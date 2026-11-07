import React, { useRef, useState } from "react";
import { Columns3, Plus, RefreshCw, Sparkles, Upload, X } from "lucide-react";
import {
  BaseControls,
  CopyableTextarea,
  NumberField,
  PanelTitle,
  Select,
  SelectField,
  TextAreaField,
} from "../../ui";
import { DetailerControls } from "./DetailerControls";
import {
  ANIMA_STAGE_PRESETS,
  animaPresetLabels,
  animaStageMeta,
  matchAnimaPreset,
  sheetSubjectOptions,
  type AnimaPresetId,
} from "../../../constants";
import {
  composeSheetPromptFromParams,
  SHEET_LORAS,
  sheetPromptInput,
} from "../../../lib/characterSheet";
import type { useSheetLora } from "../../../hooks/useSheetLora";
import type {
  AnimaStageKey,
  BaseGenerationParams,
  HighresParams,
  LoraExampleMedia,
  LoraInsertTarget,
  LoraItem,
  LoraManagerSettings,
  OptionsState,
  SheetMode,
  SheetParams,
  Toast,
} from "../../../types";

type PushToast = (type: Toast["type"], title: string, message?: string) => void;

/** Anima 阶段开关里三视图页不暴露的项（图生图由参考图区管、通配符与保存始终开启） */
const HIDDEN_STAGE_KEYS: AnimaStageKey[] = ["img2img", "wildcardNode", "saveImage"];

/** SDXL 修复开关（与「高清修复」面板同一套字段） */
type SdxlFixKey =
  | "enableUpscale"
  | "enableSegsDetailer"
  | "enableHandDetailer"
  | "enableFaceDetailer"
  | "enableEyesDetailer"
  | "enableNsfwDetailer";

const SDXL_FIX_TOGGLES: Array<{ key: SdxlFixKey; label: string; hint: string }> = [
  { key: "enableUpscale", label: "放大", hint: "LatentUpscaleBy 放大后再采样一遍（高修）" },
  { key: "enableSegsDetailer", label: "全图修复", hint: "对整图做一次 SEGS 局部重绘" },
  { key: "enableFaceDetailer", label: "脸部修复", hint: "检测脸部并局部重绘" },
  { key: "enableEyesDetailer", label: "眼部修复", hint: "检测眼部并局部重绘" },
  { key: "enableNsfwDetailer", label: "NSFW修复", hint: "对敏感区域局部重绘" },
  { key: "enableHandDetailer", label: "手部修复", hint: "检测手部并局部重绘" },
];

const MODE_LABELS: Record<SheetMode, string> = {
  anima: "Anima",
  sdxl: "SDXL · Illustrious / NoobAI",
};

export type SheetGenerationPanelProps = {
  params: SheetParams;
  setParams: (updater: SheetParams | ((prev: SheetParams) => SheetParams)) => void;
  options: OptionsState;
  apiBase: string;
  loraSettings: LoraManagerSettings;
  loraExampleFilesByHash: Record<string, LoraExampleMedia[]>;
  loraNames?: string[];
  wildcardNames?: string[];
  /** 由 App 统一持有：面板展示与生成共用同一份解析结果 */
  loraState: ReturnType<typeof useSheetLora>;
  onRunGeneration: () => void;
  onOpenLoraDetail: (item: LoraItem) => void;
  onSetSimpleLoraTarget: (target: LoraInsertTarget) => void;
  onUploadImage: (file: File) => Promise<string>;
  pushToast: PushToast;
};

/**
 * 三视图（角色三视图 / character sheet）生成页。
 *
 * 与其它模板面板的区别：它不拥有独立的 TemplateKind，也不新造工作流，
 * 只把「固定视角词 + LoRA 触发词 + 角色描述」拼成正向提示词，再交给
 * Anima / 默认生图两条既有 builder 之一。
 */
export const SheetGenerationPanel = React.memo(({
  params,
  setParams,
  options,
  apiBase,
  loraSettings,
  loraExampleFilesByHash,
  loraNames,
  wildcardNames,
  loraState,
  onRunGeneration,
  onOpenLoraDetail,
  onSetSimpleLoraTarget,
  onUploadImage,
  pushToast,
}: SheetGenerationPanelProps) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const mode = params.mode;
  const spec = SHEET_LORAS[mode];
  const resolution = loraState.resolved[mode];
  const weight = params.lora.weight[mode];
  const modeParams: BaseGenerationParams = params[mode];

  /* ---------------- 更新器：模式切换只改 mode，两套参数互不写 ---------------- */

  const setModeParams = (updater: BaseGenerationParams | ((prev: BaseGenerationParams) => BaseGenerationParams)) => {
    setParams((prev) => {
      const current = prev[prev.mode] as BaseGenerationParams;
      const next = typeof updater === "function" ? updater(current) : updater;
      return { ...prev, [prev.mode]: next } as SheetParams;
    });
  };

  const patchSheet = (patch: Partial<SheetParams>) => setParams((prev) => ({ ...prev, ...patch }));

  const setAnimaStage = (key: AnimaStageKey, value: boolean) =>
    setParams((prev) => ({
      ...prev,
      anima: { ...prev.anima, stages: { ...prev.anima.stages, [key]: value } },
    }));

  /** SDXL 修复区：直接改 `sheet.sdxl`（HighresParams），与「高清修复」面板同字段 */
  const setSdxl = (patch: Partial<HighresParams>) =>
    setParams((prev) => ({ ...prev, sdxl: { ...prev.sdxl, ...patch } }));

  const toggleFix = (key: SdxlFixKey) =>
    setParams((prev) => ({ ...prev, sdxl: { ...prev.sdxl, [key]: !prev.sdxl[key] } }));

  const fixCount = SDXL_FIX_TOGGLES.filter((toggle) => params.sdxl[toggle.key]).length;

  /* ---------------- 参考图 ---------------- */

  const referenceActive = params.reference.enabled && Boolean(params.reference.imageName);

  const toggleReference = (enabled: boolean) => {
    const currentDenoise = (params[params.mode] as BaseGenerationParams).denoise;
    const lowerDenoise = enabled && currentDenoise > 0.95;
    setParams((prev) => {
      const next: SheetParams = { ...prev, reference: { ...prev.reference, enabled } };
      if (lowerDenoise) {
        if (prev.mode === "anima") next.anima = { ...prev.anima, denoise: 0.6 };
        else next.sdxl = { ...prev.sdxl, denoise: 0.6 };
      }
      return next;
    });
    if (lowerDenoise) {
      pushToast("info", "已下调重绘强度", `重绘 ${currentDenoise} 时参考图几乎不起作用，已改为 0.6`);
    }
  };

  const pickImage = async (file?: File | null) => {
    if (!file) return;
    setUploadBusy(true);
    setUploadError("");
    try {
      const name = await onUploadImage(file);
      setParams((prev) => ({
        ...prev,
        reference: { enabled: true, imageName: name },
      }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error));
    } finally {
      setUploadBusy(false);
    }
  };

  const referenceHints: string[] = [];
  if (params.reference.enabled && !params.reference.imageName) referenceHints.push("未选参考图，本次按文生图出图");
  if (referenceActive && modeParams.denoise > 0.95) referenceHints.push("重绘接近 1，参考图几乎不起作用，建议 0.4–0.7");
  if (referenceActive) {
    referenceHints.push(
      mode === "anima"
        ? "Anima 用 ImageResizeKJv2 对齐到目标尺寸（pad_edge，不裁切）"
        : "SDXL 用 ImageScale 拉伸到目标尺寸",
    );
  }
  if (uploadError) referenceHints.push(`上传失败：${uploadError}`);

  /* ---------------- 三视图 LoRA 行 ---------------- */

  const overrideValue = params.lora.override[mode] ?? "";
  const overrideOptions = [
    { label: `内置默认：${spec.relativePath.split("/").pop()}`, value: "" },
    ...loraState.candidates[mode].map((item) => ({
      label: `${item.folder ? `${item.folder}/` : ""}${item.file_name}${item.base_model ? ` · ${item.base_model}` : ""}`,
      value: item.folder ? `${item.folder}/${item.file_name}` : item.file_name,
    })),
  ];
  if (overrideValue && !overrideOptions.some((option) => option.value === overrideValue)) {
    overrideOptions.push({ label: overrideValue, value: overrideValue });
  }

  const loraStatus = !params.lora.enabled
    ? "已关闭：不挂 LoRA，也不补触发词"
    : loraState.loading
      ? "正在检索 LoRA 库…"
      : resolution.matched
        ? `已挂载 ${resolution.ref.name}`
        : loraState.error
          ? `LoRA 库不可用，已按相对路径挂载（${loraState.error}）`
          : "未在 LoRA 库检索到，已按相对路径挂载（生成报 LoRA not found 时请检查文件位置）";

  /* ---------------- Anima 模型栈控件（替换 BaseControls 的 checkpoint 下拉） ---------------- */

  const animaModelSlot = (
    <>
      <SelectField
        label="UNet 模型"
        value={params.anima.modelStack.unetName}
        options={options.unets}
        onChange={(value) =>
          setParams((prev) => ({ ...prev, anima: { ...prev.anima, modelStack: { ...prev.anima.modelStack, unetName: value } } }))
        }
      />
      <SelectField
        label="CLIP 模型"
        value={params.anima.modelStack.clipName}
        options={options.clips}
        onChange={(value) =>
          setParams((prev) => ({ ...prev, anima: { ...prev.anima, modelStack: { ...prev.anima.modelStack, clipName: value } } }))
        }
      />
      <SelectField
        label="CLIP 类型"
        value={params.anima.modelStack.clipType}
        options={options.clipTypes}
        onChange={(value) =>
          setParams((prev) => ({ ...prev, anima: { ...prev.anima, modelStack: { ...prev.anima.modelStack, clipType: value } } }))
        }
      />
      <SelectField
        label="VAE"
        value={params.anima.modelStack.vaeName}
        options={options.vaes}
        onChange={(value) =>
          setParams((prev) => ({ ...prev, anima: { ...prev.anima, modelStack: { ...prev.anima.modelStack, vaeName: value } } }))
        }
      />
    </>
  );

  const previewPositive = composeSheetPromptFromParams(params);
  const promptInput = sheetPromptInput(params);
  const fixedCount = Math.max(0, splitTagCount(previewPositive) - splitTagCount(promptInput.character) - splitTagCount(promptInput.style));

  // 模型可用性提示：三视图页的模型是「首次打开继承、之后自维护」的，改名/换机器后会悬空
  const modelName = mode === "anima" ? params.anima.modelStack.unetName : params.sdxl.checkpoint;
  const modelPool = mode === "anima" ? options.unets : options.checkpoints;
  const modelMissing = !modelName;
  const modelStale = Boolean(modelName) && modelPool.length > 0 && !modelPool.includes(modelName);

  return (
    <section className="panel">
      <div className="panel-header" style={{ display: "flex", alignItems: "center" }}>
        <PanelTitle icon={Columns3} title="三视图" />
      </div>

      <div className="panel-body">
        {/* 模式：只切换 mode，两套参数各自保留 */}
        <div
          className="segmented"
          style={{ marginBottom: "14px", gridTemplateColumns: "repeat(2, minmax(150px, 240px))" }}
        >
          {(Object.keys(MODE_LABELS) as SheetMode[]).map((value) => (
            <button
              key={value}
              type="button"
              className={mode === value ? "active" : ""}
              onClick={() => patchSheet({ mode: value })}
            >
              {MODE_LABELS[value]}
            </button>
          ))}
        </div>

        {/* 模型悬空提示：不阻断，但先说清楚为什么提交会失败 */}
        {(modelMissing || modelStale) && (
          <div
            className="sub-panel"
            style={{ marginBottom: "14px", borderColor: "var(--warning)", background: "var(--warning-soft)" }}
          >
            <h3 style={{ color: "var(--warning)", marginBottom: "4px" }}>模型未就绪</h3>
            <div style={{ color: "var(--text)", fontSize: "13px", lineHeight: 1.7 }}>
              {modelMissing
                ? `尚未选择${mode === "anima" ? " UNet 模型" : "大模型"}，请在下拉中选择后再生成。`
                : `当前模型「${modelName}」不在 ComfyUI 的可用列表中（可能已改名或移动），请重新选择。`}
            </div>
          </div>
        )}

        {/* 三视图 LoRA：自动挂载，权重可调，不可删除 */}
        <div className="sub-panel" style={{ marginBottom: "14px" }}>
          <h3>三视图 LoRA（{spec.baseModel}）</h3>
          <div className="form-grid three">
            <label className="field checkbox-field">
              <input
                type="checkbox"
                checked={params.lora.enabled}
                onChange={(event) => setParams((prev) => ({ ...prev, lora: { ...prev.lora, enabled: event.target.checked } }))}
              />{" "}
              自动挂载
            </label>
            <label className="field" style={{ gridColumn: "span 2" }}>
              <span>LoRA 权重（{spec.weightHint}）</span>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={weight}
                  style={{ flex: 1 }}
                  onChange={(event) =>
                    setParams((prev) => ({
                      ...prev,
                      lora: { ...prev.lora, weight: { ...prev.lora.weight, [mode]: Number(event.target.value) } },
                    }))
                  }
                />
                <strong style={{ minWidth: "3ch", textAlign: "right" }}>{weight.toFixed(2)}</strong>
              </div>
            </label>
            <label className="field checkbox-field">
              <input
                type="checkbox"
                checked={params.lora.includeTrigger}
                onChange={(event) =>
                  setParams((prev) => ({ ...prev, lora: { ...prev.lora, includeTrigger: event.target.checked } }))
                }
              />{" "}
              补触发词
            </label>
            <label className="field checkbox-field">
              <input
                type="checkbox"
                checked={params.lora.includeBackground}
                onChange={(event) =>
                  setParams((prev) => ({ ...prev, lora: { ...prev.lora, includeBackground: event.target.checked } }))
                }
              />{" "}
              补背景词
            </label>
            <div className="field" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="secondary-action" onClick={loraState.reload} disabled={loraState.loading}>
                <RefreshCw size={14} /> 重新检索
              </button>
            </div>
            <label className="field" style={{ gridColumn: "span 3" }}>
              <span>改用其它三视图 LoRA</span>
              <Select
                ariaLabel="改用其它三视图 LoRA"
                block
                value={overrideValue}
                options={overrideOptions}
                onChange={(next) =>
                  setParams((prev) => ({
                    ...prev,
                    lora: {
                      ...prev.lora,
                      override: { ...prev.lora.override, [mode]: next || undefined },
                    },
                  }))
                }
              />
            </label>
          </div>
          <div style={{ fontSize: "12px", color: resolution.matched || !params.lora.enabled ? "var(--muted)" : "var(--warning)" }}>
            {loraStatus}
          </div>
        </div>

        {/* 角色与画风 */}
        <div className="form-grid three">
          <label className="field">
            <span>主体</span>
            <Select
              ariaLabel="主体"
              block
              value={params.subject}
              options={sheetSubjectOptions}
              onChange={(next) => patchSheet({ subject: next as SheetParams["subject"] })}
            />
          </label>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <span>固定视角（正 / 侧 / 背）</span>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {[...spec.views, ...spec.body].map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: "12px",
                    padding: "2px 10px",
                    borderRadius: 999,
                    background: "var(--surface-alt)",
                    border: "1px solid var(--border)",
                    color: "var(--muted)",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="form-grid two prompt-grid">
          <TextAreaField
            label="角色描述（提示词）"
            value={params.characterPrompt}
            placeholder="silver hair, blue eyes, school uniform, ..."
            onChange={(value) => patchSheet({ characterPrompt: value })}
          />
          <TextAreaField
            label={`画风附加词（${MODE_LABELS[mode]}）`}
            value={params.style[mode]}
            placeholder="masterpiece, best quality, ..."
            onChange={(value) => patchSheet({ style: { ...params.style, [mode]: value } })}
          />
        </div>

        <details className="sub-panel" style={{ marginBottom: "14px" }}>
          <summary style={{ cursor: "pointer" }}>最终正向提示词（预览 / 可复制）· {splitTagCount(previewPositive)} 个词条</summary>
          <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--muted)" }}>
            固定词 {fixedCount} 个（主体 / 触发词 / 视角 / 体型 / 背景），其余来自角色描述与画风
          </div>
          <CopyableTextarea value={previewPositive} className="output-text" />
        </details>

        {/* 参考图（两个模型族共用一份，生成时映射到各自字段） */}
        <div className="sub-panel" style={{ marginBottom: "14px" }}>
          <h3>参考图（图生图）</h3>
          <div className="form-grid three">
            <label className="field checkbox-field">
              <input
                type="checkbox"
                checked={params.reference.enabled}
                onChange={(event) => toggleReference(event.target.checked)}
              />{" "}
              启用参考图
            </label>
            <label className="field">
              <span>图片</span>
              <input readOnly value={params.reference.imageName || "未选择"} />
            </label>
            <div className="field" style={{ flexDirection: "row", gap: "8px", alignItems: "center", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="secondary-action"
                disabled={uploadBusy}
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={14} /> {uploadBusy ? "上传中…" : "选择图片"}
              </button>
              {params.reference.imageName && (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => setParams((prev) => ({ ...prev, reference: { enabled: false, imageName: "" } }))}
                >
                  <X size={14} /> 清除
                </button>
              )}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(event) => {
              void pickImage(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          {referenceHints.length > 0 && (
            <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.7 }}>
              {referenceHints.map((hint) => (
                <div key={hint}>· {hint}</div>
              ))}
            </div>
          )}
        </div>

        <BaseControls
          params={modeParams}
          options={options}
          setParams={setModeParams}
          modelSlot={mode === "anima" ? animaModelSlot : undefined}
          hidePositive
          apiBase={apiBase}
          settings={loraSettings}
          localExampleFilesByHash={loraExampleFilesByHash}
          loraNames={loraNames}
          wildcardNames={wildcardNames}
          onLoraDetail={onOpenLoraDetail}
        />

        {mode === "anima" && (
          <details className="sub-panel" style={{ marginTop: "14px" }}>
            <summary style={{ cursor: "pointer" }}>Anima 高级（阶段 / 放大）</summary>
            <div className="form-grid three" style={{ marginTop: "10px" }}>
              <label className="field">
                <span>档位预设</span>
                <Select
                  ariaLabel="档位预设"
                  block
                  value={matchAnimaPreset(params.anima.stages)}
                  options={animaPresetLabels.map((preset) => ({ value: preset.id, label: preset.label }))}
                  onChange={(next) => {
                    if (next === "custom") return;
                    setParams((prev) => ({
                      ...prev,
                      anima: { ...prev.anima, stages: { ...ANIMA_STAGE_PRESETS[next as AnimaPresetId] } },
                    }));
                  }}
                />
              </label>
              <SelectField
                label="放大模型"
                value={params.anima.hires.modelName}
                options={options.upscaleModels}
                onChange={(value) =>
                  setParams((prev) => ({ ...prev, anima: { ...prev.anima, hires: { ...prev.anima.hires, modelName: value } } }))
                }
              />
              <NumberField
                label="放大①百分比"
                value={params.anima.hires.prePercent}
                step={5}
                min={1}
                max={400}
                disabled={!params.anima.stages.hiresFixPre}
                onChange={(value) =>
                  setParams((prev) => ({ ...prev, anima: { ...prev.anima, hires: { ...prev.anima.hires, prePercent: value } } }))
                }
              />
              <NumberField
                label="放大②百分比"
                value={params.anima.hires.postPercent}
                step={5}
                min={1}
                max={400}
                disabled={!params.anima.stages.hiresFixPost}
                onChange={(value) =>
                  setParams((prev) => ({ ...prev, anima: { ...prev.anima, hires: { ...prev.anima.hires, postPercent: value } } }))
                }
              />
            </div>
            <div className="segmented" style={{ marginTop: "10px" }}>
              {animaStageMeta
                .filter(({ key }) => !HIDDEN_STAGE_KEYS.includes(key))
                .map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className={params.anima.stages[key] ? "active" : ""}
                    onClick={() => setAnimaStage(key, !params.anima.stages[key])}
                  >
                    {label}
                  </button>
                ))}
            </div>
            <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "8px" }}>
              三视图默认关闭两级放大：开启后输出尺寸会按放大模型倍率暴涨，先确认显存与耗时。
            </div>
          </details>
        )}

        {mode === "sdxl" && (
          <details className="sub-panel" style={{ marginTop: "14px" }}>
            <summary style={{ cursor: "pointer" }}>
              SDXL 修复（放大 / 全图 / 手·脸·眼）
              {fixCount > 0 ? ` · 已启用 ${fixCount} 项` : " · 全关（纯文生图）"}
            </summary>
            <div className="segmented" style={{ marginTop: "10px" }}>
              {SDXL_FIX_TOGGLES.map((toggle) => (
                <button
                  key={toggle.key}
                  type="button"
                  className={params.sdxl[toggle.key] ? "active" : ""}
                  title={toggle.hint}
                  onClick={() => toggleFix(toggle.key)}
                >
                  {toggle.label}
                </button>
              ))}
            </div>
            <div className="form-grid three" style={{ marginTop: "10px" }}>
              <SelectField
                label="放大方法"
                value={params.sdxl.upscaleMethod}
                options={options.upscaleMethods}
                onChange={(value) => setSdxl({ upscaleMethod: value })}
              />
              <NumberField
                label="放大倍率"
                value={params.sdxl.scaleBy}
                step={0.1}
                min={1}
                max={8}
                onChange={(value) => setSdxl({ scaleBy: value })}
              />
              <NumberField
                label="高修步数"
                value={params.sdxl.highresSteps}
                step={1}
                min={1}
                onChange={(value) => setSdxl({ highresSteps: value })}
              />
              <NumberField
                label="高修 CFG"
                value={params.sdxl.highresCfg}
                step={0.1}
                min={0}
                onChange={(value) => setSdxl({ highresCfg: value })}
              />
              <NumberField
                label="高修重绘"
                value={params.sdxl.highresDenoise}
                step={0.01}
                min={0}
                max={1}
                onChange={(value) => setSdxl({ highresDenoise: value })}
              />
              <label className="field checkbox-field">
                <input
                  type="checkbox"
                  checked={params.sdxl.syncHighresSeed ?? true}
                  onChange={(event) => setSdxl({ syncHighresSeed: event.target.checked })}
                />{" "}
                同步高修 seed
              </label>
            </div>
            <div className="detailer-grid">
              {params.sdxl.enableSegsDetailer && (
                <DetailerControls
                  samplers={options.samplers}
                  schedulers={options.schedulers}
                  title="全图修复参数"
                  params={params.sdxl.segsDetailer}
                  onChange={(detailer) => setSdxl({ segsDetailer: detailer })}
                />
              )}
              {params.sdxl.enableHandDetailer && (
                <DetailerControls
                  samplers={options.samplers}
                  schedulers={options.schedulers}
                  title="手部修复参数"
                  detector={params.sdxl.handDetector}
                  detectors={options.detectors}
                  params={params.sdxl.handDetailer}
                  onDetector={(value) => setSdxl({ handDetector: value })}
                  onChange={(detailer) => setSdxl({ handDetailer: detailer })}
                />
              )}
              {params.sdxl.enableFaceDetailer && (
                <DetailerControls
                  samplers={options.samplers}
                  schedulers={options.schedulers}
                  title="脸部修复参数"
                  detector={params.sdxl.faceDetector}
                  detectors={options.detectors}
                  params={params.sdxl.faceDetailer}
                  onDetector={(value) => setSdxl({ faceDetector: value })}
                  onChange={(detailer) => setSdxl({ faceDetailer: detailer })}
                />
              )}
              {params.sdxl.enableEyesDetailer && (
                <DetailerControls
                  samplers={options.samplers}
                  schedulers={options.schedulers}
                  title="眼部修复参数"
                  detector={params.sdxl.eyesDetector}
                  detectors={options.detectors}
                  params={params.sdxl.eyesDetailer}
                  onDetector={(value) => setSdxl({ eyesDetector: value })}
                  onChange={(detailer) => setSdxl({ eyesDetailer: detailer })}
                />
              )}
              {params.sdxl.enableNsfwDetailer && (
                <DetailerControls
                  samplers={options.samplers}
                  schedulers={options.schedulers}
                  title="NSFW修复参数"
                  detector={params.sdxl.nsfwDetector}
                  detectors={options.detectors}
                  params={params.sdxl.nsfwDetailer}
                  onDetector={(value) => setSdxl({ nsfwDetector: value })}
                  onChange={(detailer) => setSdxl({ nsfwDetailer: detailer })}
                />
              )}
            </div>
            <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "8px" }}>
              开启任一项后本页改用「高清修复」工作流：基础采样 → 放大（可选）→ 全图 / 手 / 脸 / 眼修复 → 输出；
              全关时仍是纯文生图（与之前逐节点一致）。放大后尺寸 = 宽高 × 倍率，注意显存。
            </div>
          </details>
        )}
      </div>

      <div className="panel-footer" style={{ display: "flex", gap: "8px" }}>
        <button className="primary-action" style={{ flex: 1 }} type="button" onClick={onRunGeneration}>
          <Sparkles size={18} />
          开始生成
        </button>
        <button
          type="button"
          onClick={() => onSetSimpleLoraTarget("sheet")}
          title="叠加其它 LoRA（风格 / 角色 / 细节）"
          className="secondary-action"
        >
          <Plus size={16} /> 添加 LoRA
        </button>
      </div>
    </section>
  );
});

/** 统计逗号分隔的词条数（预览里的「N 个词条」） */
function splitTagCount(text: string): number {
  return text
    .split(/[,，\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean).length;
}
