import { describe, expect, it } from "vitest";
import { describeWildcards, parseWildcardTxt } from "./wildcards";

describe("parseWildcardTxt", () => {
  it("忽略注释与空行、逐行去重", () => {
    const content = ["# 注释", "", "sunset", "dawn", "sunset", "  night  "].join("\n");
    expect(parseWildcardTxt(content)).toEqual(["sunset", "dawn", "night"]);
  });

  it("兼容 CRLF 换行", () => {
    expect(parseWildcardTxt("a\r\nb\r\n")).toEqual(["a", "b"]);
  });
});

describe("describeWildcards", () => {
  it("返回名字/数量/预览", () => {
    const summary = describeWildcards({ styles: ["a", "b", "c"] });
    expect(summary).toEqual([{ name: "styles", count: 3, preview: ["a", "b", "c"] }]);
  });

  it("预览最多 8 条", () => {
    const entries = Array.from({ length: 12 }, (_, i) => `w${i}`);
    expect(describeWildcards({ big: entries })[0].preview).toHaveLength(8);
  });
});