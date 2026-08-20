import React from "react";
import { ImageUp, Plus } from "lucide-react";
import { PanelTitle, BaseControls, SelectField, NumberField } from "../../ui";
import { DetailerControls } from "./DetailerControls";
import { makeDetailerParams } from "../../../lib/paramBuilders";
import type { 
  HighresParams, 
  OptionsState, 
  LoraItem, 
  LoraExampleMedia,
  LoraManagerSettings
} from "../../../types";

interface HighresGenerationPanelProps {
  params: HighresParams;
  setParams: (updater: HighresParams | ((prev: HighresParams) => HighresParams)) => void;
  options: OptionsState;
  apiBase: string;
  loraSettings: LoraManagerSettings;
  loraExampleFilesByHash: Record<string, LoraExampleMedia[]>;
  onRunGeneration: () => void;
  onOpenLoraDetail: (item: LoraItem) => void;
  onSetSimpleLoraTarget: (target: "default" | "multi" | "highres") => void;
}

export const HighresGenerationPanel = React.memo(({
  params,
  setParams,
  options,
  apiBase,
  loraSettings,
  loraExampleFilesByHash,
  onRunGeneration,
  onOpenLoraDetail,
  onSetSimpleLoraTarget,
}: HighresGenerationPanelProps) => {
  return (
    <section className="panel">
      <div className="panel-header">
        <PanelTitle icon={ImageUp} title="高清修复" />
      </div>
      <div className="panel-body">
        <div className="segmented">
          <button
            type="button"
            className={params.enableUpscale ? "active" : ""}
            onClick={() => setParams((prev) => ({ ...prev, enableUpscale: !prev.enableUpscale }))}
          >
            高清放大
          </button>
          <button
            type="button"
            className={params.enableSegsDetailer ? "active" : ""}
            onClick={() =>
              setParams((prev) => ({ ...prev, enableSegsDetailer: !prev.enableSegsDetailer }))
            }
          >
            全图修复
          </button>
          <button
            type="button"
            className={params.enableFaceDetailer ? "active" : ""}
            onClick={() =>
              setParams((prev) => ({ ...prev, enableFaceDetailer: !prev.enableFaceDetailer }))
            }
          >
            脸部修复
          </button>
          <button
            type="button"
            className={params.enableEyesDetailer ? "active" : ""}
            onClick={() =>
              setParams((prev) => ({ ...prev, enableEyesDetailer: !prev.enableEyesDetailer }))
            }
          >
            眼部修复
          </button>
          <button
            type="button"
            className={params.enableNsfwDetailer ? "active" : ""}
            onClick={() =>
              setParams((prev) => ({ ...prev, enableNsfwDetailer: !prev.enableNsfwDetailer }))
            }
          >
            NSFW修复
          </button>
          <button
            type="button"
            className={params.enableHandDetailer ? "active" : ""}
            onClick={() =>
              setParams((prev) => ({ ...prev, enableHandDetailer: !prev.enableHandDetailer }))
            }
          >
            手部修复
          </button>
        </div>
        <BaseControls
          params={params}
          options={options}
          setParams={setParams}
          apiBase={apiBase}
          settings={loraSettings}
          localExampleFilesByHash={loraExampleFilesByHash}
          onLoraDetail={onOpenLoraDetail}
        />
        <div className="xyz-fields-grid" style={{ marginBottom: "12px" }}>
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={params.syncHighresSeed ?? true}
              onChange={(event) =>
                setParams((prev) => ({ ...prev, syncHighresSeed: event.target.checked }))
              }
            />{" "}
            同步基础 Seed
          </label>
          <NumberField
            label={params.randomizeHighresSeed ? "高修 seed（随机）" : "高修 seed"}
            value={params.highresSeed}
            step={1}
            min={0}
            disabled={params.syncHighresSeed !== false || params.randomizeHighresSeed}
            onChange={(value) => setParams((prev) => ({ ...prev, highresSeed: value }))}
          />
          {params.syncHighresSeed === false && (
            <label className="field checkbox-field">
              <input
                type="checkbox"
                checked={params.randomizeHighresSeed ?? true}
                onChange={(event) =>
                  setParams((prev) => ({ ...prev, randomizeHighresSeed: event.target.checked }))
                }
              />{" "}
              随机高修 seed
            </label>
          )}
        </div>
        <div className="form-grid three">
          <SelectField
            label="放大方法"
            value={params.upscaleMethod}
            options={options.upscaleMethods}
            onChange={(value) => setParams((prev) => ({ ...prev, upscaleMethod: value }))}
          />
          <NumberField
            label="放大倍率"
            value={params.scaleBy}
            step={0.1}
            min={1}
            max={8}
            onChange={(value) => setParams((prev) => ({ ...prev, scaleBy: value }))}
          />
          <NumberField
            label="高修步数"
            value={params.highresSteps}
            step={1}
            min={1}
            onChange={(value) => setParams((prev) => ({ ...prev, highresSteps: value }))}
          />
          <NumberField
            label="高修 CFG"
            value={params.highresCfg}
            step={0.1}
            min={0}
            onChange={(value) => setParams((prev) => ({ ...prev, highresCfg: value }))}
          />
          <NumberField
            label="高修重绘"
            value={params.highresDenoise}
            step={0.01}
            min={0}
            max={1}
            onChange={(value) => setParams((prev) => ({ ...prev, highresDenoise: value }))}
          />
        </div>
        <div className="detailer-grid">
          {params.enableSegsDetailer && (
            <DetailerControls
              title="全图修复参数"
              params={
                params.segsDetailer ?? {
                  ...makeDetailerParams(0.24),
                  steps: 18,
                  cfg: 6,
                  guideSize: 512,
                  maxSize: 1024,
                }
              }
              onChange={(detailer) => setParams((prev) => ({ ...prev, segsDetailer: detailer }))}
            />
          )}
          {params.enableHandDetailer && (
            <DetailerControls
              title="手部修复参数"
              detector={params.handDetector}
              detectors={options.detectors}
              params={params.handDetailer ?? makeDetailerParams(0.38)}
              onDetector={(value) => setParams((prev) => ({ ...prev, handDetector: value }))}
              onChange={(detailer) => setParams((prev) => ({ ...prev, handDetailer: detailer }))}
            />
          )}
          {params.enableFaceDetailer && (
            <DetailerControls
              title="脸部修复参数"
              detector={params.faceDetector}
              detectors={options.detectors}
              params={params.faceDetailer ?? makeDetailerParams(0.25)}
              onDetector={(value) => setParams((prev) => ({ ...prev, faceDetector: value }))}
              onChange={(detailer) => setParams((prev) => ({ ...prev, faceDetailer: detailer }))}
            />
          )}
          {params.enableEyesDetailer && (
            <DetailerControls
              title="眼部修复参数"
              detector={params.eyesDetector}
              detectors={options.detectors}
              params={params.eyesDetailer ?? makeDetailerParams(0.24)}
              onDetector={(value) => setParams((prev) => ({ ...prev, eyesDetector: value }))}
              onChange={(detailer) => setParams((prev) => ({ ...prev, eyesDetailer: detailer }))}
            />
          )}
          {params.enableNsfwDetailer && (
            <DetailerControls
              title="NSFW修复参数"
              detector={params.nsfwDetector}
              detectors={options.detectors}
              params={params.nsfwDetailer ?? makeDetailerParams(0.3)}
              onDetector={(value) => setParams((prev) => ({ ...prev, nsfwDetector: value }))}
              onChange={(detailer) => setParams((prev) => ({ ...prev, nsfwDetailer: detailer }))}
            />
          )}
        </div>
      </div>
      <div className="panel-footer" style={{ display: "flex", gap: "8px" }}>
        <button
          className="primary-action"
          style={{ flex: 1 }}
          type="button"
          onClick={onRunGeneration}
        >
          <ImageUp size={18} />
          开始修复
        </button>
        <button
          type="button"
          onClick={() => onSetSimpleLoraTarget("highres")}
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
