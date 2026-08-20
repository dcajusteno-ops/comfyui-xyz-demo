import { useEffect, useMemo, useState } from "react";

export type ConfirmDialog = { title: string; message: string; onConfirm: () => void };

export function useUiState() {
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("xyz_welcome_seen")) {
      setShowWelcome(true);
    }
  }, []);

  const handleCloseWelcome = () => {
    localStorage.setItem("xyz_welcome_seen", "true");
    setShowWelcome(false);
  };

  const [outputLightbox, setOutputLightbox] = useState<string | null>(null);
  const [compareLightbox, setCompareLightbox] = useState<[string, string] | null>(null);
  const [isAppSidebarCollapsed, setIsAppSidebarCollapsed] = useState(false);

  // Global responsive collapse
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsAppSidebarCollapsed(true);
      }
    };
    window.addEventListener("resize", handleResize);
    handleResize();
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
