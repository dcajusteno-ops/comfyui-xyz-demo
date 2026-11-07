import type { BaseGenerationParams, MultiGenerationParams } from "../types";

/**
 * 「追加词条到目标模板正向提示词」的 updater。
 * multi 用 globalPrompt，其余模板用 positivePrompt；dedupe=true 时按逗号切分去重
 * （幸运大转盘 / 手机标签），false 时原样追加（触发词 / 提示词仓库）。
 */
export function appendPromptUpdater<T extends BaseGenerationParams | MultiGenerationParams>(
  text: string,
  options: { useGlobal: boolean; dedupe: boolean },
) {
  return (prev: T): T => {
    const key = options.useGlobal ? "globalPrompt" : "positivePrompt";
    const current = String((prev as unknown as Record<string, unknown>)[key] ?? "").trim();
    let addition = text;
    if (options.dedupe) {
      const existing = new Set(current.split(/[,，]/).map((part) => part.trim().toLowerCase()));
      const toAdd = text
        .split(/[,，]/)
        .map((part) => part.trim())
        .filter((part) => part && !existing.has(part.toLowerCase()));
      if (toAdd.length === 0) return prev;
      addition = toAdd.join(", ");
    }
    return { ...prev, [key]: current ? `${current}, ${addition}` : addition } as T;
  };
}
