import { beforeAll, describe, expect, it } from "vitest";
import {
  NEAR_VISIBLE,
  nearCountBag,
  nearPartOf,
  nearSlimFields,
  nearSlimProfile,
  slimWeightsForNear,
} from "./near";
import { sceneList } from "./scenes";
import { emptyWeights } from "./weights";
import { primeWardrobeData } from "./testData";

beforeAll(() => primeWardrobeData());

const nearScenes = () => sceneList().filter((scene) => scene.group === "near");

describe("V6：特写收紧取景", () => {
  it("60 条特写全部能算出精简档（部位取自 theme）", () => {
    const rows = nearScenes();
    expect(rows.length).toBe(60);
    for (const scene of rows) {
      expect(nearPartOf(scene)).toBeTruthy();
      expect(NEAR_VISIBLE[nearPartOf(scene)]).toBeTruthy();
      const profile = nearSlimProfile(scene);
      expect(profile, scene.id).not.toBeNull();
      expect(profile!.fields.length).toBeGreaterThan(0);
    }
  });

  it("面部特写留 ②③（只关 body / makeup），局部特写清角色", () => {
    const face = nearScenes().find((scene) => nearPartOf(scene) === "面部");
    expect(face).toBeTruthy();
    const profile = nearSlimProfile(face!)!;
    expect(profile.sections).toEqual(["body", "makeup"]);
    expect(profile.dropRole).toBe(false);

    const leg = nearScenes().find((scene) => nearPartOf(scene) === "腿部");
    expect(leg).toBeTruthy();
    expect(nearSlimProfile(leg!)!.dropRole).toBe(true);
  });

  it("role_ok 的条目走「·有脸」白名单且不清角色", () => {
    const scene = nearScenes().find((row) => row.role_ok);
    expect(scene).toBeTruthy();
    const profile = nearSlimProfile(scene!)!;
    expect(profile.roleOk).toBe(true);
    expect(profile.dropRole).toBe(false);
    const plain = nearSlimFields(scene!, "");
    expect(profile.fields.length).toBeLessThanOrEqual(plain.length);
  });

  it("人数袋默认钉死单人，条目自带 count_lock 就按它钉", () => {
    const bag = nearCountBag("");
    expect(bag["1girl, solo"]).toBe(3);
    expect(Object.entries(bag).filter(([, weight]) => weight > 0)).toHaveLength(1);
    const yuri = nearCountBag("2girls, yuri");
    expect(yuri["2girls, yuri"]).toBe(3);
    expect(yuri["1girl, solo"]).toBe(0);
  });

  it("slimWeightsForNear 不改入参（深拷贝三张子表）", () => {
    const scene = nearScenes().find((row) => nearPartOf(row) === "面部")!;
    const weights = emptyWeights();
    weights.sections.body = 2;
    weights.fields.hair_len = 3;
    weights.options.count = { "1girl, solo": 1 };
    const before = JSON.stringify(weights);
    const next = slimWeightsForNear(weights, scene);
    expect(JSON.stringify(weights)).toBe(before);
    expect(next).not.toBe(weights);
    expect(next.sections.body).toBe(0);
    expect(next.options.count["1girl, solo"]).toBe(3);
  });
});
