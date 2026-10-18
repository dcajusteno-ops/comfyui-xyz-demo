/**
 * Anima / Danbooru 提示词分词与规范化。
 *
 * 规则对齐插件 nodes.py：
 * - 只按英文逗号切分（拼接台额外承认中文逗号与换行，因为那是本项目的输入框）；
 * - `_raw_:` 前缀只去掉第一次出现；
 * - 去重按小写比较、保留第一次出现的原样大小写；
 * - 识别性别词与角色特征词（发色/瞳色）时把 `_` 当空格。
 */
import type { Rng } from "./prng";
import { randomInt } from "./prng";

export const GENDER_TAGS = new Set([
  "1boy",
  "1girl",
  "1other",
  "2boys",
  "2girls",
  "androgynous",
  "female",
  "female focus",
  "genderbend",
  "male",
  "male focus",
  "multiple boys",
  "multiple girls",
]);

export const CHARACTER_FEATURE_WORD_PREFIXES = ["eye", "hair"] as const;

export const CHARACTER_FEATURE_KEYWORDS = [
  "ahoge",
  "bangs",
  "braid",
  "braids",
  "hair bun",
  "hime cut",
  "one side up",
  "ponytail",
  "sidelocks",
  "twintails",
  "updo",
] as const;

export const CHARACTER_FEATURE_COLOUR_TARGETS = ["eye", "eyes", "hair"] as const;

export const CHARACTER_COLOUR_WORDS = new Set([
  "aqua",
  "black",
  "blonde",
  "blue",
  "brown",
  "cyan",
  "gray",
  "green",
  "grey",
  "indigo",
  "lavender",
  "magenta",
  "maroon",
  "orange",
  "pink",
  "purple",
  "red",
  "silver",
  "teal",
  "turquoise",
  "violet",
  "white",
  "yellow",
]);

/** 只按逗号切分（对齐 Composer / PromptPlus）。数组输入会被展平。 */
export function splitPromptTokens(value: string | string[] | undefined | null): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => splitPromptTokens(item));
  return String(value ?? "")
    .replace(/\r/g, ",")
    .replace(/\n/g, ",")
    .split(",")
    .map((part) => part.replace("_raw_:", "").trim())
    .filter(Boolean);
}

/** 拼接台输入框：额外承认中文逗号与换行 */
export function splitSectionTokens(value: string | undefined | null): string[] {
  return String(value ?? "")
    .split(/[,，\r\n]+/)
    .map((part) => part.replace("_raw_:", "").trim())
    .filter(Boolean);
}

/** 比较用的归一化键：小写、下划线转空格、折叠空白 */
export function normalizeTokenKey(tag: string): string {
  return String(tag ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/** 去重：按小写比较，保留首次出现的原样（与插件 `_dedupe_prompt_tokens` 一致） */
export function dedupeTokens(tokens: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const key = String(token ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(token).trim());
  }
  return out;
}

/**
 * 画师 token：去掉已有的 `@` 或 `by ` 前缀，再统一补 `@`。
 * `_raw_:` 在 splitPromptTokens 里已剥离，这里再兜一次（画廊可能直接传原文）。
 */
export function artistToken(value: string): string {
  let tag = String(value ?? "").trim().replace(/^_raw_:/, "").trim();
  if (!tag) return "";
  if (tag.startsWith("@")) tag = tag.slice(1).trim();
  else if (/^by\s+/i.test(tag)) tag = tag.replace(/^by\s+/i, "").trim();
  return tag ? `@${tag}` : "";
}

/** official 数据的查找键：`normalize(name)||normalize(copyright)` */
export function characterKey(name: string, copyright: string): string {
  return `${normalizeTokenKey(name)}||${normalizeTokenKey(copyright)}`;
}

export function isGenderTag(tag: string): boolean {
  return GENDER_TAGS.has(normalizeTokenKey(tag));
}

export function isCharacterFeatureTag(tag: string): boolean {
  const text = normalizeTokenKey(tag);
  if (!text) return false;
  for (const word of text.split(" ")) {
    if (CHARACTER_FEATURE_WORD_PREFIXES.some((prefix) => word.startsWith(prefix))) return true;
  }
  return CHARACTER_FEATURE_KEYWORDS.some((keyword) => text.includes(keyword));
}

/**
 * 把一个角色的 official tags 拆成「身份特征」与「服装/其余」。
 * 性别词在这里被剔除（但 trigger_tags 模式仍会用完整 tag 列表，见 gacha.ts）。
 */
export function splitCharacterTags(tags: readonly string[]): { features: string[]; outfit: string[] } {
  const features: string[] = [];
  const outfit: string[] = [];
  for (const tag of dedupeTokens(tags)) {
    if (isGenderTag(tag)) continue;
    if (isCharacterFeatureTag(tag)) features.push(tag);
    else outfit.push(tag);
  }
  return { features, outfit };
}

/**
 * 判断一个词是不是「同属性冲突色」：末词是 eye/eyes/hair 且包含颜色词。
 * 例：`blue eyes`、`aqua hair` → 分别归入 eyes/hair 组；`hair bow` 不归组。
 */
export function characterColourGroup(tag: string): string | null {
  const words = normalizeTokenKey(tag).split(" ").filter(Boolean);
  if (words.length < 2) return null;
  const last = words[words.length - 1];
  if (!(CHARACTER_FEATURE_COLOUR_TARGETS as readonly string[]).includes(last)) return null;
  if (!words.some((word) => CHARACTER_COLOUR_WORDS.has(word))) return null;
  return last;
}

/**
 * 同一角色常有多个冲突色（`grey eyes` + `purple eyes`），每组只留一个。
 * 输出位置取该组第一次出现的位置，后面的同组词丢弃。
 */
export function collapseFeatureColours(tags: readonly string[], rng?: Rng): string[] {
  const parts = dedupeTokens(tags);
  const groups = new Map<string, string[]>();
  for (const tag of parts) {
    const group = characterColourGroup(tag);
    if (!group) continue;
    const list = groups.get(group) ?? [];
    list.push(tag);
    groups.set(group, list);
  }

  const chosen = new Map<string, string>();
  for (const [group, list] of groups) {
    chosen.set(group, rng && list.length > 1 ? list[randomInt(rng, list.length)] : list[0]);
  }

  const out: string[] = [];
  const emitted = new Set<string>();
  for (const tag of parts) {
    const group = characterColourGroup(tag);
    if (!group) {
      out.push(tag);
      continue;
    }
    if (emitted.has(group)) continue;
    emitted.add(group);
    out.push(chosen.get(group) ?? tag);
  }
  return out;
}
