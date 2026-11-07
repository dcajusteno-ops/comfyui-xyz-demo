/**
 * 图片管理器（TS 版，SSOT）。
 *
 * 服务于「数据集工作台」的图片清理：设置默认根目录（初值自动探测 ComfyUI 输出目录）
 * → 浏览子文件夹 → 网格预览 → 多选删除（Windows 回收站 / dev 移入 data/.trash-images）。
 *
 * 边界：
 * - `browse` 只读、可浏览全盘（根目录对话框需要选新根）；
 * - `file` / `delete` 只允许「默认根目录」内的图片文件；
 * - `config` / `delete` 是写操作，只允许本机（回环地址）调用——本服务监听 0.0.0.0，
 *   不设这一层等于把「局域网任意人删本机图片」暴露出去。
 *
 * Go 侧移植见 `internal/api/imagemgr.go`；响应键集/状态码/文案逐字段对齐。
 */
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { atomicWriteJson, enqueueFileWrite, readJsonBody, readJsonFile, sendJson } from "./utils";

export const IMAGE_ROUTE_PREFIX = "/xyz/images";
export const IMAGE_MAX_FILE_BYTES = 30 * 1024 * 1024;
/** 单目录扫描上限：超过就不再继续收集（防十万文件目录把内存吃满） */
export const IMAGE_SCAN_LIMIT = 5000;
/** 单次响应返回的图片数上限 */
export const IMAGE_RETURN_LIMIT = 2000;
/** 单次删除请求的路径数上限 */
export const IMAGE_DELETE_LIMIT = 500;
const DETECT_TIMEOUT_MS = 3000;
const DETECT_CACHE_MS = 60_000;

export const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
};

export function imageExtOf(name: string): string {
  return path.extname(String(name ?? "")).toLowerCase();
}

export function isImageName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(IMAGE_MIME_BY_EXT, imageExtOf(name));
}

export function mimeOf(name: string): string {
  return IMAGE_MIME_BY_EXT[imageExtOf(name)] ?? "application/octet-stream";
}

export type OutputDirSource = "env" | "argv-output" | "argv-base" | "argv-main" | "none";

export type OutputDirResult = {
  outputDir: string;
  outputDirSource: OutputDirSource;
};

/** `--flag value` 与 `--flag=value` 两种写法都认；value 是另一个 flag 时视为缺值 */
export function argValue(args: string[], flag: string): string {
  for (let i = 0; i < args.length; i += 1) {
    const item = args[i];
    if (item === flag) {
      const next = args[i + 1] ?? "";
      return next.startsWith("-") ? "" : next;
    }
    if (item.startsWith(`${flag}=`)) return item.slice(flag.length + 1);
  }
  return "";
}

function resolveAgainst(baseDir: string, value: string): string {
  if (!value) return "";
  if (path.isAbsolute(value)) return path.resolve(value);
  // 相对路径只有知道 ComfyUI 的启动目录（main.py 所在处）时才能安全解析；
  // 否则会解析到本仓库，属于错误猜测。
  return baseDir ? path.resolve(baseDir, value) : "";
}

/**
 * 从 ComfyUI 的 `system.argv` 推导输出目录。
 * 只认「绝对且可信」的来源，宁可返回 none 也不瞎猜——猜错会把模型目录当图片根。
 */
export function detectOutputDir(argv: string[] | null, envValue?: string | null): OutputDirResult {
  const env = String(envValue ?? "").trim();
  if (env) {
    return { outputDir: path.resolve(env), outputDirSource: "env" };
  }

  const args = (argv ?? []).filter((item): item is string => typeof item === "string");
  const mainArg = args.find((item) => /(^|[\\/])main\.py$/i.test(item)) ?? "";
  const baseDir = mainArg && path.isAbsolute(mainArg) ? path.dirname(mainArg) : "";

  const outputArg = resolveAgainst(baseDir, argValue(args, "--output-directory"));
  if (outputArg) return { outputDir: outputArg, outputDirSource: "argv-output" };

  const baseArg = resolveAgainst(baseDir, argValue(args, "--base-directory"));
  if (baseArg) return { outputDir: path.resolve(path.join(baseArg, "output")), outputDirSource: "argv-base" };

  if (baseDir) return { outputDir: path.resolve(path.join(baseDir, "output")), outputDirSource: "argv-main" };

  return { outputDir: "", outputDirSource: "none" };
}

/** ComfyUI 在别的机器上时，argv 里的路径对本机没有意义 */
export function isLocalComfyTarget(target: string): boolean {
  try {
    const host = new URL(target).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

export type ImageEntry = { name: string; size: number; mtime: number };
export type DirListing = { folders: string[]; images: ImageEntry[]; total: number; truncated: boolean };

export async function listDir(dir: string): Promise<DirListing> {
  const entries = await readdir(dir, { withFileTypes: true });
  const folders: string[] = [];
  const names: string[] = [];
  let truncated = false;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      folders.push(entry.name);
      continue;
    }
    if (!entry.isFile() || !isImageName(entry.name)) continue;
    if (names.length >= IMAGE_SCAN_LIMIT) {
      truncated = true;
      break;
    }
    names.push(entry.name);
  }

  // 服务端只保证稳定顺序；自然序（001/002…）由前端排，避免两端 collation 不一致
  folders.sort(compareText);
  names.sort(compareText);
  if (names.length > IMAGE_RETURN_LIMIT) truncated = true;

  const picked = names.slice(0, IMAGE_RETURN_LIMIT);
  const images = await Promise.all(
    picked.map(async (name) => {
      const info = await stat(path.join(dir, name)).catch(() => null);
      return info ? { name, size: info.size, mtime: Math.trunc(info.mtimeMs) } : null;
    }),
  );

  return {
    folders,
    images: images.filter((item): item is ImageEntry => item !== null),
    total: names.length,
    truncated,
  };
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** 目录不存在时向上找最近一个存在的祖先（最多 8 级），供前端回落 */
export async function nearestExistingDir(dir: string, maxUp = 8): Promise<string> {
  let current = path.resolve(dir);
  for (let i = 0; i <= maxUp; i += 1) {
    const ok = await stat(current).then((info) => info.isDirectory()).catch(() => false);
    if (ok) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** 必须按分隔符边界判断，否则 `output2` 会被误判为在 `output` 内 */
export function isInsideRoot(root: string, target: string): boolean {
  if (!root || !target) return false;
  const base = comparablePath(root);
  const child = comparablePath(target);
  if (child === base) return true;
  const sep = process.platform === "win32" ? "\\" : "/";
  return child.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}

export type FailedFile = { path: string; error: string };
export type DeletePlan = { accepted: string[]; failed: FailedFile[] };

/**
 * 删除前的逐条校验：绝对路径、在根目录内、图片扩展名、存活的常规文件（非符号链接）、去重、条数上限。
 * 目录一律拒绝——Windows 的 SHFileOperation 会递归删整棵树。
 */
export async function planDelete(rawPaths: unknown, root: string): Promise<DeletePlan> {
  const failed: FailedFile[] = [];
  const accepted: string[] = [];
  const seen = new Set<string>();

  if (!Array.isArray(rawPaths)) {
    return { accepted, failed: [{ path: "", error: "paths 必须是数组" }] };
  }
  if (!root) {
    return { accepted, failed: [{ path: "", error: "未设置根目录" }] };
  }

  for (const item of rawPaths.slice(0, IMAGE_DELETE_LIMIT)) {
    if (typeof item !== "string" || !item.trim()) {
      failed.push({ path: String(item ?? ""), error: "路径无效" });
      continue;
    }
    const target = item.trim();
    if (!path.isAbsolute(target)) {
      failed.push({ path: target, error: "必须是绝对路径" });
      continue;
    }
    if (!isImageName(target)) {
      failed.push({ path: target, error: "不是支持的图片格式" });
      continue;
    }
    if (!isInsideRoot(root, target)) {
      failed.push({ path: target, error: "不在默认根目录内" });
      continue;
    }
    const key = process.platform === "win32" ? target.toLowerCase() : target;
    if (seen.has(key)) {
      failed.push({ path: target, error: "重复路径" });
      continue;
    }
    seen.add(key);

    const info = await lstat(target).catch(() => null);
    if (!info) {
      failed.push({ path: target, error: "文件不存在" });
      continue;
    }
    if (!info.isFile()) {
      failed.push({ path: target, error: "只允许删除常规文件" });
      continue;
    }
    accepted.push(target);
  }

  if (rawPaths.length > IMAGE_DELETE_LIMIT) {
    failed.push({ path: "", error: `单次最多删除 ${IMAGE_DELETE_LIMIT} 张` });
  }
  return { accepted, failed };
}

export function etagOf(size: number, mtimeMs: number): string {
  return `"${size}-${Math.trunc(mtimeMs)}"`;
}

export type ImageSettings = { rootDir: string; trashEnabled: boolean };

export function imageSettingsPath(repoRoot: string): string {
  return path.join(repoRoot, "data", "image-settings.json");
}

export async function readImageSettings(repoRoot: string): Promise<ImageSettings> {
  const data = await readJsonFile<Partial<ImageSettings>>(imageSettingsPath(repoRoot));
  return {
    rootDir: typeof data?.rootDir === "string" ? data.rootDir : "",
    // 缺省 true：老存档没有这个字段时仍然走回收站（更安全）
    trashEnabled: typeof data?.trashEnabled === "boolean" ? data.trashEnabled : true,
  };
}

/** 局部更新：只写传来的字段，其余保留（rootDir / trashEnabled 互不覆盖） */
export async function writeImageSettings(repoRoot: string, patch: Partial<ImageSettings>): Promise<void> {
  const file = imageSettingsPath(repoRoot);
  await mkdir(path.dirname(file), { recursive: true });
  await enqueueFileWrite(file, async () => {
    const current = await readImageSettings(repoRoot);
    await atomicWriteJson(file, { ...current, ...patch });
  });
}

async function isDirectory(target: string): Promise<boolean> {
  if (!target) return false;
  return stat(target).then((info) => info.isDirectory()).catch(() => false);
}

export async function listDrives(): Promise<string[]> {
  if (process.platform !== "win32") return ["/"];
  const found: string[] = [];
  for (let i = 0; i < 26; i += 1) {
    const root = `${String.fromCharCode(65 + i)}:\\`;
    if (await isDirectory(root)) found.push(root);
  }
  return found;
}

function isLoopbackRequest(req: IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // 同源导航/直接调用不带 Origin
  try {
    const originHost = new URL(origin).hostname.toLowerCase();
    const host = String(req.headers.host ?? "").split(":")[0].toLowerCase();
    return originHost === host;
  } catch {
    return false;
  }
}

type DetectedOutput = { outputDir: string; outputDirSource: OutputDirSource };
let detectCache: { at: number; target: string; value: DetectedOutput } | null = null;

async function fetchComfyArgv(comfyTarget: string): Promise<string[] | null> {
  if (!isLocalComfyTarget(comfyTarget)) return null;
  const base = comfyTarget.replace(/\/+$/, "");
  try {
    const response = await fetch(`${base}/api/system_stats`, { signal: AbortSignal.timeout(DETECT_TIMEOUT_MS) });
    if (!response.ok) return null;
    const data = (await response.json()) as { system?: { argv?: unknown } };
    const argv = data?.system?.argv;
    return Array.isArray(argv) ? argv.filter((item): item is string => typeof item === "string") : null;
  } catch {
    return null;
  }
}

async function detectComfyOutputDir(comfyTarget: string): Promise<DetectedOutput> {
  if (detectCache && detectCache.target === comfyTarget && Date.now() - detectCache.at < DETECT_CACHE_MS) {
    return detectCache.value;
  }
  const argv = await fetchComfyArgv(comfyTarget);
  const value: DetectedOutput =
    argv === null
      ? { outputDir: "", outputDirSource: "none" }
      : detectOutputDir(argv, process.env.COMFYUI_OUTPUT_DIR ?? "");
  detectCache = { at: Date.now(), target: comfyTarget, value };
  return value;
}

type ImageConfig = {
  rootDir: string;
  rootSource: "saved" | "detected" | "none";
  savedRootDir: string;
  outputDir: string;
  outputDirSource: OutputDirSource;
  outputDirExists: boolean;
  rootExists: boolean;
  trashEnabled: boolean;
};

async function resolveConfig(repoRoot: string, comfyTarget: string): Promise<ImageConfig> {
  const settings = await readImageSettings(repoRoot);
  const detected = await detectComfyOutputDir(comfyTarget);
  const outputDirExists = await isDirectory(detected.outputDir);
  const trashEnabled = settings.trashEnabled;

  const savedValid = await isDirectory(settings.rootDir);
  if (savedValid) {
    return {
      rootDir: settings.rootDir,
      rootSource: "saved",
      savedRootDir: settings.rootDir,
      outputDir: detected.outputDir,
      outputDirSource: detected.outputDirSource,
      outputDirExists,
      rootExists: true,
      trashEnabled,
    };
  }
  if (outputDirExists) {
    return {
      rootDir: detected.outputDir,
      rootSource: "detected",
      savedRootDir: settings.rootDir,
      outputDir: detected.outputDir,
      outputDirSource: detected.outputDirSource,
      outputDirExists,
      rootExists: true,
      trashEnabled,
    };
  }
  return {
    rootDir: "",
    rootSource: "none",
    savedRootDir: settings.rootDir,
    outputDir: detected.outputDir,
    outputDirSource: detected.outputDirSource,
    outputDirExists,
    rootExists: false,
    trashEnabled,
  };
}

function configPayload(config: ImageConfig, drives: string[]) {
  return {
    success: true,
    rootDir: config.rootDir,
    rootSource: config.rootSource,
    savedRootDir: config.savedRootDir,
    outputDir: config.outputDir,
    outputDirSource: config.outputDirSource,
    outputDirExists: config.outputDirExists,
    rootExists: config.rootExists,
    trashEnabled: config.trashEnabled,
    drives,
  };
}

export function xyzImageManagerPlugin(comfyTarget: string, repoRoot = process.cwd()): Plugin {
  return {
    name: "xyz-image-manager",
    configureServer(server) {
      installImageManagerMiddleware(server.middlewares, comfyTarget, repoRoot);
    },
    configurePreviewServer(server) {
      installImageManagerMiddleware(server.middlewares, comfyTarget, repoRoot);
    },
  };
}

type Middlewares = {
  use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
};

function installImageManagerMiddleware(middlewares: Middlewares, comfyTarget: string, repoRoot: string) {
  middlewares.use((req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    const { pathname } = requestUrl;
    if (pathname !== IMAGE_ROUTE_PREFIX && !pathname.startsWith(`${IMAGE_ROUTE_PREFIX}/`)) {
      next();
      return;
    }
    void handleImageManagerRequest(req, res, requestUrl, comfyTarget, repoRoot).catch((error) => {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    });
  });
}

async function handleImageManagerRequest(
  req: IncomingMessage,
  res: ServerResponse,
  requestUrl: URL,
  comfyTarget: string,
  repoRoot: string,
) {
  const method = (req.method ?? "GET").toUpperCase();
  const route = requestUrl.pathname.replace(/\/+$/, "");

  // 外置服务的地址：dev 下就是 vite 自己的 standalone.html（同源，API 仍在 9999）
  if (route === `${IMAGE_ROUTE_PREFIX}/service`) {
    if (method !== "GET") {
      sendJson(res, 405, { success: false, error: "Method Not Allowed" });
      return;
    }
    const host = req.headers.host ?? "127.0.0.1:9999";
    sendJson(res, 200, { success: true, url: `http://${host}/standalone.html` });
    return;
  }

  if (route === `${IMAGE_ROUTE_PREFIX}/config`) {
    if (method === "GET") {
      const config = await resolveConfig(repoRoot, comfyTarget);
      sendJson(res, 200, configPayload(config, await listDrives()));
      return;
    }
    if (method === "POST") {
      await handleConfigSave(req, res, repoRoot, comfyTarget);
      return;
    }
    sendJson(res, 405, { success: false, error: "Method Not Allowed" });
    return;
  }

  if (route === `${IMAGE_ROUTE_PREFIX}/browse`) {
    if (method !== "GET") {
      sendJson(res, 405, { success: false, error: "Method Not Allowed" });
      return;
    }
    await handleBrowse(res, requestUrl, repoRoot, comfyTarget);
    return;
  }

  if (route === `${IMAGE_ROUTE_PREFIX}/file`) {
    if (method !== "GET" && method !== "HEAD") {
      sendJson(res, 405, { success: false, error: "Method Not Allowed" });
      return;
    }
    await handleFile(req, res, requestUrl, repoRoot, comfyTarget, method === "HEAD");
    return;
  }

  if (route === `${IMAGE_ROUTE_PREFIX}/delete`) {
    if (method !== "POST") {
      sendJson(res, 405, { success: false, error: "Method Not Allowed" });
      return;
    }
    await handleDelete(req, res, repoRoot, comfyTarget);
    return;
  }

  sendJson(res, 404, { success: false, error: "Not Found" });
}

async function handleConfigSave(
  req: IncomingMessage,
  res: ServerResponse,
  repoRoot: string,
  comfyTarget: string,
) {
  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, { success: false, error: "仅允许本机操作" });
    return;
  }
  const body = await readJsonBody(req).catch(() => null);
  if (!body) {
    sendJson(res, 400, { success: false, error: "请求体必须是 JSON" });
    return;
  }

  const patch: Partial<ImageSettings> = {};
  if (typeof body.rootDir === "string") {
    const next = body.rootDir.trim();
    if (next) {
      if (!path.isAbsolute(next)) {
        sendJson(res, 400, { success: false, error: "rootDir 必须是绝对路径" });
        return;
      }
      if (!(await isDirectory(next))) {
        sendJson(res, 400, { success: false, error: "目录不存在" });
        return;
      }
    }
    patch.rootDir = next;
  }
  if (typeof body.trashEnabled === "boolean") {
    patch.trashEnabled = body.trashEnabled;
  }
  if (Object.keys(patch).length === 0) {
    sendJson(res, 400, { success: false, error: "rootDir 或 trashEnabled 至少提供一个" });
    return;
  }

  await writeImageSettings(repoRoot, patch);
  const config = await resolveConfig(repoRoot, comfyTarget);
  sendJson(res, 200, configPayload(config, await listDrives()));
}

async function handleBrowse(
  res: ServerResponse,
  requestUrl: URL,
  repoRoot: string,
  comfyTarget: string,
) {
  const raw = (requestUrl.searchParams.get("dir") ?? "").trim();
  const config = await resolveConfig(repoRoot, comfyTarget);

  let target: string;
  if (raw) {
    if (!path.isAbsolute(raw)) {
      sendJson(res, 200, {
        success: false,
        dir: raw,
        parent: null,
        folders: [],
        images: [],
        total: 0,
        truncated: false,
        error: "dir 必须是绝对路径",
        nearest: config.rootDir,
      });
      return;
    }
    target = path.resolve(raw);
  } else {
    target = config.rootDir;
  }

  if (!target) {
    sendJson(res, 200, {
      success: false,
      dir: "",
      parent: null,
      folders: [],
      images: [],
      total: 0,
      truncated: false,
      error: "未设置根目录",
      nearest: "",
    });
    return;
  }

  try {
    const listing = await listDir(target);
    const parent = path.dirname(target) === target ? null : path.dirname(target);
    sendJson(res, 200, {
      success: true,
      dir: target,
      parent,
      folders: listing.folders,
      images: listing.images,
      total: listing.total,
      truncated: listing.truncated,
      error: "",
      nearest: "",
    });
  } catch (error) {
    sendJson(res, 200, {
      success: false,
      dir: target,
      parent: null,
      folders: [],
      images: [],
      total: 0,
      truncated: false,
      error: error instanceof Error ? error.message : String(error),
      nearest: await nearestExistingDir(target),
    });
  }
}

async function handleFile(
  req: IncomingMessage,
  res: ServerResponse,
  requestUrl: URL,
  repoRoot: string,
  comfyTarget: string,
  headOnly: boolean,
) {
  const raw = (requestUrl.searchParams.get("path") ?? "").trim();
  if (!raw || !path.isAbsolute(raw)) {
    sendJson(res, 400, { success: false, error: "path 必须是绝对路径" });
    return;
  }
  if (!isImageName(raw)) {
    sendJson(res, 400, { success: false, error: "不是支持的图片格式" });
    return;
  }
  const config = await resolveConfig(repoRoot, comfyTarget);
  if (!config.rootDir) {
    sendJson(res, 403, { success: false, error: "未设置根目录" });
    return;
  }
  if (!isInsideRoot(config.rootDir, raw)) {
    sendJson(res, 403, { success: false, error: "path 不在默认根目录内" });
    return;
  }

  const info = await lstat(raw).catch(() => null);
  if (!info || !info.isFile()) {
    sendJson(res, 404, { success: false, error: "文件不存在" });
    return;
  }
  if (info.size > IMAGE_MAX_FILE_BYTES) {
    sendJson(res, 413, { success: false, error: "图片超过 30MB" });
    return;
  }

  const etag = etagOf(info.size, info.mtimeMs);
  if (String(req.headers["if-none-match"] ?? "") === etag) {
    res.statusCode = 304;
    res.end();
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", mimeOf(raw));
  res.setHeader("Content-Length", String(info.size));
  res.setHeader("ETag", etag);
  res.setHeader("Last-Modified", info.mtime.toUTCString());
  res.setHeader("Cache-Control", "private, max-age=60");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (headOnly) {
    res.end();
    return;
  }

  const stream = createReadStream(raw);
  stream.on("error", () => {
    if (!res.headersSent) sendJson(res, 500, { success: false, error: "读取图片失败" });
    else res.destroy();
  });
  stream.pipe(res);
}

async function handleDelete(
  req: IncomingMessage,
  res: ServerResponse,
  repoRoot: string,
  comfyTarget: string,
) {
  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, { success: false, error: "仅允许本机操作" });
    return;
  }
  if (!sameOrigin(req)) {
    sendJson(res, 403, { success: false, error: "跨源请求被拒绝" });
    return;
  }
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    sendJson(res, 415, { success: false, error: "需要 application/json" });
    return;
  }

  const body = await readJsonBody(req).catch(() => null);
  if (!body || !Array.isArray(body.paths)) {
    sendJson(res, 400, { success: false, error: "paths 必须是数组" });
    return;
  }

  const config = await resolveConfig(repoRoot, comfyTarget);
  if (!config.rootDir) {
    sendJson(res, 400, { success: false, error: "未设置根目录" });
    return;
  }

  const plan = await planDelete(body.paths, config.rootDir);
  // 回收站开关：开（默认）→ 移入回收站；关 → 直接永久删除
  const result = config.trashEnabled ? await trashFiles(plan.accepted, repoRoot) : await removeFiles(plan.accepted);
  const failed = [...plan.failed, ...result.failed];

  sendJson(res, 200, {
    success: true,
    deleted: result.deleted,
    failed,
    mode: config.trashEnabled ? "trash" : "delete",
  });
}

/** 永久删除（用户在界面里关掉「移到回收站」时才会走） */
async function removeFiles(paths: string[]): Promise<{ deleted: string[]; failed: FailedFile[] }> {
  const deleted: string[] = [];
  const failed: FailedFile[] = [];
  for (const target of paths) {
    try {
      await unlink(target);
      deleted.push(target);
    } catch (error) {
      failed.push({ path: target, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { deleted, failed };
}

/**
 * dev 环境的「回收站」：移到 data/.trash-images/<时间戳>/ 下。
 * 不用永久删除——与 exe 的回收站语义保持一致（mode 恒为 trash），误删也能手工捞回来。
 * 用户显式关掉「移到回收站」时走 removeFiles()。
 */
async function trashFiles(
  paths: string[],
  repoRoot: string,
): Promise<{ deleted: string[]; failed: FailedFile[] }> {
  const deleted: string[] = [];
  const failed: FailedFile[] = [];
  if (paths.length === 0) return { deleted, failed };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(repoRoot, "data", ".trash-images", stamp);
  await mkdir(dir, { recursive: true }).catch(() => undefined);

  for (const [index, source] of paths.entries()) {
    const target = path.join(dir, `${index}_${path.basename(source)}`);
    try {
      await rename(source, target);
      deleted.push(source);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
        failed.push({ path: source, error: error instanceof Error ? error.message : String(error) });
        continue;
      }
    }
    // 跨盘（output 在别的盘、data 在仓库盘）：复制后删源
    try {
      await copyFile(source, target);
      await unlink(source);
      deleted.push(source);
    } catch (error) {
      failed.push({ path: source, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { deleted, failed };
}
