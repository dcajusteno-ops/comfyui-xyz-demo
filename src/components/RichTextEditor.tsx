import { useState, useRef, useEffect } from "react";
import {
  Bold,
  Clock,
  Copy,
  Download,
  Eraser,
  Heading1,
  Heading2,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Maximize,
  Minimize,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  Undo,
  Redo,
  Upload
} from "lucide-react";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  title: string;
  onClear: () => void;
}

export function RichTextEditor({ value, onChange, onSave, title, onClear }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [zoom, setZoom] = useState(16); // Base font size
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync initial value, but avoid cursor jumps during active typing
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const exec = (command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    handleInput();
  };

  const handleCopy = () => {
    if (editorRef.current) {
      const text = editorRef.current.innerText; // Copy plain text for ComfyUI
      navigator.clipboard.writeText(text);
      // Let parent handle toast if needed, but we don't have access to pushToast here easily unless passed down.
      // So we just rely on browser or add a simple callback. For now, it copies silently.
    }
  };

  const handleDownload = () => {
    if (editorRef.current) {
      const text = editorRef.current.innerText;
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title || "note"}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      exec("insertHTML", safeText);
    };
    reader.readAsText(file);
    e.target.value = ""; // reset
  };

  const insertTime = () => {
    const time = new Date().toLocaleString();
    exec("insertText", time);
  };

  const ToolbarButton = ({ icon: Icon, title, onClick }: any) => (
    <button type="button" className="lm-text-btn" onClick={onClick} title={title} style={{ padding: "6px" }}>
      <Icon size={16} />
    </button>
  );

  return (
    <div className={`rich-editor-container ${isFullScreen ? "fullscreen" : ""}`} style={{
      display: "flex",
      flexDirection: "column",
      flex: 1,
      minHeight: 0,
      background: "#080b12",
      ...(isFullScreen ? { position: "fixed", inset: 0, zIndex: 100, padding: "20px" } : {})
    }}>
      {/* Primary Toolbar */}
      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "8px", background: "#111827", padding: "6px 10px", borderRadius: "8px", border: "1px solid #263244", alignItems: "center" }}>
        <ToolbarButton icon={Undo} title="撤销 (Ctrl+Z)" onClick={() => exec("undo")} />
        <ToolbarButton icon={Redo} title="重做 (Ctrl+Y)" onClick={() => exec("redo")} />
        <div style={{ width: "1px", height: "16px", background: "#263244", margin: "0 4px" }} />
        
        <ToolbarButton icon={Bold} title="加粗" onClick={() => exec("bold")} />
        <ToolbarButton icon={Italic} title="斜体" onClick={() => exec("italic")} />
        <ToolbarButton icon={Underline} title="下划线" onClick={() => exec("underline")} />
        <ToolbarButton icon={Strikethrough} title="删除线" onClick={() => exec("strikeThrough")} />
        <div style={{ width: "1px", height: "16px", background: "#263244", margin: "0 4px" }} />
        
        <ToolbarButton icon={Heading1} title="一级标题" onClick={() => exec("formatBlock", "H1")} />
        <ToolbarButton icon={Heading2} title="二级标题" onClick={() => exec("formatBlock", "H2")} />
        <ToolbarButton icon={List} title="无序列表" onClick={() => exec("insertUnorderedList")} />
        <ToolbarButton icon={ListOrdered} title="有序列表" onClick={() => exec("insertOrderedList")} />
        <div style={{ width: "1px", height: "16px", background: "#263244", margin: "0 4px" }} />
        
        <ToolbarButton icon={Highlighter} title="高亮标记" onClick={() => exec("hiliteColor", "rgba(234, 179, 8, 0.4)")} />
        <ToolbarButton icon={Eraser} title="清除格式" onClick={() => exec("removeFormat")} />
        <div style={{ width: "1px", height: "16px", background: "#263244", margin: "0 4px" }} />
        
        <ToolbarButton icon={Copy} title="复制纯文本" onClick={handleCopy} />
        <ToolbarButton icon={Download} title="下载本地文件" onClick={handleDownload} />
        <ToolbarButton icon={Upload} title="导入本地文件" onClick={() => fileInputRef.current?.click()} />
        <input type="file" accept=".txt,.md" ref={fileInputRef} style={{ display: "none" }} onChange={handleImport} />
        
        <ToolbarButton icon={Clock} title="插入时间" onClick={insertTime} />
        <ToolbarButton icon={Trash2} title="清空内容" onClick={onClear} />
        
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
          <button type="button" className="lm-text-btn" onClick={() => setZoom(Math.max(12, zoom - 2))} title="缩小字号"><Type size={14} /></button>
          <span style={{ color: "#94a3b8", fontSize: "12px", width: "24px", textAlign: "center" }}>{zoom}</span>
          <button type="button" className="lm-text-btn" onClick={() => setZoom(Math.min(32, zoom + 2))} title="放大字号"><Type size={18} /></button>
          
          <div style={{ width: "1px", height: "16px", background: "#263244", margin: "0 4px" }} />
          <ToolbarButton icon={isFullScreen ? Minimize : Maximize} title={isFullScreen ? "退出全屏" : "全屏沉浸模式"} onClick={() => setIsFullScreen(!isFullScreen)} />
        </div>
      </div>

      {/* Editor Area */}
      <div 
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            onSave();
          }
        }}
        className="rich-editor-content"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          outline: "none",
          fontSize: `${zoom}px`,
          lineHeight: 1.6,
          color: "#e2e8f0",
          background: "#0c111a",
          borderRadius: "8px",
          border: "1px solid #1e293b",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        }}
      />
    </div>
  );
}
