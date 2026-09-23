import { useState } from "react";
import { useLocalStorageState } from "./useLocalStorageState";
import type { AnimaGenerationParams, BaseGenerationParams, HighresParams, LoraSelection, MultiGenerationParams, XyzAxis, TemplateKind } from "../types";

/** XYZ 需要读取的四个模板参数集合（与 useParams 的返回对齐） */
export type XyzParamsBundle = {
  defaultParams: BaseGenerationParams;
  multiParams: MultiGenerationParams;
  highresParams: HighresParams;
  animaParams: AnimaGenerationParams;
};

export function useXyz() {
  const [xyzTarget, setXyzTarget] = useLocalStorageState<TemplateKind>("comfyui_xyz_target", "default");
  
  const [xyzAxes, setXyzAxes] = useLocalStorageState<XyzAxis[]>("comfyui_xyz_axes", [
    { enabled: true, field: "seed", values: "1,2" },
    { enabled: false, field: "cfg", values: "5,7" },
    { enabled: false, field: "steps", values: "20..30..10" },
  ]);
  
  const [xyzExcludedIndices, setXyzExcludedIndices] = useState<Set<number>>(new Set());
  const [showXyzHelp, setShowXyzHelp] = useState(false);

  const toggleXyzIndex = (index: number) => {
    setXyzExcludedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const getXyzLoras = (params: XyzParamsBundle): LoraSelection[] => {
    switch (xyzTarget) {
      case "default":
        return params.defaultParams.loras;
      case "multi":
        return params.multiParams.loras;
      case "highres":
        return params.highresParams.loras;
      case "anima":
        return params.animaParams.loras;
      default:
        return [];
    }
  };

  return {
    xyzTarget,
    setXyzTarget,
    xyzAxes,
    setXyzAxes,
    xyzExcludedIndices,
    setXyzExcludedIndices,
    toggleXyzIndex,
    getXyzLoras,
    showXyzHelp,
    setShowXyzHelp,
  };
}
