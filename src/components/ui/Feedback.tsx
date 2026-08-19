import { CheckCircle2, Info, X } from "lucide-react";
import type { ExampleImagesStatus, ProgressState, Toast } from "../../types";

export const ToastIcon = ({ type }: { type: Toast["type"] }) => {
  if (type === "success") return <CheckCircle2 size={20} color="#10b981" style={{ flexShrink: 0, marginTop: "2px" }} />;
  if (type === "error") return <X size={20} color="#ef4444" style={{ flexShrink: 0, marginTop: "2px" }} />;
  return <Info size={20} color="#3b82f6" style={{ flexShrink: 0, marginTop: "2px" }} />;
};

export function ToastViewport({ toasts, onClose }: { toasts: Toast[]; onClose: (id: string) => void }) {
  return (
    <div className="toast-viewport">
      {toasts.map((toast) => (
        <div className={`toast ${toast.type}`} key={toast.id}>
          <ToastIcon type={toast.type} />
          <div className="toast-content" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <strong>{toast.title}</strong>
            {toast.message && <p>{toast.message}</p>}
          </div>
          <button type="button" className="toast-close" onClick={() => onClose(toast.id)} style={{ flexShrink: 0 }}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function RunProgressStrip({ progress }: { progress: ProgressState }) {
  const percent = progress.max > 0 ? Math.min(100, Math.max(0, (progress.value / progress.max) * 100)) : 0;
  const show = progress.running || progress.label === "完成" || Boolean(progress.batch);
  if (!show) return null;
  const indeterminate = progress.running && percent <= 0;
  const batch = progress.batch;
  const batchPercent = batch && batch.total > 0 ? Math.min(100, Math.max(0, (batch.current / batch.total) * 100)) : 0;
  return (
    <div className="run-progress-strip" role="status" aria-live="polite">
      {batch && (
        <div className="run-progress-batch">
          <span className="batch-badge">XYZ</span>
          <strong>{batch.current}/{batch.total}</strong>
          <span className="batch-item" title={batch.itemLabel}>
            {batch.itemLabel || (progress.running ? "准备中" : "全部组合已处理")}
          </span>
          <div className="progress-track slim" aria-label="XYZ 批次进度">
            <span style={{ width: `${batchPercent}%` }} />
          </div>
        </div>
      )}
      <div className="run-progress-meta">
        <strong>{progress.label}</strong>
        <span>{progress.node ? `节点 ${progress.node}` : progress.promptId ? `任务 ${progress.promptId.slice(0, 8)}` : progress.running ? "等待提交" : ""}</span>
        <b>{indeterminate ? "处理中" : `${Math.round(percent)}%`}</b>
      </div>
      <div className={indeterminate ? "progress-track indeterminate" : "progress-track"} aria-label="生图进度">
        <span style={{ width: `${indeterminate ? 34 : percent}%` }} />
      </div>
    </div>
  );
}

export function ExampleImagesProgressBar({ status, pullingCount = 0 }: { status: ExampleImagesStatus | null; pullingCount?: number }) {
  const progress = status?.status;
  const running = Boolean(status?.is_downloading || pullingCount > 0 || progress?.status === "running");
  const total = Math.max(1, Number(progress?.total ?? pullingCount ?? 1));
  const completed = Math.min(total, Math.max(0, Number(progress?.completed ?? 0)));
  const percent = Math.min(100, Math.max(0, (completed / total) * 100));
  const label = running
    ? progress?.current_model || (pullingCount > 0 ? `单独拉取 ${pullingCount} 个 LoRA` : "正在拉取示例图")
    : progress?.status === "completed"
      ? `示例图拉取完成：${completed}/${total}`
      : progress?.status === "error"
        ? progress.last_error || "示例图拉取失败"
        : "";
  if (!running && !label) return null;
  const indeterminate = running && completed === 0;
  return (
    <div className="lm-download-progress" role="status" aria-live="polite">
      <div className="lm-download-progress-meta">
        <strong>{running ? "示例图拉取中" : progress?.status === "error" ? "示例图拉取失败" : "示例图拉取完成"}</strong>
        <span title={label}>{label}</span>
        <b>{indeterminate ? "处理中" : `${completed}/${total}`}</b>
      </div>
      <div className={indeterminate ? "progress-track indeterminate" : "progress-track"} aria-label="示例图拉取进度">
        <span style={{ width: `${indeterminate ? 34 : percent}%` }} />
      </div>
    </div>
  );
}
