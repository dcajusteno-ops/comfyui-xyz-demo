import { useEffect, useMemo, useState } from "react";
import { Heart, Search, Shirt, Star, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { AnimaSelect } from "../AnimaLibrary/AnimaSelect";
import {
  charactersData,
  roleWorkIndex,
  worksTable,
} from "../../../lib/wardrobe/characters";
import { setUi } from "../../../lib/wardrobe/state";
import { outfitRecord } from "../../../lib/wardrobe/outfits";
import type {
  WardrobeCharacter,
  WardrobeOutfitStore,
  WardrobeOutfitTemplate,
  WardrobeUiState,
} from "../../../lib/wardrobe/types";
import { WardrobeOutfitDialog } from "./WardrobeOutfitDialog";

type Props = {
  state: WardrobeUiState;
  setState: Dispatch<SetStateAction<WardrobeUiState>>;
  selected: Set<string>;
  favorites: Set<string>;
  favoriteWorks: Set<string>;
  outfits: WardrobeOutfitStore;
  outfitTemplates: WardrobeOutfitTemplate[];
  onToggleRole: (trigger: string) => void;
  onToggleFavorite: (tag: string) => void;
  onToggleWork: (slug: string) => void;
  onSaveOutfit: (roleTag: string, item: import("../../../lib/wardrobe/types").WardrobeOutfitSet, isNew: boolean) => void;
  onDeleteOutfit: (roleTag: string, id: string) => void;
  onEnableOutfit: (roleTag: string, id: string) => void;
};

export function WardrobeCharacterLibrary({
  state,
  setState,
  selected,
  favorites,
  favoriteWorks,
  outfits,
  outfitTemplates,
  onToggleRole,
  onToggleFavorite,
  onToggleWork,
  onSaveOutfit,
  onDeleteOutfit,
  onEnableOutfit,
}: Props) {
  const characters = useMemo(() => charactersData().characters, []);
  const works = useMemo(() => worksTable(), []);
  const workIndex = useMemo(() => roleWorkIndex(), []);
  const [limit, setLimit] = useState(state.ui.charPageSize);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [outfitFor, setOutfitFor] = useState<WardrobeCharacter | null>(null);

  const query = state.ui.charQuery.trim().toLowerCase();
  const workId = state.ui.charWork;
  const filtered = useMemo(() => {
    const rows = characters.filter((c) => {
      if (state.ui.charFavOnly && !favorites.has(c.tag)) return false;
      if (workId && workIndex.get(c.trigger.trim().toLowerCase()) !== workId) return false;
      if (!query) return true;
      return (
        c.name.toLowerCase().includes(query) ||
        c.tag.toLowerCase().includes(query) ||
        (c.zh ?? "").toLowerCase().includes(query) ||
        c.trigger.toLowerCase().includes(query)
      );
    });
    rows.sort((a, b) =>
      state.ui.charSort === "name" ? a.name.localeCompare(b.name) : (b.pop ?? 0) - (a.pop ?? 0),
    );
    return rows;
  }, [characters, favorites, query, state.ui.charFavOnly, state.ui.charSort, workId, workIndex]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 筛选变化时重置分页上限
    setLimit(state.ui.charPageSize);
  }, [query, workId, state.ui.charFavOnly, state.ui.charSort, state.ui.charPageSize]);

  const shown = filtered.slice(0, limit);
  // 与插件面板同口径：「全部作品」右侧数字是**角色数**；收藏的作品置顶（组内仍按角色数降序）
  const sortedWorks = useMemo(() => {
    const fav = works.filter((w) => favoriteWorks.has(w.id));
    const rest = works.filter((w) => !favoriteWorks.has(w.id));
    return [...fav, ...rest];
  }, [favoriteWorks, works]);
  const workOptions = [
    { value: "", label: `全部作品（${characters.length}）` },
    ...sortedWorks.map((w) => ({
      value: w.id,
      label: `${favoriteWorks.has(w.id) ? "★ " : ""}${w.zh || w.en}（${w.count}）`,
    })),
  ];
  const currentWork = works.find((w) => w.id === workId);

  return (
    <div className="wd-chars">
      <div className="wd-chars-toolbar">
        <label className="wd-search">
          <Search size={14} />
          <input
            value={state.ui.charQuery}
            placeholder="搜角色（中文 / 英文 / tag）"
            onChange={(event) => setState((prev) => setUi(prev, { charQuery: event.target.value }))}
          />
        </label>
        <AnimaSelect
          value={workId}
          options={workOptions}
          onChange={(value) => setState((prev) => setUi(prev, { charWork: value }))}
          ariaLabel="按作品筛选"
          size="sm"
          className="wd-work-select"
        />
        <button
          type="button"
          className={`wd-fav wd-work-fav${currentWork && favoriteWorks.has(currentWork.id) ? " is-on" : ""}`}
          disabled={!currentWork}
          onClick={() => currentWork && onToggleWork(currentWork.id)}
          title={currentWork ? (favoriteWorks.has(currentWork.id) ? "取消收藏该作品" : "收藏该作品") : "先选一个作品"}
          aria-label="收藏当前作品"
        >
          <Star size={13} />
        </button>
        <label className="wd-mini-check">
          <input
            type="checkbox"
            checked={state.ui.charFavOnly}
            onChange={(event) => setState((prev) => setUi(prev, { charFavOnly: event.target.checked }))}
          />
          仅收藏
        </label>
        <AnimaSelect
          value={state.ui.charSort}
          options={[
            { value: "pop", label: "按人气" },
            { value: "name", label: "按名称" },
          ]}
          onChange={(value) => setState((prev) => setUi(prev, { charSort: value as "pop" | "name" }))}
          ariaLabel="角色排序"
          size="sm"
        />
      </div>

      {favoriteWorks.size > 0 && (
        <div className="wd-work-favs">
          <span>收藏的作品</span>
          {[...favoriteWorks].slice(0, 12).map((slug) => {
            const work = works.find((w) => w.id === slug);
            return (
              <button
                key={slug}
                type="button"
                className={`wd-chip-btn${workId === slug ? " is-on" : ""}`}
                onClick={() => setState((prev) => setUi(prev, { charWork: prev.ui.charWork === slug ? "" : slug }))}
                title="点击筛选该作品"
              >
                ★ {work?.zh || work?.en || slug}
              </button>
            );
          })}
        </div>
      )}

      <div className="wd-selected-bar">
        <span>
          已选 <b>{state.selectedRoles.length}</b> / 8 位
        </span>
        <div className="wd-selected-chips">
          {state.selectedRoles.map((trigger) => (
            <button
              key={trigger}
              type="button"
              className="wd-chip-btn"
              onClick={() => onToggleRole(trigger)}
              title="移除"
            >
              {trigger.split(",")[0]} <X size={11} />
            </button>
          ))}
        </div>
        {state.selectedRoles.length > 0 && (
          <button
            type="button"
            className="wd-link-btn"
            onClick={() => setState((prev) => ({ ...prev, selectedRoles: [] }))}
          >
            清除已选
          </button>
        )}
      </div>

      <div className="wd-char-grid">
        {shown.map((character) => (
          <CharacterCard
            key={character.tag}
            character={character}
            selected={selected.has(character.trigger)}
            favorite={favorites.has(character.tag)}
            disabled={!selected.has(character.trigger) && state.selectedRoles.length >= 8}
            failed={failed.has(character.thumb)}
            outfitEnabled={Boolean(outfitRecord(outfits, character.tag).enabled)}
            onToggleRole={() => onToggleRole(character.trigger)}
            onToggleFavorite={() => onToggleFavorite(character.tag)}
            onOpenOutfit={() => setOutfitFor(character)}
            onFail={() => setFailed((prev) => new Set(prev).add(character.thumb))}
          />
        ))}
      </div>
      {shown.length === 0 && <div className="wd-empty">没有匹配的角色</div>}
      {limit < filtered.length && (
        <button type="button" className="wd-more" onClick={() => setLimit((n) => n + state.ui.charPageSize)}>
          加载更多（{filtered.length - limit}）
        </button>
      )}
      <div className="wd-chars-count">
        共 {filtered.length} 位（{works.length} 部作品）· 显示 {shown.length} 位
      </div>

      {outfitFor && (
        <WardrobeOutfitDialog
          roleTag={outfitFor.tag}
          roleName={outfitFor.zh || outfitFor.name}
          record={outfitRecord(outfits, outfitFor.tag)}
          templates={outfitTemplates}
          onClose={() => setOutfitFor(null)}
          onEnable={(id) => onEnableOutfit(outfitFor.tag, id)}
          onSave={(item, isNew) => onSaveOutfit(outfitFor.tag, item, isNew)}
          onDelete={(id) => onDeleteOutfit(outfitFor.tag, id)}
        />
      )}
    </div>
  );
}

function CharacterCard({
  character,
  selected,
  favorite,
  disabled,
  failed,
  outfitEnabled,
  onToggleRole,
  onToggleFavorite,
  onOpenOutfit,
  onFail,
}: {
  character: WardrobeCharacter;
  selected: boolean;
  favorite: boolean;
  disabled: boolean;
  failed: boolean;
  outfitEnabled: boolean;
  onToggleRole: () => void;
  onToggleFavorite: () => void;
  onOpenOutfit: () => void;
  onFail: () => void;
}) {
  return (
    <div
      className={`wd-char${selected ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}
      onClick={disabled ? undefined : onToggleRole}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !disabled) onToggleRole();
      }}
      title={character.trigger}
    >
      <div className="wd-char-thumb">
        {failed ? (
          <span className="wd-char-fallback">{character.name.slice(0, 2)}</span>
        ) : (
          <img
            src={`/data/wardrobe/thumbs/${character.thumb}.webp`}
            alt={character.name}
            loading="lazy"
            decoding="async"
            onError={onFail}
          />
        )}
        <button
          type="button"
          className={`wd-fav${favorite ? " is-on" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
          aria-label={favorite ? "取消收藏" : "收藏角色"}
          title={favorite ? "取消收藏" : "收藏角色"}
        >
          {favorite ? <Star size={13} /> : <Heart size={13} />}
        </button>
        <button
          type="button"
          className={`wd-outfit-btn${outfitEnabled ? " is-on" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenOutfit();
          }}
          aria-label="角色服装预设"
          title={outfitEnabled ? "已启用服装预设" : "角色服装预设"}
        >
          <Shirt size={13} />
        </button>
      </div>
      <div className="wd-char-name">{character.zh || character.name}</div>
      <div className="wd-char-work">{character.work}</div>
    </div>
  );
}
