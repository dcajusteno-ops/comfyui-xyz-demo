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
const NOTES_FILE = path.resolve(DATA_DIR, "notes.json");

type NotesStore = { revision?: number; notes?: unknown[] };

export function xyzNotesPlugin(): Plugin {
  return {
    name: "xyz-notes",
    configureServer(server) {
      installNotesMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      installNotesMiddleware(server.middlewares);
    },
  };
}

function installNotesMiddleware(middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }) {
  middlewares.use((req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith("/api/notes")) {
      next();
      return;
    }

    void handleNotesRequest(req, res).catch((error) => {
      sendError(res, error);
    });
  });
}

async function handleNotesRequest(req: IncomingMessage, res: ServerResponse) {
  const method = (req.method ?? "GET").toUpperCase();

  if (method === "GET") {
    const existing = await readJsonFile<NotesStore>(NOTES_FILE);
    if (existing) {
      sendJson(res, 200, { success: true, data: existing });
    } else {
      sendJson(res, 200, { success: true, data: { revision: 0, notes: [] } });
    }
    return;
  }

  if (method === "POST") {
    const payload = await readJsonBody(req);
    if (!Array.isArray(payload.notes)) {
      sendJson(res, 400, { success: false, error: "payload.notes must be an array" });
      return;
    }
    const incomingNotes = payload.notes;
    // baseRevision 缺省时保持旧的 last-writer-wins 行为（向后兼容）；携带时做乐观并发检测
    const baseRevision = typeof payload.baseRevision === "number" ? payload.baseRevision : null;
    await mkdir(DATA_DIR, { recursive: true });

    const outcome = await enqueueFileWrite(NOTES_FILE, async () => {
      const existing = await readJsonFile<NotesStore>(NOTES_FILE);
      const currentRevision = typeof existing?.revision === "number" ? existing.revision : 0;
      if (baseRevision !== null && baseRevision !== currentRevision) {
        return { conflict: true as const, currentRevision, data: existing };
      }
      const next = { revision: currentRevision + 1, notes: incomingNotes };
      await atomicWriteJson(NOTES_FILE, next);
      return { conflict: false as const, currentRevision: currentRevision + 1 };
    });

    if (outcome.conflict) {
      sendJson(res, 409, {
        success: false,
        error: "Notes were modified in another window",
        revision: outcome.currentRevision,
        data: outcome.data,
      });
      return;
    }
    sendJson(res, 200, { success: true, revision: outcome.currentRevision });
    return;
  }

  sendJson(res, 404, { success: false, error: "Unknown notes endpoint" });
}
