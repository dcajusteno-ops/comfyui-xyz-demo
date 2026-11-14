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
  // 卡片封面优先静帧：视频封面会自己播放，任何转场/标题/运动模糊帧都会糊满整张卡，
  // 远不如一张稳定的首图（详情弹窗里仍保留视频）。只有一张图片都没有时才回退视频。
  const images = localFiles.filter((file) => !isLoraVideo(file, localExampleSource(file)));
  const imagePreview = pickPreferredLocalExample(images.filter((file) => /^image_0\./i.test(localExampleName(file))))
    ?? images[0];
  if (imagePreview) {
    return {
      ...normalizeLocalExample(imagePreview),
      nsfwLevel: item.preview_nsfw_level ?? imagePreview.nsfwLevel,
    };
  }

  const videos = localFiles.filter((file) => isLoraVideo(file, localExampleSource(file)));
  const videoPreview = pickPreferredLocalExample(videos.filter((file) => /^image_0\./i.test(localExampleName(file))))
    ?? videos[0];
  if (videoPreview) {
    return {
      ...normalizeLocalExample(videoPreview),
      nsfwLevel: item.preview_nsfw_level ?? videoPreview.nsfwLevel,
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

// 视频扩展名对齐 LoRA Manager 的 mediaTypes.js（.mkv 一并覆盖）。
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".mkv"]);

/** 从一个片段 / 查询值里取扩展名；先去掉 ?/#，再做一次 URL 解码。 */
function mediaExtension(value: string) {
  const queryIndex = value.search(/[?#]/);
  let candidate = queryIndex === -1 ? value : value.slice(0, queryIndex);
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // 非法转义序列就按原样处理
  }
  const lastDot = candidate.lastIndexOf(".");
  if (lastDot === -1) return "";
  const extension = candidate.slice(lastDot).toLowerCase();
  return extension.includes("/") || extension.includes("\\") ? "" : extension;
}

export function isVideoPath(value: string) {
  // 不能只看 URL 结尾：LoRA Manager 的本地预览地址是
  // /api/lm/previews?path=xxx.mp4&v=<mtime>，.mp4 后面跟的是 &。
  // 对齐官方 mediaTypes.js：从 URL 本身、pathname、每个查询参数值、
  // 以及 ?&= 切出的片段里分别取扩展名判断。
  if (!value) return false;
  const candidates = new Set<string>([value]);
  try {
    const parsed = new URL(value, window.location.origin);
    candidates.add(parsed.pathname);
    parsed.searchParams.forEach((item) => candidates.add(item));
  } catch {
    // 相对/畸形 URL 解析失败时，仅靠下面的片段拆分
  }
  value.split(/[?&=]/).forEach((fragment) => candidates.add(fragment));
  for (const candidate of candidates) {
    if (VIDEO_EXTENSIONS.has(mediaExtension(candidate))) return true;
  }
  return false;
}