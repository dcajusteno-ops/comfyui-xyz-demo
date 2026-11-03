/**
 * 输出槽位（源脚本 / `rules.py` 的 SLOTS 与 FIELD_SLOT）。
 *
 * 单独成文件是为了让 `levels.ts`（effectiveLevel 需要判断字段是否入正文）
 * 与 `collect.ts` 共用同一张表，同时避免两者互相 import。
 */
import type { WardrobeSlot } from "./types";

export const SLOTS = [
  "count",
  "character",
  "appearance",
  "clothing",
  "pose",
  "expression",
  "camera",
  "scene",
  "lighting",
  "detail",
  "free",
] as const satisfies readonly WardrobeSlot[];

export const FIELD_SLOT: Record<string, WardrobeSlot> = {
  count: "count",
  role: "character",

  hair_len: "appearance",
  hair_color: "appearance",
  hair_curl: "appearance",
  hair_tie: "appearance",
  hair_bangs: "appearance",
  hair_fx: "appearance",
  hair_acc: "appearance",

  face_shape: "appearance",
  eyes_color: "appearance",
  temperament: "appearance",
  emotion: "expression",
  eye_gaze: "expression",
  mouth: "expression",

  figure: "appearance",
  skin: "appearance",
  leg: "appearance",
  skin_detail: "detail",

  makeup: "detail",
  nails: "detail",

  outfit: "clothing",
  cloth_mat: "clothing",
  cloth_state_sfw: "clothing",
  socks: "clothing",
  shoes: "clothing",
  accessory: "clothing",
  cloth_color: "clothing",
  sock_color: "clothing",
  top: "clothing",
  bottom: "clothing",

  pose_base: "pose",
  arms_hands: "pose",
  action: "pose",
  pose_risque: "pose",

  shot_size: "camera",
  viewpoint: "camera",
  dof: "camera",
  device: "camera",

  place: "scene",
  prop: "scene",
  weather: "scene",
  comp: "camera",
  texture_fx: "detail",

  light_fx: "lighting",

  n_state: "clothing",
  n_exposure: "clothing",
  n_body: "clothing",
  n_fabric: "clothing",
  n_shoes_keep: "clothing",

  n_act: "pose",
  n_pos: "pose",
  n_orgasm: "pose",
  n_cum: "pose",
  n_fluid: "pose",

  n_theme: "detail",

  n_canon: "free",
  n_extra: "free",
  nl: "free",
};

/** 内部字段（`_` 前缀）之外，collect 还要跳过的主键。 */
export const NO_EMIT_FIELDS = new Set(["n_canon"]);

/** 超长裁剪顺序（低优先级先削）。 */
export const DROP_ORDER = [
  "texture_fx",
  "comp",
  "prop",
  "weather",
  "hair_acc",
  "nails",
  "skin_detail",
  "leg",
];
