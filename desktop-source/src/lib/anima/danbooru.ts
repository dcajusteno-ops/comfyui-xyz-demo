/**
 * Danbooru 随机图（纯前端）。
 *
 * 已实测：
 * - `posts.json` 匿名可读，响应带 `access-control-allow-origin: *`；
 * - 随机抽必须用 `random:1` **标签**；查询参数 `&random=1` 会 302；
 * - 图片 CDN（cdn.donmai.us）也带 CORS，因此「设为参考图」可以 fetch → 上传。
 */
import type {
  DanbooruRating,
  DanbooruSettings,
  DanbooruSize,
  DanbooruSnapshot,
  DanbooruTagGroup,
} from "./types";

export const DANBOORU_BASE = "https://danbooru.donmai.us";
export const DANBOORU_POSTS_URL = `${DANBOORU_BASE}/posts.json`;

export const DANBOORU_SIZES: DanbooruSize[] = ["sample", "original", "720x720", "360x360", "180x180"];

export const DANBOORU_RATINGS: Array<{ value: DanbooruRating; label: string; shortLabel: string }> = [
  { value: "g", label: "全年龄 general", shortLabel: "全年龄" },
  { value: "s", label: "敏感 sensitive", shortLabel: "敏感" },
  { value: "q", label: "疑问 questionable", shortLabel: "疑问" },
  { value: "e", label: "露骨 explicit", shortLabel: "露骨" },
];

const RATING_ORDER: DanbooruRating[] = ["g", "s", "q", "e"];

const RATING_ALIASES: Record<string, DanbooruRating> = {
  g: "g",
  general: "g",
  s: "s",
  sensitive: "s",
  q: "q",
  questionable: "q",
  e: "e",
  explicit: "e",
};

/** 把外部数据（旧存档 / 手写字符串）归一成合法分级；无法识别返回 undefined */
export function normalizeDanbooruRating(value: unknown): DanbooruRating | undefined {
  const key = String(value ?? "").trim().toLowerCase();
  return RATING_ALIASES[key];
}

/**
 * 多选分级归一：接受数组、逗号/空格分隔的字符串（`rating:g,s` 也能解析），
 * 去重并按 g→s→q→e 排序。`all` / 无法识别的值直接忽略，返回空数组 = 不限。
 */
export function normalizeDanbooruRatings(value: unknown): DanbooruRating[] {
  const items = Array.isArray(value) ? value : String(value ?? "").split(/[,，\s]+/);
  const set = new Set<DanbooruRating>();
  for (const item of items) {
    const parsed = normalizeDanbooruRating(item);
    if (parsed) set.add(parsed);
  }
  return RATING_ORDER.filter((rating) => set.has(rating));
}

/**
 * 旧存档把分级写在查询串里（默认值就是 `rating:general`）。
 * 这里把 `rating:*` 令牌全部摘出来，返回纯标签查询 + 识别到的分级（支持 `rating:g,s`）。
 */
export function splitRatingFromQuery(query: string): { query: string; ratings: DanbooruRating[] } {
  const tokens = String(query ?? "").trim().split(/\s+/).filter(Boolean);
  const rest: string[] = [];
  const found: DanbooruRating[] = [];
  for (const token of tokens) {
    const matched = /^rating:(.+)$/i.exec(token);
    if (!matched) {
      rest.push(token);
      continue;
    }
    found.push(...normalizeDanbooruRatings(matched[1]));
  }
  return { query: rest.join(" "), ratings: normalizeDanbooruRatings(found) };
}

export const DEFAULT_BLOCKED_TAGS = [
  "artist_name",
  "character_request",
  "commentary_request",
  "bad_id",
  "bad_source",
  "twitter_username",
  "web_address",
  "watermark",
  "english_text",
  "translated",
  "third-party_edit",
];

/**
 * 推荐屏蔽词：按用途分组，点一下整组加进「额外屏蔽词」，再点一下移除。
 * 只补默认屏蔽（上传类标签）之外的噪音词；都是 Danbooru 标签（下划线写法），
 * 只过滤输出标签，不影响抽到哪张图。
 */
export const RECOMMENDED_BLOCK_PRESETS: Array<{ id: string; label: string; tags: string[] }> = [
  {
    id: "text",
    label: "文字 / 水印",
    tags: ["text", "commentary", "signature", "logo"],
  },
  {
    id: "frame",
    label: "边框 / 裁切",
    tags: ["border", "letterboxed", "partially_offscreen", "cropped"],
  },
  {
    id: "quality",
    label: "画质 / 瑕疵",
    tags: ["jpeg_artifacts", "lowres", "bad_anatomy"],
  },
];

const BLOCK_TAG_SPLIT = /[,，\r\n\s]+/;

function rawBlockTokens(text: string): string[] {
  return String(text ?? "").split(BLOCK_TAG_SPLIT).filter(Boolean);
}

/** 这一组推荐词是否已全部在额外屏蔽词里（比较时归一化大小写与下划线） */
export function hasBlockTags(text: string, tags: string[]): boolean {
  const present = new Set(rawBlockTokens(text).map(normalizeDanbooruTag));
  return tags.every((tag) => present.has(normalizeDanbooruTag(tag)));
}

/**
 * 整组切换：已全部存在则移除，否则补齐缺失项；用户自己写的其它词保持原样。
 * 写回时保留标签的下划线写法（不能被归一化后的空格拆开）。
 */
export function toggleBlockTags(text: string, tags: string[]): string {
  const raw = rawBlockTokens(text);
  if (hasBlockTags(text, tags)) {
    const remove = new Set(tags.map(normalizeDanbooruTag));
    return raw.filter((token) => !remove.has(normalizeDanbooruTag(token))).join(", ");
  }
  const present = new Set(raw.map(normalizeDanbooruTag));
  const next = [...raw];
  for (const tag of tags) {
    const normalized = normalizeDanbooruTag(tag);
    if (!normalized || present.has(normalized)) continue;
    present.add(normalized);
    next.push(tag);
  }
  return next.join(", ");
}

const STATIC_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const ANIMATED_TAGS = new Set(["animated", "video"]);
const TAG_GROUP_ORDER: DanbooruTagGroup[] = ["artist", "character", "copyright", "general", "meta"];
const TAG_GROUP_FIELDS: Record<DanbooruTagGroup, string> = {
  artist: "tag_string_artist",
  character: "tag_string_character",
  copyright: "tag_string_copyright",
  general: "tag_string_general",
  meta: "tag_string_meta",
};

/** 只取用到的字段，避免把整个响应类型带进项目 */
export type DanbooruPost = {
  id?: number;
  file_ext?: string;
  rating?: string;
  is_deleted?: boolean;
  is_banned?: boolean;
  is_pending?: boolean;
  is_flagged?: boolean;
  tag_string_artist?: string;
  tag_string_character?: string;
  tag_string_copyright?: string;
  tag_string_general?: string;
  tag_string_meta?: string;
  file_url?: string;
  large_file_url?: string;
  preview_file_url?: string;
  image_width?: number;
  image_height?: number;
  media_asset?: {
    variants?: Array<{ type?: string; url?: string }>;
  };
};

export type DanbooruFetchDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  attempts?: number;
};

export function danbooruPostUrl(id: number): string {
  return `${DANBOORU_BASE}/posts/${id}`;
}

/**
 * 拼查询：分级是多选，拼成 `rating:g,s`；空数组 = 不限。
 * 查询串里残留的 `rating:*` 一律摘掉，避免两个来源打架。
 */
export function buildSearchTags(query: string, ratings: DanbooruRating[] = []): string {
  const cleaned = splitRatingFromQuery(query).query;
  const selected = normalizeDanbooruRatings(ratings);
  const ratingTag = selected.length ? `rating:${selected.join(",")}` : "";
  const tags = [ratingTag, cleaned].filter(Boolean).join(" ");
  if (/(^|\s)random:\d+(\s|$)/i.test(tags)) return tags;
  return tags ? `${tags} random:1` : "random:1";
}

export function buildPostsUrl(settings: DanbooruSettings): string {
  const tags = buildSearchTags(settings.query, settings.ratings ?? []);
  return `${DANBOORU_POSTS_URL}?tags=${encodeURIComponent(tags)}&limit=1`;
}

export function normalizeDanbooruTag(tag: string): string {
  return String(tag ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function blockedTagSet(settings: DanbooruSettings): Set<string> {
  const set = new Set<string>();
  if (settings.useDefaultBlocklist) {
    for (const tag of DEFAULT_BLOCKED_TAGS) set.add(normalizeDanbooruTag(tag));
  }
  for (const tag of String(settings.blockTags ?? "").split(/[,，\r\n\s]+/)) {
    const normalized = normalizeDanbooruTag(tag);
    if (normalized) set.add(normalized);
  }
  return set;
}

function rawGroupTags(post: DanbooruPost, group: DanbooruTagGroup): string[] {
  const raw = String((post as Record<string, unknown>)[TAG_GROUP_FIELDS[group]] ?? "");
  return raw.split(/\s+/).filter(Boolean);
}

/**
 * 选图：优先 `media_asset.variants` 里请求的档位；没有该档位时按字段回退。
 * （小图没有 `sample` 档，直接取 large/file 才是对的。）
 */
export function chooseImageUrl(post: DanbooruPost, size: DanbooruSize): string | null {
  if (!post || typeof post !== "object") return null;
  const variants = post.media_asset?.variants;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      if (variant && String(variant.type ?? "") === size && variant.url) return variant.url;
    }
  }
  const fields: Record<DanbooruSize, Array<keyof DanbooruPost>> = {
    original: ["file_url", "large_file_url", "preview_file_url"],
    sample: ["large_file_url", "file_url", "preview_file_url"],
    "720x720": ["preview_file_url", "large_file_url", "file_url"],
    "360x360": ["preview_file_url", "large_file_url", "file_url"],
    "180x180": ["preview_file_url", "large_file_url", "file_url"],
  };
  for (const field of fields[size] ?? fields.sample) {
    const value = post[field];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export function isUsableDanbooruPost(post: DanbooruPost, size: DanbooruSize): boolean {
  if (!post || typeof post !== "object") return false;
  if (post.is_deleted || post.is_banned || post.is_pending || post.is_flagged) return false;
  const ext = String(post.file_ext ?? "").toLowerCase();
  if (!STATIC_EXTENSIONS.has(ext)) return false;
  const general = rawGroupTags(post, "general").map(normalizeDanbooruTag);
  const meta = rawGroupTags(post, "meta").map(normalizeDanbooruTag);
  if ([...general, ...meta].some((tag) => ANIMATED_TAGS.has(tag))) return false;
  return Boolean(chooseImageUrl(post, size));
}

export function formatDanbooruGroups(
  post: DanbooruPost,
  settings: DanbooruSettings,
): { groups: Record<DanbooruTagGroup, string>; prompt: string } {
  const blocked = blockedTagSet(settings);
  const groups = {
    artist: "",
    character: "",
    copyright: "",
    general: "",
    meta: "",
  } as Record<DanbooruTagGroup, string>;

  for (const group of TAG_GROUP_ORDER) {
    if (!settings.groups[group]) continue;
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const raw of rawGroupTags(post, group)) {
      const tag = normalizeDanbooruTag(raw);
      if (!tag || blocked.has(tag) || seen.has(tag)) continue;
      seen.add(tag);
      tags.push(group === "artist" ? `@${tag}` : tag);
    }
    groups[group] = tags.join(", ");
  }

  const prompt = TAG_GROUP_ORDER.map((group) => groups[group]).filter(Boolean).join(", ");
  return { groups, prompt };
}

export function buildSnapshot(post: DanbooruPost, settings: DanbooruSettings): DanbooruSnapshot | null {
  const id = Number(post.id);
  const imageUrl = chooseImageUrl(post, settings.size);
  if (!Number.isFinite(id) || !imageUrl) return null;
  const { groups, prompt } = formatDanbooruGroups(post, settings);
  const variants = post.media_asset?.variants ?? [];
  const variant = (type: string) => variants.find((item) => item.type === type)?.url;
  // 一个档位挂了不代表整个 CDN 挂了：按「请求档 → 720 → original → preview → 小图」依次回退
  const imageUrls = [
    imageUrl,
    variant("720x720"),
    post.file_url,
    variant("original"),
    post.large_file_url,
    post.preview_file_url,
    variant("360x360"),
    variant("180x180"),
  ]
    .filter((url, index, list): url is string => Boolean(url) && list.indexOf(url) === index)
    .slice(0, 6);

  return {
    id,
    postUrl: danbooruPostUrl(id),
    imageUrl,
    ...(post.file_url ? { fileUrl: post.file_url } : {}),
    imageUrls,
    fileExt: String(post.file_ext ?? "").toLowerCase(),
    rating: String(post.rating ?? ""),
    ...(post.image_width ? { width: post.image_width } : {}),
    ...(post.image_height ? { height: post.image_height } : {}),
    groups,
    prompt,
    at: Date.now(),
  };
}

function statusError(status: number): Error & { status: number } {
  let message = `Danbooru 返回 HTTP ${status}`;
  if (status === 401) message = "Danbooru 鉴权失败（401）";
  else if (status === 403) message = "Danbooru 拒绝访问（403），可能被 Cloudflare 拦截";
  else if (status === 422) message = "查询被拒绝（422）：匿名最多 2 个普通标签，rating 不占名额";
  else if (status === 429) message = "Danbooru 限流（429），请稍后再试";
  return Object.assign(new Error(message), { status });
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 抽一张随机图。只重试网络错误、429、5xx 与「抽到动图/已删除」，
 * 4xx（除 429）立即失败，避免把限流打成重试风暴。
 */
export async function fetchRandomDanbooruPost(
  settings: DanbooruSettings,
  deps: DanbooruFetchDeps = {},
): Promise<DanbooruSnapshot> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const attempts = Math.max(1, deps.attempts ?? 3);
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const url = buildPostsUrl(settings);

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const signal =
        typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? AbortSignal.timeout(timeoutMs)
          : undefined;
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal,
      });

      if (!response.ok) {
        const error = statusError(response.status);
        if (!retryableStatus(response.status) || attempt === attempts) throw error;
        lastError = error;
        await sleep(600 * attempt);
        continue;
      }

      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error("Danbooru 返回了预期之外的结构（不是数组）");
      const post = (data as DanbooruPost[]).find((item) => isUsableDanbooruPost(item, settings.size));
      if (post) {
        const snapshot = buildSnapshot(post, settings);
        if (snapshot) return snapshot;
      }
      lastError = new Error("抽到的是动图或已删除作品，请放宽查询条件");
      if (attempt < attempts) await sleep(600 * attempt);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // statusError 会带上 status；非它抛出的错误（网络/JSON）没有状态码，按可重试处理
      const attached = (lastError as Error & { status?: number }).status;
      const fromMessage = /HTTP (\d{3})/.exec(lastError.message)?.[1];
      const status = attached ?? (fromMessage ? Number(fromMessage) : 0);
      if (status && !retryableStatus(status)) throw lastError;
      if (attempt === attempts) throw lastError;
      await sleep(600 * attempt);
    }
  }
  throw lastError ?? new Error("Danbooru 请求失败");
}

/** 下载原图用于「设为 Anima 参考图」；CORS 已实测可用 */
export async function fetchDanbooruImage(
  url: string,
  options: { maxBytes?: number; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Blob> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? 15 * 1024 * 1024;
  const signal =
    typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(options.timeoutMs ?? 20_000)
      : undefined;
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (blob.size > maxBytes) throw new Error("图片超过 15MB，请到 Danbooru 手动下载后上传");
  return blob;
}
