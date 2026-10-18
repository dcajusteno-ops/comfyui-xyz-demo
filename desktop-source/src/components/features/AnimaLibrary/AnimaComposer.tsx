import React, { useMemo } from "react";
import { Copy, Eraser, Plus, Replace } from "lucide-react";
import type { Toast } from "../../../types";
import type { AnimaApplyMode, AnimaComposerSlot, AnimaComposerState, AnimaLibrarySection } from "../../../lib/anima/types";
import {
  COMPOSER_SLOT_META,
  buildComposerPreview,
  composerTokens,
} from "../../../lib/anima/compose";
import { AnimaComposerSection } from "./AnimaComposerSection";

type ToastFn = (type: Toast["type"], title: string, message?: string) => void;

const SLOT_TO_SECTION: Partial<Record<AnimaComposerSlot, AnimaLibrarySection>> = {
  artist: "artist",
  character: "character",
  clothing: "clothing",
  background: "background",
  pose: "pose",
};

type Props = {
  state: AnimaComposerState;
  currentPrompt: string;
  onChangeSlot: (slot: AnimaComposerSlot, value: string) => void;
  onClearSlot: (slot: AnimaComposerSlot) => void;
  onDedupeChange: (value: boolean) => void;
  onApply: (mode: AnimaApplyMode) => void;
  onClearAll: () => void;
  onConfirm: (title: string, message: string, onConfirm: () => void) => void;
  onOpenGallery: (section: AnimaLibrarySection) => void;
  pushToast: ToastFn;
};

export const AnimaComposer = React.memo(({
  state,
  currentPrompt,
  onChangeSlot,
  onClearSlot,
  onDedupeChange,
  onApply,
  onClearAll,
  onConfirm,
  onOpenGallery,
  pushToast,
}: Props) => {
  const counts = useMemo(() => composerTokens(state.values), [state.values]);
  const preview = useMemo(
    () => buildComposerPreview(state.values, { dedupe: state.dedupe }),
    [state.values, state.dedupe],
  );

  const hasAny = COMPOSER_SLOT_META.some(({ key }) => state.values[key].trim());

  const handleCopy = () => {
    if (!preview) return;
    void navigator.clipboard.writeText(preview).then(
      () => pushToast("success", "已复制拼接结果", `${preview.length} 字符`),
      () => pushToast("error", "复制失败", "浏览器剪贴板不可用"),
    );
  };

  return (
    <div className="al-composer">
      <div className="al-composer-sections">
        {COMPOSER_SLOT_META.map((meta) => {
          const section = SLOT_TO_SECTION[meta.key];
          return (
            <AnimaComposerSection
              key={meta.key}
              meta={meta}
              value={state.values[meta.key]}
              count={counts[meta.key].length}
              onChange={onChangeSlot}
              onClear={onClearSlot}
              onOpenLibrary={section ? () => onOpenGallery(section) : undefined}
            />
          );
        })}
      </div>

      <aside className="al-composer-preview">
        <div className="al-preview-head">
          <h3>拼接预览</h3>
          <span>{preview.length} 字符</span>
        </div>
        <textarea className="al-preview-text" readOnly value={preview} placeholder="左侧填词后这里实时预览" spellCheck={false} />

        <label className="al-checkbox">
          <input
            type="checkbox"
            checked={state.dedupe}
            onChange={(event) => onDedupeChange(event.target.checked)}
          />
          去重（忽略大小写）
        </label>

        <div className="al-preview-actions">
          <button type="button" className="primary-action" onClick={() => onApply("append")} disabled={!preview}>
            <Plus size={15} /> 追加到 Anima 提示词
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={!preview}
            onClick={() =>
              onConfirm(
                "覆盖 Anima 提示词",
                `当前提示词 ${currentPrompt.length} 字符将被替换为拼接结果（${preview.length} 字符），此操作不可撤销。`,
                () => onApply("replace"),
              )
            }
          >
            <Replace size={15} /> 覆盖
          </button>
          <button type="button" className="secondary-action" onClick={handleCopy} disabled={!preview}>
            <Copy size={15} /> 复制
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={!hasAny}
            onClick={() => onConfirm("清空拼接台", "确定清空七个分区的全部内容吗？", onClearAll)}
          >
            <Eraser size={15} /> 清空
          </button>
        </div>

        <div className="al-current">
          <div className="al-preview-head">
            <h3>当前 Anima 提示词</h3>
            <span>{currentPrompt.length} 字符</span>
          </div>
          <div className="al-current-text">{currentPrompt || "（空）"}</div>
        </div>
      </aside>
    </div>
  );
});
