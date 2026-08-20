import { NumberField, SelectField, TextAreaField } from "../../ui/FormFields";
import type { DetailerParams } from "../../../types";

export function DetailerControls({
  title,
  detector,
  detectors,
  params,
  onDetector,
  onChange,
}: {
  title: string;
  detector?: string;
  detectors?: string[];
  params: DetailerParams;
  onDetector?: (detector: string) => void;
  onChange: (params: DetailerParams) => void;
}) {
  const set = <K extends keyof DetailerParams>(key: K, value: DetailerParams[K]) =>
    onChange({ ...params, [key]: value });
  return (
    <div className="sub-panel">
      <h3>{title}</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "12px",
          marginBottom: "14px",
        }}
      >
        {detector !== undefined && detectors !== undefined && onDetector !== undefined && (
          <div style={{ gridColumn: "1 / -1" }}>
            <SelectField label="检测器" value={detector} options={detectors} onChange={onDetector} />
          </div>
        )}
        <NumberField
          label="guide"
          value={params.guideSize}
          step={8}
          min={64}
          onChange={(value) => set("guideSize", value)}
        />
        <NumberField
          label="max"
          value={params.maxSize}
          step={8}
          min={64}
          onChange={(value) => set("maxSize", value)}
        />
        <NumberField
          label="steps"
          value={params.steps}
          step={1}
          min={1}
          onChange={(value) => set("steps", value)}
        />
        <NumberField
          label="cfg"
          value={params.cfg}
          step={0.1}
          min={0}
          onChange={(value) => set("cfg", value)}
        />
        <NumberField
          label="denoise"
          value={params.denoise}
          step={0.01}
          min={0}
          max={1}
          onChange={(value) => set("denoise", value)}
        />
        <NumberField
          label="阈值"
          value={params.bboxThreshold}
          step={0.01}
          min={0}
          max={1}
          onChange={(value) => set("bboxThreshold", value)}
        />
        <NumberField
          label="扩张"
          value={params.bboxDilation}
          step={1}
          onChange={(value) => set("bboxDilation", value)}
        />
        <div style={{ gridColumn: "1 / -1" }}>
          <TextAreaField
            label="独立正向提示词"
            value={params.prompt ?? ""}
            placeholder="留空则继承全局正向提示词，输入空格则完全清空\n支持 Impact Pack 的 [LAB] 等分层语法"
            onChange={(value) => set("prompt", value)}
          />
        </div>
      </div>
    </div>
  );
}
