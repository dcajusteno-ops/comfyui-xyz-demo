import React, { useState } from "react";
import { Languages, X, Copy, ArrowRightLeft } from "lucide-react";
import { translateText, TranslationSettings } from "../lib/translation";

interface TranslationToolDialogProps {
  onClose: () => void;
  translationSettings: TranslationSettings;
  onToast: (type: "success" | "error" | "info", title: string, message?: string) => void;
}

export function TranslationToolDialog({ onClose, translationSettings, onToast }: TranslationToolDialogProps) {
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [direction, setDirection] = useState<"zh2en" | "en2zh">("zh2en");
  const [isTranslating, setIsTranslating] = useState(false);

  async function handleTranslate() {
    if (!inputText.trim()) return;
    setIsTranslating(true);
    try {
      const result = await translateText(inputText, translationSettings, direction);
      setOutputText(result);
    } catch (err) {
      onToast("error", "翻译失败", err instanceof Error ? err.message : String(err));
    } finally {
      setIsTranslating(false);
    }
  }

  async function handleCopy() {
    if (!outputText.trim()) return;
    try {
      await navigator.clipboard.writeText(outputText);
      onToast("success", "复制成功", "翻译结果已复制到剪贴板");
    } catch (err) {
      onToast("error", "复制失败", err instanceof Error ? err.message : String(err));
    }
  }

  function toggleDirection() {
    setDirection(prev => prev === "zh2en" ? "en2zh" : "zh2en");
    if (outputText) {
      setInputText(outputText);
      setOutputText("");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div 
        className="modal" 
        onClick={(e) => e.stopPropagation()}
        style={{ 
          maxWidth: "600px", 
          width: "100%",
          padding: 0,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 48px rgba(0,0,0,0.12)",
          borderRadius: "16px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          animation: "fadeScaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
        }}
      >
        <div style={{
          background: "var(--surface-alt)",
          borderBottom: "1px solid var(--border)",
          padding: "20px 24px",
          color: "var(--text)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <h2 style={{ margin: 0, fontSize: "1.2rem", display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}>
            <Languages size={22} color="var(--accent)" />
            独立翻译工具
          </h2>
          <button 
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text)",
              borderRadius: "50%",
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "background 0.2s"
            }}
            onMouseOver={(e) => e.currentTarget.style.background = "var(--surface)"}
            onMouseOut={(e) => e.currentTarget.style.background = "transparent"}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.95rem", fontWeight: 500, color: "var(--text)" }}>
              {direction === "zh2en" ? "中文输入" : "英文输入"}
            </span>
            <button 
              className="secondary-action" 
              onClick={toggleDirection}
              style={{ padding: "4px 12px", fontSize: "0.85rem", height: "auto" }}
            >
              <ArrowRightLeft size={14} style={{ marginRight: "4px" }} />
              切换为 {direction === "zh2en" ? "英翻中" : "中翻英"}
            </button>
          </div>
          
          <textarea 
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder={direction === "zh2en" ? "请输入要翻译的中文..." : "请输入要翻译的英文..."}
            style={{
              width: "100%",
              height: "120px",
              padding: "12px",
              background: "var(--surface-alt)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              color: "var(--text)",
              resize: "none",
              fontSize: "0.95rem",
              fontFamily: "inherit"
            }}
          />

          <div style={{ display: "flex", justifyContent: "center", margin: "4px 0" }}>
            <button 
              className="primary-action"
              onClick={handleTranslate}
              disabled={isTranslating || !inputText.trim()}
              style={{ width: "100%", justifyContent: "center", height: "40px" }}
            >
              {isTranslating ? "翻译中..." : "开始翻译"}
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
            <span style={{ fontSize: "0.95rem", fontWeight: 500, color: "var(--text)" }}>
              翻译结果
            </span>
            <button 
              className="icon-button"
              onClick={handleCopy}
              disabled={!outputText}
              style={{ padding: "4px 12px", fontSize: "0.85rem", background: "transparent", border: "1px solid var(--border)" }}
            >
              <Copy size={14} style={{ marginRight: "4px" }} />
              一键复制
            </button>
          </div>

          <textarea 
            value={outputText}
            readOnly
            placeholder="翻译结果将显示在这里..."
            style={{
              width: "100%",
              height: "120px",
              padding: "12px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              color: "var(--text)",
              resize: "none",
              fontSize: "0.95rem",
              fontFamily: "inherit"
            }}
          />
        </div>
      </div>
    </div>
  );
}
