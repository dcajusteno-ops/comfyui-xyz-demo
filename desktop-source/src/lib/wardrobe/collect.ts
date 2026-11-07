/**
 * 按槽位序收集标签（`collect()` 的移植）。
 *
 * 输出顺序是 count → character → appearance → clothing → pose → expression →
 * camera → scene → lighting → detail → free；不按界面段序（界面会把服装状态
 * 排在场景之后，进 CLIP 的顺序就错了）。
 */
import { roleOutputTags } from "./characters";
import { applyMutex } from "./mutex";
import { FIELD_SLOT, NO_EMIT_FIELDS, SLOTS } from "./slots";

export function collect(state: Record<string, unknown>, tailExtra = ""): string[] {
  const buckets: Record<string, string[]> = {};
  for (const slot of SLOTS) buckets[slot] = [];

  // v5.0.11：角色改由 roleOutputTags() 产出 Anima 官方写法（角色, 作品 两个独立 tag）。
  // state.role 保持 trigger 不动 —— 外貌/发型/服装/特征四张表都拿它当 key。
  const roleOut = roleOutputTags(state);
  for (const [key, value] of Object.entries(state)) {
    if (key.startsWith("_") || NO_EMIT_FIELDS.has(key)) continue;
    const text = String(value ?? "").trim();
    if (!text) continue;
    const slot = FIELD_SLOT[key];
    if (!slot) continue;
    if (key === "role") {
      buckets[slot].push(roleOut.length ? roleOut.join(", ") : text);
      continue;
    }
    buckets[slot].push(text);
  }

  const ordered: string[] = [];
  for (const slot of SLOTS) ordered.push(...buckets[slot]);

  const seen = new Set<string>();
  let flat: string[] = [];
  for (const chunk of ordered) {
    for (const raw of chunk.split(",")) {
      const tag = raw.trim().toLowerCase();
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      flat.push(tag);
    }
  }

  const keep = new Set<string>();
  // v5.0.11：角色 tag（含作品名）也算显式指令，必须并进 keep —— 形态角色
  // `asuna (bunny)` 含 `bunny`，不加保护会被「兔耳 vs 日常服」剔掉。
  for (const chunk of roleOut) {
    for (const raw of String(chunk).split(",")) {
      const tag = raw.trim().toLowerCase();
      if (tag) keep.add(tag);
    }
  }
  for (const key of (state._preset_fields as string[] | undefined) ?? []) {
    for (const raw of String(state[key] ?? "").split(",")) {
      const tag = raw.trim().toLowerCase();
      if (tag) keep.add(tag);
    }
  }
  // v4.1.1：选项权重点到 3.0 的标签同样是显式指令
  for (const row of (state._forced_tags as Array<[string, string, string]> | undefined) ?? []) {
    const tag = String(row[2] ?? "").trim().toLowerCase();
    if (tag) keep.add(tag);
  }
  flat = applyMutex(flat, keep);

  const tail = String(tailExtra ?? "").trim();
  if (tail) {
    for (const raw of tail.split(",")) {
      const tag = raw.trim().toLowerCase();
      if (tag && !seen.has(tag)) {
        seen.add(tag);
        flat.push(tag);
      }
    }
  }
  return flat;
}
