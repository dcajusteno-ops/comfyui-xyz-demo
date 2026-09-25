import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ImageUp, Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import { usePersistentState } from "../../hooks/usePersistentState";

/**
 * 手机端远程生图（T13）：同一手机页（#/mobile-tag）里的「生图」标签页。
 * 提交后由电脑端服务排队执行 ComfyUI，手机轮询状态并直接看图（成图经服务端代理）。
 */

type GenTask = {
  id: string;
  status: "queued" | "running" | "done" | "error";
  params: {
    prompt: string;
    negativePrompt: string;
    width: number;
    height: number;
    steps: number;
    cfg: number;
    seed: number;
  };
  images: { filename: string; subfolder: string; type: string }[];
  error?: string;
  createdAt: string;
};

type FormState = {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seedText: string;
};

const FORM_KEY = "comfyui_mobile_gen_params";
const DEFAULT_FORM: FormState = {
  prompt: "",
  negativePrompt: "",
  width: 832,
  height: 1216,
  steps: 20,
  cfg: 7,
  seedText: "",
};const PRESET_SIZES = [
  { label: "竖版 832×1216", width: 832, height: 1216 },
  { label: "横版 1216×832", width: 1216, height: 832 },
  { label: "方形 1024×1024", width: 1024, height: 1024 },
];

const STATUS_META = {
  queued: { label: "排队中…", color: "var(--muted)" },
  running: { label: "生成中…", color: "var(--accent)" },
  done: { label: "完成", color: "#16a34a" },
  error: { label: "失败", color: "#dc2626" },
} as const;

const cardStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

const inputStyle: CSSProperties = {
  padding: "10px",
  borderRadius: 8,
  border: "1px solid var(--input-border)",
  background: "var(--input-bg)",
  color: "var(--text)",
  fontSize: 14,
};

const fieldLabel: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" };

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

export function MobileGenPanel() {
  const [form, setForm] = usePersistentState<FormState>(FORM_KEY, DEFAULT_FORM);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [task, setTask] = useState<GenTask | null>(null);
  const [recent, setRecent] = useState<GenTask[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<number | null>(null);

  const updateForm = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const refreshRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/mobile/gen");
      const data = (await res.json()) as { tasks?: GenTask[] };
      setRecent(data.tasks ?? []);
    } catch {
      // 轮询失败静默（局域网抖动）
    }
  }, []);

  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);

  // 当前任务未结束时 2s 轮询详情
  useEffect(() => {
    if (!currentId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/mobile/gen/tasks/${currentId}`);
        const data = (await res.json()) as { task?: GenTask };
        if (!stopped && data.task) {
          setTask(data.task);
          if (data.task.status === "done" || data.task.status === "error") {
            void refreshRecent();
            if (data.task.status === "done") {
              try {
                navigator.vibrate?.(200);
              } catch {
                // 忽略不支持的震动 API
              }
            }
            return;
          }
        }
      } catch {
        // 静默重试
      }
      if (!stopped) pollRef.current = window.setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      stopped = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [currentId, refreshRecent]);

  const submit = async () => {
    if (!form.prompt.trim()) {
      setError("请先填写提示词");
      return;
    }
    setSubmitting(true);
    setError("");
    setCopied(false);
    try {
      const res = await fetch("/api/mobile/gen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: form.prompt,
          negativePrompt: form.negativePrompt,
          width: Number(form.width),
          height: Number(form.height),
          steps: Number(form.steps),
          cfg: Number(form.cfg),
          seed: form.seedText.trim() === "" ? undefined : Number(form.seedText),
        }),
      });
      const data = (await res.json()) as { success?: boolean; id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? `提交失败（${res.status}）`);
      setTask(null);
      setCurrentId(data.id);
      void refreshRecent();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const removeTask = async (id: string) => {
    await fetch(`/api/mobile/gen/tasks/${id}`, { method: "DELETE" }).catch(() => undefined);
    if (id === currentId) {
      setCurrentId(null);
      setTask(null);
    }
    void refreshRecent();
  };

  const status = task ? STATUS_META[task.status] : null;

  return (
    <div>
      <section style={cardStyle}>
        <label style={{ ...fieldLabel, marginBottom: 10 }}>
          提示词
          <textarea
            value={form.prompt}
            onChange={(event) => updateForm({ prompt: event.target.value })}
            rows={4}
            placeholder="例如：1girl, masterpiece, best quality…"
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }}
          />
        </label>
        <label style={{ ...fieldLabel, marginBottom: 10 }}>
          负向提示词（可选）
          <input
            value={form.negativePrompt}
            onChange={(event) => updateForm({ negativePrompt: event.target.value })}
            placeholder="lowres, bad anatomy…"
            style={inputStyle}
          />
        </label>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {PRESET_SIZES.map((preset) => {
            const active = form.width === preset.width && form.height === preset.height;
            return (
              <button
                key={preset.label}
                type="button"
                className={active ? "primary-action" : "secondary-action"}
                style={{ padding: "5px 10px", fontSize: 12 }}
                onClick={() => updateForm({ width: preset.width, height: preset.height })}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
          <label style={fieldLabel}>
            步数
            <input type="number" min={1} max={100} value={form.steps} onChange={(event) => updateForm({ steps: Number(event.target.value) })} style={inputStyle} />
          </label>
          <label style={fieldLabel}>
            CFG
            <input type="number" step={0.5} min={0} max={30} value={form.cfg} onChange={(event) => updateForm({ cfg: Number(event.target.value) })} style={inputStyle} />
          </label>
          <label style={fieldLabel}>
            种子（空=随机）
            <input value={form.seedText} inputMode="numeric" onChange={(event) => updateForm({ seedText: event.target.value })} placeholder="随机" style={inputStyle} />
          </label>
        </div>

        <button
          className="primary-action"
          disabled={submitting}
          onClick={() => void submit()}
          style={{ width: "100%", padding: "14px 0", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
          {submitting ? "提交中…" : "开始生图"}
        </button>
        {error && <div style={{ marginTop: 10, fontSize: 13, color: "#dc2626" }}>{error}</div>}
      </section>

      {currentId && task && status && (
        <section style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: status.color, flexShrink: 0 }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: status.color }}>{status.label}</span>
            <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
              {task.params.width}×{task.params.height} · {task.params.steps} 步 · seed {task.params.seed}
            </span>
          </div>

          {(task.status === "queued" || task.status === "running") && (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>生图在电脑上进行，手机可以锁屏或切后台；完成后自动展示成图。</div>
          )}

          {task.status === "done" && task.images.length > 0 && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {task.images.map((image, index) => (
                  <img
                    key={image.filename}
                    src={`/api/mobile/gen/tasks/${task.id}/image/${index}`}
                    alt={`成图 ${index + 1}`}
                    style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-alt)" }}
                  />
                ))}
              </div>
              <button
                className={copied ? "secondary-action" : "primary-action"}
                onClick={async () => {
                  if (await copyText(task.params.prompt)) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }
                }}
                style={{ width: "100%", marginTop: 12, padding: "14px 0", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
              >
                <Copy size={18} />
                {copied ? "已复制提示词" : "复制提示词"}
              </button>
            </>
          )}

          {task.status === "error" && (
            <div style={{ fontSize: 13, color: "#dc2626", background: "rgba(220,38,38,0.08)", padding: 12, borderRadius: 8 }}>{task.error ?? "生成失败"}</div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button className="secondary-action" onClick={() => { setCurrentId(null); setTask(null); }} style={{ flex: 1, padding: "12px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <RefreshCw size={16} /> 再来一张
            </button>
          </div>
        </section>
      )}

      <section style={{ marginTop: 8 }}>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8, fontWeight: 600 }}>生图记录</div>
        {recent.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)", background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 10, padding: "16px", textAlign: "center" }}>
            还没有生图记录
          </div>
        ) : (
          recent.slice(0, 8).map((item) => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
              {item.images.length > 0 ? (
                <img src={`/api/mobile/gen/tasks/${item.id}/image/0`} alt="" style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <ImageUp size={16} color="var(--muted)" style={{ flexShrink: 0 }} />
              )}
              <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.params.prompt || "（空提示词）"}
              </span>
              <span style={{ fontSize: 12, color: STATUS_META[item.status].color, flexShrink: 0 }}>{STATUS_META[item.status].label}</span>
              <button
                className="secondary-action"
                onClick={() => void removeTask(item.id)}
                title="删除记录"
                style={{ padding: "4px 8px", fontSize: 12, display: "flex", flexShrink: 0 }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
