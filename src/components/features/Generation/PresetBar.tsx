import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookmarkPlus, Download, Pencil, Play, Trash2, Upload } from "lucide-react";
import { usePresets } from "../../../hooks/usePresets";
import { applySnapshot, exportPresetsJson } from "../../../lib/generationPresets";
import { downloadTextFile } from "../../../lib/file-helper";
import { ModalFrame } from "../../ui/Modal";
import type { OptionsState, TemplateKind } from "../../../types";

interface PresetBarProps<T extends Record<string, unknown>> {
  target: TemplateKind;
  params: T;
  options: OptionsState;
  setParams: (updater: T | ((prev: T) => T)) => void;
}

const btnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  padding: "4px 10px",
  fontSize: "12px",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  background: "var(--surface-alt)",
  color: "var(--muted)",
  cursor: "pointer",
};

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  color: "var(--accent)",
  borderColor: "var(--accent)",
};

export function PresetBar<T extends Record<string, unknown>>({ target, params, options, setParams }: PresetBarProps<T>) {
  const { forTarget, add, rename, remove, importJson } = usePresets();
  const presets = forTarget(target);
  const [selectedId, setSelectedId] = useState("");
  const [modal, setModal] = useState<null | { mode: "save" | "rename"; id?: string }>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<null | { id: string; name: string }>(null);
  const [status, setStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedPreset = presets.find((p) => p.id === selectedId) ?? null;

  const flash = (text: string) => {
    setStatus(text);
    window.setTimeout(() => setStatus(""), 3200);
  };

  const handleApply = () => {
    if (!selectedPreset) {
      flash("请先在左侧下拉选择要应用的预设");
      return;
    }
    const { next, checkpointRejected } = applySnapshot(params, selectedPreset.snapshot, options.checkpoints);
    setParams(next);
    flash(
      checkpointRejected
        ? `已应用「${selectedPreset.name}」；原 checkpoint 不可用，已保留当前模型`
        : `已应用「${selectedPreset.name}」`,
    );
  };

  const openSave = () => {
    setDraft("");
    setModal({ mode: "save" });
  };

  const openRename = () => {
    if (!selectedPreset) {
      flash("请先在下拉选择要改名的预设");
      return;
    }
    setDraft(selectedPreset.name);
    setModal({ mode: "rename", id: selectedPreset.id });
  };

  const confirmModal = () => {
    const name = draft.trim();
    if (!name) {
      flash("名称不能为空");
      return;
    }
    if (modal?.mode === "save") {
      const preset = add(name, target, { ...params });
      setSelectedId(preset.id);
      flash(`已保存预设「${name}」`);
    } else if (modal?.mode === "rename" && modal.id) {
      rename(modal.id, name);
      flash(`已重命名为「${name}」`);
    }
    setModal(null);
    setDraft("");
  };

  const handleDelete = () => {
    if (!selectedPreset) {
      flash("请先在下拉选择要删除的预设");
      return;
    }
    setConfirmDelete({ id: selectedPreset.id, name: selectedPreset.name });
  };

  const confirmDeleteNow = () => {
    if (!confirmDelete) return;
    remove(confirmDelete.id);
    setSelectedId("");
    setConfirmDelete(null);
    flash(`已删除「${confirmDelete.name}」`);
  };

  const handleExport = () => {
    if (presets.length === 0) {
      flash("暂无预设可导出");
      return;
    }
    downloadTextFile(`presets-${target}-${Date.now()}.json`, exportPresetsJson(presets), "application/json");
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = importJson(String(reader.result ?? ""));
      if (result.invalid) flash("导入失败：不是合法的 JSON");
      else flash(`导入完成：新增 ${result.added} 个，跳过 ${result.skipped} 个非法条目`);
    };
    reader.onerror = () => flash("读取文件失败");
    reader.readAsText(file);
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginLeft: "auto", paddingLeft: "12px" }}>
      {status && <span style={{ fontSize: "11px", color: "var(--accent)", maxWidth: "240px" }}>{status}</span>}

      <select
        title="选择预设"
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        style={{
          padding: "4px 8px",
          fontSize: "12px",
          borderRadius: "6px",
          border: "1px solid var(--border)",
          background: "var(--surface-alt)",
          color: "var(--text)",
          maxWidth: "160px",
        }}
      >
        <option value="">{presets.length ? "选择预设…" : "暂无预设"}</option>
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>

      <button type="button" style={primaryBtnStyle} onClick={handleApply} title="应用选中的预设">
        <Play size={13} /> 应用
      </button>
      <button type="button" style={btnStyle} onClick={openSave} title="保存当前参数为预设">
        <BookmarkPlus size={13} /> 保存
      </button>
      <button type="button" style={btnStyle} onClick={openRename} title="重命名选择的预设">
        <Pencil size={13} /> 改名
      </button>
      <button type="button" style={btnStyle} onClick={handleDelete} title="删除选中的预设">
        <Trash2 size={13} /> 删除
      </button>
      <button type="button" style={btnStyle} onClick={handleExport} title="导出该模板预设为 JSON">
        <Download size={13} /> 导出
      </button>
      <button type="button" style={btnStyle} onClick={() => fileRef.current?.click()} title="从 JSON 导入预设">
        <Upload size={13} /> 导入
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImport(file);
          e.target.value = "";
        }}
      />

      {confirmDelete &&
        createPortal(
          <ModalFrame title="删除预设" onClose={() => setConfirmDelete(null)}>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "8px 0" }}>
              <p style={{ margin: 0, fontSize: "14px", color: "var(--text)", lineHeight: 1.6 }}>
                确定要删除预设「<strong>{confirmDelete.name}</strong>」吗？此操作无法撤销。
              </p>
              <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button type="button" className="secondary-action" onClick={() => setConfirmDelete(null)}>
                  取消
                </button>
                <button
                  type="button"
                  className="primary-action"
                  style={{ background: "var(--danger)", border: "1px solid var(--danger)", color: "#fff" }}
                  onClick={confirmDeleteNow}
                >
                  删除
                </button>
              </div>
            </div>
          </ModalFrame>,
          document.body,
        )}

      {modal &&
        createPortal(
          <ModalFrame
            title={modal.mode === "save" ? "保存为预设" : "重命名预设"}
            onClose={() => {
              setModal(null);
              setDraft("");
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "8px 0" }}>
              <label className="field">
                <span>预设名称</span>
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && confirmModal()}
                  placeholder="例如：竖版人像 · 高清"
                />
              </label>
              <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    setModal(null);
                    setDraft("");
                  }}
                >
                  取消
                </button>
                <button type="button" className="primary-action" onClick={confirmModal}>
                  确定
                </button>
              </div>
            </div>
          </ModalFrame>,
          document.body,
        )}
    </div>
  );
}