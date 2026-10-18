/**
 * 把三套结构不同的原始数据（画师 / 角色 / 服装类）收敛成统一的卡片模型。
 *
 * 40,600 条画师每条都带一个预计算的小写搜索串；索引按原始数组引用缓存，
 * 切分区/翻页不会重复构建。
 */
import type {
  AnimaCharacter,
  AnimaCostumeItem,
  AnimaDataMap,
  AnimaGalleryItem,
  AnimaGallerySort,
  AnimaLibrarySection,
} from "./types";
import { createRng, shuffleInPlace } from "./prng";
import { artistToken } from "./tags";
import { artistPreviewUrl, characterPreviewUrl, costumePreviewUrl, unescapeArtistName } from "./preview";

export type GallerySource = Partial<Pick<AnimaDataMap, "artists" | "characters" | "clothing" | "backgrounds" | "poses">>;

const indexCache = new WeakMap<object, AnimaGalleryItem[]>();

function numberLabel(value: number): string {
  return value > 0 ? `${value.toLocaleString("zh-CN")} 作品` : "";
}

function artistItem(item: AnimaDataMap["artists"][number]): AnimaGalleryItem {
  const tokens = [artistToken(item.name)].filter(Boolean);
  return {
    key: `artist:${item.id || item.name}`,
    section: "artist",
    // 展示用未转义名（`hammer \(sunset beach\)` → `hammer (sunset beach)`）；
    // tokens 里保留转义，因为那才是写进提示词的语法。
    title: unescapeArtistName(item.name),
    subtitle: numberLabel(item.postCount),
    preview: artistPreviewUrl(item.name),
    tokens,
    popularity: item.postCount,
    categories: [],
    traits: [],
    searchText: [item.name, unescapeArtistName(item.name), item.id, String(item.postCount)]
      .join(" ")
      .toLowerCase(),
  };
}

function characterItem(item: AnimaCharacter): AnimaGalleryItem {
  const tokens = [item.name, item.copyright].map((part) => part.trim()).filter(Boolean);
  const facets = {
    ...(item.gender ? { gender: item.gender } : {}),
    ...(item.hair ? { hair: item.hair } : {}),
    ...(item.eye ? { eye: item.eye } : {}),
    ...(item.copyright ? { copyright: item.copyright } : {}),
  };
  return {
    key: `character:${item.name}||${item.copyright}`,
    section: "character",
    title: item.name,
    subtitle: item.copyright || numberLabel(item.postCount),
    preview: characterPreviewUrl(item.name, item.copyright),
    tokens,
    popularity: item.postCount,
    categories: [],
    traits: [],
    facets,
    searchText: [
      item.name,
      item.copyright,
      item.gender,
      item.hair,
      item.eye,
      String(item.postCount),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  };
}

function costumeItem(section: Exclude<AnimaLibrarySection, "artist" | "character">, item: AnimaCostumeItem): AnimaGalleryItem {
  const title = item.nameZh || item.name;
  const subtitle = item.name && item.name !== title ? item.name : "";
  return {
    key: `${section}:${item.id}`,
    section,
    title,
    subtitle,
    preview: costumePreviewUrl(item),
    tokens: item.tags
      .split(",")
      .map((part) => part.replace("_raw_:", "").trim())
      .filter(Boolean),
    popularity: 0,
    categories: item.categories ?? [],
    traits: item.traits ?? [],
    searchText: [
      item.name,
      item.nameZh,
      item.tags,
      item.tagsZh,
      ...(item.categories ?? []),
      ...(item.traits ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  };
}

export function buildGalleryItems(section: AnimaLibrarySection, source: GallerySource): AnimaGalleryItem[] {
  if (section === "artist") return (source.artists ?? []).map(artistItem);
  if (section === "character") return (source.characters ?? []).map(characterItem);
  if (section === "clothing") return (source.clothing ?? []).map((item) => costumeItem("clothing", item));
  if (section === "background") return (source.backgrounds ?? []).map((item) => costumeItem("background", item));
  return (source.poses ?? []).map((item) => costumeItem("pose", item));
}

/** 同一份数据只构建一次（WeakMap 以原始数组为键，测试换夹具也不会串） */
export function getGalleryItems(
  section: AnimaLibrarySection,
  source: GallerySource,
): AnimaGalleryItem[] {
  const raw =
    section === "artist"
      ? source.artists
      : section === "character"
        ? source.characters
        : section === "clothing"
          ? source.clothing
          : section === "background"
            ? source.backgrounds
            : source.poses;
  if (!raw) return [];
  const cached = indexCache.get(raw);
  if (cached) return cached;
  const items = buildGalleryItems(section, source);
  indexCache.set(raw, items);
  return items;
}

const collator = new Intl.Collator("zh-Hans", { numeric: true, sensitivity: "base" });

export function sortGalleryItems(
  items: readonly AnimaGalleryItem[],
  sort: AnimaGallerySort,
  shuffleSeed = 1,
): AnimaGalleryItem[] {
  const list = items.slice();
  if (sort === "name") {
    return list.sort((a, b) => collator.compare(a.title, b.title));
  }
  if (sort === "random") {
    return shuffleInPlace(createRng(shuffleSeed), list);
  }
  return list.sort((a, b) => b.popularity - a.popularity || collator.compare(a.title, b.title));
}

export function uniqueValues(items: readonly AnimaGalleryItem[], field: "categories" | "traits"): string[] {
  const set = new Set<string>();
  for (const item of items) for (const value of item[field]) if (value) set.add(value);
  return Array.from(set).sort((a, b) => collator.compare(a, b));
}

export function uniqueFacetValues(
  items: readonly AnimaGalleryItem[],
  facet: "gender" | "hair" | "eye" | "copyright",
): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const value = item.facets?.[facet];
    if (value) set.add(value);
  }
  return Array.from(set).sort((a, b) => collator.compare(a, b));
}

export type GalleryFilter = {
  search?: string;
  category?: string;
  trait?: string;
  favoritesOnly?: boolean;
  favorites?: ReadonlySet<string>;
  gender?: string;
  hair?: string;
  eye?: string;
  copyright?: string;
};

export function filterGalleryItems(
  items: readonly AnimaGalleryItem[],
  filter: GalleryFilter,
): AnimaGalleryItem[] {
  const query = (filter.search ?? "").trim().toLowerCase();
  return items.filter((item) => {
    if (filter.favoritesOnly && !filter.favorites?.has(item.key)) return false;
    if (filter.category && !item.categories.includes(filter.category)) return false;
    if (filter.trait && !item.traits.includes(filter.trait)) return false;
    if (filter.gender && item.facets?.gender !== filter.gender) return false;
    if (filter.hair && item.facets?.hair !== filter.hair) return false;
    if (filter.eye && item.facets?.eye !== filter.eye) return false;
    if (filter.copyright && item.facets?.copyright !== filter.copyright) return false;
    if (query && !item.searchText.includes(query)) return false;
    return true;
  });
}
