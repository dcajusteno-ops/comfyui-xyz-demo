/**
 * 造型台结果 → 公共工作台（拼接台）分区。
 *
 * 为什么不用「按词表反查分区」：造型台会做颜色合成（`black` + `thighhighs` →
 * `black thighhighs`）、互斥消解与 repair 修正，结果里的词未必还在选项表里。
 * 所以主路径是**按抽取状态分桶**——`draw()` 的 state 里每个字段都有明确槽位
 * （`FIELD_SLOT`），`collect()` 就是把这些值按槽位序拼起来的，分桶结果与最终
 * 文本同源，不会错位。
 *
 * 只有 state 覆盖不到的词（repair 新增、手写补充被 summary 过）才落到
 * `bucketOfUnknown()` 兜底：画质词 → quality，性别词 → character，其余 → extra。
 */
import type { AnimaComposerSlot, AnimaComposerValues } from "../anima/types";
import { isGenderTag, normalizeTokenKey } from "../anima/tags";
import { mergeComposerSlots } from "../anima/compose";
import { FIELD_SLOT, NO_EMIT_FIELDS } from "./slots";
import type { WardrobeSlot, WardrobeWorkbenchSplit } from "./types";

/** 对外的拆分结果类型（定义在 types.ts，避免与 lastResult 循环引用）。 */
export type WorkbenchSplit = WardrobeWorkbenchSplit;

/** 造型台槽位 → 工作台分区。画师段造型台没有，永远由工作台自己补。 */
const SLOT_TO_COMPOSER: Record<WardrobeSlot, AnimaComposerSlot> = {
  count: "character",
  character: "character",
  appearance: "character",
  clothing: "clothing",
  pose: "pose",
  expression: "pose",
  camera: "pose",
  scene: "background",
  lighting: "extra",
  detail: "extra",
  free: "extra",
};

/** 画质/评分词：造型台的「加画质前缀」会把这些词写在最前面，归 quality 分区。 */
const QUALITY_WORDS = new Set([
  "masterpiece",
  "best quality",
  "amazing quality",
  "very aesthetic",
  "high quality",
  "normal quality",
  "good quality",
  "worst quality",
  "highres",
  "absurdres",
  "newest",
  "anime coloring",
]);

/** 去掉权重括号与多余空白，只用于判断「这是不是画质词」。 */
function bareToken(token: string): string {
  return normalizeTokenKey(String(token ?? "").replace(/[()[\]:]/g, " "));
}

function bucketOfUnknown(token: string): AnimaComposerSlot {
  const raw = String(token ?? "").trim();
  if (raw.startsWith("@")) return "artist";
  const bare = bareToken(raw);
  if (!bare) return "extra";
  if (QUALITY_WORDS.has(bare)) return "quality";
  if (isGenderTag(bare)) return "character";
  return "extra";
}

/**
 * 拆分造型台的抽取结果。
 *
 * @param state `WardrobeDrawResult.state`（含 `_preset_fields` 等内部键，会被跳过）
 * @param tags  `WardrobeDrawResult.tags`（已 repair，是最终正文的唯一口径）
 */
export function splitWardrobeToWorkbench(
  state: Record<string, unknown> | undefined,
  tags: readonly string[],
): WorkbenchSplit {
  const out: WorkbenchSplit = {};
  const covered = new Set<string>();
  // tags 是最终正文：state 里的词若被互斥 / 裁剪 / 角色触发词剥离丢掉了，就不能进桶
  // （例：`role = "nitta minami, idolmaster"` 只保留角色名，作品名会被剥掉）。
  const tagSet = new Set((tags ?? []).map((tag) => normalizeTokenKey(tag)).filter(Boolean));

  const push = (slot: AnimaComposerSlot, token: string, trusted: boolean) => {
    const text = String(token ?? "").trim();
    if (!text) return;
    const key = normalizeTokenKey(text);
    if (!key) return;
    if (!trusted && tagSet.size > 0 && !tagSet.has(key)) return;
    if (covered.has(key)) return;
    covered.add(key);
    (out[slot] ??= []).push(text);
  };

  for (const [key, value] of Object.entries(state ?? {})) {
    if (key.startsWith("_") || NO_EMIT_FIELDS.has(key)) continue;
    const wardrobeSlot = FIELD_SLOT[key];
    if (!wardrobeSlot) continue;
    const slot = SLOT_TO_COMPOSER[wardrobeSlot];
    for (const raw of String(value ?? "").split(",")) push(slot, raw, false);
  }

  // state 没覆盖到的词（repair 修正 / 额外正文）：兜底分桶，保证一个都不丢
  for (const raw of tags ?? []) {
    const token = String(raw ?? "").trim();
    if (!token) continue;
    const key = normalizeTokenKey(token);
    if (!key || covered.has(key)) continue;
    push(bucketOfUnknown(token), token, true);
  }

  return out;
}

/** 造型台内容并进工作台时**整体替换**的分区；`extra` 追加，`artist` 永远保留（画师只归工作台管）。 */
export const WORKBENCH_REPLACE_SLOTS = ["quality", "character", "clothing", "background", "pose"] as const;

/**
 * 把造型台拆好的分区桶并进拼接台 values。
 * 内容五区（含画质）replace —— 新一轮抽取应当整体换掉旧内容；
 * `extra` 追加 —— 手写补充是累加语义；画师与其它未涉及的分区原样保留。
 */
export function applyWardrobeSplitToValues(
  values: AnimaComposerValues,
  split: WardrobeWorkbenchSplit,
): AnimaComposerValues {
  const replacePart: Partial<Record<AnimaComposerSlot, readonly string[]>> = {};
  const appendPart: Partial<Record<AnimaComposerSlot, readonly string[]>> = {};
  for (const [slot, tokens] of Object.entries(split) as Array<[AnimaComposerSlot, string[]]>) {
    if (!tokens?.length) continue;
    if ((WORKBENCH_REPLACE_SLOTS as readonly string[]).includes(slot)) replacePart[slot] = tokens;
    else appendPart[slot] = tokens;
  }
  return mergeComposerSlots(mergeComposerSlots(values, replacePart, "replace"), appendPart, "append");
}
