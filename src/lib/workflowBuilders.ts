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
import { buildWd14Workflow } from "./wd14Workflow";

const MAX_SEED = 2 ** 53 - 1;

export function resolveSeed(seed: number, randomizeSeed = false): number {
  if (randomizeSeed || !Number.isFinite(seed)) {
    return Math.floor(Math.random() * MAX_SEED);
  }
  return Math.max(0, Math.floor(seed));
}


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

  const drawTextId = String(nextId++);
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
  };

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
        text: params.negativePrompt || " ",
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
      inputs: samplerInputs(params, ["25", 0], ["2", 0], ["7", 0], ["9", 0]),
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
    "base_vae_decode": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["6", 0],
        vae: ["1", 2],
      },
      _meta: { title: "基础图像解码" },
    },
  };

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

  if (enableHandDetailer || enableFaceDetailer || enableEyesDetailer || enableNsfwDetailer || enableSegsDetailer) {
    const previewId = String(nextId++);
    prompt[previewId] = {
      class_type: "PreviewImage",
      inputs: {
        images: currentImage,
      },
      _meta: { title: enableUpscale ? "高清放大图像" : "基础生成图像" },
    };
  }

  if (enableSegsDetailer) {
    if (currentImage[0] !== "9" && currentImage[0] !== "base_vae_decode") {
      const previewId = String(nextId++);
      prompt[previewId] = { class_type: "PreviewImage", inputs: { images: currentImage }, _meta: { title: "进入全图修复前" } };
    }
    const targetWidth = enableUpscale ? Math.round(params.width * params.scaleBy) : params.width;
    const targetHeight = enableUpscale ? Math.round(params.height * params.scaleBy) : params.height;

    const solidMaskId = String(nextId++);
    prompt[solidMaskId] = {
      class_type: "SolidMask",
      inputs: { value: 1, width: targetWidth, height: targetHeight },
      _meta: { title: "全图蒙版" },
    };

    const maskToSegsId = String(nextId++);
    prompt[maskToSegsId] = {
      class_type: "MaskToSEGS",
      inputs: { combined: false, crop_factor: 1, bbox_fill: false, drop_size: 10, contour_fill: false, mask: [solidMaskId, 0] },
      _meta: { title: "MASK to SEGS" },
    };

    const diffDiffId = String(nextId++);
    prompt[diffDiffId] = {
      class_type: "DifferentialDiffusion",
      inputs: { strength: 1, model: ["2", 0] },
      _meta: { title: "差异扩散" },
    };

    const segsDetailerId = String(nextId++);
    prompt[segsDetailerId] = {
      class_type: "DetailerForEach",
      inputs: {
        guide_size: params.segsDetailer.guideSize,
        guide_size_for: true,
        max_size: params.segsDetailer.maxSize,
        seed: resolveSeed(0, true),
        steps: params.segsDetailer.steps,
        cfg: params.segsDetailer.cfg,
        sampler_name: params.segsDetailer.samplerName,
        scheduler: params.segsDetailer.scheduler,
        denoise: params.segsDetailer.denoise,
        feather: params.segsDetailer.feather,
        noise_mask: true,
        force_inpaint: true,
        wildcard: params.segsDetailer.prompt ?? "",
        cycle: 1,
        inpaint_model: false,
        noise_mask_feather: 32,
        tiled_encode: false,
        tiled_decode: false,
        image: currentImage,
        segs: [maskToSegsId, 0],
        model: [diffDiffId, 0],
        clip: ["2", 1],
        vae: ["1", 2],
        positive: ["3", 0],
        negative: ["4", 0],
      },
      _meta: { title: "全图修复 (SEGS)" },
    };
    currentImage = [segsDetailerId, 0];
  }

  let samModelId: string | null = null;
  const getSamModel = () => {
    if (!samModelId) {
      samModelId = String(nextId++);
      prompt[samModelId] = {
        class_type: "SAMLoader",
        inputs: {
          model_name: "sam_vit_b_01ec64.pth",
          device_mode: "AUTO",
        },
        _meta: { title: "SAM 加载器" },
      };
    }
    return [samModelId, 0] as [string, number];
  };

  if (enableFaceDetailer) {
    if (currentImage[0] !== "9" && currentImage[0] !== "base_vae_decode") {
      const previewId = String(nextId++);
      prompt[previewId] = { class_type: "PreviewImage", inputs: { images: currentImage }, _meta: { title: "进入脸部修复前" } };
    }
    const detectorId = String(nextId++);
    const detailerId = String(nextId++);
    prompt[detectorId] = detectorNode(params.faceDetector, "脸部检测器");
    prompt[detailerId] = faceDetailerNode(params.faceDetailer, currentImage, ["2", 0], ["2", 1], ["1", 2], ["3", 0], ["4", 0], [detectorId, 0], params.faceDetector.includes("segm"), getSamModel(), "脸部修复");
    currentImage = [detailerId, 0];
  }

  if (enableEyesDetailer) {
    if (currentImage[0] !== "9" && currentImage[0] !== "base_vae_decode") {
      const previewId = String(nextId++);
      prompt[previewId] = { class_type: "PreviewImage", inputs: { images: currentImage }, _meta: { title: "进入眼部修复前" } };
    }
    const detectorId = String(nextId++);
    const detailerId = String(nextId++);
    prompt[detectorId] = detectorNode(params.eyesDetector, "眼部检测器");
    prompt[detailerId] = faceDetailerNode(params.eyesDetailer, currentImage, ["2", 0], ["2", 1], ["1", 2], ["3", 0], ["4", 0], [detectorId, 0], params.eyesDetector.includes("segm"), getSamModel(), "眼部修复");
    currentImage = [detailerId, 0];
  }

  if (enableNsfwDetailer) {
    if (currentImage[0] !== "9" && currentImage[0] !== "base_vae_decode") {
      const previewId = String(nextId++);
      prompt[previewId] = { class_type: "PreviewImage", inputs: { images: currentImage }, _meta: { title: "进入NSFW修复前" } };
    }
    const detectorId = String(nextId++);
    const detailerId = String(nextId++);
    prompt[detectorId] = detectorNode(params.nsfwDetector, "NSFW检测器");
    prompt[detailerId] = faceDetailerNode(params.nsfwDetailer, currentImage, ["2", 0], ["2", 1], ["1", 2], ["3", 0], ["4", 0], [detectorId, 0], params.nsfwDetector.includes("segm"), getSamModel(), "NSFW修复");
    currentImage = [detailerId, 0];
  }

  if (enableHandDetailer) {
    if (currentImage[0] !== "9" && currentImage[0] !== "base_vae_decode") {
      const previewId = String(nextId++);
      prompt[previewId] = { class_type: "PreviewImage", inputs: { images: currentImage }, _meta: { title: "进入手部修复前" } };
    }
    const detectorId = String(nextId++);
    const detailerId = String(nextId++);
    prompt[detectorId] = detectorNode(params.handDetector, "手部检测器");
    prompt[detailerId] = faceDetailerNode(params.handDetailer, currentImage, ["2", 0], ["2", 1], ["1", 2], ["3", 0], ["4", 0], [detectorId, 0], params.handDetector.includes("segm"), getSamModel(), "手部修复");
    currentImage = [detailerId, 0];
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
  isSegm: boolean,
  samModel: [string, number] | undefined,
  title: string,
) {
  const inputs: any = {
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
    wildcard: detailer.prompt ?? "",
    cycle: 1,
  };

  if (isSegm) {
    inputs.segm_detector_opt = [detector[0], 1];
  } else if (samModel) {
    inputs.sam_model_opt = samModel;
  }

  return {
    class_type: "FaceDetailer",
    inputs,
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
