#!/usr/bin/env node
/**
 * 从已安装的 Comfyui-Anima-Wardrobe-V5 插件导入造型台数据。
 *
 * 用法（在 desktop-source 目录执行）：
 *   node scripts/import-wardrobe-data.mjs --plugin "<插件根目录>"
 *   node scripts/import-wardrobe-data.mjs --plugin "<插件根目录>" --dry-run
 *   node scripts/import-wardrobe-data.mjs --verify-only
 *
 * 与 import-anima-data.mjs 的差别：Wardrobe 的数据是「结构化段/字段/选项池」+
 * 2390 位角色 + 361 条场景 + 2414 张缩略图，需要按语义做交叉校验（选项档位、
 * 场景引用、缩略图缺失），不能只数条数。
 *
 * v5.0.12 新增的旁挂表（都来自插件 presets/，缺一不可）：
 *   char_output_tags.json     正文角色 tag（角色 + 作品两段式，Anima 官方顺序）
 *   char_aliases.json         角色改名兼容表
 *   character_outfits.json    角色服装预设（用户数据，启用后锁服装）
 *   anima_v4_scene_aspects.json 场景推荐画幅（竖/横/通用）
 *   term_hints.json           复杂词条的自然语言补充句
 *   outfit_templates_日常六套.json 服装预设模板
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = path.join(ROOT, "public", "data", "wardrobe");
const SOURCE_REPO = "https://github.com/lingdongbudong/Comfyui-Anima-Wardrobe-V5";
const SOURCE_LICENSE = "MIT";

const DATASETS = {
  pools: "anima_v4_pools.json",
  levels: "anima_v4_levels.json",
  characters: "anima_v4_characters.json",
  userCharacters: "user_characters.json",
  scenes: "anima_v4_scenes.json",
  sceneAspects: "anima_v4_scene_aspects.json",
  colorMatrix: "anima_v4_color_matrix.json",
  hairStyle: "char_hair_style.json",
  charFeat: "char_feat.json",
  charOutputTags: "char_output_tags.json",
  charAliases: "char_aliases.json",
  characterOutfits: "character_outfits.json",
  termHints: "term_hints.json",
  outfitTemplates: "outfit_templates_日常六套.json",
};

/** 数据集键 → 输出文件名（与运行时 store.ts 的 FILES 表一一对应） */
const OUTPUT_FILES = {
  pools: "pools.json",
  levels: "levels.json",
  characters: "characters.json",
  userCharacters: "user-characters.json",
  scenes: "scenes.json",
  sceneAspects: "scene-aspects.json",
  colorMatrix: "color-matrix.json",
  hairStyle: "char-hair-style.json",
  charFeat: "char-feat.json",
  charOutputTags: "char-output-tags.json",
  charAliases: "char-aliases.json",
  characterOutfits: "character-outfits.json",
  termHints: "term-hints.json",
  outfitTemplates: "outfit-templates.json",
};

/** 由 export-wardrobe-tables.py 生成，导入时只校验存在性与哈希 */
const DERIVED = ["nsfw-tables.json", "overrides.json", "outfit-style.json", "link.json"];

const HELP = `导入 Comfyui-Anima-Wardrobe-V4 数据到本项目

  --plugin <dir>   插件根目录（含 presets/ 与 __init__.py）
  --out <dir>      输出目录，默认 public/data/wardrobe
  --dry-run        只读取/校验/打印统计，不写任何文件
  --verify-only    不访问插件，回读已生成产物做结构校验
  --no-thumbs      只同步 JSON
  --thumbs-only    只同步缩略图（JSON 必须已存在）
  --strict-thumbs  缩略图缺失即失败（默认只告警：当前有 20 个天然缺失）

环境变量：ANIMA_WARDROBE_DIR 等价于 --plugin`;

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    plugin: "",
    dryRun: false,
    verifyOnly: false,
    noThumbs: false,
    thumbsOnly: false,
    strictThumbs: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--plugin") args.plugin = argv[++i] ?? "";
    else if (arg === "--out") args.out = path.resolve(argv[++i] ?? DEFAULT_OUT);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--verify-only") args.verifyOnly = true;
    else if (arg === "--no-thumbs") args.noThumbs = true;
    else if (arg === "--thumbs-only") args.thumbsOnly = true;
    else if (arg === "--strict-thumbs") args.strictThumbs = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else fail(`未知参数：${arg}\n\n${HELP}`);
  }
  if (!args.plugin) args.plugin = process.env.ANIMA_WARDROBE_DIR ?? "";
  return args;
}

let warnings = 0;
function fail(message) {
  console.error(`\n[import-wardrobe] ERROR: ${message}\n`);
  process.exit(1);
}
function warn(message) {
  warnings += 1;
  console.warn(`[import-wardrobe] WARN: ${message}`);
}
function info(message) {
  console.log(`[import-wardrobe] ${message}`);
}

function readJson(file, label) {
  if (!fs.existsSync(file)) fail(`缺少${label}：${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail(`${label}解析失败：${file}\n  ${error.message}`);
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function fileSha256(file) {
  return sha256(fs.readFileSync(file));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

function pluginVersion(pluginDir) {
  const file = path.join(pluginDir, "__init__.py");
  if (!fs.existsSync(file)) return "unknown";
  const m = fs.readFileSync(file, "utf8").match(/__version__\s*=\s*["']([^"']+)["']/);
  return m ? m[1] : "unknown";
}

/* ------------------------------------------------------------------ *
 * 结构校验
 * ------------------------------------------------------------------ */

function flattenFields(pools) {
  const rows = [];
  for (const section of pools.sections ?? []) {
    for (const field of section.fields ?? []) rows.push({ section: section.id, field });
  }
  return rows;
}

function validatePools(pools) {
  const sections = pools.sections ?? [];
  const fields = flattenFields(pools);
  const options = fields.reduce((n, row) => n + (row.field.opts?.length ?? 0), 0);
  const canon = Object.keys(pools.canon ?? {}).length;
  const appear = Array.isArray(pools.appear) ? pools.appear.length : Object.keys(pools.appear ?? {}).length;
  const mutex = (pools.mutex_groups ?? []).length;
  if (sections.length !== 15) fail(`段数应为 15，实际 ${sections.length}`);
  if (fields.length !== 57) fail(`字段数应为 57，实际 ${fields.length}`);
  if (options !== 1134) fail(`选项数应为 1134，实际 ${options}`);
  if (canon !== 14) fail(`canon 应为 14，实际 ${canon}`);
  if (appear !== 221) fail(`appear 应为 221，实际 ${appear}`);
  if (mutex !== 6) fail(`mutex 应为 6，实际 ${mutex}`);
  return { sections: sections.length, fields: fields.length, options, canon, appear, mutex };
}

function validateLevels(levels, pools) {
  const fields = flattenFields(pools);
  const missing = [];
  for (const { field } of fields) {
    if (!field.opts || field.opts.length === 0) continue; // n_extra / nl 是自由文本
    if (!levels.option_levels?.[field.key]) missing.push(field.key);
  }
  if (missing.length) fail(`option_levels 缺字段：${missing.join(", ")}`);

  const uncovered = [];
  for (const { field } of fields) {
    if (!field.opts || field.opts.length === 0) continue;
    const table = levels.option_levels[field.key];
    for (const [, en] of field.opts) {
      if (!Object.prototype.hasOwnProperty.call(table, en)) uncovered.push(`${field.key}=${en}`);
    }
  }
  if (uncovered.length) fail(`有 ${uncovered.length} 个选项没有档位：${uncovered.slice(0, 5).join(" / ")}`);

  const tagCount = Object.keys(levels.tag_levels ?? {}).length;
  if (tagCount !== 1171) warn(`tag_levels 数量为 ${tagCount}（预期 1171，插件升级时会变）`);
  for (const sec of pools.sections ?? []) {
    if (!Object.prototype.hasOwnProperty.call(levels.section_floor ?? {}, sec.id)) {
      fail(`section_floor 缺段：${sec.id}`);
    }
  }
  return { tagLevels: tagCount, optionFields: Object.keys(levels.option_levels).length };
}

function validateCharacters(characters) {
  const rows = characters.characters ?? [];
  if (rows.length !== 2390) warn(`角色数 ${rows.length}（预期 2390，插件升级时会变）`);
  for (const row of rows) {
    if (!row.tag || !row.name) fail(`角色记录缺 tag/name：${JSON.stringify(row).slice(0, 120)}`);
    if (!row.thumb) fail(`角色 ${row.tag} 缺 thumb 字段`);
  }
  const works = characters.works ?? [];
  return { characters: rows.length, works: works.length };
}

function validateUserCharacters(overlay) {
  const edits = overlay.edits ?? {};
  const custom = overlay.custom ?? [];
  if (Object.keys(edits).length !== 123) warn(`角色覆盖层 edits=${Object.keys(edits).length}（预期 123）`);
  if (custom.length !== 12) warn(`角色覆盖层 custom=${custom.length}（预期 12）`);
  for (const row of custom) {
    if (!row.tag || !row.trigger) fail(`自定义角色缺 tag/trigger：${JSON.stringify(row).slice(0, 120)}`);
  }
  return { edits: Object.keys(edits).length, custom: custom.length };
}

/** 与引擎同一口径的合并（只用于数缩略图，不用于导出）。 */
function mergeCharacters(base, overlay) {
  const edits = overlay?.edits ?? {};
  const rows = (base.characters ?? []).map((row) => {
    const patch = edits[String(row.tag ?? "")];
    if (!patch) return row;
    const merged = { ...row };
    for (const key of ["trigger", "zh", "work", "thumb", "hair", "eyes"]) {
      if (typeof patch[key] === "string" && patch[key].trim()) merged[key] = patch[key].trim();
    }
    if (Array.isArray(patch.tags) && patch.tags.length) {
      merged.tags = patch.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
    }
    return merged;
  });
  for (const row of overlay?.custom ?? []) rows.push({ ...row, src: row.src ?? "user" });
  return rows;
}

function validateScenes(scenes, pools) {
  const fieldMap = new Map(flattenFields(pools).map(({ field }) => [field.key, field]));
  const problems = [];
  const rows = scenes.scenes ?? [];
  for (const scene of rows) {
    for (const [key, value] of Object.entries(scene.tags ?? {})) {
      const field = fieldMap.get(key);
      if (!field) {
        problems.push(`${scene.id}: 未知字段 ${key}`);
        continue;
      }
      const en = new Set((field.opts ?? []).map(([, v]) => v));
      if (!en.has(value)) problems.push(`${scene.id}: ${key} 没有选项 "${value}"`);
    }
    if (scene.count_lock && scene.count_lock !== "2girls" && !fieldMap.get("count")) {
      problems.push(`${scene.id}: count_lock 无法校验`);
    }
    if (!scene.id || !scene.zh) problems.push(`场景缺 id/zh：${JSON.stringify(scene).slice(0, 80)}`);
  }
  if (problems.length) fail(`场景引用有 ${problems.length} 处不合法：\n  ${problems.slice(0, 8).join("\n  ")}`);

  const groups = {};
  for (const scene of rows) groups[scene.group] = (groups[scene.group] ?? 0) + 1;
  for (const [group, count] of Object.entries({ sfw: 100, nsfw: 71, near: 60, pose: 40, art: 90 })) {
    if ((groups[group] ?? 0) !== count) warn(`场景组 ${group} 数量 ${groups[group] ?? 0}（预期 ${count}）`);
  }
  return { scenes: rows.length, groups };
}

/** 场景画幅旁挂表（v5.0.1）：缺条目只影响徽标，不阻断。 */
function validateSceneAspects(aspects, scenes) {
  const rows = aspects?.aspects ?? {};
  const ids = new Set((scenes.scenes ?? []).map((s) => s.id));
  const unknown = Object.keys(rows).filter((id) => !ids.has(id));
  if (unknown.length) warn(`画幅表有 ${unknown.length} 条对不上场景 id：${unknown.slice(0, 3).join(", ")}`);
  const buckets = { portrait: 0, landscape: 0, both: 0 };
  for (const row of Object.values(rows)) {
    const a = String(row?.a ?? "").trim().toLowerCase();
    if (a in buckets) buckets[a] += 1;
  }
  return { aspects: Object.keys(rows).length, ...buckets };
}

/** 正文角色 tag 映射（v5.0.11）：必须是「角色, 作品」两段式、零下划线。 */
function validateCharOutputTags(doc, characters, overlay) {
  const tags = doc?.tags ?? {};
  const rows = [...(characters.characters ?? []), ...(overlay.custom ?? [])];
  const triggers = new Set(rows.map((row) => String(row.trigger ?? "")));
  let missing = 0;
  let underscore = 0;
  let total = 0;
  for (const [trigger, rec] of Object.entries(tags)) {
    total += 1;
    if (!triggers.has(trigger)) missing += 1;
    const out = String(rec?.out ?? "");
    if (out.includes("_")) underscore += 1;
  }
  if (!total) fail("char_output_tags.json 是空表");
  if (underscore) fail(`char_output_tags 有 ${underscore} 条含下划线（Anima 官方禁止下划线）`);
  if (missing) warn(`char_output_tags 有 ${missing} 条 trigger 不在角色库（改名/删角色时会变）`);
  return { mappings: total, missing };
}

function validateCharAliases(doc, characters) {
  const aliases = doc?.aliases ?? {};
  const tags = new Set((characters.characters ?? []).map((row) => String(row.tag ?? "")));
  for (const [from, to] of Object.entries(aliases)) {
    if (!tags.has(String(to))) warn(`别名 ${from} → ${to} 的目标不在内置角色库`);
  }
  return { aliases: Object.keys(aliases).length };
}

function validateTermHints(doc) {
  let count = 0;
  for (const [field, sub] of Object.entries(doc ?? {})) {
    if (field.startsWith("_") || !sub || typeof sub !== "object") continue;
    count += Object.keys(sub).length;
  }
  if (!count) fail("term_hints.json 没有任何词条");
  return { termHints: count };
}

function validateOutfits(doc, characters) {
  const roles = doc?.outfits ?? {};
  const tags = new Set((characters.characters ?? []).map((row) => String(row.tag ?? "")));
  let sets = 0;
  let enabled = 0;
  const orphans = [];
  for (const [role, rec] of Object.entries(roles)) {
    if (!tags.has(role)) orphans.push(role);
    if (rec?.enabled) enabled += 1;
    sets += (rec?.list ?? []).length;
  }
  if (orphans.length) warn(`服装预设里 ${orphans.length} 个角色不在内置库：${orphans.slice(0, 3).join(", ")}`);
  return { outfitRoles: Object.keys(roles).length, outfitSets: sets, outfitEnabled: enabled };
}

function validateOutfitTemplates(doc) {
  const rows = doc?.outfits ?? [];
  if (!Array.isArray(rows) || rows.length !== 6) warn(`服装模板应为 6 套，实际 ${Array.isArray(rows) ? rows.length : 0}`);
  return { outfitTemplates: Array.isArray(rows) ? rows.length : 0 };
}

/* ------------------------------------------------------------------ *
 * 缩略图
 * ------------------------------------------------------------------ */

function listThumbs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".webp"))
    .map((name) => path.join(dir, name));
}

function syncThumbs(pluginPresets, outDir, args, subdir = "thumbs") {
  const src = path.join(pluginPresets, subdir);
  const files = listThumbs(src);
  if (files.length === 0) {
    if (subdir === "thumbs") fail(`插件里没有缩略图：${src}`);
    return { files: 0, bytes: 0, copied: 0 };
  }
  const destDir = path.join(outDir, "thumbs");
  if (!args.dryRun) fs.mkdirSync(destDir, { recursive: true });

  let copied = 0;
  let bytes = 0;
  for (const file of files) {
    const name = path.basename(file);
    const dest = path.join(destDir, name);
    const stat = fs.statSync(file);
    bytes += stat.size;
    if (args.dryRun) continue;
    let need = true;
    if (fs.existsSync(dest)) {
      const old = fs.statSync(dest);
      need = old.size !== stat.size || Math.abs(old.mtimeMs - stat.mtimeMs) > 2000;
    }
    if (need) {
      fs.copyFileSync(file, dest);
      copied += 1;
    }
  }
  return { files: files.length, bytes, copied };
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

function loadSource(pluginDir) {
  const presets = path.join(pluginDir, "presets");
  if (!fs.existsSync(presets)) fail(`插件里找不到 presets/：${pluginDir}`);
  const source = {};
  for (const [key, file] of Object.entries(DATASETS)) {
    const full = path.join(presets, file);
    if (key === "userCharacters" && !fs.existsSync(full)) {
      // 覆盖层是可选的：没有就按空处理，不影响内置角色库
      source[key] = { edits: {}, custom: [] };
      continue;
    }
    source[key] = readJson(full, `源数据 ${file}`);
  }
  return source;
}

function buildManifest({ source, counts, derived, outDir, version, poolsHash, poolsAnchor }) {
  const files = {};
  for (const out of Object.values(OUTPUT_FILES)) {
    const file = path.join(outDir, out);
    if (fs.existsSync(file)) files[out] = fileSha256(file);
  }
  const thumbDir = path.join(outDir, "thumbs");
  const thumbs = listThumbs(thumbDir);
  const thumbBytes = thumbs.reduce((n, file) => n + fs.statSync(file).size, 0);

  return {
    schema: "xyz-wardrobe/1",
    source: {
      plugin: "Comfyui-Anima-Wardrobe-V5",
      repo: SOURCE_REPO,
      version,
      license: SOURCE_LICENSE,
      poolsSha256: poolsAnchor ?? "",
      poolsSha256Actual: poolsHash,
    },
    counts: { ...counts, thumbs: thumbs.length, thumbBytes },
    levels: counts.levels ?? [],
    missingThumbs: counts.missingThumbs ?? [],
    files,
    derived,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });

  if (args.verifyOnly) {
    const outDir = args.out;
    const manifestPath = path.join(outDir, "manifest.json");
    const manifest = readJson(manifestPath, "manifest");
    if (manifest.schema !== "xyz-wardrobe/1") fail(`manifest schema 不匹配：${manifest.schema}`);

    const pools = readJson(path.join(outDir, "pools.json"), "pools");
    const levels = readJson(path.join(outDir, "levels.json"), "levels");
    const characters = readJson(path.join(outDir, "characters.json"), "characters");
    const userCharactersPath = path.join(outDir, "user-characters.json");
    const userCharacters = fs.existsSync(userCharactersPath)
      ? readJson(userCharactersPath, "user-characters")
      : { edits: {}, custom: [] };
    const scenes = readJson(path.join(outDir, "scenes.json"), "scenes");
    readJson(path.join(outDir, "color-matrix.json"), "color-matrix");
    readJson(path.join(outDir, "char-hair-style.json"), "char-hair-style");
    readJson(path.join(outDir, "char-feat.json"), "char-feat");
    const sceneAspects = readJson(path.join(outDir, "scene-aspects.json"), "scene-aspects");
    const charOutputTags = readJson(path.join(outDir, "char-output-tags.json"), "char-output-tags");
    const charAliases = readJson(path.join(outDir, "char-aliases.json"), "char-aliases");
    const characterOutfits = readJson(path.join(outDir, "character-outfits.json"), "character-outfits");
    const termHints = readJson(path.join(outDir, "term-hints.json"), "term-hints");
    readJson(path.join(outDir, "outfit-templates.json"), "outfit-templates");

    const counts = {
      ...validatePools(pools),
      ...validateLevels(levels, pools),
      ...validateCharacters(characters),
      ...validateUserCharacters(userCharacters),
      ...validateScenes(scenes, pools),
      ...validateSceneAspects(sceneAspects, scenes),
      ...validateCharOutputTags(charOutputTags, characters, userCharacters),
      ...validateCharAliases(charAliases, characters),
      ...validateOutfits(characterOutfits, characters),
      ...validateTermHints(termHints),
    };
    counts.charactersMerged = mergeCharacters(characters, userCharacters).length;

    const missingDerived = DERIVED.filter((name) => !fs.existsSync(path.join(outDir, name)));
    if (missingDerived.length) fail(`缺派生表：${missingDerived.join(", ")}（先跑 export-wardrobe-tables.py）`);

    const thumbs = listThumbs(path.join(outDir, "thumbs"));
    if (thumbs.length === 0) fail("缩略图为空（用 --no-thumbs 导入过？）");
    if (manifest.counts?.thumbs !== thumbs.length) {
      warn(`manifest 记 ${manifest.counts?.thumbs} 张缩略图，磁盘实际 ${thumbs.length} 张`);
    }
    if (manifest.counts?.charactersMerged !== counts.charactersMerged) {
      fail(`manifest 合并角色数 ${manifest.counts?.charactersMerged} ≠ 实际 ${counts.charactersMerged}`);
    }
    info(
      `verify OK：${counts.sections} 段 / ${counts.fields} 字段 / ${counts.options} 选项 / ` +
        `${counts.characters} 角色 / ${counts.scenes} 场景 / ${thumbs.length} 缩略图`,
    );
    return;
  }

  if (!args.plugin) fail(`必须提供 --plugin（或设置 ANIMA_WARDROBE_DIR）\n\n${HELP}`);
  const pluginDir = path.resolve(args.plugin);
  if (!fs.existsSync(path.join(pluginDir, "presets"))) fail(`不像插件根目录（缺 presets/）：${pluginDir}`);
  const version = pluginVersion(pluginDir);
  const source = loadSource(pluginDir);

  const counts = {
    ...validatePools(source.pools),
    ...validateLevels(source.levels, source.pools),
    ...validateCharacters(source.characters),
    ...validateUserCharacters(source.userCharacters),
    ...validateScenes(source.scenes, source.pools),
    ...validateSceneAspects(source.sceneAspects, source.scenes),
    ...validateCharOutputTags(source.charOutputTags, source.characters, source.userCharacters),
    ...validateCharAliases(source.charAliases, source.characters),
    ...validateOutfits(source.characterOutfits, source.characters),
    ...validateTermHints(source.termHints),
    ...validateOutfitTemplates(source.outfitTemplates),
  };
  const mergedCharacters = mergeCharacters(source.characters, source.userCharacters);
  counts.charactersMerged = mergedCharacters.length;

  // 插件自带的跨文件锚点：实测已过期（levels 生成后 pools 又改过），只能告警。
  const poolsHash = sha256(fs.readFileSync(path.join(pluginDir, "presets", DATASETS.pools)));
  const anchor = source.levels?._meta?.pools_sha256 ?? "";
  if (anchor && anchor !== poolsHash) {
    warn(`levels.json 的 pools_sha256 已过期（record=${anchor.slice(0, 8)}… actual=${poolsHash.slice(0, 8)}…），只告警`);
  }

  const thumbInfo = args.noThumbs
    ? { files: 0, bytes: 0, copied: 0 }
    : (() => {
        const base = syncThumbs(path.join(pluginDir, "presets"), args.out, args, "thumbs");
        const user = syncThumbs(path.join(pluginDir, "presets"), args.out, args, "user_thumbs");
        return { files: base.files + user.files, bytes: base.bytes + user.bytes, copied: base.copied + user.copied };
      })();

  if (args.dryRun) {
    info(`dry-run：${JSON.stringify(counts)}，缩略图 ${thumbInfo.files} 张 / ${(thumbInfo.bytes / 1048576).toFixed(2)}MB`);
    return;
  }

  if (!args.thumbsOnly) {
    for (const [key, out] of Object.entries(OUTPUT_FILES)) {
      writeJson(path.join(args.out, out), source[key]);
    }
    info(`写入 ${Object.keys(OUTPUT_FILES).length} 个 JSON`);
  }

  const characters = mergedCharacters;
  const thumbSet = new Set(listThumbs(path.join(args.out, "thumbs")).map((f) => path.basename(f, ".webp")));
  const missingThumbs = characters.filter((c) => !thumbSet.has(c.thumb)).map((c) => c.tag);
  if (missingThumbs.length) {
    const message = `${missingThumbs.length} 个角色缺缩略图（占位显示）：${missingThumbs.slice(0, 5).join(", ")}`;
    if (args.strictThumbs) fail(message);
    warn(message);
  }

  const nsfw = readJson(path.join(args.out, "nsfw-tables.json"), "nsfw-tables");
  const derived = {};
  const missingDerived = [];
  for (const name of DERIVED) {
    const file = path.join(args.out, name);
    if (!fs.existsSync(file)) missingDerived.push(name);
    else derived[name] = fileSha256(file);
  }
  if (missingDerived.length) fail(`缺派生表：${missingDerived.join(", ")}（先跑 export-wardrobe-tables.py）`);

  counts.levels = nsfw.scale ?? [];
  counts.missingThumbs = missingThumbs.slice(0, 40);
  const manifest = buildManifest({
    source,
    counts,
    derived,
    outDir: args.out,
    version,
    poolsHash,
    poolsAnchor: anchor,
  });
  writeJson(path.join(args.out, "manifest.json"), manifest);

  info(
    `完成：${counts.sections} 段 / ${counts.fields} 字段 / ${counts.options} 选项 / ` +
      `${counts.characters} 内置 + ${counts.charactersMerged} 合并角色 / ${counts.scenes} 场景 / ` +
      `${manifest.counts.thumbs} 缩略图 (${(manifest.counts.thumbBytes / 1048576).toFixed(2)}MB)，warnings=${warnings}`,
  );
}

main();
