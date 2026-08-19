import { memo, useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { Eye, EyeOff, Layers } from "lucide-react";
import type { LoraExampleMedia, LoraManagerSettings } from "../../../types";
import { normalizePreview } from "../../../lib/lora-helper";
import { getMediaNsfwLevel, getNSFWLevelName, getNsfwWarningText, shouldBlurNsfwLevel } from "../../../lib/nsfw";
import { isLoraVideo } from "../../../lib/lora-media";

export const LoraMedia = memo(({
  media,
  apiBase,
  alt,
  controls = false,
  settings,
  fallbackNsfwLevel = 0,
  onOpen,
}: {
  media: LoraExampleMedia;
  apiBase: string;
  alt: string;
  controls?: boolean;
  settings: LoraManagerSettings;
  fallbackNsfwLevel?: number;
  onOpen?: () => void;
}) => {
  const src = normalizePreview(apiBase, media.path || media.url);
  const [revealed, setRevealed] = useState(false);
  const nsfwLevel = getMediaNsfwLevel(media, fallbackNsfwLevel);
  const shouldBlur = shouldBlurNsfwLevel(nsfwLevel, settings);
  const isBlurred = shouldBlur && !revealed;

  useEffect(() => {
    setRevealed(false);
  }, [src, shouldBlur]);

  if (!src) {
    return <div className="lm-media-empty"><Layers size={34} /></div>;
  }
  const mediaClassName = isBlurred ? "lm-media-asset blurred" : "lm-media-asset";
  const mediaClassWithOpen = onOpen && !isBlurred ? `${mediaClassName} openable` : mediaClassName;
  const warningText = getNsfwWarningText(nsfwLevel);
  const levelName = getNSFWLevelName(nsfwLevel);
  const toggleTitle = revealed ? "重新模糊限制级内容" : "显示限制级内容";
  const stopClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setRevealed((current) => !current);
  };

  const mediaNode = isLoraVideo(media, src) ? (
    <video
      src={src}
      controls={controls}
      autoPlay={!controls}
      muted
      loop
      playsInline
      preload="none"
      className={mediaClassWithOpen}
      data-nsfw-level={nsfwLevel}
    />
  ) : (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      draggable={false}
      className={mediaClassWithOpen}
      data-nsfw-level={nsfwLevel}
      onClick={onOpen && !isBlurred ? (event) => {
        event.stopPropagation();
        onOpen();
      } : undefined}
    />
  );

  return (
    <div className={shouldBlur ? "lm-media-frame nsfw-media-wrapper" : "lm-media-frame"} data-nsfw-level={nsfwLevel}>
      {mediaNode}
      {shouldBlur && (
        <button type="button" className="lm-restricted-toggle" title={toggleTitle} aria-label={toggleTitle} onClick={stopClick}>
          {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      )}
      {isBlurred && (
        <div className="lm-nsfw-overlay">
          <div className="lm-nsfw-warning">
            <p>{warningText}</p>
            <small>NSFW {levelName}</small>
            <button type="button" className="lm-show-content-btn" onClick={stopClick}>Show</button>
          </div>
        </div>
      )}
    </div>
  );
}, (prev, next) => {
  return prev.apiBase === next.apiBase &&
         prev.alt === next.alt &&
         prev.controls === next.controls &&
         prev.settings === next.settings &&
         prev.fallbackNsfwLevel === next.fallbackNsfwLevel &&
         prev.onOpen === next.onOpen &&
         prev.media.url === next.media.url &&
         prev.media.path === next.media.path &&
         prev.media.type === next.media.type &&
         prev.media.source === next.media.source;
});
