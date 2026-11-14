/**
 * 皮肤干爽过滤（`strip_skin_moisture` 的移植，插件 v6.5.x）。
 *
 * 只在**成品 tag 列表**层剔除「会加皮肤水珠」的词条：不碰抽取 / 随机池 / 档位
 * / 互斥。关闭时零漂移（一次 rng 都不吃，text 逐字节不变）；开启时能覆盖全部
 * 通道（字段随机、服装库 tags、场景 extra、body/tail extra 都会被 collect 拍平）。
 */

export const SKIN_MOISTURE_GROUPS: Record<string, [zh: string, tags: string[]]> = {
  skin: ["皮肤", ["glistening skin", "damp skin", "wet skin", "oily skin", "raindrops on face"]],
  weather: ["天气与水", ["rain", "puddle", "water drop", "steam", "splashing water", "wet floor", "water surface"]],
  hair: ["头发", ["wet hair", "damp hair"]],
  cloth: ["衣物与体液", ["wet clothes", "wet cotton", "wet t-shirt", "sweat"]],
  light: ["光效", ["caustics"]],
};

/** 英文 tag → 中文名（面板明细常驻显示）。必须覆盖上面每一条。 */
export const SKIN_MOISTURE_ZH: Record<string, string> = {
  "glistening skin": "湿润光泽肌",
  "damp skin": "潮湿皮肤",
  "wet skin": "湿皮",
  "oily skin": "油皮",
  "raindrops on face": "脸上雨滴",
  rain: "雨天",
  puddle: "水洼",
  "water drop": "水珠",
  steam: "蒸汽氤氲",
  "splashing water": "溅水",
  "wet floor": "湿地面",
  "water surface": "水面",
  "wet hair": "湿发",
  "damp hair": "潮湿头发",
  "wet clothes": "湿透衣物",
  "wet cotton": "湿棉布",
  "wet t-shirt": "湿T恤",
  sweat: "香汗淋漓",
  caustics: "水面焦散",
};

/** 流泪白名单：命中任一条 → 放行 `glistening skin`（泪光特写会用到）。 */
export const SKIN_TEAR_MARKERS = new Set([
  "tears",
  "crying",
  "tear streak",
  "damp cheek",
  "glistening eyes",
  "watery eyes",
  "catchlight",
]);

export const SKIN_TEAR_KEEP = new Set(["glistening skin"]);

export const SKIN_MOISTURE_ALL_TAGS = new Set(
  Object.values(SKIN_MOISTURE_GROUPS).flatMap(([, tags]) => tags),
);

export function skinMoistureItems(gid: string): Array<[string, string]> {
  const tags = SKIN_MOISTURE_GROUPS[gid]?.[1] ?? [];
  return tags.map((tag) => [tag, SKIN_MOISTURE_ZH[tag] ?? tag]);
}

export function skinMoistureGroupOptions(): Array<[string, string, string[]]> {
  return Object.entries(SKIN_MOISTURE_GROUPS).map(([id, [zh, tags]]) => [id, zh, [...tags]]);
}

/**
 * 要剔除的词条集合。
 *
 * `onlyTags` **优先于** groups：
 *   · `"all"` → 全部；`"none"` → 空集（不能用空串，空串是回落语义）；
 *   · 其它非空串 → 逗号分隔的英文 tag，只关这些（词表外的静默忽略）；
 *   · `""` / 空 → 回落 groups 组语义。
 * groups 为空 / 含 `all` = 全部组。
 */
export function skinMoistureBanSet(
  groups?: string | readonly string[] | null,
  onlyTags?: string | null,
): Set<string> {
  const raw = String(onlyTags ?? "").trim().toLowerCase();
  if (raw === "all") return new Set(SKIN_MOISTURE_ALL_TAGS);
  if (raw === "none") return new Set();
  if (raw) {
    const wanted = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return new Set(wanted.filter((tag) => SKIN_MOISTURE_ALL_TAGS.has(tag)));
  }
  const groupList = Array.isArray(groups) ? groups : String(groups ?? "").split(",");
  let ids = new Set(groupList.map((s) => String(s).trim().toLowerCase()).filter(Boolean));
  if (!ids.size || ids.has("all")) ids = new Set(Object.keys(SKIN_MOISTURE_GROUPS));
  const ban = new Set<string>();
  for (const id of ids) {
    const group = SKIN_MOISTURE_GROUPS[id];
    if (!group) continue;
    for (const tag of group[1]) ban.add(tag.trim().toLowerCase());
  }
  return ban;
}

/**
 * 反向：把「生效的剔除集合」写回 `onlyTags` 字符串。
 *
 * 面板的逐条勾选要靠它 —— 全选写 `"all"`（不能用 `""`：空串是回落 groups，
 * 用户可能正好只勾了一个组），空集写 `"none"`，其余按词表顺序拼 csv，
 * 顺序稳定才好断言、也不会因为点击顺序不同产生两份等价状态。
 */
export function skinMoistureOnlyTagsFromSet(active: Iterable<string>): string {
  const set = new Set<string>();
  for (const raw of active) {
    const tag = String(raw).trim().toLowerCase();
    if (SKIN_MOISTURE_ALL_TAGS.has(tag)) set.add(tag);
  }
  if (!set.size) return "none";
  if (set.size === SKIN_MOISTURE_ALL_TAGS.size) return "all";
  const out: string[] = [];
  for (const [, tags] of Object.values(SKIN_MOISTURE_GROUPS)) {
    for (const tag of tags) if (set.has(tag)) out.push(tag);
  }
  return out.join(",");
}

/** 成品层剔除致水珠词条 → `[新 tag 列表, 被剔除的 tag 列表]`。 */
export function stripSkinMoisture(
  tags: readonly string[],
  groups?: string | readonly string[] | null,
  onlyTags?: string | null,
): [string[], string[]] {
  const ban = skinMoistureBanSet(groups, onlyTags);
  if (!ban.size) return [[...tags], []];
  const flat = tags.map((tag) => String(tag));
  const hasTears = flat.some((tag) => SKIN_TEAR_MARKERS.has(tag.trim().toLowerCase()));
  const out: string[] = [];
  const removed: string[] = [];
  for (const tag of flat) {
    const key = tag.trim().toLowerCase();
    if (ban.has(key) && !(hasTears && SKIN_TEAR_KEEP.has(key))) {
      removed.push(tag);
      continue;
    }
    out.push(tag);
  }
  return [out, removed];
}
