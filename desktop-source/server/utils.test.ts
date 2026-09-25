import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { atomicWriteJson, enqueueFileWrite, readJsonBody, readJsonFile, sendError } from "./utils";

/**
 * server/utils.ts 的数据完整性契约。
 * 全部文件操作都在 os.tmpdir() 下的临时目录进行，**不触碰仓库内 data/**。
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "xyz-utils-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("atomicWriteJson / readJsonFile", () => {
  it("写入后可读回，且不留 .tmp 残留", async () => {
    const file = path.join(dir, "state.json");
    await atomicWriteJson(file, { hello: "world", n: 1 });
    const data = await readJsonFile<{ hello: string; n: number }>(file);
    expect(data).toEqual({ hello: "world", n: 1 });
    const entries = await readdir(dir);
    expect(entries.filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("覆盖写入前会把上一版留档到 backups/（带 .bak 后缀）", async () => {
    const file = path.join(dir, "state.json");
    await atomicWriteJson(file, { v: 1 });
    await atomicWriteJson(file, { v: 2 });
    const backupsDir = path.join(dir, "backups");
    const backups = await readdir(backupsDir);
    expect(backups.length).toBe(1);
    expect(backups[0]).toMatch(/^state\.json\..+\.bak$/);
    const backupContent = JSON.parse(await readFile(path.join(backupsDir, backups[0]), "utf-8"));
    expect(backupContent).toEqual({ v: 1 });
    expect(await readJsonFile(file)).toEqual({ v: 2 });
  });

  it("文件不存在时 readJsonFile 返回 null（不抛错）", async () => {
    expect(await readJsonFile(path.join(dir, "missing.json"))).toBeNull();
  });

  it("损坏的 JSON 返回 null", async () => {
    const file = path.join(dir, "broken.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, "{not json", "utf-8");
    expect(await readJsonFile(file)).toBeNull();
  });
});

describe("enqueueFileWrite", () => {
  it("同一文件的写任务按提交顺序串行执行", async () => {
    const file = path.join(dir, "queued.json");
    const order: number[] = [];
    const tasks = [1, 2, 3, 4, 5].map((n) =>
      enqueueFileWrite(file, async () => {
        order.push(n);
        return n;
      }),
    );
    const results = await Promise.all(tasks);
    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(results).toEqual([1, 2, 3, 4, 5]);
  });

  it("某个任务抛错不影响后续任务执行", async () => {
    const file = path.join(dir, "queued2.json");
    await expect(
      enqueueFileWrite(file, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const result = await enqueueFileWrite(file, async () => "after-failure");
    expect(result).toBe("after-failure");
  });
});

describe("readJsonBody", () => {
  const makeReq = (payload: unknown) => {
    const stream = new PassThrough();
    const req = stream as unknown as IncomingMessage;
    queueMicrotask(() => {
      stream.write(typeof payload === "string" ? payload : JSON.stringify(payload));
      stream.end();
    });
    return req;
  };

  it("解析合法 JSON", async () => {
    const body = await readJsonBody(makeReq({ a: 1, b: "x" }));
    expect(body).toEqual({ a: 1, b: "x" });
  });

  it("空请求体解析为空对象", async () => {
    const body = await readJsonBody(makeReq(""));
    expect(body).toEqual({});
  });

  it("非法 JSON 直接拒绝", async () => {
    await expect(readJsonBody(makeReq("{broken"))).rejects.toThrow();
  });

  it("超过上限返回 413（BodyLimitError），不立即断开连接", async () => {
    const big = { data: "x".repeat(3 * 1024 * 1024) };
    let error: unknown;
    try {
      await readJsonBody(makeReq(big));
    } catch (err) {
      error = err;
    }
    expect((error as { name?: string; status?: number }).name).toBe("BodyLimitError");
    expect((error as { status?: number }).status).toBe(413);
  });
});

describe("sendError", () => {
  const makeRes = () => {
    const res = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: "",
      setHeader(key: string, value: string) {
        this.headers[key] = value;
      },
      end(payload?: string) {
        this.body = payload ?? "";
      },
    };
    return res as unknown as ServerResponse & { body: string; headers: Record<string, string> };
  };

  it("默认 500", () => {
    const res = makeRes();
    sendError(res, new Error("oops"));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ success: false, error: "oops" });
  });

  it("尊重错误对象上的 status（如 BodyLimitError 的 413）", () => {
    const res = makeRes();
    const error = Object.assign(new Error("too big"), { status: 413 });
    sendError(res, error);
    expect(res.statusCode).toBe(413);
  });
});
