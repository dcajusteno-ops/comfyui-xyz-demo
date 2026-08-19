import { useEffect, useState } from "react";
import type { ComfyClient } from "../lib/comfyClient";
import type { BaseGenerationParams, HighresParams, OptionsState, Toast } from "../types";
import { defaultLoraManagerSettings } from "../constants";
import { normalizeLoraManagerSettings, readCombo } from "../lib/lora-helper";
import type { LoraManagerSettings } from "../types";

type ToastFn = (type: Toast["type"], title: string, message?: string) => void;

export function useOptions({ client, pushToast, setDefaultParams, setMultiParams, setHighresParams, setWd14, setWdBatchParams, setClBatchParams }: {
  client: ComfyClient;
  pushToast: ToastFn;
  setDefaultParams: React.Dispatch<React.SetStateAction<BaseGenerationParams>>;
  setMultiParams: React.Dispatch<React.SetStateAction<any>>;
  setHighresParams: React.Dispatch<React.SetStateAction<any>>;
  setWd14: React.Dispatch<React.SetStateAction<any>>;
  setWdBatchParams: React.Dispatch<React.SetStateAction<any>>;
  setClBatchParams: React.Dispatch<React.SetStateAction<any>>;
}) {
  const fallbackOptions: OptionsState = {
    checkpoints: [], samplers: [], schedulers: [], wdModels: [], wdDevices: [],
    clModels: [], detectors: [], upscaleMethods: [], fonts: [],
  };

  const [options, setOptions] = useState<OptionsState>(fallbackOptions);
  const [loraSettings, setLoraSettings] = useState<typeof defaultLoraManagerSettings>(defaultLoraManagerSettings);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const [stats, checkpointInfo, ksamplerInfo, wdInfo, clInfo, detectorInfo, upscaleInfo, drawTextInfo, managerSettings] = await Promise.all([
          client.getSystemStats(),
          client.getObjectInfo("CheckpointLoaderSimple"),
          client.getObjectInfo("KSampler"),
          client.getObjectInfo("WD14Tagger|pysssss").catch(() => null),
          client.getObjectInfo("cl_tagger_mira").catch(() => null),
          client.getObjectInfo("UltralyticsDetectorProvider").catch(() => null),
          client.getObjectInfo("LatentUpscaleBy").catch(() => null),
          client.getObjectInfo("DrawTextAdvanced").catch(() => null),
          client.getLoraManagerSettings().catch(() => defaultLoraManagerSettings),
        ]);
        if (canceled) return;

        const chkList: string[] = readCombo(checkpointInfo, "CheckpointLoaderSimple", "ckpt_name", []);
        const samplerList: string[] = readCombo(ksamplerInfo, "KSampler", "sampler_name", []);
        const schedulerList: string[] = readCombo(ksamplerInfo, "KSampler", "scheduler", []);
        const wdModelList: string[] = wdInfo ? readCombo(wdInfo, "WD14Tagger|pysssss", "model", []) : [];
        const wdDeviceList: string[] = wdInfo ? readCombo(wdInfo, "WD14Tagger|pysssss", "device", []) : [];
        const clModelList: string[] = clInfo ? readCombo(clInfo, "cl_tagger_mira", "model_name", []) : [];
        const detList: string[] = detectorInfo ? readCombo(detectorInfo, "UltralyticsDetectorProvider", "model_name", []) : [];
        const upScaleList: string[] = upscaleInfo ? readCombo(upscaleInfo, "LatentUpscaleBy", "upscale_method", []) : [];
        const fontList: string[] = drawTextInfo ? readCombo(drawTextInfo, "DrawTextAdvanced", "font", []) : [];

        const nextOptions: OptionsState = {
          checkpoints: chkList,
          samplers: samplerList,
          schedulers: schedulerList,
          wdModels: wdModelList,
          wdDevices: wdDeviceList,
          clModels: clModelList,
          detectors: detList,
          upscaleMethods: upScaleList,
          fonts: fontList,
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
        setDefaultParams((prev: BaseGenerationParams) => ({ ...prev, checkpoint: chkList.includes(prev.checkpoint) ? prev.checkpoint : firstCheckpoint }));
        setMultiParams((prev: HighresParams & { checkpoint: string }) => ({ ...prev, checkpoint: chkList.includes(prev.checkpoint) ? prev.checkpoint : firstCheckpoint }));
        setHighresParams((prev: HighresParams & { handDetector: string; faceDetector: string; eyesDetector: string; nsfwDetector: string }) => ({
          ...prev,
          checkpoint: chkList.includes(prev.checkpoint) ? prev.checkpoint : firstCheckpoint,
          handDetector: detList.includes(prev.handDetector) ? prev.handDetector : (detList.find((item) => item.includes("hand")) ?? ""),
          faceDetector: detList.includes(prev.faceDetector) ? prev.faceDetector : (detList.find((item) => item.includes("face")) ?? ""),
          eyesDetector: detList.includes(prev.eyesDetector) ? prev.eyesDetector : (detList.find((item) => item.includes("Eye") || item.includes("eye")) ?? (prev.eyesDetector || "")),
          nsfwDetector: detList.includes(prev.nsfwDetector) ? prev.nsfwDetector : (detList.find((item) => item.includes("nsfw")) ?? (prev.nsfwDetector || "")),
        }));

        setWd14((prev: Record<string, unknown>) => ({ ...prev, model: wdModelList.includes(String(prev.model)) ? String(prev.model) : (wdModelList[0] ?? "") }));
        setWdBatchParams((prev: Record<string, unknown>) => ({ ...prev, model: wdModelList.includes(String(prev.model)) ? String(prev.model) : (wdModelList[0] ?? "") }));
        setClBatchParams((prev: Record<string, unknown>) => ({ ...prev, modelName: clModelList.includes(String(prev.modelName)) ? String(prev.modelName) : (clModelList[0] ?? "") }));

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
    loraSettings,
    setLoraSettings,
    needsOnboarding,
  };
}
