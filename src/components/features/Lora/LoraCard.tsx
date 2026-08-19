import { memo, useMemo } from "react";
import { Layers } from "lucide-react";
import type { LoraItem, LoraManagerSettings, LoraPreviewMedia, TemplateKind } from "../../../types";
import { shouldBlurNsfwLevel } from "../../../lib/nsfw";
import { subTypeAbbreviation, baseModelAbbreviation } from "../../../lib/lora-helper";
import { formatBytes } from "../../../lib/file-helper";
import { LoraMedia } from "./LoraMedia";

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
        {!previewMedia.path && !previewMedia.url && <Layers size={34} />}
        <div className="card-header lm-card-header">
          <div className="card-header-info">
            <span className="base-model-label" title={`${item.sub_type || "LoRA"} | ${item.base_model || "Unknown"}`}>
              <span className="model-sub-type">{subTypeAbbreviation(item.sub_type)}</span>
              <span className="model-separator" />
              <span className="model-base-type">{baseModelAbbreviation(item.base_model)}</span>
            </span>
            {item.update_available && <span className="model-update-badge">Update</span>}
          </div>
          <div className="card-quick-actions">
            <button type="button" title="添加到默认" onClick={(e) => { e.stopPropagation(); onInsert?.(item, "default"); }}>默认</button>
            <button type="button" title="添加到多人" onClick={(e) => { e.stopPropagation(); onInsert?.(item, "multi"); }}>多人</button>
            <button type="button" title="添加到高修" onClick={(e) => { e.stopPropagation(); onInsert?.(item, "highres"); }}>高修</button>
          </div>
        </div>
        <div className="card-footer lm-card-footer">
          <div className="lora-info model-info">
            <strong className="model-name">{key}</strong>
            <span className="version-name">{(item.civitai as any)?.name || item.folder || "local"}</span>
            <span>{item.folder || "root"} · {formatBytes(item.file_size)}</span>
            {words.length > 0 && <p>{words.slice(0, 2).join(" / ")}</p>}
          </div>
        </div>
      </div>
    </article>
  );
});
