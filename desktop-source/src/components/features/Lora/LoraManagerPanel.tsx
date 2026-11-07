import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { UIEvent } from "react";
import {
  Boxes,
  Download,
  Image as ImageIcon,
  RefreshCw,
} from "lucide-react";

import type {
  ExampleImagesPendingResult,
  ExampleImagesStatus,
  LoraExampleMedia,
  LoraItem,
  LoraListResult,
  LoraManagerSettings,
  LoraQueryState,
  ManagedModelType,
  LoraInsertTarget,
} from "../../../types";

import {
  buildFolderTree,
  extractItemTrainedWords,
} from "../../../lib/lora-helper";
import {
  getItemNsfwLevel,
  normalizeMatureBlurLevel,
} from "../../../lib/nsfw";
import { pickCardPreviewMedia } from "../../../lib/lora-media";
import { managedModelLabel } from "../../../constants";
import { ExampleImagesProgressBar, Select } from "../../ui";
import { FolderSidebar } from "./FolderSidebar";
import { LoraCard } from "./LoraCard";

const EMPTY_ARRAY: LoraItem[] = [];

export const LoraManagerPanel = memo(({
  modelType,
  onModelTypeChange,
  result,
  query,
  setQuery,
  loading,
  hasMore,
  folders,
  baseModels,
  tags,
  density,
  setDensity,
  triggerWords,
  onRefresh,
  onLoadMore,
  onDetail,
  onInsert,
  exampleStatus,
  examplePending,
  pullingExampleHashes,
  localExampleFilesByHash,
  onPullAllExamples,
  apiBase,
  settings,
  isSimple,
  simpleLabel,
  onSimpleInsert,
}: {
  modelType: ManagedModelType;
  onModelTypeChange: (modelType: ManagedModelType) => void;
  result: LoraListResult;
  query: LoraQueryState;
  setQuery: (updater: (prev: LoraQueryState) => LoraQueryState) => void;
  loading: boolean;
  hasMore: boolean;
  folders: string[];
  baseModels: Array<{ name: string; count: number }>;
  tags: string[];
  density: "compact" | "medium" | "large";
  setDensity: (density: "compact" | "medium" | "large") => void;
  triggerWords: Record<string, string[]>;
  onRefresh: () => void | Promise<void>;
  onLoadMore: () => void | Promise<void>;
  onDetail: (item: LoraItem) => void;
  onInsert?: (item: LoraItem, target: LoraInsertTarget) => void;
  exampleStatus: ExampleImagesStatus | null;
  examplePending: ExampleImagesPendingResult | null;
  pullingExampleHashes: string[];
  localExampleFilesByHash: Record<string, LoraExampleMedia[]>;
  onPullAllExamples: () => void | Promise<void>;
  apiBase: string;
  settings: LoraManagerSettings;
  isSimple?: boolean;
  /** 简易模式下的插入目标名（只渲染一个「添加到 X」按钮，避免 6 个按钮指错目标） */
  simpleLabel?: string;
  onSimpleInsert?: (item: LoraItem) => void;
}) => {
  const isLora = modelType === "loras";
  const modelLabel = managedModelLabel(modelType);
  const visibleItems = result.items;
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const exampleProgress = exampleStatus?.status;
  const exampleDownloading = Boolean(exampleStatus?.is_downloading);
  const exampleSinglePulling = pullingExampleHashes.length > 0;
  const exampleBusy = exampleDownloading || exampleSinglePulling;
  const exampleStatusText = exampleDownloading
    ? `示例图拉取中 ${exampleProgress?.completed ?? 0}/${exampleProgress?.total ?? 0}`
    : exampleSinglePulling
      ? `单独拉取中 ${pullingExampleHashes.length} 个`
      : examplePending
        ? `示例图：待拉取 ${examplePending.pending_count} / 失败 ${examplePending.failed_count}`
        : "示例图状态未读取";
  const matureBlurLevel = normalizeMatureBlurLevel(settings.mature_blur_level);
  const matureBlurEnabled = settings.blur_mature_content !== false;
  const modelScrollRef = useRef<HTMLDivElement | null>(null);
  
  const updateQuery = useCallback((patch: Partial<LoraQueryState>) => {
    setQuery((prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }));
  }, [setQuery]);

  const handleFolderSelect = useCallback((folder: string) => {
     updateQuery({ folder });
   }, [updateQuery]);

   const handleBaseModelSelect = useCallback((value: string) => {
    updateQuery({ baseModel: value });
  }, [updateQuery]);

  const handleTagSelect = useCallback((value: string) => {
    updateQuery({ tag: value });
  }, [updateQuery]);

  const handleDensityChange = useCallback((value: string) => {
    setDensity(value as "compact" | "medium" | "large");
  }, [setDensity]);

  useEffect(() => {
    modelScrollRef.current?.scrollTo({ top: 0 });
  }, [modelType, query.search, query.folder, query.baseModel, query.tag]);

  function handleModelScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    if (!hasMore || loading) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 520) {
      void onLoadMore();
    }
  }

  return (
    <div className={isLora ? "lora-manager lm-plugin-shell" : "lora-manager lm-plugin-shell embedding-mode"}>
      <div className="lm-manager-head" style={isSimple ? { borderBottom: "none", paddingBottom: 0, marginBottom: -10 } : undefined}>
        {!isSimple && (
          <div className="lm-manager-title">
            <Boxes size={20} />
            <span>LoRA 管理器</span>
          </div>
        )}
        <div className="lm-plugin-nav lm-model-type-nav" role="navigation" aria-label="Model type">
          {[
            ["loras", "LoRA"],
            ["embeddings", "Embedding"],
          ].map(([value, label]) => (
            <button key={value} type="button" className={modelType === value ? "active" : ""} onClick={() => onModelTypeChange(value as ManagedModelType)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="lora-plugin-toolbar lm-plugin-toolbar">
        <span className="az-select lm-sort-badge" title="列表按名称 A - Z 排序（后端默认）">A - Z</span>
        <button type="button" className="icon-button" onClick={() => onRefresh()}><RefreshCw size={15} /> 刷新</button>
        <button type="button" className="icon-button lm-example-download-btn" disabled={exampleBusy} onClick={() => onPullAllExamples()}>
          <Download size={15} />
          {exampleBusy ? "拉取中" : "一键拉取示例图"}
        </button>
      </div>

      <div className="lm-browser">
        <FolderSidebar
          label={modelLabel}
          folders={folderTree}
          selected={query.folder}
          total={result.total}
          onSelect={handleFolderSelect}
        />
        <div className="lm-model-area">
          <div className="lora-filter-row lm-filter-row">
            <Select
              ariaLabel="按文件夹筛选"
              block
              value={query.folder}
              onChange={handleFolderSelect}
              options={[{ value: "", label: "全部文件夹" }, ...folders.map((folder) => ({ value: folder, label: folder }))]}
            />
            <Select
              ariaLabel="按模型类型筛选"
              block
              value={query.baseModel}
              onChange={handleBaseModelSelect}
              options={[
                { value: "", label: "全部模型类型" },
                ...baseModels.map((item) => ({ value: item.name, label: `${item.name} (${item.count})` })),
              ]}
            />
            <Select
              ariaLabel="按标签筛选"
              block
              value={query.tag}
              onChange={handleTagSelect}
              options={[{ value: "", label: "全部标签" }, ...tags.map((tag) => ({ value: tag, label: tag }))]}
            />
            <Select
              ariaLabel="卡片密度"
              block
              value={density}
              onChange={handleDensityChange}
              options={[
                { value: "compact", label: "紧凑" },
                { value: "medium", label: "中等" },
                { value: "large", label: "大图" },
              ]}
            />
          </div>

          <div className="lora-summary lm-summary">
            <span className="lm-loaded-count">已加载 {visibleItems.length} / {result.total} {modelLabel}</span>
            <span className={matureBlurEnabled ? "lm-restriction-status active" : "lm-restriction-status"}>
              限制级：{matureBlurEnabled ? `${matureBlurLevel}+ 模糊` : "不模糊"}
            </span>
            {query.folder && <span>文件夹：{query.folder}</span>}
            <span className={exampleBusy ? "lm-example-status running" : "lm-example-status"} title={exampleProgress?.current_model || undefined}>
              {exampleBusy ? <RefreshCw size={13} /> : <ImageIcon size={13} />}
              {exampleStatusText}
            </span>
          </div>
          <ExampleImagesProgressBar status={exampleStatus} pullingCount={pullingExampleHashes.length} />

          <div className="lm-model-scroll" ref={modelScrollRef} onScroll={handleModelScroll}>
            <div className={`lora-grid lm-card-grid density-${density}`}>
              {visibleItems.map((item) => {
                const key = item.model_name || item.file_name;
                const hash = item.sha256?.toLowerCase();
                const localFiles = hash ? localExampleFilesByHash[hash] ?? EMPTY_ARRAY : EMPTY_ARRAY;
                const words = triggerWords[key] ?? extractItemTrainedWords(item);
                const previewNsfwLevel = getItemNsfwLevel(item);
                const previewMedia = pickCardPreviewMedia(item, localFiles);

                return (
                  <LoraCard
                    key={item.file_path}
                    item={item}
                    words={words}
                    previewNsfwLevel={previewNsfwLevel}
                    previewUrl={previewMedia.url}
                    previewPath={previewMedia.path}
                    previewType={previewMedia.type}
                    previewSource={previewMedia.source}
                    settings={settings}
                    apiBase={apiBase}
                    onDetail={onDetail}
                    onInsert={onInsert}
                    simpleLabel={simpleLabel}
                    onSimpleInsert={onSimpleInsert}
                  />
                );
              })}
              {visibleItems.length === 0 && <div className="empty-strip">没有匹配的 {modelLabel}，试试清空搜索或切换筛选</div>}
            </div>
            <div className="lm-load-status">
              {loading ? "正在加载..." : hasMore ? "滚动到底部继续加载" : `已加载全部 ${visibleItems.length} 个 ${modelLabel}`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

