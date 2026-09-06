export type NotifierSettings = {
  /** 总开关：是否允许桌面通知 */
  desktopNotifications: boolean;
  /** 是否允许提示音 */
  sound: boolean;
  /** 仅在页面隐藏（切后台）时弹系统通知；关闭则前台也弹 */
  notifyWhenHidden: boolean;
};

export const defaultNotifierSettings: NotifierSettings = {
  desktopNotifications: true,
  sound: true,
  notifyWhenHidden: true,
};

/** 纯判断：是否应该在当前可见性下发送桌面通知 */
export function shouldNotify(isHidden: boolean, settings: NotifierSettings): boolean {
  if (!settings.desktopNotifications) return false;
  if (settings.notifyWhenHidden) return isHidden;
  return true;
}

/** 请求通知权限；环境不支持或被拒绝时返回 false */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

/** 发送系统通知（无权限时静默忽略） */
export function notify(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    // 某些移动浏览器同样名通知抛异常，忽略即可
  }
}

/** 无需外部资产的短促提示音（Web Audio 合成） */
export function beep() {
  try {
    const Ctx: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.12;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => {
      void ctx.close();
    };
  } catch {
    // 忽略自动播放策略等错误
  }
}