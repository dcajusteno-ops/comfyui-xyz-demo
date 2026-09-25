import { describe, expect, it, vi } from "vitest";
import type { MultiCharacter } from "../types";
import { addCharacter, duplicateCharacter, removeCharacter } from "./multiCharacters";

const first: MultiCharacter = {
  id: "character_a",
  name: "角色 1",
  prompt: "",
  weight: 1,
  color: "#e17055",
  enabled: true,
  position: 0,
  mask: {
    id: "mask_a",
    characterId: "character_a",
    x: 0,
    y: 0.1,
    width: 0.45,
    height: 0.7,
    feather: 0,
    blend_mode: "normal",
    zIndex: 0,
  },
  syntax_type: "COUPLE",
  use_mask_syntax: true,
  use_fill: false,
  feather: 0,
};

describe("multi character helpers", () => {
  it("adds a character with stable position and linked mask", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const characters = addCharacter([first]);
    expect(characters).toHaveLength(2);
    expect(characters[1].position).toBe(1);
    expect(characters[1].mask.zIndex).toBe(1);
    expect(characters[1].mask.characterId).toBe(characters[1].id);
    vi.restoreAllMocks();
  });

  it("duplicates a character without reusing ids", () => {
    const characters = duplicateCharacter([first], 0);
    expect(characters).toHaveLength(2);
    expect(characters[1].name).toContain("副本");
    expect(characters[1].id).not.toBe(first.id);
    expect(characters[1].mask.id).not.toBe(first.mask.id);
    expect(characters[1].mask.characterId).toBe(characters[1].id);
  });

  it("removes characters and normalizes positions", () => {
    const [a, b, c] = addCharacter(addCharacter([first]));
    const characters = removeCharacter([a, b, c], 1);
    expect(characters).toHaveLength(2);
    expect(characters.map((character) => character.position)).toEqual([0, 1]);
    expect(characters.map((character) => character.mask.zIndex)).toEqual([0, 1]);
  });
});
