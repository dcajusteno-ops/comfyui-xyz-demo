import { describe, expect, it } from "vitest";
import { WardrobeRandom, clampProb, crc32, deriveSeed, pyRound } from "./rng";

/**
 * 基准值全部由本机 Python 3.13（插件同款 ``）的 random.Random(seed) 生成。
 * 这些字面量是「同 seed 逐字一致」这条承诺的地基，改动 RNG 时它们必须先红。
 */
const RANDOM_FIXTURES: Record<string, string[]> = {
  "0": [
    "0.8444218515250481",
    "0.7579544029403025",
    "0.420571580830845",
    "0.25891675029296335",
    "0.5112747213686085",
    "0.4049341374504143",
    "0.7837985890347726",
    "0.30331272607892745",
    "0.4765969541523558",
    "0.5833820394550312",
  ],
  "42": [
    "0.6394267984578837",
    "0.025010755222666936",
    "0.27502931836911926",
    "0.22321073814882275",
    "0.7364712141640124",
    "0.6766994874229113",
    "0.8921795677048454",
    "0.08693883262941615",
    "0.4219218196852704",
    "0.029797219438070344",
  ],
  "4294967295": [
    "0.6353574441341173",
    "0.20319993954407756",
    "0.6073666030347188",
    "0.29133552762158776",
    "0.3400278163075766",
    "0.3811162164237829",
    "0.6885722791691622",
    "0.8779348201241423",
    "0.27965726967964466",
    "0.8974354974718768",
  ],
};

describe("WardrobeRandom（CPython MT19937）", () => {
  for (const [seed, expected] of Object.entries(RANDOM_FIXTURES)) {
    it(`seed=${seed} 的前 10 个 random() 与 CPython 一致`, () => {
      const rng = new WardrobeRandom(Number(seed));
      const actual = expected.map(() => rng.random());
      expect(actual).toEqual(expected.map(Number));
    });
  }

  it("sample(range(2383), 3) 走「选中集合」分支", () => {
    const rng = new WardrobeRandom(42);
    expect(rng.sample(Array.from({ length: 2383 }, (_, i) => i), 3)).toEqual([456, 102, 1126]);
  });

  it("sample(range(50), 7) 走「pool 交换」分支", () => {
    const rng = new WardrobeRandom(42);
    expect(rng.sample(Array.from({ length: 50 }, (_, i) => i), 7)).toEqual([40, 7, 1, 17, 15, 14, 8]);
  });

  it("小池 sample 与 CPython 一致", () => {
    const a = new WardrobeRandom(7);
    expect(a.sample(Array.from({ length: 30 }, (_, i) => i), 5)).toEqual([10, 4, 12, 20, 1]);
    const b = new WardrobeRandom(7);
    expect(b.sample(Array.from({ length: 6 }, (_, i) => i), 5)).toEqual([2, 1, 3, 5, 0]);
  });

  it("getstate/setstate 可精确回放（插件用它复制 pre_rng）", () => {
    const rng = new WardrobeRandom(123);
    for (let i = 0; i < 17; i += 1) rng.random();
    const saved = rng.getstate();
    const first = [rng.random(), rng.random(), rng.random()];
    rng.setstate(saved);
    expect([rng.random(), rng.random(), rng.random()]).toEqual(first);
  });

  it("clone 不共享底层状态", () => {
    const rng = new WardrobeRandom(9);
    const copy = rng.clone();
    expect(copy.random()).toBe(rng.random());
    expect(copy.random()).toBe(rng.random());
  });
});

describe("Python 兼容小工具", () => {
  it("crc32 与 zlib.crc32 一致（UTF-8）", () => {
    expect(["a", "hello", "中文", "hatsune miku"].map(crc32)).toEqual([
      3904355907, 907060870, 1510599991, 2091957916,
    ]);
  });

  it("deriveSeed 与插件 derive_seed 一致", () => {
    expect([deriveSeed(42, "density", 1), deriveSeed(42, "level_floor", 2), deriveSeed("sc_rain_street_lookback", "scene_level", 0)]).toEqual([
      3325635991, 2915477129, 2837948209,
    ]);
  });

  it("pyRound 是银行家舍入", () => {
    const cases: Array<[number, number, number]> = [
      [0.3125, 3, 0.312],
      [0.9375, 3, 0.938],
      [2.675, 2, 2.67],
      [1.005, 2, 1.0],
      [0.925, 3, 0.925],
      [0.4875, 3, 0.487],
      [1.8, 3, 1.8],
    ];
    for (const [value, nd, expected] of cases) expect(pyRound(value, nd)).toBe(expected);
  });

  it("clampProb 收敛到 [0,1]", () => {
    expect([clampProb(-1), clampProb(0.3), clampProb(2), clampProb(Number.NaN)]).toEqual([
      0, 0.3, 1, 1,
    ]);
  });
});
