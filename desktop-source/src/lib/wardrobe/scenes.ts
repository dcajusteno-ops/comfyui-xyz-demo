/**
 * 场景搭配库（`rules.py` 的场景段）。
 *
 * 261 条场景与法典 14 组共用 `n_canon`：`applyPreset()` 把场景里的固定字段
 * 写进 state，并与普通抽取共享**三条闸门**（档位 / 权重 / 锁定）。
 * `manual_only`（特写 60 条）默认不进随机池。
 */
import {
  blockedByWeight,
  countSatisfies,
  EXPRESSION_FIELDS,
  forcedSexCountTarget,
  HAIR_STYLE_FIELDS,
} from "./characters";
import { bansFor } from "./link";
import { canonLevel, countLockLevel, optionLevel } from "./levels";
import { deriveSeed, WardrobeRandom } from "./rng";
import { DROP_ORDER } from "./slots";
import { fieldWeight, optionWeight, emptyWeights, tunedWeightFields, WEIGHT_MAX } from "./weights";
import { gradeNsfw } from "./nsfw";
import { requireWardrobeData } from "./store";
import type { WardrobeScene, WardrobeWeights } from "./types";

export const SCENE_FORBIDDEN_FIELDS = new Set(["count", "role"]);
const SCENE_LEVEL_MATCH_P = 1;
const SCENE_LEVEL_MATCH_P_SMALL = 1;
const SCENE_LEVEL_MIN_POOL = 15;
const SCENE_ALWAYS = false;
const SCENE_TARGET_APPEAR = 0.6;
const SCENE_APPEAR_P = 0.12;

let sceneCache: WardrobeScene[] | null = null;
let indexCache: Map<string, WardrobeScene> | null = null;
let canonCache: Map<string, Record<string, string>> | null = null;

export function resetSceneIndexes(): void {
  sceneCache = null;
  indexCache = null;
  canonCache = null;
}

export function sceneList(): WardrobeScene[] {
  if (!sceneCache) sceneCache = requireWardrobeData("scenes").scenes;
  return sceneCache;
}

export function sceneIndex(): Map<string, WardrobeScene> {
  if (!indexCache) indexCache = new Map(sceneList().map((scene) => [scene.id, scene]));
  return indexCache;
}

export function sceneGroups() {
  return requireWardrobeData("scenes").groups;
}

function fieldsByKey() {
  return new Map(requireWardrobeData("pools").sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
}

/** 场景 id → `{字段: 值}` + `n_extra`（与法典预设同形状）。 */
export function scenePreset(id: string): Record<string, string> {
  const scene = sceneIndex().get(String(id ?? ""));
  if (!scene) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(scene.tags ?? {})) {
    if (SCENE_FORBIDDEN_FIELDS.has(key) || !value) continue;
    out[key] = value;
  }
  const extra = String(scene.extra ?? "").trim();
  if (extra) out.n_extra = extra;
  // v4.4.2：场景级自然语言（可选键 scene_nl）。键名不能叫 `nl` —— 词库里
  // 已经有 `nl` 字段，同名会被当成真实字段写进 state 并被密度裁剪削掉。
  const nl = String(scene.scene_nl ?? "").trim();
  if (nl) out.scene_nl = nl;
  return out;
}

/* ------------------------------------------------------------------ *
 * 场景推荐画幅（v5.0.1 旁挂表）
 * ------------------------------------------------------------------ */

let aspectsCache: Record<string, { a: string; why?: string }> | null = null;

export function sceneAspects(): Record<string, { a: string; why?: string }> {
  if (aspectsCache) return aspectsCache;
  aspectsCache = {};
  for (const [id, rec] of Object.entries(requireWardrobeData("sceneAspects").aspects ?? {})) {
    const aspect = String(rec?.a ?? "").trim().toLowerCase();
    aspectsCache[id] = {
      a: ["portrait", "landscape", "both"].includes(aspect) ? aspect : "both",
      why: String(rec?.why ?? ""),
    };
  }
  return aspectsCache;
}

/** 单条场景的推荐画幅；没标注的按 `both`（竖横都行）。 */
export function sceneAspect(presetId: string): "portrait" | "landscape" | "both" {
  const aspect = sceneAspects()[String(presetId ?? "")]?.a;
  return aspect === "portrait" || aspect === "landscape" ? aspect : "both";
}

/** 全部预设：法典 14 组 + 场景库，合并成唯一入口。 */
export function canon(): Map<string, Record<string, string>> {
  if (canonCache) return canonCache;
  const map = new Map<string, Record<string, string>>(
    Object.entries(requireWardrobeData("pools").canon ?? {}),
  );
  for (const scene of sceneList()) {
    const preset = scenePreset(scene.id);
    if (Object.keys(preset).length) map.set(scene.id, preset);
  }
  canonCache = map;
  return map;
}

export function sceneSaysNoRole(id: unknown): boolean {
  const scene = sceneIndex().get(String(id ?? ""));
  return scene?.no_role === true;
}

export type WardrobeSceneVariantPool = {
  key: string;
  label: string;
  items: Array<{ zh: string; extra: string; nl?: string; nlExtra?: string }>;
};

export function sceneRandomVariants(id: string): WardrobeSceneVariantPool[] {
  const scene = sceneIndex().get(String(id ?? ""));
  const raw = scene?.random_variants;
  if (!raw) return [];

  const itemsOf = (value: unknown): WardrobeSceneVariantPool["items"] => {
    const out: WardrobeSceneVariantPool["items"] = [];
    for (const item of (value as unknown[]) ?? []) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const extra = String(rec.extra ?? "").trim();
      if (!extra) continue;
      const row: WardrobeSceneVariantPool["items"][number] = {
        zh: String(rec.zh ?? "").trim() || "变体",
        extra,
      };
      // v4.4.5：变体也能带自然语言。`nl` 覆盖场景 scene_nl（主维度），
      // `nl_extra` 追加在场景 scene_nl 之后（副维度）。
      const nl = String(rec.nl ?? "").trim();
      if (nl) row.nl = nl;
      const nlExtra = String(rec.nl_extra ?? "").trim();
      if (nlExtra) row.nlExtra = nlExtra;
      out.push(row);
    }
    return out;
  };

  const pools: WardrobeSceneVariantPool[] = [];
  if (Array.isArray(raw)) {
    const items = itemsOf(raw);
    if (items.length) pools.push({ key: "main", label: "", items });
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      let label = "";
      let body: unknown = value;
      if (value && typeof value === "object" && !Array.isArray(value) && "items" in value) {
        const rec = value as Record<string, unknown>;
        label = String(rec.label ?? "");
        body = rec.items ?? [];
      }
      const items = itemsOf(body);
      if (items.length) pools.push({ key, label, items });
    }
  }
  return pools;
}

export function sceneRandomFields(id: string): Record<string, string[]> {
  const scene = sceneIndex().get(String(id ?? ""));
  const out: Record<string, string[]> = {};
  for (const [key, cands] of Object.entries(scene?.random_fields ?? {})) {
    if (SCENE_FORBIDDEN_FIELDS.has(key)) continue;
    const values = (cands ?? []).map((v) => String(v)).filter((v) => v.trim());
    if (values.length) out[key] = values;
  }
  return out;
}

/** 按档位过滤的场景候选；`manual_only` 默认排除。 */
export function sceneOptions(lv = 99, includeManual = false): Array<[string, string, number]> {
  return sceneList()
    .filter((scene) => Number(scene.level ?? 0) <= lv && (includeManual || !scene.manual_only))
    .map((scene) => [scene.zh || scene.id, scene.id, Number(scene.level ?? 0)]);
}

export function manualSceneOptions(lv = 99): Array<[string, string, number]> {
  return sceneList()
    .filter((scene) => scene.manual_only && Number(scene.level ?? 0) <= lv)
    .map((scene) => [scene.zh || scene.id, scene.id, Number(scene.level ?? 0)]);
}

/** 给 n_canon 候选池补上「被显式套用」的 manual_only 预设。 */
export function canonPoolForDraw(
  pool: Array<[string, string, number]>,
  lv: number,
  weights: WardrobeWeights,
): Array<[string, string, number]> {
  const have = new Set(pool.map(([, en]) => en));
  const extra: Array<[string, string, number]> = [];
  for (const [zh, id, level] of manualSceneOptions(lv)) {
    if (have.has(id)) continue;
    if (optionWeight(weights, "n_canon", id) >= WEIGHT_MAX) extra.push([zh, id, level]);
  }
  return extra.length ? [...pool, ...extra] : pool;
}

export function sceneLevelMatchP(lv: number): number {
  if (lv <= 0) return 0;
  return SCENE_LEVEL_MATCH_P;
}

/** 按档位分层收敛 n_canon 候选池。 */
export function sceneLevelLayered(
  pool: Array<[string, string, number]>,
  lv: number,
  weights: WardrobeWeights,
  coin: number,
): [Array<[string, string, number]>, string | null] {
  if (lv <= 0 || pool.length <= 1) return [pool, null];
  for (const [, en] of pool) {
    if (optionWeight(weights, "n_canon", en) >= WEIGHT_MAX) return [pool, null];
  }
  const exact = pool.filter((it) => it[2] === lv);
  const lower = pool.filter((it) => it[2] < lv);
  if (!exact.length || !lower.length) return [pool, null];
  const p = sceneLevelMatchP(lv);
  if (coin < p) {
    return [exact, `场景档位匹配：本轮只在 L${lv} 的 ${exact.length} 条里抽（命中率 ${Math.round(p * 100)}%）`];
  }
  return [lower, `场景档位匹配：本轮走低档兜底（L0–L${lv - 1} 共 ${lower.length} 条，${Math.round((1 - p) * 100)}%）`];
}

function fieldOkUnder(fieldKey: string, en: string, lv: number): boolean {
  if (fieldKey === "n_canon") return true;
  return optionLevel(fieldKey, en) <= lv;
}

/** 把一段逗号串按档位切开。返回 [保留串, 剔除列表]。 */
export function splitByLevel(text: string, lv: number): [string, string[]] {
  const keep: string[] = [];
  const removed: string[] = [];
  for (const raw of String(text ?? "").split(",")) {
    const tag = raw.trim();
    if (!tag) continue;
    if (gradeNsfw([tag]).num <= lv) keep.push(tag);
    else removed.push(tag);
  }
  return [keep.join(", "), removed];
}

export function applyBans(state: Record<string, unknown>, presetId: string): string[] {
  const scene = sceneIndex().get(String(presetId ?? ""));
  const bans = new Set(scene?.ban_tags ?? []);
  if (!bans.size) return [];
  const hit: string[] = [];
  for (const [key, value] of Object.entries(state)) {
    if (key.startsWith("_") || !value) continue;
    if (bans.has(String(value).trim())) {
      state[key] = "";
      hit.push(key);
    }
  }
  return hit;
}

/** 场景一键填充。返回实际填入的字段中文标签。 */
export function applyPreset(
  state: Record<string, unknown>,
  presetId: string,
  lv: number,
  weights: WardrobeWeights = emptyWeights(),
  locks: Iterable<string> = [],
  rng?: WardrobeRandom,
  variantPick?: number,
  variantSeed?: number,
): string[] {
  const preset = canon().get(presetId);
  if (!preset) return [];
  const lockSet = new Set(locks);
  const filled: string[] = [];
  const written: string[] = [];
  const fields = fieldsByKey();
  const forcedKeys = new Set(((state._forced_tags as Array<[string, string, string]> | undefined) ?? []).map((f) => f[0]));
  const tunedKeys = tunedWeightFields(weights);

  // v4.4.2：场景级自然语言 → 下划线键，由 collectWithFeat 拼进 tail_extra
  const sceneNl = String(preset.scene_nl ?? "").trim();
  if (sceneNl) state._scene_nl = sceneNl;

  // v4.2.0：场景档位决定「表情谁说了算」—— L2+ 场景表情优先；L0/L1 权重点名优先
  const sceneLv = canonLevel(presetId);
  const exprSceneWins = sceneLv >= 2;
  const overrode: string[] = [];

  for (const [key, value] of Object.entries(preset)) {
    const field = fields.get(key);
    if (!field || !value) continue;
    if (key === "n_extra" || key === "scene_nl") continue;
    if (lockSet.has(key)) continue;
    if (forcedKeys.has(key)) {
      if (!(EXPRESSION_FIELDS.has(key) && exprSceneWins)) continue;
      overrode.push(key);
    }
    if (blockedByWeight(weights, key)) continue;
    // v4.3.0：选项权重 0 = 这一项永不出现（场景写死也不能绕过）
    if (optionWeight(weights, key, String(value)) <= 0) {
      filled.push(`${field.lab ?? key} 让路（该选项权重 0）`);
      continue;
    }
    if (fieldOkUnder(key, value, lv)) {
      state[key] = value;
      written.push(key);
      filled.push(field.lab ?? key);
      if (tunedKeys.has(key)) filled.push(`${field.lab ?? key} 由场景决定（选项权重本次未参与）`);
    }
  }

  const scene = sceneIndex().get(presetId) ?? ({} as WardrobeScene);
  const countLock = String(scene.count_lock ?? "").trim();
  // v4.2.1：点名的性行为压过场景的人数固定值
  const need = forcedSexCountTarget(weights);
  const lockConflict = Boolean(countLock) && !countSatisfies(countLock, need);
  if (
    countLock &&
    !lockSet.has("count") &&
    !forcedKeys.has("count") &&
    !lockConflict &&
    !blockedByWeight(weights, "count") &&
    countLockLevel(countLock) <= lv
  ) {
    state.count = countLock;
    written.push("count");
    filled.push(`人数·${countLock}`);
  } else if (countLock && lockConflict) {
    filled.push(`人数让路（点名的性行为需要 \`${need}\`，未写 ${countLock}）`);
  }

  for (const key of scene.drop_fields ?? []) {
    if (SCENE_FORBIDDEN_FIELDS.has(key) || lockSet.has(key)) continue;
    // v4.1.1：被选项权重 3.0 点名的字段，场景闭麦声明不该撤掉（显式 > 预设）
    if (forcedKeys.has(key)) continue;
    if (state[key]) {
      state[key] = "";
      filled.push(`闭麦·${key}`);
    }
  }

  const picked: Record<string, string[]> = {};
  for (const [key, cands] of Object.entries(sceneRandomFields(presetId))) {
    const field = fields.get(key);
    if (!field || lockSet.has(key) || blockedByWeight(weights, key)) continue;
    const ok = cands.filter((v) => fieldOkUnder(key, v, lv));
    if (!ok.length) continue;
    const value = rng ? ok[Math.min(Math.trunc(rng.random() * ok.length), ok.length - 1)] : ok[0];
    state[key] = value;
    written.push(key);
    picked[key] = ok;
    const zh = (field.opts ?? []).find(([, en]) => en === value)?.[0] ?? value;
    filled.push(`${field.lab ?? key}·${zh}`);
  }

  for (const [key, ok] of Object.entries(picked)) {
    if (!state[key]) continue;
    const banned = bansFor(state, key);
    if (!banned.has(String(state[key]))) continue;
    const alt = ok.filter((c) => !banned.has(c));
    const field = fields.get(key);
    if (alt.length) {
      state[key] = rng ? alt[Math.min(Math.trunc(rng.random() * alt.length), alt.length - 1)] : alt[0];
      const zh = (field?.opts ?? []).find(([, en]) => en === state[key])?.[0] ?? state[key];
      filled.push(`${field?.lab ?? key}→${zh}（避开联动矛盾）`);
    } else {
      state[key] = "";
      filled.push(`${field?.lab ?? key}（候选与本轮其它字段全冲突，未写入）`);
    }
  }

  let extra = preset.n_extra;
  let variantZh = "";
  const variants = sceneRandomVariants(presetId);
  if (variants.length && !lockSet.has("n_extra") && !blockedByWeight(weights, "n_extra")) {
    const names: string[] = [];
    let variantNl = "";
    const variantAdds: string[] = [];
    for (const pool of variants) {
      let x: number;
      if (variantSeed !== undefined) x = new WardrobeRandom(deriveSeed(variantSeed, `variant:${pool.key}`, 0)).random();
      else if (variantPick !== undefined) x = Number(variantPick);
      else x = rng ? rng.random() : 0;
      const index = Math.min(Math.trunc(x * pool.items.length), pool.items.length - 1);
      const item = pool.items[index];
      names.push(item.zh);
      extra = extra ? `${extra}, ${item.extra}` : item.extra;
      if (item.nl) variantNl = item.nl;
      if (item.nlExtra) variantAdds.push(item.nlExtra);
    }
    variantZh = names.join(" / ");
    if (variantNl || variantAdds.length) {
      const base = variantNl || String(state._scene_nl ?? "").trim();
      const joined = [base, ...variantAdds].filter(Boolean).join(" ");
      if (joined) state._scene_nl = joined;
    }
  }

  if (extra && !lockSet.has("n_extra") && !blockedByWeight(weights, "n_extra")) {
    const [kept, removed] = splitByLevel(extra, lv);
    if (kept) {
      state.n_extra = kept;
      written.push("n_extra");
      filled.push("场景补充");
    }
    if (removed.length) state._n_extra_removed = removed;
  }
  if (variantZh) {
    state._scene_variant = variantZh;
    filled.push(`构图·${variantZh}`);
  }

  for (const key of applyBans(state, presetId)) filled.push(`禁项·${key}`);
  state._preset_fields = written;
  state.n_canon = presetId;
  // v4.2.0：被场景表情盖掉的「用户点名必现」字段 —— 报告里要如实说明
  if (overrode.length) state._preset_overrode_forced = overrode;
  return filled;
}

/* ------------------------------------------------------------------ *
 * 标签数上限
 * ------------------------------------------------------------------ */

export function tagCapFor(countEn: string): number {
  const count = String(countEn ?? "");
  const solo = count.includes("solo") && !count.includes("multiple");
  const duo = /hetero|yuri|1boy/.test(count);
  return solo ? 29 : duo ? 37 : 45;
}

export function tagWindow(countEn: string): [number, number] {
  const count = String(countEn ?? "");
  const solo = count.includes("solo") && !count.includes("multiple");
  const duo = /hetero|yuri|1boy/.test(count);
  const multi = /multiple|orgy|group sex/.test(count);
  if (solo) return [16, 30];
  if (duo) return [22, 38];
  if (multi) return [30, 48];
  return [16, 42];
}

function countOf(value: unknown): number {
  return String(value ?? "")
    .split(",")
    .filter((t) => t.trim()).length;
}

export function trimToCap(state: Record<string, unknown>, cap: number, weights: WardrobeWeights): string[] {
  const uniqEst = () => {
    const seen = new Set<string>();
    for (const [key, value] of Object.entries(state)) {
      if (key.startsWith("_")) continue;
      for (const raw of String(value ?? "").split(",")) {
        const tag = raw.trim().toLowerCase();
        if (tag) seen.add(tag);
      }
    }
    return seen.size;
  };

  let est = uniqEst();
  if (est <= cap) return [];

  const protectedKeys = new Set(["count", "role", "n_canon", "nl", "n_extra"]);
  const presetId = String(state.n_canon ?? "");
  if (presetId) {
    for (const key of canon().get(presetId) ? Object.keys(canon().get(presetId)!) : []) protectedKeys.add(key);
  }
  for (const key of (state._preset_fields as string[] | undefined) ?? []) protectedKeys.add(key);
  if (state._breast_size || state._big_breasts) protectedKeys.add("figure");
  if (state._hair_style_applied) for (const key of HAIR_STYLE_FIELDS) protectedKeys.add(key);
  if (state.role) {
    protectedKeys.add("hair_color");
    protectedKeys.add("eyes_color");
  }
  // v4.1.1：被选项权重 3.0 点名的字段不参与密度裁剪（用户点名 = 这张必须有）
  for (const row of (state._forced_tags as Array<[string, string, string]> | undefined) ?? []) {
    protectedKeys.add(row[0]);
  }
  // v4.2.2：双女正戏补上来的穿戴式道具同样不参与裁剪
  if (state._toy_rule) protectedKeys.add("n_theme");

  const softness = new Map(DROP_ORDER.map((key, index) => [key, index]));
  const candidates = Object.entries(state)
    .filter(([key, value]) => value && !key.startsWith("_") && !protectedKeys.has(key))
    .map(([key]) => key);
  candidates.sort((a, b) => {
    const wa = fieldWeight(weights, a);
    const wb = fieldWeight(weights, b);
    if (wa !== wb) return wa - wb;
    const sa = softness.has(a) ? 0 : 1;
    const sb = softness.has(b) ? 0 : 1;
    return sa - sb;
  });

  const dropped: string[] = [];
  for (const key of candidates) {
    if (est <= cap) break;
    dropped.push(key);
    state[key] = "";
    est = uniqEst();
  }
  return dropped;
}

export { SCENE_APPEAR_P, SCENE_ALWAYS, SCENE_LEVEL_MATCH_P_SMALL, SCENE_LEVEL_MIN_POOL, SCENE_TARGET_APPEAR, countOf };
