import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ComfyClient } from "./lib/comfyClient";
import { ConnectionInfo, TabId } from "./types";
import { CONFIG } from "./config";
import { usePersistentState } from "./hooks/usePersistentState";
import { isValidTabId } from "./lib/app-utils";
import {
  BUILTIN_DARK_ID,
  BUILTIN_LIGHT_ID,
  DEFAULT_THEME_LIBRARY,
  THEME_LIBRARY_KEY,
  applyThemeToDom,
  getActiveTheme,
  normalizeThemeLibrary,
  probeWindowMode,
  readLegacyBaseFromLocalStorage,
  syncWindowChrome,
} from "./lib/theme";
import type { Theme, ThemeDefinition, ThemeLibraryState, WindowCaptionMode } from "./lib/theme";
import { AppContext } from "./app-context";
import type { AppContextType, ThemeActions } from "./app-context";

export type { Theme, ThemeDefinition, ThemeLibraryState } from "./lib/theme";

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [apiBase, setApiBase] = useState(CONFIG.DEFAULT_API_BASE);
  const client = useMemo(() => new ComfyClient(apiBase), [apiBase]);
  const [connection, setConnection] = useState<ConnectionInfo>({ status: "checking" });
  const [tab, setTab] = usePersistentState<TabId>("comfyui_active_tab", "default");

  // 主题库：单 key 存整库。normalize 负责结构修复（deepMerge 修不了坏数据）与旧键一次性迁移
  // （仅当本地没有库数据时；服务端路径的迁移已在 uiStateStore.applyBootTheme 里完成）。
  const [themeLibrary, setThemeLibrary] = usePersistentState<ThemeLibraryState>(
    THEME_LIBRARY_KEY,
    DEFAULT_THEME_LIBRARY,
    (merged, raw) =>
      normalizeThemeLibrary(merged, readLegacyBaseFromLocalStorage(), {
        allowLegacyMigration: raw === undefined || raw === null,
      }),
  );

  const activeTheme = useMemo(() => getActiveTheme(themeLibrary), [themeLibrary]);
  const theme: Theme = activeTheme.base;

  // 应用主题（<html> class + 内联 CSS 变量 + 壁纸变量）并把窗口外观推给 exe
  useEffect(() => {
    applyThemeToDom(themeLibrary);
    syncWindowChrome(themeLibrary);
  }, [themeLibrary]);

  // 探测是否运行在桌面窗口里（决定要不要显示「标题栏跟随主题」开关、要不要推 DWM 外观）
  useEffect(() => {
    void probeWindowMode();
  }, []);

  // 持久化的 tab 值来自 localStorage、不做校验；若该 tab 已不存在（改名/删功能），
  // 所有 `{tab === "xxx"}` 分支都不成立会让主区域一片空白。这里回落默认值。
  useEffect(() => {
    if (!isValidTabId(tab)) setTab("default");
  }, [tab, setTab]);

  const setTheme = useCallback((next: Theme) => {
    setThemeLibrary((prev) => {
      const active = getActiveTheme(prev);
      if (!active.builtin) {
        // 自定义主题：直接改它自己的基底
        return {
          ...prev,
          themes: prev.themes.map((t) =>
            t.id === active.id ? { ...t, base: next, updatedAt: Date.now() } : t,
          ),
        };
      }
      // 内置主题：切到对应的内置主题
      return { ...prev, activeThemeId: next === "dark" ? BUILTIN_DARK_ID : BUILTIN_LIGHT_ID };
    });
  }, [setThemeLibrary]);

  const toggleTheme = useCallback((event?: React.MouseEvent | MouseEvent) => {
    // View Transitions API 的 lib.dom 版本较旧未收录，这里给出最小结构类型
    const docWithTransition = document as Document & {
      startViewTransition?: (callback: () => void | Promise<void>) => { ready: Promise<unknown>; finished: Promise<unknown> };
    };
    const nextTheme: Theme = theme === "light" ? "dark" : "light";

    if (typeof document === "undefined" || !docWithTransition.startViewTransition) {
      setTheme(nextTheme);
      return;
    }

    const x = event ? event.clientX : window.innerWidth / 2;
    const y = event ? event.clientY : window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    // Add class to disable standard CSS transitions during the view transition
    document.documentElement.classList.add("switching-theme");

    const transition = docWithTransition.startViewTransition!(async () => {
      setTheme(nextTheme);
      // Wait for React to finish rendering if possible (startViewTransition waits for the promise)
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`,
      ];
      
      const animation = document.documentElement.animate(
        {
          clipPath,
        },
        {
          duration: 400,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );

      // Clean up the class when animation finishes
      animation.onfinish = () => {
        document.documentElement.classList.remove("switching-theme");
      };
    });

    transition.finished.then(() => {
      document.documentElement.classList.remove("switching-theme");
    });
  }, [theme, setTheme]);

  const setLibrary = useCallback((next: ThemeLibraryState) => {
    setThemeLibrary(next);
  }, [setThemeLibrary]);

  const applyTheme = useCallback((id: string) => {
    setThemeLibrary((prev) => (prev.themes.some((t) => t.id === id) ? { ...prev, activeThemeId: id } : prev));
  }, [setThemeLibrary]);

  const upsertTheme = useCallback((incoming: ThemeDefinition) => {
    if (incoming.builtin) return; // 内置主题不可覆盖
    setThemeLibrary((prev) => {
      const exists = prev.themes.some((t) => t.id === incoming.id);
      return {
        ...prev,
        themes: exists
          ? prev.themes.map((t) => (t.id === incoming.id ? incoming : t))
          : [...prev.themes, incoming],
      };
    });
  }, [setThemeLibrary]);

  const removeTheme = useCallback((id: string) => {
    setThemeLibrary((prev) => {
      const target = prev.themes.find((t) => t.id === id);
      if (!target || target.builtin) return prev;
      const themes = prev.themes.filter((t) => t.id !== id);
      return {
        ...prev,
        themes,
        activeThemeId:
          prev.activeThemeId === id ? (themes[0]?.id ?? BUILTIN_LIGHT_ID) : prev.activeThemeId,
      };
    });
  }, [setThemeLibrary]);

  const setWindowChrome = useCallback((on: boolean) => {
    setThemeLibrary((prev) => ({ ...prev, windowChrome: on }));
  }, [setThemeLibrary]);

  const setWindowCaption = useCallback((mode: WindowCaptionMode, color?: string) => {
    setThemeLibrary((prev) => ({
      ...prev,
      captionMode: mode,
      ...(color === undefined ? {} : { captionColor: color }),
    }));
  }, [setThemeLibrary]);

  useEffect(() => {
    client.startMonitoring();
    const unsubscribe = client.onStatusChange((info) => {
      setConnection(info);
    });
    return () => {
      unsubscribe();
      client.stopMonitoring();
    };
  }, [client]);

  const themeActions = useMemo<ThemeActions>(
    () => ({ setLibrary, applyTheme, upsertTheme, removeTheme, setWindowChrome, setWindowCaption }),
    [setLibrary, applyTheme, upsertTheme, removeTheme, setWindowChrome, setWindowCaption],
  );

  const value: AppContextType = {
    apiBase,
    setApiBase,
    client,
    connection,
    tab,
    setTab,
    theme,
    setTheme,
    toggleTheme,
    themeLibrary,
    themeActions,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
