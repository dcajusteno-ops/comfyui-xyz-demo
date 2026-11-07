/**
 * 造型台状态的不可变更新辅助。
 *
 * 组件里只调这些函数，避免十几处手写 `{...prev, weights: {...prev.weights, ...}}`
 * 时漏层——`weights` 有三层，漏一层就会静默写到旧对象上。
 */
import type { WardrobeUiState } from "./types";
import { WARDROBE_SECTION_IDS } from "./persist";

export function setLevel(state: WardrobeUiState, level: WardrobeUiState["level"]): WardrobeUiState {
  return { ...state, level };
}

export function setSectionWeight(state: WardrobeUiState, sectionId: string, weight: number): WardrobeUiState {
  return {
    ...state,
    weights: { ...state.weights, sections: { ...state.weights.sections, [sectionId]: weight } },
  };
}

export function setFieldWeight(state: WardrobeUiState, fieldKey: string, weight: number): WardrobeUiState {
  return {
    ...state,
    weights: { ...state.weights, fields: { ...state.weights.fields, [fieldKey]: weight } },
  };
}

export function setOptionWeight(
  state: WardrobeUiState,
  fieldKey: string,
  en: string,
  weight: number,
): WardrobeUiState {
  const key = en.trim().toLowerCase();
  const bag: Record<string, number> = { ...(state.weights.options[fieldKey] ?? {}), [key]: weight };
  // v5.0.1：同一字段只允许一个「必现」（权重 3）；点第二个 3 时把之前的降为 1
  if (weight >= 3) {
    for (const other of Object.keys(bag)) {
      if (other !== key && bag[other] >= 3) bag[other] = 1;
    }
  }
  return {
    ...state,
    weights: {
      ...state.weights,
      options: { ...state.weights.options, [fieldKey]: bag },
    },
  };
}

export function toggleOptionForced(state: WardrobeUiState, fieldKey: string, en: string): WardrobeUiState {
  const current = state.forced[fieldKey];
  const next = { ...state.forced };
  if (current === en) delete next[fieldKey];
  else next[fieldKey] = en;
  return { ...state, forced: next };
}

export function toggleLock(state: WardrobeUiState, fieldKey: string): WardrobeUiState {
  const has = state.locks.includes(fieldKey);
  return {
    ...state,
    locks: has ? state.locks.filter((k) => k !== fieldKey) : [...state.locks, fieldKey],
  };
}

export function isSectionEnabled(state: WardrobeUiState, sectionId: string): boolean {
  return !state.disabledSections.includes(sectionId);
}

export function toggleSection(state: WardrobeUiState, sectionId: string): WardrobeUiState {
  const disabled = new Set(state.disabledSections);
  if (disabled.has(sectionId)) disabled.delete(sectionId);
  else disabled.add(sectionId);
  return { ...state, disabledSections: [...disabled] };
}

export function enabledSections(state: WardrobeUiState): string[] {
  return WARDROBE_SECTION_IDS.filter((id) => !state.disabledSections.includes(id));
}

export function toggleSelectedRole(state: WardrobeUiState, trigger: string): WardrobeUiState {
  const has = state.selectedRoles.includes(trigger);
  const roles = has ? state.selectedRoles.filter((t) => t !== trigger) : [...state.selectedRoles, trigger];
  return { ...state, selectedRoles: roles.slice(0, 8) };
}

export function toggleExpanded(state: WardrobeUiState, sectionId: string): WardrobeUiState {
  const has = state.ui.expanded.includes(sectionId);
  return {
    ...state,
    ui: {
      ...state.ui,
      expanded: has ? state.ui.expanded.filter((id) => id !== sectionId) : [...state.ui.expanded, sectionId],
    },
  };
}

export function setUi(state: WardrobeUiState, patch: Partial<WardrobeUiState["ui"]>): WardrobeUiState {
  return { ...state, ui: { ...state.ui, ...patch } };
}
