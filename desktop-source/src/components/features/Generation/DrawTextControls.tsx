import React from "react";
import { DrawTextCanvas } from "./DrawTextCanvas";
import { NumberField, SelectField, MultiSelectField, ColorAlphaField } from "../../ui";
import { makeBaseParams } from "../../../lib/paramBuilders";
import type { DrawTextParams, BaseGenerationParams, OptionsState } from "../../../types";


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
          background: "var(--surface-alt)",
          padding: "12px 16px",
          borderRadius: "8px",
          border: "1px solid var(--border)",
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
                color: syncMode === "default" ? "var(--text)" : "var(--muted)",
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
                  color: syncMode === "multi" ? "var(--text)" : "var(--muted)",
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
                  color: syncMode === "highres" ? "var(--text)" : "var(--muted)",
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
                color: syncMode === "manual" ? "var(--text)" : "var(--muted)",
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
              background: "var(--surface-alt)",
              borderRadius: "6px",
              border: "1px solid var(--border)",
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 600 }}>手动尺寸:</span>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <input
                type="number"
                value={drawText.width}
                onChange={(e) => updateDrawText({ width: parseInt(e.target.value) || 0 })}
                style={{
                  width: "70px",
                  background: "var(--input-bg)",
                  border: "1px solid var(--input-border)",
                  color: "var(--text)",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  fontSize: "12px",
                }}
              />
              <span style={{ color: "var(--muted)" }}>x</span>
              <input
                type="number"
                value={drawText.height}
                onChange={(e) => updateDrawText({ height: parseInt(e.target.value) || 0 })}
                style={{
                  width: "70px",
                  background: "var(--input-bg)",
                  border: "1px solid var(--input-border)",
                  color: "var(--text)",
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
                onChange={(value) => updateDrawText({ layoutDirection: value as DrawTextParams["layoutDirection"] })}
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
                onChange={(value) => updateDrawText({ decoration: value as DrawTextParams["decoration"] })}
              />
            </div>

            {/* Effects Group */}
            <div
              style={{
                gridColumn: "span 3",
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "12px",
                background: "var(--surface-alt)",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
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
                  background: "var(--surface-alt)",
                  padding: "16px",
                  borderRadius: "10px",
                  border: "1px solid var(--border)",
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
                    onChange={(value) => updateDrawText({ gradientDirection: value as DrawTextParams["gradientDirection"] })}
                  />
                  {drawText.gradientDirection === "angle" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", paddingBottom: "2px" }}>
                      <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 600 }}>渐变角度</span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          background: "var(--input-bg)",
                          padding: "6px 12px",
                          borderRadius: "6px",
                          border: "1px solid var(--input-border)",
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
                            color: "var(--text)",
                            fontSize: "13px",
                            textAlign: "center",
                            outline: "none",
                          }}
                        />
                        <span style={{ color: "var(--muted)", fontSize: "14px" }}>°</span>
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
                        background: "var(--accent)",
                        color: "white",
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
                    style={{ marginTop: "4px", paddingTop: "12px", borderTop: "1px solid var(--border)" }}
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
                            background: "var(--surface)",
                            padding: "4px",
                            borderRadius: "6px",
                            border: "1px solid var(--border)",
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
                            style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", padding: "0 4px" }}
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
            color: "var(--muted)",
            background: "var(--surface-alt)",
            borderRadius: "8px",
            border: "1px dashed var(--border)",
          }}
        >
          文字功能已关闭。勾选上方“启用”开启高级文字特效与水印功能。
        </div>
      )}
    </div>
  );
}
