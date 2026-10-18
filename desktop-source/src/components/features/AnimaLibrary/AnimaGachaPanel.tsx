import React from "react";
import { Dices, Lock, Plus, Replace, Wand2 } from "lucide-react";
import type { AnimaApplyMode, AnimaGachaState, AnimaLibrarySection } from "../../../lib/anima/types";
import { randomSeed } from "../../../lib/anima/prng";
import { SECTION_LABELS, SECTION_ORDER } from "../../../lib/anima/labels";
import { AnimaSelect } from "./AnimaSelect";

const DETAIL_OPTIONS = [
  { value: "trigger", label: "仅触发词" },
  { value: "trigger_tags", label: "触发词 + 全部 Tags" },
  { value: "trigger_random_tags", label: "触发词 + 随机 Tags" },
] as const;

const SOURCE_OPTIONS = [
  { value: "author", label: "内置服装库" },
  { value: "danbooru", label: "Danbooru 标签组" },
  { value: "character_tags", label: "角色 Tags 借用" },
  { value: "random", label: "随机来源" },
] as const;

type Props = {
  state: AnimaGachaState;
  running: boolean;
  error: string | null;
  onChange: (patch: Partial<AnimaGachaState["options"]>) => void;
  onRun: () => void;
  onApply: (mode: AnimaApplyMode) => void;
  onFillComposer: () => void;
};

export const AnimaGachaPanel = React.memo(({
  state,
  running,
  error,
  onChange,
  onRun,
  onApply,
  onFillComposer,
}: Props) => {
  const options = state.options;
  const last = state.last;

  const toggle = (section: AnimaLibrarySection) =>
    onChange({ enable: { ...options.enable, [section]: !options.enable[section] } });

  return (
    <div className="al-gacha">
      <div className="al-gacha-form">
        <div className="al-sub-title">参与随机的内容</div>
        <div className="segmented al-enable-tabs">
          {SECTION_ORDER.map((section) => (
            <button
              key={section}
              type="button"
              className={options.enable[section] ? "active" : ""}
              onClick={() => toggle(section)}
            >
              {SECTION_LABELS[section]}
            </button>
          ))}
        </div>

        <div className="al-form-grid">
          <label className="field">
            <span>随机种子</span>
            <div className="al-inline">
              <input
                type="number"
                value={options.seed}
                onChange={(event) => onChange({ seed: Number(event.target.value) })}
              />
              <button type="button" className="secondary-action" onClick={() => onChange({ seed: randomSeed() })} title="填入一个固定种子">
                <Dices size={14} />
              </button>
              <button type="button" className="secondary-action" onClick={() => onChange({ seed: -1 })} title="每次运行都重新随机">-1</button>
            </div>
          </label>

          <label className="field">
            <span>画师数量</span>
            <input
              type="number"
              min={0}
              max={20}
              value={options.artistCount}
              onChange={(event) => onChange({ artistCount: Number(event.target.value) })}
            />
          </label>

          <label className="field">
            <span>角色种子</span>
            <input
              type="number"
              value={options.characterSeed}
              onChange={(event) => onChange({ characterSeed: Number(event.target.value) })}
            />
          </label>

          <label className="field">
            <span>服装种子</span>
            <input
              type="number"
              value={options.clothingSeed}
              onChange={(event) => onChange({ clothingSeed: Number(event.target.value) })}
            />
          </label>

          <div className="field">
            <span>角色细节</span>
            <AnimaSelect
              ariaLabel="角色细节"
              value={options.characterDetail}
              options={[...DETAIL_OPTIONS]}
              onChange={(value) => onChange({ characterDetail: value as typeof options.characterDetail })}
            />
          </div>

          <label className="field">
            <span>角色随机 Tags 数</span>
            <input
              type="number"
              min={0}
              max={30}
              disabled={options.characterDetail !== "trigger_random_tags"}
              value={options.characterTagCount}
              onChange={(event) => onChange({ characterTagCount: Number(event.target.value) })}
            />
          </label>

          <div className="field">
            <span>服装来源</span>
            <AnimaSelect
              ariaLabel="服装来源"
              value={options.clothingSource}
              options={[...SOURCE_OPTIONS]}
              onChange={(value) => onChange({ clothingSource: value as typeof options.clothingSource })}
            />
          </div>

          <label className="al-checkbox al-checkbox-inline">
            <input
              type="checkbox"
              checked={options.characterKeepFeatures}
              onChange={(event) => onChange({ characterKeepFeatures: event.target.checked })}
            />
            保留角色发色/瞳色
          </label>
        </div>

        <p className="al-hint">
          种子只在本工具内可复现：与 ComfyUI 插件节点填同一个数字不会得到同一结果（Python 与 JS 随机流不同）。
          「角色种子 / 服装种子」填 -1 表示跟随主种子；填固定值可单独锁定某一区，其余继续重抽。
        </p>

        <div className="al-gacha-run">
          <button type="button" className="primary-action" onClick={onRun} disabled={running}>
            <Wand2 size={16} /> {running ? "抽卡中…" : "抽一次"}
          </button>
          {error && <span className="al-error-text">{error}</span>}
        </div>
      </div>

      <div className="al-gacha-result">
        {last ? (
          <>
            <div className="al-gacha-result-head">
              <h3>本次结果</h3>
              <span>seed {last.usedSeed}</span>
            </div>

            {SECTION_ORDER.map((section) => {
              const parts = last.sections[section];
              if (!parts.length) return null;
              return (
                <div key={section} className="al-gacha-group">
                  <span className="al-gacha-group-label">{SECTION_LABELS[section]}</span>
                  <div className="al-chips">
                    {parts.map((part, index) => (
                      <span key={`${part}-${index}`} className="al-chip">{part}</span>
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="al-gacha-text">{last.text || "（空，所有分区都被关闭了）"}</div>

            <div className="al-gacha-actions">
              <button type="button" className="secondary-action" onClick={() => onChange({ seed: last.usedSeed })} title="把本次实际种子写回主种子">
                <Lock size={14} /> 锁定种子
              </button>
              <button type="button" className="secondary-action" onClick={onRun} disabled={running}>
                <Dices size={14} /> 再抽一次
              </button>
              <button type="button" className="secondary-action" onClick={onFillComposer} disabled={!last.text}>
                填入拼接台
              </button>
              <button type="button" className="primary-action" onClick={() => onApply("append")} disabled={!last.text}>
                <Plus size={14} /> 追加
              </button>
              <button type="button" className="secondary-action" onClick={() => onApply("replace")} disabled={!last.text}>
                <Replace size={14} /> 覆盖
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">还没有抽过。选好范围后点「抽一次」。</div>
        )}
      </div>
    </div>
  );
});
