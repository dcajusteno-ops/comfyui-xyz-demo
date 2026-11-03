import React, { useMemo } from "react";
import { Blocks, Copy, Eraser, Plus, Replace } from "lucide-react";
import type { Toast } from "../../../types";
import type { AnimaApplyMode, AnimaComposerSlot, AnimaComposerState, AnimaLibrarySection } from "../../../lib/anima/types";
import {
  COMPOSER_SLOT_META,
  appendTokensToSlot,
  buildComposerPreview,
  composerTokens,
} from "../../../lib/anima/compose";
import { AnimaComposerSection } from "./AnimaComposerSection";
import { AnimaArtistPicker } from "./AnimaArtistPicker";

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
  /** 画师分区下方的「画师快取」（独立工作台同样复用） */
  showArtistPicker?: boolean;
  /** 「送入工作台」：把当前分区内容追加并进独立的 Anima 工作台页（词库侧传入） */
  onSendToWorkbench?: () => void;
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
  showArtistPicker = true,
  onSendToWorkbench,
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
        <div className="al-composer-order">
          输出顺序（Anima 官方）：<b>质量 → 画师 → 角色 → 服装 → 背景 → 姿势 → 额外</b>
        </div>
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
              after={
                meta.key === "artist" && showArtistPicker ? (
                  <AnimaArtistPicker
                    onAdd={(token) =>
                      onChangeSlot("artist", appendTokensToSlot(state.values.artist, [token]))
                    }
                  />
                ) : undefined
              }
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
            onClick={() => onConfirm("清空分区", "确定清空七个分区的全部内容吗？", onClearAll)}
          >
            <Eraser size={15} /> 清空
          </button>
          {onSendToWorkbench && (
            <button
              type="button"
              className="secondary-action"
              disabled={!hasAny}
              onClick={onSendToWorkbench}
              title="把当前分区内容追加并进独立的「Anima 工作台」页（重复词去重）"
            >
              <Blocks size={15} /> 送入工作台
            </button>
          )}
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
