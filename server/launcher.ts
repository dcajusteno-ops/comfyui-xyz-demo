import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { atomicWriteJson, enqueueFileWrite, readJsonBody, readJsonFile, sendError, sendJson } from "./utils";

/**
 * 外部工具启动器（复刻自 comfyui-demo-main 的 app_feature_launcher.go，按本项目契约重写）。
 *
 * 用户把常用的本地程序/脚本（.exe/.bat/.cmd）或网页（.html/.url）登记成「工具」，
 * 一键从本应用拉起——不经过 ComfyUI，**与连接状态完全无关**，离线也能用。
 *
 * 契约（Go 侧 internal/launcher 逐条对齐，勿单边改动）：
 * - 存储走 data/launcher-tools.json（atomicWriteJson + enqueueFileWrite，与其它插件同款）；
 * - 启动语义：路径 trim 后必须存在（404 "tool file not found"）；参数按空白切分；
 *   .bat/.cmd/.html/.htm/.url → `cmd /c start "" <path> <args...>`，其余直接 spawn；
 *   工作目录 = 目标文件所在目录（很多便携工具依赖相对路径）；
 * - 图标提取：PowerShell ExtractAssociatedIcon → data/icons/<md5(path)>.png 缓存 → base64 data URL。
 */

const ROOT = path.resolve(process.cwd());
const TOOLS_FILE = path.join(ROOT, "data", "launcher-tools.json");
const ICONS_DIR = path.join(ROOT, "data", "icons");

export type LauncherTool = {
  id: string;
  name: string;
  path: string;
  args?: string;
  icon?: string;
};

/** 与原实现 strings.Fields 对齐：按任意空白切分并丢弃空段 */
export function splitLaunchArgs(argsString: string): string[] {
  return argsString.trim().split(/\s+/).filter(Boolean);
}

/** 启动命令构造（纯函数，测试固化 ext 分派语义） */
export function buildLaunchCommand(targetPath: string, argsString: string): { file: string; args: string[]; cwd: string } {
  const args = splitLaunchArgs(argsString);
  const ext = path.extname(targetPath).toLowerCase();
  if (ext === ".bat" || ext === ".cmd" || ext === ".html" || ext === ".htm" || ext === ".url") {
    return { file: "cmd.exe", args: ["/c", "start", "", targetPath, ...args], cwd: path.dirname(targetPath) };
  }
  return { file: targetPath, args, cwd: path.dirname(targetPath) };
}

export function xyzLauncherPlugin(): Plugin {
  return {
    name: "xyz-launcher",
    configureServer(server) {
      installLauncherMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      installLauncherMiddleware(server.middlewares);
    },
  };
}

function installLauncherMiddleware(middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }) {
  middlewares.use((req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith("/xyz/launcher")) {
      next();
      return;
    }
    void handleLauncherRequest(req, res, requestUrl).catch((error) => {
      sendError(res, error);
    });
  });
}

async function readTools(): Promise<LauncherTool[]> {
  const tools = await readJsonFile<LauncherTool[]>(TOOLS_FILE);
  return Array.isArray(tools) ? tools : [];
}

async function writeTools(tools: LauncherTool[]) {
  await mkdir(path.dirname(TOOLS_FILE), { recursive: true });
  await enqueueFileWrite(TOOLS_FILE, () => atomicWriteJson(TOOLS_FILE, tools));
}

function sanitizeToolInput(payload: Record<string, unknown>): { name: string; path: string; args: string; icon: string } | null {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const toolPath = typeof payload.path === "string" ? payload.path.trim() : "";
  if (!name || !toolPath) return null;
  const args = typeof payload.args === "string" ? payload.args.trim() : "";
  const icon = typeof payload.icon === "string" ? payload.icon : "";
  return { name, path: toolPath, args, icon };
}

async function handleLauncherRequest(req: IncomingMessage, res: ServerResponse, requestUrl: URL) {
  const method = (req.method ?? "GET").toUpperCase();
  const pathname = requestUrl.pathname;

  if (pathname === "/xyz/launcher/run" || pathname === "/xyz/launcher/run/") {
    if (method !== "POST") {
      sendJson(res, 405, { success: false, error: "Method Not Allowed" });
      return;
    }
    await handleRun(req, res);
    return;
  }

  if (pathname === "/xyz/launcher/icon" || pathname === "/xyz/launcher/icon/") {
    if (method !== "POST") {
      sendJson(res, 405, { success: false, error: "Method Not Allowed" });
      return;
    }
    await handleExtractIcon(req, res);
    return;
  }

  if (method === "GET") {
    sendJson(res, 200, { success: true, tools: await readTools() });
    return;
  }

  if (method === "POST") {
    const payload = await readJsonBody(req);
    const input = sanitizeToolInput(payload);
    if (!input) {
      sendJson(res, 400, { success: false, error: "缺少 name 或 path 字段" });
      return;
    }
    const tool: LauncherTool = { id: randomUUID(), ...input };
    await writeTools([...(await readTools()), tool]);
    sendJson(res, 200, { success: true, tool });
    return;
  }

  if (method === "PUT") {
    const payload = await readJsonBody(req);
    const id = typeof payload.id === "string" ? payload.id : "";
    const input = sanitizeToolInput(payload);
    if (!id || !input) {
      sendJson(res, 400, { success: false, error: "缺少 id 或 name/path 字段" });
      return;
    }
    const tools = await readTools();
    const index = tools.findIndex((t) => t.id === id);
    if (index === -1) {
      sendJson(res, 404, { success: false, error: "tool not found" });
      return;
    }
    tools[index] = { id, ...input };
    await writeTools(tools);
    sendJson(res, 200, { success: true });
    return;
  }

  if (method === "DELETE") {
    const queryId = requestUrl.searchParams.get("id");
    const body = await readJsonBody(req).catch((): Record<string, unknown> => ({}));
    const id = (queryId ?? "") || (typeof body.id === "string" ? body.id : "");
    if (!id) {
      sendJson(res, 400, { success: false, error: "缺少 id 参数" });
      return;
    }
    const tools = await readTools();
    const next = tools.filter((t) => t.id !== id);
    if (next.length === tools.length) {
      sendJson(res, 404, { success: false, error: "tool not found" });
      return;
    }
    await writeTools(next);
    sendJson(res, 200, { success: true });
    return;
  }

  sendJson(res, 404, { success: false, error: "Unknown launcher endpoint" });
}

async function handleRun(req: IncomingMessage, res: ServerResponse) {
  const payload = await readJsonBody(req);
  const id = typeof payload.id === "string" ? payload.id : "";
  const tools = await readTools();
  const tool = tools.find((t) => t.id === id);
  if (!tool) {
    sendJson(res, 404, { success: false, error: "tool not found" });
    return;
  }
  const targetPath = tool.path.trim();
  if (!targetPath) {
    sendJson(res, 400, { success: false, error: "tool path is empty" });
    return;
  }
  try {
    await stat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      sendJson(res, 404, { success: false, error: "tool file not found" });
      return;
    }
    sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    return;
  }

  const command = buildLaunchCommand(targetPath, tool.args ?? "");
  try {
    // detached + unref：工具进程独立于本应用存活（关掉应用不带走它）
    const child = spawn(command.file, command.args, {
      cwd: command.cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => undefined);
    child.unref();
  } catch (error) {
    sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    return;
  }
  sendJson(res, 200, { success: true });
}

async function handleExtractIcon(req: IncomingMessage, res: ServerResponse) {
  const payload = await readJsonBody(req);
  const targetPath = typeof payload.path === "string" ? payload.path.trim() : "";
  if (!targetPath || !targetPath.toLowerCase().endsWith(".exe")) {
    sendJson(res, 400, { success: false, error: "仅支持从 .exe 提取图标" });
    return;
  }
  const icon = await extractExeIcon(targetPath).catch((error) => {
    sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    return null;
  });
  if (icon === null) return;
  sendJson(res, 200, { success: true, icon });
}

async function extractExeIcon(targetPath: string): Promise<string> {
  await mkdir(ICONS_DIR, { recursive: true });
  const hash = createHash("md5").update(targetPath).digest("hex");
  const iconPath = path.join(ICONS_DIR, `${hash}.png`);

  if (!existsSync(iconPath)) {
    // PowerShell 单引号串的转义是成对单引号
    const psPath = targetPath.replace(/'/g, "''");
    const psIconPath = iconPath.replace(/'/g, "''");
    const script =
      `Add-Type -AssemblyName System.Drawing;` +
      `$icon = [System.Drawing.Icon]::ExtractAssociatedIcon('${psPath}');` +
      `if ($icon) { $b = $icon.ToBitmap(); $b.Save('${psIconPath}', [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose(); $icon.Dispose() }`;
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)("powershell", ["-NoProfile", "-Command", script], { timeout: 15000, windowsHide: true });
  }

  const bytes = await readFile(iconPath);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}
