import { buildAnimaPrompt, buildDefaultPrompt, buildHighresPrompt } from "./workflowBuilders";
import type {
  AnimaGenerationParams,
  AnimaStageToggles,
  ComfyPrompt,
  DrawTextParams,
  HighresParams,
  LoraItem,
  LoraSelection,
  SheetLoraRef,
  SheetMode,
  SheetParams,
} from "../types";

/* ------------------------------------------------------------------ *
 * 三视图（角色三视图 / character sheet）
 *
 * 本模块是「三视图」页的唯一真相：词表、提示词拼装、LoRA 定位与注入、
 * 以及把页面参数组装成既有两条 builder 的入参。
 * 刻意不新增工作流拓扑：Anima 走 buildAnimaPrompt，SDXL 走 buildDefaultPrompt。
 * ------------------------------------------------------------------ */

export type SheetLoraSpec = {
  /** ComfyUI loras 根目录下的相对路径（LoraManager 用的就是这种写法） */
  relativePath: string;
  baseModel: string;
  defaultWeight: number;
  weightHint: string;
  /** LoRA 触发词（可关） */
  trigger: string[];
  /** 三视图构图词（固定，不可关） */
  views: string[];
  body: string[];
  /** 背景词（可关） */
  background: string[];
};

/**
 * 内置三视图 LoRA 规格，取值来自真实 metadata（`AnimaLora/三视图/*.metadata.json`）：
 * - Character Sheet for Anima：baseModel=Anima，trainedWords=`1girl, multiple views, standing, full body,
 *   reference sheet, turnaround`，推荐权重 0.6–0.8；
 * - TRcharactersheet-10：baseModel=Illustrious，trainedWords=`reference sheet, character sheet`，
 *   样例提示词另带 front/side/back view + multiple views + simple background，权重 1.0。
 *
 * 注意：Anima 的 trainedWords 是**一个逗号长串**，不能整串当标签用；`1girl` 已抽成页面的
 * 「主体」选项（否则画男性角色会与触发词打架）。
 */
export const SHEET_LORAS: Record<SheetMode, SheetLoraSpec> = {
  anima: {
    relativePath: "AnimaLora/三视图/Character Sheet for Anima.safetensors",
    baseModel: "Anima",
    defaultWeight: 0.7,
    weightHint: "推荐 0.6–0.8",
    trigger: ["reference sheet", "turnaround"],
    views: ["multiple views", "front view", "side view", "back view"],
    body: ["full body", "standing"],
    background: ["simple background", "white background"],
  },
  sdxl: {
    relativePath: "AnimaLora/三视图/TRcharactersheet-10.safetensors",
    baseModel: "Illustrious",
    defaultWeight: 0.9,
    weightHint: "推荐 0.8–1.0",
    trigger: ["reference sheet", "character sheet"],
    views: ["multiple views", "front view", "side view", "back view"],
    body: ["full body", "standing"],
    background: ["simple background", "white background"],
  },
};

/**
 * 三视图专用 Anima 阶段档：基础采样 + CFGZeroStar。
 * 刻意关掉两级放大与全部 detailer——沿用「完整复刻」档会把 1344×1024 放大到 4096×6144，
 * 首图就要几分钟且显存吃紧。需要放大时在页面「Anima 高级」里手动打开。
 */
export const SHEET_ANIMA_STAGES: AnimaStageToggles = {
  img2img: false,
  cfgZeroStar: true,
  refinePass: false,
  hiresFixPre: false,
  segsDetailer: false,
  handDetailer: false,
  nsfwDetailer: false,
  faceDetailer: false,
  eyesDetailer: false,
  hiresFixPost: false,
  wildcardNode: false,
  saveImage: true,
};

/** 两族惯用负向（分别来自两个 LoRA 的 Civitai 样例） */
export const SHEET_DEFAULT_NEGATIVE: Record<SheetMode, string> = {
  anima:
    "old, early, (lowres, worst quality, low quality), (score_1, score_2, score_3), blurry, text, signature, logo, watermark",
  sdxl: "bad quality, worst quality, worst detail, sketch, censor, text, signature, watermark",
};

/** 两族惯用画质词（Anima 走 Qwen-Image 系，SDXL 系吃 masterpiece/best quality） */
export const SHEET_DEFAULT_STYLE: Record<SheetMode, string> = {
  anima: "(masterpiece, best quality, highres, absurdres, newest), anime coloring",
  sdxl: "masterpiece, best quality",
};

/* ------------------------------------------------------------------ *
 * 提示词拼装
 * ------------------------------------------------------------------ */

/** 按英文逗号 / 中文逗号 / 换行切词，丢弃空段（避免拼出 `,,` 或前导逗号） */
export function splitPromptTags(text: string): string[] {
  return String(text ?? "")
    .split(/[,，\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** 去重键：大小写不敏感，`_` 视同空格（danbooru 两种写法等价） */
export function dedupeKey(tag: string): string {
  return tag.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

/** `(word:1.2)` / `[word:0.8]` 这类权重语法：不参与去重，避免误伤同一词的加权与裸用 */
export function isWeightedTag(tag: string): boolean {
  return /^[([][^)\]]*:\s*-?\d+(?:\.\d+)?[)\]]$/.test(tag);
}

export type SheetPromptInput = {
  mode: SheetMode;
  subject: string;
  character: string;
  style: string;
  includeTrigger: boolean;
  includeBackground: boolean;
};

/**
 * 拼装最终正向提示词。
 * 顺序固定：主体 → 触发词(可关) → 视角词 → 体型词 → 背景词(可关) → 角色描述 → 画风。
 * 去重保留「首次出现」的原始写法；生成与页面预览共用本函数（所见即所得）。
 */
export function composeSheetPrompt(input: SheetPromptInput): string {
  const spec = SHEET_LORAS[input.mode];
  const fixed: string[] = [];
  if (input.subject.trim()) fixed.push(input.subject);
  if (input.includeTrigger) fixed.push(...spec.trigger);
  fixed.push(...spec.views, ...spec.body);
  if (input.includeBackground) fixed.push(...spec.background);

  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    if (isWeightedTag(tag)) {
      out.push(tag);
      return;
    }
    const key = dedupeKey(tag);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(tag);
  };

  fixed.forEach(push);
  splitPromptTags(input.character).forEach(push);
  splitPromptTags(input.style).forEach(push);
  return out.join(", ");
}

/** 从页面参数取拼装入参（主体/画风跟随当前模式） */
export function sheetPromptInput(sheet: SheetParams): SheetPromptInput {
  return {
    mode: sheet.mode,
    subject: sheet.subject,
    character: sheet.characterPrompt,
    style: sheet.style?.[sheet.mode] ?? "",
    includeTrigger: sheet.lora?.enabled !== false && sheet.lora?.includeTrigger !== false,
    includeBackground: sheet.lora?.includeBackground !== false,
  };
}

/** 页面预览 / 提示词仓库高亮共用：当前模式的最终正向提示词 */
export function composeSheetPromptFromParams(sheet: SheetParams): string {
  return composeSheetPrompt(sheetPromptInput(sheet));
}

/* ------------------------------------------------------------------ *
 * LoRA 定位与注入
 * ------------------------------------------------------------------ */

/** LoRA 名归一：`/`→`\`、去扩展名、小写（与 LoraManager 的 loras 列表口径一致） */
export function normalizeLoraKey(name: string): string {
  return String(name ?? "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\.(safetensors|pt|ckpt|bin)$/i, "")
    .toLowerCase();
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) (out as Record<string, unknown>)[key] = item;
  }
  return out;
}

/**
 * 注入/更新三视图 LoRA。
 * 不能用 `mergeLora`（同名直接 return）——那样改权重滑杆不会生效。
 * 命中同名（含仅 basename 相同：用户从管理器插入过同一文件）则原地替换，否则插到首位。
 */
export function upsertSheetLora(loras: LoraSelection[], selection: LoraSelection): LoraSelection[] {
  const key = normalizeLoraKey(selection.name);
  const base = key.split("\\").pop() ?? key;
  const index = loras.findIndex((lora) => {
    const loraKey = normalizeLoraKey(lora.name);
    return loraKey === key || (loraKey.split("\\").pop() ?? loraKey) === base;
  });

  const patch = stripUndefined({ ...selection, active: true });
  if (index < 0) return [{ ...selection, active: true }, ...loras];

  const next = [...loras];
  next[index] = { ...next[index], ...patch };
  return next;
}

export type SheetLoraResolution = {
  ref: SheetLoraRef;
  /** 是否在 LoRA 库里找到了实体条目（false = 按相对路径兜底） */
  matched: boolean;
  source: "list" | "fallback";
};

/**
 * 定位三视图 LoRA。
 * 优先级：完整相对路径 → 文件名同名（用户搬过目录）→ file_path 后缀匹配 → 相对路径兜底。
 * 兜底不是错误：ComfyUI 的 loras 列表本来就接受相对路径，只是无法给出预览与哈希。
 */
export function resolveSheetLora(
  mode: SheetMode,
  items: LoraItem[] = [],
  override?: string,
): SheetLoraResolution {
  const spec = SHEET_LORAS[mode];
  const wanted = (override ?? "").trim() || spec.relativePath;
  const wantedKey = normalizeLoraKey(wanted);
  const wantedBase = wantedKey.split("\\").pop() ?? wantedKey;

  let best: { item: LoraItem; rank: number } | null = null;
  for (const item of items ?? []) {
    if (!item?.file_name) continue;
    const fullKey = normalizeLoraKey(item.folder ? `${item.folder}/${item.file_name}` : item.file_name);
    const fileKey = normalizeLoraKey(item.file_name);
    let rank = -1;
    if (fullKey === wantedKey) rank = 0;
    else if (fileKey === wantedBase) rank = 1;
    else if (item.file_path) {
      const pathKey = normalizeLoraKey(item.file_path);
      if (pathKey === wantedKey || pathKey.endsWith(`\\${wantedKey}`)) rank = 2;
    }
    if (rank >= 0 && (!best || rank < best.rank)) best = { item, rank };
  }

  if (best) {
    const item = best.item;
    return {
      matched: true,
      source: "list",
      ref: {
        name: item.folder ? `${item.folder}/${item.file_name}` : item.file_name,
        displayName: item.model_name || item.file_name,
        filePath: item.file_path,
        sha256: item.sha256,
        previewUrl: item.preview_url,
      },
    };
  }

  return {
    matched: false,
    source: "fallback",
    ref: { name: wanted, displayName: wanted.split(/[\\/]/).pop() },
  };
}

function withSheetLora(
  loras: LoraSelection[],
  sheet: SheetParams,
  ref: SheetLoraRef | null,
): LoraSelection[] {
  // 关闭开关 = 既不挂 LoRA 也不补触发词（触发词开关在 composeSheetPrompt 里同样看 enabled）
  if (!ref || sheet.lora?.enabled === false) return loras;
  const weight = sheet.lora?.weight?.[sheet.mode] ?? SHEET_LORAS[sheet.mode].defaultWeight;
  return upsertSheetLora(loras, {
    name: ref.name,
    displayName: ref.displayName,
    strength: weight,
    clipStrength: weight,
    active: true,
    filePath: ref.filePath,
    sha256: ref.sha256,
    previewUrl: ref.previewUrl,
  });
}

/* ------------------------------------------------------------------ *
 * 组装成既有 builder 的入参
 * ------------------------------------------------------------------ */

/** 参考图是否真的生效（开关 + 已选图，两者缺一不可） */
export function sheetHasReference(sheet: SheetParams): boolean {
  return Boolean(sheet.reference?.enabled && sheet.reference?.imageName);
}

export function toSheetAnimaParams(
  sheet: SheetParams,
  ref: SheetLoraRef | null,
  drawText?: DrawTextParams,
): AnimaGenerationParams {
  const base = sheet.anima;
  const hasReference = sheetHasReference(sheet);
  return {
    ...base,
    checkpoint: "",
    positivePrompt: composeSheetPromptFromParams(sheet),
    // Anima 的图生图开关是 stages.img2img（builder 判定条件为 stages.img2img && imageName）
    stages: { ...base.stages, img2img: hasReference },
    img2img: { ...base.img2img, imageName: sheet.reference?.imageName ?? "" },
    loras: withSheetLora(base.loras, sheet, ref),
    drawText,
  };
}

export function toSheetSdxlParams(
  sheet: SheetParams,
  ref: SheetLoraRef | null,
  drawText?: DrawTextParams,
): HighresParams {
  const base = sheet.sdxl;
  const hasReference = sheetHasReference(sheet);
  return {
    ...base,
    positivePrompt: composeSheetPromptFromParams(sheet),
    img2img: {
      enabled: hasReference,
      imageName: sheet.reference?.imageName ?? "",
      fit: base.img2img?.fit ?? "stretch",
      upscaleMethod: base.img2img?.upscaleMethod ?? "lanczos",
      // 三视图页不做局部重绘遮罩，显式清空避免沿用旧值
      maskName: "",
    },
    loras: withSheetLora(base.loras, sheet, ref),
    drawText,
  };
}

/**
 * SDXL 侧是否启用了任一项修复（放大 / 全图 / 手 / 脸 / 眼 / NSFW）。
 * 全关时走纯文生图链路（与加入修复区之前逐节点一致），开启后改走高清修复链路。
 */
export function sheetSdxlFixEnabled(params: HighresParams): boolean {
  return Boolean(
    params.enableUpscale ||
      params.enableSegsDetailer ||
      params.enableHandDetailer ||
      params.enableFaceDetailer ||
      params.enableEyesDetailer ||
      params.enableNsfwDetailer,
  );
}

export type SheetBuildContext = {
  loraRef: SheetLoraRef | null;
  drawText?: DrawTextParams;
  animaCaps?: { useEasyHiresFix?: boolean; useImageResizeKJv2?: boolean };
};

/** 生成入口：按模式分发到既有 builder，不新增工作流拓扑 */
export function buildSheetPrompt(sheet: SheetParams, ctx: SheetBuildContext): ComfyPrompt {
  // 开关关闭由 withSheetLora 统一拦截（它也负责「不补触发词」），此处原样透传引用
  if (sheet.mode === "anima") {
    return buildAnimaPrompt(toSheetAnimaParams(sheet, ctx.loraRef, ctx.drawText), ctx.animaCaps ?? {});
  }
  const sdxlParams = toSheetSdxlParams(sheet, ctx.loraRef, ctx.drawText);
  // SDXL 修复全关 → 纯文生图（保持三视图首次接入时的节点结构不变）
  return sheetSdxlFixEnabled(sdxlParams)
    ? buildHighresPrompt(sdxlParams)
    : buildDefaultPrompt(sdxlParams);
}
