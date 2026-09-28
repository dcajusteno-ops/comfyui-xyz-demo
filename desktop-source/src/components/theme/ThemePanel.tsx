import { useMemo, useState } from "react";
import { Copy, Plus } from "lucide-react";
import { ModalFrame } from "../ui";
import { ThemeLibraryList } from "./ThemeLibraryList";
import { PaletteEditor } from "./PaletteEditor";
import { WallpaperEditor } from "./WallpaperEditor";
import { useThemeLibrary } from "../../hooks/useThemeLibrary";
import { useAppContext } from "../../AppContext";
import {
  DEFAULT_CAPTION_MODE,
  deriveWindowAppearance,
  duplicateTheme,
  getActiveTheme,
  isDesktopMode,
  isThemeEditable,
  isWallpaperActive,
  nextThemeName,
  parseColor,
  toHex,
} from "../../lib/theme";
import type { ThemeBase, ThemeDefinition, ThemeLibraryState, WindowCaptionMode } from "../../lib/theme";

type PanelTab = "palette" | "wallpaper" | "base";

const TABS: { id: PanelTab; label: string }[] = [
  { id: "palette", label: "配色" },
  { id: "wallpaper", label: "壁纸" },
  { id: "base", label: "基础" },
];

/** 标题栏取色策略（桌面模式且开了「跟随主题」时才显示） */
const CAPTION_MODES: { id: WindowCaptionMode; label: string; hint: string }[] = [
  { id: "wallpaper", label: "取壁纸主色", hint: "取壁纸顶部主色，压上顶栏色 —— 与顶栏同色" },
  { id: "theme", label: "跟随主题", hint: "只用主题的顶栏色，不理会壁纸" },
  { id: "custom", label: "自定义", hint: "直接指定标题栏底色" },
];

function cloneLibrary(lib: ThemeLibraryState): ThemeLibraryState {
  return {
    ...lib,
    themes: lib.themes.map((t) => ({ ...t, palette: { ...t.palette }, wallpaper: { ...t.wallpaper } })),
  };
}

/**
 * 主题面板：左侧主题库、右侧当前主题的编辑器。
 *
 * 交互约定：编辑**实时生效**（每次改动都 upsert + 应用，改完立刻能看到效果）。
 * 因此底部给的是「放弃本次修改」（回滚到打开面板时的快照）而不是「取消/确定」——
 * 「取消」在实时预览的语义下没有意义。
 */
export function ThemePanel({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (title: string, message: string, onConfirm: () => void) => void;
}) {
  const { library, actions } = useThemeLibrary();
  const { setTheme } = useAppContext();
  // 打开面板时的快照：底部「放弃本次修改」回滚到它。
  // 用 useState 惰性初始化而不是 useRef —— 读 ref.current 属于渲染期访问，会被 react-hooks/refs 拦下。
  const [snapshot] = useState(() => cloneLibrary(library));
  const [tab, setTab] = useState<PanelTab>("palette");

  const active = useMemo(() => getActiveTheme(library), [library]);
  const editable = isThemeEditable(active);
  const desktop = isDesktopMode();
  const wallpaperOn = isWallpaperActive(active.wallpaper);
  const captionMode = library.captionMode ?? DEFAULT_CAPTION_MODE;
  const captionHex = useMemo(
    () =>
      parseColor(library.captionColor)
        ? toHex(parseColor(library.captionColor)!)
        : deriveWindowAppearance(active, { mode: "theme" }).captionColor,
    [library.captionColor, active],
  );
  const dirty = useMemo(
    () => JSON.stringify(library) !== JSON.stringify(snapshot),
    [library, snapshot],
  );

  const patchActive = (patch: Partial<ThemeDefinition>) => {
    actions.upsertTheme({ ...active, ...patch, updatedAt: Date.now() });
  };

  const duplicate = (id: string) => {
    const source = library.themes.find((t) => t.id === id);
    if (!source) return;
    const copy = duplicateTheme(source, `${source.name} 副本`);
    actions.upsertTheme(copy);
    actions.applyTheme(copy.id);
  };

  const createNew = () => {
    const fresh = duplicateTheme(active, nextThemeName(library.themes));
    actions.upsertTheme(fresh);
    actions.applyTheme(fresh.id);
    setTab("palette");
  };

  const remove = (id: string) => {
    const target = library.themes.find((t) => t.id === id);
    if (!target) return;
    onConfirm("删除主题", `确定删除「${target.name}」？此操作不可撤销。`, () => actions.removeTheme(id));
  };

  const applyBase = (base: ThemeBase) => {
    if (!editable) return; // 只读主题的基底不可改，否则会把出厂配色改坏
    // setTheme 会区分内置/自定义：内置切到对应的内置主题，自定义则改自身 base
    setTheme(base);
  };

  /** 只读主题的逃生口：一键复制成可编辑副本并切过去 */
  const duplicateActive = () => {
    const copy = duplicateTheme(active, nextThemeName(library.themes));
    actions.upsertTheme(copy);
    actions.applyTheme(copy.id);
    setTab("palette");
  };

  return (
    <ModalFrame title="主题" onClose={onClose} className="theme-modal">
      <div className="theme-panel">
        <aside className="theme-panel-library">
          <div className="theme-panel-library-head">
            <span>主题库 · {library.themes.length}</span>
            <button type="button" className="theme-text-btn" onClick={createNew} title="基于当前主题新建一份">
              <Plus size={13} /> 新建
            </button>
          </div>
          <ThemeLibraryList
            themes={library.themes}
            activeId={library.activeThemeId}
            onApply={actions.applyTheme}
            onDuplicate={duplicate}
            onRename={(id, name) => {
              const target = library.themes.find((t) => t.id === id);
              if (target) actions.upsertTheme({ ...target, name, updatedAt: Date.now() });
            }}
            onRemove={remove}
          />
        </aside>

        <section className="theme-panel-editor">
          <div className="theme-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={tab === t.id ? "theme-tab active" : "theme-tab"}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
            <span className="theme-tabs-spacer" />
            {!editable && (
              <button type="button" className="theme-text-btn" onClick={duplicateActive} title="复制成一份可编辑的主题">
                <Copy size={13} /> 复制并编辑
              </button>
            )}
            <span className="theme-current-name" title={active.name}>
              {active.name}
              {active.builtin && <em className="theme-badge">内置</em>}
              {active.locked && <em className="theme-badge">预置</em>}
            </span>
          </div>

          {tab === "palette" && (
            <PaletteEditor theme={active} onChange={(palette) => patchActive({ palette })} />
          )}

          {tab === "wallpaper" && (
            <WallpaperEditor
              wallpaper={active.wallpaper}
              disabled={!editable}
              onChange={(wallpaper) => patchActive({ wallpaper })}
            />
          )}

          {tab === "base" && (
            <div className="theme-editor-body">
              <label className="theme-field">
                <span>明暗基底</span>
                <div className="theme-segmented">
                  <button
                    type="button"
                    className={active.base === "light" ? "active" : ""}
                    disabled={!editable}
                    onClick={() => applyBase("light")}
                  >
                    浅色
                  </button>
                  <button
                    type="button"
                    className={active.base === "dark" ? "active" : ""}
                    disabled={!editable}
                    onClick={() => applyBase("dark")}
                  >
                    深色
                  </button>
                </div>
                <em className="theme-dim">
                  {editable
                    ? "基底决定未覆盖那些令牌取哪套内置值，改的是当前这套主题自身。"
                    : "只读主题的基底不可改；要整体切明暗，请直接选左侧的「浅色」「深色」。"}
                </em>
              </label>

              <label className="theme-check">
                <input
                  type="checkbox"
                  checked={library.windowChrome !== false}
                  disabled={!desktop}
                  onChange={(e) => actions.setWindowChrome(e.target.checked)}
                />
                <span>
                  窗口标题栏跟随主题
                  {!desktop && <em className="theme-dim">（当前不是桌面窗口模式，浏览器标题栏由浏览器控制）</em>}
                </span>
              </label>

              {desktop && library.windowChrome !== false && (
                <>
                  <label className="theme-field">
                    <span>标题栏取色</span>
                    <div className="theme-segmented">
                      {CAPTION_MODES.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className={captionMode === m.id ? "active" : ""}
                          onClick={() => actions.setWindowCaption(m.id)}
                          title={m.hint}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <em className="theme-dim">
                      {wallpaperOn
                        ? "标题栏本身贴不了图，只能取一枚主色：默认取壁纸顶部的主色压上顶栏色，做到跟紧挨它的顶栏同色。"
                        : "当前主题没设壁纸，三种取色结果相同。"}
                    </em>
                  </label>

                  {captionMode === "custom" && (
                    <div className="theme-palette-row">
                      <span className="theme-palette-label">标题栏底色</span>
                      <input
                        type="color"
                        className="theme-palette-swatch"
                        value={captionHex}
                        onChange={(e) => actions.setWindowCaption("custom", e.target.value)}
                        aria-label="标题栏底色取色"
                      />
                      <input
                        type="text"
                        className="theme-palette-text"
                        value={library.captionColor ?? ""}
                        placeholder={captionHex}
                        spellCheck={false}
                        onChange={(e) => actions.setWindowCaption("custom", e.target.value)}
                        aria-label="标题栏底色"
                      />
                    </div>
                  )}
                </>
              )}

              <p className="theme-hint">
                桌面版（exe）会用 DWM 把原生标题栏与窗口边框染成主题色；Windows 11 上支持自定义颜色，
                Windows 10 只能切换深/浅。
              </p>
            </div>
          )}
        </section>
      </div>

      <footer className="theme-panel-footer">
        <span className="theme-dim">{dirty ? "已应用（实时生效）" : "未做修改"}</span>
        <button
          type="button"
          className="lm-text-btn"
          disabled={!dirty}
          onClick={() => actions.setLibrary(cloneLibrary(snapshot))}
        >
          放弃本次修改
        </button>
        <button type="button" className="primary-action" onClick={onClose}>
          完成
        </button>
      </footer>
    </ModalFrame>
  );
}

export default ThemePanel;
