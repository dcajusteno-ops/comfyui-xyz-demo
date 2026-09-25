import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { sendJson } from "./utils";

/**
 * 手机端远程生图（T13）。
 *
 * 复用手机联动的「局域网信任 + 服务端代跑 ComfyUI」模型（与 mobileSync 的识图任务一致）：
 * 手机提交提示词 → 服务端排队、构造极简 SD 工作流提交 ComfyUI → 轮询 history →
 * 手机轮询本接口取状态与成图（成图经本插件代理 /api/view，手机无需直连 ComfyUI）。
 *
 * 不走桌面端的任务面板：生图任务在服务端自洽闭环，桌面端不参与。
 */

type MiddlewareHandler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
type MiddlewareInstaller = { use: (handler: MiddlewareHandler) => void };

type GenTaskParams = {
  prompt: string;
  negativePrompt: string;
  checkpoint?: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
};

type GenImage = { filename: string; subfolder: string; type: string };

type GenTaskRecord = {
  id: string;
  status: "queued" | "running" | "done" | "error";
  params: GenTaskParams;
  promptId?: string;
  images: GenImage[];
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
};

const MAX_QUEUE = 5;
const MAX_TASKS = 40;
const MAX_PROMPT_CHARS = 4000;
const POLL_SECONDS = 300;
const clampDim = (value: number) => Math.min(2048, Math.max(256, Math.round(value / 64) * 64));

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function sanitizeParams(raw: Record<string, unknown>): GenTaskParams {
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) throw new HttpError(400, "提示词不能为空");
  if (prompt.length > MAX_PROMPT_CHARS) throw new HttpError(400, `提示词过长（上限 ${MAX_PROMPT_CHARS} 字符）`);
  const num = (key: string, fallback: number, min: number, max: number) => {
    const value = typeof raw[key] === "number" ? raw[key] : fallback;
    return Math.min(max, Math.max(min, value));
  };
  return {
    prompt,
    negativePrompt: typeof raw.negativePrompt === "string" ? raw.negativePrompt.slice(0, MAX_PROMPT_CHARS) : "",
    checkpoint: typeof raw.checkpoint === "string" && raw.checkpoint.trim() ? raw.checkpoint.trim() : undefined,
    width: clampDim(num("width", 832, 256, 2048)),
    height: clampDim(num("height", 1216, 256, 2048)),
    steps: Math.round(num("steps", 20, 1, 100)),
    cfg: num("cfg", 7, 0, 30),
    seed: typeof raw.seed === "number" && Number.isFinite(raw.seed) ? Math.floor(Math.abs(raw.seed)) % 2 ** 48 : Math.floor(Math.random() * 2 ** 31),
  };
}

/** 极简 SD 文生图工作流：只用核心节点（Checkpoint / CLIP / EmptyLatent / KSampler / VAE / Save） */
function buildText2ImgWorkflow(params: GenTaskParams, checkpoint: string) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint }, _meta: { title: "手机生图 · Checkpoint" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: params.prompt, clip: ["1", 1] }, _meta: { title: "正向提示词" } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: params.negativePrompt, clip: ["1", 1] }, _meta: { title: "负向提示词" } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: params.width, height: params.height, batch_size: 1 }, _meta: { title: "空 Latent" } },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
        seed: params.seed,
        steps: params.steps,
        cfg: params.cfg,
        sampler_name: "euler_ancestral",
        scheduler: "simple",
        denoise: 1,
      },
      _meta: { title: "采样" },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] }, _meta: { title: "VAE 解码" } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "MobileGen/gen" }, _meta: { title: "保存图像" } },
  };
}

export function xyzMobileGenPlugin(comfyTarget: string): Plugin {
  const comfyBase = comfyTarget.replace(/\/+$/, "");

  const tasks = new Map<string, GenTaskRecord>();
  const queue: GenTaskRecord[] = [];
  let draining = false;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ComfyUI 返回的动态 JSON，收窄会在多处调用点引入连锁 unknown 断言
  async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<any> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      if (!res.ok) throw new HttpError(502, `ComfyUI 请求失败（${res.status}）`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /** checkpoint 取值从 /object_info 实际枚举取（模糊命中优先，否则取首项），不硬编码 */
  async function resolveCheckpoint(requested?: string): Promise<string> {
    try {
      const info = await fetchJson(`${comfyBase}/api/object_info/CheckpointLoaderSimple`, {}, 10000);
      const choices: string[] = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
      if (!Array.isArray(choices) || choices.length === 0) throw new HttpError(502, "ComfyUI 未返回可用模型");
      if (requested) {
        const lower = requested.toLowerCase();
        const hit = choices.find((item) => item.toLowerCase() === lower) ?? choices.find((item) => item.toLowerCase().includes(lower));
        if (hit) return hit;
      }
      return choices[0];
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, "无法连接 ComfyUI（/object_info 不可达）");
    }
  }

  async function runTask(task: GenTaskRecord) {
    task.status = "running";
    task.startedAt = new Date().toISOString();
    try {
      const checkpoint = await resolveCheckpoint(task.params.checkpoint);
      const queueRes = await fetchJson(`${comfyBase}/api/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: buildText2ImgWorkflow(task.params, checkpoint), client_id: randomUUID() }),
      });
      const promptId = queueRes?.prompt_id as string | undefined;
      if (!promptId) throw new HttpError(502, "ComfyUI 未返回 prompt_id");
      task.promptId = promptId;

      for (let i = 0; i < POLL_SECONDS; i++) {
        await sleep(1000);
        const history = await fetchJson(`${comfyBase}/api/history/${encodeURIComponent(promptId)}`, {}, 10000).catch(() => null);
        const entry = history?.[promptId];
        if (entry?.status?.status_str === "error") throw new HttpError(502, "ComfyUI 执行失败");
        const outputs = entry?.outputs as Record<string, Record<string, unknown>> | undefined;
        if (outputs && Object.keys(outputs).length > 0) {
          const images: GenImage[] = [];
          for (const nodeOutput of Object.values(outputs)) {
            const list = nodeOutput?.images as Array<{ filename?: string; subfolder?: string; type?: string }> | undefined;
            for (const image of list ?? []) {
              if (image.filename && image.type === "output") {
                images.push({ filename: image.filename, subfolder: image.subfolder ?? "", type: "output" });
              }
            }
          }
          if (images.length === 0) throw new HttpError(502, "生成完成但未解析到图片");
          task.images = images;
          task.status = "done";
          return;
        }
      }
      throw new HttpError(502, `生成超时（${POLL_SECONDS} 秒内未完成）`);
    } catch (err) {
      task.status = "error";
      task.error = err instanceof Error ? err.message : String(err);
    } finally {
      task.finishedAt = new Date().toISOString();
    }
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

  function publicTask(record: GenTaskRecord) {
    const { id, status, params, promptId, images, error, createdAt, startedAt, finishedAt } = record;
    return { id, status, params, promptId, images, error, createdAt, startedAt, finishedAt };
  }

  async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let total = 0;
    return new Promise((resolve, reject) => {
      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > 1024 * 1024) {
          reject(new HttpError(413, "请求体过大"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        try {
          const body = Buffer.concat(chunks).toString("utf-8");
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new HttpError(400, "请求体必须是合法 JSON"));
        }
      });
      req.on("error", reject);
    });
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse, requestUrl: URL) {
    const method = (req.method ?? "GET").toUpperCase();
    const segments = requestUrl.pathname.split("/").filter(Boolean); // ["api","mobile","gen",...]

    if (method === "POST" && segments.length === 3) {
      const raw = await readJsonBody(req);
      const params = sanitizeParams(raw);
      if (queue.length >= MAX_QUEUE) throw new HttpError(429, `排队任务已达上限（${MAX_QUEUE}），请稍后再试`);
      const task: GenTaskRecord = {
        id: randomUUID(),
        status: "queued",
        params,
        images: [],
        createdAt: new Date().toISOString(),
      };
      tasks.set(task.id, task);
      if (tasks.size > MAX_TASKS) {
        const oldest = tasks.keys().next().value as string;
        tasks.delete(oldest);
      }
      queue.push(task);
      void drainQueue();
      sendJson(res, 202, { success: true, id: task.id });
      return;
    }

    if (method === "GET" && segments.length === 3) {
      const list = [...tasks.values()].reverse().map(publicTask);
      sendJson(res, 200, { success: true, tasks: list });
      return;
    }

    if (segments[3]) {
      const id = segments[3];
      const record = tasks.get(id);
      if (!record) {
        sendJson(res, 404, { success: false, error: "任务不存在" });
        return;
      }
      if (method === "GET" && segments.length === 4) {
        sendJson(res, 200, { success: true, task: publicTask(record) });
        return;
      }
      if (method === "DELETE" && segments.length === 4) {
        const queueIndex = queue.findIndex((item) => item.id === id);
        if (queueIndex !== -1) queue.splice(queueIndex, 1);
        tasks.delete(id);
        sendJson(res, 200, { success: true });
        return;
      }
      // 代理成图：/api/mobile/gen/tasks/:id/image/:index → ComfyUI /api/view
      if (method === "GET" && segments[4] === "image") {
        const index = Math.max(0, Number(segments[5] ?? 0) || 0);
        const image = record.images[index];
        if (!image) {
          sendJson(res, 404, { success: false, error: "成图不存在（任务可能尚未完成）" });
          return;
        }
        const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type });
        const upstream = await fetch(`${comfyBase}/api/view?${query}`);
        if (!upstream.ok || !upstream.body) {
          sendJson(res, 502, { success: false, error: `读取成图失败（${upstream.status}）` });
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/png");
        res.setHeader("Cache-Control", "no-store");
        const buffer = Buffer.from(await upstream.arrayBuffer());
        res.setHeader("Content-Length", buffer.length);
        res.end(buffer);
        return;
      }
    }

    sendJson(res, 404, { success: false, error: "Unknown mobile gen endpoint" });
  }

  return {
    name: "xyz-mobile-gen",
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };

  function install(middlewares: MiddlewareInstaller) {
    middlewares.use((req, res, next) => {
      const requestUrl = new URL(req.url ?? "/", "http://localhost");
      if (!requestUrl.pathname.startsWith("/api/mobile/gen")) {
        next();
        return;
      }
      void handleRequest(req, res, requestUrl).catch((error) => {
        const status = error instanceof HttpError ? error.status : 500;
        const message = error instanceof Error ? error.message : String(error);
        if (!res.headersSent) {
          sendJson(res, status, { success: false, error: message });
        } else {
          res.end();
        }
      });
    });
  }
}
