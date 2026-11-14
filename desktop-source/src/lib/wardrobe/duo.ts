/**
 * 多人「按人绑定」整句（`duo_*` 的移植，v4.5.0 起 / V6 的 `need` 参数）。
 *
 * 平铺标签分不清"哪件是谁的"，只能走整句：`X wears … and …` / `X has …`。
 * ⚠️ 句内不许有逗号 —— `collect()` 会按逗号把 tail_extra 拆成标签堆。
 * ⚠️ 服装 / 官方配件**不受 `appearance_follow` 控制**：那是用户手选的。
 */
import { appearanceFor, charFeatFor, roleOutputName } from "./characters";
import { effectiveOutfit } from "./outfitLibrary";

export function duoName(trigger: string): string {
  const name = roleOutputName(trigger) || String(trigger ?? "").split(",")[0].trim();
  return name.replace(/[_,;\n]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * 把"每人一句"拼成整段。`need` 是**最少几句才值得输出**：
 *   · 外貌 / 官方配件默认 2 —— 只有一位时说"谁长什么样"没有意义；
 *   · 服装 / 配件写 `need=1`（v6.6.1）—— 双人里只有一位启用预设时也要写出来。
 */
export function duoJoin(parts: readonly string[], need = 2): string {
  if (parts.length < Math.max(1, Math.trunc(need))) return "";
  return `${parts.join(". ")}.`.replace(/[,\n;]+/g, " ").trim();
}

/** 多位角色**各自**的外貌整句（只有一位有数据时不写）。 */
export function duoAppearanceText(triggers: readonly string[]): string {
  const parts: string[] = [];
  for (const raw of triggers.slice(0, 3)) {
    const trigger = String(raw ?? "").trim();
    if (!trigger) continue;
    const appearance = appearanceFor(trigger);
    if (!Object.keys(appearance).length) continue;
    const bits = ["hair", "eyes"].map((k) => String(appearance[k] ?? "").trim()).filter(Boolean);
    if (!bits.length) continue;
    parts.push(`${duoName(trigger)} has ${bits.join(" and ")}`);
  }
  return duoJoin(parts);
}

/** 双人时**各自**的服装整句（角色预设优先、服装库兜底；场景带衣物时可整套让路）。 */
export function duoOutfitText(triggers: readonly string[], lv = 99, sceneHasOutfit = false): string {
  const parts: string[] = [];
  for (const raw of triggers.slice(0, 3)) {
    const trigger = String(raw ?? "").trim();
    if (!trigger) continue;
    const [extras] = effectiveOutfit(trigger, lv, sceneHasOutfit);
    const bits = extras.slice(0, 5).map((x) => String(x).trim()).filter(Boolean);
    if (!bits.length) continue;
    parts.push(`${duoName(trigger)} wears ${bits.join(" and ")}`);
  }
  return duoJoin(parts, 1);
}

/** 双人时**各自**的角色固定特征整句（排除服装句已经写过的标签）。 */
export function duoFeatText(triggers: readonly string[], seed?: number, lv = 99, sceneHasOutfit = false): string {
  const parts: string[] = [];
  for (const raw of triggers.slice(0, 3)) {
    const trigger = String(raw ?? "").trim();
    if (!trigger) continue;
    const [extras] = charFeatFor(trigger, seed);
    const outfitTags = new Set(
      effectiveOutfit(trigger, lv, sceneHasOutfit)[0].map((x) => String(x).trim().toLowerCase()),
    );
    const bits = extras
      .map((x) => String(x).trim())
      .filter((x) => x && !outfitTags.has(x.toLowerCase()))
      .slice(0, 6);
    if (!bits.length) continue;
    parts.push(`${duoName(trigger)} has ${bits.slice(0, 5).join(" and ")}`);
  }
  return duoJoin(parts, 1);
}
