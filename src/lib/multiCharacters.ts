import type { MultiCharacter } from "../types";

export function createCharacter(position: number, source?: MultiCharacter): MultiCharacter {
  const id = `character_${Date.now()}_${cryptoSafeId()}`;
  const maskId = `mask_${Date.now()}_${cryptoSafeId()}`;
  const base = source ?? defaultCharacter(position);
  return {
    ...structuredClone(base),
    id,
    name: source ? `${source.name} 副本` : `角色 ${position + 1}`,
    position,
    color: source?.color ?? paletteColor(position),
    enabled: source?.enabled ?? true,
    mask: {
      ...structuredClone(base.mask),
      id: maskId,
      characterId: id,
      zIndex: position,
    },
  };
}

export function addCharacter(characters: MultiCharacter[]) {
  return normalizeCharacters([...characters, createCharacter(characters.length)]);
}

export function duplicateCharacter(characters: MultiCharacter[], index: number) {
  const source = characters[index];
  if (!source) return characters;
  return normalizeCharacters([...characters, createCharacter(characters.length, source)]);
}

export function removeCharacter(characters: MultiCharacter[], index: number) {
  return normalizeCharacters(characters.filter((_, itemIndex) => itemIndex !== index));
}

export function normalizeCharacters(characters: MultiCharacter[]) {
  return characters.map((character, index) => ({
    ...character,
    position: index,
    mask: {
      ...character.mask,
      zIndex: index,
    },
  }));
}

function defaultCharacter(position: number): MultiCharacter {
  const id = `character_${Date.now()}_${cryptoSafeId()}`;
  return {
    id,
    name: `角色 ${position + 1}`,
    prompt: "",
    weight: 1,
    color: paletteColor(position),
    enabled: true,
    position,
    mask: {
      id: `mask_${Date.now()}_${cryptoSafeId()}`,
      characterId: id,
      x: position % 2 === 0 ? 0 : 0.53125,
      y: 0.125,
      width: 0.46875,
      height: 0.6875,
      feather: 0,
      blend_mode: "normal",
      zIndex: position,
    },
    syntax_type: "COUPLE",
    use_mask_syntax: true,
    use_fill: false,
    feather: 0,
  };
}

function paletteColor(index: number) {
  const colors = ["#e17055", "#74b9ff", "#d17e47", "#45b7d1", "#96ceb4", "#a29bfe"];
  return colors[index % colors.length];
}

function cryptoSafeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}
