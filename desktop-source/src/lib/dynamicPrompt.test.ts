import { beforeEach, describe, expect, it } from "vitest";
import {
  detectDynamicSyntax,
  hashSeed,
  mulberry32,
  resolveChoices,
  resolveDynamicPrompt,
  resolveWildcards,
  setWildcardRegistry,
} from "./dynamicPrompt";

describe("resolveChoices", () => {
  it("从多选项中选一（确定性随机）", () => {
    const rng = mulberry32(1);
    const r1 = resolveChoices("{a|b|c}", rng);
    const r2 = resolveChoices("{a|b|c}", mulberry32(1));
    expect(["a", "b", "c"]).toContain(r1);
    expect(r2).toBe(r1);
  });

  it("无竖线的花括号块按字面量保留", () => {
    expect(resolveChoices("{tag}", mulberry32(1))).toBe("{tag}");
  });

  it("转义花括号按字面量输出", () => {
    expect(resolveChoices("\\{a\\}", mulberry32(1))).toBe("{a}");
  });

  it("未闭合花括号原样保留", () => {
    expect(resolveChoices("{a|b", mulberry32(1))).toBe("{a|b");
  });
});

describe("resolveWildcards", () => {
  beforeEach(() => {
    setWildcardRegistry({ lighting: ["sunset", "dawn", "night"] });
  });

  it("命中词库时随机抽一行", () => {
    const value = resolveWildcards("__lighting__", mulberry32(7));
    expect(["sunset", "dawn", "night"]).toContain(value);
  });

  it("缺失名字保留原文", () => {
    expect(resolveWildcards("__nope__", mulberry32(1))).toBe("__nope__");
  });

  it("空词库保留原文", () => {
    setWildcardRegistry({ empty: [] });
    expect(resolveWildcards("__empty__", mulberry32(1))).toBe("__empty__");
  });
});

describe("resolveDynamicPrompt", () => {
  beforeEach(() => {
    setWildcardRegistry({ style: ["flat", "watercolor"] });
  });

  it("同 seed 结果可复现", () => {
    const text = "{1girl|1boy}, __style__";
    expect(resolveDynamicPrompt(text, 42)).toBe(resolveDynamicPrompt(text, 42));
  });

  it("不同 seed 可能产生不同结果", () => {
    const text = "{a|b|c|d|e|f|g|h|i|j}";
    const results = new Set(Array.from({ length: 20 }, (_, i) => resolveDynamicPrompt(text, i)));
    expect(results.size).toBeGreaterThan(1);
  });

  it("多选展开后再解析通配符", () => {
    const value = resolveDynamicPrompt("{__style__|pixel}", 1);
    expect(["flat", "watercolor", "pixel"]).toContain(value);
  });
});

describe("detectDynamicSyntax", () => {
  it("统计多选与通配符数量", () => {
    expect(detectDynamicSyntax("{a|b} {c|d} __x__")).toEqual({ choices: 2, wildcards: 1 });
    expect(detectDynamicSyntax("普通提示词")).toEqual({ choices: 0, wildcards: 0 });
  });
});

describe("PRNG", () => {
  it("hashSeed 稳定", () => {
    expect(hashSeed(42)).toBe(hashSeed("42"));
    expect(hashSeed("42")).toBe(hashSeed("42"));
  });
});