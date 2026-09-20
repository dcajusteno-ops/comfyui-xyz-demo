import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useOptions } from "./useOptions";
import type { ComfyClient } from "../lib/comfyClient";

// 与 ComfyUI /api/object_info/<node> 返回形状一致（按 nodeClass 键控）
function makeMockClient() {
  const objectInfo: Record<string, unknown> = {
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [["demo-a.safetensors", "demo-b.safetensors"]] } } },
    KSampler: { input: { required: { sampler_name: [["euler", "euler_ancestral"]], scheduler: [["simple", "karras"]] } } },
    "WD14Tagger|pysssss": { input: { required: { model: [["wd-v1-4-moat-tagger-v2"]], device: [["GPU", "CPU"]] } } },
    cl_tagger_mira: { input: { required: { model_name: [["cl_tagger/cl_tagger_1_02.onnx"]] } } },
    UltralyticsDetectorProvider: { input: { required: { model_name: [["bbox/hand_yolov8s.pt", "bbox/face_yolov8m.pt"]] } } },
    LatentUpscaleBy: { input: { required: { upscale_method: [["nearest-exact", "bilinear"]] } } },
    DrawTextAdvanced: { input: { required: { font: [["default"]] } } },
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
    expect(result.current.options.samplers).toEqual(["euler", "euler_ancestral"]);
    expect(result.current.options.schedulers).toEqual(["simple", "karras"]);
    expect(result.current.options.wdModels).toEqual(["wd-v1-4-moat-tagger-v2"]);
    expect(result.current.options.wdDevices).toEqual(["GPU", "CPU"]);
    expect(result.current.options.clModels).toEqual(["cl_tagger/cl_tagger_1_02.onnx"]);
    expect(result.current.options.detectors).toEqual(["bbox/hand_yolov8s.pt", "bbox/face_yolov8m.pt"]);
    expect(result.current.options.upscaleMethods).toEqual(["nearest-exact", "bilinear"]);
    expect(result.current.options.fonts).toEqual(["default"]);
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
