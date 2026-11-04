import type { DatasetConfig, LoraSelection } from "../../types";
import { DATASET_AXIS_ORDER } from "./pools";

/**
 * 计划签名：判断「已排好的计划」是否还匹配当前配置。
 *
 * 为什么需要它：`item.prompt` / `item.caption` 是**规划时**的快照
 * （`buildDatasetPlan` 一次算完），之后再挂 LoRA、改触发词、改轴池都不会自动更新。
 * 用户很容易在「先排 100 条、后加 LoRA」之后觉得 LoRA 没生效——实际是 prompt 里
 * 少了触发词。
 *
 * 只把**影响文案与落盘**的字段纳入签名；模型栈 / 采样参数只影响出图质量，
 * 改它们不该逼用户重排 100 条。
 */

const SEP_FIELD = "\u0004";
const SEP_PART = "\u0002";
const SEP_VALUE = "\u0001";

/** FNV-1a 32bit：稳定、无依赖，碰撞概率对本用途足够 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 当前模型族里真正会进工作流的 LoRA（与 buildLoraList 的过滤口径一致） */
export function activeDatasetLoras(config: DatasetConfig): LoraSelection[] {
  const params = config[config.mode];
  return (params?.loras ?? []).filter((lora) => lora.active && Boolean(lora.name?.trim()));
}

export function buildDatasetSignature(config: DatasetConfig): string {
  const axisPart = DATASET_AXIS_ORDER.map((key) => {
    const axis = config.axes?.[key];
    return [
      key,
      axis?.enabled ? "1" : "0",
      String(axis?.perItem ?? 0),
      (axis?.pool ?? []).join(SEP_VALUE),
    ].join(SEP_PART);
  }).join(SEP_PART);

  // 顺序参与签名：LoRA 的先后会影响工作流里的叠加顺序
  const loraPart = activeDatasetLoras(config)
    .map((lora) => [String(lora.name).replace(/\\/g, "/"), String(lora.strength), String(lora.clipStrength)].join(":"))
    .join(SEP_VALUE);

  const raw = [
    config.mode,
    config.subject,
    config.characterPrompt ?? "",
    config.trigger ?? "",
    config.style?.[config.mode] ?? "",
    config.reference?.enabled ? `1:${config.reference.imageName ?? ""}` : "0",
    config.caption?.includeTrigger ? "1" : "0",
    config.caption?.includeCharacter ? "1" : "0",
    String(config.targetCount ?? 0),
    String(config.seedBase ?? 0),
    config.filenameRoot ?? "",
    `l:${loraPart}`,
    `a:${axisPart}`,
  ].join(SEP_FIELD);

  return fnv1a(raw);
}
