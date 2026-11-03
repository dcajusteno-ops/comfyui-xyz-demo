import { beforeAll, describe, expect, it } from "vitest";
import { anchorOf, colorize, fieldOptionBias, styleBans, styleBias } from "./outfitStyle";
import { primeWardrobeData, readLocalFixture } from "./testData";

beforeAll(() => primeWardrobeData());

type StyleCase = {
  state: Record<string, unknown>;
  choice: string;
  anchor: [string, string];
  bansShoes: string[];
  biasOutfit: number;
  biasTop: number;
  makeupBias: number;
  placeBias: number;
  colorBias: number;
};
type ColorCase = { input: Record<string, unknown>; notes: string[]; state: Record<string, unknown> };

const fixture = readLocalFixture<{ style: StyleCase[]; colorize: ColorCase[] }>("char-style-cases.json");

describe("风格智配", () => {
  it("锚点 / 铁律 / 三层偏置与插件一致", () => {
    for (const item of fixture.style) {
      expect(anchorOf(item.state, item.choice)).toEqual(item.anchor);
      expect([...styleBans(item.state, "shoes", item.choice)].sort()).toEqual(item.bansShoes);
      expect(styleBias(item.state, "outfit", "school uniform", item.choice)).toBeCloseTo(item.biasOutfit, 10);
      expect(styleBias(item.state, "top", "t-shirt", item.choice)).toBeCloseTo(item.biasTop, 10);
      expect(fieldOptionBias("makeup", item.choice, "pale skin, black lipstick, eyeshadow")).toBeCloseTo(item.makeupBias, 10);
      expect(fieldOptionBias("place", item.choice, "classroom")).toBeCloseTo(item.placeBias, 10);
      expect(fieldOptionBias("cloth_color", item.choice, "black")).toBeCloseTo(item.colorBias, 10);
    }
  });
});

describe("颜色合成", () => {
  it("有效组合拼接 / 无效组合退化 / 已带颜色跳过", () => {
    for (const item of fixture.colorize) {
      const state = structuredClone(item.input);
      const notes = colorize(state);
      expect(state).toEqual(item.state);
      expect(notes).toEqual(item.notes);
    }
  });
});
