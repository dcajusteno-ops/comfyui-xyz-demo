/**
 * 档位准入层（`rules.py` 的 option_level / eligible_options / tag_level）。
 *
 * 三条硬规则，改动前先读：
 *  1. `eligibleOptions()` 是**唯一**的准入判定点。权重只能在它返回的池子里加权，
 *     不能把超档项拉回来。
 *  2. 段闸门用 `section_floor <= lv`（不是 section_max）——混合档位的段
 *     只要还剩低档选项就该允许，具体抽哪条由逐选项闸门负责。
 *  3. `optionLevel` 每次都要重新叠加 `section_floor` 与 `LEVEL_RAISE`，
 *     即使 levels.json 已经写过一遍（磁盘表可能比 overrides 旧）。
 */
import {
  COUNT_LOCK_EXTRA,
  PARTNER_GATED_FIELDS,
  SOLO_OK_PARTNER_OPTS,
  countHasPartner,
  rolePool,
} from "./characters";
import { sceneOptions } from "./scenes";
import { gradeNsfw, resolveLevel, levelLabel, levelNum, targetNum } from "./nsfw";
import { levelDemoteRows, levelRaiseRows, raiseLevel, sectionFloorOf } from "./overrides";
import { FIELD_SLOT } from "./slots";
import { requireWardrobeData } from "./store";
import type { WardrobeField, WardrobeSection } from "./types";

let fieldSectionMap: Map<string, string> | null = null;

function fieldSection(): Map<string, string> {
  if (fieldSectionMap) return fieldSectionMap;
  const map = new Map<string, string>();
  for (const section of requireWardrobeData("pools").sections) {
    for (const field of section.fields) map.set(field.key, section.id);
  }
  fieldSectionMap = map;
  return map;
}

/** 数据重置后要清索引（测试/热重载用）。 */
export function resetLevelIndexes(): void {
  fieldSectionMap = null;
  floorTags = null;
  ceilingTags = null;
  poseTokens = null;
}

export function sectionById(sectionId: string): WardrobeSection | null {
  return requireWardrobeData("pools").sections.find((s) => s.id === sectionId) ?? null;
}

export function fieldByKey(fieldKey: string): { section: string; field: WardrobeField } | null {
  for (const section of requireWardrobeData("pools").sections) {
    const field = section.fields.find((f) => f.key === fieldKey);
    if (field) return { section: section.id, field };
  }
  return null;
}

/** 选项档位 = max(levels.json, 段下限, 逐选项上抬)。n_canon 走场景/法典表。 */
export function optionLevel(fieldKey: string, en: string): number {
  if (fieldKey === "n_canon") return canonLevel(en);
  const levels = requireWardrobeData("levels");
  let base = levels.option_levels[fieldKey]?.[en] ?? 0;
  const section = fieldSection().get(fieldKey);
  if (section) base = Math.max(base, sectionFloorOf(section));
  const [raised] = raiseLevel(fieldKey, en, base);
  return raised;
}

/** 场景库自带 level 优先；否则查法典 14 组。 */
export function canonLevel(presetId: string): number {
  const id = String(presetId ?? "");
  const scene = requireWardrobeData("scenes").scenes.find((s) => s.id === id);
  if (scene) return Number(scene.level ?? 0);
  return requireWardrobeData("levels").canon_levels[id] ?? 0;
}

export function sectionMaxLevel(sectionId: string): number {
  return requireWardrobeData("levels").section_max[sectionId] ?? 0;
}

export function sectionFloorLevel(sectionId: string): number {
  return requireWardrobeData("levels").section_floor[sectionId] ?? 0;
}

export function sectionAllowed(sectionId: string, lv: number): boolean {
  return sectionFloorLevel(sectionId) <= lv;
}

/**
 * 面板里的「本档是否参与」——与插件 `sectionEligible()` 同口径：
 * 段里**至少有一个选项** ≤ 当前档。不能用 `sectionFloor <= lv`：
 * `canon` 段的 floor 是 2（法典 14 组），但 SFW 场景是 L0，
 * 按 floor 判会把「全年龄场景搭配」整段锁死。
 */
export function sectionEligible(section: WardrobeSection, lv: number): boolean {
  let optionFields = 0;
  for (const field of section.fields) {
    const opts = field.opts ?? [];
    if (!opts.length) continue;
    optionFields += 1;
    for (const [, en] of opts) {
      if (optionLevel(field.key, en) <= lv) return true;
    }
  }
  if (section.id === "canon") {
    for (const [, , level] of sceneOptions(99)) if (level <= lv) return true;
  }
  return optionFields === 0;
}

/**
 * 按档位收敛候选池。返回 `[中文, 英文, 档位]`。
 * role / n_canon 的候选来自独立数据源，在这里分流后各自过滤。
 */
export function eligibleOptions(fieldKey: string, lv: number): Array<[string, string, number]> {
  if (fieldKey === "role") return rolePool(lv);

  const found = fieldByKey(fieldKey);
  if (!found) return [];
  let opts: Array<[string, string]> = (found.field.opts ?? []).map(([zh, en]) => [zh, en]);
  if (fieldKey === "n_canon") {
    opts = [...opts, ...sceneOptions(99).map(([zh, id]) => [zh, id] as [string, string])];
  }
  const out: Array<[string, string, number]> = [];
  for (const [zh, en] of opts) {
    const level = fieldKey === "n_canon" ? canonLevel(en) : optionLevel(fieldKey, en);
    if (level <= lv) out.push([zh, en, level]);
  }
  return out;
}

let floorTags: Map<string, number> | null = null;
let ceilingTags: Map<string, number> | null = null;
let poseTokens: Set<string> | null = null;

/** `LEVEL_RAISE` 折算回标签层：{标签 → 最低档位}（只升）。 */
export function levelFloorTags(): Map<string, number> {
  if (floorTags) return floorTags;
  const map = new Map<string, number>();
  const l0 = poseL0Tokens();
  for (const row of levelRaiseRows()) {
    for (const raw of String(row.en).split(",")) {
      const tag = raw.trim().toLowerCase();
      if (!tag || l0.has(tag)) continue;
      map.set(tag, Math.max(map.get(tag) ?? 0, row.level));
    }
  }
  floorTags = map;
  return map;
}

/** `LEVEL_DEMOTE` 折算回标签层：{标签 → 最低档位}（只降）。 */
export function levelCeilingTags(): Map<string, number> {
  if (ceilingTags) return ceilingTags;
  const map = new Map<string, number>();
  for (const row of levelDemoteRows()) {
    for (const raw of String(row.en).split(",")) {
      const tag = raw.trim().toLowerCase();
      if (!tag) continue;
      map.set(tag, Math.min(map.get(tag) ?? 99, row.level));
    }
  }
  ceilingTags = map;
  return map;
}

/** 姿势段里本身是 L0 的选项 —— 多标签组合上抬时的免伤白名单。 */
export function poseL0Tokens(): Set<string> {
  if (poseTokens) return poseTokens;
  const set = new Set<string>();
  for (const key of ["pose_base", "arms_hands", "action", "pose_risque"]) {
    const found = fieldByKey(key);
    for (const [, en] of found?.field.opts ?? []) {
      if (optionLevel(key, en) === 0) set.add(String(en).trim().toLowerCase());
    }
  }
  poseTokens = set;
  return set;
}

/** 单个标签的有效档位 = max(判定表∩下调, 上抬)。 */
export function tagLevel(tag: string): number {
  const key = String(tag).trim().toLowerCase();
  let base = gradeNsfw([key]).num;
  const ceiling = levelCeilingTags().get(key);
  if (ceiling !== undefined) base = Math.min(base, ceiling);
  return Math.max(base, levelFloorTags().get(key) ?? 0);
}

/** 某个字段当前值的准入档位。文本字段必须逐标签判（不能套段下限）。 */
export function fieldValueNum(fieldKey: string, value: string): number {
  if (fieldKey === "nl" || fieldKey === "n_extra") {
    return gradeNsfw(String(value).split(",").map((t) => t.trim()).filter(Boolean)).num;
  }
  return optionLevel(fieldKey, value);
}

/** 人数上不可能成立的字段（solo 时不计入实际档位）。 */
export { PARTNER_GATED_FIELDS, SOLO_OK_PARTNER_OPTS };

/** 档位数字 → key（v5.0.1「点名词条自动上调档位」用）。 */
export function levelKeyForNum(num: number): string {
  for (const [key, value] of Object.entries(targetNum())) {
    if (value === num) return key;
  }
  return "";
}

/**
 * 场景人数锁的档位（build 校验 / 自检 / 引擎写入三处共用）。
 *
 * `COUNT_LOCK_EXTRA` 里的中性写法（`2girls`）不在 levels.json 里，
 * `optionLevel` 会返回 0 —— 那是巧合正确，这里显式取值。
 */
export function countLockLevel(lock: string): number {
  const value = String(lock ?? "").trim();
  if (!value) return 0;
  if (Object.prototype.hasOwnProperty.call(COUNT_LOCK_EXTRA, value)) return COUNT_LOCK_EXTRA[value];
  return optionLevel("count", value);
}

/**
 * 画面**真能成立**的最高档位。
 * 与 check 的 real_level 的差别：solo 时排除需要第二人的 n_act/n_cum。
 */
export function effectiveLevel(state: Record<string, unknown>): number {
  const count = String(state.count ?? "");
  const solo = !countHasPartner(count);
  let best = 0;
  for (const [key, value] of Object.entries(state)) {
    if (key.startsWith("_") || !value) continue;
    const raw = String(value).trim();
    if (!raw) continue;
    if (solo && PARTNER_GATED_FIELDS.includes(key) && !SOLO_OK_PARTNER_OPTS.has(raw.toLowerCase())) {
      continue;
    }
    if (key === "n_extra" || key === "nl") {
      for (const tag of raw.split(",")) if (tag.trim()) best = Math.max(best, tagLevel(tag.trim()));
      continue;
    }
    if (!FIELD_SLOT[key]) continue;
    for (const tag of raw.split(",")) if (tag.trim()) best = Math.max(best, tagLevel(tag.trim()));
  }
  return best;
}

export { resolveLevel, levelLabel, levelNum, targetNum };
