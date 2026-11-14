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
import { emptyWeights } from "./weights";

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
      works: ["w", "w"],
    });
    expect(favorites.characters).toEqual(["a", "b"]);
    expect(favorites.scenes).toEqual(["s1"]);
    expect(favorites.works).toEqual(["w"]);
    expect(defaultFavorites()).toEqual({ version: 1, characters: [], scenes: [], works: [] });
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

  it("V6：干爽过滤 / 双女补位 / 勾选池随预设存与恢复", () => {
    const state = defaultWardrobeState();
    state.drySkin = { enabled: true, groups: ["skin"], onlyTags: "wet skin,sweat" };
    state.duoRoleFill = false;
    state.pickPool = { enabled: true, mode: "near", ids: ["a", "b"] };
    state.rolePick = false;
    state.baseProb = 0.45;
    state.roleWorks = ["vocaloid"];

    const preset = capturePreset(state, "V6 全量");
    expect(preset.drySkin?.onlyTags).toBe("wet skin,sweat");
    expect(presetSummary(preset)).toContain("干爽过滤");
    expect(presetSummary(preset)).toContain("勾选池 2 条");

    // 把面板改回默认，再套用 → 所有开关要回到预设那一刻
    const next = applyPresetToState(defaultWardrobeState(), preset);
    expect(next.drySkin).toEqual({ enabled: true, groups: ["skin"], onlyTags: "wet skin,sweat" });
    expect(next.duoRoleFill).toBe(false);
    expect(next.pickPool).toEqual({ enabled: true, mode: "near", ids: ["a", "b"] });
    expect(next.rolePick).toBe(false);
    expect(next.baseProb).toBe(0.45);
    expect(next.roleWorks).toEqual(["vocaloid"]);
  });

  it("V6：老预设（没有新键）套用时不动面板现值", () => {
    const legacy = {
      id: "old",
      name: "V5 老预设",
      createdAt: 1,
      level: "sfw" as const,
      weights: emptyWeights(),
      locks: [] as string[],
      disabledSections: [] as string[],
      selectedRoles: [] as string[],
      outfitStyle: "随机",
      extraBody: "",
    };
    const before = defaultWardrobeState();
    before.drySkin = { enabled: true, groups: ["light"], onlyTags: "caustics" };
    before.duoRoleFill = false;
    const next = applyPresetToState(before, legacy);
    expect(next.drySkin).toEqual(before.drySkin);
    expect(next.duoRoleFill).toBe(false);
    expect(next.pickPool).toEqual(before.pickPool);
  });

  it("V6：预设 normalize 读回新字段，坏值回落", () => {
    const store = normalizePresets({
      version: 1,
      items: {
        p1: {
          id: "p1",
          name: "带 V6 键",
          createdAt: 2,
          level: "explicit",
          weights: { sections: {}, fields: {}, options: {} },
          locks: [],
          disabledSections: [],
          selectedRoles: [],
          outfitStyle: "随机",
          extraBody: "",
          duoRoleFill: false,
          baseProb: 0.35,
          drySkin: { enabled: true, groups: ["skin", "weird"], onlyTags: "all" },
          pickPool: { enabled: true, mode: "near", ids: ["x", "x", "y"] },
        },
        p2: {
          id: "p2",
          name: "坏池",
          createdAt: 3,
          level: "sfw",
          weights: { sections: {}, fields: {}, options: {} },
          locks: [],
          disabledSections: [],
          selectedRoles: [],
          outfitStyle: "随机",
          extraBody: "",
          pickPool: { enabled: true, mode: "nope", ids: [] },
        },
      },
    } as never);
    expect(store.items.p1.duoRoleFill).toBe(false);
    expect(store.items.p1.baseProb).toBe(0.35);
    expect(store.items.p1.drySkin).toEqual({ enabled: true, groups: ["skin"], onlyTags: "all" });
    expect(store.items.p1.pickPool).toEqual({ enabled: true, mode: "near", ids: ["x", "y"] });
    expect(store.items.p2.pickPool?.mode).toBe("");
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

describe("V6：新状态 normalize", () => {
  it("ui.view / sceneTab 白名单 + 旧 sceneGroup 保留", () => {
    const state = normalizeWardrobeState({
      ...defaultWardrobeState(),
      ui: { ...defaultWardrobeState().ui, view: "outfits" as const, sceneTab: "near" as const, sceneGroup: "sfw" },
    });
    expect(state.ui.view).toBe("outfits");
    expect(state.ui.sceneTab).toBe("near");
    expect(state.ui.sceneGroup).toBe("sfw");

    const bad = normalizeWardrobeState({
      ...defaultWardrobeState(),
      ui: { ...defaultWardrobeState().ui, view: "nope" as never, sceneTab: "nope" as never },
    });
    expect(bad.ui.view).toBe("chars");
    expect(bad.ui.sceneTab).toBe("pair");
  });

  it("干爽过滤：groups 空回落全组，onlyTags 只保留词表内 tag", () => {
    const state = normalizeWardrobeState({
      ...defaultWardrobeState(),
      drySkin: { enabled: true, groups: [], onlyTags: "rain, wet skin, 不存在的词" },
    });
    expect(state.drySkin.groups).toHaveLength(5);
    expect(state.drySkin.enabled).toBe(true);
    expect(state.drySkin.onlyTags).toBe("rain,wet skin");

    const none = normalizeWardrobeState({
      ...defaultWardrobeState(),
      drySkin: { enabled: false, groups: ["weather", "nope" as never], onlyTags: "none" },
    });
    expect(none.drySkin.groups).toEqual(["weather"]);
    expect(none.drySkin.onlyTags).toBe("none");
  });

  it("勾选池：mode 白名单、ids 去重、没 mode 就关闭", () => {
    const state = normalizeWardrobeState({
      ...defaultWardrobeState(),
      pickPool: { enabled: true, mode: "near", ids: ["a", "a", "b"] },
    });
    expect(state.pickPool).toEqual({ enabled: true, mode: "near", ids: ["a", "b"] });

    const noMode = normalizeWardrobeState({
      ...defaultWardrobeState(),
      pickPool: { enabled: true, mode: "" as const, ids: ["a"] },
    });
    expect(noMode.pickPool.enabled).toBe(false);
  });

  it("服装库：active 只做格式校验，袜鞋覆盖小写、场景覆盖布尔", () => {
    const state = normalizeWardrobeState({
      ...defaultWardrobeState(),
      outfitLibrary: {
        active: "OL_KNIT_PLEATED",
        overrides: { socks: "Barefoot", shoes: "" },
        sceneOverride: true,
      },
    });
    expect(state.outfitLibrary.active).toBe("ol_knit_pleated");
    expect(state.outfitLibrary.overrides.socks).toBe("barefoot");
    expect(state.outfitLibrary.sceneOverride).toBe(true);

    const bad = normalizeWardrobeState({
      ...defaultWardrobeState(),
      outfitLibrary: { active: "非法 id!", overrides: { socks: "", shoes: "" }, sceneOverride: false },
    });
    expect(bad.outfitLibrary.active).toBe("");
  });

  it("nearBase：坏数据整块丢弃，好数据保留权重与锁", () => {
    const bad = normalizeWardrobeState({
      ...defaultWardrobeState(),
      nearBase: { sceneId: "", weights: emptyWeights(), disabledSections: [], locks: [] },
    });
    expect(bad.nearBase).toBeUndefined();

    const good = normalizeWardrobeState({
      ...defaultWardrobeState(),
      nearBase: {
        sceneId: "sc_near_x",
        weights: emptyWeights(),
        disabledSections: ["body", "nope" as never],
        locks: ["role", "nope" as never],
      },
    });
    expect(good.nearBase?.sceneId).toBe("sc_near_x");
    expect(good.nearBase?.disabledSections).toEqual(["body"]);
    expect(good.nearBase?.locks).toEqual(["role"]);
  });
});
