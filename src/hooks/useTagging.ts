import { useMemo, useState } from "react";
import { useLocalStorageState } from "./useLocalStorageState";
import { CONFIG } from "../config";
import type { 
  Wd14Params, 
  ClSingleParams, 
  ClBatchParams, 
  WdBatchParams 
} from "../types";

export function useTagging() {
  const [wd14, setWd14] = useLocalStorageState<Wd14Params>("comfyui_wd14_params", {
    imageName: "",
    model: "wd-v1-4-moat-tagger-v2",
    threshold: 0.35,
    characterThreshold: 0.85,
    replaceUnderscore: true,
    trailingComma: true,
    excludeTags: "",
    device: "GPU",
  });
  
  const [wdFile, setWdFile] = useState<File | null>(null);
  const [wdTags, setWdTags] = useLocalStorageState("comfyui_wd_tags", "");
  const [wd14Tab, setWd14Tab] = useLocalStorageState<"single" | "cl_single" | "cl_batch" | "wd_batch">("comfyui_wd14_tab", "single");
  
  const [clFile, setClFile] = useState<File | null>(null);
  const [clSingleParams, setClSingleParams] = useLocalStorageState<ClSingleParams>("comfyui_cl_single_params", {
    imageName: "",
    modelName: "cl_tagger/cl_tagger_1_02.onnx",
    general: 0.55,
    character: 0.6,
    replaceSpace: true,
    categories: "rating,artist,general,character,copyright,meta,model,quality",
    excludeTags: "",
    sessionMethod: "GPU",
  });
  
  const [clBatchParams, setClBatchParams] = useLocalStorageState<ClBatchParams>("comfyui_cl_batch_params", {
    imageFolder: CONFIG.DEFAULT_TAG_IMAGE_FOLDER,
    outputFolder: CONFIG.DEFAULT_TAG_OUTPUT_FOLDER,
    prependText: "cs",
    runCount: 20,
    modelName: "cl_tagger/cl_tagger_1_02.onnx",
    general: 0.55,
    character: 0.6,
    replaceSpace: true,
    categories: "rating,artist,general,character,copyright,meta,model,quality",
    excludeTags: "",
    sessionMethod: "GPU",
  });
  
  const [wdBatchParams, setWdBatchParams] = useLocalStorageState<WdBatchParams>("comfyui_wd_batch_params", {
    imageFolder: CONFIG.DEFAULT_TAG_IMAGE_FOLDER,
    outputFolder: CONFIG.DEFAULT_TAG_OUTPUT_FOLDER,
    prependText: "cs",
    runCount: 20,
    model: "wd-v1-4-moat-tagger-v2",
    threshold: 0.35,
    characterThreshold: 0.85,
    replaceUnderscore: false,
    trailingComma: false,
    excludeTags: "",
    device: "GPU",
  });

  return useMemo(() => ({
    wd14,
    setWd14,
    wdFile,
    setWdFile,
    wdTags,
    setWdTags,
    wd14Tab,
    setWd14Tab,
    clFile,
    setClFile,
    clSingleParams,
    setClSingleParams,
    clBatchParams,
    setClBatchParams,
    wdBatchParams,
    setWdBatchParams,
  }), [
    wd14,
    wdFile,
    wdTags,
    wd14Tab,
    clFile,
    clSingleParams,
    clBatchParams,
    wdBatchParams,
  ]);
}
