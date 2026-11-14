import { ModalFrame, NumberField, SelectField } from "../../ui";
import { Select } from "../../ui/Select";
import { ANIMA_STAGE_PRESETS, animaPresetLabels, animaStageMeta, matchAnimaPreset } from "../../../constants";
import type { AnimaPresetId } from "../../../constants";
import { findResolutionPreset, resolutionPresets } from "../../../lib/presets";
import type { OptionsState } from "../../../types";
import type {
  WardrobeGenerationParams,
  WardrobeGenerationState,
} from "../../../lib/wardrobe/types";
import { WARDROBE_CONTINUOUS_MAX } from "../../../lib/wardrobe/generation";

type Props = {
  state: WardrobeGenerationState;
  options: OptionsState;
  onChange: (updater: (prev: WardrobeGenerationState) => WardrobeGenerationState) => void;
  onClose: () => void;
};

/**
 * 造型台专属生图设置。
 * 所有字段只改 `comfyui_wardrobe_generation`，不会写回 Anima / 其他模板。
 */
export function WardrobeGenerationSettings({ state, options, onChange, onClose }: Props) {
  const params = state.params;
  const stagePreset = matchAnimaPreset(params.stages);
  const patchParams = (updater: (prev: WardrobeGenerationParams) => WardrobeGenerationParams) =>
    onChange((prev) => ({ ...prev, params: updater(prev.params) }));

  const setField = <K extends keyof WardrobeGenerationParams>(
    key: K,
    value: WardrobeGenerationParams[K],
  ) => patchParams((prev) => ({ ...prev, [key]: value }));

  return (
    <ModalFrame
      title="造型台生图设置"
      onClose={onClose}
      style={{ width: "min(920px, 94vw)", height: "86vh", display: "flex", flexDirection: "column" }}
    >
      <div className="wd-gen-settings">
        <div className="wd-gen-settings-lead">
          <span>只作用于造型台「一键生图 / 连续生图」</span>
          <span className="wd-muted">与 Anima 及其他模板互不影响</span>
        </div>

        <section className="wd-gen-section">
          <div className="wd-gen-section-head">
            <h3>模型栈</h3>
            <span>UNet / CLIP / VAE</span>
          </div>
          <div className="form-grid two">
            <SelectField
              label="UNet 模型"
              value={params.modelStack.unetName}
              options={options.unets}
              onChange={(value) =>
                patchParams((prev) => ({ ...prev, modelStack: { ...prev.modelStack, unetName: value } }))
              }
            />
            <SelectField
              label="CLIP 模型"
              value={params.modelStack.clipName}
              options={options.clips}
              onChange={(value) =>
                patchParams((prev) => ({ ...prev, modelStack: { ...prev.modelStack, clipName: value } }))
              }
            />
            <SelectField
              label="CLIP 类型"
              value={params.modelStack.clipType}
              options={options.clipTypes}
              onChange={(value) =>
                patchParams((prev) => ({ ...prev, modelStack: { ...prev.modelStack, clipType: value } }))
              }
            />
            <SelectField
              label="VAE"
              value={params.modelStack.vaeName}
              options={options.vaes}
              onChange={(value) =>
                patchParams((prev) => ({ ...prev, modelStack: { ...prev.modelStack, vaeName: value } }))
              }
            />
          </div>
        </section>

        <section className="wd-gen-section">
          <div className="wd-gen-section-head">
            <h3>尺寸与采样</h3>
            <span>分辨率 / 步数 / CFG / seed</span>
          </div>
          <div className="form-grid three">
            <label className="field">
              <span>宽高预设</span>
              <Select
                ariaLabel="宽高预设"
                block
                value={findResolutionPreset(params.width, params.height)}
                options={[
                  ...resolutionPresets.map((preset) => ({ value: preset.label, label: preset.label })),
                  { value: "custom", label: "自定义" },
                ]}
                onChange={(next) => {
                  const preset = resolutionPresets.find((item) => item.label === next);
                  if (preset) {
                    patchParams((prev) => ({ ...prev, width: preset.width, height: preset.height }));
                  }
                }}
              />
            </label>
            <NumberField
              label="宽"
              value={params.width}
              min={16}
              step={8}
              onChange={(value) => setField("width", value)}
            />
            <NumberField
              label="高"
              value={params.height}
              min={16}
              step={8}
              onChange={(value) => setField("height", value)}
            />
            <NumberField
              label="Steps"
              value={params.steps}
              min={1}
              step={1}
              onChange={(value) => setField("steps", value)}
            />
            <NumberField
              label="CFG"
              value={params.cfg}
              min={0}
              step={0.1}
              onChange={(value) => setField("cfg", value)}
            />
            <SelectField
              label="采样器"
              value={params.samplerName}
              options={options.samplers}
              onChange={(value) => setField("samplerName", value)}
            />
            <SelectField
              label="调度器"
              value={params.scheduler}
              options={options.schedulers}
              onChange={(value) => setField("scheduler", value)}
            />
            <NumberField
              label={params.randomizeSeed ? "Seed（随机生成）" : "Seed"}
              value={params.seed}
              min={0}
              step={1}
              disabled={params.randomizeSeed}
              onChange={(value) => setField("seed", value)}
            />
            <label className="field checkbox-field">
              <input
                type="checkbox"
                checked={params.randomizeSeed}
                onChange={(event) => setField("randomizeSeed", event.target.checked)}
              />{" "}
              每次随机 seed
            </label>
          </div>
        </section>

        <section className="wd-gen-section">
          <div className="wd-gen-section-head">
            <h3>阶段</h3>
            <span>预设只改阶段开关</span>
          </div>
          <div className="wd-gen-stage-preset">
            <label className="field">
              <span>阶段预设</span>
              <Select
                ariaLabel="阶段预设"
                block
                value={stagePreset}
                options={animaPresetLabels.map((preset) => ({ value: preset.id, label: preset.label }))}
                onChange={(next) => {
                  if (next === "custom") return;
                  patchParams((prev) => ({
                    ...prev,
                    stages: { ...ANIMA_STAGE_PRESETS[next as AnimaPresetId] },
                  }));
                }}
              />
            </label>
          </div>
          <div className="segmented wd-gen-settings-stages">
            {animaStageMeta
              .filter(({ key }) => key !== "img2img")
              .map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={params.stages[key] ? "active" : ""}
                  onClick={() =>
                    patchParams((prev) => ({
                      ...prev,
                      stages: { ...prev.stages, [key]: !prev.stages[key] },
                    }))
                  }
                >
                  {label}
                </button>
              ))}
          </div>
          <p className="wd-gen-section-hint">图生图阶段在造型台固定关闭，避免误用 Anima 面板的参考图。</p>
        </section>

        <details className="wd-gen-section wd-gen-section-collapsible">
          <summary>
            <h3>反向提示词</h3>
            <span>可选</span>
          </summary>
          <textarea
            rows={3}
            className="wd-gen-neg"
            value={params.negativePrompt}
            spellCheck={false}
            onChange={(event) => setField("negativePrompt", event.target.value)}
          />
        </details>

        <details className="wd-gen-section wd-gen-section-collapsible">
          <summary>
            <h3>放大与精修</h3>
            <span>按需开启</span>
          </summary>
          <div className="form-grid three">
            <SelectField
              label="放大模型"
              value={params.hires.modelName}
              options={options.upscaleModels}
              onChange={(value) =>
                patchParams((prev) => ({ ...prev, hires: { ...prev.hires, modelName: value } }))
              }
            />
            <NumberField
              label="放大①百分比"
              value={params.hires.prePercent}
              min={1}
              max={400}
              step={5}
              onChange={(value) =>
                patchParams((prev) => ({ ...prev, hires: { ...prev.hires, prePercent: value } }))
              }
            />
            <NumberField
              label="放大②百分比"
              value={params.hires.postPercent}
              min={1}
              max={400}
              step={5}
              onChange={(value) =>
                patchParams((prev) => ({ ...prev, hires: { ...prev.hires, postPercent: value } }))
              }
            />
            <NumberField
              label="精修步数"
              value={params.refine.steps}
              min={1}
              step={1}
              onChange={(value) =>
                patchParams((prev) => ({ ...prev, refine: { ...prev.refine, steps: value } }))
              }
            />
            <NumberField
              label="精修 CFG"
              value={params.refine.cfg}
              min={0}
              step={0.1}
              onChange={(value) =>
                patchParams((prev) => ({ ...prev, refine: { ...prev.refine, cfg: value } }))
              }
            />
            <NumberField
              label="精修重绘"
              value={params.refine.denoise}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) =>
                patchParams((prev) => ({ ...prev, refine: { ...prev.refine, denoise: value } }))
              }
            />
          </div>
        </details>

        <section className="wd-gen-section">
          <div className="wd-gen-section-head">
            <h3>连续生图</h3>
            <span>每轮重新抽词并生成</span>
          </div>
          <div className="wd-gen-inline">
            <NumberField
              label="连续次数"
              value={state.continuousCount}
              min={1}
              max={WARDROBE_CONTINUOUS_MAX}
              step={1}
              onChange={(value) =>
                onChange((prev) => ({
                  ...prev,
                  continuousCount: Math.max(
                    1,
                    Math.min(WARDROBE_CONTINUOUS_MAX, Math.trunc(value) || 1),
                  ),
                }))
              }
            />
            <p className="wd-gen-section-hint">
              连续生图会每轮重新抽一次词条（临时随机种子，不改面板 seed），再按当前参数逐张生成。
            </p>
          </div>
        </section>
      </div>

      <div className="panel-footer wd-modal-foot wd-gen-settings-foot">
        <span className="wd-muted">修改会即时保存</span>
        <button type="button" className="primary-action" onClick={onClose}>
          完成
        </button>
      </div>
    </ModalFrame>
  );
}
