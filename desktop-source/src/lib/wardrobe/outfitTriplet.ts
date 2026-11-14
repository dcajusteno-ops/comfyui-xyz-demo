/**
 * 服装三元组（`_outfit_triplet` 的移植，v5.1.0 起角色预设与全局服装库共用）。
 *
 * 单独成文件是为了避开循环依赖：
 *   `characters.ts`（outfitFor）与 `outfitLibrary.ts`（libraryOutfit）都要用，
 *   而 `outfits.ts` 反过来依赖 `characters.resetRoleIndexes()`。
 *
 * 返回 `[extra 标签, 要清空的字段, 要强设的字段]`，与 `char_feat_for` 同形状。
 */
import { requireWardrobeData } from "./store";
import type { WardrobeOutfitSet } from "./types";

/** 服装字段全集。预设启用时**默认全部闭麦** —— 漏一个就会出现「预设的白裙 + 随机泳装」。 */
export const GARMENT_FIELDS = ["outfit", "top", "bottom", "socks", "shoes", "accessory"];

/** `outfit_for` 的旧默认闭麦集合（与插件 `OUTFIT_FIELDS` 一致）。 */
export const OUTFIT_FIELDS = [
  "outfit",
  "top",
  "bottom",
  "socks",
  "sock_color",
  "shoes",
  "accessory",
  "cloth_color",
  "cloth_mat",
  "cloth_state_sfw",
  "cloth_nsfw",
  "n_fabric",
  "n_shoes_keep",
];

function fieldOpts(key: string): string[] | null {
  for (const section of requireWardrobeData("pools").sections) {
    for (const field of section.fields) {
      if (field.key !== key) continue;
      return (field.opts ?? []).map(([, en]) => String(en).trim().toLowerCase());
    }
  }
  return null;
}

/**
 * `val` 这件衣服是否已被 `extras` 里某个更具体的 tag 覆盖。
 *
 * `skirt` ⊂ `black skirt` / `pencil skirt` / `pleated skirt` → 覆盖。
 * 两边都加了空格边界，所以 `shirt` 不会命中 `t-shirt`（那是另一种衣服）。
 */
export function coveredByTags(val: string, extras: readonly string[]): boolean {
  const v = String(val ?? "").trim().toLowerCase();
  if (!v) return false;
  for (const raw of extras ?? []) {
    const t = String(raw ?? "").trim().toLowerCase();
    if (!t) continue;
    if (t === v || t.endsWith(` ${v}`) || t.startsWith(`${v} `)) return true;
  }
  return false;
}

/** 一套服装条目 → `[extra 标签, 要清空的字段, 要强设的字段]`。档位不够 → 空三元组。 */
export function outfitTriplet(
  item: WardrobeOutfitSet | null | undefined,
  lv = 99,
): [string[], string[], Record<string, string>] {
  if (!item) return [[], [], {}];
  const level = Number(item.level ?? 0) || 0;
  if (Number(lv) < level) return [[], [], {}];

  const extras: string[] = [];
  for (const raw of item.tags ?? []) {
    const tag = String(raw ?? "").trim().toLowerCase();
    if (tag && !extras.includes(tag)) extras.push(tag);
  }

  const drops: string[] = [];
  for (const raw of item.drop && item.drop.length ? item.drop : OUTFIT_FIELDS) {
    const key = String(raw ?? "").trim();
    if (key && !drops.includes(key)) drops.push(key);
  }

  const sets: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(item.fields ?? {})) {
    const key = String(rawKey ?? "").trim();
    const value = String(rawValue ?? "").trim().toLowerCase();
    if (!key || !value) continue;
    const allowed = fieldOpts(key);
    if (!allowed) continue;
    if (!allowed.includes(value)) continue;
    // v5.0.13：tags 已经写得更具体（`black skirt` vs `skirt`）→ 只闭麦，不再输出粗粒度值
    if (GARMENT_FIELDS.includes(key) && coveredByTags(value, extras)) {
      if (!drops.includes(key)) drops.push(key);
      continue;
    }
    sets[key] = value;
    if (!drops.includes(key)) drops.push(key);
  }
  return [extras, drops, sets];
}
