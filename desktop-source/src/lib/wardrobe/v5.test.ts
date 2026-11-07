/**
 * V5 新增能力的定点回归（对拍夹具之外的语义断言）。
 *
 * 夹具只保证「同 seed 同结果」，不解释**为什么**；这里钉住 v5 的几条新口径，
 * 以后改代码时如果把它们改回去，会在这里立刻红。
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  countSatisfies,
  expandRoles,
  headcountTags,
  isYuriCount,
  outfitFor,
  roleOutputTag,
  roleOutputTags,
} from "./characters";
import { applyCountToyRule, draw } from "./draw";
import { applyOutfitOverlay } from "./outfits";
import { primeWardrobeData } from "./testData";
import { emptyWeights, enforceOptionMutex, forcedOptionPool, tunedWeightFields } from "./weights";
import type { WardrobeWeights } from "./types";

beforeAll(() => primeWardrobeData());

describe("V5：人数与双女关系档位", () => {
  it("L0 双人写中性的 2girls，L1 起才写 yuri", () => {
    expect(headcountTags(2, 0)).toBe("2girls");
    expect(headcountTags(2, 1)).toBe("2girls, yuri");
    expect(headcountTags(2, 4)).toBe("2girls, yuri");
  });

  it("isYuriCount / countSatisfies 三档口径", () => {
    expect(isYuriCount("2girls, yuri")).toBe(true);
    expect(isYuriCount("2girls, multiple girls")).toBe(false);
    expect(isYuriCount("2girls, 1boy, hetero")).toBe(false);
    expect(countSatisfies("1girl, solo", "2girls, yuri")).toBe(false);
    expect(countSatisfies("2girls, yuri", "2girls, yuri")).toBe(true);
    expect(countSatisfies("1girl, multiple boys, group sex", "1girl, multiple boys, group sex")).toBe(true);
  });
});

describe("V5：正文角色 tag（Anima 官方写法）", () => {
  it("角色与作品是两个独立 tag、零下划线", () => {
    expect(roleOutputTag("texas, arknights")).toBe("texas, arknights");
    expect(roleOutputTag("texas, arknights")).not.toContain("_");
    const tags = roleOutputTags({
      _role_triggers: ["hu tao, genshin impact", "ganyu, genshin impact"],
    });
    expect(tags).toEqual(["hu tao, genshin impact", "ganyu, genshin impact"]);
  });

  it("改名别名表能把旧 tag 归一", () => {
    const roles = expandRoles(["user_motoha_arai"]);
    expect(roles.length).toBe(1);
    expect(roles[0]).toContain("arai");
  });
});

describe("V5：角色服装预设", () => {
  it("启用中的角色返回标签 + 闭麦服装字段", () => {
    const [extras, drops, sets] = outfitFor("ganyu, genshin impact", 2);
    expect(extras.length).toBeGreaterThan(0);
    expect(drops).toContain("outfit");
    expect(drops).toContain("top");
    expect(drops).toContain("bottom");
    expect(sets.outfit).toBe("serafuku");
    expect(sets.top).toBe("sailor shirt");
  });

  it("单角色抽取时服装预设真的进正文", () => {
    const result = draw({
      level: "explicit",
      seed: 7,
      weights: emptyWeights(),
      selectedRoles: ["ganyu, genshin impact"],
    });
    expect(result.text).toContain("serafuku");
    expect(result.text).toContain("sailor shirt");
  });

  it("ui-state 覆盖层能启用一套并生效", () => {
    const list = [{ id: "test_set", zh: "测试套", level: 0, tags: ["red dress"], fields: {} }];
    try {
      applyOutfitOverlay({ version: 1, roles: { tifa_lockhart: { enabled: "test_set", list } } });
      const [extras] = outfitFor("tifa lockhart, final fantasy", 1);
      expect(extras).toContain("red dress");
    } finally {
      applyOutfitOverlay({ version: 1, roles: {} });
    }
  });

  it("没启用的角色 → 空三元组（零影响）", () => {
    const [extras, drops, sets] = outfitFor("tifa lockhart, final fantasy", 2);
    expect(extras).toEqual([]);
    expect(drops).toEqual([]);
    expect(sets).toEqual({});
  });
});

describe("V5：权重互斥与被动字段", () => {
  it("同字段两个 3.0 → 只留最后一个，其余降到 1.0", () => {
    const weights: WardrobeWeights = {
      sections: {},
      fields: {},
      options: { emotion: { "embarrassed, blush": 3, smile: 3 } },
    };
    const notes = enforceOptionMutex(weights);
    expect(notes.length).toBe(1);
    expect(weights.options.emotion["embarrassed, blush"]).toBe(1);
    expect(weights.options.emotion.smile).toBe(3);

    const pool = [
      ["尴尬", "embarrassed, blush"],
      ["微笑", "smile"],
    ];
    expect(forcedOptionPool(pool, "emotion", weights).map((x) => x[1])).toEqual(["smile"]);
  });

  it("中间值字段进入必抽集合，0 不进入", () => {
    const tuned = tunedWeightFields({
      sections: {},
      fields: {},
      options: { prop: { chair: 2 }, weather: { rain: 0 } },
    });
    expect(tuned.has("prop")).toBe(true);
    expect(tuned.has("weather")).toBe(false);
  });
});

describe("V5：场景开关与不指定角色", () => {
  it("scenePick=false 一条场景都不出，true 必出", () => {
    const off = draw({ level: "explicit", seed: 42, weights: emptyWeights(), scenePick: false });
    expect(off.state.n_canon ?? "").toBe("");
    const on = draw({ level: "explicit", seed: 42, weights: emptyWeights(), scenePick: true });
    expect(String(on.state.n_canon ?? "")).not.toBe("");
  });

  it("面板显式套用的场景在 scenePick=false 时仍然生效", () => {
    const result = draw({
      level: "explicit",
      seed: 42,
      weights: {
        sections: {},
        fields: { n_canon: 3 },
        options: { n_canon: { sc_rain_street_lookback: 3 } },
      },
      scenePick: false,
    });
    expect(result.state.n_canon).toBe("sc_rain_street_lookback");
  });

  it("rolePick=false 时手填角色也不生效", () => {
    const result = draw({
      level: "suggestive",
      seed: 42,
      weights: emptyWeights(),
      rolePick: false,
      forceRole: "hatsune miku, vocaloid",
    });
    expect(result.state.role ?? "").toBe("");
    expect(result.text).not.toContain("hatsune miku");
    expect(result.notes.join(" ")).toContain("不指定角色");
  });
});

describe("V5：穿戴式道具 ↔ 人数", () => {
  it("双女 + 正戏 → 补 strap-on", () => {
    const state: Record<string, unknown> = { count: "2girls, yuri", n_act: "missionary", n_theme: "" };
    const notes = applyCountToyRule(state, 4, emptyWeights());
    expect(state.n_theme).toBe("strap-on");
    expect(notes.length).toBe(1);
  });

  it("一男一女 → 清掉玩具类", () => {
    const state: Record<string, unknown> = { count: "1girl, 1boy, hetero", n_theme: "dildo" };
    applyCountToyRule(state, 4, emptyWeights());
    expect(state.n_theme).toBe("");
  });

  it("单人 → 清掉穿戴式", () => {
    const state: Record<string, unknown> = { count: "1girl, solo", n_theme: "strap-on" };
    applyCountToyRule(state, 4, emptyWeights());
    expect(state.n_theme).toBe("");
  });
});
