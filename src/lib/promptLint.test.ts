import { describe, expect, it } from "vitest";
import { cleanupPromptSeparators, dedupePromptTags, lintPrompt } from "./promptLint";

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
  it("检测重复词条，并标记为可修复", () => {
    const issues = lintPrompt("1girl, 1girl, solo");
    const dup = issues.find((i) => i.code === "duplicate_tokens");
    expect(dup).toBeTruthy();
    expect(dup?.fixable).toBe(true);
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

describe("dedupePromptTags - 重复词条清理", () => {
  it("保留首次出现，删除后续重复", () => {
    expect(dedupePromptTags("1girl, 1girl, solo")).toBe("1girl, solo");
  });

  it("多处重复一并清理，且不残留连续逗号", () => {
    expect(dedupePromptTags("a, b, a, c, b, a")).toBe("a, b, c");
  });

  it("删除相邻的多个重复词条后，连续逗号被完全清理（回归：一次只吃两个逗号会残留）", () => {
    expect(dedupePromptTags("a, b, c, b, c, d, e")).toBe("a, b, c, d, e");
    expect(dedupePromptTags("a, b, b, c, c, c, d")).toBe("a, b, c, d");
  });

  it("大小写不敏感，保留首次出现的原始写法", () => {
    expect(dedupePromptTags("1Girl, 1girl, SOLO, solo")).toBe("1Girl, SOLO");
  });

  it("保留有效权重最大的那次出现（避免丢掉强化）", () => {
    expect(dedupePromptTags("text, (text:1.4), solo")).toBe("(text:1.4), solo");
    expect(dedupePromptTags("(text:1.4), text, solo")).toBe("(text:1.4), solo");
  });

  it("括号组内只有它自己时，连同括号整体移除", () => {
    expect(dedupePromptTags("(text:1.4), text")).toBe("(text:1.4)");
  });

  it("组内词条是幸存者时，删除组外的重复项", () => {
    // 组内的 a 有效权重 1.1 > 组外裸 a 的 1.0 → 保留组内的
    expect(dedupePromptTags("(a, b), a")).toBe("(a, b)");
  });

  it("多成员括号组内的重复不自动删（避免破坏组语义）", () => {
    const text = "(a, b), (a, c)";
    expect(dedupePromptTags(text)).toBe(text);
  });

  it("无重复时原样返回", () => {
    expect(dedupePromptTags("1girl, solo, long hair")).toBe("1girl, solo, long hair");
  });

  it("保留多行格式，只清理被挖空处的逗号", () => {
    const text = "1girl, solo, 1girl,\nlong hair, solo";
    expect(dedupePromptTags(text)).toBe("1girl, solo,\nlong hair");
  });

  it("动态提示词组（{a|b}）按整块参与去重", () => {
    expect(dedupePromptTags("{face|face, detailed face}, {face|face, detailed face}, solo")).toBe(
      "{face|face, detailed face}, solo",
    );
  });
});

describe("cleanupPromptSeparators", () => {
  it("任意数量的连续逗号都压成一个", () => {
    expect(cleanupPromptSeparators("a, , b")).toBe("a, b");
    expect(cleanupPromptSeparators("a, , , b")).toBe("a, b");
    expect(cleanupPromptSeparators("a,, ,, b")).toBe("a, b");
  });

  it("去掉整体首尾的多余逗号（含全角）", () => {
    expect(cleanupPromptSeparators(", a, b, ")).toBe("a, b");
    expect(cleanupPromptSeparators("，a, b，")).toBe("a, b");
  });

  it("无问题时原样返回", () => {
    expect(cleanupPromptSeparators("a, b, c")).toBe("a, b, c");
  });
});