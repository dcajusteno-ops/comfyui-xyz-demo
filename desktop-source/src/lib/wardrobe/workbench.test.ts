import { beforeAll, describe, expect, it } from "vitest";

import { COMPOSER_SLOT_ORDER, COMPOSER_SLOT_META } from "../anima/compose";
import type { AnimaComposerSlot } from "../anima/types";
import { primeWardrobeData, readLocalFixture } from "./testData";
import { splitWardrobeToWorkbench } from "./workbench";

beforeAll(() => primeWardrobeData());

type ParityCase = {
  id: string;
  input: Record<string, unknown>;
  expect: { text: string; tags: string[]; state: Record<string, unknown> };
};

describe("splitWardrobeToWorkbench：按抽取状态分桶", () => {
  it("字段槽位映射到工作台分区", () => {
    const split = splitWardrobeToWorkbench(
      {
        count: "1girl, solo",
        role: "hatsune miku, vocaloid",
        outfit: "evening gown",
        socks: "black pantyhose",
        pose_base: "standing",
        emotion: "smile",
        place: "beach",
        light_fx: "soft lighting",
        makeup: "lipstick",
        nl: "手写补充",
      },
      [],
    );
    expect(split.character).toEqual(["1girl", "solo", "hatsune miku", "vocaloid"]);
    expect(split.clothing).toEqual(["evening gown", "black pantyhose"]);
    expect(split.pose).toEqual(["standing", "smile"]);
    expect(split.background).toEqual(["beach"]);
    expect(split.extra).toEqual(["soft lighting", "lipstick", "手写补充"]);
    expect(split.quality).toBeUndefined();
    expect(split.artist).toBeUndefined();
  });

  it("内部键与不产出的字段不进桶", () => {
    const split = splitWardrobeToWorkbench(
      { count: "1girl, solo", _preset_fields: ["outfit"], n_canon: "sc_rain_street_lookback" },
      [],
    );
    expect(split.character).toEqual(["1girl", "solo"]);
    expect(Object.keys(split)).toEqual(["character"]);
  });

  it("state 覆盖不到的词走兜底：画质词 / 性别词 / 画师 / 其余", () => {
    const split = splitWardrobeToWorkbench(
      {},
      ["(masterpiece", "best quality", "newest)", "anime coloring", "1girl", "@wlop", "zzz unknown"],
    );
    expect(split.quality).toEqual(["(masterpiece", "best quality", "newest)", "anime coloring"]);
    expect(split.character).toEqual(["1girl"]);
    expect(split.artist).toEqual(["@wlop"]);
    expect(split.extra).toEqual(["zzz unknown"]);
  });

  it("不丢词、不重复：所有 tag 恰好落桶一次", () => {
    const cases = readLocalFixture<{ cases: ParityCase[] }>("parity.json").cases;
    let checked = 0;
    for (const item of cases) {
      const split = splitWardrobeToWorkbench(item.expect.state, item.expect.tags);
      const seen = new Map<string, number>();
      for (const slot of COMPOSER_SLOT_ORDER) {
        for (const token of split[slot] ?? []) {
          seen.set(token, (seen.get(token) ?? 0) + 1);
        }
      }
      // 每个 tag 恰好一次
      for (const tag of item.expect.tags) {
        expect(seen.get(tag) ?? 0, `${item.id}: ${tag}`).toBe(1);
      }
      // 桶里没有 tags 之外的词
      const tagSet = new Set(item.expect.tags);
      for (const [token, count] of seen) {
        expect(count, `${item.id}: 重复词 ${token}`).toBe(1);
        expect(tagSet.has(token), `${item.id}: 多余词 ${token}`).toBe(true);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("COMPOSER_SLOT_META 顺序守卫", () => {
  it("分区顺序固定为 Anima 官方：质量 → 画师 → 角色 → 服装 → 背景 → 姿势 → 额外", () => {
    expect(COMPOSER_SLOT_META.map((meta) => meta.key)).toEqual<AnimaComposerSlot[]>([
      "quality",
      "artist",
      "character",
      "clothing",
      "background",
      "pose",
      "extra",
    ]);
  });
});
