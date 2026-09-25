import type React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  adjustWeightForTag,
  handlePromptWeightAdjustment,
  parsePromptTags,
  type PromptTag,
} from "./promptUtils";

const words = (tags: PromptTag[]) => tags.map((tag) => tag.word);
const weights = (tags: PromptTag[]) => tags.map((tag) => tag.weight);

describe("parsePromptTags 边界用例（任务书 §3.7）", () => {
  it("1. 逗号分隔的裸词各自成块", () => {
    const text = "a, b";
    const tags = parsePromptTags(text);
    expect(words(tags)).toEqual(["a", "b"]);
    expect(weights(tags)).toEqual([1, 1]);
    expect(adjustWeightForTag(text, tags[0], 0.1)).toBe("(a:1.1), b");
  });

  it("2. 裸括号 (a) 有效权重为 1.1", () => {
    const text = "(a)";
    const tags = parsePromptTags(text);
    expect(words(tags)).toEqual(["a"]);
    expect(weights(tags)).toEqual([1.1]);
    expect(adjustWeightForTag(text, tags[0], 0.1)).toBe("(a:1.2)");
  });

  it("3. 显式权重 (a:1.2) 不额外乘 1.1", () => {
    const text = "(a:1.2)";
    const tags = parsePromptTags(text);
    expect(words(tags)).toEqual(["a"]);
    expect(weights(tags)).toEqual([1.2]);
    expect(adjustWeightForTag(text, tags[0], 0.1)).toBe("(a:1.3)");
  });

  it("4. 括号组拆成多个块，组内每词各乘 1.1；加权时展平重写", () => {
    const text = "(a, b, c)";
    const tags = parsePromptTags(text);
    expect(words(tags)).toEqual(["a", "b", "c"]);
    expect(weights(tags)).toEqual([1.1, 1.1, 1.1]);
    expect(adjustWeightForTag(text, tags[0], 0.1)).toBe("(a:1.2), (b:1.1), (c:1.1)");
  });

  it("5. 嵌套括号权重累乘，叶子归属最外层组", () => {
    const text = "(a, (b, c))";
    const tags = parsePromptTags(text);
    expect(words(tags)).toEqual(["a", "b", "c"]);
    expect(weights(tags)).toEqual([1.1, 1.21, 1.21]);
    expect(adjustWeightForTag(text, tags[1], 0.1)).toBe("(a:1.1), (b:1.31), (c:1.21)");
  });

  it("6. ((a)) 权重为 1.21", () => {
    const text = "((a))";
    const tags = parsePromptTags(text);
    expect(words(tags)).toEqual(["a"]);
    expect(weights(tags)).toEqual([1.21]);
    expect(adjustWeightForTag(text, tags[0], 0.1)).toBe("(a:1.31)");
  });

  it("7. {a|b, c} 是动态组：整块不可拆、不可加权", () => {
    const text = "{a|b, c}, d";
    const tags = parsePromptTags(text);
    expect(words(tags)).toEqual(["{a|b, c}", "d"]);
    expect(tags[0].dynamic).toBe(true);
    expect(tags[1].dynamic).toBe(false);
    expect(adjustWeightForTag(text, tags[0], 0.1)).toBe(text);
  });

  it("8. 组前后的裸词不受影响，重写保留原有空格", () => {
    const text = "x, (a, b), y";
    const tags = parsePromptTags(text);
    expect(words(tags)).toEqual(["x", "a", "b", "y"]);
    expect(weights(tags)).toEqual([1, 1.1, 1.1, 1]);
    expect(adjustWeightForTag(text, tags[1], 0.1)).toBe("x, (a:1.2), (b:1.1), y");
  });

  it("9. 括号不闭合属畸形输入：保留成块但不可加权", () => {
    const text = "(a, b";
    const tags = parsePromptTags(text);
    expect(words(tags)).toEqual(["(a, b"]);
    expect(tags[0].broken).toBe(true);
    expect(adjustWeightForTag(text, tags[0], 0.1)).toBe(text);
  });

  it("10. 转义逗号不参与切分", () => {
    const tags = parsePromptTags("a \\, b");
    expect(words(tags)).toEqual(["a \\, b"]);
  });

  it("11. 连续 10 次加权到 2.0，无浮点误差", () => {
    let text = "a";
    for (let i = 0; i < 10; i++) {
      text = adjustWeightForTag(text, parsePromptTags(text)[0], 0.1);
    }
    expect(text).toBe("(a:2)");
    expect(parsePromptTags(text)[0].weight).toBe(2);
  });
});

describe("parsePromptTags 实际场景", () => {
  it("整段括号包裹的质量前缀被拆成逐词块（用户上报的场景）", () => {
    const text = "(masterpiece, best quality, score_9, score_8), 1girl, long hair, blue eyes";
    const tags = parsePromptTags(text);
    expect(tags).toHaveLength(7);
    expect(words(tags)).toEqual([
      "masterpiece",
      "best quality",
      "score_9",
      "score_8",
      "1girl",
      "long hair",
      "blue eyes",
    ]);
    expect(weights(tags)).toEqual([1.1, 1.1, 1.1, 1.1, 1, 1, 1]);
    // 旧实现会写出 (..., score_8:1.1) 把权重落在最后一个词上
    expect(adjustWeightForTag(text, tags[0], 0.1)).toBe(
      "(masterpiece:1.2), (best quality:1.1), (score_9:1.1), (score_8:1.1), 1girl, long hair, blue eyes",
    );
  });

  it("Anima 的 detailer 追加词（含逗号的动态组）保持单块", () => {
    const text = "{face|face, detailed face}";
    const tags = parsePromptTags(text);
    expect(words(tags)).toEqual(["{face|face, detailed face}"]);
    expect(tags[0].dynamic).toBe(true);
    expect(adjustWeightForTag(text, tags[0], 0.1)).toBe(text);
  });

  it("多个括号组各自独立", () => {
    const text = "(a, b), (c, d)";
    const tags = parsePromptTags(text);
    expect(words(tags)).toEqual(["a", "b", "c", "d"]);
    expect(adjustWeightForTag(text, tags[2], 0.1)).toBe("(a, b), (c:1.2), (d:1.1)");
  });

  it("空值与纯空白解析为空数组", () => {
    expect(parsePromptTags("")).toEqual([]);
    expect(parsePromptTags("   ")).toEqual([]);
  });
});

describe("handlePromptWeightAdjustment（与按钮复用同一套解析）", () => {
  const makeEvent = (key: string, selectionStart: number, selectionEnd = selectionStart) => {
    const target = {
      selectionStart,
      selectionEnd,
      setSelectionRange: vi.fn(),
    };
    return {
      event: {
        ctrlKey: true,
        metaKey: false,
        key,
        preventDefault: vi.fn(),
        target,
      } as unknown as React.KeyboardEvent<HTMLTextAreaElement>,
      target,
    };
  };

  it("光标落在括号组内：调整该词并展平重写", () => {
    const text = "masterpiece, (best quality:1.2), 1girl";
    const onChange = vi.fn();
    const { event } = makeEvent("ArrowUp", 20); // 光标在 best quality 内
    handlePromptWeightAdjustment(event, text, onChange);
    expect(onChange).toHaveBeenCalledWith("masterpiece, (best quality:1.3), 1girl");
  });

  it("光标落在括号组内：整组展平为逐词权重", () => {
    const text = "(a, b), c";
    const onChange = vi.fn();
    const { event } = makeEvent("ArrowUp", 1); // 光标在 a 内
    handlePromptWeightAdjustment(event, text, onChange);
    expect(onChange).toHaveBeenCalledWith("(a:1.2), (b:1.1), c");
  });

  it("有选区时按选区加权（保持原有语义）", () => {
    const text = "masterpiece, (best quality:1.2), 1girl";
    const onChange = vi.fn();
    const { event } = makeEvent("ArrowUp", 33, 38); // 选中 1girl
    handlePromptWeightAdjustment(event, text, onChange);
    expect(onChange).toHaveBeenCalledWith("masterpiece, (best quality:1.2), (1girl:1.1)");
  });

  it("光标落在动态组内：不写坏语法，保持原样", () => {
    const text = "{a|b, c}, d";
    const onChange = vi.fn();
    const { event } = makeEvent("ArrowUp", 3);
    handlePromptWeightAdjustment(event, text, onChange);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("非 Ctrl/Cmd + ↑/↓ 不响应", () => {
    const onChange = vi.fn();
    const { event } = makeEvent("ArrowUp", 0);
    (event as { ctrlKey: boolean }).ctrlKey = false;
    handlePromptWeightAdjustment(event, "a", onChange);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("PromptTagBlocks 现有用例兼容性（任务书 §3.8）", () => {
  const VALUE = "masterpiece, (best quality:1.2), 1girl";

  it("块与权重解析不变", () => {
    const tags = parsePromptTags(VALUE);
    expect(words(tags)).toEqual(["masterpiece", "best quality", "1girl"]);
    expect(tags[1].weight).toBe(1.2);
  });

  it("点 + 权重增加 0.1", () => {
    const tags = parsePromptTags(VALUE);
    expect(adjustWeightForTag(VALUE, tags[1], 0.1)).toBe("masterpiece, (best quality:1.3), 1girl");
  });

  it("点 - 权重回落到 1.0 时去权重包装为裸词", () => {
    const text = "masterpiece, (best quality:1.1), 1girl";
    const tags = parsePromptTags(text);
    expect(adjustWeightForTag(text, tags[1], -0.1)).toBe("masterpiece, best quality, 1girl");
  });

  it("同一块内 +/- 不影响其他块", () => {
    const tags = parsePromptTags(VALUE);
    expect(adjustWeightForTag(VALUE, tags[0], 0.1)).toBe("(masterpiece:1.1), (best quality:1.2), 1girl");
  });
});
