import type { ComfyPrompt, Wd14Params } from "../types";

/**
 * WD14 识别工作流的单一事实源（纯 JSON 构造，无副作用）。
 * 前端 workflowBuilders.buildWd14Prompt 与后端 server/mobileSync.ts 共用，避免双份配置漂移。
 */
export function buildWd14Workflow(params: Wd14Params): ComfyPrompt {
  const inputs: Record<string, unknown> = {
    image: ["1", 0],
    model: params.model,
    threshold: params.threshold,
    character_threshold: params.characterThreshold,
    replace_underscore: params.replaceUnderscore,
    trailing_comma: params.trailingComma,
    exclude_tags: params.excludeTags,
  };

  if (params.device) {
    inputs.device = params.device;
  }

  return {
    "1": {
      class_type: "LoadImage",
      inputs: {
        image: params.imageName,
      },
      _meta: { title: "Load Image" },
    },
    "2": {
      class_type: "WD14Tagger|pysssss",
      inputs: inputs,
      _meta: { title: "WD14 Tagger" },
    },
    "3": {
      class_type: "PreviewImage",
      inputs: {
        images: ["1", 0],
      },
      _meta: { title: "Preview Image" },
    },
    // Force execution and return text via Save Text node
    "4": {
      class_type: "> Save Text",
      inputs: {
        text: ["2", 0],
        filename_opt: "tag_temp",
        filename_prefix: "",
        folder: "tagging",
      },
      _meta: { title: "Save Tags" },
    },
  };
}