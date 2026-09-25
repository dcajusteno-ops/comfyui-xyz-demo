import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useXyz, type XyzParamsBundle } from "./useXyz";
import type { LoraSelection } from "../types";

/**
 * useXyz 单测（补齐零覆盖缺口）。
 * hook 用 useLocalStorageState 持久化 target/axes——jsdom 的 localStorage 隔离由测试环境保证。
 */

const lorasFor = (names: string[]): LoraSelection[] =>
  names.map((name) => ({ name, strength: 1, clipStrength: 1, active: true }));

const bundle = (names: string[]): XyzParamsBundle => ({
  defaultParams: { loras: lorasFor(names) } as XyzParamsBundle["defaultParams"],
  multiParams: { loras: lorasFor(["multiA"]) } as XyzParamsBundle["multiParams"],
  highresParams: { loras: lorasFor(["highresA"]) } as XyzParamsBundle["highresParams"],
  animaParams: { loras: lorasFor(["animaA"]) } as XyzParamsBundle["animaParams"],
});

describe("useXyz", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("默认值：target=default，三行预置轴（seed 启用 / cfg、steps 备用）", () => {
    const { result } = renderHook(() => useXyz());
    expect(result.current.xyzTarget).toBe("default");
    expect(result.current.xyzAxes).toEqual([
      { enabled: true, field: "seed", values: "1,2" },
      { enabled: false, field: "cfg", values: "5,7" },
      { enabled: false, field: "steps", values: "20..30..10" },
    ]);
    expect(result.current.xyzExcludedIndices.size).toBe(0);
    expect(result.current.showXyzHelp).toBe(false);
  });

  it("getXyzLoras：按 target 从对应模板参数取 LoRA 列表", () => {
    const { result } = renderHook(() => useXyz());
    const params = bundle(["A", "B"]);
    expect(result.current.getXyzLoras(params).map((l) => l.name)).toEqual(["A", "B"]);

    act(() => { result.current.setXyzTarget("multi"); });
    expect(result.current.getXyzLoras(params).map((l) => l.name)).toEqual(["multiA"]);

    act(() => { result.current.setXyzTarget("highres"); });
    expect(result.current.getXyzLoras(params).map((l) => l.name)).toEqual(["highresA"]);

    act(() => { result.current.setXyzTarget("anima"); });
    expect(result.current.getXyzLoras(params).map((l) => l.name)).toEqual(["animaA"]);
  });

  it("toggleXyzIndex：集合切换语义（加 → 删），且不影响其它成员", () => {
    const { result } = renderHook(() => useXyz());
    act(() => {
      result.current.toggleXyzIndex(0);
      result.current.toggleXyzIndex(2);
    });
    expect([...result.current.xyzExcludedIndices].sort()).toEqual([0, 2]);

    act(() => { result.current.toggleXyzIndex(0); });
    expect([...result.current.xyzExcludedIndices]).toEqual([2]);
  });

  it("setXyzAxes：新轴列表写入并持久化到 localStorage（重挂载可读回）", () => {
    const first = renderHook(() => useXyz());
    const nextAxes = [{ enabled: true, field: "cfg" as const, values: "5,7,9" }];
    act(() => { first.result.current.setXyzAxes(nextAxes); });
    expect(first.result.current.xyzAxes).toEqual(nextAxes);

    // localStorage 持久化：新实例读回同一份
    const second = renderHook(() => useXyz());
    expect(second.result.current.xyzAxes).toEqual(nextAxes);
  });
});
