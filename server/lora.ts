import { open } from "node:fs/promises";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "./utils";

export function xyzLoraPlugin(): Plugin {
  return {
    name: "xyz-lora",
    configureServer(server) {
      installLoraMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      installLoraMiddleware(server.middlewares);
    },
  };
}

function installLoraMiddleware(middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }) {
  middlewares.use((req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "POST" && requestUrl.pathname === "/xyz/lora/extract-metadata") {
      void handleExtractMetadata(req, res).catch((error) => {
        sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
      });
      return;
    }
    next();
  });
}

async function handleExtractMetadata(req: IncomingMessage, res: ServerResponse) {
  const payload = await readJsonBody(req);
  const filePath = payload.file_path as string;
  if (!filePath) {
    sendJson(res, 400, { success: false, error: "Missing file_path" });
    return;
  }

  try {
    const metadata = await extractSafetensorsMetadata(filePath);
    sendJson(res, 200, { success: true, metadata });
  } catch (error) {
    sendJson(res, 500, { success: false, error: `Failed to extract metadata: ${error instanceof Error ? error.message : String(error)}` });
  }
}

async function extractSafetensorsMetadata(filePath: string) {
  const file = await open(filePath, "r");
  try {
    const headerSizeBuffer = Buffer.alloc(8);
    await file.read(headerSizeBuffer, 0, 8, 0);
    const headerSize = headerSizeBuffer.readBigUInt64LE();
    
    // Safety check: header size shouldn't be suspiciously large
    if (headerSize > 100 * 1024 * 1024) { // 100MB limit for header
        throw new Error("Safetensors header size is too large");
    }

    const headerBuffer = Buffer.alloc(Number(headerSize));
    await file.read(headerBuffer, 0, Number(headerSize), 8);
    
    const header = JSON.parse(headerBuffer.toString("utf8"));
    return header.__metadata__ || {};
  } finally {
    await file.close();
  }
}
