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
import { XyzReviewBar, XyzCellBadge } from "./XyzReviewOverlay";
import { useXyzReview } from "../../../hooks/useXyzReview";
import type { useGeneration } from "../../../hooks/useGeneration";
import { xyzStatusLabel } from "../../../lib/app-utils";
import { animaStageMeta, templateLabels } from "../../../constants";
import { axisValuePlaceholder, fieldLabel } from "../../../lib/xyz";
import { buildXyzCombinations } from "../../../lib/xyz";
import type {
  XyzAxis,
  TemplateKind,
  XyzField,
  LoraSelection,
  BaseGenerationParams,
  MultiGenerationParams,
  HighresParams,
  AnimaGenerationParams,
  OptionsState,
  XyzCellScore,
  XyzCombination,
} from "../../../types";

/** 快捷预设用的轴构造器：默认禁用，主轴显式开 */
const makeAxis = (field: XyzField, values: string, enabled = false): XyzAxis => ({
  enabled,
  field,
  values,
});

interface XyzControllerProps {
  xyzTarget: TemplateKind;
  setXyzTarget: (target: TemplateKind) => void;
  xyzAxes: XyzAxis[];
  setXyzAxes: (axes: XyzAxis[] | ((prev: XyzAxis[]) => XyzAxis[])) => void;
  xyzExcludedIndices: Set<number>;
  onToggleXyzIndex: (index: number) => void;
  showXyzHelp: boolean;
  setShowXyzHelp: (show: boolean) => void;
  lorasOfTarget: LoraSelection[];
  /** useGeneration 的返回值（类型化取自 hook 本体，避免手写接口漂移） */
  gen: ReturnType<typeof useGeneration>;
  params: {
    defaultParams: BaseGenerationParams;
    multiParams: MultiGenerationParams;
    highresParams: HighresParams;
    animaParams: AnimaGenerationParams;
  };
  /** Anima 的能力探测结果（重绘时透传给 builder） */
  animaCaps: OptionsState["animaCaps"];
  /** 枚举列表（采样器/调度器等），快捷预设取真实可选值而不是硬编码 */
  options: OptionsState;
  /** LoRA 库文件名列表，供「LoRA 模型」快捷预设填真实文件名 */
  loraNames: string[];
  onOutputLightbox: (url: string) => void;
  /** 把某个组合的 patch 回填到目标模板面板（T8：批量试 → 选最优 → 回单张微调） */
  onApplyCombo?: (combo: XyzCombination) => void;
}

export const XyzController = React.memo(({
  xyzTarget,
  setXyzTarget,
  xyzAxes,
  setXyzAxes,
  xyzExcludedIndices,
  onToggleXyzIndex,
  setShowXyzHelp,
  lorasOfTarget,
  gen,
  params,
  animaCaps,
  options,
  loraNames,
  onOutputLightbox,
  onApplyCombo,
}: XyzControllerProps) => {
  const review = useXyzReview();

  // XYZ 结果数据集发生变化（新运行 / 重跑 / 重试）时，清掉上一轮的复盘状态
  useEffect(() => {
    review.clearReview();
  }, [gen.xyzResults]);

  const xyzFields: XyzField[] = useMemo(() => {
    const common: XyzField[] = [
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
    ];
    if (xyzTarget !== "anima") return common;
    // Anima 专属轴：放大倍率 / 精修参数 / 12 个阶段开关（布尔）
    return [
      ...common,
      "animaHiresPrePercent",
      "animaHiresPostPercent",
      "animaRefineSteps",
      "animaRefineCfg",
      "animaRefineDenoise",
      ...animaStageMeta.map(({ key }) => `animaStage_${key}` as XyzField),
    ];
  }, [lorasOfTarget, xyzTarget]);

  // 快捷预设：一键把三行轴填成常用组合（整体替换，值都可以再改）。
  // 枚举类（采样器/调度器/LoRA 模型）从真实列表取前几项，空列表时退回中性占位。
  const xyzPresets = useMemo(() => {
    const samplerValues = options.samplers.slice(0, 3).join(", ") || "euler, ddim";
    const schedulerValues = options.schedulers.slice(0, 3).join(", ") || "simple, karras";
    // 面板挂了 LoRA 就替换第 1 个槽位；否则走追加轴（不依赖已有槽位）。
    // 取值用库序号范围语法：1..6 = LoRA 库第 1～6 个，不用逐个填文件名
    const loraModelField: XyzField = lorasOfTarget.length > 0 ? "loraName_0" : "loraAppendName_1";

    const presets: Array<{ label: string; axes: XyzAxis[] }> = [
      {
        label: "Seed",
        axes: [makeAxis("seed", "1,2,3", true), makeAxis("cfg", "5,7"), makeAxis("steps", "20..30..10")],
      },
      {
        label: "CFG",
        axes: [makeAxis("cfg", "5,7,9", true), makeAxis("steps", "20..30..10"), makeAxis("seed", "1,2")],
      },
      {
        label: "步数",
        axes: [makeAxis("steps", "20,26,32", true), makeAxis("cfg", "5,7"), makeAxis("seed", "1,2")],
      },
      {
        label: "尺寸",
        axes: [makeAxis("width", "768,1024", true), makeAxis("height", "1024,1536", true), makeAxis("seed", "1,2")],
      },
      {
        label: "采样器",
        axes: [makeAxis("samplerName", samplerValues, true), makeAxis("seed", "1,2"), makeAxis("cfg", "5,7")],
      },
      {
        label: "调度器",
        axes: [makeAxis("scheduler", schedulerValues, true), makeAxis("seed", "1,2"), makeAxis("cfg", "5,7")],
      },
      {
        label: "重绘幅度",
        axes: [makeAxis("denoise", "0.3,0.5,0.7", true), makeAxis("seed", "1,2"), makeAxis("cfg", "5,7")],
      },
      {
        label: "LoRA 强度",
        axes: [makeAxis("loraStrength_0", "0.6,0.8,1", true), makeAxis("seed", "1,2"), makeAxis("cfg", "5,7")],
      },
      {
        label: "LoRA 模型",
        axes: [makeAxis(loraModelField, "1..6", true), makeAxis("seed", "1,2"), makeAxis("cfg", "5,7")],
      },
      {
        // 每行一条（按换行拆分成多个组合）
        label: "提示词追加",
        axes: [
          makeAxis("positiveAppend", "cinematic lighting\nsoft light", true),
          makeAxis("seed", "1,2"),
          makeAxis("cfg", "5,7"),
        ],
      },
      {
        label: "文字内容",
        axes: [makeAxis("drawTextText", "文字A\n文字B", true), makeAxis("seed", "1,2"), makeAxis("cfg", "5,7")],
      },
    ];
    if (xyzTarget === "anima") {
      presets.push({
        label: "Anima 放大",
        axes: [
          makeAxis("animaHiresPrePercent", "0,35,50", true),
          makeAxis("animaHiresPostPercent", "0,20"),
          makeAxis("seed", "1,2"),
        ],
      });
    }
    return presets;
  }, [options.samplers, options.schedulers, lorasOfTarget.length, xyzTarget]);

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
      .map((url): XyzCellScore | null => {
        const sample = byUrl.get(url);
        return sample ? { url: sample.url, label: sample.item.label, score: sample.score, patch: sample.item.patch } : null;
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
          <strong>{buildXyzCombinations(xyzAxes, lorasOfTarget, undefined, loraNames).length}</strong>
          <span>组合</span>
        </div>
        <div className="xyz-preset-bar">
          <button type="button" className="icon-button" onClick={() => setShowXyzHelp(true)}>
            <CircleHelp size={16} /> 怎么用
          </button>
          {xyzPresets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="icon-button"
              onClick={() => setXyzAxes(preset.axes)}
            >
              {preset.label}
            </button>
          ))}
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
              placeholder={axisValuePlaceholder(axis.field)}
            />
          </div>
        ))}
      </div>
      <XyzPreview
        axes={xyzAxes}
        lorasOfTarget={lorasOfTarget}
        excludedIndices={xyzExcludedIndices}
        onToggleIndex={onToggleXyzIndex}
        libraryNames={loraNames}
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
            params.highresParams,
            params.animaParams,
            animaCaps,
            loraNames
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
          onClick={() => review.startReview(gen.xyzResults, xyzAxes, lorasOfTarget, loraNames)}
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
              params.highresParams,
              params.animaParams,
              animaCaps
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
          onClick={() => gen.exportXyzGrid(xyzTarget, xyzAxes, lorasOfTarget, loraNames)}
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
        onApplyBest={
          onApplyCombo && bestCells.length > 0 && bestCells[0].patch
            ? () => {
                const best = bestCells[0];
                if (!best.patch) return;
                onApplyCombo({ label: best.label, patch: best.patch });
              }
            : undefined
        }
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
                    params.highresParams,
                    params.animaParams,
                    animaCaps
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
