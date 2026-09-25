import type { TranslationSettings, TranslationProvider } from "./lib/translation";

export type { TranslationSettings, TranslationProvider };

export type MaskHandle = "nw" | "ne" | "sw" | "se";

export type Note = NoteItem;
export type CanvasCharacter = MultiCharacter;

export type ConnectionStatus = "checking" | "online" | "offline" | "error";

export type ConnectionInfo = {
  status: ConnectionStatus;
  version?: string;
  message?: string;
};

export type ComfyPromptNode = {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title: string };
};

export type ComfyPrompt = Record<string, ComfyPromptNode>;

export type LoraSelection = {
  name: string;
  displayName?: string;
  strength: number;
  clipStrength: number;
  active: boolean;
  filePath?: string;
  sha256?: string;
  previewUrl?: string;
  /** XYZ 的 LoRA 替换/追加轴占位标记：记录要替换成/追加的目标模型名（applySpecialXyzPatch 消费） */
  patchName?: string;
};

export type ManagedModelType = "loras" | "embeddings";

export type LoraItem = {
  model_name: string;
  file_name: string;
  folder: string;
  preview_url?: string;
  preview_nsfw_level?: number;
  base_model?: string;
  file_path: string;
  file_size?: number;
  modified?: number;
  sha256?: string;
  tags?: string[];
  auto_tags?: string[];
  favorite?: boolean;
  notes?: string;
  usage_tips?: string;
  from_civitai?: boolean;
  usage_count?: number;
  update_available?: boolean;
  sub_type?: string;
  civitai?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type LoraMediaMeta = Record<string, unknown> & {
  prompt?: string;
  negativePrompt?: string;
  negative_prompt?: string;
  seed?: string | number;
  steps?: string | number;
  sampler?: string;
  cfgScale?: string | number;
  clipSkip?: string | number;
  Size?: string;
  Model?: string;
};

export type LoraExampleMedia = {
  id?: string | number;
  name?: string;
  path?: string;
  url?: string;
  extension?: string;
  is_video?: boolean;
  type?: string;
  width?: number;
  height?: number;
  nsfwLevel?: number;
  meta?: LoraMediaMeta;
  metadata?: Record<string, unknown>;
  hasMeta?: boolean;
  hasPositivePrompt?: boolean;
  source?: string;
};

export type LoraMetadata = {
  id?: number;
  modelId?: number;
  name?: string;
  baseModel?: string;
  description?: string | null;
  trainedWords?: string[];
  images?: LoraExampleMedia[];
  customImages?: LoraExampleMedia[];
  creator?: {
    username?: string;
    image?: string;
  };
  model?: {
    name?: string;
    type?: string;
    nsfw?: boolean;
    description?: string | null;
    tags?: string[];
    allowNoCredit?: boolean;
    allowCommercialUse?: unknown;
    allowDerivatives?: boolean;
    allowDifferentLicense?: boolean;
  };
};

export type ApiResult<T = Record<string, unknown>> = T & {
  success?: boolean;
  error?: string;
  message?: string;
};

export type LoraMetadataResult = {
  success?: boolean;
  metadata?: LoraMetadata;
  error?: string;
};

export type LoraExampleFilesResult = {
  success?: boolean;
  files?: LoraExampleMedia[];
  error?: string;
};

export type ExampleImagesProgress = {
  total: number;
  completed: number;
  current_model: string;
  status: "idle" | "running" | "paused" | "stopping" | "stopped" | "completed" | "error";
  errors?: string[];
  last_error?: string | null;
  start_time?: number | null;
  end_time?: number | null;
  processed_models?: string[];
  refreshed_models?: string[];
  failed_models?: string[];
  reprocessed_models?: string[];
};

export type ExampleImagesStatus = {
  success: boolean;
  is_downloading: boolean;
  is_migrating?: boolean;
  status: ExampleImagesProgress;
  error?: string;
};

export type ExampleImagesStartResult = {
  success: boolean;
  message?: string;
  status?: ExampleImagesProgress;
  result?: unknown;
  error?: string;
};

export type ExampleImagesPendingResult = {
  success: boolean;
  is_downloading?: boolean;
  total_models: number;
  pending_count: number;
  processed_count: number;
  failed_count: number;
  needs_download: boolean;
  message?: string;
  error?: string;
};

export type LoraListResult = {
  items: LoraItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type LoraDuplicateGroup = {
  hash?: string;
  filename?: string;
  models: LoraItem[];
};

export type LoraUpdateVersion = Record<string, unknown> & {
  id?: number;
  modelVersionId?: number;
  model_version_id?: number;
  name?: string;
  createdAt?: string;
  publishedAt?: string;
  baseModel?: string;
  shouldIgnore?: boolean;
  ignored?: boolean;
};

export type LoraUpdateRecord = Record<string, unknown> & {
  model_id?: number;
  modelId?: number;
  current_version_id?: number;
  latest_version_id?: number;
  currentVersionId?: number;
  latestVersionId?: number;
  model_name?: string;
  modelName?: string;
  update_available?: boolean;
  updateAvailable?: boolean;
  should_ignore?: boolean;
  shouldIgnore?: boolean;
  versions?: LoraUpdateVersion[];
};

export type LoraRecipe = Record<string, unknown> & {
  id?: string;
  recipe_id?: string;
  title?: string;
  name?: string;
  file_url?: string;
  file_path?: string;
  prompt?: string;
  negative_prompt?: string;
  tags?: string[];
  loras?: Array<Record<string, unknown>>;
  base_model?: string;
};

export type DoctorDiagnostic = Record<string, unknown> & {
  key?: string;
  label?: string;
  title?: string;
  status?: string;
  severity?: string;
  message?: string;
  details?: unknown;
};

export type DoctorDiagnosticsResult = ApiResult<{
  diagnostics?: DoctorDiagnostic[];
  checks?: DoctorDiagnostic[];
  summary?: Record<string, unknown>;
  bundle_path?: string;
  environment?: Record<string, unknown>;
}>;

export type LoraManagerSettings = Record<string, unknown> & {
  example_images_path?: string;
  lora_roots?: string[];
  lora_syntax_format?: string;
  blur_mature_content?: boolean;
  mature_blur_level?: string;
};

export type DownloadProgress = ApiResult<{
  download_id?: string;
  progress?: number;
  status?: string;
  current_file?: string;
  filename?: string;
  downloaded_bytes?: number;
  total_bytes?: number;
  percent?: number;
}>;

export type LoraQueryState = {
  search: string;
  folder: string;
  baseModel: string;
  tag: string;
  page: number;
  pageSize: number;
};

export type DrawTextParams = {
  enabled: boolean;
  text: string;
  font: string;
  size: number;
  color: string;
  backgroundColor: string;
  width: number;
  height: number;
  maxWidth: number;
  lineSpacing: number;
  letterSpacing: number;
  glowBlur: number;
  glowColor: string;
  shadowDistance: number;
  shadowBlur: number;
  shadowColor: string;
  horizontalAlign: string;
  verticalAlign: string;
  offsetX: number;
  offsetY: number;
  direction: string;
  rotation: number;
  strokeWidth: number;
  strokeColor: string;
  color2: string;
  gradientColors?: string[];
  gradientDirection: "none" | "horizontal" | "vertical" | "diagonal" | "angle";
  gradientAngle?: number;
  layoutDirection: "horizontal" | "vertical";
  decoration: "none" | "underline" | "strikethrough" | "overline" | "underline_overline" | "box" | "both" | "double_underline" | "dotted_underline" | "wave_underline" | "background_box" | "bracket" | "circle" | "rhombus" | "tag" | "dashed_underline" | "rounded_box" | "double_strikethrough" | "parallelogram" | "corners" | "speech_bubble" | "neon_border" | "double_box" | "shadow_box" | "wave_overline" | "bold_underline" | "zigzag_underline" | "dotted_box" | "dashed_box" | "bracket_curly" | "bracket_angle" | "ribbon" | "highlight" | "double_underline_overline" | "stitch" | "comic_bubble" | "capsule" | "wavy_box" | "leaf_box" | "trapezoid" | "star_corners" | "double_ribbon" | "dot_dash_underline" | "bracket_square_bold" | "pill_border" | "cross_out" | "heart_box" | "cloud_bubble" | "dashed_overline" | "double_wave_underline";
  syncWithImage: boolean;
  syncMode?: 'default' | 'multi' | 'highres' | 'manual';
};

/** 图生图的缩放方式：stretch = 拉伸填满（ImageScale.crop=disabled），crop = 缩放裁剪（crop=center） */
export type Img2ImgFit = "stretch" | "crop";

/**
 * 图生图（参考图）参数：默认/多人/高修与 Anima 共用同一类型。
 *
 * 可选字段 `keepProportion` / `cropPosition` 只有 Anima 用（它的缩放节点是 ImageResizeKJv2，
 * 语义与核心 ImageScale 的 `fit` 不同），三个新模板不渲染、不下发。
 * 保留原字段名是刻意的：useLocalStorageState 的 deepMerge 只补新键、不会搬迁旧路径，
 * 改名会让老用户已保存的值静默回落默认。
 */
export type Img2ImgParams = {
  /** 显式开关：关闭时一律按文生图生成，即使已选参考图 */
  enabled: boolean;
  /** 经 client.uploadImage() 上传后的文件名；空 = 未选图 → 回落文生图 */
  imageName: string;
  /** 仅新模板使用：映射到核心 ImageScale 的 crop */
  fit: Img2ImgFit;
  /** 仅新模板使用：ImageScale.upscale_method，取值来自 /object_info */
  upscaleMethod: string;
  /** 仅 Anima（ImageResizeKJv2）使用 */
  keepProportion?: string;
  /** 仅 Anima（ImageResizeKJv2）使用 */
  cropPosition?: string;
  /**
   * 局部重绘遮罩（T12）：上传后的遮罩文件名；空 = 整图重绘。
   * 非空且开关开启时，builder 用 VAEEncodeForInpaint 替代 VAEEncode。
   */
  maskName?: string;
};

export type BaseGenerationParams = {
  checkpoint: string;
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  batchSize: number;
  seed: number;
  randomizeSeed: boolean;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  denoise: number;
  filenamePrefix: string;
  filenameSuffix?: string;
  loras: LoraSelection[];
  drawText?: DrawTextParams;
  /**
   * 图生图（参考图）。可选：既有测试夹具与纯函数调用方可能不带该键，
   * 消费方需判空（与 `drawText?` 同款约定）。应用内由 makeBaseParams() 保证存在。
   */
  img2img?: Img2ImgParams;
};

export type MultiCharacterMask = {
  id: string;
  characterId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  feather: number;
  blend_mode: string;
  zIndex: number;
};

export type MultiCharacter = {
  id: string;
  name: string;
  prompt: string;
  weight: number;
  color: string;
  enabled: boolean;
  position: number;
  mask: MultiCharacterMask;
  syntax_type: string;
  use_mask_syntax: boolean;
  use_fill: boolean;
  feather: number;
};

export type MultiCharacterConfig = {
  version: string;
  syntax_mode: "attention_couple" | "regional_prompts";
  fusion_mode: "mask_overlap" | "latent_fusion";
  base_prompt: string;
  global_prompt: string;
  use_fill: boolean;
  global_use_fill: boolean;
  canvas: {
    width: number;
    height: number;
  };
  characters: MultiCharacter[];
  settings?: Record<string, unknown>;
};

export type MultiGenerationParams = BaseGenerationParams & {
  globalPrompt: string;
  syntaxMode: "attention_couple" | "regional_prompts";
  fusionMode: "mask_overlap" | "latent_fusion";
  useFill: boolean;
  canvasWidth: number;
  canvasHeight: number;
  characters: MultiCharacter[];
};

export type Wd14Params = {
  imageName: string;
  model: string;
  threshold: number;
  characterThreshold: number;
  replaceUnderscore: boolean;
  trailingComma: boolean;
  excludeTags: string;
  device: string;
};

/** WD14 打标参数（不含 imageName，用于手机上传任务） */
export type MobileTaskParams = Pick<
  Wd14Params,
  "model" | "threshold" | "characterThreshold" | "replaceUnderscore" | "trailingComma" | "excludeTags" | "device"
>;

export type MobileTaskStatus = "queued" | "running" | "done" | "error";

export type MobileTask = {
  id: string;
  imageName: string;
  mime: string;
  size: number;
  status: MobileTaskStatus;
  params: MobileTaskParams;
  /** 识别结果（逗号分隔），done 时非空 */
  tags: string;
  error?: string;
  promptId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
};

/** 图片识别面板的 tab 标识 */
export type TaggingTabId = "single" | "cl_single" | "cl_batch" | "wd_batch" | "mobile_sync";

export type ClSingleParams = {
  imageName: string;
  modelName: string;
  general: number;
  character: number;
  replaceSpace: boolean;
  categories: string;
  excludeTags: string;
  sessionMethod: string;
};

export type BatchTaggerParams = {
  imageFolder: string;
  outputFolder: string;
  prependText: string;
  runCount: number;
};

export type ClBatchParams = BatchTaggerParams & {
  modelName: string;
  general: number;
  character: number;
  replaceSpace: boolean;
  categories: string;
  excludeTags: string;
  sessionMethod: string;
};

export type WdBatchParams = BatchTaggerParams & {
  model: string;
  threshold: number;
  characterThreshold: number;
  replaceUnderscore: boolean;
  trailingComma: boolean;
  excludeTags: string;
  device: string;
};

export type HighresVariant =
  | "full"
  | "upscale"
  | "hand"
  | "face"
  | "upscale_hand"
  | "upscale_face"
  | "hand_face";

export type DetailerParams = {
  guideSize: number;
  maxSize: number;
  steps: number;
  cfg: number;
  denoise: number;
  feather: number;
  bboxThreshold: number;
  bboxDilation: number;
  bboxCropFactor: number;
  samplerName: string;
  scheduler: string;
  prompt?: string;
  // 以下为 FaceDetailer / DetailerForEach 的可选输入，Anima 原工作流用到而高修未用。
  // 保持可选且默认 undefined → 不下发，以保证 buildHighresPrompt 输出逐节点不变。
  noiseMaskFeather?: number;
  tiledEncode?: boolean;
  tiledDecode?: boolean;
  inpaintModel?: boolean;
  /** 以下 sam_* / drop_size 在高修里是硬编码值，此处置为可选以便 Anima 对齐原工作流 */
  samDetectionHint?: string;
  samDilation?: number;
  samThreshold?: number;
  samMaskHintThreshold?: number;
  samMaskHintUseNegative?: string;
  dropSize?: number;
};

export type HighresParams = BaseGenerationParams & {
  // Legacy variant, kept for migration
  variant?: HighresVariant;
  enableUpscale: boolean;
  enableSegsDetailer: boolean;
  enableHandDetailer: boolean;
  enableFaceDetailer: boolean;
  enableEyesDetailer: boolean;
  enableNsfwDetailer: boolean;
  upscaleMethod: string;
  scaleBy: number;
  highresSeed: number;
  highresSteps: number;
  highresCfg: number;
  highresDenoise: number;
  syncHighresSeed?: boolean;
  randomizeHighresSeed?: boolean;
  handDetector: string;
  faceDetector: string;
  eyesDetector: string;
  nsfwDetector: string;
  handDetailer: DetailerParams;
  faceDetailer: DetailerParams;
  eyesDetailer: DetailerParams;
  nsfwDetailer: DetailerParams;
  segsDetailer: DetailerParams;
};

/* ------------------------------------------------------------------ *
 * Anima（Qwen-Image 系 · Turbo）模板
 * 字段集刻意与 HighresParams 同构（基础参数 + 5 个 DetailerParams + 4 个检测器），
 * 以便 DetailerControls 与 detailerChain 原样复用。
 * ------------------------------------------------------------------ */

/** 模型栈：UNET + CLIP + VAE 三段式 */
export type AnimaModelStack = {
  unetName: string; // UNETLoader.unet_name
  weightDtype: string; // UNETLoader.weight_dtype，取值取自 /object_info
  clipName: string; // CLIPLoader.clip_name
  clipType: string; // CLIPLoader.type，取值取自 /object_info
  vaeName: string; // VAELoader.vae_name
};

/** 阶段开关的 key；XyzField 的布尔轴模板要用，故独立导出 */
export type AnimaStageKey =
  | "img2img"
  | "cfgZeroStar"
  | "refinePass"
  | "hiresFixPre"
  | "segsDetailer"
  | "handDetailer"
  | "nsfwDetailer"
  | "faceDetailer"
  | "eyesDetailer"
  | "hiresFixPost"
  | "wildcardNode"
  | "saveImage";

/** 12 个阶段开关（初始值 = 「完整复刻」档，除 wildcardNode 外全开） */
export type AnimaStageToggles = Record<AnimaStageKey, boolean>;

/**
 * Anima 的图生图参数已并入共用的 `Img2ImgParams`（它额外用到其中的
 * `keepProportion` / `cropPosition`），此处不再单独定义类型。
 * 注意：`enabled` / `fit` 对 Anima 无意义——Anima 的开关是 `stages.img2img`，
 * 缩放方式由 `keepProportion` 表达；两者都保留是为了形状统一。
 */

export type AnimaHiresParams = {
  modelName: string; // 取自 /object_info，模糊命中 Remacri
  rescaleMethod: string; // 取自 /object_info
  prePercent: number; // 放大①（精修后、detailer 前），直传 easy hiresFix.percent
  postPercent: number; // 放大②（最终输出前），同上
};

/** 二次精修是普通 KSampler，用不着 DetailerParams 的 bbox/guide/feather/prompt 等字段 */
export type AnimaRefineParams = {
  steps: number;
  cfg: number;
  denoise: number;
  samplerName: string;
  scheduler: string;
  /** 是否与基础采样共用 seed（原工作流共用） */
  syncSeedWithBase: boolean;
};

export type AnimaGenerationParams = BaseGenerationParams & {
  /** 收窄为字面量空串：Anima 不用 checkpoint，从类型上杜绝误用与预设校验误报 */
  checkpoint: "";
  modelStack: AnimaModelStack;
  stages: AnimaStageToggles;
  /** 交叉类型下这里会被收窄为必需（Base 上是可选），故 Anima 侧无需可选链 */
  img2img: Img2ImgParams;
  hires: AnimaHiresParams;
  refine: AnimaRefineParams;
  handDetailer: DetailerParams;
  faceDetailer: DetailerParams;
  eyesDetailer: DetailerParams;
  nsfwDetailer: DetailerParams;
  segsDetailer: DetailerParams;
  handDetector: string;
  faceDetector: string;
  eyesDetector: string;
  nsfwDetector: string;
  // 每阶段的追加词直接用各自 DetailerParams.prompt（面板上叫「独立正向提示词」）
};

export type OutputImage = {
  filename: string;
  subfolder?: string;
  type?: string;
  url: string;
  nodeTitle?: string;
};

/**
 * 一次生成任务的展示元信息（仅内存，不落 localStorage、不落服务端）。
 * 用途：输出面板标题从「promptId 前 8 位」换成可辨认的一行摘要。
 * 字段全部可选——WD14/CL 这类打标任务没有尺寸与采样参数。
 */
export type JobMeta = {
  /** 提交时传入的任务名（模板名 / WD1.4 / CL 单图 等） */
  label: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
};

export type JobResult = {
  promptId: string;
  images: OutputImage[];
  texts: string[];
  rawHistory: unknown;
  /** 可选：老调用方与既有测试夹具不传，故必须可选 */
  meta?: JobMeta;
};

export type ProgressBatchState = {
  current: number;
  total: number;
  itemLabel: string;
};

export type ProgressState = {
  running: boolean;
  promptId?: string;
  node?: string | null;
  value: number;
  max: number;
  label: string;
  batch?: ProgressBatchState;
  previewUrl?: string;
  images?: OutputImage[];
  texts?: string[];
};

export type TemplateKind = "default" | "multi" | "highres" | "anima";

export type XyzField =
  | "seed"
  | "steps"
  | "cfg"
  | "width"
  | "height"
  | "samplerName"
  | "scheduler"
  | "denoise"
  | `loraStrength_${number}`
  | `loraName_${number}`
  | `loraAppendName_${number}`
  | `loraAppendStrength_${number}`
  | "positiveAppend"
  | "drawTextText"
  | "drawTextFont"
  | "drawTextSize"
  | "drawTextColor"
  | "drawTextWidth"
  | "drawTextHeight"
  | "drawTextMaxWidth"
  | "drawTextLineSpacing"
  | "drawTextLetterSpacing"
  | "drawTextGlowBlur"
  | "drawTextGlowColor"
  | "drawTextShadowDistance"
  | "drawTextShadowBlur"
  | "drawTextShadowColor"
  | "drawTextHorizontalAlign"
  | "drawTextVerticalAlign"
  | "drawTextOffsetX"
  | "drawTextOffsetY"
  | "drawTextRotation"
  | "drawTextStrokeWidth"
  | "drawTextStrokeColor"
  | "drawTextColor2"
  | "drawTextGradientDirection"
  | "drawTextLayoutDirection"
  | "drawTextDecoration"
  | "drawTextSyncWithImage"
  | "drawTextSyncMode"
  | "drawTextGradientAngle"
  // ---- Anima 专属轴（仅当 xyzTarget === "anima" 时在控制器里列出）----
  | "animaHiresPrePercent"
  | "animaHiresPostPercent"
  | "animaRefineSteps"
  | "animaRefineCfg"
  | "animaRefineDenoise"
  | `animaStage_${AnimaStageKey}`;

export type XyzAxis = {
  enabled: boolean;
  field: XyzField;
  values: string;
};

export type XyzCombination = {
  label: string;
  patch: Partial<BaseGenerationParams>;
  originalIndex?: number;
};

export type Toast = {
  id: string;
  type: "success" | "error" | "info";
  title: string;
  message?: string;
};

export type ResolutionPreset = {
  label: string;
  width: number;
  height: number;
};

export type PathPreset = {
  label: string;
  value: string;
};

/** 外部工具启动器的工具条目（复刻 comfyui-demo-main；icon 为 data URL 或空 = 默认图标） */
export type LauncherTool = {
  id: string;
  name: string;
  path: string;
  args?: string;
  icon?: string;
};

export type NoteItem = {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
  /** 标签（T10-④）：仅内存与 notes.json 持久化，服务端透传存储 */
  tags?: string[];
  /** 附件图（T10-④）：压缩后的 data URL（最长边 400px JPEG），上限 6 张防 notes.json 膨胀 */
  images?: string[];
};

export type GenerationPreset = {
  id: string;
  name: string;
  target: TemplateKind;
  createdAt: number;
  updatedAt: number;
  /** 该模板的完整参数快照（Base/Multi/Highres 之一），回填时整对象替换 */
  snapshot: Record<string, unknown>;
};

export type PromptLintSeverity = "error" | "warning" | "info";

export type PromptLintIssue = {
  code: string;
  severity: PromptLintSeverity;
  message: string;
  start: number;
  end: number;
  fixable: boolean;
  /** 可修复项的修复函数（输入完整文本，返回修复后文本） */
  fix?: (text: string) => string;
};

export type TabId = "default" | "wd14" | "multi" | "text" | "highres" | "xyz" | "loras" | "notes" | "slots" | "anima";

export type LoraPreviewMedia = {
  url?: string;
  path?: string;
  type?: string;
  source?: string;
};

export type OptionsState = {
  checkpoints: string[];
  samplers: string[];
  schedulers: string[];
  wdModels: string[];
  wdDevices: string[];
  clModels: string[];
  detectors: string[];
  upscaleMethods: string[];
  /**
   * 图生图缩放用的 ImageScale.upscale_method。**不可与 upscaleMethods 混用**：
   * 后者取自 LatentUpscaleBy，含 `bislerp` 而无 `lanczos`；ImageScale 恰好相反。
   */
  imageScaleMethods: string[];
  fonts: string[];
  translation: TranslationSettings;
  // ---- Anima: UNET + CLIP + VAE 三段式模型栈 ----
  unets: string[];
  clips: string[];
  clipTypes: string[];
  vaes: string[];
  /** ESRGAN 放大模型列表（UpscaleModelLoader / easy hiresFix 的 model_name） */
  upscaleModels: string[];
  /** Anima 可选能力的探测结果：是否装了原工作流用的第三方节点 */
  animaCaps: {
    useEasyHiresFix: boolean;
    useImageResizeKJv2: boolean;
  };
  /** Anima 链路必需但本机未安装的节点（用于面板顶部提示），空数组表示齐全 */
  animaMissingNodes: string[];
};

export type XyzRunItem = {
  id: string;
  label: string;
  patch: Partial<BaseGenerationParams>;
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  result?: JobResult;
  error?: string;
  comboIndex?: number;
};

export type XyzAxisInsight = {
  fieldLabel: string;
  bestValue: string;
  bestAverage: number;
  averages: Array<{ value: string; average: number; count: number }>;
};

export type XyzCellScore = {
  url: string;
  label: string;
  score: number;
  /** 产生该分数的组合 patch，供「最优组合回填到面板」使用（T8） */
  patch?: Partial<BaseGenerationParams>;
};

export type LoraOperation =
  | { type: "rename"; item: LoraItem }
  | { type: "move"; items: LoraItem[] }
  | { type: "delete"; items: LoraItem[] }
  | { type: "download"; item?: LoraItem }
  | { type: "duplicates" }
  | { type: "updates" }
  | { type: "doctor" }
  | { type: "settings" }
  | { type: "translator" }
  | { type: "notifications" }
  | { type: "civitai"; item: LoraItem };

export type MatureBlurLevel = "PG13" | "R" | "X" | "XXX";

export type CanvasInteraction = {
  id: string;
  mode: "move" | MaskHandle;
  pointerId?: number;
  startX: number;
  startY: number;
  startMask: MultiCharacter["mask"];
  rect: { width: number; height: number };
};

export type FolderTreeNode = {
  name: string;
  path: string;
  children: FolderTreeNode[];
};


