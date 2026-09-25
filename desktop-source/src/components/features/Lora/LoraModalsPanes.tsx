import React from "react";
import { Copy, FileText, RefreshCw, Trash2 } from "lucide-react";
import type {
  DoctorDiagnostic,
  LoraDuplicateGroup,
  LoraItem,
  LoraUpdateRecord,
  ManagedModelType,
  Toast,
} from "../../../types";
import type { ComfyClient } from "../../../lib/comfyClient";
import { loraModelId, updateRecordModelId } from "../../../lib/lora-helper";

/** 从 LoraModals.tsx 拆出（T14）：操作弹窗的各个窗格，逻辑逐字未改 */
export function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="field text-field">
      <span>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function ItemList({ items }: { items: LoraItem[] }) {
  return (
    <div className="operation-list">
      {items.map((item) => (
        <div className="lm-list-row" key={loraModelId(item)}>
          <div className="lm-list-row-main">
            <div className="lm-list-row-name">{item.file_name}</div>
            <div className="lm-list-row-path">{item.file_path}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DuplicatePane({ duplicates, filenameConflicts, onDeleteCopies }: { duplicates: LoraDuplicateGroup[]; filenameConflicts: LoraDuplicateGroup[]; onDeleteCopies: (items: LoraItem[]) => void }) {
  const groups = [...duplicates, ...filenameConflicts];
  return (
    <div className="lm-list-pane">
      <div className="section-toolbar">
        <strong>重复组 {groups.length}</strong>
      </div>
      {groups.length === 0 && <div className="empty-strip">没有发现重复项或文件名冲突</div>}
      {groups.map((group, index) => {
        const copies = group.models.slice(1);
        return (
          <div className="duplicate-group" key={`${group.hash ?? group.filename ?? index}`}>
            <div className="section-toolbar">
              <strong>{group.hash ?? group.filename ?? `重复组 ${index + 1}`}</strong>
              <button type="button" className="lm-text-btn danger" disabled={!copies.length} onClick={() => onDeleteCopies(copies)}><Trash2 size={13} /> 删除副本</button>
            </div>
            <ItemList items={group.models} />
          </div>
        );
      })}
    </div>
  );
}

export function UpdatesPane({ modelType, records, client, onRefresh, onToast }: { modelType: ManagedModelType; records: LoraUpdateRecord[]; client: ComfyClient; onRefresh: () => void | Promise<void>; onToast: (type: Toast["type"], title: string, message?: string) => void }) {
  async function ignore(record: LoraUpdateRecord) {
    const modelId = updateRecordModelId(record);
    if (!modelId) return;
    try {
      const result = await client.ignoreManagedModelUpdate(modelType, modelId, !(record.shouldIgnore ?? record.should_ignore));
      if (result.success === false) throw new Error(result.error || "忽略更新失败");
      onToast("success", "更新状态已写回");
      await onRefresh();
    } catch (error) {
      onToast("error", "忽略更新失败", error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="lm-list-pane">
      <div className="section-toolbar">
        <strong>可更新 LoRA {records.length}</strong>
        <button type="button" className="lm-text-btn" onClick={() => onRefresh()}><RefreshCw size={13} /> 重新检查</button>
      </div>
      {records.length === 0 && <div className="empty-strip">没有发现可更新版本</div>}
      {records.map((record) => (
        <div className="lm-list-row" key={updateRecordModelId(record) ?? JSON.stringify(record).slice(0, 48)}>
          <div>
            <strong>{String(record.modelName ?? record.model_name ?? updateRecordModelId(record) ?? "未知模型")}</strong>
            <span>{String(record.latest_version_id ?? record.latestVersionId ?? "")}</span>
          </div>
          <button type="button" className="lm-text-btn" onClick={() => ignore(record)}>
            {record.shouldIgnore || record.should_ignore ? "恢复更新" : "忽略更新"}
          </button>
        </div>
      ))}
    </div>
  );
}

export function DoctorPane({ diagnostics, rawData, onAction }: { diagnostics: DoctorDiagnostic[]; rawData: unknown; onAction: (action: "repair" | "resolve" | "export") => void | Promise<void> }) {
  return (
    <div className="lm-list-pane">
      <div className="operation-actions">
        <button type="button" className="primary-action" onClick={() => onAction("repair")}><RefreshCw size={16} /> 修复缓存</button>
        <button type="button" className="icon-button" onClick={() => onAction("resolve")}><Copy size={16} /> 解决文件名冲突</button>
        <button type="button" className="icon-button" onClick={() => onAction("export")}><FileText size={16} /> 导出诊断包</button>
      </div>
      {diagnostics.length === 0 && <pre className="json-preview">{JSON.stringify(rawData, null, 2)}</pre>}
      {diagnostics.map((item, index) => (
        <div className={`doctor-row ${String(item.status ?? item.severity ?? "info").toLowerCase()}`} key={item.key ?? item.label ?? index}>
          <strong>{String(item.label ?? item.title ?? item.key ?? `检查 ${index + 1}`)}</strong>
          <span>{String(item.status ?? item.severity ?? "")}</span>
          <p>{String(item.message ?? item.details ?? "")}</p>
        </div>
      ))}
    </div>
  );
}
