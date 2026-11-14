import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Copy, FolderOpen, LayoutList, Loader2, Plus, Replace, Sparkles } from "lucide-react";
import { toApplyText } from "../../../lib/wardrobe/text";
import type { AnimaApplyMode } from "../../../lib/anima/types";
import type { OutputImage } from "../../../types";
import type { WardrobeGenerationState } from "../../../lib/wardrobe/types";

type Props = {
  text: string;
  levelNum: number;
  cap: number;
  seed: number;
  tagCount: number;
  notes: string[];
  dropped: string[];
  repaired: string[];
  qualityPrefix: boolean;
  onQualityPrefix: (value: boolean) => void;
  onApply: (text: string, mode: AnimaApplyMode) => void;
  onCopy: (text: string) => void;
  onToWorkbench: () => void;
  onOpenAnima: () => void;
  /** 在系统浏览器打开造型台专属图片管理页（定位到 造型台 目录） */
  onOpenImageFolder: () => void;
  /** 一键生图：草稿与生成状态由造型台面板层持有，标题栏按钮共用 */
  draft: string;
  onDraftChange: (value: string) => void;
  generating: boolean;
  generatedImages: OutputImage[];
  onOpenImage: (url: string, originalUrl?: string) => void;
  /** 造型台独立生图设置（模型 / LoRA / 触发词） */
  generation: WardrobeGenerationState;
  onOpenLoraManager: () => void;
  onOpenGallery: () => void;
};

export function WardrobeResultPanel({
  text,
  levelNum,
  cap,
  seed,
  tagCount,
  notes,
  dropped,
  repaired,
  qualityPrefix,
  onQualityPrefix,
  onApply,
  onCopy,
  onToWorkbench,
  onOpenAnima,
  onOpenImageFolder,
  draft,
  onDraftChange,
  generating,
  generatedImages,
  onOpenImage,
  generation,
  onOpenLoraManager,
  onOpenGallery,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const output = toApplyText(draft, qualityPrefix);
  const disabled = !output;
  const dirty = draft !== text;
  const activeLoras = generation.params.loras.filter((lora) => lora.active).length;

  // 新图落地时把结果区滚回顶部，保证缩略图组可见（连续生图尤其需要）
  useEffect(() => {
    if (generatedImages.length > 0) {
      resultRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [generatedImages.length]);

  // 还没抽过：结果区只占一条，把高度让给角色 / 场景 / 服装列表
  if (!text) {
    return (
      <div className="wd-result is-empty">
        <div className="wd-result-head">
          <span className="wd-result-title">
            <Sparkles size={14} /> 抽取结果
          </span>
          <span className="wd-result-empty-hint">点右上「抽一次」生成正文；也可以先选角色 / 套场景</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={resultRef} className={`wd-result${collapsed ? " is-collapsed" : ""}`}>
      <div className="wd-result-head">
        <span className="wd-result-title">
          <Sparkles size={14} /> 抽取结果
        </span>
        <span className="wd-result-meta">
          <span className="wd-result-chip">L{levelNum}</span>
          <span className="wd-result-chip">{tagCount} 标签</span>
          <span className="wd-result-chip">{cap ? `cap ${cap}` : "cap 自动"}</span>
          <span className="wd-result-chip">seed {seed}</span>
          {dirty && <span className="wd-result-chip is-accent">已手改</span>}
          <button
            type="button"
            className="wd-result-chip is-accent wd-result-chip-btn"
            onClick={onOpenLoraManager}
            title="管理造型台 LoRA 与触发词"
          >
            LoRA {activeLoras}/{generation.params.loras.length}
          </button>
          {generatedImages.length > 0 && (
            <button
              type="button"
              className="wd-result-chip is-accent wd-result-chip-btn"
              onClick={onOpenGallery}
              title="查看全部生成结果"
            >
              结果 {generatedImages.length}
            </button>
          )}
        </span>
        <button
          type="button"
          className="wd-result-toggle"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? "展开抽取结果" : "收起抽取结果"}
          aria-expanded={!collapsed}
          title={collapsed ? "展开（给上面的列表腾地方）" : "收起（只看列表）"}
        >
          <ChevronDown size={13} className={collapsed ? "is-collapsed" : ""} />
        </button>
      </div>
      <div className="wd-result-main">
        <textarea
          className="wd-result-text"
          value={draft}
          spellCheck={false}
          placeholder="点「抽一次」生成正文；也可以直接在这里微调"
          onChange={(event) => onDraftChange(event.target.value)}
        />
        {(generating || generatedImages.length > 0) && (
          <div className="wd-result-gallery" aria-live="polite" aria-busy={generating}>
            <span className="wd-result-gallery-label">
              {generating ? "正在生成…" : "最近生成"}
            </span>
            <div className="wd-result-gallery-strip">
              {generating && (
                <span className="wd-result-preview-loading">
                  <Loader2 size={14} className="wd-spin" />
                </span>
              )}
              {generatedImages[0] && (
                <img
                  src={generatedImages[0].url}
                  alt="最近一次生成"
                  title="点击看大图"
                  onClick={() =>
                    onOpenImage(generatedImages[0].url, generatedImages[0].originalUrl)
                  }
                />
              )}
            </div>
          </div>
        )}
      </div>
      <div className="wd-result-actions">
        <label className="wd-mini-check">
          <input
            type="checkbox"
            checked={qualityPrefix}
            onChange={(event) => onQualityPrefix(event.target.checked)}
          />
          加画质前缀
        </label>
        <span className="wd-result-btns">
          <button type="button" className="secondary-action" disabled={disabled} onClick={() => onCopy(output)}>
            <Copy size={14} /> 复制
          </button>
          <button type="button" className="secondary-action" disabled={disabled} onClick={() => onApply(output, "append")}>
            <Plus size={14} /> 追加
          </button>
          <button type="button" className="secondary-action" disabled={disabled} onClick={() => onApply(output, "replace")}>
            <Replace size={14} /> 替换
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={disabled}
            onClick={onToWorkbench}
            title="拆进公共工作台（与 Anima 词库共用），可在那里补画师后再写入"
          >
            <LayoutList size={14} /> 工作台
          </button>
        </span>
        <span className="wd-result-gen-btns">
          <button
            type="button"
            className="secondary-action"
            onClick={onOpenImageFolder}
            title="在浏览器打开造型台图片管理（造型台/日期）"
          >
            <FolderOpen size={14} /> 图片管理
          </button>
          <button type="button" className="secondary-action" onClick={onOpenAnima}>
            <ArrowRight size={14} /> 去 Anima 生图
          </button>
        </span>
      </div>
      {(notes.length > 0 || dropped.length > 0 || repaired.length > 0) && (
        <details className="wd-result-notes">
          <summary>
            报告 · {notes.length} 条说明
            {dropped.length ? ` · 削 ${dropped.length}` : ""}
            {repaired.length ? ` · 修 ${repaired.length}` : ""}
          </summary>
          <div className="wd-note-chips">
            {dropped.map((tag) => (
              <span key={`d-${tag}`} className="wd-chip tag-drop">
                削 {tag}
              </span>
            ))}
            {repaired.map((tag) => (
              <span key={`r-${tag}`} className="wd-chip tag-fix">
                修 {tag}
              </span>
            ))}
          </div>
          <ul>
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
