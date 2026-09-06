import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { NotifierSettingsPanel } from "../../NotifierSettingsPanel";
import {
  BadgePlus,
  Brain,
  CheckCircle2,
  Columns,
  Copy,
  Download,
  FileText,
  Film,
  FolderOpen,
  GalleryHorizontalEnd,
  Globe2,
  Image as ImageIcon,
  Info,
  Loader2,
  Maximize2,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  ScanSearch,
  Settings,
  Trash2,
  X,
} from "lucide-react";

import type {
  DoctorDiagnostic,
  DownloadProgress,
  ExampleImagesStatus,
  LoraDuplicateGroup,
  LoraExampleMedia,
  LoraItem,
  LoraManagerSettings,
  LoraMediaMeta,
  LoraMetadata,
  LoraOperation,
  LoraUpdateRecord,
  ManagedModelType,
  TemplateKind,
  Toast,
  TranslationSettings,
} from "../../../types";
import { TranslationProvider } from "../../../lib/translation";

import { ComfyClient } from "../../../lib/comfyClient";
import {
  buildLoraCivitaiUrl,
  extractItemTrainedWords,
  formatStrength,
  loraModelId,
  loraSyntaxName,
  normalizeLoraManagerSettings,
  normalizePreview,
  parseTriggerWordsInput,
  uniqueStrings,
  updateRecordModelId,
} from "../../../lib/lora-helper";
import { formatBytes } from "../../../lib/file-helper";
import {
  getItemNsfwLevel,
  getMediaNsfwLevel,
  normalizeMatureBlurLevel,
  shouldBlurNsfwLevel,
} from "../../../lib/nsfw";
import { validMatureBlurLevels } from "../../../constants";
import { buildLoraExamples, isLoraVideo, pickCardPreviewMedia } from "../../../lib/lora-media";
import { operationTitle } from "../../../lib/app-utils";
import { ModalFrame, InfoItem, TagCloud, PromptBlock, NumberField } from "../../ui";
import { LoraMedia } from "./LoraMedia";

// --- Sub Components ---

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="field text-field">
      <span>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function ItemList({ items }: { items: LoraItem[] }) {
  return (
    <div className="operation-list">
      {items.map((item) => (
        <div className="lm-list-row" key={loraModelId(item)}>
          <div className="lm-list-row-main">
            <div className="lm-list-row-name">{item.file_name}</div>
            <div className="lm-list-row-path">{item.file_path}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DuplicatePane({ duplicates, filenameConflicts, onDeleteCopies }: { duplicates: LoraDuplicateGroup[]; filenameConflicts: LoraDuplicateGroup[]; onDeleteCopies: (items: LoraItem[]) => void }) {
  const groups = [...duplicates, ...filenameConflicts];
  return (
    <div className="lm-list-pane">
      <div className="section-toolbar">
        <strong>重复组 {groups.length}</strong>
      </div>
      {groups.length === 0 && <div className="empty-strip">没有发现重复项或文件名冲突</div>}
      {groups.map((group, index) => {
        const copies = group.models.slice(1);
        return (
          <div className="duplicate-group" key={`${group.hash ?? group.filename ?? index}`}>
            <div className="section-toolbar">
              <strong>{group.hash ?? group.filename ?? `重复组 ${index + 1}`}</strong>
              <button type="button" className="lm-text-btn danger" disabled={!copies.length} onClick={() => onDeleteCopies(copies)}><Trash2 size={13} /> 删除副本</button>
            </div>
            <ItemList items={group.models} />
          </div>
        );
      })}
    </div>
  );
}

function UpdatesPane({ modelType, records, client, onRefresh, onToast }: { modelType: ManagedModelType; records: LoraUpdateRecord[]; client: ComfyClient; onRefresh: () => void | Promise<void>; onToast: (type: Toast["type"], title: string, message?: string) => void }) {
  async function ignore(record: LoraUpdateRecord) {
    const modelId = updateRecordModelId(record);
    if (!modelId) return;
    try {
      const result = await client.ignoreManagedModelUpdate(modelType, modelId, !Boolean(record.shouldIgnore ?? record.should_ignore));
      if (result.success === false) throw new Error(result.error || "忽略更新失败");
      onToast("success", "更新状态已写回");
      await onRefresh();
    } catch (error) {
      onToast("error", "忽略更新失败", error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="lm-list-pane">
      <div className="section-toolbar">
        <strong>可更新 LoRA {records.length}</strong>
        <button type="button" className="lm-text-btn" onClick={() => onRefresh()}><RefreshCw size={13} /> 重新检查</button>
      </div>
      {records.length === 0 && <div className="empty-strip">没有发现可更新版本</div>}
      {records.map((record) => (
        <div className="lm-list-row" key={updateRecordModelId(record) ?? JSON.stringify(record).slice(0, 48)}>
          <div>
            <strong>{String(record.modelName ?? record.model_name ?? updateRecordModelId(record) ?? "未知模型")}</strong>
            <span>{String(record.latest_version_id ?? record.latestVersionId ?? "")}</span>
          </div>
          <button type="button" className="lm-text-btn" onClick={() => ignore(record)}>
            {record.shouldIgnore || record.should_ignore ? "恢复更新" : "忽略更新"}
          </button>
        </div>
      ))}
    </div>
  );
}

function DoctorPane({ diagnostics, rawData, onAction }: { diagnostics: DoctorDiagnostic[]; rawData: unknown; onAction: (action: "repair" | "resolve" | "export") => void | Promise<void> }) {
  return (
    <div className="lm-list-pane">
      <div className="operation-actions">
        <button type="button" className="primary-action" onClick={() => onAction("repair")}><RefreshCw size={16} /> 修复缓存</button>
        <button type="button" className="icon-button" onClick={() => onAction("resolve")}><Copy size={16} /> 解决文件名冲突</button>
        <button type="button" className="icon-button" onClick={() => onAction("export")}><FileText size={16} /> 导出诊断包</button>
      </div>
      {diagnostics.length === 0 && <pre className="json-preview">{JSON.stringify(rawData, null, 2)}</pre>}
      {diagnostics.map((item, index) => (
        <div className={`doctor-row ${String(item.status ?? item.severity ?? "info").toLowerCase()}`} key={item.key ?? item.label ?? index}>
          <strong>{String(item.label ?? item.title ?? item.key ?? `检查 ${index + 1}`)}</strong>
          <span>{String(item.status ?? item.severity ?? "")}</span>
          <p>{String(item.message ?? item.details ?? "")}</p>
        </div>
      ))}
    </div>
  );
}

function TriggerWordsPanel({
  words,
  onRead,
  onExtract,
  onSave,
  onCopy,
  onInsertWords,
}: {
  words: string[];
  onRead: () => void;
  onExtract?: () => void;
  onSave: (words: string[]) => Promise<string[]>;
  onCopy: (text: string) => void;
  onInsertWords?: (target: TemplateKind, words: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftWords, setDraftWords] = useState<string[]>(words);
  const [draftInput, setDraftInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraftWords(words);
    }
  }, [editing, words]);

  function startEditing() {
    setDraftWords(words);
    setDraftInput("");
    setEditing(true);
  }

  function addDraftWords(value = draftInput) {
    const nextWords = parseTriggerWordsInput(value);
    if (nextWords.length === 0) return;
    setDraftWords((current) => uniqueStrings([...current, ...nextWords]));
    setDraftInput("");
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addDraftWords();
    }
    if (event.key === "Escape") {
      setDraftInput("");
    }
  }

  async function saveDraftWords() {
    setSaving(true);
    try {
      const savedWords = await onSave(uniqueStrings([...draftWords, ...parseTriggerWordsInput(draftInput)]));
      setDraftWords(savedWords);
      setDraftInput("");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const visibleWords = editing ? draftWords : words;

  return (
    <div className={editing ? "lm-info-item lm-trigger-words editing" : "lm-info-item lm-trigger-words"}>
      <div className="lm-section-head">
        <label>触发词</label>
        <div className="lm-trigger-actions">
          {!editing && visibleWords.length > 0 && onInsertWords && (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginRight: '8px', paddingRight: '8px', borderRight: '1px solid var(--border-color)' }}>
              <button type="button" className="lm-text-btn" onClick={() => onInsertWords('default', visibleWords)} title="追加到默认生图正向提示词"><BadgePlus size={14} /> 默认</button>
              <button type="button" className="lm-text-btn" onClick={() => onInsertWords('multi', visibleWords)} title="追加到多人工作流正向提示词"><BadgePlus size={14} /> 多人</button>
              <button type="button" className="lm-text-btn" onClick={() => onInsertWords('highres', visibleWords)} title="追加到高清修复正向提示词"><BadgePlus size={14} /> 高修</button>
            </div>
          )}
          {!editing && onExtract && <button type="button" className="lm-text-btn" onClick={onExtract} title="从 .safetensors 文件头中提取训练词并保存 (ss_tagger_tags)"><ScanSearch size={14} /> 提取并保存</button>}
          {!editing && <button type="button" className="lm-text-btn" onClick={onRead}><Brain size={14} /> 读取</button>}
          {!editing && <button type="button" className="lm-text-btn" onClick={startEditing}><Plus size={14} /> 编辑</button>}
          {editing && <button type="button" className="lm-text-btn" disabled={saving} onClick={saveDraftWords}><CheckCircle2 size={14} /> 保存</button>}
          {editing && <button type="button" className="lm-text-btn" disabled={saving} onClick={() => { setDraftWords(words); setDraftInput(""); setEditing(false); }}><X size={14} /> 取消</button>}
        </div>
      </div>
      {editing && (
        <div className="lm-trigger-editor">
          <input
            value={draftInput}
            placeholder="添加触发词，回车确认"
            onChange={(event) => setDraftInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <button type="button" className="lm-text-btn" onClick={() => addDraftWords()}><Plus size={14} /> 添加</button>
        </div>
      )}
      <div className="lm-trigger-tags">
        {visibleWords.length === 0 && <span className="muted-text">暂无触发词</span>}
        {visibleWords.map((word) => (
          <button type="button" key={word} onClick={() => editing ? undefined : onCopy(word)}>
            <span>{word}</span>
            {editing ? (
              <X
                size={13}
                onClick={(event) => {
                  event.stopPropagation();
                  setDraftWords((current) => current.filter((item) => item !== word));
                }}
              />
            ) : (
              <Copy size={13} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function LoraExampleMetadata({ meta, onToast }: { meta: LoraMediaMeta; onToast: (type: Toast["type"], title: string, message?: string) => void }) {
  const prompt = String(meta.prompt ?? "");
  const negative = String(meta.negativePrompt ?? meta.negative_prompt ?? "");
  const params = [
    ["Size", meta.Size],
    ["Seed", meta.seed],
    ["Steps", meta.steps],
    ["Sampler", meta.sampler],
    ["CFG", meta.cfgScale],
    ["Clip Skip", meta.clipSkip],
    ["Model", meta.Model],
  ].filter(([, value]) => value !== undefined && value !== "");
  const hasMeta = params.length > 0 || prompt || negative;
  if (!hasMeta) {
    return <div className="lm-metadata-panel no-meta"><Info size={15} /> 没有生成参数</div>;
  }
  const copy = (title: string, text: string) => {
    navigator.clipboard?.writeText(text);
    onToast("success", `${title} 已复制`);
  };
  return (
    <div className="lm-metadata-panel">
      {params.length > 0 && (
        <div className="lm-param-tags">
          {params.map(([name, value]) => (
            <span key={name}><strong>{name}:</strong> {String(value)}</span>
          ))}
        </div>
      )}
      {prompt && <PromptBlock label="Prompt" value={prompt} onCopy={() => copy("Prompt", prompt)} />}
      {negative && <PromptBlock label="Negative Prompt" value={negative} onCopy={() => copy("Negative Prompt", negative)} />}
    </div>
  );
}

function LoraExampleCard({
  media,
  apiBase,
  index,
  onToast,
  settings,
  fallbackNsfwLevel = 0,
  onOpenMedia,
}: {
  media: LoraExampleMedia;
  apiBase: string;
  index: number;
  onToast: (type: Toast["type"], title: string, message?: string) => void;
  settings: LoraManagerSettings;
  fallbackNsfwLevel?: number;
  onOpenMedia?: (media: LoraExampleMedia, index: number) => void;
}) {
  const src = normalizePreview(apiBase, media.path || media.url);
  const meta = media.meta ?? {};
  const label = media.source === "local" ? "Local" : media.source === "preview" ? "Preview" : src ? "Civitai" : "Missing";
  const nsfwLevel = getMediaNsfwLevel(media, fallbackNsfwLevel);
  const canOpenMedia = Boolean(src) && !isLoraVideo(media, src);
  return (
    <article className={shouldBlurNsfwLevel(nsfwLevel, settings) ? "lm-example-card nsfw-content" : "lm-example-card"} data-nsfw-level={nsfwLevel}>
      <div className="lm-example-media">
        <div className="lm-media-badge">{isLoraVideo(media, src) ? <Film size={14} /> : <ImageIcon size={14} />} {label} #{index + 1}</div>
        {canOpenMedia && (
          <button type="button" className="lm-media-open-btn" title="查看大图" onClick={() => onOpenMedia?.(media, index)}>
            <Maximize2 size={15} />
          </button>
        )}
        <LoraMedia
          media={media}
          apiBase={apiBase}
          alt={`示例 ${index + 1}`}
          controls
          settings={settings}
          fallbackNsfwLevel={fallbackNsfwLevel}
          onOpen={canOpenMedia ? () => onOpenMedia?.(media, index) : undefined}
        />
      </div>
      <LoraExampleMetadata meta={meta} onToast={onToast} />
    </article>
  );
}

function MediaLightbox({
  media,
  apiBase,
  alt,
  settings,
  fallbackNsfwLevel,
  onClose,
}: {
  media: LoraExampleMedia;
  apiBase: string;
  alt: string;
  settings: LoraManagerSettings;
  fallbackNsfwLevel: number;
  onClose: () => void;
}) {
  return (
    <div className="lm-lightbox" role="dialog" aria-modal="true" aria-label="查看大图" onMouseDown={onClose}>
      <div className="lm-lightbox-content" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="lm-lightbox-close" title="关闭" onClick={onClose}><X size={18} /></button>
        <LoraMedia media={media} apiBase={apiBase} alt={alt} controls settings={settings} fallbackNsfwLevel={fallbackNsfwLevel} />
      </div>
    </div>
  );
}

function ExampleImagesProgressBar({ status, pullingCount }: { status: ExampleImagesStatus | null; pullingCount: number }) {
  if (!status || status.is_downloading === false && pullingCount === 0) return null;
  const progress = status.status;
  const percent = progress ? Math.round((progress.completed / progress.total) * 100) : 0;
  return (
    <div className="lm-progress-strip">
      <div className="lm-progress-bar" style={{ width: `${percent}%` }} />
      <span className="lm-progress-text">
        {status.is_downloading ? `正在从 Civitai 拉取: ${percent}% (${progress?.completed}/${progress?.total})` : `正在拉取本地示例图: ${pullingCount} 个`}
      </span>
    </div>
  );
}

// --- Main Components ---

export function LoraDetailModal({
  modelType,
  item,
  triggerWords,
  client,
  apiBase,
  settings,
  onClose,
  onInsert,
  onInsertWords,
  onTriggerWords,
  onSaveTriggerWords,
  onExtractTriggerWords,
  onRename,
  onToast,
  pullingExamples,
  exampleStatus,
  onPullExamples,
}: {
  modelType: ManagedModelType;
  item: LoraItem;
  triggerWords: string[];
  client: ComfyClient;
  apiBase: string;
  settings: LoraManagerSettings;
  onClose: () => void;
  onInsert: (target: TemplateKind, strength: number) => void;
  onInsertWords: (target: TemplateKind, words: string[]) => void;
  onTriggerWords: () => void;
  onExtractTriggerWords?: () => void;
  onSaveTriggerWords: (words: string[]) => Promise<string[]>;
  onRename?: (item: LoraItem, newName: string) => Promise<void>;
  onToast: (type: Toast["type"], title: string, message?: string) => void;
  pullingExamples: boolean;
  exampleStatus: ExampleImagesStatus | null;
  onPullExamples: (item: LoraItem) => Promise<LoraExampleMedia[]>;
}) {
  const [strength, setStrength] = useState(1);
  const [metadata, setMetadata] = useState<LoraMetadata | null>(null);
  const [localFiles, setLocalFiles] = useState<LoraExampleMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailError, setDetailError] = useState("");
  const [lightboxMedia, setLightboxMedia] = useState<{ media: LoraExampleMedia; index: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(item.file_name);
  const [renaming, setRenaming] = useState(false);
  
  const isLora = modelType === "loras";
  const key = item.model_name || item.file_name;
  const itemCivitai = item.civitai as LoraMetadata | undefined;
  const examples = useMemo(() => buildLoraExamples(apiBase, item, metadata, localFiles), [apiBase, item, metadata, localFiles]);
  const trainedWords = useMemo(() => uniqueStrings([
    ...triggerWords,
    ...(metadata?.trainedWords ?? []),
    ...(itemCivitai?.trainedWords ?? []),
  ]), [triggerWords, metadata, itemCivitai]);
  const tags = uniqueStrings([...(item.tags ?? []), ...(item.auto_tags ?? []), ...(metadata?.model?.tags ?? [])]);
  const versionName = metadata?.name ?? itemCivitai?.name ?? "N/A";
  const descriptionHtml = String(metadata?.description ?? metadata?.model?.description ?? item.notes ?? "");
  const usageSyntax = `<lora:${loraSyntaxName(item)}:${formatStrength(strength)}>`;
  const civitaiUrl = useMemo(() => buildLoraCivitaiUrl(item, metadata), [item, metadata]);

  function openCivitaiUrl() {
    if (!civitaiUrl) return;
    window.open(civitaiUrl, "_blank", "noopener,noreferrer");
  }

  async function handleSaveTriggerWords(words: string[]) {
    const savedWords = await onSaveTriggerWords(words);
    setMetadata((prev) => prev ? { ...prev, trainedWords: savedWords } : prev);
    return savedWords;
  }

  async function handlePullExamples() {
    const files = await onPullExamples(item);
    if (files.length > 0) {
      setLocalFiles(files);
    } else if (item.sha256) {
      const latestFiles = await client.getLoraExampleFiles(item.sha256).catch(() => []);
      setLocalFiles(latestFiles);
    }
    if (item.file_path) {
      const latestMetadata = await client.getManagedModelMetadataByPath(modelType, item.file_path).catch(() => undefined);
      if (latestMetadata) {
        setMetadata(latestMetadata);
      }
    }
  }

  async function handleRename() {
    if (!onRename || !newName.trim() || newName === item.file_name) {
      setIsRenaming(false);
      return;
    }
    setRenaming(true);
    try {
      await onRename(item, newName.trim());
      setIsRenaming(false);
    } catch (error) {
      // Error is handled by onRename/toast
    } finally {
      setRenaming(false);
    }
  }

  useEffect(() => {
    let canceled = false;
    async function loadDetail() {
      setLoading(true);
      setDetailError("");
      
      let currentPath = item.file_path;
      let currentSha = item.sha256;

      let metadataTask = currentPath ? client.getManagedModelMetadataByPath(modelType, currentPath) : Promise.resolve(undefined);
      let [metadataResult] = await Promise.allSettled([metadataTask]);

      if ((metadataResult.status === "rejected" || (metadataResult.status === "fulfilled" && !metadataResult.value)) && currentPath) {
        try {
          const searchName = item.model_name || item.file_name || currentPath.split("/").pop() || "";
          if (searchName) {
            const searchRes = await client.listManagedModels(modelType, { search: searchName });
            const match = searchRes.items.find((x) => 
              x.model_name === searchName || 
              x.file_name === searchName || 
              x.file_path === currentPath ||
              loraSyntaxName(x) === currentPath
            );
            if (match?.file_path) {
              currentPath = match.file_path;
              currentSha = match.sha256;
              
              metadataTask = client.getManagedModelMetadataByPath(modelType, currentPath);
              const retryResult = await Promise.allSettled([metadataTask]);
              metadataResult = retryResult[0];
            }
          }
        } catch (e) {
          // Ignore search error
        }
      }

      const examplesTask = currentSha ? client.getLoraExampleFiles(currentSha) : Promise.resolve([]);
      const examplesResult = await Promise.allSettled([examplesTask]);
      
      if (canceled) return;
      if (metadataResult.status === "fulfilled") {
        setMetadata(metadataResult.value ?? null);
      } else {
        setDetailError(metadataResult.reason instanceof Error ? metadataResult.reason.message : String(metadataResult.reason));
      }
      if (examplesResult[0].status === "fulfilled") {
        setLocalFiles(examplesResult[0].value);
      } else if (!detailError) {
        setDetailError(examplesResult[0].reason instanceof Error ? examplesResult[0].reason.message : String(examplesResult[0].reason));
      }
      setLoading(false);
    }
    loadDetail();
    return () => {
      canceled = true;
    };
  }, [client, modelType, item]);

  return (
    <ModalFrame title={key} onClose={onClose}>
      <div className={isLora ? "lm-modal" : "lm-modal embedding-mode"}>
        <header className="lm-modal-header">
          <div className="lm-modal-title-row">
            <div className="lm-modal-title">
              {isRenaming ? (
                <div className="lm-rename-input">
                  <input 
                    type="text" 
                    value={newName} 
                    onChange={(e) => setNewName(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename();
                      if (e.key === "Escape") setIsRenaming(false);
                    }}
                  />
                  <button type="button" className="lm-text-btn" disabled={renaming} onClick={handleRename}>
                    {renaming ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
                  </button>
                  <button type="button" className="lm-text-btn" disabled={renaming} onClick={() => setIsRenaming(false)}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <h2>{key}</h2>
                  {onRename && (
                    <button type="button" className="lm-icon-btn-small" title="重命名文件" onClick={() => {
                      setNewName(item.file_name);
                      setIsRenaming(true);
                    }}>
                      <Settings size={14} />
                    </button>
                  )}
                </>
              )}
              {civitaiUrl && (
                <button type="button" className="lm-civitai-link" title="前往 Civitai 对应模型" aria-label="前往 Civitai 对应模型" onClick={openCivitaiUrl}>
                  <Globe2 size={16} />
                  <span>Civitai</span>
                </button>
              )}
            </div>
          </div>
          <div className="lm-modal-actions">
            <button type="button" className="icon-button" disabled={!item.sha256 || pullingExamples} onClick={handlePullExamples}>
              <Download size={16} />
              {pullingExamples ? "拉取中" : "拉取示例图"}
            </button>
          </div>
          <TagCloud tags={tags} />
        </header>

        {detailError && <div className="empty-strip">详情数据读取失败：{detailError}</div>}

        <div className={examples.length > 0 || loading ? "lm-modal-body" : "lm-modal-body examples-empty"}>
          <section className="lm-info-section">
            <div className="lm-info-grid">
              <div className="lm-info-item lm-usage" style={{ gridColumn: "1 / -1", marginBottom: "8px" }}>
                <label>使用语法</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="lm-usage-row">
                    <code>{usageSyntax}</code>
                    <NumberField label="强度" value={strength} min={-10} max={10} step={0.05} onChange={setStrength} />
                    <button type="button" className="icon-button" onClick={() => {
                      navigator.clipboard?.writeText(usageSyntax);
                      onToast("success", "LoRA 语法已复制", usageSyntax);
                    }}><Copy size={16} /> 复制</button>
                  </div>
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    <button type="button" className="primary-action" onClick={() => onInsert("default", strength)}><BadgePlus size={16} /> 默认</button>
                    <button type="button" className="primary-action" onClick={() => onInsert("multi", strength)}><BadgePlus size={16} /> 多人</button>
                    <button type="button" className="primary-action" onClick={() => onInsert("highres", strength)}><BadgePlus size={16} /> 高修</button>
                  </div>
                </div>
              </div>
              <InfoItem label="版本" value={versionName} />
              <InfoItem label="文件名" value={item.file_name || "N/A"} />
              <InfoItem label="本地路径" value={item.file_path?.replace(/[^/]+$/, "") || item.folder || "N/A"} wide />
              <div className="lm-info-item lm-base-size">
                <div>
                  <label>基础模型</label>
                  <span>{metadata?.baseModel || item.base_model || "未知"}</span>
                </div>
                <div>
                  <label>文件大小</label>
                  <span>{formatBytes(item.file_size)}</span>
                </div>
              </div>

              <TriggerWordsPanel
                words={trainedWords}
                onRead={onTriggerWords}
                onExtract={onExtractTriggerWords}
                onSave={handleSaveTriggerWords}
                onCopy={(text) => {
                  navigator.clipboard?.writeText(text);
                  onToast("success", "触发词已复制", text);
                }}
                onInsertWords={onInsertWords}
              />

              <InfoItem 
                label="版本说明" 
                value={descriptionHtml} 
                wide 
                isHtml 
                onHtmlCopy={(text) => {
                  navigator.clipboard?.writeText(text);
                  onToast("success", "已复制该段内容", text);
                }} 
              />
            </div>
          </section>

          <section className="lm-showcase-section">
            <div className="lm-showcase-head">
              <strong className="lm-showcase-title">示例媒体 {examples.length ? `(${examples.length})` : ""}</strong>
            </div>
            <ExampleImagesProgressBar status={exampleStatus} pullingCount={pullingExamples ? 1 : 0} />
            <div className="lm-showcase-list">
                {loading && <div className="empty-strip">正在加载示例图片/视频...</div>}
                {!loading && examples.length === 0 && <div className="empty-strip">没有示例媒体，插件也会在这里显示导入入口</div>}
                {examples.map((media, index) => (
                  <LoraExampleCard
                    apiBase={apiBase}
                    media={media}
                    index={index}
                    key={`${media.source}-${media.url || media.path || index}`}
                    onToast={onToast}
                    settings={settings}
                    fallbackNsfwLevel={getItemNsfwLevel(item, metadata)}
                    onOpenMedia={(selectedMedia, selectedIndex) => setLightboxMedia({ media: selectedMedia, index: selectedIndex })}
                  />
                ))}
              </div>
          </section>
        </div>
        {lightboxMedia && (
          <MediaLightbox
            media={lightboxMedia.media}
            apiBase={apiBase}
            alt={`示例 ${lightboxMedia.index + 1}`}
            settings={settings}
            fallbackNsfwLevel={getItemNsfwLevel(item, metadata)}
            onClose={() => setLightboxMedia(null)}
          />
        )}
      </div>
    </ModalFrame>
  );
}

export function LoraOperationModal({
  modelType,
  operation,
  client,
  selectedItems,
  onClose,
  onToast,
  onSettingsSaved,
  translationSettings,
  onTranslationSettingsSaved,
  settingsApiBase,
  onApiBaseSaved,
  onMutated,
  notifications = [],
  onShowWelcome,
}: {
  modelType: ManagedModelType;
  operation: LoraOperation;
  client: ComfyClient;
  settingsApiBase: string;
  selectedItems: LoraItem[];
  onClose: () => void;
  onToast: (type: Toast["type"], title: string, message?: string) => void;
  onSettingsSaved: (settings: LoraManagerSettings) => void;
  onApiBaseSaved: (base: string) => void;
  translationSettings: TranslationSettings;
  onTranslationSettingsSaved: (settings: TranslationSettings) => void;
  onMutated: (message?: string) => void | Promise<void>;
  notifications?: Toast[];
  onShowWelcome?: () => void;
}) {
  const operationItems = "items" in operation ? operation.items : operation.type === "download" && operation.item ? [operation.item] : selectedItems;
  const [textValue, setTextValue] = useState(() => {
    if (operation.type === "rename") return operation.item.file_name;
    if (operation.type === "download") return String(loraModelId(operation.item) ?? "");
    return "";
  });
  const [secondaryValue, setSecondaryValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [duplicates, setDuplicates] = useState<LoraDuplicateGroup[]>([]);
  const [filenameConflicts, setFilenameConflicts] = useState<LoraDuplicateGroup[]>([]);
  const [updateRecords, setUpdateRecords] = useState<LoraUpdateRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<DoctorDiagnostic[]>([]);
  const [settings, setSettings] = useState<LoraManagerSettings>({});
  const [localTranslationSettings, setLocalTranslationSettings] = useState<TranslationSettings>(translationSettings);
  const [localApiBase, setLocalApiBase] = useState(settingsApiBase);
  const [activeTab, setActiveTab] = useState<"general" | "translation">("general");
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [rawData, setRawData] = useState<unknown>(null);

  const title = operationTitle(operation);

  async function loadOperationData() {
    setBusy(true);
    try {
      if (operation.type === "duplicates") {
        const [dupes, conflicts] = await Promise.all([
          client.findManagedModelDuplicates(modelType),
          client.findManagedModelFilenameConflicts(modelType),
        ]);
        setDuplicates(dupes.duplicates);
        setFilenameConflicts(conflicts.conflicts);
      }
      if (operation.type === "updates") {
        const result = await client.refreshManagedModelUpdates(modelType, { force: false });
        if (result.success === false) throw new Error(result.error || "更新检查失败");
        setUpdateRecords(result.records ?? []);
      }
      if (operation.type === "doctor") {
        const result = await client.getDoctorDiagnostics();
        if (result.success === false) throw new Error(result.error || "医生诊断失败");
        setDiagnostics(result.diagnostics ?? result.checks ?? []);
        setRawData(result);
      }
      if (operation.type === "settings") {
        try {
          const result = await client.getLoraManagerSettings();
          if (result.success !== false) {
            const nextSettings = normalizeLoraManagerSettings(result.settings ?? result);
            setSettings(nextSettings);
            setTextValue(String(nextSettings.example_images_path ?? ""));
            setSecondaryValue(String(nextSettings.lora_syntax_format ?? ""));
          }
        } catch (settingsError) {
          console.warn("Failed to load settings from server:", settingsError);
        }
      }
      if (operation.type === "civitai") {
        const hash = operation.item.sha256;
        if (!hash) throw new Error("该 LoRA 没有 SHA256");
        const result = await client.getManagedModelCivitaiByHash(modelType, hash);
        if (result.success === false) throw new Error(result.error || "Civitai 详情读取失败");
        setRawData(result);
      }
    } catch (error) {
      onToast("error", `${title}失败`, error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadOperationData();
  }, [operation.type]);

  async function submitRename() {
    if (operation.type !== "rename") return;
    const nextName = textValue.trim();
    if (!nextName) {
      onToast("error", "重命名失败", "文件名不能为空");
      return;
    }
    setBusy(true);
    try {
      const result = await client.renameManagedModel(modelType, operation.item.file_path, nextName);
      if (result.success === false) throw new Error(result.error || "重命名失败");
      await onMutated("LoRA 已重命名");
      onClose();
    } catch (error) {
      onToast("error", "重命名失败", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitMove() {
    if (operation.type !== "move") return;
    const targetPath = textValue.trim();
    if (!targetPath || operation.items.length === 0) {
      onToast("error", "移动失败", "请选择 LoRA 并填写目标文件夹");
      return;
    }
    setBusy(true);
    try {
      const result = operation.items.length === 1
        ? await client.moveManagedModel(modelType, operation.items[0].file_path, targetPath, true)
        : await client.bulkMoveManagedModels(modelType, operation.items.map((item) => item.file_path), targetPath, true);
      if (result.success === false) throw new Error(result.error || "移动失败");
      await onMutated(`已移动 ${operation.items.length} 个 LoRA`);
      onClose();
    } catch (error) {
      onToast("error", "移动失败", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitDelete(items = operation.type === "delete" ? operation.items : []) {
    if (!items.length) {
      onToast("error", "删除失败", "没有选择 LoRA");
      return;
    }
    setBusy(true);
    try {
      const result = items.length === 1
        ? await client.deleteManagedModel(modelType, items[0].file_path)
        : await client.bulkDeleteManagedModels(modelType, items.map((item) => item.file_path));
      if (result.success === false) throw new Error(result.error || "删除失败");
      await onMutated(`已删除 ${items.length} 个 LoRA`);
      onClose();
    } catch (error) {
      onToast("error", "删除失败", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitDownload() {
    const modelId = Number(textValue || (operation.type === "download" ? loraModelId(operation.item) : undefined));
    const versionId = Number(secondaryValue || 0);
    if (!Number.isFinite(modelId) || modelId <= 0) {
      onToast("error", "下载失败", "请填写 Civitai model_id");
      return;
    }
    setBusy(true);
    try {
      const result = await client.downloadManagedModel(modelType, {
        model_id: modelId,
        model_version_id: versionId > 0 ? versionId : undefined,
        use_default_paths: true,
        source: "civitai",
      });
      if (result.success === false) throw new Error(result.error || "下载提交失败");
      onToast("success", "下载任务已提交", result.download_id ? `任务 ${result.download_id}` : undefined);
      if (result.download_id) {
        const progress = await client.getDownloadProgress(result.download_id).catch(() => null);
        setDownloadProgress(progress);
      }
    } catch (error) {
      onToast("error", "下载失败", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    const apiBaseChanged = localApiBase !== settingsApiBase;
    
    if (apiBaseChanged) {
      onApiBaseSaved(localApiBase);
    }

    if (!textValue.trim()) {
      if (!apiBaseChanged) {
        onToast("error", "必填项缺失", "第一次使用请务必配置【示例图目录】！");
        return;
      } else {
        onToast("success", "API 地址已更新");
        onClose();
        return;
      }
    }

    setBusy(true);
    try {
      const payload = {
        ...settings,
        example_images_path: textValue,
        lora_syntax_format: secondaryValue || settings.lora_syntax_format,
        onboarding_completed: true,
      };
      
      try {
        const result = await client.updateLoraManagerSettings(payload);
        if (result.success === false) throw new Error(result.error || "设置保存失败");
        const nextSettings = normalizeLoraManagerSettings(result.settings ?? payload);
        setSettings(nextSettings);
        onSettingsSaved(nextSettings);
      } catch (serverError) {
        if (!apiBaseChanged) {
          throw serverError;
        }
        console.warn("Failed to sync settings to server, but API base was updated:", serverError);
      }

      onTranslationSettingsSaved(localTranslationSettings);
      onToast("success", apiBaseChanged ? "设置已更新 (API 地址已修改)" : "设置已保存");
      onClose();
    } catch (error) {
      onToast("error", "设置保存失败", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function doctorAction(action: "repair" | "resolve" | "export") {
    setBusy(true);
    try {
      const result = action === "repair"
        ? await client.repairDoctorCache()
        : action === "resolve"
          ? await client.resolveDoctorFilenameConflicts()
          : await client.exportDoctorBundle();
      if (result.success === false) throw new Error(result.error || "医生操作失败");
      onToast("success", "医生操作完成", String(result.message || result.path || result.bundle_path || ""));
      await loadOperationData();
    } catch (error) {
      onToast("error", "医生操作失败", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalFrame title={title} onClose={onClose}>
      <div className="operation-modal">
        {busy && <div className="empty-strip">处理中...</div>}
        {operation.type === "rename" && (
          <>
            <TextInput label="新文件名" value={textValue} onChange={setTextValue} />
            <div className="operation-actions">
              <button type="button" className="primary-action" onClick={submitRename}><Settings size={16} /> 保存重命名</button>
            </div>
          </>
        )}
        {operation.type === "move" && (
          <>
            <div className="empty-strip">将移动 {operation.items.length} 个 LoRA。目标路径可填写插件默认 LoRA 根目录下的相对文件夹。</div>
            <TextInput label="目标文件夹" value={textValue} onChange={setTextValue} placeholder="例如 character/pony" />
            <ItemList items={operation.items} />
            <div className="operation-actions">
              <button type="button" className="primary-action" onClick={submitMove}><FolderOpen size={16} /> 确认移动</button>
            </div>
          </>
        )}
        {operation.type === "delete" && (
          <>
            <div className="empty-strip danger-text">将真实删除 {operation.items.length} 个 LoRA 文件及相关缓存。</div>
            <ItemList items={operation.items} />
            <div className="operation-actions">
              <button type="button" className="primary-action danger" onClick={() => submitDelete()}><Trash2 size={16} /> 确认删除</button>
            </div>
          </>
        )}
        {operation.type === "download" && (
          <>
            <TextInput label="Civitai model_id" value={textValue} onChange={setTextValue} placeholder="必填" />
            <TextInput label="model_version_id" value={secondaryValue} onChange={setSecondaryValue} placeholder="可选，留空下载默认版本" />
            {downloadProgress && <pre className="json-preview">{JSON.stringify(downloadProgress, null, 2)}</pre>}
            <div className="operation-actions">
              <button type="button" className="primary-action" onClick={submitDownload}><Download size={16} /> 提交下载</button>
              <button type="button" className="icon-button" onClick={() => client.pauseDownload()}><PauseCircle size={16} /> 暂停</button>
              <button type="button" className="icon-button" onClick={() => client.resumeDownload()}><PlayCircle size={16} /> 恢复</button>
              <button type="button" className="icon-button danger" onClick={() => client.cancelDownload()}><X size={16} /> 取消</button>
            </div>
          </>
        )}
        {operation.type === "duplicates" && (
          <DuplicatePane duplicates={duplicates} filenameConflicts={filenameConflicts} onDeleteCopies={submitDelete} />
        )}
        {operation.type === "updates" && (
          <UpdatesPane modelType={modelType} records={updateRecords} client={client} onRefresh={loadOperationData} onToast={onToast} />
        )}
        {operation.type === "doctor" && (
          <DoctorPane diagnostics={diagnostics} rawData={rawData} onAction={doctorAction} />
        )}
        {operation.type === "notifications" && (
          <div className="notification-log">
            <NotifierSettingsPanel />
            {onShowWelcome && (
              <div 
                className="toast info" 
                style={{ border: "1px solid var(--accent-soft)" }}
                onClick={onShowWelcome}
              >
                <div>
                  <strong>系统环境与模型依赖说明 (点击查看)</strong>
                  <p>查看运行本项目所需的 6 大核心插件与全部底层生图模型的下载地址。</p>
                </div>
              </div>
            )}
            {notifications.length === 0 && <div className="empty-strip">暂无其他通知</div>}
            {notifications.map((toast) => (
              <div className={`toast ${toast.type}`} key={toast.id}>
                <div>
                  <strong>{toast.title}</strong>
                  {toast.message && <p>{toast.message}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
        {operation.type === "settings" && (
          <div style={{ display: "flex", gap: "1.5rem", height: "65vh", minHeight: "450px", overflow: "hidden" }}>
            {/* Sidebar */}
            <div style={{ width: "200px", display: "flex", flexDirection: "column", borderRight: "1px solid var(--border-color)", paddingRight: "1rem", height: "100%" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", flex: 1, overflowY: "auto" }}>
                <button 
                  type="button" 
                  onClick={() => setActiveTab("general")} 
                  style={{ 
                    textAlign: "left", padding: "0.75rem 1rem", borderRadius: "8px", border: "none", cursor: "pointer", 
                    backgroundColor: activeTab === "general" ? "var(--surface-alt)" : "transparent",
                    color: activeTab === "general" ? "var(--text)" : "var(--muted)",
                    fontWeight: activeTab === "general" ? 600 : 400
                  }}
                >
                  ⚙️ 基本设置
                </button>
                <button 
                  type="button" 
                  onClick={() => setActiveTab("translation")} 
                  style={{ 
                    textAlign: "left", padding: "0.75rem 1rem", borderRadius: "8px", border: "none", cursor: "pointer", 
                    backgroundColor: activeTab === "translation" ? "var(--surface-alt)" : "transparent",
                    color: activeTab === "translation" ? "var(--text)" : "var(--muted)",
                    fontWeight: activeTab === "translation" ? 600 : 400
                  }}
                >
                  🌐 翻译设置
                </button>
              </div>
              <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border-color)" }}>
                <button type="button" className="primary-action" onClick={saveSettings} style={{ width: "100%", justifyContent: "center" }}>
                  <Settings size={16} /> 保存设置
                </button>
              </div>
            </div>

            {/* Content Area */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem", overflowY: "auto", paddingRight: "0.5rem" }}>
              {activeTab === "general" && (
                 <>
                   <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem", fontWeight: 600 }}>基本设置</h3>
                   <TextInput label="API Base URL" value={localApiBase} onChange={setLocalApiBase} placeholder="/comfy" />
                  <TextInput label="示例图目录 (首次使用必填)" value={textValue} onChange={setTextValue} placeholder="必须配置，例如 E:/comfyui/lora_previews" />
                  <TextInput label="LoRA 语法格式" value={secondaryValue} onChange={setSecondaryValue} placeholder="legacy / full" />
                  
                  <div className="form-grid two compact" style={{ marginTop: "1rem" }}>
                    <label className="field checkbox-field">
                      <input
                        type="checkbox"
                        checked={settings.blur_mature_content !== false}
                        onChange={(event) => setSettings((prev) => ({ ...prev, blur_mature_content: event.target.checked }))}
                      />
                      <span>模糊限制级内容</span>
                    </label>
                    <label className="field">
                      <span>限制级模糊阈值</span>
                      <select
                        value={normalizeMatureBlurLevel(settings.mature_blur_level)}
                        onChange={(event) => setSettings((prev) => ({ ...prev, mature_blur_level: event.target.value }))}
                      >
                        {validMatureBlurLevels.map((level) => <option key={level} value={level}>{level}</option>)}
                      </select>
                    </label>
                  </div>

                  <pre className="json-preview">{JSON.stringify(settings, null, 2)}</pre>
                </>
              )}

              {activeTab === "translation" && (
                <>
                  <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem", fontWeight: 600 }}>翻译设置</h3>
                  <div className="form-grid two compact">
                    <label className="field">
                      <span>翻译服务商</span>
                      <select 
                        value={localTranslationSettings.provider} 
                        onChange={(e) => setLocalTranslationSettings(prev => ({ ...prev, provider: e.target.value as TranslationProvider }))}
                      >
                        <option value="mymemory">MyMemory (免费)</option>
                        <option value="baidu">百度翻译 (Baidu)</option>
                        <option value="aliyun">阿里云翻译 (Alibaba)</option>
                      </select>
                    </label>
                  </div>

                  {localTranslationSettings.provider === "baidu" && (
                    <div className="form-grid two compact" style={{ marginTop: "1rem" }}>
                      <TextInput label="App ID" value={localTranslationSettings.baiduAppId || ""} onChange={(v) => setLocalTranslationSettings(prev => ({ ...prev, baiduAppId: v }))} placeholder="百度翻译 App ID" />
                      <label className="field text-field">
                        <span>Secret Key</span>
                        <input 
                          type="password" 
                          value={localTranslationSettings.baiduSecret || ""} 
                          onChange={(e) => setLocalTranslationSettings(prev => ({ ...prev, baiduSecret: e.target.value }))} 
                          placeholder="百度翻译 Secret Key" 
                        />
                      </label>
                    </div>
                  )}

                  {localTranslationSettings.provider === "aliyun" && (
                    <div className="form-grid two compact" style={{ marginTop: "1rem" }}>
                      <TextInput label="AccessKey ID" value={localTranslationSettings.aliyunAccessKeyId || ""} onChange={(v) => setLocalTranslationSettings(prev => ({ ...prev, aliyunAccessKeyId: v }))} placeholder="阿里云 AccessKey ID" />
                      <label className="field text-field">
                        <span>AccessKey Secret</span>
                        <input 
                          type="password" 
                          value={localTranslationSettings.aliyunAccessKeySecret || ""} 
                          onChange={(e) => setLocalTranslationSettings(prev => ({ ...prev, aliyunAccessKeySecret: e.target.value }))} 
                          placeholder="阿里云 AccessKey Secret" 
                        />
                      </label>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </ModalFrame>
  );
}
