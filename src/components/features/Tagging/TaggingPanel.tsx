import React, { useState } from "react";
import { ScanSearch, Smartphone } from "lucide-react";
import { PanelTitle, SelectField, NumberField, CopyableTextarea } from "../../ui";
import { CONFIG } from "../../../config";
import type { 
  Wd14Params, 
  ClSingleParams, 
  ClBatchParams, 
  WdBatchParams,
  OptionsState,
  TaggingTabId,
  TemplateKind,
  MobileTask
} from "../../../types";
import { MobileSyncFeed } from "./MobileSyncFeed";
import { MobileConnectDialog } from "./MobileConnectDialog";

interface TaggingPanelProps {
  wd14: Wd14Params;
  setWd14: (params: Wd14Params | ((prev: Wd14Params) => Wd14Params)) => void;
  wdFile: File | null;
  setWdFile: (file: File | null) => void;
  wdTags: string;
  setWdTags: (tags: string) => void;
  wd14Tab: TaggingTabId;
  setWd14Tab: (tab: TaggingTabId) => void;
  clFile: File | null;
  setClFile: (file: File | null) => void;
  clSingleParams: ClSingleParams;
  setClSingleParams: (params: ClSingleParams | ((prev: ClSingleParams) => ClSingleParams)) => void;
  clBatchParams: ClBatchParams;
  setClBatchParams: (params: ClBatchParams | ((prev: ClBatchParams) => ClBatchParams)) => void;
  wdBatchParams: WdBatchParams;
  setWdBatchParams: (params: WdBatchParams | ((prev: WdBatchParams) => WdBatchParams)) => void;
  options: OptionsState;
  onRunWd14: () => void;
  onRunClSingle: () => void;
  onRunBatchTagger: (type: "cl" | "wd") => void;
  /** 把手机识别结果追加到指定工作流正向提示词 */
  onApplyTags: (tags: string, target: TemplateKind) => void;
  /** 手机上传任务列表（全局订阅，由 App 层提供） */
  mobileTasks: MobileTask[];
  onRemoveMobileTask: (id: string) => void;
  onClearMobileTasks: () => void;
}

export const TaggingPanel = React.memo(({
  wd14,
  setWd14,
  wdFile,
  setWdFile,
  wdTags,
  setWdTags,
  wd14Tab,
  setWd14Tab,
  clFile,
  setClFile,
  clSingleParams,
  setClSingleParams,
  clBatchParams,
  setClBatchParams,
  wdBatchParams,
  setWdBatchParams,
  options,
  onRunWd14,
  onRunClSingle,
  onRunBatchTagger,
  onApplyTags,
  mobileTasks,
  onRemoveMobileTask,
  onClearMobileTasks,
}: TaggingPanelProps) => {
  const [showConnect, setShowConnect] = useState(false);
  const mobileCount = mobileTasks.length;

  return (
    <section className="panel">
      <div
        className="panel-header"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <PanelTitle icon={ScanSearch} title="图片识别" />
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button
            className="secondary-action"
            onClick={() => setShowConnect(true)}
            style={{ padding: "4px 10px", height: "28px", fontSize: "12px", display: "flex", alignItems: "center", gap: 4 }}
            title="手机扫码识图"
          >
            <Smartphone size={13} />
            手机连接
          </button>
          {[
            { id: "single", label: "WD 单图" },
            { id: "cl_single", label: "CL 单图" },
            { id: "cl_batch", label: "CL 批量" },
            { id: "wd_batch", label: "WD 批量" },
            { id: "mobile_sync", label: `手机同步${mobileCount > 0 ? ` (${mobileCount})` : ""}` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setWd14Tab(tab.id as TaggingTabId)}
              className={wd14Tab === tab.id ? "primary-action" : "secondary-action"}
              style={{
                padding: "4px 12px",
                height: "28px",
                fontSize: "12px",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {showConnect && <MobileConnectDialog onClose={() => setShowConnect(false)} />}

      {wd14Tab === "mobile_sync" && (
        <MobileSyncFeed
          tasks={mobileTasks}
          onRemove={onRemoveMobileTask}
          onClear={onClearMobileTasks}
          onApplyTags={onApplyTags}
        />
      )}

      {wd14Tab === "single" && (
        <>
          <div className="panel-body">
            <div className="form-grid two">
              <div className="field">
                <span>图片</span>
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.backgroundColor = "var(--accent-soft)";
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.backgroundColor = "transparent";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.backgroundColor = "transparent";
                    const file = e.dataTransfer.files?.[0];
                    if (file && file.type.startsWith("image/")) {
                      setWdFile(file);
                    }
                  }}
                  style={{
                    border: "2px dashed var(--border)",
                    padding: "16px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "column",
                    transition: "all 0.2s",
                    background: "var(--surface-alt)",
                  }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => setWdFile(event.target.files?.[0] ?? null)}
                    style={{ display: "none" }}
                  />
                  {wdFile ? (
                    <div
                      style={{
                        color: "var(--text)",
                        fontSize: "13px",
                        textAlign: "center",
                        wordBreak: "break-all",
                      }}
                    >
                      {wdFile.name}
                    </div>
                  ) : (
                    <div style={{ color: "var(--muted)", fontSize: "13px" }}>
                      点击或拖拽图片到此处
                    </div>
                  )}
                </label>
              </div>
              <SelectField
                label="模型"
                value={wd14.model}
                options={options.wdModels}
                onChange={(value) => setWd14((prev) => ({ ...prev, model: value }))}
              />
              <SelectField
                label="设备"
                value={wd14.device}
                options={options.wdDevices}
                onChange={(value) => setWd14((prev) => ({ ...prev, device: value }))}
              />
              <NumberField
                label="阈值"
                value={wd14.threshold}
                step={0.05}
                min={0}
                max={1}
                onChange={(value) => setWd14((prev) => ({ ...prev, threshold: value }))}
              />
              <NumberField
                label="角色阈值"
                value={wd14.characterThreshold}
                step={0.05}
                min={0}
                max={1}
                onChange={(value) => setWd14((prev) => ({ ...prev, characterThreshold: value }))}
              />
              <label className="field">
                <span>排除 tags</span>
                <input
                  value={wd14.excludeTags}
                  onChange={(event) =>
                    setWd14((prev) => ({ ...prev, excludeTags: event.target.value }))
                  }
                />
              </label>
              <div className="toggle-row">
                <label>
                  <input
                    type="checkbox"
                    checked={wd14.replaceUnderscore}
                    onChange={(event) =>
                      setWd14((prev) => ({ ...prev, replaceUnderscore: event.target.checked }))
                    }
                  />{" "}
                  替换下划线
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={wd14.trailingComma}
                    onChange={(event) =>
                      setWd14((prev) => ({ ...prev, trailingComma: event.target.checked }))
                    }
                  />{" "}
                  末尾逗号
                </label>
              </div>
            </div>
            <CopyableTextarea className="output-text" value={wdTags} />
          </div>
          <div className="panel-footer">
            <button className="primary-action" type="button" onClick={onRunWd14}>
              <ScanSearch size={18} />
              开始单图识别
            </button>
          </div>
        </>
      )}

      {wd14Tab === "cl_single" && (
        <>
          <div className="panel-body">
            <div className="form-grid two">
              <div className="field">
                <span>图片</span>
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.backgroundColor = "var(--accent-soft)";
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.backgroundColor = "transparent";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.backgroundColor = "transparent";
                    const file = e.dataTransfer.files?.[0];
                    if (file && file.type.startsWith("image/")) {
                      setClFile(file);
                    }
                  }}
                  style={{
                    border: "2px dashed var(--border)",
                    padding: "16px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "column",
                    transition: "all 0.2s",
                    background: "var(--surface-alt)",
                  }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => setClFile(event.target.files?.[0] ?? null)}
                    style={{ display: "none" }}
                  />
                  {clFile ? (
                    <div
                      style={{
                        color: "var(--text)",
                        fontSize: "13px",
                        textAlign: "center",
                        wordBreak: "break-all",
                      }}
                    >
                      {clFile.name}
                    </div>
                  ) : (
                    <div style={{ color: "var(--muted)", fontSize: "13px" }}>
                      点击或拖拽图片到此处
                    </div>
                  )}
                </label>
              </div>
              <SelectField
                label="CL 模型"
                value={clSingleParams.modelName}
                options={options.clModels}
                onChange={(value) => setClSingleParams((prev) => ({ ...prev, modelName: value }))}
              />
              <SelectField
                label="设备"
                value={clSingleParams.sessionMethod}
                options={options.wdDevices}
                onChange={(value) =>
                  setClSingleParams((prev) => ({ ...prev, sessionMethod: value }))
                }
              />
              <NumberField
                label="General 阈值"
                value={clSingleParams.general}
                step={0.05}
                min={0}
                max={1}
                onChange={(value) => setClSingleParams((prev) => ({ ...prev, general: value }))}
              />
              <NumberField
                label="Character 阈值"
                value={clSingleParams.character}
                step={0.05}
                min={0}
                max={1}
                onChange={(value) => setClSingleParams((prev) => ({ ...prev, character: value }))}
              />
              <label className="field">
                <span>Categories</span>
                <input
                  value={clSingleParams.categories}
                  onChange={(event) =>
                    setClSingleParams((prev) => ({ ...prev, categories: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>排除 tags</span>
                <input
                  value={clSingleParams.excludeTags}
                  onChange={(event) =>
                    setClSingleParams((prev) => ({ ...prev, excludeTags: event.target.value }))
                  }
                />
              </label>
              <div className="toggle-row">
                <label>
                  <input
                    type="checkbox"
                    checked={clSingleParams.replaceSpace}
                    onChange={(event) =>
                      setClSingleParams((prev) => ({ ...prev, replaceSpace: event.target.checked }))
                    }
                  />{" "}
                  替换空格为下划线
                </label>
              </div>
            </div>
            <CopyableTextarea className="output-text" value={wdTags} />
          </div>
          <div className="panel-footer">
            <button className="primary-action" type="button" onClick={onRunClSingle}>
              <ScanSearch size={18} />
              开始 CL 单图识别
            </button>
          </div>
        </>
      )}

      {wd14Tab === "cl_batch" && (
        <>
          <div className="panel-body">
            <div className="form-grid two">
              <label className="field">
                <span>图片目录</span>
                <input
                  value={clBatchParams.imageFolder}
                  onChange={(e) =>
                    setClBatchParams((prev) => ({ ...prev, imageFolder: e.target.value }))
                  }
                  placeholder={`例如: ${CONFIG.DEFAULT_TAG_IMAGE_FOLDER}`}
                />
              </label>
              <label className="field">
                <span>输出目录</span>
                <input
                  value={clBatchParams.outputFolder}
                  onChange={(e) =>
                    setClBatchParams((prev) => ({ ...prev, outputFolder: e.target.value }))
                  }
                  placeholder="例如: ./ComfyUI-tag/cs"
                />
              </label>
              <label className="field">
                <span>前置提示词</span>
                <input
                  value={clBatchParams.prependText}
                  onChange={(e) =>
                    setClBatchParams((prev) => ({ ...prev, prependText: e.target.value }))
                  }
                  placeholder="打标文本前置追加"
                />
              </label>
              <NumberField
                label="处理数量"
                value={clBatchParams.runCount}
                step={1}
                min={1}
                onChange={(value) => setClBatchParams((prev) => ({ ...prev, runCount: value }))}
              />

              <SelectField
                label="CL 模型"
                value={clBatchParams.modelName}
                options={options.clModels}
                onChange={(value) => setClBatchParams((prev) => ({ ...prev, modelName: value }))}
              />
              <SelectField
                label="设备"
                value={clBatchParams.sessionMethod}
                options={options.wdDevices}
                onChange={(value) =>
                  setClBatchParams((prev) => ({ ...prev, sessionMethod: value }))
                }
              />
              <NumberField
                label="General 阈值"
                value={clBatchParams.general}
                step={0.05}
                min={0}
                max={1}
                onChange={(value) => setClBatchParams((prev) => ({ ...prev, general: value }))}
              />
              <NumberField
                label="Character 阈值"
                value={clBatchParams.character}
                step={0.05}
                min={0}
                max={1}
                onChange={(value) => setClBatchParams((prev) => ({ ...prev, character: value }))}
              />
              <label className="field">
                <span>Categories</span>
                <input
                  value={clBatchParams.categories}
                  onChange={(e) =>
                    setClBatchParams((prev) => ({ ...prev, categories: e.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>排除 tags</span>
                <input
                  value={clBatchParams.excludeTags}
                  onChange={(e) =>
                    setClBatchParams((prev) => ({ ...prev, excludeTags: e.target.value }))
                  }
                />
              </label>
              <div className="toggle-row">
                <label>
                  <input
                    type="checkbox"
                    checked={clBatchParams.replaceSpace}
                    onChange={(event) =>
                      setClBatchParams((prev) => ({ ...prev, replaceSpace: event.target.checked }))
                    }
                  />{" "}
                  替换空格为下划线
                </label>
              </div>
            </div>
          </div>
          <div className="panel-footer">
            <button className="primary-action" type="button" onClick={() => onRunBatchTagger("cl")}>
              <ScanSearch size={18} />
              开始 CL 批量打标
            </button>
          </div>
        </>
      )}

      {wd14Tab === "wd_batch" && (
        <>
          <div className="panel-body">
            <div className="form-grid two">
              <label className="field">
                <span>图片目录</span>
                <input
                  value={wdBatchParams.imageFolder}
                  onChange={(e) =>
                    setWdBatchParams((prev) => ({ ...prev, imageFolder: e.target.value }))
                  }
                  placeholder={`例如: ${CONFIG.DEFAULT_TAG_IMAGE_FOLDER}`}
                />
              </label>
              <label className="field">
                <span>输出目录</span>
                <input
                  value={wdBatchParams.outputFolder}
                  onChange={(e) =>
                    setWdBatchParams((prev) => ({ ...prev, outputFolder: e.target.value }))
                  }
                  placeholder="例如: ./ComfyUI-tag/cs"
                />
              </label>
              <label className="field">
                <span>前置提示词</span>
                <input
                  value={wdBatchParams.prependText}
                  onChange={(e) =>
                    setWdBatchParams((prev) => ({ ...prev, prependText: e.target.value }))
                  }
                  placeholder="打标文本前置追加"
                />
              </label>
              <NumberField
                label="处理数量"
                value={wdBatchParams.runCount}
                step={1}
                min={1}
                onChange={(value) => setWdBatchParams((prev) => ({ ...prev, runCount: value }))}
              />

              <SelectField
                label="WD 模型"
                value={wdBatchParams.model}
                options={options.wdModels}
                onChange={(value) => setWdBatchParams((prev) => ({ ...prev, model: value }))}
              />
              <SelectField
                label="设备"
                value={wdBatchParams.device}
                options={options.wdDevices}
                onChange={(value) => setWdBatchParams((prev) => ({ ...prev, device: value }))}
              />
              <NumberField
                label="阈值"
                value={wdBatchParams.threshold}
                step={0.05}
                min={0}
                max={1}
                onChange={(value) => setWdBatchParams((prev) => ({ ...prev, threshold: value }))}
              />
              <NumberField
                label="角色阈值"
                value={wdBatchParams.characterThreshold}
                step={0.05}
                min={0}
                max={1}
                onChange={(value) =>
                  setWdBatchParams((prev) => ({ ...prev, characterThreshold: value }))
                }
              />
              <label className="field">
                <span>排除 tags</span>
                <input
                  value={wdBatchParams.excludeTags}
                  onChange={(e) =>
                    setWdBatchParams((prev) => ({ ...prev, excludeTags: e.target.value }))
                  }
                />
              </label>
              <div className="toggle-row">
                <label>
                  <input
                    type="checkbox"
                    checked={wdBatchParams.replaceUnderscore}
                    onChange={(event) =>
                      setWdBatchParams((prev) => ({ ...prev, replaceUnderscore: event.target.checked }))
                    }
                  />{" "}
                  替换下划线
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={wdBatchParams.trailingComma}
                    onChange={(event) =>
                      setWdBatchParams((prev) => ({ ...prev, trailingComma: event.target.checked }))
                    }
                  />{" "}
                  末尾逗号
                </label>
              </div>
            </div>
          </div>
          <div className="panel-footer">
            <button className="primary-action" type="button" onClick={() => onRunBatchTagger("wd")}>
              <ScanSearch size={18} />
              开始 WD 批量打标
            </button>
          </div>
        </>
      )}
    </section>
  );
}
);
