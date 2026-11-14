/**
 * 全局服装库（`library_*` / `effective_outfit` 的移植，插件 v5.1.0 起 / V6 135 套）。
 *
 * 优先级（用户拍板）：**角色预设 > 服装库 > 随机**。
 *   · 角色启用了自己的预设 → 用它（档位不够就留空，**不拿服装库顶**）；
 *   · 角色没启用 → 用服装库启用中的那一套；
 *   · 服装库也没启用 → 空三元组，随机路径逐字节不变。
 *
 * ⚠️ 插件里 `active / overrides / scene_override` 是**服务端文件状态**；本项目
 *    没有后端，所以这三项存在 `WardrobeUiState.outfitLibrary`（localStorage），
 *    由 `applyLibraryOverlay()` 写进这里的模块状态供引擎读取。
 */
import { outfitItem } from "./characters";
import { outfitTriplet } from "./outfitTriplet";
import { requireWardrobeData } from "./store";
import type {
  WardrobeOutfitLibrary,
  WardrobeOutfitLibraryCategory,
  WardrobeOutfitLibraryItem,
  WardrobeOutfitLibraryState,
} from "./types";

export type OutfitTriplet = [string[], string[], Record<string, string>];

let state: WardrobeOutfitLibraryState = {
  active: "",
  overrides: { socks: "", shoes: "" },
  sceneOverride: false,
};

export function defaultLibraryState(): WardrobeOutfitLibraryState {
  const doc = requireWardrobeData("outfitLibrary");
  const meta = doc?._meta ?? {};
  return {
    active: String(meta.active ?? "").trim().toLowerCase(),
    overrides: {
      socks: String(meta.overrides?.socks ?? "").trim().toLowerCase(),
      shoes: String(meta.overrides?.shoes ?? "").trim().toLowerCase(),
    },
    sceneOverride: meta.scene_override === true,
  };
}

/** UI 状态 → 引擎模块状态（切换启用 / 袜鞋覆盖 / 场景覆盖后都要调）。 */
export function applyLibraryOverlay(next: WardrobeOutfitLibraryState | null | undefined): void {
  if (!next) return;
  state = {
    active: String(next.active ?? "").trim().toLowerCase(),
    overrides: {
      socks: String(next.overrides?.socks ?? "").trim().toLowerCase(),
      shoes: String(next.overrides?.shoes ?? "").trim().toLowerCase(),
    },
    sceneOverride: next.sceneOverride === true,
  };
}

export function libraryState(): WardrobeOutfitLibraryState {
  return state;
}

export function libraryDoc(): WardrobeOutfitLibrary | null {
  return requireWardrobeData("outfitLibrary");
}

export function libraryCategories(): WardrobeOutfitLibraryCategory[] {
  return libraryDoc()?._meta?.categories ?? [];
}

export function libraryItems(): WardrobeOutfitLibraryItem[] {
  return libraryDoc()?.outfits ?? [];
}

/** 启用中的那一套；没启用 / id 对不上 → null。 */
export function libraryActiveItem(): WardrobeOutfitLibraryItem | null {
  const active = String(state.active ?? "").trim().toLowerCase();
  if (!active) return null;
  return libraryItems().find((item) => String(item.id ?? "").toLowerCase() === active) ?? null;
}

// 袜子 / 鞋子的判定词根 —— 覆盖时必须同时从 extras 剔除，否则正文里两双袜子
const SOCK_WORDS = [
  "thighhigh",
  "pantyhose",
  "sock",
  "stocking",
  "garter",
  "tights",
  "barefoot",
  "leg warmer",
  "kneehigh",
];
const SHOE_WORDS = [
  "heel",
  "boot",
  "shoe",
  "loafer",
  "sneaker",
  "sandal",
  "mary jane",
  "slipper",
  "geta",
  "uwabaki",
  "bare feet",
  "barefoot",
];

/** 这个标签属于 socks / shoes / 都不是。 */
export function tagClass(tag: string): "" | "socks" | "shoes" {
  const t = String(tag ?? "").trim().toLowerCase();
  if (!t) return "";
  if (SOCK_WORDS.some((w) => t.includes(w))) return "socks";
  if (SHOE_WORDS.some((w) => t.includes(w))) return "shoes";
  return "";
}

export function libraryOverrides(): { socks: string; shoes: string } {
  return { socks: state.overrides.socks, shoes: state.overrides.shoes };
}

export function librarySceneOverride(): boolean {
  return state.sceneOverride;
}

/**
 * 把用户指定的袜子 / 鞋子盖到服装库那套上：① 从 extras 剔同类 ② 加进 drops
 * ③ 在 sets 写死。换鞋还要连 `n_shoes_keep` 一起清（"高潮后保留哪双鞋"）。
 */
export function applyLibraryOverrides(
  extras: string[],
  drops: string[],
  sets: Record<string, string>,
): OutfitTriplet {
  const ov = libraryOverrides();
  if (!ov.socks && !ov.shoes) return [extras, drops, sets];
  const nextExtras = [...extras];
  const nextDrops = [...drops];
  const nextSets = { ...sets };
  for (const key of ["socks", "shoes"] as const) {
    const value = String(ov[key] ?? "").trim().toLowerCase();
    if (!value) continue;
    for (let i = nextExtras.length - 1; i >= 0; i -= 1) {
      if (tagClass(nextExtras[i]) === key) nextExtras.splice(i, 1);
    }
    if (!nextDrops.includes(key)) nextDrops.push(key);
    nextSets[key] = value;
    if (key === "shoes") {
      if (!nextDrops.includes("n_shoes_keep")) nextDrops.push("n_shoes_keep");
      delete nextSets.n_shoes_keep;
    }
  }
  return [nextExtras, nextDrops, nextSets];
}

/** 服装库启用中的那一套 → 三元组；档位不够时**整套不生效**（也不许只盖袜鞋）。 */
export function libraryOutfit(lv = 99): OutfitTriplet {
  const tri = outfitTriplet(libraryActiveItem(), lv);
  if (!tri[0].length && !tri[1].length) return tri;
  return applyLibraryOverrides(tri[0], tri[1], tri[2]);
}

/**
 * 「这个角色现在穿什么」——角色预设优先，服装库兜底。
 *
 * 判据是 `outfitItem()` **有没有启用**，不是三元组空不空：角色启用了 L3 套装、
 * 当前 SFW 档时三元组也是空，若拿"空"去判兜底就会悄悄换成服装库那一套。
 *
 * `sceneHasOutfit` = 本轮场景**实际写入**了衣物字段。此时若「覆盖场景推荐服装」
 * 关闭（默认），服装库整套让路（含袜鞋覆盖），让场景推荐服装原样生效。
 */
export function effectiveOutfit(roleTrigger: string, lv = 99, sceneHasOutfit = false): OutfitTriplet {
  const item = outfitItem(roleTrigger);
  if (item) return outfitTriplet(item, lv);
  if (sceneHasOutfit && !librarySceneOverride()) return [[], [], {}];
  return libraryOutfit(lv);
}
