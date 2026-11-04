import { cloneMultiCharacterConfig } from "../data/multiTemplate";
import type {
  AnimaGenerationParams,
  AnimaRefineParams,
  BaseGenerationParams,
  DatasetAxisConfig,
  DatasetAxisKey,
  DatasetConfig,
  DatasetMode,
  DetailerParams,
  HighresParams,
  Img2ImgParams,
  MultiGenerationParams,
  SheetMode,
  SheetParams,
} from "../types";
import { ANIMA_FULL_STAGES, fallbackOptions } from "../constants";
import {
  SHEET_ANIMA_STAGES,
  SHEET_DEFAULT_NEGATIVE,
  SHEET_DEFAULT_STYLE,
  SHEET_LORAS,
} from "./characterSheet";
import {
  DATASET_ANIMA_STAGES,
  DATASET_AXIS_META,
  DATASET_AXIS_ORDER,
  DATASET_DEFAULT_NEGATIVE,
  DATASET_DEFAULT_POOLS,
  DATASET_DEFAULT_SIZE,
  DATASET_DEFAULT_STYLE,
  DATASET_LEGACY_POOLS_V1,
} from "./dataset/pools";
import { MAX_DATASET_COUNT, MIN_DATASET_COUNT, normalizePool } from "./dataset/plan";

/** 图生图参数的默认值（默认**关闭**，保证既有用户行为零变化） */
export function makeImg2ImgParams(): Img2ImgParams {
  return {
    enabled: false,
    imageName: "",
    fit: "stretch",
    upscaleMethod: "lanczos",
  };
}

/**
 * 三个面板共用的 img2img 更新器：对 `img2img` 做按层合并，字段缺失时用默认值兜底。
 * 泛型让各面板的 `setParams` 保持自己的参数类型（Base / Multi / Highres）。
 */
export function img2imgUpdater<T extends BaseGenerationParams>(patch: Partial<Img2ImgParams>) {
  return (prev: T): T => ({
    ...prev,
    img2img: { ...(prev.img2img ?? makeImg2ImgParams()), ...patch },
  });
}

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
    img2img: makeImg2ImgParams(),
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
      handwriting: {
        enabled: false,
        imageName: "",
        maskName: "",
      },
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
      // Anima 的图生图开关是 stages.img2img；这里的 enabled 只是共用的形状占位
      enabled: true,
      imageName: "",
      // fit 对 Anima 无效（它用 ImageResizeKJv2 的 keepProportion）
      fit: "stretch",
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

/* ------------------------------------------------------------------ *
 * 三视图页
 * ------------------------------------------------------------------ */

/**
 * 深拷贝 Anima 参数（含 5 个 detailer / hires / refine / modelStack）。
 * 三视图与数据集页都要独立于「Anima 生图」页的取值，共享嵌套对象会让两边互相污染。
 */
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
  };
}

/** 深拷贝高清修复参数（SDXL 侧复用同一套 DetailerParams，同样不能共享引用） */
function cloneHighresParams(params: HighresParams): HighresParams {
  return {
    ...params,
    img2img: { ...(params.img2img ?? makeImg2ImgParams()) },
    handDetailer: { ...params.handDetailer },
    faceDetailer: { ...params.faceDetailer },
    eyesDetailer: { ...params.eyesDetailer },
    nsfwDetailer: { ...params.nsfwDetailer },
    segsDetailer: { ...params.segsDetailer },
  };
}

/**
 * 三视图页初始值：模型栈 / checkpoint / 采样参数从现有模板**继承**（首次打开即可用），
 * 但提示词、LoRA、负向、尺寸与阶段一律重置为本页专属取值。
 *
 * SDXL 侧直接拿「高清修复」的参数做骨架（放大方法 / 倍率 / 修复链取值与那边一致），
 * 但**所有修复开关初始关闭**——先出干净图，需要时在页面里打开。
 */
export function makeSheetParams(
  anima: AnimaGenerationParams = makeAnimaParams(),
  sdxl: BaseGenerationParams = makeBaseParams(),
  sdxlFix: HighresParams = makeHighresParams(sdxl.checkpoint),
): SheetParams {
  return {
    mode: "anima",
    subject: "1girl",
    characterPrompt: "",
    style: { ...SHEET_DEFAULT_STYLE },
    reference: { enabled: false, imageName: "" },
    lora: {
      enabled: true,
      weight: { anima: SHEET_LORAS.anima.defaultWeight, sdxl: SHEET_LORAS.sdxl.defaultWeight },
      includeTrigger: true,
      includeBackground: true,
      override: {},
    },
    anima: {
      ...cloneAnimaParams(anima),
      checkpoint: "",
      positivePrompt: "",
      negativePrompt: SHEET_DEFAULT_NEGATIVE.anima,
      width: 1344,
      height: 1024,
      batchSize: 1,
      filenamePrefix: "三视图/%date:yyyy-MM-dd%/ComfyUI",
      loras: [],
      // 三视图默认只做基础采样 + CFGZeroStar，避免「完整复刻」档直接跑到 4096×6144
      stages: { ...SHEET_ANIMA_STAGES },
      img2img: { ...anima.img2img, imageName: "" },
      // 水印/文字层在生成时从「默认生图」借用（imageName 会轮换，不能存快照）
      drawText: undefined,
    },
    sdxl: {
      ...cloneHighresParams(sdxlFix),
      checkpoint: sdxl.checkpoint,
      positivePrompt: "",
      negativePrompt: SHEET_DEFAULT_NEGATIVE.sdxl,
      width: 1344,
      height: 1024,
      batchSize: 1,
      // 基础采样沿用「默认生图」的取值（高清修复模板自己的 20/7 只是它那套的起点）
      seed: sdxl.seed,
      randomizeSeed: sdxl.randomizeSeed,
      steps: sdxl.steps,
      cfg: sdxl.cfg,
      samplerName: sdxl.samplerName,
      scheduler: sdxl.scheduler,
      denoise: sdxl.denoise,
      filenamePrefix: "三视图/%date:yyyy-MM-dd%/ComfyUI",
      loras: [],
      img2img: makeImg2ImgParams(),
      drawText: undefined,
      // 修复开关一律从「关」开始：关着时走纯文生图链路，与之前的行为逐节点一致
      enableUpscale: false,
      enableSegsDetailer: false,
      enableHandDetailer: false,
      enableFaceDetailer: false,
      enableEyesDetailer: false,
      enableNsfwDetailer: false,
    },
  };
}

const SHEET_SUBJECTS: Array<SheetParams["subject"]> = ["1girl", "1boy", "1other", ""];

/**
 * 持久化脏数据兜底：deepMerge 只补新键，修不了枚举错值与 NaN 权重。
 * 只做「不改字段名」的校验，保证历史存档不会被改成默认值。
 */
export function normalizeSheetParams(merged: SheetParams): SheetParams {
  const source = (merged ?? {}) as SheetParams;
  const mode: SheetMode = source.mode === "sdxl" ? "sdxl" : "anima";
  const clampWeight = (value: unknown, fallback: number) => {
    const num = Number(value);
    return Number.isFinite(num) ? Math.min(2, Math.max(0, num)) : fallback;
  };

  return {
    ...source,
    mode,
    subject: SHEET_SUBJECTS.includes(source.subject) ? source.subject : "1girl",
    characterPrompt: String(source.characterPrompt ?? ""),
    style: { ...SHEET_DEFAULT_STYLE, ...(source.style ?? {}) },
    reference: {
      enabled: Boolean(source.reference?.enabled),
      imageName: String(source.reference?.imageName ?? ""),
    },
    lora: {
      enabled: source.lora?.enabled !== false,
      weight: {
        anima: clampWeight(source.lora?.weight?.anima, SHEET_LORAS.anima.defaultWeight),
        sdxl: clampWeight(source.lora?.weight?.sdxl, SHEET_LORAS.sdxl.defaultWeight),
      },
      includeTrigger: source.lora?.includeTrigger !== false,
      includeBackground: source.lora?.includeBackground !== false,
      override: source.lora?.override ?? {},
    },
  };
}

/* ------------------------------------------------------------------ *
 * 角色 LoRA 训练数据集工作台
 * ------------------------------------------------------------------ */

const DATASET_SUBJECTS: Array<DatasetConfig["subject"]> = ["1girl", "1boy", "1other", ""];
/** 固定的默认发牌种子：保证「首次打开 + 重置配置」得到同一份计划 */
const DATASET_PLAN_SEED_DEFAULT = 20260101;

function makeDatasetAxisConfigs(): Record<DatasetAxisKey, DatasetAxisConfig> {
  const out = {} as Record<DatasetAxisKey, DatasetAxisConfig>;
  for (const key of DATASET_AXIS_ORDER) {
    out[key] = {
      enabled: true,
      pool: [...DATASET_DEFAULT_POOLS[key]],
      perItem: DATASET_AXIS_META[key].defaultPerItem,
    };
  }
  return out;
}

/**
 * 数据集页初始值：模型栈 / 采样参数从现有模板**继承**，提示词、LoRA、
 * 尺寸与阶段重置为本页专属值（与 makeSheetParams 同一套思路）。
 *
 * 关键差异：默认尺寸 1024×1024（训练集要求全批同尺寸，方图兼容性最好），
 * 阶段只开 CFGZeroStar + 保存（100 张跑「完整复刻」档不现实）。
 */
export function makeDatasetParams(
  anima: AnimaGenerationParams = makeAnimaParams(),
  sdxl: BaseGenerationParams = makeBaseParams(),
  sdxlFix: HighresParams = makeHighresParams(sdxl.checkpoint),
): DatasetConfig {
  return {
    mode: "anima",
    subject: "1girl",
    characterPrompt: "",
    trigger: "",
    style: { ...DATASET_DEFAULT_STYLE },
    reference: { enabled: false, imageName: "" },
    axes: makeDatasetAxisConfigs(),
    targetCount: 100,
    planSeed: DATASET_PLAN_SEED_DEFAULT,
    seedBase: 1000,
    filenameRoot: "Datasets/dataset",
    caption: { includeTrigger: true, includeCharacter: false, saveTxt: true, saveTxtMode: "caption" },
    anima: {
      ...cloneAnimaParams(anima),
      checkpoint: "",
      positivePrompt: "",
      negativePrompt: DATASET_DEFAULT_NEGATIVE.anima,
      width: DATASET_DEFAULT_SIZE.width,
      height: DATASET_DEFAULT_SIZE.height,
      batchSize: 1,
      filenamePrefix: "Datasets/dataset",
      loras: [],
      stages: { ...DATASET_ANIMA_STAGES },
      img2img: { ...anima.img2img, imageName: "" },
      drawText: undefined,
    },
    sdxl: {
      ...cloneHighresParams(sdxlFix),
      checkpoint: sdxl.checkpoint,
      positivePrompt: "",
      negativePrompt: DATASET_DEFAULT_NEGATIVE.sdxl,
      width: DATASET_DEFAULT_SIZE.width,
      height: DATASET_DEFAULT_SIZE.height,
      batchSize: 1,
      seed: sdxl.seed,
      randomizeSeed: sdxl.randomizeSeed,
      highresSeed: sdxl.seed,
      randomizeHighresSeed: false,
      steps: sdxl.steps,
      cfg: sdxl.cfg,
      samplerName: sdxl.samplerName,
      scheduler: sdxl.scheduler,
      denoise: sdxl.denoise,
      filenamePrefix: "Datasets/dataset",
      loras: [],
      img2img: makeImg2ImgParams(),
      drawText: undefined,
      enableUpscale: false,
      enableSegsDetailer: false,
      enableHandDetailer: false,
      enableFaceDetailer: false,
      enableEyesDetailer: false,
      enableNsfwDetailer: false,
    },
  };
}

/**
 * 持久化脏数据兜底。注意 `deepMerge` 对数组是**整体替换**，
 * 所以这里必须逐字段重建（尤其是 axes 与 caption），不能依赖默认值合并。
 */
export function normalizeDatasetParams(merged: DatasetConfig): DatasetConfig {
  const source = (merged ?? {}) as DatasetConfig;
  const mode: DatasetMode = source.mode === "sdxl" ? "sdxl" : "anima";
  const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
    const num = Math.trunc(Number(value));
    return Number.isFinite(num) ? Math.min(max, Math.max(min, num)) : fallback;
  };

  const rawAxes = (source.axes ?? {}) as Partial<Record<DatasetAxisKey, DatasetAxisConfig>>;
  const axes = {} as Record<DatasetAxisKey, DatasetAxisConfig>;
  for (const key of DATASET_AXIS_ORDER) {
    const meta = DATASET_AXIS_META[key];
    const raw = rawAxes[key];
    const rawPool = Array.isArray(raw?.pool)
      ? raw!.pool.map((tag) => String(tag ?? "")).filter((tag) => tag.trim().length > 0)
      : null;
    // 词池扩容迁移：只有「与旧内置池逐字相同」的轴才换成新池，用户删改过的一律保留
    let pool: string[];
    if (!rawPool) {
      pool = [...DATASET_DEFAULT_POOLS[key]];
    } else {
      const legacy = normalizePool(DATASET_LEGACY_POOLS_V1[key]);
      const untouched =
        rawPool.length === legacy.length && normalizePool(rawPool).join("\u0001") === legacy.join("\u0001");
      pool = untouched ? [...DATASET_DEFAULT_POOLS[key]] : rawPool;
    }
    axes[key] = {
      enabled: raw?.enabled !== false,
      pool,
      perItem: clampInt(raw?.perItem, 0, meta.maxPerItem, meta.defaultPerItem),
    };
  }

  return {
    ...source,
    mode,
    subject: DATASET_SUBJECTS.includes(source.subject) ? source.subject : "1girl",
    characterPrompt: String(source.characterPrompt ?? ""),
    trigger: String(source.trigger ?? ""),
    style: { ...DATASET_DEFAULT_STYLE, ...(source.style ?? {}) },
    reference: {
      enabled: Boolean(source.reference?.enabled),
      imageName: String(source.reference?.imageName ?? ""),
    },
    axes,
    targetCount: clampInt(source.targetCount, MIN_DATASET_COUNT, MAX_DATASET_COUNT, 100),
    planSeed: clampInt(source.planSeed, 0, 0x7fffffff, DATASET_PLAN_SEED_DEFAULT),
    seedBase: clampInt(source.seedBase, 0, 0x7fffffff, 1000),
    filenameRoot: String(source.filenameRoot ?? "").replace(/[\\/]+$/, ""),
    caption: {
      includeTrigger: source.caption?.includeTrigger !== false,
      includeCharacter: source.caption?.includeCharacter === true,
      saveTxt: source.caption?.saveTxt !== false,
      saveTxtMode: source.caption?.saveTxtMode === "prompt" ? "prompt" : "caption",
    },
  };
}
