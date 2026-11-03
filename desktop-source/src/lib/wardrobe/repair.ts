/**
 * 成品标签串的检查 + 自动修复（`repair()` 的移植）。
 *
 * 与 sanitize 的分工：
 *   sanitize 看 **state 字段**，只管我们抽出来的字段之间的矛盾；
 *   repair 看 **成品标签串**，能抓到 extra_body / 法典型 n_extra / 锁定值
 *   这些 state 层看不见的来源。
 *
 * 三条纪律：只修可判定项、优先剔除而非改写、对同一输入幂等。
 */
import { tagLevel } from "./levels";
import { requireWardrobeData } from "./store";

const STAND_TAGS = new Set(["standing sex", "stand and carry"]);
const LIE_TAGS = new Set(["lying on stomach", "on all fours", "prone bone"]);
const LOFI_TAGS = new Set(["selfie", "webcam footage", "security camera footage"]);
const PRO_DOF = new Set(["focus on face", "depth of field, blurry background"]);
const PUPIL_TAGS = new Set(["heart-shaped pupils", "rolled back eyes"]);
const MULTI_TAGS = new Set([
  "multiple girls",
  "multiple boys",
  "2girls",
  "1boy",
  "hetero",
  "yuri",
  "orgy",
  "group sex",
]);

let fieldTagCache: Map<string, Set<string>> | null = null;
let calibratedCache: Set<string> | null = null;

export function resetRepairCache(): void {
  fieldTagCache = null;
  calibratedCache = null;
}

function fieldTags(fieldKey: string): Set<string> {
  if (!fieldTagCache) {
    fieldTagCache = new Map();
    for (const section of requireWardrobeData("pools").sections) {
      for (const field of section.fields) {
        const bag = new Set<string>();
        for (const [, en] of field.opts ?? []) {
          for (const raw of String(en).split(",")) {
            const tag = raw.trim().toLowerCase();
            if (tag) bag.add(tag);
          }
        }
        fieldTagCache.set(field.key, bag);
      }
    }
  }
  return fieldTagCache.get(fieldKey) ?? new Set();
}

/** LEVEL_DEMOTE 覆盖的标签（只收 DEMOTE，不收 RAISE）。 */
export function calibratedTags(): Set<string> {
  if (calibratedCache) return calibratedCache;
  const bag = new Set<string>();
  for (const row of requireWardrobeData("overrides").levelDemote) {
    for (const raw of String(row.en).split(",")) {
      const tag = raw.trim().toLowerCase();
      if (tag) bag.add(tag);
    }
  }
  calibratedCache = bag;
  return bag;
}

export function repairTags(tags: readonly string[], lv: number): [string[], string[]] {
  const fixes: string[] = [];
  let out: string[] = [];

  // ③-a 格式：下划线归一 + 去重保序（与 F12 完全一致，score_ 例外）
  const seen = new Set<string>();
  for (const raw of tags) {
    let tag = String(raw ?? "").trim().toLowerCase();
    if (!tag) continue;
    const before = tag;
    if (tag.includes("_") && !tag.includes("score_")) tag = tag.replace(/[\s_]+/g, " ").trim();
    if (tag !== before) fixes.push(`格式：\`${before}\` → \`${tag}\``);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }

  // ① 档位：超档剔除（已登记校准项除外）
  const calibrated = calibratedTags();
  const kept: string[] = [];
  for (const tag of out) {
    if (tagLevel(tag) > lv && !calibrated.has(tag)) {
      fixes.push(`档位：剔除超 ${lv} 档的 \`${tag}\``);
      continue;
    }
    kept.push(tag);
  }
  out = kept;

  const drop = (pred: (tag: string) => boolean, why: string) => {
    const hit = out.filter(pred);
    if (!hit.length) return;
    fixes.push(`${why}：${hit.map((h) => `\`${h}\``).join(", ")}`);
    out = out.filter((tag) => !pred(tag));
  };

  const replace = (oldTag: string, newTag: string, why: string) => {
    const index = out.indexOf(oldTag);
    if (index >= 0 && !out.includes(newTag)) {
      out[index] = newTag;
      fixes.push(`${why}：\`${oldTag}\` → \`${newTag}\``);
    } else if (index >= 0) {
      drop((tag) => tag === oldTag, `${why}（保留已有的新写法）`);
    }
  };

  // ② 结构互斥（看成品）
  if (out.includes("completely nude") || out.includes("nude with accessories only")) {
    const outfit = fieldTags("outfit");
    drop((tag) => outfit.has(tag), "服装互斥（全裸）");
  }
  if (out.includes("pantyhose") && (out.includes("bare feet") || out.includes("barefoot"))) {
    drop((tag) => tag === "bare feet" || tag === "barefoot", "服装互斥（连裤袜与赤足）");
  }

  if (out.includes("blindfold")) {
    drop((tag) => PUPIL_TAGS.has(tag), "眼罩互斥（蒙眼无法呈现心形瞳/翻白眼）");
    drop((tag) => tag === "glasses", "眼罩互斥（眼罩与眼镜冲突）");
  }

  if (out.includes("solo") && out.some((tag) => MULTI_TAGS.has(tag))) {
    drop((tag) => tag === "solo", "数量互斥（solo 与多人标签冲突）");
  }

  if (out.some((tag) => tag.includes("pov"))) {
    drop((tag) => tag === "full body", "视角互斥（POV 看不到自身全身）");
  }
  if (out.includes("from above") && out.includes("from below")) {
    drop((tag) => tag === "from below", "视角互斥（俯拍与仰拍同现）");
  }
  if (out.includes("from above") && out.includes("looking up")) {
    replace("looking up", "looking at viewer", "视角互斥（俯拍时的抬眼）");
  }
  if (out.includes("from below") && out.includes("looking down")) {
    replace("looking down", "looking at viewer", "视角互斥（仰拍时的垂眼）");
  }
  if (out.includes("facing away") && out.includes("looking at viewer")) {
    drop((tag) => tag === "looking at viewer", "视角互斥（背对却注视镜头）");
  }

  if (out.some((tag) => LOFI_TAGS.has(tag)) && out.some((tag) => PRO_DOF.has(tag))) {
    drop((tag) => PRO_DOF.has(tag), "设备与画质（低画质设备不配专业景深效果）");
  }

  if (out.some((tag) => STAND_TAGS.has(tag)) && out.some((tag) => LIE_TAGS.has(tag))) {
    drop((tag) => LIE_TAGS.has(tag), "体位互斥（站立性行为与俯卧体态矛盾）");
  }

  // 修复过程可能造出重复 → 再收一次
  const final: string[] = [];
  const seen2 = new Set<string>();
  for (const tag of out) {
    if (!seen2.has(tag)) {
      seen2.add(tag);
      final.push(tag);
    }
  }
  return [final, fixes];
}
