import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONFIG } from "./config";
import DOMPurify from "dompurify";

const EMPTY_ARRAY: any[] = [];
const EMPTY_OBJECT: any = {};
import { useLocalStorageState } from "./hooks/useLocalStorageState";
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent, ReactNode, UIEvent } from "react";
import {
  BadgePlus, Bookmark, Boxes, Brain, ChevronDown, ChevronLeft, ChevronRight, Bold, CheckCircle2,
  CircleHelp, Clock, Copy, Download, Eraser, Eye, EyeOff, FileText, Filter, Film, Folder,
  FolderOpen, GalleryHorizontalEnd, Globe2, Grid3X3, GripVertical, Heading1, Heading2,
  Highlighter, Image as ImageIcon, ImageUp, Info, Italic, Keyboard, Layers, List, ListFilter,
  ListOrdered, Maximize, Maximize2, Minimize, MoreHorizontal, PlayCircle, Plus, PauseCircle,
  Redo, RefreshCw, ScanSearch, Search, Send, Settings, SlidersHorizontal, Sparkles, Star,
  Strikethrough, Tags, Trash2, Type, Underline, Undo, Upload, UserRound, Wand2, X,
  Columns, Loader2, Languages,
} from "lucide-react";
import { cloneMultiCharacterConfig } from "./data/multiTemplate";
import { handlePromptWeightAdjustment } from "./lib/promptUtils";
import { ComfyClient } from "./lib/comfyClient";
import { enabledCanvasCharacters, moveMaskRect, resizeMaskRect, findOverlapRegions, autoBalanceWeights } from "./lib/multiCanvas";
import { ImageGalleryItem } from "./components/ImageGalleryItem";
import { PromptEditorDialog } from "./components/PromptEditorDialog";
import { TranslationToolDialog } from "./components/TranslationToolDialog";
import { PromptTagBlocks } from "./components/PromptTagBlocks";
import { RichTextEditor } from "./components/RichTextEditor";
import { WelcomeModal } from "./components/WelcomeModal";
import { PromptSidebar } from "./components/PromptSidebar";
import { AppSidebar } from "./components/layout/AppSidebar";
import {
  ToastViewport, RunProgressStrip, ExampleImagesProgressBar, ModalFrame, PanelTitle,
  NumberField, TextField, SelectField, MultiSelectField, TextAreaField, CopyableTextarea,
  ColorAlphaField, InfoItem, TagCloud, PromptBlock,
} from "./components/ui";
import { translateText, defaultTranslationSettings } from "./lib/translation";
import type { TranslationSettings, TranslationProvider } from "./lib/translation";
import type { MaskHandle } from "./lib/multiCanvas";
import { addCharacter, duplicateCharacter, removeCharacter } from "./lib/multiCharacters";
import { findPathPreset, findResolutionPreset, pathPresets, resolutionPresets } from "./lib/presets";
import {
  buildDefaultPrompt, buildHighresPrompt, buildMultiPrompt, buildWd14Prompt,
  buildClBatchPrompt, buildWdBatchPrompt, buildClSinglePrompt,
} from "./lib/workflowBuilders";
import { applySpecialXyzPatch, buildXyzCombinations, fieldLabel, parseAxisValues } from "./lib/xyz";
import type {
  BaseGenerationParams, ConnectionInfo, ConnectionStatus, DetailerParams, DoctorDiagnostic,
  DownloadProgress, ExampleImagesPendingResult, ExampleImagesStatus, HighresParams, HighresVariant,
  JobResult, LoraDuplicateGroup, LoraExampleMedia, LoraItem, LoraListResult, LoraManagerSettings,
  LoraMediaMeta, LoraMetadata, LoraOperation, LoraQueryState, LoraSelection, LoraUpdateRecord,
  ManagedModelType, MatureBlurLevel, MultiCharacter, MultiGenerationParams, OptionsState,
  ProgressState, TemplateKind, Toast, Wd14Params, XyzAxis, XyzField, OutputImage, NoteItem,
  ClBatchParams, ClSingleParams, WdBatchParams, DrawTextParams, TabId, LoraPreviewMedia, XyzRunItem,
} from "./types";
import { useAppContext } from "./AppContext";
import {
  NSFW_LEVELS, defaultLoraManagerSettings, defaultLoraQuery, emptyLoraResult, fallbackOptions,
  generationTabs, managedModelExampleType, managedModelLabel, tabs, templateLabels, toolTabs, validMatureBlurLevels,
} from "./constants";
import { makeBaseParams, makeDetailerParams, makeHighresParams, makeMultiParams } from "./lib/paramBuilders";
import {
  normalizePreview, mergeLora, readCombo, normalizeLoraManagerSettings, buildFolderTree,
  extractItemTrainedWords, subTypeAbbreviation, baseModelAbbreviation, uniqueStrings, mergeManagedModelItems,
  parseTriggerWordsInput, stripHtml, formatStrength, loraSyntaxName, roundCanvasMask, loraModelId, buildLoraCivitaiUrl, updateRecordModelId,
} from "./lib/lora-helper";
import {
  normalizeMatureBlurLevel, getMatureBlurThreshold, normalizeNsfwLevel, getItemNsfwLevel,
  getMediaNsfwLevel, shouldBlurNsfwLevel, getNSFWLevelName, getNsfwWarningText,
} from "./lib/nsfw";
import {
  buildLoraExamples, mergeRemoteWithLocalExample, pickCardPreviewMedia, normalizeLocalExample,
  findMatchingLocalExample, dedupeLocalExamples, pickPreferredLocalExample, localExampleKey,
  localExampleName, localExampleSource, localExampleExtension, localExampleScore, isLoraVideo, isVideoPath,
} from "./lib/lora-media";
import { formatBytes, downloadTextFile } from "./lib/file-helper";
import { hexToRgba } from "./lib/color-helper";
import { initialTabFromUrl, operationTitle, xyzStatusLabel } from "./lib/app-utils";
import { useToast } from "./hooks/useToast";
import { useNotes } from "./hooks/useNotes";
import { useLoras } from "./hooks/useLoras";
import { useExampleImages } from "./hooks/useExampleImages";
import { useGeneration } from "./hooks/useGeneration";
import { useOptions } from "./hooks/useOptions";
import { useUiState } from "./hooks/useUiState";
import { NotesPanel } from "./components/features/Notes/NotesPanel";
import { TaggerPanel } from "./components/features/Tagger/TaggerPanel";
import { LoraMedia, LoraCard, FolderSidebar } from "./components/features/Lora";

// ======= Inline Components (kept for now, can be extracted incrementally) =======

function XyzHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalFrame title="XYZ 控制器使用说明" onClose={onClose}>
      <div style={{ padding: 24, maxWidth: 520 }}>
        <p>XYZ 控制器用于批量测试不同参数组合的效果。</p>
        <ul>
          <li>启用轴：勾选要测试的参数</li>
          <li>填写值：支持逗号分隔或范围语法（如 20..30..10）</li>
          <li>目标模板：选择要测试的模板（默认/多人/高清修复）</li>
        </ul>
        <button className="primary-action" onClick={onClose}>关闭</button>
      </div>
    </ModalFrame>
  );
}

function FeatureModal({ modal, onClose }: { modal: { title: string; body: string }; onClose: () => void }) {
  return (
    <ModalFrame title={modal.title} onClose={onClose}>
      <div style={{ padding: 24, maxWidth: 520 }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(modal.body) }} />
    </ModalFrame>
  );
}

// ======= Main App Component =======

function App() {
  const { apiBase, setApiBase, client, connection, tab, setTab } = useAppContext();

  // ===== Hooks =====
  const { toasts, notificationLog, pushToast, removeToast } = useToast();
  const { notes, activeNoteId, notesSaving, notesSearch, isNotesWide, setNotesSearch, setIsNotesWide, setActiveNoteId, saveNotes, handleAddNote, handleDeleteNote, updateActiveNote } = useNotes({ tab, pushToast, confirm });
  const loras = useLoras({ client, pushToast });
  const { loraExampleFilesByHash, exampleStatus, examplePending, pullingExampleHashes, refreshExampleImageInfo, startExampleStatusPolling, stopExampleStatusPolling, pullAllLoraExamples, pullLoraExamples, openLoraExampleFolder, pauseExampleDownloads, resumeExampleDownloads, stopExampleDownloads } = useExampleImages({ client, pushToast, managedModelType: loras.managedModelType, refreshLoras: loras.refreshLoras, tab, defaultParams: EMPTY_OBJECT as any, multiParams: EMPTY_OBJECT as any, highresParams: EMPTY_OBJECT as any });
  const gen = useGeneration({ client, pushToast });
  const { options, loraSettings, setLoraSettings, needsOnboarding } = useOptions({
    client, pushToast, setDefaultParams: () => {}, setMultiParams: () => {}, setHighresParams: () => {},
    setWd14: () => {}, setWdBatchParams: () => {}, setClBatchParams: () => {}
  });
  const ui = useUiState();

  function confirm(title: string, message: string, onConfirm: () => void) {
    ui.setConfirmDialog({ title, message, onConfirm });
  }

  // ===== State (remaining params not in hooks yet) =====
  const [defaultParams, setDefaultParams] = useLocalStorageState<BaseGenerationParams>("comfyui_default_params", makeBaseParams());
  const [multiParams, setMultiParams] = useLocalStorageState<MultiGenerationParams>("comfyui_multi_params", makeMultiParams());
  const [highresParams, setHighresParams] = useLocalStorageState<HighresParams>("comfyui_highres_params", makeHighresParams());
  const [wd14, setWd14] = useLocalStorageState<Wd14Params>("comfyui_wd14_params", { imageName: "", model: "wd-v1-4-moat-tagger-v2", threshold: 0.35, characterThreshold: 0.85, replaceUnderscore: true, trailingComma: true, excludeTags: "", device: "GPU" });
  const [wdFile, setWdFile] = useState<File | null>(null);
  const [wdTags, setWdTags] = useLocalStorageState("comfyui_wd_tags", "");
  const [wd14Tab, setWd14Tab] = useLocalStorageState<"single" | "cl_single" | "cl_batch" | "wd_batch">("comfyui_wd14_tab", "single");
  const [clFile, setClFile] = useState<File | null>(null);
  const [clSingleParams, setClSingleParams] = useLocalStorageState<ClSingleParams>("comfyui_cl_single_params", { imageName: "", modelName: "cl_tagger/cl_tagger_1_02.onnx", general: 0.55, character: 0.6, replaceSpace: true, categories: "rating,artist,general,character,copyright,meta,model,quality", excludeTags: "", sessionMethod: "GPU" });
  const [clBatchParams, setClBatchParams] = useLocalStorageState<ClBatchParams>("comfyui_cl_batch_params", { imageFolder: CONFIG.DEFAULT_TAG_IMAGE_FOLDER, outputFolder: CONFIG.DEFAULT_TAG_OUTPUT_FOLDER, prependText: "cs", runCount: 20, modelName: "cl_tagger/cl_tagger_1_02.onnx", general: 0.55, character: 0.6, replaceSpace: true, categories: "rating,artist,general,character,copyright,meta,model,quality", excludeTags: "", sessionMethod: "GPU" });
  const [wdBatchParams, setWdBatchParams] = useLocalStorageState<WdBatchParams>("comfyui_wd_batch_params", { imageFolder: CONFIG.DEFAULT_TAG_IMAGE_FOLDER, outputFolder: CONFIG.DEFAULT_TAG_OUTPUT_FOLDER, prependText: "cs", runCount: 20, model: "wd-v1-4-moat-tagger-v2", threshold: 0.35, characterThreshold: 0.85, replaceUnderscore: false, trailingComma: false, excludeTags: "", device: "GPU" });
  const [xyzTarget, setXyzTarget] = useLocalStorageState<TemplateKind>("comfyui_xyz_target", "default");
  const [xyzAxes, setXyzAxes] = useLocalStorageState<XyzAxis[]>("comfyui_xyz_axes", [{ enabled: true, field: "seed", values: "1,2" }, { enabled: false, field: "cfg", values: "5,7" }, { enabled: false, field: "steps", values: "20..30..10" }]);
  const [xyzExcludedIndices, setXyzExcludedIndices] = useState<Set<number>>(new Set());
  const [xyzResults, setXyzResults] = useState<XyzRunItem[]>([]);

  // ===== Derived State =====
  function getXyzLoras() {
    switch (xyzTarget) {
      case "default": return defaultParams.loras;
      case "multi": return multiParams.loras;
      case "highres": return highresParams.loras;
      default: return [];
    }
  }
  const lorasOfTarget = getXyzLoras();

  // ===== Event Handlers =====
  const addLora = useCallback((item: LoraItem, strength = 1, target = loras.loraTarget) => {
    const hash = item.sha256?.toLowerCase();
    const localFiles = hash ? (loraExampleFilesByHash[hash] ?? EMPTY_ARRAY) : EMPTY_ARRAY;
    const previewMedia = pickCardPreviewMedia(item, localFiles);
    const selection: LoraSelection = {
      name: loraSyntaxName(item), displayName: item.model_name, strength, clipStrength: strength, active: true,
      filePath: item.file_path, sha256: item.sha256, previewUrl: previewMedia.path || previewMedia.url || item.preview_url,
    };
    if (target === "multi") { setMultiParams(prev => ({ ...prev, loras: mergeLora(prev.loras, selection) })); }
    else if (target === "highres") { setHighresParams(prev => ({ ...prev, loras: mergeLora(prev.loras, selection) })); }
    else { setDefaultParams(prev => ({ ...prev, loras: mergeLora(prev.loras, selection) })); }
    pushToast("success", "LoRA 已插入", `${selection.name} -> ${templateLabels[target]}`);
  }, [loras.loraTarget, loraExampleFilesByHash]);

  const handleLoraInsert = useCallback((item: LoraItem, target: TemplateKind) => { addLora(item, 1, target); }, [addLora]);

  async function runWd14() {
    gen.setError(""); gen.setActiveTaskLabel("WD1.4");
    try {
      if (!wdFile && !wd14.imageName) { throw new Error("请先选择一张图片"); }
      let imageName = wd14.imageName;
      if (wdFile) { const uploaded = await client.uploadImage(wdFile); imageName = uploaded.name; setWd14(prev => ({ ...prev, imageName })); }
      const result = await client.runPrompt(buildWd14Prompt({ ...wd14, imageName }), gen.setProgress);
      gen.setResults(prev => [result, ...prev].slice(0, 24));
      setWdTags(result.texts.join("\n"));
      pushToast("success", "WD1.4 识别完成", result.texts.length ? "标签已写入输出框" : "任务已完成");
    } catch (runError) { const message = runError instanceof Error ? runError.message : String(runError); gen.setError(message); pushToast("error", "WD1.4 识别失败", message); }
  }

  async function runClSingle() {
    gen.setError(""); gen.setActiveTaskLabel("CL 单图识别");
    try {
      if (!clFile && !clSingleParams.imageName) { throw new Error("请先选择一张图片"); }
      let imageName = clSingleParams.imageName;
      if (clFile) { const uploaded = await client.uploadImage(clFile); imageName = uploaded.name; setClSingleParams(prev => ({ ...prev, imageName })); }
      const result = await client.runPrompt(buildClSinglePrompt({ ...clSingleParams, imageName }), gen.setProgress);
      gen.setResults(prev => [result, ...prev].slice(0, 24));
      setWdTags(result.texts.join("\n"));
      pushToast("success", "CL 单图识别完成", result.texts.length ? "标签已写入输出框" : "任务已完成");
    } catch (runError) { const message = runError instanceof Error ? runError.message : String(runError); gen.setError(message); pushToast("error", "CL 单图识别失败", message); }
  }

  function buildXyzPrompt(combo: Pick<XyzRunItem, "label" | "patch">) {
    if (xyzTarget === "multi") { const patched = applySpecialXyzPatch(multiParams, combo); const promptAppend = combo.patch.positivePrompt; return buildMultiPrompt({ ...patched, globalPrompt: promptAppend ? [multiParams.globalPrompt, promptAppend].filter(Boolean).join("\n") : patched.globalPrompt }); }
    if (xyzTarget === "highres") { return buildHighresPrompt(applySpecialXyzPatch(highresParams, combo)); }
    return buildDefaultPrompt(applySpecialXyzPatch(defaultParams, combo));
  }

  async function runXyzItems(items: XyzRunItem[], reset = false) {
    gen.setError(""); gen.setActiveTaskLabel("XYZ 控制器"); gen.xyzCancelRef.current = false;
    if (reset) { setXyzResults(items); }
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (gen.xyzCancelRef.current) { setXyzResults(prev => prev.map(entry => entry.id === item.id && entry.status === "queued" ? { ...entry, status: "cancelled" } : entry)); continue; }
      const batch = { current: index + 1, total: items.length, itemLabel: item.label };
      gen.setProgress({ running: true, value: index, max: items.length, label: `XYZ ${index + 1}/${items.length}`, batch });
      setXyzResults(prev => prev.map(entry => entry.id === item.id ? { ...entry, status: "running", error: undefined } : entry));
      try {
        const result = await client.runPrompt(buildXyzPrompt(item), prog => gen.setProgress({ ...prog, batch }));
        setXyzResults(prev => prev.map(entry => entry.id === item.id ? { ...entry, status: "success", result } : entry));
        gen.setResults(prev => [result, ...prev].slice(0, 24));
      } catch (runError) { const message = runError instanceof Error ? runError.message : String(runError); setXyzResults(prev => prev.map(entry => entry.id === item.id ? { ...entry, status: "failed", error: message } : entry)); pushToast("error", `XYZ 组合失败：${item.label}`, message); }
    }
    gen.setProgress({ running: false, value: 1, max: 1, label: "XYZ 完成", batch: { current: items.length, total: items.length, itemLabel: "" } });
    pushToast("success", "XYZ 执行结束", `已处理 ${items.length} 个组合`);
  }

  async function runXyz() {
    const combos = buildXyzCombinations(xyzAxes, getXyzLoras(), xyzExcludedIndices);
    if (!combos.length) { pushToast("error", "XYZ 无法运行", "至少需要启用一个轴并填写取值，且不能全部被排除"); return; }
    const items = combos.map(combo => ({ id: crypto.randomUUID(), label: combo.label, patch: combo.patch, status: "queued" as const, comboIndex: combo.originalIndex }));
    await runXyzItems(items, true);
  }

  function stopXyzQueue() { gen.xyzCancelRef.current = true; client.interrupt(gen.progress.promptId).catch(() => undefined); gen.setProgress(prev => ({ ...prev, running: false, label: "XYZ 已中断" })); pushToast("info", "XYZ 队列已请求中断"); }
  async function rerunXyzItem(item: XyzRunItem) { await runXyzItems([{ ...item, id: crypto.randomUUID(), status: "queued", result: undefined, error: undefined }], true); }
  async function retryFailedXyz() {
    const failed = xyzResults.filter(item => item.status === "failed");
    if (!failed.length) { pushToast("info", "没有失败组合", "当前 XYZ 结果里没有需要重试的组合"); return; }
    const items = failed.map(item => ({ ...item, id: crypto.randomUUID(), status: "queued" as const, result: undefined, error: undefined }));
    await runXyzItems(items, true);
  }
  function exportXyzResults() {
    const payload = { exportedAt: new Date().toISOString(), target: xyzTarget, axes: xyzAxes, items: xyzResults.map(item => ({ label: item.label, status: item.status, patch: item.patch, error: item.error, promptId: item.result?.promptId, images: item.result?.images ?? [], texts: item.result?.texts ?? [] })) };
    downloadTextFile(`xyz-results-${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json");
    pushToast("success", "XYZ 结果已导出", "已生成 JSON manifest");
  }

  // ===== Render =====
  return (
    <div className={ui.isAppSidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <AppSidebar isCollapsed={ui.isAppSidebarCollapsed} onToggle={() => ui.setIsAppSidebarCollapsed(!ui.isAppSidebarCollapsed)} activeTab={tab} onTabChange={setTab} generationTabs={generationTabs} toolTabs={toolTabs} />
      <div className="app-main">
        {ui.showWelcome && <WelcomeModal onClose={ui.handleCloseWelcome} />}
        <header className="topbar">
          <div className="brand">
            <div className={`connection-status ${connection.status}`} title={connection.message}>
              <div className="status-dot" />
              <span>{connection.status === "online" ? `在线 ${connection.version || ""}` : connection.status === "offline" ? "离线" : connection.status === "checking" ? "正在连接..." : "连接错误"}</span>
            </div>
          </div>
          <div className="top-actions">
            <div className="action-group">
              <button type="button" className="icon-button" onClick={() => ui.setShowPromptEditor(true)} title="提示词编辑器"><Sparkles size={18} /><span>提示词</span></button>
              <button type="button" className={ui.showPromptSidebar ? "icon-button active" : "icon-button"} onClick={() => ui.setShowPromptSidebar(!ui.showPromptSidebar)} title="提示词仓库"><Bookmark size={18} /><span>仓库</span></button>
              <button type="button" className="icon-button" onClick={() => loras.setLoraOperation({ type: "translator" })} title="翻译工具"><Languages size={18} /></button>
            </div>
            <div className="action-divider" />
            <div className="action-group">
              <button type="button" className="icon-button" onClick={() => loras.setLoraOperation({ type: "notifications" })} title="通知"><ListFilter size={18} /></button>
              <button type="button" className="icon-button" onClick={() => loras.setLoraOperation({ type: "settings" })} title="设置"><Settings size={18} /></button>
            </div>
            <button type="button" className="icon-button danger" onClick={() => client.interrupt(gen.progress.promptId)} disabled={!gen.progress.running}><PauseCircle size={18} /><span>中断</span></button>
          </div>
        </header>

        {connection.status !== "online" && connection.status !== "checking" && (
          <div className="connection-overlay">
            <div className="overlay-content">
              <div className="overlay-icon"><RefreshCw size={48} className="animate-spin-slow" /></div>
              <h2>ComfyUI 连接已断开</h2>
              <p>无法连接到 ComfyUI 后端服务，请确保：</p>
              <ul>
                <li>ComfyUI 服务已经在 <b>{apiBase}</b> 启动</li>
                <li>如果使用了插件，请确保插件已正确安装</li>
                <li>尝试手动刷新页面或重启 ComfyUI</li>
              </ul>
              <div className="overlay-actions">
                <button className="primary-action" onClick={() => window.location.reload()}><RefreshCw size={18} />重新连接</button>
                <button className="secondary-action" onClick={() => loras.setLoraOperation({ type: "settings" })}><Settings size={18} />修改 API 地址</button>
              </div>
              {connection.message && <div className="error-detail">{connection.message}</div>}
            </div>
          </div>
        )}

        <PromptEditorDialog open={ui.showPromptEditor} onClose={() => ui.setShowPromptEditor(false)} initialPositive={defaultParams.positivePrompt} initialNegative={defaultParams.negativePrompt} onApply={(positive, negative) => { setDefaultParams(prev => ({ ...prev, positivePrompt: positive, negativePrompt: negative })); }} />

        {loras.loraOperation?.type === "translator" && (
          <TranslationToolDialog onClose={() => loras.setLoraOperation(null)} translationSettings={EMPTY_OBJECT as TranslationSettings} onToast={pushToast} />
        )}

        <RunProgressStrip progress={gen.progress} />

        <div className="layout-with-sidebar">
          <div className={["layout", gen.results.length > 0 ? "has-output" : "no-output", tab === "loras" ? "lora-full" : ""].filter(Boolean).join(" ")}>
            {/* Tab content will be rendered here - keeping inline for now */}
            {tab === "wd14" && (
              <TaggerPanel
                wd14Tab={wd14Tab} setWd14Tab={setWd14Tab} wd14={wd14} setWd14={setWd14}
                wdFile={wdFile} setWdFile={setWdFile} wdTags={wdTags}
                clFile={clFile} setClFile={setClFile} clSingleParams={clSingleParams} setClSingleParams={setClSingleParams}
                clBatchParams={clBatchParams} setClBatchParams={setClBatchParams}
                wdBatchParams={wdBatchParams} setWdBatchParams={setWdBatchParams}
                options={options}
                runWd14={runWd14} runClSingle={runClSingle} runBatchTagger={(type) => gen.runBatchTagger(type, clBatchParams, wdBatchParams)}
              />
            )}
            {tab === "notes" && (
              <NotesPanel
                notes={notes} activeNoteId={activeNoteId} notesSaving={notesSaving} notesSearch={notesSearch} isNotesWide={isNotesWide}
                setNotesSearch={setNotesSearch} setIsNotesWide={setIsNotesWide} setActiveNoteId={setActiveNoteId}
                handleAddNote={handleAddNote} handleDeleteNote={handleDeleteNote} updateActiveNote={updateActiveNote} saveNotes={saveNotes} confirm={confirm}
              />
            )}
            {/* Other tabs omitted for brevity - to be restored from original */}
          </div>

          {/* Output panel */}
          {tab !== "loras" && !(tab === "notes" && isNotesWide) && (
            <aside className="output-sidebar">
              <div className="output-header">生成结果</div>
              <div className="output-list custom-scrollbar">
                {gen.results.map((result, index) => (
                  <div key={result.promptId || index} className="output-item">
                    <ImageGalleryItem images={result.images} setOutputLightbox={ui.setOutputLightbox} />
                  </div>
                ))}
              </div>
            </aside>
          )}
        </div>

        {/* Modals */}
        {ui.showXyzHelp && <XyzHelpModal onClose={() => ui.setShowXyzHelp(false)} />}
        {ui.featureModal && <FeatureModal modal={ui.featureModal} onClose={() => ui.setFeatureModal(null)} />}
        {ui.confirmDialog && (
          <ModalFrame title={ui.confirmDialog.title} onClose={() => ui.setConfirmDialog(null)}>
            <div style={{ padding: 24 }}>
              <p>{ui.confirmDialog.message}</p>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button className="secondary-action" onClick={() => ui.setConfirmDialog(null)}>取消</button>
                <button className="primary-action danger" onClick={() => { ui.confirmDialog?.onConfirm(); ui.setConfirmDialog(null); }}>确认</button>
              </div>
            </div>
          </ModalFrame>
        )}
        {ui.outputLightbox && (
          <ModalFrame title="图片预览" onClose={() => ui.setOutputLightbox(null)}>
            <img src={ui.outputLightbox} alt="output" style={{ maxWidth: "90vw", maxHeight: "90vh" }} />
          </ModalFrame>
        )}
        <ToastViewport toasts={toasts} onClose={removeToast} />
      </div>
    </div>
  );
}

export default memo(App);
