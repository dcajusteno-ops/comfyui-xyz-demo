import { useAppContext } from "../AppContext";
import type { ThemeActions } from "../AppContext";
import type { ThemeLibraryState } from "../lib/theme";

/**
 * 主题库读写入口。
 *
 * 状态本体在 AppContext 里（与 `theme` / `setTheme` / `toggleTheme` 同一份真相），
 * 这里只做一层取用，避免在别处再起一个 usePersistentState 实例 —— 那样两个 hook 各持一份
 * useState，同一 key 会各自漂移。
 */
export function useThemeLibrary(): { library: ThemeLibraryState; actions: ThemeActions } {
  const { themeLibrary, themeActions } = useAppContext();
  return { library: themeLibrary, actions: themeActions };
}
