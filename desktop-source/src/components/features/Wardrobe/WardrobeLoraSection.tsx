import { Boxes, Plus } from "lucide-react";
import { LoraChips } from "../Lora/LoraChips";
import type {
  LoraExampleMedia,
  LoraItem,
  LoraManagerSettings,
  LoraSelection,
} from "../../../types";
import type { WardrobeGenerationState } from "../../../lib/wardrobe/types";
import { wardrobeTriggerWords } from "../../../lib/wardrobe/generation";

type Props = {
  state: WardrobeGenerationState;
  onChange: (updater: (prev: WardrobeGenerationState) => WardrobeGenerationState) => void;
  /** 打开全局简易 LoRA 管理器，插入目标由 App 固定为 wardrobe */
  onOpenLibrary: () => void;
  onOpenLoraDetail: (item: LoraSelection | LoraItem) => void;
  apiBase: string;
  loraSettings: LoraManagerSettings;
  loraExampleFilesByHash: Record<string, LoraExampleMedia[]>;
};

function parseTriggers(value: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const part of value.split(/[,，\n]+/)) {
    const word = part.trim();
    const key = word.toLowerCase();
    if (!word || seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }
  return words.slice(0, 50);
}

/**
 * 造型台 LoRA 面板：
 * - 列表/启停/强度/移除复用全局 `LoraChips`；
 * - 触发词与手动触发词单独维护，只写造型台状态。
 */
export function WardrobeLoraSection({
  state,
  onChange,
  onOpenLibrary,
  onOpenLoraDetail,
  apiBase,
  loraSettings,
  loraExampleFilesByHash,
}: Props) {
  const loras = state.params.loras;
  const activeCount = loras.filter((lora) => lora.active).length;
  const triggers = wardrobeTriggerWords(state);

  const handleLorasChange = (next: LoraSelection[]) => {
    onChange((prev) => ({
      ...prev,
      params: {
        ...prev.params,
        loras: next.map((lora) => {
          const old = prev.params.loras.find((item) => item.name === lora.name);
          return { ...lora, triggerWords: old?.triggerWords ?? [] };
        }),
      },
    }));
  };

  const patchTriggers = (name: string, value: string) =>
    onChange((prev) => ({
      ...prev,
      params: {
        ...prev.params,
        loras: prev.params.loras.map((lora) =>
          lora.name === name ? { ...lora, triggerWords: parseTriggers(value) } : lora,
        ),
      },
    }));

  return (
    <div className="wd-lora-manager">
      <div className="wd-lora-manager-bar">
        <span className="wd-result-title">
          <Boxes size={14} /> 造型台 LoRA · 启用 {activeCount} / {loras.length}
        </span>
        <span className="wd-muted">触发词当前会追加 {triggers.length} 个</span>
        <button type="button" className="secondary-action" onClick={onOpenLibrary}>
          <Plus size={13} /> 添加 LoRA
        </button>
      </div>

      <label className="wd-mini-check" title="生成时把启用 LoRA 的触发词追加到正向提示词末尾">
        <input
          type="checkbox"
          checked={state.autoTrigger}
          onChange={(event) =>
            onChange((prev) => ({ ...prev, autoTrigger: event.target.checked }))
          }
        />
        自动加入触发词
      </label>

      <p className="wd-muted wd-lora-manager-note">
        LoRA 卡片与全局生图页一致；启停 / 强度 / 移除都只修改造型台自己的 LoRA 栈。
      </p>

      <LoraChips
        loras={loras}
        onChange={handleLorasChange}
        onDetail={onOpenLoraDetail}
        apiBase={apiBase}
        settings={loraSettings}
        localExampleFilesByHash={loraExampleFilesByHash}
      />

      <div className="wd-lora-triggers">
        <div className="wd-lora-triggers-head">
          <span>LoRA 触发词</span>
          <span className="wd-muted">逗号分隔、失焦保存</span>
        </div>
        {loras.length === 0 && (
          <div className="wd-muted">添加 LoRA 后可在这里维护触发词。</div>
        )}
        {loras.map((lora) => (
          <label className="wd-lora-trigger-row" key={lora.name}>
            <span title={lora.name}>{lora.displayName || lora.name}</span>
            <input
              defaultValue={(lora.triggerWords ?? []).join(", ")}
              placeholder="触发词（逗号分隔）"
              spellCheck={false}
              onBlur={(event) => patchTriggers(lora.name, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
        ))}
        <label className="wd-lora-trigger-row">
          <span>手动触发词</span>
          <input
            defaultValue={(state.manualTriggers ?? []).join(", ")}
            placeholder="不绑定 LoRA 的额外触发词"
            spellCheck={false}
            onBlur={(event) =>
              onChange((prev) => ({
                ...prev,
                manualTriggers: parseTriggers(event.target.value),
              }))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
      </div>
    </div>
  );
}
