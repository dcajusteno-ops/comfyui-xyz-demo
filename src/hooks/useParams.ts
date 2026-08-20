import { useMemo } from "react";
import { useLocalStorageState } from "./useLocalStorageState";
import { makeBaseParams, makeMultiParams, makeHighresParams } from "../lib/paramBuilders";
import { fallbackOptions } from "../constants";
import type { 
  BaseGenerationParams, 
  MultiGenerationParams, 
  HighresParams, 
  OptionsState 
} from "../types";

export function useParams() {
  const [options, setOptions] = useLocalStorageState<OptionsState>("comfyui_options", fallbackOptions);
  const [defaultParams, setDefaultParams] = useLocalStorageState<BaseGenerationParams>("comfyui_default_params", makeBaseParams());
  const [multiParams, setMultiParams] = useLocalStorageState<MultiGenerationParams>("comfyui_multi_params", makeMultiParams());
  const [highresParams, setHighresParams] = useLocalStorageState<HighresParams>("comfyui_highres_params", makeHighresParams());

  const allActiveLoraHashes = useMemo(() => {
    return [
      ...defaultParams.loras,
      ...multiParams.loras,
      ...highresParams.loras,
    ].map(l => l.sha256?.toLowerCase()).filter((h): h is string => Boolean(h));
  }, [defaultParams.loras, multiParams.loras, highresParams.loras]);

  return useMemo(() => ({
    options,
    setOptions,
    defaultParams,
    setDefaultParams,
    multiParams,
    setMultiParams,
    highresParams,
    setHighresParams,
    allActiveLoraHashes,
  }), [options, setOptions, defaultParams, setDefaultParams, multiParams, setMultiParams, highresParams, setHighresParams, allActiveLoraHashes]);
}
