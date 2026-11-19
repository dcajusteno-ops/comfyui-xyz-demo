/* 生图：工具条 + 作业轮询 + 结果网格 + 灯箱 + 设置弹层（含 LoRA）。
   与之前基本等价，只是把网络、弹层、样式基座换成统一实现。 */
import {
  h, btn, iconBtn, iconSpan, checkbox, searchInput, selectEl, clamp, toast, copyText,
} from "./dom.js";
import { getJSON, postJSON } from "./api.js";
import { flushSettings, prefsGet, prefsSet } from "./store.js";
import { openOverlay } from "./overlay.js";
import { manualNegativeNow } from "./result.js";

const GEN_DEFAULTS = {
  checkpoint: "",
  width: 832,
  height: 1216,
  steps: 28,
  cfg: 5.5,
  sampler: "euler_ancestral",
  scheduler: "normal",
  seed: -1,
  hires_enabled: false,
  hires_scale: 1.5,
  hires_steps: 12,
  hires_denoise: 0.5,
  hires_sampler: "",
  negative_extra: "",
  repeat: 1,
  loras: [],
};
const GEN_PRESETS = [
  ["竖版 2:3", 832, 1216],
  ["方图", 1024, 1024],
  ["横版 3:2", 1216, 832],
  ["高清竖版", 1024, 1536],
];
const MAX_LORAS = 8;

export const GEN = {
  settings: null,
  options: null,
  optionsError: "",
  job: null,
  timer: null,
  draft: null,
  refs: null,
  loraMeta: null,
  loraMetaError: "",
  loraMetaIndex: null,
  loraPromise: null,
  pickerOpen: false,
  lastPromptKey: "",
};

function genSet() {
  if (!GEN.settings) GEN.settings = cloneGenSettings(null);
  return GEN.settings;
}

function cloneGenSettings(src) {
  const base = Object.assign({}, GEN_DEFAULTS, src || {});
  base.loras = ((src && src.loras) || []).map((lora) => Object.assign({}, lora));
  return base;
}

export async function ensureGenData(force) {
  const tasks = [];
  if (force || !GEN.settings) {
    tasks.push(getJSON("/gen/settings")
      .then((res) => { if (res && res.settings) GEN.settings = res.settings; })
      .catch(() => { /* 用本地默认值 */ }));
  }
  if (force || !GEN.options) {
    tasks.push(getJSON("/gen/options" + (force ? "?refresh=1" : ""))
      .then((res) => {
        GEN.options = res || null;
        GEN.optionsError = res && res.error ? res.error : "";
        if (res && res.settings && !GEN.settings) GEN.settings = res.settings;
      })
      .catch((err) => {
        GEN.options = { ok: false, comfy: false, checkpoints: [], samplers: [], schedulers: [], loras: [] };
        GEN.optionsError = err.message;
      }));
  }
  await Promise.all(tasks);
  try {
    const res = await getJSON("/gen/job");
    if (res && res.job) GEN.job = res.job;
  } catch (e) { /* 保持上次状态 */ }
}

/* ── 生成台（右栏底部） ───────────────────────────────────────────── */
export function mountGenBar(dock, opts) {
  dock.replaceChildren();

  const head = h("div", "nl-gendock-hd");
  const title = h("div", "nl-gendock-title");
  title.appendChild(h("span", "nl-dot"));
  title.appendChild(h("span", "", "生成"));
  head.appendChild(title);
  const count = h("span", "nl-gendock-count", "0 张");
  count.title = "生成结果张数";
  head.appendChild(count);
  head.appendChild(h("span", "nl-grow"));
  const settingsBtn = iconBtn("gear", "生图设置（模型 / 尺寸 / LoRA）", openGenSettings);
  const imagesBtn = iconBtn("image", "打开图片目录", openImageManager);
  head.append(settingsBtn, imagesBtn);

  const acts = h("div", "nl-gendock-acts");
  const one = btn("一键生图", {
    variant: "pri",
    icon: "spark",
    title: "用右栏当前提示词生成一张",
    onClick: () => startGeneration(1),
  });
  const repeatLabel = h("span", "", `连抽 ${genSet().repeat} 次`);
  const repeat = btn("", {
    icon: "layers",
    title: "按「生图设置」里的连抽次数连续生成",
    onClick: () => startGeneration(genSet().repeat),
  });
  repeat.appendChild(repeatLabel);
  const stop = btn("停止", { icon: "stop", variant: "danger", disabled: true, onClick: stopGeneration });
  acts.append(one, repeat, stop);

  const prog = h("div", "nl-genprog");
  const progTrack = h("div", "nl-genprog-track");
  const progFill = h("i", "nl-genprog-fill");
  progTrack.appendChild(progFill);
  const progMeta = h("div", "nl-genprog-meta");
  const progLabel = h("span", "nl-genprog-label", "");
  const progPct = h("span", "nl-genprog-pct", "");
  progMeta.append(progLabel, progPct);
  prog.append(progTrack, progMeta);
  prog.hidden = true;

  const stat = h("div", "nl-genstat", "正在读取 ComfyUI…");
  const results = h("div", "nl-gendock-results");

  dock.append(head, acts, prog, stat, results);

  GEN.refs = {
    bar: dock,
    one,
    repeat,
    repeatLabel,
    stop,
    count,
    stat,
    prog,
    progFill,
    progLabel,
    progPct,
    results,
    onJobPrompt: opts && opts.onJobPrompt,
  };
  updateGenBar();
  renderResults();
  syncJobPrompt(GEN.job);
}

function updateGenBar() {
  if (!GEN.refs) return;
  const settings = genSet();
  const job = GEN.job || { status: "idle", images: [], total: 0, done: 0 };
  const running = job.status === "running";
  const images = job.images || [];

  GEN.refs.one.disabled = running;
  GEN.refs.repeat.disabled = running;
  GEN.refs.stop.disabled = !running;
  GEN.refs.repeatLabel.textContent = `连抽 ${settings.repeat} 次`;
  GEN.refs.count.textContent = `${images.length} 张`;
  GEN.refs.bar.dataset.state = job.status;

  const total = job.total || settings.repeat || 1;
  const value = Number(job.progress_value) || 0;
  const max = Number(job.progress_total) || 0;
  const percent = max > 0 ? clamp(Math.round((value * 100) / max), 0, 100) : 0;

  GEN.refs.prog.hidden = !running;
  if (running) {
    const index = job.index || Math.min((job.done || 0) + 1, total);
    GEN.refs.progFill.style.width = percent + "%";
    GEN.refs.progLabel.textContent = max > 0
      ? `第 ${index}/${total} 张 · ${value}/${max} 步`
      : `第 ${index}/${total} 张 · 等待采样`;
    GEN.refs.progPct.textContent = max > 0 ? percent + "%" : "";
    GEN.refs.stat.textContent = job.message || "生成中";
    return;
  }

  const model = (settings.checkpoint || "自动选择模型").replace(/\.safetensors$/i, "");
  const extras = [];
  if (settings.hires_enabled) extras.push("高清修复");
  if (settings.loras && settings.loras.length) extras.push(`LoRA ${settings.loras.length}`);
  if (manualNegativeNow()) extras.push("手动负向");
  GEN.refs.stat.textContent = [model, `${settings.width}×${settings.height}`,
    `${settings.steps}步 CFG ${settings.cfg}`].concat(extras).join(" · ");
}

/* 连抽时每换一张都把当前提示词推到右栏；同一张只推一次，避免覆盖用户手动抽的词。 */
function syncJobPrompt(job) {
  if (!job || !job.prompt || !GEN.refs || !GEN.refs.onJobPrompt) return;
  const key = `${job.id || ""}:${job.index || 0}:${job.status === "running" ? "run" : job.status}`;
  if (GEN.lastPromptKey === key) return;
  GEN.lastPromptKey = key;
  GEN.refs.onJobPrompt(job);
}

/* ── 作业轮询 ─────────────────────────────────────────────────────── */
export function startJobPolling() {
  stopJobPolling();
  GEN.timer = setInterval(refreshJob, 800);
}

export function stopJobPolling() {
  if (GEN.timer) {
    clearInterval(GEN.timer);
    GEN.timer = null;
  }
}

async function refreshJob() {
  try {
    const res = await getJSON("/gen/job");
    if (!res || !res.job) return;
    const previous = GEN.job ? GEN.job.status : "";
    GEN.job = res.job;
    syncJobPrompt(GEN.job);
    updateGenBar();
    renderResults();
    if (res.job.status !== "running") {
      stopJobPolling();
      if (previous === "running") {
        if (res.job.status === "done") toast(`生成完成，共 ${(res.job.images || []).length} 张`);
        else if (res.job.status === "stopped") toast("已停止生成");
        else if (res.job.status === "error") toast("生成失败：" + (res.job.error || "未知错误"), true);
      }
    }
  } catch (e) { /* 下一轮再试 */ }
}

export function setVisible(visible) {
  if (visible) {
    if (GEN.job && GEN.job.status === "running") startJobPolling();
  } else {
    stopJobPolling();
  }
}

async function startGeneration(repeat) {
  if (GEN.job && GEN.job.status === "running") {
    toast("正在生成，请先停止", true);
    return;
  }
  const count = repeat > 0 ? repeat : genSet().repeat;
  const manualNeg = manualNegativeNow();
  GEN.refs.one.disabled = true;
  GEN.refs.repeat.disabled = true;
  try {
    await flushSettings();
    await saveGenSettings();
    const body = { repeat: count };
    if (manualNeg) body.negative = manualNeg;
    const res = await postJSON("/gen/start", body);
    if (!res.ok) throw new Error(res.error || "启动失败");
    GEN.job = res.job;
    syncJobPrompt(GEN.job);
    try {
      const settingsRes = await getJSON("/gen/settings");
      if (settingsRes && settingsRes.settings) GEN.settings = settingsRes.settings;
    } catch (e) { /* 不阻断生成 */ }
    updateGenBar();
    renderResults();
    startJobPolling();
    if (manualNeg) toast(count > 1 ? `开始连抽 ${count} 次 · 固定负向词` : "开始生成 · 固定负向词");
    else toast(count > 1 ? `开始连抽 ${count} 次` : "开始生成");
  } catch (err) {
    toast("启动失败：" + err.message, true);
    if (GEN.refs) GEN.refs.stat.textContent = "启动失败：" + err.message;
  } finally {
    updateGenBar();
  }
}

async function stopGeneration() {
  if (!GEN.job || GEN.job.status !== "running") return;
  if (GEN.refs) GEN.refs.stop.disabled = true;
  try {
    const res = await postJSON("/gen/interrupt", {});
    if (res && res.job) GEN.job = res.job;
    updateGenBar();
    toast("已请求停止");
  } catch (err) {
    toast("停止失败：" + err.message, true);
    if (GEN.refs) GEN.refs.stop.disabled = false;
  }
}

async function saveGenSettings() {
  const res = await postJSON("/gen/settings", cloneGenSettings(genSet()));
  if (!res || !res.ok) throw new Error((res && res.error) || "保存生图设置失败");
  if (res.settings) GEN.settings = res.settings;
  return res.settings;
}

async function openImageManager() {
  try {
    const res = await postJSON("/gen/open-images", {});
    if (!res.ok) throw new Error(res.error || "无法打开图片管理");
    toast("已打开 NoobAI 图片目录");
  } catch (err) {
    toast("打开失败：" + err.message, true);
  }
}

/* ── 结果网格 ─────────────────────────────────────────────────────── */
function renderResults() {
  if (!GEN.refs || !GEN.refs.results) return;
  const box = GEN.refs.results;
  const job = GEN.job || {};
  const images = job.images || [];
  const running = job.status === "running";
  box.replaceChildren();

  // 最新的一张放最前面；编号仍按生成顺序（#1 最早）。
  if (running) box.appendChild(h("div", "nl-result skeleton"));

  if (!images.length) {
    if (!running) {
      box.appendChild(h("div", "nl-results-empty", "还没有生成结果，点上方「一键生图」开始"));
    }
    return;
  }

  for (let index = images.length - 1; index >= 0; index -= 1) {
    const image = images[index];
    const card = h("button", "nl-result");
    card.type = "button";
    card.title = `#${index + 1} · seed ${image.seed} · 点击查看大图`;
    const img = h("img");
    img.loading = "lazy";
    img.src = image.url;
    img.alt = `生成结果 ${index + 1}`;
    card.appendChild(img);
    card.appendChild(h("span", "nl-result-seed", `#${index + 1} · ${image.seed}`));
    card.addEventListener("click", () => openLightbox(index));
    box.appendChild(card);
  }
}

function openLightbox(start) {
  const items = (GEN.job && GEN.job.images) || [];
  if (!items.length) return;
  let index = clamp(start, 0, items.length - 1);

  const handle = openOverlay({ cls: "nl-lightbox", label: "生成结果预览" });
  const root = handle.panel;
  root.tabIndex = -1;

  const closeBtn = iconBtn("close", "关闭（Esc）", () => handle.close(), "nl-lightbox-close");
  const imageEl = h("img");
  const meta = h("div", "nl-lightbox-meta");
  const bar = h("div", "nl-lightbox-bar");
  const prev = btn("上一张", { onClick: () => step(-1) });
  const next = btn("下一张", { onClick: () => step(1) });
  const counter = h("span", "nl-lightbox-count");
  const copyBtn = btn("复制 Prompt", { onClick: () => copyText(items[index].prompt || "", "Prompt 已复制") });
  const managerBtn = btn("图片管理", { onClick: openImageManager });
  bar.append(prev, next, counter, copyBtn, managerBtn);

  function step(delta) {
    index = (index + delta + items.length) % items.length;
    update();
  }
  function update() {
    const item = items[index];
    imageEl.src = item.url;
    imageEl.alt = `生成结果 ${index + 1}`;
    meta.textContent = `seed ${item.seed} · ${item.filename || ""}`;
    counter.textContent = `${index + 1} / ${items.length}`;
  }
  root.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
  });

  root.append(closeBtn, imageEl, meta, bar);
  update();
  root.focus();
}

/* ── 生图设置 ─────────────────────────────────────────────────────── */
function openGenSettings() {
  if (GEN.draft) return;
  GEN.draft = cloneGenSettings(genSet());

  const handle = openOverlay({
    cls: "nl-genmodal",
    label: "NoobAI 生图设置",
    onClose: () => { GEN.draft = null; GEN.refreshLoras = null; },
  });
  const modal = handle.panel;
  modal.tabIndex = -1;

  const head = h("div", "nl-genmodal-head");
  const title = h("div", "nl-genmodal-title");
  title.appendChild(iconSpan("sliders"));
  title.appendChild(h("span", "", "生图设置"));
  title.appendChild(h("span", "nl-genmodal-sub", "NoobAI 生图管线"));
  head.appendChild(title);
  head.appendChild(h("span", "nl-grow"));
  const refreshBtn = iconBtn("refresh", "刷新 ComfyUI 模型 / 采样器 / LoRA 列表", async () => {
    refreshBtn.disabled = true;
    try {
      await ensureGenData(true);
      await ensureLoraMeta(true);
      rebuild();
      updateGenBar();
      toast("已刷新 ComfyUI 列表");
    } catch (err) {
      toast("刷新失败：" + err.message, true);
    } finally {
      refreshBtn.disabled = false;
    }
  });
  head.appendChild(refreshBtn);
  head.appendChild(iconBtn("close", "关闭（Esc）", () => handle.close()));
  modal.appendChild(head);

  const body = h("div", "nl-genmodal-body");
  modal.appendChild(body);

  const foot = h("div", "nl-genmodal-foot");
  foot.appendChild(h("span", "nl-note", "写入 data/noobai-generation.json"));
  foot.appendChild(h("span", "nl-grow"));
  const save = btn("保存并关闭", { variant: "pri", onClick: () => commit(save) });
  foot.appendChild(btn("取消", { onClick: () => handle.close() }));
  foot.appendChild(save);
  modal.appendChild(foot);

  let refreshLoras = () => {};
  function rebuild() {
    body.replaceChildren();
    refreshLoras = buildSettingsBody(body);
  }
  rebuild();
  modal.focus();

  ensureLoraMeta()
    .then(() => { if (GEN.draft) refreshLoras(); })
    .catch(() => {});

  async function commit(button) {
    if (!GEN.draft) return;
    button.disabled = true;
    GEN.settings = cloneGenSettings(GEN.draft);
    try {
      await saveGenSettings();
      updateGenBar();
      toast("生图设置已保存");
      handle.close();
    } catch (err) {
      toast("保存失败：" + err.message, true);
      button.disabled = false;
    }
  }
}

function buildSettingsBody(body) {
  const draft = GEN.draft;
  const options = GEN.options || {};
  const checkpoints = options.checkpoints || [];
  const samplers = options.samplers || [];
  const schedulers = options.schedulers || [];

  /* 模型与尺寸 */
  const model = genCard("模型与尺寸", "spark");
  const ckpt = fillSelect(h("select", "nl-select"), checkpoints, draft.checkpoint);
  ckpt.addEventListener("change", () => { draft.checkpoint = ckpt.value; });
  model.body.appendChild(genField("Checkpoint", ckpt, {
    wide: true,
    hint: options.comfy ? "" : "ComfyUI 未连接或没有可用模型：" + (GEN.optionsError || "请确认 ComfyUI 已启动"),
  }));

  const sizeRow = h("div", "nl-grow-2");
  const widthInput = numberInput(draft.width, 256, 2048, 8, (v) => { draft.width = v; });
  const heightInput = numberInput(draft.height, 256, 2048, 8, (v) => { draft.height = v; });
  sizeRow.append(genField("宽度", widthInput), genField("高度", heightInput));
  model.body.appendChild(sizeRow);

  const presetRow = h("div", "nl-span nl-gpresets");
  GEN_PRESETS.forEach(([label, width, height]) => {
    const preset = btn(label, {
      size: "sm",
      onClick: () => {
        draft.width = width;
        draft.height = height;
        widthInput.value = String(width);
        heightInput.value = String(height);
      },
    });
    preset.dataset.active = String(draft.width === width && draft.height === height);
    presetRow.appendChild(preset);
  });
  model.body.appendChild(presetRow);
  body.appendChild(model.el);

  /* 采样 */
  const sample = genCard("采样", "sliders");
  const sampleRow = h("div", "nl-grow-2 nl-grow-3");
  sampleRow.append(
    genField("步数", numberInput(draft.steps, 1, 80, 1, (v) => { draft.steps = v; })),
    genField("CFG", numberInput(draft.cfg, 0, 30, 0.1, (v) => { draft.cfg = v; })),
    genField("Seed", numberInput(draft.seed, -1, 2147483000, 1, (v) => { draft.seed = v; }), { hint: "-1 = 每张随机" }),
  );
  sample.body.appendChild(sampleRow);
  const pickerRow = h("div", "nl-grow-2 nl-grow-3");
  pickerRow.append(
    genField("采样器", genSelect(samplers, draft.sampler, (v) => { draft.sampler = v; })),
    genField("调度器", genSelect(schedulers, draft.scheduler, (v) => { draft.scheduler = v; })),
  );
  sample.body.appendChild(pickerRow);
  body.appendChild(sample.el);

  /* 高清修复 */
  const hiresRight = [];
  const hiresSwitch = switchControl(!!draft.hires_enabled, (checked) => {
    draft.hires_enabled = checked;
    hires.el.classList.toggle("is-off", !checked);
  });
  hiresRight.push(hiresSwitch.el);
  const hires = genCard("高清修复", "layers", hiresRight);
  hires.el.classList.toggle("is-off", !draft.hires_enabled);
  const hiresRow = h("div", "nl-grow-2 nl-grow-3");
  hiresRow.append(
    genField("放大倍率", numberInput(draft.hires_scale, 1, 2, 0.05, (v) => { draft.hires_scale = v; })),
    genField("二次步数", numberInput(draft.hires_steps, 1, 80, 1, (v) => { draft.hires_steps = v; })),
    genField("降噪", numberInput(draft.hires_denoise, 0.05, 1, 0.05, (v) => { draft.hires_denoise = v; })),
  );
  hires.body.appendChild(hiresRow);
  const hiresSamplerRow = h("div", "nl-grow-2");
  const hiresSel = genSelect(
    [{ value: "", label: "跟随主采样器" }].concat(samplers.map((s) => ({ value: s, label: s }))),
    draft.hires_sampler || "",
    (v) => { draft.hires_sampler = v; },
  );
  hiresSamplerRow.appendChild(genField("二次采样器", hiresSel));
  hires.body.appendChild(hiresSamplerRow);
  body.appendChild(hires.el);

  /* 输出 */
  const output = genCard("输出", "shuffle");
  const outRow = h("div", "nl-grow-2 nl-grow-3");
  outRow.append(
    genField("连抽次数", numberInput(draft.repeat, 1, 12, 1, (v) => { draft.repeat = v; }), { hint: "1–12" }),
  );
  output.body.appendChild(outRow);
  const negInput = h("input", "nl-input");
  negInput.type = "text";
  negInput.placeholder = "追加到自动负向词末尾，逗号分隔";
  negInput.value = draft.negative_extra || "";
  negInput.addEventListener("change", () => { draft.negative_extra = negInput.value.trim(); });
  output.body.appendChild(genField("负向词追加", negInput, { wide: true }));
  body.appendChild(output.el);

  /* LoRA */
  const meta = h("span", "nl-gmeta", "");
  const addBtn = btn("添加 LoRA", {
    size: "sm",
    icon: "plus",
    onClick: () => openLoraPicker(draft, () => refreshLoras()),
  });
  const lora = genCard("LoRA", "layers", [meta, addBtn]);
  lora.el.classList.add("is-wide");
  const autoAll = checkbox("自动加入触发词", draft.loras.some((item) => item.auto_trigger), (checked) => {
    let filled = 0;
    draft.loras.forEach((item) => {
      item.auto_trigger = checked;
      // 打开总开关时，把还没填过的 LoRA 自带触发词补上，避免"勾了但什么都没加"
      if (checked && !String(item.trigger_words || "").trim()) {
        const words = triggerWordsOf(item.name);
        if (words.length) {
          item.trigger_words = words.join(", ");
          filled += 1;
        }
      }
    });
    if (filled) {
      toast(`已填入 ${filled} 个 LoRA 的自带触发词`);
      refreshLoras();
    }
  });
  const loraToolbar = h("div", "nl-span nl-lora-toolbar");
  loraToolbar.appendChild(autoAll);
  lora.body.appendChild(loraToolbar);
  const loraHost = h("div", "nl-span");
  lora.body.appendChild(loraHost);
  body.appendChild(lora.el);

  function refreshLoras() {
    const count = draft.loras.filter((item) => !item.disabled).length;
    meta.textContent = `已启用 ${count} / ${MAX_LORAS}`;
    loraHost.replaceChildren(renderLoraCards(draft, refreshLoras));
    loraHost.appendChild(renderLoraTriggers(draft, refreshLoras));
  }
  GEN.refreshLoras = refreshLoras;
  refreshLoras();
  return refreshLoras;
}

/* ── LoRA 卡片（对齐 Anima 造型台） ───────────────────────────────── */
function renderLoraCards(draft, refresh) {
  const box = h("div", "nl-lora-grid");
  if (!draft.loras.length) {
    const emptyBox = h("div", "nl-lora-empty");
    emptyBox.appendChild(iconSpan("layers"));
    emptyBox.appendChild(h("div", "", "还没有 LoRA"));
    emptyBox.appendChild(h("div", "nl-note", "点右上角「添加 LoRA」从 LoRA 库挑选，最多 8 个"));
    box.appendChild(emptyBox);
    return box;
  }
  draft.loras.forEach((lora, index) => box.appendChild(loraCard(draft, lora, index, refresh)));
  return box;
}

function loraCard(draft, lora, index, refresh) {
  const info = loraMetaOf(lora.name);
  const card = h("div", "nl-lora-card" + (lora.disabled ? " is-off" : ""));

  const thumb = h("div", "nl-lora-thumb");
  if (info && info.preview) {
    const img = h("img");
    img.loading = "lazy";
    img.src = info.preview;
    img.alt = info.display_name || lora.name;
    img.addEventListener("error", () => {
      img.remove();
      thumb.classList.add("is-empty");
      thumb.appendChild(iconSpan("image"));
    });
    thumb.appendChild(img);
  } else {
    thumb.classList.add("is-empty");
    thumb.appendChild(iconSpan("image"));
  }
  if (isMature(info)) thumb.classList.add("is-mature");
  thumb.appendChild(h("span", "nl-lora-badge", "LoRA"));
  card.appendChild(thumb);

  const bd = h("div", "nl-lora-bd");
  const top = h("div", "nl-lora-top");
  const name = h("span", "nl-lora-name", (info && info.display_name) || baseName(lora.name));
  name.title = lora.name;
  top.appendChild(name);

  const toggle = switchControl(!lora.disabled, (checked) => {
    lora.disabled = !checked;
    card.classList.toggle("is-off", lora.disabled);
    const count = draft.loras.filter((item) => !item.disabled).length;
    const metaEl = card.closest(".nl-gcard")?.querySelector(".nl-gmeta");
    if (metaEl) metaEl.textContent = `已启用 ${count} / ${MAX_LORAS}`;
  });
  toggle.el.classList.add("sm");
  top.appendChild(toggle.el);

  const remove = h("button", "nl-lora-del");
  remove.type = "button";
  remove.title = "移除";
  remove.setAttribute("aria-label", "移除 " + name.textContent);
  remove.appendChild(iconSpan("close"));
  remove.addEventListener("click", () => {
    draft.loras.splice(index, 1);
    refresh();
  });
  top.appendChild(remove);
  bd.appendChild(top);

  const subParts = [];
  if (info && info.base_model) subParts.push(info.base_model);
  if (info && info.folder) subParts.push(info.folder);
  if (!subParts.length) subParts.push(folderOf(lora.name));
  bd.appendChild(h("div", "nl-lora-sub", subParts.join(" · ")));

  const ctl = h("div", "nl-lora-ctl");
  const range = h("input", "nl-lora-range");
  range.type = "range";
  range.min = "-2";
  range.max = "2";
  range.step = "0.05";
  range.value = String(lora.strength);
  const num = h("input", "nl-input nl-lora-num");
  num.type = "number";
  num.min = "-2";
  num.max = "2";
  num.step = "0.05";
  const paint = () => {
    const pct = ((Number(range.value) + 2) / 4) * 100;
    range.style.setProperty("--v", pct + "%");
    num.value = Number(range.value).toFixed(2);
  };
  const apply = (value) => {
    const next = clamp(Number(value) || 0, -2, 2);
    range.value = String(next);
    lora.strength = next;
    // 与造型台一致：一个滑杆同时改 model / clip
    lora.clip_strength = next;
    paint();
  };
  range.addEventListener("input", () => apply(range.value));
  num.addEventListener("change", () => apply(num.value));
  paint();
  ctl.append(range, num);
  bd.appendChild(ctl);
  card.appendChild(bd);

  return card;
}

/* 触发词列表：与造型台一致，失焦保存 */
function renderLoraTriggers(draft, refresh) {
  const box = h("div", "nl-lora-triggers");
  const head = h("div", "nl-lora-triggers-hd");
  head.appendChild(h("span", "", "LoRA 触发词"));
  head.appendChild(h("span", "nl-note", "逗号分隔、失焦保存；勾选「自动加入触发词」后前置到正向词"));
  head.appendChild(h("span", "nl-grow"));

  const pending = draft.loras.filter((item) =>
    !String(item.trigger_words || "").trim() && triggerWordsOf(item.name).length > 0).length;
  if (pending) {
    head.appendChild(btn(`填入自带触发词（${pending}）`, {
      size: "sm",
      onClick: () => {
        let filled = 0;
        draft.loras.forEach((item) => {
          if (String(item.trigger_words || "").trim()) return;
          const words = triggerWordsOf(item.name);
          if (!words.length) return;
          item.trigger_words = words.join(", ");
          filled += 1;
        });
        if (!filled) return;
        toast(`已填入 ${filled} 个 LoRA 的自带触发词`);
        refresh();
      },
    }));
  }
  box.appendChild(head);

  if (!draft.loras.length) {
    box.appendChild(h("div", "nl-note", "添加 LoRA 后可在这里维护触发词。"));
    return box;
  }

  draft.loras.forEach((lora) => {
    const row = h("label", "nl-lora-trigger");
    const info = loraMetaOf(lora.name);
    const words = triggerWordsOf(lora.name);
    const saved = String(lora.trigger_words || "").trim();

    const name = h("span", "nl-lora-trigger-name", (info && info.display_name) || baseName(lora.name));
    name.title = lora.name;
    row.appendChild(name);

    const input = h("input", "nl-input");
    input.type = "text";
    input.placeholder = words.length ? "自带触发词（失焦保存）" : "触发词（逗号分隔）";
    input.value = saved || words.join(", ");
    input.classList.toggle("is-meta", !saved && words.length > 0);

    const tag = h("span", "nl-lora-trigger-tag",
      saved ? "已保存" : (words.length ? `自带 ${words.length}` : ""));
    if (!saved && words.length) tag.title = "来自 LoRA 元数据，失焦后保存为该 LoRA 的触发词";

    input.addEventListener("blur", () => {
      lora.trigger_words = input.value.trim();
      input.classList.toggle("is-meta", !lora.trigger_words && words.length > 0);
      tag.textContent = lora.trigger_words ? "已保存" : (words.length ? `自带 ${words.length}` : "");
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });

    row.appendChild(input);
    row.appendChild(tag);
    box.appendChild(row);
  });
  return box;
}

function triggerWordsOf(name) {
  const info = loraMetaOf(name);
  if (info && Array.isArray(info.trigger_words) && info.trigger_words.length) return info.trigger_words;
  const cache = GEN.loraWordCache || (GEN.loraWordCache = {});
  if (Array.isArray(cache[name])) return cache[name];
  // 元数据里没有：读 safetensors 表头兜底（异步，拿到后会刷新列表）
  ensureLoraWords(name);
  return [];
}

function ensureLoraWords(name) {
  const cache = GEN.loraWordCache || (GEN.loraWordCache = {});
  if (GEN.loraWordPending && GEN.loraWordPending[name]) return GEN.loraWordPending[name];
  GEN.loraWordPending = GEN.loraWordPending || {};
  GEN.loraWordPending[name] = getJSON("/gen/lora-words?name=" + encodeURIComponent(name))
    .then((res) => {
      cache[name] = (res && res.trigger_words) || [];
      return cache[name];
    })
    .catch(() => {
      cache[name] = [];
      return [];
    })
    .finally(() => {
      if (GEN.loraWordPending) delete GEN.loraWordPending[name];
      if (cache[name] && cache[name].length && GEN.refreshLoras && !isEditingTrigger()) {
        GEN.refreshLoras();
      }
    });
  return GEN.loraWordPending[name];
}

function isEditingTrigger() {
  const active = document.activeElement;
  return Boolean(active && active.closest && active.closest(".nl-lora-trigger"));
}

/* ── 添加 LoRA（对齐造型台的选择器） ─────────────────────────────── */
function openLoraPicker(draft, onDone) {
  if (GEN.pickerOpen) return;
  GEN.pickerOpen = true;
  let query = "";
  let baseModel = "";
  let folder = "";
  let shown = 60;
  const selected = new Set();

  const handle = openOverlay({
    cls: "nl-lora-picker",
    label: "添加 LoRA",
    onClose: () => { GEN.pickerOpen = false; },
  });
  const root = handle.panel;
  root.tabIndex = -1;

  const head = h("div", "nl-genmodal-head");
  const title = h("div", "nl-genmodal-title");
  title.appendChild(iconSpan("layers"));
  title.appendChild(h("span", "", "添加 LoRA"));
  title.appendChild(h("span", "nl-genmodal-sub", "NoobAI 生图"));
  head.appendChild(title);
  head.appendChild(h("span", "nl-grow"));
  const counter = h("span", "nl-gmeta", "");
  head.appendChild(counter);
  head.appendChild(iconBtn("close", "关闭（Esc）", () => handle.close()));
  root.appendChild(head);

  const body = h("div", "nl-picker-body");
  root.appendChild(body);

  const bar = h("div", "nl-picker-bar");
  const search = searchInput("", "搜索 LoRA 名称 / 文件夹 / 基础模型", (v) => {
    query = v;
    shown = 60;
    render();
  });
  bar.appendChild(search.el);
  const baseSel = h("select", "nl-select");
  const folderSel = h("select", "nl-select");
  bar.appendChild(baseSel);
  bar.appendChild(folderSel);
  bar.appendChild(checkbox("模糊敏感预览", prefsGet("loraBlur", true), (v) => {
    prefsSet("loraBlur", v);
    render();
  }));
  body.appendChild(bar);

  const stat = h("div", "nl-picker-stat", "");
  body.appendChild(stat);
  const gridWrap = h("div", "nl-picker-scroll");
  body.appendChild(gridWrap);

  const foot = h("div", "nl-genmodal-foot");
  foot.appendChild(h("span", "nl-note", "点击卡片选择，最多 8 个"));
  foot.appendChild(h("span", "nl-grow"));
  const cancel = btn("取消", { onClick: () => handle.close() });
  const apply = btn("添加所选", { variant: "pri", disabled: true, onClick: () => commit() });
  foot.append(cancel, apply);
  root.appendChild(foot);

  let items = [];

  function refreshFilters() {
    const bases = Array.from(new Set(items.map((i) => i.base_model).filter(Boolean))).sort();
    const folders = Array.from(new Set(items.map((i) => i.folder).filter(Boolean))).sort();
    fillSelect(baseSel, bases, baseModel, "全部基础模型");
    fillSelect(folderSel, folders, folder, "全部文件夹");
    baseSel.onchange = () => { baseModel = baseSel.value; shown = 60; render(); };
    folderSel.onchange = () => { folder = folderSel.value; shown = 60; render(); };
  }

  function filtered() {
    const q = query.toLowerCase().trim();
    return items.filter((item) => {
      if (baseModel && item.base_model !== baseModel) return false;
      if (folder && item.folder !== folder) return false;
      if (!q) return true;
      return [item.display_name, item.name, item.base_model, item.folder]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q));
    });
  }

  function render() {
    const list = filtered();
    const existing = new Set(draft.loras.map((l) => l.name));
    counter.textContent = `已选 ${selected.size} · 已启用 ${draft.loras.length}/${MAX_LORAS}`;
    stat.textContent = `共 ${list.length} 个 LoRA`;
    gridWrap.replaceChildren();
    if (!items.length) {
      gridWrap.appendChild(h("div", "nl-empty", GEN.loraMetaError
        ? "LoRA 管理器不可用：" + GEN.loraMetaError
        : "正在读取 LoRA 列表…"));
      return;
    }
    if (!list.length) {
      gridWrap.appendChild(h("div", "nl-empty", "没有匹配的 LoRA", "换个关键词，或把基础模型 / 文件夹切回「全部」"));
      return;
    }
    const page = list.slice(0, shown);
    const grid = h("div", "nl-picker-grid");
    page.forEach((item) => {
      const added = existing.has(item.name);
      const picked = selected.has(item.name);
      const card = h("button", "nl-pick-card" + (added ? " is-added" : "") + (picked ? " is-picked" : ""));
      card.type = "button";
      if (added) { card.disabled = true; card.title = "已在列表里"; }
      const thumb = h("div", "nl-pick-thumb");
      if (item.preview) {
        const img = h("img");
        img.loading = "lazy";
        img.src = item.preview;
        img.alt = item.display_name || item.name;
        img.addEventListener("error", () => { img.remove(); thumb.classList.add("is-empty"); thumb.appendChild(iconSpan("image")); });
        thumb.appendChild(img);
      } else {
        thumb.classList.add("is-empty");
        thumb.appendChild(iconSpan("image"));
      }
      if (isMature(item)) thumb.classList.add("is-mature");
      thumb.appendChild(h("span", "nl-lora-badge", "LoRA"));
      if (added || picked) {
        const check = h("span", "nl-pick-check" + (added ? " is-muted" : ""));
        check.appendChild(iconSpan("check"));
        thumb.appendChild(check);
      }
      card.appendChild(thumb);
      const bd = h("div", "nl-pick-bd");
      bd.appendChild(h("div", "nl-pick-name", item.display_name || baseName(item.name)));
      bd.appendChild(h("div", "nl-pick-sub", [item.base_model, item.folder].filter(Boolean).join(" · ") || "—"));
      card.appendChild(bd);
      if (!added) {
        card.addEventListener("click", () => {
          if (selected.has(item.name)) selected.delete(item.name);
          else {
            if (draft.loras.length + selected.size >= MAX_LORAS) {
              toast(`最多启用 ${MAX_LORAS} 个 LoRA`, true);
              return;
            }
            selected.add(item.name);
          }
          card.classList.toggle("is-picked", selected.has(item.name));
          const check = card.querySelector(".nl-pick-check");
          if (selected.has(item.name)) {
            if (!check) {
              const mark = h("span", "nl-pick-check");
              mark.appendChild(iconSpan("check"));
              thumb.appendChild(mark);
            } else {
              check.replaceChildren(iconSpan("check"));
            }
          } else if (check) {
            check.remove();
          }
          apply.disabled = selected.size === 0;
          counter.textContent = `已选 ${selected.size} · 已启用 ${draft.loras.length}/${MAX_LORAS}`;
        });
      }
      grid.appendChild(card);
    });
    gridWrap.appendChild(grid);
    if (list.length > page.length) {
      const more = btn(`加载更多（剩余 ${list.length - page.length}）`, {
        size: "sm",
        onClick: () => { shown += 60; render(); },
      });
      const wrap = h("div", "nl-more");
      wrap.appendChild(more);
      gridWrap.appendChild(wrap);
    }
  }

  function commit() {
    let added = 0;
    selected.forEach((name) => {
      if (draft.loras.length >= MAX_LORAS) return;
      if (draft.loras.some((l) => l.name === name)) return;
      const info = loraMetaOf(name);
      const words = info && Array.isArray(info.trigger_words) ? info.trigger_words : [];
      draft.loras.push({
        name,
        strength: 1,
        clip_strength: 1,
        trigger_words: words.join(", "),
        auto_trigger: false,
        disabled: false,
      });
      added += 1;
    });
    if (added) {
      toast(`已添加 ${added} 个 LoRA`);
      onDone();
    }
    handle.close();
  }

  render();

  ensureLoraMeta()
    .then(() => {
      items = GEN.loraMeta || [];
      refreshFilters();
      render();
    })
    .catch(() => render());

  return handle;
}

/* ── 设置控件 ─────────────────────────────────────────────────────── */
function genCard(title, iconName, right) {
  const sec = h("section", "nl-gcard");
  const hd = h("div", "nl-gcard-hd");
  hd.appendChild(iconSpan(iconName));
  hd.appendChild(h("h3", "", title));
  if (right && right.length) {
    hd.appendChild(h("span", "nl-grow"));
    right.forEach((node) => hd.appendChild(node));
  }
  sec.appendChild(hd);
  const bd = h("div", "nl-gcard-bd");
  sec.appendChild(bd);
  return { el: sec, body: bd };
}

function genField(label, control, opts = {}) {
  const el = h("label", "nl-gfield" + (opts.wide ? " is-wide" : ""));
  el.appendChild(h("span", "nl-gfield-lab", label));
  el.appendChild(control);
  if (opts.hint) el.appendChild(h("span", "nl-gfield-hint", opts.hint));
  return el;
}

function numberInput(value, min, max, step, onChange) {
  const input = h("input", "nl-input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("change", () => {
    let next = Number(input.value);
    if (!Number.isFinite(next)) next = Number(value);
    next = clamp(next, min, max);
    input.value = String(next);
    onChange(next);
  });
  return input;
}

function genSelect(options, current, onChange) {
  const list = (options || []).map((item) => (typeof item === "string" ? { value: item, label: item } : item));
  return selectEl(list, current, onChange);
}

function switchControl(checked, onChange) {
  const label = h("label", "nl-switch");
  const input = h("input");
  input.type = "checkbox";
  input.checked = !!checked;
  input.addEventListener("change", () => onChange(input.checked));
  label.appendChild(input);
  label.appendChild(h("span", "nl-switch-track"));
  return { el: label, input };
}

function baseName(name) {
  const parts = String(name || "").replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || name;
}

function folderOf(name) {
  const parts = String(name || "").replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join(" / ");
}

function loraMetaMap() {
  const map = new Map();
  (GEN.loraMeta || []).forEach((item) => map.set(item.name, item));
  return map;
}

function isMature(info) {
  return Boolean(info && Number(info.nsfw_level) >= 4 && prefsGet("loraBlur", true));
}

function loraMetaOf(name) {
  if (!GEN.loraMetaIndex) GEN.loraMetaIndex = loraMetaMap();
  return GEN.loraMetaIndex.get(name) || null;
}

async function ensureLoraMeta(force) {
  if (!force && GEN.loraMeta) return GEN.loraMeta;
  if (!force && GEN.loraPromise) return GEN.loraPromise;
  GEN.loraPromise = getJSON("/gen/loras" + (force ? "?refresh=1" : ""))
    .then((res) => {
      GEN.loraMeta = (res && res.items) || [];
      GEN.loraMetaError = (res && res.error) || "";
      GEN.loraMetaIndex = loraMetaMap();
      return GEN.loraMeta;
    })
    .catch((err) => {
      GEN.loraMeta = GEN.loraMeta || [];
      GEN.loraMetaError = err.message;
      return GEN.loraMeta;
    })
    .finally(() => { GEN.loraPromise = null; });
  return GEN.loraPromise;
}

function fillSelect(sel, values, current, emptyLabel) {
  sel.replaceChildren();
  const list = Array.isArray(values) ? values.slice() : [];
  if (emptyLabel) {
    const option = h("option", "", emptyLabel);
    option.value = "";
    sel.appendChild(option);
  }
  if (current && !list.includes(current)) list.unshift(current);
  list.forEach((value) => {
    const option = h("option", "", value);
    option.value = value;
    sel.appendChild(option);
  });
  if (!list.length && !emptyLabel) {
    const option = h("option", "", "（无可用项）");
    option.value = "";
    sel.appendChild(option);
  }
  sel.value = current || "";
  if (!sel.value && !emptyLabel && list.length) sel.value = list[0];
  return sel;
}
