import React, { useEffect, useRef, useState } from "react";
import { Check, Copy, Plus, Star, ImageOff } from "lucide-react";
import type { AnimaGalleryItem } from "../../../lib/anima/types";

type Props = {
  item: AnimaGalleryItem;
  selected: boolean;
  favorite: boolean;
  ratio: "3 / 4" | "2 / 3";
  onToggleSelected: (item: AnimaGalleryItem) => void;
  onToggleFavorite: (item: AnimaGalleryItem) => void;
  onAdd: (item: AnimaGalleryItem) => void;
  onCopy: (item: AnimaGalleryItem) => void;
};

/**
 * 单张词条卡。
 * 远程缩略图失败率不低（animadex 没有 CORS 且偶发 404），失败时显示占位块，
 * 不显示破图图标；容器固定宽高比，图片加载时不抖动。
 */
export const AnimaGalleryCard = React.memo(({
  item,
  selected,
  favorite,
  ratio,
  onToggleSelected,
  onToggleFavorite,
  onAdd,
  onCopy,
}: Props) => {
  const [broken, setBroken] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // 第三方 CDN 可能被墙/超时，img 会一直挂起并显示浏览器的破图图标。
  // 8 秒还没拿到像素就直接转占位块，避免整屏都是左上角的小灰点。
  useEffect(() => {
    if (!item.preview || broken) return;
    const timer = window.setTimeout(() => {
      if ((imgRef.current?.naturalWidth ?? 0) === 0) setBroken(true);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [item.preview, broken]);

  return (
    <article className={`al-card${selected ? " is-selected" : ""}`}>
      <button
        type="button"
        className="al-card-cover"
        style={{ aspectRatio: ratio }}
        onClick={() => onToggleSelected(item)}
        title={selected ? "取消选择" : "选择"}
      >
        {item.preview && !broken ? (
          <img
            ref={imgRef}
            src={item.preview}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="al-card-placeholder" title={item.preview ? "缩略图加载失败（来源站点可能不可达）" : "暂无缩略图"}>
            <ImageOff size={18} />
          </span>
        )}
        <span className="al-card-check">{selected && <Check size={13} />}</span>
      </button>

      <button
        type="button"
        className={`al-card-fav${favorite ? " is-on" : ""}`}
        onClick={() => onToggleFavorite(item)}
        title={favorite ? "取消收藏" : "收藏"}
      >
        <Star size={14} fill={favorite ? "currentColor" : "none"} />
      </button>

      <div className="al-card-body">
        <div className="al-card-title" title={item.title}>{item.title}</div>
        {item.subtitle && <div className="al-card-sub" title={item.subtitle}>{item.subtitle}</div>}
        <div className="al-card-actions">
          <button type="button" onClick={() => onAdd(item)} title="加入对应分区">
            <Plus size={13} /> 加入
          </button>
          <button type="button" onClick={() => onCopy(item)} title="复制词条">
            <Copy size={13} />
          </button>
        </div>
      </div>
    </article>
  );
});
