import type { Dispatch, SetStateAction } from "react";
import { getWardrobeData } from "../../../lib/wardrobe/store";
import type { WardrobeUiState } from "../../../lib/wardrobe/types";
import { WardrobeSectionRow } from "./WardrobeSectionRow";

type Props = {
  state: WardrobeUiState;
  setState: Dispatch<SetStateAction<WardrobeUiState>>;
  lv: number;
};

export function WardrobeTree({ state, setState, lv }: Props) {
  const pools = getWardrobeData("pools");
  if (!pools) return <div className="wd-empty">参数树未加载</div>;

  const allIds = pools.sections.map((section) => section.id);
  const allOpen = allIds.every((id) => state.ui.expanded.includes(id));

  return (
    <div className="wd-tree">
      <div className="wd-tree-head">
        <span>参数树 · {pools.sections.length} 段</span>
        <button
          type="button"
          className="wd-link-btn"
          onClick={() =>
            setState((prev) => ({
              ...prev,
              ui: { ...prev.ui, expanded: allOpen ? [] : allIds },
            }))
          }
        >
          {allOpen ? "全部收起" : "全部展开"}
        </button>
      </div>
      {pools.sections.map((section) => (
        <WardrobeSectionRow
          key={section.id}
          section={section}
          state={state}
          setState={setState}
          lv={lv}
        />
      ))}
    </div>
  );
}
