import { useRef, useState } from "react";
import { ImagePlus, Link2, Trash2, Upload } from "lucide-react";
import { CONFIG } from "../../config";
import { DEFAULT_WALLPAPER_DIM, WALLPAPER_REF_RE, WALLPAPER_ROUTE_PREFIX, sanitizeUrl } from "../../lib/theme";
import type { WallpaperConfig, WallpaperFit } from "../../lib/theme";

const MAX_WALLPAPER_BYTES = CONFIG.THEME.MAX_WALLPAPER_BYTES;
const ACCEPTED_TYPES = CONFIG.THEME.WALLPAPER_ACCEPT;

const FIT_OPTIONS: { value: WallpaperFit; label: string }[] = [
  { value: "cover", label: "铺满（裁切）" },
  { value: "contain", label: "完整显示（留边）" },
  { value: "auto", label: "原始尺寸" },
];

function wallpaperUrl(wp: WallpaperConfig): string {
  if (wp.kind === "file" && WALLPAPER_REF_RE.test(wp.ref ?? "")) {
    return `${WALLPAPER_ROUTE_PREFIX}/${wp.ref}`;
  }
  if (wp.kind === "url") return sanitizeUrl(wp.url);
  return "";
}

export function WallpaperEditor({
  wallpaper,
  disabled,
  onChange,
}: {
  wallpaper: WallpaperConfig;
  disabled: boolean;
  onChange: (next: WallpaperConfig) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const patch = (next: Partial<WallpaperConfig>) => onChange({ ...wallpaper, ...next });

  const upload = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("只支持图片文件");
      return;
    }
    if (file.size > MAX_WALLPAPER_BYTES) {
      setError(`图片超过 ${Math.floor(MAX_WALLPAPER_BYTES / 1024 / 1024)}MB`);
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("image", file);
      const res = await fetch(WALLPAPER_ROUTE_PREFIX, { method: "POST", body: form });
      const body = (await res.json()) as { success?: boolean; ref?: string; error?: string };
      if (!res.ok || !body.success || !body.ref) {
        setError(body.error || `上传失败（${res.status}）`);
        return;
      }
      patch({ kind: "file", ref: body.ref, url: undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const preview = wallpaperUrl(wallpaper);
  const urlDraft = wallpaper.kind === "url" ? wallpaper.url ?? "" : "";
  const urlValid = wallpaper.kind === "url" ? sanitizeUrl(wallpaper.url) !== "" : true;

  return (
    <div className="theme-editor-body">
      <div className="theme-segmented">
        <button
          type="button"
          className={wallpaper.kind === "none" ? "active" : ""}
          onClick={() => patch({ kind: "none" })}
        >
          不使用
        </button>
        <button
          type="button"
          className={wallpaper.kind === "file" ? "active" : ""}
          disabled={disabled}
          onClick={() => patch({ kind: "file" })}
        >
          <Upload size={13} /> 本地上传
        </button>
        <button
          type="button"
          className={wallpaper.kind === "url" ? "active" : ""}
          disabled={disabled}
          onClick={() => patch({ kind: "url" })}
        >
          <Link2 size={13} /> 图片 URL
        </button>
      </div>

      {wallpaper.kind === "file" && (
        <div
          className={dragOver ? "theme-dropzone drag-over" : "theme-dropzone"}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void upload(file);
          }}
        >
          <ImagePlus size={20} />
          <p>{busy ? "上传中…" : "把图片拖到这里，或"}</p>
          <button type="button" className="theme-link-btn" disabled={disabled || busy} onClick={() => fileRef.current?.click()}>
            选择文件
          </button>
          <span className="theme-dim">PNG / JPEG / WebP / GIF / AVIF，单张 ≤ 20MB</span>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_TYPES}
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {wallpaper.kind === "url" && (
        <label className="theme-field">
          <span>图片地址</span>
          <input
            type="text"
            value={urlDraft}
            disabled={disabled}
            spellCheck={false}
            placeholder="https://…"
            onChange={(e) => patch({ url: e.target.value })}
          />
          {!urlValid && <em className="theme-error">只支持 http/https/data:image 地址</em>}
          {urlValid && urlDraft !== "" && (
            <em className="theme-dim">网络图离线不可用；加载失败会回落到纯色底色。</em>
          )}
        </label>
      )}

      {error && <em className="theme-error">{error}</em>}

      {preview && (
        <div className="theme-wallpaper-preview">
          <img src={preview} alt="壁纸预览" onError={() => setError("图片加载失败")} />
          <button
            type="button"
            className="theme-icon-btn"
            title="移除壁纸"
            disabled={disabled}
            onClick={() => patch({ kind: "none", ref: undefined, url: undefined })}
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}

      {wallpaper.kind !== "none" && (
        <div className="theme-wallpaper-controls">
          <label className="theme-field">
            <span>填充方式</span>
            <select
              value={wallpaper.fit ?? "cover"}
              disabled={disabled}
              onChange={(e) => patch({ fit: e.target.value as WallpaperFit })}
            >
              {FIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="theme-field">
            <span>压暗 {Math.round((wallpaper.dim ?? DEFAULT_WALLPAPER_DIM) * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={wallpaper.dim ?? DEFAULT_WALLPAPER_DIM}
              disabled={disabled}
              onChange={(e) => patch({ dim: Number(e.target.value) })}
            />
            <em className="theme-dim">调高让文字在花哨壁纸上更清楚（默认 35%；0 最透，但也最影响可读性）</em>
          </label>

          <label className="theme-field">
            <span>面板不透明度 {Math.round((wallpaper.surfaceAlpha ?? 0.72) * 100)}%</span>
            <input
              type="range"
              min={0.3}
              max={1}
              step={0.02}
              value={wallpaper.surfaceAlpha ?? 0.72}
              disabled={disabled}
              onChange={(e) => patch({ surfaceAlpha: Number(e.target.value) })}
            />
            <em className="theme-dim">越低壁纸越透出来；过低会影响可读性</em>
          </label>

          <label className="theme-check">
            <input
              type="checkbox"
              checked={wallpaper.blur === true}
              disabled={disabled}
              onChange={(e) => patch({ blur: e.target.checked })}
            />
            主面板毛玻璃（backdrop blur）
          </label>
        </div>
      )}
    </div>
  );
}
