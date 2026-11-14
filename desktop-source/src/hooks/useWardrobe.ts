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
  WARDROBE_OUTFITS_KEY,
  WARDROBE_PRESETS_KEY,
  WARDROBE_STATE_KEY,
  defaultFavorites,
  defaultOutfits,
  defaultPresets,
  defaultWardrobeState,
  normalizeFavorites,
  normalizeOutfits,
  normalizePresets,
  normalizeWardrobeState,
  WARDROBE_SECTION_IDS,
} from "../lib/wardrobe/persist";
import { deleteOutfit, enableOutfit, upsertOutfit } from "../lib/wardrobe/outfits";
import { applyPresetToState, capturePreset } from "../lib/wardrobe/presets";
import { targetNum } from "../lib/wardrobe/levels";
import { enabledSections, toggleSelectedRole } from "../lib/wardrobe/state";
import { countTags } from "../lib/wardrobe/text";
import { splitWardrobeToWorkbench } from "../lib/wardrobe/workbench";
import { getWardrobeData } from "../lib/wardrobe/store";
import type {
  WardrobeDrawResult,
  WardrobeScene,
  WardrobeUiState,
} from "../lib/wardrobe/types";
import { nearSlimProfile, slimWeightsForNear } from "../lib/wardrobe/near";
import { WARDROBE_LEVELS } from "../lib/wardrobe/persist";

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
  const [outfits, setOutfits] = usePersistentState(
    WARDROBE_OUTFITS_KEY,
    defaultOutfits(),
    normalizeOutfits,
  );

  const favoriteChars = useMemo(() => new Set(favorites.characters), [favorites.characters]);
  const favoriteScenes = useMemo(() => new Set(favorites.scenes), [favorites.scenes]);
  const favoriteWorks = useMemo(() => new Set(favorites.works), [favorites.works]);
  const selectedRoles = useMemo(() => new Set(state.selectedRoles), [state.selectedRoles]);

  /**
   * 抽一次。`seedOverride` 只给连续生图用：每轮换一个临时种子，
   * 不写回面板 seed，也不改变用户的可复现设置。
   */
  const run = useCallback((seedOverride?: number): WardrobeDrawResult | null => {
    const drawSeed = Number.isFinite(seedOverride) ? Math.trunc(seedOverride as number) : state.seed;
    const drawLevel = state.randomLevel
      ? WARDROBE_LEVELS[Math.floor(Math.random() * WARDROBE_LEVELS.length)]
      : state.level;
    try {
      const result = draw({
        level: drawLevel,
        seed: drawSeed,
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
        rolePick: state.rolePick,
        scenePick: state.scenePick,
        duoRoleFill: state.duoRoleFill,
        drySkinFilter: state.drySkin.enabled,
        drySkinGroups: state.drySkin.groups.join(","),
        drySkinTags: state.drySkin.onlyTags,
        pickPoolMode: state.pickPool.enabled ? state.pickPool.mode : "",
        pickPoolIds: state.pickPool.enabled ? state.pickPool.ids.join(",") : "",
        favorites: favorites.characters,
      });
      setState((prev) => ({
        ...prev,
        lastResult: {
          text: result.text,
          levelNum: result.level_num,
          cap: result.cap,
          seed: drawSeed,
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

  const toggleFavoriteWork = useCallback(
    (slug: string) => {
      setFavorites((prev) => {
        const has = prev.works.includes(slug);
        return {
          ...prev,
          works: has ? prev.works.filter((x) => x !== slug) : [slug, ...prev.works].slice(0, 200),
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
          // 显式套用场景 = 压过勾选池（两者语义冲突，UI 上互斥）
          pickPool: { ...prev.pickPool, enabled: false },
          nearBase: undefined,
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
      return { ...prev, weights: { ...prev.weights, fields, options }, nearBase: undefined };
    });
    pushToast("info", "已清除场景", "n_canon 权重已恢复默认");
  }, [pushToast, setState]);

  const saveOutfit = useCallback(
    (roleTag: string, item: import("../lib/wardrobe/types").WardrobeOutfitSet, isNew: boolean) => {
      setOutfits((prev) => upsertOutfit(prev, roleTag, item, isNew).store);
      pushToast("success", isNew ? "服装预设已新增" : "服装预设已更新", item.zh || item.id);
    },
    [pushToast, setOutfits],
  );

  const removeOutfit = useCallback(
    (roleTag: string, id: string) => {
      setOutfits((prev) => deleteOutfit(prev, roleTag, id));
      pushToast("info", "服装预设已删除", id);
    },
    [pushToast, setOutfits],
  );

  const toggleOutfit = useCallback(
    (roleTag: string, id: string) => {
      setOutfits((prev) => enableOutfit(prev, roleTag, id));
      pushToast("info", id ? "已启用服装预设" : "已取消启用", "随机抽到的衣服不会再出现");
    },
    [pushToast, setOutfits],
  );

  /* ---------------- V6：服装库 / 干爽过滤 / 双女补位 / 勾选池 / 特写 ---------------- */

  const toggleLibraryActive = useCallback(
    (id: string) => {
      setState((prev) => {
        const active = prev.outfitLibrary.active === id ? "" : id;
        return { ...prev, outfitLibrary: { ...prev.outfitLibrary, active } };
      });
    },
    [setState],
  );

  const setLibraryOverride = useCallback(
    (field: "socks" | "shoes", value: string) => {
      setState((prev) => ({
        ...prev,
        outfitLibrary: {
          ...prev.outfitLibrary,
          overrides: { ...prev.outfitLibrary.overrides, [field]: value },
        },
      }));
    },
    [setState],
  );

  const setLibrarySceneOverride = useCallback(
    (value: boolean) => {
      setState((prev) => ({
        ...prev,
        outfitLibrary: { ...prev.outfitLibrary, sceneOverride: value },
      }));
    },
    [setState],
  );

  const setDrySkin = useCallback(
    (patch: Partial<WardrobeUiState["drySkin"]>) => {
      setState((prev) => ({ ...prev, drySkin: { ...prev.drySkin, ...patch } }));
    },
    [setState],
  );

  const setDuoRoleFill = useCallback(
    (value: boolean) => {
      setState((prev) => ({ ...prev, duoRoleFill: value }));
    },
    [setState],
  );

  const setPickPoolMode = useCallback(
    (mode: WardrobeUiState["pickPool"]["mode"]) => {
      setState((prev) => ({
        ...prev,
        pickPool: {
          enabled: mode !== "",
          mode,
          // 换模式就清空勾选（不同页签的 id 混在一起没有意义）
          ids: mode === prev.pickPool.mode ? prev.pickPool.ids : [],
        },
      }));
    },
    [setState],
  );

  const togglePickPoolId = useCallback(
    (id: string) => {
      setState((prev) => {
        const has = prev.pickPool.ids.includes(id);
        return {
          ...prev,
          pickPool: {
            ...prev.pickPool,
            ids: has ? prev.pickPool.ids.filter((x) => x !== id) : [...prev.pickPool.ids, id],
          },
        };
      });
    },
    [setState],
  );

  const clearPickPool = useCallback(() => {
    setState((prev) => ({ ...prev, pickPool: { ...prev.pickPool, ids: [] } }));
  }, [setState]);

  /** 特写套用：先快照原权重，再按 `nearSlimProfile` 收紧取景（与引擎同一套规则）。 */
  const applyNearScene = useCallback(
    (scene: WardrobeScene) => {
      const pools = getWardrobeData("pools");
      const scenes = getWardrobeData("scenes");
      if (!pools || !scenes) return;
      setState((prev) => {
        const start = prev.nearBase
          ? {
              ...prev,
              weights: prev.nearBase.weights,
              disabledSections: prev.nearBase.disabledSections,
              locks: prev.nearBase.locks,
              nearBase: undefined,
            }
          : prev;
        const profile = nearSlimProfile(scene);
        const slimmed = slimWeightsForNear(start.weights, scene);
        const ids = [...Object.keys(pools.canon ?? {}), ...scenes.scenes.map((s) => s.id)];
        const sceneOpts: Record<string, number> = {};
        for (const id of ids) sceneOpts[id] = id === scene.id ? 3 : 0;
        const weights = {
          ...slimmed,
          fields: { ...slimmed.fields, n_canon: 3 },
          options: { ...slimmed.options, n_canon: sceneOpts },
        };
        const currentNum = targetNum()[start.level] ?? 0;
        const nextLevel =
          scene.level > currentNum
            ? (WARDROBE_LEVELS[scene.level] ?? start.level)
            : start.level;
        const locks = profile?.dropRole
          ? Array.from(new Set([...start.locks, "role"]))
          : start.locks;
        return {
          ...start,
          level: nextLevel,
          weights,
          locks,
          disabledSections: start.disabledSections.filter((id) => id !== "canon"),
          selectedRoles: profile?.dropRole ? [] : start.selectedRoles,
          forceRole: profile?.dropRole ? "" : start.forceRole,
          nearBase: {
            sceneId: scene.id,
            weights: start.weights,
            disabledSections: start.disabledSections,
            locks: start.locks,
          },
        };
      });
      // v6.6.1：特写里的人数是钉死到 count_lock 的，若这一条是双女而用户只选了 1 位，
      // 必须说清「引擎会自动补一位」—— 否则正文少一个角色，用户以为是 bug。
      const lock = String(scene.count_lock ?? "");
      const duoLike = /2girls|multiple girls/i.test(lock);
      const duoTip = duoLike
        ? " · 双女人数，只选 1 位角色时引擎会自动补一位（同作品优先）"
        : "";
      pushToast(
        "info",
        "已套用特写并收紧取景",
        `${scene.zh} · 关 ${nearSlimProfile(scene)?.sections.length ?? 0} 段 / 清 ${
          nearSlimProfile(scene)?.fields.length ?? 0
        } 个字段${duoTip}`,
      );
    },
    [pushToast, setState],
  );

  const restoreNear = useCallback(() => {
    setState((prev) => {
      if (!prev.nearBase) return prev;
      return {
        ...prev,
        weights: prev.nearBase.weights,
        disabledSections: prev.nearBase.disabledSections,
        locks: prev.nearBase.locks,
        nearBase: undefined,
      };
    });
    pushToast("info", "已还原特写前的权重", "段 / 字段 / 人数 / 锁定全部回到套用前");
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
    favoriteWorks,
    presets,
    outfits,
    selectedRoles,
    run,
    toggleRole,
    toggleFavoriteCharacter,
    toggleFavoriteScene,
    toggleFavoriteWork,
    applyScene,
    clearScene,
    savePreset,
    loadPreset,
    deletePreset,
    saveOutfit,
    removeOutfit,
    toggleOutfit,
    toggleLibraryActive,
    setLibraryOverride,
    setLibrarySceneOverride,
    setDrySkin,
    setDuoRoleFill,
    setPickPoolMode,
    togglePickPoolId,
    clearPickPool,
    applyNearScene,
    restoreNear,
    sectionIds: WARDROBE_SECTION_IDS,
  };
}
