import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { animaDataUrl, getAnimaData, loadAnimaData, resetAnimaCache } from "./store";

const SAMPLE = [{ id: "1", name: "dairi", postCount: 10 }];

function okResponse(data: unknown) {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

beforeEach(() => resetAnimaCache());
afterEach(() => vi.unstubAllGlobals());

describe("词库加载器", () => {
  it("URL 指向 public/data/anima", () => {
    expect(animaDataUrl("artists")).toBe("/data/anima/artists.json");
  });

  it("同一子库并发请求只发一次", async () => {
    const fetchImpl = vi.fn(async () => okResponse(SAMPLE));
    vi.stubGlobal("fetch", fetchImpl);
    const [a, b] = await Promise.all([loadAnimaData("artists"), loadAnimaData("artists")]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a).toEqual(SAMPLE);
    expect(b).toEqual(SAMPLE);
    expect(getAnimaData("artists")).toEqual(SAMPLE);
  });

  it("已缓存时不再请求", async () => {
    const fetchImpl = vi.fn(async () => okResponse(SAMPLE));
    vi.stubGlobal("fetch", fetchImpl);
    await loadAnimaData("artists");
    await loadAnimaData("artists");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("失败后不写缓存，允许重试", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(okResponse(SAMPLE));
    vi.stubGlobal("fetch", fetchImpl);
    await expect(loadAnimaData("artists")).rejects.toThrow(/词库加载失败/);
    expect(getAnimaData("artists")).toBeNull();
    await expect(loadAnimaData("artists")).resolves.toEqual(SAMPLE);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("HTTP 非 200 时带状态码报错", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    await expect(loadAnimaData("clothing")).rejects.toThrow(/HTTP 404/);
  });

  it("reset 后重新请求", async () => {
    const fetchImpl = vi.fn(async () => okResponse(SAMPLE));
    vi.stubGlobal("fetch", fetchImpl);
    await loadAnimaData("artists");
    resetAnimaCache("artists");
    expect(getAnimaData("artists")).toBeNull();
    await loadAnimaData("artists");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
