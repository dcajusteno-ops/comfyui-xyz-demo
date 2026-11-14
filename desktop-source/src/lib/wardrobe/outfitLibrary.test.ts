import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  applyLibraryOverlay,
  effectiveOutfit,
  libraryItems,
  libraryOutfit,
  tagClass,
} from "./outfitLibrary";
import { coveredByTags, outfitTriplet } from "./outfitTriplet";
import { charactersData, outfitItem } from "./characters";
import { primeWardrobeData } from "./testData";

beforeAll(() => primeWardrobeData());

const OFF = { active: "", overrides: { socks: "", shoes: "" }, sceneOverride: false };
afterEach(() => applyLibraryOverlay(OFF));

function itemAt(level: number) {
  const item = libraryItems().find((row) => (row.level ?? 0) === level);
  if (!item) throw new Error(`服装库里没有 level=${level} 的条目`);
  return item;
}

describe("V6：服装库三元组", () => {
  it("衣物字段被更具体的 tag 覆盖时只闭麦、不再 set", () => {
    const [extras, drops, sets] = outfitTriplet({
      id: "x",
      level: 0,
      tags: ["black skirt"],
      fields: { bottom: "skirt", cloth_color: "black" },
      drop: ["bottom"],
    });
    expect(extras).toEqual(["black skirt"]);
    expect(drops).toContain("bottom");
    expect(sets.bottom).toBeUndefined();
    // 调色板锚点不参与 covered_by_tags
    expect(sets.cloth_color).toBe("black");
    expect(coveredByTags("skirt", ["black skirt"])).toBe(true);
    expect(coveredByTags("shirt", ["t-shirt"])).toBe(false);
  });

  it("档位不够 → 空三元组（不许只盖袜鞋）", () => {
    const item = itemAt(3);
    applyLibraryOverlay({ ...OFF, active: item.id, overrides: { socks: "", shoes: "" } });
    const tri = libraryOutfit(2);
    expect(tri[0]).toEqual([]);
    expect(tri[1]).toEqual([]);
    const ok = libraryOutfit(4);
    expect(ok[0].length).toBeGreaterThan(0);
  });

  it("袜 / 鞋覆盖：剔同类标签、加闭麦、写死值；换鞋连带清 n_shoes_keep", () => {
    const item = itemAt(0);
    applyLibraryOverlay({ ...OFF, active: item.id, overrides: { socks: "barefoot", shoes: "barefoot" } });
    const [extras, drops, sets] = libraryOutfit(4);
    expect(tagClass("white thighhighs")).toBe("socks");
    expect(tagClass("pointed toe high heels")).toBe("shoes");
    expect(extras.every((tag) => tagClass(tag) === "")).toBe(true);
    expect(drops).toContain("socks");
    expect(drops).toContain("shoes");
    expect(drops).toContain("n_shoes_keep");
    expect(sets.socks).toBe("barefoot");
    expect(sets.shoes).toBe("barefoot");
  });
});

describe("V6：服装优先级", () => {
  it("角色预设优先于服装库", () => {
    const trigger = charactersData().characters.map((row) => row.trigger).find((t) => outfitItem(t));
    expect(trigger, "角色库里应有启用中的服装预设").toBeTruthy();
    const item = itemAt(0);
    applyLibraryOverlay({ ...OFF, active: item.id });
    const [extras] = effectiveOutfit(trigger!, 4, false);
    const [roleOnly] = effectiveOutfit(trigger!, 4, false);
    expect(extras).toEqual(roleOnly);
    expect(extras).not.toEqual(item.tags);
  });

  it("场景写了推荐服装且未开覆盖 → 服装库整套让路", () => {
    const item = itemAt(0);
    applyLibraryOverlay({ ...OFF, active: item.id });
    expect(effectiveOutfit("hatsune miku, vocaloid", 4, true)).toEqual([[], [], {}]);
    applyLibraryOverlay({ ...OFF, active: item.id, sceneOverride: true });
    expect(effectiveOutfit("hatsune miku, vocaloid", 4, true)[0].length).toBeGreaterThan(0);
  });

  it("服装库没启用 → 空三元组（随机路径零漂移）", () => {
    applyLibraryOverlay(OFF);
    expect(effectiveOutfit("hatsune miku, vocaloid", 4, false)).toEqual([[], [], {}]);
  });
});
