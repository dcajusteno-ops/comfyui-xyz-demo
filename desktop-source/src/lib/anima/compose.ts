/**
 * 分区拼接台（对应插件的 AnimaPromptPlus，但输出顺序统一为
 * quality → artist → character → clothing → background → pose → extra）。
 *
 * 插件里 PromptPlus 是 pose 在 background 前、随机抽卡是 background 在 pose 前，
 * 两个节点自身就不一致。本项目统一成抽卡的顺序，保证「抽卡 → 填入拼接台 →
 * 最终提示词」三处文本完全一致，否则用户会以为「填入」时词被调换了。
 */
import type { AnimaComposerSlot, AnimaComposerValues } from "./types";
import { artistToken, dedupeTokens, normalizeTokenKey, splitSectionTokens } from "./tags";

export const COMPOSER_SLOT_ORDER: AnimaComposerSlot[] = [
  "quality",
  "artist",
  "character",
  "clothing",
  "background",
  "pose",
  "extra",
];

export const COMPOSER_SLOT_META: Array<{
  key: AnimaComposerSlot;
  label: string;
  hint: string;
  placeholder: string;
}> = [
  {
    key: "quality",
    label: "质量提示词",
    hint: "放在最前面的画质/风格词",
    placeholder: "masterpiece, best quality, ...",
  },
  {
    key: "artist",
    label: "画师",
    hint: "自动补 @、去掉 by 前缀",
    placeholder: "dairi, wlop, ...",
  },
  {
    key: "character",
    label: "角色",
    hint: "角色触发词与特征",
    placeholder: "hatsune miku, vocaloid, twintails, ...",
  },
  {
    key: "clothing",
    label: "服装",
    hint: "从服装库挑选或手填",
    placeholder: "evening gown, halterneck, ...",
  },
  {
    key: "background",
    label: "背景",
    hint: "场景与环境",
    placeholder: "beach, sunset, ...",
  },
  {
    key: "pose",
    label: "姿势",
    hint: "动作与构图",
    placeholder: "standing, looking at viewer, ...",
  },
  {
    key: "extra",
    label: "额外提示词",
    hint: "所有分区之后追加",
    placeholder: "depth of field, ...",
  },
];

/** 每个分区按 UI 规则切出的词（画师已补 @） */
export function composerTokens(values: AnimaComposerValues): Record<AnimaComposerSlot, string[]> {
  const out = {} as Record<AnimaComposerSlot, string[]>;
  for (const slot of COMPOSER_SLOT_ORDER) {
    const raw = splitSectionTokens(values[slot]);
    out[slot] = slot === "artist" ? raw.map(artistToken).filter(Boolean) : raw;
  }
  return out;
}

/**
 * 拼接预览。默认不去重（对齐 PromptPlus）；打开 dedupe 后按
 * `normalizeTokenKey` 跨分区去重，保留第一次出现的原样。
 */
export function buildComposerPreview(
  values: AnimaComposerValues,
  options: { dedupe?: boolean } = {},
): string {
  const tokens = composerTokens(values);
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const slot of COMPOSER_SLOT_ORDER) {
    for (const token of tokens[slot]) {
      if (options.dedupe) {
        const key = normalizeTokenKey(token);
        if (!key || seen.has(key)) continue;
        seen.add(key);
      }
      parts.push(token);
    }
  }
  return parts.join(", ");
}

/** 写入提示词前的清理：去掉拼接器可能留下的尾逗号/空白 */
export function toApplyText(text: string): string {
  return String(text ?? "")
    .trim()
    .replace(/[\s,，]+$/g, "");
}

/**
 * 往某个分区追加一批词（画廊「加入拼接台」用）。
 * 按逗号切分后去重，避免反复点同一张卡产生重复词。
 */
export function appendTokensToSlot(current: string, tokens: readonly string[]): string {
  const merged = dedupeTokens([...splitSectionTokens(current), ...tokens]);
  return merged.join(", ");
}

/**
 * 把一批「已经分好区」的词合并进拼接台。
 *
 * - `append`：逐分区追加并去重，已有顺序不动（画师区因此不会被造型台结果冲掉）；
 * - `replace`：整段替换该分区，用于「这套服装/姿势整体换掉」。
 *
 * 只处理传入的分区，未传的分区保持原样——调用方据此保住 quality / artist。
 * 每个分区的值既可以是 token 数组，也可以是逗号分隔的原文（词库拼接台整份并入时直接传 values）。
 */
export function mergeComposerSlots(
  values: AnimaComposerValues,
  incoming: Partial<Record<AnimaComposerSlot, readonly string[] | string>>,
  mode: "append" | "replace" = "append",
): AnimaComposerValues {
  const next: AnimaComposerValues = { ...values };
  for (const slot of COMPOSER_SLOT_ORDER) {
    const raw = incoming[slot];
    if (raw === undefined) continue;
    const tokens = (typeof raw === "string" ? splitSectionTokens(raw) : raw)
      .map((token) => String(token ?? "").trim())
      .filter(Boolean);
    if (!tokens.length) continue;
    next[slot] = mode === "replace" ? dedupeTokens(tokens).join(", ") : appendTokensToSlot(next[slot], tokens);
  }
  return next;
}
