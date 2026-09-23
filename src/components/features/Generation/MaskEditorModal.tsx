import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Brush, Eraser, Loader2, Save, Trash2, X } from "lucide-react";

/**
 * 涂抹式遮罩编辑器（T12 局部重绘）。
 *
 * 输出约定（与 builder 的 LoadImageMask(channel=red) 对齐）：
 * - 黑底 + 白色笔刷，红通道即遮罩（白 = 重绘区）；
 * - 画布尺寸 = 目标生图尺寸（宽高取自面板），遮罩与缩放后的参考图天然对齐；
 * - 预览时按面板的缩放方式（拉伸 / 居中裁剪）铺底图，与 ImageScale 行为一致。
 *
 * 实现是**双画布**：底图只用于参考（<img>），笔刷画在上层透明 canvas；
 * 导出 = 纯黑底 + 笔刷层，不会被底图颜色污染（早期单画布 + 亮度二值化的方案就有这个坑）。
 */
export function MaskEditorModal({
  imageUrl,
  width,
  height,
  fit,
  onClose,
  onSave,
}: {
  imageUrl: string;
  width: number;
  height: number;
  fit: "stretch" | "crop";
  onClose: () => void;
  onSave: (blob: Blob) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [brush, setBrush] = useState(40);
  const [eraseMode, setEraseMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const displayScale = Math.min(1, 560 / width, 560 / height);
  const displayStyle: React.CSSProperties = {
    width: width * displayScale,
    height: height * displayScale,
    display: "block",
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
  }, [width, height]);

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const stroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = canvasPoint(event);
    ctx.globalCompositeOperation = eraseMode ? "destination-out" : "source-over";
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  };

  const clearMask = () => {
    const ctx = canvasRef.current?.getContext("2d");
    ctx?.clearRect(0, 0, width, height);
  };

  const save = async () => {
    const overlay = canvasRef.current;
    if (!overlay) return;
    setSaving(true);
    setError("");
    try {
      const out = document.createElement("canvas");
      out.width = width;
      out.height = height;
      const ctx = out.getContext("2d")!;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(overlay, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("遮罩导出失败");
      await onSave(blob);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" style={{ zIndex: 10055 }}>
      <div className="modal" style={{ width: "640px", maxWidth: "94vw" }}>
        <div className="modal-head">
          <h2>涂抹重绘区域</h2>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={16} /> 关闭
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "6px 0" }}>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
            白色笔刷涂到哪，哪里就会被重绘；其余区域保持原图。遮罩按面板尺寸
            {" "}{width}×{height}{" "}导出，自动与参考图对齐。
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className={eraseMode ? "secondary-action" : "primary-action"}
              onClick={() => setEraseMode(false)}
              title="画笔：标记要重绘的区域"
            >
              <Brush size={14} /> 画笔
            </button>
            <button
              type="button"
              className={eraseMode ? "primary-action" : "secondary-action"}
              onClick={() => setEraseMode(true)}
              title="擦除：取消已涂的区域"
            >
              <Eraser size={14} /> 擦除
            </button>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              笔刷
              <input type="range" min={10} max={160} value={brush} onChange={(event) => setBrush(Number(event.target.value))} style={{ width: 120 }} />
            </label>
            <button type="button" className="secondary-action" onClick={clearMask} title="清空遮罩">
              <Trash2 size={14} /> 清空
            </button>
          </div>

          <div style={{ position: "relative", alignSelf: "center", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            {/* 底图：只做参考，不参与导出 */}
            <MaskBaseImage imageUrl={imageUrl} fit={fit} displayStyle={displayStyle} onReady={() => setLoading(false)} onError={() => { setError("参考图加载失败（可能已被清理），请重新选择参考图"); setLoading(false); }} />
            <canvas
              ref={canvasRef}
              style={{ ...displayStyle, position: "absolute", inset: 0, cursor: "crosshair", touchAction: "none" }}
              onPointerDown={(event) => {
                drawingRef.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                stroke(event);
              }}
              onPointerMove={stroke}
              onPointerUp={() => (drawingRef.current = false)}
              onPointerLeave={() => (drawingRef.current = false)}
            />
            {loading && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
                <Loader2 size={22} className="spin" />
              </div>
            )}
          </div>

          {error && <div style={{ fontSize: 13, color: "#dc2626" }}>{error}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="secondary-action" onClick={onClose}>
              取消
            </button>
            <button type="button" className="primary-action" disabled={loading || saving} onClick={() => void save()}>
              {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} 上传遮罩
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 底图铺放：与 ImageScale 的 stretch / crop(center) 行为一致 */
function MaskBaseImage({
  imageUrl,
  fit,
  displayStyle,
  onReady,
  onError,
}: {
  imageUrl: string;
  fit: "stretch" | "crop";
  displayStyle: React.CSSProperties;
  onReady: () => void;
  onError: () => void;
}) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const image = ref.current;
    if (!image) return;
    if (image.complete && image.naturalWidth > 0) onReady();
  }, [onReady]);

  const objectFit = fit === "stretch" ? "fill" : "cover";
  return (
    <img
      ref={ref}
      src={imageUrl}
      alt="参考图"
      onLoad={onReady}
      onError={onError}
      style={{ ...displayStyle, objectFit, objectPosition: "center", background: "#000" }}
    />
  );
}
