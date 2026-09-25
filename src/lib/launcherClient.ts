import type { LauncherTool } from "../types";

/**
 * 外部工具启动器的客户端封装（/xyz/launcher*）。
 * 这些端点由本地服务端（vite 中间件 / Go exe）直接提供，**不经过 ComfyUI**，
 * 未连接服务（离线）时照常可用。
 */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, init);
  const data = (await resp.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!resp.ok || data.success === false) {
    throw new Error(data.error || `请求失败（${resp.status}）`);
  }
  return data as T;
}

export async function fetchLauncherTools(): Promise<LauncherTool[]> {
  const data = await request<{ tools: LauncherTool[] }>("/xyz/launcher");
  return data.tools ?? [];
}

export async function addLauncherTool(input: { name: string; path: string; args?: string; icon?: string }): Promise<LauncherTool> {
  const data = await request<{ tool: LauncherTool }>("/xyz/launcher", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return data.tool;
}

export async function updateLauncherTool(id: string, input: { name: string; path: string; args?: string; icon?: string }): Promise<void> {
  await request("/xyz/launcher", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...input }),
  });
}

export async function deleteLauncherTool(id: string): Promise<void> {
  await request(`/xyz/launcher?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function runLauncherTool(id: string): Promise<void> {
  await request("/xyz/launcher/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

/** 从 .exe 提取图标（服务端缓存于 data/icons/<md5>.png） */
export async function extractLauncherIcon(path: string): Promise<string> {
  const data = await request<{ icon: string }>("/xyz/launcher/icon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return data.icon;
}
