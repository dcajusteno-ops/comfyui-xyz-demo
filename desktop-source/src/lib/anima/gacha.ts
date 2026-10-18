/**
 * 随机抽卡：严格对齐插件 AnimaPromptComposer 的取词规则
 * （nodes.py 的 `_resolve_prompt_data` / `_entry_parts` / `_resolve_clothing_entries`），
 * 但随机源换成项目自有的确定性 PRNG。
 *
 * 关键差异（有意为之）：
 * - 输出末不带 `, `，写入提示词时更干净；
 * - 与插件同一 seed 不会得到同一结果（Python / JS 随机流不同），UI 已注明。
 */
import type {
  AnimaArtist,
  AnimaCharacter,
  AnimaCharacterDetail,
  AnimaCharacterPick,
  AnimaClothingSource,
  AnimaComposerPick,
  AnimaComposerResult,
  AnimaCostumePick,
  AnimaDanbooruAttire,
  AnimaDataMap,
  AnimaGachaOptions,
  AnimaOfficialCharacter,
} from "./types";
import { createRng, pickOne, randomSeed, sampleItems, sampleParts, type Rng } from "./prng";
import {
  characterKey,
  collapseFeatureColours,
  dedupeTokens,
  splitCharacterTags,
  splitPromptTokens,
} from "./tags";
import { characterPreviewUrl } from "./preview";

export type GachaData = Pick<
  AnimaDataMap,
  "artists" | "characters" | "official" | "clothing" | "backgrounds" | "poses" | "danbooruAttire"
>;

const CLOTHING_SOURCES: AnimaClothingSource[] = ["author", "danbooru", "character_tags", "random"];
const RANDOM_SOURCES: Array<Exclude<AnimaClothingSource, "random">> = ["author", "danbooru", "character_tags"];
const MAIN_VARIANTS = ["top_bottom", "uniform", "traditional"] as const;
const LAYERED_SLOTS: Array<[keyof AnimaDanbooruAttire, number]> = [
  ["decoration", 1],
  ["socks", 0.6],
  ["shoes", 0.6],
];

function intValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeDetail(value: unknown): AnimaCharacterDetail {
  return value === "trigger_tags" || value === "trigger_random_tags" || value === "trigger"
    ? value
    : "trigger";
}

function normalizeClothingSource(value: unknown): AnimaClothingSource {
  return CLOTHING_SOURCES.includes(value as AnimaClothingSource) ? (value as AnimaClothingSource) : "author";
}

/** 角色条目：触发词 + 完整 tag 列表 + 拆分后的特征/服装词 */
export type CharacterEntry = {
  item: AnimaCharacter;
  copyright: string;
  triggerParts: string[];
  /** 含性别词，供 trigger_tags 模式使用（插件就是这样） */
  allTagParts: string[];
  featureParts: string[];
  outfitParts: string[];
};

export function buildCharacterEntry(
  item: AnimaCharacter,
  officialData: Record<string, AnimaOfficialCharacter>,
): CharacterEntry {
  const name = String(item.name ?? "").trim();
  const copyright = String(item.copyright ?? "").trim();
  const official = officialData[characterKey(name, copyright)] ?? {};
  const triggerText =
    String(official.trigger ?? "").trim() || (copyright ? `${name}, ${copyright}` : name);

  const tags = splitPromptTokens(official.tags ?? []);
  if (!tags.length) {
    // 207/8000 条 official tags 为空：用图鉴里的性别/发色/瞳色兜底
    if (item.gender) tags.push(item.gender);
    if (item.hair) tags.push(`${item.hair} hair`);
    if (item.eye) tags.push(`${item.eye} eyes`);
  }
  const allTagParts = dedupeTokens(tags);
  const { features, outfit } = splitCharacterTags(allTagParts);
  return {
    item,
    copyright,
    triggerParts: splitPromptTokens(triggerText),
    allTagParts,
    featureParts: features,
    outfitParts: outfit,
  };
}

/** 按 character_detail 模式取实际输出的词 */
export function characterEntryParts(
  entry: CharacterEntry,
  options: { detail: AnimaCharacterDetail; keepFeatures: boolean; tagCount: number },
  rng: Rng,
): string[] {
  const parts = entry.triggerParts.slice();
  if (options.detail === "trigger_tags") {
    parts.push(...entry.allTagParts);
  } else if (options.detail === "trigger_random_tags") {
    if (options.keepFeatures) {
      // 发色/瞳色跟着触发词走，同类冲突色只留一个，角色才认得出是自己
      parts.push(...collapseFeatureColours(entry.featureParts, rng));
    }
    parts.push(...sampleParts(rng, entry.outfitParts, options.tagCount));
  }
  return parts;
}

function authorOutfit(data: GachaData, rng: Rng): AnimaCostumePick[] {
  const item = pickOne(rng, data.clothing);
  if (!item) return [];
  return [
    {
      title: item.nameZh || item.name,
      subtitle: item.name,
      preview: item.preview,
      parts: splitPromptTokens(item.tags),
    },
  ];
}

/** Danbooru 标签组：一套主服装 + 装饰/袜子/鞋子，避免「两双鞋」这类冲突 */
export function danbooruOutfit(attire: AnimaDanbooruAttire, rng: Rng): AnimaCostumePick[] {
  const pools = {
    top: attire.top ?? [],
    bottom: attire.bottom ?? [],
    uniform: attire.uniform ?? [],
    traditional: attire.traditional ?? [],
    decoration: attire.decoration ?? [],
    socks: attire.socks ?? [],
    shoes: attire.shoes ?? [],
  };
  if (!pools.top.length || !pools.bottom.length || !pools.uniform.length || !pools.traditional.length) {
    return [];
  }

  const entries: AnimaCostumePick[] = [];
  const variant = pickOne(rng, MAIN_VARIANTS) ?? "top_bottom";
  const push = (slot: string, tag: string) =>
    entries.push({ title: tag, subtitle: `danbooru ${slot}`, parts: [tag] });

  if (variant === "top_bottom") {
    const top = pickOne(rng, pools.top);
    const bottom = pickOne(rng, pools.bottom);
    if (top) push("top", top);
    if (bottom) push("bottom", bottom);
  } else {
    const item = pickOne(rng, pools[variant]);
    if (item) push(variant, item);
  }

  for (const [slot, probability] of LAYERED_SLOTS) {
    const pool = pools[slot as keyof typeof pools] ?? [];
    if (!pool.length) continue;
    // 概率为 1 时不消耗随机数（对齐插件 `probability < 1 and rng.random()` 的短路）
    if (probability < 1 && rng() >= probability) continue;
    const tag = pickOne(rng, pool);
    if (tag) push(slot, tag);
  }
  return entries;
}

/** 借用其它角色的 official tags 当服装；只有约 1/5 的角色有 ≥2 个可穿词 */
export function characterTagOutfit(data: GachaData, rng: Rng, attempts = 40): AnimaCostumePick[] {
  const vocabulary = new Set(
    (data.danbooruAttire.vocabulary ?? []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean),
  );
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    const item = pickOne(rng, data.characters);
    if (!item) return [];
    const entry = buildCharacterEntry(item, data.official);
    let outfit = dedupeTokens(entry.outfitParts);
    if (vocabulary.size) outfit = outfit.filter((tag) => vocabulary.has(tag.toLowerCase()));
    if (outfit.length < 2) continue;
    return [
      {
        title: entry.item.name,
        subtitle: entry.copyright,
        preview: characterPreviewUrl(entry.item.name, entry.copyright),
        parts: outfit,
      },
    ];
  }
  return [];
}

export function resolveClothing(
  data: GachaData,
  source: AnimaClothingSource,
  rng: Rng,
): AnimaCostumePick[] {
  let resolved = normalizeClothingSource(source);
  if (resolved === "random") {
    resolved = pickOne(rng, RANDOM_SOURCES) ?? "author";
  }
  if (resolved === "danbooru") {
    const entries = danbooruOutfit(data.danbooruAttire, rng);
    if (entries.length) return entries;
  }
  if (resolved === "character_tags") {
    const entries = characterTagOutfit(data, rng);
    if (entries.length) return entries;
  }
  return authorOutfit(data, rng);
}

function artistParts(artists: readonly AnimaArtist[]): string[] {
  return artists.map((artist) => {
    const name = String(artist.name ?? "").trim().replace(/^@/, "");
    return name ? `@${name}` : "";
  }).filter(Boolean);
}

export function composeAnimaPrompt(data: GachaData, options: AnimaGachaOptions): AnimaComposerResult {
  const seedValue = intValue(options.seed, -1);
  const usedSeed = seedValue < 0 ? randomSeed() : Math.abs(seedValue);
  const master = createRng(usedSeed);

  const characterSeedValue = intValue(options.characterSeed, -1);
  const clothingSeedValue = intValue(options.clothingSeed, -1);
  const characterRng = characterSeedValue < 0 ? master : createRng(characterSeedValue);
  const clothingRng = clothingSeedValue < 0 ? master : createRng(clothingSeedValue);

  const enable = options.enable ?? {
    artist: true,
    character: true,
    clothing: true,
    background: true,
    pose: true,
  };
  const artistCount = clamp(intValue(options.artistCount, 1), 0, 20);
  const tagCount = clamp(intValue(options.characterTagCount, 3), 0, 30);
  const detail = normalizeDetail(options.characterDetail);

  // 抽取顺序必须与插件一致：artist → character → clothing → background → pose
  const artists = enable.artist ? sampleItems(master, data.artists, artistCount) : [];
  const characterItem = enable.character ? sampleItems(characterRng, data.characters, 1)[0] : undefined;
  const clothing = enable.clothing
    ? resolveClothing(data, normalizeClothingSource(options.clothingSource), clothingRng)
    : [];
  const backgroundItem = enable.background ? sampleItems(master, data.backgrounds, 1)[0] : undefined;
  const poseItem = enable.pose ? sampleItems(master, data.poses, 1)[0] : undefined;

  const characterEntry = characterItem ? buildCharacterEntry(characterItem, data.official) : undefined;

  const sections: AnimaComposerResult["sections"] = {
    artist: [],
    character: [],
    clothing: [],
    background: [],
    pose: [],
  };
  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (section: keyof typeof sections, tokens: readonly string[]) => {
    for (const token of tokens) {
      const key = String(token ?? "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      sections[section].push(String(token).trim());
      parts.push(String(token).trim());
    }
  };

  push("artist", artistParts(artists));
  if (characterEntry) {
    push(
      "character",
      characterEntryParts(characterEntry, {
        detail,
        keepFeatures: options.characterKeepFeatures !== false,
        tagCount,
      }, characterRng),
    );
  }
  for (const entry of clothing) push("clothing", entry.parts);
  if (backgroundItem) push("background", splitPromptTokens(backgroundItem.tags));
  if (poseItem) push("pose", splitPromptTokens(poseItem.tags));

  const characterPick: AnimaCharacterPick | undefined = characterEntry
    ? {
        item: characterEntry.item,
        copyright: characterEntry.copyright,
        trigger: characterEntry.triggerParts,
        featureParts: characterEntry.featureParts,
        outfitParts: characterEntry.outfitParts,
        parts: sections.character,
      }
    : undefined;

  const picks: AnimaComposerPick = {
    artists,
    ...(characterPick ? { character: characterPick } : {}),
    clothing,
    ...(backgroundItem
      ? {
          background: {
            title: backgroundItem.nameZh || backgroundItem.name,
            subtitle: backgroundItem.name,
            preview: backgroundItem.preview,
            parts: sections.background,
          },
        }
      : {}),
    ...(poseItem
      ? {
          pose: {
            title: poseItem.nameZh || poseItem.name,
            subtitle: poseItem.name,
            preview: poseItem.preview,
            parts: sections.pose,
          },
        }
      : {}),
  };

  return {
    text: parts.join(", "),
    parts,
    usedSeed,
    sections,
    picks,
  };
}

/** 把抽卡结果填进拼接台：直接用已去重的 sections，保证三处文本一致 */
export type ComposerFillValues = Record<
  "artist" | "character" | "clothing" | "background" | "pose",
  string
>;

export function composerValuesFromResult(
  result: Pick<AnimaComposerResult, "sections">,
): ComposerFillValues {
  return {
    artist: result.sections.artist.join(", "),
    character: result.sections.character.join(", "),
    clothing: result.sections.clothing.join(", "),
    background: result.sections.background.join(", "),
    pose: result.sections.pose.join(", "),
  };
}
