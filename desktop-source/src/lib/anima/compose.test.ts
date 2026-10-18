import { describe, expect, it } from "vitest";
import {
  appendTokensToSlot,
  buildComposerPreview,
  composerTokens,
  toApplyText,
} from "./compose";
import { emptyComposerValues } from "./persist";

describe("分区拼接台", () => {
  it("按 quality → artist → character → clothing → background → pose → extra 输出", () => {
    const values = {
      ...emptyComposerValues(),
      extra: "depth of field",
      pose: "standing",
      background: "beach",
      clothing: "gown",
      character: "miku",
      artist: "dairi",
      quality: "masterpiece",
    };
    expect(buildComposerPreview(values)).toBe(
      "masterpiece, @dairi, miku, gown, beach, standing, depth of field",
    );
  });

  it("画师自动补 @、去掉 by 前缀", () => {
    const values = { ...emptyComposerValues(), artist: "dairi, by wlop, @ask" };
    expect(composerTokens(values).artist).toEqual(["@dairi", "@wlop", "@ask"]);
  });

  it("中文逗号与换行也能切分", () => {
    const values = { ...emptyComposerValues(), clothing: "礼服，长裙\n高跟鞋" };
    expect(composerTokens(values).clothing).toEqual(["礼服", "长裙", "高跟鞋"]);
  });

  it("去重开关关闭时保留跨区重复词", () => {
    const values = { ...emptyComposerValues(), quality: "blue eyes", character: "Blue Eyes" };
    expect(buildComposerPreview(values)).toBe("blue eyes, Blue Eyes");
  });

  it("去重开关打开时忽略大小写只留第一次", () => {
    const values = { ...emptyComposerValues(), quality: "blue eyes", character: "Blue Eyes" };
    expect(buildComposerPreview(values, { dedupe: true })).toBe("blue eyes");
  });

  it("空输入返回空串，不产生孤零零的逗号", () => {
    expect(buildComposerPreview(emptyComposerValues())).toBe("");
  });

  it("写入前去掉尾逗号与空白", () => {
    expect(toApplyText("a, b,  ")).toBe("a, b");
    expect(toApplyText("a，b，")).toBe("a，b");
  });

  it("加入分区时去重，不反复堆同一个词", () => {
    expect(appendTokensToSlot("a, b", ["B", "c"])).toBe("a, b, c");
    expect(appendTokensToSlot("", ["x", "x"])).toBe("x");
  });
});
