import React, { useState, useEffect, useRef } from "react";
import { Boxes, GripVertical, X } from "lucide-react";
import { LoraMedia } from "./LoraMedia";
import { isVideoPath } from "../../../lib/lora-media";
import type {
  LoraSelection,
  LoraItem,
  LoraManagerSettings,
  LoraExampleMedia,
} from "../../../types";

export function LoraChips({
  loras,
  onChange,
  onDetail,
  apiBase,
  settings,
  localExampleFilesByHash = {},
}: {
  loras: LoraSelection[];
  onChange: (loras: LoraSelection[]) => void;
  onDetail?: (item: LoraItem) => void;
  apiBase: string;
  settings: LoraManagerSettings;
  localExampleFilesByHash?: Record<string, LoraExampleMedia[]>;
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [draggableIndex, setDraggableIndex] = useState<number | null>(null);
  const [isDraggingActive, setIsDraggingActive] = useState(false);
  const scrollIntervalRef = useRef<number | null>(null);
  const scrollParentRef = useRef<HTMLElement | null>(null);
  const scrollVelocityRef = useRef<number>(0);

  useEffect(() => {
    const handleGlobalDragEnd = () => {
      setDraggedIndex(null);
      setDraggableIndex(null);
      setIsDraggingActive(false);
      scrollParentRef.current = null;
      scrollVelocityRef.current = 0;
      if (scrollIntervalRef.current) {
        window.clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
    };

    window.addEventListener("dragend", handleGlobalDragEnd);
    return () => {
      window.removeEventListener("dragend", handleGlobalDragEnd);
      if (scrollIntervalRef.current) {
        window.clearInterval(scrollIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleWindowDragOver = (e: DragEvent) => {
      if (!isDraggingActive || !scrollParentRef.current) return;

      const threshold = 80;
      const maxSpeed = 20;
      const { clientY } = e;

      const scrollParent = scrollParentRef.current;
      const rect = scrollParent.getBoundingClientRect();
      const relativeY = clientY - rect.top;

      if (relativeY >= 0 && relativeY < threshold) {
        const intensity = Math.max(0, Math.min(1, (threshold - relativeY) / threshold));
        scrollVelocityRef.current = -maxSpeed * Math.pow(intensity, 2);
      } else if (relativeY > rect.height - threshold && relativeY <= rect.height) {
        const intensity = Math.max(0, Math.min(1, (relativeY - (rect.height - threshold)) / threshold));
        scrollVelocityRef.current = maxSpeed * Math.pow(intensity, 2);
      } else {
        scrollVelocityRef.current = 0;
      }
    };

    if (isDraggingActive) {
      window.addEventListener("dragover", handleWindowDragOver);
      scrollIntervalRef.current = window.setInterval(() => {
        if (scrollParentRef.current && scrollVelocityRef.current !== 0) {
          scrollParentRef.current.scrollBy(0, scrollVelocityRef.current);
        }
      }, 16);
    } else {
      window.removeEventListener("dragover", handleWindowDragOver);
      if (scrollIntervalRef.current) {
        window.clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
      scrollVelocityRef.current = 0;
    }

    return () => {
      window.removeEventListener("dragover", handleWindowDragOver);
      if (scrollIntervalRef.current) {
        window.clearInterval(scrollIntervalRef.current);
      }
    };
  }, [isDraggingActive]);

  if (!loras.length) {
    return <div className="empty-strip">未选择 LoRA</div>;
  }

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";

    const getScrollParent = (node: HTMLElement | null): HTMLElement | null => {
      if (!node) return null;
      if (
        node.scrollHeight > node.clientHeight &&
        (window.getComputedStyle(node).overflowY === "auto" ||
          window.getComputedStyle(node).overflowY === "scroll")
      ) {
        return node;
      }
      return getScrollParent(node.parentElement);
    };
    scrollParentRef.current = getScrollParent(e.currentTarget as HTMLElement) || document.documentElement;

    setTimeout(() => {
      setIsDraggingActive(true);
    }, 0);
  };

  const handleDragEnter = (e: React.DragEvent, index: number) => {
    if (draggedIndex === null || draggedIndex === index) return;

    const newLoras = [...loras];
    const draggedItem = newLoras[draggedIndex];
    newLoras.splice(draggedIndex, 1);
    newLoras.splice(index, 0, draggedItem);

    setDraggedIndex(index);
    onChange(newLoras);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDraggableIndex(null);
    setIsDraggingActive(false);
    scrollParentRef.current = null;
    scrollVelocityRef.current = 0;
    if (scrollIntervalRef.current) {
      window.clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  };

  return (
    <div className="lora-selection-grid">
      {loras.map((lora, index) => {
        const hash = lora.sha256?.toLowerCase();
        const fallbackPreview = hash
          ? localExampleFilesByHash[hash]?.[0]?.path || localExampleFilesByHash[hash]?.[0]?.url
          : undefined;
        const previewUrl = lora.previewUrl || fallbackPreview;
        const cardKey = lora.sha256 ? `lora-${lora.sha256}` : `lora-${lora.name}-${index}`;

        return (
          <div
            className={`lora-selection-card ${lora.active ? "" : "disabled"} ${
              draggedIndex === index ? "dragging" : ""
            } ${draggedIndex === index && isDraggingActive ? "dragging-active" : ""}`}
            key={cardKey}
            draggable={draggableIndex === index}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnter={(e) => handleDragEnter(e, index)}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDrop={(e) => e.preventDefault()}
          >
            <div className="lora-card-preview" onClick={() => onDetail?.(lora as any)}>
              {previewUrl ? (
                <LoraMedia
                  media={{
                    url: previewUrl,
                    type: isVideoPath(previewUrl || "") ? "video" : "image",
                    source: "preview",
                  }}
                  apiBase={apiBase}
                  alt={lora.displayName || lora.name}
                  settings={settings}
                />
              ) : (
                <div className="lora-card-placeholder">
                  <Boxes size={24} opacity={0.2} />
                </div>
              )}
              <div
                className="lora-card-handle"
                onMouseEnter={() => setDraggableIndex(index)}
                onMouseLeave={() => draggedIndex === null && setDraggableIndex(null)}
              >
                <GripVertical size={12} />
              </div>
            </div>

            <div className="lora-card-info">
              <div className="lora-card-header-row">
                <div className="lora-card-name" title={lora.displayName || lora.name}>
                  {lora.displayName || lora.name}
                </div>
                <div
                  className="lora-card-actions"
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                >
                  <label
                    className="lora-card-toggle"
                    onClick={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={lora.active}
                      onDragStart={(e) => e.stopPropagation()}
                      onChange={(event) =>
                        onChange(
                          loras.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, active: event.target.checked } : item
                          )
                        )
                      }
                    />
                    <span className="checkbox-custom"></span>
                  </label>
                  <button
                    className="lora-card-remove"
                    type="button"
                    title="移除"
                    onDragStart={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(loras.filter((_, itemIndex) => itemIndex !== index));
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div
                className="lora-card-controls"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <div
                  className="lora-slider-wrapper"
                  style={
                    {
                      "--slider-thumb-pos": `${((lora.strength + 2) / 4) * 100}%`,
                    } as React.CSSProperties
                  }
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                >
                  <input
                    className="lora-slider"
                    type="range"
                    value={lora.strength}
                    min={-2}
                    max={2}
                    step={0.05}
                    onDragStart={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onChange={(event) =>
                      onChange(
                        loras.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                strength: Number(event.target.value),
                                clipStrength: Number(event.target.value),
                              }
                            : item
                        )
                      )
                    }
                  />
                  <div
                    className="lora-slider-track-fill"
                    style={{
                      width: `${((lora.strength + 2) / 4) * 100}%`,
                      background: lora.strength >= 0 ? "var(--accent)" : "#ef4444",
                    }}
                  ></div>
                </div>
                <input
                  className="lora-number"
                  type="number"
                  value={lora.strength}
                  min={-10}
                  max={10}
                  step={0.05}
                  onDragStart={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onChange={(event) =>
                    onChange(
                      loras.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              strength: Number(event.target.value),
                              clipStrength: Number(event.target.value),
                            }
                          : item
                      )
                    )
                  }
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
