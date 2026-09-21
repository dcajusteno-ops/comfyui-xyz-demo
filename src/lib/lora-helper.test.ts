import { describe, expect, it } from "vitest";
import { parseComboEntry, readCombo } from "./lora-helper";

/** 旧格式（绝大多数节点）：entry[0] 即选项数组 */
const legacyPayload = {
  UNETLoader: {
    input: {
      required: {
        unet_name: [["a.safetensors", "b.safetensors"]],
      },
    },
  },
};

/** 新格式（实测 UpscaleModelLoader 等核心节点）：["COMBO", { options: [...] }] */
const comboPayload = {
  UpscaleModelLoader: {
    input: {
      required: {
        model_name: ["COMBO", { multiselect: false, options: ["4x_foolhardy_Remacri.pth"] }],
      },
    },
  },
};

const optionalPayload = {
  CLIPLoader: {
    input: {
      required: { clip_name: [["qwen_3_06b_base.safetensors"]] },
      optional: { device: ["COMBO", { options: ["default", "cpu"] }] },
    },
  },
};

describe("readCombo / parseComboEntry", () => {
  it("reads legacy array-of-array format", () => {
    expect(readCombo(legacyPayload, "UNETLoader", "unet_name", ["fallback"])).toEqual([
      "a.safetensors",
      "b.safetensors",
    ]);
  });

  it("reads new COMBO format instead of silently falling back", () => {
    expect(readCombo(comboPayload, "UpscaleModelLoader", "model_name", ["fallback"])).toEqual([
      "4x_foolhardy_Remacri.pth",
    ]);
  });

  it("reads COMBO format declared on optional inputs", () => {
    expect(readCombo(optionalPayload, "CLIPLoader", "device", ["fallback"])).toEqual(["default", "cpu"]);
  });

  it("returns fallback for unknown node or input", () => {
    expect(readCombo(legacyPayload, "Nope", "nope", ["f"])).toEqual(["f"]);
    expect(readCombo(legacyPayload, "UNETLoader", "nope", ["f"])).toEqual(["f"]);
  });

  it("returns fallback for non-array entries (e.g. INT/STRING specs)", () => {
    expect(parseComboEntry(["INT", { default: 1 }], ["f"])).toEqual(["f"]);
    expect(parseComboEntry(undefined, ["f"])).toEqual(["f"]);
    expect(parseComboEntry("COMBO", ["f"])).toEqual(["f"]);
    // COMBO 声明了但没有 options 字段
    expect(parseComboEntry(["COMBO", { multiselect: false }], ["f"])).toEqual(["f"]);
  });

  it("coerces numeric options to strings", () => {
    expect(parseComboEntry(["COMBO", { options: [1, 2] }], ["f"])).toEqual(["1", "2"]);
  });
});
