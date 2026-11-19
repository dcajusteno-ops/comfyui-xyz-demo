/* 场景 · 服装：一个页签，两个二级分段。
   两个分段的工具栏/列表各自常驻，切换只改 hidden，搜索框不会被销毁。 */
import {
  h, btn, searchInput, selectEl, checkbox, card, levelBadge, pager, empty, toast,
} from "./dom.js";
import {
  cache, LEVELS, LEVEL_LABELS, LEVEL_NUM, PAGE_OUTFITS, PAGE_SCENES,
  prefsGet, prefsSet, favorites, recents, pushRecent, patchState,
  activeOutfit, getSetting, setSetting, flattenTags, splitCSV, fieldByKey, optionZh, optionTags,
} from "./store.js";
import { favStar } from "./fav.js";

export function mountScene(pane, ctx) {
  const seg = h("div", "nl-seg");
  const paneOutfit = h("div", "nl-subpane");
  const paneScene = h("div", "nl-subpane");
  pane.appendChild(seg);
  pane.appendChild(paneOutfit);
  pane.appendChild(paneScene);

  const views = {
    outfits: mountOutfits(paneOutfit, ctx),
    scenes: mountScenes(paneScene, ctx),
  };

  const items = [
    { id: "outfits", label: "服装", count: (cache.outfits.outfits || []).length },
    { id: "scenes", label: "场景", count: (cache.scenes.scenes || []).length },
  ];
  const buttons = items.map((item) => {
    const b = h("button", "nl-seg-btn");
    b.type = "button";
    b.dataset.id = item.id;
    b.appendChild(h("span", "", item.label));
    b.appendChild(h("span", "nl-seg-count", String(item.count)));
    b.addEventListener("click", () => show(item.id));
    seg.appendChild(b);
    return b;
  });

  function show(id) {
    const active = views[id] ? id : "outfits";
    prefsSet("sub.scene", active);
    buttons.forEach((b) => {
      const on = b.dataset.id === active;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    paneOutfit.hidden = active !== "outfits";
    paneScene.hidden = active !== "scenes";
    views[active].activate();
  }

  return {
    activate() { show(prefsGet("sub.scene", "scenes")); },
    refresh() {
      views.outfits.refresh();
      views.scenes.refresh();
    },
  };
}

/* ── 服装 ─────────────────────────────────────────────────────────── */
function mountOutfits(pane, ctx) {
  const view = { shown: PAGE_OUTFITS, cards: new Map() };

  const bar = h("div", "nl-toolbar");
  const search = searchInput(prefsGet("outfits.query", ""), "搜索服装 / 标签", (v) => {
    prefsSet("outfits.query", v);
    view.shown = PAGE_OUTFITS;
    renderList();
  });
  bar.appendChild(search.el);

  const cats = (cache.outfits.categories || []).map((c) => ({ value: c.id, label: c.zh }));
  bar.appendChild(selectEl([{ value: "", label: "全部分类" }, ...cats], prefsGet("outfits.cat", ""), (v) => {
    prefsSet("outfits.cat", v);
    view.shown = PAGE_OUTFITS;
    renderList();
  }));

  const favBtn = btn("只看收藏", {
    size: "sm",
    pressed: prefsGet("outfits.onlyFav", false),
    onClick: () => {
      const next = !prefsGet("outfits.onlyFav", false);
      prefsSet("outfits.onlyFav", next);
      favBtn.classList.toggle("on", next);
      favBtn.setAttribute("aria-pressed", String(next));
      view.shown = PAGE_OUTFITS;
      renderList();
    },
  });
  bar.appendChild(favBtn);
  const stopBtn = btn("停用当前套装", { size: "sm", onClick: () => setActive("") });
  bar.appendChild(stopBtn);
  pane.appendChild(bar);

  const bannerWrap = h("div");
  pane.appendChild(bannerWrap);

  const overrideBox = h("details", "nl-fold nl-override");
  const sum = h("summary", "nl-fold-hd");
  sum.appendChild(h("span", "", "单件覆盖"));
  sum.appendChild(h("span", "nl-fold-meta", "优先于随机服装"));
  overrideBox.appendChild(sum);
  const overrideBody = h("div", "nl-fold-bd");
  ["top", "bottom"].forEach((slot) => {
    const found = fieldByKey(`outfit.${slot}`);
    const row = h("label", "nl-form-row");
    row.appendChild(h("span", "nl-lab", slot === "top" ? "上装" : "下装"));
    const opts = [{ value: "", label: "不覆盖" }].concat(
      ((found && found.field.opts) || []).map((o) => ({ value: optionTags(o), label: optionZh(o) })),
    );
    const current = ((cache.state && cache.state.overrides) || {})[slot] || "";
    row.appendChild(selectEl(opts, current, (v) => setOverride(slot, v)));
    overrideBody.appendChild(row);
  });
  overrideBox.appendChild(overrideBody);
  pane.appendChild(overrideBox);

  const listBox = h("div", "nl-list");
  pane.appendChild(listBox);

  function setActive(id) {
    patchState({ active_outfit: id })
      .then(() => {
        toast(id ? "已启用整套服装" : "已停用服装库");
        ctx.markStale();
        renderBanner();
        renderList();
      })
      .catch((err) => toast("状态保存失败：" + err.message, true));
  }

  function setOverride(slot, tags) {
    const overrides = Object.assign({}, (cache.state && cache.state.overrides) || {});
    overrides[slot] = tags;
    patchState({ overrides })
      .then(() => {
        toast(tags ? "已设置单件覆盖" : "已取消覆盖");
        ctx.markStale();
      })
      .catch((err) => toast("覆盖保存失败：" + err.message, true));
  }

  function renderBanner() {
    const active = activeOutfit();
    stopBtn.hidden = !active;
    bannerWrap.replaceChildren();
    if (!active) return;
    const rec = (cache.outfits.outfits || []).find((o) => o.id === active);
    const row = h("div", "nl-banner");
    row.appendChild(h("span", "", "启用中："));
    row.appendChild(h("b", "", rec ? rec.zh : active));
    row.appendChild(h("span", "nl-grow"));
    row.appendChild(h("span", "nl-note", "整套接管上装 / 下装 / 腿部 / 鞋子；角色官方服饰优先"));
    bannerWrap.appendChild(row);
  }

  function renderRecent() {
    const ids = recents("outfit").filter((id) => (cache.outfits.outfits || []).some((o) => o.id === id)).slice(0, 8);
    if (!ids.length) return null;
    const row = h("div", "nl-banner sub");
    row.appendChild(h("span", "", "最近："));
    ids.forEach((id) => {
      const rec = (cache.outfits.outfits || []).find((o) => o.id === id);
      const chip = h("button", "nl-chip", rec ? rec.zh : id);
      chip.type = "button";
      chip.addEventListener("click", () => setActive(id));
      row.appendChild(chip);
    });
    return row;
  }

  function filtered() {
    const q = String(prefsGet("outfits.query", "")).toLowerCase();
    const cat = prefsGet("outfits.cat", "");
    const onlyFav = prefsGet("outfits.onlyFav", false);
    const favs = favorites("outfit");
    return (cache.outfits.outfits || []).filter((o) => {
      if (onlyFav && !favs.has(o.id)) return false;
      if (cat && o.cat !== cat) return false;
      if (!q) return true;
      return [o.zh, o.id, ...Object.values(o.tags || {})].join(" ").toLowerCase().includes(q);
    });
  }

  function renderList() {
    const all = filtered();
    const shown = Math.max(PAGE_OUTFITS, view.shown);
    const list = all.slice(0, shown);
    const active = activeOutfit();
    view.cards.clear();
    listBox.replaceChildren();

    const recent = renderRecent();
    if (recent) listBox.insertBefore(recent, listBox.firstChild);

    if (!list.length) {
      listBox.appendChild(prefsGet("outfits.onlyFav", false)
        ? empty("还没有收藏的服装", "点卡片星标收藏")
        : empty("没有匹配的服装", "换个关键词或分类试试"));
      return;
    }

    const grid = h("div", "nl-grid outfits");
    list.forEach((o) => {
      const on = o.id === active;
      const el = card({ on, pressed: on, cls: "stack" });
      const top = h("div", "nl-card-top");
      top.appendChild(h("span", "nl-card-title", o.zh));
      if (Number(o.level) > 0) top.appendChild(levelBadge(o.level));
      el.appendChild(top);
      const cat = (cache.outfits.categories || []).find((c) => c.id === o.cat);
      el.appendChild(h("div", "nl-card-sub", cat ? cat.zh : (o.cat || "")));

      const tags = h("div", "nl-card-tags");
      Object.values(o.tags || {}).slice(0, 5).forEach((t) => tags.appendChild(h("span", "nl-tag", t)));
      el.appendChild(tags);

      const actions = h("div", "nl-card-actions");
      actions.appendChild(favStar("outfit", o.id, () => { if (prefsGet("outfits.onlyFav", false)) renderList(); }));
      actions.appendChild(btn(on ? "停用" : "启用整套", {
        size: "sm",
        on,
        onClick: (e) => {
          e.stopPropagation();
          if (!on) pushRecent("outfit", o.id);
          setActive(on ? "" : o.id);
        },
      }));
      el.appendChild(actions);
      view.cards.set(o.id, { card: el });
      grid.appendChild(el);
    });
    listBox.appendChild(grid);

    if (all.length > list.length) {
      const p = pager(list.length, all.length, () => {
        view.shown = shown + PAGE_OUTFITS;
        renderList();
      });
      p.update(list.length, all.length);
      listBox.appendChild(p.el);
    }
  }

  renderBanner();
  renderList();

  return {
    activate() { renderBanner(); renderList(); },
    refresh() { renderBanner(); renderList(); },
  };
}

/* ── 场景 ─────────────────────────────────────────────────────────── */
function mountScenes(pane, ctx) {
  const view = { shown: PAGE_SCENES };

  const bar = h("div", "nl-toolbar");
  const search = searchInput(prefsGet("scenes.query", ""), "搜索场景 / 标签", (v) => {
    prefsSet("scenes.query", v);
    view.shown = PAGE_SCENES;
    renderList();
  });
  bar.appendChild(search.el);

  const groups = (cache.scenes.groups || []).map((g) => ({ value: g.id, label: g.title }));
  bar.appendChild(selectEl([{ value: "", label: "全部分组" }, ...groups], prefsGet("scenes.group", ""), (v) => {
    prefsSet("scenes.group", v);
    view.shown = PAGE_SCENES;
    renderList();
  }));

  bar.appendChild(selectEl(
    [{ value: "all", label: "全部档位" }, ...LEVELS.filter((l) => l !== "any").map((l) => ({ value: l, label: LEVEL_LABELS[l] }))],
    prefsGet("scenes.level", "all"),
    (v) => {
      prefsSet("scenes.level", v);
      view.shown = PAGE_SCENES;
      renderList();
    },
  ));

  const favBtn = btn("只看收藏", {
    size: "sm",
    pressed: prefsGet("scenes.onlyFav", false),
    onClick: () => {
      const next = !prefsGet("scenes.onlyFav", false);
      prefsSet("scenes.onlyFav", next);
      favBtn.classList.toggle("on", next);
      favBtn.setAttribute("aria-pressed", String(next));
      view.shown = PAGE_SCENES;
      renderList();
    },
  });
  bar.appendChild(favBtn);

  const autoPick = checkbox("每次随机场景", !!getSetting("scene_pick", false), (checked) => {
    setSetting("scene_pick", checked);
    ctx.markStale();
  });
  bar.appendChild(autoPick);
  bar.appendChild(btn("清除套用", {
    size: "sm",
    onClick: () => {
      setSetting("pick_pool_mode", "");
      setSetting("pick_pool_ids", "");
      ctx.markStale();
      renderBanner();
      renderList();
      toast("已清除套用场景");
    },
  }));
  pane.appendChild(bar);

  const bannerWrap = h("div");
  pane.appendChild(bannerWrap);

  const listBox = h("div", "nl-list");
  pane.appendChild(listBox);

  function appliedIds() {
    return splitCSV(getSetting("pick_pool_ids", ""));
  }

  function applyScene(s) {
    setSetting("pick_pool_mode", "scene");
    setSetting("pick_pool_ids", s.id);
    pushRecent("scene", s.id);
    ctx.markStale();
    renderBanner();
    renderList();
    toast(`已套用「${s.zh}」，点「抽一次」查看效果`);
  }

  function renderBanner() {
    bannerWrap.replaceChildren();
    const ids = appliedIds();
    if (!ids.length) return;
    const rec = (cache.scenes.scenes || []).find((s) => s.id === ids[0]);
    const row = h("div", "nl-banner");
    row.appendChild(h("span", "", "当前套用："));
    row.appendChild(h("b", "", rec ? rec.zh : ids[0]));
    row.appendChild(h("span", "nl-grow"));
    row.appendChild(btn("取消", {
      size: "sm",
      onClick: () => {
        setSetting("pick_pool_mode", "");
        setSetting("pick_pool_ids", "");
        ctx.markStale();
        renderBanner();
        renderList();
      },
    }));
    bannerWrap.appendChild(row);
  }

  function renderRecent() {
    const ids = recents("scene").filter((id) => (cache.scenes.scenes || []).some((s) => s.id === id)).slice(0, 8);
    if (!ids.length) return null;
    const row = h("div", "nl-banner sub");
    row.appendChild(h("span", "", "最近："));
    ids.forEach((id) => {
      const rec = (cache.scenes.scenes || []).find((s) => s.id === id);
      const chip = h("button", "nl-chip", rec ? rec.zh : id);
      chip.type = "button";
      chip.addEventListener("click", () => applyScene(rec));
      row.appendChild(chip);
    });
    return row;
  }

  function filtered() {
    const q = String(prefsGet("scenes.query", "")).toLowerCase();
    const group = prefsGet("scenes.group", "");
    const lv = prefsGet("scenes.level", "all");
    const onlyFav = prefsGet("scenes.onlyFav", false);
    const favs = favorites("scene");
    return (cache.scenes.scenes || []).filter((s) => {
      if (onlyFav && !favs.has(s.id)) return false;
      if (group && s.group !== group) return false;
      if (lv && lv !== "all" && Number(s.level || 0) > (LEVEL_NUM[lv] || 0)) return false;
      if (!q) return true;
      return [s.zh, s.id, s.extra, ...Object.values(s.tags || {})].join(" ").toLowerCase().includes(q);
    });
  }

  function renderList() {
    const all = filtered();
    const shown = Math.max(PAGE_SCENES, view.shown);
    const list = all.slice(0, shown);
    const applied = appliedIds();
    const currentLevel = LEVEL_NUM[String(getSetting("nsfw_level", "sfw"))] || 0;
    listBox.replaceChildren();

    const recent = renderRecent();
    if (recent) listBox.appendChild(recent);

    if (!list.length) {
      listBox.appendChild(prefsGet("scenes.onlyFav", false)
        ? empty("还没有收藏的场景", "点卡片星标收藏")
        : empty("没有匹配的场景", "换个关键词或分组试试"));
      return;
    }

    const grid = h("div", "nl-grid scenes");
    list.forEach((s) => {
      const eligible = currentLevel >= Number(s.level || 0);
      const el = card({ on: applied.includes(s.id), cls: "stack", disabled: false });
      const top = h("div", "nl-card-top");
      top.appendChild(h("span", "nl-card-title", s.zh));
      if (Number(s.level) > 0) top.appendChild(levelBadge(s.level));
      el.appendChild(top);
      const group = (cache.scenes.groups || []).find((g) => g.id === s.group);
      el.appendChild(h("div", "nl-card-sub", group ? group.title : (s.group || "")));

      const tags = h("div", "nl-card-tags");
      const flat = [];
      Object.values(s.tags || {}).forEach((v) => flattenTags(v).forEach((t) => flat.push(t)));
      flattenTags(s.extra).forEach((t) => flat.push(t));
      flat.slice(0, 7).forEach((t) => tags.appendChild(h("span", "nl-tag", t)));
      el.appendChild(tags);

      const actions = h("div", "nl-card-actions");
      actions.appendChild(favStar("scene", s.id, () => { if (prefsGet("scenes.onlyFav", false)) renderList(); }));
      const use = btn("套用", { size: "sm", disabled: !eligible, onClick: (e) => { e.stopPropagation(); applyScene(s); } });
      if (!eligible) use.title = "当前内容档位下不可用";
      actions.appendChild(use);
      actions.appendChild(btn("预览", {
        size: "sm",
        disabled: !eligible,
        onClick: (e) => {
          e.stopPropagation();
          ctx.onRoll({ pick_pool_mode: "scene", pick_pool_ids: s.id, scene_pick: false });
        },
      }));
      el.appendChild(actions);
      if (!eligible) el.classList.add("off");
      grid.appendChild(el);
    });
    listBox.appendChild(grid);

    if (all.length > list.length) {
      const p = pager(list.length, all.length, () => {
        view.shown = shown + PAGE_SCENES;
        renderList();
      });
      p.update(list.length, all.length);
      listBox.appendChild(p.el);
    }
  }

  renderBanner();
  renderList();

  return {
    activate() { renderBanner(); renderList(); },
    refresh() { renderBanner(); renderList(); },
  };
}
