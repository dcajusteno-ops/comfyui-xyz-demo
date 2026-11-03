import { describe, expect, it } from "vitest";
import {
  defaultFavorites,
  defaultPresets,
  defaultWardrobeState,
  normalizeFavorites,
  normalizePresets,
  normalizeWardrobeState,
} from "./persist";
import { applyPresetToState, capturePreset, presetSummary } from "./presets";
import { setFieldWeight, setOptionWeight, setSectionWeight, toggleLock, toggleSection, toggleSelectedRole } from "./state";
import { countTags, toApplyText } from "./text";

describe("造型台持久化", () => {
  it("默认值不预置段权重（避免 deepMerge 把未调过当成调过）", () => {
    expect(defaultWardrobeState().weights).toEqual({ sections: {}, fields: {}, options: {} });
  });

  it("normalize 收敛坏数据", () => {
    const base = defaultWardrobeState();
    const normalized = normalizeWardrobeState({
      ...base,
      level: "nope" as never,
      seed: Number.NaN,
      baseProb: 0,
      tagCap: "999",
      breastSize: "超大" as never,
      locks: ["hair_color", "not_a_field", "hair_color"],
      forced: { not_a_field: "x", role: "hatsune miku, vocaloid" },
      disabledSections: ["hair", "nope", "hair"],
      selectedRoles: ["a", "b", "a", "c", "d", "e", "f", "g", "h", "i", "j"],
      weights: { sections: { hair: 9 }, fields: { prop: -1 }, options: { emotion: { blush: 3 } } },
      lastResult: {
        text: "x".repeat(9000),
        levelNum: 2,
        cap: 29,
        seed: 42,
        tagCount: 1,
        drawn: [],
        dropped: [],
        repaired: [],
        notes: Array.from({ length: 30 }, (_, i) => `n${i}`),
        at: 1,
      },
    });
    expect(normalized.level).toBe("sfw");
    expect(normalized.seed).toBe(-1);
    expect(normalized.baseProb).toBe(0.65);
    expect(normalized.tagCap).toBe("自动");
    expect(normalized.breastSize).toBe("不指定");
    expect(normalized.locks).toEqual(["hair_color"]);
    expect(normalized.forced).toEqual({ role: "hatsune miku, vocaloid" });
    expect(normalized.disabledSections).toEqual(["hair"]);
    expect(normalized.selectedRoles).toHaveLength(8);
    expect(normalized.weights.sections.hair).toBe(3);
    expect(normalized.weights.fields.prop).toBe(0);
    expect(normalized.lastResult?.text).toHaveLength(8000);
    expect(normalized.lastResult?.notes).toHaveLength(20);
  });

  it("收藏去重并限长", () => {
    const favorites = normalizeFavorites({
      version: 1,
      characters: ["a", "a", "b"],
      scenes: ["s1", "s1"],
    });
    expect(favorites.characters).toEqual(["a", "b"]);
    expect(favorites.scenes).toEqual(["s1"]);
    expect(defaultFavorites()).toEqual({ version: 1, characters: [], scenes: [] });
  });

  it("预设坏数据被丢弃，合法项保留", () => {
    const presets = normalizePresets({
      version: 1,
      items: {
        ok: {
          id: "ok",
          name: "我的预设",
          createdAt: 1,
          level: "explicit",
          weights: { sections: {}, fields: {}, options: {} },
          locks: ["hair_color"],
          disabledSections: ["hair"],
          selectedRoles: ["hatsune miku, vocaloid"],
          outfitStyle: "哥特",
          extraBody: "",
        },
        bad: { id: "bad", name: "" },
      },
    } as never);
    expect(Object.keys(presets.items)).toEqual(["ok"]);
    expect(presets.items.ok.name).toBe("我的预设");
    expect(defaultPresets()).toEqual({ version: 1, items: {} });
  });

  it("预设捕获/套用覆盖指定字段", () => {
    const state = defaultWardrobeState();
    state.level = "explicit";
    state.locks = ["hair_color"];
    const preset = capturePreset(state, "测试");
    const next = applyPresetToState(defaultWardrobeState(), preset);
    expect(next.level).toBe("explicit");
    expect(next.locks).toEqual(["hair_color"]);
    expect(presetSummary(preset)).toContain("EXPLICIT");
  });
});

describe("状态更新辅助", () => {
  it("三层权重都是不可变更新", () => {
    const state = defaultWardrobeState();
    const a = setSectionWeight(state, "hair", 2);
    const b = setFieldWeight(a, "hair_color", 0);
    const c = setOptionWeight(b, "emotion", "Blush", 3);
    expect(state.weights.sections.hair).toBeUndefined();
    expect(a.weights.fields.hair_color).toBeUndefined();
    expect(c.weights.options.emotion).toEqual({ blush: 3 });
    expect(c.weights.sections.hair).toBe(2);
  });

  it("锁定 / 停用段 / 选角色", () => {
    let state = defaultWardrobeState();
    state = toggleLock(state, "hair_color");
    expect(state.locks).toEqual(["hair_color"]);
    state = toggleLock(state, "hair_color");
    expect(state.locks).toEqual([]);
    state = toggleSection(state, "hair");
    expect(state.disabledSections).toEqual(["hair"]);
    for (let i = 0; i < 10; i += 1) state = toggleSelectedRole(state, `role ${i}`);
    expect(state.selectedRoles).toHaveLength(8);
  });
});

describe("输出文本", () => {
  it("countTags 按逗号计非空标签", () => {
    expect(countTags("1girl, solo, , smile ")).toBe(3);
  });

  it("画质前缀只加一次", () => {
    expect(toApplyText("1girl, solo")).toBe("1girl, solo");
    const prefixed = toApplyText("1girl, solo", true);
    expect(prefixed).toContain("masterpiece");
    expect(prefixed).toContain("1girl, solo");
    expect(toApplyText(prefixed, true)).toBe(prefixed);
  });
});
