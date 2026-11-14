/** 命名预设：捕获/套用当前造型台参数。 */
import type { WardrobePreset, WardrobeUiState } from "./types";
import { weightStats } from "./weights";

/**
 * 捕获当前面板状态。
 *
 * 覆盖范围对齐插件的「预设 = 存一份节点控件」：档位 / 权重 / 锁 / 关段 / 已选角色 /
 * 服装风格 / 附加正文，再加上 V5–V6 新加的那批开关（人数与角色抽取、干爽过滤、
 * 双女补位、勾选池）。服装库的启用态**不进预设** —— 插件那边它是服务端状态
 * （`outfit_library.json` 的 active），不随工作流走。
 */
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
    tagCap: state.tagCap,
    baseProb: state.baseProb,
    forceRole: state.forceRole,
    roleWorks: state.roleWorks,
    breastSize: state.breastSize,
    appearanceFollow: state.appearanceFollow,
    hairFollow: state.hairFollow,
    roleFavOnly: state.roleFavOnly,
    rolePick: state.rolePick,
    scenePick: state.scenePick,
    duoRoleFill: state.duoRoleFill,
    hairPicks: { ...state.hairPicks },
    drySkin: {
      enabled: state.drySkin.enabled,
      groups: [...state.drySkin.groups],
      onlyTags: state.drySkin.onlyTags,
    },
    pickPool: {
      enabled: state.pickPool.enabled,
      mode: state.pickPool.mode,
      ids: [...state.pickPool.ids],
    },
  };
}

/**
 * 套用预设。
 *
 * ⚠️ 可选键**缺席就不动**：老预设（V6 之前存的）没有 `drySkin` / `duoRoleFill`
 * 这些字段，套用时必须保留面板现值，否则会静默把用户的开关重置成默认。
 * 这条和插件 v6.5.0 对干爽过滤的处理一致。
 */
export function applyPresetToState(state: WardrobeUiState, preset: WardrobePreset): WardrobeUiState {
  const next: WardrobeUiState = {
    ...state,
    level: preset.level,
    weights: preset.weights,
    locks: [...preset.locks],
    disabledSections: [...preset.disabledSections],
    selectedRoles: [...preset.selectedRoles],
    outfitStyle: preset.outfitStyle,
    extraBody: preset.extraBody,
  };

  if (preset.tagCap !== undefined) next.tagCap = String(preset.tagCap);
  if (preset.baseProb !== undefined) next.baseProb = preset.baseProb;
  if (preset.forceRole !== undefined) next.forceRole = preset.forceRole;
  if (preset.roleWorks !== undefined) next.roleWorks = [...preset.roleWorks];
  if (preset.breastSize !== undefined) next.breastSize = preset.breastSize;
  if (preset.appearanceFollow !== undefined) next.appearanceFollow = preset.appearanceFollow;
  if (preset.hairFollow !== undefined) next.hairFollow = preset.hairFollow;
  if (preset.roleFavOnly !== undefined) next.roleFavOnly = preset.roleFavOnly;
  if (preset.rolePick !== undefined) next.rolePick = preset.rolePick;
  if (preset.scenePick !== undefined) next.scenePick = preset.scenePick;
  if (preset.duoRoleFill !== undefined) next.duoRoleFill = preset.duoRoleFill;
  if (preset.hairPicks !== undefined) next.hairPicks = { ...state.hairPicks, ...preset.hairPicks };
  if (preset.drySkin !== undefined) {
    next.drySkin = {
      enabled: Boolean(preset.drySkin.enabled),
      groups: [...preset.drySkin.groups],
      onlyTags: String(preset.drySkin.onlyTags ?? ""),
    };
  }
  if (preset.pickPool !== undefined) {
    next.pickPool = {
      enabled: Boolean(preset.pickPool.enabled),
      mode: preset.pickPool.mode as WardrobeUiState["pickPool"]["mode"],
      ids: [...preset.pickPool.ids],
    };
  }
  return next;
}

export function presetSummary(preset: WardrobePreset): string {
  const stats = weightStats(preset.weights);
  const parts = [`${preset.level.toUpperCase()}`];
  if (stats.total) parts.push(`${stats.total} 项权重`);
  if (preset.locks.length) parts.push(`锁 ${preset.locks.length}`);
  if (preset.selectedRoles.length) parts.push(`${preset.selectedRoles.length} 位角色`);
  if (preset.drySkin?.enabled) parts.push("干爽过滤");
  if (preset.pickPool?.enabled && preset.pickPool.ids.length) {
    parts.push(`勾选池 ${preset.pickPool.ids.length} 条`);
  }
  return parts.join(" · ");
}
