import { useMemo, useState } from "react";
import { usePersistentState } from "./usePersistentState";
import {
  DEFAULT_WATERMARK_PARAMS,
  normalizeWatermarkAuto,
  normalizeWatermarkParams,
  type WatermarkParams,
} from "../lib/watermark";

/**
 * 水印设置（生图自动水印 + 手动水印弹窗共用一套参数）。
 * 在 App.tsx 创建**一次**后经 props 下发：
 * - useGeneration：结果落地时按 auto/baked 决定是否前端叠加（baked=已烙入工作流则跳过，防双重水印）
 * - WatermarkModal：编辑参数 / 开关
 * - App 的烘焙 effect：auto 开时渲染双图上传 ComfyUI，写 baked 状态并把烙入配置写进各模板 drawText.watermark
 * 避免多处各自 usePersistentState 导致状态不同步。
 */
export function useWatermarkSettings() {
  const [params, setParams] = usePersistentState<WatermarkParams>(
    "comfyui_xyz_watermark_params",
    DEFAULT_WATERMARK_PARAMS,
    normalizeWatermarkParams,
  );
  const [auto, setAuto] = usePersistentState<boolean>(
    "comfyui_xyz_watermark_auto",
    false,
    normalizeWatermarkAuto,
  );
  // 工作流烙入是否就绪（非持久化，本次会话内由 App 的烘焙 effect 维护）
  const [baked, setBaked] = useState(false);

  return useMemo(
    () => ({ params, setParams, auto, setAuto, baked, setBaked }),
    [params, setParams, auto, setAuto, baked, setBaked],
  );
}

export type WatermarkSettings = ReturnType<typeof useWatermarkSettings>;
