import type {
  BaseGenerationParams,
  ComfyPrompt,
  DetailerParams,
  HighresParams,
  HighresVariant,
  LoraSelection,
  MultiGenerationParams,
  Wd14Params,
  ClBatchParams,
  WdBatchParams,
  ClSingleParams,
} from "../types";

const MAX_SEED = 2 ** 53 - 1;

export function resolveSeed(seed: number, randomizeSeed = false): number {
  if (randomizeSeed || !Number.isFinite(seed)) {
    return Math.floor(Math.random() * MAX_SEED);
  }
  return Math.max(0, Math.floor(seed));
}

export function buildLoraSyntax(loras: LoraSelection[]): string {
  return loras
    .filter((lora) => lora.active && lora.name.trim())
    .map((lora) => `<lora:${lora.name.trim()}:${formatStrength(lora.strength)}>`)
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

function loraAwarePrompt(params: BaseGenerationParams) {
  return joinPrompt(buildLoraSyntax(params.loras), params.positivePrompt);
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

export function buildDefaultPrompt(params: BaseGenerationParams): ComfyPrompt {
  return {
    ...baseCheckpoint(params),
    "2": {
      class_type: "Lora Loader (LoraManager)",
      inputs: {
        model: ["1", 0],
        clip: ["1", 1],
        text: buildLoraSyntax(params.loras),
        loras: params.loras
          .filter((l) => l.active)
          .map((l) => ({
            name: l.name,
            strength: l.strength,
            clipStrength: l.clipStrength ?? l.strength,
            active: true,
          })),
      },
      _meta: { title: "Lora Loader (LoraManager)" },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["2", 1],
        text: params.positivePrompt,
      },
      _meta: { title: "正向提示词" },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["2", 1],
        text: params.negativePrompt,
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
      inputs: samplerInputs(params, ["2", 0], ["3", 0], ["4", 0], ["5", 0]),
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
    "8": {
      class_type: "SaveImage",
      inputs: {
        images: ["7", 0],
        filename_prefix: outputPrefix(params.filenamePrefix, "%date:yyyy-MM-dd%/ComfyUI", params.filenameSuffix),
      },
      _meta: { title: "Save Image" },
    },
  };
}

export function buildWd14Prompt(params: Wd14Params): ComfyPrompt {
  return {
    "1": {
      class_type: "LoadImage",
      inputs: {
        image: params.imageName,
      },
      _meta: { title: "Load Image" },
    },
    "2": {
      class_type: "WD14Tagger|pysssss",
      inputs: {
        image: ["1", 0],
        model: params.model,
        threshold: params.threshold,
        character_threshold: params.characterThreshold,
        replace_underscore: params.replaceUnderscore,
        trailing_comma: params.trailingComma,
        exclude_tags: params.excludeTags,
        device: params.device,
      },
      _meta: { title: "WD14 Tagger" },
    },
  };
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
      inputs: {
        image: ["15", 0],
        model: params.model,
        threshold: params.threshold,
        character_threshold: params.characterThreshold,
        replace_underscore: params.replaceUnderscore,
        trailing_comma: params.trailingComma,
        exclude_tags: params.excludeTags,
        device: params.device,
      },
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
  const mceConfig = {
    version: "1.1.0",
    syntax_mode: params.syntaxMode,
    base_prompt: "",
    global_prompt: joinPrompt(buildLoraSyntax(params.loras), params.globalPrompt),
    use_fill: params.useFill,
    global_use_fill: false,
    canvas: {
      width: params.canvasWidth,
      height: params.canvasHeight,
    },
    characters: params.characters,
    settings: {
      language: "zh-CN",
      theme: {
        primaryColor: "#743795",
        backgroundColor: "#2a2a2a",
        secondaryColor: "#333333",
      },
    },
  };

  return {
    ...baseCheckpoint(params),
    "2": {
      class_type: "MultiCharacterEditorNode",
      inputs: {
        base_prompt: "",
        syntax_mode: params.syntaxMode,
        use_fill: params.useFill,
        mce_config: JSON.stringify(mceConfig, null, 2),
        canvas_width: params.canvasWidth,
        canvas_height: params.canvasHeight,
      },
      _meta: { title: "多角色编辑器" },
    },
    "3": {
      class_type: "PCLazyLoraLoader",
      inputs: {
        text: ["2", 0],
        model: ["1", 0],
        clip: ["1", 1],
      },
      _meta: { title: "PC: Schedule LoRAs" },
    },
    "4": {
      class_type: "PCLazyTextEncode",
      inputs: {
        clip: ["3", 1],
        text: ["2", 0],
      },
      _meta: { title: "PC: Schedule Prompt (positive)" },
    },
    "5": {
      class_type: "PCLazyTextEncode",
      inputs: {
        clip: ["3", 1],
        text: params.negativePrompt,
      },
      _meta: { title: "PC: Schedule Prompt (negative)" },
    },
    "6": {
      class_type: "ResolutionMasterSimplify",
      inputs: {
        width: params.width,
        height: params.height,
      },
      _meta: { title: "Resolution Master Simplify" },
    },
    "7": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: ["6", 0],
        height: ["6", 1],
        batch_size: params.batchSize,
      },
      _meta: { title: "空 Latent" },
    },
    "8": {
      class_type: "KSampler",
      inputs: samplerInputs(params, ["3", 0], ["4", 0], ["5", 0], ["7", 0]),
      _meta: { title: "KSampler" },
    },
    "9": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["8", 0],
        vae: ["1", 2],
      },
      _meta: { title: "VAE Decode" },
    },
    "10": {
      class_type: "SaveImage",
      inputs: {
        images: ["9", 0],
        filename_prefix: outputPrefix(params.filenamePrefix, "多人/%date:yyyy-MM-dd%/ComfyUI", params.filenameSuffix),
      },
      _meta: { title: "Save Image" },
    },
  };
}

export function buildHighresPrompt(params: HighresParams): ComfyPrompt {
  const baseResolvedSeed = resolveSeed(params.seed, params.randomizeSeed);
  const highresResolvedSeed = (params.syncHighresSeed ?? true) ? baseResolvedSeed : resolveSeed(params.highresSeed, params.randomizeHighresSeed ?? true);

  const prompt: ComfyPrompt = {
    ...baseCheckpoint(params),
    "2": {
      class_type: "Lora Loader (LoraManager)",
      inputs: {
        model: ["1", 0],
        clip: ["1", 1],
        text: buildLoraSyntax(params.loras),
        loras: params.loras
          .filter((l) => l.active)
          .map((l) => ({
            name: l.name,
            strength: l.strength,
            clipStrength: l.clipStrength ?? l.strength,
            active: true,
          })),
      },
      _meta: { title: "Lora Loader (LoraManager)" },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["2", 1],
        text: params.positivePrompt,
      },
      _meta: { title: "正向提示词" },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["2", 1],
        text: params.negativePrompt,
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
    "7": {
      class_type: "LatentUpscaleBy",
      inputs: {
        samples: ["6", 0],
        upscale_method: params.upscaleMethod,
        scale_by: params.scaleBy,
      },
      _meta: { title: "Latent 高清放大" },
    },
    "8": {
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
    },
    "base_vae_decode": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["6", 0],
        vae: ["1", 2],
      },
      _meta: { title: "基础图像解码" },
    },
    "base_preview": {
      class_type: "PreviewImage",
      inputs: {
        images: ["base_vae_decode", 0],
      },
      _meta: { title: "基础图像" },
    },
    "9": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["8", 0],
        vae: ["1", 2],
      },
      _meta: { title: "高清修复 VAE Decode" },
    },
  };

  let currentImage: [string, number] = ["9", 0];
  let nextId = 10;

  if (needsHandDetailer(params.variant) || needsFaceDetailer(params.variant)) {
    const previewId = String(nextId++);
    prompt[previewId] = {
      class_type: "PreviewImage",
      inputs: {
        images: currentImage,
      },
      _meta: { title: "高清放大图像" },
    };
  }

  if (needsHandDetailer(params.variant)) {
    const detectorId = String(nextId++);
    const detailerId = String(nextId++);
    prompt[detectorId] = detectorNode(params.handDetector, "手部检测器");
    prompt[detailerId] = faceDetailerNode(params.handDetailer, currentImage, ["2", 0], ["2", 1], ["1", 2], ["3", 0], ["4", 0], [detectorId, 0], "手部修复");
    currentImage = [detailerId, 0];
  }

  if (needsFaceDetailer(params.variant)) {
    if (needsHandDetailer(params.variant)) {
      const previewId = String(nextId++);
      prompt[previewId] = {
        class_type: "PreviewImage",
        inputs: {
          images: currentImage,
        },
        _meta: { title: "手部修复后" },
      };
    }
    const detectorId = String(nextId++);
    const detailerId = String(nextId++);
    prompt[detectorId] = detectorNode(params.faceDetector, "脸部检测器");
    prompt[detailerId] = faceDetailerNode(params.faceDetailer, currentImage, ["2", 0], ["2", 1], ["1", 2], ["3", 0], ["4", 0], [detectorId, 0], "脸部修复");
    currentImage = [detailerId, 0];
  }

  const compareNodeId = String(nextId++);
  prompt[compareNodeId] = {
    class_type: "Image Comparer (rgthree)",
    inputs: {
      image_a: ["base_vae_decode", 0],
      image_b: currentImage,
    },
    _meta: { title: "高清放大/脸手修复 图像对比" },
  };

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

function needsHandDetailer(variant: HighresVariant) {
  return variant === "full" || variant === "hand" || variant === "upscale_hand" || variant === "hand_face";
}

function needsFaceDetailer(variant: HighresVariant) {
  return variant === "full" || variant === "face" || variant === "upscale_face" || variant === "hand_face";
}

function detectorNode(modelName: string, title: string) {
  return {
    class_type: "UltralyticsDetectorProvider",
    inputs: {
      model_name: modelName,
    },
    _meta: { title },
  };
}

function faceDetailerNode(
  detailer: DetailerParams,
  image: [string, number],
  model: [string, number],
  clip: [string, number],
  vae: [string, number],
  positive: [string, number],
  negative: [string, number],
  detector: [string, number],
  title: string,
) {
  return {
    class_type: "FaceDetailer",
    inputs: {
      image,
      model,
      clip,
      vae,
      guide_size: detailer.guideSize,
      guide_size_for: true,
      max_size: detailer.maxSize,
      seed: resolveSeed(0, true),
      steps: detailer.steps,
      cfg: detailer.cfg,
      sampler_name: detailer.samplerName,
      scheduler: detailer.scheduler,
      positive,
      negative,
      denoise: detailer.denoise,
      feather: detailer.feather,
      noise_mask: true,
      force_inpaint: true,
      bbox_threshold: detailer.bboxThreshold,
      bbox_dilation: detailer.bboxDilation,
      bbox_crop_factor: detailer.bboxCropFactor,
      sam_detection_hint: "center-1",
      sam_dilation: 0,
      sam_threshold: 0.93,
      sam_bbox_expansion: 0,
      sam_mask_hint_threshold: 0.7,
      sam_mask_hint_use_negative: "False",
      drop_size: 10,
      bbox_detector: detector,
      wildcard: "",
      cycle: 1,
    },
    _meta: { title },
  };
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
    loras: params.loras.map((lora, i) => i === index ? { ...lora, strength } : lora),
  };
}

export const exposedForTests = {
  loraAwarePrompt,
  needsFaceDetailer,
  needsHandDetailer,
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
