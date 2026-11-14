import { describe, expect, it } from "vitest";
import {
  addWardrobeLora,
  buildWardrobeGenerationParams,
  buildWardrobePrompt,
  defaultWardrobeGeneration,
  normalizeWardrobeGeneration,
  removeWardrobeLora,
  updateWardrobeLora,
} from "./generation";
import { makeAnimaParams } from "../paramBuilders";
import type { LoraItem } from "../../types";

const loraItem: LoraItem = {
  model_name: "Style LoRA",
  file_name: "style.safetensors",
  folder: "styles",
  file_path: "styles/style.safetensors",
  sha256: "abc",
  civitai: { trainedWords: ["style trigger", "style2"] },
};

describe("造型台独立生图参数", () => {
  it("首次快照继承模型参数，但不继承 Anima 的 LoRA 和提示词", () => {
    const anima = {
      ...makeAnimaParams(),
      positivePrompt: "anima prompt",
      loras: [{ name: "anima-lora", strength: 1, clipStrength: 1, active: true }],
    };

    const generation = defaultWardrobeGeneration(anima);

    expect(generation.params.modelStack).toEqual(anima.modelStack);
    expect(generation.params.width).toBe(anima.width);
    expect(generation.params.loras).toEqual([]);
    expect(generation.params.positivePrompt).toBe("");
    expect(generation.params.stages.img2img).toBe(false);
    expect(generation.params.batchSize).toBe(1);
    expect(generation.params.drawText).toBeUndefined();
    expect(generation.params.filenamePrefix).toBe("造型台/%date:yyyy-MM-dd%/ComfyUI");
    expect(generation.continuousCount).toBe(4);
  });

  it("坏数据修复会收敛尺寸 / 采样 / LoRA / 连续次数", () => {
    const defaults = defaultWardrobeGeneration();
    const merged = {
      ...defaults,
      params: {
        ...defaults.params,
        width: -10,
        height: 99999,
        steps: 0,
        cfg: 99,
        loras: [
          { name: "  ", strength: 1, clipStrength: 1, active: true },
          {
            name: "style-a",
            strength: 99,
            clipStrength: -99,
            active: true,
            triggerWords: ["a", " a ", "b"],
          },
        ],
      },
      continuousCount: 999,
    };

    const next = normalizeWardrobeGeneration(merged, defaults);

    expect(next.params.width).toBe(16);
    expect(next.params.height).toBe(4096);
    expect(next.params.steps).toBe(1);
    expect(next.params.cfg).toBe(30);
    expect(next.params.loras).toHaveLength(1);
    expect(next.params.loras[0]).toMatchObject({ name: "style-a", strength: 10, clipStrength: -10 });
    expect(next.params.loras[0].triggerWords).toEqual(["a", "b"]);
    expect(next.continuousCount).toBe(20);
  });
});

describe("造型台提示词与 LoRA", () => {
  it("启用 LoRA 的触发词会追加到提示词，关闭 LoRA 或关掉自动开关则不追加", () => {
    let generation = defaultWardrobeGeneration();
    generation = addWardrobeLora(generation, loraItem);
    generation = updateWardrobeLora(generation, "styles/style.safetensors", {
      triggerWords: ["style trigger", "extra"],
    });

    expect(buildWardrobePrompt(generation, "1girl, solo", false)).toBe(
      "1girl, solo, style trigger, extra",
    );

    const triggerOff = { ...generation, autoTrigger: false };
    expect(buildWardrobePrompt(triggerOff, "1girl, solo", false)).toBe("1girl, solo");

    const inactive = updateWardrobeLora(generation, "styles/style.safetensors", { active: false });
    expect(buildWardrobePrompt(inactive, "1girl, solo", false)).toBe("1girl, solo");
  });

  it("画质前缀会保留，触发词追加在末尾", () => {
    let generation = defaultWardrobeGeneration();
    generation = addWardrobeLora(generation, loraItem);

    expect(buildWardrobePrompt(generation, "1girl, solo", true)).toBe(
      "(masterpiece, best quality, highres, absurdres, newest), anime coloring, 1girl, solo, style trigger, style2",
    );
  });

  it("手动触发词始终追加，不受「自动加入 LoRA 触发词」开关影响", () => {
    let generation = defaultWardrobeGeneration();
    generation = { ...generation, autoTrigger: false, manualTriggers: ["manual trigger"] };
    generation = addWardrobeLora(generation, loraItem);

    expect(buildWardrobePrompt(generation, "1girl, solo", false)).toBe(
      "1girl, solo, manual trigger",
    );
  });

  it("生成参数强制单张、文生图，并剥离触发词字段", () => {
    let generation = defaultWardrobeGeneration();
    generation = addWardrobeLora(generation, loraItem);

    const params = buildWardrobeGenerationParams(generation, "1girl, solo, style trigger");

    expect(params.positivePrompt).toBe("1girl, solo, style trigger");
    expect(params.batchSize).toBe(1);
    expect(params.stages.img2img).toBe(false);
    expect(params.drawText).toBeUndefined();
    expect(params.loras).toHaveLength(1);
    expect("triggerWords" in params.loras[0]).toBe(false);
    // 无论旧存档里的前缀是什么，落盘目录都固定到造型台
    expect(params.filenamePrefix).toBe("造型台/%date:yyyy-MM-dd%/ComfyUI");
  });

  it("重复添加同一个 LoRA 不会产生第二条；移除后清空", () => {
    let generation = defaultWardrobeGeneration();
    generation = addWardrobeLora(generation, loraItem);
    generation = addWardrobeLora(generation, loraItem);
    expect(generation.params.loras).toHaveLength(1);
    expect(generation.params.loras[0].triggerWords).toEqual(["style trigger", "style2"]);

    generation = removeWardrobeLora(generation, "styles/style.safetensors");
    expect(generation.params.loras).toEqual([]);
  });
});
