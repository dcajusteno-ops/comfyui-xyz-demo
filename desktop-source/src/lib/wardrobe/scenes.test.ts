import { beforeAll, describe, expect, it } from "vitest";
import { WardrobeRandom } from "./rng";
import { applyPreset, scenePreset, splitByLevel, trimToCap } from "./scenes";
import { primeWardrobeData, readLocalFixture } from "./testData";
import { emptyWeights } from "./weights";

beforeAll(() => primeWardrobeData());

type SceneCase = {
  id: string;
  level: number;
  preset: Record<string, string>;
  filled: string[];
  state: Record<string, unknown>;
};
type TrimCase = {
  input: Record<string, unknown>;
  cap: number;
  weights: { sections: Record<string, number>; fields: Record<string, number>; options: Record<string, Record<string, number>> };
  dropped: string[];
  state: Record<string, unknown>;
};

const fixture = readLocalFixture<{
  scenes: SceneCase[];
  trim: TrimCase[];
  split: Array<{ text: string; lv: number; keep: string; removed: string[] }>;
}>("scene-cases.json");

describe("场景预设", () => {
  it("261 条 scenePreset 与插件一致", () => {
    for (const item of fixture.scenes) expect(scenePreset(item.id)).toEqual(item.preset);
  });

  it("261 条 applyPreset（同 seed）与插件一致", () => {
    const bad: Array<{ id: string; filled?: unknown; state?: unknown }> = [];
    for (const item of fixture.scenes) {
      const state: Record<string, unknown> = {};
      const filled = applyPreset(state, item.id, item.level, emptyWeights(), [], new WardrobeRandom(42));
      if (JSON.stringify(filled) !== JSON.stringify(item.filled) || JSON.stringify(state) !== JSON.stringify(item.state)) {
        bad.push({ id: item.id, filled, state });
      }
    }
    expect(bad.slice(0, 3)).toEqual([]);
    expect(bad.length).toBe(0);
  });
});

describe("trimToCap", () => {
  it("按权重削到上限，protected 字段不动", () => {
    for (const item of fixture.trim) {
      const state = structuredClone(item.input);
      expect(trimToCap(state, item.cap, item.weights)).toEqual(item.dropped);
      expect(state).toEqual(item.state);
    }
  });
});

describe("splitByLevel", () => {
  it("逐标签按档位切开", () => {
    for (const item of fixture.split) {
      expect(splitByLevel(item.text, item.lv)).toEqual([item.keep, item.removed]);
    }
  });
});
