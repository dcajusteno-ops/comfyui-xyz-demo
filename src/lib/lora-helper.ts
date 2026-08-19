import { defaultLoraManagerSettings } from "../constants";
import type { FolderTreeNode, LoraItem, LoraManagerSettings, LoraMetadata, LoraSelection, LoraUpdateRecord, MultiCharacter } from "../types";
import { normalizeMatureBlurLevel } from "./nsfw";

export function mergeLora(loras: LoraSelection[], selection: LoraSelection) {
  if (loras.some((lora) => lora.name === selection.name)) {
    return loras;
  }
  return [...loras, selection];
}

export function readCombo(data: unknown, node: string, input: string, fallback: string[]) {
  const entry = (data as Record<string, { input?: { required?: Record<string, unknown> } }>)[node]?.input?.required?.[input];
  if (Array.isArray(entry) && Array.isArray(entry[0])) {
    return entry[0].map(String);
  }
  return fallback;
}

export function normalizePreview(apiBase: string, preview?: string) {
  if (!preview) return "";
  if (/^https?:\/\//.test(preview)) return preview;
  if (preview.startsWith("/xyz/")) return preview;
  if (preview.startsWith("data:")) return preview;

  const base = (apiBase || "/comfy").replace(/\/+$/, "");
  if (preview.startsWith("/")) return `${base}${preview}`;
  return `${base}/${preview}`;
}

export function normalizeLoraManagerSettings(settings?: LoraManagerSettings | null): LoraManagerSettings {
  return {
    ...defaultLoraManagerSettings,
    ...(settings ?? {}),
    blur_mature_content: settings?.blur_mature_content ?? defaultLoraManagerSettings.blur_mature_content,
    mature_blur_level: normalizeMatureBlurLevel(settings?.mature_blur_level),
  };
}

export function buildFolderTree(folders: string[]) {
  const roots: FolderTreeNode[] = [];
  const lookup = new Map<string, FolderTreeNode>();
  for (const folder of folders) {
    const parts = folder.split(/[\\/]/).filter(Boolean);
    let path = "";
    let siblings = roots;
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      let node = lookup.get(path);
      if (!node) {
        node = { name: part, path, children: [] };
        lookup.set(path, node);
        siblings.push(node);
      }
      siblings = node.children;
    }
  }
  return roots;
}

export function extractItemTrainedWords(item: LoraItem) {
  const civitai = item.civitai as LoraMetadata | undefined;
  return uniqueStrings(civitai?.trainedWords ?? []);
}

export function subTypeAbbreviation(value?: string) {
  const normalized = value?.toLowerCase();
  if (normalized === "locon" || normalized === "lycoris") return "LyCO";
  if (normalized === "dora") return "DoRA";
  if (normalized === "loha") return "LoHA";
  return "LoRA";
}

export function baseModelAbbreviation(value?: string) {
  const text = value || "Unknown";
  const normalized = text.toLowerCase();
  if (normalized.includes("stable diffusion xl") || normalized.includes("sdxl")) return "SDXL";
  if (normalized.includes("stable diffusion 1.5") || normalized.includes("sd 1.5")) return "SD1.5";
  if (normalized.includes("illustrious")) return "Illustrious";
  if (normalized.includes("pony")) return "Pony";
  return text.length > 14 ? `${text.slice(0, 12)}...` : text;
}

export function uniqueStrings(values: Array<string | undefined | null>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    result.push(text);
  }
  return result;
}

export function mergeManagedModelItems(currentItems: LoraItem[], nextItems: LoraItem[]) {
  const byPath = new Map<string, LoraItem>();
  for (const item of currentItems) {
    byPath.set(item.file_path || `${item.model_name}-${item.file_name}`, item);
  }
  for (const item of nextItems) {
    byPath.set(item.file_path || `${item.model_name}-${item.file_name}`, item);
  }
  return Array.from(byPath.values());
}

export function parseTriggerWordsInput(value: string) {
  return uniqueStrings(value.split(/[\n]+/).map((word) => word.trim()).filter(Boolean));
}

export function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function formatStrength(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function loraSyntaxName(item: LoraItem) {
  if (item.folder && item.file_name) {
    return `${item.folder}/${item.file_name}`;
  }
  return item.file_name || item.model_name;
}

export function roundCanvasMask(mask: MultiCharacter["mask"]) {
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return {
    ...mask,
    x: round(mask.x),
    y: round(mask.y),
    width: round(mask.width),
    height: round(mask.height),
  };
}

export function loraModelId(item?: LoraItem) {
  if (!item) return undefined;
  const civitai = item.civitai as LoraMetadata | undefined;
  const metadata = item.metadata as LoraMetadata | undefined;
  const fromRaw = [
    civitai?.modelId,
    metadata?.modelId,
    (item.civitai as Record<string, unknown> | undefined)?.modelId,
    (item.metadata as Record<string, unknown> | undefined)?.modelId,
    (item.civitai as Record<string, unknown> | undefined)?.model_id,
    (item.metadata as Record<string, unknown> | undefined)?.model_id,
  ].find((value) => Number.isFinite(Number(value)));
  return fromRaw === undefined ? undefined : Number(fromRaw);
}

export function buildLoraCivitaiUrl(item: LoraItem, metadata?: LoraMetadata | null) {
  const itemCivitai = item.civitai as Record<string, unknown> | undefined;
  const itemMetadata = item.metadata as Record<string, unknown> | undefined;
  const loadedMetadata = metadata as Record<string, unknown> | null | undefined;
  const modelId = firstFiniteNumber([
    itemCivitai?.modelId,
    itemCivitai?.model_id,
    loadedMetadata?.modelId,
    loadedMetadata?.model_id,
    itemMetadata?.modelId,
    itemMetadata?.model_id,
  ]);
  const versionId = firstFiniteNumber([
    itemCivitai?.id,
    itemCivitai?.modelVersionId,
    itemCivitai?.model_version_id,
    loadedMetadata?.id,
    loadedMetadata?.modelVersionId,
    loadedMetadata?.model_version_id,
    itemMetadata?.id,
    itemMetadata?.modelVersionId,
    itemMetadata?.model_version_id,
  ]);
  if (modelId !== undefined) {
    const base = `https://civitai.red/models/${encodeURIComponent(String(modelId))}`;
    return versionId !== undefined ? `${base}?modelVersionId=${encodeURIComponent(String(versionId))}` : base;
  }
  if (versionId !== undefined) {
    return `https://civitai.red/model-versions/${encodeURIComponent(String(versionId))}`;
  }
  if (item.from_civitai) {
    return `https://civitai.red/models?query=${encodeURIComponent(item.model_name || item.file_name)}`;
  }
  return null;
}

export function updateRecordModelId(record: LoraUpdateRecord) {
  const value = (record as any).modelId ?? (record as any).model_id;
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function firstFiniteNumber(values: unknown[]) {
  const value = values.find((candidate) => Number.isFinite(Number(candidate)) && String(candidate).trim() !== "");
  return value === undefined ? undefined : Number(value);
}