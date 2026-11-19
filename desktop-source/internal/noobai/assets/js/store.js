/* NoobAI 抽取 · 状态层
   四层分工，避免以前「一个 50 字段上帝对象 + UI 记忆塞进 weights_json」的混乱：
     cache    服务端快照（只读）
     settings 业务设置 → POST /api/settings（整份，必须合并后发送）
     prefs    界面记忆   → POST /api/state { ui }（整份快照，800ms 节流）
     view     瞬时 UI    → 不落盘
*/
import { getJSON, postJSON, postOnUnload } from "./api.js";

export const LEVELS = ["sfw", "suggestive", "explicit", "hardcore", "extreme", "any"];
export const LEVEL_NUM = { sfw: 0, suggestive: 1, explicit: 2, hardcore: 3, extreme: 4, any: 99 };
export const LEVEL_LABELS = {
  sfw: "全年龄", suggestive: "暗示", explicit: "成人", hardcore: "硬核", extreme: "极限", any: "不限",
};
export const POSE_FIELDS = ["pose.stance", "pose.action", "pose.head", "pose.legs", "pose_nsfw.intimate", "pose_nsfw.explicit"];
export const CAMERA_FIELDS = ["lighting.type", "camera.shot", "camera.composition", "lighting.grade"];
export const STYLE_FIELDS = ["style.medium", "style.theme", "style.art"];

export const PAGE_CHARS = 60;
export const PAGE_ARTISTS = 60;
export const PAGE_OUTFITS = 48;
export const PAGE_SCENES = 48;
export const PAGE_DICT = 60;

/* ── 极简事件总线 ─────────────────────────────────────────────────── */
const bus = new Map();
export function on(topic, fn) {
  if (!bus.has(topic)) bus.set(topic, new Set());
  bus.get(topic).add(fn);
  return () => bus.get(topic) && bus.get(topic).delete(fn);
}
export function emit(topic, payload) {
  const set = bus.get(topic);
  if (!set) return;
  set.forEach((fn) => {
    try { fn(payload); } catch (e) { console.error(e); }
  });
}

/* ── 服务端快照 ───────────────────────────────────────────────────── */
export const cache = {
  pools: null,
  characters: null,
  artists: null,
  outfits: null,
  scenes: null,
  state: {},
  allOptions: null,
  version: "",
};

export async function loadAll() {
  const [pools, characters, artists, outfits, scenes, stateRes, settingsRes] = await Promise.all([
    getJSON("/pools"),
    getJSON("/characters"),
    getJSON("/artists"),
    getJSON("/outfits"),
    getJSON("/scenes"),
    getJSON("/state"),
    getJSON("/settings"),
  ]);
  cache.pools = pools;
  cache.characters = characters;
  cache.artists = artists;
  cache.outfits = outfits;
  cache.scenes = scenes;
  cache.state = (stateRes && stateRes.state) || {};
  cache.version = (pools && pools.version) || "";
  cache.allOptions = null;
  loadSettings((settingsRes && settingsRes.settings) || {});
  return cache;
}

export function fieldByKey(key) {
  const sections = (cache.pools && cache.pools.sections) || [];
  for (const sec of sections) {
    const hit = (sec.fields || []).find((f) => f.key === key);
    if (hit) return { field: hit, section: sec };
  }
  return null;
}

export function optionZh(opt) { return opt && opt[0] != null ? String(opt[0]) : ""; }
export function optionTags(opt) { return opt && opt[1] != null ? String(opt[1]) : ""; }
export function optionLevel(opt) { return opt && opt[2] != null ? Number(opt[2]) : 0; }

export function flattenTags(value) {
  return String(value || "")
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function splitCSV(value) {
  return String(value || "")
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ── 业务设置（整份写，避免零值覆盖） ─────────────────────────────── */
const settings = {};
let settingsTimer = null;

function loadSettings(obj) {
  Object.keys(settings).forEach((k) => delete settings[k]);
  Object.assign(settings, obj || {});
}

export function getSetting(key, dflt = "") {
  const v = settings[key];
  return v === undefined || v === null ? dflt : v;
}

export function setSetting(key, value) {
  settings[key] = value;
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(flushSettings, 320);
}

export function settingsSnapshot() {
  return Object.assign({}, settings);
}

export async function flushSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = null;
  // 必须整份发送：后端 /api/settings 是覆盖写，缺字段会被清零
  return postJSON("/settings", settingsSnapshot()).catch(() => null);
}

export function flushSettingsOnUnload() {
  if (!Object.keys(settings).length) return;
  clearTimeout(settingsTimer);
  settingsTimer = null;
  postOnUnload("/settings", settingsSnapshot());
}

/* ── 界面记忆（写 /api/state 的 ui 字段） ─────────────────────────── */
const PREFS_DEFAULT = {
  schemaVersion: 1,
  tab: "chars",
  sub: { scene: "scenes", detail: "pose" },
  rightCollapsed: false,
  chars: { query: "", work: "", gender: "", onlyFav: false },
  artists: { scope: "curated", query: "", style: "全部", sort: "hot", onlyFav: false },
  outfits: { query: "", cat: "", onlyFav: false },
  scenes: { query: "", group: "", level: "all", onlyFav: false },
  detail: { poseView: "tags", fieldQuery: "", open: [] },
  dict: { query: "", sec: "", level: "all" },
  posePicked: [],
  lastResult: null,
};
let prefs = JSON.parse(JSON.stringify(PREFS_DEFAULT));
let prefsTimer = null;
let prefsReadyResolve;
export const prefsReady = new Promise((resolve) => { prefsReadyResolve = resolve; });
let prefsBooting = false;

function readPath(obj, path, dflt) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object" || !(p in cur)) return dflt;
    cur = cur[p];
  }
  return cur === undefined ? dflt : cur;
}

function writePath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

export function prefsGet(path, dflt) {
  return readPath(prefs, path, dflt);
}

export function prefsSet(path, value) {
  writePath(prefs, path, value);
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => { flushPrefs(); }, 800);
}

export function flushPrefs() {
  clearTimeout(prefsTimer);
  prefsTimer = null;
  if (!prefsBooting) return Promise.resolve(null);
  return postJSON("/state", { ui: prefs })
    .then((res) => {
      if (res && res.state) cache.state = res.state;
      return res;
    })
    .catch(() => null);
}

/* 把旧的 weights_json._ui 迁移到 /api/state.ui，只做一次 */
export function bootstrapPrefs() {
  prefsBooting = true;
  const fromServer = cache.state && cache.state.ui;
  if (fromServer && typeof fromServer === "object" && fromServer.schemaVersion) {
    prefs = Object.assign(JSON.parse(JSON.stringify(PREFS_DEFAULT)), fromServer);
    prefsReadyResolve(true);
    return false;
  }

  const legacy = readLegacyUi();
  if (legacy) {
    if (typeof legacy.tab === "string") prefs.tab = legacy.tab;
    if (typeof legacy.charQuery === "string") prefs.chars.query = legacy.charQuery;
    if (typeof legacy.charWork === "string") prefs.chars.work = legacy.charWork;
    if (typeof legacy.charGender === "string") prefs.chars.gender = legacy.charGender;
    if (typeof legacy.outfitQuery === "string") prefs.outfits.query = legacy.outfitQuery;
    if (typeof legacy.outfitCat === "string") prefs.outfits.cat = legacy.outfitCat;
    if (typeof legacy.sceneQuery === "string") prefs.scenes.query = legacy.sceneQuery;
    if (typeof legacy.sceneGroup === "string") prefs.scenes.group = legacy.sceneGroup;
    if (typeof legacy.sceneLevel === "string") prefs.scenes.level = legacy.sceneLevel;
    if (Array.isArray(legacy.posePicked)) prefs.posePicked = legacy.posePicked.slice();
    if (typeof legacy.poseView === "string") prefs.detail.poseView = legacy.poseView;
    if (typeof legacy.dictQuery === "string") prefs.dict.query = legacy.dictQuery;
    if (typeof legacy.dictSec === "string") prefs.dict.sec = legacy.dictSec;
    if (typeof legacy.dictLevel === "string") prefs.dict.level = legacy.dictLevel;
    if (Array.isArray(legacy.openSecs)) prefs.detail.open = legacy.openSecs.slice();
  }
  prefsReadyResolve(true);
  flushPrefs();
  // 迁移后把 _ui 从 weights_json 里清掉，避免两处各存一份界面记忆
  if (legacy) saveWeights();
  return Boolean(legacy);
}

function readLegacyUi() {
  try {
    const raw = getSetting("weights_json", "");
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data._ui && typeof data._ui === "object" ? data._ui : null;
  } catch (e) {
    return null;
  }
}

/* ── 权重模型 ─────────────────────────────────────────────────────── */
const weights = { sections: {}, fields: {}, options: {} };

export function loadWeights(raw) {
  weights.sections = {};
  weights.fields = {};
  weights.options = {};
  try {
    const data = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {});
    if (data.sections && typeof data.sections === "object") weights.sections = data.sections;
    if (data.fields && typeof data.fields === "object") weights.fields = data.fields;
    if (data.options && typeof data.options === "object") weights.options = data.options;
  } catch (e) { /* 非法 JSON 时退回空权重 */ }
}

export function saveWeights() {
  const out = { sections: {}, fields: {}, options: {} };
  ["sections", "fields", "options"].forEach((bucket) => {
    Object.entries(weights[bucket] || {}).forEach(([k, v]) => {
      const n = Number(v);
      if (Number.isFinite(n) && n !== 1) out[bucket][k] = n;
    });
  });
  const empty = !Object.keys(out.sections).length &&
    !Object.keys(out.fields).length &&
    !Object.keys(out.options).length;
  setSetting("weights_json", empty ? "" : JSON.stringify(out));
}

export function sectionWeight(id) {
  return weights.sections[id] === undefined ? 1 : Number(weights.sections[id]);
}

export function setSectionWeight(id, value) {
  weights.sections[id] = value;
  saveWeights();
  emit("weights");
}

export function fieldWeight(key) {
  return Number(weights.fields[key] === undefined ? 1 : weights.fields[key]);
}

export function setFieldWeight(key, value) {
  weights.fields[key] = value;
  saveWeights();
  emit("weights");
}

export function optionWeight(key, tags) {
  const v = weights.options[`${key}|${tags}`];
  return Number(v === undefined ? 1 : v);
}

export function setOptionWeight(key, tags, value) {
  weights.options[`${key}|${tags}`] = value;
  saveWeights();
  emit("weights");
}

export function cycleOptionWeight(key, tags) {
  const cur = optionWeight(key, tags);
  const next = cur === 1 ? 2 : cur === 2 ? 3 : cur === 3 ? 0 : 1;
  setOptionWeight(key, tags, next);
  return next;
}

export function isLocked(key) {
  return splitCSV(getSetting("lock_fields", "")).includes(key);
}

/* 锁定 = 该字段只剩这一个选项且权重 3，并写入 lock_fields */
export function lockField(key, tags, field) {
  const opts = (field && field.opts) || [];
  opts.forEach((o) => {
    if (optionTags(o) !== tags) delete weights.options[`${key}|${optionTags(o)}`];
  });
  weights.options[`${key}|${tags}`] = 3;
  const locks = new Set(splitCSV(getSetting("lock_fields", "")));
  locks.add(key);
  setSetting("lock_fields", Array.from(locks).join(","));
  saveWeights();
  emit("weights");
}

export function unlockField(key, field) {
  const opts = (field && field.opts) || [];
  opts.forEach((o) => { delete weights.options[`${key}|${optionTags(o)}`]; });
  const locks = new Set(splitCSV(getSetting("lock_fields", "")));
  locks.delete(key);
  setSetting("lock_fields", Array.from(locks).join(","));
  saveWeights();
  emit("weights");
}

export function lockedOptionTags(key, field) {
  const opts = (field && field.opts) || [];
  let hit = "";
  opts.forEach((o) => {
    if (weights.options[`${key}|${optionTags(o)}`] === 3) hit = optionTags(o);
  });
  return hit;
}

export function clearLocks(keys) {
  const locks = new Set(splitCSV(getSetting("lock_fields", "")));
  keys.forEach((k) => {
    locks.delete(k);
    Object.keys(weights.options).forEach((optKey) => {
      if (optKey.startsWith(k + "|")) delete weights.options[optKey];
    });
  });
  setSetting("lock_fields", Array.from(locks).join(","));
  saveWeights();
  emit("weights");
}

export function resetWeights(preset) {
  weights.sections = {};
  weights.fields = {};
  weights.options = {};
  if (preset === "scene") {
    Object.assign(weights.sections, { scene: 2.5, lighting: 1.5, camera: 1.3, hair: 0.8, outfit: 0.7 });
  } else if (preset === "outfit") {
    Object.assign(weights.sections, { outfit: 2.2, outfit_nsfw: 1.6, hair: 1.2, pose: 0.8 });
  } else if (preset === "person") {
    Object.assign(weights.sections, { hair: 1.6, face: 1.6, body: 1.5, makeup: 1.2, outfit: 0.6, scene: 0.7 });
  }
  saveWeights();
  emit("weights");
}

export function weightsJson() {
  const out = { sections: {}, fields: {}, options: {} };
  ["sections", "fields", "options"].forEach((bucket) => {
    Object.entries(weights[bucket] || {}).forEach(([k, v]) => {
      const n = Number(v);
      if (Number.isFinite(n) && n !== 1) out[bucket][k] = n;
    });
  });
  return out;
}

/* ── 收藏 / 最近使用 / 启用服装（写 /api/state） ──────────────────── */
const FAV_KEYS = { char: "char_favorites", outfit: "outfit_favorites", scene: "scene_favorites", artist: "artist_favorites" };
const RECENT_KEYS = { char: "recent_chars", outfit: "recent_outfits", scene: "recent_scenes", artist: "recent_artists" };

export function favorites(kind) {
  return new Set((cache.state && cache.state[FAV_KEYS[kind]]) || []);
}

export function recents(kind) {
  return ((cache.state && cache.state[RECENT_KEYS[kind]]) || []).slice();
}

export async function patchState(patch) {
  const res = await postJSON("/state", patch);
  if (res && res.state) cache.state = res.state;
  if (res && res.outfits) cache.outfits = res.outfits;
  emit("state");
  return res;
}

export async function toggleFavorite(kind, id) {
  const set = favorites(kind);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  await patchState({ [FAV_KEYS[kind]]: Array.from(set) });
  return set.has(id);
}

export async function pushRecent(kind, id) {
  const list = recents(kind).filter((x) => x !== id);
  list.unshift(id);
  await patchState({ [RECENT_KEYS[kind]]: list.slice(0, 12) }).catch(() => null);
}

export function activeOutfit() {
  return String((cache.outfits && cache.outfits._meta && cache.outfits._meta.active) || "");
}
