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

const DATA_DIR = path.resolve(process.cwd(), "data");
const PROMPTS_FILE = path.resolve(DATA_DIR, "prompts_state.json");

type PromptsStore = {
  revision?: number;
  favorites?: unknown[];
  recents?: unknown[];
  customEntries?: unknown[];
  templates?: unknown[];
};

const defaultState: Required<Omit<PromptsStore, "revision">> = {
  favorites: [],
  recents: [],
  customEntries: [],
  templates: [],
};

export function xyzPromptsPlugin(): Plugin {
  return {
    name: "xyz-prompts",
    configureServer(server) {
      installPromptsMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      installPromptsMiddleware(server.middlewares);
    },
  };
}

function installPromptsMiddleware(middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }) {
  middlewares.use((req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith("/api/prompts")) {
      next();
      return;
    }

    void handlePromptsRequest(req, res).catch((error) => {
      sendError(res, error);
    });
  });
}

async function handlePromptsRequest(req: IncomingMessage, res: ServerResponse) {
  const method = (req.method ?? "GET").toUpperCase();

  if (method === "GET") {
    const existing = await readJsonFile<PromptsStore>(PROMPTS_FILE);
    if (existing) {
      sendJson(res, 200, { success: true, data: existing });
    } else {
      sendJson(res, 200, { success: true, data: { revision: 0, ...defaultState } });
    }
    return;
  }

  if (method === "POST") {
    const payload = await readJsonBody(req);
    // baseRevision 缺省时保持旧的 last-writer-wins 行为（向后兼容）；携带时做乐观并发检测
    const baseRevision = typeof payload.baseRevision === "number" ? payload.baseRevision : null;
    await mkdir(DATA_DIR, { recursive: true });

    const outcome = await enqueueFileWrite(PROMPTS_FILE, async () => {
      const existing = await readJsonFile<PromptsStore>(PROMPTS_FILE);
      const currentRevision = typeof existing?.revision === "number" ? existing.revision : 0;
      if (baseRevision !== null && baseRevision !== currentRevision) {
        return { conflict: true as const, currentRevision, data: existing };
      }
      // 逐字段校验后整体落盘（沿用原有 schema 校验），并递增 revision
      const next: PromptsStore = { ...defaultState, revision: currentRevision + 1 };
      if (Array.isArray(payload.favorites)) next.favorites = payload.favorites;
      if (Array.isArray(payload.recents)) next.recents = payload.recents;
      if (Array.isArray(payload.customEntries)) next.customEntries = payload.customEntries;
      if (Array.isArray(payload.templates)) next.templates = payload.templates;
      await atomicWriteJson(PROMPTS_FILE, next);
      return { conflict: false as const, currentRevision: currentRevision + 1 };
    });

    if (outcome.conflict) {
      sendJson(res, 409, {
        success: false,
        error: "Prompts state was modified in another window",
        revision: outcome.currentRevision,
        data: outcome.data,
      });
      return;
    }
    sendJson(res, 200, { success: true, revision: outcome.currentRevision });
    return;
  }

  sendJson(res, 404, { success: false, error: "Unknown prompts endpoint" });
}
