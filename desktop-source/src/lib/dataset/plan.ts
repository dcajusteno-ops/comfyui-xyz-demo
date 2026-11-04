import type { DatasetAxisKey, DatasetConfig, DatasetItem } from "../../types";
import { createRng, randomSeed, shuffleInPlace } from "../anima/prng";
import { dedupeKey, splitPromptTags } from "../characterSheet";
import { buildCaption, composeDatasetPrompt } from "./compose";
import { AXIS_CONFLICTS, DATASET_AXIS_META, DATASET_AXIS_ORDER } from "./pools";

/**
 * 数据集计划生成（纯函数，确定性）。
 *
 * 为什么不用 `Math.random`：用户需要「同一份计划可复现」——改一条参数后
 * 只重跑那几条，其余样本的 prompt/seed 不能漂。`createRng` 是同项目抽卡用的
 * mulberry32，跨会话/跨机器结果一致。
 *
 * 发牌算法：每个轴一条独立随机流 + 分块洗牌。若所有轴共用一条流，
 * `pose[i]` 会与 `camera[i]` 永久绑定，100 张实际只走一条「维度轨迹」。
 */

export const MIN_DATASET_COUNT = 4;
export const MAX_DATASET_COUNT = 300;
const MAX_SEED = 2 ** 53 - 1;

/** 词池归一：去空白、按逗号/换行切分、按与提示词一致的口径去重 */
export function normalizePool(pool: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of pool ?? []) {
    for (const tag of splitPromptTags(String(raw ?? ""))) {
      const key = dedupeKey(tag);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

function conflictKeySet(): Array<[string, string]> {
  return AXIS_CONFLICTS.map(([a, b]) => [dedupeKey(a), dedupeKey(b)]);
}

function conflictsWith(chosen: string[], candidate: string): boolean {
  const key = dedupeKey(candidate);
  const pairs = conflictKeySet();
  for (const tag of chosen) {
    const other = dedupeKey(tag);
    for (const [a, b] of pairs) {
      if ((a === key && b === other) || (b === key && a === other)) return true;
    }
  }
  return false;
}

type AxisDeck = {
  axis: DatasetAxisKey;
  pool: string[];
  /** 已消费的槽位数（不是 item 数）：perItem>1 时一条会吃掉多个槽 */
  cursor: number;
  /** 每池洗一次的随机流：块号只由 cursor 决定，保证可复现 */
  orderOf: (block: number) => string[];
  cache: Map<number, string[]>;
};

function makeDeck(axis: DatasetAxisKey, pool: string[], planSeed: number, axisIndex: number): AxisDeck {
  const cache = new Map<number, string[]>();
  const orderOf = (block: number) => {
    const cached = cache.get(block);
    if (cached) return cached;
    const rng = createRng(planSeed + axisIndex * 7919 + block * 104729);
    const order = shuffleInPlace(rng, pool.slice());
    cache.set(block, order);
    // 只保留最近两块，避免长计划把整池缓存成 N 份
    if (cache.size > 3) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return order;
  };
  return { axis, pool, cursor: 0, orderOf, cache };
}

/** 从轴池里取 perItem 个不与已选词冲突的值；返回空数组表示该轴无可用词 */
function drawFromDeck(deck: AxisDeck, count: number, chosen: string[], blocked: Set<string>): string[] {
  if (!deck.pool.length || count <= 0) return [];
  const len = deck.pool.length;
  const picked: string[] = [];
  let attempts = 0;
  const maxAttempts = len * 2;

  while (picked.length < count && attempts < maxAttempts) {
    const block = Math.floor(deck.cursor / len);
    const order = deck.orderOf(block);
    const pos = deck.cursor % len;
    deck.cursor += 1;
    attempts += 1;

    const candidate = order[pos];
    if (!candidate) continue;
    const key = dedupeKey(candidate);
    if (blocked.has(key)) continue;
    if (picked.some((tag) => dedupeKey(tag) === key)) continue;
    if (conflictsWith([...chosen, ...picked], candidate)) continue;
    picked.push(candidate);
  }

  return picked;
}

/**
 * 换一批：重新规划必须同时换「发牌种子」和「每张图的 seed」。
 *
 * 只重排不换种子的话，点一次和点十次得到的是同一份计划、同一组图——
 * `seedBase` 固定会让 Seed 列一行都不变，看起来像「重新规划没生效」。
 */
export function reseedDatasetConfig(config: DatasetConfig): DatasetConfig {
  return { ...config, planSeed: randomSeed(), seedBase: randomSeed() };
}

/**
 * 生成数据集计划。
 * - 数量精确等于 `targetCount`（4..300）；
 * - 每个启用轴在内置池覆盖上尽量均匀（每个值每块出现一次）；
 * - 与角色固定词重复的词会被跳过（否则会被 compose 的 dedupe 静默吞掉）；
 * - 相同 `planSeed` + 相同配置 → 逐字段一致。
 */
export function buildDatasetPlan(config: DatasetConfig, count?: number): DatasetItem[] {
  const target = Math.min(
    MAX_DATASET_COUNT,
    Math.max(MIN_DATASET_COUNT, Math.trunc(Number(count ?? config.targetCount) || 100)),
  );

  const fixedText = [
    config.subject,
    config.characterPrompt,
    config.style?.[config.mode] ?? "",
    // 触发词是否进提示词取决于是否挂 LoRA，但无论进不进，都不该被变化轴重复选到
    config.trigger,
  ]
    .filter(Boolean)
    .join(", ");
  const blocked = new Set(splitPromptTags(fixedText).map((tag) => dedupeKey(tag)));

  const decks = DATASET_AXIS_ORDER.map((axis, axisIndex) => {
    const axisConfig = config.axes?.[axis];
    const enabled = axisConfig?.enabled !== false && axisConfig?.pool?.length;
    const perItem = Math.max(
      0,
      Math.min(
        DATASET_AXIS_META[axis].maxPerItem,
        Math.trunc(Number(axisConfig?.perItem ?? DATASET_AXIS_META[axis].defaultPerItem) || 0),
      ),
    );
    const pool = enabled ? normalizePool(axisConfig.pool) : [];
    return { axis, perItem, deck: makeDeck(axis, pool, Math.trunc(config.planSeed) || 0, axisIndex) };
  });

  const items: DatasetItem[] = [];
  const usedFingerprints = new Set<string>();

  for (let index = 0; index < target; index += 1) {
    let item: DatasetItem | null = null;

    // 指纹冲突时整条重抽（最多 6 次）；重抽会推进各轴 cursor，仍是确定性的
    for (let attempt = 0; attempt < 6 && !item; attempt += 1) {
      const tags: Partial<Record<DatasetAxisKey, string[]>> = {};
      const chosen: string[] = [];
      for (const entry of decks) {
        const picked = drawFromDeck(entry.deck, entry.perItem, chosen, blocked);
        if (picked.length) {
          tags[entry.axis] = picked;
          chosen.push(...picked);
        }
      }

      const composed = composeDatasetPrompt(config, tags);
      const fingerprint = composed.variableTags
        .map((tag) => dedupeKey(tag))
        .sort()
        .join("|");

      if (fingerprint && usedFingerprints.has(fingerprint)) continue;
      usedFingerprints.add(fingerprint);

      const ordinal = index + 1;
      item = {
        id: `ds-${Math.trunc(config.planSeed) || 0}-${ordinal}`,
        index: ordinal,
        seed: Math.abs((Math.trunc(config.seedBase) || 0) + ordinal * 1000003) % MAX_SEED,
        tags,
        prompt: composed.text,
        caption: buildCaption(config, composed.variableTags),
        fingerprint,
        status: "queued",
        files: [],
      };
    }

    // 极端情况下（例如所有轴都关）允许重复：仍然要凑够条数，否则队列会少跑
    if (!item) {
      const composed = composeDatasetPrompt(config, {});
      const ordinal = index + 1;
      item = {
        id: `ds-${Math.trunc(config.planSeed) || 0}-${ordinal}`,
        index: ordinal,
        seed: Math.abs((Math.trunc(config.seedBase) || 0) + ordinal * 1000003) % MAX_SEED,
        tags: {},
        prompt: composed.text,
        caption: buildCaption(config, composed.variableTags),
        fingerprint: composed.variableTags
          .map((tag) => dedupeKey(tag))
          .sort()
          .join("|"),
        status: "queued",
        files: [],
      };
    }

    items.push(item);
  }

  return items;
}
