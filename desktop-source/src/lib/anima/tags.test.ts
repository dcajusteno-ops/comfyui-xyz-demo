import { describe, expect, it } from "vitest";
import {
  artistToken,
  characterColourGroup,
  characterKey,
  collapseFeatureColours,
  dedupeTokens,
  isCharacterFeatureTag,
  isGenderTag,
  normalizeTokenKey,
  splitCharacterTags,
  splitPromptTokens,
  splitSectionTokens,
} from "./tags";
import { createRng } from "./prng";

describe("Anima 分词", () => {
  it("按逗号切分、去 _raw_ 前缀与空白", () => {
    expect(splitPromptTokens(" a, _raw_:b ,, c ")).toEqual(["a", "b", "c"]);
  });

  it("换行也视为分隔（插件输入框是多行的）", () => {
    expect(splitPromptTokens("a\nb\r\nc")).toEqual(["a", "b", "c"]);
  });

  it("拼接台额外承认中文逗号", () => {
    expect(splitSectionTokens("画师甲，画师乙\n画师丙, 画师丁")).toEqual(["画师甲", "画师乙", "画师丙", "画师丁"]);
  });

  it("去重按小写比较并保留第一次的原样", () => {
    expect(dedupeTokens(["Blue Eyes", "blue eyes", "Red Hair", "red hair "])).toEqual([
      "Blue Eyes",
      "Red Hair",
    ]);
  });

  it("归一化键把下划线当空格并折叠空白", () => {
    expect(normalizeTokenKey("  Long_Hair  ")).toBe("long hair");
  });
});

describe("画师 token", () => {
  it("补 @ 并去掉已有的 @ / by 前缀", () => {
    expect(artistToken("dairi")).toBe("@dairi");
    expect(artistToken("@dairi")).toBe("@dairi");
    expect(artistToken("by dairi")).toBe("@dairi");
    expect(artistToken("By  dairi ")).toBe("@dairi");
  });

  it("空串返回空串", () => {
    expect(artistToken("  ")).toBe("");
  });
});

describe("角色识别", () => {
  it("official key 归一化后能命中", () => {
    expect(characterKey("Hatsune Miku", "Vocaloid")).toBe("hatsune miku||vocaloid");
    expect(characterKey("hatsune_miku", "")).toBe("hatsune miku||");
  });

  it("性别词识别不受大小写影响", () => {
    expect(isGenderTag("1Girl")).toBe(true);
    expect(isGenderTag("female")).toBe(true);
    expect(isGenderTag("long hair")).toBe(false);
  });

  it("发色/瞳色/发型词算身份特征", () => {
    for (const tag of ["blue eyes", "aqua hair", "very long hair", "twintails", "hair bow", "single braid"]) {
      expect(isCharacterFeatureTag(tag)).toBe(true);
    }
    expect(isCharacterFeatureTag("detached sleeves")).toBe(false);
  });

  it("拆分时剔除性别词，其余按特征/服装分组", () => {
    const { features, outfit } = splitCharacterTags([
      "1girl",
      "blue eyes",
      "very long hair",
      "twintails",
      "detached sleeves",
      "hair bow",
    ]);
    expect(features).toEqual(["blue eyes", "very long hair", "twintails", "hair bow"]);
    expect(outfit).toEqual(["detached sleeves"]);
  });
});

describe("冲突颜色折叠", () => {
  it("只有末词是 eye/eyes/hair 且含颜色词才归组", () => {
    expect(characterColourGroup("blue eyes")).toBe("eyes");
    expect(characterColourGroup("aqua hair")).toBe("hair");
    expect(characterColourGroup("hair bow")).toBeNull();
    expect(characterColourGroup("blue")).toBeNull();
    expect(characterColourGroup("long hair")).toBeNull();
  });

  it("每组只留一个，位置取首次出现处", () => {
    const collapsed = collapseFeatureColours([
      "grey eyes",
      "purple eyes",
      "long hair",
      "blue hair",
      "aqua hair",
      "twintails",
    ]);
    expect(collapsed).toEqual(["grey eyes", "long hair", "blue hair", "twintails"]);
  });

  it("固定随机源时选择可复现", () => {
    const input = ["grey eyes", "purple eyes", "blue hair", "red hair"];
    const a = collapseFeatureColours(input, createRng(9));
    const b = collapseFeatureColours(input, createRng(9));
    expect(a).toEqual(b);
    expect(a.filter((tag) => tag.endsWith("eyes"))).toHaveLength(1);
    expect(a.filter((tag) => tag.endsWith("hair"))).toHaveLength(1);
  });
});
