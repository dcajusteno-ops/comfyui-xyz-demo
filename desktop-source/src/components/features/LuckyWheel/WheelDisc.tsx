import type { CSSProperties } from "react";
import { LoaderPinwheel } from "lucide-react";

import type { PromptRecord } from "../../../lib/promptLibrary";
import type { SectorResult, WheelSector } from "../../../lib/luckyWheel";
import {
  CHECK_BADGE_UNITS,
  WHEEL_CENTER,
  WHEEL_HUB_R,
  WHEEL_OUTER_R,
  sectorPath,
  truncateLabel,
  wheelLabelLayout,
} from "../../../lib/spinWheel";

interface WheelDiscProps {
  /** 参与转盘的扇区，顺序即盘上顺序 */
  sectors: WheelSector[];
  results: Record<string, SectorResult>;
  /** 指针当前指向的扇区 id（旋转开始时即为目标，保证指针与结果一致） */
  winnerSectorId: string | null;
  rotation: number;
  durationMs: number;
  spinning: boolean;
  hubLabel: string | null;
  hubTag: PromptRecord | null;
}

/** 单个大转盘：指针 + 可旋转的扇区盘 + 圆心结果。纯展示，无副作用。 */
export function WheelDisc({
  sectors,
  results,
  winnerSectorId,
  rotation,
  durationMs,
  spinning,
  hubLabel,
  hubTag,
}: WheelDiscProps) {
  const count = sectors.length;
  const winnerIndex = winnerSectorId ? sectors.findIndex((sector) => sector.id === winnerSectorId) : -1;
  const winnerSector = winnerIndex >= 0 ? sectors[winnerIndex] : null;

  return (
    <div className="wheel-stage">
      <span className={`wheel-pointer${spinning ? " is-spinning" : ""}`} aria-hidden="true" />

      {count === 0 ? (
        <div className="wheel-empty" role="status">
          没有可用的扇区
        </div>
      ) : (
        <div
          className="wheel-rotor"
          style={{ transform: `rotate(${rotation}deg)`, transitionDuration: `${durationMs}ms` }}
        >
          <svg
            className="wheel-svg"
            viewBox="0 0 200 200"
            role="img"
            aria-label={`幸运大转盘，指针指向：${winnerSector?.label ?? "无"}`}
          >
            {count === 1 ? (
              <>
                <circle
                  className="wheel-sector"
                  cx={WHEEL_CENTER}
                  cy={WHEEL_CENTER}
                  r={(WHEEL_OUTER_R + WHEEL_HUB_R) / 2}
                  strokeWidth={WHEEL_OUTER_R - WHEEL_HUB_R}
                  data-sector-id={sectors[0].id}
                />
                <circle className="wheel-sector-hole" cx={WHEEL_CENTER} cy={WHEEL_CENTER} r={WHEEL_HUB_R} />
              </>
            ) : (
              sectors.map((sector, index) => {
                const drawn = results[sector.id];
                const classes = [
                  "wheel-sector",
                  index % 2 ? "is-alt" : "",
                  drawn ? "is-drawn" : "",
                  drawn?.locked ? "is-locked" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <path
                    key={sector.id}
                    className={classes}
                    data-sector-id={sector.id}
                    style={{ "--sector-hue": `var(--char-${(index % 6) + 1})` } as CSSProperties}
                    d={sectorPath(
                      WHEEL_CENTER,
                      WHEEL_CENTER,
                      WHEEL_HUB_R,
                      WHEEL_OUTER_R,
                      (index * 360) / count,
                      ((index + 1) * 360) / count
                    )}
                  >
                    <title>
                      {drawn
                        ? `${sector.label}：${drawn.tag.text_en}${drawn.tag.text_zh ? `（${drawn.tag.text_zh}）` : ""}`
                        : sector.label}
                    </title>
                  </path>
                );
              })
            )}

            {count > 1 &&
              sectors.map((sector, index) => {
                const layout = wheelLabelLayout(index, count, WHEEL_HUB_R, WHEEL_OUTER_R);
                const drawn = results[sector.id];
                // 已抽中的扇区尾部要挂「✓」，排版预算得先把它扣掉，否则标签会冲出圆盘
                const budget = drawn ? Math.max(2, layout.maxChars - CHECK_BADGE_UNITS) : layout.maxChars;
                return (
                  <text
                    key={`label-${sector.id}`}
                    className="wheel-label"
                    transform={`translate(${layout.x} ${layout.y}) rotate(${layout.rotate})`}
                    textAnchor={layout.anchor}
                    dominantBaseline="middle"
                    fontSize={layout.fontSize}
                  >
                    {truncateLabel(sector.label, budget)}
                    {drawn ? (
                      <tspan className="wheel-check" dx="0.3em">
                        ✓
                      </tspan>
                    ) : null}
                  </text>
                );
              })}
          </svg>
        </div>
      )}

      <div className={`wheel-hub${spinning ? " is-spinning" : ""}`}>
        {spinning ? (
          <>
            <LoaderPinwheel className="wheel-spin-icon" size={18} />
            <span className="wheel-hub-hint">转动中…</span>
          </>
        ) : hubTag ? (
          <>
            {hubLabel ? <span className="wheel-hub-label">{hubLabel}</span> : null}
            <span className="wheel-hub-text" title={hubTag.text_en}>
              {hubTag.text_en}
            </span>
            {hubTag.text_zh ? <span className="wheel-hub-zh">{hubTag.text_zh}</span> : null}
          </>
        ) : (
          <span className="wheel-hub-hint">点「转动」开始</span>
        )}
      </div>
    </div>
  );
}

export default WheelDisc;
