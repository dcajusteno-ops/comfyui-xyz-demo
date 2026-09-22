import { open } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendError, sendJson } from "./utils";

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
        sendError(res, error);
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
  if (!isAllowedSafetensorsPath(filePath)) {
    sendJson(res, 403, { success: false, error: "file_path is not an allowed .safetensors path" });
    return;
  }

  try {
    const metadata = await extractSafetensorsMetadata(filePath);
    sendJson(res, 200, { success: true, metadata });
  } catch (error) {
    sendJson(res, 500, { success: false, error: `Failed to extract metadata: ${error instanceof Error ? error.message : String(error)}` });
  }
}

/**
 * 路径白名单：只允许读取 .safetensors 文件的头部元数据。
 * - 硬约束：解析后的扩展名必须是 .safetensors（非 safetensors 文件解析结果恒为空/报错，杜绝任意文件读取）；
 * - 可选约束：设置环境变量 XYZ_LORA_ALLOWED_ROOTS（Windows 分号、其余冒号分隔）后，
 *   进一步要求路径必须落在这些根目录（通常是 ComfyUI models 目录）内。
 */
function isAllowedSafetensorsPath(filePath: string): boolean {
  if (!filePath || filePath.includes("\0")) return false;
  const resolved = path.resolve(filePath);
  if (path.extname(resolved).toLowerCase() !== ".safetensors") return false;

  const roots = (process.env.XYZ_LORA_ALLOWED_ROOTS ?? "")
    .split(process.platform === "win32" ? ";" : ":")
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => path.resolve(root));
  if (!roots.length) return true;

  return roots.some((root) => {
    const rel = path.relative(root, resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
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
