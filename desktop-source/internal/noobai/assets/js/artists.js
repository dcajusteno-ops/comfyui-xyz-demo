/* 画师页：600 位精选顶流名家（配高清双图、中文名、风格详解） + 42,000+ Danbooru 全网画师索引搜索。
   支持双图悬停无缝切图、风格筛选、热度/名称排序、收藏、随机抽取。 */
import {
  h, btn, searchInput, selectEl, levelBadge, pager, empty, toast,
} from "./dom.js";
import {
  cache, PAGE_ARTISTS, prefsGet, prefsSet, favorites, recents, toggleFavorite, pushRecent,
  getSetting, setSetting, splitCSV,
} from "./store.js";
import { getJSON } from "./api.js";
import { favStar } from "./fav.js";

const MAX_PICK = 2;

export function mountArtists(pane, ctx) {
  const view = {
    results: null,
    indexTotal: 0,
    loading: false,
    shown: PAGE_ARTISTS,
    cards: new Map(),
    seq: 0,
  };

  const bar = h("div", "nl-toolbar");

  // 1. 范围切换器：精选名家 (600) vs 全量索引 (42,000+)
  const totalAllCount = (cache.artists && cache.artists.total_index_count) || 42197;
  const scopeWrap = h("div", "nl-levels");
  scopeWrap.setAttribute("role", "group");
  scopeWrap.setAttribute("aria-label", "画师库范围切换");

  const curScope = () => prefsGet("artists.scope", "curated");

  const bCurated = h("button", "nl-lvbtn", "🌟 精选名家 (600)");
  bCurated.type = "button";
  bCurated.setAttribute("aria-pressed", String(curScope() !== "all"));
  bCurated.title = "精选顶流名家：配高清双图代表作预览、中文名及画风详解（共 600 位）";
  bCurated.addEventListener("click", () => {
    if (curScope() !== "curated") {
      prefsSet("artists.scope", "curated");
      bCurated.setAttribute("aria-pressed", "true");
      bAll.setAttribute("aria-pressed", "false");
      view.shown = PAGE_ARTISTS;
      const q = prefsGet("artists.query", "");
      if (q) queueSearch(q);
      else { view.results = null; view.loading = false; renderList(); }
      renderScopeBanner();
    }
  });

  const bAll = h("button", "nl-lvbtn", `📚 全量索引 (${totalAllCount.toLocaleString()} 位)`);
  bAll.type = "button";
  bAll.setAttribute("aria-pressed", String(curScope() === "all"));
  bAll.title = `Danbooru 全量画师索引：共 ${totalAllCount.toLocaleString()} 位画师，按热度降序，支持无限分页加载`;
  bAll.addEventListener("click", () => {
    if (curScope() !== "all") {
      prefsSet("artists.scope", "all");
      bCurated.setAttribute("aria-pressed", "false");
      bAll.setAttribute("aria-pressed", "true");
      view.shown = PAGE_ARTISTS;
      queueSearch(prefsGet("artists.query", ""), true);
      renderScopeBanner();
    }
  });

  scopeWrap.appendChild(bCurated);
  scopeWrap.appendChild(bAll);
  bar.appendChild(scopeWrap);

  // 2. 搜索框
  const search = searchInput(
    prefsGet("artists.query", ""),
    `搜索画师（中文/英文/拼音），含 ${totalAllCount.toLocaleString()} 全量画师库…`,
    (v) => {
      prefsSet("artists.query", v);
      view.shown = PAGE_ARTISTS;
      if (v || curScope() === "all") queueSearch(v);
      else {
        view.results = null;
        view.indexTotal = 0;
        view.loading = false;
        renderList();
      }
    }
  );
  bar.appendChild(search.el);

  // 3. 风格筛选
  const styles = (cache.artists && cache.artists.styles) || [
    "唯美厚涂", "二次元萌系", "轻小说插画", "赛博机械", "经典复古", "水彩梦幻",
  ];
  const styleOpts = [
    { value: "", label: "全部风格" },
    ...styles.map((s) => ({ value: s, label: s })),
  ];
  bar.appendChild(selectEl(styleOpts, prefsGet("artists.style", ""), (v) => {
    prefsSet("artists.style", v);
    view.shown = PAGE_ARTISTS;
    if (prefsGet("artists.query", "") || curScope() === "all") {
      queueSearch(prefsGet("artists.query", ""));
    } else {
      renderList();
    }
  }, { title: "按风格筛选" }));

  // 4. 排序方式
  bar.appendChild(selectEl([
    { value: "hot", label: "按热度 (作品数)" },
    { value: "name", label: "按名称排序" },
  ], prefsGet("artists.sort", "hot"), (v) => {
    prefsSet("artists.sort", v);
    view.shown = PAGE_ARTISTS;
    if (prefsGet("artists.query", "") || curScope() === "all") {
      queueSearch(prefsGet("artists.query", ""));
    } else {
      renderList();
    }
  }, { title: "排序方式" }));

  // 5. 只看收藏
  const favBtn = btn("只看收藏", {
    size: "sm",
    pressed: prefsGet("artists.onlyFav", false),
    onClick: () => {
      const next = !prefsGet("artists.onlyFav", false);
      prefsSet("artists.onlyFav", next);
      favBtn.classList.toggle("on", next);
      favBtn.setAttribute("aria-pressed", String(next));
      view.shown = PAGE_ARTISTS;
      renderList();
    },
  });
  bar.appendChild(favBtn);

  // 6. 随机画师
  bar.appendChild(btn("随机画师", {
    size: "sm",
    title: "随机选择一位画师",
    onClick: () => {
      if (curScope() === "all") {
        const st = prefsGet("artists.style", "");
        getJSON(`/artist_random?scope=all&style=${encodeURIComponent(st)}`)
          .then((res) => {
            if (res && res.artist) {
              setSelected([res.artist.tag]);
              toast(`已随机选择画师: ${res.artist.zh || res.artist.tag}`);
            }
          })
          .catch(() => toast("随机抽取画师失败", true));
        return;
      }
      const pool = filtered();
      if (!pool.length) { toast("当前筛选没有画师", true); return; }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      setSelected([pick.tag]);
      toast(`已选择画师: ${pick.zh || pick.tag}`);
    },
  }));

  // 7. 清空选择
  bar.appendChild(btn("清空选择", {
    size: "sm",
    onClick: () => {
      setSelected([]);
    },
  }));

  // 8. 启用随机抽取画师（节点抽词开关）
  const autoPickLabel = h("label", "nl-check-label");
  const autoPickCheck = h("input", "nl-checkbox");
  autoPickCheck.type = "checkbox";
  autoPickCheck.checked = Boolean(getSetting("artist_pick", false));
  autoPickCheck.addEventListener("change", () => {
    setSetting("artist_pick", autoPickCheck.checked);
  });
  autoPickLabel.appendChild(autoPickCheck);
  autoPickLabel.appendChild(h("span", "", "自动随机抽取画师"));
  autoPickLabel.title = "生成提示词时若未指定画师，按设定风格自动抽取 1 位名家风格";
  bar.appendChild(autoPickLabel);

  pane.appendChild(bar);

  // 模式说明与统计横幅
  const scopeBanner = h("div", "nl-artist-scope-banner");
  function renderScopeBanner() {
    if (curScope() === "all") {
      scopeBanner.innerHTML = `<span><span class="nl-badge-hot">📚 全量索引模式</span> 已接入 <strong>Danbooru 全网 ${totalAllCount.toLocaleString()} 位画师</strong>（按帖子量热度从高到低排列，支持无限分页浏览）</span>`;
    } else {
      scopeBanner.innerHTML = `<span><span class="nl-badge-hot">🌟 精选名家模式</span> 已展示 <strong>600 位核心顶流名家</strong>（配中文译名、双图悬停切图、风格标签与风格解析）。需要浏览全网画师请点上方【全量索引】或直接搜索。</span>`;
    }
  }
  renderScopeBanner();
  pane.appendChild(scopeBanner);

  // 已选画师栏 + 最近使用
  const selectedBox = h("div", "nl-selected-box");
  pane.appendChild(selectedBox);

  const recentBox = h("div", "nl-recent-box");
  pane.appendChild(recentBox);

  // 列表容器
  const listBox = h("div", "nl-list-box");
  pane.appendChild(listBox);

  function selected() {
    return new Set(splitCSV(getSetting("selected_artists", "")));
  }

  function setSelected(tags) {
    const next = tags.slice(0, MAX_PICK);
    setSetting("selected_artists", next.join(", "));
    next.forEach((t) => pushRecent("artist", t));
    renderSelected();
    syncCards();
  }

  function toggle(tag) {
    const set = selected();
    if (set.has(tag)) set.delete(tag);
    else {
      if (set.size >= MAX_PICK) {
        const arr = Array.from(set);
        arr.shift();
        arr.push(tag);
        setSelected(arr);
        return;
      }
      set.add(tag);
    }
    setSelected(Array.from(set));
  }

  function findArtist(tag) {
    const list = (cache.artists && cache.artists.artists) || [];
    const hit = list.find((a) => a.tag === tag);
    if (hit) return hit;
    if (view.results) {
      const sHit = view.results.find((a) => a.tag === tag);
      if (sHit) return sHit;
    }
    return { tag, zh: tag };
  }

  function renderSelected() {
    renderSelectedBanner();
    renderRecents();
  }

  function renderSelectedBanner() {
    const set = selected();
    selectedBox.replaceChildren();
    if (!set.size) return;

    const banner = h("div", "nl-banner");
    banner.appendChild(h("span", "", "已选画师："));
    set.forEach((tag) => {
      const a = findArtist(tag);
      const chip = h("button", "nl-chip", (a && a.zh) ? a.zh : tag);
      chip.type = "button";
      chip.title = "点击移除画师";
      chip.addEventListener("click", () => toggle(tag));
      banner.appendChild(chip);
    });
    banner.appendChild(h("span", "nl-grow"));
    banner.appendChild(h("span", "nl-note", "最多 2 位；支持 WLOP、深井凉介、Ciloranko 等融合风格"));
    selectedBox.appendChild(banner);
  }

  function renderRecents() {
    const list = recents("artist");
    recentBox.replaceChildren();
    if (!list.length) return;

    const wrap = h("div", "nl-recent-row");
    wrap.appendChild(h("span", "nl-note", "最近使用："));
    list.slice(0, 10).forEach((tag) => {
      const a = findArtist(tag);
      const chip = h("button", "nl-chip", (a && a.zh) ? a.zh : tag);
      chip.type = "button";
      chip.title = `点击选择 ${tag}`;
      chip.addEventListener("click", () => toggle(tag));
      wrap.appendChild(chip);
    });
    recentBox.appendChild(wrap);
  }

  function syncCards() {
    const set = selected();
    view.cards.forEach((entry, tag) => {
      const on = set.has(tag);
      entry.card.classList.toggle("on", on);
      entry.card.setAttribute("aria-pressed", String(on));
    });
  }

  function filtered() {
    if (curScope() === "all" || prefsGet("artists.query", "")) {
      return view.results || [];
    }
    const list = (cache.artists && cache.artists.artists) || [];
    const style = prefsGet("artists.style", "");
    const onlyFav = prefsGet("artists.onlyFav", false);
    const favSet = favorites("artist");
    const sort = prefsGet("artists.sort", "hot");

    let pool = list.filter((a) => {
      if (style && a.style !== style) return false;
      if (onlyFav && !favSet.has(a.tag)) return false;
      return true;
    });

    if (sort === "name") {
      pool = pool.slice().sort((a, b) => (a.zh || a.tag).localeCompare(b.zh || b.tag, "zh-Hans-CN"));
    } else {
      pool = pool.slice().sort((a, b) => (b.post_count || 0) - (a.post_count || 0));
    }
    return pool;
  }

  let searchTimer = null;
  function queueSearch(q, immediate = false) {
    clearTimeout(searchTimer);
    const run = () => {
      const mySeq = ++view.seq;
      view.loading = true;
      renderList();

      const scope = curScope();
      const style = prefsGet("artists.style", "");
      const sort = prefsGet("artists.sort", "hot");
      const url = `/artist_search?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(scope)}&style=${encodeURIComponent(style)}&sort=${encodeURIComponent(sort)}&limit=120`;

      getJSON(url)
        .then((res) => {
          if (mySeq !== view.seq) return;
          view.loading = false;
          view.results = (res && res.artists) || [];
          view.indexTotal = (res && res.total) || 0;
          renderList();
        })
        .catch(() => {
          if (mySeq !== view.seq) return;
          view.loading = false;
          view.results = [];
          renderList();
        });
    };

    if (immediate) run();
    else searchTimer = setTimeout(run, 280);
  }

  function makeCard(a, picked) {
    const on = picked.has(a.tag);
    const card = h("div", "artist-card" + (on ? " on" : ""));
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-pressed", String(on));
    card.title = `${a.tag}\n${a.desc || ""}`;
    card.addEventListener("click", () => toggle(a.tag));

    // 1. 缩略图封面 (3:4 比例代表作预览)
    if (a.has_thumb && a.id) {
      const cover = h("div", "nl-artist-cover");
      const img = h("img", "nl-artist-img");
      img.loading = "lazy";
      img.alt = a.zh || a.tag;
      img.src = `/api/artist_thumb?id=${encodeURIComponent(a.id)}&v=p1`;

      card.addEventListener("mouseenter", () => {
        img.src = `/api/artist_thumb?id=${encodeURIComponent(a.id)}&v=p2`;
      });
      card.addEventListener("mouseleave", () => {
        img.src = `/api/artist_thumb?id=${encodeURIComponent(a.id)}&v=p1`;
      });

      img.onerror = () => {
        img.remove();
        cover.classList.add("placeholder");
        const inner = h("div", "nl-artist-placeholder-inner");
        const av = h("span", "nl-artist-placeholder-av", (a.zh || a.tag).slice(0, 1).toUpperCase());
        av.style.background = `hsl(${hashHue(a.tag)} 62% 66%)`;
        inner.appendChild(av);
        inner.appendChild(h("span", "nl-artist-placeholder-tag", a.tag));
        cover.insertBefore(inner, cover.firstChild);
      };

      cover.appendChild(img);

      if (a.style) {
        cover.appendChild(h("span", "nl-badge-artist cover-badge", a.style));
      }
      cover.appendChild(favStar("artist", a.tag, () => {
        if (prefsGet("artists.onlyFav", false)) renderList();
      }));

      const hint = h("span", "nl-artist-variant-hint", "双图悬停切");
      cover.appendChild(hint);

      card.appendChild(cover);
    } else {
      // 占位封面 (统一 3:4 比例)
      const cover = h("div", "nl-artist-cover placeholder");
      const inner = h("div", "nl-artist-placeholder-inner");
      const av = h("span", "nl-artist-placeholder-av", (a.zh || a.tag).slice(0, 1).toUpperCase());
      av.style.background = `hsl(${hashHue(a.tag)} 62% 66%)`;
      inner.appendChild(av);
      inner.appendChild(h("span", "nl-artist-placeholder-tag", a.tag));
      cover.appendChild(inner);

      if (a.style) {
        cover.appendChild(h("span", "nl-badge-artist cover-badge", a.style));
      }
      cover.appendChild(favStar("artist", a.tag, () => {
        if (prefsGet("artists.onlyFav", false)) renderList();
      }));
      card.appendChild(cover);
    }

    // 2. 标题行与信息
    const info = h("div", "nl-card-top");
    const names = h("div", "nl-card-title");
    const nameRow = h("div", "nl-card-name");
    nameRow.appendChild(h("span", "", a.zh || a.tag));
    if (a.pinyin_abbr) {
      nameRow.appendChild(h("span", "nl-py-badge", a.pinyin_abbr));
    }
    names.appendChild(nameRow);

    const subTag = h("div", "nl-artist-tag", a.tag);
    names.appendChild(subTag);
    info.appendChild(names);
    card.appendChild(info);

    if (a.desc) {
      card.appendChild(h("div", "nl-artist-desc", a.desc));
    } else if (a.post_count) {
      card.appendChild(h("div", "nl-artist-desc", `Danbooru 收录作品 ${a.post_count.toLocaleString()} 篇`));
    }

    const meta = h("div", "nl-artist-meta");
    if (a.style) {
      meta.appendChild(h("span", "nl-badge-artist", a.style));
    } else {
      meta.appendChild(h("span", "", ""));
    }
    if (a.post_count) {
      meta.appendChild(h("span", "", `${a.post_count.toLocaleString()} 篇`));
    }
    card.appendChild(meta);

    return card;
  }

  function renderList() {
    const isServerMode = (curScope() === "all" || Boolean(prefsGet("artists.query", "")));
    const all = filtered();
    const shown = Math.max(PAGE_ARTISTS, view.shown);
    const list = isServerMode ? all : all.slice(0, shown);

    view.cards.clear();
    listBox.replaceChildren();

    if (view.loading) {
      listBox.appendChild(h("div", "nl-note", `正在从 ${totalAllCount.toLocaleString()} 位全量画师库检索…`));
    } else if (prefsGet("artists.query", "") && view.results) {
      listBox.appendChild(h("div", "nl-note",
        `全量索引命中 ${view.indexTotal.toLocaleString()} 位 · 已显示 ${view.results.length} 位（继续输入缩小范围）`));
    }

    if (!list.length) {
      listBox.appendChild(prefsGet("artists.onlyFav", false)
        ? empty("还没有收藏的画师", "点卡片右上角星标收藏")
        : empty("没有匹配的画师", "试试输入中文名、拼音缩写或英文 tag 搜索"));
      return;
    }

    const grid = h("div", "nl-grid artists");
    const picked = selected();
    list.forEach((a) => {
      const el = makeCard(a, picked);
      view.cards.set(a.tag, { card: el });
      grid.appendChild(el);
    });
    listBox.appendChild(grid);

    if (!isServerMode && all.length > list.length) {
      const p = pager(list.length, all.length, () => {
        view.shown = shown + PAGE_ARTISTS;
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
  let hash = 0;
  for (let i = 0; i < (text || "").length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash) % 360;
}
