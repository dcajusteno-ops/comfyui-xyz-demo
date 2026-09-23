import { useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { NumberField, SelectField } from "../../ui/FormFields";
import type { Img2ImgParams } from "../../../types";

/**
 * 图生图开关 + 参数区（默认生图 / 多人工作流 / 高清修复共用）。
 *
 * 语义要点：
 * - **显式开关**：`img2img.enabled` 关闭时一律按文生图生成，即使已选参考图；
 *   此时 builder 不写入任何 `i2i_*` 节点，工作流与改造前逐节点一致。
 * - 缩放只用核心 `ImageScale`（零第三方节点依赖）；采样方法必须取 ImageScale 的
 *   专属枚举（含 lanczos、不含 bislerp），不可与「放大方法」的 LatentUpscaleBy 列表混用。
 * - 重绘强度直接绑定 `BaseGenerationParams.denoise`，与面板顶部「重绘」是同一字段。
 * - 本组件不渲染 Anima 专用的 `keepProportion` / `cropPosition`（Anima 面板自有一套控件）。
 */

/** RepeatLatentBatch.amount 的实际上限（来自 /object_info），与 EmptyLatentImage.batch_size 的 4096 不同 */
const BATCH_LIMIT = 64;

/** 缩放方式 → ImageScale.crop 的语义映射 */
const FIT_OPTIONS = [
  { value: "stretch", label: "拉伸填满" },
  { value: "crop", label: "缩放裁剪" },
];

export function Img2ImgControls({
  img2img,
  onToggle,
  onChange,
  denoise,
  onDenoiseChange,
  batchSize,
  onUploadImage,
  upscaleMethods,
}: {
  img2img?: Img2ImgParams;
  onToggle: (enabled: boolean) => void;
  onChange: (patch: Partial<Img2ImgParams>) => void;
  denoise: number;
  onDenoiseChange: (value: number) => void;
  batchSize: number;
  onUploadImage: (file: File) => Promise<string>;
  upscaleMethods: string[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const enabled = Boolean(img2img?.enabled);
  const imageName = img2img?.imageName ?? "";
  const active = enabled && imageName !== "";

  const pickImage = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    setUploadError("");
    try {
      const name = await onUploadImage(file);
      onChange({ imageName: name });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const hints: string[] = [];
  if (enabled && !imageName) hints.push("未选参考图，本次将按文生图出图");
  if (active && denoise > 0.95) hints.push("重绘强度接近 1，参考图几乎不起作用，建议 0.4–0.7");
  if (active && batchSize > BATCH_LIMIT) hints.push(`参考图模式批量上限 ${BATCH_LIMIT}，已按 ${BATCH_LIMIT} 执行`);
  if (uploadError) hints.push(`上传失败：${uploadError}`);

  return (
    <>
      {/* .segmented 默认是 auto-fit minmax(110px, 1fr)，单个按钮会被拉满整行；
          这里用内联列宽收窄，避免它看起来像一条横幅而不是开关（不动 styles.css） */}
      <div className="segmented" style={{ marginBottom: "12px", gridTemplateColumns: "minmax(110px, 150px)" }}>
        <button
          type="button"
          className={enabled ? "active" : ""}
          onClick={() => onToggle(!enabled)}
          title="开启后按参考图重绘；关闭则按文生图生成"
        >
          图生图
        </button>
      </div>

      {enabled && (
        <div className="sub-panel" style={{ marginBottom: "14px" }}>
          <h3>图生图参数</h3>
          <div className="form-grid three">
            <div className="field">
              <span>参考图</span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                  {busy ? "上传中…" : "选择图片"}
                </button>
                {imageName && (
                  <button
                    type="button"
                    className="secondary-action"
                    title="清除参考图"
                    onClick={() => onChange({ imageName: "" })}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
            <SelectField
              label="缩放方式"
              value={img2img?.fit ?? "stretch"}
              options={FIT_OPTIONS}
              onChange={(value) => onChange({ fit: value as Img2ImgParams["fit"] })}
            />
            <SelectField
              label="采样方法"
              value={img2img?.upscaleMethod ?? "lanczos"}
              options={upscaleMethods.length ? upscaleMethods : ["lanczos"]}
              onChange={(value) => onChange({ upscaleMethod: value })}
            />
            <NumberField
              label="重绘强度"
              value={denoise}
              min={0}
              max={1}
              step={0.01}
              onChange={onDenoiseChange}
            />
            <div className="field" style={{ gridColumn: "span 2", justifyContent: "flex-end" }}>
              <span style={{ color: "var(--muted)", fontSize: "12px", wordBreak: "break-all" }}>
                {imageName ? `已选：${imageName}` : "未选参考图"}
              </span>
            </div>
          </div>
          {hints.length > 0 && (
            <p style={{ margin: "8px 0 0", fontSize: "12px", color: "var(--muted)" }}>
              {hints.join("；")}
            </p>
          )}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(event) => {
          void pickImage(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </>
  );
}
