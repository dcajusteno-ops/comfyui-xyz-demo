import {
  Boxes,
  Dices,
  FileText,
  ImageUp,
  ScanSearch,
  SlidersHorizontal,
  Type,
  UserRound,
  Wand2,
} from "lucide-react";
import type {
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
  fonts: ["default"],
  translation: defaultTranslationSettings,
};

export type TabConfig = { id: TabId; label: string; icon: typeof Wand2 };

export const generationTabs: TabConfig[] = [
  { id: "default", label: "默认生图", icon: Wand2 },
  { id: "multi", label: "多人工作流", icon: UserRound },
  { id: "highres", label: "高清修复", icon: ImageUp },
];

export const toolTabs: TabConfig[] = [
  { id: "wd14", label: "WD1.4", icon: ScanSearch },
  { id: "text", label: "文字特效", icon: Type },
  { id: "xyz", label: "XYZ 控制器", icon: SlidersHorizontal },
  { id: "loras", label: "LoRA 管理", icon: Boxes },
  { id: "notes", label: "记事本", icon: FileText },
];

export const slotsTab: TabConfig = { id: "slots", label: "灵感老虎机", icon: Dices };

export const tabs: TabConfig[] = [...generationTabs, slotsTab, ...toolTabs];

export const templateLabels: Record<TemplateKind, string> = {
  default: "默认生图",
  multi: "多人工作流",
  highres: "高清修复",
};

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