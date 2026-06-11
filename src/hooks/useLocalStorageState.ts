import { useState, useEffect } from "react";

function deepMerge<T>(target: any, source: any): T {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return source as T;
  }
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    return source as T;
  }
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] !== undefined) {
      if (typeof source[key] === "object" && source[key] !== null && !Array.isArray(source[key])) {
        result[key] = deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
  }
  return result as T;
}

export function useLocalStorageState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
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
