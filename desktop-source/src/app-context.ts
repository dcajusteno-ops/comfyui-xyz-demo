import { createContext, useContext } from "react";
import type { ComfyClient } from "./lib/comfyClient";
import type { ConnectionInfo, TabId } from "./types";
import type { Theme, ThemeDefinition, ThemeLibraryState, WindowCaptionMode } from "./lib/theme";

/** 主题库操作（面板与侧栏共用；内置主题不可覆盖/删除） */
export interface ThemeActions {
  /** 整库替换：面板的实时预览与「取消」回滚都走它 */
  setLibrary: (next: ThemeLibraryState) => void;
  /** 切换当前生效主题 */
  applyTheme: (id: string) => void;
  /** 新增或整体替换某主题（id 已存在则替换；builtin 一律忽略） */
  upsertTheme: (theme: ThemeDefinition) => void;
  /** 删除自定义主题（内置不可删；删的若是当前主题则回落到第一个） */
  removeTheme: (id: string) => void;
  /** exe 窗口标题栏是否跟随主题 */
  setWindowChrome: (on: boolean) => void;
  /** exe 窗口标题栏取色策略（跟随壁纸主色 / 跟随主题 / 自定义） */
  setWindowCaption: (mode: WindowCaptionMode, color?: string) => void;
}

export interface AppContextType {
  apiBase: string;
  setApiBase: (base: string) => void;
  client: ComfyClient;
  connection: ConnectionInfo;
  tab: TabId;
  setTab: (tab: TabId) => void;
  /** 当前生效主题的明暗基底（由主题库 active 主题派生） */
  theme: Theme;
  /** 设置明暗基底：自定义主题改自身 base，内置主题则切到对应的内置主题 */
  setTheme: (theme: Theme) => void;
  toggleTheme: (event?: React.MouseEvent | MouseEvent) => void;
  /** 主题库全量状态 */
  themeLibrary: ThemeLibraryState;
  themeActions: ThemeActions;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useAppContext must be used within an AppProvider");
  }
  return context;
};
