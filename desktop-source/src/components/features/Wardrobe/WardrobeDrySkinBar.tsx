import { Sparkles, X } from "lucide-react";
import {
  SKIN_MOISTURE_ALL_TAGS,
  SKIN_MOISTURE_GROUPS,
  skinMoistureBanSet,
  skinMoistureItems,
  skinMoistureOnlyTagsFromSet,
} from "../../../lib/wardrobe/skinMoisture";
import { WARDROBE_DRY_SKIN_GROUPS } from "../../../lib/wardrobe/persist";
import type { WardrobeUiState } from "../../../lib/wardrobe/types";

type Props = {
  state: WardrobeUiState;
  onClose: () => void;
  onChange: (patch: Partial<WardrobeUiState["drySkin"]>) => void;
};

/**
 * 干爽过滤抽屉（v6.5.x / V6.5.2 逐条可控）。
 *
 * 状态模型与插件一致：`onlyTags` 优先于 groups —— `""` = 按组，`"none"` = 一条都不关，
 * 逗号串 = 只关这些，`"all"` = 全部 19 条。面板上「按组勾选」和「逐条勾选」写的
 * 都是同一个 `onlyTags`，不做第二套状态（否则两边一定会不同步）。
 */
export function WardrobeDrySkinBar({ state, onClose, onChange }: Props) {
  const { enabled, onlyTags, groups } = state.drySkin;
  const active = skinMoistureBanSet(groups, onlyTags);

  const write = (next: Set<string>) => onChange({ onlyTags: skinMoistureOnlyTagsFromSet(next) });

  const toggleTag = (tag: string) => {
    const next = new Set(active);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    write(next);
  };

  const toggleGroup = (id: string) => {
    const tags = SKIN_MOISTURE_GROUPS[id]?.[1] ?? [];
    const next = new Set(active);
    const on = tags.every((tag) => next.has(tag));
    for (const tag of tags) {
      if (on) next.delete(tag);
      else next.add(tag);
    }
    write(next);
  };

  return (
    <div className="wd-dryskin">
      <div className="wd-dryskin-head">
        <label className="wd-mini-check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
          <Sparkles size={13} /> 干爽过滤（成品层剔除「皮肤水珠」词条）
        </label>
        <span className="wd-muted">
          已选 {active.size} / {SKIN_MOISTURE_ALL_TAGS.size} 条 · 默认关，关闭时零影响
        </span>
        <button type="button" className="wd-icon-btn" onClick={onClose} aria-label="关闭干爽过滤面板">
          <X size={14} />
        </button>
      </div>

      <div className="wd-dryskin-groups">
        {WARDROBE_DRY_SKIN_GROUPS.map((id) => {
          const [zh, tags] = SKIN_MOISTURE_GROUPS[id] ?? ["", []];
          const on = tags.length > 0 && tags.every((tag) => active.has(tag));
          return (
            <label key={id} className="wd-mini-check" title={tags.join(" / ")}>
              <input type="checkbox" checked={on} onChange={() => toggleGroup(id)} />
              {zh}
              <span className="wd-muted">（{tags.length}）</span>
            </label>
          );
        })}
        <button
          type="button"
          className="wd-link-btn"
          onClick={() => write(new Set(SKIN_MOISTURE_ALL_TAGS))}
        >
          全选
        </button>
        <button type="button" className="wd-link-btn" onClick={() => write(new Set())}>
          清空
        </button>
        <button
          type="button"
          className="wd-link-btn"
          onClick={() => onChange({ onlyTags: "" })}
          title="回到「按分组」语义（默认包含全部 5 组）"
        >
          按组（默认）
        </button>
      </div>

      <div className="wd-dryskin-items">
        {WARDROBE_DRY_SKIN_GROUPS.flatMap((id) =>
          skinMoistureItems(id).map(([en, zh]) => (
            <button
              key={en}
              type="button"
              className={`wd-dryskin-tag${active.has(en) ? " is-on" : ""}`}
              onClick={() => toggleTag(en)}
              title={`${en}${active.has(en) ? " · 已加入剔除" : " · 点击加入剔除"}`}
              aria-pressed={active.has(en)}
            >
              {zh}
            </button>
          )),
        )}
      </div>
      <div className="wd-muted">
        流泪场景（泪光特写）例外：出现 tears / crying 等标记时仍保留 glistening skin。
      </div>
    </div>
  );
}
