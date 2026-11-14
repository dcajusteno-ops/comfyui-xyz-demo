import { beforeAll, describe, expect, it } from "vitest";
import {
  charFeatFor,
  charactersData,
  customTagsExtra,
  featGoesBody,
  isCustomRole,
} from "./characters";
import { requireWardrobeData } from "./store";
import { primeWardrobeData } from "./testData";

beforeAll(() => primeWardrobeData());

function bodyFeatTriggers(): string[] {
  const feats = requireWardrobeData("charFeat").feats;
  const bodyTags = new Set(
    Object.entries(feats)
      .filter(([, rec]) => rec && (rec as { body?: boolean }).body === true)
      .map(([tag]) => tag.toLowerCase()),
  );
  const out: string[] = [];
  for (const row of charactersData().characters) {
    if (bodyTags.has(String(row.tag ?? "").toLowerCase())) out.push(row.trigger);
  }
  return out;
}

describe("V6：自定义角色兜底", () => {
  it("内置角色不会被误判成自定义；兜底通道返回空三元组", () => {
    const trigger = "tifa lockhart, final fantasy";
    expect(isCustomRole(trigger)).toBe(false);
    expect(customTagsExtra(trigger)).toEqual([[], [], {}]);
  });

  it("char_feat 里 body:true 的 16 条走 body 通道，其余走 tail", () => {
    const triggers = bodyFeatTriggers();
    expect(triggers.length).toBe(16);
    for (const trigger of triggers.slice(0, 5)) expect(featGoesBody(trigger)).toBe(true);
    expect(featGoesBody("tifa lockhart, final fantasy")).toBe(false);
  });

  it("body 角色仍能拿到 extras；未收录角色返回空", () => {
    const trigger = bodyFeatTriggers()[0];
    const [extras] = charFeatFor(trigger);
    expect(extras.length).toBeGreaterThan(0);
    expect(charFeatFor("definitely not a character")).toEqual([[], [], {}]);
  });
});
