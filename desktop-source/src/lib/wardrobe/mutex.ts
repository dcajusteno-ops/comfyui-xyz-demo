/**
 * mutex_groups 的消解（源脚本 `applyMutex` 的逐条移植）。
 *
 * `keep` 是本轮由场景/预设**显式写入**的标签：优先级「显式 > 随机」。
 *  - B 侧只有随机标签 → 剔 B；
 *  - B 侧全是显式标签 → 反过来剔 A 侧的随机标签；
 *  - 两侧都含显式标签 → 谁也不动（真矛盾交给报告）。
 */
import { requireWardrobeData } from "./store";

type CompiledGroup = { id: string; a: RegExp; b: RegExp };

let compiled: CompiledGroup[] | null = null;

export function resetMutexCache(): void {
  compiled = null;
}

function groups(): CompiledGroup[] {
  if (compiled) return compiled;
  compiled = requireWardrobeData("pools").mutex_groups.map((group) => {
    const flags = group.a.flags?.includes("i") ? "i" : "";
    return {
      id: group.id,
      a: new RegExp(group.a.source, flags),
      b: new RegExp(group.b.source, flags),
    };
  });
  return compiled;
}

export function applyMutex(tags: readonly string[], keep: Iterable<string> = []): string[] {
  const keepSet = new Set(keep);
  let result = [...tags];
  for (const group of groups()) {
    const hasA = result.some((tag) => group.a.test(tag));
    const hasB = result.some((tag) => group.b.test(tag));
    if (!(hasA && hasB)) continue;
    const bHit = result.filter((tag) => group.b.test(tag));
    const aHit = result.filter((tag) => group.a.test(tag));
    const bKept = bHit.filter((tag) => keepSet.has(tag));
    const aKept = aHit.filter((tag) => keepSet.has(tag));
    if (bKept.length && !aKept.length) {
      result = result.filter((tag) => !(group.a.test(tag) && !keepSet.has(tag)));
    } else if (aKept.length && bKept.length) {
      continue;
    } else {
      result = result.filter((tag) => !group.b.test(tag));
    }
  }
  return result;
}
