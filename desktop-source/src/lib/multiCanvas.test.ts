import { describe, expect, it } from "vitest";
import type { MultiCharacter } from "../types";
import { clampMaskRect, enabledCanvasCharacters, moveMaskRect, resizeMaskRect } from "./multiCanvas";

const character: MultiCharacter = {
  id: "character_a",
  name: "A",
  prompt: "",
  weight: 1,
  color: "#e17055",
  enabled: true,
  position: 0,
  mask: {
    id: "mask_a",
    characterId: "character_a",
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    feather: 0,
    blend_mode: "normal",
    zIndex: 0,
  },
  syntax_type: "COUPLE",
  use_mask_syntax: true,
  use_fill: false,
  feather: 0,
};

describe("multi canvas helpers", () => {
  it("clamps masks inside normalized canvas space", () => {
    expect(clampMaskRect({ ...character.mask, x: 0.95, y: -1, width: 0.2, height: 2 })).toMatchObject({
      x: 0.8,
      y: 0,
      width: 0.2,
      height: 1,
    });
  });

  it("moves masks while preserving size and staying in bounds", () => {
    expect(moveMaskRect(character.mask, 1, 1)).toMatchObject({
      x: 0.7,
      y: 0.6,
      width: 0.3,
      height: 0.4,
    });
  });

  it("resizes masks from a handle with minimum size", () => {
    const resized = resizeMaskRect(character.mask, "nw", 0.5, 0.6);
    expect(resized.id).toBe(character.mask.id);
    expect(resized.characterId).toBe(character.mask.characterId);
    expect(resized.width).toBeCloseTo(0.02);
    expect(resized.height).toBeCloseTo(0.02);
  });

  it("returns only enabled characters for canvas drawing", () => {
    expect(enabledCanvasCharacters([character, { ...character, id: "b", enabled: false }]).map((item) => item.id)).toEqual(["character_a"]);
  });
});
