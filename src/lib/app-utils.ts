import { tabs } from "../constants";
import type { LoraOperation, XyzRunItem, TabId } from "../types";

export function initialTabFromUrl(): TabId {
  if (typeof window === "undefined") return "default";
  const tabParam = new URLSearchParams(window.location.search).get("tab");
  const match = tabs.find((item) => item.id === tabParam);
  return match?.id ?? "default";
}

/**
 * 校验一个值是否是当前注册过的标签页 id。
 * localStorage 里的 `comfyui_active_tab` 不做校验的话，遇到历史遗留/被删掉的 tab 值
 * 会导致所有 `{tab === "xxx" && …}` 分支都不成立 → 主区域空白。
 */
export function isValidTabId(value: unknown): value is TabId {
  return typeof value === "string" && tabs.some((item) => item.id === value);
}

export function operationTitle(operation: LoraOperation) {
  const titles: Record<LoraOperation["type"], string> = {
    rename: "重命名 LoRA",
    move: "移动 LoRA",
    delete: "删除 LoRA",
    download: "下载 LoRA",
    duplicates: "重复项管理",
    updates: "更新检查",
    doctor: "医生检查",
    settings: "全局设置",
    notifications: "通知队列",
    civitai: "Civitai 详情",
    translator: "翻译工具",
  };
  return titles[operation.type];
}

export function xyzStatusLabel(status: XyzRunItem["status"]) {
  const labels: Record<XyzRunItem["status"], string> = {
    queued: "等待",
    running: "运行中",
    success: "完成",
    failed: "失败",
    cancelled: "已中断",
  };
  return labels[status];
}