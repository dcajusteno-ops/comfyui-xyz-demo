import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_IMAGE_MANAGER_STATE,
  IMAGE_PAGE_SIZE,
  isInside,
  joinPath,
  normalizeDir,
  normalizeImageManagerState,
  parentOf,
  sortImages,
  type BrowseResult,
  type ImageConfig,
  type ImageManagerState,
  type ImageSortDir,
  type ImageSortKey,
} from "../lib/imageManager";
import { usePersistentState } from "./usePersistentState";

const JSON_HEADERS = { "Content-Type": "application/json" };

export type DeleteOutcome = { deleted: number; failed: number; firstError?: string; mode: "trash" | "delete" };

/**
 * 图片管理器的数据层：根目录配置（服务端）+ 当前目录（ui-state）+ 列表/选中/删除。
 *
 * 选中项存绝对路径（服务端 delete 收的就是绝对路径），切目录即清空。
 */
export function useImageManager() {
  const [state, setState] = usePersistentState<ImageManagerState>(
    "comfyui_image_manager",
    DEFAULT_IMAGE_MANAGER_STATE,
    normalizeImageManagerState,
  );
  const [config, setConfig] = useState<ImageConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [listing, setListing] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [visibleCount, setVisibleCount] = useState(IMAGE_PAGE_SIZE);
  const [deleting, setDeleting] = useState(false);
  const seqRef = useRef(0);
  const bootedRef = useRef(false);

  const reloadConfig = useCallback(async (): Promise<ImageConfig | null> => {
    setConfigLoading(true);
    try {
      const response = await fetch("/xyz/images/config");
      const data = (await response.json()) as ImageConfig;
      setConfig(data);
      return data;
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      return null;
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const goTo = useCallback(
    async (dir: string) => {
      const target = normalizeDir(dir);
      if (!target) return;
      const seq = ++seqRef.current;
      setLoading(true);
      setError("");

      const request = async (next: string): Promise<BrowseResult> => {
        const response = await fetch(`/xyz/images/browse?dir=${encodeURIComponent(next)}`);
        return (await response.json()) as BrowseResult;
      };

      try {
        let data = await request(target);
        if (seq !== seqRef.current) return;
        // 目录被删/改名时服务端给最近存在祖先，直接回落到那里（只回落一次，防死循环）
        if (!data.success) {
          const nearest = normalizeDir(data.nearest ?? "");
          if (nearest && nearest !== target) {
            data = await request(nearest);
            if (seq !== seqRef.current) return;
          }
        }
        if (!data.success) {
          setListing(null);
          setError(data.error || "目录读取失败");
          return;
        }
        setListing(data);
        setSelection(new Set());
        setVisibleCount(IMAGE_PAGE_SIZE);
        setState((prev) => ({ ...prev, currentDir: data.dir }));
      } catch (fetchError) {
        if (seq !== seqRef.current) return;
        setListing(null);
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [setState],
  );

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void (async () => {
      const data = await reloadConfig();
      if (!data) return;
      const remembered = normalizeDir(state.currentDir);
      const start = data.rootDir && isInside(data.rootDir, remembered) ? remembered : data.rootDir;
      if (start) await goTo(start);
    })();
  }, [goTo, reloadConfig, state.currentDir]);

  const refresh = useCallback(() => {
    const current = listing?.dir || state.currentDir || config?.rootDir || "";
    if (current) void goTo(current);
  }, [listing, state.currentDir, config, goTo]);

  const goRoot = useCallback(() => {
    if (config?.rootDir) void goTo(config.rootDir);
  }, [config, goTo]);

  const goUp = useCallback(() => {
    const current = normalizeDir(listing?.dir || state.currentDir);
    const root = normalizeDir(config?.rootDir ?? "");
    // 面板的范围就是默认根目录：到根后不再向上（要换范围请改根目录）
    if (root && current === root) return;
    const parent = parentOf(current);
    if (parent) void goTo(parent);
  }, [listing, state.currentDir, config, goTo]);

  const saveRoot = useCallback(async (dir: string): Promise<ImageConfig> => {
    const response = await fetch("/xyz/images/config", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ rootDir: dir }),
    });
    const data = (await response.json()) as ImageConfig & { error?: string };
    if (!response.ok || !data.success) throw new Error(data.error || `保存根目录失败（${response.status}）`);
    setConfig(data);
    return data;
  }, []);

  /** 删除到回收站 / 直接永久删除：写服务端 data/image-settings.json（先乐观切换，失败回滚） */
  const setTrashEnabled = useCallback(async (value: boolean) => {
    setConfig((prev) => (prev ? { ...prev, trashEnabled: value } : prev));
    try {
      const response = await fetch("/xyz/images/config", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ trashEnabled: value }),
      });
      const data = (await response.json()) as ImageConfig & { error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || `保存失败（${response.status}）`);
      setConfig(data);
    } catch (error) {
      setConfig((prev) => (prev ? { ...prev, trashEnabled: !value } : prev));
      throw error;
    }
  }, []);

  /** 灯箱翻到第 N 张时，把网格的可见窗口撑到能包含它 */
  const revealIndex = useCallback((index: number) => {
    setVisibleCount((count) => Math.max(count, index + 1));
  }, []);

  const sortedImages = useMemo(
    () => (listing ? sortImages(listing.images, state.sortKey, state.sortDir) : []),
    [listing, state.sortKey, state.sortDir],
  );

  const visibleImages = useMemo(() => sortedImages.slice(0, visibleCount), [sortedImages, visibleCount]);

  const imagePaths = useMemo(() => {
    const dir = listing?.dir ?? "";
    return sortedImages.map((item) => joinPath(dir, item.name));
  }, [listing, sortedImages]);

  const toggleSelect = useCallback((path: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelection(new Set(imagePaths));
  }, [imagePaths]);

  const invertSelection = useCallback(() => {
    setSelection((prev) => {
      const next = new Set<string>();
      for (const path of imagePaths) if (!prev.has(path)) next.add(path);
      return next;
    });
  }, [imagePaths]);

  const clearSelection = useCallback(() => setSelection(new Set()), []);

  const loadMore = useCallback(() => setVisibleCount((count) => count + IMAGE_PAGE_SIZE), []);

  const setSortKey = useCallback(
    (sortKey: ImageSortKey) => setState((prev) => ({ ...prev, sortKey })),
    [setState],
  );
  const setSortDir = useCallback(
    (sortDir: ImageSortDir) => setState((prev) => ({ ...prev, sortDir })),
    [setState],
  );

  const deleteSelected = useCallback(async (): Promise<DeleteOutcome> => {
    const paths = [...selection];
    if (paths.length === 0) return { deleted: 0, failed: 0, mode: "trash" };
    setDeleting(true);
    try {
      const response = await fetch("/xyz/images/delete", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ paths }),
      });
      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        deleted?: string[];
        failed?: { path: string; error: string }[];
        mode?: string;
      };
      if (!response.ok || !data.success) throw new Error(data.error || `删除失败（${response.status}）`);

      const deleted = new Set(data.deleted ?? []);
      const failed = data.failed ?? [];
      setListing((prev) => {
        if (!prev) return prev;
        const images = prev.images.filter((item) => !deleted.has(joinPath(prev.dir, item.name)));
        return { ...prev, images, total: Math.max(0, prev.total - deleted.size) };
      });
      // 失败项保留选中，方便重试；成功项自然消失
      setSelection(new Set(failed.map((item) => item.path)));
      return {
        deleted: deleted.size,
        failed: failed.length,
        firstError: failed[0]?.error,
        mode: data.mode === "delete" ? "delete" : "trash",
      };
    } finally {
      setDeleting(false);
    }
  }, [selection]);

  return {
    state,
    config,
    configLoading,
    listing,
    loading,
    deleting,
    error,
    selection,
    sortedImages,
    visibleImages,
    imagePaths,
    total: listing?.total ?? 0,
    truncated: listing?.truncated ?? false,
    hasMore: sortedImages.length > visibleCount,
    trashEnabled: config?.trashEnabled !== false,
    reloadConfig,
    goTo,
    goUp,
    goRoot,
    refresh,
    saveRoot,
    setTrashEnabled,
    revealIndex,
    loadMore,
    setSortKey,
    setSortDir,
    toggleSelect,
    selectAll,
    invertSelection,
    clearSelection,
    deleteSelected,
  };
}
