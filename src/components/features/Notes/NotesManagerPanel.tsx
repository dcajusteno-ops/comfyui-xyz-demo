import React, { useRef, useState } from "react";
import {
  FileText,
  Plus,
  Search,
  Trash2,
  Minimize,
  Maximize,
  Tag as TagIcon,
  X,
} from "lucide-react";
import { RichTextEditor } from "../../ui";
import type { Note } from "../../../types";

/** 附件图约束：防止 notes.json 超过服务端 2MB 请求上限（见 server/utils.ts DEFAULT_BODY_LIMIT） */
const MAX_IMAGES_PER_NOTE = 6;
const IMAGE_MAX_SIDE = 400;
const IMAGE_QUALITY = 0.72;

/** 压缩为 data URL：最长边 400px 的 JPEG，单张约 20–50KB */
async function fileToCompressedDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", IMAGE_QUALITY);
}

interface NotesManagerPanelProps {
  notes: Note[];
  activeNoteId: string | null;
  notesSearch: string;
  setNotesSearch: (search: string) => void;
  setActiveNoteId: (id: string | null) => void;
  handleAddNote: (content?: string) => void;
  handleDeleteNote: (id: string) => void;
  updateActiveNote: (patch: Partial<Note>) => void;
  saveNotes: (notes: Note[]) => void;
  notesSaving: boolean;
  isNotesWide: boolean;
  setIsNotesWide: (wide: boolean) => void;
  onConfirmClear: () => void;
}

export function NotesManagerPanel({
  notes,
  activeNoteId,
  notesSearch,
  setNotesSearch,
  setActiveNoteId,
  handleAddNote,
  handleDeleteNote,
  updateActiveNote,
  saveNotes,
  notesSaving,
  isNotesWide,
  setIsNotesWide,
  onConfirmClear,
}: NotesManagerPanelProps) {
  const [tagDraft, setTagDraft] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const search = notesSearch.toLowerCase();
  const filteredNotes = notes.filter(
    (n) =>
      n.title.toLowerCase().includes(search) ||
      n.content.toLowerCase().includes(search) ||
      (n.tags ?? []).some((tag) => tag.toLowerCase().includes(search)),
  );

  const activeNote = notes.find((n) => n.id === activeNoteId);
  const allTags = Array.from(new Set(notes.flatMap((n) => n.tags ?? [])));

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (!activeNote || !tag) return;
    const tags = activeNote.tags ?? [];
    if (!tags.some((item) => item.toLowerCase() === tag.toLowerCase())) {
      updateActiveNote({ tags: [...tags, tag] });
    }
    setTagDraft("");
  };

  const removeTag = (tag: string) => {
    if (!activeNote) return;
    updateActiveNote({ tags: (activeNote.tags ?? []).filter((item) => item !== tag) });
  };

  const appendImages = async (files: FileList | File[]) => {
    if (!activeNote) return;
    const images = activeNote.images ?? [];
    const slots = MAX_IMAGES_PER_NOTE - images.length;
    if (slots <= 0) return;
    const picked = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, slots);
    if (picked.length === 0) return;
    const compressed: string[] = [];
    for (const file of picked) {
      try {
        compressed.push(await fileToCompressedDataUrl(file));
      } catch {
        // 单张失败跳过，不中断整批
      }
    }
    updateActiveNote({ images: [...images, ...compressed] });
  };

  const removeImage = (index: number) => {
    if (!activeNote) return;
    updateActiveNote({ images: (activeNote.images ?? []).filter((_, i) => i !== index) });
  };

  return (
    <section
      className="panel notes-panel"
      style={{ padding: 0, display: "flex", flexDirection: "row", overflow: "hidden" }}
      onDragOver={(event) => {
        if (activeNote) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        if (!activeNote) return;
        event.preventDefault();
        setDragging(false);
        void appendImages(event.dataTransfer.files);
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: "260px",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          background: "var(--surface)",
        }}
      >
        <div style={{ padding: "16px", borderBottom: "1px solid var(--border)" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontWeight: "bold",
                color: "var(--text)",
              }}
            >
              <FileText size={18} /> 记事本
            </div>
            <button
              type="button"
              className="lm-text-btn"
              onClick={() => handleAddNote()}
              title="新建笔记"
            >
              <Plus size={18} />
            </button>
          </div>
          <div style={{ position: "relative" }}>
            <Search
              size={14}
              style={{
                position: "absolute",
                left: "8px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--muted)",
              }}
            />
            <input
              type="text"
              placeholder="搜索笔记或标签..."
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
                outline: "none",
              }}
            />
          </div>
          {allTags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="lm-text-btn"
                  style={{
                    fontSize: 11,
                    padding: "1px 7px",
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    background: notesSearch === tag ? "var(--accent-soft)" : "transparent",
                    color: notesSearch === tag ? "var(--accent)" : "var(--muted)",
                  }}
                  title={`按标签「${tag}」筛选`}
                  onClick={() => setNotesSearch(notesSearch === tag ? "" : tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
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
                background:
                  activeNoteId === note.id ? "var(--accent-soft)" : "transparent",
                border:
                  activeNoteId === note.id
                    ? "1px solid var(--accent)"
                    : "1px solid transparent",
                color: activeNoteId === note.id ? "var(--accent)" : "var(--muted)",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                transition: "all 0.15s ease",
              }}
              className="note-list-item"
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: activeNoteId === note.id ? "bold" : "normal",
                    fontSize: "13px",
                  }}
                >
                  {note.title || "未命名"}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteNote(note.id);
                  }}
                  className="delete-btn"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--muted)",
                    cursor: "pointer",
                    padding: "2px",
                    display: "flex",
                    opacity: 0.6,
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--muted)",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
                <span>{note.content.length > 0 ? `${note.content.length} 字` : (note.images?.length ?? 0) > 0 ? `${note.images?.length} 图` : ""}</span>
              </div>
              {(note.tags ?? []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {(note.tags ?? []).map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: 10,
                        padding: "0 6px",
                        borderRadius: 999,
                        border: "1px solid var(--border)",
                        color: "var(--muted)",
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "16px",
          background: "var(--surface-alt)",
          outline: dragging ? "2px dashed var(--accent)" : "none",
          outlineOffset: "-6px",
        }}
      >
        {activeNoteId && activeNote ? (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
                <input
                  type="text"
                  value={activeNote.title || ""}
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
                    borderRadius: "4px",
                  }}
                >
                  {isNotesWide ? <Minimize size={18} /> : <Maximize size={18} />}
                </button>
                {notesSaving && (
                  <span style={{ fontSize: "12px", color: "var(--accent)" }} className="animate-pulse">
                    保存中...
                  </span>
                )}
              </div>
            </div>

            {/* 标签行（T10-④） */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <TagIcon size={13} style={{ color: "var(--muted)" }} />
              {(activeNote.tags ?? []).map((tag) => (
                <span
                  key={tag}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    fontSize: 12,
                    color: "var(--accent)",
                    background: "var(--accent-soft)",
                    borderRadius: 999,
                    padding: "1px 8px",
                  }}
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    title="移除标签"
                    style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", display: "flex", padding: 0 }}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              {addingTag ? (
                <input
                  autoFocus
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTag(tagDraft);
                      setAddingTag(false);
                    }
                    if (event.key === "Escape") setAddingTag(false);
                  }}
                  onBlur={() => {
                    addTag(tagDraft);
                    setAddingTag(false);
                  }}
                  placeholder="标签名，回车确认"
                  style={{
                    fontSize: 12,
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: "1px solid var(--accent)",
                    background: "var(--surface)",
                    color: "var(--text)",
                    width: 120,
                    outline: "none",
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="lm-text-btn"
                  style={{ fontSize: 12 }}
                  onClick={() => setAddingTag(true)}
                  title="添加标签"
                >
                  <Plus size={12} /> 加标签
                </button>
              )}
              <button
                type="button"
                className="lm-text-btn"
                style={{ fontSize: 12, marginLeft: "auto" }}
                title={activeNote.images?.length ? "已拖入/上传的图片会压缩后随笔记保存" : "把图片拖到本页任意位置即可附加预览"}
                onClick={() => imageInputRef.current?.click()}
              >
                <Plus size={12} /> 附件图 {(activeNote.images?.length ?? 0) > 0 ? `(${activeNote.images?.length}/${MAX_IMAGES_PER_NOTE})` : ""}
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={(event) => {
                  if (event.target.files) void appendImages(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>

            {(activeNote.images ?? []).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                {(activeNote.images ?? []).map((dataUrl, index) => (
                  <div
                    key={`${index}-${dataUrl.slice(-16)}`}
                    style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}
                  >
                    <img
                      src={dataUrl}
                      alt={`附件 ${index + 1}`}
                      style={{ width: 96, height: 96, objectFit: "cover", display: "block", cursor: "zoom-in" }}
                      onClick={() => setPreviewImage(dataUrl)}
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      title="移除该图"
                      style={{
                        position: "absolute",
                        top: 2,
                        right: 2,
                        background: "rgba(0,0,0,0.55)",
                        color: "#fff",
                        border: "none",
                        borderRadius: "50%",
                        width: 18,
                        height: 18,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <RichTextEditor
              value={activeNote.content || ""}
              onChange={(content) => updateActiveNote({ content })}
              onSave={() => saveNotes(notes)}
              title={activeNote.title || "note"}
              saving={notesSaving}
              onClear={onConfirmClear}
            />

            {dragging && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,0,0,0.35)",
                  color: "#fff",
                  fontSize: 15,
                  pointerEvents: "none",
                  borderRadius: 10,
                }}
              >
                松开以附加图片（最多 {MAX_IMAGES_PER_NOTE} 张，自动压缩）
              </div>
            )}

            {previewImage && (
              <div
                onClick={() => setPreviewImage(null)}
                style={{ position: "fixed", inset: 0, zIndex: 10060, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}
              >
                <img src={previewImage} alt="预览" style={{ maxWidth: "90vw", maxHeight: "90vh" }} />
              </div>
            )}
          </>
        ) : (
          <div
            className="empty-state"
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "16px",
            }}
          >
            <div
              style={{
                background: "var(--surface)",
                padding: "20px",
                borderRadius: "50%",
                color: "var(--muted)",
              }}
            >
              <FileText size={48} />
            </div>
            <div style={{ color: "var(--muted)" }}>请在左侧选择或新建笔记</div>
            <button type="button" className="primary-action" onClick={() => handleAddNote()}>
              <Plus size={16} /> 新建第一条笔记
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
