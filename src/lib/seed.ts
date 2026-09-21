export const MAX_SEED = 2 ** 53 - 1;

/**
 * 把 UI 上的 seed 参数解析成实际下发给 ComfyUI 的种子。
 * - `randomizeSeed` 为真或 seed 不是有限数 → 随机；
 * - 否则取非负整数。
 *
 * 单独成文件是为了让 workflowBuilders 与 detailerChain 共用，避免循环依赖。
 */
export function resolveSeed(seed: number, randomizeSeed = false): number {
  if (randomizeSeed || !Number.isFinite(seed)) {
    return Math.floor(Math.random() * MAX_SEED);
  }
  return Math.max(0, Math.floor(seed));
}
