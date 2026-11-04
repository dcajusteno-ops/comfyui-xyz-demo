import type { DatasetAxisKey, DatasetConfig } from "../../types";
import { dedupeKey, isWeightedTag, splitPromptTags } from "../characterSheet";
import { DATASET_AXIS_ORDER, DATASET_FORBIDDEN_IN_CAPTION } from "./pools";

/**
 * 数据集提示词拼装。
 *
 * 与三视图共用同一套去重口径（`dedupeKey` / `isWeightedTag` 直接从 characterSheet 导出），
 * 避免「`blue_hair` 与 `blue hair` 被当成两个词」这类口径漂移。
 *
 * 顺序固定：主体 → 触发词(仅挂了 LoRA) → 角色固定词 → 画风 → 变化词。
 * 生成与页面预览、caption 共用同一份结果（所见即所得）。
 */

export type DatasetComposeResult = {
  /** 最终正向提示词 */
  text: string;
  /** 全部生效 tag（固定词 + 变化词，已去重） */
  tags: string[];
  /** 实际生效的变化词（按轴顺序）——caption 与计划查重都用它 */
  variableTags: string[];
  /** 因为与固定词重复而被丢弃的变化词（发牌时应跳过） */
  droppedTags: string[];
};

export function datasetTriggerTags(config: DatasetConfig): string[] {
  return splitPromptTags(config.trigger ?? "");
}

/** 当前模型族是否真的挂了 LoRA（决定触发词是否进正向提示词） */
export function datasetHasLora(config: DatasetConfig): boolean {
  const params = config[config.mode];
  return (params?.loras ?? []).some((lora) => lora.active && lora.name);
}

function pushUnique(target: string[], seen: Set<string>, raw: string): boolean {
  const tag = raw.trim();
  if (!tag) return false;
  if (isWeightedTag(tag)) {
    target.push(tag);
    return true;
  }
  const key = dedupeKey(tag);
  if (!key || seen.has(key)) return false;
  seen.add(key);
  target.push(tag);
  return true;
}

export function composeDatasetPrompt(
  config: DatasetConfig,
  axisTags: Partial<Record<DatasetAxisKey, string[]>>,
): DatasetComposeResult {
  const out: string[] = [];
  const seen = new Set<string>();

  if (config.subject) pushUnique(out, seen, config.subject);
  // 触发词只在真正挂了 LoRA 时进提示词：没有 LoRA 时它只是个不存在的词，纯噪声
  if (datasetHasLora(config)) {
    for (const word of datasetTriggerTags(config)) pushUnique(out, seen, word);
  }
  for (const tag of splitPromptTags(config.characterPrompt ?? "")) pushUnique(out, seen, tag);
  for (const tag of splitPromptTags(config.style?.[config.mode] ?? "")) pushUnique(out, seen, tag);

  const variableTags: string[] = [];
  const droppedTags: string[] = [];
  for (const axis of DATASET_AXIS_ORDER) {
    for (const tag of axisTags[axis] ?? []) {
      const before = out.length;
      pushUnique(out, seen, tag);
      if (out.length === before) {
        // 权重语法永远"推入成功"（不参与去重），因此这里只会是真正的重复词
        if (tag.trim() && !isWeightedTag(tag)) droppedTags.push(tag.trim());
        continue;
      }
      variableTags.push(tag.trim());
    }
  }

  return { text: out.join(", "), tags: out, variableTags, droppedTags };
}

/** caption 去重口径与提示词一致，但额外剔除画质/画风/水印类词 */
export function isForbiddenInCaption(tag: string): boolean {
  const key = dedupeKey(tag);
  return DATASET_FORBIDDEN_IN_CAPTION.some((item) => dedupeKey(item) === key);
}

/**
 * 训练 caption：触发词（可选）+ 角色固定词（可选）+ 本张变化词。
 * 画风/画质**永不进 caption**——会被 LoRA 学成条件。
 */
export function buildCaption(
  config: DatasetConfig,
  variableTags: string[],
  options: { includeTrigger?: boolean; includeCharacter?: boolean; triggerEnabled?: boolean } = {},
): string {
  const includeTrigger = options.includeTrigger ?? (config.caption.includeTrigger !== false);
  const includeCharacter = options.includeCharacter ?? (config.caption.includeCharacter === true);
  const triggerEnabled = options.triggerEnabled ?? true;

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    if (isForbiddenInCaption(tag)) return;
    if (isWeightedTag(tag)) {
      out.push(tag);
      return;
    }
    const key = dedupeKey(tag);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(tag);
  };

  if (includeTrigger && triggerEnabled) {
    for (const word of datasetTriggerTags(config)) push(word);
  }
  if (includeCharacter) {
    for (const tag of splitPromptTags(config.characterPrompt ?? "")) push(tag);
  }
  for (const tag of variableTags) push(tag);

  return out.join(", ");
}
