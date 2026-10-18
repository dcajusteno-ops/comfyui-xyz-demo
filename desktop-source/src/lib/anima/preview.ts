/**
 * 缩略图地址。
 *
 * 画师/角色缩略图来自 blobs.animadex.net（**没有 CORS**，只能 <img> 展示，
 * 不要 fetch）；服装/背景/姿势直接用数据里的 jsDelivr 地址。
 */
import type { AnimaCostumeItem } from "./types";

/**
 * 画师名里的括号在 Danbooru 语法中是转义的（`hammer \(sunset beach\)`），
 * 缩略图文件名用的是未转义版本，和插件 `re.sub(r"\\([()...)` 的做法一致。
 */
export function unescapeArtistName(name: string): string {
  return String(name ?? "").replace(/\\([()[\]{}])/g, "$1");
}

export function artistPreviewUrl(name: string): string {
  return `https://blobs.animadex.net/ArtistOutputs/thumbs/${encodeURIComponent(unescapeArtistName(name))}.webp`;
}

export function characterPreviewUrl(name: string, copyright: string): string {
  const raw = copyright ? `${name}, ${copyright}` : name;
  return `https://blobs.animadex.net/Outputs/thumbs/${encodeURIComponent(raw)}.webp`;
}

export function costumePreviewUrl(item: AnimaCostumeItem): string {
  return item.preview ?? "";
}
