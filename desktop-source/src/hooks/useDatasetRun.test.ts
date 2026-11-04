import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDatasetRun, normalizeDatasetRun } from "./useDatasetRun";
import type { ComfyClient } from "../lib/comfyClient";
import { makeDatasetParams } from "../lib/paramBuilders";
import { buildDatasetPlan } from "../lib/dataset/plan";
import { buildDatasetSignature } from "../lib/dataset/signature";
import type { ComfyPrompt, DatasetConfig, DatasetItem, DatasetRunState, JobResult, OutputImage } from "../types";

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

const makeImage = (filename: string, type = "output"): OutputImage => ({
  filename,
  type,
  url: `/comfy/api/view?filename=${filename}&type=${type}`,
});

const makeJob = (promptId = "job-1", images: OutputImage[] = [makeImage("001.png")]): JobResult => ({
  promptId,
  images,
  texts: [],
  rawHistory: {},
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeClient() {
  const runPrompt = vi.fn(
    async (
      _prompt: ComfyPrompt,
      _onProgress: unknown,
      opts?: { onSubmitted?: (id: string) => void; signal?: AbortSignal },
    ) => {
      opts?.onSubmitted?.("pid-1");
      return makeJob("pid-1");
    },
  );
  const interrupt = vi.fn().mockResolvedValue(undefined);
  const fetchJobResult = vi.fn().mockResolvedValue(null);
  const client = { runPrompt, interrupt, fetchJobResult } as unknown as ComfyClient;
  return { client, runPrompt, interrupt, fetchJobResult };
}

const config: DatasetConfig = { ...makeDatasetParams(), targetCount: 4, planSeed: 999 };

function plan(count = 4): DatasetItem[] {
  // buildDatasetPlan 最少 4 条，这里按需截断，便于写小规模用例
  return buildDatasetPlan({ ...config, targetCount: Math.max(4, count) }).slice(0, count);
}

/** 把计划写进 hook（replacePlan 走 state，必须单独一次 act 再 start） */
function seed(
  view: { result: { current: { replacePlan: (config: DatasetConfig, items: DatasetItem[]) => void } } },
  items: DatasetItem[],
) {
  act(() => {
    view.result.current.replacePlan(config, items);
  });
}

beforeEach(() => {
  localStorage.clear();
});

/* ------------------------------------------------------------------ *
 * 状态归一
 * ------------------------------------------------------------------ */

describe("normalizeDatasetRun", () => {
  it("首次挂载返回空计划", () => {
    const next = normalizeDatasetRun({} as DatasetRunState, undefined);
    expect(next.items).toEqual([]);
    expect(next.signature).toBe("");
  });

  it("把 running 归一为 interrupted，并重建缺失字段", () => {
    const raw = {
      version: 1,
      mode: "sdxl",
      planSeed: 7,
      createdAt: 1,
      signature: "abcd1234",
      items: [{ id: "a", index: 1, status: "running", seed: 5 }],
    };
    const next = normalizeDatasetRun(raw as unknown as DatasetRunState, raw);
    expect(next.mode).toBe("sdxl");
    expect(next.signature).toBe("abcd1234");
    expect(next.items[0].status).toBe("interrupted");
    expect(next.items[0].files).toEqual([]);
    expect(next.items[0].prompt).toBe("");
  });

  it("旧存档没有签名时置空（界面据此不做过期提示）", () => {
    const raw = { version: 1, items: [] };
    expect(normalizeDatasetRun(raw as unknown as DatasetRunState, raw).signature).toBe("");
  });

  it("未知状态回落到 queued", () => {
    const raw = { version: 1, items: [{ id: "a", status: "weird" }] };
    expect(normalizeDatasetRun(raw as unknown as DatasetRunState, raw).items[0].status).toBe("queued");
  });
});

/* ------------------------------------------------------------------ *
 * 队列
 * ------------------------------------------------------------------ */

describe("useDatasetRun", () => {
  it("replacePlan 记录配置签名（供「计划过期」判定）", () => {
    const { client } = makeClient();
    const view = renderHook(() =>
      useDatasetRun({ client, pushToast: vi.fn(), setGlobalProgress: vi.fn(), setActiveTaskLabel: vi.fn() }),
    );
    seed(view, plan(2));
    expect(view.result.current.run.signature).toBe(buildDatasetSignature(config));
    expect(view.result.current.run.signature).toMatch(/^[0-9a-f]{8}$/);
  });

  it("没有计划时可用外部传入的计划直接开跑（开跑按钮自动排计划）", async () => {
    const { client, runPrompt } = makeClient();
    const view = renderHook(() =>
      useDatasetRun({ client, pushToast: vi.fn(), setGlobalProgress: vi.fn(), setActiveTaskLabel: vi.fn() }),
    );
    // 不 seed：模拟「首次进来还没点重新规划」
    const items = plan(2);
    expect(view.result.current.items).toHaveLength(0);

    await act(async () => {
      await view.result.current.start("pending", config, undefined, undefined, items);
    });

    expect(runPrompt).toHaveBeenCalledTimes(2);
  });

  it("开启 .txt 保存时，每张图出来后再提交一个写文件任务", async () => {
    const { client, runPrompt } = makeClient();
    const view = renderHook(() =>
      useDatasetRun({ client, pushToast: vi.fn(), setGlobalProgress: vi.fn(), setActiveTaskLabel: vi.fn() }),
    );
    seed(view, plan(1));

    await act(async () => {
      await view.result.current.start("pending", config, { saveText: true });
    });

    expect(runPrompt).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(runPrompt.mock.calls[1][0])).toContain("> Save Text");
  });

  it("未开启 .txt 保存时不额外提交", async () => {
    const { client, runPrompt } = makeClient();
    const view = renderHook(() =>
      useDatasetRun({ client, pushToast: vi.fn(), setGlobalProgress: vi.fn(), setActiveTaskLabel: vi.fn() }),
    );
    seed(view, plan(1));

    await act(async () => {
      await view.result.current.start("pending", config, { saveText: false });
    });

    expect(runPrompt).toHaveBeenCalledTimes(1);
  });

  it("严格串行：第一条未完成时不会提交第二条", async () => {
    const { client, runPrompt } = makeClient();
    const first = deferred<JobResult>();
    runPrompt.mockImplementationOnce(async () => first.promise);
    runPrompt.mockImplementation(async () => makeJob("pid-2"));

    const view = renderHook(() =>
      useDatasetRun({
        client,
        pushToast: vi.fn(),
        setGlobalProgress: vi.fn(),
        setActiveTaskLabel: vi.fn(),
      }),
    );
    seed(view, plan(2));

    let started!: Promise<void>;
    act(() => {
      started = view.result.current.start("pending", config);
    });
    await Promise.resolve();
    expect(runPrompt).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(makeJob("pid-1"));
      await started;
    });
    expect(runPrompt).toHaveBeenCalledTimes(2);
  });

  it("单条失败不中断后续，最终成功/失败计数正确", async () => {
    const { client, runPrompt } = makeClient();
    runPrompt.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(makeJob("pid-2"));
    const view = renderHook(() =>
      useDatasetRun({ client, pushToast: vi.fn(), setGlobalProgress: vi.fn(), setActiveTaskLabel: vi.fn() }),
    );
    seed(view, plan(3));

    await act(async () => {
      await view.result.current.start("pending", config);
    });

    expect(runPrompt).toHaveBeenCalledTimes(3);
    const statuses = view.result.current.items.map((item) => item.status);
    expect(statuses).toEqual(["failed", "success", "success"]);
    expect(view.result.current.items[0].error).toBe("boom");
  });

  it("输出图为空视为失败（避免 caption 有图却没有）", async () => {
    const { client, runPrompt } = makeClient();
    runPrompt.mockResolvedValue(makeJob("pid-1", []));
    const view = renderHook(() =>
      useDatasetRun({ client, pushToast: vi.fn(), setGlobalProgress: vi.fn(), setActiveTaskLabel: vi.fn() }),
    );
    seed(view, plan(1));

    await act(async () => {
      await view.result.current.start("pending", config);
    });
    expect(view.result.current.items[0].status).toBe("failed");
    expect(view.result.current.items[0].error).toContain("未返回输出图");
  });

  it("temp 类型的预览图不计入训练图", async () => {
    const { client, runPrompt } = makeClient();
    runPrompt.mockResolvedValue(makeJob("pid-1", [makeImage("temp.png", "temp")]));
    const view = renderHook(() =>
      useDatasetRun({ client, pushToast: vi.fn(), setGlobalProgress: vi.fn(), setActiveTaskLabel: vi.fn() }),
    );
    seed(view, plan(1));
    await act(async () => {
      await view.result.current.start("pending", config);
    });
    expect(view.result.current.items[0].status).toBe("failed");
  });

  it("停止后不再提交后续条目，并把当前条标为 cancelled", async () => {
    const { client, runPrompt, interrupt } = makeClient();
    runPrompt.mockImplementation(
      (_prompt: ComfyPrompt, _onProgress: unknown, opts?: { signal?: AbortSignal }) =>
        new Promise<JobResult>((_resolve, reject) => {
          opts?.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("已取消");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        }),
    );
    const view = renderHook(() =>
      useDatasetRun({ client, pushToast: vi.fn(), setGlobalProgress: vi.fn(), setActiveTaskLabel: vi.fn() }),
    );
    seed(view, plan(5));

    act(() => {
      void view.result.current.start("pending", config);
    });
    await Promise.resolve();
    expect(runPrompt).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(interrupt).toHaveBeenCalled();
    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(view.result.current.running).toBe(false);
    expect(view.result.current.items[0].status).toBe("cancelled");
    expect(view.result.current.items[1].status).toBe("queued");
  });

  it("pending 跳过已成功条目；retryFailed 只跑失败条目", async () => {
    const { client, runPrompt } = makeClient();
    const items = plan(3).map((item, index) => ({
      ...item,
      status: index === 0 ? ("success" as const) : index === 1 ? ("failed" as const) : ("queued" as const),
    }));
    const view = renderHook(() =>
      useDatasetRun({ client, pushToast: vi.fn(), setGlobalProgress: vi.fn(), setActiveTaskLabel: vi.fn() }),
    );
    seed(view, items);

    await act(async () => {
      await view.result.current.retryFailed(config);
    });
    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(view.result.current.items[0].status).toBe("success");

    await act(async () => {
      await view.result.current.start("pending", config);
    });
    // 只剩第 3 条是 queued
    expect(runPrompt).toHaveBeenCalledTimes(2);
    expect(view.result.current.items[2].status).toBe("success");
  });

  it("重跑单条只影响该条", async () => {
    const { client, runPrompt } = makeClient();
    const items = plan(3).map((item, index) => ({
      ...item,
      status: index === 0 ? ("failed" as const) : ("success" as const),
      error: index === 0 ? "x" : undefined,
    }));
    const view = renderHook(() =>
      useDatasetRun({ client, pushToast: vi.fn(), setGlobalProgress: vi.fn(), setActiveTaskLabel: vi.fn() }),
    );
    seed(view, items);

    await act(async () => {
      await view.result.current.rerunOne(items[0].id, config);
    });
    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(view.result.current.items[0].status).toBe("success");
    expect(view.result.current.items[1].status).toBe("success");
  });

  it("进度批次带「数据集」徽章且 current 递增到 total", async () => {
    const { client } = makeClient();
    const setGlobalProgress = vi.fn();
    const view = renderHook(() =>
      useDatasetRun({ client, pushToast: vi.fn(), setGlobalProgress, setActiveTaskLabel: vi.fn() }),
    );
    seed(view, plan(2));

    await act(async () => {
      await view.result.current.start("pending", config);
    });

    const batches = setGlobalProgress.mock.calls
      .map((call) => call[0])
      .filter((value) => typeof value !== "function" && value?.batch)
      .map((value) => value.batch);
    expect(batches.map((batch) => batch.current)).toEqual([1, 2]);
    expect(batches.every((batch) => batch.label === "数据集")).toBe(true);
    expect(batches[1].total).toBe(2);
  });

  it("运行中重复启动会被拒绝", async () => {
    const { client, runPrompt } = makeClient();
    const pending = deferred<JobResult>();
    runPrompt.mockImplementationOnce(async () => pending.promise);
    runPrompt.mockResolvedValue(makeJob("pid-2"));
    const view = renderHook(() =>
      useDatasetRun({ client, pushToast: vi.fn(), setGlobalProgress: vi.fn(), setActiveTaskLabel: vi.fn() }),
    );
    seed(view, plan(2));

    act(() => {
      void view.result.current.start("pending", config);
    });
    await Promise.resolve();
    await act(async () => {
      await view.result.current.start("pending", config);
    });
    expect(runPrompt).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(makeJob("pid-1"));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  });

  it("recoverFromHistory 只补带 promptId 的中断项", async () => {
    const { client, fetchJobResult } = makeClient();
    fetchJobResult.mockResolvedValue(makeJob("pid-9"));
    const items = plan(2).map((item, index) =>
      index === 0 ? { ...item, status: "interrupted" as const, promptId: "pid-9" } : { ...item, status: "interrupted" as const },
    );
    const view = renderHook(() =>
      useDatasetRun({ client, pushToast: vi.fn(), setGlobalProgress: vi.fn(), setActiveTaskLabel: vi.fn() }),
    );
    seed(view, items);

    let recovered = 0;
    await act(async () => {
      recovered = await view.result.current.recoverFromHistory();
    });
    expect(recovered).toBe(1);
    expect(fetchJobResult).toHaveBeenCalledTimes(1);
    expect(view.result.current.items[0].status).toBe("success");
    expect(view.result.current.items[1].status).toBe("interrupted");
  });
});
