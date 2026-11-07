/**
 * 角色服装预设弹窗（v5.0.2 / v5.0.5 / v5.0.9）。
 *
 * 交互对齐插件：
 *   · 圆点 = 启用（再点一次取消）；底部「✕ 取消启用」是显式退路；
 *   · 「＋ 新增一套」走 `isNew`，后端保证 id 不撞车（绝不覆盖上一套）；
 *   · 六套日常模板一键填充（fields 全部是词库合法原文）。
 */
import { useMemo, useState } from "react";
import { Plus, Sparkles, Trash2, X } from "lucide-react";
import { OUTFIT_FIELDS } from "../../../lib/wardrobe/characters";
import { fieldByKey } from "../../../lib/wardrobe/levels";
import type {
  WardrobeOutfitRecord,
  WardrobeOutfitSet,
  WardrobeOutfitTemplate,
} from "../../../lib/wardrobe/types";
import { AnimaSelect } from "../AnimaLibrary/AnimaSelect";

type Props = {
  roleTag: string;
  roleName: string;
  record: WardrobeOutfitRecord;
  templates: WardrobeOutfitTemplate[];
  onClose: () => void;
  onEnable: (id: string) => void;
  onSave: (item: WardrobeOutfitSet, isNew: boolean) => void;
  onDelete: (id: string) => void;
};

const EMPTY: WardrobeOutfitSet = { id: "", zh: "", level: 0, tags: [], fields: {}, drop: [...OUTFIT_FIELDS] };

export function WardrobeOutfitDialog({
  roleTag,
  roleName,
  record,
  templates,
  onClose,
  onEnable,
  onSave,
  onDelete,
}: Props) {
  const list = record.list ?? [];
  const enabled = record.enabled ?? "";
  const [editing, setEditing] = useState<WardrobeOutfitSet | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [tagsText, setTagsText] = useState("");

  const fieldOptions = useMemo(() => {
    const out: Record<string, Array<{ value: string; label: string }>> = {};
    for (const key of OUTFIT_FIELDS) {
      const found = fieldByKey(key);
      out[key] = [
        { value: "", label: "不指定" },
        ...(found?.field.opts ?? []).map(([zh, en]) => ({ value: en, label: zh || en })),
      ];
    }
    return out;
  }, []);

  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of OUTFIT_FIELDS) out[key] = fieldByKey(key)?.field.lab || key;
    return out;
  }, []);

  const startNew = () => {
    setEditing({ ...EMPTY, tags: [], fields: {}, drop: [...OUTFIT_FIELDS] });
    setTagsText("");
    setIsNew(true);
  };

  const startEdit = (item: WardrobeOutfitSet) => {
    setEditing({ ...item, tags: [...(item.tags ?? [])], fields: { ...(item.fields ?? {}) } });
    setTagsText((item.tags ?? []).join(", "));
    setIsNew(false);
  };

  const applyTemplate = (template: WardrobeOutfitTemplate) => {
    setEditing({
      id: template.id,
      zh: template.zh ?? "",
      level: template.level ?? 0,
      tags: [...(template.tags ?? [])],
      fields: { ...(template.fields ?? {}) },
      drop: [...(template.drop ?? OUTFIT_FIELDS)],
      verified: template.verified,
      note: template.note,
    });
    setTagsText((template.tags ?? []).join(", "));
    setIsNew(true);
  };

  const patch = (next: Partial<WardrobeOutfitSet>) => {
    setEditing((prev) => (prev ? { ...prev, ...next } : prev));
  };

  const commit = () => {
    if (!editing) return;
    const tags = tagsText
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
    onSave({ ...editing, tags }, isNew);
    setEditing(null);
  };

  return (
    <div className="wd-modal-mask" role="dialog" aria-modal="true" aria-label="角色服装预设">
      <div className="wd-modal wd-outfit-modal">
        <div className="wd-modal-head">
          <div>
            <b>角色服装预设</b>
            <em>{roleName || roleTag}</em>
          </div>
          <button type="button" className="wd-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={14} />
          </button>
        </div>

        <div className="wd-outfit-status">
          {enabled
            ? `当前已启用：${list.find((row) => row.id === enabled)?.zh || enabled}（其余服装字段闭麦）`
            : "未启用 —— 服装按随机权重抽取"}
        </div>

        <div className="wd-outfit-list">
          {list.map((item) => (
            <div key={item.id} className={`wd-outfit-row${enabled === item.id ? " is-on" : ""}`}>
              <button
                type="button"
                className={`wd-outfit-dot${enabled === item.id ? " is-on" : ""}`}
                onClick={() => onEnable(enabled === item.id ? "" : item.id)}
                title={enabled === item.id ? "再点一次取消启用" : "启用这一套"}
                aria-label={enabled === item.id ? "取消启用" : "启用"}
              />
              <div className="wd-outfit-main">
                <b>{item.zh || item.id}</b>
                <em>
                  L{item.level ?? 0}
                  {item.verified ? " · 已实测" : ""} · {item.id}
                </em>
                <span>{[...(item.tags ?? [])].slice(0, 5).join(", ")}</span>
              </div>
              <button type="button" className="wd-link-btn" onClick={() => startEdit(item)}>
                编辑
              </button>
              <button
                type="button"
                className="wd-icon-btn"
                onClick={() => onDelete(item.id)}
                title="删除这一套"
                aria-label="删除"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {!list.length && <div className="wd-empty">这个角色还没有服装预设</div>}
        </div>

        <div className="wd-outfit-actions">
          <button type="button" className="wd-link-btn" onClick={startNew}>
            <Plus size={12} /> 新增一套
          </button>
          {enabled && (
            <button type="button" className="wd-link-btn" onClick={() => onEnable("")}>
              <X size={12} /> 取消启用
            </button>
          )}
        </div>

        {editing && (
          <div className="wd-outfit-editor">
            <div className="wd-outfit-editor-head">
              <b>{isNew ? "新增一套" : `编辑：${editing.id}`}</b>
              <button type="button" className="wd-link-btn" onClick={() => setEditing(null)}>
                收起
              </button>
            </div>
            <div className="wd-outfit-grid">
              <label className="wd-tool">
                标识 id
                <input
                  value={editing.id}
                  disabled={!isNew}
                  placeholder="default"
                  onChange={(event) => patch({ id: event.target.value })}
                />
              </label>
              <label className="wd-tool">
                名称
                <input value={editing.zh ?? ""} onChange={(event) => patch({ zh: event.target.value })} />
              </label>
              <label className="wd-tool">
                档位
                <AnimaSelect
                  value={String(editing.level ?? 0)}
                  options={[0, 1, 2, 3, 4].map((n) => ({ value: String(n), label: `L${n}` }))}
                  onChange={(value) => patch({ level: Number(value) })}
                  ariaLabel="服装预设档位"
                  size="sm"
                />
              </label>
            </div>
            <label className="wd-tool wd-tool-wide">
              额外标签（逗号分隔，走 extra 尾部通道）
              <textarea
                rows={3}
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                placeholder="white tank top, black skirt"
              />
            </label>
            <div className="wd-outfit-fields">
              {OUTFIT_FIELDS.map((key) => (
                <label key={key} className="wd-tool">
                  {labels[key]}
                  <AnimaSelect
                    value={String(editing.fields?.[key] ?? "")}
                    options={fieldOptions[key] ?? []}
                    onChange={(value) =>
                      patch({ fields: { ...(editing.fields ?? {}), [key]: value } })
                    }
                    ariaLabel={`${labels[key]} 服装字段`}
                    size="sm"
                    block
                  />
                </label>
              ))}
            </div>
            <div className="wd-outfit-templates">
              <span>
                <Sparkles size={12} /> 一键模板
              </span>
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="wd-chip-btn"
                  onClick={() => applyTemplate(template)}
                  title={template.note ?? template.zh}
                >
                  {template.zh || template.id}
                </button>
              ))}
            </div>
            <div className="wd-outfit-editor-foot">
              <button type="button" className="primary-action" onClick={commit}>
                {isNew ? "保存为新的一套" : "保存修改"}
              </button>
              <span className="wd-outfit-hint">启用后 13 个服装字段闭麦，随机抽不到别的衣服</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
