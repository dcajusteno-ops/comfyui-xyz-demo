import type { JobResult, OutputImage } from "../types";

/**
 * ComfyUI 执行结果的解析与归并（从 comfyClient 抽出的纯逻辑）。
 *
 * 抽取动因有两个，缺一不可：
 * 1. 这段逻辑原先在 `runPrompt` 的 executed 分支与 `extractHistory` 里**各写了一份**；
 * 2. 两份**行为并不一致**——`extractHistory` 用函数级累积数组判断「本节点有没有文本输出」，
 *    导致只有第一个产出文本的节点会走「扫描全部输出」的兜底，之后所有节点都不会。
 *    收进本模块后，判定天然基于**本节点局部数组**，两条路径因此等价。
 */

/** 文本类输出的优先键名（原先两处各写一份，现为唯一来源） */
export const TEXT_OUTPUT_KEYS = ["text", "texts", "STRING", "string", "tags", "csv"] as const;

/**
 * 单个输出值的文本提取：
 * - 数组：先过滤掉对象等非法项；**全为单字符时拼接成一条**（部分节点的字符串是按字符拆开输出的），
 *   否则逐项转字符串；
 * - 字符串/数字：去空白后非空才收；
 * - 其它类型（对象、null、undefined、布尔…）一律忽略，不抛错。
 */
function pushTextValue(texts: string[], value: unknown): void {
  if (Array.isArray(value)) {
    const validValues = value.filter((item) => typeof item === "string" || typeof item === "number");
    if (validValues.length === 0) return;
    if (validValues.length > 1 && validValues.every((item) => typeof item === "string" && item.length === 1)) {
      texts.push((validValues as string[]).join(""));
    } else {
      texts.push(...validValues.map(String));
    }
    return;
  }
  if (typeof value === "string" || typeof value === "number") {
    const strValue = String(value);
    if (strValue.trim().length > 0) {
      texts.push(strValue);
    }
  }
}

/**
 * 从一个节点的 `outputs` 提取文本。
 * 优先看 {@link TEXT_OUTPUT_KEYS}；**本节点**一个都没命中时，扫描它的全部输出作为兜底。
 *
 * 注意 `texts` 是本次调用的局部数组，`texts.length === 0` 只代表**本节点**没有有序键文本——
 * 这正是修复点，不可改成读取外部累积值。
 */
export function collectNodeTexts(outputs: Record<string, unknown> | null | undefined): string[] {
  const texts: string[] = [];
  if (!outputs) return texts;

  for (const key of TEXT_OUTPUT_KEYS) {
    pushTextValue(texts, outputs[key]);
  }
  if (texts.length === 0) {
    for (const value of Object.values(outputs)) {
      pushTextValue(texts, value);
    }
  }
  return texts;
}

/**
 * 从一个节点的 `outputs` 提取图片。
 * `nodeTitle` 由调用方算好传入——两条路径的取值口径本就不同
 * （`runPrompt` 兜底到 nodeId，`extractHistory` 允许 undefined），此处不做统一以避免行为变化。
 */
export function collectNodeImages(
  outputs: Record<string, unknown> | null | undefined,
  nodeTitle: string | undefined,
  viewUrl: (image: { filename: string; subfolder?: string; type?: string }) => string,
): OutputImage[] {
  const images: OutputImage[] = [];
  const imageList = outputs?.images;
  if (!Array.isArray(imageList)) return images;

  for (const image of imageList) {
    if (typeof image === "object" && image && "filename" in image) {
      const normalized = image as { filename: string; subfolder?: string; type?: string };
      images.push({
        filename: normalized.filename,
        subfolder: normalized.subfolder,
        type: normalized.type,
        url: viewUrl(normalized),
        nodeTitle,
      });
    }
  }
  return images;
}

/**
 * 把一批结果并入累积结果：
 * - 图片按 `url` 去重；
 * - 文本按**内容**去重（同一节点同时输出 `tags` 与 `text` 时内容相同，会在这里合并成一条）；
 * - 两者都保持首次出现的顺序。
 *
 * `acc` 为 `null` 时新建；否则**原地累加并返回同一对象**（与原实现的对象标识一致）。
 */
export function mergeJobResult(
  acc: JobResult | null,
  promptId: string,
  images: OutputImage[],
  texts: string[],
): JobResult {
  const result: JobResult = acc ?? { promptId, images: [], texts: [], rawHistory: {} };

  for (const image of images) {
    if (!result.images.some((existing) => existing.url === image.url)) {
      result.images.push(image);
    }
  }
  for (const text of texts) {
    if (!result.texts.includes(text)) {
      result.texts.push(text);
    }
  }
  return result;
}
