/**
 * 幸运大转盘领域层：扇区模型、词池构建、候选筛选与抽词。
 * 纯函数，零 React / 零 DOM 依赖，`random` 可注入以便测试。
 *
 * 玩法：扇区 = 一个「词槽」；指针停在哪一类，就从该类词池随机抽 1 个词。
 */

import {
  MAX_TAG_LENGTH,
  isCandidateRecord,
  normalizeCategory,
  type PromptRecord,
} from "./promptLibrary";

export type WheelSector = {
  id: string;
  /** 扇区显示名，如「角色」 */
  label: string;
  /** 词库分类筛选（大小写不敏感） */
  categories: string[];
  /** 手填补充候选词（可为空） */
  extraTags: string[];
  /** 停用 = 不上盘（配置保留） */
  enabled: boolean;
};

export type SectorResult = {
  sectorId: string;
  tag: PromptRecord;
  /** 锁定后：转动与「转满整套」都会跳过该扇区，不覆盖已有结果 */
  locked: boolean;
  at: number;
};

/** 转盘最多可容纳的扇区数：再多盘面就挤了（默认 10 个，还留几个位给自定义）。 */
export const MAX_SECTORS = 14;

/**
 * 默认扇区 = 一套「生图提示词」的常见组成。
 *
 * 每个扇区的 `categories` 是**词库里的真实分类名**（全库 78 个分类，实测各池 330~1790 条），
 * 改这里前先跑 `.workbuddy/probe-wheel-categories.cjs` 看分类的实际内容 —— 有些分类名
 * 看着合适其实是坑：「色彩氛围」整类都是 CSS 色值名（lavenderblush/hotpink/pink），
 * 「二次元」只有 38 条可用词（其余 167 条是整句长提示词被长度上限剔掉）。
 */
export const DEFAULT_WHEEL_SECTORS: WheelSector[] = [
  { id: "character", label: "角色", categories: ["人物", "person", "人物&角色", "hair", "头发", "头发&发饰"], extraTags: [], enabled: true },
  { id: "clothing", label: "服饰", categories: ["服饰", "clothes", "衣服", "服装", "裙子", "裤子"], extraTags: [], enabled: true },
  { id: "accessory", label: "配件", categories: ["饰品", "配饰", "装饰", "decor", "手套", "鞋子", "shoes", "鞋", "袜子", "袜子&腿饰", "socks"], extraTags: [], enabled: true },
  { id: "action", label: "动作", categories: ["动作", "action", "表情动作"], extraTags: [], enabled: true },
  { id: "expression", label: "表情", categories: ["表情", "五官&表情", "脸", "face", "eye", "眼", "眼睛", "头部"], extraTags: [], enabled: true },
  { id: "scene", label: "场景", categories: ["场景", "scene", "环境", "env", "背景", "背景建筑"], extraTags: [], enabled: true },
  { id: "style", label: "画风", categories: ["style", "艺术风格", "风格", "画面"], extraTags: [], enabled: true },
  { id: "lighting", label: "光影", categories: ["光影效果", "摄影", "画面效果"], extraTags: [], enabled: true },
  { id: "prop", label: "物品", categories: ["物品", "goods"], extraTags: [], enabled: true },
  { id: "pose", label: "姿势", categories: ["姿势", "视角", "镜头", "手", "腿", "身体", "胸部"], extraTags: [], enabled: true },
];

export function createDefaultSectors(): WheelSector[] {
  return DEFAULT_WHEEL_SECTORS.map((sector) => ({ ...sector, categories: [...sector.categories], extraTags: [] }));
}

/** 参与转盘的扇区（保持配置顺序）。 */
export function activeSectors(sectors: WheelSector[]): WheelSector[] {
  return sectors.filter((sector) => sector.enabled);
}

function dedupeByText(records: PromptRecord[]): PromptRecord[] {
  const seen = new Set<string>();
  const out: PromptRecord[] = [];
  for (const record of records) {
    const key = record.text_en.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

/**
 * 词池 = 词库分类命中 + 手填补充词。
 * 按 text_en 去重、剔除超长整句；手填词排在前面（保证一定在池内）。
 */
export function buildSectorPool(sector: WheelSector, records: PromptRecord[]): PromptRecord[] {
  const wanted = new Set(sector.categories.map(normalizeCategory));
  const hits = records.filter(
    (record) =>
      isCandidateRecord(record) &&
      record.text_en.trim().length <= MAX_TAG_LENGTH &&
      wanted.has(normalizeCategory(record.category ?? ""))
  );
  const manual: PromptRecord[] = sector.extraTags
    .map((tag) => tag.trim())
    .filter((tag) => Boolean(tag) && tag.length <= MAX_TAG_LENGTH)
    .map((tag) => ({ text_en: tag, category: sector.label }));
  return dedupeByText([...manual, ...hits]);
}

/** 从词池中随机抽取 count 个不重复词条（洗牌后按 text_en 去重，写入 excludeKeys）。 */
export function drawFromPool(
  pool: PromptRecord[],
  count: number,
  excludeKeys: Set<string> = new Set(),
  random: () => number = Math.random
): PromptRecord[] {
  const available = pool.filter((record) => !excludeKeys.has(record.text_en.trim().toLowerCase()));
  if (available.length === 0) return [];

  for (let i = available.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }

  const picked: PromptRecord[] = [];
  for (const record of available) {
    picked.push(record);
    excludeKeys.add(record.text_en.trim().toLowerCase());
    if (picked.length >= count) break;
  }
  return picked;
}

/** 从扇区词池抽 1 个词；词池为空时返回 null。 */
export function drawTagForSector(
  sector: WheelSector,
  records: PromptRecord[],
  random: () => number = Math.random,
  excludeKeys: Set<string> = new Set()
): PromptRecord | null {
  const pool = buildSectorPool(sector, records);
  return drawFromPool(pool, 1, excludeKeys, random)[0] ?? null;
}

/**
 * 候选扇区：启用 + 词池非空 + 结果未锁定。
 * mode = "any"：所有候选（普通转动，命中已抽过的扇区会覆盖其结果）；
 * mode = "empty"：只要尚无结果的候选（「转满整套」连转）。
 */
export function pickCandidateSectors(
  sectors: WheelSector[],
  results: Record<string, SectorResult>,
  records: PromptRecord[],
  mode: "any" | "empty" = "any"
): { sector: WheelSector; index: number }[] {
  const out: { sector: WheelSector; index: number }[] = [];
  sectors.forEach((sector, index) => {
    if (!sector.enabled) return;
    const existing = results[sector.id];
    if (existing?.locked) return;
    if (mode === "empty" && existing) return;
    if (buildSectorPool(sector, records).length === 0) return;
    out.push({ sector, index });
  });
  return out;
}

/** 按扇区顺序取出已抽到的词条（应用 / 复制 / 历史的统一口径）。 */
export function collectResultTags(
  results: Record<string, SectorResult>,
  sectors: WheelSector[]
): PromptRecord[] {
  return activeSectors(sectors)
    .map((sector) => results[sector.id]?.tag)
    .filter((tag): tag is PromptRecord => Boolean(tag));
}

/** 将结果合并为逗号分隔的英文提示词（按扇区顺序）。 */
export function joinResultTags(results: Record<string, SectorResult>, sectors: WheelSector[]): string {
  return collectResultTags(results, sectors)
    .map((record) => record.text_en.trim())
    .filter(Boolean)
    .join(", ");
}
