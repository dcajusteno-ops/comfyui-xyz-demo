/**
 * NSFW 判定表（`anima_v4_nsfw.py` 的移植）。
 *
 * 这是「成品层判档」的唯一真源：`tag_level()` / `repair()` / 报告都走它。
 * 与插件逐字对齐的前提是**不要加启发式**——判定 = 逐标签表的并集，
 * 多标签叠加不升级。
 */
import { requireWardrobeData } from "./store";
import type { WardrobeLevelKey, WardrobeNsfwTables } from "./types";

const patternCache = new Map<string, RegExp>();

function regexOf(pattern: string): RegExp {
  let re = patternCache.get(pattern);
  if (!re) {
    re = new RegExp(pattern);
    patternCache.set(pattern, re);
  }
  return re;
}

function tables(): WardrobeNsfwTables {
  return requireWardrobeData("nsfwTables");
}

export function normalizeTags(tags: string | readonly string[] | null | undefined): string[] {
  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }
  return (tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
}

/** Python `_has`：EXACT_ONLY 里的词要求整词相等，其余按子串。 */
function hasWord(tag: string, words: ReadonlySet<string>, exactOnly: ReadonlySet<string>): boolean {
  for (const word of words) {
    if (exactOnly.has(word)) {
      if (tag === word) return true;
    } else if (tag.includes(word)) {
      return true;
    }
  }
  return false;
}

function explicitHits(low: string[]): string[] {
  const data = tables();
  const exact = new Set(data.explicitTags);
  const exceptions = new Set(data.explicitExceptions);
  const hits = low.filter((t) => exact.has(t) && !exceptions.has(t));
  if (hits.length) return hits;
  for (const tag of low) {
    if (exceptions.has(tag)) continue;
    if (data.explicitPatterns.some((pattern) => regexOf(pattern).test(tag))) hits.push(tag);
  }
  return hits;
}

function suggestiveHits(low: string[]): string[] {
  const data = tables();
  const suggestive = new Set(data.suggestiveTags);
  const exactOnly = new Set(data.exactOnly);
  return low.filter((t) => suggestive.has(t) || hasWord(t, suggestive, exactOnly));
}

function nsfwCategories(low: string[]): Record<string, string[]> {
  const hits: Record<string, string[]> = {};
  for (const [cat, spec] of Object.entries(tables().tables)) {
    const found: string[] = [];
    for (const tag of low) {
      if (spec.tags.includes(tag) || spec.patterns.some((pattern) => regexOf(pattern).test(tag))) {
        found.push(tag);
      }
    }
    if (found.length) hits[cat] = found;
  }
  return hits;
}

export function nsfwCore(low: string[]): {
  num: number;
  cats: Record<string, string[]>;
  reason: string;
} {
  const data = tables();
  const cats = nsfwCategories(low);
  const catKeys = Object.keys(cats);
  if (data.extremeCategories.some((c) => c in cats)) {
    return { num: data.nsfwMax, cats, reason: "命中极端向内容（第 5 级）" };
  }
  if (data.hardcoreCategories.some((c) => c in cats)) {
    return { num: 3, cats, reason: "命中过激向内容" };
  }
  const expl = explicitHits(low);
  const sug = suggestiveHits(low);
  let num = expl.length ? 2 : sug.length ? 1 : 0;
  if (catKeys.length) {
    num = Math.max(num, ...catKeys.map((cat) => data.tables[cat].level));
  }
  const reason = expl.length ? "命中成人裸露词" : sug.length ? "命中暗示向标签" : "无暴露向标签";
  return { num, cats, reason };
}

export function gradeNsfw(tags: string | readonly string[]): {
  level: WardrobeLevelKey;
  num: number;
  label: string;
  categories: Record<string, string[]>;
  hits: string[];
  reason: string;
  base: string;
  isExtreme: boolean;
} {
  const data = tables();
  const low = normalizeTags(tags);
  const { num, cats, reason } = nsfwCore(low);
  const level = data.nsfwKeyOfNum[String(num)] as WardrobeLevelKey;
  const categories: Record<string, string[]> = {};
  for (const cat of data.categoryOrder) {
    if (cat in cats) categories[data.tables[cat].label] = cats[cat];
  }
  const hits: string[] = [];
  for (const cat of data.categoryOrder) if (cat in cats) hits.push(...cats[cat]);
  return {
    level,
    num,
    label: data.nsfwLabel[level] ?? data.levelZh[level] ?? level,
    categories,
    hits,
    reason,
    base: ["sfw", "suggestive", "explicit", "explicit", "explicit"][num] ?? "explicit",
    isExtreme: num >= data.nsfwMax,
  };
}

export function levels(): string[] {
  return tables().levels;
}

export function levelZh(): Record<string, string> {
  return tables().levelZh;
}

export function targetNum(): Record<string, number> {
  return tables().targetNum;
}

export function resolveLevel(value: unknown, fallback = "suggestive"): WardrobeLevelKey {
  const data = tables();
  const safeFallback = (data.levels.includes(fallback) ? fallback : "suggestive") as WardrobeLevelKey;
  if (value === null || value === undefined || value === "") return safeFallback;
  const v = String(value).trim();
  if (Object.prototype.hasOwnProperty.call(data.levelRank, v)) return v as WardrobeLevelKey;
  const low = v.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(data.levelRank, low)) return low as WardrobeLevelKey;
  if (Object.prototype.hasOwnProperty.call(data.levelAlias, v)) {
    return data.levelAlias[v] as WardrobeLevelKey;
  }
  if (Object.prototype.hasOwnProperty.call(data.levelAlias, low)) {
    return data.levelAlias[low] as WardrobeLevelKey;
  }
  const m = /^([0-4])\b/.exec(v);
  if (m) return data.levelAlias[m[1]] as WardrobeLevelKey;
  for (const [zh, key] of [
    ["全年龄", "sfw"],
    ["擦边", "suggestive"],
    ["成人", "explicit"],
    ["过激", "hardcore"],
    ["极端", "extreme"],
    ["不限", "any"],
  ] as const) {
    if (v.includes(zh)) return key;
  }
  return safeFallback;
}

export function levelNum(value: unknown, fallback = "suggestive"): number {
  const key = resolveLevel(value, fallback);
  return targetNum()[key] ?? 1;
}

export function levelLabel(value: unknown): string {
  const key = resolveLevel(value);
  if (key === "any") return "不限";
  const num = targetNum()[key] ?? 0;
  return `${num} · ${levelZh()[key] ?? key}`;
}

export function nsfwScale(): Array<{ num: number; key: string; zh: string; desc: string }> {
  return tables().scale;
}
