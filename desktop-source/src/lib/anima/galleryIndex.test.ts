import { describe, expect, it } from "vitest";
import {
  buildGalleryItems,
  filterGalleryItems,
  getGalleryItems,
  sortGalleryItems,
  uniqueFacetValues,
  uniqueValues,
} from "./galleryIndex";
import type { AnimaDataMap } from "./types";

const artists = [
  { id: "1", name: "dairi", postCount: 100 },
  { id: "2", name: "hammer \\(sunset beach\\)", postCount: 50 },
];
const characters = [
  {
    name: "hatsune miku",
    copyright: "vocaloid",
    postCount: 100,
    gender: "1girl",
    hair: "blue",
    eye: "blue",
  },
  {
    name: "kaito",
    copyright: "vocaloid",
    postCount: 40,
    gender: "1boy",
    hair: "blue",
    eye: "blue",
  },
];
const costume = {
  id: "c1",
  name: "Evening Gown",
  nameZh: "晚礼服",
  tags: "evening gown, halterneck,",
  categories: ["礼服"],
  traits: ["side slit"],
};
const background = {
  id: "b1",
  name: "Beach",
  nameZh: "海滩",
  tags: "beach, sunset",
  categories: ["自然"],
  traits: ["outdoor"],
};
const pose = {
  id: "p1",
  name: "Standing",
  nameZh: "站立",
  tags: "standing",
  categories: ["站姿"],
  traits: ["arm"],
};

const data = {
  artists,
  characters,
  clothing: [costume],
  backgrounds: [background],
  poses: [pose],
} as unknown as Pick<AnimaDataMap, "artists" | "characters" | "clothing" | "backgrounds" | "poses">;

describe("画廊索引", () => {
  it("画师展示名去掉转义，token 保留转义", () => {
    const item = buildGalleryItems("artist", data).find((entry) => entry.key === "artist:2");
    expect(item?.title).toBe("hammer (sunset beach)");
    expect(item?.tokens).toEqual(["@hammer \\(sunset beach\\)"]);
  });

  it("角色 token 是 name + copyright，并带筛选维度", () => {
    const item = buildGalleryItems("character", data)[0];
    expect(item.tokens).toEqual(["hatsune miku", "vocaloid"]);
    expect(item.facets).toMatchObject({ gender: "1girl", hair: "blue", eye: "blue", copyright: "vocaloid" });
  });

  it("服装类用中文名做标题、英文名做副标题，tag 按逗号切分", () => {
    const item = buildGalleryItems("clothing", data)[0];
    expect(item.title).toBe("晚礼服");
    expect(item.subtitle).toBe("Evening Gown");
    expect(item.tokens).toEqual(["evening gown", "halterneck"]);
  });

  it("同一份数组只构建一次索引", () => {
    expect(getGalleryItems("clothing", data)).toBe(getGalleryItems("clothing", data));
  });

  it("搜索同时覆盖英文名、中文名、标签与转义原文", () => {
    const artistItems = buildGalleryItems("artist", data);
    expect(filterGalleryItems(artistItems, { search: "sunset" })).toHaveLength(1);
    expect(filterGalleryItems(artistItems, { search: "dairi" })).toHaveLength(1);

    const clothingItems = buildGalleryItems("clothing", data);
    expect(filterGalleryItems(clothingItems, { search: "晚礼" })).toHaveLength(1);
    expect(filterGalleryItems(clothingItems, { search: "halterneck" })).toHaveLength(1);
  });

  it("分类/特征/角色维度筛选", () => {
    const clothingItems = buildGalleryItems("clothing", data);
    expect(filterGalleryItems(clothingItems, { category: "礼服" })).toHaveLength(1);
    expect(filterGalleryItems(clothingItems, { trait: "side slit" })).toHaveLength(1);
    expect(filterGalleryItems(clothingItems, { category: "不存在" })).toHaveLength(0);

    const characterItems = buildGalleryItems("character", data);
    expect(filterGalleryItems(characterItems, { gender: "1girl" })).toHaveLength(1);
    expect(filterGalleryItems(characterItems, { hair: "pink" })).toHaveLength(0);
  });

  it("只看收藏按 key 过滤", () => {
    const items = buildGalleryItems("artist", data);
    expect(filterGalleryItems(items, { favoritesOnly: true, favorites: new Set(["artist:1"]) })).toHaveLength(1);
  });

  it("排序：热度降序、名称、随机可复现", () => {
    const items = buildGalleryItems("artist", data);
    expect(sortGalleryItems(items, "popular").map((item) => item.key)).toEqual(["artist:1", "artist:2"]);
    expect(sortGalleryItems(items, "name").map((item) => item.title)).toEqual([
      "dairi",
      "hammer (sunset beach)",
    ]);
    const a = sortGalleryItems(items, "random", 7).map((item) => item.key);
    const b = sortGalleryItems(items, "random", 7).map((item) => item.key);
    expect(a).toEqual(b);
  });

  it("筛选项去重并排序", () => {
    const costumeItems = buildGalleryItems("clothing", data);
    expect(uniqueValues(costumeItems, "categories")).toEqual(["礼服"]);
    expect(uniqueValues(costumeItems, "traits")).toEqual(["side slit"]);
    const characterItems = buildGalleryItems("character", data);
    expect(uniqueFacetValues(characterItems, "gender")).toEqual(["1boy", "1girl"]);
  });
});
