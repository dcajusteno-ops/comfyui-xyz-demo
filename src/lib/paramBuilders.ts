import { cloneMultiCharacterConfig } from "../data/multiTemplate";
import type { BaseGenerationParams, DetailerParams, HighresParams, MultiGenerationParams } from "../types";
import { fallbackOptions } from "../constants";

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