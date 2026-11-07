import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Folder, FolderOpen, Home, Loader2, RefreshCw, Settings2, Trash2 } from "lucide-react";

import { ImageLightbox } from "../../ImageLightbox";
import { PanelTitle, Select } from "../../ui";
import {
  IMAGE_PAGE_SIZE,
  formatBytes,
  imageFileUrl,
  isInside,
  joinPath,
  resolveDatasetDir,
  splitBreadcrumb,
  type ImageSortDir,
  type ImageSortKey,
} from "../../../lib/imageManager";
import { useImageManager } from "../../../hooks/useImageManager";
import type { Toast } from "../../../types";
import { RootDirDialog } from "./RootDirDialog";

type PushToast = (type: Toast["type"], title: string, message?: string) => void;

const SORT_OPTIONS = [
  { value: "name:asc", label: "名称 A→Z" },
  { value: "name:desc", label: "名称 Z→A" },
  { value: "mtime:desc", label: "时间 新→旧" },
  { value: "mtime:asc", label: "时间 旧→新" },
];

export type ImageManagerFocus = { dir: string; nonce: number };

export type ImageManagerPanelProps = {
  /** 数据集工作台跳转时带来的落点（相对 ComfyUI 输出目录的路径） */
  focus?: ImageManagerFocus | null;
  confirm: (title: string, message: string, onConfirm: () => void) => void;
  pushToast: PushToast;
};

function formatDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ImageManagerPanel({ focus, confirm, pushToast }: ImageManagerPanelProps) {
  const api = useImageManager();
  const [rootOpen, setRootOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const appliedFocus = useRef(0);
  const {
    config,
    configLoading,
    listing,
    loading,
    deleting,
    error,
    selection,
    visibleImages,
    imagePaths,
    total,
    truncated,
    hasMore,
  } = api;

  // 数据集按钮跳转：把 <output>/<filenameRoot> 解析成绝对路径再打开
  useEffect(() => {
    if (!focus) return;
    if (appliedFocus.current === focus.nonce) return;
    if (!config) return;
    appliedFocus.current = focus.nonce;

    void (async () => {
      const base = config.outputDir || config.rootDir;
      if (!base) {
        pushToast("info", "没有落点", "未探测到 ComfyUI 输出目录，请先设置根目录");
        return;
      }
      const target = resolveDatasetDir(base, focus.dir);
      if (!target) {
        pushToast("info", "没有落点", "未探测到 ComfyUI 输出目录，请先设置根目录");
        return;
      }
      if (config.rootDir && config.outputDir && !isInside(config.rootDir, target)) {
        try {
          await api.saveRoot(config.outputDir);
          pushToast("info", "已切换根目录", "目标目录不在原根目录内，已切换为 ComfyUI 输出目录");
        } catch (saveError) {
          pushToast("error", "切换根目录失败", saveError instanceof Error ? saveError.message : String(saveError));
          return;
        }
      }
      await api.goTo(target);
    })();
  }, [focus, config, api, pushToast]);

  const currentDir = listing?.dir ?? "";
  const previewImage = previewIndex == null ? null : api.sortedImages[previewIndex] ?? null;
  const previewPath = previewImage ? joinPath(currentDir, previewImage.name) : "";

  // 换目录 / 图片被删掉后，别让灯箱停在越界的下标上
  useEffect(() => {
    setPreviewIndex(null);
  }, [currentDir]);

  useEffect(() => {
    if (previewIndex == null) return;
    if (previewIndex >= api.sortedImages.length) setPreviewIndex(null);
  }, [previewIndex, api.sortedImages.length]);

  /** 灯箱左右切换：环形，走完整目录（不只是当前加载的 48 张） */
  const stepPreview = (delta: number) => {
    if (previewIndex == null) return;
    const count = api.sortedImages.length;
    if (count === 0) return;
    const next = (previewIndex + delta + count) % count;
    api.revealIndex(next);
    setPreviewIndex(next);
  };

  const requestDelete = useCallback(() => {
    const count = selection.size;
    if (count === 0) return;
    const permanent = !api.trashEnabled;
    confirm(
      permanent ? "永久删除图片" : "删除图片",
      permanent
        ? `已关闭「移到回收站」，将永久删除选中的 ${count} 张图片，无法恢复。`
        : `将把选中的 ${count} 张图片移到 Windows 回收站，可在资源管理器里还原。`,
      () => {
        void (async () => {
          try {
            const outcome = await api.deleteSelected();
            if (outcome.failed === 0 && outcome.deleted > 0) {
              if (outcome.mode === "delete") {
                pushToast("success", "已永久删除", `已删除 ${outcome.deleted} 张，无法恢复`);
              } else {
                pushToast("success", "已移到回收站", `已删除 ${outcome.deleted} 张，可在回收站还原`);
              }
            } else if (outcome.deleted > 0) {
              pushToast("error", "部分删除失败", `成功 ${outcome.deleted} 张，失败 ${outcome.failed} 张：${outcome.firstError ?? ""}`);
            } else {
              pushToast("error", "删除失败", outcome.firstError ?? "没有文件被删除");
            }
          } catch (deleteError) {
            pushToast("error", "删除失败", deleteError instanceof Error ? deleteError.message : String(deleteError));
          }
        })();
      },
    );
  }, [api, confirm, pushToast, selection.size]);

  const applyRoot = useCallback(
    async (dir: string) => {
      try {
        const next = await api.saveRoot(dir);
        setRootOpen(false);
        pushToast("success", "默认根目录已更新", next.rootDir);
        await api.goTo(next.rootDir);
      } catch (saveError) {
        pushToast("error", "保存根目录失败", saveError instanceof Error ? saveError.message : String(saveError));
      }
    },
    [api, pushToast],
  );

  const toggleTrash = (enabled: boolean) => {
    void api.setTrashEnabled(enabled).catch((saveError: unknown) => {
      pushToast("error", "保存删除方式失败", saveError instanceof Error ? saveError.message : String(saveError));
    });
  };

  const crumbs = config?.rootDir && listing ? splitBreadcrumb(config.rootDir, listing.dir) : [];
  const folders = listing?.folders ?? [];
  const sortValue = `${api.state.sortKey}:${api.state.sortDir}`;
  const atRoot = Boolean(config?.rootDir && listing && currentDir.toLowerCase() === config.rootDir.toLowerCase());

  return (
    <section className="panel im-panel">
      <div className="panel-header im-header">
        <PanelTitle icon={FolderOpen} title="图片管理" />
        <span className="im-root" title={config?.rootDir || "尚未设置默认根目录"}>
          <Home size={14} />
          <span className="im-root-path">{config?.rootDir || "未设置根目录"}</span>
          {config?.rootSource === "detected" && <em className="im-root-tag">自动探测</em>}
        </span>
        <button type="button" className="secondary-action" onClick={() => setRootOpen(true)}>
          <Settings2 size={14} /> 根目录…
        </button>
        <button type="button" className="secondary-action" disabled={!config?.rootDir || loading} onClick={api.goRoot}>
          <Home size={14} /> 回到根目录
        </button>
        <button type="button" className="secondary-action" disabled={!config?.rootDir || loading} onClick={api.refresh}>
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      <div className="im-toolbar">
        <div className="im-crumbs">
          {crumbs.length === 0 && <span className="im-muted">—</span>}
          {crumbs.map((crumb, index) => (
            <span key={crumb.path} className="im-crumb-item">
              {index > 0 && <ChevronRight size={12} className="im-crumb-sep" />}
              <button
                type="button"
                className="im-crumb"
                title={crumb.path}
                disabled={loading || crumb.path === listing?.dir}
                onClick={() => void api.goTo(crumb.path)}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        <span className="im-spacer" />

        <div className="im-sort">
          <span>排序</span>
          <Select
            ariaLabel="排序方式"
            size="sm"
            align="right"
            value={sortValue}
            options={SORT_OPTIONS}
            onChange={(next) => {
              const [key, dir] = next.split(":");
              api.setSortKey(key as ImageSortKey);
              api.setSortDir(dir as ImageSortDir);
            }}
          />
        </div>
        <button type="button" className="ghost-btn" disabled={imagePaths.length === 0} onClick={api.selectAll}>
          全选
        </button>
        <button type="button" className="ghost-btn" disabled={imagePaths.length === 0} onClick={api.invertSelection}>
          反选
        </button>
        <button type="button" className="ghost-btn" disabled={selection.size === 0} onClick={api.clearSelection}>
          清空
        </button>
        <label
          className={`im-trash-toggle${api.trashEnabled ? "" : " is-off"}`}
          title={
            api.trashEnabled
              ? "当前删除会移到 Windows 回收站，可在资源管理器还原；取消勾选后直接永久删除"
              : "当前删除会直接永久删除、不进回收站，请谨慎操作"
          }
        >
          <input
            type="checkbox"
            checked={api.trashEnabled}
            disabled={deleting}
            onChange={(event) => toggleTrash(event.target.checked)}
          />
          <span>移到回收站</span>
        </label>
        <button
          type="button"
          className={`im-danger${api.trashEnabled ? "" : " is-permanent"}`}
          disabled={selection.size === 0 || deleting}
          onClick={requestDelete}
        >
          {deleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
          {api.trashEnabled ? "删除" : "永久删除"}（{selection.size}）
        </button>
      </div>

      <div className="im-body">
        <aside className="im-side">
          <div className="im-side-head">子文件夹（{folders.length}）</div>
          <div className="im-folders">
            {folders.map((name) => (
              <button
                key={name}
                type="button"
                className="im-folder"
                title={joinPath(currentDir, name)}
                onClick={() => void api.goTo(joinPath(currentDir, name))}
              >
                <Folder size={14} />
                <span>{name}</span>
              </button>
            ))}
            {listing && folders.length === 0 && <p className="im-muted im-side-empty">（无子文件夹）</p>}
          </div>
        </aside>

        <div className="im-main">
          <div className="im-scroll">
            {configLoading && <p className="im-state">正在读取根目录…</p>}
            {!configLoading && !config?.rootDir && (
              <div className="im-state im-state-empty">
                <FolderOpen size={40} />
                <h3>还没有可用的默认根目录</h3>
                <p>
                  没有探测到 ComfyUI 的输出目录（ComfyUI 不在本机或使用了自定义启动参数）。
                  请手动选择一个文件夹，之后的浏览与删除都以它为范围。
                </p>
                <button type="button" className="secondary-action" onClick={() => setRootOpen(true)}>
                  <Settings2 size={14} /> 选择根目录
                </button>
              </div>
            )}
            {!configLoading && config?.rootDir && loading && !listing && <p className="im-state">正在读取目录…</p>}
            {!configLoading && config?.rootDir && error && (
              <div className="im-state im-state-empty">
                <p>读取失败：{error}</p>
                <button type="button" className="secondary-action" onClick={api.refresh}>
                  <RefreshCw size={14} /> 重试
                </button>
              </div>
            )}
            {listing && (
              <>
                {visibleImages.length === 0 && <p className="im-state">此文件夹没有图片（只显示 png / jpg / webp / gif / avif / bmp）。</p>}
                <div className="im-grid">
                  {visibleImages.map((image, index) => {
                    const path = joinPath(currentDir, image.name);
                    const selected = selection.has(path);
                    return (
                      <figure key={image.name} className={`im-thumb${selected ? " is-selected" : ""}`}>
                        <button
                          type="button"
                          className="im-thumb-open"
                          title={`预览 ${image.name}（← → 切换）`}
                          onClick={() => setPreviewIndex(index)}
                        >
                          <img src={imageFileUrl(path)} alt={image.name} loading="lazy" decoding="async" />
                        </button>
                        <label className="im-check" title="选中">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => api.toggleSelect(path)}
                            aria-label={`选中 ${image.name}`}
                          />
                        </label>
                        <figcaption>
                          <span className="im-thumb-name" title={image.name}>
                            {image.name}
                          </span>
                          <span className="im-thumb-meta">
                            {formatBytes(image.size)} · {formatDate(image.mtime)}
                          </span>
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
                <div className="im-list-foot">
                  <span className="im-muted">
                    已显示 {visibleImages.length} / {total} 张
                    {truncated ? `（目录内图片超过上限，仅列出前 ${total} 张）` : ""}
                  </span>
                  {hasMore && (
                    <button type="button" className="secondary-action" onClick={api.loadMore}>
                      加载更多（每次 {IMAGE_PAGE_SIZE} 张）
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="im-statusbar">
            <button type="button" className="ghost-btn" disabled={!listing || atRoot || loading} onClick={api.goUp}>
              上一级
            </button>
            <span className="im-path" title={listing?.dir || ""}>
              {listing?.dir || "—"}
            </span>
            <span className="im-spacer" />
            <span className="im-muted">
              {selection.size > 0 ? `已标记 ${selection.size} 张待删除` : "点击图片预览（← → 切换），勾选或标记删除"}
            </span>
          </div>
        </div>
      </div>

      {previewImage && previewIndex != null && (
        <ImageLightbox
          url={imageFileUrl(previewPath)}
          caption={previewImage.name}
          position={{ index: previewIndex + 1, total: api.sortedImages.length }}
          marked={selection.has(previewPath)}
          markedCount={selection.size}
          onToggleMark={() => api.toggleSelect(previewPath)}
          onPrev={api.sortedImages.length > 1 ? () => stepPreview(-1) : undefined}
          onNext={api.sortedImages.length > 1 ? () => stepPreview(1) : undefined}
          onClose={() => setPreviewIndex(null)}
        />
      )}

      {rootOpen && (
        <RootDirDialog
          drives={config?.drives ?? []}
          detectedDir={config?.outputDir ?? ""}
          detectedExists={config?.outputDirExists ?? false}
          initialDir={config?.savedRootDir || config?.rootDir || config?.outputDir || ""}
          onClose={() => setRootOpen(false)}
          onApply={(dir) => void applyRoot(dir)}
        />
      )}
    </section>
  );
}
