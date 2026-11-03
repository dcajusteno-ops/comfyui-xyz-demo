import { useState } from "react";
import { Save, Trash2 } from "lucide-react";
import type { WardrobePresetStore } from "../../../lib/wardrobe/types";
import { presetSummary } from "../../../lib/wardrobe/presets";

type Props = {
  presets: WardrobePresetStore;
  onSave: (name: string) => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
};

export function WardrobePresetBar({ presets, onSave, onLoad, onDelete }: Props) {
  const [name, setName] = useState("");
  const items = Object.values(presets.items).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="wd-presets">
      <div className="wd-preset-save">
        <input
          value={name}
          placeholder="预设名称（档位 / 权重 / 锁定 / 角色）"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) {
              onSave(name);
              setName("");
            }
          }}
        />
        <button
          type="button"
          className="primary-action"
          disabled={!name.trim()}
          onClick={() => {
            onSave(name);
            setName("");
          }}
        >
          <Save size={14} /> 保存当前
        </button>
      </div>
      <div className="wd-preset-list">
        {items.map((preset) => (
          <div key={preset.id} className="wd-preset">
            <div className="wd-preset-main">
              <b>{preset.name}</b>
              <span>{presetSummary(preset)}</span>
            </div>
            <button type="button" className="secondary-action" onClick={() => onLoad(preset.id)}>
              套用
            </button>
            <button
              type="button"
              className="wd-icon-btn"
              onClick={() => onDelete(preset.id)}
              aria-label="删除预设"
              title="删除预设"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {items.length === 0 && <div className="wd-empty">还没有命名预设</div>}
      </div>
    </div>
  );
}
