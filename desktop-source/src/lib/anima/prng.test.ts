import { describe, expect, it } from "vitest";
import { createRng, pickOne, randomSeed, sampleItems, sampleParts } from "./prng";

describe("Anima 抽卡随机源", () => {
  it("同一种子产生完全相同的序列", () => {
    const a = createRng(123456);
    const b = createRng(123456);
    const left = Array.from({ length: 8 }, () => a());
    const right = Array.from({ length: 8 }, () => b());
    expect(left).toEqual(right);
  });

  it("不同种子的序列不同", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(Array.from({ length: 4 }, () => a())).not.toEqual(Array.from({ length: 4 }, () => b()));
  });

  it("sampleItems 不取重复项", () => {
    const rng = createRng(7);
    const source = ["a", "b", "c", "d", "e"];
    const picked = sampleItems(rng, source, 3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
  });

  it("sampleItems 在 count 超过总数时返回打乱后的全量", () => {
    const rng = createRng(11);
    const source = ["a", "b", "c", "d"];
    const picked = sampleItems(rng, source, 10);
    expect(picked).toHaveLength(source.length);
    expect(new Set(picked).size).toBe(source.length);
    // 同一 seed 再跑一次仍一致（说明是确定性洗牌而非原样返回）
    expect(sampleItems(createRng(11), source, 10)).toEqual(picked);
  });

  it("sampleParts 在 count 超过总数时保持原序", () => {
    const rng = createRng(3);
    expect(sampleParts(rng, ["a", "b", "c"], 10)).toEqual(["a", "b", "c"]);
  });

  it("count=0 返回空数组且不消耗随机数", () => {
    const rng = createRng(5);
    const before = rng();
    const rng2 = createRng(5);
    expect(sampleItems(rng2, ["a"], 0)).toEqual([]);
    expect(sampleParts(rng2, ["a"], 0)).toEqual([]);
    expect(rng2()).toBe(before);
  });

  it("pickOne 对空数组返回 undefined", () => {
    expect(pickOne(createRng(1), [])).toBeUndefined();
  });

  it("randomSeed 是非负 31 位整数", () => {
    for (let i = 0; i < 10; i += 1) {
      const seed = randomSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 31);
    }
  });
});
