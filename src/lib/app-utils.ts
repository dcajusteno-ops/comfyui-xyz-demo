import { tabs } from "../constants";
import type { LoraOperation, XyzRunItem, TabId } from "../types";

export function initialTabFromUrl(): TabId {
  if (typeof window === "undefined") return "default";
  const tabParam = new URLSearchParams(window.location.search).get("tab");
  const match = tabs.find((item) => item.id === tabParam);
  return match?.id ?? "default";
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