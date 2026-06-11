import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { randomUUID } from "node:crypto";

const DATA_DIR = path.resolve(process.cwd(), "data");
const NOTES_FILE = path.resolve(DATA_DIR, "notes.json");

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

    void handleNotesRequest(req, res, requestUrl).catch((error) => {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    });
  });
}

async function handleNotesRequest(req: IncomingMessage, res: ServerResponse, requestUrl: URL) {
  const method = (req.method ?? "GET").toUpperCase();

  if (method === "GET") {
    try {
      const content = await readFile(NOTES_FILE, "utf-8");
      sendJson(res, 200, { success: true, data: JSON.parse(content) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        sendJson(res, 200, { success: true, data: { notes: [] } });
      } else {
        throw error;
      }
    }
    return;
  }

  if (method === "POST") {
    const payload = await readJsonBody(req);
    await mkdir(DATA_DIR, { recursive: true });
    
    // Read existing to merge or replace
    let data = { notes: [] };
    if (payload.notes && Array.isArray(payload.notes)) {
      data.notes = payload.notes;
    }
    
    await writeFile(NOTES_FILE, JSON.stringify(data, null, 2), "utf-8");
    sendJson(res, 200, { success: true });
    return;
  }

  sendJson(res, 404, { success: false, error: "Unknown notes endpoint" });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
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
