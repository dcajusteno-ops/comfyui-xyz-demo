import { beforeAll, describe, expect, it } from "vitest";
import {
  canonLevel,
  eligibleOptions,
  fieldValueNum,
  optionLevel,
  sectionAllowed,
  sectionById,
  sectionEligible,
  sectionFloorLevel,
  sectionMaxLevel,
  tagLevel,
} from "./levels";
import { rolePool } from "./characters";
import { primeWardrobeData, readLocalFixture } from "./testData";

beforeAll(() => primeWardrobeData());

describe("optionLevel：与插件全量对拍", () => {
  it("1128 个选项的档位全部一致", () => {
    const expected = readLocalFixture<Record<string, number>>("option-levels.json");
    const bad: string[] = [];
    for (const [key, level] of Object.entries(expected)) {
      const [field, en] = key.split("||");
      const actual = optionLevel(field, en);
      if (actual !== level) bad.push(`${key}: ${actual} != ${level}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
    expect(bad.length).toBe(0);
  });

  it("回归：fishnet bodystocking 被 LEVEL_RAISE 抬到 2（不是 1）", () => {
    expect(optionLevel("socks", "fishnet bodystocking")).toBe(2);
  });

  it("回归：wet hair 在 hair_fx 字段是 0（不被 see_through 模式误伤）", () => {
    expect(optionLevel("hair_fx", "wet hair")).toBe(0);
  });

  it("文本字段的 optionLevel 仍会套段下限（所以 fieldValueNum 必须分流）", () => {
    expect(optionLevel("n_extra", "afternoon light, quiet")).toBe(2);
  });
});

describe("tagLevel：成品层档位与插件一致", () => {
  it("1167 个标签（含覆盖项）全部一致", () => {
    const expected = readLocalFixture<Record<string, number>>("tag-levels.json");
    const bad: string[] = [];
    for (const [tag, level] of Object.entries(expected)) {
      const actual = tagLevel(tag);
      if (actual !== level) bad.push(`${tag}: ${actual} != ${level}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
    expect(bad.length).toBe(0);
  });

  it("LEVEL_DEMOTE 白名单：wet hair 在成品层仍是 0", () => {
    expect(tagLevel("wet hair")).toBe(0);
  });

  it("LEVEL_RAISE 折算：组合标签里的中性姿势词不被拖着上抬", () => {
    expect(optionLevel("n_pos", "against wall, sex")).toBe(3);
    expect(tagLevel("sex")).toBe(3);
    expect(tagLevel("against wall")).toBe(0);
  });
});

describe("段闸门", () => {
  const sections = [
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
  ];

  it("sectionAllowed 与 section_floor 一致（15 段 × 5 档）", () => {
    for (const section of sections) {
      for (let lv = 0; lv <= 4; lv += 1) {
        expect(sectionAllowed(section, lv)).toBe(sectionFloorLevel(section) <= lv);
      }
    }
    expect(sectionFloorLevel("special_nsfw")).toBe(3);
    expect(sectionMaxLevel("count")).toBe(4);
  });

  it("面板参与判定用逐选项可用性：canon 含 L0 场景，clothes_nsfw 没有", () => {
    const canon = sectionById("canon")!;
    const cloth = sectionById("cloth_nsfw")!;
    expect(sectionAllowed("canon", 0)).toBe(false); // floor=2，但这不是面板口径
    expect(sectionEligible(canon, 0)).toBe(true);
    expect(sectionEligible(cloth, 0)).toBe(false);
    expect(sectionEligible(cloth, 2)).toBe(true);
  });
});

describe("canonLevel / 场景档位", () => {
  it("场景库自带 level 优先于法典表", () => {
    expect(canonLevel("sc_rain_street_lookback")).toBe(0);
    expect(canonLevel("c1")).toBe(2);
    expect(canonLevel("nope")).toBe(0);
  });

  it("n_extra 不套 canon 段的 floor(2)", () => {
    expect(fieldValueNum("n_extra", "afternoon light, quiet")).toBe(0);
    expect(fieldValueNum("nl", "1girl standing")).toBe(0);
  });
});

describe("eligibleOptions", () => {
  it("档位升高时候选池单调不减", () => {
    const fields = ["hair_color", "pose_risque", "n_pos", "n_canon", "role", "place"];
    for (const field of fields) {
      let previous = new Set<string>();
      for (let lv = 0; lv <= 4; lv += 1) {
        const current = new Set(eligibleOptions(field, lv).map(([, en]) => en));
        for (const en of previous) expect(current.has(en)).toBe(true);
        previous = current;
      }
      expect(previous.size).toBeGreaterThan(0);
    }
  });

  it("L0 的 n_canon 只留 SFW 场景，不留法典 NSFW 组", () => {
    const options = eligibleOptions("n_canon", 0);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every(([, , level]) => level <= 0)).toBe(true);
    expect(options.some(([, en]) => en.startsWith("sc_"))).toBe(true);
    expect(options.some(([, en]) => en === "c1")).toBe(false);
  });

  it("角色池按档位收敛", () => {
    expect(rolePool(0).length).toBeGreaterThan(0);
    expect(rolePool(4).length).toBeGreaterThanOrEqual(rolePool(0).length);
    expect(eligibleOptions("role", 0).length).toBe(rolePool(0).length);
  });
});
