import React, { useState } from "react";
import { OutputImage } from "../types";
import { ImageCompare } from "./ImageCompare";

export function ImageGalleryItem({ images, setOutputLightbox }: { images: OutputImage[], setOutputLightbox: (url: string) => void }) {
  const [compareMode, setCompareMode] = useState(false);
  const [leftIndex, setLeftIndex] = useState(0);
  const [rightIndex, setRightIndex] = useState(Math.max(0, images.length - 1));

  if (images.length === 0) return null;

  if (images.length === 1) {
    return (
      <div>
        {images[0].nodeTitle && <div className="image-stage-label">{images[0].nodeTitle}</div>}
        <img 
          src={images[0].url} 
          alt={images[0].filename} 
          style={{ cursor: "zoom-in" }}
          onClick={() => setOutputLightbox(images[0].url)}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="compare-toolbar">
        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "14px" }}>
          <input type="checkbox" checked={compareMode} onChange={e => setCompareMode(e.target.checked)} />
          对比模式
        </label>
        {compareMode && (
          <>
            <select value={leftIndex} onChange={e => setLeftIndex(Number(e.target.value))}>
              {images.map((img, i) => <option key={i} value={i}>{img.nodeTitle || `阶段 ${i+1}`}</option>)}
            </select>
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>vs</span>
            <select value={rightIndex} onChange={e => setRightIndex(Number(e.target.value))}>
              {images.map((img, i) => <option key={i} value={i}>{img.nodeTitle || `阶段 ${i+1}`}</option>)}
            </select>
          </>
        )}
      </div>

      {compareMode ? (
        <ImageCompare leftImage={images[leftIndex].url} rightImage={images[rightIndex].url} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {images.map((img, i) => (
            <div key={i}>
              {img.nodeTitle && <div className="image-stage-label">{img.nodeTitle}</div>}
              <img 
                src={img.url} 
                alt={img.filename} 
                style={{ cursor: "zoom-in", display: "block", width: "100%" }}
                onClick={() => setOutputLightbox(img.url)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
