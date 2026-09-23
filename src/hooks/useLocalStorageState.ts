import { useState, useEffect } from "react";

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
 * 读取 localStorage，并对历史遗留的无前缀 xyz_* 键做一次性迁移：
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

export function useLocalStorageState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const item = readWithLegacyMigration(key);
      if (item !== null) {
        return deepMerge(defaultValue, JSON.parse(item));
      }
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
    }
    return defaultValue;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error);
    }
  }, [key, state]);

  return [state, setState];
}
