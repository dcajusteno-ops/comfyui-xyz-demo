import React from "react";
import { UserRound, Plus } from "lucide-react";
import { PanelTitle, BaseControls, TextAreaField, SelectField, NumberField } from "../../ui";
import { MultiWorkspace } from "./MultiWorkspace";
import type { 
  MultiGenerationParams, 
  OptionsState, 
  LoraItem, 
  LoraExampleMedia,
  LoraManagerSettings,
  CanvasCharacter
} from "../../../types";

interface MultiGenerationPanelProps {
  params: MultiGenerationParams;
  setParams: (updater: MultiGenerationParams | ((prev: MultiGenerationParams) => MultiGenerationParams)) => void;
  options: OptionsState;
  apiBase: string;
  loraSettings: LoraManagerSettings;
  loraExampleFilesByHash: Record<string, LoraExampleMedia[]>;
  onRunGeneration: () => void;
  onOpenLoraDetail: (item: LoraItem) => void;
  onSetSimpleLoraTarget: (target: "default" | "multi" | "highres") => void;
  onAddCharacter: (characters: CanvasCharacter[]) => CanvasCharacter[];
}

export const MultiGenerationPanel = React.memo(({
  params,
  setParams,
  options,
  apiBase,
  loraSettings,
  loraExampleFilesByHash,
  onRunGeneration,
  onOpenLoraDetail,
  onSetSimpleLoraTarget,
  onAddCharacter,
}: MultiGenerationPanelProps) => {
  return (
    <section className="panel">
      <div className="panel-header">
        <PanelTitle icon={UserRound} title="多人工作流" />
      </div>
      <div className="panel-body">
        <BaseControls
          params={params}
          options={options}
          setParams={setParams}
          apiBase={apiBase}
          settings={loraSettings}
          localExampleFilesByHash={loraExampleFilesByHash}
          hidePositive
          disableStickyPrompt
          onLoraDetail={onOpenLoraDetail}
        />
        <div className="multi-settings">
          <TextAreaField
            label="全局 prompt"
            value={params.globalPrompt}
            onChange={(value) => setParams((prev) => ({ ...prev, globalPrompt: value }))}
          />
          <div className="form-grid multi-options">
            <SelectField
              label="语法模式"
              value={params.syntaxMode}
              options={["attention_couple", "regional_prompts"]}
              onChange={(value) =>
                setParams((prev) => ({
                  ...prev,
                  syntaxMode: value as MultiGenerationParams["syntaxMode"],
                }))
              }
            />
            <SelectField
              label="融合算法"
              value={params.fusionMode}
              options={[
                { label: "Mask 叠加", value: "mask_overlap" },
                { label: "Latent 融合", value: "latent_fusion" },
              ]}
              onChange={(value) =>
                setParams((prev) => ({
                  ...prev,
                  fusionMode: value as MultiGenerationParams["fusionMode"],
                }))
              }
            />
            <NumberField
              label="多人画布宽"
              value={params.canvasWidth}
              step={64}
              min={256}
              onChange={(value) => setParams((prev) => ({ ...prev, canvasWidth: value }))}
            />
            <NumberField
              label="多人画布高"
              value={params.canvasHeight}
              step={64}
              min={256}
              onChange={(value) => setParams((prev) => ({ ...prev, canvasHeight: value }))}
            />
            <label className="field checkbox-field">
              <input
                type="checkbox"
                checked={params.useFill}
                onChange={(event) => setParams((prev) => ({ ...prev, useFill: event.target.checked }))}
              />{" "}
              use_fill
            </label>
          </div>
        </div>
        <div className="multi-editor-layout">
          <MultiWorkspace
            canvasWidth={params.canvasWidth}
            canvasHeight={params.canvasHeight}
            characters={params.characters}
            onChange={(characters) => setParams((prev) => ({ ...prev, characters }))}
          />
        </div>
      </div>
      <div className="panel-footer" style={{ display: "flex", gap: "8px" }}>
        <button
          className="primary-action"
          style={{ flex: 1 }}
          type="button"
          onClick={onRunGeneration}
        >
          <UserRound size={18} />
          运行多人工作流
        </button>
        <button
          type="button"
          onClick={() => setParams((prev) => ({ ...prev, characters: onAddCharacter(prev.characters) }))}
          title="新增角色"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            padding: "0 16px",
            backgroundColor: "var(--bg-panel, #2a2a2a)",
            color: "var(--text-secondary, #a0a0a0)",
            border: "1px solid var(--border-color, #333)",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "14px",
            transition: "all 0.2s ease",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = "#333";
            e.currentTarget.style.color = "#fff";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = "var(--bg-panel, #2a2a2a)";
            e.currentTarget.style.color = "var(--text-secondary, #a0a0a0)";
          }}
        >
          <Plus size={16} /> 新增角色
        </button>
        <button
          type="button"
          onClick={() => onSetSimpleLoraTarget("multi")}
          title="添加 LoRA"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            padding: "0 16px",
            backgroundColor: "var(--bg-panel, #2a2a2a)",
            color: "var(--text-secondary, #a0a0a0)",
            border: "1px solid var(--border-color, #333)",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "14px",
            transition: "all 0.2s ease",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = "#333";
            e.currentTarget.style.color = "#fff";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = "var(--bg-panel, #2a2a2a)";
            e.currentTarget.style.color = "var(--text-secondary, #a0a0a0)";
          }}
        >
          <Plus size={16} /> 添加 LoRA
        </button>
      </div>
    </section>
  );
}
);
