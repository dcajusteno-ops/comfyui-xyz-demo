/* 收藏星标：角色 / 服装 / 场景共用一份实现，避免三个页签各写一遍。 */
import { h, toast } from "./dom.js";
import { favorites, toggleFavorite } from "./store.js";

const STAR_SVG = '<svg class="nl-ico" viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg>';

export function favStar(kind, id, onToggle) {
  const on = favorites(kind).has(id);
  const star = h("button", "nl-fav" + (on ? " on" : ""));
  star.type = "button";
  star.title = on ? "取消收藏" : "收藏";
  star.setAttribute("aria-label", star.title);
  star.setAttribute("aria-pressed", String(on));
  star.innerHTML = STAR_SVG;
  star.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      const next = await toggleFavorite(kind, id);
      star.classList.toggle("on", next);
      star.setAttribute("aria-pressed", String(next));
      star.title = next ? "取消收藏" : "收藏";
      star.setAttribute("aria-label", star.title);
      if (onToggle) onToggle(next);
    } catch (err) {
      toast("收藏保存失败：" + err.message, true);
    }
  });
  return star;
}
