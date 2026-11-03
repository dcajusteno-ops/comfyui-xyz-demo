import { useEffect, useState } from "react";
import { ArrowRight, Copy, LayoutList, Plus, Replace, Sparkles } from "lucide-react";
import { toApplyText } from "../../../lib/wardrobe/text";
import type { AnimaApplyMode } from "../../../lib/anima/types";

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
}: Props) {
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);

  const output = toApplyText(draft, qualityPrefix);
  const disabled = !output;

  return (
    <div className="wd-result">
      <div className="wd-result-head">
        <span className="wd-result-title">
          <Sparkles size={14} /> 抽取结果
        </span>
        <span className="wd-result-meta">
          L{levelNum} · {tagCount} 标签 · {cap ? `cap ${cap}` : "cap 自动"} · seed {seed}
        </span>
      </div>
      <textarea
        className="wd-result-text"
        value={draft}
        spellCheck={false}
        placeholder="点「抽一次」生成正文；也可以直接在这里微调"
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="wd-result-actions">
        <label className="wd-mini-check">
          <input
            type="checkbox"
            checked={qualityPrefix}
            onChange={(event) => onQualityPrefix(event.target.checked)}
          />
          加画质前缀
        </label>
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
        <button type="button" className="primary-action" onClick={onOpenAnima}>
          <ArrowRight size={14} /> 去 Anima 生图
        </button>
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
