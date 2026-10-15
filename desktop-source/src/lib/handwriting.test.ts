import { describe, expect, it } from "vitest";
import { ANIMA_FULL_STAGES } from "../constants";
import { makeAnimaParams, makeBaseParams, makeHighresParams, makeMultiParams } from "./paramBuilders";
import {
  animaUpscaleTargetSize,
  buildAnimaPrompt,
  buildDefaultPrompt,
  buildHighresPrompt,
  buildMultiPrompt,
} from "./workflowBuilders";
import { snapshotForSave } from "./generationPresets";
import type { BaseGenerationParams, ComfyPrompt, HandwritingParams } from "../types";

const HW_KEYS = ["hw_load", "hw_scale", "hw_maskload", "hw_maskscale", "hw_mask", "hw_mix"];
const hasHwNodes = (prompt: ComfyPrompt) => Object.keys(prompt).some((key) => key.startsWith("hw_"));

/** 链尾输出引用：default/multi/anima 用 "999_save"，highres 用数字 id（String(nextId)），统一按 class_type 找 */
const tailImageRef = (prompt: ComfyPrompt) => {
  const entry = Object.entries(prompt).find(
    ([, node]) => node.class_type === "SaveImage" || node.class_type === "PreviewImage",
  );
  if (!entry) throw new Error("工作流缺少 SaveImage/PreviewImage 节点");
  return entry[1].inputs.images;
};

/** 打开手写层（双图齐备），可覆盖个别字段做防御分支 */
function withHandwriting<T extends BaseGenerationParams>(params: T, patch: Partial<HandwritingParams> = {}): T {
  return {
    ...params,
    drawText: {
      ...params.drawText!,
      handwriting: { enabled: true, imageName: "hw.png", maskName: "hw_mask.png", ...patch },
    },
  } as T;
}

describe("手写层（笔迹原样叠加）", () => {
  it("默认关闭，且关闭时即使文件名在也不产生任何 hw_ 节点", () => {
    expect(makeBaseParams().drawText?.handwriting?.enabled).toBe(false);

    const off = buildDefaultPrompt(withHandwriting(makeBaseParams(), { enabled: false }));
    expect(hasHwNodes(off)).toBe(false);
  });

  it("零回归：四个 builder 未开启时无 hw_ 节点，SaveImage 输入与基准逐节点一致", () => {
    const cases: Array<[ComfyPrompt, ComfyPrompt]> = [
      [buildDefaultPrompt(makeBaseParams()), buildDefaultPrompt(withHandwriting(makeBaseParams(), { enabled: false }))],
      [buildMultiPrompt(makeMultiParams()), buildMultiPrompt(withHandwriting(makeMultiParams(), { enabled: false }))],
      [buildHighresPrompt(makeHighresParams()), buildHighresPrompt(withHandwriting(makeHighresParams(), { enabled: false }))],
      [
        buildAnimaPrompt(makeAnimaParams(), { useEasyHiresFix: true, useImageResizeKJv2: true }),
        buildAnimaPrompt(withHandwriting(makeAnimaParams(), { enabled: false }), { useEasyHiresFix: true, useImageResizeKJv2: true }),
      ],
    ];
    for (const [base, withOff] of cases) {
      expect(hasHwNodes(withOff), "关闭时不应有 hw_ 节点").toBe(false);
      expect(tailImageRef(withOff), "SaveImage 输入不变").toEqual(tailImageRef(base));
    }
  });

  it("防御：字段缺失/残缺时（旧夹具兼容）不产出节点也不抛错", () => {
    // drawText 整个被删（旧 localStorage / 手写夹具）
    const legacy = { ...makeBaseParams() } as Record<string, unknown>;
    delete legacy.drawText;
    expect(hasHwNodes(buildDefaultPrompt(legacy as unknown as BaseGenerationParams))).toBe(false);

    // handwriting 字段整体缺失
    const noField = { ...makeBaseParams(), drawText: { ...makeBaseParams().drawText!, handwriting: undefined } };
    expect(hasHwNodes(buildDefaultPrompt(noField))).toBe(false);

    // 双图缺一：只给彩图或只给 mask 都不产出（否则 LoadImage 空引用）
    expect(hasHwNodes(buildDefaultPrompt(withHandwriting(makeBaseParams(), { maskName: "" })))).toBe(false);
    expect(hasHwNodes(buildDefaultPrompt(withHandwriting(makeBaseParams(), { imageName: "" })))).toBe(false);
  });

  it("default 单开手写：6 个内置节点连线正确，SaveImage 接 hw_mix", () => {
    const base = makeBaseParams();
    const prompt = buildDefaultPrompt(withHandwriting(base));
    for (const key of HW_KEYS) expect(prompt[key], key).toBeDefined();

    const mix = prompt.hw_mix.inputs;
    expect(mix.destination).toEqual(["7", 0]); // 链尾 = VAEDecode 输出（未开文字水印）
    expect(mix.source).toEqual(["hw_scale", 0]);
    expect(mix.mask).toEqual(["hw_mask", 0]);
    expect(mix.x).toBe(0);
    expect(mix.y).toBe(0);
    expect(mix.resize_source).toBe(false);

    expect(prompt.hw_load.inputs.image).toBe("hw.png");
    expect(prompt.hw_maskload.inputs.image).toBe("hw_mask.png");
    // 彩图与 mask 必须同参缩放（lanczos + crop=disabled），否则软硬边错位产生彩边
    expect(prompt.hw_scale.inputs.upscale_method).toBe("lanczos");
    expect(prompt.hw_maskscale.inputs.upscale_method).toBe("lanczos");
    expect(prompt.hw_scale.inputs.crop).toBe("disabled");
    expect(prompt.hw_maskscale.inputs.crop).toBe("disabled");
    expect(prompt.hw_mask.inputs.channel).toBe("red");

    // 尺寸：字面量取生图尺寸
    expect(prompt.hw_scale.inputs.width).toBe(base.width);
    expect(prompt.hw_scale.inputs.height).toBe(base.height);
    expect(prompt.hw_maskscale.inputs.width).toBe(base.width);

    expect(prompt["999_save"].inputs.images).toEqual(["hw_mix", 0]);
  });

  it("与文字水印同开：手写层接在 DrawTextAdvanced 之后", () => {
    const base = makeBaseParams();
    const params: BaseGenerationParams = {
      ...base,
      drawText: {
        ...base.drawText!,
        enabled: true,
        text: "签名",
        handwriting: { enabled: true, imageName: "hw.png", maskName: "hw_mask.png" },
      },
    };
    const prompt = buildDefaultPrompt(params);
    expect(prompt["8"].class_type).toBe("DrawTextAdvanced");
    expect(prompt.hw_mix.inputs.destination).toEqual(["8", 0]);
    expect(prompt["999_save"].inputs.images).toEqual(["hw_mix", 0]);
  });

  it("multi：手写层缩放沿用 ResolutionMasterSimplify 的输出（不绕过分辨率对齐）", () => {
    const prompt = buildMultiPrompt(withHandwriting(makeMultiParams()));
    expect(prompt["22"].class_type).toBe("ResolutionMasterSimplify");
    expect(prompt.hw_scale.inputs.width).toEqual(["22", 0]);
    expect(prompt.hw_scale.inputs.height).toEqual(["22", 1]);
    expect(prompt.hw_maskscale.inputs.width).toEqual(["22", 0]);
  });

  it("highres：enableUpscale 开时按 scaleBy 放大，关时用原始尺寸（与 segsMaskSize 口径一致）", () => {
    const hp = makeHighresParams();
    const on = buildHighresPrompt(withHandwriting(hp));
    expect(on.hw_scale.inputs.width).toBe(Math.round(hp.width * hp.scaleBy));
    expect(on.hw_scale.inputs.height).toBe(Math.round(hp.height * hp.scaleBy));

    const off = buildHighresPrompt(withHandwriting({ ...hp, enableUpscale: false }));
    expect(off.hw_scale.inputs.width).toBe(hp.width);
    expect(off.hw_scale.inputs.height).toBe(hp.height);
  });

  it("anima：post / pre / 全关 三分支的目标尺寸", () => {
    const caps = { useEasyHiresFix: true, useImageResizeKJv2: true };
    const ap = makeAnimaParams();

    // 全开（FULL_STAGES 默认）：先 pre 放大再 post 放大，最终 = post 目标
    const post = animaUpscaleTargetSize(
      animaUpscaleTargetSize(ap.width, ap.height, ap.hires.prePercent).width,
      animaUpscaleTargetSize(ap.width, ap.height, ap.hires.prePercent).height,
      ap.hires.postPercent,
    );
    const full = buildAnimaPrompt(withHandwriting(ap), caps);
    expect(full.hw_scale.inputs.width).toBe(post.width);
    expect(full.hw_scale.inputs.height).toBe(post.height);

    // 仅 pre：nominal 停在 pre 目标
    const pre = animaUpscaleTargetSize(ap.width, ap.height, ap.hires.prePercent);
    const preOnly = buildAnimaPrompt(
      withHandwriting({ ...ap, stages: { ...ANIMA_FULL_STAGES, hiresFixPost: false } }),
      caps,
    );
    expect(preOnly.hw_scale.inputs.width).toBe(pre.width);

    // 全关：回到原始生图尺寸
    const none = buildAnimaPrompt(
      withHandwriting({ ...ap, stages: { ...ANIMA_FULL_STAGES, hiresFixPre: false, hiresFixPost: false } }),
      caps,
    );
    expect(none.hw_scale.inputs.width).toBe(ap.width);
    expect(none.hw_scale.inputs.height).toBe(ap.height);
  });

  it("batchSize > 1 不改变手写层结构（batch 广播由服务端 repeat_to_batch_size 负责）", () => {
    const prompt = buildDefaultPrompt(withHandwriting({ ...makeBaseParams(), batchSize: 3 }));
    for (const key of HW_KEYS) expect(prompt[key], key).toBeDefined();
    expect(prompt.hw_mix.inputs.destination).toEqual(["7", 0]);
  });

  it("节点键用非数字字符串，与 detailerChain 递增的数字 id 并存不冲突", () => {
    const prompt = buildHighresPrompt(withHandwriting({ ...makeHighresParams(), enableFaceDetailer: true }));
    for (const key of HW_KEYS) expect(prompt[key], key).toBeDefined();
    expect(Object.keys(prompt).some((key) => /^\d+$/.test(key))).toBe(true);
  });

  it("保存预设时剥掉手写图文件名，enabled 与导出尺寸保留", () => {
    const snapshot = snapshotForSave(
      withHandwriting(makeBaseParams(), { drawnWidth: 832, drawnHeight: 1216 }) as Record<string, unknown>,
    );
    const hw = (snapshot.drawText as Record<string, unknown>).handwriting as Record<string, unknown>;
    expect(hw.imageName).toBe("");
    expect(hw.maskName).toBe("");
    expect(hw.enabled).toBe(true);
    expect(hw.drawnWidth).toBe(832);
    expect(hw.drawnHeight).toBe(1216);
  });
});
