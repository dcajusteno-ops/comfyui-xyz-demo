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
  if (target !== "default" && target !== "multi" && target !== "highres" && target !== "anima") return null;
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

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined),
      source,
    );
}

/** 只在路径已存在时写入，避免给参数对象凭空造出中间层（例如给 SD 系参数加 `stages`）。 */
function writePath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const next = cursor[keys[i]];
    if (!next || typeof next !== "object") return;
    cursor = next as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
}

/** 校验「哪一个字段」用「哪一份可用列表」。默认保持 `checkpoint` / 传入的 checkpoint 列表。 */
export type SnapshotGuard = {
  /** 参数路径，支持点号（如 `modelStack.unetName`），默认 `checkpoint` */
  field?: string;
  /** 该字段的可用取值；空数组或未提供时沿用第三个参数 */
  available?: string[];
};

/**
 * 把预设快照整对象替换到当前参数，并对「模型」类字段做存活校验：
 * - snapshot 未携带该字段：原样回填；
 * - snapshot 的值不在可用列表（模型被删除/换机器）：保留用户当前值并在返回值中标记。
 *
 * `guard` 用于非 Checkpoint 系模板（例如 Anima 应校验 `modelStack.unetName` 对 `options.unets`）。
 * 不传时行为与改造前完全一致。
 */
export function applySnapshot<T extends Record<string, unknown>>(
  current: T,
  snapshot: Record<string, unknown>,
  availableCheckpoints: string[],
  guard?: SnapshotGuard,
): { next: T; checkpointRejected: boolean; rejectedField?: string } {
  const field = guard?.field ?? "checkpoint";
  const available = guard?.available ?? availableCheckpoints;

  const snapshotValue = readPath(snapshot, field);
  const rejectField =
    typeof snapshotValue === "string" &&
    snapshotValue.length > 0 &&
    available.length > 0 &&
    !available.includes(snapshotValue);

  const next: T = { ...current, ...snapshot } as T;
  if (rejectField) {
    writePath(next as Record<string, unknown>, field, readPath(current as Record<string, unknown>, field));
  }
  return { next, checkpointRejected: rejectField, rejectedField: rejectField ? field : undefined };
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