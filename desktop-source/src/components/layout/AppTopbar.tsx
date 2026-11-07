import {
  Bookmark,
  Languages,
  ListFilter,
  ListOrdered,
  PauseCircle,
  Settings,
  Sparkles,
  Wrench,
} from "lucide-react";
import { RunProgressStrip, VramBadge } from "../ui";
import type { ComfyClient } from "../../lib/comfyClient";
import type { ConnectionInfo, ProgressState } from "../../types";

interface AppTopbarProps {
  client: ComfyClient;
  connection: ConnectionInfo;
  progress: ProgressState;
  promptSidebarOpen: boolean;
  onOpenPromptEditor: () => void;
  onTogglePromptSidebar: () => void;
  onOpenTranslation: () => void;
  onOpenLauncher: () => void;
  onOpenQueue: () => void;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
  onInterrupt: () => void;
}

/** 顶栏 + 常驻进度条：只依赖连接状态与 progress，不参与各面板渲染 */
export function AppTopbar({
  client,
  connection,
  progress,
  promptSidebarOpen,
  onOpenPromptEditor,
  onTogglePromptSidebar,
  onOpenTranslation,
  onOpenLauncher,
  onOpenQueue,
  onOpenNotifications,
  onOpenSettings,
  onInterrupt,
}: AppTopbarProps) {
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className={`connection-status ${connection.status}`} title={connection.message}>
            <div className="status-dot" />
            <span>
              {connection.status === "online"
                ? `在线 ${connection.version || ""}`
                : connection.status === "offline"
                ? "离线"
                : connection.status === "checking"
                ? "正在连接..."
                : "连接错误"}
            </span>
          </div>
          {/* T10-③：显存占用指示（/system_stats 轮询，空闲过低时预警） */}
          <VramBadge client={client} />
        </div>
        <div className="top-actions">
          <div className="action-group">
            <button type="button" className="icon-button" onClick={onOpenPromptEditor} title="提示词编辑器">
              <Sparkles size={18} />
              <span>提示词</span>
            </button>
            <button
              type="button"
              className={promptSidebarOpen ? "icon-button active" : "icon-button"}
              onClick={onTogglePromptSidebar}
              title="提示词仓库"
            >
              <Bookmark size={18} />
              <span>仓库</span>
            </button>
            <button type="button" className="icon-button" onClick={onOpenTranslation} title="翻译工具">
              <Languages size={18} />
            </button>
            {/* 外部工具启动器：不经过 ComfyUI，离线可用 */}
            <button type="button" className="icon-button" onClick={onOpenLauncher} title="外部工具（一键启动本地程序/脚本）">
              <Wrench size={18} />
            </button>
          </div>

          <div className="action-divider" />

          <div className="action-group">
            <button type="button" className="icon-button" onClick={onOpenQueue} title="任务队列（查看 / 移除 / 清空）">
              <ListOrdered size={18} />
              <span>队列</span>
            </button>
            <button type="button" className="icon-button" onClick={onOpenNotifications} title="通知">
              <ListFilter size={18} />
            </button>
            <button type="button" className="icon-button" onClick={onOpenSettings} title="设置">
              <Settings size={18} />
            </button>
          </div>

          <button type="button" className="icon-button danger" onClick={onInterrupt} disabled={!progress.running}>
            <PauseCircle size={18} />
            <span>中断</span>
          </button>
        </div>
      </header>

      <RunProgressStrip progress={progress} />
    </>
  );
}
