import { describe, expect, it } from "vitest";
import {
  DEFAULT_WHEEL_SECTORS,
  MAX_SECTORS,
  buildSectorPool,
  collectResultTags,
  createDefaultSectors,
  drawFromPool,
  drawTagForSector,
  joinResultTags,
  pickCandidateSectors,
  type SectorResult,
  type WheelSector,
} from "./luckyWheel";
import { isCandidateRecord, normalizeCategory, type PromptRecord } from "./promptLibrary";
import {
  CHECK_BADGE_UNITS,
  WHEEL_HUB_R,
  WHEEL_OUTER_R,
  measureLabelWidth,
  truncateLabel,
  wheelLabelLayout,
} from "./spinWheel";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const makeRecord = (overrides: Partial<PromptRecord>): PromptRecord => ({
  id: "id",
  source: "local",
  category: "action",
  subcategory: "default",
  scope: "normal",
  text_en: "tag",
  text_zh: "词",
  ...overrides,
});

const makeSector = (overrides: Partial<WheelSector>): WheelSector => ({
  id: "s1",
  label: "角色",
  categories: ["人物"],
  extraTags: [],
  enabled: true,
  ...overrides,
});

const result = (sectorId: string, textEn: string, locked = false): SectorResult => ({
  sectorId,
  tag: makeRecord({ text_en: textEn }),
  locked,
  at: 0,
});

describe("词库判据", () => {
  it("排除 r18 与 negative_default scope", () => {
    const records: PromptRecord[] = [
      makeRecord({ text_en: "safe", scope: "normal" }),
      makeRecord({ text_en: "mature", scope: "r18" }),
      makeRecord({ text_en: "negative", scope: "negative_default" }),
      makeRecord({ text_en: "unscoped" }),
    ];
    expect(records.filter(isCandidateRecord).map((r) => r.text_en)).toEqual(["safe", "unscoped"]);
  });

  it("分类匹配大小写不敏感", () => {
    expect(normalizeCategory("  Style ")).toBe("style");
    const records: PromptRecord[] = [
      makeRecord({ category: "Style", text_en: "a" }),
      makeRecord({ category: "style", text_en: "b" }),
    ];
    const pool = buildSectorPool(makeSector({ categories: ["style"] }), records);
    expect(pool.map((r) => r.text_en).sort()).toEqual(["a", "b"]);
  });

  it("剔除整句超长词条，保留正常短词", () => {
    const records: PromptRecord[] = [
      makeRecord({ text_en: "short tag" }),
      makeRecord({ text_en: "x".repeat(81) }),
    ];
    expect(buildSectorPool(makeSector({ categories: ["action"] }), records).map((r) => r.text_en)).toEqual([
      "short tag",
    ]);
  });

  it("剔除多词条整句（带逗号），只留单条词", () => {
    const records: PromptRecord[] = [
      makeRecord({ text_en: "single tag" }),
      makeRecord({ text_en: "looking at viewer,(from side:1.2),( head tilt:1.65)" }),
      makeRecord({ text_en: "prostrate, lie flat" }),
      makeRecord({ text_en: "全角，逗号" }),
    ];
    expect(records.filter(isCandidateRecord).map((r) => r.text_en)).toEqual(["single tag"]);
  });
});

describe("扇区词池", () => {
  it("合并词库命中与手填补充词，并按 text_en 去重", () => {
    const records: PromptRecord[] = [
      makeRecord({ category: "人物", text_en: "1girl" }),
      makeRecord({ category: "人物", text_en: "handsome man" }),
    ];
    const sector = makeSector({ categories: ["人物"], extraTags: ["my own tag", "1girl"] });
    expect(buildSectorPool(sector, records).map((r) => r.text_en)).toEqual([
      "my own tag",
      "1girl",
      "handsome man",
    ]);
  });

  it("分类未命中且无手填词时返回空池", () => {
    expect(buildSectorPool(makeSector({ categories: ["不存在"] }), [makeRecord({})])).toEqual([]);
    expect(buildSectorPool(makeSector({ categories: [] }), [makeRecord({})])).toEqual([]);
  });

  it("手填词同样受长度上限约束", () => {
    const pool = buildSectorPool(makeSector({ categories: [], extraTags: ["ok", "z".repeat(81)] }), []);
    expect(pool.map((r) => r.text_en)).toEqual(["ok"]);
  });
});

describe("抽词", () => {
  const pool: PromptRecord[] = [
    makeRecord({ text_en: "one" }),
    makeRecord({ text_en: "two" }),
    makeRecord({ text_en: "three" }),
  ];

  it("抽取不重复，且尊重 excludeKeys", () => {
    const random = mulberry32(1);
    const drawn = drawFromPool(pool, 2, new Set(), random);
    expect(drawn).toHaveLength(2);
    expect(new Set(drawn.map((r) => r.text_en)).size).toBe(2);

    const excluded = new Set(["one"]);
    const rest = drawFromPool(pool, 3, excluded, mulberry32(2));
    expect(rest.every((r) => r.text_en !== "one")).toBe(true);
    expect(rest).toHaveLength(2);
  });

  it("空池返回空数组", () => {
    expect(drawFromPool([], 1)).toEqual([]);
  });

  it("drawTagForSector 在固定种子下可复现，空池返回 null", () => {
    const sector = makeSector({ categories: ["action"] });
    const records: PromptRecord[] = [
      makeRecord({ category: "action", text_en: "a" }),
      makeRecord({ category: "action", text_en: "b" }),
    ];
    const first = drawTagForSector(sector, records, mulberry32(42));
    const second = drawTagForSector(sector, records, mulberry32(42));
    expect(first?.text_en).toBe(second?.text_en);
    expect(drawTagForSector(makeSector({ categories: ["none"] }), records)).toBeNull();
  });
});

describe("候选扇区筛选", () => {
  const records: PromptRecord[] = [
    makeRecord({ category: "人物", text_en: "1girl" }),
    makeRecord({ category: "服饰", text_en: "dress" }),
    makeRecord({ category: "动作", text_en: "running" }),
  ];
  const sectors: WheelSector[] = [
    makeSector({ id: "a", label: "角色", categories: ["人物"] }),
    makeSector({ id: "b", label: "服饰", categories: ["服饰"] }),
    makeSector({ id: "c", label: "动作", categories: ["动作"] }),
    makeSector({ id: "d", label: "停用", categories: ["人物"], enabled: false }),
    makeSector({ id: "e", label: "空池", categories: ["不存在"] }),
  ];

  it("排除停用扇区与空词池扇区", () => {
    const candidates = pickCandidateSectors(sectors, {}, records);
    expect(candidates.map((c) => c.sector.id)).toEqual(["a", "b", "c"]);
    expect(candidates.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it("已锁定结果被排除，已有结果的扇区仍可被普通转动命中", () => {
    const results: Record<string, SectorResult> = {
      a: result("a", "1girl", true),
      b: result("b", "dress"),
    };
    expect(pickCandidateSectors(sectors, results, records).map((c) => c.sector.id)).toEqual(["b", "c"]);
    expect(pickCandidateSectors(sectors, results, records, "empty").map((c) => c.sector.id)).toEqual(["c"]);
  });
});

describe("结果汇总", () => {
  const sectors: WheelSector[] = [
    makeSector({ id: "a", label: "角色", categories: ["人物"] }),
    makeSector({ id: "b", label: "服饰", categories: ["服饰"] }),
    makeSector({ id: "c", label: "动作", categories: ["动作"], enabled: false }),
  ];

  it("按扇区顺序汇总，忽略停用扇区", () => {
    const results: Record<string, SectorResult> = {
      b: result("b", "dress"),
      a: result("a", "1girl"),
      c: result("c", "running"),
    };
    expect(collectResultTags(results, sectors).map((r) => r.text_en)).toEqual(["1girl", "dress"]);
    expect(joinResultTags(results, sectors)).toBe("1girl, dress");
  });

  it("无结果时返回空串", () => {
    expect(joinResultTags({}, sectors)).toBe("");
  });
});

describe("默认扇区", () => {
  it("默认 10 个扇区、id 唯一、均在容量上限内", () => {
    expect(DEFAULT_WHEEL_SECTORS).toHaveLength(10);
    expect(new Set(DEFAULT_WHEEL_SECTORS.map((s) => s.id)).size).toBe(10);
    expect(DEFAULT_WHEEL_SECTORS.length).toBeLessThanOrEqual(MAX_SECTORS);
  });

  it("每个默认扇区都有名字、有分类、默认启用且不带手填词", () => {
    for (const sector of DEFAULT_WHEEL_SECTORS) {
      expect(sector.label.trim()).not.toBe("");
      expect(sector.categories.length).toBeGreaterThan(0);
      expect(sector.enabled).toBe(true);
      expect(sector.extraTags).toEqual([]);
    }
  });

  /**
   * 扇区名必须能在**默认扇区数**的盘面上完整显示（还要容得下「✓」徽标）；
   * 10 个扇区时可用宽度会缩到 5 个单位，名字超过 2 个汉字就会开始截断。
   */
  it("默认扇区名在默认扇区数下能完整显示（含 ✓ 徽标）", () => {
    const count = DEFAULT_WHEEL_SECTORS.length;
    const layout = wheelLabelLayout(0, count, WHEEL_HUB_R, WHEEL_OUTER_R);
    const budget = Math.max(2, layout.maxChars - CHECK_BADGE_UNITS);
    for (const sector of DEFAULT_WHEEL_SECTORS) {
      expect(truncateLabel(sector.label, budget), `扇区名「${sector.label}」会被截断`).toBe(sector.label);
      expect(measureLabelWidth(sector.label) + 1).toBeLessThanOrEqual(budget);
    }
  });

  it("createDefaultSectors 返回深拷贝，改动不影响常量", () => {
    const sectors = createDefaultSectors();
    sectors[0].label = "改过了";
    sectors[0].categories.push("新增");
    expect(DEFAULT_WHEEL_SECTORS[0].label).toBe("角色");
    expect(DEFAULT_WHEEL_SECTORS[0].categories).not.toContain("新增");
  });
});
