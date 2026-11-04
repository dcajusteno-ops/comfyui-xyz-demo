import type { ComfyPrompt, DatasetConfig, DatasetFile, DatasetItem } from "../../types";

/**
 * 「出图的同时写同名 .txt」。
 *
 * 为什么不在图片那张工作流里顺带加一个 Save Text：ComfyUI 给文件名追加的计数器是
 * 按「前缀 + 目录」扫描已有文件得出的，同一目录同一前缀先后落盘会让第二个文件
 * 拿到 `_00002_`，与图片的 `_00001_` 错位。
 *
 * 所以改成**出图后单独提交一个极小的工作流**：拿 history 里返回的真实文件名当
 * `filename_opt`（> Save Text 支持精确文件名），落盘就是 `<图片同名>.txt`。
 * 依赖第三方节点 `> Save Text`（ComfyUI_yanc），可用性由 `options.datasetCaps.saveText` 探测。
 */

const TEXT_NODE = "900_caption_text";
const FILENAME_NODE = "901_caption_filename";
const SAVE_NODE = "902_caption_save";

/** .txt 的内容：默认训练用 caption，可切成完整正向提示词 */
export function datasetCaptionText(config: DatasetConfig, item: DatasetItem): string {
  return config.caption.saveTxtMode === "prompt" ? item.prompt : item.caption;
}

/** 图片文件名去掉扩展名：`001_00001_.png` → `001_00001_` */
export function datasetCaptionStem(file: DatasetFile): string {
  return String(file.filename ?? "").replace(/\.[A-Za-z0-9]{1,8}$/, "");
}

export function buildDatasetCaptionPrompt(
  config: DatasetConfig,
  item: DatasetItem,
  file: DatasetFile,
): ComfyPrompt | null {
  if (config.caption.saveTxt === false) return null;
  const stem = datasetCaptionStem(file);
  if (!stem) return null;
  const text = datasetCaptionText(config, item);
  if (!text.trim()) return null;

  return {
    [TEXT_NODE]: {
      class_type: "> Text",
      inputs: { text },
      _meta: { title: "Caption" },
    },
    [FILENAME_NODE]: {
      class_type: "> Text",
      inputs: { text: stem },
      _meta: { title: "Caption File Name" },
    },
    [SAVE_NODE]: {
      class_type: "> Save Text",
      inputs: {
        text: [TEXT_NODE, 0],
        filename_opt: [FILENAME_NODE, 0],
        // filename_opt 存在时它只决定落盘目录，最终文件名仍是 <stem>.txt
        filename_prefix: "caption",
        folder: file.subfolder ?? "",
      },
      _meta: { title: "Save Caption" },
    },
  };
}
