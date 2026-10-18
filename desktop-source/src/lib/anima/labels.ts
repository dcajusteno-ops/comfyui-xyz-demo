import type { AnimaLibrarySection } from "./types";

/** 五类词库的中文名（画廊/抽卡共用，避免两处各写一份） */
export const SECTION_LABELS: Record<AnimaLibrarySection, string> = {
  artist: "画师",
  character: "角色",
  clothing: "服装",
  background: "背景",
  pose: "姿势",
};

export const SECTION_ORDER: AnimaLibrarySection[] = ["artist", "character", "clothing", "background", "pose"];
