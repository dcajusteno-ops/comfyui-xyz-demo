import { describe, expect, it } from "vitest";
import {
  defaultComposerState,
  defaultGachaOptions,
  defaultGalleryState,
  normalizeComposerState,
  normalizeDanbooruSettings,
  normalizeDanbooruState,
  normalizeFavorites,
  normalizeGachaOptions,
  normalizeGachaState,
  normalizeGalleryState,
} from "./persist";

describe("持久化修复", () => {
  it("拼接台：非字符串值回退为空串，未知键丢弃", () => {
    const state = normalizeComposerState({
      ...defaultComposerState,
      values: {
        ...defaultComposerState.values,
        artist: 123,
        extra: "depth of field",
        unknown: "x",
      } as unknown as typeof defaultComposerState.values,
      dedupe: "yes" as unknown as boolean,
    });
    expect(state.values.artist).toBe("");
    expect(state.values.extra).toBe("depth of field");
    expect(state.values).not.toHaveProperty("unknown");
    expect(state.dedupe).toBe(false);
  });

  it("收藏：过滤非字符串、去重、每区最多 2000", () => {
    const many = Array.from({ length: 2100 }, (_, index) => `artist:${index}`);
    const state = normalizeFavorites({
      version: 1,
      items: { artist: [...many, "artist:0", 42 as unknown as string], character: "bad" as unknown as string[] },
    });
    expect(state.items.artist).toHaveLength(2000);
    expect(state.items.artist?.[0]).toBe("artist:0");
    expect(state.items.artist?.[1999]).toBe("artist:1999");
    expect(state.items.character).toBeUndefined();
  });

  it("抽卡参数：越界值 clamp，非法枚举回默认", () => {
    const options = normalizeGachaOptions({
      ...defaultGachaOptions(),
      seed: -99,
      artistCount: 999,
      characterTagCount: -4,
      characterDetail: "wat",
      clothingSource: "nope",
    });
    expect(options.seed).toBe(-1);
    expect(options.artistCount).toBe(20);
    expect(options.characterTagCount).toBe(0);
    expect(options.characterDetail).toBe("trigger");
    expect(options.clothingSource).toBe("author");
  });

  it("抽卡状态：last 结构异常时丢弃，不阻止参数加载", () => {
    const state = normalizeGachaState({
      version: 1,
      options: { ...defaultGachaOptions(), seed: 42 },
      last: { text: 1, sections: null } as never,
    });
    expect(state.options.seed).toBe(42);
    expect(state.last).toBeUndefined();
  });

  it("Danbooru 设置：非法尺寸回 sample，分组缺省补齐", () => {
    const settings = normalizeDanbooruSettings({
      query: "1girl",
      size: "huge",
      groups: { artist: true },
    });
    expect(settings.query).toBe("1girl");
    expect(settings.size).toBe("sample");
    expect(settings.groups).toEqual({
      artist: true,
      character: true,
      copyright: true,
      general: true,
      meta: false,
    });
  });

  it("Danbooru 旧存档：查询串里的 rating 迁移到多选字段", () => {
    const settings = normalizeDanbooruSettings({ query: "rating:explicit 1girl solo" });
    expect(settings.query).toBe("1girl solo");
    expect(settings.ratings).toEqual(["e"]);
  });

  it("Danbooru 旧存档：rating:g,s 与单个 rating 字段都转成数组", () => {
    expect(normalizeDanbooruSettings({ query: "rating:g,s 1girl" }).ratings).toEqual(["g", "s"]);
    expect(normalizeDanbooruSettings({ rating: "q" }).ratings).toEqual(["q"]);
  });

  it("Danbooru 分级：非法值回默认全年龄，all 表示不限（空数组）", () => {
    expect(normalizeDanbooruSettings({ ratings: ["wat"] }).ratings).toEqual(["g"]);
    expect(normalizeDanbooruSettings({ rating: "all" }).ratings).toEqual([]);
    expect(normalizeDanbooruSettings({ ratings: ["e", "g", "e"] }).ratings).toEqual(["g", "e"]);
  });

  it("Danbooru 上次结果异常时不展示", () => {
    const state = normalizeDanbooruState({
      version: 1,
      settings: { ...normalizeDanbooruSettings({}), query: "solo" },
      last: { id: "777", imageUrl: 1 } as never,
    });
    expect(state.settings.query).toBe("solo");
    expect(state.last).toBeUndefined();
  });

  it("画廊状态：非法视图/分区/分页回默认，合法值保留", () => {
    expect(normalizeGalleryState({ ...defaultGalleryState, activeView: "wat" as never, pageSize: 999 })).toMatchObject({
      activeView: "gallery",
      pageSize: 48,
    });
    expect(
      normalizeGalleryState({
        ...defaultGalleryState,
        activeView: "gacha",
        section: "clothing",
        sort: "random",
        pageSize: 24,
      }),
    ).toMatchObject({ activeView: "gacha", section: "clothing", sort: "random", pageSize: 24 });
  });
});
