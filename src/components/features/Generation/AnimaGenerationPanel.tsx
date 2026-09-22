import React, { useMemo, useRef } from "react";
import { Sparkles, Plus, Upload, RotateCcw } from "lucide-react";
import { PanelTitle, BaseControls, SelectField, NumberField } from "../../ui";
import { PresetBar } from "./PresetBar";
import { DetailerControls } from "./DetailerControls";
import {
  ANIMA_RESOLUTION_WARN_EDGE,
  ANIMA_STAGE_COST,
  ANIMA_STAGE_PRESETS,
  ANIMA_UPSCALE_MODEL_SCALE,
  animaPresetLabels,
  animaStageMeta,
  matchAnimaPreset,
  type AnimaPresetId,
} from "../../../constants";
import { animaUpscaleNominal } from "../../../lib/workflowBuilders";
import { makeAnimaDetailerParams } from "../../../lib/paramBuilders";
import type {
  AnimaGenerationParams,
  AnimaStageKey,
  LoraItem,
  LoraExampleMedia,
  LoraManagerSettings,
  OptionsState,
} from "../../../types";

interface AnimaGenerationPanelProps {
  params: AnimaGenerationParams;
  setParams: (updater: AnimaGenerationParams | ((prev: AnimaGenerationParams) => AnimaGenerationParams)) => void;
  options: OptionsState;
  apiBase: string;
  loraSettings: LoraManagerSettings;
  loraExampleFilesByHash: Record<string, LoraExampleMedia[]>;
  loraNames?: string[];
  wildcardNames?: string[];
  onRunGeneration: () => void;
  onOpenLoraDetail: (item: LoraItem) => void;
  onSetSimpleLoraTarget: (target: "default" | "multi" | "highres" | "anima") => void;
  /** 上传参考图，返回 ComfyUI 侧的文件名 */
  onUploadImage: (file: File) => Promise<string>;
}

/** 预计输出分辨率与放大链摘要（估算值：percent 是直传节点的，此处按模型标称倍率折算） */
function useAnimaPreview(params: AnimaGenerationParams) {
  return useMemo(() => {
    const stages = params.stages;
    let width = params.width;
    let height = params.height;
    const chain: string[] = [];
    const ratio = (percent: number) => (percent / 100) * ANIMA_UPSCALE_MODEL_SCALE;

    if (stages.hiresFixPre) {
      width = animaUpscaleNominal(width, params.hires.prePercent);
      height = animaUpscaleNominal(height, params.hires.prePercent);
      chain.push(`×${Number(ratio(params.hires.prePercent).toFixed(2))}`);
    }
    if (stages.hiresFixPost) {
      width = animaUpscaleNominal(width, params.hires.postPercent);
      height = animaUpscaleNominal(height, params.hires.postPercent);
      chain.push(`×${Number(ratio(params.hires.postPercent).toFixed(2))}`);
    }

    // 只累加当前实际开启的阶段，未开启的阶段不贡献耗时
    let cost = 1;
    for (const { key } of animaStageMeta) {
      if (stages[key]) cost += ANIMA_STAGE_COST[key] ?? 0;
    }

    return {
      width,
      height,
      chainLabel: chain.length ? chain.join(" → ") : "无放大",
      cost: Number(cost.toFixed(2)),
      warn: Math.max(width, height) > ANIMA_RESOLUTION_WARN_EDGE,
    };
  }, [params]);
}

export const AnimaGenerationPanel = React.memo(({
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
  onUploadImage,
}: AnimaGenerationPanelProps) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const preview = useAnimaPreview(params);
  const stagePreset = matchAnimaPreset(params.stages);
  // 默认采样参数是 Turbo 蒸馏档（8 步 / CFG 1）。若选中的不是 Turbo 模型，
  // 这套参数会明显欠采样——这里给一条非阻断提示（空模型名不提示，那是"还没选"而非"选错"）。
  const unetName = params.modelStack.unetName;
  const showTurboHint = Boolean(unetName) && !unetName.toLowerCase().includes("turbo");
  // Anima 系模型是 16 通道 latent，配 sdxl_vae 会在 VAEDecode 报通道数错误——给非阻断提示
  const showVaePairingHint =
    /anima|janima/i.test(unetName) && /sdxl/i.test(params.modelStack.vaeName);
  // 放大档依赖放大模型；未装模型（列表为空/未选）时提交会被校验拒绝
  const showUpscaleModelHint =
    (params.stages.hiresFixPre || params.stages.hiresFixPost) && !params.hires.modelName;

  const setStage = (key: AnimaStageKey, value: boolean) =>
    setParams((prev) => ({ ...prev, stages: { ...prev.stages, [key]: value } }));

  const applyPreset = (id: AnimaPresetId) =>
    setParams((prev) => ({ ...prev, stages: { ...ANIMA_STAGE_PRESETS[id] } }));

  const handlePickImage = async (file?: File | null) => {
    if (!file) return;
    const name = await onUploadImage(file);
    setParams((prev) => ({ ...prev, img2img: { ...prev.img2img, imageName: name } }));
  };

  const modelStackSlot = (
    <>
      <SelectField
        label="UNet 模型"
        value={params.modelStack.unetName}
        options={options.unets}
        onChange={(value) =>
          setParams((prev) => ({ ...prev, modelStack: { ...prev.modelStack, unetName: value } }))
        }
      />
      <SelectField
        label="CLIP 模型"
        value={params.modelStack.clipName}
        options={options.clips}
        onChange={(value) =>
          setParams((prev) => ({ ...prev, modelStack: { ...prev.modelStack, clipName: value } }))
        }
      />
      <SelectField
        label="CLIP 类型"
        value={params.modelStack.clipType}
        options={options.clipTypes}
        onChange={(value) =>
          setParams((prev) => ({ ...prev, modelStack: { ...prev.modelStack, clipType: value } }))
        }
      />
      <SelectField
        label="VAE"
        value={params.modelStack.vaeName}
        options={options.vaes}
        onChange={(value) =>
          setParams((prev) => ({ ...prev, modelStack: { ...prev.modelStack, vaeName: value } }))
        }
      />
    </>
  );

  return (
    <section className="panel">
      <div className="panel-header" style={{ display: "flex", alignItems: "center" }}>
        <PanelTitle icon={Sparkles} title="Anima 生图" />
        <PresetBar target="anima" params={params} options={options} setParams={setParams} />
      </div>

      <div className="panel-body">
        {options.animaMissingNodes?.length > 0 && (
          <div
            className="sub-panel"
            style={{ marginBottom: "14px", borderColor: "var(--warning)", background: "var(--warning-soft)" }}
          >
            <h3 style={{ color: "var(--warning)", marginBottom: "6px" }}>缺少必需节点</h3>
            <div style={{ color: "var(--text)", fontSize: "13px", lineHeight: 1.7 }}>
              本机 ComfyUI 未安装以下节点，相关阶段会失败（可在 ComfyUI Manager 中安装后重启）：
              <div style={{ marginTop: "4px", color: "var(--muted)" }}>
                {options.animaMissingNodes.join("、")}
              </div>
            </div>
          </div>
        )}

        <div className="form-grid three">
          <label className="field">
            <span>档位预设</span>
            <select
              value={stagePreset}
              onChange={(event) => {
                const value = event.target.value;
                if (value !== "custom") applyPreset(value as AnimaPresetId);
              }}
            >
              {animaPresetLabels.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <div className="field" style={{ gridColumn: "span 3", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="secondary-action"
              onClick={() => applyPreset("full")}
              title="把阶段开关恢复为「完整复刻」"
            >
              <RotateCcw size={14} /> 恢复完整复刻
            </button>
          </div>
        </div>

        <div className="sub-panel" style={{ marginBottom: "14px" }}>
          <h3 style={{ marginBottom: "6px" }}>输出预览（估算）</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", color: "var(--muted)", fontSize: "13px" }}>
            <span>
              预计尺寸{" "}
              <strong style={{ color: preview.warn ? "var(--warning)" : "var(--text)" }}>
                {preview.width} × {preview.height}
              </strong>
            </span>
            <span>放大链：{preview.chainLabel}</span>
            <span>预估耗时：约 {preview.cost}× 基础采样</span>
            {preview.warn && <span style={{ color: "var(--warning)" }}>分辨率偏高，注意显存</span>}
            {showTurboHint && (
              <span style={{ color: "var(--warning)" }}>
                当前 UNet 可能不是 Turbo 蒸馏版，默认 {params.steps} 步 / CFG {params.cfg} 容易出废图；建议改 20+ 步 / CFG 4–7，或换用文件名含 Turbo 的模型
              </span>
            )}
            {showVaePairingHint && (
              <span style={{ color: "var(--warning)" }}>
                Anima 系模型是 16 通道 latent，当前 VAE（sdxl_vae）会解码失败；建议选择 qwen_image_vae
              </span>
            )}
            {showUpscaleModelHint && (
              <span style={{ color: "var(--warning)" }}>
                放大阶段已开启，但未选择放大模型（本机可能未安装 upscale 模型），生成会被校验拒绝；请在上方选择或关闭放大阶段
              </span>
            )}
          </div>
        </div>

        <div className="segmented">
          {animaStageMeta.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={params.stages[key] ? "active" : ""}
              title={`${label} · 约 ${ANIMA_STAGE_COST[key]}× 基础耗时`}
              onClick={() => setStage(key, !params.stages[key])}
            >
              {label}
            </button>
          ))}
        </div>

        <BaseControls
          params={params}
          options={options}
          setParams={setParams}
          modelSlot={modelStackSlot}
          apiBase={apiBase}
          settings={loraSettings}
          localExampleFilesByHash={loraExampleFilesByHash}
          loraNames={loraNames}
          wildcardNames={wildcardNames}
          onLoraDetail={onOpenLoraDetail}
        />

        {params.stages.img2img && (
          <div className="sub-panel" style={{ marginBottom: "14px" }}>
            <h3>图生图</h3>
            <div className="form-grid three">
              <label className="field">
                <span>参考图</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    void handlePickImage(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              <div className="field" style={{ justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={14} /> 选择图片
                </button>
              </div>
              <SelectField
                label="缩放策略"
                value={params.img2img.keepProportion}
                options={["stretch", "resize", "pad", "pad_edge", "pad_edge_pixel", "crop", "pillarbox_blur", "total_pixels"]}
                onChange={(value) =>
                  setParams((prev) => ({ ...prev, img2img: { ...prev.img2img, keepProportion: value } }))
                }
              />
              <SelectField
                label="裁剪位置"
                value={params.img2img.cropPosition}
                options={["center", "top", "bottom", "left", "right"]}
                onChange={(value) =>
                  setParams((prev) => ({ ...prev, img2img: { ...prev.img2img, cropPosition: value } }))
                }
              />
              <NumberField
                label="重绘强度"
                value={params.denoise}
                step={0.01}
                min={0}
                max={1}
                onChange={(value) => setParams((prev) => ({ ...prev, denoise: value }))}
              />
              <div className="field" style={{ gridColumn: "span 2", justifyContent: "flex-end" }}>
                <span style={{ color: "var(--muted)", fontSize: "12px" }}>
                  {params.img2img.imageName ? `已选：${params.img2img.imageName}` : "未选图时将自动按文生图出图"}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="form-grid three">
          <SelectField
            label="放大模型"
            value={params.hires.modelName}
            options={options.upscaleModels}
            onChange={(value) => setParams((prev) => ({ ...prev, hires: { ...prev.hires, modelName: value } }))}
          />
          <NumberField
            label="放大①百分比"
            value={params.hires.prePercent}
            step={5}
            min={1}
            max={400}
            onChange={(value) => setParams((prev) => ({ ...prev, hires: { ...prev.hires, prePercent: value } }))}
          />
          <NumberField
            label="放大②百分比"
            value={params.hires.postPercent}
            step={5}
            min={1}
            max={400}
            onChange={(value) => setParams((prev) => ({ ...prev, hires: { ...prev.hires, postPercent: value } }))}
          />
          <NumberField
            label="精修步数"
            value={params.refine.steps}
            step={1}
            min={1}
            onChange={(value) => setParams((prev) => ({ ...prev, refine: { ...prev.refine, steps: value } }))}
          />
          <NumberField
            label="精修 CFG"
            value={params.refine.cfg}
            step={0.1}
            min={0}
            onChange={(value) => setParams((prev) => ({ ...prev, refine: { ...prev.refine, cfg: value } }))}
          />
          <NumberField
            label="精修重绘"
            value={params.refine.denoise}
            step={0.01}
            min={0}
            max={1}
            onChange={(value) => setParams((prev) => ({ ...prev, refine: { ...prev.refine, denoise: value } }))}
          />
        </div>

        <div className="detailer-grid">
          {params.stages.segsDetailer && (
            <DetailerControls
              samplers={options.samplers}
              schedulers={options.schedulers}
              title="全图修复参数"
              params={params.segsDetailer ?? makeAnimaDetailerParams(0.24)}
              onChange={(detailer) => setParams((prev) => ({ ...prev, segsDetailer: detailer }))}
            />
          )}
          {params.stages.handDetailer && (
            <DetailerControls
              samplers={options.samplers}
              schedulers={options.schedulers}
              title="手部修复参数"
              detector={params.handDetector}
              detectors={options.detectors}
              params={params.handDetailer ?? makeAnimaDetailerParams(0.4)}
              onDetector={(value) => setParams((prev) => ({ ...prev, handDetector: value }))}
              onChange={(detailer) => setParams((prev) => ({ ...prev, handDetailer: detailer }))}
            />
          )}
          {params.stages.faceDetailer && (
            <DetailerControls
              samplers={options.samplers}
              schedulers={options.schedulers}
              title="脸部修复参数"
              detector={params.faceDetector}
              detectors={options.detectors}
              params={params.faceDetailer ?? makeAnimaDetailerParams(0.26)}
              onDetector={(value) => setParams((prev) => ({ ...prev, faceDetector: value }))}
              onChange={(detailer) => setParams((prev) => ({ ...prev, faceDetailer: detailer }))}
            />
          )}
          {params.stages.eyesDetailer && (
            <DetailerControls
              samplers={options.samplers}
              schedulers={options.schedulers}
              title="眼部修复参数"
              detector={params.eyesDetector}
              detectors={options.detectors}
              params={params.eyesDetailer ?? makeAnimaDetailerParams(0.24)}
              onDetector={(value) => setParams((prev) => ({ ...prev, eyesDetector: value }))}
              onChange={(detailer) => setParams((prev) => ({ ...prev, eyesDetailer: detailer }))}
            />
          )}
          {params.stages.nsfwDetailer && (
            <DetailerControls
              samplers={options.samplers}
              schedulers={options.schedulers}
              title="NSFW修复参数"
              detector={params.nsfwDetector}
              detectors={options.detectors}
              params={params.nsfwDetailer ?? makeAnimaDetailerParams(0.3)}
              onDetector={(value) => setParams((prev) => ({ ...prev, nsfwDetector: value }))}
              onChange={(detailer) => setParams((prev) => ({ ...prev, nsfwDetailer: detailer }))}
            />
          )}
        </div>
      </div>

      <div className="panel-footer" style={{ display: "flex", gap: "8px" }}>
        <button className="primary-action" style={{ flex: 1 }} type="button" onClick={onRunGeneration}>
          <Sparkles size={18} />
          开始生成
        </button>
        <button
          type="button"
          onClick={() => onSetSimpleLoraTarget("anima")}
          title="添加 LoRA"
          className="secondary-action"
        >
          <Plus size={16} /> 添加 LoRA
        </button>
      </div>
    </section>
  );
});
