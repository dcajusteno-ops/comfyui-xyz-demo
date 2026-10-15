import React from "react";
import { Type, Sparkles, UserRound, ImageUp, Wand2 } from "lucide-react";
import { PanelTitle } from "../../ui";
import { DrawTextControls } from "./DrawTextControls";
import type {
  BaseGenerationParams,
  OptionsState
} from "../../../types";

interface TextGenerationPanelProps {
  params: BaseGenerationParams;
  setParams: (updater: BaseGenerationParams | ((prev: BaseGenerationParams) => BaseGenerationParams)) => void;
  options: OptionsState;
  onRunDefault: () => void;
  onRunMulti: () => void;
  onRunHighres: () => void;
  onRunAnima: () => void;
  defaultParams?: BaseGenerationParams;
  multiParams?: BaseGenerationParams;
  highresParams?: BaseGenerationParams;
  /** 上传任意图片到 ComfyUI input/（手写板导出的两张 PNG 走这条通道，同 Img2ImgControls） */
  onUploadImage?: (file: File) => Promise<string>;
  /** ComfyUI 代理前缀（/comfy），用于手写层缩略图回显 */
  apiBase?: string;
}

export function TextGenerationPanel({
  params,
  setParams,
  options,
  onRunDefault,
  onRunMulti,
  onRunHighres,
  onRunAnima,
  defaultParams,
  multiParams,
  highresParams,
  onUploadImage,
  apiBase,
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
          onUploadImage={onUploadImage}
          apiBase={apiBase}
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
          style={{ flex: 1, background: "var(--grad-purple)", borderColor: "transparent" }}
          type="button"
          onClick={onRunMulti}
        >
          <UserRound size={18} />
          多人
        </button>
        <button
          className="primary-action"
          style={{ flex: 1, background: "var(--grad-green)", borderColor: "transparent" }}
          type="button"
          onClick={onRunHighres}
        >
          <ImageUp size={18} />
          高清
        </button>
        <button
          className="primary-action"
          style={{ flex: 1, background: "linear-gradient(135deg, var(--char-3), var(--char-1))", borderColor: "transparent" }}
          type="button"
          onClick={onRunAnima}
        >
          <Wand2 size={18} />
          Anima
        </button>
      </div>
    </section>
  );
}
