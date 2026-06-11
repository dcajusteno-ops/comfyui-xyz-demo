import type { BaseGenerationParams, XyzAxis, XyzCombination, XyzField } from "../types";
import { appendPositivePrompt, firstLoraStrengthPatch } from "./workflowBuilders";

const numericFields = new Set<XyzField>([
  "seed",
  "steps",
  "cfg",
  "width",
  "height",
  "denoise",
  "firstLoraStrength",
]);

export function parseAxisValues(raw: string, field: XyzField): Array<string | number> {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (numericFields.has(field) && trimmed.includes("..")) {
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
      if (numericFields.has(field)) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : value;
      }
      return value;
    });
}

export function buildXyzCombinations(axes: XyzAxis[]): XyzCombination[] {
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
        [...labels, `${fieldLabel(axis.field)}=${String(value)}`],
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
  if (field === "firstLoraStrength") {
    return { loras: [{ name: "__FIRST_LORA_STRENGTH__", strength: Number(value), clipStrength: Number(value), active: true }] };
  }
  return { [field]: numericFields.has(field) ? Number(value) : String(value) } as Partial<BaseGenerationParams>;
}

export function applySpecialXyzPatch<T extends BaseGenerationParams>(params: T, combo: XyzCombination): T {
  const firstLora = combo.patch.loras?.find((lora) => lora.name === "__FIRST_LORA_STRENGTH__");
  const patch = { ...combo.patch };
  delete patch.loras;
  let next = applyXyzPatch(params, patch);
  if (firstLora) {
    next = firstLoraStrengthPatch(next, firstLora.strength);
  }
  return next;
}

export function fieldLabel(field: XyzField) {
  const labels: Record<XyzField, string> = {
    seed: "Seed",
    steps: "Steps",
    cfg: "CFG",
    width: "宽",
    height: "高",
    samplerName: "采样器",
    scheduler: "调度器",
    denoise: "重绘",
    firstLoraStrength: "首个 LoRA 强度",
    positiveAppend: "正向追加",
  };
  return labels[field];
}

function roundAxisNumber(value: number) {
  return Math.round(value * 100000) / 100000;
}
