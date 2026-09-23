import { useRef, useState, useEffect } from "react";
import type { DrawTextParams } from "../../../types";

/** 从 DrawTextControls.tsx 拆出（T14）：文字特效的画布预览与拖拽定位，逻辑逐字未改 */
export function DrawTextCanvas({
  width,
  height,
  drawText,
  onChange,
}: {
  width: number;
  height: number;
  drawText: DrawTextParams;
  onChange: (patch: Partial<DrawTextParams>) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [scale, setScale] = useState(1);
  const startRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    const updateScale = () => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        setScale(rect.width / width);
      }
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (canvasRef.current) observer.observe(canvasRef.current);

    return () => observer.disconnect();
  }, [width, height]);

  const handlePointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    let targetOffsetX = clickX;
    let targetOffsetY = clickY;
    if (drawText.horizontalAlign === "center") targetOffsetX -= width / 2;
    else if (drawText.horizontalAlign === "right") targetOffsetX -= width;
    if (drawText.verticalAlign === "center") targetOffsetY -= height / 2;
    else if (drawText.verticalAlign === "bottom") targetOffsetY -= height;

    const newOffsetX = Math.round(targetOffsetX);
    const newOffsetY = Math.round(targetOffsetY);

    onChange({
      offsetX: newOffsetX,
      offsetY: newOffsetY,
    });

    setIsDragging(true);
    startRef.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: newOffsetX,
      offsetY: newOffsetY,
    };
    canvasRef.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !startRef.current || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;

    const deltaX = (e.clientX - startRef.current.x) * scaleX;
    const deltaY = (e.clientY - startRef.current.y) * scaleY;

    onChange({
      offsetX: Math.round(startRef.current.offsetX + deltaX),
      offsetY: Math.round(startRef.current.offsetY + deltaY),
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    startRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };

  let previewX = drawText.offsetX;
  let previewY = drawText.offsetY;

  if (drawText.horizontalAlign === "center") previewX += width / 2;
  else if (drawText.horizontalAlign === "right") previewX += width;

  if (drawText.verticalAlign === "center") previewY += height / 2;
  else if (drawText.verticalAlign === "bottom") previewY += height;

  const displayX = (previewX / width) * 100;
  const displayY = (previewY / height) * 100;

  return (
    <div
      className="draw-text-canvas-container"
      style={{
        margin: "20px 0",
        background: "var(--surface-alt)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        className="section-toolbar"
        style={{
          padding: "8px 16px",
          background: "var(--surface)",
          fontSize: "13px",
          display: "flex",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--muted)" }}>文字位置视觉调整 (点击/拖拽紫色准星)</span>
        <span style={{ color: "var(--muted)" }}>
          当前画布比例: {width} x {height} ({(width / height).toFixed(2)}:1)
        </span>
      </div>
      <div
        className="draw-text-canvas-wrapper"
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          background: "var(--surface-alt)",
          padding: "40px",
          minHeight: "400px",
          position: "relative",
        }}
      >
        <div
          ref={canvasRef}
          className="draw-text-canvas"
          style={{
            position: "relative",
            width: width >= height ? "100%" : "auto",
            height: height > width ? "450px" : "auto",
            maxWidth: width >= height ? "800px" : "auto",
            aspectRatio: `${width}/${height}`,
            cursor: "crosshair",
            backgroundImage:
              "linear-gradient(45deg, var(--surface) 25%, transparent 25%), linear-gradient(-45deg, var(--surface) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--surface) 75%), linear-gradient(-45deg, transparent 75%, var(--surface) 75%)",
            backgroundSize: "20px 20px",
            backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
            border: "2px solid var(--border-strong)",
            touchAction: "none",
            boxShadow: "var(--shadow-lg)",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div
            className="text-anchor"
            style={{
              position: "absolute",
              left: `${displayX}%`,
              top: `${displayY}%`,
              width: "24px",
              height: "24px",
              marginLeft: "-12px",
              marginTop: "-12px",
              background: "var(--anchor-bg)",
              border: `2px solid var(--anchor-border)`,
              borderRadius: "50%",
              boxShadow: `0 0 20px var(--anchor-shadow)`,
              pointerEvents: "none",
              zIndex: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{ width: "2px", height: "100%", background: "var(--white)", position: "absolute", opacity: 0.8 }}
            />
            <div
              style={{ width: "100%", height: "2px", background: "var(--white)", position: "absolute", opacity: 0.8 }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: `${displayX}%`,
              top: `${displayY}%`,
              color: drawText.color.startsWith("#") ? drawText.color : "var(--white)",
              fontSize: `${drawText.size * scale}px`,
              fontWeight: 500,
              whiteSpace: "nowrap",
              transform: `translate(${
                drawText.horizontalAlign === "center"
                  ? "-50%"
                  : drawText.horizontalAlign === "right"
                  ? "-100%"
                  : "0"
              }, ${
                drawText.verticalAlign === "center"
                  ? "-50%"
                  : drawText.verticalAlign === "bottom"
                  ? "-100%"
                  : "0"
              }) rotate(${drawText.rotation}deg)`,
              opacity: 0.8,
              pointerEvents: "none",
              textShadow: "0 2px 4px rgba(0,0,0,0.8)",
              padding: "4px 8px",
              textDecoration: drawText.decoration
                .split(",")
                .map((d) => {
                  if (d === "underline") return "underline";
                  if (d === "bold_underline") return "underline 3px";
                  if (d === "double_underline") return "underline double";
                  if (d === "dotted_underline") return "underline dotted";
                  if (d === "dashed_underline") return "underline dashed";
                  if (d === "dot_dash_underline") return "underline dash-dot";
                  if (d === "wave_underline") return "underline wavy";
                  if (d === "underline_bold_wavy") return "underline wavy 4px";
                  if (d === "double_wave_underline") return "underline wavy double";
                  if (d === "zigzag_underline") return "underline wavy 2px";
                  if (d === "strikethrough") return "line-through";
                  if (d === "double_strikethrough") return "line-through double";
                  if (d === "double_strikethrough_bold") return "line-through double 3px";
                  if (d === "overline") return "overline";
                  if (d === "dashed_overline") return "overline dashed";
                  if (d === "wave_overline") return "overline wavy";
                  if (d === "overline_bold_wavy") return "overline wavy 4px";
                  if (d === "underline_overline") return "underline overline";
                  if (d === "double_underline_overline") return "underline double overline";
                  if (d === "both") return "underline line-through";
                  if (d === "cross_out") return "line-through 4px var(--danger)";
                  return "";
                })
                .filter(Boolean)
                .join(" "),
              outline: drawText.decoration.includes("box")
                ? "1px solid var(--white)"
                : drawText.decoration.includes("wavy_box")
                ? "1px solid var(--white)"
                : drawText.decoration.includes("pill_border")
                ? "2px solid var(--white)"
                : drawText.decoration.includes("double_box")
                ? "double 4px var(--white)"
                : drawText.decoration.includes("dotted_box")
                ? "dotted 2px var(--white)"
                : drawText.decoration.includes("dashed_box")
                ? "dashed 2px var(--white)"
                : drawText.decoration.includes("stitch")
                ? "dashed 1px rgba(255,255,255,0.5)"
                : drawText.decoration.includes("explosion")
                ? "2px solid var(--white)"
                : "none",
              outlineOffset: drawText.decoration.includes("stitch") ? "-4px" : "0px",
              boxShadow: drawText.decoration.includes("neon_border")
                ? "0 0 5px #fff, 0 0 10px #fff, 0 0 20px #00f, 0 0 30px #00f"
                : drawText.decoration.includes("shadow_box")
                ? "4px 4px 0px rgba(255,255,255,0.5)"
                : drawText.decoration.includes("highlight")
                ? `inset 0 -0.5em 0 ${
                    drawText.backgroundColor.startsWith("#") && !drawText.backgroundColor.endsWith("00")
                      ? drawText.backgroundColor
                      : "rgba(255,255,0,0.4)"
                  }`
                : "none",
              background:
                drawText.decoration.includes("background_box") ||
                drawText.decoration.includes("rounded_box") ||
                drawText.decoration.includes("tag") ||
                drawText.decoration.includes("parallelogram") ||
                drawText.decoration.includes("speech_bubble") ||
                drawText.decoration.includes("comic_bubble") ||
                drawText.decoration.includes("capsule") ||
                drawText.decoration.includes("ribbon") ||
                drawText.decoration.includes("leaf_box") ||
                drawText.decoration.includes("trapezoid") ||
                drawText.decoration.includes("double_ribbon") ||
                drawText.decoration.includes("heart_box") ||
                drawText.decoration.includes("cloud_bubble") ||
                drawText.decoration.includes("banner") ||
                drawText.decoration.includes("explosion")
                  ? drawText.backgroundColor.startsWith("#") && !drawText.backgroundColor.endsWith("00")
                    ? drawText.backgroundColor
                    : "rgba(255,255,255,0.2)"
                  : "transparent",
              borderRadius: drawText.decoration.includes("rounded_box")
                ? "12px"
                : drawText.decoration.includes("circle")
                ? "50%"
                : drawText.decoration.includes("tag")
                ? "0 8px 8px 0"
                : drawText.decoration.includes("speech_bubble") ||
                  drawText.decoration.includes("comic_bubble") ||
                  drawText.decoration.includes("cloud_bubble")
                ? "8px"
                : drawText.decoration.includes("capsule") || drawText.decoration.includes("pill_border")
                ? "50px"
                : "4px",
              border:
                drawText.decoration.includes("circle") ||
                drawText.decoration.includes("rhombus") ||
                drawText.decoration.includes("neon_border") ||
                drawText.decoration.includes("comic_bubble") ||
                drawText.decoration.includes("star_corners") ||
                drawText.decoration.includes("diamond_ends") ||
                drawText.decoration.includes("circle_ends")
                  ? "1px solid #fff"
                  : "none",
              clipPath: drawText.decoration.includes("rhombus")
                ? "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)"
                : drawText.decoration.includes("tag")
                ? "polygon(0% 0%, 85% 0%, 100% 50%, 85% 100%, 0% 100%)"
                : drawText.decoration.includes("parallelogram")
                ? "polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)"
                : drawText.decoration.includes("ribbon")
                ? "polygon(10% 0%, 90% 0%, 100% 50%, 90% 100%, 10% 100%, 0% 50%)"
                : drawText.decoration.includes("leaf_box")
                ? "polygon(20% 0%, 100% 0%, 80% 100%, 0% 100%)"
                : drawText.decoration.includes("trapezoid")
                ? "polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%)"
                : drawText.decoration.includes("heart_box")
                ? 'path("M 50 100 C 0 50 0 0 50 20 C 100 0 100 50 50 100 Z")'
                : drawText.decoration.includes("banner")
                ? "polygon(0% 0%, 100% 0%, 100% 100%, 50% 85%, 0% 100%)"
                : drawText.decoration.includes("explosion")
                ? "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)"
                : drawText.decoration.includes("corners")
                ? "polygon(0% 0%, 20% 0%, 20% 5%, 5% 5%, 5% 20%, 0% 20%, 0% 80%, 5% 80%, 5% 95%, 20% 95%, 20% 100%, 0% 100%, 100% 100%, 80% 100%, 80% 95%, 95% 95%, 95% 80%, 100% 80%, 100% 20%, 95% 20%, 95% 5%, 80% 5%, 80% 0%, 100% 0%)"
                : "none",
          }}
        >
          {drawText.decoration.includes("bracket_parenthesis")
            ? `(${drawText.text || "文字预览位置"})`
            : drawText.decoration.includes("bracket_double")
            ? `[[${drawText.text || "文字预览位置"}]]`
            : drawText.decoration.includes("bracket") && !drawText.decoration.includes("bracket_square_bold")
            ? `[${drawText.text || "文字预览位置"}]`
            : drawText.decoration.includes("bracket_square_bold")
            ? `【${drawText.text || "文字预览位置"}】`
            : drawText.decoration.includes("bracket_curly")
            ? `{${drawText.text || "文字预览位置"}}`
            : drawText.decoration.includes("bracket_angle")
            ? `<${drawText.text || "文字预览位置"}>`
            : drawText.decoration.includes("arrow_pointer")
            ? `${drawText.text || "文字预览位置"} ->`
            : drawText.decoration.includes("diamond_ends")
            ? `◆ ${drawText.text || "文字预览位置"} ◆`
            : drawText.decoration.includes("circle_ends")
            ? `● ${drawText.text || "文字预览位置"} ●`
            : drawText.text || "文字预览位置"}
          {(drawText.decoration.includes("speech_bubble") ||
            drawText.decoration.includes("comic_bubble") ||
            drawText.decoration.includes("cloud_bubble") ||
            drawText.decoration.includes("explosion")) && (
            <div
              style={{
                position: "absolute",
                bottom: "-8px",
                left: "20px",
                width: "0",
                height: "0",
                borderLeft: "8px solid transparent",
                borderRight: "8px solid transparent",
                borderTop: `8px solid ${
                  drawText.backgroundColor.startsWith("#") && !drawText.backgroundColor.endsWith("00")
                    ? drawText.backgroundColor
                    : "rgba(255,255,255,0.2)"
                }`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  </div>
  );
}