import { describe, expect, it } from "vitest";
import { cloneMultiCharacterConfig } from "../data/multiTemplate";
import type { BaseGenerationParams, HighresParams, MultiGenerationParams } from "../types";
import { buildDefaultPrompt, buildHighresPrompt, buildLoraSyntax, buildMultiPrompt, outputPrefix } from "./workflowBuilders";

const baseParams: BaseGenerationParams = {
  checkpoint: "anything-v5-PrtRE.safetensors",
  positivePrompt: "",
  negativePrompt: "",
  width: 832,
  height: 1216,
  batchSize: 1,
  seed: 42,
  randomizeSeed: false,
  steps: 20,
  cfg: 7,
  samplerName: "euler_ancestral",
  scheduler: "simple",
  denoise: 1,
  filenamePrefix: "%date:yyyy-MM-dd%/ComfyUI",
  loras: [
    { name: "my_lora_v0.6", strength: 0.8, clipStrength: 0.8, active: true },
    { name: "off", strength: 1, clipStrength: 1, active: false },
  ],
};

describe("workflow builders", () => {
  it("builds lora syntax from active selections", () => {
    expect(buildLoraSyntax(baseParams.loras)).toBe("<lora:my_lora_v0.6:0.8>");
  });

  it("builds default prompt without ui-only get/set nodes", () => {
    const prompt = buildDefaultPrompt(baseParams);
    expect(Object.values(prompt).map((node) => node.class_type)).not.toContain("GetNode");
    expect(Object.values(prompt).map((node) => node.class_type)).not.toContain("SetNode");
    expect(prompt["2"].class_type).toBe("Lora Loader (LoraManager)");
    expect(prompt["6"].inputs.seed).toBe(42);
  });

  it("expands ComfyUI-style date prefixes before SaveImage receives them", () => {
    const date = new Date("2026-06-09T15:06:00");
    expect(outputPrefix("%date:yyyy-MM-dd%/ComfyUI", "fallback", undefined, date)).toBe("2026-06-09/ComfyUI");
    expect(outputPrefix("bad:name/%date%", "fallback", undefined, date)).toBe("bad_name/20260609150600");
    expect(outputPrefix("base", "fallback", "apple")).toBe("base_apple");
    expect(outputPrefix("base", "fallback", "apple<>*")).toBe("base_apple___");
  });

  it("keeps multi structure and clears old prompt content", () => {
    const config = cloneMultiCharacterConfig();
    const params: MultiGenerationParams = {
      ...baseParams,
      width: 1024,
      height: 1536,
      steps: 25,
      cfg: 5,
      scheduler: "karras",
      globalPrompt: "",
      syntaxMode: "attention_couple",
      fusionMode: "mask_overlap",
      useFill: false,
      canvasWidth: 1024,
      canvasHeight: 1024,
      characters: config.characters,
    };
    const prompt = buildMultiPrompt(params);
    const mce = JSON.parse(prompt["2"].inputs.mce_config as string);
    expect(prompt["2"].inputs.base_prompt).toBe("");
    expect(mce.base_prompt).toBe("");
    expect(mce.global_prompt).toBe("<lora:my_lora_v0.6:0.8>");
    expect(mce.characters).toHaveLength(8);
    expect(mce.characters.every((character: { prompt: string }) => character.prompt === "")).toBe(true);
    expect(prompt["3"].class_type).toBe("PCLazyLoraLoader");
    expect(prompt["8"].inputs.cfg).toBe(5);
  });

  it("chains face, eyes, nsfw, and hand detailers correctly", () => {
    const detailer = {
      guideSize: 1024,
      maxSize: 1400,
      steps: 20,
      cfg: 7,
      denoise: 0.38,
      feather: 5,
      bboxThreshold: 0.5,
      bboxDilation: 10,
      bboxCropFactor: 3,
      samplerName: "euler_ancestral",
      scheduler: "simple",
    };
    const highres: HighresParams = {
      ...baseParams,
      enableUpscale: true,
      enableSegsDetailer: false,
      enableHandDetailer: false,
      enableFaceDetailer: false,
      enableEyesDetailer: false,
      enableNsfwDetailer: false,
      upscaleMethod: "nearest-exact",
      scaleBy: 1.5,
      highresSeed: 43,
      highresSteps: 20,
      highresCfg: 8,
      highresDenoise: 0.58,
      handDetector: "bbox/hand_yolov8s.pt",
      faceDetector: "bbox/face_yolov8m.pt",
      eyesDetector: "bbox/Eyeful_v2-Individual.pt",
      nsfwDetector: "segm/ntd11_anime_nsfw_segm_v5-variant1.pt",
      handDetailer: detailer,
      faceDetailer: { ...detailer, denoise: 0.25 },
      eyesDetailer: { ...detailer, denoise: 0.24 },
      nsfwDetailer: { ...detailer, denoise: 0.3 },
      segsDetailer: { ...detailer, denoise: 0.24 },
    };
    expect(Object.values(buildHighresPrompt({ ...highres })).filter((node) => node.class_type === "FaceDetailer")).toHaveLength(0);
    expect(Object.values(buildHighresPrompt({ ...highres, enableSegsDetailer: true })).filter((node) => node.class_type === "DetailerForEach")).toHaveLength(1);
    expect(Object.values(buildHighresPrompt({ ...highres, enableHandDetailer: true })).filter((node) => node.class_type === "FaceDetailer")).toHaveLength(1);
    expect(Object.values(buildHighresPrompt({ ...highres, enableFaceDetailer: true })).filter((node) => node.class_type === "FaceDetailer")).toHaveLength(1);
    expect(Object.values(buildHighresPrompt({ ...highres, enableEyesDetailer: true })).filter((node) => node.class_type === "FaceDetailer")).toHaveLength(1);
    expect(Object.values(buildHighresPrompt({ ...highres, enableNsfwDetailer: true })).filter((node) => node.class_type === "FaceDetailer")).toHaveLength(1);
    expect(Object.values(buildHighresPrompt({ ...highres, enableSegsDetailer: true, enableFaceDetailer: true, enableHandDetailer: true, enableEyesDetailer: true, enableNsfwDetailer: true })).filter((node) => node.class_type === "FaceDetailer" || node.class_type === "DetailerForEach")).toHaveLength(5);
  });

  it("handles all 64 combinations of repair toggles without throwing", () => {
    const detailer = { guideSize: 1024, maxSize: 1400, steps: 20, cfg: 7, denoise: 0.38, feather: 5, bboxThreshold: 0.5, bboxDilation: 10, bboxCropFactor: 3, samplerName: "euler_ancestral", scheduler: "simple" };
    const baseHighres: HighresParams = {
      ...baseParams, enableUpscale: false, enableSegsDetailer: false, enableHandDetailer: false, enableFaceDetailer: false, enableEyesDetailer: false, enableNsfwDetailer: false, upscaleMethod: "nearest-exact", scaleBy: 1.5, highresSeed: 43, highresSteps: 20, highresCfg: 8, highresDenoise: 0.58, handDetector: "bbox/hand_yolov8s.pt", faceDetector: "bbox/face_yolov8m.pt", eyesDetector: "bbox/Eyeful_v2-Individual.pt", nsfwDetector: "segm/ntd11_anime_nsfw_segm_v5-variant1.pt", handDetailer: detailer, faceDetailer: detailer, eyesDetailer: detailer, nsfwDetailer: detailer, segsDetailer: detailer,
    };
    
    let combinations = 0;
    for (let upscale of [false, true]) {
      for (let segs of [false, true]) {
        for (let face of [false, true]) {
          for (let eyes of [false, true]) {
            for (let nsfw of [false, true]) {
              for (let hand of [false, true]) {
                combinations++;
                expect(() => buildHighresPrompt({ ...baseHighres, enableUpscale: upscale, enableSegsDetailer: segs, enableFaceDetailer: face, enableEyesDetailer: eyes, enableNsfwDetailer: nsfw, enableHandDetailer: hand })).not.toThrow();
              }
            }
          }
        }
      }
    }
    expect(combinations).toBe(64);
  });
});
