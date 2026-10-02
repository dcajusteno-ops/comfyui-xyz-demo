/**
 * 提示词词库：加载与通用查询判据。
 *
 * 两个数据源，加载时合并（**我的词条排在前面**，同名时用我的）：
 * 1. 内置词库 —— 由 Vite 从 `public/` 直出（构建后进 `dist/`，随 exe 内嵌），约 1.7 万条、6.4MB；
 *    因此这里做模块级缓存 + 并发去重，避免多处组件各自重复拉取。
 * 2. 用户词条 —— `GET /api/prompts` 的 `customEntries`（编辑器里导入/手加的那份，落盘 `data/prompts_state.json`）。
 *    它同样是「可用的词条」，转盘不该看不见（用户导入词典就是为了用）；接口失败时静默降级为仅内置。
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

/** 词库中**恒排除**的 scope：负面词（任何扇区都不该抽到）。 */
export const EXCLUDED_SCOPES = new Set(["negative_default"]);

/**
 * R18 scope：默认不进词池，但**不是恒排除** —— 词库会把它加载进内存，
 * 扇区显式开启 `allowR18` 后放行（用户就是要拿 NSFW 扇区抽 R18 词）。
 */
export const R18_SCOPES = new Set(["r18"]);

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

/** 用户词条（编辑器里那份）的读取端点，与 `PromptEditorDialog` / `PromptSidebar` 同一个。 */
export const PROMPTS_STATE_URL = "/api/prompts";

export function normalizeCategory(name: string) {
  return name.trim().toLowerCase();
}

/**
 * 候选词条：scope 不在恒排除清单、是单条词（不含逗号）、具备有效英文词与分类。
 * `allowR18` 默认为 false —— 不传时与历史行为一致（R18 视为不可用），
 * 只有调用方明确要求时才放行；`isCandidateRecord` 直接作为 filter 回调传入会拿到
 * index 当第二参，所以各处都用箭头函数显式调用。
 */
export function isCandidateRecord(record: PromptRecord, options: { allowR18?: boolean } = {}): boolean {
  const scope = record.scope?.toLowerCase() ?? "";
  const text = record.text_en?.trim() ?? "";
  if (EXCLUDED_SCOPES.has(scope)) return false;
  if (!options.allowR18 && R18_SCOPES.has(scope)) return false;
  return Boolean(text) && !MULTI_TAG_PATTERN.test(text) && Boolean(record.category?.trim());
}

let libraryCache: PromptRecord[] | null = null;
let inflight: Promise<PromptRecord[]> | null = null;

/**
 * 读用户词条（`/api/prompts` 的 `customEntries`），过同一套候选判据。
 * **失败一律降级为空数组** —— 拿不到我的词条只是少了些候选，不该让整个词库加载失败。
 */
async function fetchCustomEntries(): Promise<PromptRecord[]> {
  try {
    const response = await fetch(PROMPTS_STATE_URL);
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: { customEntries?: unknown } };
    const list = body?.data?.customEntries;
    return Array.isArray(list)
      ? (list as PromptRecord[]).filter((record) => isCandidateRecord(record, { allowR18: true }))
      : [];
  } catch {
    return [];
  }
}

/**
 * 加载词库（内置 + 我的词条，模块级缓存 + 并发去重），只保留候选词条。失败后允许重试。
 * 内置词库失败视为失败（走面板的错误态）；我的词条失败静默忽略。
 */
export function loadPromptLibrary(): Promise<PromptRecord[]> {
  if (libraryCache) return Promise.resolve(libraryCache);
  if (inflight) return inflight;

  const builtin = fetch(PROMPT_LIBRARY_URL).then((response) => {
    if (!response.ok) throw new Error(`词库加载失败（HTTP ${response.status}）`);
    return response.json() as Promise<unknown>;
  });

  inflight = Promise.all([builtin, fetchCustomEntries()])
    .then(([data, custom]) => {
      // 这里**放行 R18**（只有负面词恒剔）：是否真的用 r18 词由扇区的 allowR18 决定，
      // 在加载阶段就丢掉的话，开启了开关的扇区也无词可抽。
      const records = Array.isArray(data)
        ? (data as PromptRecord[]).filter((record) => isCandidateRecord(record, { allowR18: true }))
        : [];
      // 我的词条在前：词池按 text_en 去重时保留先出现的那条，让用户自己的中英对照优先
      libraryCache = [...custom, ...records];
      return libraryCache;
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
