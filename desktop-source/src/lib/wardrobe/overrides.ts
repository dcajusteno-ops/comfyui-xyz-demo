/**
 * 人工校准层（`anima_v4_overrides.py` 的移植）。
 *
 * ⚠️ 不要把这两张表当成「levels.json 里已经有了」：
 *    levels.json 只有 section_max / section_floor / canon_levels / tag_levels /
 *    option_levels，**没有** demote / raise。`option_level()` 每次都会重新叠加
 *    raise_，`tag_level()` 还要用 demote 把 `wet hair` 这类误判折算回去。
 *    漏掉这一层，SFW 会漏出 `fishnet bodystocking`，而合法的 `wet hair`
 *    又会被 repair 当越档删掉。
 */
import { requireWardrobeData } from "./store";

const SEP = "\u0000";

let demoteMap: Map<string, number> | null = null;
let raiseMap: Map<string, { level: number; why: string }> | null = null;

function keyOf(field: string, en: string): string {
  return `${field}${SEP}${en}`;
}

function ensureMaps(): void {
  if (demoteMap && raiseMap) return;
  const data = requireWardrobeData("overrides");
  demoteMap = new Map();
  raiseMap = new Map();
  for (const row of data.levelDemote) demoteMap.set(keyOf(row.field, row.en), row.level);
  for (const row of data.levelRaise) raiseMap.set(keyOf(row.field, row.en), { level: row.level, why: row.why });
}

export function sectionFloorOf(sectionId: string): number {
  return requireWardrobeData("overrides").sectionFloor[sectionId] ?? 0;
}

/** 逐选项下调（只用于成品层换算，不参与 `option_level` —— 见 Python 注释）。 */
export function demoteLevel(field: string, en: string, level: number): number {
  ensureMaps();
  const target = demoteMap?.get(keyOf(field, en));
  return target === undefined ? level : Math.min(level, target);
}

/** 逐选项上抬：返回 [新档位, 原因]。未登记时原样返回。 */
export function raiseLevel(field: string, en: string, level: number): [number, string] {
  ensureMaps();
  const row = raiseMap?.get(keyOf(field, en));
  if (!row) return [level, ""];
  return [Math.max(level, row.level), row.why];
}

export function levelDemoteRows() {
  return requireWardrobeData("overrides").levelDemote;
}

export function levelRaiseRows() {
  return requireWardrobeData("overrides").levelRaise;
}
