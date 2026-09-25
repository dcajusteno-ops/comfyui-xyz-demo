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

  it("expands numeric ranges: fractional endpoints default step 0.1, integer endpoints default step 1", () => {
    // 强度类小数范围（用户写法 0.4..1.0）——缺省步进 0.1
    expect(parseAxisValues("0.4..1.0", "loraAppendStrength_1")).toEqual([0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    // 倒序 / 显式小数步进
    expect(parseAxisValues("1.0..0.4", "loraAppendStrength_1")).toEqual([1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4]);
    expect(parseAxisValues("0.4..1.0..0.2", "loraStrength_0")).toEqual([0.4, 0.6, 0.8, 1]);
    // 整数端点缺省步进仍为 1（seed/步数语义不变）
    expect(parseAxisValues("1..3", "seed")).toEqual([1, 2, 3]);
    // 范围可与普通枚举值混填（逗号分隔）
    expect(parseAxisValues("0.2, 0.4..0.6", "loraAppendStrength_1")).toEqual([0.2, 0.4, 0.5, 0.6]);
    // 非法范围原样保留（不误伤普通值）
    expect(parseAxisValues("0.4..", "cfg")).toEqual(["0.4.."]);
    expect(parseAxisValues("a..b", "cfg")).toEqual(["a..b"]);
    // 非数值轴不做范围展开
    expect(parseAxisValues("a..b", "positiveAppend")).toEqual(["a..b"]);
  });

  it("expands LoRA library index ranges into real file names", () => {
    const lib = ["a.safetensors", "b.safetensors", "c.safetensors", "d.safetensors"];
    // 基础范围（1 起始）
    expect(parseAxisValues("1..3", "loraName_0", lib)).toEqual(["a.safetensors", "b.safetensors", "c.safetensors"]);
    // 步进 / 倒序
    expect(parseAxisValues("1..4..2", "loraName_0", lib)).toEqual(["a.safetensors", "c.safetensors"]);
    expect(parseAxisValues("3..1", "loraName_0", lib)).toEqual(["c.safetensors", "b.safetensors", "a.safetensors"]);
    // 花括号展开 + 单个序号
    expect(parseAxisValues("{2..3}", "loraName_0", lib)).toEqual(["b.safetensors", "c.safetensors"]);
    expect(parseAxisValues("2", "loraName_0", lib)).toEqual(["b.safetensors"]);
    // 全库 + 越界丢弃 + 与文件名混填
    expect(parseAxisValues("*", "loraName_0", lib)).toEqual(lib);
    expect(parseAxisValues("2..99", "loraName_0", lib)).toEqual(["b.safetensors", "c.safetensors", "d.safetensors"]);
    expect(parseAxisValues("a.safetensors, 2..3", "loraAppendName_1", lib)).toEqual([
      "a.safetensors",
      "b.safetensors",
      "c.safetensors",
    ]);
    // 通配符：前缀 / 中段 / ? 单字符，文件名带不带 .safetensors 都能命中
    const epochs = ["my_model_123_epoch 1.safetensors", "my_model_123_epoch 2.safetensors", "other_model.safetensors"];
    expect(parseAxisValues("my_model*", "loraName_0", epochs)).toEqual([
      "my_model_123_epoch 1.safetensors",
      "my_model_123_epoch 2.safetensors",
    ]);
    expect(parseAxisValues("*epoch 2*", "loraName_0", epochs)).toEqual(["my_model_123_epoch 2.safetensors"]);
    expect(parseAxisValues("my_model_123_epoch ?", "loraName_0", epochs)).toEqual([
      "my_model_123_epoch 1.safetensors",
      "my_model_123_epoch 2.safetensors",
    ]);
    // 不匹配任何项时为空（无合法组合）
    expect(parseAxisValues("zzz*", "loraName_0", epochs)).toEqual([]);
    // 模型名 + 花括号序号范围：直接拼出文件名（带前缀不会被库序号映射劫持）
    expect(parseAxisValues("my_model_epoch{1..6..2}", "loraName_0", epochs)).toEqual([
      "my_model_epoch1",
      "my_model_epoch3",
      "my_model_epoch5",
    ]);
    // 无库（离线）时同样照常展开
    expect(parseAxisValues("my_model_epoch{1..2}", "loraName_0")).toEqual(["my_model_epoch1", "my_model_epoch2"]);
    // 不传库时保持字面值（旧行为不回归）
    expect(parseAxisValues("1..3", "loraName_0")).toEqual(["1..3"]);
    expect(parseAxisValues("1..3", "seed")).toEqual([1, 2, 3]);
  });

  it("builds lora model combinations from library ranges", () => {
    const lib = ["a.safetensors", "b.safetensors"];
    const combos = buildXyzCombinations(
      [{ enabled: true, field: "loraName_0", values: "1..2" }],
      [{ name: "demo" }],
      undefined,
      lib
    );
    expect(combos).toHaveLength(2);
    expect(combos[0].label).toBe("替换 demo 模型=a.safetensors");
    expect(combos[1].patch.loras?.[0]).toMatchObject({ name: "__LORA_NAME_0__", patchName: "b.safetensors" });
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
