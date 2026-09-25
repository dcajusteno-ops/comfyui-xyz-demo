import { describe, expect, it } from "vitest";
import { applySpecialXyzPatch, buildXyzCombinations } from "./xyz";
import { makeAnimaParams, makeBaseParams } from "./paramBuilders";
import type { XyzAxis } from "../types";

function axis(field: XyzAxis["field"], values: string): XyzAxis {
  return { enabled: true, field, values };
}

describe("XYZ × Anima 轴", () => {
  it("阶段开关轴：on/off 两种取值生成两个组合，且 patch 落到 stages 上", () => {
    const combos = buildXyzCombinations([axis("animaStage_handDetailer", "on,off")]);
    expect(combos).toHaveLength(2);
    expect(combos[0].patch).toMatchObject({ stages: { handDetailer: true } });
    expect(combos[1].patch).toMatchObject({ stages: { handDetailer: false } });
    expect(combos[0].label).toBe("阶段：手部修复=on");
  });

  it("多种布尔写法都能识别（中文/1/yes）", () => {
    const truthy = ["on", "true", "1", "开", "yes"];
    for (const value of truthy) {
      const [combo] = buildXyzCombinations([axis("animaStage_faceDetailer", value)]);
      expect(combo.patch).toMatchObject({ stages: { faceDetailer: true } });
    }
    for (const value of ["off", "false", "0", "关"]) {
      const [combo] = buildXyzCombinations([axis("animaStage_faceDetailer", value)]);
      expect(combo.patch).toMatchObject({ stages: { faceDetailer: false } });
    }
  });

  it("放大倍率轴与精修参数轴落到 hires / refine", () => {
    const [pre] = buildXyzCombinations([axis("animaHiresPrePercent", "50")]);
    expect(pre.patch).toMatchObject({ hires: { prePercent: 50 } });
    const [post] = buildXyzCombinations([axis("animaHiresPostPercent", "0")]);
    expect(post.patch).toMatchObject({ hires: { postPercent: 0 } });
    const [dn] = buildXyzCombinations([axis("animaRefineDenoise", "0.3")]);
    expect(dn.patch).toMatchObject({ refine: { denoise: 0.3 } });
  });

  it("倍数轴支持区间语法", () => {
    const combos = buildXyzCombinations([axis("animaHiresPostPercent", "25..100..25")]);
    const values = combos.map((c) => (c.patch as unknown as { hires: { postPercent: number } }).hires.postPercent);
    expect(values).toEqual([25, 50, 75, 100]);
  });

  it("applySpecialXyzPatch 按层合并，不覆盖同层的其它字段", () => {
    const params = makeAnimaParams();
    params.hires.prePercent = 50;
    params.hires.postPercent = 50;
    params.stages.handDetailer = true;
    params.stages.faceDetailer = true;

    const [combo] = buildXyzCombinations([axis("animaStage_handDetailer", "off")]);
    const patched = applySpecialXyzPatch(params, combo);

    expect(patched.stages.handDetailer).toBe(false);
    // 同层其它字段保持不变
    expect(patched.stages.faceDetailer).toBe(true);
    expect(patched.stages.hiresFixPost).toBe(params.stages.hiresFixPost);
    expect(patched.hires.postPercent).toBe(50);
    // 不修改原对象
    expect(params.stages.handDetailer).toBe(true);
  });

  it("多个 Anima 轴可以叠加", () => {
    const combos = buildXyzCombinations([
      axis("animaStage_handDetailer", "on,off"),
      axis("animaHiresPostPercent", "25,50"),
    ]);
    expect(combos).toHaveLength(4);
    const patched = applySpecialXyzPatch(makeAnimaParams(), combos[3]);
    expect(patched.stages.handDetailer).toBe(false);
    expect(patched.hires.postPercent).toBe(50);
  });

  it("守卫：给 SD 系参数打 Anima 专属轴不会凭空造出 stages/hires/refine 键", () => {
    const sdParams = makeBaseParams("demo.safetensors");
    const combos = [
      ...buildXyzCombinations([axis("animaStage_handDetailer", "off")]),
      ...buildXyzCombinations([axis("animaHiresPostPercent", "25")]),
      ...buildXyzCombinations([axis("animaRefineSteps", "8")]),
    ];
    for (const combo of combos) {
      const patched = applySpecialXyzPatch(sdParams, combo) as unknown as Record<string, unknown>;
      expect(patched).not.toHaveProperty("stages");
      expect(patched).not.toHaveProperty("hires");
      expect(patched).not.toHaveProperty("refine");
      // 原有字段不受影响
      expect(patched.checkpoint).toBe("demo.safetensors");
    }
  });

  it("常规轴对 Anima 与 SD 系都照常工作（不回归）", () => {
    const combos = buildXyzCombinations([axis("cfg", "5,7")]);
    expect(combos.map((c) => c.patch.cfg)).toEqual([5, 7]);
    expect(applySpecialXyzPatch(makeAnimaParams(), combos[1]).cfg).toBe(7);
    expect(applySpecialXyzPatch(makeBaseParams("m.safetensors"), combos[1]).cfg).toBe(7);
  });
});
