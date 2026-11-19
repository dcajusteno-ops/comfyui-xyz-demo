/* 细节页：姿势 / 构图光影 / 风格与参数 / 全部字段。
   前两段是「点一下即锁定」的快捷视图，最后一段是完整的 14 段权重编辑器。
   所有锁定与权重都走 store 的 weights 模型，视图之间通过 subscribe 同步。 */
import {
  h, btn, iconBtn, iconSpan, searchInput, selectEl, checkbox, card, levelBadge, empty,
  subhead, toast, fmtWeight, clamp,
} from "./dom.js";
import {
  cache, LEVELS, LEVEL_LABELS, LEVEL_NUM, POSE_FIELDS, CAMERA_FIELDS, STYLE_FIELDS,
  prefsGet, prefsSet, getSetting, setSetting, fieldByKey, optionZh, optionTags, optionLevel,
  flattenTags, splitCSV,
} from "./store.js";
import {
  sectionWeight, setSectionWeight, fieldWeight, setFieldWeight, optionWeight, cycleOptionWeight,
  lockField, unlockField, isLocked, clearLocks, resetWeights, saveWeights,
} from "./store.js";

export function mountDetail(pane, ctx) {
  const seg = h("div", "nl-seg");
  const subPanes = {
    pose: h("div", "nl-subpane"),
    camera: h("div", "nl-subpane"),
    style: h("div", "nl-subpane"),
    fields: h("div", "nl-subpane"),
  };
  pane.appendChild(seg);
  Object.values(subPanes).forEach((el) => pane.appendChild(el));

  const items = [
    { id: "pose", label: "姿势" },
    { id: "camera", label: "构图光影" },
    { id: "style", label: "风格与参数" },
    { id: "fields", label: "全部字段" },
  ];
  const buttons = items.map((item) => {
    const b = h("button", "nl-seg-btn");
    b.type = "button";
    b.dataset.id = item.id;
    b.appendChild(h("span", "", item.label));
    b.addEventListener("click", () => show(item.id));
    seg.appendChild(b);
    return b;
  });

  const mounts = {
    pose: mountPose(subPanes.pose, ctx),
    camera: mountCamera(subPanes.camera, ctx),
    style: mountStyle(subPanes.style, ctx),
    fields: mountFields(subPanes.fields, ctx),
  };

  function show(id) {
    const active = mounts[id] ? id : "pose";
    prefsSet("sub.detail", active);
    buttons.forEach((b) => {
      const on = b.dataset.id === active;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    Object.entries(subPanes).forEach(([key, el]) => { el.hidden = key !== active; });
    mounts[active].activate();
  }

  show(prefsGet("sub.detail", "pose"));

  return {
    activate() { show(prefsGet("sub.detail", "pose")); },
    refresh() { mounts[prefsGet("sub.detail", "pose")].refresh(); },
  };
}

/* ── 共用：chip 组 ────────────────────────────────────────────────── */
function chipGroup(key, field, opts = {}) {
  const grid = h("div", "nl-optgrid");
  const chips = new Map();
  const entries = [];
  (field.opts || []).forEach((opt) => {
    const tags = optionTags(opt);
    const chip = h("button", "nl-chip");
    chip.type = "button";
    chip.textContent = optionZh(opt);
    chip.title = tags;
    chip.dataset.tags = tags;
    if (optionLevel(opt) > (LEVEL_NUM[String(getSetting("nsfw_level", "sfw"))] || 0)) {
      chip.disabled = true;
      chip.title = `${tags}\n当前内容档位不可用`;
    }
    chip.addEventListener("click", () => {
      if (opts.mode === "lock") {
        if (lockedTags(key, field) === tags && isLocked(key)) unlockField(key, field);
        else lockField(key, tags, field);
      } else {
        cycleOptionWeight(key, tags);
      }
      syncChips();
      if (opts.onChange) opts.onChange();
    });
    chips.set(tags, chip);
    entries.push({ chip, tags });
  });

  /* 锁定视图默认只露出前 14 个，避免单个字段铺满整屏；展开后与「全部字段」一致 */
  const limit = opts.limit || 0;
  let expanded = !limit;
  function renderChips() {
    grid.replaceChildren();
    const visible = expanded ? entries : entries.slice(0, limit);
    visible.forEach((entry) => grid.appendChild(entry.chip));
    if (!expanded && entries.length > limit) {
      const more = btn(`更多 ${entries.length - limit}`, {
        size: "sm",
        onClick: () => { expanded = true; renderChips(); },
      });
      more.classList.add("nl-chip-more");
      grid.appendChild(more);
    }
  }

  function lockedTags(k, f) {
    const cur = splitCSV(getSetting("lock_fields", "")).includes(k);
    if (!cur) return "";
    let hit = "";
    (f.opts || []).forEach((o) => {
      if (optionWeight(k, optionTags(o)) === 3) hit = optionTags(o);
    });
    return hit;
  }

  function syncChips() {
    const locked = lockedTags(key, field);
    chips.forEach((chip, tags) => {
      const w = optionWeight(key, tags);
      chip.dataset.w = String(w);
      chip.setAttribute("aria-pressed", String(w > 0));
      chip.classList.toggle("locked", Boolean(locked) && locked === tags);
      chip.classList.toggle("dim", Boolean(locked) && locked !== tags);
    });
  }

  syncChips();
  renderChips();
  return { el: grid, sync: syncChips, lockedTags: () => lockedTags(key, field) };
}

function fieldBlock(title, key, onChange, opts = {}) {
  const found = fieldByKey(key);
  if (!found) return null;
  const wrap = h("div", "nl-field");
  const hd = h("div", "nl-field-hd");
  hd.appendChild(h("span", "nl-lab", title));
  hd.appendChild(h("span", "nl-kv", key));
  hd.appendChild(h("span", "nl-grow"));
  const state = h("span", "nl-lock-state", "");
  hd.appendChild(state);
  const clear = btn("清除", {
    size: "sm",
    onClick: () => { unlockField(key, found.field); sync(); if (onChange) onChange(); },
  });
  hd.appendChild(clear);
  wrap.appendChild(hd);

  const group = chipGroup(key, found.field, { mode: "lock", onChange, limit: 14 });
  wrap.appendChild(group.el);

  function sync() {
    group.sync();
    const locked = splitCSV(getSetting("lock_fields", "")).includes(key);
    const tags = group.lockedTags();
    let label = "";
    if (locked && tags) {
      const opt = (found.field.opts || []).find((o) => optionTags(o) === tags);
      label = `锁定：${opt ? optionZh(opt) : tags}`;
    }
    state.textContent = label;
    state.classList.toggle("on", Boolean(label));
    clear.hidden = !locked;
  }
  sync();
  return { el: wrap, sync };
}

/* ── 姿势 ─────────────────────────────────────────────────────────── */
function mountPose(pane, ctx) {
  const view = { mode: prefsGet("detail.poseView", "tags") };

  const bar = h("div", "nl-toolbar");
  const tagsBtn = btn("细分标签", {
    size: "sm",
    pressed: view.mode !== "scenes",
    onClick: () => { view.mode = "tags"; prefsSet("detail.poseView", "tags"); draw(); },
  });
  const scenesBtn = btn("预设组合", {
    size: "sm",
    pressed: view.mode === "scenes",
    onClick: () => { view.mode = "scenes"; prefsSet("detail.poseView", "scenes"); draw(); },
  });
  bar.appendChild(tagsBtn);
  bar.appendChild(scenesBtn);
  bar.appendChild(h("span", "nl-grow"));
  pane.appendChild(bar);

  const body = h("div", "nl-list");
  pane.appendChild(body);

  const POSE_GROUPS = [
    { key: "pose.stance", title: "身体站姿 / 坐卧体态" },
    { key: "pose.action", title: "手部交互 / 动作特写" },
    { key: "pose.head", title: "头部神态 / 视线方向" },
    { key: "pose.legs", title: "腿部造型 / 步态" },
    { key: "pose_nsfw.intimate", title: "私密情调 / 亲密体位" },
    { key: "pose_nsfw.explicit", title: "露骨姿态" },
  ];

  function draw() {
    tagsBtn.classList.toggle("on", view.mode !== "scenes");
    tagsBtn.setAttribute("aria-pressed", String(view.mode !== "scenes"));
    scenesBtn.classList.toggle("on", view.mode === "scenes");
    scenesBtn.setAttribute("aria-pressed", String(view.mode === "scenes"));
    body.replaceChildren();
    if (view.mode === "scenes") drawSceneCombos();
    else drawTagFields();
  }

  function drawTagFields() {
    const head = h("div", "nl-hint");
    head.appendChild(h("span", "", "点击标签即把该字段锁定为必出（权重 3），再点一次取消。"));
    head.appendChild(h("span", "nl-grow"));
    head.appendChild(btn("清除姿势锁定", { size: "sm", onClick: () => { clearLocks(POSE_FIELDS); draw(); } }));
    body.appendChild(head);
    POSE_GROUPS.forEach((g) => {
      const block = fieldBlock(g.title, g.key, () => {});
      if (block) body.appendChild(block.el);
    });
  }

  function drawSceneCombos() {
    const picked = new Set(prefsGet("posePicked", []));
    const head = h("div", "nl-hint");
    head.appendChild(h("span", "", "勾选几条预设组合，再「从勾选随机」或勾上「每次运行自动随机」。"));
    head.appendChild(h("span", "nl-grow"));
    head.appendChild(btn("从勾选随机", {
      size: "sm",
      onClick: () => {
        if (!picked.size) { toast("先勾选至少一条姿势", true); return; }
        ctx.onRoll({ pick_pool_mode: "pose", pick_pool_ids: Array.from(picked).join(",") });
      },
    }));
    head.appendChild(btn("清空勾选", {
      size: "sm",
      onClick: () => {
        picked.clear();
        prefsSet("posePicked", []);
        draw();
      },
    }));
    body.appendChild(head);

    const auto = checkbox("每次运行自动随机", getSetting("pick_pool_mode", "") === "pose", (checked) => {
      if (checked) {
        if (!picked.size) { toast("先勾选几条姿势", true); draw(); return; }
        setSetting("pick_pool_mode", "pose");
        setSetting("pick_pool_ids", Array.from(picked).join(","));
      } else if (getSetting("pick_pool_mode", "") === "pose") {
        setSetting("pick_pool_mode", "");
        setSetting("pick_pool_ids", "");
      }
      ctx.markStale();
    });
    body.appendChild(auto);
    body.appendChild(h("div", "nl-note", `已勾选 ${picked.size} 条`));

    const scenes = (cache.scenes.scenes || []).filter((s) => s.group === "pose");
    if (!scenes.length) {
      body.appendChild(empty("姿势库里没有预设组合"));
      return;
    }
    const grid = h("div", "nl-grid scenes");
    scenes.forEach((s) => {
      const on = picked.has(s.id);
      const el = card({
        on,
        pressed: on,
        onClick: () => {
          if (picked.has(s.id)) picked.delete(s.id);
          else picked.add(s.id);
          prefsSet("posePicked", Array.from(picked));
          el.classList.toggle("on", picked.has(s.id));
          el.setAttribute("aria-pressed", String(picked.has(s.id)));
          note.textContent = `已勾选 ${picked.size} 条`;
        },
      });
      const top = h("div", "nl-card-top");
      top.appendChild(h("span", "nl-card-title", s.zh));
      if (Number(s.level) > 0) top.appendChild(levelBadge(s.level));
      el.appendChild(top);
      const tags = h("div", "nl-card-tags");
      Object.values(s.tags || {}).forEach((v) => flattenTags(v).slice(0, 3).forEach((t) => tags.appendChild(h("span", "nl-tag", t))));
      el.appendChild(tags);
      grid.appendChild(el);
    });
    const note = h("div", "nl-note", `已勾选 ${picked.size} 条`);
    body.appendChild(grid);
    body.appendChild(note);
  }

  draw();

  return {
    activate() { draw(); },
    refresh() { draw(); },
  };
}

/* ── 构图光影 ─────────────────────────────────────────────────────── */
function mountCamera(pane, ctx) {
  const bar = h("div", "nl-toolbar");
  bar.appendChild(h("span", "nl-note", "点击选项 = 锁定为必出（权重 3）；再次点击取消。"));
  bar.appendChild(h("span", "nl-grow"));
  bar.appendChild(btn("清除构图锁定", { size: "sm", onClick: () => { clearLocks(CAMERA_FIELDS); draw(); } }));
  pane.appendChild(bar);

  const body = h("div", "nl-list");
  pane.appendChild(body);

  const GROUPS = [
    { key: "lighting.type", title: "光照类型" },
    { key: "camera.shot", title: "镜头景别" },
    { key: "camera.composition", title: "构图" },
    { key: "lighting.grade", title: "调色与后期" },
  ];

  function draw() {
    body.replaceChildren();
    GROUPS.forEach((g) => {
      const block = fieldBlock(g.title, g.key, () => {});
      if (block) body.appendChild(block.el);
    });
  }

  draw();
  return { activate() { draw(); }, refresh() { draw(); } };
}

/* ── 风格与参数 ───────────────────────────────────────────────────── */
function mountStyle(pane, ctx) {
  const body = h("div", "nl-list");
  pane.appendChild(body);

  function draw() {
    body.replaceChildren();

    body.appendChild(subhead("画质预设"));
    const profileGrid = h("div", "nl-grid profiles");
    (cache.pools.quality_profiles || []).forEach((profile) => {
      const on = String(getSetting("quality_profile", "NoobAI 标准")) === profile.name;
      const el = card({
        on,
        pressed: on,
        cls: "stack",
        onClick: () => {
          setSetting("quality_profile", profile.name);
          ctx.markStale();
          draw();
        },
      });
      el.appendChild(h("div", "nl-card-title", profile.name));
      el.appendChild(h("div", "nl-card-sub", profile.tags || "不加画质串"));
      profileGrid.appendChild(el);
    });
    body.appendChild(profileGrid);

    body.appendChild(subhead("服装风格"));
    const styleRow = h("div", "nl-form-row");
    styleRow.appendChild(h("span", "nl-lab", "整套接管概率"));
    styleRow.appendChild(selectEl(
      (cache.pools.outfit_styles || []).map((s) => ({ value: s, label: s })),
      String(getSetting("outfit_style", "随机")),
      (v) => { setSetting("outfit_style", v); ctx.markStale(); },
    ));
    styleRow.appendChild(h("span", "nl-note", "「随机」有 30% 概率从服装库整套接管；「不限」纯随机单件。"));
    body.appendChild(styleRow);

    body.appendChild(subhead("画面风格 / 题材 / 作品形态"));
    STYLE_FIELDS.forEach((key) => {
      const block = fieldBlock(fieldByKey(key) ? fieldByKey(key).field.lab : key, key, () => {});
      if (block) body.appendChild(block.el);
    });

    body.appendChild(subhead("抽取参数"));
    body.appendChild(paramRows(ctx));
  }

  draw();
  return { activate() { draw(); }, refresh() { draw(); } };
}

function paramRows(ctx) {
  const box = h("div", "nl-params");

  const row = (label, control, hint) => {
    const r = h("div", "nl-form-row");
    r.appendChild(h("span", "nl-lab", label));
    r.appendChild(control);
    if (hint) r.appendChild(h("span", "nl-note", hint));
    box.appendChild(r);
  };

  const numInput = (value, min, max, step, onChange) => {
    const input = h("input", "nl-input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener("change", () => {
      const next = clamp(Number(input.value) || 0, min, max);
      input.value = String(next);
      onChange(next);
      ctx.markStale();
    });
    return input;
  };

  const textInput = (value, placeholder, onChange) => {
    const input = h("input", "nl-input");
    input.type = "text";
    input.placeholder = placeholder;
    input.value = String(value);
    input.addEventListener("change", () => { onChange(input.value.trim()); ctx.markStale(); });
    return input;
  };

  row("字段概率", numInput(getSetting("base_prob", 0.6), 0, 1, 0.05, (v) => setSetting("base_prob", v)),
    "每个字段被抽中的基础概率");
  row("标签上限", selectEl(
    (cache.pools.tag_cap_choices || ["自动"]).map((v) => ({ value: v, label: v })),
    String(getSetting("tag_cap", "自动")),
    (v) => { setSetting("tag_cap", v); ctx.markStale(); },
  ));
  row("角色还原", selectEl([
    { value: "完整核心", label: "完整核心（发型 / 发长 / 标志服饰全锁）" },
    { value: "仅发色瞳色", label: "仅发色 / 瞳色" },
    { value: "关闭", label: "关闭（完全随机）" },
  ], String(getSetting("appearance_mode", "完整核心")), (v) => { setSetting("appearance_mode", v); ctx.markStale(); }));
  row("服装概率", numInput(getSetting("outfit_prob", 60), 0, 100, 5, (v) => setSetting("outfit_prob", v)),
    "「随机」风格时套用服装库的概率（%）");
  row("负向档位", selectEl([
    { value: "自动（按档位）", label: "自动（按内容档位选择）" },
    { value: "NoobAI 官方", label: "NoobAI 官方" },
    { value: "NoobAI 官方（不含 nsfw）", label: "NoobAI 官方（不含 nsfw）" },
    { value: "WAI 官方", label: "WAI 官方" },
    { value: "不加负面", label: "不输出负向词" },
    { value: "自定义追加", label: "仅用「负向补充」" },
  ], String(getSetting("negative_profile", "自动（按档位）")), (v) => { setSetting("negative_profile", v); ctx.markStale(); }));
  row("负向补充", textInput(getSetting("negative_extra", ""), "额外负向 tag，逗号分隔", (v) => setSetting("negative_extra", v)));
  row("手写补充", textInput(getSetting("extra_body", ""), "手写正向 tag，始终追加在末尾", (v) => setSetting("extra_body", v)));

  const checkRow = h("div", "nl-form-row checks");
  checkRow.appendChild(checkbox("评分 tag", !!getSetting("rating_tag", true), (v) => { setSetting("rating_tag", v); ctx.markStale(); }));
  checkRow.appendChild(checkbox("避免连抽重复", !!getSetting("avoid_repeat", false), (v) => { setSetting("avoid_repeat", v); ctx.markStale(); }));
  checkRow.appendChild(checkbox("官方发色 / 瞳色", !!getSetting("appearance_follow", true), (v) => { setSetting("appearance_follow", v); ctx.markStale(); }));
  checkRow.appendChild(checkbox("每次自动换人", !!getSetting("role_pick", false), (v) => { setSetting("role_pick", v); ctx.markStale(); }));
  box.appendChild(checkRow);

  return box;
}

/* ── 全部字段 ─────────────────────────────────────────────────────── */
function mountFields(pane, ctx) {
  const view = { query: prefsGet("detail.fieldQuery", ""), open: new Set(prefsGet("detail.open", [])) };

  const bar = h("div", "nl-toolbar");
  const search = searchInput(view.query, "搜索字段 / 标签 / 中文名", (v) => {
    view.query = v;
    prefsSet("detail.fieldQuery", v);
    draw();
  });
  bar.appendChild(search.el);
  bar.appendChild(selectEl([
    { value: "", label: "权重预设…" },
    { value: "default", label: "默认" },
    { value: "scene", label: "重场景" },
    { value: "outfit", label: "重服装" },
    { value: "person", label: "重人物" },
  ], "", (v) => {
    if (!v) return;
    resetWeights(v);
    draw();
    toast(v === "default" ? "已恢复默认权重" : "已套用权重预设");
  }));
  bar.appendChild(btn("全部展开", {
    size: "sm",
    onClick: () => {
      view.open = new Set((cache.pools.sections || []).map((s) => s.id));
      persistOpen();
      draw();
    },
  }));
  bar.appendChild(btn("全部收起", {
    size: "sm",
    onClick: () => {
      view.open = new Set();
      persistOpen();
      draw();
    },
  }));
  bar.appendChild(h("span", "nl-grow"));
  bar.appendChild(btn("恢复默认权重", {
    size: "sm",
    onClick: () => {
      resetWeights("default");
      draw();
      toast("已恢复默认权重（锁定与禁用段未改动）");
    },
  }));
  bar.appendChild(btn("清空全部", {
    size: "sm",
    danger: true,
    variant: "danger",
    onClick: () => {
      if (!window.confirm("清空所有段/字段/选项权重，并清除全部字段锁定？")) return;
      resetWeights("default");
      setSetting("lock_fields", "");
      setSetting("disabled_sections", "");
      saveWeights();
      view.open = new Set();
      persistOpen();
      ctx.markStale();
      draw();
      toast("已清空权重与锁定");
    },
  }));
  pane.appendChild(bar);

  const body = h("div", "nl-list");
  pane.appendChild(body);

  function persistOpen() {
    prefsSet("detail.open", Array.from(view.open));
  }

  function matches(sec, field) {
    const q = view.query.toLowerCase().trim();
    if (!q) return true;
    if (String(sec.title || sec.name || sec.id).toLowerCase().includes(q)) return true;
    if (String(field.lab || field.key).toLowerCase().includes(q)) return true;
    if (String(field.key).toLowerCase().includes(q)) return true;
    return (field.opts || []).some((o) => optionZh(o).toLowerCase().includes(q) || optionTags(o).toLowerCase().includes(q));
  }

  function draw() {
    body.replaceChildren();
    body.appendChild(h("div", "nl-hint",
      "权重 0 = 关闭 · 1 = 默认 · 2 = 加强 · 3 = 必出；锁定字段保证参与抽取。"));
    const sections = cache.pools.sections || [];
    let shown = 0;

    sections.forEach((sec) => {
      const fields = (sec.fields || []).filter((f) => matches(sec, f));
      if (!fields.length) return;
      shown += 1;
      const open = view.query ? true : view.open.has(sec.id);
      const sw = sectionWeight(sec.id);
      const wrap = h("section", "nl-sec" + (open ? " open" : "") + (sw <= 0 ? " off" : ""));

      const hd = h("div", "nl-sec-hd");
      hd.tabIndex = 0;
      hd.setAttribute("role", "button");
      hd.setAttribute("aria-expanded", String(open));
      const arrow = h("span", "nl-arrow");
      arrow.appendChild(iconSpan("chevron"));
      hd.appendChild(arrow);
      hd.appendChild(h("span", "nl-sec-title", sec.title || sec.name || sec.id));
      hd.appendChild(h("span", "nl-sec-meta",
        `字段 ${fields.length} · 档位 ≥ ${LEVEL_LABELS[LEVELS[sec.floor || 0]]}`));

      const toggle = btn(sw > 0 ? "已启用" : "已关闭", {
        size: "sm",
        on: sw > 0,
        pressed: sw > 0,
        onClick: (e) => {
          e.stopPropagation();
          setSectionWeight(sec.id, sw > 0 ? 0 : 1);
          draw();
        },
      });
      hd.appendChild(toggle);
      hd.appendChild(stepper(sw, (v) => {
        setSectionWeight(sec.id, v);
        if (v <= 0) wrap.classList.add("off");
        else wrap.classList.remove("off");
      }));

      const toggleOpen = () => {
        if (view.open.has(sec.id)) view.open.delete(sec.id);
        else view.open.add(sec.id);
        persistOpen();
        draw();
      };
      hd.addEventListener("click", toggleOpen);
      hd.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOpen(); }
      });
      wrap.appendChild(hd);

      if (open) {
        const bd = h("div", "nl-sec-bd");
        fields.forEach((f) => bd.appendChild(fieldRow(f)));
        wrap.appendChild(bd);
      }
      body.appendChild(wrap);
    });

    if (!shown) body.appendChild(empty("没有匹配的字段", "换个关键词，或清空搜索查看全部 51 个字段"));
    if (view.query) {
      body.insertBefore(h("div", "nl-note", `搜索「${view.query}」命中 ${shown} 个段落`), body.firstChild);
    }
  }

  function fieldRow(field) {
    const wrap = h("div", "nl-field");
    const hd = h("div", "nl-field-hd");
    hd.appendChild(h("span", "nl-lab", field.lab));
    hd.appendChild(h("span", "nl-kv", field.key));
    if (field.req) hd.appendChild(h("span", "nl-req", "必出"));
    hd.appendChild(h("span", "nl-grow"));

    const lockSet = new Set(splitCSV(getSetting("lock_fields", "")));
    const lockBtn = iconBtn("pin", lockSet.has(field.key) ? "取消锁定" : "锁定该字段（保证参与抽取）", () => {
      const now = splitCSV(getSetting("lock_fields", ""));
      const next = new Set(now);
      if (next.has(field.key)) next.delete(field.key);
      else next.add(field.key);
      setSetting("lock_fields", Array.from(next).join(","));
      lockBtn.classList.toggle("on", next.has(field.key));
      lockBtn.setAttribute("aria-pressed", String(next.has(field.key)));
    }, "nl-lock" + (lockSet.has(field.key) ? " on" : ""));
    lockBtn.setAttribute("aria-pressed", String(lockSet.has(field.key)));
    hd.appendChild(lockBtn);
    hd.appendChild(stepper(fieldWeight(field.key), (v) => setFieldWeight(field.key, v)));
    wrap.appendChild(hd);

    const group = chipGroup(field.key, field, { onChange: () => ctx.markStale() });
    wrap.appendChild(group.el);
    return wrap;
  }

  draw();
  return { activate() { draw(); }, refresh() { draw(); } };
}

/* ── 权重步进器 ───────────────────────────────────────────────────── */
function stepper(value, onChange) {
  const wrap = h("div", "nl-step");
  let v = clamp(Number(value) || 0, 0, 3);
  const minus = h("button", "", "−");
  minus.type = "button";
  minus.setAttribute("aria-label", "降低权重");
  const val = h("span", "nl-val", fmtWeight(v));
  const plus = h("button", "", "+");
  plus.type = "button";
  plus.setAttribute("aria-label", "提高权重");
  const sync = () => {
    val.textContent = fmtWeight(v);
    minus.disabled = v <= 1e-9;
    plus.disabled = v >= 3 - 1e-9;
  };
  minus.addEventListener("click", (e) => {
    e.stopPropagation();
    v = clamp(Number((v - 0.5).toFixed(2)), 0, 3);
    sync();
    onChange(v);
  });
  plus.addEventListener("click", (e) => {
    e.stopPropagation();
    v = clamp(Number((v + 0.5).toFixed(2)), 0, 3);
    sync();
    onChange(v);
  });
  sync();
  wrap.appendChild(minus);
  wrap.appendChild(val);
  wrap.appendChild(plus);
  return wrap;
}
