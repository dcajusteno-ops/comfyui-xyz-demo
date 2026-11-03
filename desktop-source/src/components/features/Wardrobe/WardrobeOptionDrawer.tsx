import { useMemo, useState } from "react";
import { Search, Target } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { optionLevel } from "../../../lib/wardrobe/levels";
import { setOptionWeight, toggleOptionForced } from "../../../lib/wardrobe/state";
import type { WardrobeField, WardrobeUiState } from "../../../lib/wardrobe/types";

type Props = {
  field: WardrobeField;
  state: WardrobeUiState;
  setState: Dispatch<SetStateAction<WardrobeUiState>>;
  lv: number;
  locked: boolean;
};

export function WardrobeOptionDrawer({ field, state, setState, lv, locked }: Props) {
  const [query, setQuery] = useState("");
  const [inLevelOnly, setInLevelOnly] = useState(false);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (field.opts ?? [])
      .map(([zh, en]) => ({ zh, en, level: optionLevel(field.key, en) }))
      .filter((row) => (inLevelOnly ? row.level <= lv : true))
      .filter((row) => !q || row.zh.toLowerCase().includes(q) || row.en.toLowerCase().includes(q));
  }, [field.key, field.opts, inLevelOnly, lv, query]);

  return (
    <div className="wd-options">
      <div className="wd-options-head">
        <label className="wd-options-search">
          <Search size={12} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜选项（中文 / 英文）"
            aria-label={`${field.lab} 选项搜索`}
          />
        </label>
        <label className="wd-mini-check">
          <input
            type="checkbox"
            checked={inLevelOnly}
            onChange={(event) => setInLevelOnly(event.target.checked)}
          />
          仅本档
        </label>
        <span className="wd-options-count">{options.length} 项</span>
      </div>
      <div className="wd-options-list">
        {options.map((row) => {
          const weight = state.weights.options[field.key]?.[row.en.toLowerCase()] ?? 1;
          const forced = state.forced[field.key] === row.en;
          return (
            <div
              key={row.en}
              className={`wd-opt${row.level > lv ? " is-over" : ""}${forced ? " is-forced" : ""}`}
            >
              <span className={`wd-chip lv${row.level}`} title={`选项档位 L${row.level}`}>
                L{row.level}
              </span>
              <div className="wd-opt-name">
                <span>{row.zh || row.en}</span>
                {row.zh && row.zh !== row.en && <em>{row.en}</em>}
              </div>
              <input
                className="wd-weight"
                type="range"
                min={0}
                max={3}
                step={0.1}
                value={weight}
                disabled={locked}
                aria-label={`${row.zh || row.en} 选项权重`}
                onChange={(event) =>
                  setState((prev) => setOptionWeight(prev, field.key, row.en, Number(event.target.value)))
                }
              />
              <span className="wd-weight-value">{weight.toFixed(1)}</span>
              <button
                type="button"
                className={`wd-force${forced ? " is-on" : ""}`}
                disabled={locked}
                onClick={() => setState((prev) => toggleOptionForced(prev, field.key, row.en))}
                title={forced ? "取消强制" : "强制本次使用该选项"}
                aria-label={forced ? "取消强制" : "强制该选项"}
              >
                <Target size={12} />
              </button>
            </div>
          );
        })}
        {options.length === 0 && <div className="wd-empty">没有匹配的选项</div>}
      </div>
    </div>
  );
}
