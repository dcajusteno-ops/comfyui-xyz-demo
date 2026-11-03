import { useEffect, useMemo, useState } from "react";
import { Heart, Search, Star, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { AnimaSelect } from "../AnimaLibrary/AnimaSelect";
import {
  charactersData,
  roleWorkIndex,
  worksTable,
} from "../../../lib/wardrobe/characters";
import { setUi } from "../../../lib/wardrobe/state";
import type { WardrobeCharacter, WardrobeUiState } from "../../../lib/wardrobe/types";

type Props = {
  state: WardrobeUiState;
  setState: Dispatch<SetStateAction<WardrobeUiState>>;
  selected: Set<string>;
  favorites: Set<string>;
  onToggleRole: (trigger: string) => void;
  onToggleFavorite: (tag: string) => void;
};

export function WardrobeCharacterLibrary({
  state,
  setState,
  selected,
  favorites,
  onToggleRole,
  onToggleFavorite,
}: Props) {
  const characters = useMemo(() => charactersData().characters, []);
  const works = useMemo(() => worksTable(), []);
  const workIndex = useMemo(() => roleWorkIndex(), []);
  const [limit, setLimit] = useState(state.ui.charPageSize);
  const [failed, setFailed] = useState<Set<string>>(new Set());

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
    setLimit(state.ui.charPageSize);
  }, [query, workId, state.ui.charFavOnly, state.ui.charSort, state.ui.charPageSize]);

  const shown = filtered.slice(0, limit);
  // 与插件面板同口径：「全部作品」右侧数字是**角色数**（作品数在下面统计行里给）
  const workOptions = [
    { value: "", label: `全部作品（${characters.length}）` },
    ...works.map((w) => ({ value: w.id, label: `${w.zh || w.en}（${w.count}）` })),
  ];

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
            onToggleRole={() => onToggleRole(character.trigger)}
            onToggleFavorite={() => onToggleFavorite(character.tag)}
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
    </div>
  );
}

function CharacterCard({
  character,
  selected,
  favorite,
  disabled,
  failed,
  onToggleRole,
  onToggleFavorite,
  onFail,
}: {
  character: WardrobeCharacter;
  selected: boolean;
  favorite: boolean;
  disabled: boolean;
  failed: boolean;
  onToggleRole: () => void;
  onToggleFavorite: () => void;
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
      </div>
      <div className="wd-char-name">{character.zh || character.name}</div>
      <div className="wd-char-work">{character.work}</div>
    </div>
  );
}
