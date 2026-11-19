/* NoobAI 抽取 · 入口
   页面结构：顶栏（品牌 / 档位 / seed / 抽一次 / 字典）→ 页签 + 生图工具条 → 左栏页签 + 右栏结果台。
   Esc 只关浮层（灯箱 / 生图设置 / 字典），页面本身靠左侧栏切换离开。 */
import {
  h, btn, iconSpan, iconBtn, toast, copyText,
} from "./dom.js";
import {
  cache, loadAll, loadWeights, bootstrapPrefs, prefsGet, prefsSet,
  getSetting, setSetting, weightsJson, LEVELS, LEVEL_LABELS, activeOutfit, flushSettings,
} from "./store.js";
import { postJSON } from "./api.js";
import { mountResultPanel, setResult, setStatus, markStale, copyNegative } from "./result.js";
import { mountChars } from "./chars.js";
import { mountArtists } from "./artists.js";
import { mountScene } from "./scene.js";
import { mountDetail } from "./detail.js";
import { mountAssemble } from "./assemble.js";
import { openDictionary } from "./dict.js";
import { mountGenBar, ensureGenData, setVisible, GEN } from "./generate.js";

const EMBED = new URLSearchParams(location.search).get("embed") === "1";
const SEED_MAX = 2147483000;

const TABS = [
  { id: "chars", label: "角色", icon: "user", mount: mountChars },
  { id: "artists", label: "画师", icon: "brush", mount: mountArtists },
  { id: "scene", label: "场景服装", icon: "shirt", mount: mountScene },
  { id: "detail", label: "细节", icon: "sliders", mount: mountDetail },
  { id: "assemble", label: "拼装", icon: "layers", mount: mountAssemble },
];

const view = { last: null, busy: false, tab: null, panes: {}, mounts: {} };
let root = null;
let resultApi = null;
let seedInput = null;

boot();

async function boot() {
  const host = document.getElementById("noobaiApp") || document.body;
  host.replaceChildren(h("div", "nl-loading", "正在加载 NoobAI 词库…"));

  try {
    await loadAll();
  } catch (err) {
    host.replaceChildren(h("div", "nl-empty", "NoobAI 词库加载失败：" + err.message));
    return;
  }

  loadWeights(getSetting("weights_json", ""));
  bootstrapPrefs();

  host.replaceChildren();
  buildShell(host);

  const last = prefsGet("lastResult", null);
  if (last && last.text) {
    view.last = last;
    setResult(last);
    setStatus(last.report ? `上次结果 · seed ${last.report.seed}` : "上次结果来自拼接台");
  } else {
    setStatus("选好角色 / 场景后，点右上角「抽一次」");
  }

  activateTab(resolveInitialTab());

  ensureGenData()
    .then(() => {
      mountGenBar(resultApi.genDockEl, {
        onJobPrompt: (job) => {
          // 复制 / 固定 seed 走的是 view.last，这里同步成本次生图实际用的词。
          view.last = {
            text: job.prompt || "",
            negative: job.negative || "",
            cn_summary: "",
            report: Number(job.seed) >= 0 ? { seed: job.seed } : null,
            source: "gen",
          };
          resultApi.setGenPrompt(job);
          const index = job.index || 1;
          const total = job.total || 1;
          setStatus(job.status === "running"
            ? `正在生成第 ${index}/${total} 张 · 右栏显示的是它实际使用的提示词`
            : `本次生图已完成（第 ${index}/${total} 张）`);
        },
      });
      if (GEN.job && GEN.job.status === "running") setVisible(true);
    })
    .catch(() => { /* 生图数据失败不影响抽词 */ });
}

function resolveInitialTab() {
  const q = new URLSearchParams(location.search).get("tab");
  const valid = TABS.some((t) => t.id === q);
  if (valid) return q;
  const saved = prefsGet("tab", "chars");
  return TABS.some((t) => t.id === saved) ? saved : "chars";
}

function buildShell(host) {
  root = h("div", "nl-app");
  host.appendChild(root);

  /* 顶栏 */
  const top = h("header", "nl-top");
  const brand = h("div", "nl-brand");
  brand.appendChild(iconSpan("logo"));
  brand.appendChild(h("h1", "nl-title", "NoobAI 抽取"));
  if (cache.version) brand.appendChild(h("span", "nl-ver", "v" + cache.version));
  top.appendChild(brand);

  const levels = h("div", "nl-levels");
  levels.setAttribute("role", "group");
  levels.setAttribute("aria-label", "内容档位");
  const levelBtns = LEVELS.map((lv) => {
    const b = h("button", "nl-lvbtn", LEVEL_LABELS[lv]);
    b.type = "button";
    b.dataset.level = lv;
    b.title = `${LEVEL_LABELS[lv]}（${lv}）`;
    b.setAttribute("aria-pressed", String(String(getSetting("nsfw_level", "sfw")) === lv));
    b.addEventListener("click", () => {
      setSetting("nsfw_level", lv);
      levelBtns.forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.level === lv)));
      markStale(true);
      refreshActive();
    });
    levels.appendChild(b);
    return b;
  });
  top.appendChild(levels);

  const seedWrap = h("div", "nl-seed");
  const seedLabel = h("label", "nl-lab", "seed");
  seedLabel.htmlFor = "nlSeed";
  seedWrap.appendChild(seedLabel);
  seedInput = h("input");
  seedInput.id = "nlSeed";
  seedInput.type = "number";
  seedInput.value = String(getSetting("seed", -1));
  seedInput.title = "-1 = 每次重抽；≥0 = 可复现";
  seedInput.addEventListener("change", () => {
    const v = parseInt(seedInput.value, 10);
    setSetting("seed", Number.isFinite(v) ? v : -1);
  });
  seedWrap.appendChild(seedInput);
  seedWrap.appendChild(iconBtn("dice", "换一个随机 seed", () => {
    const v = Math.floor(Math.random() * SEED_MAX);
    seedInput.value = String(v);
    setSetting("seed", v);
  }));
  top.appendChild(seedWrap);

  top.appendChild(h("span", "nl-grow"));

  const rollBtn = btn("抽一次", {
    variant: "pri",
    icon: "spark",
    title: "根据当前设置抽取一条提示词（Ctrl/Cmd + Enter）",
    onClick: () => doRoll(),
  });
  top.appendChild(rollBtn);
  top.appendChild(btn("词库字典", {
    size: "sm",
    icon: "book",
    onClick: () => openDictionary({
      onWeightsChanged: () => refreshActive(),
      onSettingsChanged: () => { /* 手写补充在下次开抽时生效 */ },
    }),
  }));
  root.appendChild(top);

  /* 页签 + 生图工具条 */
  const tabsRow = h("div", "nl-tabs-row");
  const tabs = h("div", "nl-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "抽取步骤");
  TABS.forEach((tab) => {
    const b = h("button", "nl-tab");
    b.type = "button";
    b.id = `nl-tab-${tab.id}`;
    b.dataset.tab = tab.id;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", `nl-pane-${tab.id}`);
    b.setAttribute("aria-selected", "false");
    b.appendChild(iconSpan(tab.icon));
    b.appendChild(h("span", "", tab.label));
    b.addEventListener("click", () => activateTab(tab.id));
    b.addEventListener("keydown", onTabKey);
    tabs.appendChild(b);
  });
  tabsRow.appendChild(tabs);
  root.appendChild(tabsRow);

  /* 主体 */
  const body = h("div", "nl-body");
  const left = h("div", "nl-left");
  const right = h("aside", "nl-right");
  body.appendChild(left);
  body.appendChild(right);
  root.appendChild(body);

  TABS.forEach((tab) => {
    const pane = h("div", "nl-pane");
    pane.id = `nl-pane-${tab.id}`;
    pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-labelledby", `nl-tab-${tab.id}`);
    pane.hidden = true;
    left.appendChild(pane);
    view.panes[tab.id] = pane;
  });

  resultApi = mountResultPanel(right, {
    onRoll: () => doRoll(),
    onAdopt: adoptSeed,
    onCopy: () => {
      if (!view.last || !view.last.text) { toast("还没有可复制的内容", true); return; }
      copyText(view.last.text, "已复制 Prompt");
    },
    onCopyNeg: () => copyNegative(view.last),
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      doRoll();
    }
  });

  window.addEventListener("pagehide", () => { flushSettings(); });
  if (EMBED) {
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || data.type !== "comfy-noobai-visibility") return;
      setVisible(Boolean(data.visible));
      if (!data.visible) flushSettings();
    });
  }
}

function onTabKey(event) {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const current = TABS.findIndex((t) => t.id === view.tab);
  let next = current;
  if (event.key === "ArrowRight") next = (current + 1) % TABS.length;
  if (event.key === "ArrowLeft") next = (current - 1 + TABS.length) % TABS.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = TABS.length - 1;
  event.preventDefault();
  activateTab(TABS[next].id);
  const btnEl = document.getElementById(`nl-tab-${TABS[next].id}`);
  if (btnEl) btnEl.focus();
}

function activateTab(id) {
  const tab = TABS.find((t) => t.id === id) || TABS[0];
  view.tab = tab.id;
  prefsSet("tab", tab.id);

  document.querySelectorAll(".nl-tab").forEach((el) => {
    const on = el.dataset.tab === tab.id;
    el.setAttribute("aria-selected", String(on));
    el.tabIndex = on ? 0 : -1;
  });
  Object.entries(view.panes).forEach(([key, pane]) => { pane.hidden = key !== tab.id; });

  if (!view.mounts[tab.id]) {
    const ctx = {
      onRoll: (overrides) => doRoll(overrides),
      markStale: (on) => markStale(on !== false),
      currentResult: () => view.last,
      usePrompt: (text) => {
        view.last = { text, negative: "", cn_summary: "", report: null, source: "assemble" };
        setResult(view.last);
        setStatus("来自拼接台 · 点「抽一次」可重新生成");
        prefsSet("lastResult", view.last);
      },
      onWeightsChanged: () => refreshActive(),
      onSettingsChanged: () => {},
    };
    view.mounts[tab.id] = tab.mount(view.panes[tab.id], ctx);
  }
  view.mounts[tab.id].activate();
}

function refreshActive() {
  const m = view.mounts[view.tab];
  if (m && m.refresh) m.refresh();
}

/* ── 抽取 ─────────────────────────────────────────────────────────── */
function buildRollBody(overrides) {
  const configured = Number(getSetting("seed", -1));
  const body = {
    nsfw_level: String(getSetting("nsfw_level", "sfw")),
    seed: configured >= 0 ? configured : Math.floor(Math.random() * SEED_MAX),
    tag_cap: getSetting("tag_cap", "自动"),
    base_prob: Number(getSetting("base_prob", 0.6)),
    quality_profile: getSetting("quality_profile", "NoobAI 标准"),
    disabled_sections: getSetting("disabled_sections", ""),
    lock_fields: getSetting("lock_fields", ""),
    force_role: getSetting("force_role", ""),
    weights_json: JSON.stringify(weightsJson()),
    extra_body: getSetting("extra_body", ""),
    selected_roles: getSetting("selected_roles", ""),
    outfit_style: getSetting("outfit_style", "随机"),
    appearance_follow: !!getSetting("appearance_follow", true),
    role_pick: !!getSetting("role_pick", false),
    role_works: getSetting("role_works", ""),
    scene_pick: !!getSetting("scene_pick", false),
    pick_pool_mode: getSetting("pick_pool_mode", ""),
    pick_pool_ids: getSetting("pick_pool_ids", ""),
    appearance_mode: getSetting("appearance_mode", "完整核心"),
    negative_profile: getSetting("negative_profile", "自动（按档位）"),
    negative_extra: getSetting("negative_extra", ""),
    rating_tag: !!getSetting("rating_tag", true),
    outfit_prob: Math.min(100, Math.max(0, Number(getSetting("outfit_prob", 60)) || 0)),
    avoid_repeat: !!getSetting("avoid_repeat", false),
    active_outfit: activeOutfit(),
    overrides: (cache.state && cache.state.overrides) || {},
  };
  return Object.assign(body, overrides || {});
}

async function doRoll(overrides) {
  if (view.busy) return;
  view.busy = true;
  setStatus("抽取中…");
  try {
    const res = await postJSON("/roll", buildRollBody(overrides));
    view.last = res;
    setResult(res);
    markStale(false);
    const report = res.report || {};
    setStatus(`抽好了 · seed ${report.seed}（点「固定 seed」可复现）`);
    prefsSet("lastResult", slim(res));
  } catch (err) {
    setStatus("抽取失败：" + err.message, true);
    toast("抽取失败：" + err.message, true);
  } finally {
    view.busy = false;
  }
}

/* 只保留渲染需要的字段，避免把整包 picked/tags 写进 state */
function slim(res) {
  return {
    text: res.text || "",
    negative: res.negative || "",
    cn_summary: res.cn_summary || "",
    report: res.report || null,
    source: "roll",
  };
}

function adoptSeed() {
  if (!view.last || !view.last.report) {
    toast("先点「抽一次」", true);
    return;
  }
  const seed = view.last.report.seed;
  if (seed == null) return;
  setSetting("seed", seed);
  if (seedInput) seedInput.value = String(seed);
  flushSettings();
  setStatus(`已固定 seed ${seed} · 下次「抽一次」可复现`);
  toast("已固定这条 seed");
}
