import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isServerBacked, readStoredValue, scheduleUiStateSave } from "../lib/uiStateStore";
import { usePersistentState } from "./usePersistentState";

export type ConfirmDialog = { title: string; message: string; onConfirm: () => void };

/** 首次进入且没有保存过侧边栏状态时的默认值：窄窗口收起，宽窗口展开。 */
function readInitialSidebarCollapsed(): boolean {
  try {
    return window.innerWidth < 1024;
  } catch {
    return false;
  }
}

/**
 * 欢迎弹窗已读标记：正常路径走服务端存储；offline 兜底走 localStorage
 * （懒初始化时顺带把无前缀的旧键迁移过来，避免用 effect 同步 setState）。
 */
function readWelcomeSeen(): boolean {
  if (isServerBacked()) {
    return readStoredValue<boolean>("comfyui_xyz_welcome_seen") === true;
  }
  try {
    if (localStorage.getItem("comfyui_xyz_welcome_seen")) return true;
    const legacy = localStorage.getItem("xyz_welcome_seen");
    if (legacy !== null) {
      localStorage.setItem("comfyui_xyz_welcome_seen", legacy);
      localStorage.removeItem("xyz_welcome_seen");
      return true;
    }
  } catch {
    // localStorage 不可用时视为未读过
  }
  return false;
}

function persistWelcomeSeen(): void {
  if (isServerBacked()) {
    scheduleUiStateSave("comfyui_xyz_welcome_seen", true);
    return;
  }
  try {
    localStorage.setItem("comfyui_xyz_welcome_seen", "true");
  } catch {
    // 写失败时仅本次会话内不再弹出
  }
}

export function useUiState() {
  const [showWelcome, setShowWelcome] = useState<boolean>(() => !readWelcomeSeen());

  const handleCloseWelcome = useCallback(() => {
    persistWelcomeSeen();
    setShowWelcome(false);
  }, []);

  const [outputLightbox, setOutputLightbox] = useState<{ url: string; originalUrl?: string } | null>(null);
  const [compareLightbox, setCompareLightbox] = useState<[string, string] | null>(null);
  // 水印弹窗的源图 URL（transient，不持久化）。水印开着时灯箱挂起（见 GlobalModals），关掉后灯箱原样恢复。
  const [watermarkSource, setWatermarkSource] = useState<string | null>(null);
  const [isAppSidebarCollapsed, setIsAppSidebarCollapsed] = usePersistentState<boolean>(
    "comfyui_xyz_sidebar_collapsed",
    readInitialSidebarCollapsed(),
  );

  // 只响应跨过 1024px 断点时的自动收起/展开；普通缩放不覆盖用户手动选择。
  const wasNarrowRef = useRef(readInitialSidebarCollapsed());
  useEffect(() => {
    const handleResize = () => {
      const narrow = window.innerWidth < 1024;
      if (narrow === wasNarrowRef.current) return;
      wasNarrowRef.current = narrow;
      setIsAppSidebarCollapsed(narrow);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setIsAppSidebarCollapsed]);

  const [featureModal, setFeatureModal] = useState<{ title: string; body: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [triggerWords, setTriggerWords] = useState<Record<string, string[]>>({});
  const [showXyzHelp, setShowXyzHelp] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [showPromptSidebar, setShowPromptSidebar] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [showLauncher, setShowLauncher] = useState(false);
  const [showThemePanel, setShowThemePanel] = useState(false);

  const confirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmDialog({ title, message, onConfirm });
  };

  return useMemo(() => ({
    showWelcome,
    setShowWelcome,
    handleCloseWelcome,
    outputLightbox,
    setOutputLightbox,
    compareLightbox,
    setCompareLightbox,
    watermarkSource,
    setWatermarkSource,
    isAppSidebarCollapsed,
    setIsAppSidebarCollapsed,
    featureModal,
    setFeatureModal,
    confirmDialog,
    setConfirmDialog,
    triggerWords,
    setTriggerWords,
    showXyzHelp,
    setShowXyzHelp,
    showPromptEditor,
    setShowPromptEditor,
    showPromptSidebar,
    setShowPromptSidebar,
    showTranslation,
    setShowTranslation,
    showLauncher,
    setShowLauncher,
    showThemePanel,
    setShowThemePanel,
    confirm,
  }), [
    showWelcome,
    handleCloseWelcome,
    outputLightbox,
    compareLightbox,
    watermarkSource,
    isAppSidebarCollapsed,
    setIsAppSidebarCollapsed,
    featureModal,
    confirmDialog,
    triggerWords,
    showXyzHelp,
    showPromptEditor,
    showPromptSidebar,
    showTranslation,
    showLauncher,
    showThemePanel,
  ]);
}
