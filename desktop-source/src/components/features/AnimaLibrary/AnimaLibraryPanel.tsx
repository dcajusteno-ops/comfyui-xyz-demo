import React, { useCallback, useMemo, useState } from "react";
import { LibraryBig } from "lucide-react";
import { PanelTitle } from "../../ui";
import type { Toast } from "../../../types";
import { usePersistentState } from "../../../hooks/usePersistentState";
import { useAnimaData } from "../../../hooks/useAnimaData";
import { loadAnimaData } from "../../../lib/anima/store";
import { appendTokensToSlot, buildComposerPreview, toApplyText } from "../../../lib/anima/compose";
import { splitSectionTokens } from "../../../lib/anima/tags";
import { composeAnimaPrompt, composerValuesFromResult } from "../../../lib/anima/gacha";
import { fetchDanbooruImage, fetchRandomDanbooruPost } from "../../../lib/anima/danbooru";
import { proxiedDanbooruImageUrl } from "../../../lib/anima/imageProxy";
import {
  defaultComposerState,
  defaultDanbooruState,
  defaultFavorites,
  defaultGachaState,
  defaultGalleryState,
  emptyComposerValues,
  normalizeComposerState,
  normalizeDanbooruState,
  normalizeFavorites,
  normalizeGachaState,
  normalizeGalleryState,
} from "../../../lib/anima/persist";
import type {
  AnimaApplyMode,
  AnimaComposerState,
  AnimaCostumeItem,
  AnimaDanbooruAttire,
  AnimaFavoritesState,
  AnimaGalleryState,
  AnimaGachaState,
  AnimaLibrarySection,
  AnimaLibraryView,
  AnimaOfficialCharacter,
  AnimaArtist,
  AnimaCharacter,
  DanbooruSettings,
  DanbooruSnapshot,
} from "../../../lib/anima/types";
import { AnimaGallery } from "./AnimaGallery";
import { AnimaComposer } from "./AnimaComposer";
import { AnimaGachaPanel } from "./AnimaGachaPanel";
import { AnimaDanbooruPanel } from "./AnimaDanbooruPanel";

type ToastFn = (type: Toast["type"], title: string, message?: string) => void;

const VIEWS: Array<{ id: AnimaLibraryView; label: string }> = [
  { id: "gallery", label: "画廊" },
  { id: "composer", label: "拼接台" },
  { id: "gacha", label: "抽卡" },
  { id: "danbooru", label: "Danbooru" },
];

export type AnimaLibraryPanelProps = {
  currentPrompt: string;
  onApplyPrompt: (text: string, mode: AnimaApplyMode) => void;
  onUploadImage: (file: File) => Promise<string>;
  onSetAnimaReference: (imageName: string) => void;
  onConfirm: (title: string, message: string, onConfirm: () => void) => void;
  pushToast: ToastFn;
};

export const AnimaLibraryPanel = React.memo(({
  currentPrompt,
  onApplyPrompt,
  onUploadImage,
  onSetAnimaReference,
  onConfirm,
  pushToast,
}: AnimaLibraryPanelProps) => {
  const [gallery, setGallery] = usePersistentState<AnimaGalleryState>(
    "comfyui_anima_gallery",
    defaultGalleryState,
    normalizeGalleryState,
  );
  const [composer, setComposer] = usePersistentState<AnimaComposerState>(
    "comfyui_anima_composer",
    defaultComposerState,
    normalizeComposerState,
  );
  const [favorites, setFavorites] = usePersistentState<AnimaFavoritesState>(
    "comfyui_anima_favorites",
    defaultFavorites,
    normalizeFavorites,
  );
  const [gacha, setGacha] = usePersistentState<AnimaGachaState>(
    "comfyui_anima_gacha",
    defaultGachaState,
    normalizeGachaState,
  );
  const [danbooru, setDanbooru] = usePersistentState(
    "comfyui_anima_danbooru",
    defaultDanbooruState,
    normalizeDanbooruState,
  );

  const manifest = useAnimaData("manifest");
  const [gachaRunning, setGachaRunning] = useState(false);
  const [gachaError, setGachaError] = useState<string | null>(null);
  const [danbooruLoading, setDanbooruLoading] = useState(false);
  const [danbooruError, setDanbooruError] = useState<string | null>(null);

  const setView = useCallback(
    (activeView: AnimaLibraryView) => setGallery((prev) => ({ ...prev, activeView })),
    [setGallery],
  );

  const favoriteSet = useMemo(
    () => new Set(favorites.items[gallery.section] ?? []),
    [favorites.items, gallery.section],
  );

  const toggleFavorite = useCallback(
    (section: AnimaLibrarySection, key: string) => {
      setFavorites((prev) => {
        const current = prev.items[section] ?? [];
        const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
        return { ...prev, items: { ...prev.items, [section]: next.slice(-2000) } };
      });
    },
    [setFavorites],
  );

  const setFavoritesBulk = useCallback(
    (section: AnimaLibrarySection, keys: string[], value: boolean) => {
      setFavorites((prev) => {
        const current = new Set(prev.items[section] ?? []);
        for (const key of keys) {
          if (value) current.add(key);
          else current.delete(key);
        }
        return { ...prev, items: { ...prev.items, [section]: Array.from(current).slice(-2000) } };
      });
    },
    [setFavorites],
  );

  const addToComposer = useCallback(
    (section: AnimaLibrarySection, tokens: string[]) => {
      if (!tokens.length) return;
      setComposer((prev) => ({
        ...prev,
        values: { ...prev.values, [section]: appendTokensToSlot(prev.values[section], tokens) },
      }));
    },
    [setComposer],
  );

  const applyText = useCallback(
    (text: string, mode: AnimaApplyMode) => {
      const clean = toApplyText(text);
      if (!clean) {
        pushToast("info", "没有可写入的内容", "请先拼出或抽出一段提示词");
        return;
      }
      onApplyPrompt(clean, mode);
    },
    [onApplyPrompt, pushToast],
  );

  const runGacha = useCallback(async () => {
    const options = gacha.options;
    setGachaRunning(true);
    setGachaError(null);
    try {
      // 服装来源为「角色 Tags 借用」时，即使角色分区没开也要角色图鉴 + 官方 tags，
      // 否则会静默退化成内置服装库（插件总是加载全量数据，不会踩到这个坑）。
      const needsCharacters =
        options.enable.character ||
        (options.enable.clothing &&
          (options.clothingSource === "character_tags" || options.clothingSource === "random"));
      const needsAttire = options.enable.clothing && options.clothingSource !== "author";

      const [artists, characters, official, clothing, backgrounds, poses, danbooruAttire] = await Promise.all([
        options.enable.artist ? loadAnimaData("artists") : Promise.resolve<AnimaArtist[]>([]),
        needsCharacters ? loadAnimaData("characters") : Promise.resolve<AnimaCharacter[]>([]),
        needsCharacters
          ? loadAnimaData("official")
          : Promise.resolve<Record<string, AnimaOfficialCharacter>>({}),
        options.enable.clothing ? loadAnimaData("clothing") : Promise.resolve<AnimaCostumeItem[]>([]),
        options.enable.background ? loadAnimaData("backgrounds") : Promise.resolve<AnimaCostumeItem[]>([]),
        options.enable.pose ? loadAnimaData("poses") : Promise.resolve<AnimaCostumeItem[]>([]),
        needsAttire ? loadAnimaData("danbooruAttire") : Promise.resolve<AnimaDanbooruAttire>({}),
      ]);

      const result = composeAnimaPrompt(
        { artists, characters, official, clothing, backgrounds, poses, danbooruAttire },
        options,
      );
      setGacha((prev) => ({
        ...prev,
        last: {
          text: result.text,
          sections: result.sections,
          picks: result.picks,
          usedSeed: result.usedSeed,
          characterSeed: options.characterSeed,
          clothingSeed: options.clothingSeed,
          at: Date.now(),
        },
      }));
    } catch (cause) {
      setGachaError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setGachaRunning(false);
    }
  }, [gacha.options, setGacha]);

  const fillComposerFromGacha = useCallback(() => {
    const last = gacha.last;
    if (!last) return;
    const doFill = () => {
      setComposer((prev) => ({
        ...prev,
        values: {
          ...prev.values,
          ...composerValuesFromResult({ sections: last.sections }),
        },
      }));
      setView("composer");
      pushToast("success", "已填入拼接台", "可以继续手改，再写入提示词");
    };

    const occupied = (["artist", "character", "clothing", "background", "pose"] as const).some(
      (slot) => composer.values[slot].trim(),
    );
    if (occupied) {
      onConfirm(
        "覆盖拼接台分区",
        "抽卡结果会替换画师 / 角色 / 服装 / 背景 / 姿势五个分区（质量与额外提示词保留）。",
        doFill,
      );
      return;
    }
    doFill();
  }, [composer.values, gacha.last, onConfirm, pushToast, setComposer, setView]);

  const fillComposerExtra = useCallback(
    (text: string) => {
      setComposer((prev) => ({
        ...prev,
        values: { ...prev.values, extra: appendTokensToSlot(prev.values.extra, splitSectionTokens(text)) },
      }));
      setView("composer");
      pushToast("success", "已填入拼接台", "写在「额外提示词」分区");
    },
    [pushToast, setComposer, setView],
  );

  const runDanbooru = useCallback(async () => {
    setDanbooruLoading(true);
    setDanbooruError(null);
    try {
      const snapshot = await fetchRandomDanbooruPost(danbooru.settings);
      setDanbooru((prev) => ({ ...prev, last: snapshot }));
    } catch (cause) {
      setDanbooruError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDanbooruLoading(false);
    }
  }, [danbooru.settings, setDanbooru]);

  const useDanbooruAsReference = useCallback(
    async (snapshot: DanbooruSnapshot) => {
      const blob = await fetchDanbooruImage(
        proxiedDanbooruImageUrl(snapshot.fileUrl || snapshot.imageUrl),
      );
      const ext = snapshot.fileExt === "jpeg" ? "jpg" : snapshot.fileExt || "jpg";
      const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      const file = new File([blob], `danbooru_${snapshot.id}.${ext}`, {
        type: blob.type || mime,
      });
      const imageName = await onUploadImage(file);
      onSetAnimaReference(imageName);
    },
    [onSetAnimaReference, onUploadImage],
  );

  const updateDanbooruSettings = useCallback(
    (patch: Partial<DanbooruSettings>) =>
      setDanbooru((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } })),
    [setDanbooru],
  );

  const manifestLabel = useMemo(() => {
    if (manifest.error) return `数据未就绪：${manifest.error}`;
    if (!manifest.data) return "数据加载中…";
    const counts = manifest.data.counts;
    const total = ["artists", "characters", "clothing", "backgrounds", "poses"].reduce(
      (sum, key) => sum + (counts[key] ?? 0),
      0,
    );
    return `数据 v${manifest.data.source.version} · ${(total / 10000).toFixed(2)} 万条`;
  }, [manifest.data, manifest.error]);

  return (
    <section className="panel al-panel">
      <div className="panel-header al-header">
        <PanelTitle icon={LibraryBig} title="Anima 词库" />
        <div className="al-header-meta">{manifestLabel}</div>
        <div className="segmented al-view-tabs">
          {VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              className={gallery.activeView === view.id ? "active" : ""}
              onClick={() => setView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`panel-body al-body${gallery.activeView === "gallery" ? " is-gallery" : ""}`}>
        {gallery.activeView === "gallery" && (
          <AnimaGallery
            section={gallery.section}
            onSectionChange={(section) => setGallery((prev) => ({ ...prev, section }))}
            sort={gallery.sort}
            onSortChange={(sort) => setGallery((prev) => ({ ...prev, sort }))}
            pageSize={gallery.pageSize}
            onPageSizeChange={(pageSize) => setGallery((prev) => ({ ...prev, pageSize }))}
            favoritesOnly={gallery.favoritesOnly}
            onFavoritesOnlyChange={(favoritesOnly) => setGallery((prev) => ({ ...prev, favoritesOnly }))}
            favorites={favoriteSet}
            onToggleFavorite={toggleFavorite}
            onSetFavorites={setFavoritesBulk}
            onAddToComposer={addToComposer}
            pushToast={pushToast}
          />
        )}

        {gallery.activeView === "composer" && (
          <AnimaComposer
            state={composer}
            currentPrompt={currentPrompt}
            onChangeSlot={(slot, value) =>
              setComposer((prev) => ({ ...prev, values: { ...prev.values, [slot]: value } }))
            }
            onClearSlot={(slot) =>
              setComposer((prev) => ({ ...prev, values: { ...prev.values, [slot]: "" } }))
            }
            onDedupeChange={(dedupe) => setComposer((prev) => ({ ...prev, dedupe }))}
            onApply={(mode) =>
              applyText(buildComposerPreview(composer.values, { dedupe: composer.dedupe }), mode)
            }
            onClearAll={() =>
              setComposer((prev) => ({ ...prev, values: emptyComposerValues() }))
            }
            onConfirm={onConfirm}
            onOpenGallery={(section) => {
              setGallery((prev) => ({ ...prev, section, activeView: "gallery" }));
            }}
            pushToast={pushToast}
          />
        )}

        {gallery.activeView === "gacha" && (
          <AnimaGachaPanel
            state={gacha}
            running={gachaRunning}
            error={gachaError}
            onChange={(patch) =>
              setGacha((prev) => ({ ...prev, options: { ...prev.options, ...patch } }))
            }
            onRun={() => void runGacha()}
            onApply={(mode) => {
              const text = gacha.last?.text ?? "";
              if (mode === "replace") {
                onConfirm(
                  "覆盖 Anima 提示词",
                  `当前提示词 ${currentPrompt.length} 字符将被抽卡结果替换，此操作不可撤销。`,
                  () => applyText(text, "replace"),
                );
                return;
              }
              applyText(text, "append");
            }}
            onFillComposer={fillComposerFromGacha}
          />
        )}

        {gallery.activeView === "danbooru" && (
          <AnimaDanbooruPanel
            state={danbooru}
            loading={danbooruLoading}
            error={danbooruError}
            onChangeSettings={updateDanbooruSettings}
            onRun={() => void runDanbooru()}
            onApplyPrompt={(text, mode) => {
              if (mode === "replace") {
                onConfirm(
                  "覆盖 Anima 提示词",
                  `当前提示词 ${currentPrompt.length} 字符将被 Danbooru 标签替换，此操作不可撤销。`,
                  () => applyText(text, "replace"),
                );
                return;
              }
              applyText(text, "append");
            }}
            onFillComposer={fillComposerExtra}
            onUseAsReference={useDanbooruAsReference}
            pushToast={pushToast}
          />
        )}
      </div>
    </section>
  );
});
