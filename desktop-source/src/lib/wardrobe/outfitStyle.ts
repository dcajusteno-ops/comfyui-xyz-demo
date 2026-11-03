/**
 * 服装风格智配 + 颜色合成（`anima_v4_outfit_style.py` 的移植）。
 *
 * 两套相互独立的语义知识：
 *   ① 风格：给服装六类的每个选项打风格标；抽到定调单品后，其余部位按风格
 *      亲和度加权，并对物理上不可能的组合硬剔除。
 *   ② 颜色：颜色字段不单独输出，而是拼进目标单品的第一个 tag；
 *      `{color} {garment}` 是否真实存在由颜色矩阵离线判定，未命中就不上色。
 */
import { requireWardrobeData } from "./store";
import type { WardrobeOutfitStyle } from "./types";

const SEP = "\u0000";

let styleOfMap: Map<string, Map<string, Set<string>>> | null = null;
let styleBanMap: Map<string, Set<string>> | null = null;
let anchorBanMap: Map<string, Map<string, Set<string>>> | null = null;
let compatMap: Map<string, number> | null = null;
let preferMap: Map<string, number> | null = null;
let styleKeyByZh: Map<string, string> | null = null;

function data(): WardrobeOutfitStyle {
  return requireWardrobeData("outfitStyle");
}

export function resetOutfitStyleCache(): void {
  styleOfMap = null;
  styleBanMap = null;
  anchorBanMap = null;
  compatMap = null;
  preferMap = null;
  styleKeyByZh = null;
}

function ensureMaps(): void {
  if (styleOfMap) return;
  const payload = data();
  styleOfMap = new Map();
  for (const [field, table] of Object.entries(payload.styleOf)) {
    const inner = new Map<string, Set<string>>();
    for (const [en, raw] of Object.entries(table)) {
      inner.set(en.trim().toLowerCase(), new Set(String(raw).split(/\s+/).filter(Boolean)));
    }
    styleOfMap.set(field, inner);
  }
  styleBanMap = new Map();
  for (const row of payload.styleBans) {
    styleBanMap.set(`${row.style}${SEP}${row.field}`, new Set(row.tags));
  }
  anchorBanMap = new Map();
  for (const row of payload.anchorBans) {
    if (!anchorBanMap.has(row.anchor)) anchorBanMap.set(row.anchor, new Map());
    anchorBanMap.get(row.anchor)!.set(row.field, new Set(row.tags));
  }
  compatMap = new Map(payload.styleCompat.map((row) => [`${row.a}${SEP}${row.b}`, row.factor]));
  preferMap = new Map(payload.styleOutfitPrefer.map((row) => [`${row.a}${SEP}${row.b}`, row.factor]));
  styleKeyByZh = new Map(payload.styles.map((row) => [row.zh, row.key]));
}

export function styleChoices(): string[] {
  return data().styleChoices;
}

export function styles(): Array<{ key: string; zh: string }> {
  return data().styles;
}

export function stylesOf(fieldKey: string, en: string): Set<string> {
  ensureMaps();
  return styleOfMap?.get(fieldKey)?.get(String(en ?? "").trim().toLowerCase()) ?? new Set();
}

export function styleOfValue(fieldKey: string, en: string): Set<string> {
  return stylesOf(fieldKey, en);
}

/** 中文取值 → 风格 key；"" = 不干预，"auto" = 自动锚定。 */
export function resolveChoice(choice: string): string {
  ensureMaps();
  const c = String(choice ?? "").trim();
  if (!c || c === "不限" || c === "随机") return c === "不限" ? "" : "auto";
  return styleKeyByZh?.get(c) ?? "auto";
}

const ANCHOR_LABELS: Record<string, string> = { outfit: "整套服装", top: "上装", bottom: "下装" };

export function anchorOf(state: Record<string, unknown>, choice = "随机"): [string, string] {
  const picked = resolveChoice(choice);
  if (picked && picked !== "auto") return [picked, "控件指定"];
  if (picked === "") return ["", ""];

  const place = String(state.place ?? "").trim().toLowerCase();
  const placeStyle = data().placeStyle[place];
  if (placeStyle) return [placeStyle, "场景"];

  for (const key of ["outfit", "top", "bottom"]) {
    const found = stylesOf(key, String(state[key] ?? ""));
    if (found.size) return [[...found].sort()[0], ANCHOR_LABELS[key]];
  }
  return ["", ""];
}

export function styleBans(state: Record<string, unknown>, fieldKey: string, choice = "随机"): Set<string> {
  ensureMaps();
  const out = new Set<string>();
  const [anchor] = anchorOf(state, choice);
  if (!anchor) return out;
  for (const tag of styleBanMap?.get(`${anchor}${SEP}${fieldKey}`) ?? []) out.add(tag);
  const outfit = String(state.outfit ?? "").trim().toLowerCase();
  if (outfit) {
    for (const tag of anchorBanMap?.get(outfit)?.get(fieldKey) ?? []) out.add(tag);
  }
  return out;
}

/** 控件显式指定风格时，整套服装硬收敛（同风格优先，中性兜底）。 */
export function allowedOutfit<T extends [string, string, number]>(pool: T[], choice: string): T[] {
  const picked = resolveChoice(choice);
  if (picked === "" || picked === "auto") return pool;
  const same = pool.filter((item) => stylesOf("outfit", item[1]).has(picked));
  if (same.length) return same;
  const neutral = pool.filter((item) => stylesOf("outfit", item[1]).size === 0);
  return neutral.length ? neutral : pool;
}

export function layerBias(state: Record<string, unknown>, fieldKey: string, choice = "随机"): number {
  if (fieldKey !== "top" && fieldKey !== "bottom") return 1;
  if (resolveChoice(choice) === "") return 1;
  const outfit = String(state.outfit ?? "").trim().toLowerCase();
  if (outfit && !data().outfitPartial.includes(outfit)) return data().constants.layerSuppress;
  return 1;
}

export function outfitPrefer(anchor: string, en: string): number {
  ensureMaps();
  return preferMap?.get(`${anchor}${SEP}${String(en ?? "").trim().toLowerCase()}`) ?? 1;
}

export function styleBias(state: Record<string, unknown>, fieldKey: string, en: string, choice = "随机"): number {
  const layer = layerBias(state, fieldKey, choice);
  const [anchor] = anchorOf(state, choice);
  if (!anchor) return layer;
  const found = stylesOf(fieldKey, en);
  if (!found.size) return layer;
  if (found.has(anchor)) {
    let base = layer * data().constants.sameStyleBoost;
    if (fieldKey === "outfit") base *= outfitPrefer(anchor, en);
    return base;
  }
  let best = 0;
  for (const style of found) {
    const direct = `${anchor}${SEP}${style}`;
    const reverse = `${style}${SEP}${anchor}`;
    const pair = compatMap?.has(direct) ? direct : reverse;
    best = Math.max(best, compatMap?.get(pair) ?? data().constants.farStyleFactor);
  }
  return layer * best;
}

export function fieldOptionBias(fieldKey: string, choice: string, en: string): number {
  const payload = data();
  const picked = resolveChoice(choice);
  if (picked === "" || picked === "auto") return 1;
  const key = String(en ?? "").trim().toLowerCase();
  let want: Record<string, number> | string[] | undefined;
  let boost = payload.constants.styleMakeupBoost;
  let far = payload.constants.styleMakeupFar;

  if (fieldKey === "makeup") {
    const table = payload.styleMakeup[picked];
    // 妆容表有两种写法：直方图 {选项: 权重}，或"只列该风格要的几项"的数组。
    // 数组写法走通用的 boost/far（Python 里 `isinstance(want, dict)` 为假）。
    if (table && typeof table === "object" && !Array.isArray(table)) {
      return table[key] ?? payload.constants.styleMakeupFar;
    }
    want = table as string[] | undefined;
  } else if (["place", "light_fx", "weather"].includes(fieldKey)) {
    const table = payload.styleSceneBias[fieldKey]?.[picked];
    if (!table) return 1;
    return table.includes(key) ? payload.constants.styleSceneBoost : payload.constants.styleSceneFar;
  } else if (fieldKey === "cloth_color" || fieldKey === "sock_color") {
    want = payload.styleColor[picked];
    boost = 8;
    far = 0.08;
  } else {
    return 1;
  }

  if (!want || !Array.isArray(want)) return 1;
  return want.includes(key) ? boost : far;
}

/* ------------------------------------------------------------------ *
 * 颜色合成
 * ------------------------------------------------------------------ */

export function comboOk(color: string, garment: string): boolean {
  const row = requireWardrobeData("colorMatrix").matrix[String(color ?? "").trim().toLowerCase()];
  if (!row) return false;
  return Boolean(row[String(garment ?? "").trim().toLowerCase()]?.ok);
}

export function hasColorTag(value: string): boolean {
  const colors = data().colorTags;
  for (const raw of String(value ?? "").split(",")) {
    const tag = raw.trim().toLowerCase();
    if (!tag) continue;
    for (const color of colors) if (tag === color || tag.startsWith(`${color} `)) return true;
  }
  return false;
}

function applyColor(
  state: Record<string, unknown>,
  fieldKey: string,
  targets: string[],
  notes: string[],
): void {
  const color = String(state[fieldKey] ?? "").trim().toLowerCase();
  if (!color) return;
  delete state[fieldKey];

  let target = "";
  let first = "";
  let why = "";
  for (const key of targets) {
    const value = String(state[key] ?? "").trim();
    if (!value) continue;
    const head = value.split(",")[0].trim();
    if (hasColorTag(head)) {
      if (!why) why = `颜色「${data().colorZh[color] ?? color}」跳过：${key} 已自带颜色（${head}）`;
      continue;
    }
    if (!comboOk(color, head)) {
      if (!why) why = `颜色「${data().colorZh[color] ?? color}」跳过：\`${color} ${head}\` 不是有效组合 tag（矩阵未收录）`;
      continue;
    }
    target = key;
    first = head;
    break;
  }

  if (!target) {
    notes.push(why || `颜色「${data().colorZh[color] ?? color}」无落点（${targets.join("/")} 没有可着色的单品），已跳过`);
    return;
  }

  const parts = String(state[target] ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return;
  parts[0] = `${color} ${first}`;
  state[target] = parts.join(", ");
  notes.push(`颜色合成：${data().colorZh[color] ?? color} → ${state[target]}（${target}）`);
}

export function colorize(state: Record<string, unknown>): string[] {
  const notes: string[] = [];
  const payload = data();
  applyColor(state, "sock_color", payload.sockColorTargets, notes);
  applyColor(state, "cloth_color", payload.bodyColorTargets, notes);
  return notes;
}
