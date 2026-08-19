import { useEffect, useRef, useState } from "react";
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

  useEffect(() => {
    if (tab === "notes") {
      fetch("/api/notes")
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.data && data.data.notes) {
            setNotes(data.data.notes);
            if (data.data.notes.length > 0 && !activeNoteId) {
              setActiveNoteId(data.data.notes[0].id);
            }
          }
        })
        .catch((err) => pushToast("error", "加载笔记失败", String(err)));
    }
  }, [tab, pushToast]);

  async function saveNotes(currentNotes: NoteItem[], silent = false) {
    if (currentNotes.length === 0 && notes.length === 0) return;
    setNotesSaving(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: currentNotes }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      if (!silent) pushToast("success", "笔记已保存");
    } catch (err) {
      if (!silent) pushToast("error", "保存笔记失败", String(err));
    } finally {
      // Keep "saving" state for a moment to show visual feedback
      setTimeout(() => setNotesSaving(false), 800);
    }
  }

  // Auto-save effect
  useEffect(() => {
    if (tab !== "notes") return;

    if (notesSaveTimerRef.current) {
      window.clearTimeout(notesSaveTimerRef.current);
    }

    notesSaveTimerRef.current = window.setTimeout(() => {
      saveNotes(notes, true);
    }, 2000); // 2 seconds debounce

    return () => {
      if (notesSaveTimerRef.current) {
        window.clearTimeout(notesSaveTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, tab]);

  function handleAddNote() {
    const newNote: NoteItem = {
      id: Math.random().toString(36).slice(2),
      title: "未命名笔记",
      content: "",
      updatedAt: Date.now(),
    };
    const nextNotes = [newNote, ...notes];
    setNotes(nextNotes);
    setActiveNoteId(newNote.id);
    saveNotes(nextNotes);
  }

  function handleDeleteNote(id: string) {
    confirm("删除笔记", "确定要删除这条笔记吗？删除后将无法恢复。", () => {
      const nextNotes = notes.filter((n) => n.id !== id);
      setNotes(nextNotes);
      if (activeNoteId === id) {
        setActiveNoteId(nextNotes.length > 0 ? nextNotes[0].id : null);
      }
      saveNotes(nextNotes);
    });
  }

  function updateActiveNote(partial: Partial<NoteItem>) {
    if (!activeNoteId) return;
    setNotes((prev) =>
      prev.map((n) => (n.id === activeNoteId ? { ...n, ...partial, updatedAt: Date.now() } : n))
    );
  }

  return {
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
    handleDeleteNote,
    updateActiveNote,
  };
}