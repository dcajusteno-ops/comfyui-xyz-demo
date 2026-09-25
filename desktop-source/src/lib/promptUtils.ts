import type React from "react";

const round2 = (value: number) => Math.round(value * 100) / 100;

/** 组内一个成员：权重重写时的最小单元 */
export interface PromptMember {
  word: string;
  /** 该成员的有效权重（已含所有外层括号的隐含乘数） */
  weight: number;
  /** 含 `{}` 动态语法 → 不可加权 */
  dynamic: boolean;
  /** 括号不配对等畸形输入 → 重写时原样输出、不可加权 */
  broken: boolean;
}

export interface PromptTag {
  /** 该叶子在原文中的片段（已 trim） */
  text: string;
  /** 展示用词：剥掉权重包装与纯分组括号，但保留 `{}` 动态语法 */
  word: string;
  /** 有效权重（含所有外层括号的隐含乘数） */
  weight: number;
  /** 是否含 `{}` 动态语法（UI 据此禁用加减按钮） */
  dynamic: boolean;
  /** 是否为畸形输入（UI 据此禁用加减按钮） */
  broken: boolean;
  /** 叶子在原文中的起止 */
  start: number;
  end: number;
  /** 权重重写时需要整体替换的区间 = 所在最外层括号组；不在组内时等于 [start, end) */
  groupStart: number;
  groupEnd: number;
  /** 重写该组时用到的全部成员（按出现顺序）。不在组内时长度为 1 */
  members: PromptMember[];
  /** 本叶子在 `members` 中的下标 */
  memberIndex: number;
}

type Segment = { text: string; start: number; end: number };

type LeafData = {
  word: string;
  weight: number;
  dynamic: boolean;
  broken: boolean;
  start: number;
  end: number;
};

type GroupCtx = { start: number; end: number; members: PromptMember[]; leafs: LeafData[] };

type Node =
  | { kind: "leaf"; text: string; start: number; end: number; dynamic: boolean; broken: boolean }
  | {
      kind: "group";
      start: number;
      end: number;
      /** 该层括号带来的乘数 */
      mult: number;
      contentStart: number;
      contentEnd: number;
    };

/**
 * 在 [from, to) 内按「顶层逗号」切分：只有 braceDepth 与 parenDepth 同时为 0 的逗号才切。
 *
 * 这样 `{a|b, c}` 与 `(a, b)` 内部的逗号都会被深度保护：
 * - `{...}` 是动态提示词的选项内容，整块不可拆；
 * - `(...)` 由调用方先剥掉外层括号再递归调用本函数，因此括号组能正确展开成多个 tag。
 *
 * 注意不要对 `(...)` 采用「单遍扫描 + 括号栈」写法：段 `c)` 的收尾逗号出现在 `)` 之后，
 * 此时栈已被弹出，会丢失组归属。
 */
function splitTop(text: string, from: number, to: number): Segment[] {
  const segments: Segment[] = [];
  let brace = 0;
  let paren = 0;
  let segStart = from;

  const cut = (end: number) => {
    const raw = text.slice(segStart, end);
    if (raw.trim()) segments.push({ text: raw, start: segStart, end });
    segStart = end + 1;
  };

  for (let i = from; i < to; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "{") brace++;
    else if (ch === "}") brace = Math.max(0, brace - 1);
    else if (ch === "(" && brace === 0) paren++;
    else if (ch === ")" && brace === 0) paren = Math.max(0, paren - 1);
    else if (ch === "," && brace === 0 && paren === 0) cut(i);
  }
  cut(to);

  return segments;
}

function buildNode(segment: Segment): Node {
  const raw = segment.text;
  const trimmed = raw.trim();
  const lead = raw.length - raw.trimStart().length;
  const absStart = segment.start + lead;
  const absEnd = absStart + trimmed.length;

  // `{...}` 动态组：整块原子。不要求内部含 `|`——`{a, b}` 在 resolveChoices 里也按字面量整体保留。
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return { kind: "leaf", text: trimmed, start: absStart, end: absEnd, dynamic: true, broken: false };
  }

  const open = raw.indexOf("(");
  const close = raw.lastIndexOf(")");
  const isParenWrapped = open >= 0 && close > open && trimmed.startsWith("(") && trimmed.endsWith(")");

  if (isParenWrapped) {
    // 关键：组范围必须指向 `(` 本身，不能用段起点——段可能带前导空格，
    // 否则重写时会丢掉 `x,` 与 `(` 之间的空格。
    const groupStart = segment.start + open;
    const groupEnd = segment.start + close + 1;
    const inner = raw.slice(open + 1, close);
    // `(X:1.2)`：显式权重绑定整个括号组（ComfyUI 的 parse_parentheses 也是把整组当一个单元）
    const explicit = inner.match(/^([\s\S]+?):\s*(-?[0-9.]+)\s*$/);
    if (explicit) {
      return {
        kind: "group",
        start: groupStart,
        end: groupEnd,
        mult: parseFloat(explicit[2]),
        contentStart: groupStart + 1,
        contentEnd: groupStart + 1 + explicit[1].length,
      };
    }
    // `(X)`：裸括号，隐含 ×1.1
    return {
      kind: "group",
      start: groupStart,
      end: groupEnd,
      mult: 1.1,
      contentStart: groupStart + 1,
      contentEnd: groupEnd - 1,
    };
  }

  // 括号不配对的畸形输入（如 `(a, b`）：保留成块但不可加权，避免把用户文本改坏
  const broken = /[()]/.test(trimmed);
  return { kind: "leaf", text: trimmed, start: absStart, end: absEnd, dynamic: false, broken };
}

function flatten(node: Node, text: string, mult: number, out: PromptTag[], outer: GroupCtx | null): void {
  if (node.kind === "leaf") {
    const weight = round2(mult);
    const leaf: LeafData = {
      word: node.text,
      weight,
      dynamic: node.dynamic,
      broken: node.broken,
      start: node.start,
      end: node.end,
    };
    if (outer) {
      outer.members.push({ word: leaf.word, weight, dynamic: leaf.dynamic, broken: leaf.broken });
      outer.leafs.push(leaf);
    } else {
      out.push({
        text: leaf.word,
        word: leaf.word,
        weight,
        dynamic: leaf.dynamic,
        broken: leaf.broken,
        start: leaf.start,
        end: leaf.end,
        groupStart: leaf.start,
        groupEnd: leaf.end,
        members: [{ word: leaf.word, weight, dynamic: leaf.dynamic, broken: leaf.broken }],
        memberIndex: 0,
      });
    }
    return;
  }

  const childMult = round2(mult * node.mult);
  const isOuterGroup = outer === null;
  const ctx: GroupCtx = outer ?? { start: node.start, end: node.end, members: [], leafs: [] };

  for (const segment of splitTop(text, node.contentStart, node.contentEnd)) {
    flatten(buildNode(segment), text, childMult, out, ctx);
  }

  // 只有最外层组才产出「可整体重写」的区间；嵌套组仅贡献乘数
  if (isOuterGroup) {
    ctx.leafs.forEach((leaf, index) => {
      out.push({
        text: leaf.word,
        word: leaf.word,
        weight: leaf.weight,
        dynamic: leaf.dynamic,
        broken: leaf.broken,
        start: leaf.start,
        end: leaf.end,
        groupStart: ctx.start,
        groupEnd: ctx.end,
        members: ctx.members,
        memberIndex: index,
      });
    });
  }
}

/**
 * 把提示词解析成可独立操作的标签块。
 *
 * 语法规约：
 * - `(...)` 内的逗号**是** tag 分隔符，括号给组内**每个词**乘 1.1（`(a, b, c)` = 三词各 ×1.1）；
 * - `{a|b, c}` 内的逗号**不是**分隔符（动态提示词的选项内容，整块不可拆）；
 * - `weight` 是**有效权重**，已含所有外层括号的乘数。
 */
export function parsePromptTags(text: string): PromptTag[] {
  const tags: PromptTag[] = [];
  for (const segment of splitTop(text, 0, text.length)) {
    flatten(buildNode(segment), text, 1, tags, null);
  }
  return tags;
}

/**
 * 调整某个标签块的权重。
 *
 * 当目标位于括号组内时，会把**整个组重写为逐词权重**（展平），例如
 * `(a, b, c)` 里点 `a` 的 `+` → `(a:1.2), (b:1.1), (c:1.1)`。
 * 这是必要的：组语法（`(a, b, c)`）只能给整组同一个权重，无法表达单成员不同权重。
 */
export function adjustWeightForTag(text: string, tag: PromptTag, delta: number): string {
  // 动态组与畸形输入不参与加权（UI 已拦截，这里再兜一层保证纯函数安全）
  if (tag.dynamic || tag.broken) return text;

  const nextWeight = round2(tag.weight + delta);
  const rendered = tag.members
    .map((member, index) => {
      if (member.dynamic || member.broken) return member.word;
      const weight = index === tag.memberIndex ? nextWeight : member.weight;
      if (weight === 1) return member.word;
      // 直接模板插值：Number→String 会去掉尾随 0（1.2 → "1.2"），不要用 toFixed(2)
      return `(${member.word}:${weight})`;
    })
    .join(", ");

  return text.slice(0, tag.groupStart) + rendered + text.slice(tag.groupEnd);
}

/**
 * Ctrl/Cmd + ↑/↓ 调权重的快捷键。
 *
 * 与「+ / −」按钮复用同一套解析：光标落在某个可加权的标签块内时走 adjustWeightForTag，
 * 因此两者行为完全一致；其余情况保持原有语义（选区加权 / 按 `,()` 边界扩词）。
 */
export function handlePromptWeightAdjustment(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  value: string,
  onChange: (val: string) => void
) {
  if (!((e.ctrlKey || e.metaKey) && (e.key === "ArrowUp" || e.key === "ArrowDown"))) return;
  e.preventDefault();

  const delta = e.key === "ArrowUp" ? 0.1 : -0.1;
  const target = e.target as HTMLTextAreaElement;
  let start = target.selectionStart;
  let end = target.selectionEnd;
  const text = value;

  // 1) 无选区且光标落在标签块内：与「+ / −」按钮完全一致的处理
  if (start === end) {
    const covering = parsePromptTags(text).find((tag) => start >= tag.start && start <= tag.end);
    if (covering) {
      // 动态组 / 畸形块不支持加权，保持文本不变而不是写出坏语法
      if (covering.dynamic || covering.broken) return;
      const next = adjustWeightForTag(text, covering, delta);
      if (next === text) return;
      onChange(next);
      const replaced = covering.groupEnd - covering.groupStart;
      const nextLength = next.length - (text.length - replaced);
      setTimeout(() => {
        target.setSelectionRange(covering.groupStart, covering.groupStart + nextLength);
      }, 0);
      return;
    }
  }

  // 2) 有选区 / 光标不在任何块内：按 `,()` 边界扩词后加权
  if (start === end) {
    const isSpaceOrBoundary = (char?: string) => !char || /[\s,()\n]/.test(char);
    if (isSpaceOrBoundary(text[start - 1]) && isSpaceOrBoundary(text[start])) {
      return;
    }
    while (start > 0 && !/[,()\n]/.test(text[start - 1])) start--;
    while (end < text.length && !/[,()\n]/.test(text[end])) end++;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start === end) return;
  }

  let selected = text.slice(start, end);
  if (selected.startsWith("(") && selected.endsWith(")")) {
    selected = selected.slice(1, -1);
  }

  const weight = round2(1 + delta);
  const newStr = weight === 1 ? selected : `(${selected}:${weight})`;
  const newText = text.slice(0, start) + newStr + text.slice(end);
  onChange(newText);

  setTimeout(() => {
    target.setSelectionRange(start, start + newStr.length);
  }, 0);
}
