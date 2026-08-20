import React, { useState, useEffect, useRef } from "react";
import { X, Columns } from "lucide-react";

export function ImageComparerModal({ imageA, imageB, onClose }: { imageA: string; imageB: string; onClose: () => void }) {
  const [sliderPos, setSliderPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const updateSlider = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setSliderPos(pos);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="对比图像"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        backgroundColor: 'rgba(0,0,0,0.9)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: '12px',
      }}
    >
      {/* Header bar */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: 'min(92vw, 1200px)', color: '#e7edf7', flexShrink: 0 }}
      >
        <span style={{ fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: '#93a4ba' }}>
          <Columns size={15} /> 拖动中间滑块对比
        </span>
        <button
          type="button"
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ background: 'none', border: 'none', color: '#93a4ba', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Comparison area */}
      <div
        ref={containerRef}
        onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); updateSlider(e.clientX); }}
        onPointerMove={(e) => { if (e.buttons === 1) updateSlider(e.clientX); }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
        style={{
          position: 'relative',
          maxWidth: 'min(92vw, 1200px)',
          maxHeight: 'calc(92vh - 50px)',
          cursor: 'col-resize',
          userSelect: 'none',
          lineHeight: 0,
          borderRadius: '8px',
          overflow: 'hidden',
          flexShrink: 1,
        }}
      >
        {/* Base image (A) — sets the natural dimensions */}
        <img
          src={imageA}
          alt="基础图像"
          style={{ display: 'block', maxWidth: '100%', maxHeight: 'calc(92vh - 50px)', objectFit: 'contain', pointerEvents: 'none' }}
          draggable={false}
        />

        {/* Repaired image (B) — overlaid, clipped by slider */}
        <img
          src={imageB}
          alt="修复结果"
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'contain',
            clipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
            pointerEvents: 'none',
          }}
          draggable={false}
        />

        {/* Slider divider line */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${sliderPos}%`,
          width: '2px',
          backgroundColor: '#fff',
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
          boxShadow: '0 0 6px rgba(0,0,0,0.8)',
        }}>
          {/* Handle circle */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '38px', height: '38px',
            borderRadius: '50%',
            backgroundColor: '#fff',
            border: '2px solid #ddd',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 4px rgba(0,0,0,0.3)',
          }}>
            <Columns size={16} color="#333" />
          </div>
        </div>
      </div>
    </div>
  );
}
