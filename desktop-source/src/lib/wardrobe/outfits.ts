/**
 * 角色服装预设的用户覆盖层（v5.0.2）。
 *
 * 插件把预设写在 `presets/character_outfits.json`（用户数据）。本项目的数据包
 * 是只读的，所以**编辑结果存 ui-state**，运行时把它合并进引擎读到的表里：
 * 覆盖层按角色整条替换（与插件的「同角色一份记录」语义一致）。
 *
 * ⚠️ 合并后必须 `resetRoleIndexes()` —— 引擎里 `outfitIndex` 是模块级缓存，
 *    不清就会继续用旧的表（表现为「点了启用但抽出来还是随机衣服」）。
 */
import { resetRoleIndexes } from "./characters";
import { requireWardrobeData, setWardrobeData } from "./store";
import type { WardrobeOutfitRecord, WardrobeOutfitSet, WardrobeOutfitStore } from "./types";

let baseRoles: Record<string, WardrobeOutfitRecord> | null = null;

function base(): Record<string, WardrobeOutfitRecord> {
  if (!baseRoles) {
    const raw = requireWardrobeData("characterOutfits").outfits ?? {};
    baseRoles = JSON.parse(JSON.stringify(raw)) as Record<string, WardrobeOutfitRecord>;
  }
  return baseRoles;
}

/** 把 ui-state 的覆盖层合并进引擎数据（覆盖层优先）。 */
export function applyOutfitOverlay(overlay: WardrobeOutfitStore | null | undefined): void {
  const merged: Record<string, WardrobeOutfitRecord> = { ...base() };
  for (const [role, rec] of Object.entries(overlay?.roles ?? {})) {
    if (rec && typeof rec === "object" && Array.isArray(rec.list)) merged[role] = rec;
  }
  const current = requireWardrobeData("characterOutfits");
  setWardrobeData("characterOutfits", { ...current, outfits: merged });
  resetRoleIndexes();
}

/** 某角色的预设记录（覆盖层优先，其次内置表）。 */
export function outfitRecord(store: WardrobeOutfitStore, roleTag: string): WardrobeOutfitRecord {
  return store.roles[roleTag] ?? base()[roleTag] ?? {};
}

/** 新增 / 更新一套。`isNew` 时 id 撞车自动改名（v5.0.9：绝不覆盖上一套）。 */
export function upsertOutfit(
  store: WardrobeOutfitStore,
  roleTag: string,
  item: WardrobeOutfitSet,
  isNew: boolean,
): { store: WardrobeOutfitStore; saved: WardrobeOutfitSet } {
  const rec = outfitRecord(store, roleTag);
  const list = [...(rec.list ?? [])];
  const saved: WardrobeOutfitSet = { ...item, tags: [...(item.tags ?? [])], fields: { ...(item.fields ?? {}) } };
  if (isNew) {
    const used = new Set(list.map((row) => row.id));
    let id = saved.id?.trim() || "default";
    let n = 2;
    const stem = id;
    while (used.has(id)) id = `${stem}_${n++}`;
    saved.id = id;
    list.push(saved);
  } else {
    const index = list.findIndex((row) => row.id === saved.id);
    if (index >= 0) list[index] = saved;
    else list.push(saved);
  }
  return {
    store: {
      ...store,
      roles: { ...store.roles, [roleTag]: { ...rec, list } },
    },
    saved,
  };
}

export function deleteOutfit(
  store: WardrobeOutfitStore,
  roleTag: string,
  id: string,
): WardrobeOutfitStore {
  const rec = outfitRecord(store, roleTag);
  const list = (rec.list ?? []).filter((row) => row.id !== id);
  const next: WardrobeOutfitRecord = { ...rec, list };
  if (!list.length) delete next.enabled;
  if (next.enabled === id) delete next.enabled;
  return { ...store, roles: { ...store.roles, [roleTag]: next } };
}

/** 启用 / 取消启用（传空串 = 取消启用，预设本身保留）。 */
export function enableOutfit(
  store: WardrobeOutfitStore,
  roleTag: string,
  id: string,
): WardrobeOutfitStore {
  const rec = outfitRecord(store, roleTag);
  const next: WardrobeOutfitRecord = { ...rec, list: [...(rec.list ?? [])] };
  if (id) next.enabled = id;
  else delete next.enabled;
  return { ...store, roles: { ...store.roles, [roleTag]: next } };
}
