/**
 * Danbooru 图片同源代理（TS 版，SSOT）。
 *
 * 为什么必须代理：cdn.donmai.us 对浏览器发来的 `Sec-Fetch-Site: cross-site`
 * 直接回 403（Cloudflare 热链保护），返回的又是 CORP: same-origin 的 HTML，
 * 浏览器最终报 `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`。服务端请求不带这些头，
 * 可以正常拿到图片。仅放行 donmai.us 域，避免变成任意 URL 的 SSRF 跳板。
 *
 * Go 侧移植见 `internal/api/anima_image.go`；响应头/状态码/错误文案逐字段对齐。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { sendError, sendJson } from "./utils";

export const ANIMA_IMAGE_ROUTE = "/xyz/anima/image";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
/**
 * Cloudflare 对 UA 很敏感：Mozilla / 自定义 UA 从 Node 直连会被 403，
 * 插件同款 UA（curl 类客户端）实测 200。Accept 用通配符最稳。
 */
export const DANBOORU_IMAGE_USER_AGENT =
  "Anima-Tools-Danbooru/1.0 (+https://github.com/nregret/Comfyui-Anima-Tools)";

/** 只允许 Danbooru 自家的图片域（含子域），其它 host / 协议一律拒绝 */
export function isAllowedAnimaImageUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(String(raw ?? ""));
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return host === "donmai.us" || host.endsWith(".donmai.us");
}

export function xyzAnimaImagePlugin(): Plugin {
  return {
    name: "xyz-anima-image",
    configureServer(server) {
      installAnimaImageMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      installAnimaImageMiddleware(server.middlewares);
    },
  };
}

type Middlewares = {
  use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
};

function installAnimaImageMiddleware(middlewares: Middlewares) {
  middlewares.use((req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith(ANIMA_IMAGE_ROUTE)) {
      next();
      return;
    }
    void handleAnimaImageRequest(req, res, requestUrl).catch((error) => {
      sendError(res, error, 502);
    });
  });
}

async function handleAnimaImageRequest(req: IncomingMessage, res: ServerResponse, requestUrl: URL) {
  if ((req.method ?? "GET").toUpperCase() !== "GET") {
    sendJson(res, 405, { success: false, error: "Method Not Allowed" });
    return;
  }

  const target = requestUrl.searchParams.get("url") ?? "";
  if (!isAllowedAnimaImageUrl(target)) {
    sendJson(res, 400, { success: false, error: "url must be an https image URL on donmai.us" });
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          // 不带 Sec-Fetch-*：那是浏览器才会发、且会触发 CDN 热链拦截的头
          "User-Agent": DANBOORU_IMAGE_USER_AGENT,
          Accept: "image/*,*/*;q=0.8",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) {
      sendJson(res, 502, { success: false, error: `Danbooru image HTTP ${upstream.status}` });
      return;
    }
    // 重定向后的最终地址也必须在白名单内，防止 30x 跳出
    if (!isAllowedAnimaImageUrl(upstream.url)) {
      sendJson(res, 502, { success: false, error: "redirected to a non-donmai host" });
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      sendJson(res, 502, { success: false, error: "upstream did not return an image" });
      return;
    }
    const declared = Number(upstream.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      sendJson(res, 502, { success: false, error: "image exceeds 20MB" });
      return;
    }

    const data = Buffer.from(await upstream.arrayBuffer());
    if (data.length > MAX_IMAGE_BYTES) {
      sendJson(res, 502, { success: false, error: "image exceeds 20MB" });
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(data.length));
    // URL 里带 md5 文件 key，内容不可变；浏览器缓存一天足够
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(data);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      sendJson(res, 504, { success: false, error: "Danbooru image timeout" });
      return;
    }
    sendJson(res, 502, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
