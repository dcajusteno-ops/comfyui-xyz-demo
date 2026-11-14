import { memo, useEffect, useRef, useState } from "react";
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
  initialRevealed = false,
  onRevealChange,
  onOpen,
}: {
  media: LoraExampleMedia;
  apiBase: string;
  alt: string;
  controls?: boolean;
  settings: LoraManagerSettings;
  fallbackNsfwLevel?: number;
  /** 初始是否已解禁（大图查看沿用网格里已解禁的状态，避免同一张图被糊两次） */
  initialRevealed?: boolean;
  /** 把解禁状态镜像给调用方（示例卡片用它把状态带给大图查看） */
  onRevealChange?: (revealed: boolean) => void;
  onOpen?: () => void;
}) => {
  const src = normalizePreview(apiBase, media.path || media.url);
  const [revealed, setRevealed] = useState(initialRevealed);
  const nsfwLevel = getMediaNsfwLevel(media, fallbackNsfwLevel);
  const shouldBlur = shouldBlurNsfwLevel(nsfwLevel, settings);
  const isBlurred = shouldBlur && !revealed;

  useEffect(() => {
    setRevealed(initialRevealed);
  }, [src, shouldBlur, initialRevealed]);

  // 只在同步给调用方这一个副作用上做通知（不塞进 setState updater，避免 StrictMode 下重复调用）
  useEffect(() => {
    onRevealChange?.(revealed);
  }, [revealed, onRevealChange]);

  // 对齐 LoRA Manager 的 configureModelCardVideo：卡片封面视频不依赖 autoplay 属性，
  // 换源/挂载后主动 play()；被播放策略拦截时静默失败（preload=metadata 仍会显示首帧）。
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (controls) return;
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    const tryPlay = () => {
      const promise = video.play();
      if (promise && typeof promise.catch === "function") promise.catch(() => undefined);
    };
    tryPlay();
    video.addEventListener("loadeddata", tryPlay);
    return () => video.removeEventListener("loadeddata", tryPlay);
  }, [src, controls]);

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
      ref={videoRef}
      src={src}
      controls={controls}
      autoPlay={!controls}
      muted
      loop
      playsInline
      preload="metadata"
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
         prev.initialRevealed === next.initialRevealed &&
         prev.onRevealChange === next.onRevealChange &&
         prev.onOpen === next.onOpen &&
         prev.media.url === next.media.url &&
         prev.media.path === next.media.path &&
         prev.media.type === next.media.type &&
         prev.media.source === next.media.source;
});
