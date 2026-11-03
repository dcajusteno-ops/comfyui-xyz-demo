/**
 * 角色库（`rules.py` 的角色段 / 发型 / 外貌 / 固定特征）。
 *
 * 两个来源：
 *   ① pools.json 的 role 字段（221 条，源脚本人工核准、带 APPEAR 外貌表）
 *   ② characters.json（2383 条，独立文件）
 * 两边按 trigger 去重，源脚本的条目优先。
 */
import { deriveSeed, WardrobeRandom } from "./rng";
import { fieldWeight, sectionWeight } from "./weights";
import { gradeNsfw } from "./nsfw";
import { requireWardrobeData } from "./store";
import type { WardrobeCharacter, WardrobeWeights } from "./types";

export const GIRL_COUNT_BY_TAG: Record<string, number> = {
  "multiple girls": 3,
  orgy: 3,
  "2girls": 2,
};

export const MULTI_CLEAR_FIELDS = ["n_act", "n_pos", "n_cum"];
export const MULTI_CLEAR_OPTIONS: Record<string, Set<string>> = {
  n_theme: new Set(["threesome", "foursome", "gangbang"]),
};
export const SOLO_OK_PARTNER_OPTS = new Set(["masturbation", "fingering", "dildo riding"]);
export const PARTNER_GATED_FIELDS = ["n_act", "n_cum"];
export const GROUP_ONLY_TAGS = new Set([
  "threesome",
  "foursome",
  "gangbang",
  "bukkake",
  "excessive cum",
  "multiple creampie",
]);

export const HAIR_STYLE_FIELDS = ["hair_len", "hair_tie", "hair_curl", "hair_acc"] as const;
export const HAIR_PICK_AUTO = "角色标签发型";
export const HAIR_PICK_ALIASES = ["角色官方", "官方发型", "auto"];
export const HAIR_PICK_RANDOM = "随机";
export const HAIR_PICK_SEP = "｜";
export const HAIR_LONG_TIES = new Set([
  "twintails",
  "low ponytail",
  "high ponytail",
  "side ponytail",
  "braid",
  "single braid",
  "twin braids",
  "hair bun",
  "double bun",
  "drill hair",
  "half updo",
  "ponytail",
]);
export const HAIR_SHORT_LENS = new Set(["short hair", "bob cut"]);
export const HAIR_LEN_TAGS = new Set([
  "short hair",
  "long hair",
  "very long hair",
  "medium hair",
  "shoulder-length hair",
  "bob cut",
]);
export const HAIR_TIE_TAGS = new Set([
  "twintails",
  "ponytail",
  "low ponytail",
  "high ponytail",
  "side ponytail",
  "braid",
  "single braid",
  "twin braids",
  "hair bun",
  "double bun",
  "drill hair",
  "half updo",
]);

const ROLE_SEP = /[|;\n]/;

function tagSet(countEn: string): Set<string> {
  return new Set(
    String(countEn ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function girlCountFor(countEn: string): number {
  const tags = tagSet(countEn);
  for (const [tag, n] of Object.entries(GIRL_COUNT_BY_TAG)) if (tags.has(tag)) return n;
  return 1;
}

export function countHasPartner(countEn: string): boolean {
  const tags = tagSet(countEn);
  if (tags.has("solo")) return false;
  return ["1boy", "2boys", "multiple boys", "hetero", "group sex"].some((t) => tags.has(t));
}

export function countIsGroup(countEn: string): boolean {
  const tags = tagSet(countEn);
  return ["multiple boys", "multiple girls", "orgy", "group sex"].some((t) => tags.has(t));
}

/* ------------------------------------------------------------------ *
 * 索引
 * ------------------------------------------------------------------ */

export type WardrobeRoleOption = [zh: string, trigger: string, level: number];

let roleCache: WardrobeRoleOption[] | null = null;
let charIndexCache: Map<string, WardrobeCharacter> | null = null;
let charByTriggerCache: Map<string, WardrobeCharacter> | null = null;
let roleWorkIndexCache: Map<string, string> | null = null;
let roleNameWorksCache: Map<string, Set<string>> | null = null;
let fieldOptsCache: Map<string, Set<string>> | null = null;
let mergedCache: { characters: WardrobeCharacter[]; works: import("./types").WardrobeWork[] } | null = null;

export function resetRoleIndexes(): void {
  roleCache = null;
  charIndexCache = null;
  charByTriggerCache = null;
  roleWorkIndexCache = null;
  roleNameWorksCache = null;
  fieldOptsCache = null;
  mergedCache = null;
}

const WORK_ZH_HINT: Record<string, string> = { "fx senshi kurumi-chan": "FX战士久留美" };

/**
 * 内置角色库 + 覆盖层（`user_characters.json`）。
 *
 * 插件的 `_merge_overlay()` 做三件事，少一件前端就对不上：
 *   ① edits 覆盖 trigger / zh / work / thumb / hair / eyes，tags 整条替换；
 *   ② custom 整条追加；
 *   ③ 重算 works[].count，并给库里没有的作品名补一行。
 */
export function charactersData(): { characters: WardrobeCharacter[]; works: import("./types").WardrobeWork[] } {
  if (mergedCache) return mergedCache;
  const base = requireWardrobeData("characters");
  const overlay = requireWardrobeData("userCharacters");
  const edits = overlay.edits ?? {};

  const characters: WardrobeCharacter[] = base.characters.map((row) => {
    const patch = edits[String(row.tag ?? "")];
    if (!patch) return row;
    const merged: WardrobeCharacter = { ...row };
    for (const key of ["trigger", "zh", "work", "thumb", "hair", "eyes"] as const) {
      const value = patch[key];
      if (typeof value === "string" && value.trim()) merged[key] = value.trim();
    }
    if (Array.isArray(patch.tags) && patch.tags.length) {
      merged.tags = patch.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
    }
    return merged;
  });
  for (const row of overlay.custom ?? []) {
    characters.push({ ...row, src: row.src ?? "user" });
  }

  const works = base.works.map((w) => ({ ...w }));
  const idOfWork = new Map<string, string>();
  for (const work of works) if (!idOfWork.has(work.en)) idOfWork.set(work.en, work.id);

  for (const character of characters) {
    const work = String(character.work ?? "").trim();
    if (!work || idOfWork.has(work)) continue;
    const used = new Set(works.map((w) => w.id));
    let id = workSlug(work) || "user_work";
    let n = 2;
    while (used.has(id)) id = `${workSlug(work) || "user_work"}_${n++}`;
    works.push({
      id,
      en: work,
      zh: WORK_ZH_HINT[work.trim().toLowerCase()] ?? work,
      count: 0,
      pop: 0,
      target: false,
    });
    idOfWork.set(work, id);
  }

  const counts = new Map<string, number>();
  for (const character of characters) {
    const id = idOfWork.get(String(character.work ?? "").trim());
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const work of works) work.count = counts.get(work.id) ?? 0;
  works.sort((a, b) => b.count - a.count || (a.en < b.en ? -1 : a.en > b.en ? 1 : 0));

  mergedCache = { characters, works };
  return mergedCache;
}

function workSlug(en: string): string {
  return String(en ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function fieldOpts(fieldKey: string): Set<string> {
  if (!fieldOptsCache) {
    fieldOptsCache = new Map();
    for (const section of requireWardrobeData("pools").sections) {
      for (const field of section.fields) {
        fieldOptsCache.set(
          field.key,
          new Set((field.opts ?? []).map(([, en]) => String(en).trim().toLowerCase())),
        );
      }
    }
  }
  return fieldOptsCache.get(fieldKey) ?? new Set();
}

/** 合并后的角色候选（未按档位过滤）。 */
export function roleOptions(): WardrobeRoleOption[] {
  if (roleCache) return roleCache;
  const out: WardrobeRoleOption[] = [];
  const seen = new Set<string>();

  const roleField = requireWardrobeData("pools").sections
    .flatMap((s) => s.fields)
    .find((f) => f.key === "role");
  for (const [zh, rawEn] of roleField?.opts ?? []) {
    const en = String(rawEn ?? "").trim();
    if (!en) continue;
    const key = en.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([String(zh).trim(), en, gradeNsfw(en.split(",").map((t) => t.trim()).filter(Boolean)).num]);
  }

  for (const character of charactersData().characters) {
    const trigger = String(character.trigger || character.tag || "").trim();
    if (!trigger || seen.has(trigger.toLowerCase())) continue;
    seen.add(trigger.toLowerCase());
    const zh = character.zh || character.name || trigger;
    out.push([zh, trigger, gradeNsfw(trigger.split(",").map((t) => t.trim()).filter(Boolean)).num]);
  }

  roleCache = out;
  return out;
}

export function rolePool(lv = 99): WardrobeRoleOption[] {
  return roleOptions().filter((row) => row[2] <= lv);
}

export function charIndex(): Map<string, WardrobeCharacter> {
  if (!charIndexCache) {
    charIndexCache = new Map(charactersData().characters.map((c) => [c.tag, c]));
  }
  return charIndexCache;
}

/** trigger → 角色记录（先到先得：本体排在皮肤形态前）。 */
export function charByTrigger(): Map<string, WardrobeCharacter> {
  if (!charByTriggerCache) {
    charByTriggerCache = new Map();
    for (const c of charactersData().characters) {
      const key = String(c.trigger ?? "").trim().toLowerCase();
      if (key && !charByTriggerCache.has(key)) charByTriggerCache.set(key, c);
    }
  }
  return charByTriggerCache;
}

export function findCharacter(trigger: string): WardrobeCharacter | null {
  const key = String(trigger ?? "").trim().toLowerCase();
  if (!key) return null;
  const byTag = charIndex().get(trigger) ?? charIndex().get(key);
  if (byTag) return byTag;
  return charByTrigger().get(key) ?? null;
}

export function roleWorkIndex(): Map<string, string> {
  if (!roleWorkIndexCache) {
    roleWorkIndexCache = new Map();
    for (const c of charactersData().characters) {
      const trigger = String(c.trigger || c.tag || "").trim().toLowerCase();
      if (trigger) roleWorkIndexCache.set(trigger, workSlug(String(c.work ?? "")));
    }
  }
  return roleWorkIndexCache;
}

export function worksTable() {
  return charactersData().works;
}

export function resolveWorks(raw: string | readonly string[] | null | undefined): string[] {
  if (!raw) return [];
  const chunks = Array.isArray(raw) ? raw : String(raw).split(/[|;\n,，]/);
  const byKey = new Map<string, string>();
  for (const work of worksTable()) {
    for (const key of [work.id, work.en, work.zh]) {
      const k = String(key ?? "").trim().toLowerCase();
      if (k && !byKey.has(k)) byKey.set(k, work.id);
    }
  }
  const ids = new Set(worksTable().map((w) => w.id));
  const out: string[] = [];
  for (const chunk of chunks) {
    const key = String(chunk).trim().toLowerCase();
    if (!key) continue;
    const slug = byKey.get(key) || (ids.has(key) ? key : "");
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

export function unknownWorks(raw: string | readonly string[] | null | undefined): string[] {
  if (!raw) return [];
  const known = new Set<string>();
  for (const work of worksTable()) {
    for (const key of [work.id, work.en, work.zh]) known.add(String(key ?? "").toLowerCase());
  }
  const chunks = Array.isArray(raw) ? raw : String(raw).split(/[|;\n,，]/);
  return chunks.map((c) => String(c).trim()).filter((c) => c && !known.has(c.toLowerCase()));
}

/** 收藏（角色 tag）→ 候选池 trigger 的归一化 key 集合。 */
export function favoriteRoleKeys(favorites: readonly string[]): Set<string> {
  const keys = new Set<string>();
  const idx = charIndex();
  for (const raw of favorites) {
    const tag = String(raw ?? "").trim();
    if (!tag) continue;
    const rec = idx.get(tag) ?? idx.get(tag.toLowerCase());
    const trigger = String(rec?.trigger ?? "").trim() || normalizeRoleToken(tag);
    for (const key of [trigger, normalizeRoleToken(tag), trigger.split(",")[0], tag.replace(/_/g, " ")]) {
      const k = String(key ?? "").trim().toLowerCase();
      if (k) keys.add(k);
    }
  }
  return keys;
}

export function rolePoolByWorks(
  lv: number,
  works: readonly string[] | null | undefined,
  favoritesOnly = false,
  favorites: readonly string[] = [],
): WardrobeRoleOption[] {
  let pool = rolePool(lv);
  if (favoritesOnly) {
    const fav = favoriteRoleKeys(favorites);
    if (fav.size === 0) return [];
    pool = pool.filter((row) => fav.has(row[1].trim().toLowerCase()) || fav.has(row[1].split(",")[0].trim().toLowerCase()));
  }
  const wanted = new Set(works ?? []);
  if (wanted.size === 0) return pool;
  const index = roleWorkIndex();
  return pool.filter((row) => wanted.has(index.get(row[1].trim().toLowerCase()) ?? ""));
}

export function workPoolSizes(lv = 99): Record<string, number> {
  const out: Record<string, number> = {};
  const index = roleWorkIndex();
  for (const [, trigger] of rolePool(lv)) {
    const slug = index.get(trigger.trim().toLowerCase());
    if (slug) out[slug] = (out[slug] ?? 0) + 1;
  }
  return out;
}

/** 从角色池随机抽 n 位互不重复的角色（返回 trigger）。 */
export function pickRandomRoles(
  rng: WardrobeRandom,
  lv = 99,
  n = 1,
  works: readonly string[] | null | undefined = [],
  favoritesOnly = false,
  favorites: readonly string[] = [],
): string[] {
  const pool = rolePoolByWorks(lv, works, favoritesOnly, favorites);
  if (pool.length === 0 || n <= 0) return [];
  const take = Math.min(Math.trunc(n), pool.length);
  const indices = rng.sample(
    Array.from({ length: pool.length }, (_, i) => i),
    take,
  );
  return indices.map((i) => pool[i][1]);
}

export function parseSelectedRoles(raw: unknown): string[] {
  const out: string[] = [];
  for (const chunk of String(raw ?? "").split(ROLE_SEP)) {
    const token = chunk.trim();
    if (token && !out.includes(token)) out.push(token);
  }
  return out;
}

/** `ellen_joe_(zenless_zone_zero)` → `ellen joe, zenless zone zero`。 */
export function normalizeRoleToken(token: string): string {
  const t = String(token ?? "").trim();
  if (!t) return "";
  const m = /^(.+?)_\(([^()]+)\)$/.exec(t);
  if (m) {
    const name = m[1].replace(/_/g, " ").trim();
    const work = m[2].replace(/_/g, " ").trim();
    return name && work ? `${name}, ${work}` : name;
  }
  return t.replace(/_/g, " ").trim();
}

export function expandRoles(tokens: readonly string[]): string[] {
  const idx = charIndex();
  const out: string[] = [];
  for (const raw of tokens) {
    const token = String(raw ?? "").trim();
    if (!token) continue;
    const rec = idx.get(token) ?? idx.get(token.toLowerCase());
    const trigger = String(rec?.trigger ?? "").trim() || normalizeRoleToken(token);
    if (trigger && !out.includes(trigger)) out.push(trigger);
  }
  return out;
}

export function headcountTags(n: number, lv: number, current = ""): string {
  if (n <= 0) return "";
  if (n === 1) {
    const cur = current.toLowerCase();
    const singleOk = cur.includes("1girl") && !cur.includes("multiple") && !cur.includes("2girls") && !cur.includes("1boy");
    return singleOk ? "" : "1girl, solo";
  }
  if (n === 2) return lv <= 1 ? "2girls, multiple girls" : "2girls, yuri";
  return "multiple girls";
}

export function roleNameWorks(): Map<string, Set<string>> {
  if (roleNameWorksCache) return roleNameWorksCache;
  const index = new Map<string, Set<string>>();
  for (const c of charactersData().characters) {
    const trigger = String(c.trigger || c.tag || "").trim();
    if (!trigger) continue;
    const name = trigger.split(",")[0].trim().toLowerCase();
    let work = String(c.work ?? "").trim().toLowerCase();
    if (!work) {
      const parts = trigger.split(",").map((t) => t.trim().toLowerCase());
      work = parts[1] ?? "";
    }
    if (!index.has(name)) index.set(name, new Set());
    if (work) index.get(name)?.add(work);
  }
  roleNameWorksCache = index;
  return index;
}

export function roleNeedsWork(trigger: string): boolean {
  const trig = String(trigger ?? "").trim();
  if (!trig) return false;
  const name = trig.split(",")[0].trim().toLowerCase();
  return (roleNameWorks().get(name)?.size ?? 0) > 1;
}

export function roleOutputName(trigger: string): string {
  const trig = String(trigger ?? "").trim();
  if (!trig) return "";
  if (roleNeedsWork(trig)) return trig;
  return trig.split(",")[0].trim();
}

export function roleOutputText(state: Record<string, unknown>): string {
  const triggers = (state._role_triggers as string[] | undefined) ?? [];
  if (!triggers.length) return String(state.role ?? "");
  return triggers.map(roleOutputName).filter(Boolean).join(", ");
}

export function stripRoleWorks(tags: readonly string[], state: Record<string, unknown>): string[] {
  const triggers = (state._role_triggers as string[] | undefined) ?? [];
  if (!triggers.length) return [...tags];
  const drop = new Set<string>();
  for (const trigger of triggers) {
    const parts = String(trigger).split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (parts.length < 2 || roleNeedsWork(trigger)) continue;
    for (const part of parts.slice(1)) drop.add(part);
  }
  if (drop.size === 0) return [...tags];
  return tags.filter((tag) => !drop.has(tag));
}

export function applySelectedRoles(
  state: Record<string, unknown>,
  triggers: readonly string[],
  lv: number,
  rewriteCount = true,
): string[] {
  const list = (triggers ?? []).filter(Boolean);
  const n = list.length;
  if (!n) return [];
  const notes: string[] = [];
  state.role = list.join(", ");
  state._role_triggers = [...list];

  if (rewriteCount) {
    const head = headcountTags(n, lv, String(state.count ?? ""));
    if (head) {
      state.count = head;
      notes.push(`按选中角色数（${n} 位）改写人数标签 → \`${head}\``);
    }
    if (n >= 3) notes.push("多人群像模式：已写 `multiple girls`，不再使用双人关系标签");
    else if (n === 2 && lv <= 1) {
      notes.push("当前档位 ≤ 擦边：双人关系用中性的 `multiple girls`（`yuri` 属 2 档内容，写了会越档）");
    }
  } else {
    notes.push(`人数组合由「人数构成」决定，已填入 ${n} 位角色（未改写人数标签）`);
  }

  if (n >= 2) {
    for (const key of MULTI_CLEAR_FIELDS) if (state[key]) state[key] = "";
    for (const [key, values] of Object.entries(MULTI_CLEAR_OPTIONS)) {
      if (values.has(String(state[key] ?? "").trim().toLowerCase())) state[key] = "";
    }
    if (state._cleared_for_multi === undefined) {
      state._cleared_for_multi = true;
      notes.push("多人模式：已清空一对一正戏字段（体位 / 受方动作 / 精液）");
    }
  }
  return notes;
}

/* ------------------------------------------------------------------ *
 * 发型
 * ------------------------------------------------------------------ */

export function hairPickStrip(value: string): string {
  const v = String(value ?? "").trim();
  if (!v.includes(HAIR_PICK_SEP)) return v;
  const parts = v.split(HAIR_PICK_SEP).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return "";
  for (const part of parts) {
    if ([...part].every((ch) => ch.charCodeAt(0) < 128)) return part;
  }
  return parts[parts.length - 1];
}

export function hairPickOptions(fieldKey: string): string[] {
  const out = [HAIR_PICK_AUTO, HAIR_PICK_RANDOM];
  const field = requireWardrobeData("pools").sections.flatMap((s) => s.fields).find((f) => f.key === fieldKey);
  for (const [zhRaw, enRaw] of field?.opts ?? []) {
    const zh = String(zhRaw ?? "").trim();
    const en = String(enRaw ?? "");
    const label = zh && zh !== en ? `${zh}${HAIR_PICK_SEP}${en}` : en;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

export function hairStyleFor(roleTrigger: string): Record<string, string> {
  const trig = String(roleTrigger ?? "").trim().toLowerCase();
  if (!trig) return {};
  const data = requireWardrobeData("hairStyle");
  const index = new Map<string, Record<string, string>>();
  for (const [tag, rec] of Object.entries(data.styles)) {
    if (rec && typeof rec === "object") index.set(String(tag).trim().toLowerCase(), rec);
  }
  for (const c of charactersData().characters) {
    const tag = String(c.tag ?? "").trim().toLowerCase();
    const trigger = String(c.trigger ?? "").trim().toLowerCase();
    if (trigger && index.has(tag) && !index.has(trigger)) index.set(trigger, index.get(tag)!);
  }
  const rec = index.get(trig);
  if (!rec) return {};
  const out: Record<string, string> = {};
  for (const key of HAIR_STYLE_FIELDS) {
    const value = String(rec[key] ?? "").trim().toLowerCase();
    if (!value) continue;
    if (["none", "散开", "不束发", "loose"].includes(value)) {
      out[key] = "none";
      continue;
    }
    if (fieldOpts(key).has(value)) out[key] = value;
  }
  return out;
}

export function blockedByWeight(weights: WardrobeWeights, fieldKey: string): boolean {
  const section = requireWardrobeData("pools").sections.find((s) => s.fields.some((f) => f.key === fieldKey));
  if (section && sectionWeight(weights, section.id) <= 0) return true;
  return fieldWeight(weights, fieldKey) <= 0;
}

export function applyHairStyle(
  state: Record<string, unknown>,
  weights: WardrobeWeights,
  picks: Record<string, string> | null = null,
): string[] {
  const hs = hairStyleFor(String(state.role ?? ""));
  const resolved: Record<string, string> = {};
  for (const key of HAIR_STYLE_FIELDS) {
    const raw = hairPickStrip(String(picks?.[key] ?? HAIR_PICK_AUTO));
    resolved[key] = HAIR_PICK_ALIASES.includes(raw) ? HAIR_PICK_AUTO : raw;
  }
  const explicit = Object.values(resolved).some((v) => v !== HAIR_PICK_AUTO && v !== "");

  if (explicit) {
    const tiePick = resolved.hair_tie ?? "";
    const lenPick = resolved.hair_len ?? "";
    const lenFix =
      ![HAIR_PICK_AUTO, HAIR_PICK_RANDOM, ""].includes(tiePick) &&
      lenPick === HAIR_PICK_AUTO &&
      HAIR_LONG_TIES.has(tiePick);

    const explicitFields = HAIR_STYLE_FIELDS.filter((k) => resolved[k] !== HAIR_PICK_AUTO && resolved[k] !== "");
    if (lenFix && HAIR_SHORT_LENS.has(String(hs.hair_len ?? "")) && !explicitFields.includes("hair_len")) {
      explicitFields.push("hair_len");
    }
    state._hair_picks_explicit = explicitFields;

    const changed: string[] = [];
    for (const key of HAIR_STYLE_FIELDS) {
      const pick = resolved[key];
      if (pick === HAIR_PICK_RANDOM) {
        if (state[key]) state[key] = "";
        changed.push(key);
        continue;
      }
      let value: string | undefined;
      if (pick === HAIR_PICK_AUTO || pick === "") {
        value = hs[key];
        if (key === "hair_len" && lenFix && HAIR_SHORT_LENS.has(String(value ?? ""))) value = "long hair";
        if (value === undefined) continue;
      } else {
        value = pick;
      }
      if (blockedByWeight(weights, key)) continue;
      state[key] = value === "none" ? "" : value;
      changed.push(key);
    }
    if (changed.length) state._hair_style_applied = true;
    return changed;
  }

  if (!Object.keys(hs).length) return [];
  const changed: string[] = [];
  for (const [key, value] of Object.entries(hs)) {
    if (blockedByWeight(weights, key)) continue;
    state[key] = value === "none" ? "" : value;
    changed.push(key);
  }
  if (changed.length) state._hair_style_applied = true;
  return changed;
}

/* ------------------------------------------------------------------ *
 * 外貌 / 固定特征
 * ------------------------------------------------------------------ */

export function appearanceFor(roleTrigger: string): Record<string, string> {
  const trig = String(roleTrigger ?? "").trim().toLowerCase();
  if (!trig) return {};
  const appear = requireWardrobeData("pools").appear;
  const direct = appear[roleTrigger] ?? appear[trig];
  if (direct) return { ...direct };

  const c = charByTrigger().get(trig);
  if (!c) return {};
  const out: Record<string, string> = {};
  const hair = String(c.hair ?? "").trim().toLowerCase();
  const eyes = String(c.eyes ?? "").trim().toLowerCase();
  if (hair) out.hair = hair.endsWith("hair") ? hair : `${hair} hair`;
  if (eyes) out.eyes = eyes.endsWith("eyes") ? eyes : `${eyes} eyes`;

  for (const raw of c.tags ?? []) {
    const tag = String(raw).trim().toLowerCase();
    if (!tag || tag.length > 40) continue;
    if (tag.includes("hair") && !out.hair) out.hair = tag;
    else if (tag.includes("eyes") && !out.eyes) out.eyes = tag;
    else if (
      ["huge breasts", "large breasts", "medium breasts", "small breasts", "flat chest"].includes(tag) &&
      !out.figure
    ) {
      out.figure = tag;
    }
  }
  return out;
}

export function applyAppearance(state: Record<string, unknown>, weights: WardrobeWeights): string[] {
  const appearance = appearanceFor(String(state.role ?? ""));
  if (!Object.keys(appearance).length) return [];
  const changed: string[] = [];
  const pairs: Array<[string, string]> = [
    ["hair", "hair_color"],
    ["eyes", "eyes_color"],
    ["figure", "figure"],
    ["skin", "skin"],
    ["face", "face_shape"],
  ];
  for (const [src, dst] of pairs) {
    if (!appearance[src]) continue;
    if (blockedByWeight(weights, dst)) continue;
    state[dst] = appearance[src];
    changed.push(dst);
  }
  return changed;
}

export function charFeatFor(
  roleTrigger: string,
  seed?: number,
): [string[], string[], Record<string, string>] {
  const trig = String(roleTrigger ?? "").trim().toLowerCase();
  if (!trig) return [[], [], {}];
  const feats = requireWardrobeData("charFeat").feats;
  const index = new Map<string, Record<string, unknown>>();
  for (const [tag, rec] of Object.entries(feats)) {
    if (rec && typeof rec === "object") index.set(String(tag).trim().toLowerCase(), rec);
  }
  for (const c of charactersData().characters) {
    const tag = String(c.tag ?? "").trim().toLowerCase();
    const trigger = String(c.trigger ?? "").trim().toLowerCase();
    if (trigger && index.has(tag) && !index.has(trigger)) index.set(trigger, index.get(tag)!);
  }
  const rec = index.get(trig);
  if (!rec) return [[], [], {}];

  const extras: string[] = [];
  for (const raw of (rec.extras as string[] | undefined) ?? []) {
    const tag = String(raw).trim().toLowerCase();
    if (tag && !extras.includes(tag)) extras.push(tag);
  }

  const picks = rec.pick as Record<string, string[]> | undefined;
  if (picks && typeof picks === "object") {
    for (const [name, pool] of Object.entries(picks)) {
      const candidates = (pool ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
      if (!candidates.length) continue;
      let pick: string;
      if (seed === undefined || seed < 0) {
        pick = candidates[new WardrobeRandom().randrange(candidates.length)];
      } else {
        pick = candidates[deriveSeed(seed, `charfeat:${name}`, 0) % candidates.length];
      }
      if (!extras.includes(pick)) extras.push(pick);
    }
  }

  const drops: string[] = [];
  for (const raw of (rec.drop as string[] | undefined) ?? []) {
    const key = String(raw).trim();
    if (key && !drops.includes(key)) drops.push(key);
  }

  const sets: Record<string, string> = {};
  for (const [key, raw] of Object.entries((rec.set as Record<string, string> | undefined) ?? {})) {
    const fieldKey = String(key).trim();
    const field = requireWardrobeData("pools").sections.flatMap((s) => s.fields).find((f) => f.key === fieldKey);
    if (!field) continue;
    const value = String(raw).trim().toLowerCase();
    if ((field.opts ?? []).some(([, en]) => String(en).trim().toLowerCase() === value)) sets[fieldKey] = value;
  }
  return [extras, drops, sets];
}
