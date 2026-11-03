import { beforeAll, describe, expect, it } from "vitest";
import {
  applyHairStyle,
  applySelectedRoles,
  appearanceFor,
  charFeatFor,
  hairStyleFor,
  headcountTags,
  pickRandomRoles,
  roleNeedsWork,
  roleOptions,
  rolePool,
  stripRoleWorks,
} from "./characters";
import { WardrobeRandom } from "./rng";
import { primeWardrobeData, readLocalFixture } from "./testData";

beforeAll(() => primeWardrobeData());

type Fixture = {
  rolePoolCounts: Record<string, number>;
  rolePoolHead: Record<string, Array<[string, string, number]>>;
  pickRoles: Array<{ seed: number; lv: number; n: number; works?: string[]; roles: string[] }>;
  headcount: Array<[number, number, string, string]>;
  selected: Array<{ input: Record<string, unknown>; triggers: string[]; lv: number; notes: string[]; state: Record<string, unknown> }>;
  hair: Array<{ trigger: string; style: Record<string, string>; appearance: Record<string, string> }>;
  hairApply: Array<{ picks: Record<string, string>; changed: string[]; state: Record<string, unknown> }>;
  feat: Array<{ tag: string; extras: string[]; drop: string[]; set: Record<string, string> }>;
};

const fixture = readLocalFixture<Fixture>("char-style-cases.json");

describe("角色池", () => {
  it("2423 个角色的档位全部一致", () => {
    const expected = readLocalFixture<Record<string, number>>("role-levels.json");
    const actual = new Map(roleOptions().map(([, trigger, level]) => [trigger, level]));
    const bad: Array<[string, number, number | undefined]> = [];
    for (const [trigger, level] of Object.entries(expected)) {
      if (actual.get(trigger) !== level) bad.push([trigger, level, actual.get(trigger)]);
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it("各档位角色数与插件一致", () => {
    for (const [lv, count] of Object.entries(fixture.rolePoolCounts)) {
      expect(rolePool(Number(lv)).length).toBe(count);
    }
  });

  it("池首顺序与插件一致（L0/L2/L4）", () => {
    for (const [lv, rows] of Object.entries(fixture.rolePoolHead)) {
      expect(rolePool(Number(lv)).slice(0, rows.length)).toEqual(rows);
    }
  });

  it("pickRandomRoles 与插件同 seed 同结果", () => {
    for (const item of fixture.pickRoles) {
      const rng = new WardrobeRandom(item.seed);
      expect(pickRandomRoles(rng, item.lv, item.n, item.works ?? [])).toEqual(item.roles);
    }
  });
});

describe("人数标签", () => {
  it("headcountTags 全表一致", () => {
    for (const [n, lv, current, expected] of fixture.headcount) {
      expect(headcountTags(n, lv, current)).toBe(expected);
    }
  });
});

describe("选中角色", () => {
  it("写入 state / 人数联动 / 多人清场与插件一致", () => {
    for (const item of fixture.selected) {
      const state = structuredClone(item.input);
      const notes = applySelectedRoles(state, item.triggers, item.lv);
      expect(state).toEqual(item.state);
      expect(notes).toEqual(item.notes);
    }
  });
});

describe("发型与外貌", () => {
  it("hairStyleFor / appearanceFor 与插件一致", () => {
    for (const item of fixture.hair) {
      expect(hairStyleFor(item.trigger)).toEqual(item.style);
      expect(appearanceFor(item.trigger)).toEqual(item.appearance);
    }
  });

  it("applyHairStyle 与插件一致", () => {
    for (const item of fixture.hairApply) {
      const state = structuredClone(item.state);
      const changed = applyHairStyle(state, { sections: {}, fields: {}, options: {} }, item.picks);
      expect(changed).toEqual(item.changed);
      expect(state).toEqual(item.state);
    }
  });
});

describe("角色固定特征", () => {
  it("charFeatFor 与插件同 seed 同结果", () => {
    for (const item of fixture.feat) {
      expect(charFeatFor(item.tag, 42)).toEqual([item.extras, item.drop, item.set]);
    }
  });
});

describe("角色名去作品名", () => {
  it("非重名角色在正文里只留名字", () => {
    expect(roleNeedsWork("hatsune miku, vocaloid")).toBe(false);
    expect(stripRoleWorks(["hatsune miku", "vocaloid", "smile"], { _role_triggers: ["hatsune miku, vocaloid"] })).toEqual([
      "hatsune miku",
      "smile",
    ]);
  });
});
