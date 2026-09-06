import { describe, expect, it } from "vitest";
import { lintPrompt } from "./promptLint";

describe("lintPrompt - 括号配平", () => {
  it("检测未闭合左括号", () => {
    const issues = lintPrompt("(1girl");
    expect(issues.some((i) => i.code === "unbalanced_open")).toBe(true);
  });

  it("检测多余右括号", () => {
    const issues = lintPrompt("1girl)");
    expect(issues.some((i) => i.code === "unbalanced_close")).toBe(true);
  });

  it("配平时不报错", () => {
    const issues = lintPrompt("(1girl:1.2)");
    expect(issues.filter((i) => i.code.startsWith("unbalanced"))).toEqual([]);
  });
});

describe("lintPrompt - 权重语法", () => {
  it("空权重判定 error", () => {
    const issues = lintPrompt("(girl:)");
    expect(issues.some((i) => i.code === "empty_weight")).toBe(true);
  });

  it("非数字权重判定 error", () => {
    const issues = lintPrompt("(girl: abc)");
    expect(issues.some((i) => i.code === "bad_weight")).toBe(true);
  });

  it("复数权重不误判，双冒号取最后一个", () => {
    // (artist: ciloranko: 0.6) 是历史支持的形态，不应报 bad_weight
    const issues = lintPrompt("(artist: ciloranko: 0.6)");
    expect(issues.some((i) => i.code === "bad_weight")).toBe(false);
  });

  it("越界权重 warning", () => {
    const issues = lintPrompt("(girl:4)");
    expect(issues.some((i) => i.code === "weight_out_of_range")).toBe(true);
  });
});

describe("lintPrompt - 逗号与空片段", () => {
  it("全角逗号 warning 且可修复", () => {
    const issues = lintPrompt("1girl，long hair");
    const issue = issues.find((i) => i.code === "full_width_comma");
    expect(issue?.fixable).toBe(true);
    expect(issue?.fix?.("1girl，long hair")).toBe("1girl, long hair");
  });

  it("连续逗号 info 且可修复", () => {
    const issues = lintPrompt("a,, b");
    const issue = issues.find((i) => i.code === "empty_segments");
    expect(issue?.fixable).toBe(true);
    expect(issue?.fix?.("a,, b")).toBe("a, b");
  });
});

describe("lintPrompt - 重复与 token", () => {
  it("检测重复词条", () => {
    const issues = lintPrompt("1girl, 1girl, solo");
    expect(issues.some((i) => i.code === "duplicate_tokens")).toBe(true);
  });

  it("超长文本估算 token 超限", () => {
    const long = Array.from({ length: 260 }, (_, i) => `word${i}`).join(" ");
    const issues = lintPrompt(long);
    expect(issues.some((i) => i.code === "token_budget")).toBe(true);
  });
});

describe("lintPrompt - 上下文规则", () => {
  it("未传 LoRA 列表时规则关闭", () => {
    const issues = lintPrompt("<lora:unknown_model:1>");
    expect(issues.some((i) => i.code === "unknown_lora")).toBe(false);
  });

  it("传入 LoRA 列表时命中未知引用", () => {
    const issues = lintPrompt("<lora:unknown_model:1>", { loraNames: ["known_model"] });
    expect(issues.some((i) => i.code === "unknown_lora")).toBe(true);
  });

  it("已知 LoRA 不误报（含路径与扩展名归一化）", () => {
    const issues = lintPrompt("<lora:sub/dir/known_model:0.8>", { loraNames: ["known_model.safetensors"] });
    expect(issues.some((i) => i.code === "unknown_lora")).toBe(false);
  });

  it("未知通配符依赖上下文", () => {
    expect(lintPrompt("__nope__", { wildcardNames: ["styles"] }).some((i) => i.code === "unknown_wildcard")).toBe(true);
    expect(lintPrompt("__nope__").some((i) => i.code === "unknown_wildcard")).toBe(false);
  });
});