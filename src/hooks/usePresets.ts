import { useCallback } from "react";
import { useLocalStorageState } from "./useLocalStorageState";
import { exportPresetsJson, makePreset, selectPresetsFor, validateImport } from "../lib/generationPresets";
import type { GenerationPreset, TemplateKind } from "../types";

type Store = { presets: GenerationPreset[] };

export function usePresets() {
  const [store, setStore] = useLocalStorageState<Store>("comfyui_presets", { presets: [] });

  const add = useCallback(
    (name: string, target: TemplateKind, snapshot: Record<string, unknown>) => {
      const preset = makePreset(name, target, snapshot);
      setStore((prev) => ({ presets: [preset, ...prev.presets] }));
      return preset;
    },
    [setStore],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      setStore((prev) => ({
        presets: prev.presets.map((p) =>
          p.id === id ? { ...p, name: name.trim(), updatedAt: Date.now() } : p,
        ),
      }));
    },
    [setStore],
  );

  const remove = useCallback(
    (id: string) => {
      setStore((prev) => ({ presets: prev.presets.filter((p) => p.id !== id) }));
    },
    [setStore],
  );

  const clear = useCallback(() => {
    setStore({ presets: [] });
  }, [setStore]);

  const importJson = useCallback(
    (text: string) => {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return { added: 0, skipped: 0, invalid: true as const };
      }
      const { valid, skipped } = validateImport(raw);
      if (valid.length > 0) {
        setStore((prev) => {
          const byId = new Map(prev.presets.map((p) => [p.id, p]));
          for (const preset of valid) byId.set(preset.id, preset);
          return { presets: Array.from(byId.values()) };
        });
      }
      return { added: valid.length, skipped, invalid: false as const };
    },
    [setStore],
  );

  const exportText = useCallback(() => exportPresetsJson(store.presets), [store.presets]);

  const forTarget = useCallback(
    (target: TemplateKind) => selectPresetsFor(store.presets, target),
    [store.presets],
  );

  return { presets: store.presets, add, rename, remove, clear, importJson, exportText, forTarget };
}