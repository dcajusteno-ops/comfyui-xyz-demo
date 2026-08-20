import React, { useState, useEffect, useRef, PointerEvent, MouseEvent, CSSProperties } from "react";
import { Boxes, Copy, Trash2 } from "lucide-react";
import { NumberField, SelectField, TextAreaField } from "../../ui/FormFields";
import {
  enabledCanvasCharacters,
  moveMaskRect,
  resizeMaskRect,
  findOverlapRegions,
  autoBalanceWeights,
} from "../../../lib/multiCanvas";
import {
  duplicateCharacter,
  removeCharacter,
} from "../../../lib/multiCharacters";
import { roundCanvasMask } from "../../../lib/lora-helper";
import { hexToRgba } from "../../../lib/color-helper";
import type { MultiCharacter, MaskHandle } from "../../../types";

type CanvasInteraction = {
  id: string;
  mode: "move" | MaskHandle;
  pointerId?: number;
  startX: number;
  startY: number;
  startMask: MultiCharacter["mask"];
  rect: { width: number; height: number };
};

export function MultiWorkspace({
  canvasWidth,
  canvasHeight,
  characters,
  onChange,
}: {
  canvasWidth: number;
  canvasHeight: number;
  characters: MultiCharacter[];
  onChange: (characters: MultiCharacter[]) => void;
}) {
  const visibleCharacters = enabledCanvasCharacters(characters);
  const [selectedId, setSelectedId] = useState(visibleCharacters[0]?.id ?? "");

  useEffect(() => {
    if (selectedId && !characters.some((character) => character.id === selectedId)) {
      const visible = enabledCanvasCharacters(characters);
      setSelectedId(visible[0]?.id ?? "");
    }
  }, [characters, selectedId]);

  return (
    <>
      <MultiCanvasEditor
        canvasWidth={canvasWidth}
        canvasHeight={canvasHeight}
        characters={characters}
        onChange={onChange}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <CharacterEditor
        characters={characters}
        onChange={onChange}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
    </>
  );
}

function MultiCanvasEditor({
  canvasWidth,
  canvasHeight,
  characters,
  onChange,
  selectedId,
  onSelect,
}: {
  canvasWidth: number;
  canvasHeight: number;
  characters: MultiCharacter[];
  onChange: (characters: MultiCharacter[]) => void;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<CanvasInteraction | null>(null);
  const visibleCharacters = enabledCanvasCharacters(characters);
  const [interaction, setInteraction] = useState<CanvasInteraction | null>(null);

  useEffect(() => {
    if (!interaction) return;
    const move = (event: globalThis.MouseEvent | globalThis.PointerEvent) => {
      applyInteraction(event.clientX, event.clientY);
    };
    const end = () => {
      interactionRef.current = null;
      setInteraction(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [interaction]);

  function updateMask(id: string, mask: MultiCharacter["mask"]) {
    onChange(
      characters.map((character) =>
        character.id === id ? { ...character, mask: roundCanvasMask(mask) } : character
      )
    );
  }

  function startInteraction(
    event: PointerEvent<HTMLElement>,
    character: MultiCharacter,
    mode: CanvasInteraction["mode"]
  ) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    canvasRef.current?.setPointerCapture(event.pointerId);
    beginInteraction(event.clientX, event.clientY, character, mode, event.pointerId, {
      width: rect.width,
      height: rect.height,
    });
  }

  function startMouseInteraction(
    event: MouseEvent<HTMLElement>,
    character: MultiCharacter,
    mode: CanvasInteraction["mode"]
  ) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || interactionRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    beginInteraction(event.clientX, event.clientY, character, mode, undefined, {
      width: rect.width,
      height: rect.height,
    });
  }

  function beginInteraction(
    clientX: number,
    clientY: number,
    character: MultiCharacter,
    mode: CanvasInteraction["mode"],
    pointerId: number | undefined,
    rect: CanvasInteraction["rect"]
  ) {
    onSelect(character.id);
    const nextInteraction = {
      id: character.id,
      mode,
      pointerId,
      startX: clientX,
      startY: clientY,
      startMask: character.mask,
      rect,
    };
    interactionRef.current = nextInteraction;
    setInteraction(nextInteraction);
  }

  function moveInteraction(event: PointerEvent<HTMLDivElement>) {
    applyInteraction(event.clientX, event.clientY);
  }

  function endInteraction(event: PointerEvent<HTMLDivElement>) {
    if (interactionRef.current?.pointerId === event.pointerId) {
      canvasRef.current?.releasePointerCapture(event.pointerId);
      interactionRef.current = null;
      setInteraction(null);
    }
  }

  function moveMouseInteraction(event: MouseEvent<HTMLDivElement>) {
    applyInteraction(event.clientX, event.clientY);
  }

  function applyInteraction(clientX: number, clientY: number) {
    const current = interactionRef.current;
    if (!current) return;
    const deltaX = (clientX - current.startX) / current.rect.width;
    const deltaY = (clientY - current.startY) / current.rect.height;
    const nextMask =
      current.mode === "move"
        ? moveMaskRect(current.startMask, deltaX, deltaY)
        : resizeMaskRect(current.startMask, current.mode, deltaX, deltaY);
    updateMask(current.id, nextMask);
  }

  function endMouseInteraction() {
    interactionRef.current = null;
    setInteraction(null);
  }

  return (
    <div className="multi-canvas-panel">
      <div className="section-toolbar">
        <strong>角色画布</strong>
        <div style={{ display: "flex", gap: "8px", fontSize: "11px", color: "#888" }}>
          <span>
            {canvasWidth}x{canvasHeight}
          </span>
          {findOverlapRegions(characters).length > 0 && (
            <span style={{ color: "#ff4757", fontWeight: 600 }}>
              重叠区域: {findOverlapRegions(characters).length}
            </span>
          )}
        </div>
      </div>
      <div
        className="multi-canvas"
        ref={canvasRef}
        onPointerMove={moveInteraction}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
        onMouseMove={moveMouseInteraction}
        onMouseUp={endMouseInteraction}
        onMouseLeave={endMouseInteraction}
      >
        {visibleCharacters.map((character) => {
          const style = {
            left: `${character.mask.x * 100}%`,
            top: `${character.mask.y * 100}%`,
            width: `${character.mask.width * 100}%`,
            height: `${character.mask.height * 100}%`,
            "--mask-color": character.color,
            "--mask-fill": hexToRgba(character.color, 0.28),
          } as CSSProperties;
          return (
            <div
              className={selectedId === character.id ? "mask-region selected" : "mask-region"}
              key={character.id}
              style={style}
              onPointerDown={(event) => startInteraction(event, character, "move")}
              onMouseDown={(event) => startMouseInteraction(event, character, "move")}
            >
              {character.feather > 0 && (
                <div
                  className="mask-feather-preview"
                  style={{
                    position: "absolute",
                    inset: 0,
                    boxShadow: `inset 0 0 ${character.feather}px ${character.color}`,
                    opacity: 0.4,
                    pointerEvents: "none",
                    borderRadius: "inherit",
                  }}
                />
              )}
              <span>{character.name}</span>
              {(["nw", "ne", "sw", "se"] as MaskHandle[]).map((handle) => (
                <button
                  aria-label={`${character.name} ${handle}`}
                  className={`mask-handle ${handle}`}
                  key={handle}
                  type="button"
                  onPointerDown={(event) => startInteraction(event, character, handle)}
                  onMouseDown={(event) => startMouseInteraction(event, character, handle)}
                />
              ))}
            </div>
          );
        })}
        {findOverlapRegions(characters).map((overlap, idx) => (
          <div
            key={`overlap-${idx}`}
            className="mask-overlap-region"
            style={{
              position: "absolute",
              left: `${overlap.rect.x * 100}%`,
              top: `${overlap.rect.y * 100}%`,
              width: `${overlap.rect.width * 100}%`,
              height: `${overlap.rect.height * 100}%`,
              backgroundColor: "rgba(255, 71, 87, 0.15)",
              border: "1px dashed rgba(255, 71, 87, 0.4)",
              pointerEvents: "none",
              zIndex: 10,
            }}
          />
        ))}
        {visibleCharacters.length === 0 && <div className="canvas-empty">启用角色后会显示 mask 区域</div>}
        <div className="canvas-corner">
          {canvasWidth}x{canvasHeight}
          <br />
          缩放: 100%
        </div>
      </div>
    </div>
  );
}

function CharacterEditor({
  characters,
  onChange,
  selectedId,
  onSelect,
}: {
  characters: MultiCharacter[];
  onChange: (characters: MultiCharacter[]) => void;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  function update(index: number, patch: Partial<MultiCharacter>) {
    onChange(
      characters.map((character, characterIndex) =>
        characterIndex === index ? { ...character, ...patch } : character
      )
    );
  }

  function updateMask(index: number, patch: Partial<MultiCharacter["mask"]>) {
    onChange(
      characters.map((character, characterIndex) =>
        characterIndex === index ? { ...character, mask: { ...character.mask, ...patch } } : character
      )
    );
  }

  const selectedIndex = characters.findIndex((c) => c.id === selectedId);
  const activeCharacter = characters[selectedIndex] || characters[0];
  const activeIndex = selectedIndex !== -1 ? selectedIndex : 0;

  return (
    <div className="character-panel">
      <div className="section-toolbar">
        <strong>角色控制</strong>
      </div>
      <div className="character-tabs">
        {characters.map((character, index) => (
          <button
            key={character.id}
            type="button"
            className={`character-tab ${selectedId === character.id ? "active" : ""}`}
            onClick={() => onSelect(character.id)}
          >
            <span className="tab-color-dot" style={{ background: character.color }}></span>
            角色 {index + 1}
          </button>
        ))}
      </div>
      <div className="character-list">
        {activeCharacter && (
          <div className="character-card">
            <div className="character-head">
              <label>
                <input
                  type="checkbox"
                  checked={activeCharacter.enabled}
                  onChange={(event) => update(activeIndex, { enabled: event.target.checked })}
                />{" "}
                启用
              </label>
              <input
                className="character-name"
                value={activeCharacter.name}
                onChange={(event) => update(activeIndex, { name: event.target.value })}
              />
              <input
                type="color"
                value={activeCharacter.color}
                onChange={(event) => update(activeIndex, { color: event.target.value })}
              />
            </div>
            <TextAreaField
              label="角色 prompt"
              value={activeCharacter.prompt}
              onChange={(value) => update(activeIndex, { prompt: value })}
            />
            <div className="compact-coords" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <NumberField
                label="权重"
                value={activeCharacter.weight}
                step={0.1}
                onChange={(value) => update(activeIndex, { weight: value })}
              />
              <NumberField
                label="feather"
                value={activeCharacter.feather}
                step={1}
                onChange={(value) => update(activeIndex, { feather: value })}
              />
              <SelectField
                label="融合模式"
                value={activeCharacter.mask.blend_mode || "normal"}
                options={[
                  { label: "正常", value: "normal" },
                  { label: "叠加", value: "additive" },
                  { label: "乘法", value: "multiply" },
                ]}
                onChange={(value) => updateMask(activeIndex, { blend_mode: value })}
              />
              <NumberField
                label="x"
                value={activeCharacter.mask.x}
                step={0.01}
                onChange={(value) => updateMask(activeIndex, { x: value })}
              />
              <NumberField
                label="y"
                value={activeCharacter.mask.y}
                step={0.01}
                onChange={(value) => updateMask(activeIndex, { y: value })}
              />
              <NumberField
                label="w"
                value={activeCharacter.mask.width}
                step={0.01}
                onChange={(value) => updateMask(activeIndex, { width: value })}
              />
              <NumberField
                label="h"
                value={activeCharacter.mask.height}
                step={0.01}
                onChange={(value) => updateMask(activeIndex, { height: value })}
              />
            </div>
            <div className="card-actions">
              <button
                type="button"
                onClick={() => onChange(autoBalanceWeights(characters))}
                title="根据重叠区域自动调整角色权重"
              >
                <Boxes size={15} /> 平衡权重
              </button>
              <button type="button" onClick={() => onChange(duplicateCharacter(characters, activeIndex))}>
                <Copy size={15} /> 复制角色
              </button>
              <button type="button" onClick={() => onChange(removeCharacter(characters, activeIndex))}>
                <Trash2 size={15} /> 删除
              </button>
            </div>
          </div>
        )}
        {characters.length === 0 && <div className="empty-strip">暂无角色，点击“新增角色”开始</div>}
      </div>
    </div>
  );
}
