import { useMemo, useState } from "react";
import { Film, Heart, RotateCcw, Search, Star, Wand2, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { sceneAspect, sceneGroups, sceneList } from "../../../lib/wardrobe/scenes";
import { setUi } from "../../../lib/wardrobe/state";
import { nearPartOf, nearSlimProfile, NEAR_VISIBLE } from "../../../lib/wardrobe/near";
import type { WardrobeScene, WardrobeUiState } from "../../../lib/wardrobe/types";
import { WardrobePickPoolBar } from "./WardrobePickPoolBar";
import { AnimaSelect } from "../AnimaLibrary/AnimaSelect";

export type SceneTab = WardrobeUiState["ui"]["sceneTab"];

type Props = {
  state: WardrobeUiState;
  setState: Dispatch<SetStateAction<WardrobeUiState>>;
  favorites: Set<string>;
  tab: SceneTab;
  onToggleFavorite: (id: string) => void;
  onApply: (scene: WardrobeScene) => void;
  onClear: () => void;
  onApplyNear: (scene: WardrobeScene) => void;
  onRestoreNear: () => void;
  onSetPickMode: (mode: WardrobeUiState["pickPool"]["mode"]) => void;
  onTogglePick: (id: string) => void;
  onSelectPickAll: (ids: string[]) => void;
  onClearPick: () => void;
};

type AspectFilter = "all" | "portrait" | "landscape";

/** 画幅徽标：竖 / 横 / 通（v5.0.1 旁挂表）。 */
const ASPECT_LABEL: Record<string, string> = { portrait: "竖", landscape: "横", both: "通" };

const TAB_GROUP: Record<SceneTab, string[]> = {
  pair: ["sfw", "nsfw"],
  pose: ["pose"],
  art: ["art"],
  weapon: ["weapon"],
  near: ["near"],
};

export function WardrobeSceneLibrary({
  state,
  setState,
  favorites,
  tab,
  onToggleFavorite,
  onApply,
  onClear,
  onApplyNear,
  onRestoreNear,
  onSetPickMode,
  onTogglePick,
  onSelectPickAll,
  onClearPick,
}: Props) {
  const groups = sceneGroups();
  const scenes = sceneList();
  const [favOnly, setFavOnly] = useState(false);
  const [aspect, setAspect] = useState<AspectFilter>("all");
  const [sub, setSub] = useState("all");
  const query = state.ui.sceneQuery.trim().toLowerCase();
  const group = state.ui.sceneGroup;
  const allowedGroups = TAB_GROUP[tab];

  const subOptions = useMemo(() => {
    const base = scenes.filter((scene) => allowedGroups.includes(scene.group));
    const values = new Set<string>();
    for (const scene of base) {
      if (tab === "art") values.add(String(scene.bg ?? ""));
      else if (tab === "weapon") values.add(String(scene.work ?? ""));
      else if (tab === "near") values.add(nearPartOf(scene));
      else if (tab === "pose") values.add(poseCategory(scene.theme));
    }
    return [...values].filter(Boolean).sort();
  }, [allowedGroups, scenes, tab]);

  const activeSub = subOptions.includes(sub) ? sub : "all";

  const filtered = useMemo(
    () =>
      scenes.filter((scene) => {
        if (!allowedGroups.includes(scene.group)) return false;
        // 搭配页保留档位分组（sfw / nsfw）的单选；其余页签已由 tab 决定分组
        if (tab === "pair" && scene.group !== group) return false;
        if (activeSub !== "all") {
          if (tab === "art" && String(scene.bg ?? "") !== activeSub) return false;
          if (tab === "weapon" && String(scene.work ?? "") !== activeSub) return false;
          if (tab === "near" && nearPartOf(scene) !== activeSub) return false;
          if (tab === "pose" && poseCategory(scene.theme) !== activeSub) return false;
        }
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
          (scene.work_zh ?? "").toLowerCase().includes(query) ||
          (scene.weapon ?? "").toLowerCase().includes(query) ||
          scene.id.toLowerCase().includes(query)
        );
      }),
    [activeSub, allowedGroups, aspect, favOnly, favorites, group, query, scenes, tab],
  );

  const activeScene = state.weights.options.n_canon
    ? Object.entries(state.weights.options.n_canon).find(([, weight]) => weight >= 3)?.[0]
    : undefined;
  const pickMode = tab === "pair" ? "" : tab;
  const picked = state.pickPool.mode === pickMode ? state.pickPool.ids : [];

  return (
    <div className="wd-scenes">
      <div className="wd-scenes-toolbar">
        {tab === "pair" ? (
          <div className="wd-scene-groups">
            {groups
              .filter((item) => allowedGroups.includes(item.id))
              .map((item) => (
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
        ) : (
          <label className="wd-scene-filter">
            <span>{tab === "near" ? "部位" : tab === "art" ? "底色" : tab === "weapon" ? "作品" : "分类"}</span>
            <AnimaSelect
              value={activeSub}
              options={[
                { value: "all", label: `全部（${scenes.filter((s) => allowedGroups.includes(s.group)).length}）` },
                ...subOptions.map((value) => ({ value, label: value })),
              ]}
              onChange={(value) => setSub(value)}
              ariaLabel="按分类筛选"
              size="sm"
            />
          </label>
        )}
        <label className="wd-search">
          <Search size={14} />
          <input
            value={state.ui.sceneQuery}
            placeholder={tab === "weapon" ? "搜武器 / 作品" : "搜场景"}
            onChange={(event) => setState((prev) => setUi(prev, { sceneQuery: event.target.value }))}
          />
        </label>
        <div className="wd-scene-aspects" role="group" aria-label="按画幅筛选">
          {(
            [
              ["all", "全部", "不限画幅"],
              ["portrait", "竖屏", "竖屏 · 通用（推荐画幅为竖或通）"],
              ["landscape", "横屏", "横屏 · 通用（推荐画幅为横或通）"],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              className={`wd-scene-aspect${aspect === value ? " is-on" : ""}`}
              onClick={() => setAspect(value)}
              title={hint}
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
        {state.nearBase && (
          <button type="button" className="wd-link-btn" onClick={onRestoreNear}>
            <RotateCcw size={12} /> 还原特写前的权重
          </button>
        )}
      </div>

      {tab === "pair" ? (
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
      ) : pickMode ? (
        <WardrobePickPoolBar
          mode={pickMode}
          state={state}
          visibleIds={filtered.map((scene) => scene.id)}
          onSetMode={onSetPickMode}
          onSelectAll={onSelectPickAll}
          onClear={onClearPick}
        />
      ) : null}

      <div className="wd-scene-grid">
        {filtered.map((scene) => {
          const value = sceneAspect(scene.id);
          const profile = tab === "near" ? nearSlimProfile(scene) : null;
          const isPicked = picked.includes(scene.id);
          return (
            <div
              key={scene.id}
              className={`wd-scene-card${activeScene === scene.id ? " is-active" : ""}${
                isPicked ? " is-picked" : ""
              }`}
            >
              <div className="wd-scene-head">
                <span className={`wd-chip lv${scene.level}`}>L{scene.level}</span>
                <span className="wd-scene-title">{scene.zh}</span>
                {pickMode && (
                  <input
                    type="checkbox"
                    className="wd-scene-pickbox"
                    checked={isPicked}
                    onChange={() => onTogglePick(scene.id)}
                    aria-label={`勾选 ${scene.zh}`}
                  />
                )}
                <button
                  type="button"
                  className="wd-apply-scene"
                  onClick={() => (tab === "near" ? onApplyNear(scene) : onApply(scene))}
                  title={profile ? "套用并收紧取景（关段 / 清字段 / 钉人数）" : "套用这条场景"}
                >
                  <Wand2 size={12} /> 套用
                </button>
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
              <div className="wd-scene-meta">
                <span className={`wd-scene-aspect-badge is-${value}`} title={`推荐画幅：${ASPECT_LABEL[value]}`}>
                  {ASPECT_LABEL[value]}
                </span>
                  {scene.work_zh ? <span>《{scene.work_zh}》</span> : null}
                  {scene.weapon ? <span>{scene.weapon}</span> : null}
                  {scene.bg ? <span>{scene.bg}</span> : null}
                  {scene.theme ? <span>{scene.theme}</span> : null}
                  {scene.manual_only ? <em>仅手动</em> : null}
                  {scene.no_role ? <em>无角色</em> : null}
                  {scene.role_ok ? <em>角色生效</em> : null}
                  {scene.count_lock ? <em>{scene.count_lock}</em> : null}
              </div>
              {profile && (
                <div className="wd-scene-slim">
                  收紧取景：关 {profile.sections.length} 段 / 清 {profile.fields.length} 个字段 / 人数
                  「{scene.count_lock || "1girl, solo"}」{profile.dropRole ? " / 清角色" : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {filtered.length === 0 && <div className="wd-empty">没有匹配的场景</div>}
      <div className="wd-chars-count">本组 {filtered.length} 条</div>
    </div>
  );
}

/** 姿势库内部再分一层（瑜伽 / 伸展 / 基础），按 theme 前缀判（与插件同口径）。 */
function poseCategory(theme: string | undefined): string {
  const th = String(theme ?? "");
  if (th.includes("瑜伽")) return "瑜伽";
  if (th.includes("伸展")) return "伸展";
  return th ? "基础姿势" : "";
}

export { NEAR_VISIBLE };
