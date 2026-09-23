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

/* ------------------------------------------------------------------ *
 * 在线编辑（T9）：读写由 server/wildcards.ts 插件提供（/xyz/wildcards）
 * ------------------------------------------------------------------ */

export type WildcardFileState = {
  name: string;
  content: string;
  /** 服务端文件缺失时为 true（例如首次克隆仓库后未生成），保存时视为空词库 */
  missing: boolean;
  revision: number;
};

export async function listWildcardFiles(): Promise<WildcardFileState[]> {
  const res = await fetch("/xyz/wildcards");
  if (!res.ok) throw new Error(`词库读取失败（HTTP ${res.status}）`);
  const data = (await res.json()) as { success?: boolean; files?: WildcardFileState[] };
  if (!data.files) throw new Error("词库接口返回异常");
  return data.files;
}

export async function saveWildcardFile(name: string, content: string, baseRevision: number): Promise<number> {
  const res = await fetch("/xyz/wildcards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, content, baseRevision }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    revision?: number;
    error?: string;
  };
  if (!res.ok) {
    // 409 = 并发冲突，把服务端给的最新 revision 带回去让 UI 提示刷新
    const error = new Error(data.error ?? `词库保存失败（HTTP ${res.status}）`) as Error & { conflict?: boolean };
    if (res.status === 409) error.conflict = true;
    throw error;
  }
  if (typeof data.revision !== "number") throw new Error("词库保存返回异常");
  return data.revision;
}