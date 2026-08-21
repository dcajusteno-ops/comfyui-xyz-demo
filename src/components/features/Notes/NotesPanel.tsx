import { FileText, Maximize, Minimize, Plus, Search, Trash2 } from "lucide-react";
import { RichTextEditor } from "../../ui";
import type { NoteItem } from "../../../types";

export function NotesPanel({
  notes,
  activeNoteId,
  notesSaving,
  notesSearch,
  isNotesWide,
  setNotesSearch,
  setIsNotesWide,
  setActiveNoteId,
  handleAddNote,
  handleDeleteNote,
  updateActiveNote,
  saveNotes,
  confirm,
}: {
  notes: NoteItem[];
  activeNoteId: string | null;
  notesSaving: boolean;
  notesSearch: string;
  isNotesWide: boolean;
  setNotesSearch: (value: string) => void;
  setIsNotesWide: (value: boolean) => void;
  setActiveNoteId: (id: string | null) => void;
  handleAddNote: () => void;
  handleDeleteNote: (id: string) => void;
  updateActiveNote: (partial: Partial<NoteItem>) => void;
  saveNotes: (notes: NoteItem[], silent?: boolean) => Promise<void>;
  confirm: (title: string, message: string, onConfirm: () => void) => void;
}) {
  const filteredNotes = notes.filter(n =>
    n.title.toLowerCase().includes(notesSearch.toLowerCase()) ||
    n.content.toLowerCase().includes(notesSearch.toLowerCase())
  );

  return (
    <section className="panel notes-panel" style={{ padding: 0, display: "flex", flexDirection: "row", overflow: "hidden" }}>
      {/* Sidebar */}
      <div style={{ width: "260px", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", background: "var(--surface)" }}>
        <div style={{ padding: "16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "bold", color: "var(--text)" }}>
              <FileText size={18} /> 记事本
            </div>
            <button type="button" className="lm-text-btn" onClick={handleAddNote} title="新建笔记">
              <Plus size={18} />
            </button>
          </div>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
            <input
              type="text"
              placeholder="搜索笔记..."
              value={notesSearch}
              onChange={(e) => setNotesSearch(e.target.value)}
              style={{
                width: "100%",
                background: "var(--input-bg)",
                border: "1px solid var(--input-border)",
                borderRadius: "6px",
                padding: "6px 8px 6px 28px",
                fontSize: "12px",
                color: "var(--text)",
                outline: "none"
              }}
            />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px" }} className="custom-scrollbar">
          {filteredNotes.length === 0 && (
            <div className="empty-state" style={{ padding: "40px 0", fontSize: "12px" }}>
              {notes.length === 0 ? "暂无笔记" : "未找到匹配项"}
            </div>
          )}
          {filteredNotes.map((note) => (
            <div
              key={note.id}
              onClick={() => setActiveNoteId(note.id)}
              style={{
                padding: "10px 12px",
                marginBottom: "4px",
                borderRadius: "8px",
                cursor: "pointer",
                background: activeNoteId === note.id ? "var(--accent-soft)" : "transparent",
                border: activeNoteId === note.id ? "1px solid var(--accent)" : "1px solid transparent",
                color: activeNoteId === note.id ? "var(--accent)" : "var(--muted)",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                transition: "all 0.15s ease",
              }}
              className="note-list-item"
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: activeNoteId === note.id ? "bold" : "normal", fontSize: "13px" }}>
                  {note.title || "未命名"}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteNote(note.id);
                  }}
                  className="delete-btn"
                  style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: "2px", display: "flex", opacity: 0.6 }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
                <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
                {note.content.length > 0 && <span>{note.content.length} 字</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "16px", background: "var(--surface-alt)" }}>
        {activeNoteId && notes.find((n) => n.id === activeNoteId) ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
                <input
                  type="text"
                  value={notes.find((n) => n.id === activeNoteId)?.title || ""}
                  onChange={(e) => updateActiveNote({ title: e.target.value })}
                  placeholder="笔记标题"
                  style={{
                    background: "transparent",
                    border: "none",
                    fontSize: "18px",
                    fontWeight: "bold",
                    color: "var(--text)",
                    width: "100%",
                    outline: "none",
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  type="button"
                  className={`lm-text-btn ${isNotesWide ? "active" : ""}`}
                  onClick={() => setIsNotesWide(!isNotesWide)}
                  title={isNotesWide ? "显示输出面板" : "全宽模式"}
                  style={{
                    color: isNotesWide ? "var(--accent)" : "var(--muted)",
                    background: isNotesWide ? "var(--accent-soft)" : "transparent",
                    padding: "4px",
                    borderRadius: "4px"
                  }}
                >
                  {isNotesWide ? <Minimize size={18} /> : <Maximize size={18} />}
                </button>
                {notesSaving && <span style={{ fontSize: "12px", color: "var(--accent)" }} className="animate-pulse">保存中...</span>}
              </div>
            </div>

            <RichTextEditor
              value={notes.find((n) => n.id === activeNoteId)?.content || ""}
              onChange={(content) => updateActiveNote({ content })}
              onSave={() => saveNotes(notes)}
              title={notes.find((n) => n.id === activeNoteId)?.title || "note"}
              saving={notesSaving}
              onClear={() => {
                confirm("清空内容", "确定要清空当前笔记的所有内容吗？此操作无法撤销。", () => {
                  updateActiveNote({ content: "" });
                });
              }}
            />
          </>
        ) : (
          <div className="empty-state" style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px" }}>
            <div style={{ background: "var(--surface)", padding: "20px", borderRadius: "50%", color: "var(--muted)" }}>
              <FileText size={48} />
            </div>
            <div style={{ color: "var(--muted)" }}>请在左侧选择或新建笔记</div>
            <button type="button" className="primary-action" onClick={handleAddNote}>
              <Plus size={16} /> 新建第一条笔记
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
