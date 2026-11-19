/* 角色页：本地 754 位精选 + 服务端全量索引搜索（14k+）。
   列表重绘只发生在筛选变化时；选中/收藏只原地改卡片，不动输入框与滚动位置。 */
import {
  h, btn, searchInput, selectEl, card, levelBadge, pager, empty, toast,
} from "./dom.js";
import {
  cache, PAGE_CHARS, prefsGet, prefsSet, favorites, recents, toggleFavorite, pushRecent,
  getSetting, setSetting, emit,
} from "./store.js";
import { getJSON } from "./api.js";
import { favStar } from "./fav.js";

const MAX_PICK = 2;

export function mountChars(pane, ctx) {
  const view = {
    results: null,
    indexTotal: 0,
    loading: false,
    shown: PAGE_CHARS,
    cards: new Map(),
    seq: 0,
  };

  const bar = h("div", "nl-toolbar");
  const search = searchInput(prefsGet("chars.query", ""), "搜索角色 / 作品 / 中文名（含全量索引）", (v) => {
    prefsSet("chars.query", v);
    view.shown = PAGE_CHARS;
    if (v) queueSearch(v);
    else {
      view.results = null;
      view.indexTotal = 0;
      view.loading = false;
      renderList();
    }
  });
  bar.appendChild(search.el);

  const works = (cache.characters.works || []).map((w) => ({
    value: w.work, label: `${w.work_zh}（${w.count}）`,
  }));
  bar.appendChild(selectEl([{ value: "", label: "全部作品" }, ...works], prefsGet("chars.work", ""), (v) => {
    prefsSet("chars.work", v);
    view.shown = PAGE_CHARS;
    renderList();
  }, { title: "按作品筛选" }));

  bar.appendChild(selectEl([
    { value: "", label: "全部性别" },
    { value: "female", label: "仅看女性" },
    { value: "male", label: "仅看男性" },
  ], prefsGet("chars.gender", ""), (v) => {
    prefsSet("chars.gender", v);
    view.shown = PAGE_CHARS;
    renderList();
  }));

  const favBtn = btn("只看收藏", {
    size: "sm",
    pressed: prefsGet("chars.onlyFav", false),
    onClick: () => {
      const next = !prefsGet("chars.onlyFav", false);
      prefsSet("chars.onlyFav", next);
      favBtn.classList.toggle("on", next);
      favBtn.setAttribute("aria-pressed", String(next));
      view.shown = PAGE_CHARS;
      renderList();
    },
  });
  bar.appendChild(favBtn);

  bar.appendChild(btn("随机一位", {
    size: "sm",
    title: "在当前筛选结果里随机选一位",
    onClick: () => {
      const pool = filtered();
      if (!pool.length) { toast("当前筛选没有角色", true); return; }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      setSelected([pick.tag]);
    },
  }));
  bar.appendChild(btn("清空选择", { size: "sm", onClick: () => setSelected([]) }));

  const pickInfo = h("span", "nl-note");
  bar.appendChild(h("span", "nl-grow"));
  bar.appendChild(pickInfo);
  pane.appendChild(bar);

  const recentBox = h("div", "nl-banner-wrap");
  pane.appendChild(recentBox);

  const listBox = h("div", "nl-list");
  pane.appendChild(listBox);

  function selected() {
    return new Set(splitSelected(getSetting("selected_roles", "")));
  }

  function splitSelected(raw) {
    return String(raw || "").split("|").map((s) => s.trim()).filter(Boolean);
  }

  function setSelected(tags) {
    setSetting("selected_roles", tags.join("|"));
    renderSelected();
    syncCards();
  }

  function toggle(tag) {
    const set = selected();
    if (set.has(tag)) set.delete(tag);
    else {
      if (set.size >= MAX_PICK) { toast(`最多同时选择 ${MAX_PICK} 位角色`, true); return; }
      set.add(tag);
      pushRecent("char", tag);
    }
    setSelected(Array.from(set));
  }

  function queueSearch(q) {
    const seq = ++view.seq;
    view.loading = true;
    renderNote();
    getJSON(`/character_search?q=${encodeURIComponent(q)}&limit=120`)
      .then((res) => {
        if (seq !== view.seq) return;
        view.results = res.characters || [];
        view.indexTotal = res.total || 0;
        view.loading = false;
        renderList();
      })
      .catch(() => {
        if (seq !== view.seq) return;
        view.results = [];
        view.indexTotal = 0;
        view.loading = false;
        renderList();
      });
  }

  function filtered() {
    const q = String(prefsGet("chars.query", "")).toLowerCase().trim();
    const work = prefsGet("chars.work", "");
    const gender = prefsGet("chars.gender", "");
    const onlyFav = prefsGet("chars.onlyFav", false);
    const favs = favorites("char");
    const pool = (q && view.results) ? view.results : (cache.characters.characters || []);
    return pool.filter((c) => {
      if (onlyFav && !favs.has(c.tag)) return false;
      if (work && c.work !== work) return false;
      if (gender === "male" && !String(c.core || "").includes("1boy")) return false;
      if (gender === "female" && String(c.core || "").includes("1boy")) return false;
      if (!q) return true;
      const aliases = Array.isArray(c.aliases) ? c.aliases : [];
      return [c.tag, c.zh, c.work, c.work_zh, c.pinyin_abbr, ...aliases]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q));
    });
  }

  function findChar(tag) {
    const hit = (cache.characters.characters || []).find((c) => c.tag === tag);
    if (hit) return hit;
    return (view.results || []).find((c) => c.tag === tag) || null;
  }

  function renderNote() {
    if (!view.loading) return;
    pickInfo.textContent = "正在搜索全量索引…";
  }

  function renderSelected() {
    const set = selected();
    pickInfo.textContent = set.size ? `已选 ${set.size} / ${MAX_PICK}` : "";
    const box = h("div", "nl-banner");
    if (set.size) {
      box.appendChild(h("span", "", "已选角色："));
      set.forEach((tag) => {
        const rec = findChar(tag);
        const chip = h("button", "nl-chip", rec ? rec.zh : tag);
        chip.type = "button";
        chip.title = `${tag}（点击移除）`;
        chip.addEventListener("click", () => toggle(tag));
        box.appendChild(chip);
      });
      box.appendChild(h("span", "nl-grow"));
      box.appendChild(h("span", "nl-note", "最多 2 位；已选角色优先于「每次自动换人」"));
    }

    const recent = recents("char").filter((id) => findChar(id)).slice(0, 8);
    const wrap = h("div");
    if (recent.length) {
      const row = h("div", "nl-banner sub");
      row.appendChild(h("span", "", "最近："));
      recent.forEach((id) => {
        const rec = findChar(id);
        const chip = h("button", "nl-chip", rec.zh || id);
        chip.type = "button";
        chip.title = id;
        chip.addEventListener("click", () => setSelected([id]));
        row.appendChild(chip);
      });
      wrap.appendChild(row);
    }
    if (set.size) wrap.appendChild(box);
    recentBox.replaceChildren();
    while (wrap.firstChild) recentBox.appendChild(wrap.firstChild);
  }

  function syncCards() {
    const set = selected();
    view.cards.forEach((entry, tag) => {
      const on = set.has(tag);
      entry.card.classList.toggle("on", on);
      entry.card.setAttribute("aria-pressed", String(on));
    });
  }

  function makeCard(c, picked) {
    const on = picked.has(c.tag);
    const el = card({
      on,
      pressed: on,
      title: `${c.tag}\n${c.work || ""}`,
      onClick: () => toggle(c.tag),
    });
    const top = h("div", "nl-card-top");
    const av = h("span", "nl-avatar", (c.zh || c.tag).slice(0, 1));
    av.style.background = `hsl(${hashHue(c.tag)} 42% 44%)`;
    top.appendChild(av);
    const names = h("div", "nl-card-title");
    const nameRow = h("div", "nl-card-name");
    nameRow.appendChild(h("span", "", c.zh || c.tag));
    if (c.pinyin_abbr) nameRow.appendChild(h("span", "nl-py-badge", c.pinyin_abbr));
    names.appendChild(nameRow);
    const sub = h("div", "nl-card-sub", c.work_zh || c.work || "");
    if (Array.isArray(c.aliases) && c.aliases.length) sub.title = `别名：${c.aliases.join(" / ")}`;
    names.appendChild(sub);
    top.appendChild(names);
    top.appendChild(favStar("char", c.tag, () => { if (prefsGet("chars.onlyFav", false)) renderList(); }));
    el.appendChild(top);

    const tags = h("div", "nl-card-tags");
    (c.appearance || []).slice(0, 3).forEach((t) => tags.appendChild(h("span", "nl-tag", t)));
    el.appendChild(tags);

    if (Number(c.level) > 0) {
      const lv = h("span", "nl-card-lv");
      lv.appendChild(levelBadge(c.level));
      el.appendChild(lv);
    }
    return el;
  }

  function renderList() {
    const all = filtered();
    const shown = Math.max(PAGE_CHARS, view.shown);
    const list = all.slice(0, shown);
    view.cards.clear();
    listBox.replaceChildren();

    if (view.loading) {
      listBox.appendChild(h("div", "nl-note", "正在搜索全量角色索引…"));
    } else if (prefsGet("chars.query", "") && view.results) {
      listBox.appendChild(h("div", "nl-note",
        `全量索引命中 ${view.indexTotal} 位 · 已显示 ${view.results.length} 位（继续输入可缩小范围）`));
    }

    if (!list.length) {
      listBox.appendChild(prefsGet("chars.onlyFav", false)
        ? empty("还没有收藏的角色", "点卡片右上角星标收藏")
        : empty("没有匹配的角色", "试试只输入一两个字，或换一个作品筛选"));
      return;
    }

    const grid = h("div", "nl-grid chars");
    const picked = selected();
    list.forEach((c) => {
      const el = makeCard(c, picked);
      view.cards.set(c.tag, { card: el });
      grid.appendChild(el);
    });
    listBox.appendChild(grid);

    if (all.length > list.length) {
      const p = pager(list.length, all.length, () => {
        view.shown = shown + PAGE_CHARS;
        renderList();
      });
      p.update(list.length, all.length);
      listBox.appendChild(p.el);
    }
  }

  renderSelected();
  renderList();

  return {
    activate() {
      renderSelected();
      renderList();
    },
    refresh() {
      renderSelected();
      renderList();
    },
  };
}

function hashHue(text) {
  let hue = 0;
  for (let i = 0; i < text.length; i += 1) hue = (hue * 31 + text.charCodeAt(i)) % 360;
  return hue;
}
