/** 命名预设：捕获/套用当前造型台参数。 */
import type { WardrobePreset, WardrobeUiState } from "./types";
import { weightStats } from "./weights";

export function capturePreset(state: WardrobeUiState, name: string): WardrobePreset {
  return {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim().slice(0, 60) || "未命名预设",
    createdAt: Date.now(),
    level: state.level,
    weights: state.weights,
    locks: [...state.locks],
    disabledSections: [...state.disabledSections],
    selectedRoles: [...state.selectedRoles],
    outfitStyle: state.outfitStyle,
    extraBody: state.extraBody,
  };
}

export function applyPresetToState(state: WardrobeUiState, preset: WardrobePreset): WardrobeUiState {
  return {
    ...state,
    level: preset.level,
    weights: preset.weights,
    locks: [...preset.locks],
    disabledSections: [...preset.disabledSections],
    selectedRoles: [...preset.selectedRoles],
    outfitStyle: preset.outfitStyle,
    extraBody: preset.extraBody,
  };
}

export function presetSummary(preset: WardrobePreset): string {
  const stats = weightStats(preset.weights);
  const parts = [`${preset.level.toUpperCase()}`];
  if (stats.total) parts.push(`${stats.total} 项权重`);
  if (preset.locks.length) parts.push(`锁 ${preset.locks.length}`);
  if (preset.selectedRoles.length) parts.push(`${preset.selectedRoles.length} 位角色`);
  return parts.join(" · ");
}
