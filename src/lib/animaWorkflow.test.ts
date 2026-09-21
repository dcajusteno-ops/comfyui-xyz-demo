import { describe, expect, it } from "vitest";
import { makeAnimaParams, makeHighresParams } from "./paramBuilders";
import { buildAnimaPrompt, buildHighresPrompt } from "./workflowBuilders";
import { ANIMA_FULL_STAGES, ANIMA_STAGE_PRESETS } from "../constants";
import type { AnimaGenerationParams, AnimaStageToggles, HighresParams } from "../types";

const baseOptions = {
  modelStack: {
    unetName: "silvermoonmixAnima_v2329BTurbo.safetensors",
    weightDtype: "default",
    clipName: "qwen_3_06b_base.safetensors",
    clipType: "stable_diffusion",
    vaeName: "qwen_image_vae.safetensors",
  },
  loras: [{ name: "AnimaLora\\鸣潮\\秧秧\\E7A7A7E7A7A7.NSmw.safetensors", strength: 1, clipStrength: 1, active: true }],
  seed: 42,
  randomizeSeed: false,
  positivePrompt: "1girl",
  negativePrompt: "low quality",
  hires: { modelName: "4x_foolhardy_Remacli.pth", rescaleMethod: "lanczos", prePercent: 50, postPercent: 50 },
};

function animaParams(overrides: Partial<AnimaGenerationParams> = {}): AnimaGenerationParams {
  return {
    ...makeAnimaParams(),
    ...baseOptions,
    ...overrides,
  };
}

function withStages(stages: Partial<AnimaStageToggles>): AnimaGenerationParams {
  return animaParams({ stages: { ...ANIMA_FULL_STAGES, ...stages } });
}

function typesOf(prompt: ReturnType<typeof buildAnimaPrompt>) {
  return Object.values(prompt).map((node) => node.class_type);
}

function countType(prompt: ReturnType<typeof buildAnimaPrompt>, classType: string) {
  return typesOf(prompt).filter((t) => t === classType).length;
}

describe("buildAnimaPrompt", () => {
  it("模型栈为 UNET + CLIP + VAE 三段式，且 LoRA 走 LoraManager", () => {
    const prompt = buildAnimaPrompt(animaParams());
    expect(prompt["1"].class_type).toBe("UNETLoader");
    expect(prompt["1"].inputs.unet_name).toBe("silvermoonmixAnima_v2329BTurbo.safetensors");
    expect(prompt["17"].class_type).toBe("CLIPLoader");
    expect(prompt["17"].inputs.type).toBe("stable_diffusion");
    expect(prompt["22"].class_type).toBe("VAELoader");
    expect(prompt["54"].class_type).toBe("Lora Loader (LoraManager)");
    expect(prompt["54"].inputs.model).toEqual(["1", 0]);
    expect(prompt["54"].inputs.clip).toEqual(["17", 0]);
    // 反斜杠路径 + 无扩展名（与现有模板一致）
    expect(prompt["54"].inputs.loras).toMatchObject({
      __value__: [{ name: "AnimaLora\\鸣潮\\秧秧\\E7A7A7E7A7A7.NSmw", strength: 1 }],
    });
    // CLIP 编码取自 LoRA 之后的 clip（与高修同一约定）
    expect(prompt["42"].inputs.clip).toEqual(["54", 1]);
    expect(prompt["45"].inputs.clip).toEqual(["54", 1]);
  });

  it("不产出原工作流的常量中转节点（全部内联）", () => {
    const types = typesOf(buildAnimaPrompt(animaParams()));
    for (const banned of ["easy int", "PrimitiveInt", "PrimitiveFloat", "PrimitiveBoolean", "SeedNode"]) {
      expect(types).not.toContain(banned);
    }
  });

  it("不产出管道化节点与 ImpactSwitch（改用逐节点显式输入 + 代码层二选一）", () => {
    const types = typesOf(buildAnimaPrompt(animaParams()));
    for (const banned of ["ToDetailerPipe", "EditDetailerPipe", "FaceDetailerPipe", "ImpactSwitch"]) {
      expect(types).not.toContain(banned);
    }
  });

  it("默认档位 = 完整复刻：五个修复阶段 + 两级放大齐全", () => {
    const prompt = buildAnimaPrompt(animaParams());
    expect(countType(prompt, "DetailerForEach")).toBe(1);
    expect(countType(prompt, "FaceDetailer")).toBe(4);
    expect(countType(prompt, "UltralyticsDetectorProvider")).toBe(4);
    expect(countType(prompt, "SAMLoader")).toBe(1);
    expect(countType(prompt, "easy hiresFix")).toBe(2);
    expect(countType(prompt, "KSampler")).toBe(2);
    expect(countType(prompt, "DifferentialDiffusion")).toBe(1);
    expect(countType(prompt, "CFGZeroStar")).toBe(1);
    expect(typesOf(prompt)).toContain("SaveImage");
  });

  it("执行顺序对齐原工作流：SEGS → 手 → NSFW → 脸 → 眼", () => {
    const prompt = buildAnimaPrompt(animaParams());
    // DetailerForEach 先于所有 FaceDetailer；FaceDetailer 的 _meta.title 顺序即链式顺序
    const titles = Object.values(prompt)
      .filter((node) => node.class_type === "FaceDetailer")
      .map((node) => node._meta?.title);
    expect(titles).toEqual(["手部修复", "NSFW修复", "脸部修复", "眼部修复"]);

    const detectorTitles = Object.values(prompt)
      .filter((node) => node.class_type === "UltralyticsDetectorProvider")
      .map((node) => node._meta?.title);
    expect(detectorTitles).toEqual(["手部检测器", "NSFW检测器", "脸部检测器", "眼部检测器"]);
  });

  it("detailer 的 model 取自 DifferentialDiffusion，且不重复包装", () => {
    const prompt = buildAnimaPrompt(animaParams());
    const diffEntry = Object.entries(prompt).find(([, node]) => node.class_type === "DifferentialDiffusion")!;
    const [diffId, diffNode] = diffEntry;
    // 原工作流：DifferentialDiffusion 包在 CFGZeroStar 之后
    const cfgEntry = Object.entries(prompt).find(([, node]) => node.class_type === "CFGZeroStar")!;
    expect(diffNode.inputs.model).toEqual([cfgEntry[0], 0]);
    // 只应存在 1 个 DifferentialDiffusion（不重复包装）
    expect(countType(prompt, "DifferentialDiffusion")).toBe(1);
    // 手部 detailer 用 diffused model
    const hand = Object.values(prompt).find((node) => node._meta?.title === "手部修复")!;
    expect(hand.inputs.model).toEqual([diffId, 0]);
    // SEGS 也用 diffused model，而不是自己再包一层
    const segs = Object.values(prompt).find((node) => node.class_type === "DetailerForEach")!;
    expect(segs.inputs.model).toEqual([diffId, 0]);
  });

  it("细节参数对齐原工作流（noise_mask_feather / sam_* / drop_size / feather）", () => {
    const prompt = buildAnimaPrompt(animaParams());
    const hand = Object.values(prompt).find((node) => node._meta?.title === "手部修复")!;
    expect(hand.inputs.noise_mask_feather).toBe(64);
    expect(hand.inputs.tiled_encode).toBe(false);
    expect(hand.inputs.tiled_decode).toBe(false);
    expect(hand.inputs.inpaint_model).toBe(false);
    expect(hand.inputs.sam_detection_hint).toBe("none");
    expect(hand.inputs.sam_dilation).toBe(4);
    expect(hand.inputs.bbox_crop_factor).toBe(2.5);
    expect(hand.inputs.drop_size).toBe(16);
    expect(hand.inputs.feather).toBe(16);
    expect(hand.inputs.guide_size).toBe(512);
    expect(hand.inputs.max_size).toBe(1536);

    const segs = Object.values(prompt).find((node) => node.class_type === "DetailerForEach")!;
    expect(segs.inputs.noise_mask_feather).toBe(32);
    expect(segs.inputs.feather).toBe(5);
    expect(segs.inputs.guide_size).toBe(512);
    expect(segs.inputs.max_size).toBe(1024);
  });

  it("NSFW 检测器走 segm 输出（取 index 1），且不挂 SAM", () => {
    const prompt = buildAnimaPrompt(animaParams());
    const nsfw = Object.values(prompt).find((node) => node._meta?.title === "NSFW修复")!;
    const segmDetectorEntry = Object.entries(prompt).find(([, node]) => node._meta?.title === "NSFW检测器")!;
    // UltralyticsDetectorProvider 输出为 [BBOX_DETECTOR, SEGM_DETECTOR] → segm 取 index 1
    expect(nsfw.inputs.segm_detector_opt).toEqual([segmDetectorEntry[0], 1]);
    expect(nsfw.inputs.sam_model_opt).toBeUndefined();
  });

  it.each([
    ["cfgZeroStar", "CFGZeroStar"],
    ["refinePass", "KSampler"],
    ["hiresFixPre", "easy hiresFix"],
    ["segsDetailer", "DetailerForEach"],
    ["handDetailer", "FaceDetailer"],
    ["hiresFixPost", "easy hiresFix"],
    ["wildcardNode", "ImpactWildcardProcessor"],
  ] as const)("关闭 %s 会让 %s 从图里消失", (stage, classType) => {
    const on = buildAnimaPrompt(withStages({ [stage]: true }));
    const off = buildAnimaPrompt(withStages({ [stage]: false }));
    expect(countType(on, classType)).toBeGreaterThan(0);
    expect(countType(off, classType)).toBeLessThan(countType(on, classType));
    if (stage === "handDetailer") {
      expect(countType(off, "FaceDetailer")).toBe(3);
    }
    if (stage === "hiresFixPre") {
      expect(countType(off, "easy hiresFix")).toBe(1);
    }
  });

  it("detailer 全关时不产出 DifferentialDiffusion / 检测器 / SAM", () => {
    const prompt = buildAnimaPrompt(
      withStages({
        segsDetailer: false,
        handDetailer: false,
        nsfwDetailer: false,
        faceDetailer: false,
        eyesDetailer: false,
      }),
    );
    const types = typesOf(prompt);
    expect(types).not.toContain("DifferentialDiffusion");
    expect(types).not.toContain("UltralyticsDetectorProvider");
    expect(types).not.toContain("SAMLoader");
    expect(types).not.toContain("DetailerForEach");
    expect(types).not.toContain("FaceDetailer");
    // 链路退化为 采样→解码→放大②→保存
    expect(types).toContain("SaveImage");
    expect(countType(prompt, "KSampler")).toBe(2);
  });

  it("极速直出档：只有基础采样 + 一次放大", () => {
    const prompt = buildAnimaPrompt(animaParams({ stages: { ...ANIMA_STAGE_PRESETS.turbo } }));
    expect(countType(prompt, "KSampler")).toBe(1);
    expect(countType(prompt, "easy hiresFix")).toBe(1);
    const types = typesOf(prompt);
    for (const banned of ["DetailerForEach", "FaceDetailer", "SAMLoader", "UltralyticsDetectorProvider", "DifferentialDiffusion"]) {
      expect(types).not.toContain(banned);
    }
  });

  it("图生图：未选图时回落文生图；选了图才产出参考图链路", () => {
    const noImage = buildAnimaPrompt(withStages({ img2img: true }));
    expect(typesOf(noImage)).not.toContain("LoadImage");
    expect(typesOf(noImage)).toContain("EmptyLatentImage");

    const withImage = buildAnimaPrompt({
      ...withStages({ img2img: true }),
      img2img: { imageName: "ref.png", keepProportion: "pad_edge", upscaleMethod: "nearest-exact", cropPosition: "center" },
    });
    expect(countType(withImage, "LoadImage")).toBe(1);
    expect(countType(withImage, "ImageResizeKJv2")).toBe(1);
    expect(countType(withImage, "VAEEncode")).toBe(1);
  });

  it("关闭「保存图像」时改用 PreviewImage", () => {
    const prompt = buildAnimaPrompt(withStages({ saveImage: false }));
    expect(typesOf(prompt)).toContain("PreviewImage");
    expect(typesOf(prompt)).not.toContain("SaveImage");
  });

  it("缺少 easy hiresFix / ImageResizeKJv2 时降级为核心节点（按目标像素缩放）", () => {
    const degraded = buildAnimaPrompt(animaParams(), {
      useEasyHiresFix: false,
      useImageResizeKJv2: false,
    });
    const types = typesOf(degraded);
    expect(types).not.toContain("easy hiresFix");
    expect(countType(degraded, "UpscaleModelLoader")).toBe(1);
    expect(countType(degraded, "ImageUpscaleWithModel")).toBe(2);
    expect(countType(degraded, "ImageScale")).toBe(2);
    // 降级路径不用比例，而是显式目标像素：1024×1536 → ×2 → ×2
    const scales = Object.values(degraded).filter((node) => node.class_type === "ImageScale");
    expect(scales[0].inputs).toMatchObject({ width: 2048, height: 3072, crop: "disabled" });
    expect(scales[1].inputs).toMatchObject({ width: 4096, height: 6144 });
  });

  it("开启通配符节点时产出 ImpactWildcardProcessor 并改用其输出编码", () => {
    const withNode = buildAnimaPrompt(withStages({ wildcardNode: true }));
    expect(countType(withNode, "ImpactWildcardProcessor")).toBe(2);
    const posId = Object.entries(withNode).find(([, node]) => node._meta?.title === "POSITIVE")![0];
    expect(withNode["42"].inputs.text).toEqual([posId, 0]);
    // 默认（前端展开）时直接填文本
    expect(buildAnimaPrompt(withStages({ wildcardNode: false }))["42"].inputs.text).toBe("1girl");
  });

  it("所有档位 × 所有开关组合都能生成合法图（无悬空引用）", () => {
    const keys = Object.keys(ANIMA_FULL_STAGES) as Array<keyof AnimaStageToggles>;
    const presets = Object.values(ANIMA_STAGE_PRESETS);
    let checked = 0;

    const assertNoDangling = (prompt: ReturnType<typeof buildAnimaPrompt>) => {
      const ids = new Set(Object.keys(prompt));
      for (const [id, node] of Object.entries(prompt)) {
        for (const [key, value] of Object.entries(node.inputs)) {
          if (!Array.isArray(value) || value.length !== 2) continue;
          const [refId, index] = value as [unknown, unknown];
          if (typeof refId !== "string" || typeof index !== "number") continue;
          expect(ids.has(refId), `${id}.${key} 引用了不存在的节点 ${refId}`).toBe(true);
        }
      }
    };

    for (const preset of presets) {
      assertNoDangling(buildAnimaPrompt(animaParams({ stages: { ...preset } })));
      checked++;
    }
    // 再逐个单开/单关
    for (const key of keys) {
      for (const value of [true, false]) {
        assertNoDangling(buildAnimaPrompt(withStages({ [key]: value })));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe("buildHighresPrompt（重构后回归防线）", () => {
  function highres(params: Partial<HighresParams> = {}): ReturnType<typeof buildHighresPrompt> {
    return buildHighresPrompt({ ...makeHighresParams("demo.safetensors"), ...params });
  }

  it("全关时不产出任何 detailer 节点", () => {
    const prompt = highres();
    const types = Object.values(prompt).map((node) => node.class_type);
    expect(types).not.toContain("FaceDetailer");
    expect(types).not.toContain("DetailerForEach");
    expect(types).not.toContain("DifferentialDiffusion");
    expect(types).not.toContain("SAMLoader");
  });

  it("五个修复全开时：1 个 SEGS + 4 个 FaceDetailer + 4 个检测器 + 1 个 SAM", () => {
    const prompt = highres({
      enableSegsDetailer: true,
      enableHandDetailer: true,
      enableFaceDetailer: true,
      enableEyesDetailer: true,
      enableNsfwDetailer: true,
    });
    const types = Object.values(prompt).map((node) => node.class_type);
    const count = (t: string) => types.filter((x) => x === t).length;
    expect(count("DetailerForEach")).toBe(1);
    expect(count("FaceDetailer")).toBe(4);
    expect(count("UltralyticsDetectorProvider")).toBe(4);
    expect(count("SAMLoader")).toBe(1);
    expect(count("DifferentialDiffusion")).toBe(1);
    // 高修的 SEGS 自己产出 DifferentialDiffusion（preDiffusedModel 缺省为 false）
    const segs = Object.values(prompt).find((node) => node.class_type === "DetailerForEach")!;
    const diffEntry = Object.entries(prompt).find(([, node]) => node.class_type === "DifferentialDiffusion")!;
    expect(segs.inputs.model).toEqual([diffEntry[0], 0]);
  });

  it("高修的 detailer 不携带 Anima 专属的可选输入（保证逐节点不变）", () => {
    const prompt = highres({ enableHandDetailer: true });
    const hand = Object.values(prompt).find((node) => node.class_type === "FaceDetailer")!;
    expect(hand.inputs.noise_mask_feather).toBeUndefined();
    expect(hand.inputs.tiled_encode).toBeUndefined();
    expect(hand.inputs.inpaint_model).toBeUndefined();
    // highres 专用的 sam_* 与 drop_size 保持原硬编码值
    expect(hand.inputs.sam_detection_hint).toBe("center-1");
    expect(hand.inputs.sam_dilation).toBe(0);
    expect(hand.inputs.drop_size).toBe(10);
  });

  it("执行顺序仍为 SEGS → 脸 → 眼 → NSFW → 手", () => {
    const prompt = highres({
      enableSegsDetailer: true,
      enableHandDetailer: true,
      enableFaceDetailer: true,
      enableEyesDetailer: true,
      enableNsfwDetailer: true,
    });
    const titles = Object.values(prompt)
      .filter((node) => node.class_type === "FaceDetailer")
      .map((node) => node._meta?.title);
    expect(titles).toEqual(["脸部修复", "眼部修复", "NSFW修复", "手部修复"]);
  });
});

describe("buildAnimaPrompt - 文字水印", () => {
  it("drawText 启用时产出 DrawTextAdvanced，syncWithImage 用 Anima 的画布尺寸", () => {
    const inherited = animaParams().drawText!;
    const params = animaParams({
      drawText: { ...inherited, enabled: true, text: "水印测试", syncWithImage: true },
    });
    const prompt = buildAnimaPrompt(params);
    const drawNode = Object.values(prompt).find((node) => node.class_type === "DrawTextAdvanced");
    expect(drawNode).toBeTruthy();
    expect(drawNode!.inputs.text).toBe("水印测试");
    expect(drawNode!.inputs.width).toBe(params.width);
    expect(drawNode!.inputs.height).toBe(params.height);
  });

  it("drawText 未启用（默认）时不产出文字节点", () => {
    const prompt = buildAnimaPrompt(animaParams());
    expect(typesOf(prompt)).not.toContain("DrawTextAdvanced");
  });
});
