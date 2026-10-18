#!/usr/bin/env node
/**
 * 从已安装的 Comfyui-Anima-Tools 插件提取提示词词库，生成项目内置 JSON。
 *
 * 用法（在 desktop-source 目录执行）：
 *   node scripts/import-anima-data.mjs --plugin "F:/ComfyUI/custom_nodes/Comfyui-Anima-Tools"
 *   node scripts/import-anima-data.mjs --plugin "<插件>/js" --dry-run
 *   ANIMA_TOOLS_DIR="<插件目录>" node scripts/import-anima-data.mjs
 *
 * 为什么要拷一份而不是运行时读插件：本项目的 exe 内嵌 dist，词库必须离线可用，
 * 且不能因为用户删除/升级插件而整块功能失效。数据版权归原插件（MIT），见 manifest。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = path.join(ROOT, "public", "data", "anima");

const SOURCE_REPO = "https://github.com/nregret/Comfyui-Anima-Tools";
const SOURCE_LICENSE = "MIT";

/** 输入文件 → 输出文件；value 是插件 js/ 下的文件名 */
const DATASETS = {
  artists: { file: "data.js", out: "artists.json", min: 30000 },
  characters: { file: "character_data.js", out: "characters.json", min: 5000 },
  official: { file: "character_official_data.json", out: "character-official.json", min: 5000, json: true },
  clothing: { file: "clothing_data.js", out: "clothing.json", min: 300 },
  backgrounds: { file: "background_data.js", out: "backgrounds.json", min: 800 },
  poses: { file: "pose_data.js", out: "poses.json", min: 200 },
  danbooruAttire: { file: "danbooru_attire_data.json", out: "danbooru-attire.json", json: true },
};

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, dryRun: false, verifyOnly: false, plugin: "", force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--plugin") args.plugin = argv[++i] ?? "";
    else if (arg === "--out") args.out = path.resolve(argv[++i] ?? DEFAULT_OUT);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--verify-only") args.verifyOnly = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else {
      fail(`未知参数：${arg}\n\n${HELP}`);
    }
  }
  if (!args.plugin) args.plugin = process.env.ANIMA_TOOLS_DIR ?? "";
  return args;
}

const HELP = `提取 Comfyui-Anima-Tools 词库到本项目

  --plugin <dir>   插件根目录（含 js/）或 js/ 目录本身
  --out <dir>      输出目录，默认 public/data/anima
  --dry-run        只解析并打印统计，不写文件
  --verify-only    只回读已生成的 JSON 并校验，不访问插件

环境变量：ANIMA_TOOLS_DIR 等价于 --plugin`;

function fail(message) {
  console.error(`\n[import-anima] ERROR: ${message}\n`);
  process.exit(1);
}

function warn(message) {
  console.warn(`[import-anima] WARN: ${message}`);
}

/** 插件 data.js 带 UTF-8 BOM，JSON.parse 会直接报 Unexpected token */
function stripBom(text) {
  return text.replace(/^\uFEFF/, "");
}

/**
 * 从 `const x = [...]` 里取出第一个完整的数组字面量。
 * 不能用 indexOf("[")..lastIndexOf("]")：文件尾部可能还有别的数组/导出语句，
 * 而且字符串里的 `]` 会让朴素截断提前结束。
 */
function extractFirstJsonArray(text, file) {
  const start = text.indexOf("[");
  if (start < 0) fail(`${file} 中找不到数组起始符 "["`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        const raw = text.slice(start, i + 1);
        try {
          const data = JSON.parse(raw);
          if (!Array.isArray(data)) fail(`${file} 的顶层不是数组`);
          return data;
        } catch (error) {
          fail(`${file} 数组解析失败：${error.message}\n  片段：${raw.slice(0, 120)}`);
        }
      }
    }
  }
  return fail(`${file} 的数组没有闭合`);
}

function readText(file) {
  if (!fs.existsSync(file)) return null;
  return stripBom(fs.readFileSync(file, "utf8"));
}

function resolveJsDir(plugin) {
  const candidates = [plugin, path.join(plugin, "js")];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "data.js"))) return candidate;
  }
  return null;
}

function readPluginVersion(pluginRoot) {
  const pyproject = readText(path.join(pluginRoot, "pyproject.toml"));
  if (!pyproject) return "unknown";
  const match = pyproject.match(/^\s*version\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? "unknown";
}

function normalizeArtist(item) {
  const name = String(item?.name ?? "").trim();
  if (!name) return null;
  const id = String(item?.id ?? "").trim();
  const postCount = Number(item?.post_count) || 0;
  const uniquenessScore = Number(item?.uniqueness_score);
  return {
    id: id || name,
    name,
    postCount,
    ...(Number.isFinite(uniquenessScore) ? { uniquenessScore } : {}),
  };
}

function normalizeCharacter(item) {
  const name = String(item?.name ?? "").trim();
  if (!name) return null;
  const copyright = String(item?.copyright ?? "").trim();
  return {
    name,
    copyright,
    postCount: Number(item?.post_count) || 0,
    ...(item?.gender ? { gender: String(item.gender) } : {}),
    ...(item?.hair ? { hair: String(item.hair) } : {}),
    ...(item?.eye ? { eye: String(item.eye) } : {}),
  };
}

function normalizeCostume(item) {
  const id = String(item?.id ?? "").trim();
  const name = String(item?.name ?? "").trim();
  const nameZh = String(item?.name_zh ?? "").trim();
  if (!name && !nameZh) return null;
  return {
    id: id || nameZh || name,
    name: name || nameZh,
    nameZh: nameZh || name,
    tags: String(item?.tags ?? ""),
    ...(item?.tags_zh ? { tagsZh: String(item.tags_zh) } : {}),
    categories: Array.isArray(item?.categories) ? item.categories.map(String) : [],
    traits: Array.isArray(item?.traits) ? item.traits.map(String) : [],
    ...(item?.preview ? { preview: String(item.preview) } : {}),
  };
}

function normalizeOfficial(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (!value || typeof value !== "object") continue;
    const trigger = typeof value.trigger === "string" ? value.trigger : "";
    const tags = Array.isArray(value.tags) ? value.tags.map(String) : [];
    out[key] = { trigger, tags };
  }
  return out;
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function human(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function loadPluginData(jsDir) {
  const missing = [];
  const raw = {};
  for (const [key, spec] of Object.entries(DATASETS)) {
    const file = path.join(jsDir, spec.file);
    const text = readText(file);
    if (text === null) {
      missing.push(spec.file);
      continue;
    }
    raw[key] = text;
  }
  if (missing.length) {
    fail(`插件目录缺少以下文件：\n  - ${missing.join("\n  - ")}\n目录：${jsDir}`);
  }

  const artists = extractFirstJsonArray(raw.artists, DATASETS.artists.file).map(normalizeArtist).filter(Boolean);
  const characters = extractFirstJsonArray(raw.characters, DATASETS.characters.file).map(normalizeCharacter).filter(Boolean);
  const clothing = extractFirstJsonArray(raw.clothing, DATASETS.clothing.file).map(normalizeCostume).filter(Boolean);
  const backgrounds = extractFirstJsonArray(raw.backgrounds, DATASETS.backgrounds.file).map(normalizeCostume).filter(Boolean);
  const poses = extractFirstJsonArray(raw.poses, DATASETS.poses.file).map(normalizeCostume).filter(Boolean);

  let official;
  try {
    official = normalizeOfficial(JSON.parse(raw.official));
  } catch (error) {
    fail(`${DATASETS.official.file} JSON 解析失败：${error.message}`);
  }
  let danbooruAttire;
  try {
    danbooruAttire = JSON.parse(raw.danbooruAttire);
  } catch (error) {
    fail(`${DATASETS.danbooruAttire.file} JSON 解析失败：${error.message}`);
  }

  return { artists, characters, official, clothing, backgrounds, poses, danbooruAttire };
}

function checkCounts(counts) {
  for (const [key, spec] of Object.entries(DATASETS)) {
    const value = counts[key];
    if (!value) fail(`${key} 解析结果为 0，拒绝写入`);
    if (spec.min && value < spec.min) warn(`${key} 只有 ${value} 条，低于预期 ${spec.min}（继续）`);
  }
}

function writeOutputs(data, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = {};
  let total = 0;
  for (const [key, spec] of Object.entries(DATASETS)) {
    const target = path.join(outDir, spec.out);
    fs.writeFileSync(target, `${JSON.stringify(data[key])}\n`, "utf8");
    files[key] = spec.out;
    const bytes = jsonBytes(data[key]);
    total += bytes;
    console.log(`  ${spec.out.padEnd(28)} ${String(Array.isArray(data[key]) ? data[key].length : Object.keys(data[key]).length).padStart(6)} 条  ${human(bytes)}`);
  }
  return { files, total };
}

function writeManifest(args, data, files, total) {
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generator: "scripts/import-anima-data.mjs",
    source: {
      plugin: "Comfyui-Anima-Tools",
      version: readPluginVersion(args.plugin),
      repo: SOURCE_REPO,
      license: SOURCE_LICENSE,
    },
    counts: {
      artists: data.artists.length,
      characters: data.characters.length,
      official: Object.keys(data.official).length,
      clothing: data.clothing.length,
      backgrounds: data.backgrounds.length,
      poses: data.poses.length,
      danbooruAttire: Object.keys(data.danbooruAttire).length,
    },
    files: { ...files, manifest: "manifest.json" },
    notes:
      "画师/角色缩略图来自 blobs.animadex.net；服装/背景/姿势缩略图来自数据内的 jsDelivr 地址。" +
      "仅提取词条元数据，数据版权归 Comfyui-Anima-Tools（MIT）与 Danbooru 贡献者。",
  };
  const target = path.join(args.out, "manifest.json");
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  total += jsonBytes(manifest);
  return manifest;
}

function verify(outDir) {
  let total = 0;
  const manifestPath = path.join(outDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) fail(`缺少 ${manifestPath}，请先执行导入`);
  const manifest = JSON.parse(readText(manifestPath));
  for (const [key, spec] of Object.entries(DATASETS)) {
    const file = path.join(outDir, spec.out);
    if (!fs.existsSync(file)) fail(`缺少 ${file}`);
    const parsed = JSON.parse(readText(file));
    const count = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
    const expected = manifest.counts?.[key];
    if (expected !== undefined && expected !== count) {
      fail(`${spec.out} 条数不一致：manifest=${expected} 实际=${count}`);
    }
    if (!count) fail(`${spec.out} 为空`);
    total += jsonBytes(parsed);
    console.log(`  OK ${spec.out.padEnd(28)} ${String(count).padStart(6)} 条`);
  }
  console.log(`\n[import-anima] 校验通过，数据合计 ${human(total)}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.verifyOnly) {
    verify(args.out);
    return;
  }
  if (!args.plugin) {
    fail(
      `未指定插件目录。示例：\n` +
        `  node scripts/import-anima-data.mjs --plugin "F:/ComfyUI/custom_nodes/Comfyui-Anima-Tools"\n` +
        `也可以用环境变量 ANIMA_TOOLS_DIR。`,
    );
  }
  const pluginRoot = path.resolve(args.plugin);
  const jsDir = resolveJsDir(pluginRoot);
  if (!jsDir) fail(`在 ${pluginRoot} 及其 js/ 下都找不到 data.js，请确认路径指向 Comfyui-Anima-Tools`);
  if (!fs.existsSync(path.join(jsDir, "i18n.js"))) warn(`未在 ${jsDir} 看到 i18n.js，仍按 data.js 解析`);

  console.log(`[import-anima] 读取插件数据：${jsDir}`);
  const data = loadPluginData(jsDir);
  const counts = {
    artists: data.artists.length,
    characters: data.characters.length,
    official: Object.keys(data.official).length,
    clothing: data.clothing.length,
    backgrounds: data.backgrounds.length,
    poses: data.poses.length,
    danbooruAttire: Object.keys(data.danbooruAttire).length,
  };
  checkCounts(counts);

  console.log(`[import-anima] 解析完成：`);
  for (const [key, value] of Object.entries(counts)) console.log(`  ${key.padEnd(16)} ${value}`);

  if (args.dryRun) {
    for (const [key, spec] of Object.entries(DATASETS)) {
      console.log(`  ${spec.out.padEnd(28)} ${human(jsonBytes(data[key]))}`);
    }
    console.log(`\n[import-anima] --dry-run：未写入任何文件`);
    return;
  }

  console.log(`[import-anima] 写入 ${args.out}`);
  const { files, total } = writeOutputs(data, args.out);
  const manifest = writeManifest(args, data, files, total);
  console.log(
    `\n[import-anima] 完成：${Object.keys(manifest.counts).length} 个数据集，` +
      `合计约 ${human(total)}（含 manifest）\n` +
      `  来源：Comfyui-Anima-Tools v${manifest.source.version}（${SOURCE_LICENSE}）`,
  );
}

main();
