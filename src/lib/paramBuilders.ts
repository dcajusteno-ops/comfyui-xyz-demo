import { cloneMultiCharacterConfig } from "../data/multiTemplate";
import type {
  AnimaGenerationParams,
  AnimaRefineParams,
  BaseGenerationParams,
  DetailerParams,
  HighresParams,
  MultiGenerationParams,
} from "../types";
import { ANIMA_FULL_STAGES, fallbackOptions } from "../constants";

export function makeBaseParams(checkpoint = fallbackOptions.checkpoints[0]): BaseGenerationParams {
  return {
    checkpoint,
    positivePrompt: "",
    negativePrompt: "",
    width: 832,
    height: 1216,
    batchSize: 1,
    seed: 42,
    randomizeSeed: true,
    steps: 20,
    cfg: 7,
    samplerName: "euler_ancestral",
    scheduler: "simple",
    denoise: 1,
    filenamePrefix: "默认生图/%date:yyyy-MM-dd%/ComfyUI",
    loras: [],
    drawText: {
      enabled: false,
      text: "测试文本",
      font: fallbackOptions.fonts[0] ?? "",
      size: 56,
      color: "#FFFFFF",
      backgroundColor: "#00000000",
      width: 0,
      height: 0,
      maxWidth: 0,
      lineSpacing: 0,
      letterSpacing: 0,
      glowBlur: 0,
      glowColor: "#FFFFFF",
      shadowDistance: 5,
      shadowBlur: 3,
      shadowColor: "#000000",
      rotation: 0,
      strokeWidth: 0,
      strokeColor: "#00000000",
      horizontalAlign: "left",
      verticalAlign: "top",
      offsetX: 0,
      offsetY: 0,
      direction: "ltr",
      color2: "#FFFFFF",
      gradientColors: ["#FFFFFF", "#000000"],
      gradientDirection: "none",
      gradientAngle: 0,
      layoutDirection: "horizontal",
      decoration: "none",
      syncWithImage: true,
    },
  };
}

export function makeMultiParams(checkpoint = fallbackOptions.checkpoints[0]): MultiGenerationParams {
  const template = cloneMultiCharacterConfig();
  return {
    ...makeBaseParams(checkpoint),
    width: 1024,
    height: 1536,
    steps: 25,
    cfg: 5,
    scheduler: "karras",
    filenamePrefix: "多人/%date:yyyy-MM-dd%/ComfyUI",
    globalPrompt: "",
    syntaxMode: "attention_couple",
    fusionMode: "mask_overlap",
    useFill: false,
    canvasWidth: 1024,
    canvasHeight: 1024,
    characters: template.characters,
  };
}

export function makeDetailerParams(denoise: number): DetailerParams {
  return {
    guideSize: 1024,
    maxSize: 1400,
    steps: 20,
    cfg: 7,
    denoise,
    feather: 5,
    bboxThreshold: 0.5,
    bboxDilation: 10,
    bboxCropFactor: 3,
    samplerName: "euler_ancestral",
    scheduler: "simple",
  };
}

export function makeHighresParams(checkpoint = fallbackOptions.checkpoints[0]): HighresParams {
  return {
    ...makeBaseParams(checkpoint),
    filenamePrefix: "高清修复/%date:yyyy-MM-dd%/ComfyUI",
    enableUpscale: true,
    enableSegsDetailer: false,
    enableHandDetailer: false,
    enableFaceDetailer: false,
    enableEyesDetailer: false,
    enableNsfwDetailer: false,
    upscaleMethod: "nearest-exact",
    scaleBy: 1.5,
    highresSeed: 43,
    syncHighresSeed: true,
    randomizeHighresSeed: true,
    highresSteps: 20,
    highresCfg: 8,
    highresDenoise: 0.58,
    handDetector: "bbox/hand_yolov8s.pt",
    faceDetector: "bbox/face_yolov8m.pt",
    eyesDetector: "bbox/Eyeful_v2-Individual.pt",
    nsfwDetector: "segm/ntd11_anime_nsfw_segm_v5-variant1.pt",
    handDetailer: makeDetailerParams(0.38),
    faceDetailer: makeDetailerParams(0.25),
    eyesDetailer: makeDetailerParams(0.24),
    nsfwDetailer: makeDetailerParams(0.3),
    segsDetailer: { ...makeDetailerParams(0.24), steps: 18, cfg: 6, guideSize: 512, maxSize: 1024 },
  };
}

/* ------------------------------------------------------------------ *
 * Anima 模板
 * 取值原则：只固化"参数位"与"拓扑"，不固化"取值"。
 * 下面这些数字只是"首次打开不致空白"的中性起点，全部可在 UI 上改；
 * 枚举型（模型名 / 采样器 / 检测器…）一律由 useOptions 从 /object_info 校正。
 * ------------------------------------------------------------------ */

/** 二次精修采样的默认值（专用小类型，不复用 DetailerParams） */
export function makeAnimaRefineParams(): AnimaRefineParams {
  return {
    steps: 16,
    cfg: 1,
    denoise: 0.2,
    samplerName: "er_sde",
    scheduler: "simple",
    syncSeedWithBase: true,
  };
}

/**
 * Anima 的 detailer 默认值。
 * 全部对齐原工作流 `AnimaBasicV9-2.json` 中 4 个 `FaceDetailerPipe` / `EditDetailerPipe` 的实际取值：
 * guide 512 / max 1536 / 16 步 / cfg 6 / er_sde / feather 16 / bbox_dilation 8 / crop 2.5 /
 * sam_detection_hint none / sam_dilation 4 / drop_size 16 / noise_mask_feather 64。
 * （`refiner_ratio` 已按既定决策不实现——它只存在于 pipe 版节点上。）
 */
export function makeAnimaDetailerParams(
  denoise: number,
  overrides: Partial<DetailerParams> = {},
): DetailerParams {
  return {
    guideSize: 512,
    maxSize: 1536,
    steps: 16,
    cfg: 6,
    denoise,
    feather: 16,
    bboxThreshold: 0.5,
    bboxDilation: 8,
    bboxCropFactor: 2.5,
    samplerName: "er_sde",
    scheduler: "simple",
    noiseMaskFeather: 64,
    tiledEncode: false,
    tiledDecode: false,
    inpaintModel: false,
    samDetectionHint: "none",
    samDilation: 4,
    samThreshold: 0.9,
    samMaskHintThreshold: 0.7,
    samMaskHintUseNegative: "False",
    dropSize: 16,
    ...overrides,
  };
}

export function makeAnimaParams(): AnimaGenerationParams {
  // 注意：必须显式把 checkpoint 置空——makeBaseParams() 默认会带一个 SD 系文件名，
  // 那个值既无意义又会让 PresetBar 的模型存活校验误报（见任务书 §4.2(4)）。
  const base = makeBaseParams("");
  return {
    ...base,
    checkpoint: "",
    positivePrompt: "",
    negativePrompt: "",
    width: 1024,
    height: 1536,
    steps: 8,
    cfg: 1,
    samplerName: "er_sde",
    scheduler: "simple",
    denoise: 1,
    filenamePrefix: "Anima/%date:yyyy-MM-dd%/ComfyUI",
    modelStack: {
      unetName: "",
      weightDtype: "default",
      clipName: "",
      clipType: "stable_diffusion",
      vaeName: "",
    },
    stages: { ...ANIMA_FULL_STAGES },
    img2img: {
      imageName: "",
      keepProportion: "pad_edge",
      upscaleMethod: "nearest-exact",
      cropPosition: "center",
    },
    hires: {
      modelName: "",
      rescaleMethod: "lanczos",
      prePercent: 50,
      postPercent: 50,
    },
    refine: makeAnimaRefineParams(),
    handDetector: "bbox/hand_yolov9c.pt",
    faceDetector: "bbox/face_yolov9c.pt",
    eyesDetector: "bbox/Eyeful_v2-Individual.pt",
    nsfwDetector: "segm/ntd11_anime_nsfw_segm_v5-variant1.pt",
    // 各阶段 denoise / bbox_threshold 按原工作流逐项对齐
    handDetailer: makeAnimaDetailerParams(0.4, { bboxThreshold: 0.5, prompt: "hand, perfect hands" }),
    faceDetailer: makeAnimaDetailerParams(0.26, { bboxThreshold: 0.4, prompt: "{face|face, detailed face}" }),
    eyesDetailer: makeAnimaDetailerParams(0.24, { bboxThreshold: 0.38, prompt: "{eyes|eyes, detailed eyes}" }),
    // NSFW 的 [LAB] 是 Impact 分层语法，前端展开器不认，故按已定决策简化为纯文本
    nsfwDetailer: makeAnimaDetailerParams(0.3, { bboxThreshold: 0.44, prompt: "nsfw" }),
    // 全图 SEGS 单独一套取值：guide 512 / max 1024 / 18 步 / feather 5 / noise_mask_feather 32
    segsDetailer: makeAnimaDetailerParams(0.24, {
      steps: 18,
      cfg: 6,
      guideSize: 512,
      maxSize: 1024,
      feather: 5,
      noiseMaskFeather: 32,
    }),
  };
}
