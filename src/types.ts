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
  source?: "local" | "civitai" | "custom" | "preview";
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

export type OutputImage = {
  filename: string;
  subfolder?: string;
  type?: string;
  url: string;
  nodeTitle?: string;
};

export type JobResult = {
  promptId: string;
  images: OutputImage[];
  texts: string[];
  rawHistory: unknown;
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

export type TemplateKind = "default" | "multi" | "highres";

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
  | "drawTextFont";

export type XyzAxis = {
  enabled: boolean;
  field: XyzField;
  values: string;
};

export type XyzCombination = {
  label: string;
  patch: Partial<BaseGenerationParams>;
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

export type NoteItem = {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
};
