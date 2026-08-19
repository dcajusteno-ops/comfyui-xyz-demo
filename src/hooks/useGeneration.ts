import { useEffect, useRef, useState } from "react";
import { ComfyClient } from "../lib/comfyClient";
import { buildClBatchPrompt, buildWdBatchPrompt } from "../lib/workflowBuilders";
import type {
  ClBatchParams,
  ComfyPrompt,
  JobResult,
  ProgressState,
  Toast,
  WdBatchParams,
} from "../types";

type ToastFn = (type: Toast["type"], title: string, message?: string) => void;

export function useGeneration({ client, pushToast }: { client: ComfyClient; pushToast: ToastFn }) {
  const [progress, setProgress] = useState<ProgressState>({
    running: false,
    value: 0,
    max: 1,
    label: "空闲",
  });
  const [activeTaskLabel, setActiveTaskLabel] = useState("");
  const [results, setResults] = useState<JobResult[]>([]);
  const [error, setError] = useState("");
  const xyzCancelRef = useRef(false);
  const baseDocTitleRef = useRef(document.title);

  useEffect(() => {
    if (progress.running) {
      const percent = progress.max > 0 ? Math.round((progress.value / progress.max) * 100) : 0;
      let prefix = `${percent}%`;
      if (progress.batch) {
        prefix = `[${progress.batch.current}/${progress.batch.total}] ${prefix}`;
      }
      const taskPart = activeTaskLabel ? ` | ${activeTaskLabel}` : "";
      document.title = `${prefix}${taskPart} - ${baseDocTitleRef.current}`;
    } else if (document.title !== baseDocTitleRef.current) {
      document.title = baseDocTitleRef.current;
    }
  }, [progress.running, progress.value, progress.max, progress.batch, activeTaskLabel]);

  async function runPrompt(
    label: string,
    promptFactory: () => ComfyPrompt,
    onProgress: (progress: ProgressState) => void = (prog) => setProgress(prog),
    taskLabel?: string,
  ) {
    setError("");
    setActiveTaskLabel(taskLabel || label);
    try {
      onProgress({ running: true, value: 0, max: 1, label: `${label} 准备中` });
      pushToast("info", `${label} 已提交`, "正在等待 ComfyUI 执行");
      const result = await client.runPrompt(promptFactory(), onProgress);
      setResults((prev) => [result, ...prev].slice(0, 24));
      pushToast("success", `${label} 完成`, result.images.length ? `输出 ${result.images.length} 张图片` : undefined);
      return result;
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setError(message);
      onProgress({ running: false, value: 0, max: 1, label: "失败" });
      pushToast("error", `${label} 失败`, message);
      throw runError;
    }
  }

  async function runBatchTagger(type: "cl" | "wd", clBatchParams: ClBatchParams, wdBatchParams: WdBatchParams) {
    setError("");
    setActiveTaskLabel(type === "cl" ? "CL 批量打标" : "WD 批量打标");
    const params = type === "cl" ? clBatchParams : wdBatchParams;
    try {
      pushToast("info", "批量打标已启动", `计划处理 ${params.runCount} 张`);
      let successCount = 0;
      for (let i = 0; i < params.runCount; i++) {
        if (xyzCancelRef.current) break;
        const prompt = type === "cl"
          ? buildClBatchPrompt(clBatchParams, i)
          : buildWdBatchPrompt(wdBatchParams, i);

        await client.runPrompt(prompt, setProgress);
        successCount++;
      }
      pushToast("success", "批量打标完成", `成功处理 ${successCount} 张`);
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setError(message);
      pushToast("error", "批量打标失败", message);
    }
  }

  return {
    progress,
    setProgress,
    activeTaskLabel,
    setActiveTaskLabel,
    results,
    setResults,
    error,
    setError,
    xyzCancelRef,
    runPrompt,
    runBatchTagger,
  };
}