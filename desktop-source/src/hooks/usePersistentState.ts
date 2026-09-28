import { useEffect, useRef, useState } from "react";
import { isServerBacked, readStoredValue, scheduleUiStateSave } from "../lib/uiStateStore";

function deepMerge<T>(target: unknown, source: unknown): T {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return source as T;
  }
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    return source as T;
  }
  const result = { ...(target as Record<string, unknown>) };
  const src = source as Record<string, unknown>;
  for (const key of Object.keys(src)) {
    if (src[key] !== undefined) {
      if (typeof src[key] === "object" && src[key] !== null && !Array.isArray(src[key])) {
        result[key] = deepMerge<unknown>(result[key] ?? {}, src[key]);
      } else {
        result[key] = src[key];
      }
    }
  }
  return result as T;
}

/**
 * 读取 localStorage（离线兜底路径），并对历史遗留的无前缀 xyz_* 键做一次性迁移：
 * 新键（comfyui_xyz_*）不存在而旧键存在时，把旧值迁移到新键并删除旧键。
 */
function readWithLegacyMigration(key: string): string | null {
  const value = localStorage.getItem(key);
  if (value !== null) return value;
  if (key.startsWith("comfyui_xyz_")) {
    const legacyKey = key.replace(/^comfyui_/, "");
    try {
      const legacy = localStorage.getItem(legacyKey);
      if (legacy !== null) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem(legacyKey);
        return legacy;
      }
    } catch {
      // 迁移失败不影响读取流程
    }
  }
  return null;
}

/**
 * 持久化 state：正常路径存服务端 data/ui-state.json（800ms 防抖批量 PUT），
 * 服务不可达时回退 localStorage（离线兜底）。deepMerge 语义与旧 useLocalStorageState
 * 完全一致——只补新键，参数字段一律不改名。
 *
 * normalize（可选）：deepMerge 只「补默认值命中的路径」，修不了类型错乱的坏数据
 * （例如存储里 themes 不是数组）。需要结构校验的调用方传它，会拿到「合并后的值 + 原始存储值」
 * 并返回最终初始值；原始存储值为 undefined 表示本地/服务端都没有数据。
 */
export function usePersistentState<T>(
  key: string,
  defaultValue: T,
  normalize?: (merged: T, raw: unknown) => T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    const finish = (merged: T, raw: unknown) => (normalize ? normalize(merged, raw) : merged);
    if (isServerBacked()) {
      const stored = readStoredValue<unknown>(key);
      if (stored !== undefined && stored !== null) {
        return finish(deepMerge<T>(defaultValue, stored), stored);
      }
      return finish(defaultValue, undefined);
    }
    // pending / offline：沿用 localStorage（offline 是服务不可达的兜底，永不变砖）
    try {
      const item = readWithLegacyMigration(key);
      if (item !== null) {
        const parsed = JSON.parse(item);
        return finish(deepMerge<T>(defaultValue, parsed), parsed);
      }
    } catch (error) {
      console.warn(`Error reading persisted key "${key}":`, error);
    }
    return finish(defaultValue, undefined);
  });

  // 跳过首次挂载：服务端是共享存储，启动时全量回写会把本地快照盖到别的窗口的变更上；
  // 只有真正发生变更（或 key 变更）才持久化。
  const lastPersisted = useRef<{ key: string; value: T } | null>(null);
  useEffect(() => {
    const prev = lastPersisted.current;
    lastPersisted.current = { key, value: state };
    if (prev === null || (prev.key === key && prev.value === state)) {
      return; // 首次挂载或值未变：不持久化
    }
    if (isServerBacked()) {
      scheduleUiStateSave(key, state);
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.warn(`Error setting persisted key "${key}":`, error);
    }
  }, [key, state]);

  return [state, setState];
}
