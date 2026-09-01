import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScanSearch, Copy, RefreshCw, ImageUp, Loader2 } from "lucide-react";
import { useMobileTasks } from "../../hooks/useMobileTasks";
import type { MobileTask, MobileTaskParams, MobileTaskStatus } from "../../types";

const PARAM_KEY = "comfyui_wd14_params";

const DEFAULT_PARAMS: MobileTaskParams = {
  model: "wd-v1-4-moat-tagger-v2",
  threshold: 0.35,
  characterThreshold: 0.85,
  replaceUnderscore: true,
  trailingComma: true,
  excludeTags: "",
  device: "GPU",
};

function readStoredParams(): MobileTaskParams {
  try {
    const raw = localStorage.getItem(PARAM_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<MobileTaskParams>;
      return { ...DEFAULT_PARAMS, ...p };
    }
  } catch {
    // 忽略损坏的存储
  }
  return { ...DEFAULT_PARAMS };
}

const STATUS_META: Record<MobileTaskStatus, { label: string; color: string }> = {
  queued: { label: "排队中…", color: "var(--muted)" },
  running: { label: "识别中…", color: "var(--accent)" },
  done: { label: "完成", color: "#16a34a" },
  error: { label: "失败", color: "#dc2626" },
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 剪贴板 API 不可用时回退到 textarea 选中复制
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  }
}

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

export const MobileTagPage = () => {
  const { tasks, submit } = useMobileTasks();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [params, setParams] = useState<MobileTaskParams>(readStoredParams);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [copied, setCopied] = useState(false);

  const current = useMemo(() => (currentId ? tasks.find((t) => t.id === currentId) ?? null : null), [tasks, currentId]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handlePick = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    if (picked) {
      setFile(picked);
      setSubmitError("");
      // 换图后若上一任务已结束，回到待提交状态
      if (currentId) setCurrentId(null);
    }
    event.target.value = "";
  }, [currentId]);

  const handleSubmit = useCallback(async () => {
    if (!file) return;
    setSubmitting(true);
    setSubmitError("");
    setCopied(false);
    try {
      const id = await submit(file, params);
      setCurrentId(id);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }, [file, params, submit]);

  const handleReset = useCallback(() => {
    setFile(null);
    setPreviewUrl(null);
    setCurrentId(null);
    setSubmitError("");
    setCopied(false);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!current?.tags) return;
    const ok = await copyText(current.tags);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [current]);

  const status = current ? STATUS_META[current.status] : null;

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--text)", maxWidth: 520, margin: "0 auto", padding: "16px 16px 48px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <ScanSearch size={22} color="var(--accent)" />
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>手机识图</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>图片上传到电脑，由 WD1.4 识别返回 tags</div>
        </div>
      </header>

      {!current && (
        <section style={cardStyle}>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={handlePick}
            style={{ display: "none" }}
          />
          <label
            onClick={() => inputRef.current?.click()}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              border: "2px dashed var(--border)",
              borderRadius: 12,
              padding: "36px 16px",
              cursor: "pointer",
              transition: "border-color 0.2s",
            }}
          >
            <ImageUp size={40} color="var(--muted)" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 15, fontWeight: 500 }}>
              {file ? file.name : "点击选择图片 / 拍照"}
            </div>
            {!file && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>仅支持单张，大小 &lt; 20MB</div>}
          </label>

          {previewUrl && (
            <img
              src={previewUrl}
              alt="待识别"
              style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 8, margin: "12px 0", background: "var(--surface-alt)" }}
            />
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
              模型
              <input
                value={params.model}
                onChange={(e) => setParams((prev) => ({ ...prev, model: e.target.value }))}
                style={{ padding: "10px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)", fontSize: 14 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
              阈值
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={params.threshold}
                onChange={(e) => setParams((prev) => ({ ...prev, threshold: Number(e.target.value) }))}
                style={{ padding: "10px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)", fontSize: 14 }}
              />
            </label>
          </div>

          <details style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
            <summary style={{ cursor: "pointer", padding: "4px 0" }}>高级参数</summary>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                角色阈值
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={params.characterThreshold}
                  onChange={(e) => setParams((prev) => ({ ...prev, characterThreshold: Number(e.target.value) }))}
                  style={{ padding: "10px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)", fontSize: 14 }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                排除 tags
                <input
                  value={params.excludeTags}
                  onChange={(e) => setParams((prev) => ({ ...prev, excludeTags: e.target.value }))}
                  style={{ padding: "10px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)", fontSize: 14 }}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={params.replaceUnderscore} onChange={(e) => setParams((prev) => ({ ...prev, replaceUnderscore: e.target.checked }))} />
                替换下划线
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={params.trailingComma} onChange={(e) => setParams((prev) => ({ ...prev, trailingComma: e.target.checked }))} />
                末尾逗号
              </label>
            </div>
          </details>

          <button
            className="primary-action"
            disabled={!file || submitting}
            onClick={handleSubmit}
            style={{ width: "100%", marginTop: 14, padding: "14px 0", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: !file || submitting ? 0.6 : 1 }}
          >
            {submitting ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <ScanSearch size={18} />}
            {submitting ? "提交中…" : "开始识别"}
          </button>
          {submitError && <div style={{ marginTop: 10, fontSize: 13, color: "#dc2626" }}>{submitError}</div>}
        </section>
      )}

      {current && status && (
        <section style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: status.color, flexShrink: 0 }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: status.color }}>{status.label}</span>
            <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto", wordBreak: "break-all", textAlign: "right" }}>{current.imageName}</span>
          </div>

          {previewUrl && (
            <img src={previewUrl} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 8, marginBottom: 12, background: "var(--surface-alt)" }} />
          )}

          {(current.status === "queued" || current.status === "running") && (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              识别在电脑上进行，手机可以锁屏或切到后台；完成/失败结果会实时同步过来。
            </div>
          )}

          {current.status === "done" && (
            <>
              <div className="output-text" style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {current.tags}
              </div>
              <button
                className={copied ? "secondary-action" : "primary-action"}
                onClick={handleCopy}
                style={{ width: "100%", marginTop: 12, padding: "14px 0", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
              >
                <Copy size={18} />
                {copied ? "已复制" : "复制 tags"}
              </button>
            </>
          )}

          {current.status === "error" && (
            <div style={{ fontSize: 13, color: "#dc2626", background: "rgba(220,38,38,0.08)", padding: 12, borderRadius: 8 }}>{current.error ?? "识别失败"}</div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button className="secondary-action" onClick={handleReset} style={{ flex: 1, padding: "12px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <RefreshCw size={16} />
              {current.status === "error" ? "重新选择" : "再传一张"}
            </button>
          </div>
        </section>
      )}

      <section style={{ marginTop: 8 }}>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8, fontWeight: 600 }}>最近记录</div>
        {tasks.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)", background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 10, padding: "16px", textAlign: "center" }}>
            还没有识别记录
          </div>
        ) : (
          tasks.slice(0, 10).map((task) => (
            <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_META[task.status].color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.imageName}</span>
              <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>{STATUS_META[task.status].label}</span>
              {task.status === "done" && (
                <button
                  className="secondary-action"
                  onClick={async () => copyText(task.tags)}
                  style={{ padding: "4px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}
                >
                  <Copy size={12} />
                  复制
                </button>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
};