import { describe, expect, it } from "vitest";
import {
  buildSlotPool,
  drawFromPool,
  isCandidateRecord,
  normalizeCategory,
  rollSlots,
  type SlotConfig,
  type SlotRecord,
} from "./slotMachine";

const makeRecord = (overrides: Partial<SlotRecord>): SlotRecord => ({
  id: "id",
  source: "gwliang",
  category: "action",
  subcategory: "default",
  scope: "normal",
  text_en: "tag",
  text_zh: "词",
  ...overrides,
});

describe("slot machine library", () => {
  it("excludes r18 and negative_default scopes from candidates", () => {
    const records: SlotRecord[] = [
      makeRecord({ text_en: "safe", scope: "normal" }),
      makeRecord({ text_en: "mature", scope: "r18" }),
      makeRecord({ text_en: "negative", scope: "negative_default" }),
      makeRecord({ text_en: "unscoped" }),
    ];
    expect(records.filter(isCandidateRecord).map((r) => r.text_en)).toEqual(["safe", "unscoped"]);
  });

  it("matches categories case-insensitively", () => {
    const records: SlotRecord[] = [
      makeRecord({ category: "Style", text_en: "a" }),
      makeRecord({ category: "style", text_en: "b" }),
      makeRecord({ category: "人脸", text_en: "c" }),
    ];
    expect(buildSlotPool(records, ["style"]).map((r) => r.text_en).sort()).toEqual(["a", "b"]);
    expect(normalizeCategory("  Style ")).toBe("style");
  });

  it("filters out overly long entries (full prompts, not tags)", () => {
    const records: SlotRecord[] = [
      makeRecord({ text_en: "short tag" }),
      makeRecord({ text_en: "x".repeat(81) }),
      makeRecord({ text_en: "  master 权重 (1.5) ".concat("y".repeat(70)) }),
    ];
    expect(buildSlotPool(records, ["action"]).map((r) => r.text_en)).toEqual(["short tag"]);
  });

  it("draws up to count unique records and honors excludeKeys", () => {
    const pool: SlotRecord[] = [
      makeRecord({ text_en: "one" }),
      makeRecord({ text_en: "two" }),
      makeRecord({ text_en: "three" }),
    ];
    const drawn = drawFromPool(pool, 2);
    expect(drawn).toHaveLength(2);
    expect(new Set(drawn.map((r) => r.text_en)).size).toBe(2);

    const excluded = new Set(["one"]);
    const drawnWithExclude = drawFromPool(pool, 3, excluded);
    expect(drawnWithExclude.every((r) => r.text_en !== "one")).toBe(true);
    expect(drawnWithExclude).toHaveLength(2);
  });

  it("returns an empty draw when the pool is empty", () => {
    expect(drawFromPool([], 1)).toEqual([]);
  });

  it("only rolls enabled unlocked slots and de-dupes tags across slots", () => {
    const records: SlotRecord[] = [
      makeRecord({ category: "人物", text_en: "1girl" }),
      makeRecord({ category: "face", text_en: "smile" }),
      makeRecord({ category: "服饰", text_en: "dress" }),
      makeRecord({ category: "clothes", text_en: "dress" }),
      makeRecord({ category: "action", text_en: "dress" }), // 重复英文词，用于跨槽去重验证
    ];
    const configs: SlotConfig[] = [
      { id: "a", label: "角色", categories: ["人物", "face"], enabled: true, locked: false, count: 2 },
      { id: "b", label: "服饰", categories: ["服饰", "clothes"], enabled: true, locked: false, count: 1 },
      { id: "c", label: "锁定", categories: ["action"], enabled: true, locked: true, count: 1 },
      { id: "d", label: "禁用", categories: ["action"], enabled: false, locked: false, count: 1 },
    ];

    const { draws, totalTags } = rollSlots(configs, records);

    expect(draws).toHaveLength(2);
    expect(draws.map((d) => d.slotId)).toEqual(["a", "b"]);
    const allTags = totalTags.map((r) => r.text_en);
    expect(new Set(allTags).size).toBe(allTags.length); // dress 不会同时出现在两个槽
  });
});