import { useCallback, useEffect, useMemo, useState } from "react";

export type ConfirmDialog = { title: string; message: string; onConfirm: () => void };

/** 欢迎弹窗已读标记：懒初始化时顺带把无前缀的旧键迁移过来，避免用 effect 同步 setState */
function readWelcomeSeen(): boolean {
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

export function useUiState() {
  const [showWelcome, setShowWelcome] = useState<boolean>(() => !readWelcomeSeen());

  const handleCloseWelcome = useCallback(() => {
    try {
      localStorage.setItem("comfyui_xyz_welcome_seen", "true");
    } catch {
      // 写失败时仅本次会话内不再弹出
    }
    setShowWelcome(false);
  }, []);

  const [outputLightbox, setOutputLightbox] = useState<string | null>(null);
  const [compareLightbox, setCompareLightbox] = useState<[string, string] | null>(null);
  const [isAppSidebarCollapsed, setIsAppSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.innerWidth < 1024;
    } catch {
      return false;
    }
  });

  // Global responsive collapse（初始值已在懒初始化里处理，这里只响应后续变化）
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsAppSidebarCollapsed(true);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [featureModal, setFeatureModal] = useState<{ title: string; body: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [triggerWords, setTriggerWords] = useState<Record<string, string[]>>({});
  const [showXyzHelp, setShowXyzHelp] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [showPromptSidebar, setShowPromptSidebar] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);

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
    confirm,
  }), [
    showWelcome,
    handleCloseWelcome,
    outputLightbox,
    compareLightbox,
    isAppSidebarCollapsed,
    featureModal,
    confirmDialog,
    triggerWords,
    showXyzHelp,
    showPromptEditor,
    showPromptSidebar,
    showTranslation,
  ]);
}
