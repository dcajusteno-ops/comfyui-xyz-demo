/**
 * Danbooru 图片必须走同源代理：浏览器直连 cdn.donmai.us 会带
 * `Sec-Fetch-Site: cross-site`，被 Cloudflare 热链保护拦成 403，
 * 最终表现为 `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`。
 *
 * data:/blob: 是本地测试或已下载资源，保持原样。
 */
export function proxiedDanbooruImageUrl(url: string): string {
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return url;
  return `/xyz/anima/image?url=${encodeURIComponent(url)}`;
}
