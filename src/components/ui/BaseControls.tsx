import { useState } from "react";
import { RefreshCw, Braces } from "lucide-react";
import { NumberField, SelectField, TextAreaField } from "./FormFields";
import { PromptTagBlocks } from "../PromptTagBlocks";
import { PromptLintBadge } from "./PromptLintBadge";
import { LoraChips } from "../features/Lora/LoraChips";
import { WildcardHelper } from "../features/Generation/WildcardHelper";
import { detectDynamicSyntax } from "../../lib/dynamicPrompt";
import type { PromptLintContext } from "../../lib/promptLint";
import {
  resolutionPresets,
  pathPresets,
  findResolutionPreset,
  findPathPreset,
} from "../../lib/presets";
import type {
  BaseGenerationParams,
  OptionsState,
  LoraSelection,
  LoraItem,
  LoraManagerSettings,
  LoraExampleMedia,
} from "../../types";

export function BaseControls<T extends BaseGenerationParams>({
  params,
  options,
  setParams,
  hidePositive = false,
  disableStickyPrompt = false,
  onLoraDetail,
  apiBase,
  settings,
  localExampleFilesByHash = {},
  loraNames,
  wildcardNames,
}: {
  params: T;
  options: OptionsState;
  setParams: (updater: T | ((prev: T) => T)) => void;
  hidePositive?: boolean;
  disableStickyPrompt?: boolean;
  onLoraDetail?: (item: LoraItem) => void;
  apiBase: string;
  settings: LoraManagerSettings;
  localExampleFilesByHash?: Record<string, LoraExampleMedia[]>;
  loraNames?: string[];
  wildcardNames?: string[];
}) {
  const setField = <K extends keyof T>(key: K, value: T[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const lintContext: PromptLintContext = { loraNames, wildcardNames };

  const [showWildcards, setShowWildcards] = useState(false);
  const positiveSyntax = detectDynamicSyntax(params.positivePrompt);
  const positiveSyntaxCount = positiveSyntax.choices + positiveSyntax.wildcards;

  const appendToPositive = (text: string) => {
    const current = params.positivePrompt?.trim() ?? "";
    const next = current ? `${current}, ${text}` : text;
    setField("positivePrompt", next as T["positivePrompt"]);
  };

  return (
    <>
      <div className="form-grid three">
        <SelectField
          label="大模型"
          value={params.checkpoint}
          options={options.checkpoints}
          onChange={(value) => setField("checkpoint", value as T["checkpoint"])}
        />
        <label className="field">
          <span>宽高预设</span>
          <select
            value={findResolutionPreset(params.width, params.height)}
            onChange={(event) => {
              const preset = resolutionPresets.find((item) => item.label === event.target.value);
              if (preset) {
                setParams((prev) => ({ ...prev, width: preset.width, height: preset.height }));
              }
            }}
          >
            {resolutionPresets.map((preset) => (
              <option key={preset.label} value={preset.label}>
                {preset.label}
              </option>
            ))}
            <option value="custom">自定义</option>
          </select>
        </label>
        <NumberField
          label="宽"
          value={params.width}
          min={16}
          step={8}
          onChange={(value) => setField("width", value as T["width"])}
        />
        <NumberField
          label="高"
          value={params.height}
          min={16}
          step={8}
          onChange={(value) => setField("height", value as T["height"])}
        />
        <label className="field swap-field">
          <span>宽高</span>
          <button
            type="button"
            className="icon-button"
            onClick={() => setParams((prev) => ({ ...prev, width: prev.height, height: prev.width }))}
            title="翻转宽高"
          >
            <RefreshCw size={16} />
            翻转宽高
          </button>
        </label>
        <NumberField
          label="批量"
          value={params.batchSize}
          min={1}
          step={1}
          onChange={(value) => setField("batchSize", value as T["batchSize"])}
        />
        <NumberField
          label={params.randomizeSeed ? "Seed（随机生成）" : "Seed"}
          value={params.seed}
          min={0}
          step={1}
          disabled={params.randomizeSeed}
          onChange={(value) => setField("seed", value as T["seed"])}
        />
        <label className="field checkbox-field">
          <input
            type="checkbox"
            checked={params.randomizeSeed}
            onChange={(event) => setField("randomizeSeed", event.target.checked as T["randomizeSeed"])}
          />{" "}
          随机 seed
        </label>
        <NumberField
          label="Steps"
          value={params.steps}
          min={1}
          step={1}
          onChange={(value) => setField("steps", value as T["steps"])}
        />
        <NumberField
          label="CFG"
          value={params.cfg}
          min={0}
          step={0.1}
          onChange={(value) => setField("cfg", value as T["cfg"])}
        />
        <NumberField
          label="重绘"
          value={params.denoise}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => setField("denoise", value as T["denoise"])}
        />
        <SelectField
          label="采样器"
          value={params.samplerName}
          options={options.samplers}
          onChange={(value) => setField("samplerName", value as T["samplerName"])}
        />
        <SelectField
          label="调度器"
          value={params.scheduler}
          options={options.schedulers}
          onChange={(value) => setField("scheduler", value as T["scheduler"])}
        />
        <label className="field">
          <span>保存路径预设</span>
          <select
            value={findPathPreset(params.filenamePrefix)}
            onChange={(event) => {
              if (event.target.value !== "custom") {
                setField("filenamePrefix", event.target.value as T["filenamePrefix"]);
              }
            }}
          >
            {pathPresets.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
            <option value="custom">自定义</option>
          </select>
        </label>
        <label className="field">
          <span>保存前缀</span>
          <input
            value={params.filenamePrefix}
            onChange={(event) => setField("filenamePrefix", event.target.value as T["filenamePrefix"])}
          />
        </label>
      </div>
      {!hidePositive && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
          <button type="button" className="secondary-action" onClick={() => setShowWildcards(true)} title="动态提示词 / 通配符">
            <Braces size={14} /> 通配符
          </button>
          {positiveSyntaxCount > 0 && (
            <span
              style={{
                fontSize: "11px",
                color: "var(--accent)",
                background: "var(--accent-soft)",
                borderRadius: 999,
                padding: "2px 10px",
              }}
            >
              含 {positiveSyntaxCount} 处动态语法
            </span>
          )}
        </div>
      )}
      {disableStickyPrompt ? (
        <>
          {!hidePositive && (
            <div className="form-grid two prompt-grid">
              <TextAreaField
                label="正向提示词"
                value={params.positivePrompt}
                onChange={(value) => setField("positivePrompt", value as T["positivePrompt"])}
              />
              <TextAreaField
                label="反向提示词"
                value={params.negativePrompt}
                onChange={(value) => setField("negativePrompt", value as T["negativePrompt"])}
              />
            </div>
          )}
          {hidePositive && (
            <>
              <TextAreaField
                label="反向提示词"
                value={params.negativePrompt}
                onChange={(value) => setField("negativePrompt", value as T["negativePrompt"])}
              />
              <PromptLintBadge
                value={params.negativePrompt}
                onChange={(value) => setField("negativePrompt", value as T["negativePrompt"])}
                context={lintContext}
              />
            </>
          )}
        </>
      ) : (
        <>
          <div className="prompt-sticky-container">
            {!hidePositive && (
              <div className="form-grid two prompt-grid">
                <TextAreaField
                  label="正向提示词"
                  value={params.positivePrompt}
                  onChange={(value) => setField("positivePrompt", value as T["positivePrompt"])}
                  hideChips
                />
                <TextAreaField
                  label="反向提示词"
                  value={params.negativePrompt}
                  onChange={(value) => setField("negativePrompt", value as T["negativePrompt"])}
                  hideChips
                />
              </div>
            )}
            {hidePositive && (
              <TextAreaField
                label="反向提示词"
                value={params.negativePrompt}
                onChange={(value) => setField("negativePrompt", value as T["negativePrompt"])}
                hideChips
              />
            )}
          </div>
          <div
            className={hidePositive ? "form-grid prompt-grid" : "form-grid two prompt-grid"}
            style={{ marginTop: "0", paddingTop: "0" }}
          >
            {!hidePositive && (
              <div>
                {params.positivePrompt.trim() && (
                  <PromptTagBlocks
                    value={params.positivePrompt}
                    onChange={(value) => setField("positivePrompt", value as T["positivePrompt"])}
                  />
                )}
                <PromptLintBadge
                  value={params.positivePrompt}
                  onChange={(value) => setField("positivePrompt", value as T["positivePrompt"])}
                  context={lintContext}
                />
              </div>
            )}
            <div>
              {params.negativePrompt.trim() && (
                <PromptTagBlocks
                  value={params.negativePrompt}
                  onChange={(value) => setField("negativePrompt", value as T["negativePrompt"])}
                />
              )}
              <PromptLintBadge
                value={params.negativePrompt}
                onChange={(value) => setField("negativePrompt", value as T["negativePrompt"])}
                context={lintContext}
              />
            </div>
          </div>
        </>
      )}
      <LoraChips
        loras={params.loras}
        onChange={(loras) => setField("loras", loras as T["loras"])}
        onDetail={onLoraDetail}
        apiBase={apiBase}
        settings={settings}
        localExampleFilesByHash={localExampleFilesByHash}
      />
      {showWildcards && (
        <WildcardHelper onClose={() => setShowWildcards(false)} onInsert={appendToPositive} />
      )}
    </>
  );
}
