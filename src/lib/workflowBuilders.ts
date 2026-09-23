import type {
  AnimaGenerationParams,
  BaseGenerationParams,
  ComfyPrompt,
  HighresParams,
  LoraSelection,
  MultiGenerationParams,
  Wd14Params,
  ClBatchParams,
  WdBatchParams,
  ClSingleParams,
} from "../types";
import { ANIMA_UPSCALE_MODEL_SCALE } from "../constants";
import { buildWd14Workflow } from "./wd14Workflow";
import { resolveDynamicPrompt } from "./dynamicPrompt";
import { resolveSeed } from "./seed";
import { appendDetailerChain, type DetailerChainStage } from "./detailerChain";

export { resolveSeed };


export function formatLoraName(name: string, withExtension = true): string {
  const trimmed = name.trim();
  // 在 Windows 环境下，无论是 text 语法还是 loras 列表，通常都需要反斜杠
  let finalName = trimmed.replace(/\//g, "\\");
  
  if (withExtension) {
    // 标准语法通常需要扩展名
    const hasExtension = /\.(safetensors|pt|ckpt|bin)$/i.test(finalName);
    if (!hasExtension) {
      finalName = `${finalName}.safetensors`;
    }
  } else {
    // LoraManager 的 loras 列表通常不需要扩展名
    finalName = finalName.replace(/\.(safetensors|pt|ckpt|bin)$/i, "");
  }
  
  return finalName;
}

export function buildLoraSyntax(loras: LoraSelection[], withExtension = true): string {
  return loras
    .filter((lora) => lora.active && lora.name.trim())
    .map((lora) => {
      const finalName = formatLoraName(lora.name, withExtension);
      return `<lora:${finalName}:${formatStrength(lora.strength)}>`;
    })
    .join(" ");
}

function formatStrength(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function outputPrefix(prefix: string, fallback: string, suffix?: string, date = new Date()) {
  const raw = prefix.trim() || fallback;
  const expanded = raw.replace(/%date(?::([^%]+))?%/g, (_match, format: string | undefined) =>
    formatDate(date, format || "yyyyMMddhhmmss"),
  );
  let base = expanded
    .split(/[\\/]/)
    .map((segment) => segment.replace(/[<>:"|?*]/g, "_"))
    .join("/");
    
  if (suffix) {
    const safeSuffix = suffix.replace(/[<>:"/\\|?*\n\r\t]/g, "_").slice(0, 50).trim();
    if (safeSuffix) {
      base = `${base}_${safeSuffix}`;
    }
  }
  return base;
}

function joinPrompt(...parts: Array<string | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join("\n");
}

function insertDrawTextNode(
  prompt: ComfyPrompt,
  params: BaseGenerationParams,
  inputImage: [string, number],
  nextId: number
): [string, number] {
  if (!params.drawText?.enabled) return inputImage;

  const textToDraw = (params.drawText.text && params.drawText.text.trim()) ? params.drawText.text : "测试文本";

  const drawTextId = String(nextId);
  prompt[drawTextId] = {
    class_type: "DrawTextAdvanced",
    inputs: {
      text: textToDraw,
      font: params.drawText.font,
      size: params.drawText.size,
      color: params.drawText.color,
      background_color: params.drawText.backgroundColor,
      width: params.drawText.syncWithImage ? params.width : (params.drawText.width || 0),
      height: params.drawText.syncWithImage ? params.height : (params.drawText.height || 0),
      max_width: params.drawText.maxWidth || 0,
      line_spacing: params.drawText.lineSpacing || 0,
      letter_spacing: params.drawText.letterSpacing || 0,
      glow_blur: params.drawText.glowBlur || 0,
      glow_color: params.drawText.glowColor || "#FFFFFF",
      shadow_distance: params.drawText.shadowDistance,
      shadow_blur: params.drawText.shadowBlur,
      shadow_color: params.drawText.shadowColor,
      horizontal_align: params.drawText.horizontalAlign,
      vertical_align: params.drawText.verticalAlign,
      offset_x: params.drawText.offsetX,
      offset_y: params.drawText.offsetY,
      direction: params.drawText.direction,
      rotation: params.drawText.rotation || 0,
      stroke_width: params.drawText.strokeWidth || 0,
      stroke_color: params.drawText.strokeColor || "#00000000",
      color_2: params.drawText.color2 || "#FFFFFF",
      gradient_colors: (params.drawText.gradientColors || []).join(','),
      gradient_direction: params.drawText.gradientDirection || "none",
      gradient_angle: params.drawText.gradientAngle || 0,
      layout_direction: params.drawText.layoutDirection || "horizontal",
      decoration: params.drawText.decoration || "none",
      img_composite: inputImage,
    },
    _meta: { title: "Draw Text" },
  };

  return [drawTextId, 0];
}

/**
 * 图生图 latent：LoadImage → ImageScale → VAEEncode（batchSize > 1 时再 RepeatLatentBatch）。
 *
 * 未开启开关或未选参考图时返回 `null`，调用方保留原有 EmptyLatentImage 分支
 * ——关闭时该函数不写入任何节点，工作流与改造前逐节点一致。
 *
 * 节点键一律用非数字字符串：高修的 detailerChain 用 `nextId` 递增占号（`workflowBuilders.ts:639`），
 * 默认生图的 drawText 又固定占 `"8"`，数字键有碰撞风险。
 * （先例：`base_vae_decode`、`999_save`，均在本项目实机验证可用。）
 *
 * `size` 允许传节点引用：多人工作流的分辨率由 ResolutionMasterSimplify 决定，
 * 必须沿用它的输出，否则会绕过分辨率对齐逻辑。
 */
function img2imgLatent(
  prompt: ComfyPrompt,
  params: BaseGenerationParams,
  vae: [string, number],
  size: { width: number | [string, number]; height: number | [string, number] },
): [string, number] | null {
  const img2img = params.img2img;
  if (!img2img?.enabled || !img2img.imageName) return null;

  prompt["i2i_load"] = {
    class_type: "LoadImage",
    inputs: { image: img2img.imageName },
    _meta: { title: "加载参考图" },
  };
  prompt["i2i_scale"] = {
    class_type: "ImageScale",
    inputs: {
      image: ["i2i_load", 0],
      upscale_method: img2img.upscaleMethod,
      width: size.width,
      height: size.height,
      crop: img2img.fit === "crop" ? "center" : "disabled",
    },
    _meta: { title: "缩放参考图" },
  };
  prompt["i2i_encode"] = {
    class_type: "VAEEncode",
    inputs: { pixels: ["i2i_scale", 0], vae },
    _meta: { title: "参考图 VAE 编码" },
  };

  let latent: [string, number] = ["i2i_encode", 0];
  // VAEEncode 输出恒为 1 张，要保住「批量」语义只能显式复制 latent。
  // 注意 RepeatLatentBatch.amount 上限是 64，而 EmptyLatentImage.batch_size 可到 4096。
  if (params.batchSize > 1) {
    prompt["i2i_repeat"] = {
      class_type: "RepeatLatentBatch",
      inputs: { samples: latent, amount: Math.min(params.batchSize, 64) },
      _meta: { title: "复制参考图 latent（批量）" },
    };
    latent = ["i2i_repeat", 0];
  }
  return latent;
}

/** 把 KSampler 的 latent 来源换成图生图链路；未启用时原样返回 false，调用方保持不动 */
function applyImg2ImgLatent(
  prompt: ComfyPrompt,
  params: BaseGenerationParams,
  vae: [string, number],
  size: { width: number | [string, number]; height: number | [string, number] },
  ksamplerId: string,
  emptyLatentId: string,
): boolean {
  const latent = img2imgLatent(prompt, params, vae, size);
  if (!latent) return false;
  delete prompt[emptyLatentId];
  (prompt[ksamplerId].inputs as Record<string, unknown>).latent_image = latent;
  return true;
}

function baseCheckpoint(params: BaseGenerationParams): ComfyPrompt {
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: params.checkpoint,
      },
      _meta: { title: "Load Checkpoint" },
    },
  };
}

function loraAwarePrompt(params: BaseGenerationParams) {
  return joinPrompt(buildLoraSyntax(params.loras), params.positivePrompt);
}

function buildLoraList(loras: LoraSelection[]): any {
  const list = loras
    .filter((l) => l.active && l.name.trim())
    .map((l) => ({
      name: formatLoraName(l.name, false),
      strength: l.strength,
      clipStrength: l.clipStrength ?? l.strength,
      active: true,
      expanded: false,
      selected: false,
      locked: false,
    }));

  return { "__value__": list };
}

export function buildDefaultPrompt(params: BaseGenerationParams): ComfyPrompt {
  const resolvedSeed = resolveSeed(params.seed, params.randomizeSeed);
  const positivePrompt = resolveDynamicPrompt(params.positivePrompt, resolvedSeed);
  const negativePrompt = resolveDynamicPrompt(params.negativePrompt, resolvedSeed);

  const prompt: ComfyPrompt = {
    ...baseCheckpoint(params),
    "2": {
      class_type: "Lora Loader (LoraManager)",
      inputs: {
        model: ["1", 0],
        clip: ["1", 1],
        text: buildLoraSyntax(params.loras, false),
        loras: buildLoraList(params.loras),
        __lm_autocomplete_meta_text: { version: 1, textWidgetName: "text" },
      },
      _meta: { title: "Lora Loader (LoraManager)" },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["2", 1],
        text: positivePrompt,
      },
      _meta: { title: "正向提示词" },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["2", 1],
        text: negativePrompt,
      },
      _meta: { title: "反向提示词" },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: params.width,
        height: params.height,
        batch_size: params.batchSize,
      },
      _meta: { title: "空 Latent" },
    },
    "6": {
      class_type: "KSampler",
      inputs: samplerInputs(params, ["2", 0], ["3", 0], ["4", 0], ["5", 0], resolvedSeed),
      _meta: { title: "KSampler" },
    },
    "7": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["6", 0],
        vae: ["1", 2],
      },
      _meta: { title: "VAE Decode" },
    },
  };

  // 图生图：开关开启且选了参考图时，用 LoadImage → ImageScale → VAEEncode 取代空 latent；
  // 未启用时本行为空操作，工作流与改造前逐节点一致。
  applyImg2ImgLatent(prompt, params, ["1", 2], { width: params.width, height: params.height }, "6", "5");

  const finalImage = insertDrawTextNode(prompt, params, ["7", 0], 8);

  prompt["999_save"] = {
    class_type: "SaveImage",
    inputs: {
      images: finalImage,
      filename_prefix: outputPrefix(params.filenamePrefix, "%date:yyyy-MM-dd%/ComfyUI", params.filenameSuffix),
    },
    _meta: { title: "Save Image" },
  };

  return prompt;
}

export function buildWd14Prompt(params: Wd14Params): ComfyPrompt {
  return buildWd14Workflow(params);
}

export function buildClSinglePrompt(params: ClSingleParams): ComfyPrompt {
  return {
    "1": {
      class_type: "LoadImage",
      inputs: {
        image: params.imageName,
      },
      _meta: { title: "Load Image" },
    },
    "2": {
      class_type: "cl_tagger_mira",
      inputs: {
        image: ["1", 0],
        model_name: params.modelName,
        general: params.general,
        character: params.character,
        replace_space: params.replaceSpace,
        categories: params.categories,
        exclude_tags: params.excludeTags,
        session_method: params.sessionMethod,
      },
      _meta: { title: "CL Tagger" },
    },
    "3": {
      class_type: "PreviewImage",
      inputs: {
        images: ["1", 0],
      },
      _meta: { title: "Preview Image" },
    },
    // Force execution and return text via Save Text node
    "4": {
      class_type: "> Save Text",
      inputs: {
        text: ["2", 0],
        filename_opt: "tag_temp",
        filename_prefix: "",
        folder: "tagging",
      },
      _meta: { title: "Save Tags" },
    },
  };
}

export function buildClBatchPrompt(params: ClBatchParams, index: number): ComfyPrompt {
  return {
    "15": {
      class_type: "> Load Image From Folder",
      inputs: {
        index,
        image_folder: params.imageFolder,
      },
      _meta: { title: "> Load Image From Folder" },
    },
    "1": {
      class_type: "cl_tagger_mira",
      inputs: {
        image: ["15", 0],
        model_name: params.modelName,
        general: params.general,
        character: params.character,
        replace_space: params.replaceSpace,
        categories: params.categories,
        exclude_tags: params.excludeTags,
        session_method: params.sessionMethod,
      },
      _meta: { title: "CL Tagger" },
    },
    "19": {
      class_type: "> Text",
      inputs: { text: params.prependText },
      _meta: { title: "Prepend Text" },
    },
    "16": {
      class_type: "Text Concatenate",
      inputs: {
        text_a: ["19", 0],
        text_b: ["1", 0],
        delimiter: ", ",
        clean_whitespace: "false",
      },
      _meta: { title: "Text Concatenate" },
    },
    "14": {
      class_type: "> Save Text",
      inputs: {
        text: ["16", 0],
        filename_opt: ["15", 1],
        filename_prefix: "_",
        folder: params.outputFolder,
      },
      _meta: { title: "> Save Text" },
    },
    "13": {
      class_type: "> Save Image",
      inputs: {
        images: ["15", 0],
        filename_opt: ["15", 1],
        filename_prefix: "_",
        folder: params.outputFolder,
        overwrite_warning: false,
        include_metadata: true,
        extension: "png",
        quality: 95,
      },
      _meta: { title: "> Save Image" },
    },
  };
}

export function buildWdBatchPrompt(params: WdBatchParams, index: number): ComfyPrompt {
  const inputs: any = {
    image: ["15", 0],
    model: params.model,
    threshold: params.threshold,
    character_threshold: params.characterThreshold,
    replace_underscore: params.replaceUnderscore,
    trailing_comma: params.trailingComma,
    exclude_tags: params.excludeTags,
  };
  
  if (params.device) {
    inputs.device = params.device;
  }

  return {
    "15": {
      class_type: "> Load Image From Folder",
      inputs: {
        index,
        image_folder: params.imageFolder,
      },
      _meta: { title: "> Load Image From Folder" },
    },
    "37": {
      class_type: "WD14Tagger|pysssss",
      inputs: inputs,
      _meta: { title: "WD14 Tagger" },
    },
    "19": {
      class_type: "> Text",
      inputs: { text: params.prependText },
      _meta: { title: "Prepend Text" },
    },
    "16": {
      class_type: "Text Concatenate",
      inputs: {
        text_a: ["19", 0],
        text_b: ["37", 0],
        delimiter: ", ",
        clean_whitespace: "false",
      },
      _meta: { title: "Text Concatenate" },
    },
    "14": {
      class_type: "> Save Text",
      inputs: {
        text: ["16", 0],
        filename_opt: ["15", 1],
        filename_prefix: "_",
        folder: params.outputFolder,
      },
      _meta: { title: "> Save Text" },
    },
    "13": {
      class_type: "> Save Image",
      inputs: {
        images: ["15", 0],
        filename_opt: ["15", 1],
        filename_prefix: "_",
        folder: params.outputFolder,
        overwrite_warning: false,
        include_metadata: true,
        extension: "png",
        quality: 95,
      },
      _meta: { title: "> Save Image" },
    },
  };
}

export function buildMultiPrompt(params: MultiGenerationParams): ComfyPrompt {
  const resolvedSeed = resolveSeed(params.seed, params.randomizeSeed);
  const globalPrompt = resolveDynamicPrompt(params.globalPrompt, resolvedSeed);
  const negativePrompt = resolveDynamicPrompt(params.negativePrompt, resolvedSeed);
  const characters = params.characters.map((character) => ({
    ...character,
    prompt: resolveDynamicPrompt(character.prompt, resolvedSeed),
  }));

  const mceConfig = {
    version: "1.1.0",
    syntax_mode: params.syntaxMode,
    base_prompt: "",
    global_prompt: joinPrompt(buildLoraSyntax(params.loras), globalPrompt),
    use_fill: params.useFill,
    global_use_fill: false,
    canvas: {
      width: params.canvasWidth,
      height: params.canvasHeight,
    },
    characters,
    settings: {
      language: "zh-CN",
      theme: {
        primaryColor: "#743795",
        backgroundColor: "#2a2a2a",
        secondaryColor: "#333333",
      },
    },
    timestamp: Date.now(),
  };

  const prompt: ComfyPrompt = {
    ...baseCheckpoint(params),
    "27": {
      class_type: "MultiCharacterEditorNode",
      inputs: {
        syntax_mode: params.syntaxMode,
        use_fill: params.useFill,
        mce_config: JSON.stringify(mceConfig),
        canvas_width: params.canvasWidth,
        canvas_height: params.canvasHeight,
        multi_character_editor: "",
      },
      _meta: { title: "多角色编辑器 (Multi Character Editor)" },
    },
    "25": {
      class_type: "PCLazyLoraLoader",
      inputs: {
        text: ["27", 0],
        model: ["1", 0],
        clip: ["1", 1],
      },
      _meta: { title: "PC: Schedule LoRAs" },
    },
    "2": {
      class_type: "PCLazyTextEncode",
      inputs: {
        clip: ["25", 1],
        text: ["27", 0],
      },
      _meta: { title: "PC: Schedule Prompt (positive)" },
    },
    "7": {
      class_type: "PCLazyTextEncode",
      inputs: {
        clip: ["1", 1],
        text: negativePrompt || " ",
      },
      _meta: { title: "PC: Schedule Prompt (negative)" },
    },
    "22": {
      class_type: "ResolutionMasterSimplify",
      inputs: {
        width: params.width,
        height: params.height,
      },
      _meta: { title: "Resolution Master Simplify" },
    },
    "9": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: ["22", 0],
        height: ["22", 1],
        batch_size: params.batchSize,
      },
      _meta: { title: "空Latent图像" },
    },
    "4": {
      class_type: "KSampler",
      inputs: samplerInputs(params, ["25", 0], ["2", 0], ["7", 0], ["9", 0], resolvedSeed),
      _meta: { title: "K采样器" },
    },
    "10": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["4", 0],
        vae: ["1", 2],
      },
      _meta: { title: "VAE解码" },
    },
  };

  // 图生图：分辨率必须沿用 ResolutionMasterSimplify("22") 的输出，否则会绕过分辨率对齐逻辑
  applyImg2ImgLatent(
    prompt,
    params,
    ["1", 2],
    { width: ["22", 0], height: ["22", 1] },
    "4",
    "9",
  );

  const finalImage = insertDrawTextNode(prompt, params, ["10", 0], 28);

  prompt["999_save"] = {
    class_type: "SaveImage",
    inputs: {
      images: finalImage,
      filename_prefix: outputPrefix(params.filenamePrefix, "多人/%date:yyyy-MM-dd%/ComfyUI", params.filenameSuffix),
    },
    _meta: { title: "保存图像" },
  };

  return prompt;
}

export function buildHighresPrompt(params: HighresParams): ComfyPrompt {
  const baseResolvedSeed = resolveSeed(params.seed, params.randomizeSeed);
  const highresResolvedSeed = (params.syncHighresSeed ?? true) ? baseResolvedSeed : resolveSeed(params.highresSeed, params.randomizeHighresSeed ?? true);
  const positivePrompt = resolveDynamicPrompt(params.positivePrompt, baseResolvedSeed);
  const negativePrompt = resolveDynamicPrompt(params.negativePrompt, baseResolvedSeed);

  const prompt: ComfyPrompt = {
    ...baseCheckpoint(params),
    "2": {
      class_type: "Lora Loader (LoraManager)",
      inputs: {
        model: ["1", 0],
        clip: ["1", 1],
        text: buildLoraSyntax(params.loras, false),
        loras: buildLoraList(params.loras),
        __lm_autocomplete_meta_text: { version: 1, textWidgetName: "text" },
      },
      _meta: { title: "Lora Loader (LoraManager)" },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["2", 1],
        text: positivePrompt,
      },
      _meta: { title: "正向提示词" },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["2", 1],
        text: negativePrompt,
      },
      _meta: { title: "反向提示词" },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: params.width,
        height: params.height,
        batch_size: params.batchSize,
      },
      _meta: { title: "空 Latent" },
    },
    "6": {
      class_type: "KSampler",
      inputs: samplerInputs(params, ["2", 0], ["3", 0], ["4", 0], ["5", 0], baseResolvedSeed),
      _meta: { title: "基础采样" },
    },
    "base_vae_decode": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["6", 0],
        vae: ["1", 2],
      },
      _meta: { title: "基础图像解码" },
    },
  };

  // 图生图：只替换基础采样的 latent 来源，后面的放大链走 KSampler 输出，不受影响
  applyImg2ImgLatent(prompt, params, ["1", 2], { width: params.width, height: params.height }, "6", "5");

  // Handle backward compatibility for legacy variant
  const enableUpscale = params.enableUpscale ?? true;
  const enableSegsDetailer = params.enableSegsDetailer ?? false;
  const enableHandDetailer = params.enableHandDetailer ?? false;
  const enableFaceDetailer = params.enableFaceDetailer ?? false;
  const enableEyesDetailer = params.enableEyesDetailer ?? false;
  const enableNsfwDetailer = params.enableNsfwDetailer ?? false;

  if (enableUpscale) {
    prompt["7"] = {
      class_type: "LatentUpscaleBy",
      inputs: {
        samples: ["6", 0],
        upscale_method: params.upscaleMethod,
        scale_by: params.scaleBy,
      },
      _meta: { title: "Latent 高清放大" },
    };
    prompt["8"] = {
      class_type: "KSampler",
      inputs: {
        seed: highresResolvedSeed,
        steps: params.highresSteps,
        cfg: params.highresCfg,
        sampler_name: params.samplerName,
        scheduler: params.scheduler,
        denoise: params.highresDenoise,
        model: ["2", 0],
        positive: ["3", 0],
        negative: ["4", 0],
        latent_image: ["7", 0],
      },
      _meta: { title: "高清修复采样" },
    };
    prompt["9"] = {
      class_type: "VAEDecode",
      inputs: {
        samples: ["8", 0],
        vae: ["1", 2],
      },
      _meta: { title: "高清修复 VAE Decode" },
    };
  }

  let currentImage: [string, number] = enableUpscale ? ["9", 0] : ["base_vae_decode", 0];
  let nextId = 10;

  // 修复链：按「全图 → 脸 → 眼 → NSFW → 手」的顺序收集阶段，
  // 具体节点构造交给共用模块 detailerChain（与「Anima 生图」共用同一实现）。
  const detailerStages: DetailerChainStage[] = [];
  if (enableSegsDetailer) {
    detailerStages.push({
      key: "segs",
      detector: params.faceDetector,
      params: params.segsDetailer,
      detailerTitle: "全图修复 (SEGS)",
      detectorTitle: "全图检测器",
    });
  }
  if (enableFaceDetailer) {
    detailerStages.push({
      key: "face",
      detector: params.faceDetector,
      params: params.faceDetailer,
      detailerTitle: "脸部修复",
      detectorTitle: "脸部检测器",
    });
  }
  if (enableEyesDetailer) {
    detailerStages.push({
      key: "eyes",
      detector: params.eyesDetector,
      params: params.eyesDetailer,
      detailerTitle: "眼部修复",
      detectorTitle: "眼部检测器",
    });
  }
  if (enableNsfwDetailer) {
    detailerStages.push({
      key: "nsfw",
      detector: params.nsfwDetector,
      params: params.nsfwDetailer,
      detailerTitle: "NSFW修复",
      detectorTitle: "NSFW检测器",
    });
  }
  if (enableHandDetailer) {
    detailerStages.push({
      key: "hand",
      detector: params.handDetector,
      params: params.handDetailer,
      detailerTitle: "手部修复",
      detectorTitle: "手部检测器",
    });
  }

  if (detailerStages.length) {
    const chain = appendDetailerChain(prompt, {
      stages: detailerStages,
      image: currentImage,
      model: ["2", 0],
      diffusionModel: ["2", 0],
      clip: ["2", 1],
      vae: ["1", 2],
      positive: ["3", 0],
      negative: ["4", 0],
      nextId,
      segsMaskSize: {
        width: enableUpscale ? Math.round(params.width * params.scaleBy) : params.width,
        height: enableUpscale ? Math.round(params.height * params.scaleBy) : params.height,
      },
      leadingPreviewTitle: enableUpscale ? "高清放大图像" : "基础生成图像",
      alreadyPreviewedRefs: [
        ["9", 0],
        ["base_vae_decode", 0],
      ],
    });
    currentImage = chain.image;
    nextId = chain.nextId;
  }

  const compareNodeId = String(nextId++);
  prompt[compareNodeId] = {
    class_type: "Image Comparer (rgthree)",
    inputs: {
      image_a: ["base_vae_decode", 0],
      image_b: currentImage,
    },
    _meta: { title: "生成结果 对比" },
  };

  currentImage = insertDrawTextNode(prompt, params, currentImage, nextId);
  nextId += 2;

  prompt[String(nextId)] = {
    class_type: "SaveImage",
    inputs: {
      images: currentImage,
      filename_prefix: outputPrefix(params.filenamePrefix, "高清修复/%date:yyyy-MM-dd%/ComfyUI", params.filenameSuffix),
    },
    _meta: { title: "Save Image" },
  };

  return prompt;
}

function samplerInputs(
  params: BaseGenerationParams,
  model: [string, number],
  positive: [string, number],
  negative: [string, number],
  latent: [string, number],
  overrideSeed?: number,
) {
  return {
    seed: overrideSeed !== undefined ? overrideSeed : resolveSeed(params.seed, params.randomizeSeed),
    steps: params.steps,
    cfg: params.cfg,
    sampler_name: params.samplerName,
    scheduler: params.scheduler,
    denoise: params.denoise,
    model,
    positive,
    negative,
    latent_image: latent,
  };
}



/* ------------------------------------------------------------------ *
 * Anima（Qwen-Image 系 · Turbo）
 * 与 Checkpoint 系模板的差别只在「模型栈」与「阶段组合」，修复链复用 detailerChain。
 * ------------------------------------------------------------------ */

/** 「放大一次」之后的标称像素尺寸。仅用于估算与降级路径取目标尺寸（percent 是直传节点的）。 */
export function animaUpscaleNominal(size: number, percent: number) {
  return Math.max(1, Math.round((size * percent * ANIMA_UPSCALE_MODEL_SCALE) / 100));
}

export function animaUpscaleTargetSize(width: number, height: number, percent: number) {
  return { width: animaUpscaleNominal(width, percent), height: animaUpscaleNominal(height, percent) };
}

/**
 * 插入一级放大。优先使用原工作流的 `easy hiresFix`；
 * 若该类探测不到（useEasyHiresFix=false）则降级为
 * `UpscaleModelLoader` → `ImageUpscaleWithModel` → `ImageScale`。
 *
 * 降级路径刻意**不用 scale_by 比例**，而是按目标像素尺寸 `ImageScale`——
 * 这样无需知道模型标称倍率，结果与「净倍率」语义完全一致。
 */
function insertAnimaUpscale(
  prompt: ComfyPrompt,
  nextId: number,
  opts: {
    image: [string, number];
    vae: [string, number];
    modelName: string;
    rescaleMethod: string;
    percent: number;
    /** easy 分支的 width/height/longer_side 在 "by percentage" 模式下不参与计算，传输入尺寸即可 */
    inputWidth: number;
    inputHeight: number;
    /** 降级分支的目标像素尺寸 */
    targetWidth: number;
    targetHeight: number;
    title: string;
    useEasyHiresFix: boolean;
    /** 降级分支用的放大模型加载器（惰性、可复用，避免两级放大各建一个） */
    getUpscaleLoaderId: () => string;
  },
): { image: [string, number]; nextId: number } {
  const id = String(nextId++);

  if (opts.useEasyHiresFix) {
    prompt[id] = {
      class_type: "easy hiresFix",
      inputs: {
        model_name: opts.modelName,
        rescale_after_model: true,
        rescale_method: opts.rescaleMethod,
        rescale: "by percentage",
        percent: opts.percent,
        width: opts.inputWidth,
        height: opts.inputHeight,
        longer_side: Math.max(opts.inputWidth, opts.inputHeight),
        crop: "disabled",
        image_output: "Hide",
        link_id: 0,
        save_prefix: "ComfyUI",
        image: opts.image,
        vae: opts.vae,
      },
      _meta: { title: opts.title },
    };
    // 输出顺序实测为 ["pipe", "image", "latent"]，取 index 1
    return { image: [id, 1], nextId };
  }

  const loaderId = opts.getUpscaleLoaderId();
  const upscaleId = String(nextId++);
  prompt[upscaleId] = {
    class_type: "ImageUpscaleWithModel",
    inputs: { upscale_model: [loaderId, 0], image: opts.image },
    _meta: { title: `${opts.title}（模型放大）` },
  };
  const scaleId = String(nextId++);
  prompt[scaleId] = {
    class_type: "ImageScale",
    inputs: {
      image: [upscaleId, 0],
      upscale_method: opts.rescaleMethod,
      width: opts.targetWidth,
      height: opts.targetHeight,
      crop: "disabled",
    },
    _meta: { title: opts.title },
  };
  return { image: [scaleId, 0], nextId };
}

/**
 * Anima 工作流的代码化生成。
 *
 * 可选能力探测（`useEasyHiresFix` / `useImageResizeKJv2`）由调用方从 `/object_info` 传入，
 * 缺省为 true（即优先使用原节点），探测不到时走核心节点等价实现。
 */
export function buildAnimaPrompt(
  params: AnimaGenerationParams,
  capabilities: { useEasyHiresFix?: boolean; useImageResizeKJv2?: boolean } = {},
): ComfyPrompt {
  const useEasyHiresFix = capabilities.useEasyHiresFix ?? true;
  const useImageResizeKJv2 = capabilities.useImageResizeKJv2 ?? true;

  const stages = params.stages;
  const resolvedSeed = resolveSeed(params.seed, params.randomizeSeed);
  const refineSeed = params.refine.syncSeedWithBase ? resolvedSeed : resolveSeed(0, true);
  const positivePrompt = resolveDynamicPrompt(params.positivePrompt, resolvedSeed);
  const negativePrompt = resolveDynamicPrompt(params.negativePrompt, resolvedSeed);

  // ---- 模型栈 + LoRA ----
  const prompt: ComfyPrompt = {
    "1": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: params.modelStack.unetName,
        weight_dtype: params.modelStack.weightDtype,
      },
      _meta: { title: "UNet加载器" },
    },
    "17": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: params.modelStack.clipName,
        type: params.modelStack.clipType,
        device: "default",
      },
      _meta: { title: "加载CLIP" },
    },
    "22": {
      class_type: "VAELoader",
      inputs: { vae_name: params.modelStack.vaeName },
      _meta: { title: "加载VAE" },
    },
    "54": {
      class_type: "Lora Loader (LoraManager)",
      inputs: {
        model: ["1", 0],
        clip: ["17", 0],
        text: buildLoraSyntax(params.loras, false),
        loras: buildLoraList(params.loras),
        __lm_autocomplete_meta_text: { version: 1, textWidgetName: "text" },
      },
      _meta: { title: "Lora Loader (LoraManager)" },
    },
  };

  const clipRef: [string, number] = ["54", 1];
  const vaeRef: [string, number] = ["22", 0];

  // ---- CFGZeroStar（可选）----
  let modelRef: [string, number] = ["54", 0];
  if (stages.cfgZeroStar) {
    prompt["49"] = {
      class_type: "CFGZeroStar",
      inputs: { model: ["54", 0] },
      _meta: { title: "CFGZeroStar" },
    };
    modelRef = ["49", 0];
  }

  // ---- 提示词（默认前端展开；开启节点时交给 Impact 处理）----
  if (stages.wildcardNode) {
    const wildcardInputs = (text: string) => ({
      wildcard_text: text,
      populated_text: text,
      mode: "populate",
      seed: resolvedSeed,
      "Select to add LoRA": "Select the LoRA to add to the text",
      "Select to add Wildcard": "Select the Wildcard to add to the text",
    });
    prompt["3"] = {
      class_type: "ImpactWildcardProcessor",
      inputs: wildcardInputs(positivePrompt),
      _meta: { title: "POSITIVE" },
    };
    prompt["4"] = {
      class_type: "ImpactWildcardProcessor",
      inputs: wildcardInputs(negativePrompt),
      _meta: { title: "NEGATIVE" },
    };
  }

  prompt["42"] = {
    class_type: "CLIPTextEncode",
    inputs: {
      text: stages.wildcardNode ? ["3", 0] : positivePrompt,
      clip: clipRef,
    },
    _meta: { title: "CLIP Text Encode (Positive Prompt)" },
  };
  prompt["45"] = {
    class_type: "CLIPTextEncode",
    inputs: {
      text: stages.wildcardNode ? ["4", 0] : negativePrompt,
      clip: clipRef,
    },
    _meta: { title: "CLIP Text Encode (Negative Prompt)" },
  };

  // ---- latent 来源：图生图（惰性）或空 latent ----
  let nominalWidth = params.width;
  let nominalHeight = params.height;
  let latentRef: [string, number];

  const useImg2Img = stages.img2img && Boolean(params.img2img.imageName);
  if (useImg2Img) {
    prompt["0"] = {
      class_type: "LoadImage",
      inputs: { image: params.img2img.imageName },
      _meta: { title: "加载图像" },
    };
    if (useImageResizeKJv2) {
      prompt["32"] = {
        class_type: "ImageResizeKJv2",
        inputs: {
          image: ["0", 0],
          width: params.width,
          height: params.height,
          upscale_method: params.img2img.upscaleMethod,
          keep_proportion: params.img2img.keepProportion,
          pad_color: "0, 0, 0",
          crop_position: params.img2img.cropPosition,
          divisible_by: 8,
          device: "cpu",
        },
        _meta: { title: "Resize Image v2" },
      };
    } else {
      prompt["32"] = {
        class_type: "ImageScale",
        inputs: {
          image: ["0", 0],
          upscale_method: params.img2img.upscaleMethod,
          width: params.width,
          height: params.height,
          crop: "disabled",
        },
        _meta: { title: "缩放参考图" },
      };
    }
    prompt["34"] = {
      class_type: "VAEEncode",
      inputs: { pixels: ["32", 0], vae: vaeRef },
      _meta: { title: "VAE编码" },
    };
    latentRef = ["34", 0];
  } else {
    prompt["46"] = {
      class_type: "EmptyLatentImage",
      inputs: {
        width: params.width,
        height: params.height,
        batch_size: params.batchSize,
      },
      _meta: { title: "空Latent图像" },
    };
    latentRef = ["46", 0];
  }

  // ---- 基础采样 ----
  prompt["5"] = {
    class_type: "KSampler",
    inputs: {
      seed: resolvedSeed,
      steps: params.steps,
      cfg: params.cfg,
      sampler_name: params.samplerName,
      scheduler: params.scheduler,
      denoise: params.denoise,
      model: modelRef,
      positive: ["42", 0],
      negative: ["45", 0],
      latent_image: latentRef,
    },
    _meta: { title: "K采样器（基础生成）" },
  };

  // ---- 二次精修（同 latent，不放大）----
  let lastLatent: [string, number] = ["5", 0];
  if (stages.refinePass) {
    prompt["25"] = {
      class_type: "KSampler",
      inputs: {
        seed: refineSeed,
        steps: params.refine.steps,
        cfg: params.refine.cfg,
        sampler_name: params.refine.samplerName,
        scheduler: params.refine.scheduler,
        denoise: params.refine.denoise,
        model: modelRef,
        positive: ["42", 0],
        negative: ["45", 0],
        latent_image: ["5", 0],
      },
      _meta: { title: "K采样器（二次精修）" },
    };
    lastLatent = ["25", 0];
  }

  prompt["48"] = {
    class_type: "VAEDecode",
    inputs: { samples: lastLatent, vae: vaeRef },
    _meta: { title: "VAE解码" },
  };

  const decodedImage: [string, number] = ["48", 0];
  let currentImage: [string, number] = decodedImage;
  let nextId = 60;

  // 放大模型加载器：惰性且两级放大共用，仅在核心节点降级路径下才会真正产出
  let upscaleLoaderId: string | null = null;
  const getUpscaleLoaderId = () => {
    if (!upscaleLoaderId) {
      upscaleLoaderId = String(nextId++);
      prompt[upscaleLoaderId] = {
        class_type: "UpscaleModelLoader",
        inputs: { model_name: params.hires.modelName },
        _meta: { title: "放大模型加载器" },
      };
    }
    return upscaleLoaderId;
  };

  // ---- 放大①（精修后、detailer 前）----
  if (stages.hiresFixPre) {
    const target = animaUpscaleTargetSize(nominalWidth, nominalHeight, params.hires.prePercent);
    const res = insertAnimaUpscale(prompt, nextId, {
      image: currentImage,
      vae: vaeRef,
      modelName: params.hires.modelName,
      rescaleMethod: params.hires.rescaleMethod,
      percent: params.hires.prePercent,
      inputWidth: nominalWidth,
      inputHeight: nominalHeight,
      targetWidth: target.width,
      targetHeight: target.height,
      title: "高清放大①",
      useEasyHiresFix,
      getUpscaleLoaderId,
    });
    nextId = res.nextId;
    currentImage = res.image;
    nominalWidth = target.width;
    nominalHeight = target.height;
  }

  // ---- 局部修复链（与「高清修复」共用 detailerChain）----
  // 执行顺序对齐原工作流：全图 SEGS → 手 → NSFW → 脸 → 眼（链式串联，顺序会影响画面）
  const animaStages: DetailerChainStage[] = [];
  if (stages.segsDetailer) {
    animaStages.push({ key: "segs", detector: params.faceDetector, params: params.segsDetailer, detailerTitle: "全图修复 (SEGS)", detectorTitle: "全图检测器" });
  }
  if (stages.handDetailer) {
    animaStages.push({ key: "hand", detector: params.handDetector, params: params.handDetailer, detailerTitle: "手部修复", detectorTitle: "手部检测器" });
  }
  if (stages.nsfwDetailer) {
    animaStages.push({ key: "nsfw", detector: params.nsfwDetector, params: params.nsfwDetailer, detailerTitle: "NSFW修复", detectorTitle: "NSFW检测器" });
  }
  if (stages.faceDetailer) {
    animaStages.push({ key: "face", detector: params.faceDetector, params: params.faceDetailer, detailerTitle: "脸部修复", detectorTitle: "脸部检测器" });
  }
  if (stages.eyesDetailer) {
    animaStages.push({ key: "eyes", detector: params.eyesDetector, params: params.eyesDetailer, detailerTitle: "眼部修复", detectorTitle: "眼部检测器" });
  }

  if (animaStages.length) {
    const chainInputImage = currentImage;
    // 原工作流里 DifferentialDiffusion 包在 CFGZeroStar 之后，且所有 detailer 都用它的输出
    const diffDiffId = String(nextId++);
    prompt[diffDiffId] = {
      class_type: "DifferentialDiffusion",
      inputs: { strength: 1, model: modelRef },
      _meta: { title: "差异扩散DifferentialDiffusion" },
    };
    const animaDetailerModel: [string, number] = [diffDiffId, 0];

    const chain = appendDetailerChain(prompt, {
      stages: animaStages,
      image: chainInputImage,
      model: animaDetailerModel,
      diffusionModel: animaDetailerModel,
      clip: clipRef,
      vae: vaeRef,
      positive: ["42", 0],
      negative: ["45", 0],
      nextId,
      segsMaskSize: { width: nominalWidth, height: nominalHeight },
      leadingPreviewTitle: stages.hiresFixPre ? "高清放大图像" : "基础生成图像",
      alreadyPreviewedRefs: [chainInputImage],
      preDiffusedModel: true,
    });
    currentImage = chain.image;
    nextId = chain.nextId;
  }

  // ---- 放大②（最终输出前）----
  if (stages.hiresFixPost) {
    const target = animaUpscaleTargetSize(nominalWidth, nominalHeight, params.hires.postPercent);
    const res = insertAnimaUpscale(prompt, nextId, {
      image: currentImage,
      vae: vaeRef,
      modelName: params.hires.modelName,
      rescaleMethod: params.hires.rescaleMethod,
      percent: params.hires.postPercent,
      inputWidth: nominalWidth,
      inputHeight: nominalHeight,
      targetWidth: target.width,
      targetHeight: target.height,
      title: "高清放大②",
      useEasyHiresFix,
      getUpscaleLoaderId,
    });
    nextId = res.nextId;
    currentImage = res.image;
  }

  // ---- 生成结果对比（与「基础解码结果」对比，便于回看放大/修复效果）----
  if (currentImage[0] !== decodedImage[0]) {
    const compareId = String(nextId++);
    prompt[compareId] = {
      class_type: "Image Comparer (rgthree)",
      inputs: { image_a: decodedImage, image_b: currentImage },
      _meta: { title: "生成结果 对比" },
    };
  }

  // ---- 文字绘制（与默认/高修保持同等能力）----
  currentImage = insertDrawTextNode(prompt, params, currentImage, nextId);

  const saveImage = stages.saveImage;
  const prefix = outputPrefix(params.filenamePrefix, "Anima/%date:yyyy-MM-dd%/ComfyUI", params.filenameSuffix);
  if (saveImage) {
    prompt["999_save"] = {
      class_type: "SaveImage",
      inputs: { images: currentImage, filename_prefix: prefix },
      _meta: { title: "保存图像" },
    };
  } else {
    prompt["998_preview"] = {
      class_type: "PreviewImage",
      inputs: { images: currentImage },
      _meta: { title: "预览图像" },
    };
  }

  return prompt;
}

export function appendPositivePrompt<T extends BaseGenerationParams>(params: T, append: string): T {
  return {
    ...params,
    positivePrompt: joinPrompt(params.positivePrompt, append),
  };
}

export function loraStrengthPatch<T extends BaseGenerationParams>(params: T, index: number, strength: number): T {
  if (!params.loras.length || index < 0 || index >= params.loras.length) {
    return params;
  }
  return {
    ...params,
    loras: params.loras.map((lora, i) => i === index ? { ...lora, strength, clipStrength: strength } : lora),
  };
}

export function loraNamePatch<T extends BaseGenerationParams>(params: T, index: number, name: string): T {
  if (!params.loras.length || index < 0 || index >= params.loras.length) {
    return params;
  }
  return {
    ...params,
    loras: params.loras.map((lora, i) => i === index ? { ...lora, name } : lora),
  };
}

export const exposedForTests = {
  loraAwarePrompt,
};

function formatDate(date: Date, format: string) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return format
    .replace(/yyyy/g, String(date.getFullYear()))
    .replace(/yy/g, String(date.getFullYear()).slice(-2))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/dd/g, pad(date.getDate()))
    .replace(/hh/g, pad(date.getHours()))
    .replace(/mm/g, pad(date.getMinutes()))
    .replace(/ss/g, pad(date.getSeconds()));
}
