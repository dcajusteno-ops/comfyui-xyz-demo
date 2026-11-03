/**
 * 三层权重（段 / 字段 / 选项）。
 *
 * 与插件 `weights_json` **同构**：`{sections, fields, options}`，
 * options 的键是 `en.toLowerCase()`。因此 `dumpWeights()` 的输出可以原样贴回
 * 插件节点，用户在两边调好的参数不会丢。
 */
import { pyRound, WardrobeRandom } from "./rng";
import { requireWardrobeData } from "./store";
import type { WardrobeWeights } from "./types";

export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 3;
export const DEFAULT_WEIGHT = 1;
export const DEFAULT_BASE_PROB = 0.65;

export function emptyWeights(): WardrobeWeights {
  return { sections: {}, fields: {}, options: {} };
}

function asWeight(value: unknown): number | null {
  let n: number;
  if (typeof value === "boolean") n = value ? 1 : 0;
  else if (typeof value === "number") n = value;
  else if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    n = Number(text);
  } else return null;
  if (Number.isNaN(n)) return null;
  return Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, n));
}

/** 永远不抛：空串 / 非法 JSON / 类型不对 → 空表（= 全默认 1.0）。 */
export function parseWeights(raw: unknown): WardrobeWeights {
  let data: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return emptyWeights();
    try {
      data = JSON.parse(text);
    } catch {
      return emptyWeights();
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return emptyWeights();
  const source = data as Record<string, unknown>;
  const out = emptyWeights();

  for (const scope of ["sections", "fields"] as const) {
    const bag = source[scope];
    if (!bag || typeof bag !== "object" || Array.isArray(bag)) continue;
    for (const [key, value] of Object.entries(bag)) {
      const weight = asWeight(value);
      if (weight !== null) out[scope][String(key)] = weight;
    }
  }

  const bag = source.options;
  if (bag && typeof bag === "object" && !Array.isArray(bag)) {
    for (const [field, sub] of Object.entries(bag)) {
      if (!sub || typeof sub !== "object" || Array.isArray(sub)) continue;
      const clean: Record<string, number> = {};
      for (const [key, value] of Object.entries(sub as Record<string, unknown>)) {
        const weight = asWeight(value);
        if (weight !== null) clean[String(key).trim().toLowerCase()] = weight;
      }
      if (Object.keys(clean).length) out.options[String(field)] = clean;
    }
  }
  return out;
}

/** 回写成控件文本：只写非默认项；空表返回空串。 */
export function dumpWeights(weights: WardrobeWeights): string {
  const out: Record<string, unknown> = {};
  for (const scope of ["sections", "fields"] as const) {
    const bag: Record<string, number> = {};
    for (const [key, value] of Object.entries(weights[scope] ?? {})) {
      if (Math.abs(value - DEFAULT_WEIGHT) > 1e-9) bag[key] = pyRound(value, 3);
    }
    if (Object.keys(bag).length) out[scope] = bag;
  }
  const options: Record<string, Record<string, number>> = {};
  for (const [field, sub] of Object.entries(weights.options ?? {})) {
    const bag: Record<string, number> = {};
    for (const [key, value] of Object.entries(sub)) {
      if (Math.abs(value - DEFAULT_WEIGHT) > 1e-9) bag[key] = pyRound(value, 3);
    }
    if (Object.keys(bag).length) options[field] = bag;
  }
  if (Object.keys(options).length) out.options = options;
  return Object.keys(out).length ? JSON.stringify(out, null, 1) : "";
}

export function sectionWeight(weights: WardrobeWeights, sectionId: string): number {
  return weights.sections[sectionId] ?? DEFAULT_WEIGHT;
}

export function fieldWeight(weights: WardrobeWeights, fieldKey: string): number {
  return weights.fields[fieldKey] ?? DEFAULT_WEIGHT;
}

export function optionWeight(weights: WardrobeWeights, fieldKey: string, en: string): number {
  return weights.options[fieldKey]?.[String(en).trim().toLowerCase()] ?? DEFAULT_WEIGHT;
}

/** 加权随机取一项；全 0 权重返回 null（= 本字段不出现）。 */
export function weightedPick<T>(
  rng: WardrobeRandom,
  items: readonly T[],
  weightOf: (item: T) => number,
): T | null {
  if (!items.length) return null;
  const weights = items.map((item) => Math.max(0, Number(weightOf(item))));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const r = rng.random() * total;
  let acc = 0;
  for (let i = 0; i < items.length; i += 1) {
    acc += weights[i];
    if (r <= acc) return items[i];
  }
  return items[items.length - 1];
}

export function weightStats(weights: WardrobeWeights): {
  sections: number;
  fields: number;
  options: number;
  total: number;
} {
  const tuned = (bag: Record<string, number>) =>
    Object.values(bag).filter((v) => Math.abs(v - DEFAULT_WEIGHT) > 1e-9).length;
  const options = Object.values(weights.options ?? {}).reduce((n, sub) => n + Object.keys(sub).length, 0);
  const sections = tuned(weights.sections ?? {});
  const fields = tuned(weights.fields ?? {});
  return { sections, fields, options, total: sections + fields + options };
}

/** 引用不存在的段/字段/选项 → 告警列表（不阻断）。 */
export function validateWeights(weights: WardrobeWeights): string[] {
  const pools = requireWardrobeData("pools");
  const fields = pools.sections.flatMap((s) => s.fields);
  const knownSections = new Set(pools.sections.map((s) => s.id));
  const knownFields = new Set(fields.map((f) => f.key));
  const fieldMap = new Map(fields.map((f) => [f.key, f]));
  const bad: string[] = [];

  for (const key of Object.keys(weights.sections ?? {})) {
    if (!knownSections.has(key)) bad.push(`段权重引用了不存在的段「${key}」`);
  }
  for (const key of Object.keys(weights.fields ?? {})) {
    if (!knownFields.has(key)) bad.push(`字段权重引用了不存在的字段「${key}」`);
  }
  for (const [field, sub] of Object.entries(weights.options ?? {})) {
    if (!knownFields.has(field)) {
      bad.push(`选项权重引用了不存在的字段「${field}」`);
      continue;
    }
    const valid = new Set((fieldMap.get(field)?.opts ?? []).map(([, en]) => String(en).trim().toLowerCase()));
    if (field === "n_canon") {
      for (const scene of requireWardrobeData("scenes").scenes) valid.add(scene.id.toLowerCase());
    }
    for (const key of Object.keys(sub)) {
      if (!valid.has(key)) bad.push(`选项权重引用了不存在的选项「${field} / ${key}」`);
    }
  }
  return bad;
}
