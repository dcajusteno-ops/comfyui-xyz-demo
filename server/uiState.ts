import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { atomicWriteJson, enqueueFileWrite, readJsonBody, readJsonFile, sendError, sendJson } from "./utils";

/**
 * 前端持久化状态存储（/api/ui-state）。
 *
 * 背景：桌面端/手机端此前把全部持久化状态（面板参数、预设、主题、翻译设置…）存浏览器
 * localStorage——按「协议+地址+端口」隔离，端口漂移/清浏览器数据即"重置"。现统一迁移到
 * 服务端 data/ui-state.json（与 notes/wildcards 同款：原子写 + 备份 + 写队列）。
 *
 * 契约（Go 侧 internal/api/uistate.go 逐条对齐，勿单边改动）：
 * - GET  → { success, data: { [key]: JSON }, revision }；文件不存在 → { success, data: {}, revision: 0 }
 * - PUT  body { entries: { [key]: JSON | null } } → 逐 key 合并（null = 删除该 key），
 *         revision + 1 原子落盘 → { success, revision }
 * - DELETE → 清空全部 key，revision + 1 → { success, revision }
 * - key 限制：字符串、非空、长度 ≤ 120；entries 内的 null 表示删除；请求体上限沿用 2MB；
 * - DSH_E2E=1（Playwright / verify 脚本）：全内存态，不读写 data/ui-state.json，防测试污染真实数据。
 */

const ROOT = path.resolve(process.cwd());
const UI_STATE_FILE = path.join(ROOT, "data", "ui-state.json");
const KEY_MAX_LENGTH = 120;

type UiStateFile = { revision: number; data: Record<string, unknown> };

/** E2E 模式的内存态（替代文件，测试结束后即丢弃） */
const memoryState: UiStateFile = { revision: 0, data: {} };
const inMemory = () => process.env.DSH_E2E === "1";

/** 仅供测试：内存态模块级共享，用例间用它隔离 */
export function __resetUiStateMemoryForTest() {
  memoryState.data = {};
  memoryState.revision = 0;
}

/** 注意：故意不用类型谓词——调用处的 else 分支（非法 key 提示）仍需把 key 当 string 用 */
export function isValidUiStateKey(key: unknown): boolean {
  return typeof key === "string" && key.length > 0 && key.length <= KEY_MAX_LENGTH;
}

/** 合并 entries 到现有 data（纯函数，测试固化 null=删除 语义） */
export function mergeUiStateEntries(
  data: Record<string, unknown>,
  entries: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...data };
  for (const [key, value] of Object.entries(entries)) {
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function xyzUiStatePlugin(): Plugin {
  return {
    name: "xyz-ui-state",
    configureServer(server) {
      installUiStateMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      installUiStateMiddleware(server.middlewares);
    },
  };
}

function installUiStateMiddleware(middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }) {
  middlewares.use((req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith("/api/ui-state")) {
      next();
      return;
    }
    void handleUiStateRequest(req, res).catch((error) => {
      sendError(res, error);
    });
  });
}

export async function handleUiStateRequest(req: IncomingMessage, res: ServerResponse) {
  const method = (req.method ?? "GET").toUpperCase();

  if (method === "GET") {
    if (inMemory()) {
      sendJson(res, 200, { success: true, data: memoryState.data, revision: memoryState.revision });
      return;
    }
    const existing = await readJsonFile<UiStateFile>(UI_STATE_FILE);
    if (existing && existing.data && typeof existing.data === "object" && !Array.isArray(existing.data)) {
      sendJson(res, 200, { success: true, data: existing.data, revision: existing.revision ?? 0 });
    } else {
      sendJson(res, 200, { success: true, data: {}, revision: 0 });
    }
    return;
  }

  if (method === "PUT") {
    const payload = await readJsonBody(req);
    const entries = payload.entries;
    if (entries === null || typeof entries !== "object" || Array.isArray(entries)) {
      sendJson(res, 400, { success: false, error: "payload.entries must be an object" });
      return;
    }
    const record = entries as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!isValidUiStateKey(key)) {
        sendJson(res, 400, { success: false, error: `invalid ui-state key: ${key.slice(0, 40)}` });
        return;
      }
    }

    if (inMemory()) {
      memoryState.data = mergeUiStateEntries(memoryState.data, record);
      memoryState.revision += 1;
      sendJson(res, 200, { success: true, revision: memoryState.revision });
      return;
    }

    const revision = await enqueueFileWrite(UI_STATE_FILE, async () => {
      const existing = await readJsonFile<UiStateFile>(UI_STATE_FILE);
      const base: UiStateFile =
        existing && existing.data && typeof existing.data === "object" && !Array.isArray(existing.data)
          ? { revision: existing.revision ?? 0, data: existing.data }
          : { revision: 0, data: {} };
      const next: UiStateFile = { revision: base.revision + 1, data: mergeUiStateEntries(base.data, record) };
      await atomicWriteJson(UI_STATE_FILE, next);
      return next.revision;
    });
    sendJson(res, 200, { success: true, revision });
    return;
  }

  if (method === "DELETE") {
    if (inMemory()) {
      memoryState.data = {};
      memoryState.revision += 1;
      sendJson(res, 200, { success: true, revision: memoryState.revision });
      return;
    }
    const revision = await enqueueFileWrite(UI_STATE_FILE, async () => {
      const existing = await readJsonFile<UiStateFile>(UI_STATE_FILE);
      const prevRevision = existing?.revision ?? 0;
      await atomicWriteJson(UI_STATE_FILE, { revision: prevRevision + 1, data: {} });
      return prevRevision + 1;
    });
    sendJson(res, 200, { success: true, revision });
    return;
  }

  sendJson(res, 405, { success: false, error: "Method Not Allowed" });
}
