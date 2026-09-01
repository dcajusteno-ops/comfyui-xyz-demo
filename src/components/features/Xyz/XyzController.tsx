import React, { useEffect, useMemo } from "react";
import {
  SlidersHorizontal,
  CircleHelp,
  PauseCircle,
  RefreshCw,
  FileText,
  Grid3X3,
  Gauge,
  RotateCw,
} from "lucide-react";
import { PanelTitle } from "../../ui";
import { XyzPreview } from "./XyzPreview";
import { XyzHelpModal } from "./XyzHelpModal";
import { XyzReviewBar, XyzCellBadge } from "./XyzReviewOverlay";
import { useXyzReview } from "../../../hooks/useXyzReview";
import { xyzStatusLabel } from "../../../lib/app-utils";
import { templateLabels } from "../../../constants";
import { fieldLabel } from "../../../lib/xyz";
import { buildXyzCombinations } from "../../../lib/xyz";
import type {
  XyzAxis,
  TemplateKind,
  XyzField,
  BaseGenerationParams,
  MultiGenerationParams,
  HighresParams,
  LoraItem,
  XyzCellScore,
} from "../../../types";

interface XyzControllerProps {
  xyzTarget: TemplateKind;
  setXyzTarget: (target: TemplateKind) => void;
  xyzAxes: XyzAxis[];
  setXyzAxes: (axes: XyzAxis[] | ((prev: XyzAxis[]) => XyzAxis[])) => void;
  xyzExcludedIndices: Set<number>;
  onToggleXyzIndex: (index: number) => void;
  showXyzHelp: boolean;
  setShowXyzHelp: (show: boolean) => void;
  lorasOfTarget: { name: string; displayName?: string }[];
  gen: {
    runXyz: (axes: XyzAxis[], excluded: Set<number>, target: TemplateKind, loras: any, def: any, multi: any, high: any) => void;
    stopXyzQueue: () => void;
    retryFailedXyz: (target: TemplateKind, def: any, multi: any, high: any) => void;
    exportXyzResults: (target: TemplateKind, axes: XyzAxis[]) => void;
    exportXyzGrid: (target: TemplateKind, axes: XyzAxis[], loras: any) => void;
    rerunXyzItem: (item: any, target: TemplateKind, def: any, multi: any, high: any) => void;
    xyzResults: any[];
    progress: { running: boolean };
  };
  params: {
    defaultParams: BaseGenerationParams;
    multiParams: MultiGenerationParams;
    highresParams: HighresParams;
  };
  onOutputLightbox: (url: string) => void;
}

export const XyzController = React.memo(({
  xyzTarget,
  setXyzTarget,
  xyzAxes,
  setXyzAxes,
  xyzExcludedIndices,
  onToggleXyzIndex,
  showXyzHelp,
  setShowXyzHelp,
  lorasOfTarget,
  gen,
  params,
  onOutputLightbox,
}: XyzControllerProps) => {
  const review = useXyzReview();

  // XYZ 结果数据集发生变化（新运行 / 重跑 / 重试）时，清掉上一轮的复盘状态
  useEffect(() => {
    review.clearReview();
  }, [gen.xyzResults]);

  const xyzFields: XyzField[] = useMemo(() => [
    "seed",
    "steps",
    "cfg",
    "width",
    "height",
    "samplerName",
    "scheduler",
    "denoise",
    "positiveAppend",
    ...lorasOfTarget.flatMap((_, i) => [`loraName_${i}` as const, `loraStrength_${i}` as const]),
    "loraAppendName_1",
    "loraAppendStrength_1",
    "loraAppendName_2",
    "loraAppendStrength_2",
    "drawTextText",
    "drawTextFont",
  ], [lorasOfTarget]);

  const updateAxis = (index: number, patch: Partial<XyzAxis>) => {
    setXyzAxes((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const canReview =
    !review.reviewing &&
    gen.xyzResults.some((item) => item.status === "success" && item.result?.images?.length);

  const bestCells: XyzCellScore[] = useMemo(() => {
    if (!review.outcome || !review.outcome.samples.length) return [];
    const byUrl = new Map(review.outcome.samples.map((sample) => [sample.url, sample]));
    return review.bestUrls
      .map((url) => {
        const sample = byUrl.get(url);
        return sample ? { url: sample.url, label: sample.item.label, score: sample.score } : null;
      })
      .filter((entry): entry is XyzCellScore => entry !== null);
  }, [review.outcome, review.bestUrls]);

  return (
    <section className="panel xyz-panel">
      <PanelTitle icon={SlidersHorizontal} title="XYZ 控制器" />
      <div className="xyz-head">
        <label className="field">
          <span>目标模板</span>
          <select
            value={xyzTarget}
            onChange={(event) => setXyzTarget(event.target.value as TemplateKind)}
          >
            {Object.entries(templateLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="metric-card">
          <strong>{buildXyzCombinations(xyzAxes, lorasOfTarget).length}</strong>
          <span>组合</span>
        </div>
        <div className="xyz-preset-bar">
          <button type="button" className="icon-button" onClick={() => setShowXyzHelp(true)}>
            <CircleHelp size={16} /> 怎么用
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() =>
              setXyzAxes([
                { enabled: true, field: "seed", values: "1,2,3" },
                { enabled: false, field: "cfg", values: "5,7" },
                { enabled: false, field: "steps", values: "20..30..10" },
              ])
            }
          >
            Seed
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() =>
              setXyzAxes([
                { enabled: true, field: "cfg", values: "5,7,9" },
                { enabled: false, field: "steps", values: "20..30..10" },
                { enabled: false, field: "seed", values: "1,2" },
              ])
            }
          >
            CFG
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() =>
              setXyzAxes([
                { enabled: true, field: "width", values: "768,1024" },
                { enabled: true, field: "height", values: "1024,1536" },
                { enabled: false, field: "seed", values: "1,2" },
              ])
            }
          >
            尺寸
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() =>
              setXyzAxes([
                { enabled: true, field: "loraStrength_0", values: "0.6,0.8,1" },
                { enabled: false, field: "seed", values: "1,2" },
                { enabled: false, field: "cfg", values: "5,7" },
              ])
            }
          >
            LoRA 强度
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() =>
              setXyzAxes([
                {
                  enabled: true,
                  field: "positiveAppend",
                  values: "cinematic lighting\\nsoft light",
                },
                { enabled: false, field: "seed", values: "1,2" },
                { enabled: false, field: "cfg", values: "5,7" },
              ])
            }
          >
            提示词追加
          </button>
        </div>
      </div>
      <div className="axis-list">
        {xyzAxes.map((axis, index) => (
          <div className="axis-row" key={index}>
            <label className="axis-toggle">
              <input
                type="checkbox"
                checked={axis.enabled}
                onChange={(event) => updateAxis(index, { enabled: event.target.checked })}
              />{" "}
              {["X", "Y", "Z"][index]}
            </label>
            <select
              value={axis.field}
              onChange={(event) => updateAxis(index, { field: event.target.value as XyzField })}
            >
              {xyzFields.map((field) => (
                <option key={field} value={field}>
                  {fieldLabel(field, lorasOfTarget)}
                </option>
              ))}
            </select>
            <input
              value={axis.values}
              onChange={(event) => updateAxis(index, { values: event.target.value })}
            />
          </div>
        ))}
      </div>
      <XyzPreview
        axes={xyzAxes}
        lorasOfTarget={lorasOfTarget}
        excludedIndices={xyzExcludedIndices}
        onToggleIndex={onToggleXyzIndex}
      />
      <button
        className="primary-action xyz-run-btn"
        type="button"
        onClick={() =>
          gen.runXyz(
            xyzAxes,
            xyzExcludedIndices,
            xyzTarget,
            lorasOfTarget,
            params.defaultParams,
            params.multiParams,
            params.highresParams
          )
        }
      >
        <SlidersHorizontal size={18} />
        顺序执行 XYZ
      </button>
      <div className="xyz-actions">
        <button
          type="button"
          className="icon-button danger"
          disabled={!gen.progress.running}
          onClick={gen.stopXyzQueue}
        >
          <PauseCircle size={16} /> 中断队列
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={!canReview || review.reviewing}
          onClick={() => review.startReview(gen.xyzResults, xyzAxes, lorasOfTarget)}
        >
          {review.reviewing ? <RotateCw size={16} className="spin" /> : <Gauge size={16} />}
          {review.reviewing && review.progress
            ? `复盘中 ${review.progress.done}/${review.progress.total}`
            : "智能复盘"}
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={!gen.xyzResults.some((item) => item.status === "failed")}
          onClick={() =>
            gen.retryFailedXyz(
              xyzTarget,
              params.defaultParams,
              params.multiParams,
              params.highresParams
            )
          }
        >
          <RefreshCw size={16} /> 重试失败
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={gen.xyzResults.length === 0}
          onClick={() => gen.exportXyzResults(xyzTarget, xyzAxes)}
        >
          <FileText size={16} /> 导出结果
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={gen.xyzResults.length === 0}
          onClick={() => gen.exportXyzGrid(xyzTarget, xyzAxes, lorasOfTarget)}
        >
          <Grid3X3 size={16} /> 导出网格
        </button>
      </div>
      <XyzReviewBar
        reviewedAt={review.reviewedAt}
        overlayOn={review.overlayOn}
        best={bestCells}
        insights={review.insights}
        onToggleOverlay={review.toggleOverlay}
      />
      <div className="xyz-grid">
        {gen.xyzResults.map((item) => {
          const itemUrl = item.result?.images?.[0]?.url;
          const cellScore = itemUrl ? review.scoresByUrl[itemUrl] : undefined;
          const isBestCell = itemUrl ? review.bestUrls.includes(itemUrl) : false;
          return (
          <div className={`result-card xyz-result ${item.status}`} key={item.id}>
            <div className="xyz-result-head">
              <strong>{item.label}</strong>
              <span>{xyzStatusLabel(item.status)}</span>
            </div>
            {item.result?.images[0] ? (
              <div className={`xyz-result-media${isBestCell ? " xyz-best" : ""}`}>
                <img
                  src={item.result.images[0].url}
                  alt={item.label}
                  style={{ cursor: "zoom-in" }}
                  onClick={() => onOutputLightbox(item.result!.images[0].url)}
                />
                {review.overlayOn && cellScore !== undefined && (
                  <XyzCellBadge score={cellScore} best={isBestCell} />
                )}
              </div>
            ) : (
              <div className="xyz-image-placeholder" />
            )}
            {item.error && <p>{item.error}</p>}
            {item.status !== "running" && item.status !== "queued" && (
              <button
                type="button"
                className="lm-text-btn"
                onClick={() =>
                  gen.rerunXyzItem(
                    item,
                    xyzTarget,
                    params.defaultParams,
                    params.multiParams,
                    params.highresParams
                  )
                }
              >
                <RefreshCw size={13} /> 重跑
              </button>
            )}
          </div>
          );
        })}
      </div>
    </section>
  );
}
);
