#!/usr/bin/env node
/**
 * 从已安装的 Comfyui-Anima-Wardrobe-V6 插件导入造型台数据。
 *
 * 用法（在 desktop-source 目录执行）：
 *   node scripts/import-wardrobe-data.mjs --plugin "<插件根目录>"
 *   node scripts/import-wardrobe-data.mjs --plugin "<插件根目录>" --dry-run
 *   node scripts/import-wardrobe-data.mjs --verify-only
 *
 * 与 import-anima-data.mjs 的差别：Wardrobe 的数据是「结构化段/字段/选项池」+
 * 2432 位角色 + 524 条场景 + 2432 张缩略图，需要按语义做交叉校验（选项档位、
 * 场景引用、缩略图缺失），不能只数条数。
 *
 * 旁挂表（都来自插件 presets/，缺一不可）：
 *   char_output_tags.json     正文角色 tag（角色 + 作品两段式，Anima 官方顺序）
 *   char_aliases.json         角色改名兼容表
 *   character_outfits.json    角色服装预设（用户数据，启用后锁服装）
 *   outfit_library.json       全局服装库（v5.1.0：135 套 / 11 类）
 *   anima_v4_scene_aspects.json 场景推荐画幅（竖/横/通用）
 *   term_hints.json           复杂词条的自然语言补充句
 *   outfit_templates_日常六套.json 服装预设模板
 *
 * ⚠️ 插件里的 `_orphan_hair_styles.json` 是被主动清理的死数据归档，**永不导入**。
 * ⚠️ 插件里的 `_meta.count` / `_meta.counters` 常年不更新（V6 实际 2432 却写着
 *    2390/2409），本脚本一律以数组实测为准。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = path.join(ROOT, "public", "data", "wardrobe");
const SOURCE_REPO = "https://github.com/lingdongbudong/Comfyui-Anima-Wardrobe-V6";
const SOURCE_PLUGIN = "Comfyui-Anima-Wardrobe-V6";
const SOURCE_LICENSE = "GPL-3.0";

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
  outfitLibrary: "outfit_library.json",
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
  outfitLibrary: "outfit-library.json",
  termHints: "term-hints.json",
  outfitTemplates: "outfit-templates.json",
};

/** 由 export-wardrobe-tables.py 生成，导入时只校验存在性与哈希 */
const DERIVED = ["nsfw-tables.json", "overrides.json", "outfit-style.json", "link.json"];

const HELP = `导入 Comfyui-Anima-Wardrobe-V6 数据到本项目

  --plugin <dir>   插件根目录（含 presets/ 与 __init__.py）
  --out <dir>      输出目录，默认 public/data/wardrobe
  --dry-run        只读取/校验/打印统计，不写任何文件
  --verify-only    不访问插件，回读已生成产物做结构校验
  --no-thumbs      只同步 JSON
  --thumbs-only    只同步缩略图（JSON 必须已存在）
  --prune-thumbs   删除源里已不存在的缩略图（角色被删后的孤儿图）
  --refresh-thumbs 强制重拷全部缩略图（插件真的改了图时才用）
  --strict-thumbs  缩略图缺失即失败（默认只告警）

环境变量：ANIMA_WARDROBE_DIR 等价于 --plugin`;

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    plugin: "",
    dryRun: false,
    verifyOnly: false,
    noThumbs: false,
    thumbsOnly: false,
    pruneThumbs: false,
    refreshThumbs: false,
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
    else if (arg === "--prune-thumbs") args.pruneThumbs = true;
    else if (arg === "--refresh-thumbs") args.refreshThumbs = true;
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
  if (rows.length !== 2432) warn(`角色数 ${rows.length}（预期 2432，插件升级时会变）`);
  for (const row of rows) {
    if (!row.tag || !row.name) fail(`角色记录缺 tag/name：${JSON.stringify(row).slice(0, 120)}`);
    if (!row.thumb) fail(`角色 ${row.tag} 缺 thumb 字段`);
  }
  const works = characters.works ?? [];
  return { characters: rows.length, works: works.length };
}

/**
 * 去掉「已经被上游收编进内置库」的自建角色。
 *
 * V6 的 `user_characters.json` 是干净重装后的空文件，而项目保留的覆盖层里
 * 有 12 位当年手建的角色 —— 它们现在全部出现在内置库里（同 tag）。再整条
 * 追加就是同一角色两份（角色池、作品计数、索引全部翻倍），所以按 tag 去重。
 */
function dedupeCustom(base, overlay) {
  const known = new Set((base.characters ?? []).map((row) => String(row.tag ?? "").trim().toLowerCase()));
  const kept = [];
  const dropped = [];
  for (const row of overlay?.custom ?? []) {
    const tag = String(row.tag ?? "").trim().toLowerCase();
    if (tag && known.has(tag)) dropped.push(String(row.tag ?? ""));
    else kept.push(row);
  }
  return { kept, dropped };
}

function validateUserCharacters(overlay, base) {
  const edits = overlay.edits ?? {};
  const { kept, dropped } = dedupeCustom(base, overlay);
  if (dropped.length) {
    info(`角色覆盖层：${dropped.length} 位自建角色已在内置库 → 合并时跳过（${dropped.slice(0, 4).join("、")}${dropped.length > 4 ? "…" : ""}）`);
  }
  for (const row of kept) {
    if (!row.tag || !row.trigger) fail(`自定义角色缺 tag/trigger：${JSON.stringify(row).slice(0, 120)}`);
  }
  return { edits: Object.keys(edits).length, custom: kept.length, dedupedCustom: dropped.length };
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
  const { kept, dropped } = dedupeCustom(base, overlay);
  for (const row of kept) rows.push({ ...row, src: row.src ?? "user" });
  return { rows, dedupedCustom: dropped.length };
}

function validateScenes(scenes, pools) {
  const fieldMap = new Map(flattenFields(pools).map(({ field }) => [field.key, field]));
  const problems = [];
  const rows = scenes.scenes ?? [];
  const countOpts = new Set((fieldMap.get("count")?.opts ?? []).map(([, v]) => v));
  // `2girls` 是插件里 L0 双人的中性写法（`yuri` 自 L1 起），不在人数选项表里
  const extraCountLocks = new Set(["2girls"]);
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
    // V6 起 524 条场景全部带 count_lock（V5 有 51 条为空），必须能对上人数选项
    if (scene.count_lock && countOpts.size && !countOpts.has(scene.count_lock) && !extraCountLocks.has(scene.count_lock)) {
      problems.push(`${scene.id}: count_lock "${scene.count_lock}" 不是人数选项`);
    }
    if (!scene.id || !scene.zh) problems.push(`场景缺 id/zh：${JSON.stringify(scene).slice(0, 80)}`);
  }
  if (problems.length) fail(`场景引用有 ${problems.length} 处不合法：\n  ${problems.slice(0, 8).join("\n  ")}`);

  const groups = {};
  for (const scene of rows) groups[scene.group] = (groups[scene.group] ?? 0) + 1;
  // 三方一致性：scenes.json 的 groups 声明、场景实际分布、本脚本的期望表。
  // 写死数字会在插件新增分组时静默漏管（V6 的 weapon 80 条就是这样躲过去的）。
  const declared = (scenes.groups ?? []).map((g) => String(g.id)).sort();
  const actual = Object.keys(groups).sort();
  const expected = { sfw: 122, nsfw: 77, near: 60, pose: 82, art: 103, weapon: 80 };
  if (declared.join("|") !== actual.join("|")) {
    fail(`groups 声明 [${declared.join(", ")}] 与实际分布 [${actual.join(", ")}] 不一致`);
  }
  const expectedKeys = Object.keys(expected).sort();
  if (expectedKeys.join("|") !== actual.join("|")) {
    warn(`场景分组变了：[${actual.join(", ")}]（脚本期望 [${expectedKeys.join(", ")}]）—— 请确认新组是否需要引擎/面板支持`);
  }
  for (const [group, count] of Object.entries(expected)) {
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

/** 全局服装库（v5.1.0 起；V6 = 135 套 / 11 类）：字段值必须能对上词库。 */
function validateOutfitLibrary(doc, pools) {
  const meta = doc?._meta ?? {};
  const items = doc?.outfits ?? [];
  const cats = (meta.categories ?? []).map((c) => String(c.id));
  const catSet = new Set(cats);
  const fieldMap = new Map(flattenFields(pools).map(({ field }) => [field.key, field]));
  const problems = [];
  const ids = new Set();
  for (const item of items) {
    const id = String(item?.id ?? "");
    if (!id) problems.push("有条目缺 id");
    if (ids.has(id)) problems.push(`id 重复：${id}`);
    ids.add(id);
    if (catSet.size && !catSet.has(String(item?.cat))) problems.push(`${id}: 未知分类 ${item?.cat}`);
    const level = Number(item?.level ?? 0);
    if (!Number.isInteger(level) || level < 0 || level > 4) problems.push(`${id}: level 越界 ${item?.level}`);
    for (const [key, value] of Object.entries(item?.fields ?? {})) {
      const field = fieldMap.get(key);
      if (!field) {
        problems.push(`${id}: 未知字段 ${key}`);
        continue;
      }
      if (!(field.opts ?? []).some(([, v]) => v === value)) problems.push(`${id}: ${key} 没有选项 "${value}"`);
    }
    if (!Array.isArray(item?.drop) || !item.drop.includes("outfit")) problems.push(`${id}: drop 缺 outfit`);
  }
  if (problems.length) fail(`服装库有 ${problems.length} 处不合法：\n  ${problems.slice(0, 8).join("\n  ")}`);
  if (items.length !== 135) warn(`服装库条目 ${items.length}（预期 135）`);
  if (cats.length !== 11) warn(`服装库分类 ${cats.length}（预期 11）`);
  return { outfitLibrary: items.length, outfitLibraryCats: cats.length };
}

/** 发型表：V6 删掉 11 条幽灵角色并另存归档 —— 归档永不导入。 */
function validateHairStyle(doc) {
  const count = Object.keys(doc?.styles ?? {}).length;
  if (count !== 2122) warn(`发型表 ${count} 条（预期 2122）`);
  return { hairStyles: count };
}

/** 角色特征表：V6 新增 `body: true`（这 16 条走 body_extra 通道，不是 tail）。 */
function validateCharFeat(doc) {
  const feats = doc?.feats ?? {};
  const count = Object.keys(feats).length;
  let body = 0;
  for (const rec of Object.values(feats)) if (rec && rec.body === true) body += 1;
  return { charFeat: count, charFeatBody: body };
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
    return { files: 0, bytes: 0, copied: 0, names: [] };
  }
  const destDir = path.join(outDir, "thumbs");
  if (!args.dryRun) fs.mkdirSync(destDir, { recursive: true });

  const names = files.map((file) => path.basename(file));
  let copied = 0;
  let bytes = 0;
  for (const file of files) {
    const name = path.basename(file);
    const dest = path.join(destDir, name);
    const stat = fs.statSync(file);
    bytes += stat.size;
    if (args.dryRun) continue;
    // ⚠️ 不能用 size/mtime 判等：项目里的图已被 optimize-data.py 重编码
    // （14.35MB vs 插件原始 22MB），元数据一定不同 —— 那会把 2402 张已优化
    // 的图全部重写回原始体积。插件只做「增删」不做「改图」，所以判据是
    // 「本地是否已存在」；本地反而更大说明它是原始图，需要重拷（可被
    // --refresh-thumbs 强制覆盖）。
    let need = true;
    if (fs.existsSync(dest)) {
      need = args.refreshThumbs || fs.statSync(dest).size >= stat.size;
    }
    if (need) {
      fs.copyFileSync(file, dest);
      copied += 1;
    }
  }
  return { files: files.length, bytes, copied, names };
}

/** 删掉源里已不存在的缩略图（角色被删后的孤儿图）。keep = 两个子目录的并集。 */
function pruneThumbs(outDir, keepNames, args) {
  if (!args.pruneThumbs || args.dryRun) return 0;
  const dir = path.join(outDir, "thumbs");
  const keep = new Set(keepNames);
  let pruned = 0;
  for (const file of listThumbs(dir)) {
    if (keep.has(path.basename(file))) continue;
    fs.unlinkSync(file);
    pruned += 1;
  }
  return pruned;
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

/**
 * 覆盖层里的 `thumb` 是钉死文件名的。老覆盖层里有人把 thumb 改成 `user_xxx`，
 * 而 V6 已把这些角色收编进内置库、图也换成了 `xxx.webp` —— 继续用旧值就是
 * 「角色有记录、图 404」。这里按插件实际文件清单校验，失效的 thumb 补丁直接丢。
 */
function sanitizeOverlayThumbs(overlay, available) {
  let dropped = 0;
  for (const patch of Object.values(overlay?.edits ?? {})) {
    if (!patch || typeof patch !== "object") continue;
    if (patch.thumb && !available.has(`${patch.thumb}.webp`)) {
      delete patch.thumb;
      dropped += 1;
    }
  }
  for (const row of overlay?.custom ?? []) {
    if (row?.thumb && !available.has(`${row.thumb}.webp`)) {
      delete row.thumb;
      dropped += 1;
    }
  }
  if (dropped) info(`覆盖层：${dropped} 条 thumb 指向已不存在的图 → 已丢弃该字段（回落到内置图）`);
}

function loadSource(pluginDir, outDir) {
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

  // ⚠️ 用户覆盖层不能「源覆盖本地」：V6 是干净重装，插件里的 user_characters.json
  // 已经被清空（0 编辑 / 0 自建），而本项目里存着当年 123 条用户修正 + 12 位
  // 自建角色。覆盖层属于用户数据，只做并集，source 里的值优先。
  const localPath = path.join(outDir, "user-characters.json");
  if (fs.existsSync(localPath)) {
    const local = readJson(localPath, "本地 user-characters");
    const incoming = source.userCharacters ?? { edits: {}, custom: [] };
    const edits = { ...(local.edits ?? {}), ...(incoming.edits ?? {}) };
    const custom = [...(local.custom ?? [])];
    const seen = new Set(custom.map((row) => String(row.tag ?? "").trim().toLowerCase()));
    for (const row of incoming.custom ?? []) {
      const tag = String(row.tag ?? "").trim().toLowerCase();
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      custom.push(row);
    }
    // `_meta` 同样要继承本地那份：`deduped` 记的是「已去重多少位自建角色」，
    // 插件里的空覆盖层没有这个字段 → 直接 `...incoming` 会把它洗成 0，
    // 再写回时 `Math.max` 就再也救不回来了（2026-11-10 踩过，manifest 里
    // dedupedCustom 变 0，provenance 丢失）。
    const localMeta = local._meta ?? {};
    const meta = { ...(incoming._meta ?? {}) };
    meta.deduped = Math.max(Number(meta.deduped) || 0, Number(localMeta.deduped) || 0);
    source.userCharacters = { ...incoming, _meta: meta, edits, custom };
    info(`用户覆盖层：合并本地 ${Object.keys(local.edits ?? {}).length} 条编辑 / ${(local.custom ?? []).length} 位自建`);

    const available = new Set([
      ...fs.readdirSync(path.join(presets, "thumbs")).filter((n) => n.endsWith(".webp")),
      ...(fs.existsSync(path.join(presets, "user_thumbs"))
        ? fs.readdirSync(path.join(presets, "user_thumbs")).filter((n) => n.endsWith(".webp"))
        : []),
    ]);
    sanitizeOverlayThumbs(source.userCharacters, available);
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
      plugin: SOURCE_PLUGIN,
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
    const hairStyle = readJson(path.join(outDir, "char-hair-style.json"), "char-hair-style");
    const charFeat = readJson(path.join(outDir, "char-feat.json"), "char-feat");
    const sceneAspects = readJson(path.join(outDir, "scene-aspects.json"), "scene-aspects");
    const charOutputTags = readJson(path.join(outDir, "char-output-tags.json"), "char-output-tags");
    const charAliases = readJson(path.join(outDir, "char-aliases.json"), "char-aliases");
    const characterOutfits = readJson(path.join(outDir, "character-outfits.json"), "character-outfits");
    const outfitLibrary = readJson(path.join(outDir, "outfit-library.json"), "outfit-library");
    const termHints = readJson(path.join(outDir, "term-hints.json"), "term-hints");
    readJson(path.join(outDir, "outfit-templates.json"), "outfit-templates");

    const counts = {
      ...validatePools(pools),
      ...validateLevels(levels, pools),
      ...validateCharacters(characters),
      ...validateUserCharacters(userCharacters, characters),
      ...validateScenes(scenes, pools),
      ...validateSceneAspects(sceneAspects, scenes),
      ...validateCharOutputTags(charOutputTags, characters, userCharacters),
      ...validateCharAliases(charAliases, characters),
      ...validateOutfits(characterOutfits, characters),
      ...validateOutfitLibrary(outfitLibrary, pools),
      ...validateHairStyle(hairStyle),
      ...validateCharFeat(charFeat),
      ...validateTermHints(termHints),
    };
    counts.charactersMerged = mergeCharacters(characters, userCharacters).rows.length;

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
  const source = loadSource(pluginDir, args.out);

  const counts = {
    ...validatePools(source.pools),
    ...validateLevels(source.levels, source.pools),
    ...validateCharacters(source.characters),
    ...validateUserCharacters(source.userCharacters, source.characters),
    ...validateScenes(source.scenes, source.pools),
    ...validateSceneAspects(source.sceneAspects, source.scenes),
    ...validateCharOutputTags(source.charOutputTags, source.characters, source.userCharacters),
    ...validateCharAliases(source.charAliases, source.characters),
    ...validateOutfits(source.characterOutfits, source.characters),
    ...validateOutfitLibrary(source.outfitLibrary, source.pools),
    ...validateHairStyle(source.hairStyle),
    ...validateCharFeat(source.charFeat),
    ...validateTermHints(source.termHints),
    ...validateOutfitTemplates(source.outfitTemplates),
  };
  const merged = mergeCharacters(source.characters, source.userCharacters);
  const mergedCharacters = merged.rows;
  counts.charactersMerged = mergedCharacters.length;
  // 去重只发生在第一次导入；后续重跑要保留历史数字，别把 provenance 洗成 0
  counts.dedupedCustom = Math.max(
    counts.dedupedCustom ?? 0,
    Number(source.userCharacters?._meta?.deduped) || 0,
  );

  // 插件自带的跨文件锚点：实测已过期（levels 生成后 pools 又改过），只能告警。
  const poolsHash = sha256(fs.readFileSync(path.join(pluginDir, "presets", DATASETS.pools)));
  const anchor = source.levels?._meta?.pools_sha256 ?? "";
  if (anchor && anchor !== poolsHash) {
    warn(`levels.json 的 pools_sha256 已过期（record=${anchor.slice(0, 8)}… actual=${poolsHash.slice(0, 8)}…），只告警`);
  }

  const thumbInfo = args.noThumbs
    ? { files: 0, bytes: 0, copied: 0, pruned: 0 }
    : (() => {
        const base = syncThumbs(path.join(pluginDir, "presets"), args.out, args, "thumbs");
        // user_thumbs 里放的是「用户自建角色」的缩略图；V6 把它们上游收编后仍然
        // 只放在这个子目录（角色记录的 thumb 指向它），所以必须一起同步。
        const user = syncThumbs(path.join(pluginDir, "presets"), args.out, args, "user_thumbs");
        const pruned = pruneThumbs(args.out, [...base.names, ...user.names], args);
        return {
          files: base.files + user.files,
          bytes: base.bytes + user.bytes,
          copied: base.copied + user.copied,
          pruned,
        };
      })();

  if (args.dryRun) {
    info(`dry-run：${JSON.stringify(counts)}，缩略图 ${thumbInfo.files} 张 / ${(thumbInfo.bytes / 1048576).toFixed(2)}MB`);
    return;
  }

  if (!args.thumbsOnly) {
    for (const [key, out] of Object.entries(OUTPUT_FILES)) {
      if (key === "userCharacters") {
        // 去重后的覆盖层：保留 123 条编辑，自建里已被内置库收编的整条丢弃
        const meta = { ...(source.userCharacters._meta ?? {}) };
        meta.edits = counts.edits;
        meta.custom = counts.custom;
        meta.deduped = Math.max(Number(meta.deduped) || 0, counts.dedupedCustom);
        writeJson(path.join(args.out, out), {
          ...source.userCharacters,
          _meta: meta,
          custom: dedupeCustom(source.characters, source.userCharacters).kept,
        });
        continue;
      }
      writeJson(path.join(args.out, out), source[key]);
    }
    info(
      `写入 ${Object.keys(OUTPUT_FILES).length} 个 JSON` +
        (thumbInfo.copied ? `，复制 ${thumbInfo.copied} 张缩略图` : "") +
        (thumbInfo.pruned ? `，清理 ${thumbInfo.pruned} 张孤儿图` : ""),
    );
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
