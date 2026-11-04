import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ComfyClient } from "../lib/comfyClient";
import type {
  DatasetConfig,
  DatasetItem,
  DatasetItemStatus,
  DatasetRunState,
  OptionsState,
  ProgressState,
  Toast,
} from "../types";
import { usePersistentState } from "./usePersistentState";
import { buildDatasetPrompt } from "../lib/dataset/build";
import { buildDatasetCaptionPrompt } from "../lib/dataset/captionNode";
import { buildDatasetSignature } from "../lib/dataset/signature";

/**
 * 数据集顺序队列。
 *
 * 为什么放在 App 层：面板是条件渲染（切 tab 即卸载），队列若持有在面板里，
 * 切走一次就会丢进度/丢中断句柄。
 *
 * 为什么自己再写一套而不复用 useGeneration.runXyzItems：
 * 1) 数据集需要「按 item.id 定向重跑 / 跳过已完成 / 从 history 补齐」；
 * 2) 100 条结果不该挤进输出面板那个 24 条上限的列表；
 * 3) 需要 AbortSignal 才能真正打断 `await runPrompt`（XYZ 的停止在中断任务上会卡住）。
 */

const RUN_KEY = "comfyui_dataset_run";
const ITEM_TIMEOUT_MS = 12 * 60 * 1000;
const PREVIEW_COUNT = 3;

type ToastFn = (type: Toast["type"], title: string, message?: string) => void;
export type DatasetStartMode = "pending" | "failed" | "all" | "preview";

/** 提交时需要的能力开关：Anima 节点能力 + 「> Save Text」是否可用 */
export type DatasetRunCaps = {
  animaCaps?: OptionsState["animaCaps"];
  saveText?: boolean;
};

const EMPTY_RUN: DatasetRunState = { version: 1, mode: "anima", planSeed: 0, createdAt: 0, signature: "", items: [] };
const STATUSES: DatasetItemStatus[] = ["queued", "running", "success", "failed", "cancelled", "interrupted"];

export function normalizeDatasetRun(merged: DatasetRunState, raw?: unknown): DatasetRunState {
  // 首次挂载（本地/服务端都没有值）时不要造一份空壳覆盖默认
  if (raw === undefined || raw === null) return { ...EMPTY_RUN, items: [] };

  const source = (merged ?? {}) as Partial<DatasetRunState>;
  const items = Array.isArray(source.items) ? source.items : [];
  return {
    version: 1,
    mode: source.mode === "sdxl" ? "sdxl" : "anima",
    planSeed: Number(source.planSeed) || 0,
    createdAt: Number(source.createdAt) || 0,
    // 旧存档没有该字段 → 空串（界面据此不做「计划过期」提示）
    signature: String(source.signature ?? ""),
    items: items.map((rawItem, index) => {
      const item = (rawItem ?? {}) as Partial<DatasetItem>;
      const status = STATUSES.includes(item.status as DatasetItemStatus)
        ? item.status === "running"
          ? "interrupted"
          : (item.status as DatasetItemStatus)
        : "queued";
      return {
        id: String(item.id ?? `ds-${index + 1}`),
        index: Number(item.index) || index + 1,
        seed: Number(item.seed) || 0,
        tags: (item.tags ?? {}) as DatasetItem["tags"],
        prompt: String(item.prompt ?? ""),
        caption: String(item.caption ?? ""),
        fingerprint: String(item.fingerprint ?? ""),
        status,
        promptId: item.promptId ? String(item.promptId) : undefined,
        files: Array.isArray(item.files)
          ? item.files
              .map((file) => ({
                filename: String(file?.filename ?? ""),
                subfolder: file?.subfolder ? String(file.subfolder) : undefined,
                type: file?.type ? String(file.type) : undefined,
              }))
              .filter((file) => file.filename)
          : [],
        error: item.error ? String(item.error) : undefined,
      };
    }),
  };
}

function isPending(item: DatasetItem): boolean {
  return item.status === "queued" || item.status === "interrupted" || item.status === "cancelled";
}

export function useDatasetRun({
  client,
  pushToast,
  notifyComplete,
  setGlobalProgress,
  setActiveTaskLabel,
}: {
  client: ComfyClient;
  pushToast: ToastFn;
  notifyComplete?: (title: string, message?: string) => void;
  setGlobalProgress: React.Dispatch<React.SetStateAction<ProgressState>>;
  setActiveTaskLabel: (label: string) => void;
}) {
  const [run, setRun] = usePersistentState<DatasetRunState>(RUN_KEY, EMPTY_RUN, normalizeDatasetRun);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(0);

  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const patchItem = useCallback(
    (id: string, patch: Partial<DatasetItem>) => {
      setRun((prev) => ({
        ...prev,
        items: prev.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      }));
    },
    [setRun],
  );

  const replacePlan = useCallback(
    (config: DatasetConfig, items: DatasetItem[]) => {
      setRun({
        version: 1,
        mode: config.mode,
        planSeed: config.planSeed,
        createdAt: Date.now(),
        signature: buildDatasetSignature(config),
        items,
      });
    },
    [setRun],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    void client.interrupt().catch(() => undefined);
    setGlobalProgress((prev) => ({ ...prev, running: false, label: "数据集已停止" }));
    pushToast("info", "数据集已停止", "已请求中断当前任务，队列不再继续提交");
  }, [client, pushToast, setGlobalProgress]);

  const start = useCallback(
    async (
      mode: DatasetStartMode,
      config: DatasetConfig,
      caps?: DatasetRunCaps,
      onlyId?: string,
      /**
       * 外部传入的计划：用于「还没有计划就直接点开始」——此时 hook 里的 items 还是空的，
       * 不能只靠 replacePlan（setState 要等下一轮渲染），所以由调用方把刚排好的计划一起传进来。
       */
      itemsOverride?: DatasetItem[],
    ) => {
      if (runningRef.current) {
        pushToast("info", "已有数据集任务在跑", "先停止当前队列再开始新的");
        return;
      }

      const animaCaps = caps?.animaCaps;
      const saveText = caps?.saveText === true;
      let captionFailed = 0;

      const all = itemsOverride?.length ? itemsOverride : runRef.current.items;
      let targets: DatasetItem[];
      if (onlyId) {
        targets = all.filter((item) => item.id === onlyId);
      } else if (mode === "all") {
        targets = all;
      } else if (mode === "failed") {
        targets = all.filter((item) => item.status === "failed");
      } else if (mode === "preview") {
        targets = all.filter(isPending).slice(0, PREVIEW_COUNT);
      } else {
        targets = all.filter(isPending);
      }

      if (!targets.length) {
        pushToast("info", "没有要生成的条目", mode === "failed" ? "当前没有失败的条目" : "计划里的条目都已生成");
        return;
      }

      runningRef.current = true;
      setRunning(true);
      setActiveTaskLabel("数据集");
      const queueController = new AbortController();
      abortRef.current = queueController;
      let success = 0;
      let failed = 0;

      try {
        for (let index = 0; index < targets.length; index += 1) {
          if (queueController.signal.aborted) break;
          const item = targets[index];
          setCurrent(index + 1);
          setGlobalProgress({
            running: true,
            value: index,
            max: targets.length,
            label: `数据集 ${index + 1}/${targets.length}`,
            batch: { current: index + 1, total: targets.length, itemLabel: `#${item.index}`, label: "数据集" },
          });
          patchItem(item.id, { status: "running", error: undefined });

          const itemController = new AbortController();
          const onQueueStop = () => itemController.abort();
          queueController.signal.addEventListener("abort", onQueueStop);
          let timedOut = false;
          const timer = window.setTimeout(() => {
            timedOut = true;
            itemController.abort();
            void client.interrupt().catch(() => undefined);
          }, ITEM_TIMEOUT_MS);

          try {
            const prompt = buildDatasetPrompt(config, item, { animaCaps });
            const result = await client.runPrompt(prompt, () => undefined, {
              signal: itemController.signal,
              onSubmitted: (promptId) => patchItem(item.id, { promptId }),
            });
            // type=temp 是 PreviewImage 的产物，会被 ComfyUI 清理，不能当训练图
            const files = result.images
              .filter((image) => (image.type ?? "output") !== "temp")
              .map((image) => ({ filename: image.filename, subfolder: image.subfolder, type: image.type }));
            if (!files.length) throw new Error("ComfyUI 未返回输出图");
            patchItem(item.id, { status: "success", files, error: undefined });
            success += 1;

            // 出图后再单独提交「写同名 .txt」：同一张工作流里两个保存节点的计数器会错位
            if (saveText) {
              for (const file of files) {
                const captionPrompt = buildDatasetCaptionPrompt(config, item, file);
                if (!captionPrompt) continue;
                try {
                  await client.runPrompt(captionPrompt, () => undefined, { signal: queueController.signal });
                } catch (captionError) {
                  if (queueController.signal.aborted) break;
                  captionFailed += 1;
                  if (captionFailed === 1) {
                    pushToast(
                      "error",
                      "提示词 .txt 保存失败",
                      captionError instanceof Error ? captionError.message : String(captionError),
                    );
                  }
                }
              }
            }
          } catch (error) {
            if (queueController.signal.aborted && !timedOut) {
              patchItem(item.id, { status: "cancelled", error: undefined });
              break;
            }
            const message = timedOut
              ? "单张超时（12 分钟），已请求中断"
              : error instanceof Error
                ? error.message
                : String(error);
            patchItem(item.id, { status: "failed", error: message });
            failed += 1;
            pushToast("error", `第 ${item.index} 张失败`, message);
          } finally {
            window.clearTimeout(timer);
            queueController.signal.removeEventListener("abort", onQueueStop);
          }
        }
      } finally {
        runningRef.current = false;
        abortRef.current = null;
        setRunning(false);
        setCurrent(0);
        setGlobalProgress({
          running: false,
          value: 1,
          max: 1,
          label: queueController.signal.aborted ? "数据集已停止" : "数据集完成",
        });
      }

      if (queueController.signal.aborted) {
        pushToast("info", "数据集已停止", `已完成 ${success} 张，失败 ${failed} 张`);
      } else {
        const captionNote = captionFailed ? ` · ${captionFailed} 条 .txt 未写入` : "";
        pushToast("success", "数据集执行结束", `成功 ${success} 张，失败 ${failed} 张${captionNote}`);
        notifyComplete?.("数据集执行结束", `成功 ${success} 张，失败 ${failed} 张`);
      }
    },
    [client, notifyComplete, patchItem, pushToast, setActiveTaskLabel, setGlobalProgress],
  );

  const retryFailed = useCallback(
    (config: DatasetConfig, caps?: DatasetRunCaps) => start("failed", config, caps),
    [start],
  );

  const rerunOne = useCallback(
    (id: string, config: DatasetConfig, caps?: DatasetRunCaps) => start("pending", config, caps, id),
    [start],
  );

  /** 关窗/崩溃后补齐：凭 promptId 去 ComfyUI 历史里把已出图但没来得及回写的条目捞回来 */
  const recoverFromHistory = useCallback(async () => {
    if (runningRef.current) return 0;
    const candidates = runRef.current.items.filter((item) => item.status === "interrupted" && item.promptId);
    if (!candidates.length) return 0;
    let recovered = 0;
    for (const item of candidates) {
      const job = await client.fetchJobResult(item.promptId!);
      const files = (job?.images ?? [])
        .filter((image) => (image.type ?? "output") !== "temp")
        .map((image) => ({ filename: image.filename, subfolder: image.subfolder, type: image.type }));
      if (!files.length) continue;
      patchItem(item.id, { status: "success", files, error: undefined });
      recovered += 1;
    }
    if (recovered) pushToast("success", "已补回历史结果", `${recovered} 条`);
    return recovered;
  }, [client, patchItem, pushToast]);

  return {
    run,
    items: run.items,
    running,
    current,
    replacePlan,
    start,
    stop,
    retryFailed,
    rerunOne,
    recoverFromHistory,
    setRun,
  };
}
