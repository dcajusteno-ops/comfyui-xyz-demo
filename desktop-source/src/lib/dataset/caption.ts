import type { DatasetConfig, DatasetFile, DatasetItem, DatasetRunState } from "../../types";
import { activeDatasetLoras } from "./signature";

/** 去掉扩展名的相对路径（`Datasets/x/001_00001_.png` → `Datasets/x/001_00001_`） */
export function datasetFileStem(file: DatasetFile): string {
  const path = file.subfolder ? `${file.subfolder}/${file.filename}` : file.filename;
  return path.replace(/\.[A-Za-z0-9]{1,8}$/, "");
}

/**
 * caption 清单：一行一条，`文件路径<TAB>caption`。
 *
 * 为什么不逐张导出 .txt：浏览器对同一站点连续自动下载会拦截，100 次必然失败。
 * 需要逐文件落盘时，把这个清单交给训练脚本按行拆即可。
 */
export function buildCaptionsText(items: DatasetItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    if (item.status !== "success" || !item.files.length) continue;
    for (const file of item.files) {
      lines.push(`${datasetFileStem(file)}\t${item.caption}`);
    }
  }
  return lines.join("\n");
}

export function buildManifest(config: DatasetConfig, run: DatasetRunState) {
  const items = run.items;
  const success = items.filter((item) => item.status === "success").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const params = config[config.mode];
  const model = config.mode === "anima" ? config.anima.modelStack.unetName : config.sdxl.checkpoint;

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    mode: config.mode,
    planSeed: run.planSeed,
    character: {
      subject: config.subject,
      prompt: config.characterPrompt,
      trigger: config.trigger,
      style: config.style[config.mode],
      reference: config.reference.enabled ? config.reference.imageName : "",
    },
    settings: {
      model,
      width: params.width,
      height: params.height,
      steps: params.steps,
      cfg: params.cfg,
      sampler: params.samplerName,
      scheduler: params.scheduler,
      denoise: params.denoise,
      negativePrompt: params.negativePrompt,
      caption: { ...config.caption },
      // 用 manifest 复现同一批图时，LoRA 组合是必需信息（之前漏了）
      loras: activeDatasetLoras(config).map((lora) => ({
        name: lora.name,
        displayName: lora.displayName,
        strength: lora.strength,
        clipStrength: lora.clipStrength,
        sha256: lora.sha256,
      })),
    },
    counts: { total: items.length, success, failed, pending: items.length - success - failed },
    items: items.map((item) => ({
      index: item.index,
      seed: item.seed,
      status: item.status,
      tags: item.tags,
      prompt: item.prompt,
      caption: item.caption,
      files: item.files,
      error: item.error,
    })),
  };
}
