import { readFile, rename, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

export function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

/** 请求体默认上限：2MB（图片上传走 mobileSync 自己的 readBody，另有上限） */
export const DEFAULT_BODY_LIMIT = 2 * 1024 * 1024;

export class BodyLimitError extends Error {
  constructor(limitBytes: number) {
    super(`Request body exceeds limit of ${Math.floor(limitBytes / 1024)}KB`);
    this.name = "BodyLimitError";
    this.status = 413;
  }
  status: number;
}

export function readJsonBody(req: IncomingMessage, maxBytes: number = DEFAULT_BODY_LIMIT): Promise<Record<string, unknown>> {
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
        // 不立即 destroy：把剩余请求体排干后正常响应 413，客户端才能读到状态码。
        // 超过 32 倍上限的恶意超大流仍然直接断开。
        if (total > maxBytes * 32) {
          req.destroy();
        } else {
          req.resume();
        }
        reject(new BodyLimitError(maxBytes));
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** 读取 JSON 文件；不存在或损坏时返回 null（调用方决定默认值） */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

/** 原子写 JSON：先写临时文件再 rename，避免写一半崩溃/并发留下损坏文件 */
export async function atomicWriteJson(filePath: string, data: unknown) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmp, filePath);
}

const fileWriteQueues = new Map<string, Promise<unknown>>();

/**
 * 同一文件的写操作串行化：并发 POST 依次应用，而不是互相覆盖/交错写。
 * 返回值透传任务结果。
 */
export function enqueueFileWrite<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const prev = fileWriteQueues.get(filePath) ?? Promise.resolve();
  const next = prev.then(task, task);
  fileWriteQueues.set(filePath, next.catch(() => undefined));
  return next;
}

/** 中间件兜底错误响应：尊重错误对象上的 status（如 BodyLimitError 的 413） */
export function sendError(res: ServerResponse, error: unknown, fallbackStatus = 500) {
  const status = (error as { status?: number } | null)?.status ?? fallbackStatus;
  sendJson(res, status, { success: false, error: error instanceof Error ? error.message : String(error) });
}
