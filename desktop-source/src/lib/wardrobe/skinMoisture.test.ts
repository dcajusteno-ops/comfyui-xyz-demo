import { beforeAll, describe, expect, it } from "vitest";
import {
  SKIN_MOISTURE_ALL_TAGS,
  SKIN_MOISTURE_GROUPS,
  skinMoistureBanSet,
  skinMoistureGroupOptions,
  skinMoistureOnlyTagsFromSet,
  stripSkinMoisture,
} from "./skinMoisture";
import { primeWardrobeData } from "./testData";

beforeAll(() => primeWardrobeData());

describe("V6：干爽过滤", () => {
  it("5 组 / 19 条，且中文名全覆盖", () => {
    expect(Object.keys(SKIN_MOISTURE_GROUPS)).toHaveLength(5);
    expect(SKIN_MOISTURE_ALL_TAGS.size).toBe(19);
    const rows = skinMoistureGroupOptions();
    expect(rows).toHaveLength(5);
    for (const [, zh, tags] of rows) {
      expect(zh).toBeTruthy();
      expect(tags.length).toBeGreaterThan(0);
    }
  });

  it("only_tags 优先于 groups（all / none / csv / 空串）", () => {
    expect(skinMoistureBanSet("skin", "all").size).toBe(19);
    expect(skinMoistureBanSet("skin", "none").size).toBe(0);
    expect([...skinMoistureBanSet("", "rain,wet skin,不存在的词")].sort()).toEqual(["rain", "wet skin"]);
    // 空串回落 groups
    expect(skinMoistureBanSet("weather", "").size).toBe(7);
    // 不认识的组 → 空集（与插件一致：ignored，不误伤）
    expect(skinMoistureBanSet("nope", "").size).toBe(0);
  });

  it("流泪场景放行 glistening skin，其余照删", () => {
    const [kept, removed] = stripSkinMoisture(
      ["1girl", "glistening skin", "wet skin", "rain", "tears"],
      "",
      "all",
    );
    expect(kept).toEqual(["1girl", "glistening skin", "tears"]);
    expect(removed.sort()).toEqual(["rain", "wet skin"]);
  });

  it("没有泪光标记时 glistening skin 也被删", () => {
    const [kept, removed] = stripSkinMoisture(["1girl", "glistening skin"], "", "all");
    expect(kept).toEqual(["1girl"]);
    expect(removed).toEqual(["glistening skin"]);
  });
});

describe("V6：干爽过滤 · 逐条勾选回写", () => {
  it("全选写 all（不能写空串 —— 空串是回落分组，可能被用户缩窄过）", () => {
    expect(skinMoistureOnlyTagsFromSet(SKIN_MOISTURE_ALL_TAGS)).toBe("all");
    // 传进来大小写混写 / 词表外的垃圾也要能归一
    expect(skinMoistureOnlyTagsFromSet([...SKIN_MOISTURE_ALL_TAGS].map((x) => x.toUpperCase()))).toBe("all");
  });

  it("空集写 none，与「一条都不关」区分开", () => {
    expect(skinMoistureOnlyTagsFromSet([])).toBe("none");
    expect(skinMoistureOnlyTagsFromSet(["不存在的词"])).toBe("none");
  });

  it("部分勾选按词表顺序拼 csv，与点击顺序无关", () => {
    const a = skinMoistureOnlyTagsFromSet(["sweat", "wet skin"]);
    const b = skinMoistureOnlyTagsFromSet(["wet skin", "sweat"]);
    expect(a).toBe(b);
    expect(a).toBe("wet skin,sweat");
    // 回写后再解析，集合一致
    expect([...skinMoistureBanSet("", a)].sort()).toEqual(["sweat", "wet skin"]);
  });

  it("逐条勾选与按组勾选落到同一个集合（不会被回落语义偷偷放大）", () => {
    const groupTags = SKIN_MOISTURE_GROUPS.skin[1];
    const only = skinMoistureOnlyTagsFromSet(groupTags);
    expect([...skinMoistureBanSet("", only)].sort()).toEqual([...new Set(groupTags)].sort());
    // 关键：groups 只剩 weather 时，写回的 csv 也必须仍然只关 skin 组这 5 条
    expect([...skinMoistureBanSet("weather", only)].sort()).toEqual([...new Set(groupTags)].sort());
  });
});
