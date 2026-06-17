import type { BaseGenerationParams, XyzAxis, XyzCombination, XyzField } from "../types";
import { appendPositivePrompt, loraStrengthPatch } from "./workflowBuilders";

const numericFields = new Set<string>([
  "seed",
  "steps",
  "cfg",
  "width",
  "height",
  "denoise",
]);

function isNumericField(field: XyzField) {
  if (field.startsWith("loraStrength_")) return true;
  return numericFields.has(field as any);
}

export function parseAxisValues(raw: string, field: XyzField): Array<string | number> {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (isNumericField(field) && trimmed.includes("..")) {
    const parts = trimmed.split("..").map((part) => Number(part.trim()));
    const [start, end, step = 1] = parts;
    if ([start, end, step].every(Number.isFinite) && step !== 0) {
      const values: number[] = [];
      const direction = start <= end ? 1 : -1;
      const actualStep = Math.abs(step) * direction;
      for (let value = start; direction > 0 ? value <= end : value >= end; value += actualStep) {
        values.push(roundAxisNumber(value));
        if (values.length > 256) break;
      }
      return values;
    }
  }

  return trimmed
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      if (isNumericField(field)) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : value;
      }
      return value;
    });
}

export function buildXyzCombinations(axes: XyzAxis[], lorasOfTarget?: { name: string; displayName?: string }[]): XyzCombination[] {
  const activeAxes = axes
    .filter((axis) => axis.enabled)
    .map((axis) => ({
      axis,
      values: parseAxisValues(axis.values, axis.field),
    }))
    .filter((axis) => axis.values.length > 0);

  if (!activeAxes.length) return [];

  const combinations: XyzCombination[] = [];
  const walk = (index: number, patch: Partial<BaseGenerationParams>, labels: string[]) => {
    if (index === activeAxes.length) {
      combinations.push({
        patch,
        label: labels.join(" / "),
      });
      return;
    }

    const { axis, values } = activeAxes[index];
    for (const value of values) {
      walk(
        index + 1,
        { ...patch, ...fieldPatch(axis.field, value) },
        [...labels, `${fieldLabel(axis.field, lorasOfTarget)}=${String(value)}`],
      );
    }
  };
  walk(0, {}, []);
  return combinations;
}

export function applyXyzPatch<T extends BaseGenerationParams>(params: T, patch: Partial<BaseGenerationParams>): T {
  let next = { ...params, ...patch };
  if ("positivePrompt" in patch && patch.positivePrompt) {
    next = {
      ...next,
      positivePrompt: appendPositivePrompt(params, patch.positivePrompt).positivePrompt,
    };
  }
  if (patch.loras) {
    next.loras = patch.loras;
  }
  return next;
}

function fieldPatch(field: XyzField, value: string | number): Partial<BaseGenerationParams> {
  if (field === "positiveAppend") {
    return { positivePrompt: String(value), filenameSuffix: String(value) };
  }
  if (field.startsWith("loraStrength_")) {
    const idx = parseInt(field.split("_")[1]);
    return { loras: [{ name: `__LORA_STRENGTH_${idx}__`, strength: Number(value), clipStrength: Number(value), active: true }] };
  }
  return { [field]: isNumericField(field) ? Number(value) : String(value) } as Partial<BaseGenerationParams>;
}

export function applySpecialXyzPatch<T extends BaseGenerationParams>(params: T, combo: XyzCombination): T {
  const strengthLoras = combo.patch.loras?.filter((lora) => lora.name.startsWith("__LORA_STRENGTH_"));
  const patch = { ...combo.patch };
  delete patch.loras;
  let next = applyXyzPatch(params, patch);
  if (strengthLoras) {
    for (const lora of strengthLoras) {
      const idx = parseInt(lora.name.split("_")[3]);
      next = loraStrengthPatch(next, idx, lora.strength);
    }
  }
  return next;
}

export function fieldLabel(field: XyzField, lorasOfTarget?: { name: string; displayName?: string }[]) {
  if (field.startsWith("loraStrength_")) {
    const idx = parseInt(field.split("_")[1]);
    const lora = lorasOfTarget?.[idx];
    return lora ? `${lora.displayName || lora.name} 强度` : `LoRA ${idx + 1} 强度`;
  }
  const labels: Record<string, string> = {
    seed: "Seed",
    steps: "Steps",
    cfg: "CFG",
    width: "宽",
    height: "高",
    samplerName: "采样器",
    scheduler: "调度器",
    denoise: "重绘",
    positiveAppend: "正向追加",
  };
  return labels[field] || field;
}

function roundAxisNumber(value: number) {
  return Math.round(value * 100000) / 100000;
}
