import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Braces, Dices, Sparkles, X } from "lucide-react";
import { loadWildcards, describeWildcards, type WildcardSummary } from "../../../lib/wildcards";
import { resolveDynamicPrompt, detectDynamicSyntax } from "../../../lib/dynamicPrompt";

export function WildcardHelper({ onClose, onInsert }: { onClose: () => void; onInsert: (text: string) => void }) {
  const [packs, setPacks] = useState<WildcardSummary[] | null>(null);
  const [error, setError] = useState("");
  const [sample, setSample] = useState("{油画|水彩}, __styles__");
  const [preview, setPreview] = useState("");

  useEffect(() => {
    void loadWildcards()
      .then((map) => setPacks(describeWildcards(map)))
      .catch(() => setError("通配符词库加载失败"));
  }, []);

  const reroll = () => {
    setPreview(resolveDynamicPrompt(sample, Math.floor(Math.random() * 2 ** 31)));
  };

  const hasSampleSyntax = detectDynamicSyntax(sample).choices + detectDynamicSyntax(sample).wildcards > 0;

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
          Lora 语法与动态语法可并存，提交时按 seed 展开（同 seed 可复现）。
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
          {packs?.map((pack) => (
            <div key={pack.name} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px", background: "var(--surface-alt)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <code style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>__{pack.name}__</code>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{pack.count} 条</span>
                <button
                  type="button"
                  className="secondary-action"
                  style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 12 }}
                  onClick={() => onInsert(`__${pack.name}__`)}
                >
                  插入
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {pack.preview.map((word) => (
                  <span key={word} style={{ fontSize: 12, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 8px" }}>
                    {word}
                  </span>
                ))}
                {pack.count > pack.preview.length && <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>…</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
      </div>
    </div>,
    document.body,
  );
}