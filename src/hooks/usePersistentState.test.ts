import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePersistentState } from "./usePersistentState";
import { bootUiState, isServerBacked, __resetForTest } from "../lib/uiStateStore";

/**
 * usePersistentState / uiStateStore 的存储后端切换契约。
 *
 * jsdom 无本地服务：
 * - 未 boot（pending）→ hook 走 localStorage 兜底（旧 useLocalStorageState 语义，现有测试全部依赖它）；
 * - boot 成功（stub fetch）→ ready，hook 读写服务端镜像，变更进防抖 PUT；
 * - boot 失败 → offline，回退 localStorage。
 */

describe("usePersistentState（未 boot：localStorage 兜底语义）", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTest();
  });

  it("无存储值时返回 defaultValue", () => {
    const { result } = renderHook(() => usePersistentState("comfyui_test_key", { steps: 20 }));
    expect(result.current[0]).toEqual({ steps: 20 });
  });

  it("读回 localStorage 已有值并 deepMerge 只补新键", () => {
    localStorage.setItem("comfyui_test_key", JSON.stringify({ steps: 30 }));
    const { result } = renderHook(() => usePersistentState("comfyui_test_key", { steps: 20, cfg: 7 }));
    expect(result.current[0]).toEqual({ steps: 30, cfg: 7 });
  });

  it("set 后写入 localStorage", () => {
    const { result } = renderHook(() => usePersistentState<string>("comfyui_test_key", "a"));
    act(() => result.current[1]("b"));
    expect(JSON.parse(localStorage.getItem("comfyui_test_key") ?? "null")).toBe("b");
  });

  it("isServerBacked 为 false", () => {
    expect(isServerBacked()).toBe(false);
  });
});

describe("bootUiState + ready 路径", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubFetchOnce(payload: unknown) {
    return vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/api/ui-state")) {
          return new Response(JSON.stringify(payload), { status: 200 });
        }
        throw new Error(`unexpected fetch ${url}`);
      });
  }

  it("boot 成功后 isServerBacked=true，hook 读取服务端值", async () => {
    const fetchSpy = stubFetchOnce({ success: true, data: { comfyui_test_key: { steps: 42 } }, revision: 3 });
    await bootUiState();
    expect(fetchSpy).toHaveBeenCalled();
    expect(isServerBacked()).toBe(true);

    const { result } = renderHook(() => usePersistentState("comfyui_test_key", { steps: 20 }));
    expect(result.current[0]).toEqual({ steps: 42 });
  });

  it("服务端为空时迁移 localStorage 全部 comfyui_*/xyz_* 键（PUT 上去）", async () => {
    localStorage.setItem("comfyui_default_params", JSON.stringify({ steps: 25 }));
    localStorage.setItem("xyz_legacy", JSON.stringify({ keep: true }));
    localStorage.setItem("unrelated", JSON.stringify({ skip: true }));

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/ui-state") && (init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ success: true, data: {}, revision: 0 }), { status: 200 });
      }
      if (url.includes("/api/ui-state") && init?.method === "PUT") {
        (globalThis as { __migrated?: unknown }).__migrated = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ success: true, revision: 1 }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await bootUiState();
    expect(isServerBacked()).toBe(true);

    const entries = (globalThis as { __migrated?: { entries: Record<string, unknown> } }).__migrated?.entries;
    expect(entries).toBeDefined();
    expect(entries!["comfyui_default_params"]).toEqual({ steps: 25 });
    expect(entries!["xyz_legacy"]).toEqual({ keep: true });
    expect(entries!["unrelated"]).toBeUndefined();
    void fetchSpy;
  });

  it("ready 下 set 走防抖 PUT（不写 localStorage）", async () => {
    vi.useFakeTimers();
    try {
      stubFetchOnce({ success: true, data: {}, revision: 0 });
      await bootUiState();

      const { result } = renderHook(() => usePersistentState<string>("comfyui_test_key", "a"));
      const putSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
      // 同一全局 fetch 的 spy 会共享调用记录：清掉 boot GET 的计数，只看本用例的 PUT
      putSpy.mockClear();

      act(() => result.current[1]("b"));
      // 未到防抖时间：不发请求，也不写 localStorage
      expect(putSpy).not.toHaveBeenCalled();
      expect(localStorage.getItem("comfyui_test_key")).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(850);
      });
      expect(putSpy).toHaveBeenCalledTimes(1);
      const [, init] = putSpy.mock.calls[0];
      expect((init as RequestInit).method).toBe("PUT");
      expect(JSON.parse(String((init as RequestInit).body)).entries).toEqual({ comfyui_test_key: "b" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("boot 失败 → offline，hook 回退 localStorage", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await bootUiState();
    expect(isServerBacked()).toBe(false);

    const { result } = renderHook(() => usePersistentState<string>("comfyui_test_key", "a"));
    act(() => result.current[1]("b"));
    expect(JSON.parse(localStorage.getItem("comfyui_test_key") ?? "null")).toBe("b");
  });

  it("重挂载后从服务端镜像读回同一值（防抖保存已进内存 store）", async () => {
    stubFetchOnce({ success: true, data: {}, revision: 0 });
    await bootUiState();

    const first = renderHook(() => usePersistentState<string>("comfyui_test_key", "a"));
    act(() => first.result.current[1]("b"));
    first.unmount();

    const second = renderHook(() => usePersistentState<string>("comfyui_test_key", "a"));
    await waitFor(() => expect(second.result.current[0]).toBe("b"));
  });
});
