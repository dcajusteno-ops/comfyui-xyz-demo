import type { PathPreset, ResolutionPreset } from "../types";

export const resolutionPresets: ResolutionPreset[] = [
  { label: "512x768", width: 512, height: 768 },
  { label: "768x1024", width: 768, height: 1024 },
  { label: "832x1216", width: 832, height: 1216 },
  { label: "1024x1024", width: 1024, height: 1024 },
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
