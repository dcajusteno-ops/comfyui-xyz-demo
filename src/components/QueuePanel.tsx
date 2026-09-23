import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ListOrdered, Loader2, Trash2, X } from "lucide-react";
import { ModalFrame } from "./ui/Modal";
import type { ComfyClient, QueueState } from "../lib/comfyClient";

const EMPTY: QueueState = { running: [], pending: [] };

/**
 * 任务队列面板（T11）。
 * 以前只能「中断当前」，接上 /api/queue 后可以看到整个队列并单独移除 pending 任务。
 * 面板打开期间 4s 轮询一次；关闭即停。
 */
export function QueuePanel({
  client,
  runningPromptId,
  onClose,
  onToast,
}: {
  client: ComfyClient;
  /** 当前正在执行的任务（若有），用于区分「运行中」与「等待中」 */
  runningPromptId?: string;
  onClose: () => void;
  onToast: (type: "success" | "error" | "info", title: string, message?: string) => void;
}) {
  const [queue, setQueue] = useState<QueueState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setQueue(await client.getQueue());
    } catch {
      setQueue(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function act(task: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    try {
      await task();
      await refresh();
      onToast("success", successMessage);
    } catch (error) {
      onToast("error", "队列操作失败", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const total = queue.running.length + queue.pending.length;

  return createPortal(
    <ModalFrame title="任务队列" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0", minWidth: 420 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--muted)" }}>
          <ListOrdered size={14} />
          <span>
            运行中 {queue.running.length} · 等待 {queue.pending.length}
          </span>
          {loading && <Loader2 size={13} className="spin" />}
          <button
            type="button"
            className="lm-text-btn"
            style={{ marginLeft: "auto" }}
            disabled={busy || queue.pending.length === 0}
            title="清空全部等待中的任务（不影响当前运行）"
            onClick={() => void act(() => client.clearQueue(), "队列已清空")}
          >
            <Trash2 size={13} /> 清空等待队列
          </button>
        </div>

        {!loading && total === 0 && <div className="empty-state" style={{ padding: "28px 0" }}>队列为空</div>}

        {queue.running.map((item) => {
          const isCurrent = runningPromptId === item.promptId;
          return (
            <div
              key={item.promptId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--accent-soft)",
                fontSize: 13,
              }}
            >
              <Loader2 size={14} className="spin" style={{ color: "var(--accent)" }} />
              <code style={{ fontSize: 12 }}>{item.promptId.slice(0, 8)}</code>
              <span style={{ color: "var(--muted)", marginLeft: "auto" }}>{isCurrent ? "当前任务 · 运行中" : "运行中"}</span>
            </div>
          );
        })}

        {queue.pending.map((item, index) => (
          <div
            key={item.promptId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--surface-alt)",
              fontSize: 13,
            }}
          >
            <span style={{ color: "var(--muted)", width: 16, textAlign: "center" }}>{index + 1}</span>
            <code style={{ fontSize: 12 }}>{item.promptId.slice(0, 8)}</code>
            <button
              type="button"
              className="lm-text-btn"
              style={{ marginLeft: "auto" }}
              disabled={busy}
              title="从队列移除该任务"
              onClick={() => void act(() => client.deleteFromQueue([item.promptId]), "已从队列移除")}
            >
              <X size={13} /> 移除
            </button>
          </div>
        ))}
      </div>
    </ModalFrame>,
    document.body,
  );
}
