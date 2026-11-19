/* NoobAI 抽取 · 右栏「结果台」
   只放输出：prompt → meta → 自检 → 负向词 → 中文摘要 → 生成结果图。
   输入类设置一律搬到左侧页签，避免结果被设置挤到折叠线以下。 */
import { h, iconSpan, btn, iconBtn, copyText, toast } from "./dom.js";
import { LEVELS, LEVEL_LABELS, prefsGet, prefsSet } from "./store.js";

const TOKEN_WARN = 75;

let refs = null;

/* 负向词模式：lastAutoNegative 是最近一次抽取 / 生图得到的自动负向词；
   manualNegative（持久化在 state.ui）非空表示用户固定了自己的负向词。 */
let lastAutoNegative = "";

function manualNegative() {
  return (prefsGet("manualNegative", "") || "").trim();
}

function updateNegMode() {
  if (!refs) return;
  const manual = manualNegative();
  const value = refs.negText.value.trim();
  refs.negMeta.textContent = value
    ? `${manual ? "手动" : "自动"} · ${value.length} 字符`
    : "无";
  refs.negReset.hidden = !manual;
  refs.negNote.textContent = manual
    ? "手动负向词整条替换自动负向词，固定用于一键生图 / 连抽"
    : "";
}

function setNegText(text) {
  if (!refs) return;
  refs.negText.value = text || "";
  updateNegMode();
}

function commitNegInput() {
  if (!refs) return;
  const value = refs.negText.value.trim();
  prefsSet("manualNegative", !value || value === lastAutoNegative ? "" : value);
  updateNegMode();
}

function resetNegative() {
  prefsSet("manualNegative", "");
  setNegText(lastAutoNegative);
  toast("已恢复自动负向词");
}

/* 供生图模块读取：输入框里与自动词不同（且非空）的内容才算手动覆盖。
   直接读输入框而不是 prefs，避免 600ms 防抖期间点「一键生图」丢词。 */
export function manualNegativeNow() {
  if (!refs) return manualNegative();
  const value = refs.negText.value.trim();
  if (!value || value === lastAutoNegative) return "";
  return value;
}

export function mountResultPanel(el, handlers) {
  el.replaceChildren();
  const collapsed = Boolean(prefsGet("rightCollapsed", false));
  el.classList.toggle("is-collapsed", collapsed);
  if (el.parentElement) el.parentElement.classList.toggle("right-collapsed", collapsed);

  const rail = h("div", "nl-rail");
  const railBtn = h("button", "nl-rail-btn");
  railBtn.type = "button";
  railBtn.title = "展开结果台";
  railBtn.setAttribute("aria-label", "展开结果台");
  railBtn.appendChild(iconSpan("panel"));
  railBtn.appendChild(h("span", "nl-rail-label", "结果"));
  rail.appendChild(railBtn);
  el.appendChild(rail);

  const body = h("div", "nl-right-body");
  el.appendChild(body);

  const head = h("div", "nl-right-head");
  const title = h("div", "nl-right-title");
  title.appendChild(h("span", "nl-dot"));
  title.appendChild(h("span", "", "结果"));
  head.appendChild(title);
  const headActions = h("div", "nl-right-acts");
  const adoptBtn = btn("固定 seed", { size: "sm", onClick: () => handlers.onAdopt() });
  adoptBtn.disabled = true;
  const copyNegBtn = iconBtn("copy", "复制负向词", () => handlers.onCopyNeg(), "nl-copyneg");
  copyNegBtn.disabled = true;
  const copyBtn = btn("复制", { size: "sm", icon: "copy", onClick: () => handlers.onCopy() });
  copyBtn.disabled = true;
  const collapseBtn = iconBtn("panel", "收起结果台", () => toggleCollapsed(true), "nl-collapse");
  headActions.appendChild(adoptBtn);
  headActions.appendChild(copyBtn);
  headActions.appendChild(collapseBtn);
  head.appendChild(headActions);
  body.appendChild(head);

  const stale = h("div", "nl-stale");
  stale.hidden = true;
  const staleText = h("span", "", "设置已变，当前结果可能过期");
  const staleBtn = btn("重新抽取", { size: "sm", variant: "pri", onClick: () => handlers.onRoll() });
  stale.appendChild(staleText);
  stale.appendChild(staleBtn);
  body.appendChild(stale);

  const status = h("div", "nl-status", "点「抽一次」生成一条提示词");
  status.setAttribute("aria-live", "polite");
  body.appendChild(status);

  /* prompt */
  const promptBox = h("div", "nl-prompt");
  const promptHead = h("div", "nl-prompt-hd");
  promptHead.appendChild(h("span", "", "Prompt"));
  const sourceTag = h("span", "nl-src", "");
  sourceTag.hidden = true;
  promptHead.appendChild(sourceTag);
  promptBox.appendChild(promptHead);
  const out = h("pre", "nl-out", "（还没有结果）");
  out.tabIndex = 0;
  promptBox.appendChild(out);
  body.appendChild(promptBox);

  const meta = h("div", "nl-meta");
  body.appendChild(meta);

  /* 自检 */
  const checksBox = h("details", "nl-fold");
  const checksSum = h("summary", "nl-fold-hd");
  checksSum.appendChild(h("span", "", "自检"));
  const checksCount = h("span", "nl-fold-meta", "—");
  checksSum.appendChild(checksCount);
  checksBox.appendChild(checksSum);
  const checks = h("div", "nl-checks");
  checksBox.appendChild(checks);
  body.appendChild(checksBox);

  /* 负向词（可手动输入：留空走自动；输入后整条替换并固定用于生图） */
  const negBox = h("details", "nl-fold");
  const negSum = h("summary", "nl-fold-hd");
  negSum.appendChild(h("span", "", "负向提示词"));
  const negMeta = h("span", "nl-fold-meta", "—");
  negSum.appendChild(negMeta);
  copyNegBtn.addEventListener("click", (event) => event.stopPropagation());
  negSum.appendChild(copyNegBtn);
  negBox.appendChild(negSum);
  const negText = h("textarea", "nl-out neg nl-neg-text");
  negText.rows = 3;
  negText.spellcheck = false;
  negText.placeholder = "留空 = 每次生成用抽取的负向词；输入后固定用于生图";
  negBox.appendChild(negText);
  const negFoot = h("div", "nl-neg-foot");
  const negNote = h("span", "nl-note", "");
  const negReset = btn("恢复自动", { size: "sm", onClick: resetNegative });
  negReset.hidden = true;
  negFoot.append(negNote, h("span", "nl-grow"), negReset);
  negBox.appendChild(negFoot);
  body.appendChild(negBox);

  /* 中文摘要 */
  const cnBox = h("details", "nl-fold");
  const cnSum = h("summary", "nl-fold-hd");
  cnSum.appendChild(h("span", "", "中文摘要"));
  const cnMeta = h("span", "nl-fold-meta", "");
  cnSum.appendChild(cnMeta);
  cnBox.appendChild(cnSum);
  const cn = h("div", "nl-cn", "抽取后会显示中文说明。");
  cnBox.appendChild(cn);
  body.appendChild(cnBox);

  /* 生成台：按钮 + 进度 + 结果图固定在右栏底部，不随提示词滚动 */
  const genDock = h("section", "nl-gendock");
  el.appendChild(genDock);

  refs = {
    el, body, out, meta, checks, checksBox, checksCount, negText, negMeta, negNote, negReset, cn, cnMeta,
    status, adoptBtn, copyBtn, copyNegBtn, stale, genDock, sourceTag,
  };

  railBtn.addEventListener("click", () => toggleCollapsed(false));

  let negTimer = null;
  negText.addEventListener("input", () => {
    clearTimeout(negTimer);
    negTimer = setTimeout(commitNegInput, 600);
  });
  negText.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      clearTimeout(negTimer);
      commitNegInput();
    }
  });

  return {
    refs,
    setResult,
    setStatus,
    markStale,
    setGenPrompt,
    genDockEl: genDock,
  };
}

function toggleCollapsed(collapsed) {
  if (!refs) return;
  refs.el.classList.toggle("is-collapsed", collapsed);
  if (refs.el.parentElement) refs.el.parentElement.classList.toggle("right-collapsed", collapsed);
  prefsSet("rightCollapsed", collapsed);
  if (!collapsed) {
    refs.out.focus({ preventScroll: true });
  }
}

export function setStatus(text, isError) {
  if (!refs) return;
  refs.status.textContent = text || "";
  refs.status.classList.toggle("err", Boolean(isError));
}

export function markStale(on) {
  if (!refs) return;
  refs.stale.hidden = !on;
}

/* 生图作业的当前提示词：连抽时每换一张都会调用一次，让右栏跟着更新。
   和「抽一次」的结果分开渲染，避免把 report 自检信息套到生图词上。 */
export function setGenPrompt(job) {
  if (!refs || !job || !job.prompt) return;
  markStale(false);
  refs.out.classList.remove("empty");
  refs.out.textContent = job.prompt;
  if (!manualNegative()) {
    lastAutoNegative = job.negative || "";
    setNegText(lastAutoNegative);
  } else {
    updateNegMode();
  }
  refs.copyBtn.disabled = false;
  refs.copyNegBtn.disabled = !(manualNegative() || job.negative);

  const seed = Number(job.seed);
  refs.adoptBtn.disabled = !(seed >= 0);
  const index = job.index || 1;
  const total = job.total || 1;
  refs.meta.replaceChildren(
    pill("来源", job.status === "running" ? "生成中" : "生图"),
    pill("第", `${index}/${total} 张`),
    pill("seed", String(seed)),
  );
  refs.checksBox.hidden = true;
  refs.cn.textContent = job.status === "running"
    ? "连抽进行中：提示词会随每一张更新。"
    : "这是本次生图实际使用的提示词。";
  refs.cnMeta.textContent = "";
  refs.sourceTag.hidden = false;
  refs.sourceTag.textContent = job.status === "running"
    ? `生成中 ${index}/${total}`
    : `第 ${index}/${total} 张`;
}

export function setResult(result) {
  if (!refs) return;
  markStale(false);
  refs.sourceTag.hidden = true;
  if (!result) {
    refs.out.textContent = "（还没有结果）";
    refs.out.classList.add("empty");
    setNegText(manualNegative());
    refs.meta.replaceChildren();
    refs.checks.replaceChildren();
    refs.checksCount.textContent = "—";
    refs.cn.textContent = "抽取后会显示中文说明。";
    refs.cnMeta.textContent = "";
    refs.adoptBtn.disabled = true;
    refs.copyBtn.disabled = true;
    refs.copyNegBtn.disabled = !manualNegative();
    return;
  }

  refs.out.classList.remove("empty");
  refs.out.textContent = result.text || "（空）";
  refs.copyBtn.disabled = !result.text;
  lastAutoNegative = result.negative || "";
  setNegText(manualNegative() || lastAutoNegative);
  refs.copyNegBtn.disabled = !(manualNegative() || result.negative);
  refs.adoptBtn.disabled = !(result.report && result.report.seed != null);

  const report = result.report;
  if (!report) {
    refs.meta.replaceChildren(pill("来源", result.source === "assemble" ? "拼接台" : "手动"));
    refs.checksBox.hidden = true;
    refs.cn.textContent = result.cn_summary || "（无）";
    refs.cnMeta.textContent = "";
    return;
  }
  refs.checksBox.hidden = false;

  const tok = Number(report.tokens_est) || 0;
  refs.meta.replaceChildren(
    pill("档位", LEVEL_LABELS[report.target_level] || report.target_level || "—"),
    pill("落档", LEVEL_LABELS[LEVELS[report.real_level]] || String(report.real_level)),
    pill("标签", String(report.n == null ? "—" : report.n)),
    pill("token≈", String(tok), tok > TOKEN_WARN),
    pill("分块", String(report.chunks_n || 1)),
    report.core_used ? pill("核心", "已注入", false, "ok") : null,
    pill("seed", String(report.seed)),
  );

  const list = report.checks || [];
  const passed = list.filter((c) => c.ok).length;
  refs.checksCount.textContent = `${passed}/${list.length} 通过`;
  refs.checks.replaceChildren();
  list.forEach((c) => {
    const row = h("div", "nl-check-row " + (c.ok ? "ok" : "no"));
    row.appendChild(iconSpan(c.ok ? "check" : "warn"));
    row.appendChild(h("span", "", c.msg || ""));
    refs.checks.appendChild(row);
  });
  refs.checksBox.open = passed !== list.length;

  updateNegMode();
  refs.cn.textContent = result.cn_summary || "（无）";
  refs.cnMeta.textContent = "";
}

function pill(label, value, warn, tone) {
  const el = h("span", "nl-pill" + (warn ? " warn" : "") + (tone === "ok" ? " ok" : ""));
  el.appendChild(h("span", "nl-pill-k", label));
  el.appendChild(h("span", "nl-pill-v", value));
  return el;
}

export function copyResult(result) {
  if (!result || !result.text) {
    toast("还没有可复制的内容", true);
    return;
  }
  copyText(result.text, "已复制 Prompt");
}

export function copyNegative(_result) {
  if (!refs) return;
  const text = refs.negText.value.trim();
  if (!text) {
    toast("还没有可复制的负向词", true);
    return;
  }
  copyText(text, "已复制负向词");
}
