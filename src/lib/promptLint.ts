import type { PromptLintIssue } from "../types";
import { parsePromptTags } from "./promptUtils";

export type PromptLintContext = {
  /** 已安装 LoRA 名（可为含目录 / 带扩展名的路径，内部做归一化比较） */
  loraNames?: string[];
  /** 可用通配符名集合 */
  wildcardNames?: string[];
};

const TOKEN_WARN_THRESHOLD = 220;

function normalizeModelName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? name;
  return base.replace(/\.(safetensors|pt|ckpt|bin)$/i, "").trim().toLowerCase();
}

function estimateTokens(text: string): number {
  const chunks = text.split(/[,，\n]+/).map((s) => s.trim()).filter(Boolean);
  let words = 0;
  for (const chunk of chunks) words += chunk.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.33);
}

/** 扫描文本中的顶层括号分组（不处理嵌套） */
function scanParenthesized(text: string): Array<{ start: number; end: number; inner: string }> {
  const groups: Array<{ start: number; end: number; inner: string }> = [];
  let open = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "(" && open === -1) {
      open = i;
    } else if (ch === ")" && open !== -1) {
      groups.push({ start: open, end: i, inner: text.slice(open + 1, i) });
      open = -1;
    }
  }
  return groups;
}

function weightFromGroup(inner: string): { word: string; weight: string } | null {
  const idx = inner.lastIndexOf(":");
  if (idx === -1) return null;
  return { word: inner.slice(0, idx).trim(), weight: inner.slice(idx + 1).trim() };
}

function isNumeric(value: string): boolean {
  return /^-?[0-9.]+$/.test(value.trim()) && value.trim() !== "" && value.trim() !== ".";
}

export function lintPrompt(text: string, ctx: PromptLintContext = {}): PromptLintIssue[] {
  const issues: PromptLintIssue[] = [];

  // 1. 括号配平
  let depth = 0;
  let unbalancedAt = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth < 0) {
        unbalancedAt = i;
        break;
      }
    }
  }
  if (unbalancedAt >= 0) {
    issues.push({
      code: "unbalanced_close",
      severity: "error",
      message: "存在多余的右括号（未匹配到左括号）",
      start: unbalancedAt,
      end: unbalancedAt + 1,
      fixable: false,
    });
  } else if (depth > 0) {
    issues.push({
      code: "unbalanced_open",
      severity: "error",
      message: `有 ${depth} 个左括号未闭合`,
      start: Math.max(0, text.lastIndexOf("(")),
      end: Math.min(text.length, Math.max(0, text.lastIndexOf("(")) + 1),
      fixable: false,
    });
  }

  // 2/3. 括号内的权重语法与越界
  for (const group of scanParenthesized(text)) {
    const wf = weightFromGroup(group.inner);
    if (!wf || !wf.word) continue;
    if (wf.weight === "") {
      issues.push({
        code: "empty_weight",
        severity: "error",
        message: `权重为空：(...: ) 需要权重数值`,
        start: group.start,
        end: group.end + 1,
        fixable: false,
      });
      continue;
    }
    if (!isNumeric(wf.weight)) {
      issues.push({
        code: "bad_weight",
        severity: "error",
        message: `权重不是合法数字：「${wf.weight}」`,
        start: group.start,
        end: group.end + 1,
        fixable: false,
      });
      continue;
    }
    const value = parseFloat(wf.weight);
    if (Math.abs(value) > 3) {
      issues.push({
        code: "weight_out_of_range",
        severity: "warning",
        message: `权重 ${value} 超出常见范围（|w|>3，疑似手滑）`,
        start: group.start,
        end: group.end + 1,
        fixable: false,
      });
    }
  }

  // 4. 全角逗号（可修复）
  const fullWidthIdx = text.indexOf("，");
  if (fullWidthIdx !== -1) {
    issues.push({
      code: "full_width_comma",
      severity: "warning",
      message: "检测到全角逗号，建议统一为半角",
      start: fullWidthIdx,
      end: fullWidthIdx + 1,
      fixable: true,
      fix: (t) => t.replace(/，/g, ", "),
    });
  }

  // 5. 连续逗号 / 空 token（可修复）
  const emptySegIdx = text.search(/,\s*,+|^\s*[,，]\s*|[,，]\s*$/);
  if (emptySegIdx !== -1) {
    issues.push({
      code: "empty_segments",
      severity: "info",
      message: "存在连续逗号或空片段",
      start: Math.max(0, emptySegIdx),
      end: Math.min(text.length, Math.max(0, emptySegIdx) + 1),
      fixable: true,
      fix: (t) =>
        t
          .replace(/,\s*,+/g, ",")
          .replace(/^\s*[,，]+\s*/, "")
          .replace(/[,，]+\s*$/, ""),
    });
  }

  // 6. 词条重复
  const words = parsePromptTags(text).map((tag) => tag.word.toLowerCase()).filter(Boolean);
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const word of words) {
    if (seen.has(word)) dups.add(word);
    seen.add(word);
  }
  if (dups.size > 0) {
    issues.push({
      code: "duplicate_tokens",
      severity: "info",
      message: `重复词条：${Array.from(dups).slice(0, 5).join("、")}${dups.size > 5 ? " 等" : ""}`,
      start: 0,
      end: 0,
      fixable: false,
    });
  }

  // 7. 未知 LoRA 引用（依赖上下文）
  if (ctx.loraNames && ctx.loraNames.length > 0) {
    const known = new Set(ctx.loraNames.map(normalizeModelName));
    const loraRe = /<lora:([^:>]+):[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = loraRe.exec(text)) !== null) {
      const name = m[1].trim();
      if (!known.has(normalizeModelName(name))) {
        issues.push({
          code: "unknown_lora",
          severity: "warning",
          message: `引用了未知 LoRA：${name}`,
          start: m.index,
          end: m.index + m[0].length,
          fixable: false,
        });
      }
    }
  }

  // 8. 未知通配符引用（依赖上下文）
  if (ctx.wildcardNames && ctx.wildcardNames.length > 0) {
    const known = new Set(ctx.wildcardNames);
    const wcRe = /__([A-Za-z0-9_\u4e00-\u9fa5-]+?)__/g;
    let m: RegExpExecArray | null;
    while ((m = wcRe.exec(text)) !== null) {
      if (!known.has(m[1])) {
        issues.push({
          code: "unknown_wildcard",
          severity: "warning",
          message: `引用了未知通配符：__${m[1]}__`,
          start: m.index,
          end: m.index + m[0].length,
          fixable: false,
        });
      }
    }
  }

  // 9. token 数估算
  const tokens = estimateTokens(text);
  if (tokens > TOKEN_WARN_THRESHOLD) {
    issues.push({
      code: "token_budget",
      severity: "info",
      message: `粗略估算约 ${tokens} tokens，超过 ${TOKEN_WARN_THRESHOLD}（建议精简或分批）`,
      start: 0,
      end: 0,
      fixable: false,
    });
  }

  return issues.sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 } as const;
    return order[a.severity] - order[b.severity];
  });
}