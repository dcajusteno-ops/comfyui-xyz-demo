import { useCallback, useMemo, useState } from "react";

import { ModalFrame, ToastViewport } from "../../ui";
import type { Toast } from "../../../types";
import { ImageManagerPanel } from "./ImageManagerPanel";

type ConfirmState = { title: string; message: string; onConfirm: () => void };

/**
 * 外置图片管理器的壳：主应用里的 `confirm` / toast 都来自 App 层，
 * 独立页面没有那一层，这里用最小实现补齐（只是壳，业务仍走 ImageManagerPanel）。
 */
export function StandaloneImageManager() {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // 数据集按钮会把 filenameRoot 放进 ?dir=，由面板按 ComfyUI 输出目录解析成绝对路径
  const focus = useMemo(() => {
    const dir = (new URLSearchParams(window.location.search).get("dir") ?? "").trim();
    return dir ? { dir, nonce: 1 } : null;
  }, []);

  const pushToast = useCallback((type: Toast["type"], title: string, message?: string) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, title, message }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 5000);
  }, []);

  const confirm = useCallback((title: string, message: string, onConfirm: () => void) => {
    setConfirmState({ title, message, onConfirm });
  }, []);

  return (
    <div className="standalone-shell">
      <ImageManagerPanel focus={focus} confirm={confirm} pushToast={pushToast} />

      {confirmState && (
        <ModalFrame title={confirmState.title} onClose={() => setConfirmState(null)}>
          <div className="standalone-confirm">
            <p>{confirmState.message}</p>
            <div className="standalone-confirm-actions">
              <button type="button" className="secondary-action" onClick={() => setConfirmState(null)}>
                取消
              </button>
              <button
                type="button"
                className="im-danger"
                onClick={() => {
                  // 先关再回调：回调里若再开确认框，后置空会把新框吞掉（项目踩过的坑）
                  const handleConfirm = confirmState.onConfirm;
                  setConfirmState(null);
                  handleConfirm();
                }}
              >
                确定删除
              </button>
            </div>
          </div>
        </ModalFrame>
      )}

      <ToastViewport toasts={toasts} onClose={(id) => setToasts((prev) => prev.filter((toast) => toast.id !== id))} />
    </div>
  );
}
