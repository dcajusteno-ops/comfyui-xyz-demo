import { useEffect, useRef, useState } from "react";
import type { DatasetAxisConfig, DatasetAxisKey } from "../../../types";
import { DATASET_AXIS_META, DATASET_AXIS_ORDER, DATASET_DEFAULT_POOLS } from "../../../lib/dataset/pools";
import { normalizePool } from "../../../lib/dataset/plan";

/**
 * 变化轴编辑器。
 *
 * 词池用「草稿模式」编辑：编辑期只维护本地字符串，失焦/回车才归一化提交。
 * 直接拿 `pool.join("\n")` 做受控值会让用户敲不进逗号——每敲一个分隔符就被
 * 重新切分、光标跳走（大转盘的分区列表踩过同一个坑）。
 */

function AxisCard({
  axis,
  config,
  disabled,
  onChange,
}: {
  axis: DatasetAxisKey;
  config: DatasetAxisConfig;
  disabled: boolean;
  onChange: (patch: Partial<DatasetAxisConfig>) => void;
}) {
  const meta = DATASET_AXIS_META[axis];
  const [draft, setDraft] = useState(() => config.pool.join("\n"));
  const focused = useRef(false);

  // 外部改动（恢复内置、重新规划后重载）时才覆盖草稿，编辑中不打断输入
  useEffect(() => {
    if (!focused.current) setDraft(config.pool.join("\n"));
  }, [config.pool]);

  const parsed = normalizePool(draft.split(/\n/));
  const commit = () => {
    if (disabled) return;
    if (parsed.join("|") === config.pool.join("|")) return;
    onChange({ pool: parsed });
  };

  const restore = () => {
    const pool = [...DATASET_DEFAULT_POOLS[axis]];
    setDraft(pool.join("\n"));
    onChange({ pool });
  };

  return (
    <details className={`ds-axis${config.enabled ? "" : " off"}`}>
      <summary className="ds-axis-head">
        <input
          type="checkbox"
          checked={config.enabled}
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onChange({ enabled: event.target.checked })}
          aria-label={`启用${meta.label}`}
        />
        <span className="ds-axis-name">{meta.label}</span>
        <span className="ds-axis-count">{config.pool.length} 词 · 每条 {config.perItem}</span>
      </summary>
      <div className="ds-axis-body">
        <p className="ds-hint">{meta.hint}</p>
        <div className="ds-axis-tools">
          <label className="ds-inline">
            每条取
            <input
              type="number"
              min={0}
              max={meta.maxPerItem}
              value={config.perItem}
              disabled={disabled}
              onChange={(event) => onChange({ perItem: Number(event.target.value) })}
            />
            个
          </label>
          <button type="button" className="ghost-btn" disabled={disabled} onClick={restore}>
            恢复内置词池
          </button>
          <span className="ds-hint">当前 {parsed.length} 个有效词（逗号/换行分隔，自动去重）</span>
        </div>
        <textarea
          className="ds-axis-pool"
          value={draft}
          disabled={disabled}
          spellCheck={false}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            focused.current = false;
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </div>
    </details>
  );
}

export function DatasetAxisEditor({
  axes,
  disabled,
  onChange,
}: {
  axes: Record<DatasetAxisKey, DatasetAxisConfig>;
  disabled: boolean;
  onChange: (axis: DatasetAxisKey, patch: Partial<DatasetAxisConfig>) => void;
}) {
  const enabled = DATASET_AXIS_ORDER.filter((axis) => axes[axis]?.enabled).length;
  const totalTags = DATASET_AXIS_ORDER.reduce((sum, axis) => sum + (axes[axis]?.pool?.length ?? 0), 0);
  return (
    <section className="ds-card">
      <header className="ds-card-head">
        <h3>变化轴</h3>
        <span className="ds-hint">
          {enabled}/{DATASET_AXIS_ORDER.length} 轴启用 · 共 {totalTags} 词 · 点开某一轴可改词池与每条取词数
        </span>
      </header>
      <div className="ds-axis-list">
        {DATASET_AXIS_ORDER.map((axis) => (
          <AxisCard
            key={axis}
            axis={axis}
            config={axes[axis]}
            disabled={disabled}
            onChange={(patch) => onChange(axis, patch)}
          />
        ))}
      </div>
    </section>
  );
}
