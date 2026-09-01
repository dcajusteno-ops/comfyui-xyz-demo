import { randomUUID } from "node:crypto";
import os from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { CONFIG } from "../src/config";
import { pickLanIp } from "../src/lib/lanAddress";
import { extractTextsFromHistory, parseMultipart } from "../src/lib/mobileSync";
import { buildWd14Workflow } from "../src/lib/wd14Workflow";
import { sendJson } from "./utils";

type MobileTaskRecord = import("../src/types").MobileTask & { image: Buffer };

const MAX_TASKS = CONFIG.MOBILE.MAX_TASKS;
const MAX_IMAGE_BYTES = CONFIG.MOBILE.MAX_IMAGE_BYTES;
const MAX_QUEUE = CONFIG.MOBILE.MAX_QUEUE;
const HEARTBEAT_MS = CONFIG.MOBILE.SSE_HEARTBEAT_MS;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function xyzMobileSyncPlugin(comfyTarget: string): Plugin {
  const comfyBase = comfyTarget.replace(/\/+$/, "");

  const tasks = new Map<string, MobileTaskRecord>();
  const queue: MobileTaskRecord[] = [];
  let draining = false;
  const sseClients = new Set<ServerResponse>();

  function toPublic(record: MobileTaskRecord): import("../src/types").MobileTask {
    const { image: _image, ...pub } = record;
    return pub;
  }

  function broadcast(task: MobileTaskRecord) {
    const payload = `event: task-updated\ndata: ${JSON.stringify(toPublic(task))}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  }

  function getLanIp(): string | null {
    const addresses: string[] = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list ?? []) {
        if (net.family === "IPv4" && !net.internal) addresses.push(net.address);
      }
    }
    return pickLanIp(addresses);
  }

  function buildMobileUrl(req: IncomingMessage): string {
    const lanIp = getLanIp();
    const host = req.headers.host ?? "127.0.0.1:9999";
    const sep = host.lastIndexOf(":");
    const hostname = sep === -1 ? host : host.slice(0, sep);
    const port = sep === -1 ? "" : host.slice(sep + 1);
    const hostForUrl = /^(127\.0\.0\.1|localhost)$/i.test(hostname) ? (lanIp ?? hostname) : hostname;
    const portPart = port && port !== "80" ? `:${port}` : "";
    return `http://${hostForUrl}${portPart}/${CONFIG.MOBILE.PAGE_HASH.replace(/^#/, "#")}`;
  }

  // ---------- ComfyUI 执行 ----------

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 10000): Promise<any> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      if (!res.ok) throw new HttpError(502, `ComfyUI 请求失败（${url} → ${res.status}）`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function runTask(task: MobileTaskRecord) {
    task.status = "running";
    task.startedAt = new Date().toISOString();
    broadcast(task);
    try {
      // 1. 探测 ComfyUI 是否可达
      await fetchJson(`${comfyBase}/api/system_stats`, {}, 5000);

      // 2. 上传图片
      const form = new FormData();
      form.set("image", new Blob([task.image], { type: task.mime }), task.imageName);
      form.set("type", "input");
      form.set("overwrite", "true");
      const uploadRes = await fetch(`${comfyBase}/api/upload/image`, { method: "POST", body: form });
      if (!uploadRes.ok) throw new HttpError(502, `上传图片到 ComfyUI 失败（${uploadRes.status}）`);
      const uploaded = (await uploadRes.json()) as { name?: string };
      const imageName = uploaded.name ?? task.imageName;

      // 3. 提交 WD14 工作流
      const clientId = randomUUID();
      const queueRes = await fetchJson(
        `${comfyBase}/api/prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: buildWd14Workflow({ ...task.params, imageName }), client_id: clientId }),
        },
        15000,
      );
      const promptId = queueRes?.prompt_id as string | undefined;
      if (!promptId) throw new HttpError(502, "ComfyUI 未返回 prompt_id");
      task.promptId = promptId;

      // 4. 轮询 history 直到有输出（上限 180s）
      let history: Record<string, any> = {};
      let foundOutput = false;
      for (let i = 0; i < 180; i++) {
        await sleep(1000);
        try {
          history = await fetchJson(`${comfyBase}/api/history/${encodeURIComponent(promptId)}`, {}, 10000);
        } catch {
          continue;
        }
        const entry = history[promptId];
        if (entry?.status?.status_str === "error") throw new HttpError(502, "ComfyUI 执行失败");
        if (entry?.outputs && Object.keys(entry.outputs).length > 0) {
          foundOutput = true;
          break;
        }
      }
      if (!foundOutput) throw new HttpError(502, "识别超时（180 秒内未完成）");

      const texts = extractTextsFromHistory(history, promptId);
      if (texts.length === 0) throw new HttpError(502, "识别完成但未解析到 tags");
      task.tags = texts.join("\n");
      task.status = "done";
    } catch (err) {
      task.status = "error";
      task.error = err instanceof Error ? err.message : String(err);
    }
    task.finishedAt = new Date().toISOString();
    broadcast(task);
  }

  async function drainQueue() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0) {
        await runTask(queue.shift()!);
      }
    } finally {
      draining = false;
    }
  }

  // ---------- 请求处理 ----------

  function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          reject(new HttpError(413, `图片过大，上限 ${Math.floor(maxBytes / 1024 / 1024)}MB`));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  async function handleCreateTask(req: IncomingMessage): Promise<import("../src/types").MobileTask> {
    const contentType = req.headers["content-type"] ?? "";
    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    if (!boundaryMatch) throw new HttpError(400, "请求必须为 multipart/form-data");
    const raw = await readBody(req, MAX_IMAGE_BYTES + 64 * 1024);
    const parts = parseMultipart(raw, boundaryMatch[1] ?? boundaryMatch[2]);

    const imagePart = parts.find((p) => p.filename && (p.contentType ?? "").startsWith("image/"));
    if (!imagePart) throw new HttpError(400, "缺少图片字段（image）");
    if (imagePart.data.length === 0 || imagePart.data.length > MAX_IMAGE_BYTES) {
      throw new HttpError(413, `图片大小需在 1B ~ ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB 之间`);
    }
    const paramsPart = parts.find((p) => p.name === "params");
    const defaults = { model: "wd-v1-4-moat-tagger-v2", threshold: 0.35, characterThreshold: 0.85, replaceUnderscore: true, trailingComma: true, excludeTags: "", device: "GPU" };
    let params = defaults;
    if (paramsPart) {
      try {
        params = { ...defaults, ...JSON.parse(new TextDecoder().decode(paramsPart.data)) };
      } catch {
        throw new HttpError(400, "params 字段必须是合法 JSON");
      }
    }
    if (queue.length >= MAX_QUEUE) throw new HttpError(429, `排队任务已达上限（${MAX_QUEUE}），请稍后再试`);

    const task: MobileTaskRecord = {
      id: randomUUID(),
      imageName: imagePart.filename ?? "upload.png",
      mime: imagePart.contentType ?? "image/png",
      size: imagePart.data.length,
      status: "queued",
      params,
      tags: "",
      createdAt: new Date().toISOString(),
      image: Buffer.from(imagePart.data),
    };
    tasks.set(task.id, task);
    if (tasks.size > MAX_TASKS) {
      tasks.delete(tasks.keys().next().value as string);
    }
    queue.push(task);
    broadcast(task);
    void drainQueue();
    return task;
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse, requestUrl: URL) {
    const method = (req.method ?? "GET").toUpperCase();
    const segments = requestUrl.pathname.split("/").filter(Boolean); // ["api","mobile",...]

    if (requestUrl.pathname === "/api/mobile/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`retry: 3000\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (requestUrl.pathname === "/api/mobile/info") {
      sendJson(res, 200, {
        success: true,
        data: { mobileUrl: buildMobileUrl(req), lanIp: getLanIp() },
      });
      return;
    }

    if (requestUrl.pathname === "/api/mobile/tasks") {
      if (method === "GET") {
        const list = [...tasks.values()].reverse().map(toPublic);
        sendJson(res, 200, { success: true, tasks: list });
        return;
      }
      if (method === "POST") {
        const task = await handleCreateTask(req);
        sendJson(res, 202, { success: true, id: task.id });
        return;
      }
      if (method === "DELETE") {
        tasks.clear();
        sendJson(res, 200, { success: true });
        return;
      }
    }

    if (segments[2] === "tasks" && segments[3]) {
      const id = segments[3];
      const record = tasks.get(id);
      if (!record) {
        sendJson(res, 404, { success: false, error: "任务不存在" });
        return;
      }
      if (segments[4] === "image" && method === "GET") {
        res.statusCode = 200;
        res.setHeader("Content-Type", record.mime);
        res.setHeader("Content-Length", record.size);
        res.setHeader("Cache-Control", "no-store");
        res.end(record.image);
        return;
      }
      if (method === "GET") {
        sendJson(res, 200, { success: true, task: toPublic(record) });
        return;
      }
      if (method === "DELETE") {
        tasks.delete(id);
        sendJson(res, 200, { success: true });
        return;
      }
    }

    sendJson(res, 404, { success: false, error: "Unknown mobile endpoint" });
  }

  let heartbeat: NodeJS.Timeout | null = null;

  function install(middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }) {
    middlewares.use((req, res, next) => {
      const requestUrl = new URL(req.url ?? "/", "http://localhost");
      if (!requestUrl.pathname.startsWith("/api/mobile")) {
        next();
        return;
      }
      void handleRequest(req, res, requestUrl).catch((error) => {
        const status = error instanceof HttpError ? error.status : 500;
        const message = error instanceof Error ? error.message : String(error);
        if (res.headersSent) {
          res.end();
        } else {
          sendJson(res, status, { success: false, error: message });
        }
      });
    });
    if (!heartbeat) {
      heartbeat = setInterval(() => {
        for (const client of sseClients) {
          client.write(": heartbeat\n\n");
        }
      }, HEARTBEAT_MS);
    }
  }

  return {
    name: "xyz-mobile-sync",
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}