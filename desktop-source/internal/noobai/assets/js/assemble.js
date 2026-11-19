/* 拼装页：把随机正文与手写补充合并，去重 / 互斥 / 限档。
   结果不再单独展示一份，而是「用作正文」送进右栏结果台，避免两处文本不一致。 */
import { h, btn, selectEl, copyText, toast } from "./dom.js";
import { LEVELS, LEVEL_LABELS, prefsGet, prefsSet } from "./store.js";
import { postJSON } from "./api.js";

export function mountAssemble(pane, ctx) {
  let result = "";

  const bar = h("div", "nl-toolbar");
  bar.appendChild(h("span", "nl-note", "把随机正文与手写补充合并：可去重、互斥并限制档位。"));
  bar.appendChild(h("span", "nl-grow"));
  bar.appendChild(btn("取当前结果", {
    size: "sm",
    onClick: () => {
      const last = ctx.currentResult();
      if (!last || !last.text) { toast("还没有抽取结果", true); return; }
      main.value = last.text;
      prefsSet("assemble.main", main.value);
    },
  }));
  pane.appendChild(bar);

  const body = h("div", "nl-list nl-assemble");

  body.appendChild(h("div", "nl-subhead", "随机正文"));
  const main = h("textarea", "nl-input nl-textarea");
  main.value = prefsGet("assemble.main", "");
  main.placeholder = "主提示词，例如 1girl, solo, ...";
  main.addEventListener("input", () => prefsSet("assemble.main", main.value));
  body.appendChild(main);

  body.appendChild(h("div", "nl-subhead", "手写补充"));
  const sup = h("textarea", "nl-input nl-textarea");
  sup.value = prefsGet("assemble.supplement", "");
  sup.placeholder = "补充 tag，逗号分隔";
  sup.addEventListener("input", () => prefsSet("assemble.supplement", sup.value));
  body.appendChild(sup);

  const opts = h("div", "nl-toolbar wrap");
  const mode = selectEl([
    { value: "追加到末尾", label: "追加到末尾" },
    { value: "合并去重", label: "合并去重" },
    { value: "仅透传 main", label: "仅透传 main" },
  ], prefsGet("assemble.mode", "合并去重"), (v) => prefsSet("assemble.mode", v));
  const lv = selectEl(
    [{ value: "不限", label: "不限档位" }, ...LEVELS.map((l) => ({ value: l, label: LEVEL_LABELS[l] }))],
    prefsGet("assemble.level", "不限"),
    (v) => prefsSet("assemble.level", v),
  );
  const modeRow = h("label", "nl-form-row");
  modeRow.appendChild(h("span", "nl-lab", "合并方式"));
  modeRow.appendChild(mode);
  const lvRow = h("label", "nl-form-row");
  lvRow.appendChild(h("span", "nl-lab", "档位上限"));
  lvRow.appendChild(lv);
  opts.appendChild(modeRow);
  opts.appendChild(lvRow);

  const runBtn = btn("合并", {
    variant: "pri",
    onClick: async () => {
      runBtn.disabled = true;
      try {
        const res = await postJSON("/assemble", {
          main: main.value,
          supplement: sup.value,
          mode: mode.value,
          max_level: lv.value,
        });
        result = res.text || "";
        out.textContent = result || "（空）";
        out.classList.remove("empty");
        copyBtn.disabled = !result;
        useBtn.disabled = !result;
        toast("已合并");
      } catch (err) {
        toast("合并失败：" + err.message, true);
      } finally {
        runBtn.disabled = false;
      }
    },
  });
  const copyBtn = btn("复制结果", {
    disabled: true,
    onClick: () => copyText(result, "已复制拼接结果"),
  });
  const useBtn = btn("用作正文", {
    disabled: true,
    onClick: () => {
      if (!result) return;
      ctx.usePrompt(result);
      toast("已送入右栏结果台");
    },
  });
  const actions = h("div", "nl-form-row actions");
  actions.appendChild(runBtn);
  actions.appendChild(copyBtn);
  actions.appendChild(useBtn);
  opts.appendChild(actions);
  body.appendChild(opts);

  body.appendChild(h("div", "nl-subhead", "拼接结果"));
  const out = h("pre", "nl-out empty", "（还没有拼接结果）");
  out.tabIndex = 0;
  body.appendChild(out);

  pane.appendChild(body);

  return {
    activate() {},
    refresh() {},
  };
}
