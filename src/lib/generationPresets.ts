import type { GenerationPreset, TemplateKind } from "../types";

export const PRESETS_EXPORT_VERSION = 1;

function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}

export type PresetStoreShape = { presets: GenerationPreset[] };

export const emptyPresetStore = (): PresetStoreShape => ({ presets: [] });

/** 按模板分组筛选预设 */
export function selectPresetsFor(presets: GenerationPreset[], target: TemplateKind): GenerationPreset[] {
  return presets.filter((preset) => preset.target === target);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceItem(raw: unknown): GenerationPreset | null {
  if (!isRecord(raw)) return null;
  const target = raw.target;
  if (target !== "default" && target !== "multi" && target !== "highres") return null;
  if (typeof raw.name !== "string" || !raw.name.trim()) return null;
  if (!isRecord(raw.snapshot)) return null;

  const now = Date.now();
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : generateId(),
    name: raw.name.trim(),
    target,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
    snapshot: raw.snapshot,
  };
}

/** 校验导入 JSON：返回合法预设列表与跳过的非法条目数 */
export function validateImport(raw: unknown): { valid: GenerationPreset[]; skipped: number } {
  const valid: GenerationPreset[] = [];
  let skipped = 0;

  const source = isRecord(raw) && Array.isArray(raw.presets) ? raw.presets : raw;

  if (Array.isArray(source)) {
    for (const item of source) {
      const preset = coerceItem(item);
      if (preset) valid.push(preset);
      else skipped += 1;
    }
  } else {
    // 顶层不是数组也不是 { presets: [] }，视为整体非法
    skipped += 1;
  }

  return { valid, skipped };
}

export function exportPresetsJson(presets: GenerationPreset[]): string {
  return JSON.stringify(
    {
      version: PRESETS_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      presets,
    },
    null,
    2,
  );
}

/**
 * 把预设快照整对象替换到当前参数，并做 checkpoint 存活校验：
 * - snapshot 未携带 checkpoint：原样回填；
 * - snapshot.checkpoint 不在可用列表（模型被删除/换机器）：保留用户当前 checkpoint 并标记。
 */
export function applySnapshot<T extends Record<string, unknown>>(
  current: T,
  snapshot: Record<string, unknown>,
  availableCheckpoints: string[],
): { next: T; checkpointRejected: boolean } {
  const snapshotCkpt = snapshot.checkpoint;
  const rejectCheckpoint =
    typeof snapshotCkpt === "string" &&
    snapshotCkpt.length > 0 &&
    availableCheckpoints.length > 0 &&
    !availableCheckpoints.includes(snapshotCkpt);

  const next: T = { ...current, ...snapshot } as T;
  if (rejectCheckpoint) {
    (next as Record<string, unknown>).checkpoint = current.checkpoint;
  }
  return { next, checkpointRejected: rejectCheckpoint };
}

/** 生成一个命名预设（不落库，由调用方负责写回） */
export function makePreset(
  name: string,
  target: TemplateKind,
  snapshot: Record<string, unknown>,
): GenerationPreset {
  const now = Date.now();
  return {
    id: generateId(),
    name: name.trim(),
    target,
    createdAt: now,
    updatedAt: now,
    snapshot,
  };
}