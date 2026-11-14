/**
 * 造型台独立生图参数与 LoRA（含触发词）。
 *
 * 约定：
 * - 只在造型台内部读写，绝不写回 Anima / 其他模板的参数。
 * - 首次使用时以 Anima 参数为骨架（模型栈 / 尺寸 / 采样），但**不继承**它的 LoRA。
 * - LoRA 触发词由用户维护，生成时自动追加到正向提示词末尾。
 */
import type { AnimaGenerationParams, LoraItem } from "../../types";
import { extractItemTrainedWords, loraSyntaxName, uniqueStrings } from "../lora-helper";
import { makeAnimaParams } from "../paramBuilders";
import { toApplyText } from "./text";
import type {
  WardrobeGenerationParams,
  WardrobeGenerationState,
  WardrobeLoraSelection,
} from "./types";

export const WARDROBE_GENERATION_KEY = "comfyui_wardrobe_generation";
export const WARDROBE_CONTINUOUS_MAX = 20;

/** 造型台专用输出目录（相对 ComfyUI output），图片管理页也按这个目录定位。 */
export const WARDROBE_OUTPUT_ROOT = "造型台";
/** SaveImage 的 filename_prefix：造型台/日期/ComfyUI */
export const WARDROBE_OUTPUT_PREFIX = `${WARDROBE_OUTPUT_ROOT}/%date:yyyy-MM-dd%/ComfyUI`;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return Math.trunc(clampNumber(value, min, max, fallback));
}

function cloneAnimaParams(params: AnimaGenerationParams): AnimaGenerationParams {
  return {
    ...params,
    modelStack: { ...params.modelStack },
    stages: { ...params.stages },
    img2img: { ...params.img2img },
    hires: { ...params.hires },
    refine: { ...params.refine },
    handDetailer: { ...params.handDetailer },
    faceDetailer: { ...params.faceDetailer },
    eyesDetailer: { ...params.eyesDetailer },
    nsfwDetailer: { ...params.nsfwDetailer },
    segsDetailer: { ...params.segsDetailer },
    loras: params.loras.map((lora) => ({ ...lora })),
  };
}

/** 首次使用：继承 Anima 的模型 / 采样 / 尺寸作为起点，提示词与 LoRA 全部清空。 */
export function defaultWardrobeGeneration(
  anima: AnimaGenerationParams = makeAnimaParams(),
): WardrobeGenerationState {
  const base = cloneAnimaParams(anima);
  return {
    version: 1,
    params: {
      ...base,
      positivePrompt: "",
      negativePrompt: base.negativePrompt,
      batchSize: 1,
      // 造型台没有参考图控件：避免误用 Anima 面板遗留的参考图
      stages: { ...base.stages, img2img: false },
      img2img: { ...base.img2img, imageName: "" },
      // 不借用 Anima 的 LoRA；LoRA 由造型台自己维护
      loras: [],
      // 造型台不参与文字水印
      drawText: undefined,
      // 造型台图片单独落盘，不与 Anima / 其他模板混在一起
      filenamePrefix: WARDROBE_OUTPUT_PREFIX,
    },
    autoTrigger: true,
    manualTriggers: [],
    continuousCount: 4,
  };
}

function normalizeLora(raw: unknown): WardrobeLoraSelection | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const name = String(rec.name ?? "").trim();
  if (!name) return null;
  const triggerWords = Array.isArray(rec.triggerWords)
    ? uniqueStrings(rec.triggerWords.map(String)).slice(0, 50)
    : [];
  return {
    name,
    displayName: String(rec.displayName ?? "").trim() || undefined,
    strength: clampNumber(rec.strength, -10, 10, 1),
    clipStrength: clampNumber(rec.clipStrength, -10, 10, 1),
    active: rec.active !== false,
    filePath: String(rec.filePath ?? "").trim() || undefined,
    sha256: String(rec.sha256 ?? "").trim() || undefined,
    previewUrl: String(rec.previewUrl ?? "").trim() || undefined,
    triggerWords,
  };
}

/**
 * 坏数据修复。`merged` 已经过 usePersistentState 的 deepMerge，
 * 这里只做白名单 / 类型 / 范围收敛，不引入 Anima 侧的任何现值。
 */
export function normalizeWardrobeGeneration(
  merged: WardrobeGenerationState,
  defaults: WardrobeGenerationState = defaultWardrobeGeneration(),
): WardrobeGenerationState {
  const params = cloneAnimaParams(merged?.params ?? defaults.params) as WardrobeGenerationParams;
  const raw = (merged?.params ?? {}) as Partial<WardrobeGenerationParams>;

  params.modelStack = {
    ...params.modelStack,
    unetName: String(raw.modelStack?.unetName ?? params.modelStack.unetName),
    weightDtype: String(raw.modelStack?.weightDtype ?? params.modelStack.weightDtype),
    clipName: String(raw.modelStack?.clipName ?? params.modelStack.clipName),
    clipType: String(raw.modelStack?.clipType ?? params.modelStack.clipType),
    vaeName: String(raw.modelStack?.vaeName ?? params.modelStack.vaeName),
  };
  params.width = clampInt(raw.width, 16, 4096, params.width);
  params.height = clampInt(raw.height, 16, 4096, params.height);
  params.steps = clampInt(raw.steps, 1, 150, params.steps);
  params.cfg = clampNumber(raw.cfg, 0, 30, params.cfg);
  params.seed = clampInt(raw.seed, 0, 2 ** 31 - 1, params.seed);
  params.randomizeSeed = raw.randomizeSeed === true;
  params.samplerName = String(raw.samplerName ?? params.samplerName);
  params.scheduler = String(raw.scheduler ?? params.scheduler);
  params.negativePrompt = String(raw.negativePrompt ?? "").slice(0, 8000);
  params.positivePrompt = "";
  params.batchSize = 1;
  params.drawText = undefined;
  params.stages = { ...params.stages, ...(raw.stages ?? {}), img2img: false };
  params.img2img = { ...params.img2img, ...(raw.img2img ?? {}), imageName: "" };
  params.hires = {
    ...params.hires,
    modelName: String(raw.hires?.modelName ?? params.hires.modelName),
    rescaleMethod: String(raw.hires?.rescaleMethod ?? params.hires.rescaleMethod),
    prePercent: clampNumber(raw.hires?.prePercent, 1, 400, params.hires.prePercent),
    postPercent: clampNumber(raw.hires?.postPercent, 1, 400, params.hires.postPercent),
  };
  params.refine = {
    ...params.refine,
    steps: clampInt(raw.refine?.steps, 1, 150, params.refine.steps),
    cfg: clampNumber(raw.refine?.cfg, 0, 30, params.refine.cfg),
    denoise: clampNumber(raw.refine?.denoise, 0, 1, params.refine.denoise),
    samplerName: String(raw.refine?.samplerName ?? params.refine.samplerName),
    scheduler: String(raw.refine?.scheduler ?? params.refine.scheduler),
  };

  const loras = Array.isArray(raw.loras) ? raw.loras : [];
  params.loras = loras
    .map(normalizeLora)
    .filter((lora): lora is WardrobeLoraSelection => Boolean(lora))
    .slice(0, 50);

  return {
    version: 1,
    params,
    autoTrigger: merged?.autoTrigger !== false,
    manualTriggers: Array.isArray(merged?.manualTriggers)
      ? uniqueStrings(merged.manualTriggers.map(String)).slice(0, 60)
      : [],
    continuousCount: clampInt(merged?.continuousCount, 1, WARDROBE_CONTINUOUS_MAX, 4),
  };
}

export function wardrobeTriggerWords(state: WardrobeGenerationState): string[] {
  const manual = Array.isArray(state.manualTriggers) ? state.manualTriggers : [];
  const loraWords = state.autoTrigger
    ? state.params.loras
        .filter((lora) => lora.active)
        .flatMap((lora) => lora.triggerWords ?? [])
    : [];
  return uniqueStrings([...manual, ...loraWords]).slice(0, 80);
}

/** 抽取文本 + 质量前缀 + 启用 LoRA 的触发词。 */
export function buildWardrobePrompt(
  state: WardrobeGenerationState,
  text: string,
  qualityPrefix: boolean,
): string {
  const base = toApplyText(text, qualityPrefix).trim();
  if (!base) return "";
  const triggers = wardrobeTriggerWords(state);
  return triggers.length ? `${base}, ${triggers.join(", ")}` : base;
}

/** 交给 buildAnimaPrompt 的参数快照：强制单张 + 文生图 + 不带水印。 */
export function buildWardrobeGenerationParams(
  state: WardrobeGenerationState,
  prompt: string,
): AnimaGenerationParams {
  return {
    ...state.params,
    positivePrompt: prompt,
    batchSize: 1,
    drawText: undefined,
    stages: { ...state.params.stages, img2img: false },
    img2img: { ...state.params.img2img, imageName: "" },
    // 无论旧存档里是什么前缀，造型台图片始终写入自己的目录
    filenamePrefix: WARDROBE_OUTPUT_PREFIX,
    loras: state.params.loras.map((lora) => ({
      name: lora.name,
      displayName: lora.displayName,
      strength: lora.strength,
      clipStrength: lora.clipStrength,
      active: lora.active,
      filePath: lora.filePath,
      sha256: lora.sha256,
      previewUrl: lora.previewUrl,
    })),
  };
}

export function wardrobeLoraKey(lora: Pick<WardrobeLoraSelection, "name" | "filePath">): string {
  return lora.filePath || lora.name;
}

/** 标准 LoRA 插入路径用的合并：按 name 去重，已有条目保留原触发词。 */
export function mergeWardrobeLora(
  loras: WardrobeLoraSelection[],
  selection: WardrobeLoraSelection,
): WardrobeLoraSelection[] {
  const existing = loras.find((lora) => lora.name === selection.name);
  if (!existing) return [...loras, selection];
  return loras.map((lora) =>
    lora.name === selection.name
      ? {
          ...lora,
          ...selection,
          triggerWords: selection.triggerWords?.length
            ? selection.triggerWords
            : lora.triggerWords,
        }
      : lora,
  );
}

/** 把 LoRA 列表里的条目加入造型台（按 name 去重），并带上可用的触发词。 */
export function addWardrobeLora(
  state: WardrobeGenerationState,
  item: LoraItem,
  triggerWords: string[] = [],
): WardrobeGenerationState {
  const name = loraSyntaxName(item);
  if (state.params.loras.some((lora) => lora.name === name)) return state;
  const lora: WardrobeLoraSelection = {
    name,
    displayName: item.model_name || item.file_name,
    strength: 1,
    clipStrength: 1,
    active: true,
    filePath: item.file_path,
    sha256: item.sha256,
    previewUrl: item.preview_url,
    triggerWords: uniqueStrings([...triggerWords, ...extractItemTrainedWords(item)]).slice(0, 50),
  };
  return {
    ...state,
    params: { ...state.params, loras: [...state.params.loras, lora] },
  };
}

export function updateWardrobeLora(
  state: WardrobeGenerationState,
  name: string,
  patch: Partial<WardrobeLoraSelection>,
): WardrobeGenerationState {
  return {
    ...state,
    params: {
      ...state.params,
      loras: state.params.loras.map((lora) =>
        lora.name === name ? { ...lora, ...patch } : lora,
      ),
    },
  };
}

export function removeWardrobeLora(
  state: WardrobeGenerationState,
  name: string,
): WardrobeGenerationState {
  return {
    ...state,
    params: {
      ...state.params,
      loras: state.params.loras.filter((lora) => lora.name !== name),
    },
  };
}
