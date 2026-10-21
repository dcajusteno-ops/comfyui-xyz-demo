import { useMemo, useState } from "react";
import { usePersistentState } from "./usePersistentState";
import {
  makeBaseParams,
  makeMultiParams,
  makeHighresParams,
  makeAnimaParams,
  makeSheetParams,
  normalizeSheetParams,
} from "../lib/paramBuilders";
import { fallbackOptions } from "../constants";
import type { 
  BaseGenerationParams, 
  MultiGenerationParams, 
  HighresParams, 
  AnimaGenerationParams,
  SheetParams,
  OptionsState 
} from "../types";

export function useParams() {
  const [options, setOptions] = usePersistentState<OptionsState>("comfyui_options", fallbackOptions);
  const [defaultParams, setDefaultParams] = usePersistentState<BaseGenerationParams>("comfyui_default_params", makeBaseParams());
  const [multiParams, setMultiParams] = usePersistentState<MultiGenerationParams>("comfyui_multi_params", makeMultiParams());
  const [highresParams, setHighresParams] = usePersistentState<HighresParams>("comfyui_highres_params", makeHighresParams());
  const [animaParams, setAnimaParams] = usePersistentState<AnimaGenerationParams>("comfyui_anima_params", makeAnimaParams());
  /**
   * 三视图页的默认值只在首次挂载取一次快照（模型栈 / checkpoint / 采样参数从上面几套继承），
   * 之后由 `comfyui_sheet_params` 自维护——不能跟随 Anima 面板变化，否则「独立一套参数」名存实亡。
   * SDXL 侧的修复区以「高清修复」参数为骨架（放大方法/倍率/修复链取值一致），但开关全部从关闭开始。
   */
  const [sheetDefaults] = useState<SheetParams>(() => makeSheetParams(animaParams, defaultParams, highresParams));
  const [sheetParams, setSheetParams] = usePersistentState<SheetParams>(
    "comfyui_sheet_params",
    sheetDefaults,
    normalizeSheetParams,
  );

  const allActiveLoraHashes = useMemo(() => {
    return [
      ...defaultParams.loras,
      ...multiParams.loras,
      ...highresParams.loras,
      ...animaParams.loras,
      ...sheetParams.anima.loras,
      ...sheetParams.sdxl.loras,
    ].map(l => l.sha256?.toLowerCase()).filter((h): h is string => Boolean(h));
  }, [
    defaultParams.loras,
    multiParams.loras,
    highresParams.loras,
    animaParams.loras,
    sheetParams.anima.loras,
    sheetParams.sdxl.loras,
  ]);

  return useMemo(() => ({
    options,
    setOptions,
    defaultParams,
    setDefaultParams,
    multiParams,
    setMultiParams,
    highresParams,
    setHighresParams,
    animaParams,
    setAnimaParams,
    sheetParams,
    setSheetParams,
    allActiveLoraHashes,
  }), [options, setOptions, defaultParams, setDefaultParams, multiParams, setMultiParams, highresParams, setHighresParams, animaParams, setAnimaParams, sheetParams, setSheetParams, allActiveLoraHashes]);
}
