import React, { useRef, useState, useEffect } from "react";
import { NumberField, SelectField, TextAreaField, MultiSelectField, ColorAlphaField } from "../../ui";
import { makeBaseParams } from "../../../lib/paramBuilders";
import type { DrawTextParams, BaseGenerationParams, OptionsState } from "../../../types";

function DrawTextCanvas({
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
        background: "#1a1a1a",
        border: "1px solid #333",
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
          background: "#222",
          fontSize: "13px",
          display: "flex",
          justifyContent: "space-between",
          borderBottom: "1px solid #333",
        }}
      >
        <span style={{ fontWeight: 600, color: "#aaa" }}>文字位置视觉调整 (点击/拖拽紫色准星)</span>
        <span style={{ color: "#888" }}>
          当前画布比例: {width} x {height} ({(width / height).toFixed(2)}:1)
        </span>
      </div>
      <div
        className="draw-text-canvas-wrapper"
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          background: "#0d0d0d",
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
              "linear-gradient(45deg, #181818 25%, transparent 25%), linear-gradient(-45deg, #181818 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #181818 75%), linear-gradient(-45deg, transparent 75%, #181818 75%)",
            backgroundSize: "20px 20px",
            backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
            border: "2px solid #444",
            touchAction: "none",
            boxShadow: "0 10px 30px rgba(0,0,0,0.8)",
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
              background: "#ff00ff",
              border: "2px solid #fff",
              borderRadius: "50%",
              boxShadow: "0 0 20px rgba(255,0,255,0.9)",
              pointerEvents: "none",
              zIndex: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{ width: "2px", height: "100%", background: "#fff", position: "absolute", opacity: 0.8 }}
            />
            <div
              style={{ width: "100%", height: "2px", background: "#fff", position: "absolute", opacity: 0.8 }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: `${displayX}%`,
              top: `${displayY}%`,
              color: drawText.color.startsWith("#") ? drawText.color : "#fff",
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
                  if (d === "cross_out") return "line-through 4px red";
                  return "";
                })
                .filter(Boolean)
                .join(" "),
              outline: drawText.decoration.includes("box")
                ? "1px solid #fff"
                : drawText.decoration.includes("wavy_box")
                ? "1px solid #fff"
                : drawText.decoration.includes("pill_border")
                ? "2px solid #fff"
                : drawText.decoration.includes("double_box")
                ? "double 4px #fff"
                : drawText.decoration.includes("dotted_box")
                ? "dotted 2px #fff"
                : drawText.decoration.includes("dashed_box")
                ? "dashed 2px #fff"
                : drawText.decoration.includes("stitch")
                ? "dashed 1px rgba(255,255,255,0.5)"
                : drawText.decoration.includes("explosion")
                ? "2px solid #fff"
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

export function DrawTextControls<T extends BaseGenerationParams>({
  params,
  options,
  setParams,
  defaultParams,
  multiParams,
  highresParams,
}: {
  params: T;
  options: OptionsState;
  setParams: (updater: T | ((prev: T) => T)) => void;
  defaultParams?: BaseGenerationParams;
  multiParams?: BaseGenerationParams;
  highresParams?: BaseGenerationParams;
}) {
  const drawText = params.drawText || makeBaseParams().drawText!;
  const updateDrawText = (patch: Partial<DrawTextParams>) => {
    setParams((prev) => ({
      ...prev,
      drawText: { ...(prev.drawText || makeBaseParams().drawText!), ...patch },
    }));
  };

  const syncMode = drawText.syncMode || (drawText.syncWithImage ? "default" : "manual");

  let canvasWidth = drawText.width || 800;
  let canvasHeight = drawText.height || 600;

  if (syncMode === "default") {
    canvasWidth = defaultParams?.width || params.width;
    canvasHeight = defaultParams?.height || params.height;
  } else if (syncMode === "multi" && multiParams) {
    canvasWidth = multiParams.width;
    canvasHeight = multiParams.height;
  } else if (syncMode === "highres" && highresParams) {
    canvasWidth = highresParams.width;
    canvasHeight = highresParams.height;
  }

  return (
    <div className="draw-text-config">
      <div
        className="toggle-row"
        style={{
          marginBottom: "16px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "20px",
          background: "rgba(255,255,255,0.03)",
          padding: "12px 16px",
          borderRadius: "8px",
          border: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <label
          style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontWeight: 600 }}
        >
          <input
            type="checkbox"
            checked={drawText.enabled}
            onChange={(e) => updateDrawText({ enabled: e.target.checked })}
            style={{ width: "18px", height: "18px" }}
          />
          启用文字特效叠加
        </label>
        {drawText.enabled && (
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
                color: syncMode === "default" ? "#fff" : "#aaa",
              }}
            >
              <input
                type="radio"
                name="syncSize"
                checked={syncMode === "default"}
                onChange={() => updateDrawText({ syncWithImage: true, syncMode: "default" })}
              />
              同步默认尺寸 ({defaultParams?.width || params.width}x{defaultParams?.height || params.height})
            </label>
            {multiParams && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer",
                  color: syncMode === "multi" ? "#fff" : "#aaa",
                }}
              >
                <input
                  type="radio"
                  name="syncSize"
                  checked={syncMode === "multi"}
                  onChange={() => updateDrawText({ syncWithImage: true, syncMode: "multi" })}
                />
                同步多人尺寸 ({multiParams.width}x{multiParams.height})
              </label>
            )}
            {highresParams && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer",
                  color: syncMode === "highres" ? "#fff" : "#aaa",
                }}
              >
                <input
                  type="radio"
                  name="syncSize"
                  checked={syncMode === "highres"}
                  onChange={() => updateDrawText({ syncWithImage: true, syncMode: "highres" })}
                />
                同步高清尺寸 ({highresParams.width}x{highresParams.height})
              </label>
            )}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
                color: syncMode === "manual" ? "#fff" : "#aaa",
              }}
            >
              <input
                type="radio"
                name="syncSize"
                checked={syncMode === "manual"}
                onChange={() =>
                  updateDrawText({ syncWithImage: false, syncMode: "manual", width: canvasWidth, height: canvasHeight })
                }
              />
              手动指定
            </label>
          </div>
        )}
        {drawText.enabled && syncMode === "manual" && (
          <div
            style={{
              display: "flex",
              gap: "12px",
              alignItems: "center",
              padding: "4px 12px",
              background: "rgba(255,255,255,0.05)",
              borderRadius: "6px",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <span style={{ fontSize: "12px", color: "#888", fontWeight: 600 }}>手动尺寸:</span>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <input
                type="number"
                value={drawText.width}
                onChange={(e) => updateDrawText({ width: parseInt(e.target.value) || 0 })}
                style={{
                  width: "70px",
                  background: "#000",
                  border: "1px solid #444",
                  color: "#fff",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  fontSize: "12px",
                }}
              />
              <span style={{ color: "#666" }}>x</span>
              <input
                type="number"
                value={drawText.height}
                onChange={(e) => updateDrawText({ height: parseInt(e.target.value) || 0 })}
                style={{
                  width: "70px",
                  background: "#000",
                  border: "1px solid #444",
                  color: "#fff",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  fontSize: "12px",
                }}
              />
            </div>
          </div>
        )}
      </div>
      {drawText.enabled ? (
        <>
          <DrawTextCanvas
            width={canvasWidth}
            height={canvasHeight}
            drawText={drawText}
            onChange={updateDrawText}
          />
          <div className="form-grid three">
            <label className="field" style={{ gridColumn: "span 3" }}>
              <span>文字内容</span>
              <input
                value={drawText.text}
                onChange={(e) => updateDrawText({ text: e.target.value })}
                placeholder="输入要绘制的文字..."
              />
            </label>

            {/* Typography Group */}
            <div
              style={{
                gridColumn: "span 3",
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "12px",
                marginTop: "8px",
              }}
            >
              <SelectField
                label="字体"
                value={drawText.font}
                options={options.fonts}
                onChange={(value) => updateDrawText({ font: value })}
              />
              <NumberField
                label="字号"
                value={drawText.size}
                min={8}
                step={1}
                onChange={(value) => updateDrawText({ size: value })}
              />
              <ColorAlphaField
                label="文字颜色"
                value={drawText.color}
                onChange={(value) => updateDrawText({ color: value })}
              />

              <NumberField
                label="自动换行宽"
                value={drawText.maxWidth}
                min={0}
                step={1}
                onChange={(value) => updateDrawText({ maxWidth: value })}
              />
              <NumberField
                label="行间距"
                value={drawText.lineSpacing}
                step={1}
                onChange={(value) => updateDrawText({ lineSpacing: value })}
              />
              <NumberField
                label="字间距"
                value={drawText.letterSpacing}
                step={1}
                onChange={(value) => updateDrawText({ letterSpacing: value })}
              />

              <SelectField
                label="排列方向"
                value={drawText.layoutDirection}
                options={[
                  { label: "横向", value: "horizontal" },
                  { label: "纵向", value: "vertical" },
                ]}
                onChange={(value) => updateDrawText({ layoutDirection: value as any })}
              />
              <SelectField
                label="水平对齐"
                value={drawText.horizontalAlign}
                options={[
                  { label: "居左", value: "left" },
                  { label: "居中", value: "center" },
                  { label: "居右", value: "right" },
                ]}
                onChange={(value) => updateDrawText({ horizontalAlign: value })}
              />
              <SelectField
                label="垂直对齐"
                value={drawText.verticalAlign}
                options={[
                  { label: "居上", value: "top" },
                  { label: "居中", value: "center" },
                  { label: "居下", value: "bottom" },
                ]}
                onChange={(value) => updateDrawText({ verticalAlign: value })}
              />

              <SelectField
                label="文字方向"
                value={drawText.direction}
                options={[
                  { label: "左到右", value: "ltr" },
                  { label: "右到左", value: "rtl" },
                ]}
                onChange={(value) => updateDrawText({ direction: value })}
              />
              <NumberField
                label="文字旋转"
                value={drawText.rotation}
                step={0.1}
                onChange={(value) => updateDrawText({ rotation: value })}
              />
              <MultiSelectField
                label="文字装饰"
                value={drawText.decoration}
                options={[
                  { label: "无", value: "none" },
                  { label: "下划线", value: "underline" },
                  { label: "粗下划线", value: "bold_underline" },
                  { label: "双下划线", value: "double_underline" },
                  { label: "点状下划线", value: "dotted_underline" },
                  { label: "虚线下划线", value: "dashed_underline" },
                  { label: "波浪下划线", value: "wave_underline" },
                  { label: "粗波浪下划线", value: "underline_bold_wavy" },
                  { label: "点划线下划线", value: "dot_dash_underline" },
                  { label: "双波浪下划线", value: "double_wave_underline" },
                  { label: "锯齿下划线", value: "zigzag_underline" },
                  { label: "删除线", value: "strikethrough" },
                  { label: "双删除线", value: "double_strikethrough" },
                  { label: "粗双删除线", value: "double_strikethrough_bold" },
                  { label: "上划线", value: "overline" },
                  { label: "虚线上划线", value: "dashed_overline" },
                  { label: "波浪上划线", value: "wave_overline" },
                  { label: "粗波浪上划线", value: "overline_bold_wavy" },
                  { label: "上下划线", value: "underline_overline" },
                  { label: "双上下划线", value: "double_underline_overline" },
                  { label: "下划线+删除线", value: "both" },
                  { label: "叉号划除", value: "cross_out" },
                  { label: "边框", value: "box" },
                  { label: "双线边框", value: "double_box" },
                  { label: "点状边框", value: "dotted_box" },
                  { label: "虚线边框", value: "dashed_box" },
                  { label: "波浪边框", value: "wavy_box" },
                  { label: "霓虹边框", value: "neon_border" },
                  { label: "投影边框", value: "shadow_box" },
                  { label: "直角边框", value: "corners" },
                  { label: "星角边框", value: "star_corners" },
                  { label: "缝线效果", value: "stitch" },
                  { label: "背景块", value: "background_box" },
                  { label: "圆角背景", value: "rounded_box" },
                  { label: "胶囊样式", value: "capsule" },
                  { label: "胶囊边框", value: "pill_border" },
                  { label: "荧光笔", value: "highlight" },
                  { label: "平行四边形", value: "parallelogram" },
                  { label: "梯形样式", value: "trapezoid" },
                  { label: "对话气泡", value: "speech_bubble" },
                  { label: "漫画气泡", value: "comic_bubble" },
                  { label: "云朵气泡", value: "cloud_bubble" },
                  { label: "爆炸气泡", value: "explosion" },
                  { label: "圆圈", value: "circle" },
                  { label: "菱形", value: "rhombus" },
                  { label: "标签样式", value: "tag" },
                  { label: "丝带样式", value: "ribbon" },
                  { label: "双丝带", value: "double_ribbon" },
                  { label: "条幅样式", value: "banner" },
                  { label: "树叶样式", value: "leaf_box" },
                  { label: "爱心背景", value: "heart_box" },
                  { label: "小括号 ()", value: "bracket_parenthesis" },
                  { label: "方括号 []", value: "bracket" },
                  { label: "双中括号 [[]]", value: "bracket_double" },
                  { label: "粗方括号 【】", value: "bracket_square_bold" },
                  { label: "大括号 {}", value: "bracket_curly" },
                  { label: "尖括号 <>", value: "bracket_angle" },
                  { label: "箭头指向 ->", value: "arrow_pointer" },
                  { label: "两端菱形", value: "diamond_ends" },
                  { label: "两端圆点", value: "circle_ends" },
                ]}
                onChange={(value) => updateDrawText({ decoration: value as any })}
              />
            </div>

            {/* Effects Group */}
            <div
              style={{
                gridColumn: "span 3",
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "12px",
                background: "rgba(255,255,255,0.02)",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.05)",
                marginTop: "8px",
              }}
            >
              <NumberField
                label="描边粗细"
                value={drawText.strokeWidth}
                min={0}
                step={1}
                onChange={(value) => updateDrawText({ strokeWidth: value })}
              />
              <ColorAlphaField
                label="描边颜色"
                value={drawText.strokeColor}
                onChange={(value) => updateDrawText({ strokeColor: value })}
              />
              <div />

              <NumberField
                label="阴影距离"
                value={drawText.shadowDistance}
                min={0}
                step={1}
                onChange={(value) => updateDrawText({ shadowDistance: value })}
              />
              <NumberField
                label="阴影模糊"
                value={drawText.shadowBlur}
                min={0}
                step={1}
                onChange={(value) => updateDrawText({ shadowBlur: value })}
              />
              <ColorAlphaField
                label="阴影颜色"
                value={drawText.shadowColor}
                onChange={(value) => updateDrawText({ shadowColor: value })}
              />

              <NumberField
                label="发光模糊"
                value={drawText.glowBlur}
                min={0}
                step={1}
                onChange={(value) => updateDrawText({ glowBlur: value })}
              />
              <ColorAlphaField
                label="发光颜色"
                value={drawText.glowColor}
                onChange={(value) => updateDrawText({ glowColor: value })}
              />
              <ColorAlphaField
                label="背景颜色"
                value={drawText.backgroundColor}
                onChange={(value) => updateDrawText({ backgroundColor: value })}
              />
            </div>

            {/* Gradient & Positioning Group */}
            <div
              style={{
                gridColumn: "span 3",
                display: "flex",
                gap: "16px",
                marginTop: "8px",
                alignItems: "flex-start",
              }}
            >
              {/* Gradient Section */}
              <div
                style={{
                  flex: 2,
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  background: "rgba(255,255,255,0.03)",
                  padding: "16px",
                  borderRadius: "10px",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ display: "flex", gap: "20px", alignItems: "flex-end" }}>
                  <SelectField
                    label="渐变模式"
                    value={drawText.gradientDirection}
                    options={[
                      { label: "无", value: "none" },
                      { label: "横向", value: "horizontal" },
                      { label: "纵向", value: "vertical" },
                      { label: "对角线", value: "diagonal" },
                      { label: "自定义角度", value: "angle" },
                    ]}
                    onChange={(value) => updateDrawText({ gradientDirection: value as any })}
                  />
                  {drawText.gradientDirection === "angle" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", paddingBottom: "2px" }}>
                      <span style={{ fontSize: "12px", color: "#888", fontWeight: 600 }}>渐变角度</span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          background: "rgba(0,0,0,0.3)",
                          padding: "6px 12px",
                          borderRadius: "6px",
                          border: "1px solid rgba(255,255,255,0.1)",
                          height: "34px",
                        }}
                      >
                        <input
                          type="number"
                          value={drawText.gradientAngle || 0}
                          onChange={(e) => updateDrawText({ gradientAngle: parseInt(e.target.value) || 0 })}
                          style={{
                            width: "40px",
                            background: "transparent",
                            border: "none",
                            color: "#fff",
                            fontSize: "13px",
                            textAlign: "center",
                            outline: "none",
                          }}
                        />
                        <span style={{ color: "#666", fontSize: "14px" }}>°</span>
                      </div>
                    </div>
                  )}
                  <div style={{ flex: 1 }} />
                  {drawText.gradientDirection !== "none" && (
                    <button
                      type="button"
                      onClick={() => {
                        const colors = drawText.gradientColors || [drawText.color, drawText.color2];
                        updateDrawText({ gradientColors: [...colors, "#FFFFFF"] });
                      }}
                      style={{
                        padding: "6px 12px",
                        fontSize: "11px",
                        borderRadius: "6px",
                        background: "#3498db",
                        color: "#fff",
                        border: "none",
                        cursor: "pointer",
                        fontWeight: 600,
                        height: "34px",
                      }}
                    >
                      + 追加颜色
                    </button>
                  )}
                </div>

                {drawText.gradientDirection !== "none" && (
                  <div
                    className="gradient-colors-editor"
                    style={{ marginTop: "4px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.05)" }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {(drawText.gradientColors || [drawText.color, drawText.color2]).map((col, idx) => (
                        <div
                          key={idx}
                          style={{
                            position: "relative",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            background: "rgba(255,255,255,0.05)",
                            padding: "4px",
                            borderRadius: "6px",
                            border: "1px solid rgba(255,255,255,0.05)",
                          }}
                        >
                          <div style={{ width: "24px", height: "24px", borderRadius: "3px", overflow: "hidden" }}>
                            <input
                              type="color"
                              value={col.substring(0, 7)}
                              onChange={(e) => {
                                const newColors = [...(drawText.gradientColors || [drawText.color, drawText.color2])];
                                newColors[idx] = e.target.value;
                                updateDrawText({ gradientColors: newColors });
                              }}
                              style={{ width: "150%", height: "150%", margin: "-25%", border: "none", padding: "0", cursor: "pointer" }}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const newColors = [...(drawText.gradientColors || [drawText.color, drawText.color2])];
                              newColors.splice(idx, 1);
                              updateDrawText({ gradientColors: newColors.length >= 2 ? newColors : undefined });
                            }}
                            style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", padding: "0 4px" }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div
          style={{
            textAlign: "center",
            padding: "40px",
            color: "#666",
            background: "rgba(0,0,0,0.1)",
            borderRadius: "8px",
            border: "1px dashed #444",
          }}
        >
          文字功能已关闭。勾选上方“启用”开启高级文字特效与水印功能。
        </div>
      )}
    </div>
  );
}
