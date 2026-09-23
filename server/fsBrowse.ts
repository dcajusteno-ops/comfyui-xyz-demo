import { readdir } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { sendError, sendJson } from "./utils";

/**
 * 目录浏览（T10-①）：批量打标的「图片目录 / 输出目录」以前要手抄路径，
 * 这个只读接口列出某目录下的一层子目录（不含文件、不读内容），供前端做选择器。
 *
 * 安全边界：只列目录名、只读、不跟随符号链接内容；本项目沿用局域网信任模型
 * （与 mobileSync 的无鉴权决策一致），不做路径白名单——打标目标本来就可能
 * 在磁盘任意位置。
 */

const ROOT = path.resolve(process.cwd());

export function xyzFsBrowsePlugin(): Plugin {
  return {
    name: "xyz-fs-browse",
    configureServer(server) {
      installFsBrowseMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      installFsBrowseMiddleware(server.middlewares);
    },
  };
}

function installFsBrowseMiddleware(middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }) {
  middlewares.use((req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith("/xyz/fs/folders")) {
      next();
      return;
    }
    void handleFsBrowseRequest(req, res, requestUrl).catch((error) => {
      sendError(res, error);
    });
  });
}

async function handleFsBrowseRequest(req: IncomingMessage, res: ServerResponse, requestUrl: URL) {
  if ((req.method ?? "GET").toUpperCase() !== "GET") {
    sendJson(res, 405, { success: false, error: "Method Not Allowed" });
    return;
  }

  const raw = requestUrl.searchParams.get("path") ?? "";
  const target = path.resolve(raw || ROOT);
  try {
    const entries = await readdir(target, { withFileTypes: true });
    const folders = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    sendJson(res, 200, {
      success: true,
      path: target,
      parent: path.dirname(target) !== target ? path.dirname(target) : null,
      folders,
    });
  } catch (error) {
    sendJson(res, 200, {
      success: false,
      path: target,
      error: error instanceof Error ? error.message : String(error),
      folders: [],
    });
  }
}
