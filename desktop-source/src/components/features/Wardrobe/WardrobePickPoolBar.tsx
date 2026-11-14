import { Dice5, Eraser, ListChecks } from "lucide-react";
import type { WardrobeUiState } from "../../../lib/wardrobe/types";

type Props = {
  mode: Exclude<WardrobeUiState["pickPool"]["mode"], "">;
  state: WardrobeUiState;
  visibleIds: string[];
  onSetMode: (mode: WardrobeUiState["pickPool"]["mode"]) => void;
  onSelectAll: (ids: string[]) => void;
  onClear: () => void;
};

const MODE_LABEL: Record<Exclude<WardrobeUiState["pickPool"]["mode"], "">, string> = {
  pose: "姿势库",
  art: "艺术构图",
  weapon: "武器场景",
  near: "特写搭配",
};

/** 勾选池工具条（v6.7.0）：勾若干条 + 打开开关 → 每次抽取随机换一条。 */
export function WardrobePickPoolBar({ mode, state, visibleIds, onSetMode, onSelectAll, onClear }: Props) {
  const on = state.pickPool.enabled && state.pickPool.mode === mode;
  const picked = state.pickPool.mode === mode ? state.pickPool.ids : [];
  return (
    <div className="wd-pickpool">
      <label className="wd-mini-check" title="打开后每次抽取从勾选的条目里随机换一条（不改你的权重）">
        <input
          type="checkbox"
          checked={on}
          onChange={(event) => {
            onSetMode(event.target.checked ? mode : "");
            if (event.target.checked) onSelectAll(visibleIds);
          }}
        />
        <Dice5 size={13} /> 每次运行自动随机（{MODE_LABEL[mode]}）
      </label>
      <span className="wd-muted">已勾选 {picked.length} 条</span>
      <button type="button" className="wd-link-btn" onClick={() => onSelectAll(visibleIds)}>
        <ListChecks size={12} /> 全选本页
      </button>
      <button type="button" className="wd-link-btn" onClick={onClear}>
        <Eraser size={12} /> 清空
      </button>
      {on && <span className="wd-pickpool-hint">勾选池会压过显式套用的场景；每次抽取只换一条。</span>}
    </div>
  );
}
