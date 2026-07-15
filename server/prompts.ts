import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const DATA_DIR = path.resolve(process.cwd(), "data");
const PROMPTS_FILE = path.resolve(DATA_DIR, "prompts_state.json");

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

    void handlePromptsRequest(req, res, requestUrl).catch((error) => {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    });
  });
}

const defaultState = {
  favorites: [],
  recents: [],
  customEntries: [],
  templates: []
};

async function handlePromptsRequest(req: IncomingMessage, res: ServerResponse, requestUrl: URL) {
  const method = (req.method ?? "GET").toUpperCase();

  if (method === "GET") {
    try {
      const content = await readFile(PROMPTS_FILE, "utf-8");
      sendJson(res, 200, { success: true, data: JSON.parse(content) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        sendJson(res, 200, { success: true, data: defaultState });
      } else {
        throw error;
      }
    }
    return;
  }

  if (method === "POST") {
    const payload = await readJsonBody(req);
    await mkdir(DATA_DIR, { recursive: true });
    
    // Validate schema generally
    const data = { ...defaultState };
    if (Array.isArray(payload.favorites)) data.favorites = payload.favorites;
    if (Array.isArray(payload.recents)) data.recents = payload.recents;
    if (Array.isArray(payload.customEntries)) data.customEntries = payload.customEntries;
    if (Array.isArray(payload.templates)) data.templates = payload.templates;
    
    await writeFile(PROMPTS_FILE, JSON.stringify(data, null, 2), "utf-8");
    sendJson(res, 200, { success: true });
    return;
  }

  sendJson(res, 404, { success: false, error: "Unknown prompts endpoint" });
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
