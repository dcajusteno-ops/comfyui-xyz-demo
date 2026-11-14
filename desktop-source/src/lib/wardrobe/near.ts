/**
 * 特写「收紧取景」（`near_*` 的移植，插件 v6.7.0 从这里起是唯一真源）。
 *
 * 规则：按部位白名单把字段权重清零、关掉不该出现的段、把人数钉死到条目自带的
 * `count_lock`；局部特写还要清掉角色（画框里没有脸）。
 *
 * ⚠️ 数据里**没有 `part` 键**，部位写在 `theme`（`near_part_of` 是 `part ?? theme`）。
 * ⚠️ 普通 sfw 场景的 `theme` 是题材（夜景/日常…），不在白名单里 → `nearSlimProfile`
 *    返回 `null`，不会误伤。
 */
import { requireWardrobeData } from "./store";
import { WEIGHT_MAX } from "./weights";
import type { WardrobeScene, WardrobeWeights } from "./types";

export const NEAR_LOCAL_SECTIONS = ["hair", "face", "body", "makeup"];

export const NEAR_VISIBLE: Record<string, string[]> = {
  面部: [
    "hair_len", "hair_color", "hair_curl", "hair_tie", "hair_bangs",
    "hair_fx", "hair_acc", "eyes_color", "emotion", "eye_gaze", "mouth",
    "skin", "skin_detail", "makeup", "accessory", "shot_size",
    "viewpoint", "dof", "place", "weather", "prop", "light_fx",
    "texture_fx",
  ],
  眼与唇: [
    "hair_bangs", "hair_fx", "eyes_color", "emotion", "eye_gaze",
    "mouth", "skin", "makeup", "shot_size", "dof", "place",
    "light_fx", "texture_fx",
  ],
  上半身与胸: [
    "hair_len", "hair_color", "hair_curl", "hair_tie", "hair_bangs",
    "hair_fx", "hair_acc", "eyes_color", "emotion", "eye_gaze",
    "mouth", "figure", "skin", "skin_detail", "makeup", "outfit",
    "cloth_color", "cloth_mat", "cloth_state_sfw", "top",
    "accessory", "arms_hands", "pose_base", "shot_size",
    "viewpoint", "dof", "place", "prop", "weather", "comp",
    "light_fx", "texture_fx",
  ],
  // ⚠️ 四肢/臀不放 `dof`：候选里有 `focus on face`，与"只看局部"自相矛盾
  手部: [
    "skin", "arms_hands", "pose_base", "shot_size", "viewpoint",
    "place", "prop", "weather", "light_fx",
  ],
  "手部·有脸": [
    "hair_len", "hair_color", "hair_curl", "hair_tie", "hair_bangs",
    "hair_fx", "hair_acc", "eyes_color", "emotion", "eye_gaze",
    "mouth", "skin", "skin_detail", "makeup", "accessory",
    "arms_hands", "pose_base", "shot_size", "viewpoint", "dof",
    "place", "prop", "weather", "light_fx",
  ],
  "🔞 成人向": [
    "skin", "skin_detail", "figure", "pose_base",
    "shot_size", "viewpoint", "place", "prop", "weather", "light_fx",
  ],
  "🔞 成人向·有脸": [
    "hair_len", "hair_color", "hair_curl", "hair_tie", "hair_bangs",
    "hair_fx", "hair_acc", "eyes_color", "emotion", "eye_gaze",
    "mouth", "skin", "skin_detail", "makeup", "accessory",
    "figure", "pose_base", "shot_size", "viewpoint", "place",
    "prop", "weather", "light_fx",
  ],
  腿部: [
    "skin", "cloth_color", "sock_color", "socks", "shoes", "pose_base",
    "shot_size", "viewpoint", "place", "prop", "weather", "light_fx",
  ],
  脚部: [
    "skin", "cloth_color", "sock_color", "socks", "shoes", "pose_base",
    "shot_size", "viewpoint", "place", "prop", "weather", "light_fx",
  ],
  臀部: [
    "skin", "cloth_color", "sock_color", "socks", "shoes", "pose_base",
    "shot_size", "viewpoint", "place", "prop", "weather", "light_fx",
  ],
};

/** 部位 → 要关掉哪几段（面部/眼与唇留 ②③ 才能出五官与表情） */
export const NEAR_DROP_SECTIONS: Record<string, string[]> = {
  面部: ["body", "makeup"],
  眼与唇: ["body", "makeup"],
  上半身与胸: [],
  手部: NEAR_LOCAL_SECTIONS,
  腿部: NEAR_LOCAL_SECTIONS,
  脚部: NEAR_LOCAL_SECTIONS,
  臀部: NEAR_LOCAL_SECTIONS,
  "🔞 成人向": NEAR_LOCAL_SECTIONS,
};

/** 部位 → 要不要清角色（局部特写不该有脸）；标了 `role_ok` 的条目例外 */
export const NEAR_DROP_ROLE: Record<string, boolean> = {
  手部: true,
  腿部: true,
  脚部: true,
  臀部: true,
  "🔞 成人向": true,
};

export type NearSlimProfile = {
  part: string;
  sections: string[];
  fields: string[];
  dropRole: boolean;
  roleOk: boolean;
};

let allFieldKeysCache: string[] | null = null;

export function resetNearCache(): void {
  allFieldKeysCache = null;
}

/** 全部字段 key（按段顺序）—— 精简档"清零"按这张表算。 */
export function allFieldKeys(): string[] {
  if (allFieldKeysCache) return allFieldKeysCache;
  const out: string[] = [];
  for (const section of requireWardrobeData("pools").sections) {
    for (const field of section.fields) {
      const key = String(field.key ?? "");
      if (key && !out.includes(key)) out.push(key);
    }
  }
  allFieldKeysCache = out;
  return out;
}

/** 特写条目属于哪个部位（数据里叫 `theme`，payload 里叫 `part`）。 */
export function nearPartOf(scene: WardrobeScene | null | undefined): string {
  return String(scene?.theme ?? "").trim();
}

/** 这条特写要**清零**哪些字段 = 全字段 −（可见白名单 ∪ 它自己写的 ∪ 特例）。 */
export function nearSlimFields(scene: WardrobeScene | null | undefined, visKey = ""): string[] {
  const key = visKey || nearPartOf(scene);
  const keep = new Set(NEAR_VISIBLE[key] ?? []);
  for (const field of Object.keys(scene?.tags ?? {})) keep.add(field);
  for (const field of ["n_canon", "n_extra", "count", "role"]) keep.add(field);
  // 条目点名闭麦的字段要从白名单里摘掉（口交特写连 `pose_base` 都不能留）
  for (const field of scene?.drop_fields ?? []) keep.delete(field);
  // `random_fields` 的字段由后端抽值，权重清零会让 blockedByWeight 挡掉
  for (const field of Object.keys(scene?.random_fields ?? {})) keep.add(field);
  return allFieldKeys().filter((field) => !keep.has(field));
}

/** 特写条目 → 精简档；不是特写（或部位不认识）返回 null。 */
export function nearSlimProfile(scene: WardrobeScene | null | undefined): NearSlimProfile | null {
  if (!scene) return null;
  const part = nearPartOf(scene);
  if (!(part in NEAR_VISIBLE)) return null;
  if (scene.role_ok) {
    const faceKey = `${part}·有脸` in NEAR_VISIBLE ? `${part}·有脸` : "🔞 成人向·有脸";
    return {
      part,
      sections: ["body", "makeup"],
      fields: nearSlimFields(scene, faceKey),
      dropRole: false,
      roleOk: true,
    };
  }
  return {
    part,
    sections: [...(NEAR_DROP_SECTIONS[part] ?? [])],
    fields: nearSlimFields(scene),
    dropRole: Boolean(NEAR_DROP_ROLE[part]),
    roleOk: false,
  };
}

/** 特写的人数袋：默认钉死单人，条目自带 `count_lock` 就按它钉。 */
export function nearCountBag(countLock = ""): Record<string, number> {
  const want = String(countLock ?? "").trim() || "1girl, solo";
  const bag: Record<string, number> = {};
  for (const section of requireWardrobeData("pools").sections) {
    for (const field of section.fields) {
      if (field.key !== "count") continue;
      for (const [, en] of field.opts ?? []) {
        bag[String(en)] = String(en) === want ? WEIGHT_MAX : 0;
      }
    }
  }
  return bag;
}

/** 把精简档写进一份**拷贝**的权重表（不动调用方传进来的那份）。 */
export function slimWeightsForNear(weights: WardrobeWeights, scene: WardrobeScene | null): WardrobeWeights {
  const profile = nearSlimProfile(scene);
  if (!profile) return weights;
  const options: Record<string, Record<string, number>> = {};
  for (const [key, value] of Object.entries(weights?.options ?? {})) {
    options[key] = { ...value };
  }
  const next: WardrobeWeights = {
    sections: { ...(weights?.sections ?? {}) },
    fields: { ...(weights?.fields ?? {}) },
    options,
  };
  for (const key of profile.sections) next.sections[key] = 0;
  for (const key of profile.fields) next.fields[key] = 0;
  next.options.count = nearCountBag(scene?.count_lock);
  return next;
}
