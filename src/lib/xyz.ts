import type { BaseGenerationParams, XyzAxis, XyzCombination, XyzField } from "../types";
import { appendPositivePrompt, loraNamePatch, loraStrengthPatch } from "./workflowBuilders";

const numericFields = new Set<string>([
  "seed",
  "steps",
  "cfg",
  "width",
  "height",
  "denoise",
  "drawTextSize",
  "drawTextWidth",
  "drawTextHeight",
  "drawTextMaxWidth",
  "drawTextLineSpacing",
  "drawTextLetterSpacing",
  "drawTextGlowBlur",
  "drawTextShadowDistance",
  "drawTextShadowBlur",
  "drawTextOffsetX",
  "drawTextOffsetY",
  "drawTextRotation",
  "drawTextStrokeWidth",
]);

function isNumericField(field: XyzField) {
  if (field.startsWith("loraStrength_") || field.startsWith("loraAppendStrength_")) return true;
  if (field.startsWith("loraName_") || field.startsWith("loraAppendName_")) return false;
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
    .flatMap((value) => {
      const match = value.match(/^(.*)\{(\d+)\.\.(\d+)(?:\.\.(\d+))?\}(.*)$/);
      if (match) {
        const [, prefix, startStr, endStr, stepStr, suffix] = match;
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        const step = stepStr ? parseInt(stepStr, 10) : 1;
        const padLen = startStr.length === endStr.length && startStr.startsWith("0") ? startStr.length : 0;
        
        if (Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(step) && step > 0) {
          const expanded: string[] = [];
          const direction = start <= end ? 1 : -1;
          const actualStep = step * direction;
          for (let i = start; direction > 0 ? i <= end : i >= end; i += actualStep) {
            expanded.push(`${prefix}${String(i).padStart(padLen, "0")}${suffix}`);
            if (expanded.length > 256) break;
          }
          return expanded;
        }
      }
      return [value];
    })
    .map((value) => {
      if (isNumericField(field)) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : value;
      }
      return value;
    });
}

export function buildXyzCombinations(
  axes: XyzAxis[],
  lorasOfTarget?: { name: string; displayName?: string }[],
  excludedIndices?: Set<number>
): XyzCombination[] {
  const activeAxes = axes
    .filter((axis) => axis.enabled)
    .map((axis) => ({
      axis,
      values: parseAxisValues(axis.values, axis.field),
    }))
    .filter((axis) => axis.values.length > 0);

  if (!activeAxes.length) return [];

  const combinations: XyzCombination[] = [];
  let currentIndex = 0;

  const walk = (index: number, patch: Partial<BaseGenerationParams>, labels: string[]) => {
    if (index === activeAxes.length) {
      if (!excludedIndices || !excludedIndices.has(currentIndex)) {
        combinations.push({
          patch,
          label: labels.join(" / "),
          originalIndex: currentIndex,
        });
      }
      currentIndex++;
      return;
    }

    const { axis, values } = activeAxes[index];
    for (const value of values) {
      const fp = fieldPatch(axis.field, value);
      const nextPatch = { ...patch, ...fp };
      if (patch.loras && fp.loras) {
        nextPatch.loras = [...patch.loras, ...fp.loras];
      }
      if (patch.drawText && fp.drawText) {
        nextPatch.drawText = { ...patch.drawText, ...fp.drawText };
      }
      walk(
        index + 1,
        nextPatch,
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
  if (patch.drawText && params.drawText) {
    next.drawText = { ...params.drawText, ...patch.drawText };
  } else if (patch.drawText) {
    next.drawText = patch.drawText as any;
  }
  return next;
}

function isBooleanField(field: XyzField) {
  return field === "drawTextSyncWithImage";
}

function parseValue(field: XyzField, value: any) {
  if (isNumericField(field)) return Number(value);
  if (isBooleanField(field)) return String(value).toLowerCase() === "true" || value === "1" || value === 1;
  return String(value);
}

function fieldPatch(field: XyzField, value: string | number): Partial<BaseGenerationParams> {
  if (field === "positiveAppend") {
    return { positivePrompt: String(value), filenameSuffix: String(value) };
  }
  if (field.startsWith("loraStrength_")) {
    const idx = parseInt(field.split("_")[1]);
    return { loras: [{ name: `__LORA_STRENGTH_${idx}__`, strength: Number(value), clipStrength: Number(value), active: true }] };
  }
  if (field.startsWith("loraName_")) {
    const idx = parseInt(field.split("_")[1]);
    return { loras: [{ name: `__LORA_NAME_${idx}__`, active: true, strength: 0, clipStrength: 0, patchName: String(value) } as any] };
  }
  if (field.startsWith("loraAppendName_")) {
    const idx = parseInt(field.split("_")[1]);
    return { loras: [{ name: `__LORA_APPEND_NAME_${idx}__`, active: true, strength: 0, clipStrength: 0, patchName: String(value) } as any] };
  }
  if (field.startsWith("loraAppendStrength_")) {
    const idx = parseInt(field.split("_")[1]);
    return { loras: [{ name: `__LORA_APPEND_STRENGTH_${idx}__`, active: true, strength: Number(value), clipStrength: Number(value) } as any] };
  }
  if (field === "drawTextText") {
    return { drawText: { text: String(value), enabled: true } as any };
  }
  if (field === "drawTextFont") {
    return { drawText: { font: String(value), enabled: true } as any };
  }
  if (field.startsWith("drawText")) {
    const subField = field.slice(8);
    const camelSubField = subField.charAt(0).toLowerCase() + subField.slice(1);
    return { drawText: { [camelSubField]: parseValue(field, value), enabled: true } as any };
  }
  return { [field]: parseValue(field, value) } as Partial<BaseGenerationParams>;
}

export function applySpecialXyzPatch<T extends BaseGenerationParams>(params: T, combo: XyzCombination): T {
  const strengthLoras = combo.patch.loras?.filter((lora) => lora.name.startsWith("__LORA_STRENGTH_"));
  const nameLoras = combo.patch.loras?.filter((lora) => lora.name.startsWith("__LORA_NAME_"));
  const appendNameLoras = combo.patch.loras?.filter((lora) => lora.name.startsWith("__LORA_APPEND_NAME_"));
  const appendStrengthLoras = combo.patch.loras?.filter((lora) => lora.name.startsWith("__LORA_APPEND_STRENGTH_"));
  
  const patch = { ...combo.patch };
  delete patch.loras;
  let next = applyXyzPatch(params, patch);
  if (strengthLoras) {
    for (const lora of strengthLoras) {
      const match = lora.name.match(/\d+/);
      const idx = match ? parseInt(match[0], 10) : 0;
      next = loraStrengthPatch(next, idx, lora.strength);
    }
  }
  if (nameLoras) {
    for (const lora of nameLoras) {
      const match = lora.name.match(/\d+/);
      const idx = match ? parseInt(match[0], 10) : 0;
      next = loraNamePatch(next, idx, (lora as any).patchName);
    }
  }
  
  const appendedLoras: Record<number, any> = {};
  if (appendNameLoras) {
    for (const lora of appendNameLoras) {
      const match = lora.name.match(/\d+/);
      if (match) appendedLoras[parseInt(match[0], 10)] = { name: (lora as any).patchName, strength: 1.0, clipStrength: 1.0, active: true };
    }
  }
  if (appendStrengthLoras) {
    for (const lora of appendStrengthLoras) {
      const match = lora.name.match(/\d+/);
      if (match) {
        const idx = parseInt(match[0], 10);
        if (!appendedLoras[idx]) appendedLoras[idx] = { name: "", strength: 1.0, clipStrength: 1.0, active: true };
        appendedLoras[idx].strength = lora.strength;
        appendedLoras[idx].clipStrength = lora.clipStrength;
      }
    }
  }
  
  const toAppend = Object.values(appendedLoras).filter(l => l.name);
  if (toAppend.length > 0) {
    next = { ...next, loras: [...next.loras, ...toAppend] };
  }
  
  return next;
}

export function fieldLabel(field: XyzField, lorasOfTarget?: { name: string; displayName?: string }[]) {
  if (field.startsWith("loraStrength_")) {
    const idx = parseInt(field.split("_")[1]);
    const lora = lorasOfTarget?.[idx];
    return lora ? `${lora.displayName || lora.name} 强度` : `LoRA ${idx + 1} 强度`;
  }
  if (field.startsWith("loraName_")) {
    const idx = parseInt(field.split("_")[1]);
    const lora = lorasOfTarget?.[idx];
    return lora ? `替换 ${lora.displayName || lora.name} 模型` : `LoRA ${idx + 1} 模型`;
  }
  if (field.startsWith("loraAppendName_")) {
    const idx = parseInt(field.split("_")[1]);
    return `追加 LoRA ${idx} 模型`;
  }
  if (field.startsWith("loraAppendStrength_")) {
    const idx = parseInt(field.split("_")[1]);
    return `追加 LoRA ${idx} 强度`;
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
    drawTextText: "文字内容",
    drawTextFont: "文字字体",
    drawTextSize: "文字大小",
    drawTextColor: "文字颜色",
    drawTextWidth: "画布宽",
    drawTextHeight: "画布高",
    drawTextMaxWidth: "文字换行宽",
    drawTextLineSpacing: "行间距",
    drawTextLetterSpacing: "字间距",
    drawTextGlowBlur: "发光模糊",
    drawTextGlowColor: "发光颜色",
    drawTextShadowDistance: "阴影距离",
    drawTextShadowBlur: "阴影模糊",
    drawTextShadowColor: "阴影颜色",
    drawTextHorizontalAlign: "水平对齐",
    drawTextVerticalAlign: "垂直对齐",
    drawTextOffsetX: "偏移X",
    drawTextOffsetY: "偏移Y",
    drawTextRotation: "旋转角度",
    drawTextStrokeWidth: "描边粗细",
    drawTextStrokeColor: "描边颜色",
    drawTextColor2: "渐变颜色2",
    drawTextGradientDirection: "渐变方向",
    drawTextLayoutDirection: "排列方向",
    drawTextDecoration: "文字装饰",
    drawTextSyncWithImage: "同步画布大小",
    drawTextSyncMode: "画布同步模式",
    drawTextGradientAngle: "渐变角度",
  };
  return labels[field] || field;
}

function roundAxisNumber(value: number) {
  return Math.round(value * 100000) / 100000;
}
