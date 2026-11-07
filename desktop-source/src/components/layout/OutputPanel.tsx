import { useState } from "react";
import { CheckCircle2, Columns, GalleryHorizontalEnd, Loader2 } from "lucide-react";
import { Select } from "../ui";
import type { JobResult, OutputImage, TemplateKind } from "../../types";

/**
 * 输出面板的一行标题摘要。
 * 以前只显示 `promptId.slice(0,8)`，出几张图后就分不清哪张是哪张了。
 * 元信息来自 useGeneration 在提交时从**实际工作流**里读出的参数；缺失时逐级降级。
 */
function jobTitle(result: JobResult) {
  const meta = result.meta;
  if (!meta) return result.promptId.slice(0, 8);
  const parts: string[] = [meta.label];
  if (meta.width && meta.height) parts.push(`${meta.width}×${meta.height}`);
  if (meta.steps !== undefined) parts.push(`${meta.steps} 步`);
  if (meta.seed !== undefined) parts.push(`seed ${meta.seed}`);
  return parts.join(" · ");
}

interface OutputPanelProps {
  results: JobResult[];
  previewUrl?: string;
  running: boolean;
  watermarkAuto: boolean;
  onWatermarkAutoChange: (auto: boolean) => void;
  onOpenLightbox: (url: string, originalUrl?: string) => void;
  onOpenCompare: (urls: [string, string]) => void;
  onSendImageTo: (image: OutputImage, target: TemplateKind | "wd14" | "sheet") => Promise<void>;
}

/** 右侧输出画廊：进度预览 + 结果图 + 「作为输入图」 */
export function OutputPanel({
  results,
  previewUrl,
  running,
  watermarkAuto,
  onWatermarkAutoChange,
  onOpenLightbox,
  onOpenCompare,
  onSendImageTo,
}: OutputPanelProps) {
  // 上传中的图片 key 只服务于本面板的「作为输入图」下拉，放在组件内部即可
  const [uploadingImageKey, setUploadingImageKey] = useState<string | null>(null);

  return (
    <aside className={results.length > 0 || previewUrl ? "output-panel" : "output-panel is-empty"}>
      <div className="gallery">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <h2><GalleryHorizontalEnd size={18} /> 输出</h2>
          <label
            title="开启后水印直接烙进 ComfyUI 出图文件（与文字特效同机制）；烙入失败时回退为仅前端叠加"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--muted)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <input
              type="checkbox"
              checked={watermarkAuto}
              onChange={(event) => onWatermarkAutoChange(event.target.checked)}
            />
            自动水印
          </label>
        </div>
        {results.length === 0 && !previewUrl && <div className="empty-state">暂无输出</div>}

        {running && previewUrl && (
          <div className="gallery-item" key="preview">
            <div className="gallery-meta">
              <Loader2 size={16} className="spin" />
              <span>预览中...</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
              <img
                src={previewUrl}
                alt="Preview"
                style={{ filter: "blur(2px)", transition: "filter 0.3s" }}
              />
            </div>
          </div>
        )}

        {results.map((result) => (
          <div className="gallery-item" key={result.promptId}>
            <div className="gallery-meta">
              <CheckCircle2 size={16} />
              <span
                title={result.promptId + (result.meta ? ` | ${jobTitle(result)}` : "")}
                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
              >
                {jobTitle(result)}
              </span>
            </div>
            {result.images.length > 0 && (() => {
              const lastImg = result.images[result.images.length - 1];
              const finalImages = result.images.filter(img => img.subfolder === lastImg.subfolder && img.nodeTitle === lastImg.nodeTitle);
              const baseImages = result.images.filter(img => img.subfolder !== lastImg.subfolder || img.nodeTitle !== lastImg.nodeTitle);

              return finalImages.map((image, i) => (
                <div key={`${result.promptId}-${image.filename}`} style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                  <img
                    src={image.url}
                    alt={image.filename}
                    style={{ cursor: "zoom-in" }}
                    onClick={() => onOpenLightbox(image.url, image.originalUrl)}
                  />
                  {baseImages.length > 0 && (
                    <button
                      className="secondary-action"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '100%' }}
                      onClick={() => onOpenCompare([baseImages[Math.min(i, baseImages.length - 1)].url, image.url])}
                    >
                      <Columns size={14} /> 对比基础图像
                    </button>
                  )}
                  {(() => {
                    const key = `${result.promptId}-${image.filename}`;
                    const busy = uploadingImageKey === key;
                    return (
                      <Select
                        ariaLabel="作为输入图"
                        block
                        title="把这张图作为其它面板的参考图"
                        value=""
                        disabled={busy}
                        options={[
                          { value: "", label: busy ? "上传中…" : "作为输入图 ▾" },
                          { value: "default", label: "→ 默认生图" },
                          { value: "multi", label: "→ 多人工作流" },
                          { value: "highres", label: "→ 高清修复" },
                          { value: "anima", label: "→ Anima 生图" },
                          { value: "sheet", label: "→ 三视图" },
                          { value: "wd14", label: "→ 图片识别（反推）" },
                        ]}
                        onChange={(next) => {
                          if (!next) return;
                          setUploadingImageKey(key);
                          void onSendImageTo(image, next as TemplateKind | "wd14" | "sheet").finally(() =>
                            setUploadingImageKey(null),
                          );
                        }}
                      />
                    );
                  })()}
                </div>
              ));
            })()}
            {result.texts.length > 0 && <pre>{result.texts.join("\n")}</pre>}
          </div>
        ))}
      </div>
    </aside>
  );
}
