import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Braces, Dices, Pencil, Save, Sparkles, X } from "lucide-react";
import {
  listWildcardFiles,
  loadWildcards,
  saveWildcardFile,
  describeWildcards,
  type WildcardFileState,
  type WildcardSummary,
} from "../../../lib/wildcards";
import { resolveDynamicPrompt, detectDynamicSyntax } from "../../../lib/dynamicPrompt";
import type { Toast } from "../../../types";

/**
 * 动态提示词 / 通配符弹窗。
 * T9 起支持在线编辑词库：读写走 `/xyz/wildcards`（server/wildcards.ts），
 * 保存后立即重新加载注册表，`__name__` 引用即时生效。
 */
export function WildcardHelper({
  onClose,
  onInsert,
  onToast,
}: {
  onClose: () => void;
  onInsert: (text: string) => void;
  onToast?: (type: Toast["type"], title: string, message?: string) => void;
}) {
  const [packs, setPacks] = useState<WildcardSummary[] | null>(null);
  const [fileStates, setFileStates] = useState<WildcardFileState[]>([]);
  const [error, setError] = useState("");
  const [sample, setSample] = useState("{油画|水彩}, __styles__");
  const [preview, setPreview] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const [files, map] = await Promise.all([listWildcardFiles(), loadWildcards()]);
    setFileStates(files);
    setPacks(describeWildcards(map));
  }, []);

  useEffect(() => {
    refresh().catch(() => setError("通配符词库加载失败"));
  }, [refresh]);

  const reroll = () => {
    setPreview(resolveDynamicPrompt(sample, Math.floor(Math.random() * 2 ** 31)));
  };

  const hasSampleSyntax = detectDynamicSyntax(sample).choices + detectDynamicSyntax(sample).wildcards > 0;

  function startEdit(file: WildcardFileState) {
    setEditingName(file.name);
    setDraft(file.content);
  }

  async function saveEdit(name: string) {
    const file = fileStates.find((item) => item.name === name);
    if (!file) return;
    setSaving(true);
    try {
      await saveWildcardFile(name, draft, file.revision);
      await refresh();
      setEditingName(null);
      onToast?.("success", "词库已保存", `__${name}__ 已更新，引用即时生效`);
    } catch (saveError) {
      const err = saveError as Error & { conflict?: boolean };
      onToast?.("error", err.conflict ? "词库已被其它窗口修改" : "词库保存失败", err.message);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" style={{ zIndex: 10050 }}>
      <div className="modal" style={{ width: "560px", maxWidth: "92vw" }}>
        <div className="modal-head">
          <h2>动态提示词 / 通配符</h2>
          <button type="button" className="icon-button" onClick={onClose}><X size={16} /> 关闭</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "4px 0" }}>
        <div style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.7 }}>
          支持两种语法：<code>{"{蓝天|星空|黄昏}"}</code> 随机三选一；<code>__styles__</code> 从词库抽一行。
          Lora 语法与动态语法可并存，提交时按 seed 展开（同 seed 可复现）。词库可直接在线编辑并落盘。
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button type="button" className="secondary-action" onClick={() => onInsert("{a|b|c}")}>
            <Braces size={14} /> 插入多选
          </button>
          <input
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder="示例提示词"
            style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-alt)", color: "var(--text)", fontSize: 13 }}
          />
          <button type="button" className="secondary-action" onClick={reroll} disabled={!hasSampleSyntax}>
            <Dices size={14} /> 展开预览
          </button>
        </div>
        {preview && (
          <div style={{ fontSize: 13, color: "var(--text)", background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", wordBreak: "break-word" }}>
            <Sparkles size={13} style={{ verticalAlign: "-2px", marginRight: 6, color: "var(--accent)" }} />
            {preview}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {packs === null && !error && <div style={{ fontSize: 13, color: "var(--muted)" }}>加载词库中…</div>}
          {error && <div style={{ fontSize: 13, color: "#dc2626" }}>{error}</div>}
          {packs?.map((pack) => {
            const file = fileStates.find((item) => item.name === pack.name);
            const editing = editingName === pack.name;
            return (
              <div key={pack.name} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px", background: "var(--surface-alt)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <code style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>__{pack.name}__</code>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{pack.count} 条</span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    {editing ? (
                      <>
                        <button
                          type="button"
                          className="primary-action"
                          style={{ padding: "3px 10px", fontSize: 12 }}
                          disabled={saving}
                          onClick={() => void saveEdit(pack.name)}
                        >
                          <Save size={13} /> 保存
                        </button>
                        <button
                          type="button"
                          className="secondary-action"
                          style={{ padding: "3px 10px", fontSize: 12 }}
                          disabled={saving}
                          onClick={() => setEditingName(null)}
                        >
                          <X size={13} /> 取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="secondary-action"
                          style={{ padding: "3px 10px", fontSize: 12 }}
                          title="在线编辑该词库并保存到 public/wildcards"
                          onClick={() => file && startEdit(file)}
                          disabled={!file}
                        >
                          <Pencil size={13} /> 编辑
                        </button>
                        <button
                          type="button"
                          className="secondary-action"
                          style={{ padding: "3px 10px", fontSize: 12 }}
                          onClick={() => onInsert(`__${pack.name}__`)}
                        >
                          插入
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {editing ? (
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    spellCheck={false}
                    style={{
                      width: "100%",
                      minHeight: "180px",
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "var(--surface)",
                      color: "var(--text)",
                      fontSize: 13,
                      fontFamily: "var(--font-mono, monospace)",
                      lineHeight: 1.6,
                      resize: "vertical",
                    }}
                  />
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {pack.preview.map((word) => (
                      <span key={word} style={{ fontSize: 12, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 8px" }}>
                        {word}
                      </span>
                    ))}
                    {pack.count > pack.preview.length && <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>…</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      </div>
    </div>,
    document.body,
  );
}
