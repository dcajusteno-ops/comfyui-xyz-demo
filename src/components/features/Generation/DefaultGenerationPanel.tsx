import React from "react";
import { Wand2, Plus, Send } from "lucide-react";
import { PanelTitle, BaseControls } from "../../ui";
import { PresetBar } from "./PresetBar";
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
  loraNames?: string[];
  wildcardNames?: string[];
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
  loraNames,
  wildcardNames,
  onRunGeneration,
  onOpenLoraDetail,
  onSetSimpleLoraTarget,
  onSendToHighres,
}: DefaultGenerationPanelProps) => {
  return (
    <section className="panel">
      <div className="panel-header" style={{ display: "flex", alignItems: "center" }}>
        <PanelTitle icon={Wand2} title="默认生图" />
        <PresetBar target="default" params={params} options={options} setParams={setParams} />
      </div>
      <div className="panel-body">
        <BaseControls
          params={params}
          options={options}
          setParams={setParams}
          apiBase={apiBase}
          settings={loraSettings}
          localExampleFilesByHash={loraExampleFilesByHash}
          loraNames={loraNames}
          wildcardNames={wildcardNames}
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
          className="secondary-action"
        >
          <Plus size={16} /> 添加 LoRA
        </button>
        <button
          type="button"
          onClick={onSendToHighres}
          title="将当前提示词和 Lora 快捷发送到高清修复并跳转"
          className="secondary-action"
        >
          <Send size={16} />
          送到高修
        </button>
      </div>
    </section>
  );
});
