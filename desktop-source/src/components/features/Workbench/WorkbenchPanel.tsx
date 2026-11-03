import type { Dispatch, SetStateAction } from "react";
import { Blocks, Shirt } from "lucide-react";
import { PanelTitle } from "../../ui";
import type { Toast } from "../../../types";
import { usePersistentState } from "../../../hooks/usePersistentState";
import { useAnimaComposer } from "../../../hooks/useAnimaComposer";
import {
  COMPOSER_SLOT_ORDER,
  buildComposerPreview,
  mergeComposerSlots,
} from "../../../lib/anima/compose";
import { emptyComposerValues } from "../../../lib/anima/persist";
import type { AnimaApplyMode, AnimaComposerState } from "../../../lib/anima/types";
import {
  WARDROBE_STATE_KEY,
  defaultWardrobeState,
  normalizeWardrobeState,
} from "../../../lib/wardrobe/persist";
import { applyWardrobeSplitToValues } from "../../../lib/wardrobe/workbench";
import type { WardrobeUiState } from "../../../lib/wardrobe/types";
import { AnimaComposer } from "../AnimaLibrary/AnimaComposer";

type ToastFn = (type: Toast["type"], title: string, message?: string) => void;

type Props = {
  state: AnimaComposerState;
  setState: Dispatch<SetStateAction<AnimaComposerState>>;
  currentPrompt: string;
  onApplyPrompt: (text: string, mode: AnimaApplyMode) => void;
  onConfirm: (title: string, message: string, onConfirm: () => void) => void;
  pushToast: ToastFn;
  /** 跳到 Anima 词库（分区里「词库」按钮的去处） */
  onOpenAnimaLibrary: () => void;
};

/**
 * 「Anima 工作台」—— 独立的公共工作台页。
 *
 * 词库的「拼接台」和造型台的抽取结果都往这里**送**（不互相同步、不互相覆盖）：
 * - 造型台：结果区「工作台」按钮（内容五区 replace、extra 追加、画师保留）；
 * - 词库：拼接台「送入工作台」按钮（整份分区追加、去重）；
 * - 本页还可以随时用右上角两个按钮把两个来源再拉一遍。
 *
 * 画师只在工台里维护：`@name` 固定排在质量词之后、角色之前（Anima 官方顺序，
 * 见画师分区下方的横幅）。输出顺序即七个分区的排列顺序。
 */
export function WorkbenchPanel({
  state,
  setState,
  currentPrompt,
  onApplyPrompt,
  onConfirm,
  pushToast,
  onOpenAnimaLibrary,
}: Props) {
  // 两个来源都按「只读」挂载：本页不写这两个 key，不会有写冲突
  const [libraryComposer] = useAnimaComposer();
  const [wardrobeState] = usePersistentState<WardrobeUiState>(
    WARDROBE_STATE_KEY,
    defaultWardrobeState(),
    normalizeWardrobeState,
  );

  const pullFromLibrary = () => {
    const values = libraryComposer.values;
    const hasAny = COMPOSER_SLOT_ORDER.some((slot) => values[slot].trim());
    if (!hasAny) {
      pushToast("info", "词库拼接台是空的", "先去 Anima 词库挑词 / 抽卡，或直接在这里手填");
      return;
    }
    setState((prev) => ({ ...prev, values: mergeComposerSlots(prev.values, values, "append") }));
    pushToast("success", "已并入词库拼接台", "重复词已去重，画师仍排在质量词之后");
  };

  const pullFromWardrobe = () => {
    const slots = wardrobeState.lastResult?.slots;
    if (!slots || Object.keys(slots).length === 0) {
      pushToast("info", "造型台还没有结果", "去 Anima 造型台抽一次，再回来并入");
      return;
    }
    setState((prev) => ({ ...prev, values: applyWardrobeSplitToValues(prev.values, slots) }));
    pushToast("success", "已并入造型台上一轮", "内容分区已更新，画师与额外词保留");
  };

  const handleApply = (text: string, mode: AnimaApplyMode) => {
    const clean = text.trim();
    if (!clean) {
      pushToast("info", "没有可写入的内容", "先拼出或抽出一段提示词");
      return;
    }
    onApplyPrompt(clean, mode);
  };

  return (
    <section className="panel wb-panel">
      <div className="panel-header wb-header">
        <PanelTitle icon={Blocks} title="Anima 工作台" />
        <span className="wb-sub">
          公共工作台 · 词库与造型台的词在这里合流 · 输出顺序 = Anima 官方（质量 → 画师 → 角色 → 服装 → 背景 → 姿势 → 额外）
        </span>
        <div className="wb-sources">
          <button type="button" className="secondary-action" onClick={pullFromLibrary} title="把 Anima 词库拼接台的分区内容追加进来">
            <Blocks size={14} /> ← 词库拼接台
          </button>
          <button type="button" className="secondary-action" onClick={pullFromWardrobe} title="把造型台上一轮抽取结果并进来（内容分区替换、画师保留）">
            <Shirt size={14} /> ← 造型台上一轮
          </button>
        </div>
      </div>
      <div className="panel-body wb-body">
        <AnimaComposer
          state={state}
          currentPrompt={currentPrompt}
          onChangeSlot={(slot, value) =>
            setState((prev) => ({ ...prev, values: { ...prev.values, [slot]: value } }))
          }
          onClearSlot={(slot) =>
            setState((prev) => ({ ...prev, values: { ...prev.values, [slot]: "" } }))
          }
          onDedupeChange={(dedupe) => setState((prev) => ({ ...prev, dedupe }))}
          onApply={(mode) => handleApply(buildComposerPreview(state.values, { dedupe: state.dedupe }), mode)}
          // ⚠️ 这里只做清空，不要再包一层 onConfirm：
          // AnimaComposer 的「清空」按钮已经弹过确认框，而 GlobalModals 执行回调时
          // 是「先跑 onConfirm() 再 setConfirmDialog(null)」——回调里再开确认框会被
          // 后者的 null 覆盖吞掉，真正的清空永远不会执行（双重确认 = 全都不生效）。
          onClearAll={() => setState((prev) => ({ ...prev, values: emptyComposerValues() }))}
          onConfirm={onConfirm}
          onOpenGallery={onOpenAnimaLibrary}
          pushToast={pushToast}
        />
      </div>
    </section>
  );
}
