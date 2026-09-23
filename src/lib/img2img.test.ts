import { describe, expect, it } from "vitest";
import {
  makeAnimaParams,
  makeBaseParams,
  makeHighresParams,
  makeImg2ImgParams,
  makeMultiParams,
} from "./paramBuilders";
import {
  buildAnimaPrompt,
  buildDefaultPrompt,
  buildHighresPrompt,
  buildMultiPrompt,
} from "./workflowBuilders";
import { snapshotForSave } from "./generationPresets";
import { fallbackOptions } from "../constants";
import type { BaseGenerationParams, ComfyPrompt, Img2ImgParams } from "../types";

const typesOf = (prompt: ComfyPrompt) => Object.values(prompt).map((node) => node.class_type);
const countType = (prompt: ComfyPrompt, type: string) => typesOf(prompt).filter((t) => t === type).length;

/** 打开图生图开关并挂上参考图 */
function withImg2Img<T extends Record<string, unknown>>(params: T, patch: Partial<Img2ImgParams> = {}): T {
  return {
    ...params,
    img2img: { ...makeImg2ImgParams(), enabled: true, imageName: "ref.png", ...patch },
  } as T;
}

describe("图生图（默认 / 多人 / 高修）", () => {
  it("默认开关是关闭的（既有用户行为零变化）", () => {
    expect(makeBaseParams().img2img?.enabled).toBe(false);
    expect(makeMultiParams().img2img?.enabled).toBe(false);
    expect(makeHighresParams().img2img?.enabled).toBe(false);
  });

  it("零回归：未开启时 KSampler 的 latent 仍指向原 EmptyLatentImage 节点", () => {
    // 这三个 id 是改动前的既有事实，任何变动都意味着误伤了原链路
    expect(buildDefaultPrompt(makeBaseParams())["6"].inputs.latent_image).toEqual(["5", 0]);
    expect(buildMultiPrompt(makeMultiParams())["4"].inputs.latent_image).toEqual(["9", 0]);
    expect(buildHighresPrompt(makeHighresParams())["6"].inputs.latent_image).toEqual(["5", 0]);
  });

  it("零回归：未开启时不产生任何 i2i 节点，也不出现 LoadImage", () => {
    const prompts = [
      buildDefaultPrompt(makeBaseParams()),
      buildMultiPrompt(makeMultiParams()),
      buildHighresPrompt(makeHighresParams()),
    ];
    for (const prompt of prompts) {
      expect(Object.keys(prompt).some((key) => key.startsWith("i2i_"))).toBe(false);
      expect(countType(prompt, "LoadImage")).toBe(0);
      expect(countType(prompt, "VAEEncode")).toBe(0);
      expect(countType(prompt, "ImageScale")).toBe(0);
      expect(countType(prompt, "EmptyLatentImage")).toBe(1);
    }
  });

  it("开关关闭时即使已选参考图也按文生图出图", () => {
    const params = {
      ...makeBaseParams(),
      img2img: { ...makeImg2ImgParams(), enabled: false, imageName: "ref.png" },
    };
    const prompt = buildDefaultPrompt(params);
    expect(countType(prompt, "LoadImage")).toBe(0);
    expect(countType(prompt, "EmptyLatentImage")).toBe(1);
    expect(prompt["6"].inputs.latent_image).toEqual(["5", 0]);
  });

  it("字段完全缺失时不抛错（兼容既有夹具与外部调用方）", () => {
    const legacy = { ...makeBaseParams() } as Record<string, unknown>;
    delete legacy.img2img;
    const prompt = buildDefaultPrompt(legacy as unknown as BaseGenerationParams);
    expect(countType(prompt, "LoadImage")).toBe(0);
    expect(countType(prompt, "EmptyLatentImage")).toBe(1);
  });

  it("开启并选图后，三个 builder 都产出 LoadImage → ImageScale → VAEEncode", () => {
    const cases: Array<[string, ComfyPrompt, string]> = [
      ["default", buildDefaultPrompt(withImg2Img(makeBaseParams())), "6"],
      ["multi", buildMultiPrompt(withImg2Img(makeMultiParams())), "4"],
      ["highres", buildHighresPrompt(withImg2Img(makeHighresParams())), "6"],
    ];
    for (const [name, prompt, ksamplerId] of cases) {
      expect(countType(prompt, "LoadImage"), name).toBe(1);
      expect(countType(prompt, "ImageScale"), name).toBe(1);
      expect(countType(prompt, "VAEEncode"), name).toBe(1);
      expect(countType(prompt, "EmptyLatentImage"), name).toBe(0);
      expect(prompt.i2i_load.inputs.image, name).toBe("ref.png");
      expect(prompt.i2i_scale.inputs.image, name).toEqual(["i2i_load", 0]);
      expect(prompt.i2i_encode.inputs.pixels, name).toEqual(["i2i_scale", 0]);
      expect(prompt[ksamplerId].inputs.latent_image, name).toEqual(["i2i_encode", 0]);
    }
  });

  it("节点键用非数字字符串，与 detailerChain 递增的数字 id 并存不冲突", () => {
    const prompt = buildHighresPrompt({ ...withImg2Img(makeHighresParams()), enableFaceDetailer: true });
    for (const key of ["i2i_load", "i2i_scale", "i2i_encode"]) {
      expect(prompt[key], key).toBeDefined();
    }
    expect(prompt.i2i_encode.class_type).toBe("VAEEncode");
    // detailerChain 仍按数字 id 追加节点，两套命名并存互不覆盖
    expect(Object.keys(prompt).some((key) => /^\d+$/.test(key))).toBe(true);
    expect(prompt["6"].inputs.latent_image).toEqual(["i2i_encode", 0]);
  });

  it("多人工作流：缩放宽高沿用 ResolutionMasterSimplify 的输出（不绕过分辨率对齐）", () => {
    const prompt = buildMultiPrompt(withImg2Img(makeMultiParams()));
    expect(prompt["22"].class_type).toBe("ResolutionMasterSimplify");
    expect(prompt.i2i_scale.inputs.width).toEqual(["22", 0]);
    expect(prompt.i2i_scale.inputs.height).toEqual(["22", 1]);
  });

  it("缩放方式映射到核心 ImageScale 的 crop", () => {
    expect(buildDefaultPrompt(withImg2Img(makeBaseParams(), { fit: "stretch" })).i2i_scale.inputs.crop).toBe("disabled");
    expect(buildDefaultPrompt(withImg2Img(makeBaseParams(), { fit: "crop" })).i2i_scale.inputs.crop).toBe("center");
  });

  it("批量 > 1 时用 RepeatLatentBatch 保住批量语义，并按 amount 上限 64 截断", () => {
    const single = buildDefaultPrompt(withImg2Img(makeBaseParams()));
    expect(countType(single, "RepeatLatentBatch")).toBe(0);

    const three = buildDefaultPrompt(withImg2Img({ ...makeBaseParams(), batchSize: 3 }));
    expect(three.i2i_repeat.inputs.amount).toBe(3);
    expect(three["6"].inputs.latent_image).toEqual(["i2i_repeat", 0]);

    // EmptyLatentImage.batch_size 可到 4096，但 RepeatLatentBatch.amount 上限是 64
    const huge = buildDefaultPrompt(withImg2Img({ ...makeBaseParams(), batchSize: 100 }));
    expect(huge.i2i_repeat.inputs.amount).toBe(64);
  });

  it("高修：图生图只替换基础采样，放大链仍走 KSampler 输出", () => {
    const params = withImg2Img({ ...makeHighresParams(), enableUpscale: true });
    const prompt = buildHighresPrompt(params);
    expect(prompt["7"].class_type).toBe("LatentUpscaleBy");
    expect(prompt["7"].inputs.samples).toEqual(["6", 0]);
  });
});

describe("T12 局部重绘遮罩", () => {
  it("未设遮罩：走 VAEEncode 整图重绘，无 mask 节点（既有路径零变化）", () => {
    const prompt = buildDefaultPrompt(withImg2Img(makeBaseParams()));
    expect(prompt.i2i_encode.class_type).toBe("VAEEncode");
    expect(Object.values(prompt).some((n) => n.class_type === "VAEEncodeForInpaint" || n.class_type === "LoadImageMask")).toBe(false);
  });

  it("设置遮罩：LoadImageMask(channel=red) + VAEEncodeForInpaint(grow_mask_by=6)，latent 接到 KSampler", () => {
    const prompt = buildDefaultPrompt(withImg2Img(makeBaseParams(), { maskName: "mask.png" }));
    expect(prompt.i2i_mask_load.class_type).toBe("LoadImageMask");
    expect(prompt.i2i_mask_load.inputs.image).toBe("mask.png");
    expect(prompt.i2i_mask_load.inputs.channel).toBe("red");
    expect(prompt.i2i_encode.class_type).toBe("VAEEncodeForInpaint");
    expect(prompt.i2i_encode.inputs.pixels).toEqual(["i2i_scale", 0]);
    expect(prompt.i2i_encode.inputs.mask).toEqual(["i2i_mask_load", 0]);
    expect(prompt.i2i_encode.inputs.grow_mask_by).toBe(6);
    expect(prompt["6"].inputs.latent_image).toEqual(["i2i_encode", 0]);
  });

  it("遮罩重绘同样尊重批量 clamp（RepeatLatentBatch）与高修模板", () => {
    const prompt = buildHighresPrompt(withImg2Img({ ...makeHighresParams(), batchSize: 2 }, { maskName: "m.png" }));
    expect(prompt.i2i_repeat).toBeDefined();
    expect(prompt.i2i_repeat.inputs.samples).toEqual(["i2i_encode", 0]);
  });

  it("清除参考图时遮罩一并失效（enabled 关闭 → 不写任何 i2i 节点）", () => {
    const prompt = buildDefaultPrompt(withImg2Img(makeBaseParams(), { enabled: false, maskName: "m.png" }));
    expect(countType(prompt, "LoadImageMask")).toBe(0);
    expect(countType(prompt, "VAEEncodeForInpaint")).toBe(0);
    expect(countType(prompt, "EmptyLatentImage")).toBe(1);
  });
});

describe("图生图与预设 / 枚举", () => {  it("保存预设时剥掉参考图文件名，其余图生图字段保留", () => {
    const snapshot = snapshotForSave(withImg2Img(makeBaseParams(), { fit: "crop" }) as Record<string, unknown>);
    const img2img = snapshot.img2img as Record<string, unknown>;
    expect(img2img.imageName).toBe("");
    expect(img2img.enabled).toBe(true);
    expect(img2img.fit).toBe("crop");
  });

  it("fallbackOptions 的图生图缩放枚举含 lanczos、不含 bislerp（与放大方法不同源）", () => {
    expect(fallbackOptions.imageScaleMethods).toContain("lanczos");
    expect(fallbackOptions.imageScaleMethods).not.toContain("bislerp");
    // 反向确认：放大方法那份确实含 bislerp，两者不可混用
    expect(fallbackOptions.upscaleMethods).not.toContain("lanczos");
  });
});

describe("Anima 图生图零回归", () => {
  const caps = { useEasyHiresFix: true, useImageResizeKJv2: true };

  it("未选图时回落文生图（开关是 stages.img2img，与共用的 enabled 字段无关）", () => {
    const prompt = buildAnimaPrompt(makeAnimaParams(), caps);
    expect(countType(prompt, "LoadImage")).toBe(0);
    expect(countType(prompt, "EmptyLatentImage")).toBe(1);
  });

  it("选了图仍走它自己的 ImageResizeKJv2，不落到核心 ImageScale", () => {
    const base = makeAnimaParams();
    const prompt = buildAnimaPrompt(
      { ...base, img2img: { ...base.img2img, imageName: "ref.png" } },
      caps,
    );
    expect(countType(prompt, "LoadImage")).toBe(1);
    expect(countType(prompt, "ImageResizeKJv2")).toBe(1);
    expect(countType(prompt, "ImageScale")).toBe(0);
    expect(prompt["32"].inputs.keep_proportion).toBe("pad_edge");
    expect(prompt["32"].inputs.crop_position).toBe("center");
  });

  it("共用的 enabled 字段与 fit 不参与 Anima 的工作流构造", () => {
    const base = makeAnimaParams();
    const off = buildAnimaPrompt(
      { ...base, img2img: { ...base.img2img, enabled: false, imageName: "ref.png" } },
      caps,
    );
    expect(countType(off, "LoadImage")).toBe(1);
  });
});
