import React from "react";
import { Wand2, Plus, Send } from "lucide-react";
import { PanelTitle, BaseControls } from "../../ui";
import type { 
  BaseGenerationParams, 
  OptionsState, 
  LoraItem, 
  LoraExampleMedia,
  LoraManagerSettings
} from "../../../types";

interface DefaultGenerationPanelProps {
  params: BaseGenerationParams;
  setParams: (updater: BaseGenerationParams | ((prev: BaseGenerationParams) => BaseGenerationParams)) => void;
  options: OptionsState;
  apiBase: string;
  loraSettings: LoraManagerSettings;
  loraExampleFilesByHash: Record<string, LoraExampleMedia[]>;
  onRunGeneration: () => void;
  onOpenLoraDetail: (item: LoraItem) => void;
  onSetSimpleLoraTarget: (target: "default" | "multi" | "highres") => void;
  onSendToHighres: () => void;
}

export const DefaultGenerationPanel = React.memo(({
  params,
  setParams,
  options,
  apiBase,
  loraSettings,
  loraExampleFilesByHash,
  onRunGeneration,
  onOpenLoraDetail,
  onSetSimpleLoraTarget,
  onSendToHighres,
}: DefaultGenerationPanelProps) => {
  return (
    <section className="panel">
      <div className="panel-header">
        <PanelTitle icon={Wand2} title="默认生图" />
      </div>
      <div className="panel-body">
        <BaseControls
          params={params}
          options={options}
          setParams={setParams}
          apiBase={apiBase}
          settings={loraSettings}
          localExampleFilesByHash={loraExampleFilesByHash}
          onLoraDetail={onOpenLoraDetail}
        />
      </div>
      <div className="panel-footer" style={{ display: "flex", gap: "8px" }}>
        <button
          className="primary-action"
          style={{ flex: 1 }}
          type="button"
          onClick={onRunGeneration}
        >
          <Wand2 size={18} />
          开始生成
        </button>
        <button
          type="button"
          onClick={() => onSetSimpleLoraTarget("default")}
          title="添加 LoRA"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            padding: "0 16px",
            backgroundColor: "var(--bg-panel, #2a2a2a)",
            color: "var(--text-primary, #eaeaea)",
            border: "1px solid var(--border-color, #444)",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "13px",
            transition: "all 0.2s ease",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = "#333";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = "var(--bg-panel, #2a2a2a)";
          }}
        >
          <Plus size={16} /> 添加 LoRA
        </button>
        <button
          type="button"
          onClick={onSendToHighres}
          title="将当前提示词和 Lora 快捷发送到高清修复并跳转"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            padding: "0 16px",
            backgroundColor: "var(--bg-panel, #2a2a2a)",
            color: "var(--text-primary, #eaeaea)",
            border: "1px solid var(--border-color, #444)",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "13px",
          }}
        >
          <Send size={16} />
          送到高修
        </button>
      </div>
    </section>
  );
});
