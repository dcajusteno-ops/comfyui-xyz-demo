import { useMemo, useState } from "react";
import { Film, Heart, Search, Star, Wand2, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { sceneAspect, sceneGroups, sceneList } from "../../../lib/wardrobe/scenes";
import { setUi } from "../../../lib/wardrobe/state";
import type { WardrobeScene, WardrobeUiState } from "../../../lib/wardrobe/types";

type Props = {
  state: WardrobeUiState;
  setState: Dispatch<SetStateAction<WardrobeUiState>>;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  onApply: (scene: WardrobeScene) => void;
  onClear: () => void;
};

type AspectFilter = "all" | "portrait" | "landscape";

/** 画幅徽标：竖 / 横 / 通（v5.0.1 旁挂表）。 */
const ASPECT_LABEL: Record<string, string> = { portrait: "竖", landscape: "横", both: "通" };

export function WardrobeSceneLibrary({ state, setState, favorites, onToggleFavorite, onApply, onClear }: Props) {
  const groups = sceneGroups();
  const scenes = sceneList();
  const [favOnly, setFavOnly] = useState(false);
  const [aspect, setAspect] = useState<AspectFilter>("all");
  const query = state.ui.sceneQuery.trim().toLowerCase();
  const group = state.ui.sceneGroup;

  const filtered = useMemo(
    () =>
      scenes.filter((scene) => {
        if (scene.group !== group) return false;
        if (favOnly && !favorites.has(scene.id)) return false;
        if (aspect !== "all") {
          const value = sceneAspect(scene.id);
          // 竖屏·通用 = portrait + both；横屏·通用 = landscape + both
          if (value !== aspect && value !== "both") return false;
        }
        if (!query) return true;
        return (
          scene.zh.toLowerCase().includes(query) ||
          (scene.desc ?? "").toLowerCase().includes(query) ||
          (scene.theme ?? "").toLowerCase().includes(query) ||
          scene.id.toLowerCase().includes(query)
        );
      }),
    [aspect, favOnly, favorites, group, query, scenes],
  );

  const activeScene = state.weights.options.n_canon
    ? Object.entries(state.weights.options.n_canon).find(([, weight]) => weight >= 3)?.[0]
    : undefined;

  return (
    <div className="wd-scenes">
      <div className="wd-scenes-toolbar">
        <div className="wd-scene-groups">
          {groups.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`wd-scene-group${group === item.id ? " is-on" : ""}`}
              onClick={() => setState((prev) => setUi(prev, { sceneGroup: item.id }))}
            >
              {item.title}
            </button>
          ))}
        </div>
        <label className="wd-search">
          <Search size={14} />
          <input
            value={state.ui.sceneQuery}
            placeholder="搜场景"
            onChange={(event) => setState((prev) => setUi(prev, { sceneQuery: event.target.value }))}
          />
        </label>
        <div className="wd-scene-aspects" role="group" aria-label="按画幅筛选">
          {(
            [
              ["all", "全部"],
              ["portrait", "竖屏·通用"],
              ["landscape", "横屏·通用"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`wd-scene-aspect${aspect === value ? " is-on" : ""}`}
              onClick={() => setAspect(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="wd-mini-check">
          <input type="checkbox" checked={favOnly} onChange={(event) => setFavOnly(event.target.checked)} />
          仅收藏
        </label>
        {activeScene && (
          <button type="button" className="wd-link-btn" onClick={onClear}>
            <X size={12} /> 清除已套用场景
          </button>
        )}
      </div>

      <div className="wd-scene-pick">
        <label className="wd-mini-check" title="勾上 = 必出一条本档场景；不勾 = 一条都不出">
          <input
            type="checkbox"
            checked={state.scenePick}
            onChange={(event) => setState((prev) => ({ ...prev, scenePick: event.target.checked }))}
          />
          <Film size={13} /> 随机抽取场景搭配（按当前 NSFW 档位，必出）
        </label>
        <span className="wd-scene-pick-hint">场景卡片「套用」是显式指定，与这个开关互不替代</span>
      </div>

      <div className="wd-scene-grid">
        {filtered.map((scene) => {
          const value = sceneAspect(scene.id);
          return (
            <div
              key={scene.id}
              className={`wd-scene-card${activeScene === scene.id ? " is-active" : ""}`}
            >
              <div className="wd-scene-head">
                <span className={`wd-chip lv${scene.level}`}>L{scene.level}</span>
                <span className={`wd-scene-aspect-badge is-${value}`} title={`推荐画幅：${ASPECT_LABEL[value]}`}>
                  {ASPECT_LABEL[value]}
                </span>
                <span className="wd-scene-title">{scene.zh}</span>
                <button
                  type="button"
                  className={`wd-fav${favorites.has(scene.id) ? " is-on" : ""}`}
                  onClick={() => onToggleFavorite(scene.id)}
                  aria-label={favorites.has(scene.id) ? "取消收藏" : "收藏场景"}
                >
                  {favorites.has(scene.id) ? <Star size={13} /> : <Heart size={13} />}
                </button>
              </div>
              {scene.desc && <div className="wd-scene-desc">{scene.desc}</div>}
              <div className="wd-scene-tags">
                {Object.values(scene.tags ?? {})
                  .slice(0, 5)
                  .map((tag) => (
                    <span key={tag} className="wd-scene-tag">
                      {tag}
                    </span>
                  ))}
                {scene.extra && <span className="wd-scene-tag is-extra">{scene.extra}</span>}
              </div>
              <div className="wd-scene-foot">
                <span className="wd-scene-theme">{scene.theme ?? ""}</span>
                <span className="wd-scene-flags">
                  {scene.manual_only && <em>仅手动套用</em>}
                  {scene.no_role && <em>无角色</em>}
                  {scene.role_ok && <em>角色生效</em>}
                  {scene.count_lock && <em>{scene.count_lock}</em>}
                </span>
                <button type="button" className="wd-apply-scene" onClick={() => onApply(scene)}>
                  <Wand2 size={12} /> 套用
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length === 0 && <div className="wd-empty">没有匹配的场景</div>}
      <div className="wd-chars-count">本组 {filtered.length} 条</div>
    </div>
  );
}
