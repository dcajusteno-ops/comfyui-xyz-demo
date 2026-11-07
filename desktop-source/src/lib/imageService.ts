/**
 * 外置图片管理服务的前端入口。
 *
 * 图片管理器是**独立端口的网页**（例如 http://127.0.0.1:9124/），
 * 主应用里只有数据集工作台那个按钮；这里负责问服务端要地址并在系统浏览器打开。
 */
export type ImageServiceInfo = { success: boolean; url?: string; error?: string };

type WindowWithOpener = Window & { openExternal?: (target: string) => unknown };

/** 桌面窗口里走 Go 绑定的 ShellExecute（真正的外部浏览器）；dev / web 模式退回 window.open */
export function openExternalUrl(url: string): void {
  const opener = (window as WindowWithOpener).openExternal;
  if (typeof opener === "function") {
    void opener(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

export async function openImageManagerService(relativeDir?: string): Promise<string> {
  const response = await fetch("/xyz/images/service");
  const data = (await response.json()) as ImageServiceInfo;
  if (!response.ok || !data.success || !data.url) {
    throw new Error(data.error || "图片管理服务未启动");
  }
  const dir = String(relativeDir ?? "").trim();
  const url = dir ? `${data.url}${data.url.includes("?") ? "&" : "?"}dir=${encodeURIComponent(dir)}` : data.url;
  openExternalUrl(url);
  return url;
}
