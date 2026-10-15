import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Brush, Eraser, Loader2, Move, Save, Trash2, Undo2, X } from "lucide-react";

/**
 * 手写板（笔迹原样叠加到生成图，不做 OCR 识别、不用字体重渲染）。
 *
 * 与 MaskEditorModal 同款骨架（createPortal / displayScale / PointerEvent + setPointerCapture）。
 * 画布内部分辨率 = 生图尺寸（width×height），CSS 缩放显示——笔迹直接画在最终位置（画板内定稿），
 * 板内提供 移动 / 缩放 / 撤销 调整，不需要参数化 offset（工作流里 ImageCompositeMasked 不做定位）。
 *
 * 导出约定（与 workflowBuilders.insertHandwritingNode 对齐，缺一不可）：
 * - 彩图：黑底 + 彩色笔迹（ComfyUI 的 LoadImage 会 convert("RGB") 丢 alpha，黑底即透明区）；
 * - mask 图：白笔迹黑底，red 通道即 alpha（半透明笔迹导出为灰度，合成时线性混合 ≈ alpha 混合）。
 * 单张 RGBA 的「优化」方案不可行：LoadImage 的 MASK 输出是反转 alpha（详见 builder 注释）。
 *
 * 移动 / 缩放基于 getImageData 快照重绘：拖动用 putImageData 平移（putImageData 是替换不是混合，
 * 必须先 clearRect 否则原位置留残影）；缩放经离屏 canvas 以画布中心等比变换。
 */
export function HandwritingBoardModal({
  width,
  height,
  initialImageUrl,
  onClose,
  onSave,
}: {
  width: number;
  height: number;
  /** 已上传手写层的彩图 URL（重画场景回显，可能被拉伸到当前画布尺寸） */
  initialImageUrl?: string;
  onClose: () => void;
  /** 保存回调：两张同尺寸 PNG（彩图 / mask 图）。抛错时错误留在板内、弹窗不关 */
  onSave: (colorBlob: Blob, maskBlob: Blob) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const moveStartRef = useRef<{ x: number; y: number } | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);
  const zoomingRef = useRef(false);
  const historyRef = useRef<string[]>([]);

  const [tool, setTool] = useState<"draw" | "erase" | "move">("draw");
  const [brush, setBrush] = useState(6);
  const [color, setColor] = useState("#FFFFFF");
  const [opacity, setOpacity] = useState(100);
  const [zoom, setZoom] = useState(100);
  const [canUndo, setCanUndo] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialImageUrl));
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
    if (!initialImageUrl) return;

    // 重画场景：把已上传的手写层画回来（尺寸不符时 drawImage 拉伸，与工作流 ImageScale 行为一致）
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(initialImageUrl);
        if (!response.ok) throw new Error(`读取手写层失败：${response.status}`);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        if (cancelled) return;
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        setHasContent(true);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [width, height, initialImageUrl]);

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  /** 保存当前画布快照（撤销栈，上限 20 步，超出丢最旧） */
  const pushHistory = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    historyRef.current.push(canvas.toDataURL("image/png"));
    if (historyRef.current.length > 20) historyRef.current.shift();
    setCanUndo(true);
  };

  const undo = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const data = historyRef.current.pop();
    if (!canvas || !ctx || !data) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = data;
    setCanUndo(historyRef.current.length > 0);
  };

  const strokeDab = (x: number, y: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
    ctx.globalAlpha = opacity / 100;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = brush;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const last = lastPointRef.current;
    if (last) {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      // 落笔第一下画圆点，否则单击不留痕
      ctx.beginPath();
      ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    lastPointRef.current = { x, y };
    setHasContent(true);
  };

  /** 移动工具：按快照平移整层（putImageData 是替换语义，必须先 clearRect） */
  const moveTo = (x: number, y: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const snapshot = snapshotRef.current;
    const start = moveStartRef.current;
    if (!canvas || !ctx || !snapshot || !start) return;
    const dx = Math.round(x - start.x);
    const dy = Math.round(y - start.y);
    if (dx === 0 && dy === 0) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(snapshot, dx, dy);
    setHasContent(true);
  };

  /** 缩放：从快照出发以画布中心等比变换（每次都从快照重放，滑块来回拖不累积误差） */
  const applyZoom = (pct: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const snapshot = snapshotRef.current;
    if (!canvas || !ctx || !snapshot) return;
    const tmp = document.createElement("canvas");
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    tmp.getContext("2d")?.putImageData(snapshot, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = pct / 100;
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(s, s);
    ctx.drawImage(tmp, -canvas.width / 2, -canvas.height / 2);
    ctx.restore();
    setHasContent(true);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    pushHistory();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasContent(false);
  };

  const exportBlobs = (canvas: HTMLCanvasElement): Promise<{ colorBlob: Blob; maskBlob: Blob }> => {
    // 彩图：黑底 + 笔迹（透明区变黑，正好被 mask=0 挡掉）
    const colorOut = document.createElement("canvas");
    colorOut.width = canvas.width;
    colorOut.height = canvas.height;
    const cctx = colorOut.getContext("2d")!;
    cctx.fillStyle = "#000000";
    cctx.fillRect(0, 0, canvas.width, canvas.height);
    cctx.drawImage(canvas, 0, 0);

    // mask 图：笔迹的 alpha 形状染白（source-in），再垫黑底（destination-over）
    const maskOut = document.createElement("canvas");
    maskOut.width = canvas.width;
    maskOut.height = canvas.height;
    const mctx = maskOut.getContext("2d")!;
    mctx.drawImage(canvas, 0, 0);
    mctx.globalCompositeOperation = "source-in";
    mctx.fillStyle = "#ffffff";
    mctx.fillRect(0, 0, canvas.width, canvas.height);
    mctx.globalCompositeOperation = "destination-over";
    mctx.fillStyle = "#000000";
    mctx.fillRect(0, 0, canvas.width, canvas.height);

    return Promise.all([
      new Promise<Blob | null>((resolve) => colorOut.toBlob(resolve, "image/png")),
      new Promise<Blob | null>((resolve) => maskOut.toBlob(resolve, "image/png")),
    ]).then(([colorBlob, maskBlob]) => {
      if (!colorBlob || !maskBlob) throw new Error("手写层导出失败");
      return { colorBlob, maskBlob };
    });
  };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    setError("");
    try {
      const { colorBlob, maskBlob } = await exportBlobs(canvas);
      await onSave(colorBlob, maskBlob);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const beginZoom = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || zoomingRef.current) return;
    pushHistory();
    snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    zoomingRef.current = true;
  };

  const endZoom = () => {
    zoomingRef.current = false;
    snapshotRef.current = null;
  };

  return createPortal(
    <div className="modal-backdrop" style={{ zIndex: 10055 }}>
      <div className="modal" style={{ width: "640px", maxWidth: "94vw" }}>
        <div className="modal-head">
          <h2>手写板</h2>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={16} /> 关闭
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "6px 0" }}>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
            画布即 {width}×{height} 的生成图（按比例缩放显示），直接写在最终位置；写完可用「移动 / 缩放」调整，
            保存后笔迹原样叠加到生成图（不做文字识别）。支持鼠标与触摸。
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className={tool === "draw" ? "primary-action" : "secondary-action"}
              onClick={() => setTool("draw")}
              title="画笔：写入手写内容"
            >
              <Brush size={14} /> 画笔
            </button>
            <button
              type="button"
              className={tool === "erase" ? "primary-action" : "secondary-action"}
              onClick={() => setTool("erase")}
              title="擦除：去掉笔迹"
            >
              <Eraser size={14} /> 擦除
            </button>
            <button
              type="button"
              className={tool === "move" ? "primary-action" : "secondary-action"}
              onClick={() => setTool("move")}
              title="移动：拖动整层笔迹"
            >
              <Move size={14} /> 移动
            </button>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              颜色
              <input type="color" value={color} onChange={(event) => setColor(event.target.value)} style={{ width: 28, height: 24, padding: 0, border: "none", cursor: "pointer" }} />
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              粗细
              <input type="range" min={1} max={40} value={brush} onChange={(event) => setBrush(Number(event.target.value))} style={{ width: 90 }} />
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              不透明度
              <input type="range" min={10} max={100} value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} style={{ width: 90 }} />
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              缩放
              <input
                type="range"
                min={10}
                max={200}
                value={zoom}
                onPointerDown={beginZoom}
                onPointerUp={endZoom}
                onBlur={endZoom}
                onChange={(event) => {
                  const pct = Number(event.target.value);
                  setZoom(pct);
                  applyZoom(pct);
                }}
                style={{ width: 110 }}
              />
            </label>
            <button
              type="button"
              className="secondary-action"
              disabled={!canUndo}
              onClick={undo}
              title="撤销上一步"
            >
              <Undo2 size={14} /> 撤销
            </button>
            <button type="button" className="secondary-action" onClick={clearCanvas} title="清空画布">
              <Trash2 size={14} /> 清空
            </button>
          </div>

          <div
            style={{
              position: "relative",
              alignSelf: "center",
              border: "1px solid var(--border)",
              borderRadius: 8,
              overflow: "hidden",
              // 棋盘格提示「这里是透明层」，笔迹会以 alpha 混合叠到生成图上
              backgroundImage:
                "conic-gradient(#2a2a2e 0 25%, #232327 0 50%, #2a2a2e 0 75%, #232327 0)",
              backgroundSize: "16px 16px",
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                ...displayStyle,
                touchAction: "none",
                cursor: tool === "move" ? "grab" : "crosshair",
              }}
              onPointerDown={(event) => {
                const point = canvasPoint(event);
                event.currentTarget.setPointerCapture(event.pointerId);
                if (tool === "move") {
                  const ctx = canvasRef.current?.getContext("2d");
                  if (!ctx) return;
                  pushHistory();
                  snapshotRef.current = ctx.getImageData(0, 0, width, height);
                  moveStartRef.current = point;
                } else {
                  pushHistory();
                  lastPointRef.current = null;
                  drawingRef.current = true;
                  strokeDab(point.x, point.y);
                }
              }}
              onPointerMove={(event) => {
                const point = canvasPoint(event);
                if (tool === "move") {
                  if (!moveStartRef.current) return;
                  moveTo(point.x, point.y);
                } else if (drawingRef.current) {
                  strokeDab(point.x, point.y);
                }
              }}
              onPointerUp={() => {
                drawingRef.current = false;
                lastPointRef.current = null;
                moveStartRef.current = null;
                snapshotRef.current = null;
              }}
              onPointerLeave={() => {
                drawingRef.current = false;
              }}
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
            <button type="button" className="primary-action" disabled={loading || saving || !hasContent} onClick={() => void save()}>
              {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} 保存手写层
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
