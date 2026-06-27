import type { PathPreset, ResolutionPreset } from "../types";

export const resolutionPresets: ResolutionPreset[] = [
  { label: "512x768", width: 512, height: 768 },
  { label: "768x1024", width: 768, height: 1024 },
  { label: "832x1216", width: 832, height: 1216 },
  { label: "1024x1024", width: 1024, height: 1024 },
  { label: "1024x1344 (最推荐)", width: 1024, height: 1344 },
  { label: "1344x1024 (最推荐-翻转)", width: 1344, height: 1024 },
  { label: "1024x1280 (很好)", width: 1024, height: 1280 },
  { label: "1280x1024 (很好-翻转)", width: 1280, height: 1024 },
  { label: "960x1280 (推荐)", width: 960, height: 1280 },
  { label: "1280x960 (推荐-翻转)", width: 1280, height: 960 },
  { label: "1024x1216 (安全)", width: 1024, height: 1216 },
  { label: "1216x1024 (安全-翻转)", width: 1216, height: 1024 },
  { label: "1024x1536", width: 1024, height: 1536 },
  { label: "1536x1024", width: 1536, height: 1024 },
];

export const pathPresets: PathPreset[] = [
  { label: "日期 / ComfyUI", value: "%date:yyyy-MM-dd%/ComfyUI" },
  { label: "ComfyUI / 日期", value: "ComfyUI/%date:yyyy-MM-dd%" },
  { label: "默认生图 / 日期 / ComfyUI", value: "默认生图/%date:yyyy-MM-dd%/ComfyUI" },
  { label: "双人 / 日期 / ComfyUI", value: "双人/%date:yyyy-MM-dd%/ComfyUI" },
  { label: "多人 / 日期 / ComfyUI", value: "多人/%date:yyyy-MM-dd%/ComfyUI" },
  { label: "高清修复 / 日期 / ComfyUI", value: "高清修复/%date:yyyy-MM-dd%/ComfyUI" },
  { label: "XYZ / 日期 / ComfyUI", value: "XYZ/%date:yyyy-MM-dd%/ComfyUI" },
];

export function resolutionLabel(width: number, height: number) {
  return `${width}x${height}`;
}

export function findResolutionPreset(width: number, height: number) {
  const label = resolutionLabel(width, height);
  return resolutionPresets.find((preset) => preset.label === label)?.label ?? "custom";
}

export function findPathPreset(path: string) {
  return pathPresets.find((preset) => preset.value === path)?.value ?? "custom";
}
