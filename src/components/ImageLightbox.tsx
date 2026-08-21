import React, { useState, useRef, useEffect } from "react";
import { X, ZoomIn, ZoomOut, Download, Copy, RefreshCw } from "lucide-react";

interface ImageLightboxProps {
  url: string;
  onClose: () => void;
}

export function ImageLightbox({ url, onClose }: ImageLightboxProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") handleZoomIn();
      if (e.key === "-" || e.key === "_") handleZoomOut();
      if (e.key === "0") handleReset();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleZoomIn = () => setScale(s => Math.min(s + 0.2, 5));
  const handleZoomOut = () => setScale(s => Math.max(s - 0.2, 0.5));
  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    // Zoom relative to mouse position would be better but let's keep it simple for now
    if (e.deltaY < 0) handleZoomIn();
    else handleZoomOut();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPosition({
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
            <button onClick={handleCopy} title="复制到剪贴板"><Copy size={18} /></button>
            <button onClick={handleDownload} title="下载图片"><Download size={18} /></button>
          </div>
          <div className="lm-toolbar-divider" />
          <div className="lm-toolbar-group">
            <button onClick={onClose} title="关闭 (Esc)"><X size={18} /></button>
          </div>
        </div>
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
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            }}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
