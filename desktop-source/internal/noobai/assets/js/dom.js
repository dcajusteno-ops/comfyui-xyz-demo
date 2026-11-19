/* NoobAI 抽取 · DOM 与通用控件
   所有 UI 原语集中在这里，页签模块只描述结构，不重复造按钮/搜索框/卡片。 */
import { icon } from "./icons.js";

export function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

export function frag(children) {
  const box = document.createDocumentFragment();
  (children || []).forEach((c) => c && box.appendChild(c));
  return box;
}

export function iconSpan(name) {
  const span = h("span", "nl-ico");
  span.innerHTML = icon(name);
  return span;
}

/* 图标按钮：图标 + 可选文字 */
export function btn(label, opts = {}) {
  const b = h("button", "nl-btn" + (opts.size === "sm" ? " sm" : "") +
    (opts.variant ? " " + opts.variant : "") + (opts.on && opts.pressed ? " on" : ""));
  b.type = "button";
  if (opts.icon) b.appendChild(iconSpan(opts.icon));
  if (label) b.appendChild(h("span", "", label));
  if (opts.title) b.title = opts.title;
  if (opts.pressed != null) b.setAttribute("aria-pressed", String(!!opts.pressed));
  b.disabled = !!opts.disabled;
  if (opts.onClick) b.addEventListener("click", opts.onClick);
  return b;
}

export function iconBtn(name, title, onClick, cls) {
  const b = h("button", "nl-iconbtn" + (cls ? " " + cls : ""));
  b.type = "button";
  b.title = title || "";
  b.setAttribute("aria-label", title || name);
  b.appendChild(iconSpan(name));
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

export function selectEl(options, value, onChange, opts = {}) {
  const sel = h("select", "nl-select" + (opts.cls ? " " + opts.cls : ""));
  (options || []).forEach((item) => {
    const value0 = typeof item === "string" ? item : item.value;
    const label = typeof item === "string" ? item : item.label;
    const o = h("option", "", label);
    o.value = value0;
    sel.appendChild(o);
  });
  sel.value = value == null ? "" : String(value);
  if (opts.title) sel.title = opts.title;
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

export function checkbox(label, checked, onChange) {
  const wrap = h("label", "nl-check");
  const input = h("input");
  input.type = "checkbox";
  input.checked = !!checked;
  input.addEventListener("change", () => onChange(input.checked));
  wrap.appendChild(input);
  wrap.appendChild(h("span", "", label));
  return wrap;
}

/* 搜索框：输入节点在整页签生命周期内保持不动，只把值回调出去。
   composition 事件用于避免中文输入法在拼音阶段触发过滤。 */
export function searchInput(value, placeholder, onInput) {
  const wrap = h("label", "nl-search");
  wrap.appendChild(iconSpan("search"));
  const input = h("input");
  input.type = "search";
  input.placeholder = placeholder || "搜索";
  input.value = value || "";
  input.autocomplete = "off";
  input.spellcheck = false;
  let composing = false;
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(() => onInput(input.value.trim()), 140);
  };
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; fire(); });
  input.addEventListener("input", () => { if (!composing) fire(); });
  wrap.appendChild(input);
  return { el: wrap, input };
}

/* 二级分段控件（角色页无，场景/细节页用） */
export function segmented(items, value, onChange) {
  const box = h("div", "nl-seg");
  box.setAttribute("role", "tablist");
  const buttons = [];
  (items || []).forEach((item) => {
    const b = h("button", "nl-seg-btn");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.dataset.id = item.id;
    b.appendChild(h("span", "", item.label));
    if (item.count != null) b.appendChild(h("span", "nl-seg-count", String(item.count)));
    b.addEventListener("click", () => onChange(item.id));
    buttons.push(b);
    box.appendChild(b);
  });
  const set = (next) => {
    buttons.forEach((b) => {
      const on = b.dataset.id === next;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
  };
  set(value);
  box.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const list = items.map((i) => i.id);
    const cur = list.indexOf(value);
    const next = e.key === "ArrowRight"
      ? (cur + 1) % list.length
      : (cur - 1 + list.length) % list.length;
    e.preventDefault();
    onChange(list[next]);
  });
  return { el: box, set };
}

export function pager(shown, total, onMore) {
  const wrap = h("div", "nl-more");
  const note = h("span", "nl-note", `已显示 ${shown} / ${total}`);
  const more = btn("加载更多", { size: "sm", onClick: onMore });
  wrap.appendChild(note);
  wrap.appendChild(more);
  return {
    el: wrap,
    update(nextShown, nextTotal) {
      note.textContent = `已显示 ${nextShown} / ${nextTotal}`;
      more.hidden = nextShown >= nextTotal;
    },
  };
}

export function empty(text, hint) {
  const box = h("div", "nl-empty");
  box.appendChild(h("div", "", text));
  if (hint) box.appendChild(h("div", "nl-empty-hint", hint));
  return box;
}

export function levelBadge(level) {
  const n = Number(level) || 0;
  const labels = ["全年龄", "暗示", "成人", "硬核", "极限"];
  const b = h("span", "nl-badge nl-lv-" + Math.min(n, 4), labels[Math.min(n, 4)] || "不限");
  b.title = `内容档位 ${n}`;
  return b;
}

export function subhead(text, right) {
  const row = h("div", "nl-subhead");
  row.appendChild(h("span", "", text));
  if (right) {
    row.appendChild(h("span", "nl-grow"));
    row.appendChild(right);
  }
  return row;
}

/* 卡片容器：用 div + role=button，而不是 <button>。
   卡片里通常还有收藏 / 套用等独立按钮，真实 button 会形成非法嵌套并吞掉点击。 */
export function card(opts) {
  const el = h("div", "nl-card" + (opts.on ? " on" : "") + (opts.cls ? " " + opts.cls : ""));
  if (opts.onClick) {
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    if (opts.pressed != null) el.setAttribute("aria-pressed", String(!!opts.pressed));
    el.addEventListener("click", opts.onClick);
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target !== el) return;
      e.preventDefault();
      opts.onClick(e);
    });
  }
  if (opts.disabled) el.setAttribute("aria-disabled", "true");
  if (opts.title) el.title = opts.title;
  return el;
}

export function toast(msg, isError) {
  let host = document.getElementById("nlToastHost");
  if (!host) {
    host = h("div", "nl-toast-host");
    host.id = "nlToastHost";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", isError ? "assertive" : "polite");
    document.body.appendChild(host);
  }
  host.setAttribute("aria-live", isError ? "assertive" : "polite");
  const el = h("div", "nl-toast" + (isError ? " err" : ""), msg);
  el.setAttribute("role", isError ? "alert" : "status");
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 200);
  }, 2600);
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function fmtWeight(v) {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(1)));
}

export async function copyText(text, okMsg, errMsg) {
  try {
    await navigator.clipboard.writeText(text || "");
    toast(okMsg || "已复制到剪贴板");
    return true;
  } catch (e) {
    toast(errMsg || "复制失败，请手动选择文本", true);
    return false;
  }
}
