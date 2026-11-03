import { ChevronDown, ChevronRight } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { sectionEligible, sectionFloorLevel, sectionMaxLevel } from "../../../lib/wardrobe/levels";
import {
  isSectionEnabled,
  setSectionWeight,
  toggleExpanded,
  toggleSection,
} from "../../../lib/wardrobe/state";
import type { WardrobeSection, WardrobeUiState } from "../../../lib/wardrobe/types";
import { WardrobeFieldRow } from "./WardrobeFieldRow";

type Props = {
  section: WardrobeSection;
  state: WardrobeUiState;
  setState: Dispatch<SetStateAction<WardrobeUiState>>;
  lv: number;
};

export function WardrobeSectionRow({ section, state, setState, lv }: Props) {
  const expanded = state.ui.expanded.includes(section.id);
  const allowed = sectionEligible(section, lv);
  const enabled = isSectionEnabled(state, section.id) && allowed;
  const weight = state.weights.sections[section.id] ?? 1;
  const floor = sectionFloorLevel(section.id);
  const max = sectionMaxLevel(section.id);

  return (
    <section className={`wd-section${!enabled ? " is-off" : ""}${!allowed ? " is-locked-by-level" : ""}`}>
      <div className="wd-section-head">
        <button
          type="button"
          className="wd-section-toggle"
          onClick={() => setState((prev) => toggleExpanded(prev, section.id))}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="wd-section-title">{section.title}</span>
        </button>
        <span className="wd-section-meta">
          {section.id === "canon"
            ? `${section.fields.length} 字段 · 场景含 L0`
            : `${section.fields.length} 字段 · L${floor}–L${max}`}
        </span>
        <input
          className="wd-weight"
          type="range"
          min={0}
          max={3}
          step={0.1}
          value={weight}
          disabled={!allowed}
          aria-label={`${section.title} 段权重`}
          onChange={(event) => setState((prev) => setSectionWeight(prev, section.id, Number(event.target.value)))}
        />
        <span className="wd-weight-value">{weight.toFixed(1)}</span>
        <label className="wd-section-enable" title={allowed ? "启用 / 关闭整段" : `需 ≥ L${floor}`}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!allowed}
            onChange={() => setState((prev) => toggleSection(prev, section.id))}
          />
        </label>
      </div>
      {!allowed && <div className="wd-section-lock">本档不可用（需 ≥ L{floor}）</div>}
      {expanded && enabled && (
        <div className="wd-fields">
          {section.fields.map((field) => (
            <WardrobeFieldRow
              key={field.key}
              field={field}
              sectionId={section.id}
              state={state}
              setState={setState}
              lv={lv}
            />
          ))}
        </div>
      )}
    </section>
  );
}
