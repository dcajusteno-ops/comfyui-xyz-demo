import React from "react";
import { Eraser, LibraryBig } from "lucide-react";
import type { AnimaComposerSlot } from "../../../lib/anima/types";
import { COMPOSER_SLOT_META } from "../../../lib/anima/compose";

type Meta = (typeof COMPOSER_SLOT_META)[number];

type Props = {
  meta: Meta;
  value: string;
  count: number;
  onChange: (slot: AnimaComposerSlot, value: string) => void;
  onClear: (slot: AnimaComposerSlot) => void;
  onOpenLibrary?: () => void;
  /** 输入框下方的附加区域（画师分区挂「画师快取」） */
  after?: React.ReactNode;
};

export const AnimaComposerSection = React.memo(({
  meta,
  value,
  count,
  onChange,
  onClear,
  onOpenLibrary,
  after,
}: Props) => (
  <div className="al-composer-section">
    <div className="al-composer-section-head">
      <div>
        <h3>{meta.label}</h3>
        <span>{meta.hint}</span>
      </div>
      <div className="al-composer-section-actions">
        <span className="al-count">{count} 个词条</span>
        {onOpenLibrary && (
          <button type="button" className="secondary-action" onClick={onOpenLibrary} title="切到画廊挑选">
            <LibraryBig size={13} /> 词库
          </button>
        )}
        <button type="button" className="secondary-action" onClick={() => onClear(meta.key)} disabled={!value}>
          <Eraser size={13} />
        </button>
      </div>
    </div>
    <textarea
      rows={3}
      value={value}
      placeholder={meta.placeholder}
      spellCheck={false}
      onChange={(event) => onChange(meta.key, event.target.value)}
    />
    {after}
  </div>
));

AnimaComposerSection.displayName = "AnimaComposerSection";
