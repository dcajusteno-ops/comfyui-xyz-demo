import type { LoraExampleMedia, LoraItem, LoraMetadata } from "../types";
import { getItemNsfwLevel } from "./nsfw";

export function buildLoraExamples(
  _apiBase: string,
  item: LoraItem,
  metadata: LoraMetadata | null,
  localFiles: LoraExampleMedia[],
) {
  const remoteImages = [...(metadata?.images ?? []), ...(metadata?.customImages ?? [])].filter(Boolean);
  if (remoteImages.length > 0) {
    return remoteImages.map((remote, index) => {
      const local = findMatchingLocalExample(remote, index, localFiles);
      if (!local) {
        return { ...remote, source: remote.source ?? "civitai" };
      }
      return mergeRemoteWithLocalExample(remote, local);
    });
  }

  const dedupedLocal = dedupeLocalExamples(localFiles);
  if (dedupedLocal.length > 0) {
    return dedupedLocal.map(normalizeLocalExample);
  }

  const merged: LoraExampleMedia[] = [];
  if (item.preview_url) {
    merged.push({
      url: item.preview_url,
      type: isVideoPath(item.preview_url) ? "video" : "image",
      source: "preview",
      nsfwLevel: getItemNsfwLevel(item, metadata),
    });
  }
  return merged;
}

export function mergeRemoteWithLocalExample(remote: LoraExampleMedia, local: LoraExampleMedia) {
  const localExample = normalizeLocalExample(local);
  return {
    ...remote,
    ...localExample,
    source: "local" as const,
    meta: remote.meta ?? localExample.meta,
    nsfwLevel: localExample.nsfwLevel ?? remote.nsfwLevel,
  };
}

export function pickCardPreviewMedia(item: LoraItem, localFiles: LoraExampleMedia[]): LoraExampleMedia {
  const localPreview = pickPreferredLocalExample(localFiles.filter((file) => /^image_0\./i.test(localExampleName(file))))
    ?? pickPreferredLocalExample(localFiles);
  if (localPreview) {
    return {
      ...normalizeLocalExample(localPreview),
      nsfwLevel: item.preview_nsfw_level ?? localPreview.nsfwLevel,
    };
  }
  return {
    url: item.preview_url,
    type: isVideoPath(item.preview_url ?? "") ? "video" : "image",
    nsfwLevel: item.preview_nsfw_level,
    source: "preview",
  };
}

export function normalizeLocalExample(local: LoraExampleMedia): LoraExampleMedia {
  const localSource = localExampleSource(local);
  const normalized = {
    ...local,
    source: "local" as const,
    type: local.is_video ? "video" : local.type ?? (isVideoPath(localSource) ? "video" : "image"),
  };
  if (!normalized.path && localSource) {
    normalized.path = localSource;
  }
  if (!normalized.url && localSource) {
    normalized.url = localSource;
  }
  return normalized;
}

export function findMatchingLocalExample(remote: LoraExampleMedia, index: number, localFiles: LoraExampleMedia[]) {
  const customId = remote.id !== undefined && remote.id !== null ? `custom_${String(remote.id)}` : "";
  const candidates = localFiles.filter((file) => {
    const name = localExampleName(file);
    const imageMatch = name.match(/^image_(\d+)\./i);
    if (customId) {
      return name.startsWith(customId) || Boolean(imageMatch && Number(imageMatch[1]) === index);
    }
    return Boolean(imageMatch && Number(imageMatch[1]) === index);
  });
  return pickPreferredLocalExample(candidates);
}

export function dedupeLocalExamples(localFiles: LoraExampleMedia[]) {
  const byKey = new Map<string, LoraExampleMedia>();
  for (const file of localFiles) {
    const key = localExampleKey(file);
    const current = byKey.get(key);
    if (!current || localExampleScore(file) > localExampleScore(current)) {
      byKey.set(key, file);
    }
  }
  return Array.from(byKey.values());
}

export function pickPreferredLocalExample(files: LoraExampleMedia[]) {
  return files.reduce<LoraExampleMedia | undefined>((best, file) => {
    if (!best || localExampleScore(file) > localExampleScore(best)) {
      return file;
    }
    return best;
  }, undefined);
}

export function localExampleKey(file: LoraExampleMedia) {
  const name = localExampleName(file);
  return name.replace(/\.[^.]+$/, "").toLowerCase();
}

export function localExampleName(file: LoraExampleMedia) {
  const value = file.name || localExampleSource(file);
  return value.split(/[\\/]/).pop() || value;
}

export function localExampleSource(file: LoraExampleMedia) {
  return file.path || file.url || "";
}

export function localExampleExtension(file: LoraExampleMedia) {
  const fromType = file.extension || localExampleName(file).match(/\.[^.]+$/)?.[0] || "";
  return fromType.toLowerCase();
}

export function localExampleScore(file: LoraExampleMedia) {
  if (isLoraVideo(file, localExampleSource(file))) return 50;
  const extension = localExampleExtension(file);
  if (extension === ".webp") return 40;
  if (extension === ".png") return 30;
  if (extension === ".jpg" || extension === ".jpeg") return 20;
  if (extension === ".gif") return 10;
  return 0;
}

export function isLoraVideo(media: LoraExampleMedia, src = "") {
  return Boolean(media.is_video || media.type === "video" || isVideoPath(src || media.path || media.url || ""));
}

export function isVideoPath(value: string) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(value);
}