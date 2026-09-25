import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useOptions } from "./useOptions";
import type { ComfyClient } from "../lib/comfyClient";

// 与 ComfyUI /api/object_info/<node> 返回形状一致（按 nodeClass 键控）
function makeMockClient() {
  const objectInfo: Record<string, unknown> = {
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [["demo-a.safetensors", "demo-b.safetensors"]] } } },
    KSampler: { input: { required: { sampler_name: [["euler", "euler_ancestral", "er_sde"]], scheduler: [["simple", "karras"]] } } },
    "WD14Tagger|pysssss": { input: { required: { model: [["wd-v1-4-moat-tagger-v2"]], device: [["GPU", "CPU"]] } } },
    cl_tagger_mira: { input: { required: { model_name: [["cl_tagger/cl_tagger_1_02.onnx"]] } } },
    UltralyticsDetectorProvider: { input: { required: { model_name: [["bbox/hand_yolov8s.pt", "bbox/face_yolov8m.pt"]] } } },
    LatentUpscaleBy: { input: { required: { upscale_method: [["nearest-exact", "bilinear"]] } } },
    // 图生图缩放用：枚举刻意与 LatentUpscaleBy 不同（有 lanczos、无 bislerp）
    ImageScale: { input: { required: { upscale_method: [["nearest-exact", "bilinear", "area", "bicubic", "lanczos"]] } } },
    DrawTextAdvanced: { input: { required: { font: [["default"]] } } },
    // Anima：三段式模型栈 + 放大模型（含新版 COMBO 格式，防 readCombo 回归）
    UNETLoader: { input: { required: { unet_name: [["other.safetensors", "silvermoonmixAnima_v2329BTurbo.safetensors"]] } } },
    // 故意把 qwen3vl_* 放在 qwen_3_06b_base 之前，验证模糊命中用的是精确关键词
    CLIPLoader: { input: { required: { clip_name: [["qwen3vl_4b_fp8_scaled.safetensors", "qwen_3_06b_base.safetensors"]], type: [["stable_diffusion", "qwen_image"]] } } },
    VAELoader: { input: { required: { vae_name: [["sdxl_vae.safetensors", "qwen_image_vae.safetensors"]] } } },
    "easy hiresFix": { input: { required: { model_name: [["4x_foolhardy_Remacri.pth"]] } } },
    ImageResizeKJv2: { input: { required: { keep_proportion: [["pad_edge", "stretch"]] } } },
    UpscaleModelLoader: { input: { required: { model_name: ["COMBO", { options: ["4x_foolhardy_Remacri.pth"] }] } } },
  };
  return {
    // 真实 getObjectInfo 返回按 nodeClass 键控的形状，mock 保持一致
    getObjectInfo: vi.fn(async (nodeClass: string) => ({ [nodeClass]: objectInfo[nodeClass] ?? {} })),
    getLoraManagerSettings: vi.fn(async () => ({
      settings: { blur_mature_content: true, mature_blur_level: "X", onboarding_completed: true, example_images_path: "D:/examples" },
    })),
    getSystemStats: vi.fn(async () => ({})),
  } as unknown as ComfyClient;
}

function renderUseOptions() {
  const client = makeMockClient();
  const setters = {
    setDefaultParams: vi.fn(),
    setMultiParams: vi.fn(),
    setHighresParams: vi.fn(),
    setAnimaParams: vi.fn(),
    setWd14: vi.fn(),
    setWdBatchParams: vi.fn(),
    setClBatchParams: vi.fn(),
    setClSingleParams: vi.fn(),
  };
  const view = renderHook(() => useOptions({ client, pushToast: vi.fn(), ...setters }));
  return { ...view, client, ...setters };
}

describe("useOptions", () => {
  it("下拉选项与 object_info 的节点一一对应（Promise.all 解构错位回归防线）", async () => {
    const { result } = renderUseOptions();
    await waitFor(() => expect(result.current.options.checkpoints).toEqual(["demo-a.safetensors", "demo-b.safetensors"]));
    expect(result.current.options.samplers).toEqual(["euler", "euler_ancestral", "er_sde"]);
    expect(result.current.options.schedulers).toEqual(["simple", "karras"]);
    expect(result.current.options.wdModels).toEqual(["wd-v1-4-moat-tagger-v2"]);
    expect(result.current.options.wdDevices).toEqual(["GPU", "CPU"]);
    expect(result.current.options.clModels).toEqual(["cl_tagger/cl_tagger_1_02.onnx"]);
    expect(result.current.options.detectors).toEqual(["bbox/hand_yolov8s.pt", "bbox/face_yolov8m.pt"]);
    expect(result.current.options.upscaleMethods).toEqual(["nearest-exact", "bilinear"]);
    // 图生图缩放必须取 ImageScale 自己的枚举：LatentUpscaleBy 的 bislerp 对 ImageScale 非法
    expect(result.current.options.imageScaleMethods).toEqual(["nearest-exact", "bilinear", "area", "bicubic", "lanczos"]);
    expect(result.current.options.imageScaleMethods).not.toContain("bislerp");
    expect(result.current.options.fonts).toEqual(["default"]);
  });

  it("Anima 三段式模型栈与放大模型从 object_info 读出（含新版 COMBO 格式）", async () => {
    const { result } = renderUseOptions();
    await waitFor(() => expect(result.current.options.unets.length).toBe(2));
    expect(result.current.options.clips).toEqual(["qwen3vl_4b_fp8_scaled.safetensors", "qwen_3_06b_base.safetensors"]);
    expect(result.current.options.clipTypes).toEqual(["stable_diffusion", "qwen_image"]);
    expect(result.current.options.vaes).toEqual(["sdxl_vae.safetensors", "qwen_image_vae.safetensors"]);
    // 两个来源取并集并去重：easy hiresFix（旧格式）+ UpscaleModelLoader（COMBO 新格式）
    expect(result.current.options.upscaleModels).toEqual(["4x_foolhardy_Remacri.pth"]);
    expect(result.current.options.animaCaps).toEqual({ useEasyHiresFix: true, useImageResizeKJv2: true });
    // mock 未提供 CFGZeroStar / DifferentialDiffusion / FaceDetailer / DetailerForEach / MaskToSEGS / SolidMask / SAMLoader
    expect(result.current.options.animaMissingNodes).toEqual([
      "CFGZeroStar",
      "DifferentialDiffusion",
      "FaceDetailer",
      "DetailerForEach",
      "MaskToSEGS",
      "SolidMask",
      "SAMLoader",
    ]);
  });

  it("Anima 参数同步：模糊命中优先用精确关键词，避免命中同前缀的其它模型", async () => {
    const { setAnimaParams } = renderUseOptions();
    await waitFor(() => expect(setAnimaParams).toHaveBeenCalled());
    const [updater] = setAnimaParams.mock.calls[0];
    const prev = {
      modelStack: { unetName: "", weightDtype: "default", clipName: "", clipType: "", vaeName: "" },
      hires: { modelName: "" },
      samplerName: "",
      scheduler: "",
      refine: { samplerName: "", scheduler: "" },
      handDetector: "",
      faceDetector: "",
      eyesDetector: "",
      nsfwDetector: "",
    };
    const next = updater(prev);
    expect(next.modelStack.unetName).toBe("silvermoonmixAnima_v2329BTurbo.safetensors");
    // 关键：不能命中排在前面的 qwen3vl_4b_fp8_scaled
    expect(next.modelStack.clipName).toBe("qwen_3_06b_base.safetensors");
    expect(next.modelStack.vaeName).toBe("qwen_image_vae.safetensors");
    expect(next.hires.modelName).toBe("4x_foolhardy_Remacri.pth");
    expect(next.samplerName).toBe("er_sde");
    expect(next.scheduler).toBe("simple");
    expect(next.handDetector).toBe("bbox/hand_yolov8s.pt");
    expect(next.faceDetector).toBe("bbox/face_yolov8m.pt");
  });

  it("manager settings 归一化并驱动 onboarding 判定", async () => {
    const { result } = renderUseOptions();
    await waitFor(() => expect(result.current.loraSettings).toMatchObject({ mature_blur_level: "X" }));
    expect(result.current.needsOnboarding).toBe(false);
  });

  it("参数同步：checkpoint 失效时回落到首个可用项", async () => {
    const { setDefaultParams } = renderUseOptions();
    await waitFor(() => expect(setDefaultParams).toHaveBeenCalled());
    const [updater] = setDefaultParams.mock.calls[0];
    const prev = { checkpoint: "expired.safetensors" };
    expect(updater(prev)).toMatchObject({ checkpoint: "demo-a.safetensors" });
  });
});
