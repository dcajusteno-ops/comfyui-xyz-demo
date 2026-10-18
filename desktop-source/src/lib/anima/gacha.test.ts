import { describe, expect, it } from "vitest";
import {
  buildCharacterEntry,
  characterEntryParts,
  characterTagOutfit,
  composeAnimaPrompt,
  resolveClothing,
  type GachaData,
} from "./gacha";
import type { AnimaCharacter, AnimaCostumeItem, AnimaGachaOptions } from "./types";
import { defaultGachaOptions } from "./persist";
import { createRng } from "./prng";
import { buildComposerPreview } from "./compose";
import { characterKey } from "./tags";

const artist = (index: number) => ({
  id: `a${index}`,
  name: `artist ${index}`,
  postCount: 1000 - index,
});

const miku: AnimaCharacter = {
  name: "hatsune miku",
  copyright: "vocaloid",
  postCount: 100,
  gender: "1girl",
  hair: "blue",
  eye: "blue",
};
const reimu: AnimaCharacter = {
  name: "hakurei reimu",
  copyright: "touhou",
  postCount: 90,
  gender: "1girl",
  hair: "black",
  eye: "red",
};
const marisa: AnimaCharacter = {
  name: "kirisame marisa",
  copyright: "touhou",
  postCount: 80,
  gender: "1girl",
  hair: "blonde",
  eye: "yellow",
};

const official = {
  [characterKey(miku.name, miku.copyright)]: {
    trigger: "hatsune miku, vocaloid",
    tags: [
      "1girl",
      "aqua eyes",
      "blue eyes",
      "very long hair",
      "aqua hair",
      "long hair",
      "twintails",
      "detached sleeves",
    ],
  },
  [characterKey(reimu.name, reimu.copyright)]: {
    trigger: "hakurei reimu, touhou",
    tags: [
      "1girl",
      "brown eyes",
      "red eyes",
      "brown hair",
      "long hair",
      "black hair",
      "hair bow",
      "hair tubes",
      "red bow",
      "detached sleeves",
    ],
  },
  [characterKey(marisa.name, marisa.copyright)]: {
    trigger: "kirisame marisa, touhou",
    tags: [],
  },
};

const costume = (id: string, name: string, tags: string): AnimaCostumeItem => ({
  id,
  name,
  nameZh: name,
  tags,
  categories: [],
  traits: [],
});

const clothing = [
  costume("c1", "Evening Gown", "evening gown, halterneck"),
  costume("c2", "Sailor Uniform", "sailor uniform, pleated skirt"),
];
const backgrounds = [costume("b1", "Beach", "beach, sunset")];
const poses = [costume("p1", "Standing", "standing")];

const data: GachaData = {
  artists: Array.from({ length: 8 }, (_, index) => artist(index)),
  characters: [miku, reimu, marisa],
  official,
  clothing,
  backgrounds,
  poses,
  danbooruAttire: {
    top: ["shirt"],
    bottom: ["skirt"],
    uniform: ["sailor uniform"],
    traditional: ["kimono"],
    decoration: ["ribbon"],
    socks: ["thighhighs"],
    shoes: ["boots"],
    vocabulary: ["shirt", "skirt", "sailor uniform", "kimono", "ribbon", "thighhighs", "boots", "detached sleeves", "red bow"],
  },
};

function options(overrides: Partial<AnimaGachaOptions> = {}): AnimaGachaOptions {
  const base = defaultGachaOptions();
  return {
    ...base,
    ...overrides,
    enable: { ...base.enable, ...(overrides.enable ?? {}) },
  };
}

function only(section: keyof AnimaGachaOptions["enable"], overrides: Partial<AnimaGachaOptions> = {}) {
  return options({
    ...overrides,
    enable: {
      artist: section === "artist",
      character: section === "character",
      clothing: section === "clothing",
      background: section === "background",
      pose: section === "pose",
    },
  });
}

describe("角色条目", () => {
  it("official trigger 与 tag 拆分：性别词不进特征/服装", () => {
    const entry = buildCharacterEntry(miku, official);
    expect(entry.triggerParts).toEqual(["hatsune miku", "vocaloid"]);
    expect(entry.featureParts).toContain("aqua eyes");
    expect(entry.featureParts).not.toContain("1girl");
    expect(entry.outfitParts).toEqual(["detached sleeves"]);
    expect(entry.allTagParts).toContain("1girl");
  });

  it("official tags 为空时用性别/发色/瞳色兜底", () => {
    const entry = buildCharacterEntry(marisa, official);
    expect(entry.allTagParts).toEqual(["1girl", "blonde hair", "yellow eyes"]);
  });

  it("没有 official 数据时触发词回退 name, copyright", () => {
    const stranger: AnimaCharacter = { name: "ol-chan (oouso)", copyright: "original", postCount: 1 };
    const entry = buildCharacterEntry(stranger, official);
    expect(entry.triggerParts).toEqual(["ol-chan (oouso)", "original"]);
  });
});

describe("角色细节模式", () => {
  const entry = buildCharacterEntry(miku, official);
  const rng = () => createRng(5);

  it("trigger：只输出触发词", () => {
    expect(characterEntryParts(entry, { detail: "trigger", keepFeatures: true, tagCount: 3 }, rng())).toEqual([
      "hatsune miku",
      "vocaloid",
    ]);
  });

  it("trigger_tags：触发词 + 全部 tag（含性别词）", () => {
    const parts = characterEntryParts(entry, { detail: "trigger_tags", keepFeatures: true, tagCount: 3 }, rng());
    expect(parts).toContain("hatsune miku");
    expect(parts).toContain("1girl");
    expect(parts).toContain("detached sleeves");
  });

  it("trigger_random_tags + tagCount=0：只有触发词与特征词，没有服装词", () => {
    const parts = characterEntryParts(
      entry,
      { detail: "trigger_random_tags", keepFeatures: true, tagCount: 0 },
      rng(),
    );
    expect(parts.some((part) => part.endsWith("eyes"))).toBe(true);
    expect(parts).not.toContain("detached sleeves");
  });

  it("keepFeatures=false：不出现任何 eyes/hair 特征词", () => {
    const parts = characterEntryParts(
      entry,
      { detail: "trigger_random_tags", keepFeatures: false, tagCount: 5 },
      rng(),
    );
    expect(parts.some((part) => /(?:eye|hair)/i.test(part))).toBe(false);
    expect(parts).toContain("detached sleeves");
  });

  it("tagCount 超过服装词数量时全量返回", () => {
    const parts = characterEntryParts(
      entry,
      { detail: "trigger_random_tags", keepFeatures: false, tagCount: 99 },
      rng(),
    );
    expect(parts).toContain("detached sleeves");
  });

  it("冲突瞳色只留一个", () => {
    const parts = characterEntryParts(
      entry,
      { detail: "trigger_random_tags", keepFeatures: true, tagCount: 0 },
      rng(),
    );
    expect(parts.filter((part) => part.endsWith("eyes"))).toHaveLength(1);
  });
});

describe("主流程", () => {
  it("全部关闭时输出空串", () => {
    const result = composeAnimaPrompt(
      data,
      options({ enable: { artist: false, character: false, clothing: false, background: false, pose: false } }),
    );
    expect(result.text).toBe("");
    expect(result.parts).toEqual([]);
  });

  it("同一种子输出完全一致", () => {
    const opts = options({ seed: 2026 });
    expect(composeAnimaPrompt(data, opts).text).toBe(composeAnimaPrompt(data, opts).text);
  });

  it("不同种子输出不同", () => {
    const a = composeAnimaPrompt(data, options({ seed: 1, artistCount: 3 }));
    const b = composeAnimaPrompt(data, options({ seed: 2, artistCount: 3 }));
    expect(a.text).not.toBe(b.text);
  });

  it("画师数量超过总数时返回全量且不重复", () => {
    const result = composeAnimaPrompt(data, only("artist", { seed: 3, artistCount: 99 }));
    expect(result.sections.artist).toHaveLength(data.artists.length);
    expect(new Set(result.sections.artist).size).toBe(data.artists.length);
  });

  it("固定角色种子时主种子变化不影响角色", () => {
    const a = composeAnimaPrompt(data, only("character", { seed: 1, characterSeed: 77, characterDetail: "trigger_tags" }));
    const b = composeAnimaPrompt(data, only("character", { seed: 2, characterSeed: 77, characterDetail: "trigger_tags" }));
    expect(a.sections.character).toEqual(b.sections.character);
  });

  it("输出顺序固定：画师 → 角色 → 服装 → 背景 → 姿势", () => {
    const result = composeAnimaPrompt(
      data,
      options({ seed: 10, artistCount: 1, clothingSource: "author", characterDetail: "trigger" }),
    );
    const positions = ["artist", "character", "clothing", "background", "pose"].map((section) => {
      const first = result.sections[section as keyof typeof result.sections][0];
      return first ? result.text.indexOf(first) : -1;
    });
    const present = positions.filter((position) => position >= 0);
    expect(present).toEqual([...present].sort((a, b) => a - b));
  });

  it("跨分区去重只保留第一次出现的词", () => {
    const custom: GachaData = {
      ...data,
      clothing: [costume("c9", "Shared", "shared, gown")],
      poses: [costume("p9", "Shared Pose", "shared")],
    };
    const result = composeAnimaPrompt(custom, only("clothing", { seed: 4 }));
    expect(result.text.split("shared").length - 1).toBe(1);
    // pose 关闭时不会走到；单独打开两区再验证
    const both = composeAnimaPrompt(
      custom,
      options({
        seed: 4,
        enable: { artist: false, character: false, clothing: true, background: false, pose: true },
      }),
    );
    expect(both.text.split("shared").length - 1).toBe(1);
    expect(both.sections.pose).not.toContain("shared");
  });

  it("抽卡结果填入拼接台后文本完全一致", () => {
    const result = composeAnimaPrompt(data, options({ seed: 8, artistCount: 2, characterDetail: "trigger_tags" }));
    const values = {
      quality: "",
      artist: result.sections.artist.join(", "),
      character: result.sections.character.join(", "),
      clothing: result.sections.clothing.join(", "),
      background: result.sections.background.join(", "),
      pose: result.sections.pose.join(", "),
      extra: "",
    };
    expect(buildComposerPreview(values)).toBe(result.text);
  });

  it("seed=-1 返回本次实际种子，且用该值可重放", () => {
    const live = composeAnimaPrompt(data, options({ seed: -1 }));
    const replay = composeAnimaPrompt(data, options({ seed: live.usedSeed }));
    expect(replay.text).toBe(live.text);
  });
});

describe("服装来源", () => {
  it("author 使用服装库 tag", () => {
    const entries = resolveClothing(data, "author", createRng(1));
    expect(entries.length).toBe(1);
    expect(entries[0].parts.join(", ")).toMatch(/evening gown|sailor uniform/);
  });

  it("danbooru 一定叠一件装饰，主服装三选一", () => {
    const entries = resolveClothing(data, "danbooru", createRng(2));
    const parts = entries.flatMap((entry) => entry.parts);
    expect(parts).toContain("ribbon");
    expect(parts.some((part) => ["shirt", "skirt", "sailor uniform", "kimono"].includes(part))).toBe(true);
  });

  it("danbooru 池缺失时回退服装库", () => {
    const broken: GachaData = {
      ...data,
      danbooruAttire: { ...data.danbooruAttire, top: [] },
    };
    const entries = resolveClothing(broken, "danbooru", createRng(3));
    expect(entries[0].parts.join(", ")).toMatch(/evening gown|sailor uniform/);
  });

  it("character_tags 只保留词汇表内的服装词，且至少 2 个", () => {
    const single: GachaData = {
      ...data,
      characters: [reimu],
      clothing: [],
    };
    const entries = characterTagOutfit(single, createRng(4));
    expect(entries.length).toBe(1);
    expect(entries[0].parts.sort()).toEqual(["detached sleeves", "red bow"]);
  });

  it("character_tags 词汇表为空时不做过滤", () => {
    const noVocab: GachaData = {
      ...data,
      characters: [reimu],
      danbooruAttire: { ...data.danbooruAttire, vocabulary: [] },
    };
    const entries = characterTagOutfit(noVocab, createRng(4));
    expect(entries[0].parts.length).toBeGreaterThanOrEqual(2);
  });

  it("random 只会落到三个合法来源且结果非空", () => {
    for (let seed = 0; seed < 10; seed += 1) {
      const entries = resolveClothing(data, "random", createRng(seed));
      expect(entries.length).toBeGreaterThan(0);
    }
  });
});
