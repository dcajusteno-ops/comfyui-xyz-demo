import { beforeAll, describe, expect, it } from "vitest";
import { charactersData, outfitItem, pickDuoPartner, roleShort } from "./characters";
import { duoJoin, duoOutfitText } from "./duo";
import { roleWorkIndex } from "./characters";
import { WardrobeRandom } from "./rng";
import { primeWardrobeData } from "./testData";

beforeAll(() => primeWardrobeData());

describe("V6：双女补位", () => {
  it("roleShort 只取逗号前裸名", () => {
    expect(roleShort("texas, arknights")).toBe("texas");
  });

  it("同作品优先，且排除已选与本人", () => {
    const base = "texas, arknights";
    const [partner, mode] = pickDuoPartner(new WardrobeRandom(42), 99, base, [base]);
    expect(mode).toBe("same_work");
    expect(partner.toLowerCase()).not.toBe(base);
    expect(roleWorkIndex().get(partner.toLowerCase())).toBe(roleWorkIndex().get(base));
  });

  it("同 seed 同结果；exclude 生效", () => {
    const a = pickDuoPartner(new WardrobeRandom(7), 99, "texas, arknights", ["texas, arknights"]);
    const b = pickDuoPartner(new WardrobeRandom(7), 99, "texas, arknights", ["texas, arknights"]);
    expect(a).toEqual(b);
    expect(a[0].toLowerCase()).not.toBe("texas, arknights");
  });

  it("works 收窄后只在池内选（含同作品）", () => {
    const works = ["arknights"];
    const [partner] = pickDuoPartner(new WardrobeRandom(3), 99, "texas, arknights", ["texas, arknights"], false, works);
    expect(roleWorkIndex().get(partner.toLowerCase())).toBe("arknights");
  });

  it("不在角色库的作者名 → unknown_work，但仍补一位", () => {
    const [partner, mode] = pickDuoPartner(new WardrobeRandom(1), 99, "my original oc", []);
    expect(partner).not.toBe("");
    expect(mode).toBe("unknown_work");
  });

  it("补位恰好消耗一次随机数（同 rng 后续取值可复现）", () => {
    const rng = new WardrobeRandom(99);
    pickDuoPartner(rng, 99, "texas, arknights", ["texas, arknights"]);
    const after = rng.random();
    const rng2 = new WardrobeRandom(99);
    pickDuoPartner(rng2, 99, "texas, arknights", ["texas, arknights"]);
    expect(rng2.random()).toBe(after);
  });
});

describe("V6：duo 整句", () => {
  it("duoJoin 的 need 门槛：默认 2 句、服装 need=1", () => {
    expect(duoJoin(["a"])).toBe("");
    expect(duoJoin(["a"], 1)).toBe("a.");
    expect(duoJoin(["a", "b"])).toBe("a. b.");
  });

  it("只有一位启用服装时也写整句（need=1）", () => {
    const triggers = charactersData().characters.map((row) => row.trigger);
    const withPreset = triggers.find((t) => outfitItem(t));
    const without = triggers.find((t) => !outfitItem(t));
    expect(withPreset).toBeTruthy();
    expect(without).toBeTruthy();
    const text = duoOutfitText([withPreset!, without!], 4);
    expect(text).toContain("wears");
    expect(text).not.toContain(",");
  });
});
