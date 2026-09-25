import type { BaseGenerationParams, DrawTextParams, LoraSelection, XyzAxis, XyzCombination, XyzField } from "../types";
import { animaStageMeta } from "../constants";
import { appendPositivePrompt, loraNamePatch, loraStrengthPatch } from "./workflowBuilders";

const numericFields = new Set<string>([
  "seed",
  "steps",
  "cfg",
  "width",
  "height",
  "denoise",
  "animaHiresPrePercent",
  "animaHiresPostPercent",
  "animaRefineSteps",
  "animaRefineCfg",
  "animaRefineDenoise",
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
  return numericFields.has(field);
}

/** 模型库取值字段：LoRA 模型轴支持按库序号批量（1..6 / {2..4} / 1..9..2 / * ）与通配符（模型名*） */
function isLibraryModelField(field: XyzField) {
  return field.startsWith("loraName_") || field.startsWith("loraAppendName_");
}

/** 通配符模式 → 正则（* 任意串、? 单字符，不区分大小写，锚定全串） */
function wildcardToRegExp(pattern: string) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function stripSafetensors(name: string) {
  return name.replace(/\.safetensors$/i, "");
}

/**
 * 数值范围 token 展开（数值轴专用）：`0.4..1.0` / `1..5`，步进可写第三段 `0.4..1.0..0.2`。
 * 缺省步进：两端都是整数 → 1（seed/步数/CFG 等整数扫描）；否则 → 0.1（强度/重绘幅度等小数扫描粒度）。
 * 返回 null 表示不是合法范围（token 原样保留，走后续字面值流程，不误伤普通值）。
 */
function expandNumericRangeToken(value: string): number[] | null {
  const segments = value.split("..");
  if (segments.length < 2 || segments.length > 3) return null;
  if (segments.some((part) => !part.trim())) return null;
  const [start, end, stepArg] = segments.map((part) => Number(part.trim()));
  const defaultStep = Number.isInteger(start) && Number.isInteger(end) ? 1 : 0.1;
  const step = segments.length === 3 ? stepArg : defaultStep;
  if (![start, end, step].every(Number.isFinite) || step === 0) return null;
  const values: number[] = [];
  const direction = start <= end ? 1 : -1;
  const actualStep = Math.abs(step) * direction;
  for (let current = start; direction > 0 ? current <= end : current >= end; current += actualStep) {
    values.push(roundAxisNumber(current));
    if (values.length > 256) break;
  }
  return values;
}

/** 轴值输入框 placeholder（与 parseAxisValues 实际支持的写法保持一致，勿另写一份） */
export function axisValuePlaceholder(field: XyzField): string | undefined {
  if (isLibraryModelField(field)) return "模型名{1..4}、模型名*、1..6 或文件名";
  if (isNumericField(field)) return "0.3, 0.5, 0.4..1.0 或 0.4..1.0..0.2";
  return undefined;
}

export function parseAxisValues(raw: string, field: XyzField, library?: string[]): Array<string | number> {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // 模型库模式：LoRA 模型轴按库序号（1 起始）取值，展开成真实文件名
  const lib = library && library.length > 0 && isLibraryModelField(field) ? library : undefined;

  return trimmed
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value): Array<string | number> => {
      // 数值轴的范围写法（0.4..1.0 / 1..5，可带步进），支持与普通值混填（逗号分隔）
      if (isNumericField(field)) {
        const expanded = expandNumericRangeToken(value);
        if (expanded) return expanded;
      }
      if (lib) {
        if (value === "*" || value.toLowerCase() === "all") {
          return lib.slice(0, 256);
        }
        // 通配符模式：模型名* / *关键词* / 名称? —— 限定同一模型/文件夹内批量
        if (value.includes("*") || value.includes("?")) {
          const pattern = wildcardToRegExp(value);
          return lib
            .filter((name) => pattern.test(name) || pattern.test(stripSafetensors(name)))
            .slice(0, 256);
        }
        const range = value.match(/^(\d+)\s*\.\.\s*(\d+)(?:\s*\.\.\s*(\d+))?$/);
        if (range) {
          const [, startStr, endStr, stepStr] = range;
          const start = parseInt(startStr, 10);
          const end = parseInt(endStr, 10);
          const step = stepStr ? parseInt(stepStr, 10) : 1;
          if (Number.isFinite(start) && Number.isFinite(end) && step > 0) {
            const expanded: string[] = [];
            const direction = start <= end ? 1 : -1;
            for (let i = start; direction > 0 ? i <= end : i >= end; i += step * direction) {
              if (i >= 1 && i <= lib.length) expanded.push(lib[i - 1]);
              if (expanded.length > 256) break;
            }
            return expanded;
          }
        }
      }
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
      // 花括号展开/单值产生的纯数字串 → 库序号映射（越界丢弃，稍后过滤）
      if (lib && /^\d+$/.test(String(value))) {
        const index = Number(value);
        return index >= 1 && index <= lib.length ? lib[index - 1] : "";
      }
      if (isNumericField(field)) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : value;
      }
      return value;
    })
    .filter((value) => value !== "");
}

export function buildXyzCombinations(
  axes: XyzAxis[],
  lorasOfTarget?: { name: string; displayName?: string }[],
  excludedIndices?: Set<number>,
  /** 模型库列表（LoRA 库文件名）：模型轴取值支持库序号范围（1..6 / * ） */
  libraryNames?: string[]
): XyzCombination[] {
  const activeAxes = axes
    .filter((axis) => axis.enabled)
    .map((axis) => ({
      axis,
      values: parseAxisValues(axis.values, axis.field, libraryNames),
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
      const nextPatch: Record<string, unknown> = { ...patch, ...fp };
      if (patch.loras && fp.loras) {
        nextPatch.loras = [...patch.loras, ...fp.loras];
      }
      if (patch.drawText && fp.drawText) {
        nextPatch.drawText = { ...patch.drawText, ...fp.drawText };
      }
      // 嵌套层按层合并，使多个 Anima 轴可以叠加（例如同时打「阶段开关轴」与「放大倍率轴」）
      for (const key of NESTED_PATCH_KEYS) {
        const a = (patch as Record<string, unknown>)[key];
        const b = (fp as Record<string, unknown>)[key];
        if (a && b && typeof a === "object" && typeof b === "object") {
          nextPatch[key] = { ...(a as object), ...(b as object) };
        }
      }
      walk(
        index + 1,
        nextPatch as Partial<BaseGenerationParams>,
        [...labels, `${fieldLabel(axis.field, lorasOfTarget)}=${String(value)}`],
      );
    }
  };
  walk(0, {}, []);
  return combinations;
}

/** 需要「按层合并」而非整体覆盖的参数键（Anima 等模板的嵌套配置） */
const NESTED_PATCH_KEYS = ["stages", "hires", "refine", "img2img"] as const;

export function applyXyzPatch<T extends BaseGenerationParams>(params: T, patch: Partial<BaseGenerationParams>): T {
  // 先把嵌套层拆出来，扁平层走原来的整体覆盖逻辑
  const flatPatch = { ...(patch as Record<string, unknown>) };
  const nestedPatch: Record<string, Record<string, unknown>> = {};
  for (const key of NESTED_PATCH_KEYS) {
    const value = flatPatch[key];
    delete flatPatch[key];
    if (value && typeof value === "object") nestedPatch[key] = value as Record<string, unknown>;
  }

  let next = { ...params, ...flatPatch } as T;
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
    next.drawText = patch.drawText;
  }

  // 嵌套层：**存在性守卫**——只有目标参数对象本身就有这一层才合并。
  // 否则（例如给 SD 系参数打 Anima 专属轴）会凭空造出 stages/hires/refine 键，
  // 污染其 localStorage 与预设快照。
  const source = params as unknown as Record<string, unknown>;
  const target = next as unknown as Record<string, unknown>;
  for (const key of NESTED_PATCH_KEYS) {
    const value = nestedPatch[key];
    if (!value) continue;
    const currentValue = source[key];
    if (currentValue && typeof currentValue === "object") {
      target[key] = { ...(currentValue as Record<string, unknown>), ...value };
    }
  }

  return next;
}

function isBooleanField(field: XyzField) {
  return field === "drawTextSyncWithImage" || field.startsWith("animaStage_");
}

const TRUTHY_AXIS_VALUES = new Set(["true", "1", "on", "yes", "开", "是"]);

function parseValue(field: XyzField, value: string | number) {
  if (isNumericField(field)) return Number(value);
  if (isBooleanField(field)) return TRUTHY_AXIS_VALUES.has(String(value).toLowerCase()) || value === 1;
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
    return { loras: [{ name: `__LORA_NAME_${idx}__`, active: true, strength: 0, clipStrength: 0, patchName: String(value) } as unknown as LoraSelection] };
  }
  if (field.startsWith("loraAppendName_")) {
    const idx = parseInt(field.split("_")[1]);
    return { loras: [{ name: `__LORA_APPEND_NAME_${idx}__`, active: true, strength: 0, clipStrength: 0, patchName: String(value) } as unknown as LoraSelection] };
  }
  if (field.startsWith("loraAppendStrength_")) {
    const idx = parseInt(field.split("_")[1]);
    return { loras: [{ name: `__LORA_APPEND_STRENGTH_${idx}__`, active: true, strength: Number(value), clipStrength: Number(value) } as unknown as LoraSelection] };
  }
  // ---- Anima 专属轴：返回**嵌套** patch，由 applyXyzPatch / buildXyzCombinations 按层合并 ----
  if (field === "animaHiresPrePercent") {
    return { hires: { prePercent: Number(value) } } as unknown as Partial<BaseGenerationParams>;
  }
  if (field === "animaHiresPostPercent") {
    return { hires: { postPercent: Number(value) } } as unknown as Partial<BaseGenerationParams>;
  }
  if (field === "animaRefineSteps") {
    return { refine: { steps: Number(value) } } as unknown as Partial<BaseGenerationParams>;
  }
  if (field === "animaRefineCfg") {
    return { refine: { cfg: Number(value) } } as unknown as Partial<BaseGenerationParams>;
  }
  if (field === "animaRefineDenoise") {
    return { refine: { denoise: Number(value) } } as unknown as Partial<BaseGenerationParams>;
  }
  if (field.startsWith("animaStage_")) {
    const stageKey = field.slice("animaStage_".length);
    return { stages: { [stageKey]: parseValue(field, value) } } as unknown as Partial<BaseGenerationParams>;
  }

  if (field === "drawTextText") {
    return { drawText: { text: String(value), enabled: true } as unknown as DrawTextParams };
  }
  if (field === "drawTextFont") {
    return { drawText: { font: String(value), enabled: true } as unknown as DrawTextParams };
  }
  if (field.startsWith("drawText")) {
    const subField = field.slice(8);
    const camelSubField = subField.charAt(0).toLowerCase() + subField.slice(1);
    return { drawText: { [camelSubField]: parseValue(field, value), enabled: true } as unknown as DrawTextParams };
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
      next = loraNamePatch(next, idx, lora.patchName ?? "");
    }
  }
  
  const appendedLoras: Record<number, LoraSelection> = {};
  if (appendNameLoras) {
    for (const lora of appendNameLoras) {
      const match = lora.name.match(/\d+/);
      if (match) appendedLoras[parseInt(match[0], 10)] = { name: lora.patchName ?? "", strength: 1.0, clipStrength: 1.0, active: true };
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
  if (field.startsWith("animaStage_")) {
    const stageKey = field.slice("animaStage_".length);
    const meta = animaStageMeta.find((item) => item.key === stageKey);
    return `阶段：${meta?.label ?? stageKey}`;
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
    animaHiresPrePercent: "放大①百分比",
    animaHiresPostPercent: "放大②百分比",
    animaRefineSteps: "精修步数",
    animaRefineCfg: "精修 CFG",
    animaRefineDenoise: "精修重绘",
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
