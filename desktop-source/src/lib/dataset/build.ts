import type { AnimaGenerationParams, ComfyPrompt, DatasetConfig, DatasetItem, HighresParams, OptionsState } from "../../types";
import { sheetSdxlFixEnabled } from "../characterSheet";
import { buildAnimaPrompt, buildDefaultPrompt, buildHighresPrompt } from "../workflowBuilders";

/**
 * 数据集条目的工作流组装。
 *
 * 只做「把本条的提示词 / 种子 / 落盘前缀塞进既有参数」，
 * 不新增任何节点拓扑——Anima 走 buildAnimaPrompt，SDXL 走默认或高修链路。
 */

export function datasetHasReference(config: DatasetConfig): boolean {
  return Boolean(config.reference?.enabled && config.reference?.imageName);
}

/** ComfyUI 的落盘子目录：`<root>/<三位序号>`，保证每张图文件名可追溯到 item */
export function datasetItemPrefix(config: DatasetConfig, item: DatasetItem): string {
  const root = String(config.filenameRoot ?? "").trim().replace(/[\\/]+$/, "");
  const padded = String(item.index).padStart(3, "0");
  return root ? `${root}/${padded}` : padded;
}

/**
 * 五项强制覆盖（漏一项就会产出不可用于训练的图）：
 * 1) randomizeSeed=false —— 否则 resolveSeed 无视 item.seed，重跑换图；
 * 2) batchSize=1 —— 否则一条 item 出多张图，caption 对不上；
 * 3) stages.saveImage=true —— 否则走 PreviewImage，落 temp 目录会被清理；
 * 4) drawText=undefined —— 否则借用「默认生图」的水印烙进训练图；
 * 5) filenamePrefix 独立 —— 否则 100 条共用一个计数器，文件名无法对应 caption。
 */
export function toDatasetAnimaParams(config: DatasetConfig, item: DatasetItem): AnimaGenerationParams {
  const base = config.anima;
  const hasReference = datasetHasReference(config);
  return {
    ...base,
    checkpoint: "",
    positivePrompt: item.prompt,
    seed: item.seed,
    randomizeSeed: false,
    batchSize: 1,
    filenamePrefix: datasetItemPrefix(config, item),
    // Anima 的图生图开关是 stages.img2img（builder 判定 = stages.img2img && imageName）
    stages: { ...base.stages, img2img: hasReference, saveImage: true },
    img2img: { ...base.img2img, imageName: hasReference ? config.reference.imageName : "" },
    drawText: undefined,
  };
}

export function toDatasetSdxlParams(config: DatasetConfig, item: DatasetItem): HighresParams {
  const base = config.sdxl;
  const hasReference = datasetHasReference(config);
  return {
    ...base,
    positivePrompt: item.prompt,
    seed: item.seed,
    randomizeSeed: false,
    // 高修链的二次采样种子也要钉死，否则同一 item 重跑出不同图
    highresSeed: item.seed,
    randomizeHighresSeed: false,
    batchSize: 1,
    filenamePrefix: datasetItemPrefix(config, item),
    img2img: {
      enabled: hasReference,
      imageName: hasReference ? config.reference.imageName : "",
      fit: base.img2img?.fit ?? "stretch",
      upscaleMethod: base.img2img?.upscaleMethod ?? "lanczos",
      // 数据集页不做局部重绘，显式清空避免沿用旧值
      maskName: "",
    },
    drawText: undefined,
  };
}

export type DatasetBuildContext = {
  animaCaps?: OptionsState["animaCaps"];
};

export function buildDatasetPrompt(
  config: DatasetConfig,
  item: DatasetItem,
  ctx: DatasetBuildContext = {},
): ComfyPrompt {
  if (config.mode === "anima") {
    return buildAnimaPrompt(toDatasetAnimaParams(config, item), ctx.animaCaps ?? {});
  }
  const sdxlParams = toDatasetSdxlParams(config, item);
  // 修复全关 → 纯文生图；任一修复开启 → 高修链路（与三视图同一判定）
  return sheetSdxlFixEnabled(sdxlParams)
    ? buildHighresPrompt(sdxlParams)
    : buildDefaultPrompt(sdxlParams);
}
