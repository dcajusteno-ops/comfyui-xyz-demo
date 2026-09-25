import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  atomicWriteJson,
  enqueueFileWrite,
  readJsonBody,
  readJsonFile,
  sendError,
  sendJson,
} from "./utils";

/**
 * 通配符词库在线编辑（T9）。
 *
 * 词库本体是 `public/wildcards/<name>.txt`（前端静态加载 + ImpactWildcardProcessor 引用），
 * 插件提供读写 API 并用侧车 JSON 记录每个文件的 revision，供编辑弹窗做乐观并发检测。
 * 复用 utils 的约定：readJsonBody 2MB 上限、temp+rename 原子写、enqueueFileWrite 串行化。
 */

const ROOT = path.resolve(process.cwd());
const WILDCARD_DIR = path.join(ROOT, "public", "wildcards");
const STATE_FILE = path.resolve(process.cwd(), "data", "wildcards_state.json");

/** 词库名白名单：与 src/lib/wildcards.ts 的 WILDCARD_FILES 保持一致（服务端不信任前端传名） */
const WILDCARD_NAMES = new Set(["styles", "lighting", "camera", "quality"]);

type WildcardState = {
  revision?: number;
  files?: Record<string, number>;
};

function wildcardFile(name: string) {
  // name 已过白名单，path.join 不会逃出目录；仍用 resolve 复核一次
  const target = path.resolve(WILDCARD_DIR, `${name}.txt`);
  if (!target.startsWith(WILDCARD_DIR + path.sep)) {
    throw new Error("非法的词库名");
  }
  return target;
}

async function readText(filePath: string): Promise<string | null> {
  const { readFile } = await import("node:fs/promises");
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** 原子写文本（与 atomicWriteJson 同款 temp+rename，txt 不能落 JSON） */
async function atomicWriteText(filePath: string, content: string) {
  const { writeFile, rename } = await import("node:fs/promises");
  const tmp = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, filePath);
}

export function xyzWildcardsPlugin(): Plugin {
  return {
    name: "xyz-wildcards",
    configureServer(server) {
      installWildcardsMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      installWildcardsMiddleware(server.middlewares);
    },
  };
}

function installWildcardsMiddleware(middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }) {
  middlewares.use((req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith("/xyz/wildcards")) {
      next();
      return;
    }
    void handleWildcardsRequest(req, res).catch((error) => {
      sendError(res, error);
    });
  });
}

async function handleWildcardsRequest(req: IncomingMessage, res: ServerResponse) {
  const method = (req.method ?? "GET").toUpperCase();

  if (method === "GET") {
    const state = (await readJsonFile<WildcardState>(STATE_FILE)) ?? {};
    const fileRevisions = state.files ?? {};
    const files = await Promise.all(
      [...WILDCARD_NAMES].map(async (name) => {
        const content = await readText(wildcardFile(name));
        return {
          name,
          content: content ?? "",
          missing: content === null,
          revision: typeof fileRevisions[name] === "number" ? fileRevisions[name] : 0,
        };
      }),
    );
    sendJson(res, 200, { success: true, files });
    return;
  }

  if (method === "POST") {
    const payload = await readJsonBody(req);
    const name = typeof payload.name === "string" ? payload.name : "";
    const content = typeof payload.content === "string" ? payload.content : null;
    if (!WILDCARD_NAMES.has(name)) {
      sendJson(res, 400, { success: false, error: `未知词库「${name}」` });
      return;
    }
    if (content === null) {
      sendJson(res, 400, { success: false, error: "缺少 content 字段" });
      return;
    }

    await mkdir(path.dirname(STATE_FILE), { recursive: true });

    const baseRevision = typeof payload.baseRevision === "number" ? payload.baseRevision : null;
    const outcome = await enqueueFileWrite(STATE_FILE, async () => {
      const state = (await readJsonFile<WildcardState>(STATE_FILE)) ?? {};
      const fileRevisions = { ...(state.files ?? {}) };
      const current = typeof fileRevisions[name] === "number" ? fileRevisions[name] : 0;
      if (baseRevision !== null && baseRevision !== current) {
        return { conflict: true as const, currentRevision: current };
      }
      await atomicWriteText(wildcardFile(name), content);
      const nextRevision = current + 1;
      fileRevisions[name] = nextRevision;
      await atomicWriteJson(STATE_FILE, { revision: nextRevision, files: fileRevisions });
      return { conflict: false as const, currentRevision: nextRevision };
    });

    if (outcome.conflict) {
      sendJson(res, 409, {
        success: false,
        error: "词库已在其它窗口被修改，请刷新后重试",
        revision: outcome.currentRevision,
      });
      return;
    }
    sendJson(res, 200, { success: true, revision: outcome.currentRevision });
    return;
  }

  sendJson(res, 404, { success: false, error: "Unknown wildcards endpoint" });
}
