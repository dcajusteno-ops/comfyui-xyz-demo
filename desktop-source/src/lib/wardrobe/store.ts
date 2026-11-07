/**
 * 造型台数据的按需加载与缓存。
 *
 * 与 `lib/anima/store.ts` 同一套思路：分文件 + 模块级缓存 + inflight 去重。
 * 差别是引擎需要「一次性拿齐」——抽取过程中任何一张表缺失都会算错档位，
 * 所以额外提供 `loadWardrobeEngine()` 做整包预加载。
 *
 * 测试可以通过 `setWardrobeData()` 直接播种，避免在 jsdom 里 mock fetch。
 */
import type {
  WardrobeCharAliases,
  WardrobeCharFeat,
  WardrobeCharOutputTags,
  WardrobeCharacters,
  WardrobeCharacterOutfits,
  WardrobeColorMatrix,
  WardrobeHairStyle,
  WardrobeLevels,
  WardrobeLink,
  WardrobeManifest,
  WardrobeNsfwTables,
  WardrobeOutfitStyle,
  WardrobeOutfitTemplates,
  WardrobeOverrides,
  WardrobePools,
  WardrobeScenes,
  WardrobeSceneAspects,
  WardrobeTermHints,
  WardrobeUserCharacters,
} from "./types";

export type WardrobeDataKey =
  | "pools"
  | "levels"
  | "characters"
  | "userCharacters"
  | "scenes"
  | "sceneAspects"
  | "colorMatrix"
  | "hairStyle"
  | "charFeat"
  | "charOutputTags"
  | "charAliases"
  | "characterOutfits"
  | "termHints"
  | "outfitTemplates"
  | "nsfwTables"
  | "overrides"
  | "outfitStyle"
  | "link"
  | "manifest";

export type WardrobeDataMap = {
  pools: WardrobePools;
  levels: WardrobeLevels;
  characters: WardrobeCharacters;
  userCharacters: WardrobeUserCharacters;
  scenes: WardrobeScenes;
  sceneAspects: WardrobeSceneAspects;
  colorMatrix: WardrobeColorMatrix;
  hairStyle: WardrobeHairStyle;
  charFeat: WardrobeCharFeat;
  charOutputTags: WardrobeCharOutputTags;
  charAliases: WardrobeCharAliases;
  characterOutfits: WardrobeCharacterOutfits;
  termHints: WardrobeTermHints;
  outfitTemplates: WardrobeOutfitTemplates;
  nsfwTables: WardrobeNsfwTables;
  overrides: WardrobeOverrides;
  outfitStyle: WardrobeOutfitStyle;
  link: WardrobeLink;
  manifest: WardrobeManifest;
};

const FILES: Record<WardrobeDataKey, string> = {
  pools: "pools.json",
  levels: "levels.json",
  characters: "characters.json",
  userCharacters: "user-characters.json",
  scenes: "scenes.json",
  sceneAspects: "scene-aspects.json",
  colorMatrix: "color-matrix.json",
  hairStyle: "char-hair-style.json",
  charFeat: "char-feat.json",
  charOutputTags: "char-output-tags.json",
  charAliases: "char-aliases.json",
  characterOutfits: "character-outfits.json",
  termHints: "term-hints.json",
  outfitTemplates: "outfit-templates.json",
  nsfwTables: "nsfw-tables.json",
  overrides: "overrides.json",
  outfitStyle: "outfit-style.json",
  link: "link.json",
  manifest: "manifest.json",
};

const ENGINE_KEYS: WardrobeDataKey[] = [
  "pools",
  "levels",
  "characters",
  "userCharacters",
  "scenes",
  "sceneAspects",
  "colorMatrix",
  "hairStyle",
  "charFeat",
  "charOutputTags",
  "charAliases",
  "characterOutfits",
  "termHints",
  "outfitTemplates",
  "nsfwTables",
  "overrides",
  "outfitStyle",
  "link",
];

const cache = new Map<WardrobeDataKey, unknown>();
const inflight = new Map<WardrobeDataKey, Promise<unknown>>();

export function wardrobeDataUrl(key: WardrobeDataKey): string {
  return `/data/wardrobe/${FILES[key]}`;
}

export function getWardrobeData<K extends WardrobeDataKey>(key: K): WardrobeDataMap[K] | null {
  return (cache.get(key) as WardrobeDataMap[K] | undefined) ?? null;
}

/** 引擎内部统一走这个：缺表时给出可定位的错误，而不是 undefined 崩在别处。 */
export function requireWardrobeData<K extends WardrobeDataKey>(key: K): WardrobeDataMap[K] {
  const value = cache.get(key);
  if (value === undefined) {
    throw new Error(`造型台数据未加载：${key}（${FILES[key]}）`);
  }
  return value as WardrobeDataMap[K];
}

/** 测试/预加载播种；同 key 覆盖。 */
export function setWardrobeData<K extends WardrobeDataKey>(key: K, value: WardrobeDataMap[K]): void {
  cache.set(key, value);
}

export async function loadWardrobeData<K extends WardrobeDataKey>(key: K): Promise<WardrobeDataMap[K]> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached as WardrobeDataMap[K];

  const pending = inflight.get(key);
  if (pending) return pending as Promise<WardrobeDataMap[K]>;

  const file = FILES[key];
  const task = (async () => {
    let response: Response;
    try {
      response = await fetch(wardrobeDataUrl(key));
    } catch (error) {
      throw new Error(
        `造型台数据加载失败：${file}（${error instanceof Error ? error.message : String(error)}）`,
        { cause: error },
      );
    }
    if (!response.ok) throw new Error(`造型台数据加载失败：${file}（HTTP ${response.status}）`);
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error(
        `造型台数据解析失败：${file}（${error instanceof Error ? error.message : String(error)}）`,
        { cause: error },
      );
    }
    if (data === null || typeof data !== "object") throw new Error(`造型台数据结构异常：${file}`);
    cache.set(key, data);
    return data as WardrobeDataMap[K];
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

/** 抽取前必须整包就绪；重复调用直接命中缓存。 */
export async function loadWardrobeEngine(): Promise<void> {
  await Promise.all(ENGINE_KEYS.map((key) => loadWardrobeData(key)));
}

export function resetWardrobeCache(key?: WardrobeDataKey): void {
  if (key) {
    cache.delete(key);
    inflight.delete(key);
    return;
  }
  cache.clear();
  inflight.clear();
}
