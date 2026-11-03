import { beforeAll, describe, expect, it } from "vitest";
import { collect } from "./collect";
import { applyMutex } from "./mutex";
import { repairTags } from "./repair";
import { sanitize } from "./sanitize";
import { primeWardrobeData, readLocalFixture } from "./testData";
import { DEFAULT_WEIGHT, dumpWeights, emptyWeights, parseWeights, validateWeights, weightStats } from "./weights";

beforeAll(() => primeWardrobeData());

type SanitizeCase = {
  name: string;
  input: Record<string, unknown>;
  cleared: string[];
  state: Record<string, unknown>;
};
type RepairCase = { name: string; tags: string[]; lv: number; result: [string[], string[]] };
type CollectCase = { name: string; input: Record<string, unknown>; out: string[] };

describe("sanitize：与插件逐例对拍", () => {
  const cases = readLocalFixture<{ sanitize: SanitizeCase[] }>("core-cases.json").sanitize;
  for (const item of cases) {
    it(item.name, () => {
      const state = structuredClone(item.input);
      const cleared = sanitize(state);
      expect(state).toEqual(item.state);
      expect(cleared).toEqual(item.cleared);
    });
  }
});

describe("repair：与插件逐例对拍", () => {
  const cases = readLocalFixture<{ repair: RepairCase[] }>("core-cases.json").repair;
  for (const item of cases) {
    it(item.name, () => {
      const [tags, fixes] = repairTags(item.tags, item.lv);
      expect(tags).toEqual(item.result[0]);
      expect(fixes).toEqual(item.result[1]);
    });
  }
});

describe("collect：槽位顺序与去重", () => {
  const cases = readLocalFixture<{ collect: CollectCase[] }>("core-cases.json").collect;
  for (const item of cases) {
    it(item.name, () => {
      expect(collect(item.input)).toEqual(item.out);
    });
  }

  it("n_canon 不进正文", () => {
    expect(collect({ count: "1girl", n_canon: "c1" })).toEqual(["1girl"]);
  });

  it("tail_extra 追加在末尾且不重复", () => {
    expect(collect({ count: "1girl, solo", emotion: "smile" }, "pointy ears, smile")).toEqual([
      "1girl",
      "solo",
      "smile",
      "pointy ears",
    ]);
  });
});

describe("mutex：显式写入优先", () => {
  it("全裸 × 整套服装：B 侧随机 → 剔 B", () => {
    expect(applyMutex(["completely nude", "school uniform"])).toEqual(["completely nude"]);
  });

  it("B 侧显式 → 反向剔 A 侧随机", () => {
    expect(applyMutex(["completely nude", "school uniform"], ["school uniform"])).toEqual(["school uniform"]);
  });

  it("两侧都显式 → 谁也不动", () => {
    expect(applyMutex(["completely nude", "school uniform"], ["completely nude", "school uniform"])).toEqual([
      "completely nude",
      "school uniform",
    ]);
  });
});

describe("weights", () => {
  it("脏数据一律回落空表", () => {
    for (const raw of ["", "[]", "null", "{bad", 42, null, undefined]) {
      expect(parseWeights(raw)).toEqual(emptyWeights());
    }
  });

  it("值 clamp 到 [0,3]，非法项丢弃而不是当 0", () => {
    const parsed = parseWeights({
      sections: { hair: 9, face: -2, body: "abc", makeup: "0.5" },
      fields: { hair_color: 3.5 },
      options: { emotion: { BLUSH: 3, grin: "nan" } },
    });
    expect(parsed.sections).toEqual({ hair: 3, face: 0, makeup: 0.5 });
    expect(parsed.fields).toEqual({ hair_color: 3 });
    expect(parsed.options).toEqual({ emotion: { blush: 3 } });
  });

  it("dump 只写非默认项，且可被 parse 读回", () => {
    const weights = {
      sections: { hair: 0.5, face: DEFAULT_WEIGHT },
      fields: {},
      options: { emotion: { blush: 3 } },
    };
    const text = dumpWeights(weights);
    expect(text).toContain('"hair": 0.5');
    expect(text).not.toContain('"face"');
    expect(parseWeights(text)).toEqual({ sections: { hair: 0.5 }, fields: {}, options: { emotion: { blush: 3 } } });
  });

  it("weightStats 统计调过的项", () => {
    expect(weightStats({ sections: { hair: 2 }, fields: { prop: 0 }, options: { emotion: { blush: 3 } } })).toEqual({
      sections: 1,
      fields: 1,
      options: 1,
      total: 3,
    });
  });

  it("validateWeights 报未知键但不抛", () => {
    const bad = validateWeights({
      sections: { nope: 1 },
      fields: { nope: 1 },
      options: { emotion: { nope: 1 } },
    });
    expect(bad).toHaveLength(3);
  });
});
