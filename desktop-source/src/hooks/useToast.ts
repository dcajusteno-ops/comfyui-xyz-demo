import { useCallback, useState } from "react";
import type { Toast } from "../types";

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notificationLog, setNotificationLog] = useState<Toast[]>([]);

  const pushToast = useCallback((type: Toast["type"], title: string, message?: string) => {
    const toast: Toast = { id: crypto.randomUUID(), type, title, message };
    setNotificationLog((prev) => [toast, ...prev].slice(0, 80));
    setToasts((prev) => [...prev, toast].slice(-5));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== toast.id));
    }, type === "error" ? 5200 : 3600);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  return { toasts, notificationLog, pushToast, removeToast };
}