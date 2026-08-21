import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ComfyClient } from "../lib/comfyClient";
import { 
  mergeManagedModelItems, 
  uniqueStrings, 
  loraSyntaxName, 
  mergeLora, 
  normalizeLoraManagerSettings,
  loraModelId
} from "../lib/lora-helper";
import { pickCardPreviewMedia } from "../lib/lora-media";
import type {
  LoraItem,
  LoraListResult,
  LoraManagerSettings,
  LoraOperation,
  LoraQueryState,
  LoraSelection,
  ManagedModelType,
  TabId,
  TemplateKind,
  Toast,
  ExampleImagesStatus,
  ExampleImagesPendingResult,
  LoraExampleMedia,
  DownloadProgress
} from "../types";
import { 
  defaultLoraQuery, 
  emptyLoraResult, 
  templateLabels, 
  managedModelExampleType,
  defaultLoraManagerSettings
} from "../constants";

type ToastFn = (type: Toast["type"], title: string, message?: string) => void;

export function useLoras({
  client,
  pushToast,
  activeLoraHashes = [],
  loraSettings,
  setLoraSettings,
  tab,
}: {
  client: ComfyClient;
  pushToast: ToastFn;
  activeLoraHashes?: string[];
  loraSettings: LoraManagerSettings;
  setLoraSettings: (settings: LoraManagerSettings) => void;
  tab: TabId;
}) {
  const [managedModelType, setManagedModelType] = useState<ManagedModelType>("loras");
  const [loraResult, setLoraResult] = useState<LoraListResult>(emptyLoraResult);
  const loraResultRef = useRef(loraResult);
  useEffect(() => { loraResultRef.current = loraResult; }, [loraResult]);

  const [loraQuery, setLoraQuery] = useState<LoraQueryState>(defaultLoraQuery);
  const loraQueryRef = useRef(loraQuery);
  useEffect(() => { loraQueryRef.current = loraQuery; }, [loraQuery]);

  const [loraLoading, setLoraLoading] = useState(false);
  const loraLoadingRef = useRef(false);
  const [loraFolders, setLoraFolders] = useState<string[]>([]);
  const loraFoldersRef = useRef(loraFolders);
  useEffect(() => { loraFoldersRef.current = loraFolders; }, [loraFolders]);

  const [loraBaseModels, setLoraBaseModels] = useState<Array<{ name: string; count: number }>>([]);
  const loraBaseModelsRef = useRef(loraBaseModels);
  useEffect(() => { loraBaseModelsRef.current = loraBaseModels; }, [loraBaseModels]);

  const [loraTags, setLoraTags] = useState<string[]>([]);
  const loraTagsRef = useRef(loraTags);
  useEffect(() => { loraTagsRef.current = loraTags; }, [loraTags]);
  
  const [loraTarget, setLoraTarget] = useState<TemplateKind>("default");
  const [loraDensity, setLoraDensity] = useState<"compact" | "medium" | "large">("medium");
  const [loraDetail, setLoraDetail] = useState<LoraItem | null>(null);
  const [selectedLoraPaths, setSelectedLoraPaths] = useState<string[]>([]);
  const [loraOperation, setLoraOperation] = useState<LoraOperation | null>(null);
  const [simpleLoraTarget, setSimpleLoraTarget] = useState<TemplateKind | null>(null);
  
  const [loraExampleFilesByHash, setLoraExampleFilesByHash] = useState<Record<string, LoraExampleMedia[]>>({});
  const loraExampleFilesByHashRef = useRef(loraExampleFilesByHash);
  useEffect(() => { loraExampleFilesByHashRef.current = loraExampleFilesByHash; }, [loraExampleFilesByHash]);
  
  const [exampleStatus, setExampleStatus] = useState<ExampleImagesStatus | null>(null);
  const [examplePending, setExamplePending] = useState<ExampleImagesPendingResult | null>(null);
  const [pullingExampleHashes, setPullingExampleHashes] = useState<string[]>([]);
  const [triggerWords, setTriggerWords] = useState<Record<string, string[]>>({});
  
  const examplePollRef = useRef<number | null>(null);
  const startPollingRef = useRef<() => void>(() => {});
  const refreshInfoRef = useRef<() => Promise<void>>(async () => {});

  const selectedLoraItems = useMemo(
    () => loraResult.items.filter((item) => selectedLoraPaths.includes(item.file_path)),
    [loraResult.items, selectedLoraPaths],
  );

  const loadManagedModelsPage = useCallback(async (
    modelType: ManagedModelType,
    query: LoraQueryState,
    pageNumber: number,
    options: { append: boolean; reloadFacets: boolean },
  ) => {
    if (loraLoadingRef.current) return;
    loraLoadingRef.current = true;
    setLoraLoading(true);
    try {
      const pagePromise = client.listManagedModels(modelType, { ...query, page: pageNumber });
      const facetsPromise = options.reloadFacets
        ? Promise.all([
          client.getManagedModelFolders(modelType),
          client.getManagedModelBaseModels(modelType),
          client.getManagedModelTopTags(modelType),
        ])
        : Promise.resolve<[string[], Array<{ name: string; count: number }>, string[]]>([loraFoldersRef.current, loraBaseModelsRef.current, loraTagsRef.current]);
      const [page, [folders, baseModels, tags]] = await Promise.all([pagePromise, facetsPromise]);
      setLoraResult((prev) => options.append
        ? { ...page, items: mergeManagedModelItems(prev.items, page.items) }
        : page);
      if (options.reloadFacets) {
        setLoraFolders(folders);
        setLoraBaseModels(baseModels);
        setLoraTags(tags);
        setSelectedLoraPaths([]);
      }
    } finally {
      loraLoadingRef.current = false;
      setLoraLoading(false);
    }
  }, [client]);

  const refreshLoras = useCallback(async (query = loraQueryRef.current) => {
    await loadManagedModelsPage(managedModelType, query, 1, { append: false, reloadFacets: true });
  }, [managedModelType, loadManagedModelsPage]);

  const loadMoreManagedModels = useCallback(async () => {
    const currentResult = loraResultRef.current;
    if (loraLoadingRef.current || currentResult.page >= currentResult.totalPages) return;
    await loadManagedModelsPage(managedModelType, loraQueryRef.current, currentResult.page + 1, { append: true, reloadFacets: false });
  }, [managedModelType, loadManagedModelsPage]);

  const changeManagedModelType = useCallback((nextType: ManagedModelType) => {
    if (nextType === managedModelType) return;
    setManagedModelType(nextType);
    setLoraQuery(defaultLoraQuery);
    setLoraResult(emptyLoraResult);
    setLoraFolders([]);
    setLoraBaseModels([]);
    setLoraTags([]);
    setSelectedLoraPaths([]);
    setLoraDetail(null);
    setLoraOperation(null);
  }, [managedModelType]);

  const updateLoraItem = useCallback((filePath: string, patch: Partial<LoraItem>) => {
    setLoraResult((prev) => ({
      ...prev,
      items: prev.items.map((item) => item.file_path === filePath ? { ...item, ...patch } : item),
    }));
    setLoraDetail((prev) => prev?.file_path === filePath ? { ...prev, ...patch } : prev);
  }, []);

  const toggleLoraFavorite = useCallback(async (item: LoraItem) => {
    const nextFavorite = !item.favorite;
    updateLoraItem(item.file_path, { favorite: nextFavorite });
    try {
      const result = await client.setManagedModelFavorite(managedModelType, item.file_path, nextFavorite);
      if (result.success === false) {
        throw new Error(result.error || "插件没有写回收藏状态");
      }
      pushToast("success", nextFavorite ? "已收藏 LoRA" : "已取消收藏", item.model_name || item.file_name);
    } catch (favoriteError) {
      updateLoraItem(item.file_path, { favorite: item.favorite });
      pushToast("error", "收藏写回失败", favoriteError instanceof Error ? favoriteError.message : String(favoriteError));
    }
  }, [client, managedModelType, updateLoraItem, pushToast]);

  const toggleLoraSelection = useCallback((item: LoraItem) => {
    setSelectedLoraPaths((prev) => prev.includes(item.file_path)
      ? prev.filter((path) => path !== item.file_path)
      : [...prev, item.file_path]);
  }, []);

  const selectVisibleLoras = useCallback(() => {
    const visiblePaths = loraResult.items.map((item) => item.file_path);
    const allSelected = visiblePaths.every((path) => selectedLoraPaths.includes(path));
    setSelectedLoraPaths((prev) => allSelected
      ? prev.filter((path) => !visiblePaths.includes(path))
      : uniqueStrings([...prev, ...visiblePaths]));
  }, [loraResult.items, selectedLoraPaths]);

  const refreshLoraListsAfterMutation = useCallback(async (message?: string) => {
    await refreshLoras();
    if (message) pushToast("success", message);
  }, [refreshLoras, pushToast]);

  const stopExampleStatusPolling = useCallback(() => {
    if (examplePollRef.current !== null) {
      window.clearInterval(examplePollRef.current);
      examplePollRef.current = null;
    }
  }, []);

  const refreshExampleImageInfo = useCallback(async () => {
    const [status, pending] = await Promise.all([
      client.getExampleImagesStatus(),
      client.checkExampleImagesNeeded([managedModelExampleType(managedModelType)]),
    ]);
    setExampleStatus(status);
    setExamplePending(pending);
    if (status.is_downloading) {
      startPollingRef.current();
    }
  }, [client, managedModelType]);

  const startExampleStatusPolling = useCallback(() => {
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
            refreshInfoRef.current().catch(() => undefined);
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
  }, [client, pushToast, refreshLoras, stopExampleStatusPolling]);

  // Keep refs updated so callbacks always call the latest version
  useEffect(() => { startPollingRef.current = startExampleStatusPolling; }, [startExampleStatusPolling]);
  useEffect(() => { refreshInfoRef.current = refreshExampleImageInfo; }, [refreshExampleImageInfo]);

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
  }, [client, managedModelType, pushToast, startExampleStatusPolling]);

  const pullLoraExamples = useCallback(async (item: LoraItem): Promise<LoraExampleMedia[]> => {
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
  }, [client, managedModelType, pushToast, refreshLoras, refreshExampleImageInfo, startExampleStatusPolling]);

  const openLoraExampleFolder = useCallback(async (item: LoraItem) => {
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
  }, [client, pushToast]);

  const loadTriggerWords = useCallback(async (item: LoraItem) => {
    if (managedModelType !== "loras") return;
    const key = item.model_name || item.file_name;
    const words = await client.getLoraTriggerWords(key);
    setTriggerWords((prev) => ({ ...prev, [key]: words }));
    pushToast(words.length ? "success" : "info", "触发词已读取", words.length ? words.join(", ") : "该 LoRA 暂无触发词");
  }, [client, managedModelType, pushToast]);

  const extractTriggerWords = useCallback(async (item: LoraItem, autoSave = false) => {
    if (managedModelType !== "loras") return;
    const key = item.model_name || item.file_name;
    try {
      pushToast("info", "正在从文件提取元数据...", item.file_name);
      const metadata = await client.extractLoraMetadata(item.file_path);
      
      // Look for common tags in safetensors metadata
      const tags = metadata.ss_tagger_tags || metadata.ss_trained_words || "";
      const words = uniqueStrings(tags.split(/[,，\n]+/).map(w => w.trim()).filter(Boolean));
      
      if (words.length > 0) {
        setTriggerWords((prev) => ({ ...prev, [key]: words }));
        
        if (autoSave) {
          try {
            await client.saveLoraTriggerWords(item.file_path, words);
            const nextCivitai = {
              ...((item.civitai as Record<string, unknown> | undefined) ?? {}),
              trainedWords: words,
            };
            updateLoraItem(item.file_path, { civitai: nextCivitai });
            pushToast("success", `成功提取并保存 ${words.length} 个触发词`, words.join(", "));
          } catch (saveError) {
            pushToast("error", "提取成功但保存失败", saveError instanceof Error ? saveError.message : String(saveError));
          }
        } else {
          pushToast("success", `成功提取 ${words.length} 个触发词`, words.join(", "));
        }
      } else {
        pushToast("info", "文件中未发现明显触发词元数据", "建议通过 Civitai 同步或手动编辑");
      }
      return words;
    } catch (error) {
      pushToast("error", "提取触发词失败", error instanceof Error ? error.message : String(error));
      return [];
    }
  }, [client, managedModelType, pushToast, updateLoraItem]);

  const saveLoraTriggerWords = useCallback(async (item: LoraItem, words: string[]) => {
    if (managedModelType !== "loras") return words;
    const key = item.model_name || item.file_name;
    const cleanWords = uniqueStrings(words.map((word) => word.trim()).filter(Boolean));
    const nextCivitai = {
      ...((item.civitai as Record<string, unknown> | undefined) ?? {}),
      trainedWords: cleanWords,
    };
    try {
      const result = await client.saveLoraTriggerWords(item.file_path, cleanWords);
      if (result.success === false) {
        throw new Error(result.error || "Trigger words save failed");
      }
      setTriggerWords((prev) => ({ ...prev, [key]: cleanWords }));
      updateLoraItem(item.file_path, { civitai: nextCivitai });
      pushToast("success", "触发词已同步", cleanWords.length ? cleanWords.join(", ") : "已清空触发词");
      return cleanWords;
    } catch (error) {
      pushToast("error", "触发词同步失败", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [client, managedModelType, pushToast, updateLoraItem]);

  const pauseExampleDownloads = useCallback(async () => {
    try {
      const result = await client.pauseExampleImages();
      if (result.success === false) throw new Error(result.error || "暂停失败");
      await refreshExampleImageInfo();
      pushToast("success", "示例图下载已暂停");
    } catch (pauseError) {
      pushToast("error", "暂停示例图失败", pauseError instanceof Error ? pauseError.message : String(pauseError));
    }
  }, [client, refreshExampleImageInfo, pushToast]);

  const resumeExampleDownloads = useCallback(async () => {
    try {
      const result = await client.resumeExampleImages();
      if (result.success === false) throw new Error(result.error || "恢复失败");
      startExampleStatusPolling();
      pushToast("success", "示例图下载已恢复");
    } catch (resumeError) {
      pushToast("error", "恢复示例图失败", resumeError instanceof Error ? resumeError.message : String(resumeError));
    }
  }, [client, startExampleStatusPolling, pushToast]);

  const stopExampleDownloads = useCallback(async () => {
    try {
      const result = await client.stopExampleImages();
      if (result.success === false) throw new Error(result.error || "停止失败");
      stopExampleStatusPolling();
      await refreshExampleImageInfo();
      pushToast("success", "示例图下载已停止");
    } catch (stopError) {
      pushToast("error", "停止示例图失败", stopError instanceof Error ? stopError.message : String(stopError));
    }
  }, [client, stopExampleStatusPolling, refreshExampleImageInfo, pushToast]);

  const renameLora = useCallback(async (item: LoraItem, newName: string) => {
    try {
      const result = await client.renameManagedModel(managedModelType, item.file_path, newName);
      if (result.success === false) throw new Error(result.error || "重命名失败");
      if (loraDetail?.file_path === item.file_path) {
        setLoraDetail(null);
      }
      await refreshLoraListsAfterMutation("LoRA 已重命名");
    } catch (error) {
      pushToast("error", "重命名失败", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [client, managedModelType, refreshLoraListsAfterMutation, pushToast]);

  const moveLora = useCallback(async (item: LoraItem, targetFolder: string) => {
    try {
      const result = await client.moveManagedModel(managedModelType, item.file_path, targetFolder, true);
      if (result.success === false) throw new Error(result.error || "移动失败");
      await refreshLoraListsAfterMutation("LoRA 已移动");
    } catch (error) {
      pushToast("error", "移动失败", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [client, managedModelType, refreshLoraListsAfterMutation, pushToast]);

  const deleteLora = useCallback(async (item: LoraItem) => {
    try {
      const result = await client.deleteManagedModel(managedModelType, item.file_path);
      if (result.success === false) throw new Error(result.error || "删除失败");
      await refreshLoraListsAfterMutation("LoRA 已删除");
    } catch (error) {
      pushToast("error", "删除失败", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [client, managedModelType, refreshLoraListsAfterMutation, pushToast]);

  const bulkMoveLoras = useCallback(async (paths: string[], targetFolder: string) => {
    try {
      const result = await client.bulkMoveManagedModels(managedModelType, paths, targetFolder, true);
      if (result.success === false) throw new Error(result.error || "批量移动失败");
      await refreshLoraListsAfterMutation(`已移动 ${paths.length} 个 LoRA`);
    } catch (error) {
      pushToast("error", "批量移动失败", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [client, managedModelType, refreshLoraListsAfterMutation, pushToast]);

  const bulkDeleteLoras = useCallback(async (paths: string[]) => {
    try {
      const result = await client.bulkDeleteManagedModels(managedModelType, paths);
      if (result.success === false) throw new Error(result.error || "批量删除失败");
      await refreshLoraListsAfterMutation(`已删除 ${paths.length} 个 LoRA`);
    } catch (error) {
      pushToast("error", "批量删除失败", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [client, managedModelType, refreshLoraListsAfterMutation, pushToast]);

  const syncCivitai = useCallback(async (item: LoraItem) => {
    try {
      const result = await client.refreshManagedModelCivitaiMetadata(managedModelType, item.file_path);
      if (!result) throw new Error("同步失败");
      await refreshLoraListsAfterMutation("Civitai 元数据已同步");
    } catch (error) {
      pushToast("error", "同步失败", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [client, managedModelType, refreshLoraListsAfterMutation, pushToast]);

  const updateLoraSettings = useCallback(async (nextSettings: LoraManagerSettings) => {
    try {
      const result = await client.updateLoraManagerSettings(nextSettings);
      if (result.success === false) throw new Error(result.error || "设置保存失败");
      const normalized = normalizeLoraManagerSettings(result.settings ?? nextSettings);
      setLoraSettings(normalized);
      pushToast("success", "设置已保存");
      return normalized;
    } catch (error) {
      pushToast("error", "设置保存失败", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [client, pushToast]);

  const doctorAction = useCallback(async (action: "repair" | "resolve" | "export") => {
    try {
      const result = action === "repair"
        ? await client.repairDoctorCache()
        : action === "resolve"
          ? await client.resolveDoctorFilenameConflicts()
          : await client.exportDoctorBundle();
      if (result.success === false) throw new Error(result.error || "医生操作失败");
      pushToast("success", "医生操作完成", String(result.message || result.path || result.bundle_path || ""));
      return result;
    } catch (error) {
      pushToast("error", "医生操作失败", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [client, pushToast]);

  // Effects
  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshLoras(loraQuery).catch(() => undefined);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [client, managedModelType, loraQuery.search, loraQuery.folder, loraQuery.baseModel, loraQuery.tag, loraQuery.pageSize, refreshLoras]);

  useEffect(() => {
    let canceled = false;
    const missingHashes = activeLoraHashes.filter((hash) => !(hash in loraExampleFilesByHash));
    if (missingHashes.length === 0) return;

    async function loadLocalExampleFiles() {
      const entries = await Promise.all(
        missingHashes.map(async (hash) => {
          const files = await client.getLoraExampleFiles(hash).catch(() => []);
          return [hash, files] as const;
        }),
      );
      if (canceled) return;
      setLoraExampleFilesByHash((prev) => {
        const next = { ...prev };
        for (const [hash, files] of entries) {
          next[hash] = files;
        }
        return next;
      });
    }

    loadLocalExampleFiles();
    return () => {
      canceled = true;
    };
  }, [client, activeLoraHashes, loraExampleFilesByHash]);

  useEffect(() => {
    if (tab !== "loras") return;
    refreshExampleImageInfo().catch((infoError) => {
      pushToast("error", "示例图状态读取失败", infoError instanceof Error ? infoError.message : String(infoError));
    });
  }, [client, tab, managedModelType, refreshExampleImageInfo]);

  useEffect(() => {
    return () => {
      stopExampleStatusPolling();
    };
  }, [stopExampleStatusPolling]);

  return useMemo(() => ({
    managedModelType,
    setManagedModelType,
    loraResult,
    loraQuery,
    setLoraQuery,
    loraLoading,
    loraFolders,
    loraBaseModels,
    loraTags,
    loraTarget,
    setLoraTarget,
    loraDensity,
    setLoraDensity,
    loraDetail,
    setLoraDetail,
    selectedLoraPaths,
    setSelectedLoraPaths,
    loraOperation,
    setLoraOperation,
    loraSettings,
    setLoraSettings,
    simpleLoraTarget,
    setSimpleLoraTarget,
    selectedLoraItems,
    loraExampleFilesByHash,
    exampleStatus,
    examplePending,
    pullingExampleHashes,
    triggerWords,
    loadManagedModelsPage,
    refreshLoras,
    loadMoreManagedModels,
    changeManagedModelType,
    updateLoraItem,
    toggleLoraFavorite,
    toggleLoraSelection,
    selectVisibleLoras,
    refreshLoraListsAfterMutation,
    refreshExampleImageInfo,
    startExampleStatusPolling,
    stopExampleStatusPolling,
    pullAllLoraExamples,
    pullLoraExamples,
    openLoraExampleFolder,
    loadTriggerWords,
    extractTriggerWords,
    saveLoraTriggerWords,
    pauseExampleDownloads,
    resumeExampleDownloads,
    stopExampleDownloads,
    renameLora,
    moveLora,
    deleteLora,
    bulkMoveLoras,
    bulkDeleteLoras,
    syncCivitai,
    updateLoraSettings,
    doctorAction,
  }), [
    managedModelType,
    loraResult,
    loraQuery,
    loraLoading,
    loraFolders,
    loraBaseModels,
    loraTags,
    loraTarget,
    loraDensity,
    loraDetail,
    selectedLoraPaths,
    loraOperation,
    loraSettings,
    simpleLoraTarget,
    selectedLoraItems,
    loraExampleFilesByHash,
    exampleStatus,
    examplePending,
    pullingExampleHashes,
    triggerWords,
    loadManagedModelsPage,
    refreshLoras,
    loadMoreManagedModels,
    changeManagedModelType,
    updateLoraItem,
    toggleLoraFavorite,
    toggleLoraSelection,
    selectVisibleLoras,
    refreshLoraListsAfterMutation,
    refreshExampleImageInfo,
    startExampleStatusPolling,
    stopExampleStatusPolling,
    pullAllLoraExamples,
    pullLoraExamples,
    openLoraExampleFolder,
    loadTriggerWords,
    extractTriggerWords,
    saveLoraTriggerWords,
    pauseExampleDownloads,
    resumeExampleDownloads,
    stopExampleDownloads,
    renameLora,
    moveLora,
    deleteLora,
    bulkMoveLoras,
    bulkDeleteLoras,
    syncCivitai,
    updateLoraSettings,
    doctorAction,
  ]);
}

export type UseLorasResult = ReturnType<typeof useLoras>;

export function makeLoraSelection(item: LoraItem, localFiles: LoraItem[] | any[], strength = 1): LoraSelection {
  const previewMedia = pickCardPreviewMedia(item, localFiles);
  return {
    name: loraSyntaxName(item),
    displayName: item.model_name,
    strength,
    clipStrength: strength,
    active: true,
    filePath: item.file_path,
    sha256: item.sha256,
    previewUrl: previewMedia.path || previewMedia.url || item.preview_url,
  };
}

export function appendLoraToCollection(prev: LoraSelection[], selection: LoraSelection) {
  return mergeLora(prev, selection);
}

export const loraTargetLabel = (target: TemplateKind) => templateLabels[target];
