/**
 * 内置提示词词库：加载与通用查询判据。
 *
 * 词库文件由 Vite 从 `public/` 直出（构建后进 `dist/`，随 exe 内嵌），
 * 词条约 1.7 万条，体积约 6.4MB —— 因此这里做模块级缓存 + 并发去重，
 * 避免多处组件各自重复拉取。
 */

export type PromptRecord = {
  id?: string;
  source?: string;
  category?: string;
  subcategory?: string;
  scope?: string;
  text_en: string;
  text_zh?: string;
  preview?: string;
};

/** 词库中需要排除的 scope（NSFW 与负面词）。 */
export const EXCLUDED_SCOPES = new Set(["r18", "negative_default"]);

/** 词条最大长度：超出此长度的是整句/整段提示词，不适合做词条。 */
export const MAX_TAG_LENGTH = 80;

/**
 * 多词条整句的判据：真正的「一个词条」不会自带逗号分隔。
 * 库里有 189 条形如 `looking at viewer,(from side:1.2),( head tilt:1.65)`、
 * `prostrate, lie flat` 的整段提示词 —— 它们会让「转动一次得到一个词条」的语义破功
 * （在结果里显示成一长条，应用时又被按逗号拆成好几条）。
 */
const MULTI_TAG_PATTERN = /[,，]/;

export const PROMPT_LIBRARY_URL = "/data/prompt-library/all_prompts_merged.cleaned.json";

export function normalizeCategory(name: string) {
  return name.trim().toLowerCase();
}

/** 候选词条：scope 不在排除清单、是单条词（不含逗号）、具备有效英文词与分类。 */
export function isCandidateRecord(record: PromptRecord): boolean {
  const scope = record.scope?.toLowerCase() ?? "";
  const text = record.text_en?.trim() ?? "";
  return (
    !EXCLUDED_SCOPES.has(scope) &&
    Boolean(text) &&
    !MULTI_TAG_PATTERN.test(text) &&
    Boolean(record.category?.trim())
  );
}

let libraryCache: PromptRecord[] | null = null;
let inflight: Promise<PromptRecord[]> | null = null;

/** 加载内置词库（模块级缓存 + 并发去重），只保留候选词条。失败后允许重试。 */
export function loadPromptLibrary(): Promise<PromptRecord[]> {
  if (libraryCache) return Promise.resolve(libraryCache);
  if (inflight) return inflight;

  inflight = fetch(PROMPT_LIBRARY_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`词库加载失败（HTTP ${response.status}）`);
      return response.json() as Promise<unknown>;
    })
    .then((data: unknown) => {
      const records = Array.isArray(data) ? (data as PromptRecord[]).filter(isCandidateRecord) : [];
      libraryCache = records;
      return records;
    })
    .catch((error: unknown) => {
      inflight = null;
      throw error;
    });

  return inflight;
}

/** 仅供测试：清空缓存，让下一次调用重新 fetch。 */
export function resetPromptLibraryCache() {
  libraryCache = null;
  inflight = null;
}
