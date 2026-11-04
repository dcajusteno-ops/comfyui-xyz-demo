import React from "react";
import { AlertTriangle, Download, FileJson, Images, Play, RefreshCw, RotateCcw, Square } from "lucide-react";
import { BaseControls, NumberField, PanelTitle, SelectField, TextAreaField, TextField } from "../../ui";
import { sheetSubjectOptions } from "../../../constants";
import { DATASET_AXIS_ORDER } from "../../../lib/dataset/pools";
import { buildDatasetSignature } from "../../../lib/dataset/signature";
import type { DatasetStartMode } from "../../../hooks/useDatasetRun";
import type {
  AnimaGenerationParams,
  DatasetAxisConfig,
  DatasetAxisKey,
  DatasetConfig,
  DatasetFile,
  DatasetItem,
  HighresParams,
  LoraExampleMedia,
  LoraInsertTarget,
  LoraItem,
  LoraManagerSettings,
  OptionsState,
  Toast,
} from "../../../types";
import { DatasetAxisEditor } from "./DatasetAxisEditor";
import { DatasetIdentityBlock } from "./DatasetIdentityBlock";
import { DatasetPlanTable } from "./DatasetPlanTable";
import { DatasetResultGrid } from "./DatasetResultGrid";

type PushToast = (type: Toast["type"], title: string, message?: string) => void;

export type DatasetPanelProps = {
  params: DatasetConfig;
  setParams: (updater: DatasetConfig | ((prev: DatasetConfig) => DatasetConfig)) => void;
  options: OptionsState;
  apiBase: string;
  loraSettings: LoraManagerSettings;
  loraExampleFilesByHash: Record<string, LoraExampleMedia[]>;
  loraNames?: string[];
  wildcardNames?: string[];
  items: DatasetItem[];
  /** 计划是用哪个模型族排的：与当前模式不同则提示重新规划 */
  planMode: DatasetConfig["mode"];
  /** 计划的配置签名（空串 = 旧存档，不做过期提示） */
  planSignature: string;
  running: boolean;
  current: number;
  onStart: (mode: DatasetStartMode) => void;
  onStop: () => void;
  onRetryFailed: () => void;
  onRerunOne: (id: string) => void;
  onRegeneratePlan: () => void;
  onRecover: () => void;
  onExportCaptions: () => void;
  onExportManifest: () => void;
  onUploadImage: (file: File) => Promise<string>;
  onOpenLoraDetail: (item: LoraItem) => void;
  onSetSimpleLoraTarget: (target: LoraInsertTarget) => void;
  onOpenImage: (url: string) => void;
  resolveImageUrl: (file: DatasetFile) => string;
  confirm: (title: string, message: string, onConfirm: () => void) => void;
  pushToast: PushToast;
};

/**
 * 角色 LoRA 训练数据集工作台。
 *
 * 与三视图同构：不拥有 TemplateKind、不新造工作流，只把「角色固定词 + 本张变化词」
 * 拼好后交给既有 builder；区别是它一次排 100 条、顺序出图、每条配 caption。
 */
export const DatasetPanel = React.memo(function DatasetPanel({
  params,
  setParams,
  options,
  apiBase,
  loraSettings,
  loraExampleFilesByHash,
  loraNames,
  wildcardNames,
  items,
  planMode,
  planSignature,
  running,
  current,
  onStart,
  onStop,
  onRetryFailed,
  onRerunOne,
  onRegeneratePlan,
  onRecover,
  onExportCaptions,
  onExportManifest,
  onUploadImage,
  onOpenLoraDetail,
  onSetSimpleLoraTarget,
  onOpenImage,
  resolveImageUrl,
  confirm,
  pushToast,
}: DatasetPanelProps) {
  const mode = params.mode;
  const successCount = items.filter((item) => item.status === "success").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const interruptedCount = items.filter((item) => item.status === "interrupted").length;
  const pendingCount = items.filter(
    (item) => item.status === "queued" || item.status === "interrupted" || item.status === "cancelled",
  ).length;

  const currentSignature = React.useMemo(() => buildDatasetSignature(params), [params]);
  // 空签名 = 旧存档（升级前排的计划），不提示，避免一进页面就红一片
  const planStale = Boolean(planSignature) && planSignature !== currentSignature && items.length > 0;
  /** 「> Save Text」可用才能边出图边写同名 .txt（探测在 useOptions 里做一次） */
  const saveTextAvailable = options.datasetCaps?.saveText === true;

  const activeLoras = (params[mode].loras ?? []).filter((lora) => lora.active && lora.name);
  const anchored = activeLoras.length > 0 || (params.reference.enabled && Boolean(params.reference.imageName));
  const modelName = mode === "anima" ? params.anima.modelStack.unetName : params.sdxl.checkpoint;
  const modelPool = mode === "anima" ? options.unets : options.checkpoints;
  const modelMissing = !modelName;
  const modelStale = Boolean(modelName) && modelPool.length > 0 && !modelPool.includes(modelName);

  const patchAxes = (axis: DatasetAxisKey, patch: Partial<DatasetAxisConfig>) =>
    setParams((prev) => ({ ...prev, axes: { ...prev.axes, [axis]: { ...prev.axes[axis], ...patch } } }));

  const requestStart = (startMode: DatasetStartMode) => {
    if (modelMissing) {
      pushToast("error", "还没有选择模型", "先在「模型与采样」里选好模型再开始，否则每一条都会提交失败");
      return;
    }
    if (!anchored) {
      confirm(
        "未配置角色锚点",
        "数据集里没有角色 LoRA，也没开参考图。100 张会画出 100 个不同的人，训练出来的 LoRA 学不到具体角色。仍要继续？",
        () => onStart(startMode),
      );
      return;
    }
    onStart(startMode);
  };

  const setAnima = (
    updater: AnimaGenerationParams | ((prev: AnimaGenerationParams) => AnimaGenerationParams),
  ) =>
    setParams((prev) => ({
      ...prev,
      anima: typeof updater === "function" ? updater(prev.anima) : updater,
    }));

  const setSdxl = (updater: HighresParams | ((prev: HighresParams) => HighresParams)) =>
    setParams((prev) => ({
      ...prev,
      sdxl: typeof updater === "function" ? updater(prev.sdxl) : updater,
    }));

  const animaModelSlot = (
    <>
      <SelectField
        label="UNet 模型"
        value={params.anima.modelStack.unetName}
        options={options.unets}
        onChange={(value) =>
          setParams((prev) => ({
            ...prev,
            anima: { ...prev.anima, modelStack: { ...prev.anima.modelStack, unetName: value } },
          }))
        }
      />
      <SelectField
        label="CLIP 模型"
        value={params.anima.modelStack.clipName}
        options={options.clips}
        onChange={(value) =>
          setParams((prev) => ({
            ...prev,
            anima: { ...prev.anima, modelStack: { ...prev.anima.modelStack, clipName: value } },
          }))
        }
      />
      <SelectField
        label="CLIP 类型"
        value={params.anima.modelStack.clipType}
        options={options.clipTypes}
        onChange={(value) =>
          setParams((prev) => ({
            ...prev,
            anima: { ...prev.anima, modelStack: { ...prev.anima.modelStack, clipType: value } },
          }))
        }
      />
      <SelectField
        label="VAE"
        value={params.anima.modelStack.vaeName}
        options={options.vaes}
        onChange={(value) =>
          setParams((prev) => ({
            ...prev,
            anima: { ...prev.anima, modelStack: { ...prev.anima.modelStack, vaeName: value } },
          }))
        }
      />
    </>
  );

  return (
    <section className="panel ds-panel">
      <div className="panel-header ds-header">
        <PanelTitle icon={Images} title="数据集工作台" />
        <div className="ds-segmented" role="group" aria-label="模型族">
          <button
            type="button"
            className={mode === "anima" ? "active" : ""}
            disabled={running}
            onClick={() => setParams((prev) => ({ ...prev, mode: "anima" }))}
          >
            Anima
          </button>
          <button
            type="button"
            className={mode === "sdxl" ? "active" : ""}
            disabled={running}
            onClick={() => setParams((prev) => ({ ...prev, mode: "sdxl" }))}
          >
            SDXL
          </button>
        </div>
        <span className="ds-hint">
          成功 {successCount}/{items.length}
          {failedCount ? ` · 失败 ${failedCount}` : ""}
        </span>
        {running && (
          <span className="ds-running">
            生成中 {current}/{items.length}
          </span>
        )}
        {planMode !== mode && items.length > 0 && (
          <span className="ds-warn">计划属于 {planMode === "anima" ? "Anima" : "SDXL"}，切换模型族后请重新规划</span>
        )}
        {modelMissing && <span className="ds-warn">未选择{mode === "anima" ? " UNet " : "大"}模型</span>}
        {!modelMissing && modelStale && <span className="ds-warn">模型不在当前列表，可能已被移动</span>}
      </div>

      <div className="ds-toolbar">
        <NumberField
          label="目标张数"
          value={params.targetCount}
          min={4}
          max={300}
          disabled={running}
          onChange={(value) => setParams((prev) => ({ ...prev, targetCount: value }))}
        />
        <button type="button" className="ghost-btn" disabled={running} onClick={onRegeneratePlan}>
          <RefreshCw size={14} /> 重新规划
        </button>
        <button
          type="button"
          className="primary-action"
          disabled={running || (items.length > 0 && pendingCount === 0)}
          onClick={() => requestStart("pending")}
        >
          <Play size={14} /> {successCount > 0 ? `继续生成（剩 ${pendingCount}）` : "开始生成"}
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={running || (items.length > 0 && pendingCount === 0)}
          onClick={() => requestStart("preview")}
        >
          试跑 3 张
        </button>
        <button type="button" className="ghost-btn" disabled={running || failedCount === 0} onClick={onRetryFailed}>
          重试失败{failedCount ? `（${failedCount}）` : ""}
        </button>
        <button type="button" className="ghost-btn" disabled={!running} onClick={onStop}>
          <Square size={14} /> 停止
        </button>
        {interruptedCount > 0 && (
          <button type="button" className="ghost-btn" disabled={running} onClick={onRecover}>
            <RotateCcw size={14} /> 补齐未完成（{interruptedCount}）
          </button>
        )}
        <span className="ds-spacer" />
        <button type="button" className="ghost-btn" disabled={successCount === 0} onClick={onExportCaptions}>
          <Download size={14} /> caption 清单
        </button>
        <button type="button" className="ghost-btn" disabled={items.length === 0} onClick={onExportManifest}>
          <FileJson size={14} /> manifest
        </button>
      </div>

      <div className="ds-body">
        <div className="ds-side">
          <section className="ds-card">
            <header className="ds-card-head">
              <h3>角色与画风</h3>
            </header>
            <div className="form-grid">
              <label className="field">
                <span>主体词</span>
                <select
                  value={params.subject}
                  disabled={running}
                  onChange={(event) =>
                    setParams((prev) => ({ ...prev, subject: event.target.value as DatasetConfig["subject"] }))
                  }
                >
                  {sheetSubjectOptions.map((option) => (
                    <option key={option.value || "none"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <TextAreaField
              label="角色描述"
              value={params.characterPrompt}
              placeholder="每条都带：发色 / 瞳色 / 发型 / 体型 / 标志性特征"
              onChange={(value) => setParams((prev) => ({ ...prev, characterPrompt: value }))}
            />
            <TextAreaField
              label="画风附加词"
              value={params.style[mode]}
              placeholder="画质与风格词（只进正向提示词，不会写进 caption）"
              onChange={(value) =>
                setParams((prev) => ({ ...prev, style: { ...prev.style, [mode]: value } }))
              }
            />
          </section>

          <DatasetIdentityBlock
            params={params}
            setParams={setParams}
            disabled={running}
            onSetSimpleLoraTarget={() => onSetSimpleLoraTarget("dataset")}
            onUploadImage={onUploadImage}
            pushToast={pushToast}
          />

          <section className="ds-card">
            <header className="ds-card-head">
              <h3>模型与采样</h3>
              <span className="ds-hint">数据集固定单张/条，批次与种子由计划接管</span>
            </header>
            {mode === "anima" ? (
              <BaseControls<AnimaGenerationParams>
                params={params.anima}
                options={options}
                setParams={setAnima}
                modelSlot={animaModelSlot}
                hidePositive
                apiBase={apiBase}
                settings={loraSettings}
                localExampleFilesByHash={loraExampleFilesByHash}
                loraNames={loraNames}
                wildcardNames={wildcardNames}
                onLoraDetail={onOpenLoraDetail}
              />
            ) : (
              <BaseControls<HighresParams>
                params={params.sdxl}
                options={options}
                setParams={setSdxl}
                hidePositive
                apiBase={apiBase}
                settings={loraSettings}
                localExampleFilesByHash={loraExampleFilesByHash}
                loraNames={loraNames}
                wildcardNames={wildcardNames}
                onLoraDetail={onOpenLoraDetail}
              />
            )}
          </section>

          <section className="ds-card">
            <header className="ds-card-head">
              <h3>落盘与 caption</h3>
            </header>
            <TextField
              label="落盘子目录"
              value={params.filenameRoot}
              placeholder="Datasets/角色名"
              disabled={running}
              onChange={(value) => setParams((prev) => ({ ...prev, filenameRoot: value }))}
            />
            <p className="ds-hint">
              实际文件：<code>{params.filenameRoot || "(根目录)"}/001_00001_.png</code>（序号由本页给出，计数器由 ComfyUI 追加）
            </p>
            <label className="ds-inline">
              <input
                type="checkbox"
                checked={params.caption.includeTrigger}
                disabled={running}
                onChange={(event) =>
                  setParams((prev) => ({ ...prev, caption: { ...prev.caption, includeTrigger: event.target.checked } }))
                }
              />
              caption 带触发词
            </label>
            <label className="ds-inline">
              <input
                type="checkbox"
                checked={params.caption.includeCharacter}
                disabled={running}
                onChange={(event) =>
                  setParams((prev) => ({ ...prev, caption: { ...prev.caption, includeCharacter: event.target.checked } }))
                }
              />
              caption 带角色固定词
            </label>
            <p className="ds-hint">画风/画质词永不进 caption（会被 LoRA 学成条件）。</p>

            <div className="ds-divider" />
            <label className="ds-inline">
              <input
                type="checkbox"
                checked={params.caption.saveTxt !== false}
                disabled={running || !saveTextAvailable}
                onChange={(event) =>
                  setParams((prev) => ({ ...prev, caption: { ...prev.caption, saveTxt: event.target.checked } }))
                }
              />
              同时保存 .txt（与图片同目录同名）
            </label>
            <label className="field">
              <span>.txt 内容</span>
              <select
                value={params.caption.saveTxtMode ?? "caption"}
                disabled={running || !saveTextAvailable || params.caption.saveTxt === false}
                onChange={(event) =>
                  setParams((prev) => ({
                    ...prev,
                    caption: { ...prev.caption, saveTxtMode: event.target.value === "prompt" ? "prompt" : "caption" },
                  }))
                }
              >
                <option value="caption">训练用 caption（触发词 + 变化词）</option>
                <option value="prompt">完整正向提示词</option>
              </select>
            </label>
            {saveTextAvailable ? (
              <p className="ds-hint">
                图片旁会多一份同名 txt：<code>001_00001_.png</code> + <code>001_00001_.txt</code>（出图后单独提交一个写文件任务，不改图片工作流）。
              </p>
            ) : (
              <p className="ds-hint ds-warn">
                当前 ComfyUI 没有「&gt; Save Text」节点（ComfyUI_yanc），无法自动写 txt；装好后重开本页即可。
              </p>
            )}

            {items[0] && (
              <details className="ds-preview">
                <summary>第 1 条预览</summary>
                <p>
                  <strong>prompt</strong>：{items[0].prompt}
                </p>
                <p>
                  <strong>caption</strong>：{items[0].caption}
                </p>
              </details>
            )}
          </section>
        </div>

        <div className="ds-main">
          {planStale && (
            <div className="ds-stale">
              <AlertTriangle size={15} />
              <span>
                角色 / LoRA / 触发词 / 轴 / caption 已改动，已排好的提示词还是旧的（尤其「加了 LoRA 但 prompt 里没有触发词」）。
              </span>
              <button type="button" className="ghost-btn" disabled={running} onClick={onRegeneratePlan}>
                <RefreshCw size={14} /> 重新规划
              </button>
            </div>
          )}
          <DatasetAxisEditor axes={params.axes} disabled={running} onChange={patchAxes} />
          <DatasetPlanTable
            items={items}
            disabled={running}
            onRerunOne={onRerunOne}
            onCopyCaption={(item) => {
              void navigator.clipboard
                ?.writeText(item.caption)
                .then(() => pushToast("success", "已复制 caption"))
                .catch(() => pushToast("error", "复制失败", "浏览器拒绝了剪贴板访问"));
            }}
          />
          <DatasetResultGrid
            items={items}
            resolveImageUrl={resolveImageUrl}
            onOpenImage={onOpenImage}
            onCopyCaption={(item) => {
              void navigator.clipboard
                ?.writeText(item.caption)
                .then(() => pushToast("success", "已复制 caption"))
                .catch(() => pushToast("error", "复制失败", "浏览器拒绝了剪贴板访问"));
            }}
          />
          <p className="ds-hint">
            启用 {DATASET_AXIS_ORDER.filter((axis) => params.axes[axis]?.enabled).length} 个变化轴 ·
            计划内指纹去重 · 相同自动种子可复现
          </p>
        </div>
      </div>
    </section>
  );
});
