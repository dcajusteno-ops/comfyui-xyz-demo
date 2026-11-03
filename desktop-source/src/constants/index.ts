import {
  Blocks,
  Boxes,
  Columns3,
  Disc3,
  FileText,
  ImageUp,
  LibraryBig,
  ScanSearch,
  Shirt,
  SlidersHorizontal,
  Sparkles,
  Type,
  UserRound,
  Wand2,
} from "lucide-react";
import type {
  AnimaStageKey,
  AnimaStageToggles,
  LoraInsertTarget,
  LoraListResult,
  LoraManagerSettings,
  LoraQueryState,
  ManagedModelType,
  MatureBlurLevel,
  OptionsState,
  TabId,
  TemplateKind,
} from "../types";
import { defaultTranslationSettings } from "../lib/translation";

export const fallbackOptions: OptionsState = {
  checkpoints: ["anything-v5-PrtRE.safetensors"],
  samplers: ["euler_ancestral", "euler", "dpmpp_2m"],
  schedulers: ["simple", "karras", "normal"],
  wdModels: ["wd-v1-4-moat-tagger-v2"],
  wdDevices: ["GPU", "CPU"],
  clModels: ["cl_tagger/cl_tagger_1_02.onnx"],
  detectors: ["bbox/hand_yolov8s.pt", "bbox/face_yolov8m.pt"],
  upscaleMethods: ["nearest-exact", "bilinear", "bicubic"],
  // 图生图缩放用：ImageScale 独有 lanczos（LatentUpscaleBy 的 bislerp 对 ImageScale 非法）
  imageScaleMethods: ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"],
  fonts: ["default"],
  translation: defaultTranslationSettings,
  unets: [],
  clips: [],
  clipTypes: ["stable_diffusion"],
  vaes: [],
  upscaleModels: [],
  animaCaps: { useEasyHiresFix: true, useImageResizeKJv2: true },
  animaMissingNodes: [],
};

export type TabConfig = { id: TabId; label: string; icon: typeof Wand2 };

/**
 * 侧边栏「生图模板」组。
 * 注意：此处是 tab 定义的**唯一来源**，App.tsx 必须引用本数组，
 * 不得再在组件内另起一份硬编码列表（历史上正是因此漏掉了新入口）。
 */
export const generationTabs: TabConfig[] = [
  { id: "default", label: "默认生图", icon: Wand2 },
  { id: "multi", label: "多人工作流", icon: UserRound },
  { id: "highres", label: "高清修复", icon: ImageUp },
  { id: "anima", label: "Anima 生图", icon: Sparkles },
  // 三视图紧随 Anima：它本质是 Anima / SDXL 两条模型族的专项模板
  { id: "sheet", label: "三视图", icon: Columns3 },
  { id: "wd14", label: "WD1.4", icon: ScanSearch },
  { id: "text", label: "文字特效", icon: Type },
  { id: "xyz", label: "XYZ 控制器", icon: SlidersHorizontal },
];

/** 侧边栏「工具组件」组 */
export const toolTabs: TabConfig[] = [
  { id: "loras", label: "LoRA 管理", icon: Boxes },
  // 该组从第 10 项起本来就不在数字键 1-9 的覆盖范围，插在记事本前不影响既有快捷键
  { id: "anima-library", label: "Anima 词库", icon: LibraryBig },
  { id: "wardrobe", label: "Anima 造型台", icon: Shirt },
  // 独立公共工作台：词库与造型台的词在这里合流（不是嵌在两边页面里）
  { id: "workbench", label: "Anima 工作台", icon: Blocks },
  { id: "notes", label: "记事本", icon: FileText },
];

/** 幸运大转盘：单独导出以标记其不属于生成模板（显示上归入「工具」组） */
export const slotsTab: TabConfig = { id: "slots", label: "幸运大转盘", icon: Disc3 };

/** 全部 tab，用于 `?tab=` 参数校验与非法值回落 */
export const tabs: TabConfig[] = [...generationTabs, slotsTab, ...toolTabs];

/** 侧边栏分组（只管**显示**；数字键 1–9 仍按 generationTabs + slotsTab + toolTabs 的旧顺序，见 App 的 digitTabs） */
export type NavGroup = {
  id: string;
  label: string;
  /** 该组页签可整体折叠 */
  foldable: true;
  /** Anima 工坊：条目带同族小圆点标记 */
  accent?: boolean;
  tabs: TabConfig[];
};

const pick = (list: TabConfig[], ids: TabId[]): TabConfig[] =>
  ids.map((id) => {
    const found = list.find((tab) => tab.id === id);
    if (!found) throw new Error(`navGroups 引用了不存在的 tab：${id}`);
    return found;
  });

export const navGroups: NavGroup[] = [
  {
    id: "generate",
    label: "生成",
    foldable: true,
    tabs: pick(generationTabs, ["default", "multi", "highres", "anima", "sheet"]),
  },
  {
    id: "anima",
    label: "Anima 工坊",
    foldable: true,
    // 选词（词库）→ 造型（造型台）→ 合流（工作台），同族功能放一组
    accent: true,
    tabs: pick(toolTabs, ["anima-library", "wardrobe", "workbench"]),
  },
  {
    id: "tools",
    label: "工具",
    foldable: true,
    tabs: [...pick(generationTabs, ["wd14", "text", "xyz"]), slotsTab, ...pick(toolTabs, ["loras", "notes"])],
  },
];

export const templateLabels: Record<TemplateKind, string> = {
  default: "默认生图",
  multi: "多人工作流",
  highres: "高清修复",
  anima: "Anima 生图",
};

/**
 * LoRA 插入目标的展示名：模板 + 三视图页。
 * 凡是可能收到 `LoraInsertTarget` 的文案都必须走这张表——`templateLabels[target]`
 * 在 target 为 "sheet" 时会取到 undefined。
 */
export const loraInsertTargetLabels: Record<LoraInsertTarget, string> = {
  ...templateLabels,
  sheet: "三视图",
};

/** 三视图页主体词选项 */
export const sheetSubjectOptions: Array<{ value: "" | "1girl" | "1boy" | "1other"; label: string }> = [
  { value: "1girl", label: "1girl（单人女性）" },
  { value: "1boy", label: "1boy（单人男性）" },
  { value: "1other", label: "1other（无性别/其它）" },
  { value: "", label: "不指定" },
];

/* ------------------------------------------------------------------ *
 * Anima 模板常量
 * ------------------------------------------------------------------ */

/**
 * 各阶段相对「基础采样 = 1.0」的工程量级估算，仅用于面板展示与档位排序。
 * 注意 ComfyUI 在 denoise < 1 时只执行 steps × denoise 步，所以"精修 16 步"实际约 3 步。
 * M5 基准实测后只校准这张表，逻辑不变。
 */
export const ANIMA_STAGE_COST: Record<AnimaStageKey, number> = {
  img2img: 0.05,
  cfgZeroStar: 0,
  refinePass: 0.4,
  hiresFixPre: 0.2,
  segsDetailer: 2.2,
  handDetailer: 0.15,
  nsfwDetailer: 0.15,
  faceDetailer: 0.15,
  eyesDetailer: 0.15,
  hiresFixPost: 0.8,
  wildcardNode: 0,
  saveImage: 0,
};

/**
 * 放大模型的标称倍率，**仅用于「输出预览条」估算分辨率**。
 * 生成时 percent 是直传给 easy hiresFix 的（不做换算），因此本常量标定有偏差也不会影响出图。
 */
export const ANIMA_UPSCALE_MODEL_SCALE = 4;

/** 预计输出长边超过该值时，输出预览条转为预警态（不阻断生成） */
export const ANIMA_RESOLUTION_WARN_EDGE = 3000;

/** Anima 阶段开关的初始值 = 「完整复刻」档（1:1 对齐原工作流的阶段组合） */
export const ANIMA_FULL_STAGES: AnimaStageToggles = {
  img2img: true,
  cfgZeroStar: true,
  refinePass: true,
  hiresFixPre: true,
  segsDetailer: true,
  handDetailer: true,
  nsfwDetailer: true,
  faceDetailer: true,
  eyesDetailer: true,
  hiresFixPost: true,
  wildcardNode: false,
  saveImage: true,
};

export type AnimaPresetId = "full" | "refine" | "standard" | "turbo";

/** 档位预设：切换只改阶段开关，不动提示词 / 种子 / LoRA / 各项参数 */
export const ANIMA_STAGE_PRESETS: Record<AnimaPresetId, AnimaStageToggles> = {
  full: { ...ANIMA_FULL_STAGES },
  refine: { ...ANIMA_FULL_STAGES, img2img: false, nsfwDetailer: false },
  standard: {
    img2img: false,
    cfgZeroStar: true,
    refinePass: true,
    hiresFixPre: false,
    segsDetailer: false,
    handDetailer: true,
    nsfwDetailer: false,
    faceDetailer: true,
    eyesDetailer: true,
    hiresFixPost: true,
    wildcardNode: false,
    saveImage: true,
  },
  turbo: {
    img2img: false,
    cfgZeroStar: true,
    refinePass: false,
    hiresFixPre: false,
    segsDetailer: false,
    handDetailer: false,
    nsfwDetailer: false,
    faceDetailer: false,
    eyesDetailer: false,
    hiresFixPost: true,
    wildcardNode: false,
    saveImage: true,
  },
};

export const animaPresetLabels: Array<{ id: AnimaPresetId | "custom"; label: string; hint: string }> = [
  { id: "full", label: "完整复刻", hint: "阶段全开，1:1 对齐原工作流结构（输出可能到 4096×6144）" },
  { id: "refine", label: "精修", hint: "完整复刻去掉 NSFW 修复与图生图" },
  { id: "standard", label: "标准", hint: "基础 + 二次精修 + 手/脸/眼 + 放大②，输出约 2048×3072" },
  { id: "turbo", label: "极速直出", hint: "基础采样 + 放大②，适合试词、扫种子与 XYZ 批量" },
  { id: "custom", label: "自定义", hint: "手动勾选阶段开关" },
];

/** 各阶段开关的展示标签与次序（UI 顺序固定；生成顺序另见 builder） */
export const animaStageMeta: Array<{ key: AnimaStageKey; label: string }> = [
  { key: "img2img", label: "图生图" },
  { key: "cfgZeroStar", label: "CFGZeroStar" },
  { key: "refinePass", label: "二次精修" },
  { key: "hiresFixPre", label: "放大①" },
  { key: "segsDetailer", label: "全图修复" },
  { key: "handDetailer", label: "手部修复" },
  { key: "faceDetailer", label: "脸部修复" },
  { key: "eyesDetailer", label: "眼部修复" },
  { key: "nsfwDetailer", label: "NSFW修复" },
  { key: "hiresFixPost", label: "放大②" },
  { key: "wildcardNode", label: "通配符节点" },
  { key: "saveImage", label: "保存图像" },
];

/** 判断一组开关属于哪个档位（用于档位下拉的选中态） */
export function matchAnimaPreset(stages: AnimaStageToggles): AnimaPresetId | "custom" {
  const ids: AnimaPresetId[] = ["full", "refine", "standard", "turbo"];
  for (const id of ids) {
    const preset = ANIMA_STAGE_PRESETS[id];
    if (animaStageMeta.every(({ key }) => preset[key] === stages[key])) return id;
  }
  return "custom";
}

export const defaultLoraQuery: LoraQueryState = {
  search: "",
  folder: "",
  baseModel: "",
  tag: "",
  page: 1,
  pageSize: 48,
};

export const emptyLoraResult: LoraListResult = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 48,
  totalPages: 1,
};

export const NSFW_LEVELS = {
  UNKNOWN: 0,
  PG: 1,
  PG13: 2,
  R: 4,
  X: 8,
  XXX: 16,
  BLOCKED: 32,
} as const;

export const validMatureBlurLevels: MatureBlurLevel[] = ["PG13", "R", "X", "XXX"];

export const defaultLoraManagerSettings: LoraManagerSettings = {
  blur_mature_content: true,
  mature_blur_level: "R",
};

export function managedModelLabel(modelType: ManagedModelType) {
  return modelType === "embeddings" ? "Embedding" : "LoRA";
}

export function managedModelExampleType(modelType: ManagedModelType) {
  return modelType === "embeddings" ? "embedding" : "lora";
}