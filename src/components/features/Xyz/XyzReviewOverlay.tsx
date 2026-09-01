import React from "react";
import { Eye, EyeOff, Star } from "lucide-react";
import type { CSSProperties } from "react";
import type { XyzAxisInsight, XyzCellScore } from "../../../types";

interface XyzReviewBarProps {
  reviewedAt: number;
  overlayOn: boolean;
  best: XyzCellScore[];
  insights: XyzAxisInsight[];
  onToggleOverlay: () => void;
}

/** 复盘结果的控制条（热度层开关 + 最优组合），复盘完成前隐藏。 */
export const XyzReviewBar = React.memo(({
  reviewedAt,
  overlayOn,
  best,
  insights,
  onToggleOverlay,
}: XyzReviewBarProps) => {
  if (reviewedAt === 0) return null;
  return (
    <>
      <div className="xyz-review-bar">
        <button
          type="button"
          className={`icon-button${overlayOn ? " active" : ""}`}
          onClick={onToggleOverlay}
          title="开关网格热度叠加层"
        >
          {overlayOn ? <Eye size={16} /> : <EyeOff size={16} />} 热度层
        </button>
        {best.length > 0 && (
          <span className="xyz-review-best" title="本批次综合得分最高的组合">
            <Star size={13} /> 最优 {best[0].label} · {best[0].score.toFixed(1)} 分
          </span>
        )}
      </div>
      {insights.length > 0 && (
        <div className="xyz-insights">
          {insights.map((insight) => (
            <span key={insight.fieldLabel} className="xyz-insight-chip">
              {insight.fieldLabel}={insight.bestValue} 最优（均值 {insight.bestAverage.toFixed(1)}）
            </span>
          ))}
        </div>
      )}
    </>
  );
});

export const XyzCellBadge = React.memo(({ score, best }: { score: number; best: boolean }) => (
  <span
    className={`xyz-score-badge${best ? " is-best" : ""}`}
    style={{ "--cell-hue": String(score * 1.2) } as CSSProperties}
  >
    {Math.round(score)}
  </span>
));