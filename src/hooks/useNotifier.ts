import { useCallback } from "react";
import { useLocalStorageState } from "./useLocalStorageState";
import {
  beep,
  notify,
  requestNotificationPermission,
  shouldNotify,
  defaultNotifierSettings,
  type NotifierSettings,
} from "../lib/notifier";

export function useNotifier() {
  const [settings, setSettings] = useLocalStorageState<NotifierSettings>("comfyui_notifier", defaultNotifierSettings);

  const update = useCallback(
    (patch: Partial<NotifierSettings>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
    },
    [setSettings],
  );

  /** 打开桌面通知开关时触发；被拒则回滚开关 */
  const enableDesktopNotifications = useCallback(async () => {
    const granted = await requestNotificationPermission();
    if (granted) {
      setSettings((prev) => ({ ...prev, desktopNotifications: true }));
      return true;
    }
    setSettings((prev) => ({ ...prev, desktopNotifications: false }));
    return false;
  }, [setSettings]);

  /** 任务完成时调用：按设置决断是否弹系统通知 + 提示音 */
  const notifyComplete = useCallback(
    (title: string, message?: string) => {
      const isHidden = typeof document !== "undefined" && document.hidden;
      if (shouldNotify(isHidden, settings)) {
        notify(title, message ?? "");
      }
      if (settings.sound) beep();
    },
    [settings],
  );

  return { settings, update, enableDesktopNotifications, notifyComplete };
}