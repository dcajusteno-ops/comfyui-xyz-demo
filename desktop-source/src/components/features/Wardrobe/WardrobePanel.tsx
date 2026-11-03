import { useMemo, useState } from "react";
import { Dice5, Loader2, Play, RefreshCw, Shirt, Sparkles } from "lucide-react";
import { PanelTitle } from "../../ui";
import type { Toast } from "../../../types";
import type { AnimaApplyMode } from "../../../lib/anima/types";
import { useWardrobeData } from "../../../hooks/useWardrobeData";
import { useWardrobe } from "../../../hooks/useWardrobe";
import { targetNum } from "../../../lib/wardrobe/levels";
import { styleChoices } from "../../../lib/wardrobe/outfitStyle";
import { hairPickOptions } from "../../../lib/wardrobe/characters";
import { setLevel, setUi } from "../../../lib/wardrobe/state";
import { splitWardrobeToWorkbench } from "../../../lib/wardrobe/workbench";
import {
  WARDROBE_BREAST_SIZES,
  WARDROBE_HAIR_PICKS,
  WARDROBE_LEVELS,
  WARDROBE_TAG_CAPS,
} from "../../../lib/wardrobe/persist";
import { countTags } from "../../../lib/wardrobe/text";
import type { WardrobeDrawResult, WardrobeWorkbenchSplit } from "../../../lib/wardrobe/types";
import { WardrobeTree } from "./WardrobeTree";
import { WardrobeCharacterLibrary } from "./WardrobeCharacterLibrary";
import { WardrobeSceneLibrary } from "./WardrobeSceneLibrary";
import { WardrobePresetBar } from "./WardrobePresetBar";
import { WardrobeResultPanel } from "./WardrobeResultPanel";
import { AnimaSelect } from "../AnimaLibrary/AnimaSelect";

type Props = {
  currentPrompt: string;
  onApplyPrompt: (text: string, mode: AnimaApplyMode) => void;
  onConfirm: (title: string, message: string, onConfirm: () => void) => void;
  pushToast: (type: Toast["type"], title: string, message?: string) => void;
  onOpenAnima: () => void;
  /** 公共工作台（独立页）当前的内容，用来判断要不要弹确认 */
  workbenchValues: Record<string, string>;
  /** 把拆好的分区桶送进公共工作台并跳转过去 */
  onSendToWorkbench: (split: WardrobeWorkbenchSplit) => void;
};

/** 送入工作台时整体替换的分区；`extra` 追加，`artist` 永远保留（画师只归工作台管）。 */
const WORKBENCH_REPLACE_SLOTS = ["quality", "character", "clothing", "background", "pose"] as const;

const LEVEL_LABELS: Record<(typeof WARDROBE_LEVELS)[number], string> = {
  sfw: "全年龄",
  suggestive: "擦边",
  explicit: "成人",
  hardcore: "过激",
  extreme: "极端",
};

/** 静态档位数字：首屏数据未就绪时也要能渲染，不能调 targetNum()（它依赖数据包）。 */
const LEVEL_NUM: Record<(typeof WARDROBE_LEVELS)[number], number> = {
  sfw: 0,
  suggestive: 1,
  explicit: 2,
  hardcore: 3,
  extreme: 4,
};

export function WardrobePanel({
  currentPrompt,
  onApplyPrompt,
  onConfirm,
  pushToast,
  onOpenAnima,
  workbenchValues,
  onSendToWorkbench,
}: Props) {
  const data = useWardrobeData();
  const wardrobe = useWardrobe(pushToast);
  const [result, setResult] = useState<WardrobeDrawResult | null>(null);

  const state = wardrobe.state;
  const lv = LEVEL_NUM[state.level] ?? 0;
  const shownText = result?.text ?? state.lastResult?.text ?? "";
  const shownMeta = result
    ? {
        levelNum: result.level_num,
        cap: result.cap,
        seed: state.seed,
        tagCount: countTags(result.text),
        notes: result.notes,
        dropped: result.dropped,
        repaired: result.report.repaired,
      }
    : {
        levelNum: state.lastResult?.levelNum ?? lv,
        cap: state.lastResult?.cap ?? 0,
        seed: state.lastResult?.seed ?? state.seed,
        tagCount: state.lastResult?.tagCount ?? 0,
        notes: state.lastResult?.notes ?? [],
        dropped: state.lastResult?.dropped ?? [],
        repaired: state.lastResult?.repaired ?? [],
      };

  const outfitOptions = useMemo(
    () => (data.ready ? styleChoices().map((choice) => ({ value: choice, label: choice })) : []),
    [data.ready],
  );

  if (data.error) {
    return (
      <div className="wd-panel panel">
        <div className="panel-header">
          <PanelTitle icon={Shirt} title="Anima 造型台" />
        </div>
        <div className="panel-body">
          <div className="wd-empty-state">
            <p>造型台数据加载失败：{data.error}</p>
            <button type="button" className="primary-action" onClick={data.reload}>
              <RefreshCw size={14} /> 重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!data.ready) {
    return (
      <div className="wd-panel panel">
        <div className="panel-header">
          <PanelTitle icon={Shirt} title="Anima 造型台" />
        </div>
        <div className="panel-body">
          <div className="wd-empty-state">
            <Loader2 size={18} className="wd-spin" />
            <p>正在加载词库 / 角色库 / 场景库…</p>
          </div>
        </div>
      </div>
    );
  }

  const handleRun = () => {
    const next = wardrobe.run();
    if (next) setResult(next);
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      pushToast("success", "已复制", `${countTags(text)} 个标签`);
    } catch (error) {
      pushToast("error", "复制失败", error instanceof Error ? error.message : String(error));
    }
  };

  const handleApply = (text: string, mode: AnimaApplyMode) => {
    if (mode === "replace") {
      onConfirm(
        "覆盖 Anima 提示词",
        `当前正向提示词 ${currentPrompt.length} 字符将被替换为造型台结果（${text.length} 字符）。`,
        () => onApplyPrompt(text, "replace"),
      );
      return;
    }
    onApplyPrompt(text, "append");
  };

  /** 造型台结果 → 公共工作台（独立页）：内容分区整体替换、extra 追加、画师保留。 */
  const handleToWorkbench = () => {
    const saved = state.lastResult?.slots;
    const split: WardrobeWorkbenchSplit =
      saved ?? splitWardrobeToWorkbench(result?.state, shownText.split(",").map((t) => t.trim()));
    const occupied = WORKBENCH_REPLACE_SLOTS.some((slot) => (workbenchValues[slot] ?? "").trim());

    const doSend = () => onSendToWorkbench(split);

    if (occupied) {
      onConfirm(
        "更新公共工作台",
        "造型台结果会替换工作台里的质量 / 角色 / 服装 / 背景 / 姿势分区，「额外」追加、画师与手改内容保留。继续吗？",
        doSend,
      );
      return;
    }
    doSend();
  };

  return (
    <div className="wd-panel panel">
      <div className="panel-header wd-header">
        <PanelTitle icon={Shirt} title="Anima 造型台" />
        <div className="wd-level-bar" role="group" aria-label="档位">
          {WARDROBE_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={`wd-level${state.level === level ? " is-on" : ""}`}
              onClick={() => wardrobe.setState((prev) => setLevel(prev, level))}
              title={`L${targetNum()[level]} · ${LEVEL_LABELS[level]}`}
            >
              <em>L{targetNum()[level]}</em>
              {LEVEL_LABELS[level]}
            </button>
          ))}
        </div>
        <label className="wd-seed">
          seed
          <input
            type="number"
            value={state.seed}
            min={-1}
            max={2 ** 31 - 1}
            onChange={(event) =>
              wardrobe.setState((prev) => ({ ...prev, seed: Number(event.target.value) || -1 }))
            }
            title="-1 = 每次重抽；固定数字 = 可复现"
          />
          <button
            type="button"
            className="wd-icon-btn"
            title="随机一个 seed"
            onClick={() =>
              wardrobe.setState((prev) => ({ ...prev, seed: Math.floor(Math.random() * 2 ** 31) }))
            }
          >
            <Dice5 size={14} />
          </button>
        </label>
        <button type="button" className="primary-action wd-run" onClick={handleRun}>
          <Play size={15} /> 抽一次
        </button>
      </div>

      <div className="wd-toolbar">
        <label className="wd-tool">
          标签上限
          <AnimaSelect
            value={state.tagCap}
            options={WARDROBE_TAG_CAPS.map((cap) => ({ value: cap, label: cap }))}
            onChange={(value) => wardrobe.setState((prev) => ({ ...prev, tagCap: value }))}
            ariaLabel="标签上限"
            size="sm"
          />
        </label>
        <label className="wd-tool">
          基础概率
          <input
            type="number"
            min={0.05}
            max={1}
            step={0.05}
            value={state.baseProb}
            onChange={(event) =>
              wardrobe.setState((prev) => ({ ...prev, baseProb: Number(event.target.value) || 0.65 }))
            }
          />
        </label>
        <label className="wd-tool">
          服装风格
          <AnimaSelect
            value={state.outfitStyle}
            options={outfitOptions}
            onChange={(value) => wardrobe.setState((prev) => ({ ...prev, outfitStyle: value }))}
            ariaLabel="服装风格"
            size="sm"
          />
        </label>
        <label className="wd-tool">
          胸部
          <AnimaSelect
            value={state.breastSize}
            options={WARDROBE_BREAST_SIZES.map((value) => ({ value, label: value }))}
            onChange={(value) => wardrobe.setState((prev) => ({ ...prev, breastSize: value }))}
            ariaLabel="胸部大小"
            size="sm"
          />
        </label>
        <label className="wd-mini-check">
          <input
            type="checkbox"
            checked={state.appearanceFollow}
            onChange={(event) =>
              wardrobe.setState((prev) => ({ ...prev, appearanceFollow: event.target.checked }))
            }
          />
          外貌对齐
        </label>
        <label className="wd-mini-check">
          <input
            type="checkbox"
            checked={state.hairFollow}
            onChange={(event) => wardrobe.setState((prev) => ({ ...prev, hairFollow: event.target.checked }))}
          />
          发型对齐
        </label>
        <label className="wd-mini-check">
          <input
            type="checkbox"
            checked={state.roleFavOnly}
            onChange={(event) => wardrobe.setState((prev) => ({ ...prev, roleFavOnly: event.target.checked }))}
          />
          角色仅收藏
        </label>
      </div>

      <div className="wd-body">
        <aside className="wd-left">
          <div className="wd-advanced">
            <label className="wd-tool wd-tool-wide">
              手填角色（force_role）
              <input
                value={state.forceRole}
                placeholder="角色 trigger，如 hatsune miku, vocaloid"
                onChange={(event) => wardrobe.setState((prev) => ({ ...prev, forceRole: event.target.value }))}
              />
            </label>
            <label className="wd-tool wd-tool-wide">
              手写补充（拼在末尾）
              <textarea
                value={state.extraBody}
                rows={2}
                placeholder="pointy ears, smile"
                onChange={(event) => wardrobe.setState((prev) => ({ ...prev, extraBody: event.target.value }))}
              />
            </label>
            <details className="wd-hair-picks">
              <summary>发型选择器（4 项）</summary>
              {WARDROBE_HAIR_PICKS.map((key) => (
                <label key={key} className="wd-tool wd-tool-wide">
                  {key}
                  <AnimaSelect
                    value={state.hairPicks[key] ?? "角色标签发型"}
                    options={hairPickOptions(key).map((value) => ({ value, label: value }))}
                    onChange={(value) =>
                      wardrobe.setState((prev) => ({
                        ...prev,
                        hairPicks: { ...prev.hairPicks, [key]: value },
                      }))
                    }
                    ariaLabel={`${key} 发型选择`}
                    size="sm"
                  />
                </label>
              ))}
            </details>
          </div>
          <WardrobeTree state={state} setState={wardrobe.setState} lv={lv} />
        </aside>

        <section className="wd-right">
          <div className="wd-view-bar">
            {(
              [
                ["chars", "角色库"],
                ["scenes", "场景库"],
                ["presets", "预设"],
              ] as const
            ).map(([view, label]) => (
              <button
                key={view}
                type="button"
                className={`wd-view-tab${state.ui.view === view ? " is-on" : ""}`}
                onClick={() => wardrobe.setState((prev) => setUi(prev, { view }))}
              >
                {label}
              </button>
            ))}
            <span className="wd-view-hint">
              <Sparkles size={12} /> {state.lastResult ? "上一轮结果在下方" : "选角色 / 套场景后抽一次"}
            </span>
          </div>
          <div className="wd-view-body">
            {state.ui.view === "chars" && (
              <WardrobeCharacterLibrary
                state={state}
                setState={wardrobe.setState}
                selected={wardrobe.selectedRoles}
                favorites={wardrobe.favoriteChars}
                onToggleRole={wardrobe.toggleRole}
                onToggleFavorite={wardrobe.toggleFavoriteCharacter}
              />
            )}
            {state.ui.view === "scenes" && (
              <WardrobeSceneLibrary
                state={state}
                setState={wardrobe.setState}
                favorites={wardrobe.favoriteScenes}
                onToggleFavorite={wardrobe.toggleFavoriteScene}
                onApply={wardrobe.applyScene}
                onClear={wardrobe.clearScene}
              />
            )}
            {state.ui.view === "presets" && (
              <WardrobePresetBar
                presets={wardrobe.presets}
                onSave={wardrobe.savePreset}
                onLoad={wardrobe.loadPreset}
                onDelete={wardrobe.deletePreset}
              />
            )}
          </div>
          <WardrobeResultPanel
            text={shownText}
            levelNum={shownMeta.levelNum}
            cap={shownMeta.cap}
            seed={shownMeta.seed}
            tagCount={shownMeta.tagCount}
            notes={shownMeta.notes}
            dropped={shownMeta.dropped}
            repaired={shownMeta.repaired}
            qualityPrefix={state.qualityPrefix}
            onQualityPrefix={(value) => wardrobe.setState((prev) => ({ ...prev, qualityPrefix: value }))}
            onApply={handleApply}
            onCopy={handleCopy}
            onToWorkbench={handleToWorkbench}
            onOpenAnima={onOpenAnima}
          />
        </section>
      </div>
    </div>
  );
}
