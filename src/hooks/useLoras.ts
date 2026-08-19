import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ComfyClient } from "../lib/comfyClient";
import { mergeManagedModelItems, uniqueStrings, loraSyntaxName, mergeLora } from "../lib/lora-helper";
import { pickCardPreviewMedia } from "../lib/lora-media";
import type {
  LoraItem,
  LoraListResult,
  LoraManagerSettings,
  LoraOperation,
  LoraQueryState,
  LoraSelection,
  ManagedModelType,
  TemplateKind,
  Toast,
} from "../types";
import { defaultLoraQuery, emptyLoraResult, templateLabels } from "../constants";

type ToastFn = (type: Toast["type"], title: string, message?: string) => void;

export function useLoras({ client, pushToast }: { client: ComfyClient; pushToast: ToastFn }) {
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
  const [loraSettings, setLoraSettings] = useState<LoraManagerSettings>({ blur_mature_content: true, mature_blur_level: "R" });
  const [simpleLoraTarget, setSimpleLoraTarget] = useState<TemplateKind | null>(null);

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

  function updateLoraItem(filePath: string, patch: Partial<LoraItem>) {
    setLoraResult((prev) => ({
      ...prev,
      items: prev.items.map((item) => item.file_path === filePath ? { ...item, ...patch } : item),
    }));
    setLoraDetail((prev) => prev?.file_path === filePath ? { ...prev, ...patch } : prev);
  }

  async function toggleLoraFavorite(item: LoraItem) {
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
  }

  function toggleLoraSelection(item: LoraItem) {
    setSelectedLoraPaths((prev) => prev.includes(item.file_path)
      ? prev.filter((path) => path !== item.file_path)
      : [...prev, item.file_path]);
  }

  function selectVisibleLoras() {
    const visiblePaths = loraResult.items.map((item) => item.file_path);
    const allSelected = visiblePaths.every((path) => selectedLoraPaths.includes(path));
    setSelectedLoraPaths((prev) => allSelected
      ? prev.filter((path) => !visiblePaths.includes(path))
      : uniqueStrings([...prev, ...visiblePaths]));
  }

  async function refreshLoraListsAfterMutation(message?: string) {
    await refreshLoras();
    if (message) pushToast("success", message);
  }

  return {
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
    loraResultRef,
    loraQueryRef,
    loadManagedModelsPage,
    refreshLoras,
    loadMoreManagedModels,
    changeManagedModelType,
    updateLoraItem,
    toggleLoraFavorite,
    toggleLoraSelection,
    selectVisibleLoras,
    refreshLoraListsAfterMutation,
  };
}

export type UseLorasResult = ReturnType<typeof useLoras>;

// 以下为 App 层组合函数所需的纯逻辑
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