/**
 * Anima 词库的领域类型。
 *
 * 这些类型只被 `lib/anima/*` 与 `components/features/AnimaLibrary/*` 消费，
 * 因此不放进 `src/types.ts`（那里是跨模块契约，避免 App 层被词库细节污染）。
 * 只有 TabId 必须留在 types.ts。
 */

export type AnimaLibrarySection = "artist" | "character" | "clothing" | "background" | "pose";

export type AnimaComposerSlot =
  | "quality"
  | "artist"
  | "character"
  | "clothing"
  | "background"
  | "pose"
  | "extra";

export type AnimaApplyMode = "append" | "replace";

/* ------------------------------------------------------------------ *
 * 数据集（public/data/anima/*.json，导入脚本已转 camelCase）
 * ------------------------------------------------------------------ */

export type AnimaArtist = {
  id: string;
  name: string;
  postCount: number;
  uniquenessScore?: number;
};

export type AnimaCharacter = {
  name: string;
  copyright: string;
  postCount: number;
  /** official tags 为空时的回退来源（207/8000 条会走到） */
  gender?: string;
  hair?: string;
  eye?: string;
};

export type AnimaOfficialCharacter = {
  trigger?: string;
  tags?: string[];
};

export type AnimaCostumeItem = {
  id: string;
  name: string;
  nameZh: string;
  tags: string;
  tagsZh?: string;
  categories: string[];
  traits: string[];
  preview?: string;
};

export type AnimaDanbooruAttire = Partial<
  Record<"top" | "bottom" | "uniform" | "traditional" | "decoration" | "socks" | "shoes" | "vocabulary", string[]>
>;

export type AnimaManifest = {
  schemaVersion: number;
  generatedAt: string;
  generator?: string;
  source: { plugin: string; version: string; repo: string; license: string };
  counts: Record<string, number>;
  files: Record<string, string>;
  notes?: string;
};

export type AnimaDataMap = {
  artists: AnimaArtist[];
  characters: AnimaCharacter[];
  official: Record<string, AnimaOfficialCharacter>;
  clothing: AnimaCostumeItem[];
  backgrounds: AnimaCostumeItem[];
  poses: AnimaCostumeItem[];
  danbooruAttire: AnimaDanbooruAttire;
  manifest: AnimaManifest;
};

export type AnimaDataKind = keyof AnimaDataMap;

/* ------------------------------------------------------------------ *
 * 画廊
 * ------------------------------------------------------------------ */

export type AnimaGallerySort = "popular" | "name" | "random";

/** 原始数据 → 统一卡片模型；构建一次并缓存，40k 条不重复 map */
export type AnimaGalleryItem = {
  key: string;
  section: AnimaLibrarySection;
  title: string;
  subtitle?: string;
  preview?: string;
  /** 加入拼接台的默认 token（画师已带 @） */
  tokens: string[];
  popularity: number;
  categories: string[];
  traits: string[];
  /** 角色专有筛选维度（性别/发色/瞳色/作品） */
  facets?: { gender?: string; hair?: string; eye?: string; copyright?: string };
  /** 小写拼接串，构建时算一次 */
  searchText: string;
};

/* ------------------------------------------------------------------ *
 * 拼接台
 * ------------------------------------------------------------------ */

export type AnimaComposerValues = Record<AnimaComposerSlot, string>;

export type AnimaComposerState = {
  version: 1;
  values: AnimaComposerValues;
  dedupe: boolean;
  applyMode: AnimaApplyMode;
};

/* ------------------------------------------------------------------ *
 * 收藏
 * ------------------------------------------------------------------ */

export type AnimaFavoritesState = {
  version: 1;
  items: Partial<Record<AnimaLibrarySection, string[]>>;
};

/* ------------------------------------------------------------------ *
 * 随机抽卡
 * ------------------------------------------------------------------ */

export type AnimaCharacterDetail = "trigger" | "trigger_tags" | "trigger_random_tags";
export type AnimaClothingSource = "author" | "danbooru" | "character_tags" | "random";

export type AnimaGachaOptions = {
  seed: number;
  artistCount: number;
  characterSeed: number;
  clothingSeed: number;
  characterDetail: AnimaCharacterDetail;
  characterTagCount: number;
  characterKeepFeatures: boolean;
  clothingSource: AnimaClothingSource;
  enable: Record<AnimaLibrarySection, boolean>;
};

export type AnimaCharacterPick = {
  item: AnimaCharacter;
  copyright: string;
  trigger: string[];
  featureParts: string[];
  outfitParts: string[];
  /** 实际进入输出的词（已应用 detail 模式与去重） */
  parts: string[];
};

export type AnimaCostumePick = {
  title: string;
  subtitle?: string;
  preview?: string;
  parts: string[];
};

export type AnimaComposerPick = {
  artists: AnimaArtist[];
  character?: AnimaCharacterPick;
  clothing: AnimaCostumePick[];
  background?: AnimaCostumePick;
  pose?: AnimaCostumePick;
};

export type AnimaComposerResult = {
  text: string;
  parts: string[];
  usedSeed: number;
  /** 每个分区实际进入 text 的词（跨区去重后），用于「填入拼接台」保证结果一致 */
  sections: Record<Exclude<AnimaComposerSlot, "quality" | "extra">, string[]>;
  picks: AnimaComposerPick;
};

export type AnimaGachaState = {
  version: 1;
  options: AnimaGachaOptions;
  last?: {
    text: string;
    sections: AnimaComposerResult["sections"];
    picks: AnimaComposerPick;
    usedSeed: number;
    characterSeed: number;
    clothingSeed: number;
    at: number;
  };
};

/* ------------------------------------------------------------------ *
 * Danbooru
 * ------------------------------------------------------------------ */

export type DanbooruTagGroup = "artist" | "character" | "copyright" | "general" | "meta";
export type DanbooruSize = "sample" | "original" | "720x720" | "360x360" | "180x180";

/** Danbooru 官方分级；空数组 = 不限（不拼 rating 条件） */
export type DanbooruRating = "g" | "s" | "q" | "e";

export type DanbooruSettings = {
  query: string;
  /** 多选分级，按 g/s/q/e 顺序存；旧存档的 rating 字段读取时会迁移到这里 */
  ratings?: DanbooruRating[];
  size: DanbooruSize;
  groups: Record<DanbooruTagGroup, boolean>;
  blockTags: string;
  useDefaultBlocklist: boolean;
};

export type DanbooruSnapshot = {
  id: number;
  postUrl: string;
  imageUrl: string;
  fileUrl?: string;
  /** 逐档回退：sample 挂了试 720，再试 original/preview（CDN 对某些档位可能单独失败） */
  imageUrls?: string[];
  fileExt: string;
  rating: string;
  width?: number;
  height?: number;
  groups: Record<DanbooruTagGroup, string>;
  prompt: string;
  at: number;
};

export type DanbooruState = {
  version: 1;
  settings: DanbooruSettings;
  last?: DanbooruSnapshot;
};

/* ------------------------------------------------------------------ *
 * 画廊视图状态
 * ------------------------------------------------------------------ */

export type AnimaLibraryView = "gallery" | "composer" | "gacha" | "danbooru";

export type AnimaGalleryState = {
  version: 1;
  activeView: AnimaLibraryView;
  section: AnimaLibrarySection;
  sort: AnimaGallerySort;
  pageSize: number;
  favoritesOnly: boolean;
};
