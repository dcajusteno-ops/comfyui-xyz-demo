import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, RotateCcw, X } from "lucide-react";
import {
  drawWatermark,
  TILE_POSITION,
  WATERMARK_POSITIONS,
  type WatermarkParams,
  type WatermarkPosition,
} from "../../../lib/watermark";
import type { WatermarkSettings } from "../../../hooks/useWatermarkSettings";

/**
 * 文字水印弹窗（灯箱入口，手动对单张图操作）。
 *
 * - 源图 fetch → createImageBitmap（blob 路线，canvas 不被污染，toBlob 可用）
 * - canvas 按原图分辨率绘制（与导出同一代码路径，所见即所得），CSS 缩放显示
 * - 参数由 useWatermarkSettings 持久化（App 单点创建传入），与「生图自动水印」共用
 * - createPortal + zIndex 11050：高于灯箱 11000、低于 toast 12000；
 *   水印打开期间灯箱在 GlobalModals 中挂起（值保留），Esc 只关本弹窗、关掉后灯箱原样恢复
 */
const PREVIEW_MAX = 560;

const POSITION_LABELS: Record<WatermarkPosition, string> = {
  "top-left": "左上",
  "top-center": "上中",
  "top-right": "右上",
  "middle-left": "左中",
  "middle-center": "居中",
  "middle-right": "右中",
  "bottom-left": "左下",
  "bottom-center": "下中",
  "bottom-right": "右下",
  "tile": "平铺",
};

export function WatermarkModal({
  url,
  settings,
  onClose,
}: {
  url: string;
  settings: WatermarkSettings;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const rafRef = useRef(0);

  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  const { params, setParams, auto, setAuto } = settings;

  const patch = useCallback(
    (partial: Partial<WatermarkParams>) => setParams((prev) => ({ ...prev, ...partial })),
    [setParams],
  );

  // 源图只加载一次
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`读取图片失败：${response.status}`);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        if (cancelled) {
          bitmap.close();
          return;
        }
        bitmapRef.current = bitmap;
        setImgSize({ w: bitmap.width, h: bitmap.height });
        setLoading(false);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      bitmapRef.current?.close();
      bitmapRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [url]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const bitmap = bitmapRef.current;
    if (!canvas || !bitmap) return;
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    drawWatermark(ctx, canvas.width, canvas.height, params);
  }, [params]);

  // 字体就绪后补画一次（字体晚于首绘就绪时 measureText 有偏差）；幂等重绘，无副作用
  useEffect(() => {
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) redraw();
    });
    return () => {
      cancelled = true;
    };
  }, [redraw]);

  // 参数变化：rAF 合帧重绘
  useEffect(() => {
    if (!imgSize) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      redraw();
    });
  }, [imgSize, redraw]);

  // Esc 关闭（灯箱此刻已挂起，无监听冲突）
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const download = async () => {
    const canvas = canvasRef.current;
    if (!canvas || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("导出失败");
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      // /comfy/api/view?filename=xxx.png 一定带 filename 参数；解析失败兜底时间戳名
      let name = "";
      try {
        name = new URL(url, window.location.href).searchParams.get("filename") || "";
      } catch {
        // 保持空串走兜底
      }
      link.download = name ? `${name.replace(/\.[^.]+$/, "")}-水印.png` : `watermark-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : String(downloadError));
    } finally {
      setDownloading(false);
    }
  };

  const displayScale = imgSize ? Math.min(1, PREVIEW_MAX / imgSize.w, PREVIEW_MAX / imgSize.h) : 1;

  return createPortal(
    <div className="modal-backdrop" style={{ zIndex: 11050 }}>
      <div className="modal" style={{ width: "90vw", maxWidth: "1100px", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <div className="modal-head">
          <h2>文字水印</h2>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={16} /> 关闭
          </button>
        </div>

        <div style={{ display: "flex", gap: 16, padding: "6px 0", overflow: "hidden", flex: 1, minHeight: 0 }}>
          {/* 左：预览 */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--bg-deep, rgba(0,0,0,0.25))",
              overflow: "hidden",
              position: "relative",
              minHeight: 320,
            }}
          >
            {imgSize && (
              <canvas
                ref={canvasRef}
                style={{
                  width: imgSize.w * displayScale,
                  height: imgSize.h * displayScale,
                  display: "block",
                  maxWidth: "100%",
                }}
              />
            )}
            {loading && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
                <Loader2 size={22} className="spin" />
              </div>
            )}
          </div>

          {/* 右：参数 */}
          <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "var(--muted)" }}>
              水印文字
              <input
                type="text"
                value={params.text}
                placeholder="输入水印内容"
                onChange={(event) => patch({ text: event.target.value })}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "var(--muted)" }}>
              字号（{params.fontSize}px）
              <input
                type="range"
                min={6}
                max={300}
                value={params.fontSize}
                onChange={(event) => patch({ fontSize: Number(event.target.value) })}
              />
            </label>

            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
              颜色
              <input
                type="color"
                value={params.color}
                onChange={(event) => patch({ color: event.target.value })}
                style={{ width: 36, height: 26, padding: 0, border: "none", cursor: "pointer" }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "var(--muted)" }}>
              不透明度（{params.opacity}%）
              <input
                type="range"
                min={1}
                max={100}
                value={params.opacity}
                onChange={(event) => patch({ opacity: Number(event.target.value) })}
              />
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "var(--muted)" }}>
              位置
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 4,
                }}
              >
                {WATERMARK_POSITIONS.map((position) => (
                  <button
                    key={position}
                    type="button"
                    className={params.position === position ? "primary-action" : "secondary-action"}
                    style={{ padding: "6px 0", fontSize: 12 }}
                    onClick={() => patch({ position })}
                    title={POSITION_LABELS[position]}
                  >
                    {POSITION_LABELS[position]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={params.position === TILE_POSITION ? "primary-action" : "secondary-action"}
                style={{ padding: "6px 0", fontSize: 12, justifyContent: "center" }}
                onClick={() => patch({ position: TILE_POSITION })}
                title="沿旋转方向铺满整张图（防盗图）；建议配 -30° 旋转 + 低不透明度"
              >
                平铺整图
              </button>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "var(--muted)" }}>
              边距（{params.margin}px）
              <input
                type="range"
                min={0}
                max={300}
                value={params.margin}
                onChange={(event) => patch({ margin: Number(event.target.value) })}
              />
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "var(--muted)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>旋转（{params.rotation}°）</span>
                <button
                  type="button"
                  className="secondary-action"
                  style={{ padding: "2px 8px", fontSize: 12 }}
                  onClick={() => patch({ rotation: 0 })}
                  title="重置旋转"
                >
                  <RotateCcw size={12} /> 归零
                </button>
              </div>
              <input
                type="range"
                min={-90}
                max={90}
                value={params.rotation}
                onChange={(event) => patch({ rotation: Number(event.target.value) })}
              />
            </div>

            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
              <input
                type="checkbox"
                checked={auto}
                onChange={(event) => setAuto(event.target.checked)}
              />
              生成时烙进图片（工作流合成）
            </label>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
              开启后水印直接合成进 ComfyUI 出图文件（含落盘原图），与文字特效同机制；
              需保持 ComfyUI 在线，调整参数后约 1 秒自动上传水印层。关闭或烙入失败时回退为仅前端叠加。
            </div>

            {error && <div style={{ fontSize: 13, color: "#dc2626" }}>{error}</div>}

            <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
              <button
                type="button"
                className="primary-action"
                disabled={loading || downloading || !imgSize}
                onClick={() => void download()}
                style={{ flex: 1, justifyContent: "center" }}
              >
                {downloading ? <Loader2 size={14} className="spin" /> : <Download size={14} />} 下载 PNG
              </button>
              <button type="button" className="secondary-action" onClick={onClose}>
                关闭
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
