import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleUiStateRequest, isValidUiStateKey, mergeUiStateEntries, __resetUiStateMemoryForTest } from "./uiState";

/**
 * server/uiState.ts 的契约测试。
 * HTTP 层全部跑在 DSH_E2E=1 的内存模式下，**不触碰仓库内 data/**（文件模式与
 * notes/launcher 同款原子写 + 写队列，行为由 Go 侧 uistate_test.go 以临时目录覆盖）。
 */

function fakeReq(method: string, body?: unknown): IncomingMessage {
  const req = new PassThrough();
  (req as unknown as { method: string }).method = method;
  if (body !== undefined) req.end(JSON.stringify(body));
  else req.end();
  return req as unknown as IncomingMessage;
}

type CapturedResponse = { status: number; body: Record<string, unknown> };

function fakeRes(): ServerResponse & { captured: CapturedResponse } {
  const captured: CapturedResponse = { status: 0, body: {} };
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(payload?: string) {
      captured.status = this.statusCode;
      captured.body = payload ? (JSON.parse(payload) as Record<string, unknown>) : {};
    },
    captured,
  };
  return res as unknown as ServerResponse & { captured: CapturedResponse };
}

async function call(method: string, body?: unknown) {
  const res = fakeRes();
  await handleUiStateRequest(fakeReq(method, body), res);
  return res.captured;
}

beforeEach(() => {
  vi.stubEnv("DSH_E2E", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  // 内存态模块级共享：每个用例后清空，避免互相污染
  __resetUiStateMemoryForTest();
});

describe("isValidUiStateKey", () => {
  it("非空字符串且 ≤120 字符才合法", () => {
    expect(isValidUiStateKey("comfyui_default_params")).toBe(true);
    expect(isValidUiStateKey("")).toBe(false);
    expect(isValidUiStateKey("x".repeat(121))).toBe(false);
    expect(isValidUiStateKey("x".repeat(120))).toBe(true);
    expect(isValidUiStateKey(42)).toBe(false);
    expect(isValidUiStateKey(null)).toBe(false);
  });
});

describe("mergeUiStateEntries", () => {
  it("逐 key 覆盖合并", () => {
    expect(mergeUiStateEntries({ a: 1, b: { x: 1 } }, { b: { x: 2 }, c: true })).toEqual({
      a: 1,
      b: { x: 2 },
      c: true,
    });
  });

  it("null 表示删除该 key（前端协议：持久化值永不为 null）", () => {
    expect(mergeUiStateEntries({ a: 1, b: 2 }, { a: null })).toEqual({ b: 2 });
  });
});

describe("HTTP 契约（DSH_E2E 内存模式）", () => {
  it("GET 空状态 → data:{} revision:0", async () => {
    const res = await call("GET");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: {}, revision: 0 });
  });

  it("PUT 合并 entries 并递增 revision；GET 读回", async () => {
    const put = await call("PUT", { entries: { theme: "dark", params: { steps: 20 } } });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ success: true, revision: 1 });

    const get = await call("GET");
    expect(get.body.data).toEqual({ theme: "dark", params: { steps: 20 } });

    const put2 = await call("PUT", { entries: { theme: null, params: { steps: 30 } } });
    expect(put2.body).toEqual({ success: true, revision: 2 });

    const get2 = await call("GET");
    expect(get2.body.data).toEqual({ params: { steps: 30 } });
  });

  it("DELETE 清空全部 key", async () => {
    await call("PUT", { entries: { a: 1, b: 2 } });
    const del = await call("DELETE");
    expect(del.status).toBe(200);
    const get = await call("GET");
    expect(get.body.data).toEqual({});
    expect((get.body.revision as number)).toBeGreaterThan(1);
  });

  it("entries 缺失或非对象 → 400", async () => {
    expect((await call("PUT", {})).status).toBe(400);
    expect((await call("PUT", { entries: [1] })).status).toBe(400);
    expect((await call("PUT", { entries: null })).status).toBe(400);
  });

  it("非法 key（空串/超长）→ 400", async () => {
    expect((await call("PUT", { entries: { "": 1 } })).status).toBe(400);
    expect((await call("PUT", { entries: { [ "x".repeat(121) ]: 1 } })).status).toBe(400);
  });

  it("不支持的方法 → 405", async () => {
    expect((await call("POST", { entries: {} })).status).toBe(405);
  });
});
