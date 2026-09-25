/**
 * 项目全局配置
 * 请根据实际环境修改这些配置，或通过环境变量进行注入
 */

export const CONFIG = {
  // 默认 API 地址
  DEFAULT_API_BASE: "/comfy",
  
  // 默认示例图目录（建议在 UI 设置中修改）
  DEFAULT_EXAMPLE_IMAGE_PATH: "F:\\AI_lora\\img",
  
  // 默认标签图片文件夹
  DEFAULT_TAG_IMAGE_FOLDER: "F:\\AI_lora\\lora-data-img\\tag-cs",
  
  // 默认标签输出文件夹
  DEFAULT_TAG_OUTPUT_FOLDER: "./ComfyUI-tag/cs",

  // 手机上传识别（局域网联动）配置
  MOBILE: {
    // /api/mobile 相关
    MAX_TASKS: 50, // 内存中最多保留的任务数（超出丢弃最早）
    MAX_IMAGE_BYTES: 20 * 1024 * 1024, // 单张图片上限
    MAX_QUEUE: 10, // 排队任务上限（超出 429）
    SSE_HEARTBEAT_MS: 20000, // SSE 心跳注释行间隔
    PAGE_HASH: "#/mobile-tag", // 手机端页面入口 hash
  },
};
