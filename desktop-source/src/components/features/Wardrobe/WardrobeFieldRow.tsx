import { ChevronDown, ChevronRight, Lock, LockOpen, SlidersHorizontal } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { fieldWeight, sectionWeight } from "../../../lib/wardrobe/weights";
import { clampProb } from "../../../lib/wardrobe/rng";
import { setFieldWeight, setUi, toggleLock } from "../../../lib/wardrobe/state";
import type { WardrobeField, WardrobeUiState } from "../../../lib/wardrobe/types";
import { WardrobeOptionDrawer } from "./WardrobeOptionDrawer";

type Props = {
  field: WardrobeField;
  sectionId: string;
  state: WardrobeUiState;
  setState: Dispatch<SetStateAction<WardrobeUiState>>;
  lv: number;
};

export function WardrobeFieldRow({ field, sectionId, state, setState, lv }: Props) {
  const weight = fieldWeight(state.weights, field.key);
  const locked = state.locks.includes(field.key);
  const forced = state.forced[field.key];
  const open = state.ui.openField === field.key;
  const isRole = field.key === "role";
  const probability = state.baseProb * sectionWeight(state.weights, sectionId) * weight;
  const probabilityText =
    field.req || weight >= 3
      ? "必现"
      : weight <= 0
        ? "永不"
        : `p≈${Math.round(clampProb(probability) * 100)}%`;

  return (
    <div className={`wd-field${locked ? " is-locked" : ""}${forced ? " is-forced" : ""}`}>
      <div className="wd-field-main">
        <button
          type="button"
          className="wd-field-name"
          onClick={() =>
            !isRole && setState((prev) => setUi(prev, { openField: open ? undefined : field.key }))
          }
          title={isRole ? "角色由角色库 / 手填决定" : "查看选项 / 选项权重"}
        >
          {!isRole && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
          <span>{field.lab}</span>
          {field.req && <em className="wd-req">*</em>}
        </button>
        <span className="wd-field-prob" title={isRole ? "角色由角色库选择" : "抽取概率 = 基准 × 段权重 × 字段权重"}>
          {isRole ? "角色库" : probabilityText}
        </span>
        {!isRole && (
          <>
            <input
              className="wd-weight"
              type="range"
              min={0}
              max={3}
              step={0.1}
              value={weight}
              aria-label={`${field.lab} 字段权重`}
              onChange={(event) => setState((prev) => setFieldWeight(prev, field.key, Number(event.target.value)))}
            />
            <span className="wd-weight-value">{weight.toFixed(1)}</span>
          </>
        )}
        <button
          type="button"
          className={`wd-lock${locked ? " is-on" : ""}`}
          onClick={() => setState((prev) => toggleLock(prev, field.key))}
          title={locked ? "已锁定：本次不参与随机" : "锁定该字段（留给上游给值）"}
          aria-label={locked ? "解锁字段" : "锁定字段"}
        >
          {locked ? <Lock size={13} /> : <LockOpen size={13} />}
        </button>
      </div>
      {!isRole && forced && (
        <div className="wd-forced" title="强制选项：本次必出该值">
          <SlidersHorizontal size={12} /> 强制：{forced}
        </div>
      )}
      {!isRole && open && (
        <WardrobeOptionDrawer
          field={field}
          state={state}
          setState={setState}
          lv={lv}
          locked={locked}
        />
      )}
    </div>
  );
}
