import React, { useEffect, useState } from "react";
import { BadgePlus, Brain, CheckCircle2, Copy, Film, ImageIcon, Info, Maximize2, Plus, ScanSearch, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import type {
  ExampleImagesStatus,
  LoraExampleMedia,
  LoraManagerSettings,
  LoraMediaMeta,
  TemplateKind,
  Toast,
} from "../../../types";
import { getMediaNsfwLevel, shouldBlurNsfwLevel } from "../../../lib/nsfw";
import { normalizePreview, parseTriggerWordsInput, uniqueStrings } from "../../../lib/lora-helper";
import { isLoraVideo } from "../../../lib/lora-media";
import { PromptBlock } from "../../ui";
import { LoraMedia } from "./LoraMedia";

/** 从 LoraModals.tsx 拆出（T14）：触发词面板与示例媒体卡片，逻辑逐字未改 */
export function TriggerWordsPanel({
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
              <button type="button" className="lm-text-btn" onClick={() => onInsertWords('anima', visibleWords)} title="追加到 Anima 生图正向提示词"><BadgePlus size={14} /> Anima</button>
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

export function LoraExampleMetadata({ meta, onToast }: { meta: LoraMediaMeta; onToast: (type: Toast["type"], title: string, message?: string) => void }) {
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

export function LoraExampleCard({
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

export function MediaLightbox({
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

export function ExampleImagesProgressBar({ status, pullingCount }: { status: ExampleImagesStatus | null; pullingCount: number }) {
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