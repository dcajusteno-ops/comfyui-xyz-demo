import { setWildcardRegistry, type WildcardMap } from "./dynamicPrompt";

export const WILDCARD_FILES = ["styles", "lighting", "camera", "quality"] as const;

/** 解析通配符 txt：# 注释、空行忽略、逐行去重 */
export function parseWildcardTxt(content: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/** 惰性加载内置词库，成功后写入动态提示的模块级注册表 */
export async function loadWildcards(): Promise<WildcardMap> {
  const map: WildcardMap = {};
  await Promise.all(
    WILDCARD_FILES.map(async (name) => {
      try {
        const res = await fetch(`/wildcards/${name}.txt`);
        if (!res.ok) return;
        const entries = parseWildcardTxt(await res.text());
        if (entries.length) map[name] = entries;
      } catch {
        // 单个文件加载失败不阻塞其它词库
      }
    }),
  );
  setWildcardRegistry(map);
  return map;
}

export type WildcardSummary = { name: string; count: number; preview: string[] };

export function describeWildcards(map: WildcardMap): WildcardSummary[] {
  return Object.entries(map).map(([name, entries]) => ({
    name,
    count: entries.length,
    preview: entries.slice(0, 8),
  }));
}