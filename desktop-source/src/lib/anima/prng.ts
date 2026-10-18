/**
 * 确定性随机源。
 *
 * 为什么不用 Math.random：抽卡需要「同一个种子 → 同一套词」，否则锁定种子和
 * 「再抽一次」的对照就失去意义。mulberry32 足够快、实现稳定，且常数固定，
 * 跨会话/跨机器结果一致。
 *
 * 注意：与 ComfyUI 插件的 Python random 流**不互通**。同一个数字在本工具与
 * 插件节点里会得到不同结果，UI 上必须说明这一点。
 */

export type Rng = () => number;

export function createRng(seed: number): Rng {
  let state = (Number.isFinite(seed) ? Math.trunc(seed) : 0) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 31 位非负种子：与插件 seed 的 [0, 2^31-1] 习惯一致，且不会溢出 JS 安全整数 */
export function randomSeed(): number {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    const buf = new Uint32Array(1);
    cryptoObj.getRandomValues(buf);
    return buf[0] & 0x7fffffff;
  }
  return Math.floor(Math.random() * 0x7fffffff);
}

export function randomInt(rng: Rng, maxExclusive: number): number {
  const max = Math.max(0, Math.trunc(maxExclusive));
  if (max <= 0) return 0;
  return Math.floor(rng() * max);
}

export function pickOne<T>(rng: Rng, items: readonly T[]): T | undefined {
  if (!items.length) return undefined;
  return items[randomInt(rng, items.length)];
}

export function shuffleInPlace<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * 对应插件的 `_pick_items`：抽 `count` 个不重复项。
 * 关键细节：`count >= len` 时返回**打乱后的全量**，而不是原序前 len 个。
 */
export function sampleItems<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const n = Math.max(0, Math.trunc(count));
  if (n <= 0 || !items.length) return [];
  if (n >= items.length) return shuffleInPlace(rng, items.slice());
  // 部分 Fisher-Yates：只洗前 n 个，避免对 4 万条做全量洗牌
  const pool = items.slice();
  for (let i = 0; i < n; i += 1) {
    const j = i + randomInt(rng, pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/**
 * 对应插件的 `_sample_parts`：从一段 tag 里随机抽 `count` 个。
 * 与 sampleItems 的区别：`count >= len` 时返回**原序全量**（插件沿用去重后的顺序）。
 */
export function sampleParts<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const n = Math.max(0, Math.trunc(count));
  if (n <= 0 || !items.length) return [];
  if (n >= items.length) return items.slice();
  const pool = items.slice();
  for (let i = 0; i < n; i += 1) {
    const j = i + randomInt(rng, pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}
