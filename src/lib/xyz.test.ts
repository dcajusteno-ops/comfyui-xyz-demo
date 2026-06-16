import { describe, expect, it } from "vitest";
import type { BaseGenerationParams } from "../types";
import { applySpecialXyzPatch, buildXyzCombinations, fieldLabel, parseAxisValues } from "./xyz";

const params: BaseGenerationParams = {
  checkpoint: "anything-v5-PrtRE.safetensors",
  positivePrompt: "base",
  negativePrompt: "",
  width: 512,
  height: 768,
  batchSize: 1,
  seed: 1,
  randomizeSeed: false,
  steps: 20,
  cfg: 7,
  samplerName: "euler",
  scheduler: "simple",
  denoise: 1,
  filenamePrefix: "test",
  loras: [{ name: "demo", strength: 1, clipStrength: 1, active: true }],
};

describe("xyz utilities", () => {
  it("parses comma values and numeric ranges", () => {
    expect(parseAxisValues("1, 2, 3", "steps")).toEqual([1, 2, 3]);
    expect(parseAxisValues("1..2..0.5", "cfg")).toEqual([1, 1.5, 2]);
    expect(parseAxisValues("3..1..1", "seed")).toEqual([3, 2, 1]);
    expect(parseAxisValues("euler, ddim", "samplerName")).toEqual(["euler", "ddim"]);
  });

  it("builds Cartesian combinations in stable order", () => {
    const combos = buildXyzCombinations([
      { enabled: true, field: "steps", values: "10,20" },
      { enabled: true, field: "cfg", values: "5,7" },
      { enabled: false, field: "seed", values: "1,2" },
    ]);
    expect(combos).toHaveLength(4);
    expect(combos[0].patch).toEqual({ steps: 10, cfg: 5 });
    expect(combos[3].patch).toEqual({ steps: 20, cfg: 7 });
  });

  it("applies prompt append and first lora strength patches", () => {
    const combo = buildXyzCombinations([
      { enabled: true, field: "positiveAppend", values: "detail" },
      { enabled: true, field: "loraStrength_0", values: "0.4" },
    ])[0];
    const patched = applySpecialXyzPatch(params, combo);
    expect(patched.positivePrompt).toBe("base\ndetail");
    expect(patched.loras[0].strength).toBe(0.4);
  });

  it("uses Chinese labels for UI previews", () => {
    expect(fieldLabel("width")).toBe("宽");
    expect(fieldLabel("loraStrength_0")).toBe("LoRA 1 强度");
    expect(fieldLabel("positiveAppend")).toBe("正向追加");
  });
});
