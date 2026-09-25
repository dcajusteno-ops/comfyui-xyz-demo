import { useEffect, useState } from "react";
import type { ComfyClient } from "../lib/comfyClient";
import type { AnimaGenerationParams, BaseGenerationParams, ClBatchParams, ClSingleParams, HighresParams, MultiGenerationParams, OptionsState, Toast, Wd14Params, WdBatchParams } from "../types";
import { defaultLoraManagerSettings, fallbackOptions as globalFallbackOptions } from "../constants";
import { normalizeLoraManagerSettings, readCombo } from "../lib/lora-helper";
import { defaultTranslationSettings } from "../lib/translation";
import type { LoraManagerSettings } from "../types";

type ToastFn = (type: Toast["type"], title: string, message?: string) => void;

export function useOptions({ client, pushToast, setDefaultParams, setMultiParams, setHighresParams, setAnimaParams, setWd14, setWdBatchParams, setClBatchParams, setClSingleParams }: {
  client: ComfyClient;
  pushToast: ToastFn;
  setDefaultParams: React.Dispatch<React.SetStateAction<BaseGenerationParams>>;
  setMultiParams: React.Dispatch<React.SetStateAction<MultiGenerationParams>>;
  setHighresParams: React.Dispatch<React.SetStateAction<HighresParams>>;
  setAnimaParams: React.Dispatch<React.SetStateAction<AnimaGenerationParams>>;
  setWd14: React.Dispatch<React.SetStateAction<Wd14Params>>;
  setWdBatchParams: React.Dispatch<React.SetStateAction<WdBatchParams>>;
  setClBatchParams: React.Dispatch<React.SetStateAction<ClBatchParams>>;
  setClSingleParams: React.Dispatch<React.SetStateAction<ClSingleParams>>;
}) {
  const [options, setOptions] = useState<OptionsState>(globalFallbackOptions);
  const [loraSettings, setLoraSettings] = useState<typeof defaultLoraManagerSettings>(defaultLoraManagerSettings);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const [checkpointInfo, ksamplerInfo, wdInfo, clInfo, detectorInfo, upscaleInfo, drawTextInfo, managerSettings, unetInfo, clipInfo, vaeInfo, easyHiresInfo, resizeInfo, upscaleLoaderInfo, cfgZeroInfo, diffDiffInfo, faceDetailerInfo, detailerForEachInfo, maskToSegsInfo, solidMaskInfo, samLoaderInfo, imageScaleInfo] = await Promise.all([
          client.getObjectInfo("CheckpointLoaderSimple"),
          client.getObjectInfo("KSampler"),
          client.getObjectInfo("WD14Tagger|pysssss").catch(() => null),
          client.getObjectInfo("cl_tagger_mira").catch(() => null),
          client.getObjectInfo("UltralyticsDetectorProvider").catch(() => null),
          client.getObjectInfo("LatentUpscaleBy").catch(() => null),
          client.getObjectInfo("DrawTextAdvanced").catch(() => null),
          client.getLoraManagerSettings().catch(() => defaultLoraManagerSettings),
          client.getObjectInfo("UNETLoader").catch(() => null),
          client.getObjectInfo("CLIPLoader").catch(() => null),
          client.getObjectInfo("VAELoader").catch(() => null),
          client.getObjectInfo("easy hiresFix").catch(() => null),
          client.getObjectInfo("ImageResizeKJv2").catch(() => null),
          client.getObjectInfo("UpscaleModelLoader").catch(() => null),
          client.getObjectInfo("CFGZeroStar").catch(() => null),
          client.getObjectInfo("DifferentialDiffusion").catch(() => null),
          client.getObjectInfo("FaceDetailer").catch(() => null),
          client.getObjectInfo("DetailerForEach").catch(() => null),
          client.getObjectInfo("MaskToSEGS").catch(() => null),
          client.getObjectInfo("SolidMask").catch(() => null),
          client.getObjectInfo("SAMLoader").catch(() => null),
          client.getObjectInfo("ImageScale").catch(() => null),
        ]);
        if (canceled) return;

        const chkList: string[] = readCombo(checkpointInfo, "CheckpointLoaderSimple", "ckpt_name", []);
        const samplerList: string[] = readCombo(ksamplerInfo, "KSampler", "sampler_name", []);
        const schedulerList: string[] = readCombo(ksamplerInfo, "KSampler", "scheduler", []);
        const wdModelList: string[] = wdInfo ? readCombo(wdInfo, "WD14Tagger|pysssss", "model", []) : [];
        const wdDeviceList: string[] = wdInfo ? readCombo(wdInfo, "WD14Tagger|pysssss", "device", ["GPU", "CPU"]) : ["GPU", "CPU"];
        const clModelList: string[] = clInfo ? readCombo(clInfo, "cl_tagger_mira", "model_name", []) : [];
        const detList: string[] = detectorInfo ? readCombo(detectorInfo, "UltralyticsDetectorProvider", "model_name", []) : [];
        const upScaleList: string[] = upscaleInfo ? readCombo(upscaleInfo, "LatentUpscaleBy", "upscale_method", []) : [];
        // 图生图缩放用。**不能复用 upScaleList**：ImageScale 的枚举含 lanczos 而不含 bislerp，
        // 与 LatentUpscaleBy 恰好不同，混用会把非法值送进工作流。
        const imageScaleList: string[] = imageScaleInfo ? readCombo(imageScaleInfo, "ImageScale", "upscale_method", []) : [];
        const fontList: string[] = drawTextInfo ? readCombo(drawTextInfo, "DrawTextAdvanced", "font", []) : [];

        // Anima：UNET / CLIP / VAE 三段式模型栈
        const unetList: string[] = unetInfo ? readCombo(unetInfo, "UNETLoader", "unet_name", []) : [];
        const clipList: string[] = clipInfo ? readCombo(clipInfo, "CLIPLoader", "clip_name", []) : [];
        const clipTypeList: string[] = clipInfo ? readCombo(clipInfo, "CLIPLoader", "type", ["stable_diffusion"]) : ["stable_diffusion"];
        const vaeList: string[] = vaeInfo ? readCombo(vaeInfo, "VAELoader", "vae_name", []) : [];
        // 放大模型有两个来源：easy hiresFix（旧格式，已实测可解析）与 UpscaleModelLoader（新 COMBO 格式）。
        // 两者取并集，任一可用即可，避免单点失败导致下拉为空。
        const upscaleModelList: string[] = Array.from(new Set([
          ...(easyHiresInfo ? readCombo(easyHiresInfo, "easy hiresFix", "model_name", []) : []),
          ...(upscaleLoaderInfo ? readCombo(upscaleLoaderInfo, "UpscaleModelLoader", "model_name", []) : []),
        ]));
        const animaCaps = {
          useEasyHiresFix: easyHiresInfo ? Boolean((easyHiresInfo as Record<string, { input?: unknown }>)["easy hiresFix"]?.input) : true,
          useImageResizeKJv2: resizeInfo ? Boolean((resizeInfo as Record<string, { input?: unknown }>)["ImageResizeKJv2"]?.input) : true,
        };

        // 节点依赖自检：探测结果里有该键但没有 input，说明节点没装（ComfyUI 对未知节点返回 {}）
        const hasNode = (name: string, info: unknown) =>
          !info || Boolean((info as Record<string, { input?: unknown }>)[name]?.input);
        const requiredAnimaNodes: Array<[string, unknown]> = [
          ["UNETLoader", unetInfo],
          ["CLIPLoader", clipInfo],
          ["VAELoader", vaeInfo],
          ["CFGZeroStar", cfgZeroInfo],
          ["DifferentialDiffusion", diffDiffInfo],
          ["FaceDetailer", faceDetailerInfo],
          ["DetailerForEach", detailerForEachInfo],
          ["MaskToSEGS", maskToSegsInfo],
          ["SolidMask", solidMaskInfo],
          ["UltralyticsDetectorProvider", detectorInfo],
          ["SAMLoader", samLoaderInfo],
          ["easy hiresFix", easyHiresInfo],
          ["ImageResizeKJv2", resizeInfo],
        ];
        const animaMissingNodes = requiredAnimaNodes
          .filter(([name, info]) => !hasNode(name, info))
          .map(([name]) => name);

        const nextOptions: OptionsState = {
          checkpoints: chkList,
          samplers: samplerList,
          schedulers: schedulerList,
          wdModels: wdModelList,
          wdDevices: wdDeviceList,
          clModels: clModelList,
          detectors: detList,
          upscaleMethods: upScaleList,
          imageScaleMethods: imageScaleList,
          fonts: fontList,
          translation: defaultTranslationSettings,
          unets: unetList,
          clips: clipList,
          clipTypes: clipTypeList,
          vaes: vaeList,
          upscaleModels: upscaleModelList,
          animaCaps,
          animaMissingNodes,
        };

        setOptions(nextOptions);

        const managerResult: Record<string, unknown> = managerSettings as Record<string, unknown>;
        const fallbackSettings: LoraManagerSettings = defaultLoraManagerSettings;
        const rawSettings: LoraManagerSettings | undefined = managerResult.settings ? managerResult.settings as LoraManagerSettings : undefined;
        const finalSettings = normalizeLoraManagerSettings(rawSettings ?? fallbackSettings);
        setLoraSettings(finalSettings);

        // Enforce onboarding / setting the example images directory on first launch
        const needs = finalSettings.onboarding_completed !== true || !finalSettings.example_images_path;
        setNeedsOnboarding(Boolean(needs));

        const firstCheckpoint = nextOptions.checkpoints[0] ?? "";

        // Sync params with loaded options
        setDefaultParams((prev: BaseGenerationParams) => ({ ...prev, checkpoint: chkList.includes(prev.checkpoint) ? prev.checkpoint : firstCheckpoint, drawText: prev.drawText ? { ...prev.drawText, font: pickFont(prev.drawText.font) } : prev.drawText, }));
        setMultiParams((prev: MultiGenerationParams) => ({ ...prev, checkpoint: chkList.includes(prev.checkpoint) ? prev.checkpoint : firstCheckpoint, drawText: prev.drawText ? { ...prev.drawText, font: pickFont(prev.drawText.font) } : prev.drawText, }));
        setHighresParams((prev: HighresParams) => ({
          ...prev,
          checkpoint: chkList.includes(prev.checkpoint) ? prev.checkpoint : firstCheckpoint,
          handDetector: detList.includes(prev.handDetector) ? prev.handDetector : (detList.find((item) => item.includes("hand")) ?? ""),
          faceDetector: detList.includes(prev.faceDetector) ? prev.faceDetector : (detList.find((item) => item.includes("face")) ?? ""),
          eyesDetector: detList.includes(prev.eyesDetector) ? prev.eyesDetector : (detList.find((item) => item.includes("Eye") || item.includes("eye")) ?? (prev.eyesDetector || "")),
          nsfwDetector: detList.includes(prev.nsfwDetector) ? prev.nsfwDetector : (detList.find((item) => item.includes("nsfw")) ?? (prev.nsfwDetector || "")),
          drawText: prev.drawText ? { ...prev.drawText, font: pickFont(prev.drawText.font) } : prev.drawText,
        }));

        // Anima 模型栈与参数：模糊命中优先（按关键词优先级），否则回退列表首项。
        // 关键词要给足精度——例如 CLIP 列表里 `qwen3vl_*` 会先于 `qwen_3_06b_base` 命中裸 "qwen"。
        const pickBy = (list: string[], keywords: string[]) => {
          for (const kw of keywords) {
            const hit = list.find((item) => item.toLowerCase().includes(kw.toLowerCase()));
            if (hit) return hit;
          }
          return list[0] ?? "";
        };
        // 水印字体：默认参数里的 "default" 只是占位，真实节点校验的是字体文件清单——
        // 不在清单里时按「模糊命中优先、否则取首项」纠正（清单为空说明节点未装，保持原值）
        const pickFont = (font: string) => {
          if (fontList.includes(font)) return font;
          const hit = font !== "default"
            ? fontList.find((item) => item.toLowerCase().includes(font.toLowerCase()))
            : undefined;
          return hit ?? fontList[0] ?? font;
        };
        /**
         * UNet 选择：面板默认是 Turbo 蒸馏参数（steps 8 / cfg 1），配非蒸馏模型会直接出废图。
         * 因此先在命中 "anima" 的候选里**优先取同时含 "turbo" 的**，没有才退回第一个 anima 模型。
         */
        const pickAnimaUnet = (list: string[]) => {
          const animaHits = list.filter((item) => item.toLowerCase().includes("anima"));
          if (!animaHits.length) return list[0] ?? "";
          return animaHits.find((item) => item.toLowerCase().includes("turbo")) ?? animaHits[0];
        };
        setAnimaParams((prev: AnimaGenerationParams) => ({
          ...prev,
          modelStack: {
            ...prev.modelStack,
            unetName: unetList.includes(prev.modelStack.unetName)
              ? prev.modelStack.unetName
              : pickAnimaUnet(unetList),
            clipName: clipList.includes(prev.modelStack.clipName)
              ? prev.modelStack.clipName
              : pickBy(clipList, ["qwen_3_06b", "qwen_3_", "qwen"]),
            clipType: clipTypeList.includes(prev.modelStack.clipType)
              ? prev.modelStack.clipType
              : pickBy(clipTypeList, ["stable_diffusion"]),
            vaeName: vaeList.includes(prev.modelStack.vaeName)
              ? prev.modelStack.vaeName
              : pickBy(vaeList, ["qwen_image_vae", "qwen"]),
          },
          hires: {
            ...prev.hires,
            modelName: upscaleModelList.includes(prev.hires.modelName)
              ? prev.hires.modelName
              : pickBy(upscaleModelList, ["remacri"]),
          },
          samplerName: samplerList.includes(prev.samplerName)
            ? prev.samplerName
            : pickBy(samplerList, ["er_sde"]),
          scheduler: schedulerList.includes(prev.scheduler)
            ? prev.scheduler
            : pickBy(schedulerList, ["simple"]),
          refine: {
            ...prev.refine,
            samplerName: samplerList.includes(prev.refine.samplerName)
              ? prev.refine.samplerName
              : pickBy(samplerList, ["er_sde"]),
            scheduler: schedulerList.includes(prev.refine.scheduler)
              ? prev.refine.scheduler
              : pickBy(schedulerList, ["simple"]),
          },
          handDetector: detList.includes(prev.handDetector)
            ? prev.handDetector
            : pickBy(detList, ["hand"]),
          faceDetector: detList.includes(prev.faceDetector)
            ? prev.faceDetector
            : pickBy(detList, ["face"]),
          eyesDetector: detList.includes(prev.eyesDetector)
            ? prev.eyesDetector
            : pickBy(detList, ["eyeful", "eye"]),
          nsfwDetector: detList.includes(prev.nsfwDetector)
            ? prev.nsfwDetector
            : pickBy(detList, ["nsfw"]),
          drawText: prev.drawText ? { ...prev.drawText, font: pickFont(prev.drawText.font) } : prev.drawText,
        }));

        setWd14((prev: Wd14Params) => ({
          ...prev,
          model: wdModelList.includes(String(prev.model)) ? String(prev.model) : (wdModelList[0] ?? ""),
          device: wdDeviceList.includes(String(prev.device)) ? String(prev.device) : (wdDeviceList[0] ?? prev.device)
        }));
        setWdBatchParams((prev: WdBatchParams) => ({
          ...prev,
          model: wdModelList.includes(String(prev.model)) ? String(prev.model) : (wdModelList[0] ?? ""),
          device: wdDeviceList.includes(String(prev.device)) ? String(prev.device) : (wdDeviceList[0] ?? prev.device)
        }));
        setClBatchParams((prev: ClBatchParams) => ({
          ...prev,
          modelName: clModelList.includes(String(prev.modelName)) ? String(prev.modelName) : (clModelList[0] ?? ""),
          sessionMethod: wdDeviceList.includes(String(prev.sessionMethod)) ? String(prev.sessionMethod) : (wdDeviceList[0] ?? prev.sessionMethod)
        }));
        setClSingleParams((prev: ClSingleParams) => ({
          ...prev,
          modelName: clModelList.includes(String(prev.modelName)) ? String(prev.modelName) : (clModelList[0] ?? ""),
          sessionMethod: wdDeviceList.includes(String(prev.sessionMethod)) ? String(prev.sessionMethod) : (wdDeviceList[0] ?? prev.sessionMethod)
        }));

      } catch (loadError) {
        if (canceled) return;
        pushToast("error", "连接失败", loadError instanceof Error ? loadError.message : String(loadError));
      }
    }
    load();
    return () => { canceled = true; };
  }, [client]);

  return {
    options,
    setOptions,
    loraSettings,
    setLoraSettings,
    needsOnboarding,
  };
}
