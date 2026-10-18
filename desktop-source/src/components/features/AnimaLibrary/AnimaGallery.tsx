import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Dices,
  RefreshCw,
  Search,
  Shuffle,
  Star,
} from "lucide-react";
import type {
  AnimaGalleryItem,
  AnimaGallerySort,
  AnimaLibrarySection,
} from "../../../lib/anima/types";
import type { Toast } from "../../../types";
import { useAnimaData } from "../../../hooks/useAnimaData";
import {
  filterGalleryItems,
  getGalleryItems,
  sortGalleryItems,
  uniqueFacetValues,
  uniqueValues,
  type GallerySource,
} from "../../../lib/anima/galleryIndex";
import { createRng, pickOne, randomSeed } from "../../../lib/anima/prng";
import { SECTION_LABELS, SECTION_ORDER } from "../../../lib/anima/labels";
import { AnimaGalleryCard } from "./AnimaGalleryCard";
import { AnimaSelect } from "./AnimaSelect";

type ToastFn = (type: Toast["type"], title: string, message?: string) => void;

const KIND_BY_SECTION = {
  artist: "artists",
  character: "characters",
  clothing: "clothing",
  background: "backgrounds",
  pose: "poses",
} as const;

const SORT_LABELS: Array<{ value: AnimaGallerySort; label: string }> = [
  { value: "popular", label: "按热度" },
  { value: "name", label: "按名称" },
  { value: "random", label: "随机排序" },
];

async function copyText(text: string): Promise<void> {
  if (!text) return;
  await navigator.clipboard.writeText(text);
}

type Props = {
  section: AnimaLibrarySection;
  onSectionChange: (section: AnimaLibrarySection) => void;
  sort: AnimaGallerySort;
  onSortChange: (sort: AnimaGallerySort) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  favoritesOnly: boolean;
  onFavoritesOnlyChange: (value: boolean) => void;
  favorites: ReadonlySet<string>;
  onToggleFavorite: (section: AnimaLibrarySection, key: string) => void;
  onSetFavorites: (section: AnimaLibrarySection, keys: string[], value: boolean) => void;
  onAddToComposer: (section: AnimaLibrarySection, tokens: string[]) => void;
  pushToast: ToastFn;
};

export const AnimaGallery = React.memo(({
  section,
  onSectionChange,
  sort,
  onSortChange,
  pageSize,
  onPageSizeChange,
  favoritesOnly,
  onFavoritesOnlyChange,
  favorites,
  onToggleFavorite,
  onSetFavorites,
  onAddToComposer,
  pushToast,
}: Props) => {
  const kind = KIND_BY_SECTION[section];
  const { data, loading, error, reload } = useAnimaData(kind);

  const items = useMemo<AnimaGalleryItem[]>(() => {
    if (!data) return [];
    return getGalleryItems(section, { [kind]: data } as GallerySource);
  }, [data, kind, section]);

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [category, setCategory] = useState("");
  const [trait, setTrait] = useState("");
  const [gender, setGender] = useState("");
  const [hair, setHair] = useState("");
  const [eye, setEye] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shuffleSeed, setShuffleSeed] = useState(1);
  const [randomPick, setRandomPick] = useState<AnimaGalleryItem | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 切分区时把临时筛选/勾选全部复位（这些本来就不持久化）
  useEffect(() => {
    setSearch("");
    setCategory("");
    setTrait("");
    setGender("");
    setHair("");
    setEye("");
    setPage(1);
    setSelected(new Set());
    setRandomPick(null);
  }, [section]);

  // 翻页 / 换分区 / 改搜索时回到顶部，避免停在上一页的中段
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [page, section, sort, deferredSearch]);

  const categories = useMemo(() => uniqueValues(items, "categories"), [items]);
  const traits = useMemo(() => uniqueValues(items, "traits"), [items]);
  const genders = useMemo(() => uniqueFacetValues(items, "gender"), [items]);
  const hairs = useMemo(() => uniqueFacetValues(items, "hair"), [items]);
  const eyes = useMemo(() => uniqueFacetValues(items, "eye"), [items]);

  const filtered = useMemo(
    () =>
      filterGalleryItems(items, {
        search: deferredSearch,
        category,
        trait,
        favoritesOnly,
        favorites,
        gender,
        hair,
        eye,
      }),
    [items, deferredSearch, category, trait, favoritesOnly, favorites, gender, hair, eye],
  );

  const sorted = useMemo(() => sortGalleryItems(filtered, sort, shuffleSeed), [filtered, sort, shuffleSeed]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pageItems = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );

  const toggleSelected = useCallback((item: AnimaGalleryItem) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.key)) next.delete(item.key);
      else next.add(item.key);
      return next;
    });
  }, []);

  const handleAdd = useCallback(
    (item: AnimaGalleryItem) => {
      onAddToComposer(section, item.tokens);
      pushToast("success", "已加入拼接台", `${item.title} → ${SECTION_LABELS[section]}`);
    },
    [onAddToComposer, pushToast, section],
  );

  const handleCopy = useCallback(
    (item: AnimaGalleryItem) => {
      void copyText(item.tokens.join(", ")).then(
        () => pushToast("success", "已复制", item.title),
        () => pushToast("error", "复制失败", "浏览器剪贴板不可用"),
      );
    },
    [pushToast],
  );

  const selectedItems = useMemo(() => items.filter((item) => selected.has(item.key)), [items, selected]);
  const currentPageAllSelected = pageItems.length > 0 && pageItems.every((item) => selected.has(item.key));

  const addSelected = () => {
    if (!selectedItems.length) return;
    onAddToComposer(section, selectedItems.flatMap((item) => item.tokens));
    pushToast("success", "已加入拼接台", `${selectedItems.length} 条 → ${SECTION_LABELS[section]}`);
  };

  const copySelected = () => {
    const text = selectedItems.flatMap((item) => item.tokens).join(", ");
    void copyText(text).then(
      () => pushToast("success", "已复制选中词条", `${selectedItems.length} 条`),
      () => pushToast("error", "复制失败", "浏览器剪贴板不可用"),
    );
  };

  const favoriteSelected = (value: boolean) => {
    if (!selectedItems.length) return;
    onSetFavorites(section, selectedItems.map((item) => item.key), value);
    pushToast("success", value ? "已收藏" : "已取消收藏", `${selectedItems.length} 条`);
  };

  const pickRandom = () => {
    if (!filtered.length) return;
    const item = pickOne(createRng(randomSeed()), filtered);
    if (item) setRandomPick(item);
  };

  return (
    <div className="al-gallery">
      <div className="al-gallery-head">
        <div className="segmented al-section-tabs">
        {SECTION_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className={section === key ? "active" : ""}
            onClick={() => onSectionChange(key)}
          >
            {SECTION_LABELS[key]}
          </button>
        ))}
      </div>

      <div className="al-toolbar">
        <label className="al-search">
          <Search size={15} />
          <input
            type="search"
            value={search}
            placeholder={`搜索${SECTION_LABELS[section]}（中英文均可）`}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>

        <AnimaSelect
          ariaLabel="排序"
          value={sort}
          options={SORT_LABELS}
          onChange={(value) => {
            const next = value as AnimaGallerySort;
            onSortChange(next);
            if (next === "random") setShuffleSeed((seed) => seed + 1);
            setPage(1);
          }}
        />

        {section === "character" && genders.length > 0 && (
          <AnimaSelect
            ariaLabel="性别筛选"
            value={gender}
            options={[{ value: "", label: "全部性别" }, ...genders.map((value) => ({ value, label: value }))]}
            onChange={(value) => { setGender(value); setPage(1); }}
          />
        )}
        {section === "character" && hairs.length > 0 && (
          <AnimaSelect
            ariaLabel="发色筛选"
            value={hair}
            options={[{ value: "", label: "全部发色" }, ...hairs.map((value) => ({ value, label: value }))]}
            onChange={(value) => { setHair(value); setPage(1); }}
          />
        )}
        {section === "character" && eyes.length > 0 && (
          <AnimaSelect
            ariaLabel="瞳色筛选"
            value={eye}
            options={[{ value: "", label: "全部瞳色" }, ...eyes.map((value) => ({ value, label: value }))]}
            onChange={(value) => { setEye(value); setPage(1); }}
          />
        )}

        {categories.length > 0 && (
          <AnimaSelect
            ariaLabel="分类筛选"
            value={category}
            options={[{ value: "", label: "全部分类" }, ...categories.map((value) => ({ value, label: value }))]}
            onChange={(value) => { setCategory(value); setPage(1); }}
          />
        )}
        {traits.length > 0 && (
          <AnimaSelect
            ariaLabel="特征筛选"
            value={trait}
            options={[{ value: "", label: "全部特征" }, ...traits.map((value) => ({ value, label: value }))]}
            onChange={(value) => { setTrait(value); setPage(1); }}
          />
        )}

        <button
          type="button"
          className={favoritesOnly ? "secondary-action active" : "secondary-action"}
          onClick={() => { onFavoritesOnlyChange(!favoritesOnly); setPage(1); }}
          title="只看收藏"
        >
          <Star size={14} fill={favoritesOnly ? "currentColor" : "none"} /> 收藏
        </button>

        <button type="button" className="secondary-action" onClick={pickRandom} disabled={!filtered.length}>
          <Dices size={14} /> 随机 1 个
        </button>

        {sort === "random" && (
          <button type="button" className="secondary-action" onClick={() => setShuffleSeed((seed) => seed + 1)} title="重新洗牌">
            <Shuffle size={14} />
          </button>
        )}
      </div>

      <div className="al-gallery-meta">
        <span>
          共 {items.length.toLocaleString("zh-CN")} 条
          {filtered.length !== items.length && ` · 匹配 ${filtered.length.toLocaleString("zh-CN")} 条`}
        </span>
        <span className="al-gallery-page-size">
          每页
          <AnimaSelect
            ariaLabel="每页条数"
            size="sm"
            align="right"
            value={String(pageSize)}
            options={[24, 48, 96].map((size) => ({ value: String(size), label: String(size) }))}
            onChange={(value) => { onPageSizeChange(Number(value)); setPage(1); }}
          />
        </span>
      </div>
      </div>

      <div className="al-gallery-scroll" ref={scrollRef}>
      {randomPick && (
        <div className="al-random-pick">
          <span>随机结果</span>
          {randomPick.preview && <img src={randomPick.preview} alt="" referrerPolicy="no-referrer" />}
          <div className="al-random-pick-text">
            <strong>{randomPick.title}</strong>
            {randomPick.subtitle && <small>{randomPick.subtitle}</small>}
          </div>
          <button type="button" className="secondary-action" onClick={() => handleAdd(randomPick)}>加入拼接台</button>
          <button type="button" className="secondary-action" onClick={() => setRandomPick(null)}>关闭</button>
        </div>
      )}

      {loading && <div className="empty-state">正在加载{SECTION_LABELS[section]}词库…</div>}
      {error && (
        <div className="empty-state al-error">
          <div>{error}</div>
          <button type="button" className="secondary-action" onClick={reload}>
            <RefreshCw size={14} /> 重试
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          {pageItems.length === 0 ? (
            <div className="empty-state">没有匹配的词条，试试清空搜索或切换筛选</div>
          ) : (
            <div className="al-grid">
              {pageItems.map((item) => (
                <AnimaGalleryCard
                  key={item.key}
                  item={item}
                  selected={selected.has(item.key)}
                  favorite={favorites.has(item.key)}
                  ratio={section === "artist" || section === "character" ? "3 / 4" : "2 / 3"}
                  onToggleSelected={toggleSelected}
                  onToggleFavorite={(target) => onToggleFavorite(section, target.key)}
                  onAdd={handleAdd}
                  onCopy={handleCopy}
                />
              ))}
            </div>
          )}

          <div className="al-pagination">
            <button type="button" className="secondary-action" disabled={page <= 1} onClick={() => setPage(1)}>首页</button>
            <button type="button" className="secondary-action" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              <ChevronLeft size={14} />
            </button>
            <span>{page} / {pageCount}</span>
            <button type="button" className="secondary-action" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>
              <ChevronRight size={14} />
            </button>
            <button type="button" className="secondary-action" disabled={page >= pageCount} onClick={() => setPage(pageCount)}>末页</button>
            <button
              type="button"
              className="secondary-action"
              onClick={() => {
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (currentPageAllSelected) pageItems.forEach((item) => next.delete(item.key));
                  else pageItems.forEach((item) => next.add(item.key));
                  return next;
                });
              }}
            >
              {currentPageAllSelected ? "取消本页" : "全选本页"}
            </button>
          </div>
        </>
      )}

      {selected.size > 0 && (
        <div className="al-selection-bar">
          <span>已选 {selected.size} 条</span>
          <button type="button" className="secondary-action" onClick={addSelected}>加入拼接台</button>
          <button type="button" className="secondary-action" onClick={copySelected}>复制</button>
          <button type="button" className="secondary-action" onClick={() => favoriteSelected(true)}>收藏</button>
          <button type="button" className="secondary-action" onClick={() => favoriteSelected(false)}>取消收藏</button>
          <button type="button" className="secondary-action" onClick={() => setSelected(new Set())}>清空</button>
        </div>
      )}
      </div>
    </div>
  );
});
