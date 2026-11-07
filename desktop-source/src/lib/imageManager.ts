/**
 * 图片管理器的纯函数（路径 / 排序 / 持久化归一化）。
 *
 * 路径一律按 Windows 语义处理：服务端返回的是 `F:\...\output`，
 * 前端不做 `path.resolve`，只做拼接与拆分，避免把 `\` 和 `/` 混在一起。
 */
export type ImageEntry = { name: string; size: number; mtime: number };

export type ImageConfig = {
  success: boolean;
  rootDir: string;
  rootSource: "saved" | "detected" | "none";
  savedRootDir: string;
  outputDir: string;
  outputDirSource: string;
  outputDirExists: boolean;
  rootExists: boolean;
  /** 删除是否进回收站；false = 直接永久删除 */
  trashEnabled: boolean;
  drives: string[];
};

export type BrowseResult = {
  success: boolean;
  dir: string;
  parent: string | null;
  folders: string[];
  images: ImageEntry[];
  total: number;
  truncated: boolean;
  error?: string;
  nearest?: string;
};

export type ImageSortKey = "name" | "mtime";
export type ImageSortDir = "asc" | "desc";

export type ImageManagerState = {
  currentDir: string;
  sortKey: ImageSortKey;
  sortDir: ImageSortDir;
};

export const IMAGE_PAGE_SIZE = 48;

export const DEFAULT_IMAGE_MANAGER_STATE: ImageManagerState = {
  currentDir: "",
  sortKey: "name",
  sortDir: "asc",
};

const DRIVE_ROOT_RE = /^[a-zA-Z]:\\$/;

/** 统一分隔符、去尾部反斜杠、盘符大写；`F:\` 这类盘根保持原样 */
export function normalizeDir(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  let next = trimmed.replace(/\//g, "\\");
  if (!DRIVE_ROOT_RE.test(next)) next = next.replace(/\\+$/, "");
  if (/^[a-zA-Z]:/.test(next)) next = next[0].toUpperCase() + next.slice(1);
  return next;
}

export function isAbsoluteDir(value: string): boolean {
  const normalized = normalizeDir(value);
  return /^[a-zA-Z]:\\/.test(normalized) || normalized.startsWith("\\\\");
}

export function joinPath(base: string, child: string): string {
  const head = normalizeDir(base);
  const tail = String(child ?? "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/^\\+/, "")
    .replace(/\\+$/, "");
  if (!head) return tail;
  if (!tail) return head;
  return head.endsWith("\\") ? `${head}${tail}` : `${head}\\${tail}`;
}

export function baseName(dir: string): string {
  const normalized = normalizeDir(dir);
  if (!normalized) return "";
  if (DRIVE_ROOT_RE.test(normalized)) return normalized;
  const index = normalized.lastIndexOf("\\");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

/** 盘根返回 null（上级到此为止） */
export function parentOf(dir: string): string | null {
  const normalized = normalizeDir(dir);
  if (!normalized || DRIVE_ROOT_RE.test(normalized)) return null;
  if (normalized.startsWith("\\\\")) return null;
  const index = normalized.lastIndexOf("\\");
  if (index < 0) return null;
  const parent = normalized.slice(0, index);
  if (!parent) return null;
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}\\` : parent;
}

/** Windows 路径大小写不敏感；必须按分隔符边界判断，防 `output2` 被当成 `output` 内 */
export function isInside(root: string, dir: string): boolean {
  const base = normalizeDir(root).toLowerCase();
  const child = normalizeDir(dir).toLowerCase();
  if (!base || !child) return false;
  if (child === base) return true;
  return child.startsWith(base.endsWith("\\") ? base : `${base}\\`);
}

export type Crumb = { name: string; path: string };

/** 从根目录到当前目录的面包屑；当前目录不在根内时只给出根 */
export function splitBreadcrumb(root: string, dir: string): Crumb[] {
  const base = normalizeDir(root);
  const current = normalizeDir(dir);
  if (!base) return [];
  if (!current || !isInside(base, current)) return [{ name: baseName(base) || base, path: base }];

  const crumbs: Crumb[] = [{ name: baseName(base) || base, path: base }];
  const rest = current.slice(base.length).replace(/^\\+/, "");
  if (!rest) return crumbs;

  let cursor = base.endsWith("\\") ? base.slice(0, -1) : base;
  for (const part of rest.split("\\").filter(Boolean)) {
    cursor = `${cursor}\\${part}`;
    crumbs.push({ name: part, path: cursor });
  }
  return crumbs;
}

/** 文件名用自然序（001 / 002 / 010 才不会排成 1 / 10 / 2） */
export function sortImages(images: ImageEntry[], key: ImageSortKey, dir: ImageSortDir): ImageEntry[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...images].sort((a, b) => {
    if (key === "mtime" && a.mtime !== b.mtime) return (a.mtime - b.mtime) * factor;
    const byName = a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
    if (byName !== 0) return byName * factor;
    return (a.mtime - b.mtime) * factor;
  });
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 数据集按钮的落点：ComfyUI 的 `filename_prefix` 最后一段是文件名前缀，
 * 所以图片就在 `<output>/<filenameRoot>` 本身——**不要 dirname**。
 * （`lib/dataset/build.ts` 会把它拼成 `<filenameRoot>/001` 再交给 SaveImage）
 */
export function datasetRootToDir(filenameRoot: string): string {
  return normalizeDir(String(filenameRoot ?? ""));
}

/** 把数据集传来的相对目录解析成绝对路径；已经是绝对路径就直接用 */
export function resolveDatasetDir(outputDir: string, filenameRoot: string): string {
  const relative = datasetRootToDir(filenameRoot);
  if (!relative) return normalizeDir(outputDir);
  if (isAbsoluteDir(relative)) return relative;
  return joinPath(outputDir, relative);
}

export function imageFileUrl(path: string): string {
  return `/xyz/images/file?path=${encodeURIComponent(path)}`;
}

export function normalizeImageManagerState(
  merged: ImageManagerState,
  raw: unknown,
): ImageManagerState {
  const source = (raw ?? {}) as Partial<ImageManagerState>;
  const sortKey: ImageSortKey = source.sortKey === "mtime" ? "mtime" : "name";
  const sortDir: ImageSortDir = source.sortDir === "desc" ? "desc" : "asc";
  return {
    currentDir: normalizeDir(String(merged.currentDir ?? "")),
    sortKey,
    sortDir,
  };
}
