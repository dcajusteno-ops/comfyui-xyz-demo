/* 词库字典：全局抽屉（不再是页签）。
   2,978 条选项的统一检索入口，支持复制 / 追加到手写补充 / 锁定字段。 */
import {
  h, btn, iconBtn, iconSpan, searchInput, selectEl, levelBadge, pager, empty, copyText, toast,
} from "./dom.js";
import {
  cache, LEVELS, LEVEL_LABELS, prefsGet, prefsSet, getSetting, setSetting, splitCSV,
  optionZh, optionTags, optionLevel, lockField, PAGE_DICT,
} from "./store.js";
import { openOverlay, topOverlay } from "./overlay.js";

function allOptions() {
  if (cache.allOptions) return cache.allOptions;
  const list = [];
  (cache.pools.sections || []).forEach((sec) => {
    (sec.fields || []).forEach((f) => {
      (f.opts || []).forEach((opt) => {
        list.push({
          zh: optionZh(opt),
          tag: optionTags(opt),
          level: optionLevel(opt),
          secId: sec.id,
          secName: sec.title || sec.name || sec.id,
          fieldKey: f.key,
          fieldLab: f.lab || f.key,
        });
      });
    });
  });
  cache.allOptions = list;
  return list;
}

export function openDictionary(ctx) {
  const existing = topOverlay();
  if (existing && existing.panel.classList.contains("nl-drawer")) return null;
  const items = allOptions();
  let shown = PAGE_DICT;
  let query = prefsGet("dict.query", "");
  let sec = prefsGet("dict.sec", "");
  let level = prefsGet("dict.level", "all");

  const handle = openOverlay({ cls: "nl-drawer", label: "词库字典" });
  const root = handle.panel;

  const head = h("div", "nl-drawer-hd");
  const title = h("div", "nl-drawer-title");
  title.appendChild(iconSpan("book"));
  title.appendChild(h("span", "", "词库字典"));
  const lockCount = h("span", "nl-note", "");
  title.appendChild(lockCount);
  head.appendChild(title);
  head.appendChild(h("span", "nl-grow"));
  head.appendChild(iconBtn("close", "关闭（Esc）", () => handle.close()));
  root.appendChild(head);

  const body = h("div", "nl-drawer-bd");

  const bar = h("div", "nl-toolbar");
  const search = searchInput(query, `搜索 ${items.length.toLocaleString("zh-CN")} 个标签（中文 / 英文 / 拼音）`, (v) => {
    query = v;
    shown = PAGE_DICT;
    prefsSet("dict.query", v);
    render();
  });
  bar.appendChild(search.el);

  const secOptions = [{ value: "", label: `全部大类（${items.length}）` }].concat(
    (cache.pools.sections || []).map((s) => {
      const count = (s.fields || []).reduce((acc, f) => acc + (f.opts || []).length, 0);
      return { value: s.id, label: `${s.title || s.name || s.id}（${count}）` };
    }),
  );
  bar.appendChild(selectEl(secOptions, sec, (v) => {
    sec = v;
    shown = PAGE_DICT;
    prefsSet("dict.sec", v);
    render();
  }));

  bar.appendChild(selectEl(
    [{ value: "all", label: "全部档位" }].concat(
      LEVELS.filter((l) => l !== "any").map((l) => ({ value: String(LEVELS.indexOf(l)), label: LEVEL_LABELS[l] })),
    ),
    level,
    (v) => {
      level = v;
      shown = PAGE_DICT;
      prefsSet("dict.level", v);
      render();
    },
  ));
  body.appendChild(bar);

  const stat = h("div", "nl-subhead", "");
  body.appendChild(stat);
  const listBox = h("div", "nl-dict-list");
  body.appendChild(listBox);
  root.appendChild(body);

  function updateLockCount() {
    const n = splitCSV(getSetting("lock_fields", "")).length;
    lockCount.textContent = n ? `已锁定 ${n} 个字段` : "";
  }

  function filtered() {
    const q = query.toLowerCase().trim();
    return items.filter((item) => {
      if (sec && item.secId !== sec) return false;
      if (level !== "all" && String(item.level) !== level) return false;
      if (!q) return true;
      return item.zh.toLowerCase().includes(q) ||
        item.tag.toLowerCase().includes(q) ||
        item.fieldLab.toLowerCase().includes(q) ||
        item.secName.toLowerCase().includes(q);
    });
  }

  function render() {
    updateLockCount();
    const list = filtered();
    stat.textContent = `共 ${list.length.toLocaleString("zh-CN")} 个标签`;
    listBox.replaceChildren();

    if (!list.length) {
      listBox.appendChild(empty("没有匹配的标签", "换个关键词，或把大类/档位切回「全部」"));
      return;
    }

    const page = list.slice(0, shown);
    const grid = h("div", "nl-grid dict-grid");
    page.forEach((item) => {
      const card = h("div", "nl-card dict-card");
      const top = h("div", "nl-card-top");
      top.appendChild(h("span", "nl-badge nl-badge-cat", `${item.secName} · ${item.fieldLab}`));
      if (Number(item.level) > 0) top.appendChild(levelBadge(item.level));
      card.appendChild(top);
      card.appendChild(h("div", "nl-dict-zh", item.zh));
      card.appendChild(h("div", "nl-dict-tag", item.tag));

      const actions = h("div", "nl-dict-actions");
      actions.appendChild(btn("复制", {
        size: "sm",
        title: "复制英文 tag",
        onClick: () => copyText(item.tag, `已复制 ${item.tag}`),
      }));
      actions.appendChild(btn("+ 手写", {
        size: "sm",
        title: "追加到手写补充",
        onClick: () => {
          const cur = String(getSetting("extra_body", "")).trim();
          const next = cur ? `${cur}, ${item.tag}` : item.tag;
          setSetting("extra_body", next);
          ctx.onSettingsChanged();
          toast(`已追加到手写补充：${item.tag}`);
        },
      }));
      actions.appendChild(btn("锁定", {
        size: "sm",
        title: "锁定该字段，后续固定抽取这一项",
        onClick: () => {
          const found = findField(item.fieldKey);
          lockField(item.fieldKey, item.tag, found);
          ctx.onWeightsChanged();
          updateLockCount();
          toast(`已锁定：${item.zh}（可在「细节 > 全部字段」查看）`);
        },
      }));
      card.appendChild(actions);
      grid.appendChild(card);
    });
    listBox.appendChild(grid);

    if (list.length > page.length) {
      const p = pager(page.length, list.length, () => {
        shown += PAGE_DICT;
        render();
      });
      p.update(page.length, list.length);
      listBox.appendChild(p.el);
    }
  }

  function findField(key) {
    for (const s of cache.pools.sections || []) {
      const hit = (s.fields || []).find((f) => f.key === key);
      if (hit) return hit;
    }
    return null;
  }

  render();
  return handle;
}
