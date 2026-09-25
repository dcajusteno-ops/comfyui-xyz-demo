import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoteItem, TabId, Toast } from "../types";

type ToastFn = (type: Toast["type"], title: string, message?: string) => void;
type ConfirmFn = (title: string, message: string, onConfirm: () => void) => void;

export function useNotes({ tab, pushToast, confirm }: { tab: TabId; pushToast: ToastFn; confirm: ConfirmFn }) {
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSearch, setNotesSearch] = useState("");
  const [isNotesWide, setIsNotesWide] = useState(false);
  const notesSaveTimerRef = useRef<number | null>(null);
  // 服务端数据版本号：每次保存递增；携带过期版本会得到 409（乐观并发检测）
  const notesRevisionRef = useRef(0);
  const lastConflictToastAtRef = useRef(0);
  // 始终指向最新 notes，供「离开页面立即落盘」使用（不触发重新渲染）
  const latestNotesRef = useRef(notes);
  useEffect(() => {
    latestNotesRef.current = notes;
  }, [notes]);

  const saveNotes = useCallback(async (currentNotes: NoteItem[], silent = false) => {
    // 服务端从未有过数据（revision 0）时跳过空保存；否则空数组也是一次「删光」的有效保存
    if (currentNotes.length === 0 && notesRevisionRef.current === 0) return;
    setNotesSaving(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: currentNotes, baseRevision: notesRevisionRef.current }),
      });
      if (res.status === 409) {
        // 别的窗口改过：对齐服务端版本号（下次保存可成功，内容以本窗口为准），限流提示一次
        const data = await res.json().catch(() => ({}) as { revision?: number });
        if (typeof data.revision === "number") {
          notesRevisionRef.current = data.revision;
        }
        const now = Date.now();
        if (!silent || now - lastConflictToastAtRef.current > 10000) {
          lastConflictToastAtRef.current = now;
          pushToast("error", "笔记保存冲突", "笔记已在其他窗口被修改；本窗口的下一次保存将覆盖远端内容");
        }
        return;
      }
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      if (typeof data.revision === "number") {
        notesRevisionRef.current = data.revision;
      }
      if (!silent) pushToast("success", "笔记已保存");
    } catch (err) {
      if (!silent) pushToast("error", "保存笔记失败", String(err));
    } finally {
      // Keep "saving" state for a moment to show visual feedback
      setTimeout(() => setNotesSaving(false), 800);
    }
  }, [pushToast]);

  useEffect(() => {
    if (tab === "notes") {
      fetch("/api/notes")
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.data && data.data.notes) {
            setNotes(data.data.notes);
            if (typeof data.data.revision === "number") {
              notesRevisionRef.current = data.data.revision;
            }
            // 函数式更新：仅在没有选中项时落到第一条，避免把 activeNoteId 加进依赖
            if (data.data.notes.length > 0) {
              setActiveNoteId((prev) => prev ?? data.data.notes[0].id);
            }
          }
        })
        .catch((err) => pushToast("error", "加载笔记失败", String(err)));
    }
  }, [tab, pushToast]);

  // 离开笔记页 / 关闭页面时立即落盘，避免 2 秒防抖窗口内的末次编辑丢失。
  // 注意：cleanup 里有 flush 副作用，因此依赖必须只有 tab（saveNotes 从 ref 语义上等价取用），
  // 否则 saveNotes 身份变化会触发多余的 flush。
  useEffect(() => {
    if (tab !== "notes") return;
    const handleUnload = () => {
      const payload = JSON.stringify({ notes: latestNotesRef.current, baseRevision: notesRevisionRef.current });
      navigator.sendBeacon?.("/api/notes", new Blob([payload], { type: "application/json" }));
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      void saveNotes(latestNotesRef.current, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Auto-save effect
  useEffect(() => {
    if (tab !== "notes") return;

    if (notesSaveTimerRef.current) {
      window.clearTimeout(notesSaveTimerRef.current);
    }

    notesSaveTimerRef.current = window.setTimeout(() => {
      void saveNotes(notes, true);
    }, 2000); // 2 seconds debounce

    return () => {
      if (notesSaveTimerRef.current) {
        window.clearTimeout(notesSaveTimerRef.current);
      }
    };
  }, [notes, tab, saveNotes]);

  const handleAddNote = useCallback(() => {
    const newNote: NoteItem = {
      id: Math.random().toString(36).slice(2),
      title: "未命名笔记",
      content: "",
      updatedAt: Date.now(),
    };
    const nextNotes = [newNote, ...latestNotesRef.current];
    setNotes(nextNotes);
    setActiveNoteId(newNote.id);
    void saveNotes(nextNotes);
  }, [saveNotes]);

  const handleSaveImageToNote = useCallback((url: string) => {
    const newNote: NoteItem = {
      id: Math.random().toString(36).slice(2),
      title: "图片保存",
      content: `<p><img src="${url}" /></p>`,
      updatedAt: Date.now(),
    };
    const nextNotes = [newNote, ...latestNotesRef.current];
    setNotes(nextNotes);
    setActiveNoteId(newNote.id);
    void saveNotes(nextNotes);
    pushToast("success", "图片已保存到笔记");
  }, [saveNotes, pushToast]);

  const handleDeleteNote = useCallback((id: string) => {
    confirm("删除笔记", "确定要删除这条笔记吗？删除后将无法恢复。", () => {
      const nextNotes = latestNotesRef.current.filter((n) => n.id !== id);
      setNotes(nextNotes);
      setActiveNoteId((prev) => (prev === id ? (nextNotes.length > 0 ? nextNotes[0].id : null) : prev));
      void saveNotes(nextNotes);
    });
  }, [confirm, saveNotes]);

  const updateActiveNote = useCallback((partial: Partial<NoteItem>) => {
    if (!activeNoteId) return;
    setNotes((prev) =>
      prev.map((n) => (n.id === activeNoteId ? { ...n, ...partial, updatedAt: Date.now() } : n))
    );
  }, [activeNoteId]);

  return useMemo(() => ({
    notes,
    activeNoteId,
    notesSaving,
    notesSearch,
    isNotesWide,
    setNotesSearch,
    setIsNotesWide,
    setActiveNoteId,
    saveNotes,
    handleAddNote,
    handleSaveImageToNote,
    handleDeleteNote,
    updateActiveNote,
  }), [
    notes,
    activeNoteId,
    notesSaving,
    notesSearch,
    isNotesWide,
    saveNotes,
    handleAddNote,
    handleSaveImageToNote,
    handleDeleteNote,
    updateActiveNote,
  ]);
}
