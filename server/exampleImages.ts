import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

type ManagedModelType = "loras" | "embeddings";

type LoraItem = Record<string, unknown> & {
  model_type?: ManagedModelType;
  sha256?: string;
  file_path?: string;
  file_name?: string;
  model_name?: string;
  civitai?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type ExampleProgress = {
  total: number;
  completed: number;
  current_model: string;
  status: "idle" | "running" | "paused" | "stopping" | "stopped" | "completed" | "error";
  errors: string[];
  last_error: string | null;
  start_time: number | null;
  end_time: number | null;
  processed_models: string[];
  refreshed_models: string[];
  failed_models: string[];
  reprocessed_models: string[];
};

type LocalExampleFile = {
  name: string;
  path: string;
  extension: string;
  is_video: boolean;
  type: "image" | "video";
  source: "local";
};

type DownloadMedia = {
  url: string;
  index: number;
  id?: string | number;
  source: "image" | "custom";
  type?: string;
};

type DownloadResult = {
  hash: string;
  ok: boolean;
  files: LocalExampleFile[];
  downloaded: number;
  skipped: number;
  errors: string[];
  no_media: boolean;
};

type JobState = {
  running: boolean;
  paused: boolean;
  stopRequested: boolean;
  progress: ExampleProgress;
  results: Record<string, DownloadResult>;
};

const supportedImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"]);
const supportedVideoExtensions = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const supportedExtensions = new Set([...supportedImageExtensions, ...supportedVideoExtensions]);

const mimeByExtension: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
};

const extensionByContentType: Record<string, string> = {
  "image/jpeg": ".jpeg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/avif": ".avif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "video/x-m4v": ".m4v",
};

let activeJob: JobState | null = null;
let lastProgress = makeProgress(0, "idle");
let cachedExampleRoot = "";

export function xyzExampleImagesPlugin(comfyBaseUrl = "http://127.0.0.1:8188"): Plugin {
  return {
    name: "xyz-example-images",
    configureServer(server) {
      installExampleImagesMiddleware(server.middlewares, comfyBaseUrl);
    },
    configurePreviewServer(server) {
      installExampleImagesMiddleware(server.middlewares, comfyBaseUrl);
    },
  };
}

function installExampleImagesMiddleware(middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }, comfyBaseUrl: string) {
  middlewares.use((req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith("/xyz/example")) {
      next();
      return;
    }

    void handleExampleImagesRequest(req, res, requestUrl, comfyBaseUrl).catch((error) => {
      sendJson(res, 500, { success: false, error: errorMessage(error) });
    });
  });
}

async function handleExampleImagesRequest(req: IncomingMessage, res: ServerResponse, requestUrl: URL, comfyBaseUrl: string) {
  const method = (req.method ?? "GET").toUpperCase();
  const pathname = requestUrl.pathname;

  if (method === "GET" && pathname === "/xyz/example-images/status") {
    sendJson(res, 200, currentStatusPayload());
    return;
  }

  if (method === "POST" && pathname === "/xyz/example-images/check") {
    const payload = await readJsonBody(req);
    const modelTypes = normalizeModelTypes(payload.model_types ?? payload.modelTypes);
    const result = await checkExampleImagesNeeded(comfyBaseUrl, modelTypes);
    sendJson(res, 200, result);
    return;
  }

  if (method === "POST" && pathname === "/xyz/example-images/download") {
    const payload = await readJsonBody(req);
    if (activeJob?.running) {
      sendJson(res, 409, { success: false, error: "Example image download is already running", status: activeJob.progress });
      return;
    }
    const items = await resolveDownloadItems(comfyBaseUrl, payload);
    const job = startJob(items.length);
    void runDownloadJob(job, comfyBaseUrl, items, Boolean(payload.force ?? true)).catch((error) => {
      failJob(job, errorMessage(error));
    });
    sendJson(res, 200, { success: true, message: "Example image download started", status: job.progress });
    return;
  }

  if (method === "POST" && pathname === "/xyz/example-images/force-download") {
    const payload = await readJsonBody(req);
    if (activeJob?.running) {
      sendJson(res, 409, { success: false, error: "Example image download is already running", status: activeJob.progress });
      return;
    }
    const items = await resolveDownloadItems(comfyBaseUrl, payload);
    const job = startJob(items.length);
    const result = await runDownloadJob(job, comfyBaseUrl, items, Boolean(payload.force ?? true));
    const success = result.status.status !== "error" && result.status.status !== "stopped";
    sendJson(res, success ? 200 : 500, {
      success,
      message: success ? "Example images downloaded" : result.status.last_error ?? "Example image download failed",
      status: result.status,
      result: result.results,
      error: success ? undefined : result.status.last_error,
    });
    return;
  }

  if (method === "POST" && pathname === "/xyz/example-images/pause") {
    if (activeJob?.running) {
      activeJob.paused = true;
      activeJob.progress.status = "paused";
    }
    sendJson(res, 200, { success: true, status: activeJob?.progress ?? lastProgress });
    return;
  }

  if (method === "POST" && pathname === "/xyz/example-images/resume") {
    if (activeJob?.running) {
      activeJob.paused = false;
      activeJob.progress.status = "running";
    }
    sendJson(res, 200, { success: true, status: activeJob?.progress ?? lastProgress });
    return;
  }

  if (method === "POST" && pathname === "/xyz/example-images/stop") {
    if (activeJob?.running) {
      activeJob.stopRequested = true;
      activeJob.paused = false;
      activeJob.progress.status = "stopping";
    }
    sendJson(res, 200, { success: true, status: activeJob?.progress ?? lastProgress });
    return;
  }

  if (method === "POST" && pathname === "/xyz/example-images/open-folder") {
    const payload = await readJsonBody(req);
    const hash = normalizeHash(payload.model_hash ?? payload.modelHash);
    if (!hash) {
      sendJson(res, 400, { success: false, error: "Missing model_hash parameter" });
      return;
    }
    const root = await getExampleImagesRoot(comfyBaseUrl);
    const folder = safeResolve(root, hash);
    await mkdir(folder, { recursive: true });
    openFolder(folder);
    sendJson(res, 200, { success: true, path: folder, mode: "system" });
    return;
  }

  if (method === "GET" && pathname === "/xyz/example-image-files") {
    const hash = normalizeHash(requestUrl.searchParams.get("model_hash"));
    if (!hash) {
      sendJson(res, 400, { success: false, error: "Missing model_hash parameter", files: [] });
      return;
    }
    const root = await getExampleImagesRoot(comfyBaseUrl);
    const files = await listLocalExampleFiles(root, hash);
    sendJson(res, 200, { success: true, files });
    return;
  }

  if ((method === "GET" || method === "HEAD") && pathname.startsWith("/xyz/example-images/file/")) {
    await serveExampleFile(req, res, requestUrl, comfyBaseUrl);
    return;
  }

  sendJson(res, 404, { success: false, error: "Unknown xyz example images endpoint" });
}

async function checkExampleImagesNeeded(comfyBaseUrl: string, modelTypes: ManagedModelType[]) {
  const items = await listAllModels(comfyBaseUrl, modelTypes);
  const root = await getExampleImagesRoot(comfyBaseUrl);
  let pending = 0;
  let processed = 0;
  let failed = 0;

  for (const item of items) {
    const hash = normalizeHash(item.sha256);
    if (!hash) {
      failed += 1;
      continue;
    }
    const localFiles = await listLocalExampleFiles(root, hash);
    if (localFiles.length > 0) {
      processed += 1;
      continue;
    }

    try {
      const metadata = await getModelMetadata(comfyBaseUrl, item);
      const media = extractRemoteMedia(metadata, item);
      if (media.length > 0) {
        pending += 1;
      } else {
        processed += 1;
      }
    } catch {
      pending += 1;
    }
  }

  return {
    success: true,
    is_downloading: Boolean(activeJob?.running),
    total_models: items.length,
    pending_count: pending,
    processed_count: processed,
    failed_count: failed,
    needs_download: pending > 0,
  };
}

async function resolveDownloadItems(comfyBaseUrl: string, payload: Record<string, unknown>) {
  const modelTypes = normalizeModelTypes(payload.model_types ?? payload.modelTypes);
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const itemsFromPayload = rawItems
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => normalizeDownloadItem(item, modelTypes[0]))
    .filter((item) => normalizeHash(item.sha256));

  const hashes = new Set(
    (Array.isArray(payload.model_hashes) ? payload.model_hashes : [])
      .map((hash) => normalizeHash(hash))
      .filter(Boolean),
  );

  if (itemsFromPayload.length > 0) {
    if (hashes.size === 0) return dedupeDownloadItems(itemsFromPayload);
    return dedupeDownloadItems(itemsFromPayload.filter((item) => hashes.has(normalizeHash(item.sha256))));
  }

  const listedItems = await listAllModels(comfyBaseUrl, modelTypes);
  const filtered = hashes.size > 0
    ? listedItems.filter((item) => hashes.has(normalizeHash(item.sha256)))
    : listedItems;
  return dedupeDownloadItems(filtered);
}

async function listAllModels(comfyBaseUrl: string, modelTypes: ManagedModelType[]) {
  const allItems: LoraItem[] = [];
  for (const modelType of modelTypes) {
    const pageSize = 100;
    let page = 1;
    let totalPages = 1;
    do {
      const query = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
        sort_by: "name",
      });
      const data = await comfyGetJson<Record<string, unknown>>(comfyBaseUrl, `/api/lm/${modelType}/list?${query}`);
      const items = Array.isArray(data.items) ? data.items : [];
      for (const item of items) {
        if (item && typeof item === "object") {
          allItems.push(normalizeDownloadItem(item as Record<string, unknown>, modelType));
        }
      }
      totalPages = Number(data.total_pages ?? 1) || 1;
      page += 1;
      if (items.length === 0) break;
    } while (page <= totalPages);
  }
  return dedupeDownloadItems(allItems);
}

function normalizeDownloadItem(item: Record<string, unknown>, fallbackModelType: ManagedModelType): LoraItem {
  const modelType = normalizeModelType(item.model_type ?? item.modelType ?? item.type) ?? fallbackModelType;
  return {
    ...item,
    model_type: modelType,
    sha256: normalizeHash(item.sha256 ?? item.hash ?? item.model_hash),
    file_path: stringValue(item.file_path ?? item.filePath),
    file_name: stringValue(item.file_name ?? item.fileName),
    model_name: stringValue(item.model_name ?? item.modelName),
  };
}

function dedupeDownloadItems(items: LoraItem[]) {
  const byKey = new Map<string, LoraItem>();
  for (const item of items) {
    const hash = normalizeHash(item.sha256);
    if (!hash) continue;
    byKey.set(`${item.model_type ?? "loras"}:${hash}`, item);
  }
  return Array.from(byKey.values());
}

function startJob(total: number): JobState {
  const job: JobState = {
    running: true,
    paused: false,
    stopRequested: false,
    progress: makeProgress(total, "running"),
    results: {},
  };
  activeJob = job;
  return job;
}

async function runDownloadJob(job: JobState, comfyBaseUrl: string, items: LoraItem[], force: boolean) {
  try {
    const root = await getExampleImagesRoot(comfyBaseUrl);
    for (const item of items) {
      await waitForJob(job);
      if (job.stopRequested) break;

      const hash = normalizeHash(item.sha256);
      job.progress.current_model = stringValue(item.model_name ?? item.file_name ?? hash);
      job.progress.status = "running";

      const result = await downloadExamplesForItem(comfyBaseUrl, root, item, force);
      job.results[result.hash] = result;
      job.progress.completed += 1;

      if (result.ok) {
        job.progress.processed_models.push(result.hash);
        if (force && result.downloaded > 0) {
          job.progress.reprocessed_models.push(result.hash);
        }
      } else {
        job.progress.failed_models.push(result.hash);
        for (const itemError of result.errors) {
          job.progress.errors.push(itemError);
        }
        job.progress.last_error = result.errors.at(-1) ?? "Example image download failed";
      }
    }

    if (job.stopRequested) {
      job.progress.status = "stopped";
      job.progress.last_error = "Example image download stopped";
    } else if (job.progress.failed_models.length > 0) {
      job.progress.status = "error";
      job.progress.last_error ??= `${job.progress.failed_models.length} model(s) failed`;
    } else {
      job.progress.status = "completed";
    }
    job.progress.end_time = Date.now() / 1000;
    job.running = false;
    if (activeJob === job) {
      lastProgress = job.progress;
      activeJob = null;
    }
    return { status: job.progress, results: job.results };
  } catch (error) {
    failJob(job, errorMessage(error));
    return { status: job.progress, results: job.results };
  }
}

function failJob(job: JobState, message: string) {
  job.running = false;
  job.progress.status = "error";
  job.progress.last_error = message;
  job.progress.errors.push(message);
  job.progress.end_time = Date.now() / 1000;
  if (activeJob === job) {
    lastProgress = job.progress;
    activeJob = null;
  }
}

async function waitForJob(job: JobState) {
  while (job.running && job.paused && !job.stopRequested) {
    await delay(250);
  }
}

async function downloadExamplesForItem(comfyBaseUrl: string, root: string, item: LoraItem, force: boolean): Promise<DownloadResult> {
  const hash = normalizeHash(item.sha256);
  if (!hash) {
    return {
      hash: "unknown",
      ok: false,
      files: [],
      downloaded: 0,
      skipped: 0,
      errors: ["Missing SHA256 for model"],
      no_media: false,
    };
  }

  const folder = safeResolve(root, hash);
  await mkdir(folder, { recursive: true });

  const existingFiles = await listLocalExampleFiles(root, hash);
  const metadata = await getModelMetadata(comfyBaseUrl, item);
  const mediaItems = extractRemoteMedia(metadata, item);
  const errors: string[] = [];
  let downloaded = 0;
  let skipped = 0;

  if (mediaItems.length === 0) {
    return {
      hash,
      ok: true,
      files: existingFiles,
      downloaded,
      skipped: existingFiles.length,
      errors,
      no_media: true,
    };
  }

  for (const media of mediaItems) {
    const stems = mediaStemCandidates(media);
    const currentFiles = await listLocalExampleFiles(root, hash);
    if (!force && currentFiles.some((file) => stems.includes(fileStem(file.name)))) {
      skipped += 1;
      continue;
    }

    try {
      await downloadMediaFile(media, folder, stems[0]);
      downloaded += 1;
    } catch (error) {
      errors.push(`${displayName(item, hash)}: ${errorMessage(error)}`);
    }
  }

  const files = await listLocalExampleFiles(root, hash);
  const missing = mediaItems.filter((media) => {
    const stems = mediaStemCandidates(media);
    return !files.some((file) => stems.includes(fileStem(file.name)));
  });

  if (missing.length > 0) {
    errors.push(`${displayName(item, hash)}: ${missing.length} media file(s) were not written locally`);
  }

  return {
    hash,
    ok: errors.length === 0,
    files,
    downloaded,
    skipped,
    errors,
    no_media: false,
  };
}

async function downloadMediaFile(media: DownloadMedia, folder: string, stem: string) {
  const response = await fetch(media.url, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,video/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
      Referer: "https://civitai.com/",
    },
  });

  if (!response.ok) {
    throw new Error(`${media.url} ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error(`${media.url} returned an empty body`);
  }

  const contentType = normalizeContentType(response.headers.get("content-type"));
  const urlExtension = extensionFromUrl(media.url);
  const contentExtension = extensionByContentType[contentType] ?? "";
  const extension = contentExtension || urlExtension || (isVideoMedia(media) ? ".mp4" : ".jpeg");
  const validBinaryType = contentType.startsWith("image/")
    || contentType.startsWith("video/")
    || contentType === "application/octet-stream"
    || contentType === "binary/octet-stream"
    || contentType === "";

  if (!supportedExtensions.has(extension) || (!validBinaryType && !supportedExtensions.has(urlExtension))) {
    throw new Error(`Unsupported media response type ${contentType || "unknown"} for ${media.url}`);
  }

  const targetFile = path.resolve(folder, `${stem}${extension}`);
  if (!isInside(targetFile, folder)) {
    throw new Error("Resolved media path is outside the example image folder");
  }

  const tempFile = `${targetFile}.download-${Date.now()}.tmp`;
  try {
    await pipeline(Readable.fromWeb(response.body as unknown as ReadableStream), createWriteStream(tempFile));
    await unlink(targetFile).catch(() => undefined); // Delete existing file first to avoid EPERM on Windows
    try {
      await rename(tempFile, targetFile);
    } catch (renameError) {
      if ((renameError as NodeJS.ErrnoException).code === "EPERM") {
        await new Promise(resolve => setTimeout(resolve, 500));
        await unlink(targetFile).catch(() => undefined);
        await rename(tempFile, targetFile);
      } else {
        throw renameError;
      }
    }
  } catch (error) {
    await unlink(tempFile).catch(() => undefined);
    throw error;
  }
}

async function getModelMetadata(comfyBaseUrl: string, item: LoraItem) {
  const filePath = stringValue(item.file_path);
  if (!filePath) return undefined;
  const modelType = item.model_type ?? "loras";
  const query = new URLSearchParams({ file_path: filePath });
  const data = await comfyGetJson<Record<string, unknown>>(comfyBaseUrl, `/api/lm/${modelType}/metadata?${query}`);
  return data.metadata;
}

function extractRemoteMedia(metadata: unknown, item: LoraItem) {
  const sources = [metadata, item.metadata, item.civitai].filter((source): source is Record<string, unknown> => Boolean(source && typeof source === "object"));
  for (const source of sources) {
    const media = mediaFromSource(source);
    if (media.length > 0) return dedupeRemoteMedia(media);
  }
  return [];
}

function mediaFromSource(source: Record<string, unknown>) {
  const imageItems = Array.isArray(source.images) ? source.images : [];
  const customItems = Array.isArray(source.customImages) ? source.customImages : [];
  const media: DownloadMedia[] = [];
  for (const item of imageItems) {
    const parsed = parseRemoteMedia(item, media.length, "image");
    if (parsed) media.push(parsed);
  }
  for (const item of customItems) {
    const parsed = parseRemoteMedia(item, media.length, "custom");
    if (parsed) media.push(parsed);
  }
  return media;
}

function parseRemoteMedia(value: unknown, index: number, source: "image" | "custom"): DownloadMedia | null {
  if (!value || typeof value !== "object") return null;
  const media = value as Record<string, unknown>;
  const url = firstHttpUrl([media.url, media.path, media.image_url, media.imageUrl, media.video_url, media.videoUrl]);
  if (!url) return null;
  return {
    url,
    index,
    id: typeof media.id === "string" || typeof media.id === "number" ? media.id : undefined,
    source,
    type: stringValue(media.type),
  };
}

function dedupeRemoteMedia(items: DownloadMedia[]) {
  const seen = new Set<string>();
  const result: DownloadMedia[] = [];
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    result.push(item);
  }
  return result;
}

function mediaStemCandidates(media: DownloadMedia) {
  const imageStem = `image_${media.index}`;
  if (media.source === "custom" && media.id !== undefined) {
    return [`custom_${safeNamePart(String(media.id))}`, imageStem];
  }
  return [imageStem];
}

async function listLocalExampleFiles(root: string, hash: string): Promise<LocalExampleFile[]> {
  const folder = safeResolve(root, hash);
  const entries = await readdir(folder, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files: LocalExampleFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!supportedExtensions.has(extension)) continue;
    const filePath = path.resolve(folder, entry.name);
    if (!isInside(filePath, folder)) continue;
    const info = await stat(filePath);
    if (info.size <= 0) continue;
    const encodedName = encodeURIComponent(entry.name);
    files.push({
      name: entry.name,
      path: `/xyz/example-images/file/${encodeURIComponent(hash)}/${encodedName}?v=${Math.trunc(info.mtimeMs)}`,
      extension,
      is_video: supportedVideoExtensions.has(extension),
      type: supportedVideoExtensions.has(extension) ? "video" : "image",
      source: "local",
    });
  }
  return files.sort((left, right) => mediaSortValue(left.name) - mediaSortValue(right.name) || left.name.localeCompare(right.name));
}

async function serveExampleFile(req: IncomingMessage, res: ServerResponse, requestUrl: URL, comfyBaseUrl: string) {
  const match = requestUrl.pathname.match(/^\/xyz\/example-images\/file\/([^/]+)\/(.+)$/);
  if (!match) {
    sendJson(res, 404, { success: false, error: "Example image file not found" });
    return;
  }

  const hash = normalizeHash(decodeURIComponent(match[1]));
  const decodedName = decodeURIComponent(match[2]);
  const fileName = path.basename(decodedName);
  if (!hash || !fileName || fileName !== decodedName.replace(/\\/g, "/").split("/").pop()) {
    sendJson(res, 400, { success: false, error: "Invalid example image path" });
    return;
  }

  const extension = path.extname(fileName).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    sendJson(res, 415, { success: false, error: "Unsupported example media type" });
    return;
  }

  const root = await getExampleImagesRoot(comfyBaseUrl);
  const folder = safeResolve(root, hash);
  const filePath = path.resolve(folder, fileName);
  if (!isInside(filePath, folder)) {
    sendJson(res, 400, { success: false, error: "Invalid example image path" });
    return;
  }

  await access(filePath);
  const info = await stat(filePath);
  const range = parseRange(req.headers.range, info.size);
  res.setHeader("Content-Type", mimeByExtension[extension] ?? "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=60");

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

async function getExampleImagesRoot(comfyBaseUrl: string) {
  try {
    const data = await comfyGetJson<Record<string, unknown>>(comfyBaseUrl, "/api/lm/settings");
    const settings = data.settings && typeof data.settings === "object" ? data.settings as Record<string, unknown> : data;
    const root = stringValue(settings.example_images_path).trim();
    if (!root) {
      throw new Error("No example_images_path configured in LoRA Manager settings");
    }
    const resolved = path.resolve(root);
    await mkdir(resolved, { recursive: true });
    cachedExampleRoot = resolved;
    return resolved;
  } catch (error) {
    if (cachedExampleRoot) return cachedExampleRoot;
    throw error;
  }
}

async function comfyGetJson<T>(comfyBaseUrl: string, endpoint: string): Promise<T> {
  const response = await fetch(new URL(endpoint, comfyBaseUrl), {
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${endpoint} ${response.status}: ${body || response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function currentStatusPayload() {
  const progress = activeJob?.progress ?? lastProgress;
  return {
    success: true,
    is_downloading: Boolean(activeJob?.running),
    is_migrating: false,
    status: progress,
  };
}

function makeProgress(total: number, status: ExampleProgress["status"]): ExampleProgress {
  return {
    total,
    completed: 0,
    current_model: "",
    status,
    errors: [],
    last_error: null,
    start_time: status === "idle" ? null : Date.now() / 1000,
    end_time: null,
    processed_models: [],
    refreshed_models: [],
    failed_models: [],
    reprocessed_models: [],
  };
}

function normalizeModelTypes(value: unknown): ManagedModelType[] {
  const rawValues = Array.isArray(value) ? value : value ? [value] : ["lora"];
  const result = rawValues.map(normalizeModelType).filter((item): item is ManagedModelType => Boolean(item));
  return result.length > 0 ? result : ["loras"];
}

function normalizeModelType(value: unknown): ManagedModelType | null {
  const normalized = stringValue(value).toLowerCase();
  if (normalized === "embedding" || normalized === "embeddings") return "embeddings";
  if (normalized === "lora" || normalized === "loras") return "loras";
  return null;
}

function normalizeHash(value: unknown) {
  const hash = stringValue(value).trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : "";
}

function firstHttpUrl(values: unknown[]) {
  for (const value of values) {
    const text = stringValue(value).trim();
    if (/^https?:\/\//i.test(text)) return text;
  }
  return "";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function normalizeContentType(value: string | null) {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

function extensionFromUrl(value: string) {
  try {
    const parsed = new URL(value);
    const extension = path.extname(parsed.pathname).toLowerCase();
    return supportedExtensions.has(extension) ? extension : "";
  } catch {
    return "";
  }
}

function isVideoMedia(media: DownloadMedia) {
  return media.type?.toLowerCase() === "video" || supportedVideoExtensions.has(extensionFromUrl(media.url));
}

function fileStem(fileName: string) {
  return path.basename(fileName, path.extname(fileName)).toLowerCase();
}

function safeNamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "item";
}

function mediaSortValue(name: string) {
  const stem = fileStem(name);
  const imageMatch = stem.match(/^image_(\d+)$/i);
  if (imageMatch) return Number(imageMatch[1]);
  const customMatch = stem.match(/^custom_(.+)$/i);
  if (customMatch) return 100000;
  return 200000;
}

function safeResolve(root: string, ...parts: string[]) {
  const resolved = path.resolve(root, ...parts);
  if (!isInside(resolved, root)) {
    throw new Error("Resolved path is outside the example images root");
  }
  return resolved;
}

function isInside(candidate: string, root: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function openFolder(folder: string) {
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [folder], { detached: true, stdio: "ignore" });
  child.unref();
}

function parseRange(value: string | undefined, size: number) {
  if (!value || !value.startsWith("bytes=")) return null;
  const [startText, endText] = value.slice("bytes=".length).split("-", 2);
  let start = startText ? Number(startText) : NaN;
  let end = endText ? Number(endText) : NaN;

  if (!Number.isFinite(start) && Number.isFinite(end)) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (Number.isFinite(start) && !Number.isFinite(end)) {
    end = size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  start = Math.max(0, Math.trunc(start));
  end = Math.min(size - 1, Math.trunc(end));
  if (start > end || start >= size) return null;
  return { start, end };
}

function displayName(item: LoraItem, hash: string) {
  return stringValue(item.model_name ?? item.file_name) || hash;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) return {};
  const parsed = JSON.parse(body);
  return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
