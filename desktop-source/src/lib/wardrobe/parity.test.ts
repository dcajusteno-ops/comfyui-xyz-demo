import { beforeAll, describe, expect, it } from "vitest";
import { draw } from "./draw";
import { primeWardrobeData, readLocalFixture } from "./testData";
import type { WardrobeDrawInput } from "./types";

beforeAll(() => primeWardrobeData());

type ParityCase = {
  id: string;
  input: Record<string, unknown>;
  expect: {
    text: string;
    tags: string[];
    state: Record<string, unknown>;
    dropped: string[];
    level_num: number;
  };
};

const cases = [
  ...readLocalFixture<{ cases: ParityCase[] }>("parity.json").cases,
  ...readLocalFixture<{ cases: ParityCase[] }>("parity-random.json").cases,
];

/** 夹具里是插件 draw() 的 snake_case 参数，这里转成前端 API 的 camelCase。 */
function toInput(raw: Record<string, unknown>): WardrobeDrawInput {
  return {
    level: raw.level as string,
    seed: raw.seed as number,
    baseProb: (raw.base_prob ?? raw.baseProb) as number | undefined,
    weights: raw.weights as WardrobeDrawInput["weights"],
    enabledSections: (raw.enabled_sections ?? raw.enabledSections) as string[] | undefined,
    locks: raw.locks as string[] | undefined,
    tagCap: (raw.tag_cap ?? raw.tagCap) as string | number | undefined,
    forced: raw.forced as Record<string, string> | undefined,
    forceRole: (raw.force_role ?? raw.forceRole) as string | undefined,
    extraBody: (raw.extra_body ?? raw.extraBody) as string | undefined,
    maxRetry: (raw.max_retry ?? raw.maxRetry) as number | undefined,
    appearanceFollow: (raw.appearance_follow ?? raw.appearanceFollow) as boolean | undefined,
    selectedRoles: (raw.selected_roles ?? raw.selectedRoles) as string[] | undefined,
    bigBreasts: (raw.big_breasts ?? raw.bigBreasts) as boolean | undefined,
    breastSize: (raw.breast_size ?? raw.breastSize) as string | undefined,
    roleWorks: (raw.role_works ?? raw.roleWorks) as string | undefined,
    outfitStyle: (raw.outfit_style ?? raw.outfitStyle) as string | undefined,
    roleFavOnly: (raw.role_fav_only ?? raw.roleFavOnly) as boolean | undefined,
    hairFollow: (raw.hair_follow ?? raw.hairFollow) as boolean | undefined,
    hairPicks: (raw.hair_picks ?? raw.hairPicks) as Record<string, string> | undefined,
    rolePick: (raw.role_pick ?? raw.rolePick) as boolean | undefined,
    scenePick: (raw.scene_pick ?? raw.scenePick) as boolean | undefined,
  };
}

describe("draw：与插件逐字对拍", () => {
  for (const item of cases) {
    it(item.id, () => {
      const result = draw(toInput(item.input));
      // text 是最直观的验收；先比它，失败时再看 state
      expect(result.text).toBe(item.expect.text);
      expect(result.tags).toEqual(item.expect.tags);
      expect(result.level_num).toBe(item.expect.level_num);
      expect(result.dropped).toEqual(item.expect.dropped);
      expect(result.state).toEqual(item.expect.state);
    });
  }
});
