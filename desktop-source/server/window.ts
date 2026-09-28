import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { readJsonBody, sendError, sendJson } from "./utils";

/**
 * 桌面窗口外观端点（/xyz/window/appearance）—— **浏览器 / dev 模式下的 no-op stub**。
 *
 * 真正的实现只在 Go 侧（internal/api/window.go + internal/winchrome）：那里用 DWM 给 Windows
 * 原生标题栏着色。TS 侧没有桌面窗口，所以这里唯一职责是：
 * 1. 让端点存在、字段形状与 Go 侧一致（parity 对拍才成立）；
 * 2. 让前端的 probeWindowMode() 得到一个明确的 desktop:false，从而跳过窗口皮肤那条分支。
 *
 * 契约（与 Go 侧逐字段对齐）：
 * - GET  → { success, desktop: false, appearance, caps }
 * - POST { dark, captionColor, textColor, borderColor } → { success, desktop: false, caps }
 * - 其它方法 → 405
 *
 * caps 全 false 表示「本环境不支持任何 DWM 属性」，与 Win10 只支持 immersive dark 的情况
 * 在语义上是同一套表达，前端据此隐藏「标题栏跟随主题」开关。
 */

export const WINDOW_APPEARANCE_PATH = "/xyz/window/appearance";

type WindowAppearance = {
  dark: boolean;
  captionColor: string;
  textColor: string;
  borderColor: string;
};

const CAPS_ALL_FALSE = {
  immersiveDark: false,
  captionColor: false,
  textColor: false,
  borderColor: false,
};

const EMPTY_APPEARANCE: WindowAppearance = {
  dark: false,
  captionColor: "",
  textColor: "",
  borderColor: "",
};

/** 记住最近一次提交的外观，让 GET 的返回值与 Go 侧语义一致（Go 会返回 LastApplied） */
let lastAppearance: WindowAppearance = { ...EMPTY_APPEARANCE };

/** 仅供测试：重置模块级状态，用例间隔离 */
export function __resetWindowAppearanceForTest(): void {
  lastAppearance = { ...EMPTY_APPEARANCE };
}

export function xyzWindowPlugin(): Plugin {
  return {
    name: "xyz-window-appearance",
    configureServer(server) {
      installWindowMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      installWindowMiddleware(server.middlewares);
    },
  };
}

function installWindowMiddleware(middlewares: {
  use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
}) {
  middlewares.use((req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (requestUrl.pathname !== WINDOW_APPEARANCE_PATH) {
      next();
      return;
    }
    void handleWindowAppearanceRequest(req, res).catch((error) => {
      sendError(res, error);
    });
  });
}

export async function handleWindowAppearanceRequest(req: IncomingMessage, res: ServerResponse) {
  const method = (req.method ?? "GET").toUpperCase();

  if (method === "GET") {
    sendJson(res, 200, {
      success: true,
      desktop: false,
      appearance: lastAppearance,
      caps: CAPS_ALL_FALSE,
    });
    return;
  }

  if (method === "POST") {
    // 即便只是 stub 也要把请求体读完：否则 keep-alive 连接上残留的字节会污染下一个请求
    const payload = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>);
    lastAppearance = {
      dark: payload.dark === true,
      captionColor: typeof payload.captionColor === "string" ? payload.captionColor : "",
      textColor: typeof payload.textColor === "string" ? payload.textColor : "",
      borderColor: typeof payload.borderColor === "string" ? payload.borderColor : "",
    };
    sendJson(res, 200, { success: true, desktop: false, caps: CAPS_ALL_FALSE });
    return;
  }

  sendJson(res, 405, { success: false, error: "Method Not Allowed" });
}
