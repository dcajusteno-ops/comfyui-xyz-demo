/**
 * 字段联动（`anima_v4_link.py` 的移植）。
 *
 * 三张表：体位配对 / 表情配套 / 场景倾向。设计原则是**黑名单**：
 * 新增选项默认不受限，忘了登记只是少一条约束；白名单会让新选项默认被排除。
 */
import { requireWardrobeData } from "./store";

function tagsOf(value: unknown): Set<string> {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
}

function themeOf(state: Record<string, unknown>): string {
  const place = String(state.place ?? "").trim().toLowerCase();
  return requireWardrobeData("link").placeTheme[place] ?? "";
}

export function handTagsOf(state: Record<string, unknown>, fieldKey: string): Set<string> {
  const slot = requireWardrobeData("link").handSlot[fieldKey];
  if (!slot) return new Set();
  const allowed = new Set(slot);
  const out = new Set<string>();
  for (const tag of tagsOf(state[fieldKey])) if (allowed.has(tag)) out.add(tag);
  return out;
}

/** {占用上肢的字段: 该字段的上肢标签}（只收非空项，按 HAND_ORDER 顺序）。 */
export function handSlotState(state: Record<string, unknown>): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const key of requireWardrobeData("link").handOrder) {
    const got = handTagsOf(state, key);
    if (got.size) out[key] = got;
  }
  return out;
}

/** 上肢槽位该归谁：显式 > 字段优先级 > HAND_ORDER 靠前者。 */
export function handWinner(state: Record<string, unknown>): string {
  const holders = handSlotState(state);
  const keys = Object.keys(holders);
  if (keys.length === 0) return "";
  const data = requireWardrobeData("link");
  const explicit = new Set((state._preset_fields as string[] | undefined) ?? []);
  const ranked = [...keys].sort((a, b) => {
    const expA = explicit.has(a) ? 1 : 0;
    const expB = explicit.has(b) ? 1 : 0;
    if (expA !== expB) return expB - expA;
    const priA = data.handPriority[a] ?? 0;
    const priB = data.handPriority[b] ?? 0;
    if (priA !== priB) return priB - priA;
    return data.handOrder.indexOf(b) - data.handOrder.indexOf(a);
  });
  return ranked[0];
}

/** 当前已抽状态下该字段禁止的选项值。 */
export function bansFor(state: Record<string, unknown>, fieldKey: string): Set<string> {
  const data = requireWardrobeData("link");
  const out = new Set<string>();

  if (fieldKey === "n_pos") {
    for (const tag of tagsOf(state.n_act)) {
      for (const banned of data.actPosBan[tag] ?? []) out.add(banned);
    }
  } else if (fieldKey === "eye_gaze" || fieldKey === "mouth") {
    for (const tag of tagsOf(state.emotion)) {
      for (const banned of data.emotionBan[tag]?.[fieldKey] ?? []) out.add(banned);
    }
  }

  const theme = themeOf(state);
  if (theme) {
    for (const banned of data.themeBan[theme]?.[fieldKey] ?? []) out.add(banned);
  }

  if (data.handSlot[fieldKey]) {
    const mine = data.handPriority[fieldKey] ?? 0;
    for (const other of data.handOrder) {
      if (other === fieldKey || (data.handPriority[other] ?? 0) <= mine) continue;
      for (const tag of handTagsOf(state, other)) out.add(tag);
    }
  }
  return out;
}

/** 当前场景下该选项的权重倍数（1.0 = 不干预）。 */
export function biasFor(state: Record<string, unknown>, fieldKey: string, en: string): number {
  const theme = themeOf(state);
  if (!theme) return 1;
  return requireWardrobeData("link").themeWeight[theme]?.[fieldKey]?.[en] ?? 1;
}

export function handAll(): Set<string> {
  return new Set(requireWardrobeData("link").handAll);
}

export function handOrder(): string[] {
  return requireWardrobeData("link").handOrder;
}

export function handSlot(): Record<string, string[]> {
  return requireWardrobeData("link").handSlot;
}
