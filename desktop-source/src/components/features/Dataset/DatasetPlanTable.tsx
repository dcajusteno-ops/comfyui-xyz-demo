import { useMemo, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import type { DatasetItem, DatasetItemStatus } from "../../../types";
import { DATASET_AXIS_META, DATASET_AXIS_ORDER } from "../../../lib/dataset/pools";

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<DatasetItemStatus, string> = {
  queued: "待生成",
  running: "生成中",
  success: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "待补跑",
};

export function DatasetPlanTable({
  items,
  disabled,
  onRerunOne,
  onCopyCaption,
}: {
  items: DatasetItem[];
  disabled: boolean;
  onRerunOne: (id: string) => void;
  onCopyCaption: (item: DatasetItem) => void;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  // 计划变短（重新规划/改张数）时用派生值夹住页码，避免在 effect 里 setState 触发级联渲染
  const safePage = Math.min(page, pages - 1);

  const view = useMemo(
    () => items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [items, safePage],
  );

  if (!items.length) {
    return (
      <section className="ds-card">
        <header className="ds-card-head">
          <h3>生成计划</h3>
        </header>
        <p className="ds-empty">
          还没有计划。点「开始生成」会自动按当前设置排一份并立刻开跑；想先看词再跑，就点「重新规划」。
        </p>
      </section>
    );
  }

  return (
    <section className="ds-card">
      <header className="ds-card-head">
        <h3>生成计划</h3>
        <span className="ds-hint">
          共 {items.length} 条 · 第 {safePage + 1}/{pages} 页
        </span>
        {pages > 1 && (
          <div className="ds-pager">
            <button
              type="button"
              className="ghost-btn"
              disabled={safePage === 0}
              onClick={() => setPage(Math.max(0, safePage - 1))}
            >
              上一页
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={safePage >= pages - 1}
              onClick={() => setPage(Math.min(pages - 1, safePage + 1))}
            >
              下一页
            </button>
          </div>
        )}
      </header>

      <div className="ds-table" role="table">
        <div className="ds-row ds-row-head" role="row">
          <span>#</span>
          <span>变化词</span>
          <span>Seed</span>
          <span>Caption</span>
          <span>状态</span>
          <span />
        </div>
        {view.map((item) => (
          <div className={`ds-row ds-status-row-${item.status}`} role="row" key={item.id}>
            <span className="ds-index">{String(item.index).padStart(3, "0")}</span>
            <span className="ds-tags" title={item.prompt}>
              {DATASET_AXIS_ORDER.flatMap((axis) =>
                (item.tags[axis] ?? []).map((tag) => (
                  <em key={`${axis}-${tag}`} title={DATASET_AXIS_META[axis].label}>
                    {tag}
                  </em>
                )),
              )}
            </span>
            <span className="ds-seed" title={String(item.seed)}>{item.seed}</span>
            <span className="ds-caption" title={item.caption}>
              {item.caption || "—"}
            </span>
            <span className={`ds-status ds-status-${item.status}`} title={item.error}>
              {STATUS_LABEL[item.status]}
              {item.error ? " ⚠" : ""}
            </span>
            <span className="ds-row-actions">
              <button type="button" className="icon-btn" title="复制 caption" onClick={() => onCopyCaption(item)}>
                <Copy size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="重跑这一条"
                disabled={disabled}
                onClick={() => onRerunOne(item.id)}
              >
                <RefreshCw size={14} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
