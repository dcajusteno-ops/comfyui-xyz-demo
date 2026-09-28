import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { parseMultipart } from "../src/lib/mobileSync";
import { sendError, sendJson } from "./utils";

/**
 * 主题壁纸存储（/xyz/theme/wallpaper）。Go 侧 internal/api/theme.go 逐条对齐，勿单边改动。
 *
 * 为什么单独开端点而不用 /api/upload/image（ComfyUI 的 input 目录）：
 * 1. 主题壁纸不该依赖 ComfyUI 在线，也不该混进用户的工作流输入目录；
 * 2. ui-state 有 2MB 请求体上限，塞不下图片（base64 更不行），所以前端只存引用。
 *
 * 契约：
 * - GET    /xyz/theme/wallpaper             → { success, files: string[] }（ref 列表，供 parity 对拍）
 * - POST   /xyz/theme/wallpaper             → multipart 字段 image → { success, ref }
 * - GET    /xyz/theme/wallpaper/<ref>       → 图片本体（支持 Range / HEAD）
 * - DELETE /xyz/theme/wallpaper/<ref>       → { success }（删除主题时调用）
 *
 * 文件名 = 内容 sha256 + 由 MIME 白名单推导的扩展名：
 * 天然去重、防路径穿越、不信任客户端文件名。ref 白名单正则同前端 WALLPAPER_REF_RE。
 */

export const THEME_MAX_WALLPAPER_BYTES = 20 * 1024 * 1024;
export const WALLPAPER_ROUTE_PREFIX = "/xyz/theme/wallpaper";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

export const WALLPAPER_REF_RE = /^[0-9a-f]{64}\.(png|jpg|jpeg|webp|gif|avif)$/;

/** E2E / verify 脚本的内存态（DSH_E2E=1），不落盘也用于服务，防测试污染真实目录 */
const memoryFiles = new Map<string, { mime: string; data: Buffer }>();
const inMemory = () => process.env.DSH_E2E === "1";

/** 仅供测试：清空内存态 */
export function __resetThemeMemoryForTest(): void {
  memoryFiles.clear();
}

function wallpaperDir(repoRoot: string): string {
  return path.join(repoRoot, "data", "theme", "wallpapers");
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        chunks.length = 0;
        reject(Object.assign(new Error(`壁纸过大，上限 ${Math.floor(maxBytes / 1024 / 1024)}MB`), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

/** 极简 Range 解析（对齐 exampleImages.ts 的行为：不合法/多段一律当整文件返回） */
function parseRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;
  let start: number;
  let end: number;
  if (rawStart === "") {
    const suffix = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(rawStart, 10);
    end = rawEnd === "" ? size - 1 : Number.parseInt(rawEnd, 10);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export function xyzThemePlugin(): Plugin {
  return {
    name: "xyz-theme-wallpaper",
    configureServer(server) {
      installThemeMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      installThemeMiddleware(server.middlewares);
    },
  };
}

function installThemeMiddleware(middlewares: {
  use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
}) {
  middlewares.use((req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith(WALLPAPER_ROUTE_PREFIX)) {
      next();
      return;
    }
    void handleThemeRequest(req, res, process.cwd()).catch((error) => {
      sendError(res, error);
    });
  });
}

export async function handleThemeRequest(req: IncomingMessage, res: ServerResponse, repoRoot: string) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const rest = requestUrl.pathname.slice(WALLPAPER_ROUTE_PREFIX.length);
  const method = (req.method ?? "GET").toUpperCase();

  // /xyz/theme/wallpaper
  if (rest === "" || rest === "/") {
    if (method === "GET") {
      sendJson(res, 200, { success: true, files: await listWallpapers(repoRoot) });
      return;
    }
    if (method === "POST") {
      await uploadWallpaper(req, res, repoRoot);
      return;
    }
    sendJson(res, 405, { success: false, error: "Method Not Allowed" });
    return;
  }

  // /xyz/theme/wallpaper/<ref>
  const ref = decodeURIComponent(rest.replace(/^\//, ""));
  if (!WALLPAPER_REF_RE.test(ref)) {
    sendJson(res, 400, { success: false, error: "invalid wallpaper ref" });
    return;
  }

  if (method === "GET" || method === "HEAD") {
    await serveWallpaper(req, res, repoRoot, ref);
    return;
  }
  if (method === "DELETE") {
    await removeWallpaper(repoRoot, ref);
    sendJson(res, 200, { success: true });
    return;
  }
  sendJson(res, 405, { success: false, error: "Method Not Allowed" });
}

async function listWallpapers(repoRoot: string): Promise<string[]> {
  if (inMemory()) return [...memoryFiles.keys()].sort();
  try {
    const entries = await readdir(wallpaperDir(repoRoot));
    return entries.filter((name) => WALLPAPER_REF_RE.test(name)).sort();
  } catch {
    return [];
  }
}

async function uploadWallpaper(req: IncomingMessage, res: ServerResponse, repoRoot: string) {
  const contentType = req.headers["content-type"] ?? "";
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) {
    sendJson(res, 400, { success: false, error: "请求必须为 multipart/form-data" });
    return;
  }

  const raw = await readBody(req, THEME_MAX_WALLPAPER_BYTES + 64 * 1024);
  const parts = parseMultipart(raw, boundaryMatch[1] ?? boundaryMatch[2]);
  const imagePart = parts.find((p) => (p.contentType ?? "").startsWith("image/")) ?? parts.find((p) => p.name === "image");
  if (!imagePart) {
    sendJson(res, 400, { success: false, error: "缺少图片字段（image）" });
    return;
  }
  if (imagePart.data.length === 0 || imagePart.data.length > THEME_MAX_WALLPAPER_BYTES) {
    sendJson(res, 413, {
      success: false,
      error: `图片大小需在 1B ~ ${Math.floor(THEME_MAX_WALLPAPER_BYTES / 1024 / 1024)}MB 之间`,
    });
    return;
  }

  // 扩展名只认 MIME 白名单，不信任客户端文件名
  const mime = (imagePart.contentType ?? "").split(";")[0].trim().toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext) {
    sendJson(res, 415, { success: false, error: `不支持的图片类型：${mime || "未知"}` });
    return;
  }

  const buffer = Buffer.from(imagePart.data);
  const ref = `${createHash("sha256").update(buffer).digest("hex")}.${ext}`;

  if (inMemory()) {
    memoryFiles.set(ref, { mime, data: buffer });
  } else {
    const dir = wallpaperDir(repoRoot);
    await mkdir(dir, { recursive: true });
    // 同一份内容重复上传 → 同一个 ref，直接复用（内容哈希命名天然幂等）
    await writeFile(path.join(dir, ref), buffer).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  }

  sendJson(res, 200, { success: true, ref });
}

async function serveWallpaper(req: IncomingMessage, res: ServerResponse, repoRoot: string, ref: string) {
  const ext = path.extname(ref).slice(1).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";

  if (inMemory()) {
    const hit = memoryFiles.get(ref);
    if (!hit) {
      sendJson(res, 404, { success: false, error: "wallpaper not found" });
      return;
    }
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", String(hit.data.length));
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.statusCode = 200;
    res.end((req.method ?? "GET").toUpperCase() === "HEAD" ? undefined : hit.data);
    return;
  }

  const filePath = path.join(wallpaperDir(repoRoot), ref);
  let info;
  try {
    info = await stat(filePath);
  } catch {
    sendJson(res, 404, { success: false, error: "wallpaper not found" });
    return;
  }

  res.setHeader("Content-Type", mime);
  res.setHeader("Accept-Ranges", "bytes");
  // 内容哈希命名 → 内容不可变，可以长缓存
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");

  const range = parseRange(req.headers.range, info.size);
  if (range) {
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
    if ((req.method ?? "GET").toUpperCase() === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Length", String(info.size));
  if ((req.method ?? "GET").toUpperCase() === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

async function removeWallpaper(repoRoot: string, ref: string) {
  if (inMemory()) {
    memoryFiles.delete(ref);
    return;
  }
  await unlink(path.join(wallpaperDir(repoRoot), ref)).catch(() => undefined);
}
