import { useMemo } from "react";
import { Clock } from "lucide-react";
import { buildXyzCombinations } from "../../../lib/xyz";
import type { XyzAxis } from "../../../types";

export function XyzPreview({
  axes,
  lorasOfTarget,
  excludedIndices,
  onToggleIndex,
}: {
  axes: XyzAxis[];
  lorasOfTarget?: { name: string; displayName?: string }[];
  excludedIndices: Set<number>;
  onToggleIndex: (index: number) => void;
}) {
  const allCombos = useMemo(() => buildXyzCombinations(axes, lorasOfTarget), [axes, lorasOfTarget]);
  const activeCount = allCombos.length - excludedIndices.size;
  const estMinutes = Math.ceil((activeCount * 15) / 60);

  return (
    <div className="xyz-preview">
      <div className="section-toolbar">
        <div className="preview-status">
          <strong>组合预览</strong>
          <span className="count-badge">
            {activeCount} / {allCombos.length} 活跃
          </span>
        </div>
        {activeCount > 0 && (
          <div className="est-time">
            <Clock size={14} />
            预计 {estMinutes} 分钟
          </div>
        )}
      </div>
      {allCombos.length === 0 ? (
        <div className="empty-strip">启用轴并填写取值后会显示组合预览</div>
      ) : (
        <div className="preview-table custom-scrollbar">
          {allCombos.slice(0, 100).map((combo, index) => {
            const isExcluded = excludedIndices.has(index);
            return (
              <div
                className={`preview-row ${isExcluded ? "excluded" : ""}`}
                key={`${combo.label}-${index}`}
                onClick={() => onToggleIndex(index)}
              >
                <div className="row-selector">
                  <div className={`checkbox-mini ${!isExcluded ? "checked" : ""}`}>
                    {!isExcluded && <div className="check-mark" />}
                  </div>
                  <span className="idx">{index + 1}</span>
                </div>
                <div className="row-content">
                  <strong className="label">{combo.label}</strong>
                  <code className="patch-info">{JSON.stringify(combo.patch)}</code>
                </div>
              </div>
            );
          })}
          {allCombos.length > 100 && <div className="empty-strip">仅预览前 100 个组合</div>}
        </div>
      )}
    </div>
  );
}
