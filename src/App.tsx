import { useCallback, useMemo } from "react";
import {
  Bookmark,
  Boxes,
  CheckCircle2,
  Columns,
  Dices,
  ExternalLink,
  FileText,
  GalleryHorizontalEnd,
  ImageUp,
  Languages,
  ListFilter,
  Loader2,
  PauseCircle,
  RefreshCw,
  Save,
  ScanSearch,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Type,
  UserRound,
  Wand2,
  X,
} from "lucide-react";

import { AppSidebar } from "./components/layout/AppSidebar";
import { GlobalModals } from "./components/GlobalModals";
import { PromptSidebar } from "./components/PromptSidebar";
import { ToastViewport, RunProgressStrip } from "./components/ui";

import {
  DefaultGenerationPanel,
  MultiGenerationPanel,
  HighresGenerationPanel,
  TextGenerationPanel,
} from "./components/features/Generation";
import { TaggingPanel } from "./components/features/Tagging/TaggingPanel";
import { NotesManagerPanel } from "./components/features/Notes/NotesManagerPanel";
import { XyzController } from "./components/features/Xyz";
import { LoraManagerPanel } from "./components/features/Lora";
import { SlotMachinePanel } from "./components/features/Slots";
import { WelcomeModal } from "./components/WelcomeModal";

import { useAppContext } from "./AppContext";
import { useToast } from "./hooks/useToast";
import { useUiState } from "./hooks/useUiState";
import { useNotes } from "./hooks/useNotes";
import { useLoras } from "./hooks/useLoras";
import { useGeneration } from "./hooks/useGeneration";
import { useParams } from "./hooks/useParams";
import { useTagging } from "./hooks/useTagging";
import { useXyz } from "./hooks/useXyz";
import { useOptions } from "./hooks/useOptions";

import { loraSyntaxName, mergeLora } from "./lib/lora-helper";
import { pickCardPreviewMedia } from "./lib/lora-media";
import { addCharacter } from "./lib/multiCharacters";
import {
  buildDefaultPrompt,
  buildHighresPrompt,
  buildMultiPrompt,
  buildWd14Prompt,
  buildClSinglePrompt,
} from "./lib/workflowBuilders";
import { templateLabels } from "./constants";
import type { LoraSelection, TemplateKind, LoraItem, TabId } from "./types";

function App() {
  const { apiBase, setApiBase, client, connection, tab, setTab } = useAppContext();

  // ===== Hooks =====
  const { toasts, notificationLog, pushToast, removeToast } = useToast();
  const ui = useUiState();
  const tagging = useTagging();
  const xyz = useXyz();
  const notesHook = useNotes({ tab: tab as any, pushToast, confirm: ui.confirm });

  const gen = useGeneration({ client, pushToast });
  const params = useParams();

  const { options, setOptions, loraSettings, setLoraSettings } = useOptions({
    client,
    pushToast,
    setDefaultParams: (updater) => params.setDefaultParams(updater as any),
    setMultiParams: (updater) => params.setMultiParams(updater as any),
    setHighresParams: (updater) => params.setHighresParams(updater as any),
    setWd14: tagging.setWd14,
    setWdBatchParams: tagging.setWdBatchParams,
    setClBatchParams: tagging.setClBatchParams,
    setClSingleParams: tagging.setClSingleParams,
  });

  // Update active hashes for lora hook
  const allActiveHashes = useMemo(() => {
    const hashes = new Set<string>();
    params.defaultParams.loras.forEach(l => l.sha256 && hashes.add(l.sha256.toLowerCase()));
    params.multiParams.loras.forEach(l => l.sha256 && hashes.add(l.sha256.toLowerCase()));
    params.highresParams.loras.forEach(l => l.sha256 && hashes.add(l.sha256.toLowerCase()));
    return Array.from(hashes);
  }, [params.defaultParams.loras, params.multiParams.loras, params.highresParams.loras]);

  const loras = useLoras({
    client,
    pushToast,
    activeLoraHashes: allActiveHashes,
    loraSettings,
    setLoraSettings,
    tab: tab as TabId,
  });

  const handleAddCharacter = useCallback(() => {
    params.setMultiParams(prev => ({
      ...prev,
      characters: addCharacter(prev.characters)
    }));
  }, [params.setMultiParams]);

  const handleOpenLoraDetail = useCallback((lora: LoraSelection | LoraItem) => {
    if ("sha256" in lora && "file_path" in lora) {
      loras.setLoraDetail(lora as LoraItem);
      return;
    }
    const selection = lora as LoraSelection;
    loras.setManagedModelType("loras");
    const hash = selection.sha256?.toLowerCase();
    const fallbackPreview = hash ? (loras.loraExampleFilesByHash[hash]?.[0]?.path || loras.loraExampleFilesByHash[hash]?.[0]?.url) : undefined;
    
    loras.setLoraDetail({ 
      file_path: selection.filePath || selection.name, 
      file_name: selection.name.split("/").pop() || selection.name,
      model_name: selection.displayName || selection.name.split("/").pop() || selection.name,
      preview_url: selection.previewUrl || fallbackPreview,
      file_size: 0, 
      sha256: selection.sha256 
    } as LoraItem);
  }, [loras.loraExampleFilesByHash, loras.setLoraDetail, loras.setManagedModelType]);

  const handleLoraInsert = useCallback((item: LoraItem, target: TemplateKind, strength = 1) => {
    const hash = item.sha256?.toLowerCase();
    const localFiles = hash ? loras.loraExampleFilesByHash[hash] ?? [] : [];
    const previewMedia = pickCardPreviewMedia(item, localFiles);
    
    const selection: LoraSelection = {
      name: loraSyntaxName(item),
      displayName: item.model_name || item.file_name,
      strength,
      clipStrength: strength,
      active: true,
      filePath: item.file_path,
      sha256: item.sha256,
      previewUrl: previewMedia.path || previewMedia.url || item.preview_url,
    };

    if (target === "multi") {
      params.setMultiParams((prev) => ({ ...prev, loras: mergeLora(prev.loras, selection) }));
    } else if (target === "highres") {
      params.setHighresParams((prev) => ({ ...prev, loras: mergeLora(prev.loras, selection) }));
    } else {
      params.setDefaultParams((prev) => ({ ...prev, loras: mergeLora(prev.loras, selection) }));
    }
    pushToast("success", "LoRA 已插入", `${selection.displayName} -> ${templateLabels[target]}`);
  }, [loras.loraExampleFilesByHash, params.setDefaultParams, params.setMultiParams, params.setHighresParams, pushToast]);

  const handleSlotsApply = useCallback((tags: string[], target: TemplateKind) => {
    const clean = tags.map((tag) => tag.trim()).filter(Boolean);
    if (clean.length === 0) return;

    const updater = (prev: any) => {
      const key = target === "multi" ? "globalPrompt" : "positivePrompt";
      const current = (prev[key] || "").trim();
      const existing = new Set(current.split(/[,，]/).map((part: string) => part.trim().toLowerCase()));
      const toAdd = clean.filter((tag) => !existing.has(tag.toLowerCase()));
      if (toAdd.length === 0) return prev;
      const joined = toAdd.join(", ");
      return { ...prev, [key]: current ? `${current}, ${joined}` : joined };
    };

    if (target === "multi") {
      params.setMultiParams(updater);
    } else if (target === "highres") {
      params.setHighresParams(updater);
    } else {
      params.setDefaultParams(updater);
    }
    pushToast("success", "灵感已应用", `已追加 ${clean.length} 个词条到 ${templateLabels[target]} 正向提示词`);
  }, [params, pushToast]);

  const handleSidebarSelect = useCallback((text: string, target: "positive" | "negative") => {
    const updater = (prev: any) => {
      const key = target === "positive" ? (tab === "multi" ? "globalPrompt" : "positivePrompt") : "negativePrompt";
      return { ...prev, [key]: (prev[key] || "") + (prev[key] ? ", " : "") + text };
    };

    if (tab === "multi") {
      params.setMultiParams(updater);
    } else if (tab === "highres") {
      params.setHighresParams(updater);
    } else {
      params.setDefaultParams(updater);
    }
    pushToast("info", "提示词已添加", `${text.slice(0, 20)}...`);
  }, [tab, params, pushToast]);

  function addTriggerWords(words: string[], target = loras.loraTarget) {
    if (!words || words.length === 0) return;
    const text = words.join(", ");
    const updater = (prev: any) => {
      const key = tab === "multi" ? "globalPrompt" : "positivePrompt";
      return { ...prev, [key]: (prev[key] || "") + (prev[key] ? ", " : "") + text };
    };

    if (target === "multi") {
      params.setMultiParams(updater);
    } else if (target === "highres") {
      params.setHighresParams(updater);
    } else {
      params.setDefaultParams(updater);
    }
    pushToast("success", "触发词已应用", `已追加到 ${templateLabels[target]} 正向提示词`);
  }

  const currentPrompts = useMemo(() => {
    if (tab === "multi") return { positive: params.multiParams.globalPrompt, negative: params.multiParams.negativePrompt };
    if (tab === "highres") return { positive: params.highresParams.positivePrompt, negative: params.highresParams.negativePrompt };
    return { positive: params.defaultParams.positivePrompt, negative: params.defaultParams.negativePrompt };
  }, [tab, params.defaultParams, params.multiParams, params.highresParams]);

  const generationTabs = useMemo(() => [
    { id: "default", label: "默认生图", icon: Wand2 },
    { id: "multi", label: "多人工作流", icon: UserRound },
    { id: "highres", label: "高清修复", icon: ImageUp },
    { id: "wd14", label: "WD1.4", icon: ScanSearch },
    { id: "text", label: "文字特效", icon: Type },
    { id: "xyz", label: "XYZ 控制器", icon: SlidersHorizontal },
    { id: "slots", label: "灵感老虎机", icon: Dices },
  ], []);

  const toolTabs = useMemo(() => [
    { id: "loras", label: "LoRA 管理", icon: Boxes },
    { id: "notes", label: "记事本", icon: FileText },
  ], []);

  return (
    <>
      <div className="app-shell">
      <AppSidebar
        isCollapsed={ui.isAppSidebarCollapsed}
        onToggle={() => ui.setIsAppSidebarCollapsed(!ui.isAppSidebarCollapsed)}
        activeTab={tab as any}
        onTabChange={(id) => setTab(id as any)}
        generationTabs={generationTabs as any}
        toolTabs={toolTabs as any}
      />
      
      <div className="app-main">
        <header className="topbar">
          <div className="brand">
            <div className={`connection-status ${connection.status}`} title={connection.message}>
              <div className="status-dot" />
              <span>
                {connection.status === "online" 
                  ? `在线 ${connection.version || ""}` 
                  : connection.status === "offline" 
                  ? "离线" 
                  : connection.status === "checking" 
                  ? "正在连接..." 
                  : "连接错误"}
              </span>
            </div>
          </div>
          <div className="top-actions">
            <div className="action-group">
              <button type="button" className="icon-button" onClick={() => ui.setShowPromptEditor(true)} title="提示词编辑器">
                <Sparkles size={18} />
                <span>提示词</span>
              </button>
              <button type="button" className={ui.showPromptSidebar ? "icon-button active" : "icon-button"} onClick={() => ui.setShowPromptSidebar(!ui.showPromptSidebar)} title="提示词仓库">
                <Bookmark size={18} />
                <span>仓库</span>
              </button>
              <button type="button" className="icon-button" onClick={() => ui.setShowTranslation(true)} title="翻译工具">
                <Languages size={18} />
              </button>
            </div>
            
            <div className="action-divider" />
            
            <div className="action-group">
              <button type="button" className="icon-button" onClick={() => loras.setLoraOperation({ type: "notifications" })} title="通知">
                <ListFilter size={18} />
              </button>
              <button type="button" className="icon-button" onClick={() => loras.setLoraOperation({ type: "settings" })} title="设置">
                <Settings size={18} />
              </button>
            </div>
  
            <button type="button" className="icon-button danger" onClick={() => client.interrupt(gen.progress.promptId)} disabled={!gen.progress.running}>
              <PauseCircle size={18} />
              <span>中断</span>
            </button>
          </div>
        </header>

        <RunProgressStrip progress={gen.progress} />

        <div className="layout-with-sidebar">
          <div className={["layout", gen.results.length > 0 ? "has-output" : "no-output", tab === "loras" ? "lora-full" : ""].filter(Boolean).join(" ")}>
            <main className="workspace">
              {tab === "default" && (
                <DefaultGenerationPanel
                  params={params.defaultParams}
                  setParams={params.setDefaultParams}
                  options={options}
                  apiBase={apiBase}
                  loraSettings={loraSettings}
                  loraExampleFilesByHash={loras.loraExampleFilesByHash}
                  onRunGeneration={() => gen.runPrompt("默认生图", () => buildDefaultPrompt(params.defaultParams))}
                  onOpenLoraDetail={handleOpenLoraDetail}
                  onSetSimpleLoraTarget={loras.setSimpleLoraTarget}
                  onSendToHighres={() => {
                    params.setHighresParams(prev => ({
                      ...prev,
                      positivePrompt: params.defaultParams.positivePrompt,
                      negativePrompt: params.defaultParams.negativePrompt,
                      loras: [...params.defaultParams.loras]
                    }));
                    setTab("highres");
                  }}
                />
              )}

              {tab === "multi" && (
                <MultiGenerationPanel
                  params={params.multiParams}
                  setParams={params.setMultiParams}
                  options={options}
                  apiBase={apiBase}
                  loraSettings={loraSettings}
                  loraExampleFilesByHash={loras.loraExampleFilesByHash}
                  onRunGeneration={() => gen.runPrompt("多人工作流", () => buildMultiPrompt(params.multiParams))}
                  onOpenLoraDetail={handleOpenLoraDetail}
                  onSetSimpleLoraTarget={loras.setSimpleLoraTarget}
                  onAddCharacter={addCharacter}
                />
              )}

              {tab === "highres" && (
                <HighresGenerationPanel
                  params={params.highresParams}
                  setParams={params.setHighresParams}
                  options={options}
                  apiBase={apiBase}
                  loraSettings={loraSettings}
                  loraExampleFilesByHash={loras.loraExampleFilesByHash}
                  onRunGeneration={() => gen.runPrompt("高清修复", () => buildHighresPrompt(params.highresParams))}
                  onOpenLoraDetail={handleOpenLoraDetail}
                  onSetSimpleLoraTarget={loras.setSimpleLoraTarget}
                />
              )}

              {tab === "wd14" && (
                <TaggingPanel
                  wd14={tagging.wd14}
                  setWd14={tagging.setWd14}
                  wdFile={tagging.wdFile}
                  setWdFile={tagging.setWdFile}
                  wdTags={tagging.wdTags}
                  setWdTags={tagging.setWdTags}
                  wd14Tab={tagging.wd14Tab}
                  setWd14Tab={tagging.setWd14Tab}
                  clFile={tagging.clFile}
                  setClFile={tagging.setClFile}
                  clSingleParams={tagging.clSingleParams}
                  setClSingleParams={tagging.setClSingleParams}
                  clBatchParams={tagging.clBatchParams}
                  setClBatchParams={tagging.setClBatchParams}
                  wdBatchParams={tagging.wdBatchParams}
                  setWdBatchParams={tagging.setWdBatchParams}
                  options={options}
                  onRunWd14={() => {
                    tagging.setWdTags("");
                    return gen.runWd14(tagging.wd14, tagging.wdFile).then(res => tagging.setWdTags(res.texts.join("\n")));
                  }}
                  onRunClSingle={() => {
                    tagging.setWdTags("");
                    return gen.runClSingle(tagging.clSingleParams, tagging.clFile).then(res => tagging.setWdTags(res.texts.join("\n")));
                  }}
                  onRunBatchTagger={(type) => gen.runBatchTagger(type, tagging.clBatchParams, tagging.wdBatchParams)}
                />
              )}

              {tab === "text" && (
                <TextGenerationPanel
                  params={params.defaultParams}
                  setParams={params.setDefaultParams}
                  options={options}
                  onRunDefault={() => gen.runPrompt("默认生图", () => buildDefaultPrompt(params.defaultParams))}
                  onRunMulti={() => gen.runPrompt("多人", () => buildMultiPrompt({ ...params.multiParams, drawText: params.defaultParams.drawText }))}
                  onRunHighres={() => gen.runPrompt("高清修复", () => buildHighresPrompt({ ...params.highresParams, drawText: params.defaultParams.drawText }))}
                  defaultParams={params.defaultParams}
                  multiParams={params.multiParams}
                  highresParams={params.highresParams}
                />
              )}
              
              {tab === "xyz" && (
                <XyzController
                  xyzTarget={xyz.xyzTarget}
                  setXyzTarget={xyz.setXyzTarget}
                  xyzAxes={xyz.xyzAxes}
                  setXyzAxes={xyz.setXyzAxes}
                  xyzExcludedIndices={xyz.xyzExcludedIndices}
                  onToggleXyzIndex={xyz.toggleXyzIndex}
                  showXyzHelp={ui.showXyzHelp}
                  setShowXyzHelp={ui.setShowXyzHelp}
                  lorasOfTarget={xyz.getXyzLoras(params)}
                  gen={gen}
                  params={params}
                  onOutputLightbox={ui.setOutputLightbox}
                />
              )}

              {tab === "slots" && (
                <SlotMachinePanel onApplyPrompt={handleSlotsApply} />
              )}

              {tab === "loras" && (
                <LoraManagerPanel
                  modelType={loras.managedModelType}
                  onModelTypeChange={loras.changeManagedModelType}
                  result={loras.loraResult}
                  query={loras.loraQuery}
                  setQuery={loras.setLoraQuery}
                  loading={loras.loraLoading}
                  hasMore={loras.loraResult.page < loras.loraResult.totalPages}
                  folders={loras.loraFolders}
                  baseModels={loras.loraBaseModels}
                  tags={loras.loraTags}
                  density={loras.loraDensity}
                  setDensity={loras.setLoraDensity}
                  triggerWords={loras.triggerWords}
                  onRefresh={loras.refreshLoras}
                  onLoadMore={loras.loadMoreManagedModels}
                  onDetail={loras.setLoraDetail}
                  onInsert={handleLoraInsert}
                  exampleStatus={loras.exampleStatus}
                  examplePending={loras.examplePending}
                  pullingExampleHashes={loras.pullingExampleHashes}
                  localExampleFilesByHash={loras.loraExampleFilesByHash}
                  onPullAllExamples={loras.pullAllLoraExamples}
                  apiBase={apiBase}
                  settings={loraSettings}
                />
              )}

              {tab === "notes" && (
                <NotesManagerPanel
                  notes={notesHook.notes}
                  activeNoteId={notesHook.activeNoteId}
                  notesSearch={notesHook.notesSearch}
                  setNotesSearch={notesHook.setNotesSearch}
                  setActiveNoteId={notesHook.setActiveNoteId}
                  handleAddNote={notesHook.handleAddNote}
                  handleDeleteNote={notesHook.handleDeleteNote}
                  updateActiveNote={notesHook.updateActiveNote}
                  saveNotes={notesHook.saveNotes}
                  notesSaving={notesHook.notesSaving}
                  isNotesWide={notesHook.isNotesWide}
                  setIsNotesWide={notesHook.setIsNotesWide}
                  onConfirmClear={() => ui.confirm("清空内容", "确定要清空当前笔记的所有内容吗？此操作无法撤销。", () => notesHook.updateActiveNote({ content: "" }))}
                />
              )}
            </main>

            {tab !== "loras" && !(tab === "notes" && notesHook.isNotesWide) && (
              <aside className={gen.results.length > 0 || gen.progress.previewUrl ? "output-panel" : "output-panel is-empty"}>
                <div className="gallery">
                  <h2><GalleryHorizontalEnd size={18} /> 输出</h2>
                  {gen.results.length === 0 && !gen.progress.previewUrl && <div className="empty-state">暂无输出</div>}
                  
                  {gen.progress.running && gen.progress.previewUrl && (
                    <div className="gallery-item" key="preview">
                      <div className="gallery-meta">
                        <Loader2 size={16} className="spin" />
                        <span>预览中...</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                        <img 
                          src={gen.progress.previewUrl} 
                          alt="Preview" 
                          style={{ filter: "blur(2px)", transition: "filter 0.3s" }}
                        />
                      </div>
                    </div>
                  )}

                  {gen.results.map((result) => (
                    <div className="gallery-item" key={result.promptId}>
                      <div className="gallery-meta">
                        <CheckCircle2 size={16} />
                        <span>{result.promptId.slice(0, 8)}</span>
                      </div>
                      {result.images.length > 0 && (() => {
                        const lastImg = result.images[result.images.length - 1];
                        const finalImages = result.images.filter(img => img.subfolder === lastImg.subfolder && img.nodeTitle === lastImg.nodeTitle);
                        const baseImages = result.images.filter(img => img.subfolder !== lastImg.subfolder || img.nodeTitle !== lastImg.nodeTitle);
                        
                        return finalImages.map((image, i) => (
                          <div key={`${result.promptId}-${image.filename}`} style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                            <img 
                              src={image.url} 
                              alt={image.filename} 
                              style={{ cursor: "zoom-in" }}
                              onClick={() => ui.setOutputLightbox(image.url)}
                            />
                            {baseImages.length > 0 && (
                              <button 
                                className="secondary-action" 
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '100%' }}
                                onClick={() => ui.setCompareLightbox([baseImages[Math.min(i, baseImages.length - 1)].url, image.url])}
                              >
                                <Columns size={14} /> 对比基础图像
                              </button>
                            )}
                          </div>
                        ));
                      })()}
                      {result.texts.length > 0 && <pre>{result.texts.join("\n")}</pre>}
                    </div>
                  ))}
                </div>
              </aside>
            )}
          </div>

          <PromptSidebar 
            isOpen={ui.showPromptSidebar} 
            onClose={() => ui.setShowPromptSidebar(false)} 
            onSelect={(text, target) => handleSidebarSelect(text, target as any)} 
            currentPositive={currentPrompts.positive}
            currentNegative={currentPrompts.negative}
          />
        </div>
      </div>
    </div>

      <GlobalModals 
        loraOperation={loras.loraOperation} 
        setLoraOperation={loras.setLoraOperation}
        loraDetail={loras.loraDetail}
        setLoraDetail={loras.setLoraDetail}
        simpleLoraTarget={loras.simpleLoraTarget}
        setSimpleLoraTarget={loras.setSimpleLoraTarget}
        showXyzHelp={ui.showXyzHelp}
        setShowXyzHelp={ui.setShowXyzHelp}
        featureModal={ui.featureModal}
        setFeatureModal={ui.setFeatureModal}
        onLoraInsert={handleLoraInsert}
        onLoraRename={loras.renameLora}
        onLoraMove={loras.moveLora}
        onLoraDelete={loras.deleteLora}
        onLoraBatchMove={(items, targetPath) => { loras.bulkMoveLoras(items.map(i => i.file_path || ""), targetPath); return Promise.resolve(); }}
        onLoraBatchDelete={(items) => { loras.bulkDeleteLoras(items.map(i => i.file_path || "")); return Promise.resolve(); }}
        onLoraCivitaiSync={async (item) => { await loras.syncCivitai(item); }}
        onTriggerWordsApply={addTriggerWords}
        onTriggerWordsSave={async (item, words) => { await loras.saveLoraTriggerWords(item, words); return words; }}
        onTriggerWordsRead={async (item) => { await loras.loadTriggerWords(item); return []; }}
        onPromptApply={(pos, neg) => {
          const append = (current: string, addition: string) => {
            if (!addition.trim()) return current;
            if (!current.trim()) return addition.trim();
            const trimmed = current.trim();
            const sep = (trimmed.endsWith(',') || trimmed.endsWith('，')) ? ' ' : ', ';
            return trimmed + sep + addition.trim();
          };

          const updater = (prev: any) => {
            const posKey = tab === "multi" ? "globalPrompt" : "positivePrompt";
            return {
              ...prev,
              [posKey]: append(prev[posKey] || "", pos),
              negativePrompt: append(prev.negativePrompt || "", neg)
            };
          };

          if (tab === "multi") {
            params.setMultiParams(updater);
          } else if (tab === "highres") {
            params.setHighresParams(updater);
          } else {
            params.setDefaultParams(updater);
          }
          pushToast("success", "提示词已应用", "已成功追加到输入框");
        }}
        onOpenLoraFolder={loras.openLoraExampleFolder}
        onPullLoraExamples={async (item) => { await loras.pullLoraExamples(item); return []; }}
        onPauseDownloads={loras.pauseExampleDownloads}
        onResumeDownloads={loras.resumeExampleDownloads}
        onStopDownloads={loras.stopExampleDownloads}
        onUpdateSettings={async (s) => { loras.updateLoraSettings(s); }}
        onDoctorAction={async (action) => { loras.doctorAction(action as any); }}
        loras={loras}
        apiBase={apiBase}
        setApiBase={setApiBase}
        ui={ui}
        client={client}
        translationSettings={options.translation}
        onTranslationSettingsSaved={(ts) => setOptions(prev => ({ ...prev, translation: ts }))}
        pushToast={pushToast}
        toasts={toasts}
        notificationLog={notificationLog}
      />

      <ToastViewport toasts={toasts} onClose={removeToast} />
      
      {connection.status !== "online" && connection.status !== "checking" && (
        <div className="connection-overlay">
          <div className="overlay-content">
            <div className="overlay-icon">
              <RefreshCw size={48} className="animate-spin-slow" />
            </div>
            <h2>ComfyUI 连接已断开</h2>
            <p>无法连接到 ComfyUI 后端服务，请确保：</p>
            <ul>
              <li>ComfyUI 服务已经在 <b>{apiBase}</b> 启动</li>
              <li>如果使用了插件，请确保插件已正确安装</li>
              <li>尝试手动刷新页面或重启 ComfyUI</li>
            </ul>
            <div className="overlay-actions">
              <button type="button" className="primary-action" onClick={() => window.location.reload()}>
                <RefreshCw size={18} />
                重新连接
              </button>
              <button type="button" className="secondary-action" onClick={() => loras.setLoraOperation({ type: "settings" })}>
                <Settings size={18} />
                修改 API 地址
              </button>
            </div>
            {connection.message && <div className="error-detail">{connection.message}</div>}
          </div>
        </div>
      )}
    </>
  );
}

export default App;
