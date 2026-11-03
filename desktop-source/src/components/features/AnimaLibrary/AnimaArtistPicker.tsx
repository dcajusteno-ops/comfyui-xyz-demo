import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { loadAnimaData } from "../../../lib/anima/store";
import { artistToken } from "../../../lib/anima/tags";
import { unescapeArtistName } from "../../../lib/anima/preview";
import type { AnimaArtist } from "../../../lib/anima/types";

type Props = {
  /** 收到的是**已补 `@`** 的画师 token（官方格式），直接追加进画师分区 */
  onAdd: (token: string) => void;
};

const RESULT_LIMIT = 12;

/**
 * 画师快取：从 4 万条画师库里搜，点一下按 Anima 官方格式写成 `@name`
 * 追加到「画师」分区——该分区固定排在质量词之后、角色之前。
 *
 * 数据 3MB，**聚焦时才加载**（和抽卡/画廊共用一个 loader 缓存）。
 * 画师名里的括号是 Danbooru 转义写法（`hammer \(sunset beach\)`），
 * 列表显示还原后的可读版本，插入时保留转义——否则 `(...)` 会被当成权重。
 */
export function AnimaArtistPicker({ onAdd }: Props) {
  const [artists, setArtists] = useState<AnimaArtist[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const started = useRef(false);

  const ensureLoaded = useCallback(() => {
    if (started.current) return;
    started.current = true;
    setLoading(true);
    loadAnimaData("artists")
      .then((rows) => setArtists([...rows].sort((a, b) => b.postCount - a.postCount)))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false));
  }, []);

  const results = useMemo(() => {
    if (!artists) return [];
    const needle = query.trim().toLowerCase().replace(/^@/, "");
    if (!needle) return artists.slice(0, RESULT_LIMIT);
    const out: AnimaArtist[] = [];
    for (const artist of artists) {
      const raw = artist.name.toLowerCase();
      const bare = unescapeArtistName(artist.name).toLowerCase();
      if (raw.includes(needle) || bare.includes(needle)) {
        out.push(artist);
        if (out.length >= RESULT_LIMIT) break;
      }
    }
    return out;
  }, [artists, query]);

  const add = useCallback(
    (artist: AnimaArtist) => {
      const token = artistToken(artist.name);
      if (token) onAdd(token);
      setQuery("");
    },
    [onAdd],
  );

  const total = artists ? artists.length : 0;

  return (
    <div className="al-artist-pick">
      <label className="al-artist-pick-input">
        <Search size={13} />
        <input
          value={query}
          spellCheck={false}
          placeholder="搜画师（英文名 / 别号），点一下加入画师区"
          onFocus={() => {
            ensureLoaded();
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            ensureLoaded();
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) {
              event.preventDefault();
              add(results[0]);
            }
            if (event.key === "Escape") setOpen(false);
          }}
          aria-label="搜索画师"
        />
        <span className="al-artist-pick-total">
          {loading ? <Loader2 size={12} className="wd-spin" /> : total ? `${total} 位` : "4 万位"}
        </span>
      </label>

      {open && (
        <div className="al-artist-pick-list" role="listbox">
          {error && <div className="al-artist-pick-empty">{error}</div>}
          {!error && !artists && <div className="al-artist-pick-empty">载入画师库…</div>}
          {!error && artists && results.length === 0 && (
            <div className="al-artist-pick-empty">没有匹配的画师</div>
          )}
          {results.map((artist) => (
            <button
              key={artist.id}
              type="button"
              role="option"
              aria-selected={false}
              className="al-artist-pick-item"
              // mousedown 先于 blur：不让输入框失焦把列表关掉
              onMouseDown={(event) => {
                event.preventDefault();
                add(artist);
              }}
              title={`加入 @${unescapeArtistName(artist.name)}`}
            >
              <span className="al-artist-pick-name">{unescapeArtistName(artist.name)}</span>
              <span className="al-artist-pick-count">{artist.postCount.toLocaleString("zh-CN")}</span>
              <Plus size={13} />
            </button>
          ))}
        </div>
      )}

      <p className="al-artist-pick-hint">
        Anima 官方顺序：<b>质量 → 画师 → 角色 → 服装 → 背景 → 姿势 → 额外</b>；画师统一写成{" "}
        <code>@name</code>，排在角色之前。
      </p>
    </div>
  );
}
