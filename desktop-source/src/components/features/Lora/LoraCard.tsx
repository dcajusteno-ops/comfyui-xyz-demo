import { memo, useMemo } from "react";
import type { LoraItem, LoraManagerSettings, LoraPreviewMedia, TemplateKind } from "../../../types";
import { shouldBlurNsfwLevel } from "../../../lib/nsfw";
import { subTypeAbbreviation, baseModelAbbreviation } from "../../../lib/lora-helper";
import { formatBytes } from "../../../lib/file-helper";
import { LoraMedia } from "./LoraMedia";

// 卡片版式（2026-09-25 重做）：封面区（1:1，徽标左上 / 快捷插入右下悬停浮现）+ 实底信息面板（名称一行省略 + folder·大小 + 触发词）。
// 信息面板不再压在封面渐变上——旧版把 4 行文字挤在封面底部 36% 的渐变里，长模型名会把后面的行挤掉，且浅色主题下白字看不清。
export const LoraCard = memo(({ 
  item, 
  words,
  previewNsfwLevel,
  previewUrl,
  previewPath,
  previewType,
  previewSource,
  settings, 
  apiBase, 
  onDetail, 
  onInsert 
}: {
  item: LoraItem;
  words: string[];
  previewNsfwLevel: number;
  previewUrl?: string;
  previewPath?: string;
  previewType?: string;
  previewSource?: string;
  settings: LoraManagerSettings;
  apiBase: string;
  onDetail: (item: LoraItem) => void;
  onInsert?: (item: LoraItem, target: TemplateKind) => void;
}) => {
  const key = item.model_name || item.file_name;
  const previewMedia = useMemo(() => ({
    url: previewUrl,
    path: previewPath,
    type: previewType,
    source: previewSource,
  } as LoraPreviewMedia), [previewUrl, previewPath, previewType, previewSource]);

  return (
    <article
      className={[
        "lora-card lm-model-card",
        shouldBlurNsfwLevel(previewNsfwLevel, settings) ? "nsfw-content" : "",
      ].filter(Boolean).join(" ")}
      data-nsfw-level={previewNsfwLevel}
      onClick={() => onDetail(item)}
      tabIndex={0}
    >
      <div className="lora-preview lm-card-preview">
        <LoraMedia
          media={previewMedia}
          apiBase={apiBase}
          alt={key}
          settings={settings}
          fallbackNsfwLevel={previewNsfwLevel}
        />
        <div className="card-header lm-card-header">
          <div className="card-header-info">
            <span className="base-model-label" title={`${item.sub_type || "LoRA"} | ${item.base_model || "Unknown"}`}>
              <span className="model-sub-type">{subTypeAbbreviation(item.sub_type)}</span>
              <span className="model-separator" />
              <span className="model-base-type">{baseModelAbbreviation(item.base_model)}</span>
            </span>
            {item.update_available && <span className="model-update-badge">Update</span>}
          </div>
        </div>
        <div className="card-quick-actions">
          <button type="button" title="添加到默认" onClick={(e) => { e.stopPropagation(); onInsert?.(item, "default"); }}>默认</button>
          <button type="button" title="添加到多人" onClick={(e) => { e.stopPropagation(); onInsert?.(item, "multi"); }}>多人</button>
          <button type="button" title="添加到高修" onClick={(e) => { e.stopPropagation(); onInsert?.(item, "highres"); }}>高修</button>
        </div>
      </div>
      <div className="card-footer lm-card-footer">
        <div className="lora-info model-info">
          <strong className="model-name" title={key}>{key}</strong>
          <span className="model-meta">{item.folder || "root"} · {formatBytes(item.file_size)}</span>
          {/* 触发词行常驻占位（内容为空时保留行高），保证同排卡片高度一致 */}
          <p className="model-tags">{words.slice(0, 2).join(" / ")}</p>
        </div>
      </div>
    </article>
  );
});
