import { Bell, Volume2, EyeOff } from "lucide-react";
import { useNotifier } from "../hooks/useNotifier";

/** 完成提醒设置区（自管理 localStorage 状态），嵌入「通知」弹窗顶部 */
export function NotifierSettingsPanel() {
  const { settings, update, enableDesktopNotifications } = useNotifier();

  const toggleDesktop = async () => {
    if (settings.desktopNotifications) {
      update({ desktopNotifications: false });
      return;
    }
    const ok = await enableDesktopNotifications();
    if (!ok && typeof Notification !== "undefined" && Notification.permission === "denied") {
      // 环境拒绝：由调用方 UI 提示即可，这里不再处理
    }
  };

  return (
    <div
      className="notifier-settings"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
        padding: "10px 12px",
        marginBottom: "12px",
        borderRadius: "8px",
        border: "1px solid var(--border)",
        background: "var(--surface-alt)",
      }}
    >
      <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--muted)", alignSelf: "center" }}>完成提醒</span>

      <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text)", cursor: "pointer" }}>
        <input type="checkbox" checked={settings.desktopNotifications} onChange={toggleDesktop} />
        <Bell size={13} /> 桌面通知
      </label>

      <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text)", cursor: "pointer" }}>
        <input type="checkbox" checked={settings.sound} onChange={(e) => update({ sound: e.target.checked })} />
        <Volume2 size={13} /> 提示音
      </label>

      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "12px",
          color: settings.desktopNotifications ? "var(--text)" : "var(--muted)",
          cursor: settings.desktopNotifications ? "pointer" : "not-allowed",
          opacity: settings.desktopNotifications ? 1 : 0.55,
        }}
      >
        <input
          type="checkbox"
          checked={settings.notifyWhenHidden}
          disabled={!settings.desktopNotifications}
          onChange={(e) => update({ notifyWhenHidden: e.target.checked })}
        />
        <EyeOff size={13} /> 仅后台提醒
      </label>
    </div>
  );
}