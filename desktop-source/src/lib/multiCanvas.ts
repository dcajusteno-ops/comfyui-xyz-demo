import type { MultiCharacter, MultiCharacterMask } from "../types";

export type MaskHandle = "nw" | "ne" | "sw" | "se";

export const MIN_MASK_SIZE = 0.02;

type MaskRect = Pick<MultiCharacterMask, "x" | "y" | "width" | "height">;

export function enabledCanvasCharacters(characters: MultiCharacter[]) {
  return characters.filter((character) => character.enabled);
}

export function clampMaskRect<T extends MaskRect>(mask: T): T {
  const width = clamp(mask.width, MIN_MASK_SIZE, 1);
  const height = clamp(mask.height, MIN_MASK_SIZE, 1);
  return {
    ...mask,
    width,
    height,
    x: clamp(mask.x, 0, 1 - width),
    y: clamp(mask.y, 0, 1 - height),
  };
}

export function moveMaskRect<T extends MaskRect>(mask: T, deltaX: number, deltaY: number): T {
  return clampMaskRect({
    ...mask,
    x: mask.x + deltaX,
    y: mask.y + deltaY,
  });
}

export function resizeMaskRect<T extends MaskRect>(mask: T, handle: MaskHandle, deltaX: number, deltaY: number): T {
  let next: MaskRect = { ...mask };

  if (handle.includes("e")) {
    next.width = mask.width + deltaX;
  }
  if (handle.includes("s")) {
    next.height = mask.height + deltaY;
  }
  if (handle.includes("w")) {
    next.x = mask.x + deltaX;
    next.width = mask.width - deltaX;
  }
  if (handle.includes("n")) {
    next.y = mask.y + deltaY;
    next.height = mask.height - deltaY;
  }

  next = clampResizeToCanvas(next, mask);
  return {
    ...mask,
    ...next,
  };
}

function clampResizeToCanvas(next: MaskRect, previous: MaskRect) {
  let x = clamp(next.x, 0, 1 - MIN_MASK_SIZE);
  let y = clamp(next.y, 0, 1 - MIN_MASK_SIZE);
  let width = next.width;
  let height = next.height;

  if (width < MIN_MASK_SIZE) {
    if (next.x !== previous.x) {
      x = previous.x + previous.width - MIN_MASK_SIZE;
    }
    width = MIN_MASK_SIZE;
  }
  if (height < MIN_MASK_SIZE) {
    if (next.y !== previous.y) {
      y = previous.y + previous.height - MIN_MASK_SIZE;
    }
    height = MIN_MASK_SIZE;
  }

  width = clamp(width, MIN_MASK_SIZE, 1 - x);
  height = clamp(height, MIN_MASK_SIZE, 1 - y);
  return { x, y, width, height };
}

export function getIntersection(a: MaskRect, b: MaskRect): MaskRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const width = x2 - x;
  const height = y2 - y;

  if (width > 0 && height > 0) {
    return { x, y, width, height };
  }
  return null;
}

export function findOverlapRegions(characters: MultiCharacter[]) {
  const visible = enabledCanvasCharacters(characters);
  const overlaps: { a: string; b: string; rect: MaskRect }[] = [];

  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const rect = getIntersection(visible[i].mask, visible[j].mask);
      if (rect) {
        overlaps.push({ a: visible[i].id, b: visible[j].id, rect });
      }
    }
  }
  return overlaps;
 }
 
 export function autoBalanceWeights(characters: MultiCharacter[]): MultiCharacter[] {
   const visible = enabledCanvasCharacters(characters);
   if (visible.length < 2) return characters;
 
   const overlapAreas = new Map<string, number>();
   visible.forEach(c => overlapAreas.set(c.id, 0));
 
   for (let i = 0; i < visible.length; i++) {
     for (let j = i + 1; j < visible.length; j++) {
       const rect = getIntersection(visible[i].mask, visible[j].mask);
       if (rect) {
         const area = rect.width * rect.height;
         overlapAreas.set(visible[i].id, overlapAreas.get(visible[i].id)! + area);
         overlapAreas.set(visible[j].id, overlapAreas.get(visible[j].id)! + area);
       }
     }
   }
 
   return characters.map(c => {
     if (!c.enabled) return c;
     const overlapArea = overlapAreas.get(c.id) || 0;
     const selfArea = c.mask.width * c.mask.height;
     const overlapRatio = overlapArea / selfArea;
 
     if (overlapRatio > 0.1) {
       const newWeight = Math.max(0.5, c.weight * (1 - Math.min(0.3, overlapRatio * 0.5)));
       return { ...c, weight: parseFloat(newWeight.toFixed(2)) };
     }
     return c;
   });
 }
 
 function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
