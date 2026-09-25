export type WildcardMap = Record<string, string[]>;

/**
 * 通配符注册表：由 wildcards.ts 在加载完成后注入模块级内存缓存。
 * workflowBuilders 同步读取；未加载完成前视为空（引用缺失走降级，保留原文）。
 */
let wildcardRegistry: WildcardMap = {};

export function setWildcardRegistry(map: WildcardMap): void {
  wildcardRegistry = map ?? {};
}

export function getWildcardRegistry(): WildcardMap {
  return wildcardRegistry;
}

/** mulberry32 确定性伪随机数生成器 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 风格字符串→32 位种子 */
export function hashSeed(input: string | number): number {
  const str = String(input);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickOne(options: string[], rng: () => number): string {
  const idx = Math.floor(rng() * options.length);
  return options[Math.min(idx, options.length - 1)] ?? "";
}

/** 展开 `{a|b|c}` 随机多选（不支持嵌套；`\{` / `\}` 为字面量转义） */
export function resolveChoices(text: string, rng: () => number): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length) {
      out += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === "{") {
      const close = text.indexOf("}", i + 1);
      if (close === -1) {
        out += ch;
        i += 1;
        continue;
      }
      const inner = text.slice(i + 1, close);
      const parts = inner.split("|");
      if (parts.length >= 2) {
        out += pickOne(parts, rng);
        i = close + 1;
        continue;
      }
      // 无 `|` 的花括号块：按字面量保留
      out += text.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** 展开 `__name__` 通配符引用；名字缺失时保留原文 */
export function resolveWildcards(text: string, rng: () => number): string {
  return text.replace(/__([A-Za-z0-9_\u4e00-\u9fa5-]+?)__/g, (match, name: string) => {
    const list = wildcardRegistry[name];
    if (!list || list.length === 0) return match;
    return pickOne(list, rng);
  });
}

/**
 * 完整展开：先 `{...}` 多选，再 `__name__` 通配符。
 * 以 seed 为随机种子 → 同 seed 同输入同词库必得同结果（可复现）。
 */
export function resolveDynamicPrompt(text: string, seed: string | number): string {
  if (!text) return text;
  const rng = mulberry32(hashSeed(seed));
  const afterChoices = resolveChoices(text, rng);
  return resolveWildcards(afterChoices, rng);
}

export type DynamicSyntaxInfo = { choices: number; wildcards: number };

/** 统计文本中的动态语法数量（用于输入框徽标） */
export function detectDynamicSyntax(text: string): DynamicSyntaxInfo {
  let choices = 0;
  let wildcards = 0;
  const choiceRe = /\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = choiceRe.exec(text)) !== null) {
    if (m[1].includes("|")) choices += 1;
  }
  const wcRe = /__([A-Za-z0-9_\u4e00-\u9fa5-]+?)__/g;
  while ((wcRe.exec(text)) !== null) wildcards += 1;
  return { choices, wildcards };
}