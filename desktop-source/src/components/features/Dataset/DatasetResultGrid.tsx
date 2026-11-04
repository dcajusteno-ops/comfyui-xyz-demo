import { useState } from "react";
import { Copy } from "lucide-react";
import type { DatasetFile, DatasetItem } from "../../../types";

/**
 * 结果网格。
 * 100 张全尺寸 PNG 一起解码会吃掉几百 MB，因此默认只渲染最近 24 张，
 * 且图片一律 `loading="lazy"` + `decoding="async"`（与 LoRA 媒体卡同款写法）。
 */
export function DatasetResultGrid({
  items,
  resolveImageUrl,
  onOpenImage,
  onCopyCaption,
}: {
  items: DatasetItem[];
  resolveImageUrl: (file: DatasetFile) => string;
  onOpenImage: (url: string) => void;
  onCopyCaption: (item: DatasetItem) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const done = items.filter((item) => item.status === "success" && item.files.length > 0);
  const shown = showAll ? done : done.slice(-24);

  return (
    <section className="ds-card">
      <header className="ds-card-head">
        <h3>已出图</h3>
        <span className="ds-hint">
          {done.length} 张{!showAll && done.length > shown.length ? `（显示最近 ${shown.length} 张）` : ""}
        </span>
        {done.length > 24 && (
          <button type="button" className="ghost-btn" onClick={() => setShowAll((prev) => !prev)}>
            {showAll ? "只看最近 24 张" : `展开全部 ${done.length} 张`}
          </button>
        )}
      </header>

      {shown.length === 0 ? (
        <p className="ds-empty">还没有出图。点「开始生成」后这里会按序号铺开。</p>
      ) : (
        <div className="ds-grid">
          {shown.map((item) => {
            const file = item.files[0];
            const url = resolveImageUrl(file);
            return (
              <figure className="ds-thumb" key={item.id}>
                <button type="button" className="ds-thumb-btn" title={item.caption} onClick={() => onOpenImage(url)}>
                  <img src={url} alt={`#${item.index}`} loading="lazy" decoding="async" />
                  <span className="ds-thumb-index">{String(item.index).padStart(3, "0")}</span>
                </button>
                <figcaption>
                  <span title={item.caption}>{item.caption || "—"}</span>
                  <button type="button" className="icon-btn" title="复制 caption" onClick={() => onCopyCaption(item)}>
                    <Copy size={12} />
                  </button>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </section>
  );
}
