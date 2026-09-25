import { tabs } from "../constants";
import type { ComfyPrompt, JobMeta, LoraOperation, XyzRunItem, TabId } from "../types";

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

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/**
 * 从**已构造好的工作流**里读出展示用的关键参数（尺寸 / 步数 / seed）。
 *
 * 为什么从 prompt 里读而不是从面板参数读：`runPrompt` 是所有模板（含 XYZ 打补丁后的
 * 组合、Anima 的多段链路）的唯一汇合点，从这里读才能保证标题与**实际提交的图**一致。
 * 找不到对应节点时返回 undefined，由调用方决定怎么降级展示。
 */
export function describePrompt(prompt: ComfyPrompt, label: string): JobMeta {
  const nodes = Object.values(prompt ?? {});
  const meta: JobMeta = { label };

  // 尺寸：基础 latent（图生图模式下会由 ImageScale 对齐，但尺寸仍写在 EmptyLatentImage 上）
  const latent = nodes.find((node) => node.class_type === "EmptyLatentImage");
  if (latent) {
    meta.width = asFiniteNumber(latent.inputs?.width);
    meta.height = asFiniteNumber(latent.inputs?.height);
  }

  // 采样：Anima 等多段链路会叠多个 KSampler，取**第一个**（即基础采样，决定全局观感）
  const sampler = nodes.find((node) => node.class_type === "KSampler");
  if (sampler) {
    meta.steps = asFiniteNumber(sampler.inputs?.steps);
    meta.seed = asFiniteNumber(sampler.inputs?.seed);
  }

  return meta;
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