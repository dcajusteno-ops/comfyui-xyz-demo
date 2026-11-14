import { useMemo, useState } from "react";
import { Check, Search, Shirt, SlidersHorizontal, X } from "lucide-react";
import { AnimaSelect } from "../AnimaLibrary/AnimaSelect";
import { libraryCategories, libraryItems } from "../../../lib/wardrobe/outfitLibrary";
import { getWardrobeData } from "../../../lib/wardrobe/store";
import type { WardrobeUiState } from "../../../lib/wardrobe/types";

type Props = {
  state: WardrobeUiState;
  onToggleActive: (id: string) => void;
  onOverride: (field: "socks" | "shoes", value: string) => void;
  onSceneOverride: (value: boolean) => void;
};

/** 全局服装库（V6：135 套 / 11 类）。启用一套后由引擎在生成时接管服装字段。 */
export function WardrobeOutfitLibrary({ state, onToggleActive, onOverride, onSceneOverride }: Props) {
  const [cat, setCat] = useState("all");
  const [showFine, setShowFine] = useState(false);
  const [query, setQuery] = useState("");
  const categories = libraryCategories();
  const items = libraryItems();
  const active = state.outfitLibrary.active;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (cat !== "all" && item.cat !== cat) return false;
      if (!q) return true;
      if (String(item.zh ?? "").toLowerCase().includes(q)) return true;
      if (String(item.id ?? "").toLowerCase().includes(q)) return true;
      if (String(item.note ?? "").toLowerCase().includes(q)) return true;
      return (item.tags ?? []).some((tag) => String(tag).toLowerCase().includes(q));
    });
  }, [cat, items, query]);

  const activeItem = items.find((item) => item.id === active);
  const sockOpts = useMemo(() => optionList("socks"), []);
  const shoeOpts = useMemo(() => optionList("shoes"), []);
  const hasFine = Boolean(
    state.outfitLibrary.overrides.socks || state.outfitLibrary.overrides.shoes || state.outfitLibrary.sceneOverride,
  );

  return (
    <div className="wd-outfit-lib">
      <div className={`wd-outfit-lib-state${activeItem ? " is-on" : ""}`}>
        <span className="wd-lib-hero-icon">
          <Shirt size={15} />
        </span>
        <div className="wd-lib-hero-text">
          <strong>{activeItem ? activeItem.zh || activeItem.id : "未启用服装库"}</strong>
          <span>
            {activeItem
              ? "当前启用 · 已接管服装字段，抽到的衣服只出这一套"
              : "服装走随机 / 角色预设；点下方卡片即可启用一套"}
          </span>
        </div>
        {activeItem && (
          <button type="button" className="wd-lib-close" onClick={() => onToggleActive(activeItem.id)}>
            <X size={12} /> 关闭
          </button>
        )}
        <span className="wd-lib-total">{items.length} 套</span>
      </div>

      <div className="wd-lib-bar">
        <div className="wd-lib-cats" role="group" aria-label="服装分类">
          <button
            type="button"
            className={`wd-scene-group${cat === "all" ? " is-on" : ""}`}
            onClick={() => setCat("all")}
          >
            全部
          </button>
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`wd-scene-group${cat === item.id ? " is-on" : ""}`}
              onClick={() => setCat(item.id)}
              title={item.desc}
            >
              {item.zh}
            </button>
          ))}
        </div>
      </div>

      {showFine && (
        <div className="wd-lib-fine">
          <label className="wd-lib-inline">
            <span>丝袜</span>
            <AnimaSelect
              value={state.outfitLibrary.overrides.socks}
              options={[{ value: "", label: "跟随套装" }, ...sockOpts]}
              onChange={(value) => onOverride("socks", value)}
              ariaLabel="丝袜覆盖"
              size="sm"
            />
          </label>
          <label className="wd-lib-inline">
            <span>鞋子</span>
            <AnimaSelect
              value={state.outfitLibrary.overrides.shoes}
              options={[{ value: "", label: "跟随套装" }, ...shoeOpts]}
              onChange={(value) => onOverride("shoes", value)}
              ariaLabel="鞋子覆盖"
              size="sm"
            />
          </label>
          <label className="wd-mini-check" title="打开后服装库会压过场景里写死的推荐服装">
            <input
              type="checkbox"
              checked={state.outfitLibrary.sceneOverride}
              onChange={(event) => onSceneOverride(event.target.checked)}
            />
            覆盖场景推荐服装
          </label>
          <span className="wd-lib-rule">优先级：角色预设 › 服装库 › 随机</span>
        </div>
      )}

      <div className="wd-lib-toolbar">
        <label className="wd-search">
          <Search size={14} />
          <input
            value={query}
            placeholder="搜服装（名称 / 标签 / 备注）"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span className="wd-lib-hint">
          {filtered.length} / {items.length} 套{activeItem ? "" : " · 点卡片启用"}
        </span>
        <button
          type="button"
          className={`wd-lib-fine-btn${showFine || hasFine ? " is-on" : ""}`}
          onClick={() => setShowFine((prev) => !prev)}
          title="丝袜 / 鞋子覆盖、是否压过场景推荐服装"
          aria-expanded={showFine}
        >
          <SlidersHorizontal size={13} /> 微调{hasFine ? " · 已设" : ""}
        </button>
      </div>

      <div className="wd-outfit-lib-list">
        {filtered.map((item) => {
          const on = item.id === active;
          const catZh = categories.find((c) => c.id === item.cat)?.zh ?? item.cat;
          const tags = item.tags ?? [];
          return (
            <button
              key={item.id}
              type="button"
              className={`wd-outfit-lib-card${on ? " is-on" : ""}`}
              onClick={() => onToggleActive(item.id)}
              aria-pressed={on}
              title={on ? "点击取消启用" : "点击启用这一套"}
            >
              <span className="wd-lib-card-top">
                <b>{item.zh || item.id}</b>
                <span className={`wd-chip lv${item.level ?? 0}`}>{item.level ? `L${item.level}` : "全档"}</span>
                <span className="wd-lib-cat">{catZh}</span>
                {on && (
                  <span className="wd-outfit-lib-on">
                    <Check size={11} /> 已启用
                  </span>
                )}
              </span>
              <span className="wd-lib-card-tags">
                {tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="wd-scene-tag">
                    {tag}
                  </span>
                ))}
                {tags.length > 4 && <span className="wd-lib-more">+{tags.length - 4}</span>}
                {!tags.length && <span className="wd-muted">没有标签（只闭麦服装字段）</span>}
              </span>
              {item.note && (
                <span className="wd-lib-card-note" title={item.note}>
                  {item.note}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <div className="wd-empty">
          没有匹配的服装
          <button
            type="button"
            className="wd-link-btn"
            onClick={() => {
              setQuery("");
              setCat("all");
            }}
          >
            清除筛选
          </button>
        </div>
      )}
    </div>
  );
}

/** 下拉选项：直接从词库字段拿真值（null = 该字段没有选项）。 */
function optionList(fieldKey: string): Array<{ value: string; label: string }> {
  const pools = getWardrobeData("pools");
  const field = pools?.sections.flatMap((s) => s.fields).find((f) => f.key === fieldKey);
  return (field?.opts ?? []).map(([zh, en]) => ({
    value: String(en),
    label: zh && zh !== en ? `${zh}｜${en}` : String(en),
  }));
}
