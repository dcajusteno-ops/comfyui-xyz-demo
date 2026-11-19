/* 浮层管理：抽屉 / 灯箱 / 生图设置共用一套 Esc 与焦点陷阱。
   页面本身（工作区里的 NoobAI）不会因为 Esc 关闭，只有这里的浮层会。 */
import { h } from "./dom.js";

const stack = [];
let bound = false;

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function onKeyDown(event) {
  if (!stack.length) return;
  const top = stack[stack.length - 1];
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeOverlay(top);
    return;
  }
  if (event.key !== "Tab") return;
  const items = Array.from(top.panel.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function openOverlay(opts) {
  if (!bound) {
    document.addEventListener("keydown", onKeyDown, true);
    bound = true;
  }
  const mask = h("div", "nl-ovl-mask" + (opts.maskCls ? " " + opts.maskCls : ""));
  const panel = h("div", "nl-ovl" + (opts.cls ? " " + opts.cls : ""));
  panel.tabIndex = -1;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  if (opts.label) panel.setAttribute("aria-label", opts.label);
  mask.appendChild(panel);

  const entry = { mask, panel, onClose: opts.onClose, prevFocus: document.activeElement };
  mask.addEventListener("mousedown", (e) => {
    if (e.target === mask && opts.dismissible !== false) closeOverlay(entry);
  });
  document.body.appendChild(mask);
  stack.push(entry);
  document.body.classList.add("nl-has-overlay");

  const target = opts.initialFocus ? opts.initialFocus() : panel;
  (target || panel).focus({ preventScroll: true });
  return { panel, close: () => closeOverlay(entry) };
}

export function closeOverlay(entry) {
  const index = stack.indexOf(entry);
  if (index < 0) return;
  stack.splice(index, 1);
  entry.mask.remove();
  if (!stack.length) document.body.classList.remove("nl-has-overlay");
  if (entry.onClose) entry.onClose();
  try {
    if (entry.prevFocus && entry.prevFocus.focus) entry.prevFocus.focus({ preventScroll: true });
  } catch (e) { /* 焦点已不在文档里 */ }
}

export function closeTop() {
  if (!stack.length) return false;
  closeOverlay(stack[stack.length - 1]);
  return true;
}

export function topOverlay() {
  return stack[stack.length - 1] || null;
}

export function overlayCount() {
  return stack.length;
}
