import { RefreshCw, Settings, Wrench } from "lucide-react";

interface ConnectionOverlayProps {
  apiBase: string;
  message?: string;
  onReload: () => void;
  onOpenLauncher: () => void;
  onOpenSettings: () => void;
}

/** 断连全屏遮罩：保留三个离线可用出口（重连 / 外部工具 / 改 API 地址） */
export function ConnectionOverlay({
  apiBase,
  message,
  onReload,
  onOpenLauncher,
  onOpenSettings,
}: ConnectionOverlayProps) {
  return (
    <div className="connection-overlay">
      <div className="overlay-content">
        <div className="overlay-icon">
          <RefreshCw size={48} className="animate-spin-slow" />
        </div>
        <h2>ComfyUI 连接已断开</h2>
        <p>无法连接到 ComfyUI 后端服务，请确保：</p>
        <ul>
          <li>ComfyUI 服务已经在 <b>{apiBase}</b> 启动</li>
          <li>如果使用了插件，请确保插件已正确安装</li>
          <li>尝试手动刷新页面或重启 ComfyUI</li>
        </ul>
        <div className="overlay-actions">
          <button type="button" className="primary-action" onClick={onReload}>
            <RefreshCw size={18} />
            重新连接
          </button>
          {/* 断连时也能用的离线功能入口：外部工具启动器（不依赖 ComfyUI） */}
          <button type="button" className="secondary-action" onClick={onOpenLauncher} title="离线可用：一键启动本地程序/脚本/网页">
            <Wrench size={18} />
            外部工具
          </button>
          <button type="button" className="secondary-action" onClick={onOpenSettings}>
            <Settings size={18} />
            修改 API 地址
          </button>
        </div>
        {message && <div className="error-detail">{message}</div>}
      </div>
    </div>
  );
}
