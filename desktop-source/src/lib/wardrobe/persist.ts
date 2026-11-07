/**
 * 造型台的持久化默认值与坏数据修复。
 *
 * 与 `lib/anima/persist.ts` 同一套约定：`default*` + `normalize*` 成对出现，
 * 由 `usePersistentState(key, default, normalize)` 调用。
 * ⚠️ 不要在默认值里预置 15 个段权重 —— deepMerge 会把"没调过"变成"调过 1.0"。
 */
import { FIELD_SLOT } from "./slots";
import { emptyWeights, parseWeights } from "./weights";
import type {
  WardrobeFavorites,
  WardrobeLastResult,
  WardrobeOutfitSet,
  WardrobeOutfitStore,
  WardrobePreset,
  WardrobePresetStore,
  WardrobeUiState,
  WardrobeWeights,
} from "./types";

export const WARDROBE_STATE_KEY = "comfyui_wardrobe_state";
export const WARDROBE_FAVORITES_KEY = "comfyui_wardrobe_favorites";
export const WARDROBE_PRESETS_KEY = "comfyui_wardrobe_presets";
export const WARDROBE_OUTFITS_KEY = "comfyui_wardrobe_outfits";

export const WARDROBE_SECTION_IDS = [
  "count",
  "hair",
  "face",
  "body",
  "makeup",
  "cloth_sfw",
  "pose_sfw",
  "camera",
  "scene",
  "lighting",
  "cloth_nsfw",
  "pose_nsfw",
  "special_nsfw",
  "canon",
  "nl_block",
] as const;

export const WARDROBE_LEVELS = ["sfw", "suggestive", "explicit", "hardcore", "extreme"] as const;

export const WARDROBE_TAG_CAPS = ["自动", "16", "20", "24", "28", "32", "36", "40", "48"] as const;

export const WARDROBE_BREAST_SIZES = ["不指定", "平胸", "小胸", "中等", "大胸", "巨乳", "爆乳"] as const;

export const WARDROBE_HAIR_PICKS = ["hair_len", "hair_tie", "hair_curl", "hair_acc"] as const;

export function defaultWardrobeState(): WardrobeUiState {
  return {
    version: 1,
    level: "sfw",
    seed: -1,
    baseProb: 0.65,
    tagCap: "自动",
    outfitStyle: "随机",
    breastSize: "不指定",
    appearanceFollow: true,
    hairFollow: true,
    hairPicks: {
      hair_len: "角色标签发型",
      hair_tie: "角色标签发型",
      hair_curl: "角色标签发型",
      hair_acc: "角色标签发型",
    },
    extraBody: "",
    weights: emptyWeights(),
    locks: [],
    forced: {},
    disabledSections: [],
    selectedRoles: [],
    roleWorks: [],
    roleFavOnly: false,
    rolePick: true,
    scenePick: false,
    forceRole: "",
    applyMode: "append",
    qualityPrefix: false,
    ui: {
      view: "chars",
      expanded: ["count", "hair"],
      openField: undefined,
      charQuery: "",
      charWork: "",
      charFavOnly: false,
      charSort: "pop",
      charPageSize: 60,
      sceneGroup: "sfw",
      sceneQuery: "",
    },
  };
}

function clampWeightString(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(3, n));
}

function normalizeLastResult(raw: unknown): WardrobeLastResult | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const text = String(rec.text ?? "").slice(0, 8000);
  if (!text) return undefined;
  const drawn = Array.isArray(rec.drawn) ? rec.drawn.slice(0, 60) : [];
  return {
    text,
    levelNum: Number(rec.levelNum) || 0,
    cap: Number(rec.cap) || 0,
    seed: Number(rec.seed) || -1,
    tagCount: Number(rec.tagCount) || 0,
    drawn: drawn
      .filter((row) => row && typeof row === "object")
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          field: String(item.field ?? ""),
          zh: String(item.zh ?? ""),
          en: String(item.en ?? ""),
          level: Number(item.level) || 0,
          weight: Number(item.weight) || 0,
        };
      }),
    dropped: Array.isArray(rec.dropped) ? rec.dropped.map(String).slice(0, 40) : [],
    repaired: Array.isArray(rec.repaired) ? rec.repaired.map(String).slice(0, 40) : [],
    notes: Array.isArray(rec.notes) ? rec.notes.map(String).slice(0, 20) : [],
    at: Number(rec.at) || Date.now(),
  };
}

export function normalizeWardrobeState(merged: WardrobeUiState): WardrobeUiState {
  const base = defaultWardrobeState();
  const state: WardrobeUiState = { ...base, ...(merged ?? {}) };

  state.level = (WARDROBE_LEVELS as readonly string[]).includes(state.level) ? state.level : "sfw";
  const seed = Number(state.seed);
  state.seed = Number.isFinite(seed) ? Math.max(-1, Math.min(2 ** 31 - 1, Math.trunc(seed))) : -1;
  const prob = Number(state.baseProb);
  state.baseProb = Number.isFinite(prob) && prob > 0 && prob <= 1 ? prob : 0.65;
  state.tagCap = (WARDROBE_TAG_CAPS as readonly string[]).includes(String(state.tagCap)) ? String(state.tagCap) : "自动";
  state.outfitStyle = String(state.outfitStyle || "随机");
  state.breastSize = (WARDROBE_BREAST_SIZES as readonly string[]).includes(String(state.breastSize))
    ? String(state.breastSize)
    : "不指定";
  state.appearanceFollow = state.appearanceFollow !== false;
  state.hairFollow = state.hairFollow !== false;
  state.extraBody = String(state.extraBody ?? "").slice(0, 2000);
  state.forceRole = String(state.forceRole ?? "").slice(0, 200);
  state.applyMode = state.applyMode === "replace" ? "replace" : "append";
  state.qualityPrefix = state.qualityPrefix === true;
  state.roleFavOnly = state.roleFavOnly === true;
  state.rolePick = state.rolePick !== false;
  state.scenePick = state.scenePick === true;

  const hairPicks = { ...base.hairPicks, ...(state.hairPicks ?? {}) };
  for (const key of WARDROBE_HAIR_PICKS) hairPicks[key] = String(hairPicks[key] || "角色标签发型");
  state.hairPicks = hairPicks;

  state.weights = parseWeights(state.weights ?? {});
  for (const scope of ["sections", "fields"] as const) {
    for (const [key, value] of Object.entries(state.weights[scope])) {
      state.weights[scope][key] = clampWeightString(value, 1);
    }
  }
  for (const sub of Object.values(state.weights.options)) {
    for (const [key, value] of Object.entries(sub)) sub[key] = clampWeightString(value, 1);
  }

  state.locks = Array.from(new Set((Array.isArray(state.locks) ? state.locks : []).map(String))).filter(
    (key) => key in FIELD_SLOT,
  );
  const forcedRaw = state.forced ?? {};
  state.forced = {};
  for (const [key, value] of Object.entries(forcedRaw)) {
    if (key in FIELD_SLOT && typeof value === "string" && value.trim()) state.forced[key] = value;
  }
  state.disabledSections = Array.from(
    new Set((Array.isArray(state.disabledSections) ? state.disabledSections : []).map(String)),
  ).filter((id) => (WARDROBE_SECTION_IDS as readonly string[]).includes(id));
  state.selectedRoles = Array.from(
    new Set((Array.isArray(state.selectedRoles) ? state.selectedRoles : []).map(String).filter(Boolean)),
  ).slice(0, 8);
  state.roleWorks = Array.from(
    new Set((Array.isArray(state.roleWorks) ? state.roleWorks : []).map(String).filter(Boolean)),
  ).slice(0, 20);
  state.lastResult = normalizeLastResult(state.lastResult);

  const ui = { ...base.ui, ...(state.ui ?? {}) };
  ui.view = ["chars", "scenes", "presets"].includes(ui.view) ? ui.view : "chars";
  ui.expanded = Array.isArray(ui.expanded)
    ? ui.expanded.filter((id) => (WARDROBE_SECTION_IDS as readonly string[]).includes(id))
    : base.ui.expanded;
  ui.charQuery = String(ui.charQuery ?? "").slice(0, 100);
  ui.charWork = String(ui.charWork ?? "");
  ui.charFavOnly = ui.charFavOnly === true;
  ui.charSort = ui.charSort === "name" ? "name" : "pop";
  ui.charPageSize = [24, 60, 96].includes(Number(ui.charPageSize)) ? Number(ui.charPageSize) : 60;
  ui.sceneGroup = String(ui.sceneGroup || "sfw");
  ui.sceneQuery = String(ui.sceneQuery ?? "").slice(0, 100);
  state.ui = ui;

  return state;
}

export function defaultFavorites(): WardrobeFavorites {
  return { version: 1, characters: [], scenes: [], works: [] };
}

export function normalizeFavorites(merged: WardrobeFavorites): WardrobeFavorites {
  const chars = Array.isArray(merged?.characters) ? merged.characters.map(String).filter(Boolean) : [];
  const scenes = Array.isArray(merged?.scenes) ? merged.scenes.map(String).filter(Boolean) : [];
  const works = Array.isArray(merged?.works) ? merged.works.map(String).filter(Boolean) : [];
  return {
    version: 1,
    characters: Array.from(new Set(chars)).slice(0, 2000),
    scenes: Array.from(new Set(scenes)).slice(0, 2000),
    works: Array.from(new Set(works)).slice(0, 200),
  };
}

export function defaultOutfits(): WardrobeOutfitStore {
  return { version: 1, roles: {} };
}

export function normalizeOutfits(merged: WardrobeOutfitStore): WardrobeOutfitStore {
  const roles: WardrobeOutfitStore["roles"] = {};
  const source = merged?.roles && typeof merged.roles === "object" ? merged.roles : {};
  for (const [role, raw] of Object.entries(source)) {
    if (!raw || typeof raw !== "object") continue;
    const list = Array.isArray(raw.list) ? raw.list : [];
    const clean: WardrobeOutfitSet[] = [];
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const id = String(row.id ?? "").trim();
      if (!id) continue;
      clean.push({
        id,
        zh: String(row.zh ?? "").slice(0, 60),
        level: Math.max(0, Math.min(4, Math.trunc(Number(row.level) || 0))),
        tags: Array.isArray(row.tags)
          ? row.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean).slice(0, 60)
          : [],
        fields:
          row.fields && typeof row.fields === "object"
            ? Object.fromEntries(
                Object.entries(row.fields as Record<string, unknown>)
                  .map(([key, value]) => [String(key), String(value).trim().toLowerCase()])
                  .filter(([, value]) => value),
              )
            : {},
        drop: Array.isArray(row.drop) ? row.drop.map(String).slice(0, 20) : undefined,
        verified: row.verified === true,
        note: String(row.note ?? "").slice(0, 300) || undefined,
      });
      if (clean.length >= 20) break;
    }
    const enabled = String(raw.enabled ?? "").trim();
    roles[role] = { ...(enabled ? { enabled } : {}), list: clean };
    if (Object.keys(roles).length >= 400) break;
  }
  return { version: 1, roles };
}

export function defaultPresets(): WardrobePresetStore {
  return { version: 1, items: {} };
}

export function normalizePresets(merged: WardrobePresetStore): WardrobePresetStore {
  const items: Record<string, WardrobePreset> = {};
  const source = merged?.items && typeof merged.items === "object" ? merged.items : {};
  for (const [id, raw] of Object.entries(source)) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const name = String(rec.name ?? "").trim();
    if (!name) continue;
    const weights = parseWeights(rec.weights ?? {}) as WardrobeWeights;
    items[id] = {
      id,
      name: name.slice(0, 60),
      createdAt: Number(rec.createdAt) || Date.now(),
      level: (WARDROBE_LEVELS as readonly string[]).includes(String(rec.level))
        ? (String(rec.level) as WardrobePreset["level"])
        : "sfw",
      weights,
      locks: Array.isArray(rec.locks) ? rec.locks.map(String).slice(0, 60) : [],
      disabledSections: Array.isArray(rec.disabledSections)
        ? rec.disabledSections.map(String).filter((x) => (WARDROBE_SECTION_IDS as readonly string[]).includes(x))
        : [],
      selectedRoles: Array.isArray(rec.selectedRoles) ? rec.selectedRoles.map(String).slice(0, 8) : [],
      outfitStyle: String(rec.outfitStyle || "随机"),
      extraBody: String(rec.extraBody ?? "").slice(0, 2000),
    };
    if (Object.keys(items).length >= 60) break;
  }
  return { version: 1, items };
}
