import React, { useCallback, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Loader2, Smartphone, Trash2, X } from "lucide-react";
import type { MobileTask, MobileTaskStatus, TemplateKind } from "../../../types";
import { MobileQrBox } from "./MobileQrBox";

const STATUS_META: Record<MobileTaskStatus, { label: string; color: string }> = {
  queued: { label: "排队中", color: "var(--muted)" },
  running: { label: "识别中", color: "var(--accent)" },
  done: { label: "完成", color: "#16a34a" },
  error: { label: "失败", color: "#dc2626" },
};

const APPLY_TARGETS: Array<{ id: TemplateKind; label: string }> = [
  { id: "default", label: "默认生图" },
  { id: "multi", label: "多人工作流" },
  { id: "highres", label: "高清修复" },
];

function timeAgo(iso: string): string {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  }
}

type MobileSyncFeedProps = {
  tasks: MobileTask[];
  onRemove: (id: string) => void;
  onClear: () => void;
  /** 把 tags 追加到指定工作流的正向提示词 */
  onApplyTags: (tags: string, target: TemplateKind) => void;
};

export const MobileSyncFeed = ({ tasks, onRemove, onClear, onApplyTags }: MobileSyncFeedProps) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [targets, setTargets] = useState<Record<string, TemplateKind>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = useCallback(async (task: MobileTask) => {
    const ok = await copyText(task.tags);
    if (ok) {
      setCopiedId(task.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }, []);

  const handleRemove = useCallback((id: string) => onRemove(id), [onRemove]);

  const handleClear = useCallback(() => {
    if (tasks.length === 0) return;
    if (window.confirm(`确定清空全部 ${tasks.length} 条手机上传记录？`)) {
      onClear();
    }
  }, [tasks.length, onClear]);

  return (
    <div className="panel-body">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
          <Smartphone size={14} />
          手机上传共 {tasks.length} 条
        </div>
        <button className="secondary-action" onClick={handleClear} style={{ padding: "4px 10px", height: 28, fontSize: 12, display: "flex", alignItems: "center", gap: 4, opacity: tasks.length ? 1 : 0.5 }}>
          <Trash2 size={13} />
          清空全部
        </button>
      </div>

      {tasks.length === 0 ? (
        <div style={{ border: "2px dashed var(--border)", borderRadius: 8, padding: "20px 16px", textAlign: "center" }}>
          <Smartphone size={28} color="var(--muted)" style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 13, color: "var(--muted)" }}>尚无手机上传的任务</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, marginBottom: 12 }}>
            手机扫码（或手动输入下方地址）后上传识图，结果会实时同步到这里
          </div>
          <MobileQrBox />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tasks.map((task) => {
            const status = STATUS_META[task.status] ?? { label: task.status || "未知", color: "var(--muted)" };
            const modelName = task.params?.model ?? "";
            const isExpanded = expanded[task.id];
            const target = targets[task.id] ?? "default";
            const isDone = task.status === "done";
            return (
              <div key={task.id} style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface-alt)", padding: 10 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <img
                    src={`/api/mobile/tasks/${task.id}/image`}
                    alt=""
                    style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover", background: "var(--surface)", flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.imageName}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                      <span style={{ fontSize: 11, color: status.color, display: "flex", alignItems: "center", gap: 4 }}>
                        {task.status === "running" && <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />}
                        {status.label}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>{timeAgo(task.createdAt)}</span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>{modelName}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    {isDone && (
                      <button
                        className="secondary-action"
                        title="复制 tags"
                        onClick={() => handleCopy(task)}
                        style={{ padding: "5px 8px", height: 28, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
                      >
                        {copiedId === task.id ? <Check size={13} /> : <Copy size={13} />}
                        {copiedId === task.id ? "已复制" : "复制"}
                      </button>
                    )}
                    <button className="secondary-action" title="删除" onClick={() => handleRemove(task.id)} style={{ padding: "5px 8px", height: 28, fontSize: 12, display: "flex", alignItems: "center" }}>
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {isDone && (
                  <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: isExpanded ? undefined : 40, overflow: "hidden" }}>
                      {task.tags}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                      <select
                        value={target}
                        onChange={(e) => setTargets((prev) => ({ ...prev, [task.id]: e.target.value as TemplateKind }))}
                        style={{ padding: "4px 6px", fontSize: 12, borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}
                      >
                        {APPLY_TARGETS.map((t) => (
                          <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                      </select>
                      <button className="primary-action" onClick={() => onApplyTags(task.tags, target)} style={{ padding: "4px 10px", height: 28, fontSize: 12 }}>
                        应用到工作流
                      </button>
                      <button
                        className="secondary-action"
                        onClick={() => setExpanded((prev) => ({ ...prev, [task.id]: !prev[task.id] }))}
                        style={{ padding: "4px 8px", height: 28, fontSize: 12, display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}
                      >
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        {isExpanded ? "收起" : "展开全文"}
                      </button>
                    </div>
                  </div>
                )}

                {task.status === "error" && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#dc2626", background: "rgba(220,38,38,0.08)", padding: "6px 10px", borderRadius: 6 }}>
                    {task.error ?? "识别失败"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};