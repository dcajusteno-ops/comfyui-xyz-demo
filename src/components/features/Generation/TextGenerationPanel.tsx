import React from "react";
import { Type, Sparkles, UserRound, ImageUp } from "lucide-react";
import { PanelTitle, BaseControls } from "../../ui";
import { DrawTextControls } from "./DrawTextControls";
import type { 
  BaseGenerationParams, 
  OptionsState, 
  LoraItem, 
  LoraExampleMedia,
  LoraManagerSettings
} from "../../../types";

interface TextGenerationPanelProps {
  params: BaseGenerationParams;
  setParams: (updater: BaseGenerationParams | ((prev: BaseGenerationParams) => BaseGenerationParams)) => void;
  options: OptionsState;
  onRunDefault: () => void;
  onRunMulti: () => void;
  onRunHighres: () => void;
  defaultParams?: BaseGenerationParams;
  multiParams?: BaseGenerationParams;
  highresParams?: BaseGenerationParams;
}

export function TextGenerationPanel({
  params,
  setParams,
  options,
  onRunDefault,
  onRunMulti,
  onRunHighres,
  defaultParams,
  multiParams,
  highresParams,
}: TextGenerationPanelProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <PanelTitle icon={Type} title="文字特效 & 水印" />
      </div>
      <div className="panel-body">
        <DrawTextControls 
          params={params}
          options={options}
          setParams={setParams}
          defaultParams={defaultParams}
          multiParams={multiParams}
          highresParams={highresParams}
        />
      </div>
      <div className="panel-footer" style={{ display: "flex", gap: "10px" }}>
        <button
          className="primary-action"
          style={{ flex: 1 }}
          type="button"
          onClick={onRunDefault}
        >
          <Sparkles size={18} />
          默认生图
        </button>
        <button
          className="primary-action"
          style={{ flex: 1, background: "linear-gradient(135deg, #743795, #9b51e0)", borderColor: "#9b51e0" }}
          type="button"
          onClick={onRunMulti}
        >
          <UserRound size={18} />
          多人
        </button>
        <button
          className="primary-action"
          style={{ flex: 1, background: "linear-gradient(135deg, #27ae60, #2ecc71)", borderColor: "#2ecc71" }}
          type="button"
          onClick={onRunHighres}
        >
          <ImageUp size={18} />
          高清
        </button>
      </div>
    </section>
  );
}
