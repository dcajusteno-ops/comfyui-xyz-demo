import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WALLPAPER_REF_RE, __resetThemeMemoryForTest, handleThemeRequest } from "./theme";

/**
 * server/theme.ts 的契约测试。
 * 全部跑在 DSH_E2E=1 的内存模式下，**不触碰仓库内 data/**（磁盘路径的行为由 Go 侧
 * internal/api/theme_test.go 用临时目录覆盖）。
 */

const ROOT = "/xyz/theme/wallpaper";
const BOUNDARY = "----xyzThemeBoundary";

function multipartBody(parts: { name: string; filename?: string; contentType?: string; data: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const head = [
      `--${BOUNDARY}`,
      `Content-Disposition: form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ""}`,
    ];
    if (part.contentType) head.push(`Content-Type: ${part.contentType}`);
    chunks.push(Buffer.from(`${head.join("\r\n")}\r\n\r\n`, "utf-8"));
    chunks.push(part.data);
    chunks.push(Buffer.from("\r\n", "utf-8"));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`, "utf-8"));
  return Buffer.concat(chunks);
}

type Captured = { status: number; headers: Record<string, string>; json?: Record<string, unknown>; raw?: Buffer };

function fakeRes(): ServerResponse & { captured: Captured } {
  const captured: Captured = { status: 0, headers: {} };
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      captured.headers[name] = value;
    },
    end(payload?: string | Buffer) {
      captured.status = this.statusCode;
      if (Buffer.isBuffer(payload)) {
        captured.raw = payload;
        return;
      }
      if (typeof payload === "string") {
        try {
          captured.json = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          captured.raw = Buffer.from(payload, "utf-8");
        }
      }
    },
    captured,
  };
  return res as unknown as ServerResponse & { captured: Captured };
}

async function call(method: string, path: string, opts: { body?: Buffer; headers?: Record<string, string> } = {}) {
  const stream = new PassThrough();
  const req = stream as unknown as PassThrough & { method: string; url: string; headers: Record<string, string> };
  req.method = method;
  req.url = path;
  req.headers = opts.headers ?? {};
  if (opts.body) stream.write(opts.body);
  stream.end();

  const res = fakeRes();
  await handleThemeRequest(req as unknown as IncomingMessage, res, process.cwd());
  return res.captured;
}

const upload = (data: Buffer, mime = "image/png", filename = "wall.png") =>
  call("POST", ROOT, {
    body: multipartBody([{ name: "image", filename, contentType: mime, data }]),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const expectedRef = (data: Buffer, ext: string) => `${createHash("sha256").update(data).digest("hex")}.${ext}`;

beforeEach(() => {
  vi.stubEnv("DSH_E2E", "1");
  __resetThemeMemoryForTest();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("壁纸上传", () => {
  it("返回 sha256 + 由 MIME 推导的扩展名", async () => {
    const res = await upload(PNG);
    expect(res.status).toBe(200);
    expect(res.json?.success).toBe(true);
    expect(res.json?.ref).toBe(expectedRef(PNG, "png"));
    expect(WALLPAPER_REF_RE.test(String(res.json?.ref))).toBe(true);
  });

  it("扩展名由 MIME 决定，不信任客户端文件名", async () => {
    const res = await upload(PNG, "image/jpeg", "其实是脚本.svg");
    expect(res.json?.ref).toBe(expectedRef(PNG, "jpg"));
  });

  it("同一份内容重复上传得到同一个 ref（内容哈希天然去重）", async () => {
    const a = await upload(PNG);
    const b = await upload(PNG);
    expect(a.json?.ref).toBe(b.json?.ref);
    const list = await call("GET", ROOT);
    expect(list.json?.files).toEqual([a.json?.ref]);
  });

  it("不支持的图片类型 → 415", async () => {
    const res = await upload(PNG, "image/svg+xml");
    expect(res.status).toBe(415);
    expect(String(res.json?.error)).toContain("不支持的图片类型");
  });

  it("非 multipart 请求 → 400", async () => {
    const res = await call("POST", ROOT, { body: Buffer.from("{}"), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(400);
    expect(String(res.json?.error)).toContain("multipart/form-data");
  });

  it("缺少图片字段 → 400", async () => {
    const res = await call("POST", ROOT, {
      body: multipartBody([{ name: "other", data: Buffer.from("x") }]),
      headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    });
    expect(res.status).toBe(400);
    expect(String(res.json?.error)).toContain("缺少图片字段");
  });

  it("空文件 → 413", async () => {
    const res = await upload(Buffer.alloc(0));
    expect(res.status).toBe(413);
  });
});

describe("壁纸读取与删除", () => {
  it("GET /<ref> 返回图片本体与正确的 Content-Type", async () => {
    const ref = String((await upload(PNG, "image/webp")).json?.ref);
    const res = await call("GET", `${ROOT}/${ref}`);
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/webp");
    expect(res.headers["Cache-Control"]).toContain("immutable");
    expect(res.raw?.equals(PNG)).toBe(true);
  });

  it("ref 格式非法 → 400（防路径穿越）", async () => {
    const res = await call("GET", `${ROOT}/..%2F..%2Fetc%2Fpasswd`);
    expect(res.status).toBe(400);
  });

  it("格式合法但不存在 → 404", async () => {
    const res = await call("GET", `${ROOT}/${"a".repeat(64)}.png`);
    expect(res.status).toBe(404);
  });

  it("DELETE 后列表里不再有它", async () => {
    const ref = String((await upload(PNG)).json?.ref);
    const del = await call("DELETE", `${ROOT}/${ref}`);
    expect(del.status).toBe(200);
    const list = await call("GET", ROOT);
    expect(list.json?.files).toEqual([]);
  });

  it("不支持的方法 → 405", async () => {
    expect((await call("PATCH", ROOT)).status).toBe(405);
    expect((await call("PUT", `${ROOT}/${"a".repeat(64)}.png`)).status).toBe(405);
  });

  it("未上传任何壁纸时列表为空数组", async () => {
    const list = await call("GET", ROOT);
    expect(list.status).toBe(200);
    expect(list.json).toEqual({ success: true, files: [] });
  });
});
