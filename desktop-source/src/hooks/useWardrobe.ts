/**
 * 造型台的状态编排：持久化三件套 + 抽取 + 场景套用 + 收藏/预设。
 *
 * 抽取是同步的（引擎整包在内存里，单次 ~5–15ms），所以这里不用 async，
 * 也不做"运行中"状态；按钮点击后立即出结果。
 */
import { useCallback, useMemo } from "react";
import type { Toast } from "../types";
import { usePersistentState } from "./usePersistentState";
import { draw } from "../lib/wardrobe/draw";
import {
  WARDROBE_FAVORITES_KEY,
  WARDROBE_PRESETS_KEY,
  WARDROBE_STATE_KEY,
  defaultFavorites,
  defaultPresets,
  defaultWardrobeState,
  normalizeFavorites,
  normalizePresets,
  normalizeWardrobeState,
  WARDROBE_SECTION_IDS,
} from "../lib/wardrobe/persist";
import { applyPresetToState, capturePreset } from "../lib/wardrobe/presets";
import { targetNum } from "../lib/wardrobe/levels";
import { enabledSections, toggleSelectedRole } from "../lib/wardrobe/state";
import { countTags } from "../lib/wardrobe/text";
import { splitWardrobeToWorkbench } from "../lib/wardrobe/workbench";
import { getWardrobeData } from "../lib/wardrobe/store";
import type { WardrobeDrawResult, WardrobeScene, WardrobeUiState } from "../lib/wardrobe/types";

type ToastFn = (type: Toast["type"], title: string, message?: string) => void;

export function useWardrobe(pushToast: ToastFn) {
  const [state, setState] = usePersistentState<WardrobeUiState>(
    WARDROBE_STATE_KEY,
    defaultWardrobeState(),
    normalizeWardrobeState,
  );
  const [favorites, setFavorites] = usePersistentState(
    WARDROBE_FAVORITES_KEY,
    defaultFavorites(),
    normalizeFavorites,
  );
  const [presets, setPresets] = usePersistentState(
    WARDROBE_PRESETS_KEY,
    defaultPresets(),
    normalizePresets,
  );

  const favoriteChars = useMemo(() => new Set(favorites.characters), [favorites.characters]);
  const favoriteScenes = useMemo(() => new Set(favorites.scenes), [favorites.scenes]);
  const selectedRoles = useMemo(() => new Set(state.selectedRoles), [state.selectedRoles]);

  const run = useCallback((): WardrobeDrawResult | null => {
    try {
      const result = draw({
        level: state.level,
        seed: state.seed,
        baseProb: state.baseProb,
        weights: state.weights,
        enabledSections: enabledSections(state),
        locks: state.locks,
        tagCap: state.tagCap,
        forced: state.forced,
        forceRole: state.forceRole,
        extraBody: state.extraBody,
        appearanceFollow: state.appearanceFollow,
        hairFollow: state.hairFollow,
        hairPicks: state.hairPicks,
        selectedRoles: state.selectedRoles,
        breastSize: state.breastSize,
        roleWorks: state.roleWorks,
        outfitStyle: state.outfitStyle,
        roleFavOnly: state.roleFavOnly,
        favorites: favorites.characters,
      });
      setState((prev) => ({
        ...prev,
        lastResult: {
          text: result.text,
          levelNum: result.level_num,
          cap: result.cap,
          seed: state.seed,
          tagCount: countTags(result.text),
          drawn: result.report.drawn,
          dropped: result.dropped,
          repaired: result.report.repaired,
          notes: result.notes.slice(0, 20),
          slots: splitWardrobeToWorkbench(result.state, result.tags),
          at: Date.now(),
        },
      }));
      pushToast("success", "造型台已抽取", `${countTags(result.text)} 个标签 · ${result.level_label}`);
      return result;
    } catch (error) {
      pushToast("error", "抽取失败", error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [state, favorites.characters, pushToast, setState]);

  const toggleFavoriteCharacter = useCallback(
    (tag: string) => {
      setFavorites((prev) => {
        const has = prev.characters.includes(tag);
        return {
          ...prev,
          characters: has ? prev.characters.filter((x) => x !== tag) : [tag, ...prev.characters].slice(0, 2000),
        };
      });
    },
    [setFavorites],
  );

  const toggleFavoriteScene = useCallback(
    (id: string) => {
      setFavorites((prev) => {
        const has = prev.scenes.includes(id);
        return {
          ...prev,
          scenes: has ? prev.scenes.filter((x) => x !== id) : [id, ...prev.scenes].slice(0, 2000),
        };
      });
    },
    [setFavorites],
  );

  const toggleRole = useCallback(
    (trigger: string) => {
      setState((prev) => toggleSelectedRole(prev, trigger));
    },
    [setState],
  );

  const applyScene = useCallback(
    (scene: WardrobeScene) => {
      const pools = getWardrobeData("pools");
      const scenes = getWardrobeData("scenes");
      if (!pools || !scenes) return;
      const ids = [...Object.keys(pools.canon), ...scenes.scenes.map((s) => s.id)];
      setState((prev) => {
        const options: Record<string, number> = {};
        for (const id of ids) options[id] = 0;
        options[scene.id] = 3;
        const currentNum = targetNum()[prev.level] ?? 0;
        const nextLevel =
          scene.level > currentNum
            ? (["sfw", "suggestive", "explicit", "hardcore", "extreme"] as const)[scene.level] ?? prev.level
            : prev.level;
        const locks = scene.no_role && !prev.locks.includes("role") ? [...prev.locks, "role"] : prev.locks;
        return {
          ...prev,
          level: nextLevel,
          locks,
          disabledSections: prev.disabledSections.filter((id) => id !== "canon"),
          weights: {
            ...prev.weights,
            sections: { ...prev.weights.sections, canon: prev.weights.sections.canon || 1 },
            fields: { ...prev.weights.fields, n_canon: 3 },
            options: { ...prev.weights.options, n_canon: options },
          },
        };
      });
      pushToast("info", "已套用场景", `${scene.zh}${scene.level > 0 ? ` · L${scene.level}` : ""}`);
    },
    [pushToast, setState],
  );

  const clearScene = useCallback(() => {
    setState((prev) => {
      const fields = { ...prev.weights.fields };
      delete fields.n_canon;
      const options = { ...prev.weights.options };
      delete options.n_canon;
      return { ...prev, weights: { ...prev.weights, fields, options } };
    });
    pushToast("info", "已清除场景", "n_canon 权重已恢复默认");
  }, [pushToast, setState]);

  const savePreset = useCallback(
    (name: string) => {
      const preset = capturePreset(state, name);
      setPresets((prev) => ({ ...prev, items: { ...prev.items, [preset.id]: preset } }));
      pushToast("success", "预设已保存", preset.name);
    },
    [pushToast, setPresets, state],
  );

  const loadPreset = useCallback(
    (id: string) => {
      const preset = presets.items[id];
      if (!preset) return;
      setState((prev) => applyPresetToState(prev, preset));
      pushToast("info", "预设已套用", preset.name);
    },
    [presets.items, pushToast, setState],
  );

  const deletePreset = useCallback(
    (id: string) => {
      setPresets((prev) => {
        const items = { ...prev.items };
        delete items[id];
        return { ...prev, items };
      });
    },
    [setPresets],
  );

  return {
    state,
    setState,
    favorites,
    favoriteChars,
    favoriteScenes,
    presets,
    selectedRoles,
    run,
    toggleRole,
    toggleFavoriteCharacter,
    toggleFavoriteScene,
    applyScene,
    clearScene,
    savePreset,
    loadPreset,
    deletePreset,
    sectionIds: WARDROBE_SECTION_IDS,
  };
}
