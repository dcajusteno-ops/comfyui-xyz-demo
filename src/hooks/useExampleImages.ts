import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ComfyClient } from "../lib/comfyClient";
import { uniqueStrings } from "../lib/lora-helper";
import { managedModelExampleType } from "../constants";
import type {
  BaseGenerationParams,
  ExampleImagesPendingResult,
  ExampleImagesStatus,
  HighresParams,
  LoraExampleMedia,
  LoraItem,
  ManagedModelType,
  MultiGenerationParams,
  TabId,
  Toast,
} from "../types";

type ToastFn = (type: Toast["type"], title: string, message?: string) => void;

export function useExampleImages({
  client,
  pushToast,
  managedModelType,
  refreshLoras,
  tab,
  defaultParams,
  multiParams,
  highresParams,
}: {
  client: ComfyClient;
  pushToast: ToastFn;
  managedModelType: ManagedModelType;
  refreshLoras: () => Promise<void>;
  tab: TabId;
  defaultParams: BaseGenerationParams;
  multiParams: MultiGenerationParams;
  highresParams: HighresParams;
}) {
  const [loraExampleFilesByHash, setLoraExampleFilesByHash] = useState<Record<string, LoraExampleMedia[]>>({});
  const loraExampleFilesByHashRef = useRef(loraExampleFilesByHash);
  useEffect(() => { loraExampleFilesByHashRef.current = loraExampleFilesByHash; }, [loraExampleFilesByHash]);
  const [exampleStatus, setExampleStatus] = useState<ExampleImagesStatus | null>(null);
  const [examplePending, setExamplePending] = useState<ExampleImagesPendingResult | null>(null);
  const [pullingExampleHashes, setPullingExampleHashes] = useState<string[]>([]);
  const examplePollRef = useRef<number | null>(null);

  async function refreshExampleImageInfo() {
    const [status, pending] = await Promise.all([
      client.getExampleImagesStatus(),
      client.checkExampleImagesNeeded([managedModelExampleType(managedModelType)]),
    ]);
    setExampleStatus(status);
    setExamplePending(pending);
    if (status.is_downloading) {
      startExampleStatusPolling();
    }
  }

  function stopExampleStatusPolling() {
    if (examplePollRef.current !== null) {
      window.clearInterval(examplePollRef.current);
      examplePollRef.current = null;
    }
  }

  function startExampleStatusPolling() {
    stopExampleStatusPolling();
    const tick = async () => {
      try {
        const status = await client.getExampleImagesStatus();
        setExampleStatus(status);
        if (!status.is_downloading) {
          stopExampleStatusPolling();
          if (status.status.status === "completed") {
            pushToast("success", "示例图拉取完成", `${status.status.completed}/${status.status.total} 个模型已处理`);
            setLoraExampleFilesByHash({});
            refreshLoras().catch(() => undefined);
            refreshExampleImageInfo().catch(() => undefined);
          }
          if (status.status.status === "error") {
            pushToast("error", "示例图拉取失败", status.status.last_error ?? "插件下载任务返回错误");
          }
        }
      } catch (statusError) {
        stopExampleStatusPolling();
        pushToast("error", "示例图状态读取失败", statusError instanceof Error ? statusError.message : String(statusError));
      }
    };
    tick();
    examplePollRef.current = window.setInterval(tick, 2200);
  }

  const pullAllLoraExamples = useCallback(async () => {
    try {
      setLoraExampleFilesByHash({});
      pushToast("info", "一键拉取已提交", "将自动跳过本地已有的示例图");
      const result = await client.downloadExampleImages({ force: false, optimize: false, modelTypes: [managedModelExampleType(managedModelType)] });
      if (!result.success) {
        throw new Error(result.error || "插件没有启动示例图拉取");
      }
      if (result.status) {
        setExampleStatus({ success: true, is_downloading: true, status: result.status });
      }
      startExampleStatusPolling();
    } catch (pullError) {
      const message = pullError instanceof Error ? pullError.message : String(pullError);
      pushToast("error", "一键拉取失败", message);
    }
  }, [client, managedModelType, pushToast]);

  async function pullLoraExamples(item: LoraItem): Promise<LoraExampleMedia[]> {
    const hash = item.sha256?.toLowerCase();
    if (!hash) {
      pushToast("error", "无法拉取示例图", "该 LoRA 没有 SHA256");
      return [];
    }

    setPullingExampleHashes((prev) => uniqueStrings([...prev, hash]));
    try {
      pushToast("info", "单独拉取已开始", item.model_name || item.file_name);
      setExampleStatus({
        success: true,
        is_downloading: true,
        status: {
          total: 1,
          completed: 0,
          current_model: item.model_name || item.file_name || hash,
          status: "running",
          errors: [],
          last_error: null,
          processed_models: [],
          refreshed_models: [],
          failed_models: [],
          reprocessed_models: [],
        },
      });
      startExampleStatusPolling();
      if (item.file_path) {
        await client.refreshManagedModelCivitaiMetadata(managedModelType, item.file_path).catch((metadataError) => {
          pushToast("info", "元数据刷新未完成", metadataError instanceof Error ? metadataError.message : String(metadataError));
        });
      }
      const result = await client.forceDownloadExampleImages([hash], { optimize: false, modelTypes: [managedModelExampleType(managedModelType)], items: [item] });
      if (!result.success) {
        throw new Error(result.error || "插件没有完成单独拉取");
      }
      const files = await client.getLoraExampleFiles(hash);
      setLoraExampleFilesByHash((prev) => ({ ...prev, [hash]: files }));
      await refreshLoras();
      await refreshExampleImageInfo();
      setExampleStatus({
        success: true,
        is_downloading: false,
        status: {
          total: 1,
          completed: 1,
          current_model: item.model_name || item.file_name || hash,
          status: "completed",
          errors: [],
          last_error: null,
          processed_models: [hash],
          refreshed_models: [],
          failed_models: [],
          reprocessed_models: [],
        },
      });
      pushToast(files.length ? "success" : "info", "单独拉取完成", files.length ? `已读取 ${files.length} 个示例媒体` : "插件没有返回新的示例媒体");
      return files;
    } catch (pullError) {
      const message = pullError instanceof Error ? pullError.message : String(pullError);
      setExampleStatus({
        success: false,
        is_downloading: false,
        status: {
          total: 1,
          completed: 0,
          current_model: item.model_name || item.file_name || hash,
          status: "error",
          errors: [message],
          last_error: message,
          processed_models: [],
          refreshed_models: [],
          failed_models: [hash],
          reprocessed_models: [],
        },
        error: message,
      });
      pushToast("error", "单独拉取失败", message);
      return [];
    } finally {
      setPullingExampleHashes((prev) => prev.filter((value) => value !== hash));
    }
  }

  async function openLoraExampleFolder(item: LoraItem) {
    const hash = item.sha256?.toLowerCase();
    if (!hash) {
      pushToast("error", "无法打开目录", "该 LoRA 没有 SHA256");
      return;
    }
    try {
      const result = await client.openExampleImagesFolder(hash);
      if (!result.success) {
        throw new Error(result.error || "插件没有返回目录");
      }
      if (result.uri) {
        window.open(result.uri, "_blank", "noopener,noreferrer");
      }
      if (result.mode === "clipboard" && result.path) {
        navigator.clipboard?.writeText(result.path);
        pushToast("success", "示例图目录已复制", result.path);
      } else {
        pushToast("success", "示例图目录已打开", result.path || result.uri);
      }
    } catch (openError) {
      pushToast("error", "打开示例图目录失败", openError instanceof Error ? openError.message : String(openError));
    }
  }

  async function pauseExampleDownloads() {
    try {
      const result = await client.pauseExampleImages();
      if (result.success === false) throw new Error(result.error || "暂停失败");
      await refreshExampleImageInfo();
      pushToast("success", "示例图下载已暂停");
    } catch (pauseError) {
      pushToast("error", "暂停示例图失败", pauseError instanceof Error ? pauseError.message : String(pauseError));
    }
  }

  async function resumeExampleDownloads() {
    try {
      const result = await client.resumeExampleImages();
      if (result.success === false) throw new Error(result.error || "恢复失败");
      startExampleStatusPolling();
      pushToast("success", "示例图下载已恢复");
    } catch (resumeError) {
      pushToast("error", "恢复示例图失败", resumeError instanceof Error ? resumeError.message : String(resumeError));
    }
  }

  async function stopExampleDownloads() {
    try {
      const result = await client.stopExampleImages();
      if (result.success === false) throw new Error(result.error || "停止失败");
      stopExampleStatusPolling();
      await refreshExampleImageInfo();
      pushToast("success", "示例图下载已停止");
    } catch (stopError) {
      pushToast("error", "停止示例图失败", stopError instanceof Error ? stopError.message : String(stopError));
    }
  }

  const allRelevantHashes = useMemo(() => {
    const selectedHashes = [
      ...defaultParams.loras,
      ...multiParams.loras,
      ...highresParams.loras,
    ].map((l) => l.sha256?.toLowerCase()).filter((h): h is string => Boolean(h));

    // loraResult items 由 hook 外部（useLoras）提供不了，此处无需依赖列表项，
    // 只依赖三个参数中的 loras，保持原有逻辑由调用方传入
    return uniqueStrings(selectedHashes);
  }, [defaultParams.loras, multiParams.loras, highresParams.loras]);

  // 定时刷新 LoRA 示例图状态（tab 为 loras 时）
  useEffect(() => {
    if (tab !== "loras") return;
    refreshExampleImageInfo().catch((infoError) => {
      pushToast("error", "示例图状态读取失败", infoError instanceof Error ? infoError.message : String(infoError));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, tab, managedModelType]);

  useEffect(() => {
    return () => {
      stopExampleStatusPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    loraExampleFilesByHash,
    loraExampleFilesByHashRef,
    setLoraExampleFilesByHash,
    exampleStatus,
    examplePending,
    pullingExampleHashes,
    refreshExampleImageInfo,
    startExampleStatusPolling,
    stopExampleStatusPolling,
    pullAllLoraExamples,
    pullLoraExamples,
    openLoraExampleFolder,
    pauseExampleDownloads,
    resumeExampleDownloads,
    stopExampleDownloads,
  };
}