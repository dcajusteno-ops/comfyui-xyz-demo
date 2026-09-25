import { NSFW_LEVELS, validMatureBlurLevels } from "../constants";
import type { LoraExampleMedia, LoraItem, LoraManagerSettings, LoraMetadata, MatureBlurLevel } from "../types";

export function normalizeMatureBlurLevel(value: unknown): MatureBlurLevel {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return validMatureBlurLevels.includes(normalized as MatureBlurLevel) ? normalized as MatureBlurLevel : "R";
}

export function getMatureBlurThreshold(settings?: LoraManagerSettings | null) {
  const level = normalizeMatureBlurLevel(settings?.mature_blur_level);
  return NSFW_LEVELS[level as keyof typeof NSFW_LEVELS] ?? NSFW_LEVELS.R;
}

export function normalizeNsfwLevel(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function getItemNsfwLevel(item: LoraItem, metadata?: LoraMetadata | null) {
  const explicitLevel = normalizeNsfwLevel(item.preview_nsfw_level);
  if (explicitLevel > 0 || item.preview_nsfw_level !== undefined) {
    return explicitLevel;
  }
  const itemCivitai = item.civitai as LoraMetadata | undefined;
  return metadata?.model?.nsfw || itemCivitai?.model?.nsfw ? NSFW_LEVELS.R : NSFW_LEVELS.UNKNOWN;
}

export function getMediaNsfwLevel(media: LoraExampleMedia, fallbackLevel = 0) {
  if (media.nsfwLevel !== undefined) {
    return normalizeNsfwLevel(media.nsfwLevel);
  }
  const metadata = media.metadata as Record<string, unknown> | undefined;
  const meta = media.meta as Record<string, unknown> | undefined;
  const metadataLevel = normalizeNsfwLevel(metadata?.nsfwLevel ?? meta?.nsfwLevel);
  if (metadataLevel > 0) return metadataLevel;
  if (metadata?.nsfw === true || meta?.nsfw === true) return NSFW_LEVELS.R;
  return normalizeNsfwLevel(fallbackLevel);
}

export function shouldBlurNsfwLevel(level: number, settings?: LoraManagerSettings | null) {
  return settings?.blur_mature_content !== false && normalizeNsfwLevel(level) >= getMatureBlurThreshold(settings);
}

export function getNSFWLevelName(level: number) {
  const normalized = normalizeNsfwLevel(level);
  if (normalized >= NSFW_LEVELS.BLOCKED) return "Blocked";
  if (normalized >= NSFW_LEVELS.XXX) return "XXX";
  if (normalized >= NSFW_LEVELS.X) return "X";
  if (normalized >= NSFW_LEVELS.R) return "R";
  if (normalized >= NSFW_LEVELS.PG13) return "PG13";
  if (normalized >= NSFW_LEVELS.PG) return "PG";
  return "Unknown";
}

export function getNsfwWarningText(level: number) {
  const normalized = normalizeNsfwLevel(level);
  if (normalized >= NSFW_LEVELS.XXX) return "XXX-rated Content";
  if (normalized >= NSFW_LEVELS.X) return "X-rated Content";
  if (normalized >= NSFW_LEVELS.R) return "R-rated Content";
  return "Mature Content";
}