export type SlotRecord = {
  id?: string;
  source?: string;
  category?: string;
  subcategory?: string;
  scope?: string;
  text_en: string;
  text_zh?: string;
  preview?: string;
};

export type SlotConfig = {
  id: string;
  label: string;
  categories: string[];
  enabled: boolean;
  locked: boolean;
  count: number;
};

export type SlotDraw = {
  slotId: string;
  label: string;
  tags: SlotRecord[];
};

export type SlotRollResult = {
  draws: SlotDraw[];
  totalTags: SlotRecord[];
};

/** 词库中需要排除的 scope（NSFW 与负面词）。 */
export const EXCLUDED_SCOPES = new Set(["r18", "negative_default"]);

/** 词条最大长度：超出此长度的是整句/整段提示词，不适合做词条。 */
export const MAX_TAG_LENGTH = 80;

export const DEFAULT_SLOT_CONFIGS: SlotConfig[] = [
  { id: "character", label: "角色", categories: ["人物", "face", "hair"], enabled: true, locked: false, count: 1 },
  { id: "clothing", label: "服饰", categories: ["服饰", "clothes", "衣服", "饰品"], enabled: true, locked: false, count: 1 },
  { id: "action", label: "动作", categories: ["动作", "action", "表情动作"], enabled: true, locked: false, count: 1 },
  { id: "scene", label: "场景", categories: ["场景", "环境", "env"], enabled: true, locked: false, count: 1 },
  { id: "style", label: "画风", categories: ["style", "二次元", "画面", "图像种类"], enabled: true, locked: false, count: 1 },
  { id: "lighting", label: "光影氛围", categories: ["色彩氛围", "摄影"], enabled: true, locked: false, count: 1 },
];

export function normalizeCategory(name: string) {
  return name.trim().toLowerCase();
}

/** 候选词条：scope 不在排除清单、具备有效英文词与分类。 */
export function isCandidateRecord(record: SlotRecord): boolean {
  const scope = record.scope?.toLowerCase() ?? "";
  return !EXCLUDED_SCOPES.has(scope) && Boolean(record.text_en?.trim()) && Boolean(record.category?.trim());
}

/** 根据分类名列表构建词池（大小写不敏感匹配，且自动剔除超长整句）。 */
export function buildSlotPool(records: SlotRecord[], categories: string[], maxLength = MAX_TAG_LENGTH): SlotRecord[] {
  const wanted = new Set(categories.map(normalizeCategory));
  return records.filter(
    (record) =>
      isCandidateRecord(record) &&
      record.text_en.trim().length <= maxLength &&
      wanted.has(normalizeCategory(record.category!))
  );
}

/** 从词池中随机抽取 count 个不重复词条（按 text_en 去重）。 */
export function drawFromPool(pool: SlotRecord[], count: number, excludeKeys: Set<string> = new Set()): SlotRecord[] {
  const available = pool.filter((record) => !excludeKeys.has(record.text_en.trim().toLowerCase()));
  if (available.length === 0) return [];

  for (let i = available.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }

  const picked: SlotRecord[] = [];
  for (const record of available) {
    picked.push(record);
    excludeKeys.add(record.text_en.trim().toLowerCase());
    if (picked.length >= count) break;
  }
  return picked;
}

/**
 * 对所有「启用且未锁定」的词槽执行摇奖。
 * 锁定的词槽由调用方保留上一次的抽取结果，不在此重新抽取。
 */
export function rollSlots(configs: SlotConfig[], records: SlotRecord[]): SlotRollResult {
  const draws: SlotDraw[] = [];
  const usedKeys = new Set<string>();
  const totalTags: SlotRecord[] = [];

  for (const config of configs) {
    if (!config.enabled || config.locked) continue;
    const pool = buildSlotPool(records, config.categories);
    const picked = drawFromPool(pool, Math.max(1, config.count), usedKeys);
    totalTags.push(...picked);
    draws.push({ slotId: config.id, label: config.label, tags: picked });
  }

  return { draws, totalTags };
}

/** 将一组抽取结果合并为逗号分隔的英文提示词。 */
export function joinSlotTags(tags: SlotRecord[]): string {
  return tags.map((record) => record.text_en.trim()).filter(Boolean).join(", ");
}