/**
 * 按槽位序收集标签（`collect()` 的移植）。
 *
 * 输出顺序是 count → character → appearance → clothing → pose → expression →
 * camera → scene → lighting → detail → free；不按界面段序（界面会把服装状态
 * 排在场景之后，进 CLIP 的顺序就错了）。
 */
import { applyMutex } from "./mutex";
import { FIELD_SLOT, NO_EMIT_FIELDS, SLOTS } from "./slots";

export function collect(state: Record<string, unknown>, tailExtra = ""): string[] {
  const buckets: Record<string, string[]> = {};
  for (const slot of SLOTS) buckets[slot] = [];

  for (const [key, value] of Object.entries(state)) {
    if (key.startsWith("_") || NO_EMIT_FIELDS.has(key)) continue;
    const text = String(value ?? "").trim();
    if (!text) continue;
    const slot = FIELD_SLOT[key];
    if (!slot) continue;
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
  for (const key of (state._preset_fields as string[] | undefined) ?? []) {
    for (const raw of String(state[key] ?? "").split(",")) {
      const tag = raw.trim().toLowerCase();
      if (tag) keep.add(tag);
    }
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
