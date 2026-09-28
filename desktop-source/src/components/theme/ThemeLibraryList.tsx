import { useState } from "react";
import { Check, Copy, Image as ImageIcon, Lock, Pencil, Trash2 } from "lucide-react";
import { BASE_FALLBACK, effectiveToken, isThemeEditable, isWallpaperActive } from "../../lib/theme";
import type { ThemeDefinition } from "../../lib/theme";

/** 主题色卡：面板底色 + 强调色条 + 正文色条，一眼能区分 */
function ThemeChip({ theme }: { theme: ThemeDefinition }) {
  const surface = effectiveToken(theme, "surface") ?? BASE_FALLBACK[theme.base].surface;
  const accent = effectiveToken(theme, "accent") ?? BASE_FALLBACK[theme.base].accent;
  const text = effectiveToken(theme, "text") ?? BASE_FALLBACK[theme.base].text;
  const border = effectiveToken(theme, "border") ?? BASE_FALLBACK[theme.base].border;
  return (
    <span className="theme-chip" style={{ background: surface, borderColor: border }} aria-hidden="true">
      <span className="theme-chip-accent" style={{ background: accent }} />
      <span className="theme-chip-text" style={{ background: text }} />
    </span>
  );
}

export function ThemeLibraryList({
  themes,
  activeId,
  onApply,
  onDuplicate,
  onRename,
  onRemove,
}: {
  themes: ThemeDefinition[];
  activeId: string;
  onApply: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startRename = (theme: ThemeDefinition) => {
    setEditingId(theme.id);
    setDraft(theme.name);
  };

  const commitRename = () => {
    if (editingId) {
      const name = draft.trim();
      if (name) onRename(editingId, name);
    }
    setEditingId(null);
    setDraft("");
  };

  return (
    <ul className="theme-library">
      {themes.map((theme) => {
        const active = theme.id === activeId;
        const isEditing = editingId === theme.id;
        return (
          <li key={theme.id} className={active ? "theme-library-item active" : "theme-library-item"}>
            <button
              type="button"
              className="theme-library-main"
              onClick={() => onApply(theme.id)}
              title={`应用「${theme.name}」`}
            >
              <ThemeChip theme={theme} />
              <span className="theme-library-text">
                {isEditing ? (
                  <input
                    className="theme-rename-input"
                    value={draft}
                    autoFocus
                    spellCheck={false}
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") {
                        setEditingId(null);
                        setDraft("");
                      }
                    }}
                  />
                ) : (
                  <span className="theme-library-name" title={theme.name}>
                    {theme.name}
                  </span>
                )}
                <span className="theme-library-meta">
                  {theme.base === "dark" ? "深色" : "浅色"}
                  {theme.builtin && <em className="theme-badge">内置</em>}
                  {theme.locked && <em className="theme-badge">预置</em>}
                  {isWallpaperActive(theme.wallpaper) && (
                    <em className="theme-badge">
                      <ImageIcon size={10} /> 壁纸
                    </em>
                  )}
                </span>
              </span>
              {active && <Check size={15} className="theme-library-check" />}
            </button>

            <span className="theme-library-actions">
              <button
                type="button"
                className="theme-icon-btn"
                title="复制一份"
                onClick={() => onDuplicate(theme.id)}
              >
                <Copy size={13} />
              </button>
              {isThemeEditable(theme) && (
                <>
                  <button
                    type="button"
                    className="theme-icon-btn"
                    title="重命名"
                    onClick={() => startRename(theme)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="theme-icon-btn danger"
                    title="删除"
                    onClick={() => onRemove(theme.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
              {!isThemeEditable(theme) && (
                <span className="theme-icon-btn" title="只读主题：请先「复制」再改" aria-hidden="true">
                  <Lock size={12} />
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
