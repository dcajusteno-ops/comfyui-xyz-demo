/**
 * 公共工作台（拼接台）的持久化状态。
 *
 * 两份状态、各管各的：
 * - `comfyui_anima_composer`：Anima 词库的「拼接台」（画廊加入词的落点）；
 * - `comfyui_workbench`：独立的「Anima 工作台」页，词库与造型台的词在这里合流。
 *
 * 两边都是 usePersistentState；同 key 不会双挂载，scheduleUiStateSave 同步写内存，
 * 切标签页时读到的一定是刚写完的那份。
 */
import { usePersistentState } from "./usePersistentState";
import { defaultComposerState, normalizeComposerState } from "../lib/anima/persist";
import type { AnimaComposerState } from "../lib/anima/types";

export const ANIMA_COMPOSER_KEY = "comfyui_anima_composer";
export const WORKBENCH_COMPOSER_KEY = "comfyui_workbench";

/** Anima 词库的拼接台 */
export function useAnimaComposer(): [
  AnimaComposerState,
  React.Dispatch<React.SetStateAction<AnimaComposerState>>,
] {
  return usePersistentState<AnimaComposerState>(
    ANIMA_COMPOSER_KEY,
    defaultComposerState,
    normalizeComposerState,
  );
}

/** 独立「Anima 工作台」页（公共工作台） */
export function useWorkbenchComposer(): [
  AnimaComposerState,
  React.Dispatch<React.SetStateAction<AnimaComposerState>>,
] {
  return usePersistentState<AnimaComposerState>(
    WORKBENCH_COMPOSER_KEY,
    defaultComposerState,
    normalizeComposerState,
  );
}
