/**
 * 词库数据的按需加载。
 *
 * 为什么分文件而不是一个总 JSON：画师库单独就有 3MB，用户只开「服装」时
 * 不应该为它付出解析成本。每个子库独立 fetch + 模块级 promise 缓存，
 * 同一子库并发请求只发一次。
 */
import type { AnimaDataKind, AnimaDataMap } from "./types";

const FILES: Record<AnimaDataKind, string> = {
  artists: "artists.json",
  characters: "characters.json",
  official: "character-official.json",
  clothing: "clothing.json",
  backgrounds: "backgrounds.json",
  poses: "poses.json",
  danbooruAttire: "danbooru-attire.json",
  manifest: "manifest.json",
};

const cache = new Map<AnimaDataKind, unknown>();
const inflight = new Map<AnimaDataKind, Promise<unknown>>();

export function animaDataUrl(kind: AnimaDataKind): string {
  return `/data/anima/${FILES[kind]}`;
}

export function getAnimaData<K extends AnimaDataKind>(kind: K): AnimaDataMap[K] | null {
  return (cache.get(kind) as AnimaDataMap[K] | undefined) ?? null;
}

export async function loadAnimaData<K extends AnimaDataKind>(kind: K): Promise<AnimaDataMap[K]> {
  const cached = cache.get(kind);
  if (cached !== undefined) return cached as AnimaDataMap[K];

  const pending = inflight.get(kind);
  if (pending) return pending as Promise<AnimaDataMap[K]>;

  const file = FILES[kind];
  const task = (async () => {
    let response: Response;
    try {
      response = await fetch(animaDataUrl(kind));
    } catch (error) {
      throw new Error(
        `词库加载失败：${file}（${error instanceof Error ? error.message : String(error)}）`,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new Error(`词库加载失败：${file}（HTTP ${response.status}）`);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error(
        `词库解析失败：${file}（${error instanceof Error ? error.message : String(error)}）`,
        { cause: error },
      );
    }
    if (data === null || typeof data !== "object") {
      throw new Error(`词库数据结构异常：${file}`);
    }
    cache.set(kind, data);
    return data as AnimaDataMap[K];
  })();

  inflight.set(kind, task);
  try {
    return await task;
  } finally {
    // 成功时 cache 已写入；失败时清掉 inflight，允许用户点「重试」重新请求
    inflight.delete(kind);
  }
}

/** 批量加载（抽卡按需拉取） */
export async function loadAnimaDataMany<K extends AnimaDataKind>(
  kinds: readonly K[],
): Promise<Pick<AnimaDataMap, K>> {
  const entries = await Promise.all(kinds.map(async (kind) => [kind, await loadAnimaData(kind)] as const));
  return Object.fromEntries(entries) as Pick<AnimaDataMap, K>;
}

export function resetAnimaCache(kind?: AnimaDataKind): void {
  if (kind) {
    cache.delete(kind);
    inflight.delete(kind);
    return;
  }
  cache.clear();
  inflight.clear();
}
