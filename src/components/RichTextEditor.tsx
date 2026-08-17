import { useState, useRef, useEffect } from "react";
import {
  Clock,
  Copy,
  Download,
  Maximize,
  Minimize,
  Trash2,
  Type,
  Upload,
  Save,
  CheckCircle2,
  Eraser,
  Sparkles,
  Zap,
  AlignLeft
} from "lucide-react";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  title: string;
  onClear: () => void;
  saving?: boolean;
}

const COMMON_SNIPPETS = [
  { label: "大师级", value: "masterpiece, best quality, highres, " },
  { label: "写实", value: "photorealistic, ultra detailed, 8k uhd, " },
  { label: "二次元", value: "anime style, vibrant colors, " },
  { label: "负面提示词", value: "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, " }
];

export function RichTextEditor({ value, onChange, onSave, title, onClear, saving }: RichTextEditorProps) {
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [zoom, setZoom] = useState(16);
  const [showSnippets, setShowSnippets] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  const insertText = (text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentText = textarea.value;
    const newText = currentText.substring(0, start) + text + currentText.substring(end);
    
    onChange(newText);
    
    // Focus back and set selection
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + text.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const handleCopyPrompt = () => {
    // Clean up text for ComfyUI: strip HTML tags if any, collapse multiple spaces/newlines
    const div = document.createElement("div");
    div.innerHTML = value;
    let cleanText = div.innerText || div.textContent || value;
    
    // Remove multiple newlines and spaces that might break prompts
    cleanText = cleanText.replace(/\n\s*\n/g, "\n").trim();
    
    navigator.clipboard.writeText(cleanText);
  };

  const handleDownload = () => {
    const blob = new Blob([value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title || "prompt"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      onChange(text);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const cleanupHtml = () => {
    const div = document.createElement("div");
    div.innerHTML = value;
    const plainText = div.innerText || div.textContent || "";
    onChange(plainText.replace(/&nbsp;/g, " ").trim());
  };

  const ToolbarButton = ({ icon: Icon, title, onClick, active, color }: any) => (
    <button 
      type="button" 
      className={`lm-text-btn ${active ? "active" : ""}`} 
      onClick={onClick} 
      title={title} 
      style={{ 
        padding: "6px 10px",
        background: active ? "rgba(59, 130, 246, 0.2)" : "transparent",
        color: active ? "#60a5fa" : (color || "#94a3b8"),
        borderRadius: "6px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        fontSize: "12px",
        border: active ? "1px solid rgba(59, 130, 246, 0.3)" : "1px solid transparent",
      }}
    >
      <Icon size={16} />
      {title && <span className="btn-label">{title}</span>}
    </button>
  );

  return (
    <div className={`rich-editor-container ${isFullScreen ? "fullscreen" : ""}`} style={{
      display: "flex",
      flexDirection: "column",
      flex: 1,
      minHeight: 0,
      background: "#080b12",
      ...(isFullScreen ? { position: "fixed", inset: 0, zIndex: 1000, padding: "20px" } : {})
    }}>
      {/* Prompt Utility Bar */}
      <div style={{ 
        display: "flex", 
        gap: "8px", 
        flexWrap: "wrap", 
        marginBottom: "10px", 
        background: "#111827", 
        padding: "8px 12px", 
        borderRadius: "10px", 
        border: "1px solid #263244", 
        alignItems: "center" 
      }}>
        <button 
          type="button" 
          className="primary-action" 
          onClick={handleCopyPrompt}
          style={{ 
            background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
            padding: "6px 16px",
            height: "32px",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            boxShadow: "0 4px 12px rgba(37, 99, 235, 0.2)"
          }}
        >
          <Copy size={16} />
          复制到 ComfyUI
        </button>

        <div style={{ width: "1px", height: "20px", background: "#263244", margin: "0 4px" }} />

        <div style={{ position: "relative" }}>
          <ToolbarButton 
            icon={Sparkles} 
            title="快捷片段" 
            active={showSnippets} 
            onClick={() => setShowSnippets(!showSnippets)} 
            color="#fbbf24"
          />
          {showSnippets && (
            <div style={{
              position: "absolute",
              top: "100%",
              left: 0,
              marginTop: "8px",
              background: "#111827",
              border: "1px solid #263244",
              borderRadius: "8px",
              padding: "8px",
              zIndex: 10,
              boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
              width: "200px",
              display: "flex",
              flexDirection: "column",
              gap: "4px"
            }}>
              {COMMON_SNIPPETS.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="lm-text-btn"
                  style={{ justifyContent: "flex-start", padding: "6px 10px", fontSize: "12px", width: "100%" }}
                  onClick={() => {
                    insertText(s.value);
                    setShowSnippets(false);
                  }}
                >
                  <Zap size={14} style={{ marginRight: "8px", color: "#fbbf24" }} />
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <ToolbarButton icon={Clock} title="时间戳" onClick={() => insertText(`\n[${new Date().toLocaleString()}]\n`)} />
        <ToolbarButton icon={Eraser} title="清理格式" onClick={cleanupHtml} />
        
        <div style={{ width: "1px", height: "20px", background: "#263244", margin: "0 4px" }} />
        
        <ToolbarButton icon={Download} title="导出" onClick={handleDownload} />
        <ToolbarButton icon={Upload} title="导入" onClick={() => fileInputRef.current?.click()} />
        <input type="file" accept=".txt" ref={fileInputRef} style={{ display: "none" }} onChange={handleImport} />
        
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", background: "#0c111a", padding: "2px", borderRadius: "6px", border: "1px solid #1e293b" }}>
            <button type="button" className="lm-text-btn" onClick={() => setZoom(Math.max(12, zoom - 2))} title="缩小"><Type size={14} /></button>
            <span style={{ color: "#94a3b8", fontSize: "12px", width: "24px", textAlign: "center" }}>{zoom}</span>
            <button type="button" className="lm-text-btn" onClick={() => setZoom(Math.min(32, zoom + 2))} title="放大"><Type size={18} /></button>
          </div>
          
          <button 
            type="button" 
            className="primary-action" 
            onClick={onSave} 
            disabled={saving}
            style={{ 
              padding: "4px 12px", 
              fontSize: "12px", 
              height: "28px", 
              background: saving ? "#059669" : "#374151",
              border: "none"
            }}
          >
            {saving ? <CheckCircle2 size={14} className="animate-pulse" /> : <Save size={14} />}
            {saving ? "已存" : "保存"}
          </button>

          <button 
            type="button" 
            className="lm-text-btn" 
            onClick={() => setIsFullScreen(!isFullScreen)} 
            title={isFullScreen ? "退出全屏" : "全屏模式"}
          >
            {isFullScreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>

      {/* Main Textarea */}
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{
          position: "absolute",
          top: "10px",
          right: "20px",
          fontSize: "11px",
          color: "#4b5563",
          pointerEvents: "none",
          zIndex: 5
        }}>
          {value.length} 字符 | {value.split(/\s+/).filter(Boolean).length} 单词
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
              e.preventDefault();
              onSave();
            }
            if (e.key === "Tab") {
              e.preventDefault();
              insertText("  ");
            }
          }}
          placeholder="在这里记录您的提示词（Prompt）..."
          style={{
            flex: 1,
            padding: "24px",
            outline: "none",
            fontSize: `${zoom}px`,
            lineHeight: 1.8,
            color: "#e2e8f0",
            background: "#0c111a",
            borderRadius: "12px",
            border: "1px solid #1e293b",
            fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
            resize: "none",
            tabSize: 2,
            boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)"
          }}
        />
      </div>

      <style>{`
        .btn-label { display: inline; }
        @media (max-width: 1200px) {
          .btn-label { display: none; }
        }
        textarea::placeholder {
          color: #334155;
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
