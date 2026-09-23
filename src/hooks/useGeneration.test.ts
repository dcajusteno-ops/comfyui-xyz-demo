import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGeneration } from "./useGeneration";
import type { ComfyClient } from "../lib/comfyClient";
import {
  makeAnimaParams,
  makeBaseParams,
  makeHighresParams,
  makeMultiParams,
} from "../lib/paramBuilders";
import type {
  BaseGenerationParams,
  ClSingleParams,
  ComfyPrompt,
  JobResult,
  OutputImage,
  TemplateKind,
  Wd14Params,
  XyzRunItem,
} from "../types";

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

const ANIMA_CAPS = { useEasyHiresFix: true, useImageResizeKJv2: true };

const makeImage = (filename: string): OutputImage => ({
  filename,
  url: `/comfy/api/view?filename=${filename}&type=output`,
});

const makeJob = (promptId = "job-1", imageCount = 1): JobResult => ({
  promptId,
  images: Array.from({ length: imageCount }, (_, i) => makeImage(`${promptId}-${i}.png`)),
  texts: [],
  rawHistory: {},
});

const defaultParams = makeBaseParams();
const multiParams = makeMultiParams();
const highresParams = makeHighresParams();
const animaParams = makeAnimaParams();

const emptyPrompt = () => ({}) as ComfyPrompt;

/**
 * mock client：只保留 useGeneration 实际用到的方法。
 * 不构造真实 ComfyClient —— 它会在实例化时牵扯 WebSocket 与定时器。
 */
function makeClient() {
  const runPrompt = vi.fn();
  runPrompt.mockResolvedValue(makeJob());
  const uploadImage = vi.fn();
  uploadImage.mockImplementation(async (file: File) => ({ name: `uploaded-${file.name}` }));
  const interrupt = vi.fn();
  interrupt.mockResolvedValue(undefined);
  const client = { runPrompt, uploadImage, interrupt } as unknown as ComfyClient;
  return { client, runPrompt, uploadImage, interrupt };
}

function setup() {
  const { client, runPrompt, uploadImage, interrupt } = makeClient();
  const pushToast = vi.fn();
  const notifyComplete = vi.fn();
  const view = renderHook(() => useGeneration({ client, pushToast, notifyComplete }));
  return { ...view, client, runPrompt, uploadImage, interrupt, pushToast, notifyComplete };
}

/** 取第 n 次 runPrompt 调用时提交的 prompt */
const sentPrompt = (runPrompt: ReturnType<typeof vi.fn>, n = 0): ComfyPrompt =>
  runPrompt.mock.calls[n][0] as ComfyPrompt;
/** 把 prompt 序列化后做子串断言 —— 对节点 id 与层级不敏感 */
const serialized = (prompt: ComfyPrompt) => JSON.stringify(prompt);

const xyzItem = (id: string, patch: XyzRunItem["patch"] = {}): XyzRunItem => ({
  id,
  label: `组合-${id}`,
  patch,
  status: "queued",
});

const runItems = async (
  hook: ReturnType<typeof setup>,
  items: XyzRunItem[],
  reset = true,
  target: TemplateKind = "default",
) =>
  act(async () => {
    await hook.result.current.runXyzItems(
      items,
      reset,
      target,
      defaultParams,
      multiParams,
      highresParams,
      animaParams,
      ANIMA_CAPS,
    );
  });

beforeEach(() => {
  document.title = "BASE_TITLE";
});

/* ------------------------------------------------------------------ *
 * B. runPrompt
 * ------------------------------------------------------------------ */

describe("runPrompt", () => {
  it("B1 成功：结果入列、toast 提交与完成、通知完成、原样返回结果", async () => {
    const hook = setup();
    const job = makeJob("job-b1");
    hook.runPrompt.mockResolvedValueOnce(job);

    let returned: JobResult | undefined;
    await act(async () => {
      returned = await hook.result.current.runPrompt("默认生图", emptyPrompt);
    });

    expect(returned).toBe(job);
    expect(hook.result.current.results[0]).toBe(job);
    expect(hook.pushToast).toHaveBeenCalledWith("info", "默认生图 已提交", "正在等待 ComfyUI 执行");
    expect(hook.pushToast).toHaveBeenCalledWith("success", "默认生图 完成", "输出 1 张图片");
    expect(hook.notifyComplete).toHaveBeenCalledWith("默认生图 完成", "输出 1 张图片");
    expect(hook.result.current.error).toBe("");
  });

  it("B2 失败：error 置位、toast 失败、progress 归零并置「失败」，且向调用方抛出", async () => {
    const hook = setup();
    hook.runPrompt.mockRejectedValueOnce(new Error("boom"));

    await act(async () => {
      await expect(hook.result.current.runPrompt("默认生图", emptyPrompt)).rejects.toThrow("boom");
    });

    expect(hook.result.current.error).toBe("boom");
    expect(hook.pushToast).toHaveBeenCalledWith("error", "默认生图 失败", "boom");
    expect(hook.result.current.progress.running).toBe(false);
    expect(hook.result.current.progress.label).toBe("失败");
  });

  it("B2b 非 Error 抛出物走 String() 分支", async () => {
    const hook = setup();
    hook.runPrompt.mockRejectedValueOnce("plain-string-failure");

    await act(async () => {
      await expect(hook.result.current.runPrompt("默认生图", emptyPrompt)).rejects.toBe("plain-string-failure");
    });

    expect(hook.result.current.error).toBe("plain-string-failure");
    expect(hook.pushToast).toHaveBeenCalledWith("error", "默认生图 失败", "plain-string-failure");
  });

  it("B3 results 只保留最近 24 条，最新在前", async () => {
    const hook = setup();
    let seq = 0;
    hook.runPrompt.mockImplementation(async () => makeJob(`job-${++seq}`));

    await act(async () => {
      for (let i = 0; i < 25; i += 1) {
        await hook.result.current.runPrompt("默认生图", emptyPrompt);
      }
    });

    expect(hook.result.current.results).toHaveLength(24);
    expect(hook.result.current.results[0].promptId).toBe("job-25");
  });

  it("B4 activeTaskLabel 优先取 taskLabel，缺省回落 label", async () => {
    const hook = setup();

    await act(async () => {
      await hook.result.current.runPrompt("默认生图", emptyPrompt);
    });
    expect(hook.result.current.activeTaskLabel).toBe("默认生图");

    await act(async () => {
      await hook.result.current.runPrompt("默认生图", emptyPrompt, undefined, "XYZ 控制器");
    });
    expect(hook.result.current.activeTaskLabel).toBe("XYZ 控制器");
  });

  it("B5 标题联动：运行中带批次前缀与百分比，结束后恢复原标题", async () => {
    const hook = setup();

    act(() => {
      hook.result.current.setProgress({
        running: true,
        value: 12,
        max: 100,
        label: "绘图中",
        batch: { current: 1, total: 3, itemLabel: "组合-1" },
      });
    });
    expect(document.title).toBe("[1/3] 12% - BASE_TITLE");

    act(() => {
      hook.result.current.setActiveTaskLabel("XYZ 控制器");
    });
    expect(document.title).toBe("[1/3] 12% | XYZ 控制器 - BASE_TITLE");

    act(() => {
      hook.result.current.setProgress({ running: false, value: 1, max: 1, label: "完成" });
    });
    expect(document.title).toBe("BASE_TITLE");
  });

  it("B5b max 为 0 时不出现 NaN%", async () => {
    const hook = setup();
    act(() => {
      hook.result.current.setProgress({ running: true, value: 0, max: 0, label: "准备" });
    });
    expect(document.title).toBe("0% - BASE_TITLE");
  });
});

/* ------------------------------------------------------------------ *
 * B. runWd14 / runClSingle
 * ------------------------------------------------------------------ */

const wd14 = (over: Partial<Wd14Params> = {}): Wd14Params => ({
  imageName: "",
  model: "wd-v1-4-moat-tagger-v2",
  threshold: 0.35,
  characterThreshold: 0.85,
  replaceUnderscore: true,
  trailingComma: false,
  excludeTags: "",
  device: "GPU",
  ...over,
});

const clSingle = (over: Partial<ClSingleParams> = {}): ClSingleParams => ({
  imageName: "",
  modelName: "cl_tagger",
  general: 0.35,
  character: 0.85,
  replaceSpace: true,
  categories: "",
  excludeTags: "",
  sessionMethod: "GPU",
  ...over,
});

describe("runWd14 / runClSingle", () => {
  it("B6 WD14 未选图：抛错且完全不提交任务", async () => {
    const hook = setup();

    await act(async () => {
      await expect(hook.result.current.runWd14(wd14(), null)).rejects.toThrow("请先选择一张图片");
    });

    expect(hook.runPrompt).not.toHaveBeenCalled();
    expect(hook.uploadImage).not.toHaveBeenCalled();
    expect(hook.pushToast).toHaveBeenCalledWith("error", "WD1.4 识别失败", "请先选择一张图片");
  });

  it("B7 WD14 带本地文件：先上传，并用上传返回的文件名覆盖 imageName", async () => {
    const hook = setup();
    const file = new File(["x"], "ref.png", { type: "image/png" });

    await act(async () => {
      await hook.result.current.runWd14(wd14({ imageName: "stale.png" }), file);
    });

    expect(hook.uploadImage).toHaveBeenCalledWith(file);
    expect(serialized(sentPrompt(hook.runPrompt))).toContain("uploaded-ref.png");
    expect(serialized(sentPrompt(hook.runPrompt))).not.toContain("stale.png");
    expect(hook.pushToast).toHaveBeenCalledWith("success", "WD1.4 识别完成", "任务已完成");
  });

  it("B8 WD14 只有 imageName：不触发上传，直接用该名字", async () => {
    const hook = setup();

    await act(async () => {
      await hook.result.current.runWd14(wd14({ imageName: "already-uploaded.png" }), null);
    });

    expect(hook.uploadImage).not.toHaveBeenCalled();
    expect(serialized(sentPrompt(hook.runPrompt))).toContain("already-uploaded.png");
  });

  it("B9 CL 单图：未选图抛错；带文件时先上传并用上传名（与 WD14 对称）", async () => {
    const hook = setup();

    await act(async () => {
      await expect(hook.result.current.runClSingle(clSingle(), null)).rejects.toThrow("请先选择一张图片");
    });
    expect(hook.runPrompt).not.toHaveBeenCalled();

    const file = new File(["x"], "cl.png", { type: "image/png" });
    await act(async () => {
      await hook.result.current.runClSingle(clSingle({ imageName: "stale.png" }), file);
    });
    expect(hook.uploadImage).toHaveBeenCalledWith(file);
    expect(serialized(sentPrompt(hook.runPrompt))).toContain("uploaded-cl.png");
  });
});

/* ------------------------------------------------------------------ *
 * B. runXyzItems 语义
 * ------------------------------------------------------------------ */

describe("runXyzItems", () => {
  it("B10 reset=true 时整体重置结果列表（旧条目不会残留）", async () => {
    const hook = setup();

    await runItems(hook, [xyzItem("old-1"), xyzItem("old-2")]);
    expect(hook.result.current.xyzResults.map((item) => item.id)).toEqual(["old-1", "old-2"]);

    await runItems(hook, [xyzItem("new-1")]);
    expect(hook.result.current.xyzResults.map((item) => item.id)).toEqual(["new-1"]);
  });

  it("B11 请求中断后：剩余 queued 标记为 cancelled，已完成条目保留结果", async () => {
    const hook = setup();
    hook.runPrompt.mockImplementation(async () => {
      if (hook.runPrompt.mock.calls.length === 1) {
        hook.result.current.xyzCancelRef.current = true;
      }
      return makeJob(`job-${hook.runPrompt.mock.calls.length}`);
    });

    await runItems(hook, [xyzItem("a"), xyzItem("b"), xyzItem("c")]);

    expect(hook.result.current.xyzResults.map((item) => item.status)).toEqual([
      "success",
      "cancelled",
      "cancelled",
    ]);
    expect(hook.runPrompt).toHaveBeenCalledTimes(1);
    expect(hook.result.current.xyzResults[0].result?.promptId).toBe("job-1");
  });

  it("B12 单条失败不中断整批：失败条目标记 failed+error，后续继续执行", async () => {
    const hook = setup();
    hook.runPrompt
      .mockResolvedValueOnce(makeJob("ok-1"))
      .mockRejectedValueOnce(new Error("组合爆炸"))
      .mockResolvedValueOnce(makeJob("ok-3"));

    await runItems(hook, [xyzItem("a"), xyzItem("b"), xyzItem("c")]);

    expect(hook.runPrompt).toHaveBeenCalledTimes(3);
    const [a, b, c] = hook.result.current.xyzResults;
    expect(a.status).toBe("success");
    expect(b.status).toBe("failed");
    expect(b.error).toBe("组合爆炸");
    expect(c.status).toBe("success");
    expect(hook.pushToast).toHaveBeenCalledWith("error", "XYZ 组合失败：组合-b", "组合爆炸");
  });

  it("B13 回归防线：rerunXyzItem 原位替换，其余组合的对象引用不变（原 bug 会整体清空）", async () => {
    const hook = setup();
    await runItems(hook, [xyzItem("a"), xyzItem("b")]);

    const successful = hook.result.current.xyzResults;
    expect(successful.map((item) => item.status)).toEqual(["success", "success"]);
    const untouched = successful[1];

    await act(async () => {
      await hook.result.current.rerunXyzItem(
        successful[0],
        "default",
        defaultParams,
        multiParams,
        highresParams,
        animaParams,
        ANIMA_CAPS,
      );
    });

    const after = hook.result.current.xyzResults;
    expect(after).toHaveLength(2);
    expect(after[1]).toBe(untouched); // 同一对象引用 → 未被重置
    expect(after[0].id).not.toBe("a"); // 重跑条目换新 id
    expect(after[0].status).toBe("success");
    expect(after[0].label).toBe("组合-a"); // 标签沿用
  });

  it("B14 回归防线：retryFailedXyz 只替换失败项，成功项引用不变；无失败项时只提示不执行", async () => {
    const hook = setup();
    hook.runPrompt
      .mockResolvedValueOnce(makeJob("ok-1"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(makeJob("retried"));

    await runItems(hook, [xyzItem("a"), xyzItem("b")]);
    expect(hook.result.current.xyzResults.map((item) => item.status)).toEqual(["success", "failed"]);
    const kept = hook.result.current.xyzResults[0];

    await act(async () => {
      await hook.result.current.retryFailedXyz(
        "default",
        defaultParams,
        multiParams,
        highresParams,
        animaParams,
        ANIMA_CAPS,
      );
    });

    const after = hook.result.current.xyzResults;
    expect(after[0]).toBe(kept); // 成功项引用不变
    expect(after[1].status).toBe("success");
    expect(after[1].result?.promptId).toBe("retried");
    expect(hook.runPrompt).toHaveBeenCalledTimes(3); // 只补跑了失败的那条

    // 已无失败项时：只提示，不再提交
    hook.pushToast.mockClear();
    await act(async () => {
      await hook.result.current.retryFailedXyz(
        "default",
        defaultParams,
        multiParams,
        highresParams,
        animaParams,
        ANIMA_CAPS,
      );
    });
    expect(hook.runPrompt).toHaveBeenCalledTimes(3);
    expect(hook.pushToast).toHaveBeenCalledWith("info", "没有失败组合", "当前 XYZ 结果里没有需要重试的组合");
  });
});

/* ------------------------------------------------------------------ *
 * C. 轴 patch 落到 prompt 的方式（代码注释里点名的两个坑）
 * ------------------------------------------------------------------ */

describe("XYZ 轴 patch 的合并方式", () => {
  it("C1 multi：positivePrompt 轴是**追加**到 globalPrompt，不是覆盖", async () => {
    const hook = setup();
    const base = { ...multiParams, globalPrompt: "BASE_GLOBAL_PROMPT" };

    await act(async () => {
      await hook.result.current.runXyzItems(
        [xyzItem("a", { positivePrompt: "EXTRA_PROMPT_AXIS" })],
        true,
        "multi",
        defaultParams,
        base,
        highresParams,
        animaParams,
        ANIMA_CAPS,
      );
    });

    const prompt = serialized(sentPrompt(hook.runPrompt));
    expect(prompt).toContain("BASE_GLOBAL_PROMPT");
    expect(prompt).toContain("EXTRA_PROMPT_AXIS");
  });

  it("C2 anima：drawText 轴是**按层合并**，未打轴的字段（字体）不丢", async () => {
    const hook = setup();
    const base = makeBaseParams();
    if (!base.drawText) throw new Error("夹具应自带完整 drawText 配置");
    const withWatermark: BaseGenerationParams = {
      ...base,
      drawText: {
        ...base.drawText,
        enabled: true,
        text: "WATERMARK_TEXT",
        font: "FONT_BASE_ABC",
        color: "#123456",
      },
    };

    await act(async () => {
      await hook.result.current.runXyzItems(
        [
          {
            ...xyzItem("a"),
            // drawText 轴只带一个字段（真实场景下 patch.drawText 就是这种部分对象）
            patch: { drawText: { color: "#ABCDEF" } } as XyzRunItem["patch"],
          },
        ],
        true,
        "anima",
        withWatermark,
        multiParams,
        highresParams,
        animaParams,
        ANIMA_CAPS,
      );
    });

    const prompt = serialized(sentPrompt(hook.runPrompt));
    expect(prompt).toContain("#ABCDEF"); // 轴的值生效
    expect(prompt).toContain("FONT_BASE_ABC"); // 借用的基底字体没被整体覆盖冲掉
    expect(prompt).toContain("WATERMARK_TEXT");
  });

  it("C3 default：patch 的关键参数确实落到 KSampler 上", async () => {
    const hook = setup();

    await act(async () => {
      await hook.result.current.runXyzItems(
        [xyzItem("a", { steps: 33 })],
        true,
        "default",
        defaultParams,
        multiParams,
        highresParams,
        animaParams,
        ANIMA_CAPS,
      );
    });

    expect(sentPrompt(hook.runPrompt)["6"].inputs.steps).toBe(33);
  });
});

/* 说明：exportXyzGrid 未纳入本文件——它依赖 new Image() / canvas.getContext("2d") / toDataURL，
   jsdom 均未实现；其导出链路已由 E2E 的网格导出路径间接覆盖。 */
