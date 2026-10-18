/**
 * 持久化状态默认值与坏数据修复。
 *
 * `usePersistentState` 的 deepMerge 只会「补默认值命中的路径」，修不了
 * 「favorites 不是数组」「pageSize 是字符串」这类错乱，所以每个复合状态
 * 都配一个 normalize。
 */
import type {
  AnimaComposerPick,
  AnimaComposerSlot,
  AnimaComposerState,
  AnimaFavoritesState,
  AnimaGalleryState,
  AnimaGachaOptions,
  AnimaGachaState,
  AnimaLibrarySection,
  AnimaLibraryView,
  DanbooruSettings,
  DanbooruState,
} from "./types";
import { DANBOORU_SIZES, normalizeDanbooruRatings, splitRatingFromQuery } from "./danbooru";

export const ANIMA_SECTIONS: AnimaLibrarySection[] = [
  "artist",
  "character",
  "clothing",
  "background",
  "pose",
];

export const ANIMA_COMPOSER_SLOTS: AnimaComposerSlot[] = [
  "quality",
  "artist",
  "character",
  "clothing",
  "background",
  "pose",
  "extra",
];

const VIEWS: AnimaLibraryView[] = ["gallery", "composer", "gacha", "danbooru"];
const PAGE_SIZES = [24, 48, 96];

export function emptyComposerValues(): Record<AnimaComposerSlot, string> {
  return {
    quality: "",
    artist: "",
    character: "",
    clothing: "",
    background: "",
    pose: "",
    extra: "",
  };
}

export const defaultComposerState: AnimaComposerState = {
  version: 1,
  values: emptyComposerValues(),
  dedupe: false,
  applyMode: "append",
};

export const defaultFavorites: AnimaFavoritesState = {
  version: 1,
  items: {},
};

export function defaultGachaOptions(): AnimaGachaOptions {
  return {
    seed: -1,
    artistCount: 1,
    characterSeed: -1,
    clothingSeed: -1,
    characterDetail: "trigger",
    characterTagCount: 3,
    characterKeepFeatures: true,
    clothingSource: "author",
    enable: { artist: true, character: true, clothing: true, background: true, pose: true },
  };
}

export const defaultGachaState: AnimaGachaState = {
  version: 1,
  options: defaultGachaOptions(),
};

export const defaultDanbooruSettings: DanbooruSettings = {
  query: "",
  ratings: ["g"],
  size: "sample",
  // 与插件默认一致：角色/作品/普通标签开，画师与 meta 关
  groups: { artist: false, character: true, copyright: true, general: true, meta: false },
  blockTags: "",
  useDefaultBlocklist: true,
};

export const defaultDanbooruState: DanbooruState = {
  version: 1,
  settings: defaultDanbooruSettings,
};

export const defaultGalleryState: AnimaGalleryState = {
  version: 1,
  activeView: "gallery",
  section: "artist",
  sort: "popular",
  pageSize: 48,
  favoritesOnly: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function int(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeComposerState(merged: AnimaComposerState): AnimaComposerState {
  const rawValues: Record<string, unknown> = isRecord(merged?.values) ? merged.values : {};
  const values = emptyComposerValues();
  for (const slot of ANIMA_COMPOSER_SLOTS) values[slot] = text(rawValues[slot]);
  return {
    version: 1,
    values,
    dedupe: bool(merged?.dedupe, false),
    applyMode: merged?.applyMode === "replace" ? "replace" : "append",
  };
}

export function normalizeFavorites(merged: AnimaFavoritesState): AnimaFavoritesState {
  const items = isRecord(merged?.items) ? merged.items : {};
  const out: AnimaFavoritesState["items"] = {};
  for (const section of ANIMA_SECTIONS) {
    const list = items[section];
    if (!Array.isArray(list)) continue;
    const keys = Array.from(new Set(list.filter((key): key is string => typeof key === "string" && Boolean(key))));
    // ui-state 是单个 JSON 文件；每区 2000 个键足够用，也避免无限膨胀
    out[section] = keys.slice(0, 2000);
  }
  return { version: 1, items: out };
}

export function normalizeGachaOptions(raw: unknown): AnimaGachaOptions {
  const defaults = defaultGachaOptions();
  const options = isRecord(raw) ? raw : {};
  const enable = isRecord(options.enable) ? options.enable : {};
  const detail = options.characterDetail;
  const source = options.clothingSource;
  return {
    seed: clamp(int(options.seed, defaults.seed), -1, 2 ** 31 - 1),
    artistCount: clamp(int(options.artistCount, defaults.artistCount), 0, 20),
    characterSeed: clamp(int(options.characterSeed, defaults.characterSeed), -1, 2 ** 31 - 1),
    clothingSeed: clamp(int(options.clothingSeed, defaults.clothingSeed), -1, 2 ** 31 - 1),
    characterDetail:
      detail === "trigger" || detail === "trigger_tags" || detail === "trigger_random_tags"
        ? detail
        : defaults.characterDetail,
    characterTagCount: clamp(int(options.characterTagCount, defaults.characterTagCount), 0, 30),
    characterKeepFeatures: bool(options.characterKeepFeatures, defaults.characterKeepFeatures),
    clothingSource:
      source === "author" || source === "danbooru" || source === "character_tags" || source === "random"
        ? source
        : defaults.clothingSource,
    enable: {
      artist: bool(enable.artist, true),
      character: bool(enable.character, true),
      clothing: bool(enable.clothing, true),
      background: bool(enable.background, true),
      pose: bool(enable.pose, true),
    },
  };
}

export function normalizeGachaState(merged: AnimaGachaState): AnimaGachaState {
  const options = normalizeGachaOptions(merged?.options);
  const last = merged?.last;
  if (!isRecord(last) || typeof last.text !== "string" || !isRecord(last.sections)) {
    return { version: 1, options };
  }
  const sections = last.sections as Record<string, unknown>;
  const toList = (key: string) =>
    Array.isArray(sections[key])
      ? (sections[key] as unknown[]).filter((part): part is string => typeof part === "string")
      : [];
  return {
    version: 1,
    options,
    last: {
      text: last.text,
      sections: {
        artist: toList("artist"),
        character: toList("character"),
        clothing: toList("clothing"),
        background: toList("background"),
        pose: toList("pose"),
      },
      picks: isRecord(last.picks) ? (last.picks as unknown as AnimaComposerPick) : ({} as AnimaComposerPick),
      usedSeed: int(last.usedSeed, -1),
      characterSeed: int(last.characterSeed, -1),
      clothingSeed: int(last.clothingSeed, -1),
      at: int(last.at, Date.now()),
    },
  };
}

export function normalizeDanbooruSettings(raw: unknown): DanbooruSettings {
  const defaults = defaultDanbooruSettings;
  const settings = isRecord(raw) ? raw : {};
  const groups = isRecord(settings.groups) ? settings.groups : {};
  // 旧存档：分级曾写在查询串里（rating:general）或单个 rating 字段，这里统一迁移到多选数组
  const parsedQuery = splitRatingFromQuery(text(settings.query, defaults.query));
  /** 空值 / all / any = 不限；有内容但一个都识别不出 = 坏数据，返回 undefined 交给下一级回退 */
  const readRatings = (raw: unknown): DanbooruSettings["ratings"] | undefined => {
    if (raw === undefined) return undefined;
    const normalized = normalizeDanbooruRatings(raw);
    if (normalized.length) return normalized;
    const rawText = (Array.isArray(raw) ? raw.join(",") : String(raw ?? "")).trim().toLowerCase();
    if (!rawText || rawText === "all" || rawText === "any") return [];
    return undefined;
  };
  const ratings =
    readRatings("ratings" in settings ? settings.ratings : undefined) ??
    readRatings(settings.rating) ??
    (parsedQuery.ratings.length ? parsedQuery.ratings : [...(defaults.ratings ?? [])]);
  return {
    query: parsedQuery.query,
    ratings,
    size: DANBOORU_SIZES.includes(settings.size as never) ? (settings.size as DanbooruSettings["size"]) : defaults.size,
    groups: {
      artist: bool(groups.artist, defaults.groups.artist),
      character: bool(groups.character, defaults.groups.character),
      copyright: bool(groups.copyright, defaults.groups.copyright),
      general: bool(groups.general, defaults.groups.general),
      meta: bool(groups.meta, defaults.groups.meta),
    },
    blockTags: text(settings.blockTags, ""),
    useDefaultBlocklist: bool(settings.useDefaultBlocklist, true),
  };
}

export function normalizeDanbooruState(merged: DanbooruState): DanbooruState {
  const settings = normalizeDanbooruSettings(merged?.settings);
  const last = merged?.last;
  if (
    !isRecord(last) ||
    typeof last.imageUrl !== "string" ||
    typeof last.prompt !== "string" ||
    typeof last.id !== "number"
  ) {
    return { version: 1, settings };
  }
  const groups: Record<string, unknown> = isRecord(last.groups) ? last.groups : {};
  return {
    version: 1,
    settings,
    last: {
      id: last.id,
      postUrl: text(last.postUrl, ""),
      imageUrl: last.imageUrl,
      ...(typeof last.fileUrl === "string" ? { fileUrl: last.fileUrl } : {}),
      ...(Array.isArray(last.imageUrls)
        ? {
            imageUrls: last.imageUrls.filter(
              (url): url is string => typeof url === "string" && Boolean(url),
            ),
          }
        : {}),
      fileExt: text(last.fileExt, "jpg"),
      rating: text(last.rating, ""),
      ...(typeof last.width === "number" ? { width: last.width } : {}),
      ...(typeof last.height === "number" ? { height: last.height } : {}),
      groups: {
        artist: text(groups.artist),
        character: text(groups.character),
        copyright: text(groups.copyright),
        general: text(groups.general),
        meta: text(groups.meta),
      },
      prompt: last.prompt,
      at: int(last.at, Date.now()),
    },
  };
}

export function normalizeGalleryState(merged: AnimaGalleryState): AnimaGalleryState {
  const defaults = defaultGalleryState;
  const section = ANIMA_SECTIONS.includes(merged?.section) ? merged.section : defaults.section;
  return {
    version: 1,
    activeView: VIEWS.includes(merged?.activeView) ? merged.activeView : defaults.activeView,
    section,
    sort:
      merged?.sort === "name" || merged?.sort === "random" || merged?.sort === "popular"
        ? merged.sort
        : defaults.sort,
    pageSize: PAGE_SIZES.includes(merged?.pageSize) ? merged.pageSize : defaults.pageSize,
    favoritesOnly: bool(merged?.favoritesOnly, defaults.favoritesOnly),
  };
}
