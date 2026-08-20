import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIEvent } from "react";
import {
  Boxes,
  Download,
  GripVertical,
  Image as ImageIcon,
  RefreshCw,
  X,
} from "lucide-react";

import type {
  ExampleImagesPendingResult,
  ExampleImagesStatus,
  LoraExampleMedia,
  LoraItem,
  LoraListResult,
  LoraManagerSettings,
  LoraQueryState,
  LoraSelection,
  ManagedModelType,
  TemplateKind,
} from "../../../types";

import {
  buildFolderTree,
  extractItemTrainedWords,
  loraSyntaxName,
} from "../../../lib/lora-helper";
import {
  getItemNsfwLevel,
  normalizeMatureBlurLevel,
} from "../../../lib/nsfw";
import { isVideoPath, pickCardPreviewMedia } from "../../../lib/lora-media";
import { managedModelLabel } from "../../../constants";
import { ExampleImagesProgressBar } from "../../ui";
import { FolderSidebar } from "./FolderSidebar";
import { LoraChips } from "./LoraChips";
import { LoraCard } from "./LoraCard";
import { LoraMedia } from "./LoraMedia";

const EMPTY_ARRAY: any[] = [];

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
  onInsert?: (item: LoraItem, target: TemplateKind) => void;
  exampleStatus: ExampleImagesStatus | null;
  examplePending: ExampleImagesPendingResult | null;
  pullingExampleHashes: string[];
  localExampleFilesByHash: Record<string, LoraExampleMedia[]>;
  onPullAllExamples: () => void | Promise<void>;
  apiBase: string;
  settings: LoraManagerSettings;
  isSimple?: boolean;
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

   const handleBaseModelSelect = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    updateQuery({ baseModel: event.target.value });
  }, [updateQuery]);

  const handleTagSelect = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    updateQuery({ tag: event.target.value });
  }, [updateQuery]);

  const handleDensityChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setDensity(event.target.value as "compact" | "medium" | "large");
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
        <select className="az-select" value="az" onChange={() => undefined} title="排序">
          <option value="az">A - Z</option>
        </select>
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
            <select value={query.folder} onChange={(e) => handleFolderSelect(e.target.value)}>
              <option value="">全部文件夹</option>
              {folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
            </select>
            <select value={query.baseModel} onChange={handleBaseModelSelect}>
              <option value="">全部模型类型</option>
              {baseModels.map((item) => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}
            </select>
            <select value={query.tag} onChange={handleTagSelect}>
              <option value="">全部标签</option>
              {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
            <select value={density} onChange={handleDensityChange}>
              <option value="compact">紧凑</option>
              <option value="medium">中等</option>
              <option value="large">大图</option>
            </select>
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

