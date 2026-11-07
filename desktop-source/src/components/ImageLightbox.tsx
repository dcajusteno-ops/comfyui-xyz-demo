import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  RefreshCw,
  Stamp,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

interface ImageLightboxProps {
  url: string;
  /** 自动水印产出的图：原图 URL（水印入口用它，避免二次叠加） */
  originalUrl?: string;
  onClose: () => void;
  /** 打开文字水印弹窗（传入源图 URL；不传则不显示入口） */
  onWatermark?: (url: string) => void;
  /** 图片管理器专属：上一张 / 下一张（不传则不显示箭头、不响应方向键） */
  onPrev?: () => void;
  onNext?: () => void;
  /** 图片管理器专属：当前序号（1-based）与总数 */
  position?: { index: number; total: number };
  /** 图片管理器专属：文件名（底部条显示） */
  caption?: string;
  /** 图片管理器专属：是否已标记为删除备选 */
  marked?: boolean;
  onToggleMark?: () => void;
  /** 图片管理器专属：已标记数量 */
  markedCount?: number;
}

export function ImageLightbox({
  url,
  originalUrl,
  onClose,
  onWatermark,
  onPrev,
  onNext,
  position,
  caption,
  marked = false,
  onToggleMark,
  markedCount = 0,
}: ImageLightboxProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);

  const handleZoomIn = useCallback(() => setScale(s => Math.min(s + 0.2, 5)), []);
  const handleZoomOut = useCallback(() => setScale(s => Math.max(s - 0.2, 0.5)), []);
  const handleReset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // 换图时重置缩放，否则上一张的放大状态会带到下一张
  useEffect(() => {
    handleReset();
  }, [url, handleReset]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") handleZoomIn();
      if (e.key === "-" || e.key === "_") handleZoomOut();
      if (e.key === "0") handleReset();
      if (e.key === "ArrowLeft" && onPrev) {
        e.preventDefault();
        onPrev();
      }
      if (e.key === "ArrowRight" && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onPrev, onNext, handleZoomIn, handleZoomOut, handleReset]);

  const handleWheel = (e: React.WheelEvent) => {
    // Zoom relative to mouse position would be better but let's keep it simple for now
    if (e.deltaY < 0) handleZoomIn();
    else handleZoomOut();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleDownload = async () => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `image-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Failed to download image", err);
    }
  };

  const handleCopy = async () => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
    } catch (err) {
      console.error("Failed to copy image", err);
    }
  };

  return (
    <div className="lm-lightbox" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="lm-lightbox-bg-blur" style={{ backgroundImage: `url(${url})` }} />
      <div className="lm-lightbox-content" onMouseDown={e => e.stopPropagation()}>
        <div className="lm-lightbox-toolbar">
          <div className="lm-toolbar-group">
            <button onClick={handleZoomIn} title="放大 (Ctrl +)"><ZoomIn size={18} /></button>
            <button onClick={handleZoomOut} title="缩小 (Ctrl -)"><ZoomOut size={18} /></button>
            <button onClick={handleReset} title="重置 (0)"><RefreshCw size={18} /></button>
          </div>
          <div className="lm-toolbar-divider" />
          <div className="lm-toolbar-group">
            {onWatermark && (
              <button onClick={() => onWatermark(originalUrl ?? url)} title="添加文字水印">
                <Stamp size={18} />
              </button>
            )}
            <button onClick={handleCopy} title="复制到剪贴板"><Copy size={18} /></button>
            <button onClick={handleDownload} title="下载图片"><Download size={18} /></button>
          </div>
          <div className="lm-toolbar-divider" />
          <div className="lm-toolbar-group">
            <button onClick={onClose} title="关闭 (Esc)"><X size={18} /></button>
          </div>
        </div>

        {onPrev && (
          <button type="button" className="lm-lightbox-nav prev" onClick={onPrev} title="上一张（←）">
            <ChevronLeft size={24} />
          </button>
        )}
        {onNext && (
          <button type="button" className="lm-lightbox-nav next" onClick={onNext} title="下一张（→）">
            <ChevronRight size={24} />
          </button>
        )}

        <div
          className="lm-lightbox-media-container"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
          }}
        >
          <img
            ref={imgRef}
            src={url}
            alt="Preview"
            className="lm-media-asset"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            }}
            draggable={false}
          />
        </div>

        {(caption || position || onToggleMark) && (
          <div className="lm-lightbox-footer">
            <span className="lm-lightbox-caption" title={caption}>
              {caption ?? ""}
            </span>
            {position && (
              <span className="lm-lightbox-counter">
                {position.index} / {position.total}
              </span>
            )}
            <span className="lm-lightbox-footer-spacer" />
            {markedCount > 0 && <span className="lm-lightbox-marked">已标记 {markedCount} 张</span>}
            {onToggleMark && (
              <button
                type="button"
                className={`lm-lightbox-mark${marked ? " is-marked" : ""}`}
                onClick={onToggleMark}
                title={marked ? "取消删除标记" : "标记为删除备选（关闭灯箱后可统一删除）"}
              >
                {marked ? <Check size={15} /> : <Trash2 size={15} />}
                {marked ? "取消标记" : "标记删除"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
