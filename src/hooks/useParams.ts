import { useMemo } from "react";
import { usePersistentState } from "./usePersistentState";
import { makeBaseParams, makeMultiParams, makeHighresParams, makeAnimaParams } from "../lib/paramBuilders";
import { fallbackOptions } from "../constants";
import type { 
  BaseGenerationParams, 
  MultiGenerationParams, 
  HighresParams, 
  AnimaGenerationParams,
  OptionsState 
} from "../types";

export function useParams() {
  const [options, setOptions] = usePersistentState<OptionsState>("comfyui_options", fallbackOptions);
  const [defaultParams, setDefaultParams] = usePersistentState<BaseGenerationParams>("comfyui_default_params", makeBaseParams());
  const [multiParams, setMultiParams] = usePersistentState<MultiGenerationParams>("comfyui_multi_params", makeMultiParams());
  const [highresParams, setHighresParams] = usePersistentState<HighresParams>("comfyui_highres_params", makeHighresParams());
  const [animaParams, setAnimaParams] = usePersistentState<AnimaGenerationParams>("comfyui_anima_params", makeAnimaParams());

  const allActiveLoraHashes = useMemo(() => {
    return [
      ...defaultParams.loras,
      ...multiParams.loras,
      ...highresParams.loras,
      ...animaParams.loras,
    ].map(l => l.sha256?.toLowerCase()).filter((h): h is string => Boolean(h));
  }, [defaultParams.loras, multiParams.loras, highresParams.loras, animaParams.loras]);

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
    allActiveLoraHashes,
  }), [options, setOptions, defaultParams, setDefaultParams, multiParams, setMultiParams, highresParams, setHighresParams, animaParams, setAnimaParams, allActiveLoraHashes]);
}
