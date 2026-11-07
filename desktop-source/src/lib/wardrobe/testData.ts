/**
 * 单测用数据播种：直接从仓库里的 `public/data/wardrobe` 读 JSON。
 *
 * 不 mock fetch、不 import 巨型 JSON 模块（避免 tsc 为 characters.json
 * 推断出一棵 2383 节点的字面量类型）。生产代码不会 import 本文件。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resetLevelIndexes } from "./levels";
import { resetRoleIndexes } from "./characters";
import { resetSceneIndexes } from "./scenes";
import { resetWardrobeCache, setWardrobeData, type WardrobeDataKey, type WardrobeDataMap } from "./store";

const DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "public",
  "data",
  "wardrobe",
);

const FILES: Array<[WardrobeDataKey, string]> = [
  ["pools", "pools.json"],
  ["levels", "levels.json"],
  ["characters", "characters.json"],
  ["userCharacters", "user-characters.json"],
  ["scenes", "scenes.json"],
  ["sceneAspects", "scene-aspects.json"],
  ["colorMatrix", "color-matrix.json"],
  ["hairStyle", "char-hair-style.json"],
  ["charFeat", "char-feat.json"],
  ["charOutputTags", "char-output-tags.json"],
  ["charAliases", "char-aliases.json"],
  ["characterOutfits", "character-outfits.json"],
  ["termHints", "term-hints.json"],
  ["outfitTemplates", "outfit-templates.json"],
  ["nsfwTables", "nsfw-tables.json"],
  ["overrides", "overrides.json"],
  ["outfitStyle", "outfit-style.json"],
  ["link", "link.json"],
];

let primed = false;

export function primeWardrobeData(force = false): void {
  if (primed && !force) return;
  resetWardrobeCache();
  for (const [key, file] of FILES) {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8")) as WardrobeDataMap[typeof key];
    setWardrobeData(key, raw);
  }
  resetLevelIndexes();
  resetRoleIndexes();
  resetSceneIndexes();
  primed = true;
}

/** 读 `src/lib/wardrobe/__fixtures__` 下的对拍夹具。 */
export function readLocalFixture<T>(name: string): T {
  return JSON.parse(
    fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", name), "utf8"),
  ) as T;
}
