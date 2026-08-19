import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONFIG } from "./config";
import DOMPurify from "dompurify";

const EMPTY_ARRAY: any[] = [];
const EMPTY_OBJECT: any = {};
import { useLocalStorageState } from "./hooks/useLocalStorageState";
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent, ReactNode, UIEvent } from "react";
import {
  BadgePlus,
  Bookmark,
  Boxes,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Bold,
  CheckCircle2,
  CircleHelp,
  Clock,
  Copy,
  Download,
  Eraser,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Film,
  Folder,
  FolderOpen,
  GalleryHorizontalEnd,
  Globe2,
  Grid3X3,
  GripVertical,
  Heading1,
  Heading2,
  Highlighter,
  Image as ImageIcon,
  ImageUp,
  Info,
  Italic,
  Keyboard,
  Layers,
  List,
  ListFilter,
  ListOrdered,
  Maximize,
  Maximize2,
  Minimize,
  MoreHorizontal,
  PlayCircle,
  Plus,
  PauseCircle,
  Redo,
  RefreshCw,
  ScanSearch,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  Strikethrough,
  Tags,
  Trash2,
  Type,
  Underline,
  Undo,
  Upload,
  UserRound,
  Wand2,
  X,
  Columns,
  Loader2,
  Languages,
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
import { translateText, defaultTranslationSettings } from "./lib/translation";
import type { TranslationSettings, TranslationProvider } from "./lib/translation";
import type { MaskHandle } from "./lib/multiCanvas";
import { addCharacter, duplicateCharacter, removeCharacter } from "./lib/multiCharacters";
import { findPathPreset, findResolutionPreset, pathPresets, resolutionPresets } from "./lib/presets";
import {
  buildDefaultPrompt,
  buildHighresPrompt,
  buildMultiPrompt,
  buildWd14Prompt,
  buildClBatchPrompt,
  buildWdBatchPrompt,
  buildClSinglePrompt,
} from "./lib/workflowBuilders";
import { applySpecialXyzPatch, buildXyzCombinations, fieldLabel, parseAxisValues } from "./lib/xyz";
import type {
  BaseGenerationParams,
  ConnectionInfo,
  ConnectionStatus,
  DetailerParams,
  DoctorDiagnostic,
  DownloadProgress,
  ExampleImagesPendingResult,
  ExampleImagesStatus,
  HighresParams,
  HighresVariant,
  JobResult,
  LoraDuplicateGroup,
  LoraExampleMedia,
  LoraItem,
  LoraListResult,
  LoraManagerSettings,
  LoraMediaMeta,
  LoraMetadata,
  LoraOperation,
  LoraQueryState,
  LoraSelection,
  LoraUpdateRecord,
  ManagedModelType,
  MatureBlurLevel,
  MultiCharacter,
  MultiGenerationParams,
  OptionsState,
  ProgressState,
  TemplateKind,
  Toast,
  Wd14Params,
  XyzAxis,
  XyzField,
  OutputImage,
  NoteItem,
  ClBatchParams,
  ClSingleParams,
  WdBatchParams,
  DrawTextParams,
  TabId,
  LoraPreviewMedia,
  XyzRunItem,
} from "./types";
import { useAppContext } from "./AppContext";
import {
  NSFW_LEVELS,
  defaultLoraManagerSettings,
  defaultLoraQuery,
  emptyLoraResult,
  fallbackOptions,
  generationTabs,
  managedModelExampleType,
  managedModelLabel,
  tabs,
  templateLabels,
  toolTabs,
  validMatureBlurLevels,
} from "./constants";
import {
  makeBaseParams,
  makeDetailerParams,
  makeHighresParams,
  makeMultiParams,
} from "./lib/paramBuilders";
import {
  normalizePreview,
  mergeLora,
  readCombo,
  normalizeLoraManagerSettings,
  buildFolderTree,
  extractItemTrainedWords,
  subTypeAbbreviation,
  baseModelAbbreviation,
  uniqueStrings,
  mergeManagedModelItems,
  parseTriggerWordsInput,
  stripHtml,
  formatStrength,
  loraSyntaxName,
  roundCanvasMask,
  loraModelId,
  buildLoraCivitaiUrl,
  updateRecordModelId,
} from "./lib/lora-helper";
import {
  normalizeMatureBlurLevel,
  getMatureBlurThreshold,
  normalizeNsfwLevel,
  getItemNsfwLevel,
  getMediaNsfwLevel,
  shouldBlurNsfwLevel,
  getNSFWLevelName,
  getNsfwWarningText,
} from "./lib/nsfw";
import {
  buildLoraExamples,
  mergeRemoteWithLocalExample,
  pickCardPreviewMedia,
  normalizeLocalExample,
  findMatchingLocalExample,
  dedupeLocalExamples,
  pickPreferredLocalExample,
  localExampleKey,
  localExampleName,
  localExampleSource,
  localExampleExtension,
  localExampleScore,
  isLoraVideo,
  isVideoPath,
} from "./lib/lora-media";
import { formatBytes, downloadTextFile } from "./lib/file-helper";
import { hexToRgba } from "./lib/color-helper";
import { initialTabFromUrl, operationTitle, xyzStatusLabel } from "./lib/app-utils";

const AppSidebar = memo(({
  isCollapsed,
  onToggle,
  activeTab,
  onTabChange,
  generationTabs,
  toolTabs,
}: {
  isCollapsed: boolean;
  onToggle: () => void;
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
  generationTabs: Array<{ id: TabId; label: string; icon: any }>;
  toolTabs: Array<{ id: TabId; label: string; icon: any }>;
}) => {
  return (
    <aside className={isCollapsed ? "app-sidebar is-collapsed" : "app-sidebar"}>
      <div className="sidebar-header">
        <div className="brand-mark">
          <Sparkles size={22} />
        </div>
        {!isCollapsed && <h1>ComfyUI XYZ</h1>}
      </div>
      
      <nav className="sidebar-nav">
        <div className="nav-section">
          {!isCollapsed && <label>生图模板</label>}
          {generationTabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={activeTab === item.id ? "nav-item active" : "nav-item"}
                onClick={() => onTabChange(item.id)}
                title={item.label}
              >
                <Icon size={20} />
                {!isCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </div>
        
        <div className="nav-divider" />
        
        <div className="nav-section">
          {!isCollapsed && <label>工具组件</label>}
          {toolTabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={activeTab === item.id ? "nav-item active" : "nav-item"}
                onClick={() => onTabChange(item.id)}
                title={item.label}
              >
                <Icon size={20} />
                {!isCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="collapse-toggle"
          onClick={onToggle}
          title={isCollapsed ? "展开" : "收起"}
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          {!isCollapsed && <span>收起</span>}
        </button>
      </div>
    </aside>
  );
});

function App() {
  const { apiBase, setApiBase, client, connection, tab, setTab } = useAppContext();
  
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("xyz_welcome_seen")) {
      setShowWelcome(true);
    }
  }, []);

  const handleCloseWelcome = useCallback(() => {
    localStorage.setItem("xyz_welcome_seen", "true");
    setShowWelcome(false);
  }, []);

  const [options, setOptions] = useState<OptionsState>(fallbackOptions);
  const [defaultParams, setDefaultParams] = useLocalStorageState<BaseGenerationParams>("comfyui_default_params", makeBaseParams());
  const [multiParams, setMultiParams] = useLocalStorageState<MultiGenerationParams>("comfyui_multi_params", makeMultiParams());
  const [highresParams, setHighresParams] = useLocalStorageState<HighresParams>("comfyui_highres_params", makeHighresParams());
  const [outputLightbox, setOutputLightbox] = useState<string | null>(null);
  const [compareLightbox, setCompareLightbox] = useState<[string, string] | null>(null);
  const [wd14, setWd14] = useLocalStorageState<Wd14Params>("comfyui_wd14_params", {
    imageName: "",
    model: "wd-v1-4-moat-tagger-v2",
    threshold: 0.35,
    characterThreshold: 0.85,
    replaceUnderscore: true,
    trailingComma: true,
    excludeTags: "",
    device: "GPU",
  });
  const [wdFile, setWdFile] = useState<File | null>(null);
  const [wdTags, setWdTags] = useLocalStorageState("comfyui_wd_tags", "");
  const [wd14Tab, setWd14Tab] = useLocalStorageState<"single" | "cl_single" | "cl_batch" | "wd_batch">("comfyui_wd14_tab", "single");
  const [clFile, setClFile] = useState<File | null>(null);
  const [clSingleParams, setClSingleParams] = useLocalStorageState<ClSingleParams>("comfyui_cl_single_params", {
    imageName: "",
    modelName: "cl_tagger/cl_tagger_1_02.onnx",
    general: 0.55,
    character: 0.6,
    replaceSpace: true,
    categories: "rating,artist,general,character,copyright,meta,model,quality",
    excludeTags: "",
    sessionMethod: "GPU",
  });
  const [clBatchParams, setClBatchParams] = useLocalStorageState<ClBatchParams>("comfyui_cl_batch_params", {
    imageFolder: CONFIG.DEFAULT_TAG_IMAGE_FOLDER,
    outputFolder: CONFIG.DEFAULT_TAG_OUTPUT_FOLDER,
    prependText: "cs",
    runCount: 20,
    modelName: "cl_tagger/cl_tagger_1_02.onnx",
    general: 0.55,
    character: 0.6,
    replaceSpace: true,
    categories: "rating,artist,general,character,copyright,meta,model,quality",
    excludeTags: "",
    sessionMethod: "GPU",
  });
  const [wdBatchParams, setWdBatchParams] = useLocalStorageState<WdBatchParams>("comfyui_wd_batch_params", {
    imageFolder: CONFIG.DEFAULT_TAG_IMAGE_FOLDER,
    outputFolder: CONFIG.DEFAULT_TAG_OUTPUT_FOLDER,
    prependText: "cs",
    runCount: 20,
    model: "wd-v1-4-moat-tagger-v2",
    threshold: 0.35,
    characterThreshold: 0.85,
    replaceUnderscore: false,
    trailingComma: false,
    excludeTags: "",
    device: "GPU",
  });
  const [managedModelType, setManagedModelType] = useState<ManagedModelType>("loras");
  const [loraResult, setLoraResult] = useState<LoraListResult>(emptyLoraResult);
  const loraResultRef = useRef(loraResult);
  useEffect(() => { loraResultRef.current = loraResult; }, [loraResult]);

  const [loraQuery, setLoraQuery] = useState<LoraQueryState>(defaultLoraQuery);
  const loraQueryRef = useRef(loraQuery);
  useEffect(() => { loraQueryRef.current = loraQuery; }, [loraQuery]);

  const [loraLoading, setLoraLoading] = useState(false);
  const [loraFolders, setLoraFolders] = useState<string[]>([]);
  const loraFoldersRef = useRef(loraFolders);
  useEffect(() => { loraFoldersRef.current = loraFolders; }, [loraFolders]);

  const [loraBaseModels, setLoraBaseModels] = useState<Array<{ name: string; count: number }>>([]);
  const loraBaseModelsRef = useRef(loraBaseModels);
  useEffect(() => { loraBaseModelsRef.current = loraBaseModels; }, [loraBaseModels]);

  const [loraTags, setLoraTags] = useState<string[]>([]);
  const loraTagsRef = useRef(loraTags);
  useEffect(() => { loraTagsRef.current = loraTags; }, [loraTags]);
  const [loraTarget, setLoraTarget] = useState<TemplateKind>("default");
  const [loraDensity, setLoraDensity] = useState<"compact" | "medium" | "large">("medium");
  const [loraDetail, setLoraDetail] = useState<LoraItem | null>(null);
  const [selectedLoraPaths, setSelectedLoraPaths] = useState<string[]>([]);
  const [loraOperation, setLoraOperation] = useState<LoraOperation | null>(null);
  const [loraSettings, setLoraSettings] = useState<LoraManagerSettings>(defaultLoraManagerSettings);
  const [simpleLoraTarget, setSimpleLoraTarget] = useState<TemplateKind | null>(null);
  const [translationSettings, setTranslationSettings] = useLocalStorageState<TranslationSettings>("comfyui_translation_settings", defaultTranslationSettings);

  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSearch, setNotesSearch] = useState("");
  const [isNotesWide, setIsNotesWide] = useState(false);

  const [isAppSidebarCollapsed, setIsAppSidebarCollapsed] = useState(false);

  // Global responsive collapse
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsAppSidebarCollapsed(true);
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const notesSaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (tab === "notes") {
      fetch("/api/notes")
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.data && data.data.notes) {
            setNotes(data.data.notes);
            if (data.data.notes.length > 0 && !activeNoteId) {
              setActiveNoteId(data.data.notes[0].id);
            }
          }
        })
        .catch((err) => pushToast("error", "加载笔记失败", String(err)));
    }
  }, [tab]);

  async function saveNotes(currentNotes: NoteItem[], silent = false) {
    if (currentNotes.length === 0 && notes.length === 0) return;
    setNotesSaving(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: currentNotes }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      if (!silent) pushToast("success", "笔记已保存");
    } catch (err) {
      if (!silent) pushToast("error", "保存笔记失败", String(err));
    } finally {
      // Keep "saving" state for a moment to show visual feedback
      setTimeout(() => setNotesSaving(false), 800);
    }
  }

  // Auto-save effect
  useEffect(() => {
    if (tab !== "notes") return;
    
    if (notesSaveTimerRef.current) {
      window.clearTimeout(notesSaveTimerRef.current);
    }

    notesSaveTimerRef.current = window.setTimeout(() => {
      saveNotes(notes, true);
    }, 2000); // 2 seconds debounce

    return () => {
      if (notesSaveTimerRef.current) {
        window.clearTimeout(notesSaveTimerRef.current);
      }
    };
  }, [notes, tab]);

  function handleAddNote() {
    const newNote: NoteItem = {
      id: Math.random().toString(36).slice(2),
      title: "未命名笔记",
      content: "",
      updatedAt: Date.now(),
    };
    const nextNotes = [newNote, ...notes];
    setNotes(nextNotes);
    setActiveNoteId(newNote.id);
    saveNotes(nextNotes);
  }

  function handleDeleteNote(id: string) {
    setConfirmDialog({
      title: "删除笔记",
      message: "确定要删除这条笔记吗？删除后将无法恢复。",
      onConfirm: () => {
        const nextNotes = notes.filter((n) => n.id !== id);
        setNotes(nextNotes);
        if (activeNoteId === id) {
          setActiveNoteId(nextNotes.length > 0 ? nextNotes[0].id : null);
        }
        saveNotes(nextNotes);
      }
    });
  }

  function updateActiveNote(partial: Partial<NoteItem>) {
    if (!activeNoteId) return;
    setNotes((prev) =>
      prev.map((n) => (n.id === activeNoteId ? { ...n, ...partial, updatedAt: Date.now() } : n))
    );
  }
  const [loraExampleFilesByHash, setLoraExampleFilesByHash] = useState<Record<string, LoraExampleMedia[]>>({});
  const loraExampleFilesByHashRef = useRef(loraExampleFilesByHash);
  useEffect(() => { loraExampleFilesByHashRef.current = loraExampleFilesByHash; }, [loraExampleFilesByHash]);
  const [exampleStatus, setExampleStatus] = useState<ExampleImagesStatus | null>(null);
  const [examplePending, setExamplePending] = useState<ExampleImagesPendingResult | null>(null);
  const [pullingExampleHashes, setPullingExampleHashes] = useState<string[]>([]);
  const [featureModal, setFeatureModal] = useState<{ title: string; body: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [triggerWords, setTriggerWords] = useState<Record<string, string[]>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notificationLog, setNotificationLog] = useState<Toast[]>([]);
  const [showXyzHelp, setShowXyzHelp] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [showPromptSidebar, setShowPromptSidebar] = useState(false);

  const [progress, setProgress] = useState<ProgressState>({
    running: false,
    value: 0,
    max: 1,
    label: "空闲",
  });
  const [activeTaskLabel, setActiveTaskLabel] = useState("");
  const [results, setResults] = useState<JobResult[]>([]);
  const [error, setError] = useState("");
  const [xyzTarget, setXyzTarget] = useLocalStorageState<TemplateKind>("comfyui_xyz_target", "default");
  function getXyzLoras() {
    switch (xyzTarget) {
      case "default": return defaultParams.loras;
      case "multi": return multiParams.loras;
      case "highres": return highresParams.loras;
      default: return [];
    }
  }
  const [xyzAxes, setXyzAxes] = useLocalStorageState<XyzAxis[]>("comfyui_xyz_axes", [
    { enabled: true, field: "seed", values: "1,2" },
    { enabled: false, field: "cfg", values: "5,7" },
    { enabled: false, field: "steps", values: "20..30..10" },
  ]);
  const [xyzExcludedIndices, setXyzExcludedIndices] = useState<Set<number>>(new Set());
  const [xyzResults, setXyzResults] = useState<XyzRunItem[]>([]);
  const examplePollRef = useRef<number | null>(null);
  const loraLoadingRef = useRef(false);
  const xyzCancelRef = useRef(false);
  const selectedLoraItems = useMemo(
    () => loraResult.items.filter((item) => selectedLoraPaths.includes(item.file_path)),
    [loraResult.items, selectedLoraPaths],
  );
  const baseDocTitleRef = useRef(document.title);
  useEffect(() => {
    if (progress.running) {
      const percent = progress.max > 0 ? Math.round((progress.value / progress.max) * 100) : 0;
      let prefix = `${percent}%`;
      if (progress.batch) {
        prefix = `[${progress.batch.current}/${progress.batch.total}] ${prefix}`;
      }
      const taskPart = activeTaskLabel ? ` | ${activeTaskLabel}` : "";
      document.title = `${prefix}${taskPart} - ${baseDocTitleRef.current}`;
    } else if (document.title !== baseDocTitleRef.current) {
      document.title = baseDocTitleRef.current;
    }
  }, [progress.running, progress.value, progress.max, progress.batch, activeTaskLabel]);

  function pushToast(type: Toast["type"], title: string, message?: string) {
    const toast: Toast = { id: crypto.randomUUID(), type, title, message };
    setNotificationLog((prev) => [toast, ...prev].slice(0, 80));
    setToasts((prev) => [...prev, toast].slice(-5));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== toast.id));
    }, type === "error" ? 5200 : 3600);
  }

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const [stats, checkpointInfo, ksamplerInfo, wdInfo, clInfo, detectorInfo, upscaleInfo, drawTextInfo, managerSettings] = await Promise.all([
          client.getSystemStats(),
          client.getObjectInfo("CheckpointLoaderSimple"),
          client.getObjectInfo("KSampler"),
          client.getObjectInfo("WD14Tagger|pysssss").catch(() => null),
          client.getObjectInfo("cl_tagger_mira").catch(() => null),
          client.getObjectInfo("UltralyticsDetectorProvider").catch(() => null),
          client.getObjectInfo("LatentUpscaleBy").catch(() => null),
          client.getObjectInfo("DrawTextAdvanced").catch(() => null),
          client.getLoraManagerSettings().catch(() => defaultLoraManagerSettings),
        ]);
        if (canceled) return;
        const nextOptions = {
          checkpoints: readCombo(checkpointInfo, "CheckpointLoaderSimple", "ckpt_name", fallbackOptions.checkpoints),
          samplers: readCombo(ksamplerInfo, "KSampler", "sampler_name", fallbackOptions.samplers),
          schedulers: readCombo(ksamplerInfo, "KSampler", "scheduler", fallbackOptions.schedulers),
          wdModels: wdInfo ? readCombo(wdInfo, "WD14Tagger|pysssss", "model", fallbackOptions.wdModels) : fallbackOptions.wdModels,
          wdDevices: wdInfo ? readCombo(wdInfo, "WD14Tagger|pysssss", "device", fallbackOptions.wdDevices) : fallbackOptions.wdDevices,
          clModels: clInfo ? readCombo(clInfo, "cl_tagger_mira", "model_name", fallbackOptions.clModels) : fallbackOptions.clModels,
          detectors: detectorInfo ? readCombo(detectorInfo, "UltralyticsDetectorProvider", "model_name", fallbackOptions.detectors) : fallbackOptions.detectors,
          upscaleMethods: upscaleInfo ? readCombo(upscaleInfo, "LatentUpscaleBy", "upscale_method", fallbackOptions.upscaleMethods) : fallbackOptions.upscaleMethods,
          fonts: drawTextInfo ? readCombo(drawTextInfo, "DrawTextAdvanced", "font", fallbackOptions.fonts) : fallbackOptions.fonts,
        };
        setOptions(nextOptions);
        const managerSettingsResult = managerSettings as LoraManagerSettings & { settings?: LoraManagerSettings };
        const finalSettings = normalizeLoraManagerSettings(managerSettingsResult.settings ?? managerSettingsResult);
        setLoraSettings(finalSettings);
        
        // Enforce onboarding / setting the example images directory on first launch
        if (finalSettings.onboarding_completed !== true || !finalSettings.example_images_path) {
          setLoraOperation({ type: "settings" });
        }

        const system = stats as { system?: { comfyui_version?: string }; devices?: Array<{ name: string }> };
        const firstCheckpoint = nextOptions.checkpoints[0] ?? "";
        setDefaultParams((prev) => ({ ...prev, checkpoint: nextOptions.checkpoints.includes(prev.checkpoint) ? prev.checkpoint : firstCheckpoint }));
        setMultiParams((prev) => ({ ...prev, checkpoint: nextOptions.checkpoints.includes(prev.checkpoint) ? prev.checkpoint : firstCheckpoint }));
        setHighresParams((prev) => ({
          ...prev,
          checkpoint: nextOptions.checkpoints.includes(prev.checkpoint) ? prev.checkpoint : firstCheckpoint,
          handDetector: nextOptions.detectors.includes(prev.handDetector) ? prev.handDetector : (nextOptions.detectors.find((item) => item.includes("hand")) ?? ""),
          faceDetector: nextOptions.detectors.includes(prev.faceDetector) ? prev.faceDetector : (nextOptions.detectors.find((item) => item.includes("face")) ?? ""),
          eyesDetector: nextOptions.detectors.includes(prev.eyesDetector) ? prev.eyesDetector : (nextOptions.detectors.find((item) => item.includes("Eye") || item.includes("eye")) ?? (prev.eyesDetector || "bbox/Eyeful_v2-Individual.pt")),
          nsfwDetector: nextOptions.detectors.includes(prev.nsfwDetector) ? prev.nsfwDetector : (nextOptions.detectors.find((item) => item.includes("nsfw")) ?? (prev.nsfwDetector || "segm/ntd11_anime_nsfw_segm_v5-variant1.pt")),
        }));
        setWd14((prev) => ({ ...prev, model: nextOptions.wdModels.includes(prev.model) ? prev.model : (nextOptions.wdModels[0] ?? "") }));
        setWdBatchParams((prev) => ({ ...prev, model: nextOptions.wdModels.includes(prev.model) ? prev.model : (nextOptions.wdModels[0] ?? "") }));
        setClBatchParams((prev) => ({ ...prev, modelName: nextOptions.clModels.includes(prev.modelName) ? prev.modelName : (nextOptions.clModels[0] ?? "") }));
      } catch (loadError) {
        if (canceled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        pushToast("error", "连接失败", loadError instanceof Error ? loadError.message : String(loadError));
      }
    }
    load();
    return () => {
      canceled = true;
    };
  }, [client]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshLoras(loraQuery).catch((loadError) => {
        pushToast("error", "LoRA 列表加载失败", loadError instanceof Error ? loadError.message : String(loadError));
      });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [client, managedModelType, loraQuery.search, loraQuery.folder, loraQuery.baseModel, loraQuery.tag, loraQuery.pageSize]);

  useEffect(() => {
    if (tab !== "loras") return;
    refreshExampleImageInfo().catch((infoError) => {
      pushToast("error", "示例图状态读取失败", infoError instanceof Error ? infoError.message : String(infoError));
    });
  }, [client, tab, managedModelType]);

  const allRelevantHashes = useMemo(() => {
    const selectedHashes = [
      ...defaultParams.loras,
      ...multiParams.loras,
      ...highresParams.loras,
    ].map((l) => l.sha256?.toLowerCase()).filter((h): h is string => Boolean(h));

    return uniqueStrings([
      ...loraResult.items.map((item) => item.sha256?.toLowerCase()).filter((h): h is string => Boolean(h)),
      ...selectedHashes,
    ]);
  }, [loraResult.items, defaultParams.loras, multiParams.loras, highresParams.loras]);

  useEffect(() => {
    let canceled = false;
    const missingHashes = allRelevantHashes.filter((hash) => !(hash in loraExampleFilesByHash));
    if (missingHashes.length === 0) return;

    async function loadLocalExampleFiles() {
      const entries = await Promise.all(
        missingHashes.map(async (hash) => {
          const files = await client.getLoraExampleFiles(hash).catch(() => []);
          return [hash, files] as const;
        }),
      );
      if (canceled) return;
      setLoraExampleFilesByHash((prev) => {
        const next = { ...prev };
        for (const [hash, files] of entries) {
          next[hash] = files;
        }
        return next;
      });
    }

    loadLocalExampleFiles();
    return () => {
      canceled = true;
    };
  }, [client, allRelevantHashes, loraExampleFilesByHash]);

  useEffect(() => {
    return () => {
      stopExampleStatusPolling();
    };
  }, []);

  const loadManagedModelsPage = useCallback(async (
    modelType: ManagedModelType,
    query: LoraQueryState,
    pageNumber: number,
    options: { append: boolean; reloadFacets: boolean },
  ) => {
    if (loraLoadingRef.current) return;
    loraLoadingRef.current = true;
    setLoraLoading(true);
    setError("");
    try {
      const pagePromise = client.listManagedModels(modelType, { ...query, page: pageNumber });
      const facetsPromise = options.reloadFacets
        ? Promise.all([
          client.getManagedModelFolders(modelType),
          client.getManagedModelBaseModels(modelType),
          client.getManagedModelTopTags(modelType),
        ])
        : Promise.resolve<[string[], Array<{ name: string; count: number }>, string[]]>([loraFoldersRef.current, loraBaseModelsRef.current, loraTagsRef.current]);
      const [page, [folders, baseModels, tags]] = await Promise.all([pagePromise, facetsPromise]);
      setLoraResult((prev) => options.append
        ? { ...page, items: mergeManagedModelItems(prev.items, page.items) }
        : page);
      if (options.reloadFacets) {
        setLoraFolders(folders);
        setLoraBaseModels(baseModels);
        setLoraTags(tags);
        setSelectedLoraPaths([]);
      }
    } finally {
      loraLoadingRef.current = false;
      setLoraLoading(false);
    }
  }, [client]);

  const refreshLoras = useCallback(async (query = loraQueryRef.current) => {
    await loadManagedModelsPage(managedModelType, query, 1, { append: false, reloadFacets: true });
  }, [managedModelType, loadManagedModelsPage]);

  const loadMoreManagedModels = useCallback(async () => {
    const currentResult = loraResultRef.current;
    if (loraLoadingRef.current || currentResult.page >= currentResult.totalPages) return;
    await loadManagedModelsPage(managedModelType, loraQueryRef.current, currentResult.page + 1, { append: true, reloadFacets: false });
  }, [managedModelType, loadManagedModelsPage]);

  async function refreshExampleImageInfo() {
    const [status, pending] = await Promise.all([
      client.getExampleImagesStatus(),
      client.checkExampleImagesNeeded([managedModelExampleType(managedModelType)]),
    ]);
    setExampleStatus(status);
    setExamplePending(pending);
    if (status.is_downloading) {
      startExampleStatusPolling();
    }
  }

  function stopExampleStatusPolling() {
    if (examplePollRef.current !== null) {
      window.clearInterval(examplePollRef.current);
      examplePollRef.current = null;
    }
  }

  function startExampleStatusPolling() {
    stopExampleStatusPolling();
    const tick = async () => {
      try {
        const status = await client.getExampleImagesStatus();
        setExampleStatus(status);
        if (!status.is_downloading) {
          stopExampleStatusPolling();
          if (status.status.status === "completed") {
            pushToast("success", "示例图拉取完成", `${status.status.completed}/${status.status.total} 个模型已处理`);
            setLoraExampleFilesByHash({});
            refreshLoras().catch(() => undefined);
            refreshExampleImageInfo().catch(() => undefined);
          }
          if (status.status.status === "error") {
            pushToast("error", "示例图拉取失败", status.status.last_error ?? "插件下载任务返回错误");
          }
        }
      } catch (statusError) {
        stopExampleStatusPolling();
        pushToast("error", "示例图状态读取失败", statusError instanceof Error ? statusError.message : String(statusError));
      }
    };
    tick();
    examplePollRef.current = window.setInterval(tick, 2200);
  }

  const pullAllLoraExamples = useCallback(async () => {
    setError("");
    try {
      setLoraExampleFilesByHash({});
      pushToast("info", "一键拉取已提交", "将自动跳过本地已有的示例图");
      const result = await client.downloadExampleImages({ force: false, optimize: false, modelTypes: [managedModelExampleType(managedModelType)] });
      if (!result.success) {
        throw new Error(result.error || "插件没有启动示例图拉取");
      }
      if (result.status) {
        setExampleStatus({ success: true, is_downloading: true, status: result.status });
      }
      startExampleStatusPolling();
    } catch (pullError) {
      const message = pullError instanceof Error ? pullError.message : String(pullError);
      setError(message);
      pushToast("error", "一键拉取失败", message);
    }
  }, [client, managedModelType]);

  async function pullLoraExamples(item: LoraItem): Promise<LoraExampleMedia[]> {
    const hash = item.sha256?.toLowerCase();
    if (!hash) {
      pushToast("error", "无法拉取示例图", "该 LoRA 没有 SHA256");
      return [];
    }

    setPullingExampleHashes((prev) => uniqueStrings([...prev, hash]));
    try {
      pushToast("info", "单独拉取已开始", item.model_name || item.file_name);
      setExampleStatus({
        success: true,
        is_downloading: true,
        status: {
          total: 1,
          completed: 0,
          current_model: item.model_name || item.file_name || hash,
          status: "running",
          errors: [],
          last_error: null,
          processed_models: [],
          refreshed_models: [],
          failed_models: [],
          reprocessed_models: [],
        },
      });
      startExampleStatusPolling();
      if (item.file_path) {
        await client.refreshManagedModelCivitaiMetadata(managedModelType, item.file_path).catch((metadataError) => {
          pushToast("info", "元数据刷新未完成", metadataError instanceof Error ? metadataError.message : String(metadataError));
        });
      }
      const result = await client.forceDownloadExampleImages([hash], { optimize: false, modelTypes: [managedModelExampleType(managedModelType)], items: [item] });
      if (!result.success) {
        throw new Error(result.error || "插件没有完成单独拉取");
      }
      const files = await client.getLoraExampleFiles(hash);
      setLoraExampleFilesByHash((prev) => ({ ...prev, [hash]: files }));
      await refreshLoras();
      await refreshExampleImageInfo();
      setExampleStatus({
        success: true,
        is_downloading: false,
        status: {
          total: 1,
          completed: 1,
          current_model: item.model_name || item.file_name || hash,
          status: "completed",
          errors: [],
          last_error: null,
          processed_models: [hash],
          refreshed_models: [],
          failed_models: [],
          reprocessed_models: [],
        },
      });
      pushToast(files.length ? "success" : "info", "单独拉取完成", files.length ? `已读取 ${files.length} 个示例媒体` : "插件没有返回新的示例媒体");
      return files;
    } catch (pullError) {
      const message = pullError instanceof Error ? pullError.message : String(pullError);
      setExampleStatus({
        success: false,
        is_downloading: false,
        status: {
          total: 1,
          completed: 0,
          current_model: item.model_name || item.file_name || hash,
          status: "error",
          errors: [message],
          last_error: message,
          processed_models: [],
          refreshed_models: [],
          failed_models: [hash],
          reprocessed_models: [],
        },
        error: message,
      });
      pushToast("error", "单独拉取失败", message);
      return [];
    } finally {
      setPullingExampleHashes((prev) => prev.filter((value) => value !== hash));
    }
  }

  async function openLoraExampleFolder(item: LoraItem) {
    const hash = item.sha256?.toLowerCase();
    if (!hash) {
      pushToast("error", "无法打开目录", "该 LoRA 没有 SHA256");
      return;
    }
    try {
      const result = await client.openExampleImagesFolder(hash);
      if (!result.success) {
        throw new Error(result.error || "插件没有返回目录");
      }
      if (result.uri) {
        window.open(result.uri, "_blank", "noopener,noreferrer");
      }
      if (result.mode === "clipboard" && result.path) {
        navigator.clipboard?.writeText(result.path);
        pushToast("success", "示例图目录已复制", result.path);
      } else {
        pushToast("success", "示例图目录已打开", result.path || result.uri);
      }
    } catch (openError) {
      pushToast("error", "打开示例图目录失败", openError instanceof Error ? openError.message : String(openError));
    }
  }

  async function runPrompt(
    label: string,
    promptFactory: () => ReturnType<typeof buildDefaultPrompt>,
    onProgress: (progress: ProgressState) => void = (prog) => setProgress(prog),
    taskLabel?: string,
  ) {
    setError("");
    setActiveTaskLabel(taskLabel || label);
    try {
      onProgress({ running: true, value: 0, max: 1, label: `${label} 准备中` });
      pushToast("info", `${label} 已提交`, "正在等待 ComfyUI 执行");
      const result = await client.runPrompt(promptFactory(), onProgress);
      setResults((prev) => [result, ...prev].slice(0, 24));
      pushToast("success", `${label} 完成`, result.images.length ? `输出 ${result.images.length} 张图片` : undefined);
      return result;
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setError(message);
      onProgress({ running: false, value: 0, max: 1, label: "失败" });
      pushToast("error", `${label} 失败`, message);
      throw runError;
    }
  }

  async function runBatchTagger(type: "cl" | "wd") {
    setError("");
    setActiveTaskLabel(type === "cl" ? "CL 批量打标" : "WD 批量打标");
    const params = type === "cl" ? clBatchParams : wdBatchParams;
    try {
      pushToast("info", "批量打标已启动", `计划处理 ${params.runCount} 张`);
      let successCount = 0;
      for (let i = 0; i < params.runCount; i++) {
        if (xyzCancelRef.current) break;
        const prompt = type === "cl" 
          ? buildClBatchPrompt(clBatchParams, i)
          : buildWdBatchPrompt(wdBatchParams, i);
        
        await client.runPrompt(prompt, setProgress);
        successCount++;
      }
      pushToast("success", "批量打标完成", `成功处理 ${successCount} 张`);
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setError(message);
      pushToast("error", "批量打标失败", message);
    }
  }

  async function runWd14() {
    setError("");
    setActiveTaskLabel("WD1.4");
    try {
      if (!wdFile && !wd14.imageName) {
        throw new Error("请先选择一张图片");
      }
      let imageName = wd14.imageName;
      if (wdFile) {
        const uploaded = await client.uploadImage(wdFile);
        imageName = uploaded.name;
        setWd14((prev) => ({ ...prev, imageName }));
      }
      const result = await client.runPrompt(buildWd14Prompt({ ...wd14, imageName }), setProgress);
      setResults((prev) => [result, ...prev].slice(0, 24));
      setWdTags(result.texts.join("\n"));
      pushToast("success", "WD1.4 识别完成", result.texts.length ? "标签已写入输出框" : "任务已完成");
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setError(message);
      pushToast("error", "WD1.4 识别失败", message);
    }
  }

  async function runClSingle() {
    setError("");
    setActiveTaskLabel("CL 单图识别");
    try {
      if (!clFile && !clSingleParams.imageName) {
        throw new Error("请先选择一张图片");
      }
      let imageName = clSingleParams.imageName;
      if (clFile) {
        const uploaded = await client.uploadImage(clFile);
        imageName = uploaded.name;
        setClSingleParams((prev) => ({ ...prev, imageName }));
      }
      const result = await client.runPrompt(buildClSinglePrompt({ ...clSingleParams, imageName }), setProgress);
      setResults((prev) => [result, ...prev].slice(0, 24));
      setWdTags(result.texts.join("\n"));
      pushToast("success", "CL 单图识别完成", result.texts.length ? "标签已写入输出框" : "任务已完成");
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setError(message);
      pushToast("error", "CL 单图识别失败", message);
    }
  }

  function buildXyzPrompt(combo: Pick<XyzRunItem, "label" | "patch">) {
    if (xyzTarget === "multi") {
      const patched = applySpecialXyzPatch(multiParams, combo);
      const promptAppend = combo.patch.positivePrompt;
      return buildMultiPrompt({
        ...patched,
        globalPrompt: promptAppend ? [multiParams.globalPrompt, promptAppend].filter(Boolean).join("\n") : patched.globalPrompt,
      });
    }
    if (xyzTarget === "highres") {
      return buildHighresPrompt(applySpecialXyzPatch(highresParams, combo));
    }
    return buildDefaultPrompt(applySpecialXyzPatch(defaultParams, combo));
  }

  async function runXyzItems(items: XyzRunItem[], reset = false) {
    setError("");
    setActiveTaskLabel("XYZ 控制器");
    xyzCancelRef.current = false;
    if (reset) {
      setXyzResults(items);
    }

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (xyzCancelRef.current) {
        setXyzResults((prev) => prev.map((entry) => entry.id === item.id && entry.status === "queued" ? { ...entry, status: "cancelled" } : entry));
        continue;
      }

      const batch = { current: index + 1, total: items.length, itemLabel: item.label };
      setProgress({
        running: true,
        value: index,
        max: items.length,
        label: `XYZ ${index + 1}/${items.length}`,
        batch,
      });

      setXyzResults((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: "running", error: undefined } : entry));

      try {
        const result = await client.runPrompt(
          buildXyzPrompt(item),
          (prog) => setProgress({ ...prog, batch })
        );
        setXyzResults((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: "success", result } : entry));
        // 同步更新全局输出面板，让图片显示在右侧
        setResults((prev) => [result, ...prev].slice(0, 24));
      } catch (runError) {
        const message = runError instanceof Error ? runError.message : String(runError);
        setXyzResults((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: "failed", error: message } : entry));
        pushToast("error", `XYZ 组合失败：${item.label}`, message);
      }
    }

    setProgress({
      running: false,
      value: 1,
      max: 1,
      label: "XYZ 完成",
      batch: { current: items.length, total: items.length, itemLabel: "" },
    });
    pushToast("success", "XYZ 执行结束", `已处理 ${items.length} 个组合`);
  }

  async function runXyz() {
    const combos = buildXyzCombinations(xyzAxes, getXyzLoras(), xyzExcludedIndices);
    if (!combos.length) {
      pushToast("error", "XYZ 无法运行", "至少需要启用一个轴并填写取值，且不能全部被排除");
      return;
    }
    const items = combos.map((combo) => ({
      id: crypto.randomUUID(),
      label: combo.label,
      patch: combo.patch,
      status: "queued" as const,
      comboIndex: combo.originalIndex,
    }));
    await runXyzItems(items, true);
  }

  function stopXyzQueue() {
    xyzCancelRef.current = true;
    client.interrupt(progress.promptId).catch(() => undefined);
    setProgress((prev) => ({ ...prev, running: false, label: "XYZ 已中断" }));
    pushToast("info", "XYZ 队列已请求中断");
  }

  async function rerunXyzItem(item: XyzRunItem) {
    await runXyzItems([{ ...item, id: crypto.randomUUID(), status: "queued", result: undefined, error: undefined }], true);
  }

  async function retryFailedXyz() {
    const failed = xyzResults.filter((item) => item.status === "failed");
    if (!failed.length) {
      pushToast("info", "没有失败组合", "当前 XYZ 结果里没有需要重试的组合");
      return;
    }
    const items = failed.map((item) => ({ ...item, id: crypto.randomUUID(), status: "queued" as const, result: undefined, error: undefined }));
    await runXyzItems(items, true);
  }

  function exportXyzResults() {
    const payload = {
      exportedAt: new Date().toISOString(),
      target: xyzTarget,
      axes: xyzAxes,
      items: xyzResults.map((item) => ({
        label: item.label,
        status: item.status,
        patch: item.patch,
        error: item.error,
        promptId: item.result?.promptId,
        images: item.result?.images ?? [],
        texts: item.result?.texts ?? [],
      })),
    };
    downloadTextFile(`xyz-results-${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json");
    pushToast("success", "XYZ 结果已导出", "已生成 JSON manifest");
  }

  async function exportXyzGrid() {
    const drawableItems = xyzResults.filter((item) => item.status === "success" && item.result?.images[0]);
    if (drawableItems.length === 0) {
      pushToast("info", "没有可导出的结果", "网格中没有成功的生成图像");
      return;
    }
    pushToast("info", "正在生成网格", "请稍候...");

    const lorasOfTarget = getXyzLoras();
    const activeAxes = xyzAxes.filter((axis) => axis.enabled && axis.values.trim());
    const lastAxis = activeAxes[activeAxes.length - 1];
    const lastAxisValues = lastAxis ? parseAxisValues(lastAxis.values, lastAxis.field) : [];
    const cols = lastAxisValues.length > 0 ? lastAxisValues.length : 1;

    const slotOf = (item: XyzRunItem) => (typeof item.comboIndex === "number" ? item.comboIndex : xyzResults.indexOf(item));
    const total = Math.max(...xyzResults.map((item) => slotOf(item))) + 1;
    const rows = Math.ceil(total / cols);

    try {
      const imagesBySlot = new Map<number, HTMLImageElement>();
      await Promise.all(
        drawableItems.map(
          (item) =>
            new Promise<void>((resolve, reject) => {
              const img = new Image();
              img.crossOrigin = "anonymous";
              img.onload = () => {
                imagesBySlot.set(slotOf(item), img);
                resolve();
              };
              img.onerror = () => reject(new Error(`加载图像失败: ${item.label}`));
              img.src = item.result!.images[0].url;
            }),
        ),
      );

      const itemsBySlot = new Map<number, XyzRunItem>();
      xyzResults.forEach((item) => itemsBySlot.set(slotOf(item), item));
      const combos = buildXyzCombinations(xyzAxes, lorasOfTarget);
      const labelOfSlot = (slot: number) => itemsBySlot.get(slot)?.label ?? combos[slot]?.label ?? "";

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建 canvas 绘图上下文");
      const fontStack = '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';

      const cellW = Math.max(...[...imagesBySlot.values()].map((img) => img.width));
      const cellH = Math.max(...[...imagesBySlot.values()].map((img) => img.height));
      const fontSize = Math.min(30, Math.max(18, Math.round(cellW / 26)));
      const headerFontSize = Math.min(24, Math.max(16, Math.round(cellW / 34)));
      const gap = 14;
      const margin = 28;
      const fontLineH = Math.round(fontSize * 1.45);
      const headerLineH = Math.round(headerFontSize * 1.4);

      // 文件路径类的值只保留文件名，避免标签过长被截断
      const prettyValue = (value: string | number) => {
        const text = String(value);
        if (/[\\/]/.test(text) && /\.[A-Za-z0-9]{2,16}$/.test(text)) {
          return text.split(/[\\/]/).pop() || text;
        }
        return text;
      };
      const prettyLabel = (label: string) =>
        label
          .split(" / ")
          .map((segment) => {
            const eq = segment.indexOf("=");
            return eq > 0 ? `${segment.slice(0, eq + 1)}${prettyValue(segment.slice(eq + 1))}` : segment;
          })
          .join(" / ");

      const wrapWidth = (text: string, maxWidth: number) => {
        const lines: string[] = [];
        let current = "";
        for (const ch of text) {
          if (current && ctx.measureText(current + ch).width > maxWidth) {
            lines.push(current);
            current = ch;
          } else {
            current += ch;
          }
        }
        if (current) lines.push(current);
        return lines;
      };
      const wrapLabel = (label: string, maxWidth: number, maxLines: number) => {
        const lines = label.split(" / ").flatMap((segment) => wrapWidth(segment, maxWidth));
        if (lines.length <= maxLines) return lines;
        const kept = lines.slice(0, maxLines);
        let last = kept[maxLines - 1];
        while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
          last = last.slice(0, -1);
        }
        kept[maxLines - 1] = `${last}…`;
        return kept;
      };

      ctx.font = `600 ${fontSize}px ${fontStack}`;
      const cellLabelLines = new Map<number, string[]>();
      let maxCellLabelLines = 1;
      for (let slot = 0; slot < total; slot += 1) {
        const lines = wrapLabel(prettyLabel(labelOfSlot(slot)), cellW - 24, 2);
        cellLabelLines.set(slot, lines);
        maxCellLabelLines = Math.max(maxCellLabelLines, lines.length);
      }
      const labelH = fontLineH * maxCellLabelLines + 16;
      const cellTotalH = cellH + labelH;

      ctx.font = `600 ${headerFontSize}px ${fontStack}`;
      const rowHeaderOf = (row: number) => {
        const parts = prettyLabel(labelOfSlot(row * cols)).split(" / ");
        return parts.length > 1 ? parts.slice(0, -1).join(" / ") : "";
      };
      const rowHeaderMaxLines = Math.max(2, Math.min(6, Math.floor((cellTotalH - 16) / headerLineH)));
      const rowHeaders = Array.from({ length: rows }, (_, row) => rowHeaderOf(row));
      const hasRowHeaders = rowHeaders.some(Boolean);
      const rowHeaderW = hasRowHeaders
        ? Math.min(
            340,
            Math.max(
              ...rowHeaders
                .filter(Boolean)
                .flatMap((header) => wrapLabel(header, 328, rowHeaderMaxLines))
                .map((line) => ctx.measureText(line).width),
            ) + 24,
          )
        : 0;
      const rowHeaderLines = rowHeaders.map((header) => (header ? wrapLabel(header, rowHeaderW - 12, rowHeaderMaxLines) : []));

      const colHeaders = lastAxisValues.map((value) => `${fieldLabel(lastAxis.field, lorasOfTarget)}=${prettyValue(value)}`);
      const colHeaderLines = colHeaders.map((header) => wrapLabel(header, cellW, 2));
      const maxColHeaderLines = Math.max(1, ...colHeaderLines.map((lines) => lines.length));
      const colHeaderH = colHeaders.length ? headerLineH * maxColHeaderLines + 18 : 0;
      const titleH = 96;
      const gridW = cols * cellW + (cols - 1) * gap;
      const gridH = rows * cellTotalH + (rows - 1) * gap;
      canvas.width = margin * 2 + rowHeaderW + (hasRowHeaders ? gap : 0) + gridW;
      canvas.height = margin + titleH + colHeaderH + (colHeaderH ? gap : 0) + gridH + margin;

      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const fitText = (text: string, maxWidth: number) => {
        if (!text || ctx.measureText(text).width <= maxWidth) return text;
        let truncated = text;
        while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
          truncated = truncated.slice(0, -1);
        }
        return `${truncated}…`;
      };

      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      const title = `XYZ 网格 · ${templateLabels[xyzTarget]} · ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#e2e8f0";
      ctx.font = `700 30px ${fontStack}`;
      ctx.fillText(title, margin, margin + 38);
      const subtitle = activeAxes
        .map((axis) => `${fieldLabel(axis.field, lorasOfTarget)}: ${axis.values.replace(/[\n,]+/g, ",").trim()}`)
        .join(" ｜ ");
      if (subtitle) {
        ctx.fillStyle = "#8ea0b8";
        ctx.font = `400 18px ${fontStack}`;
        ctx.fillText(fitText(subtitle, canvas.width - margin * 2), margin, margin + 70);
      }

      const gridTop = margin + titleH + colHeaderH + (colHeaderH ? gap : 0);
      const gridLeft = margin + rowHeaderW + (hasRowHeaders ? gap : 0);

      if (colHeaders.length) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#93c5fd";
        ctx.font = `600 ${headerFontSize}px ${fontStack}`;
        colHeaderLines.forEach((lines, c) => {
          const centerX = gridLeft + c * (cellW + gap) + cellW / 2;
          const startY = margin + titleH + (colHeaderH - (lines.length - 1) * headerLineH) / 2;
          lines.forEach((line, i) => ctx.fillText(line, centerX, startY + i * headerLineH));
        });
      }

      if (hasRowHeaders) {
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#93c5fd";
        ctx.font = `600 ${headerFontSize}px ${fontStack}`;
        rowHeaderLines.forEach((lines, r) => {
          if (!lines.length) return;
          const centerY = gridTop + r * (cellTotalH + gap) + cellH / 2;
          const startY = centerY - ((lines.length - 1) * headerLineH) / 2;
          lines.forEach((line, i) => ctx.fillText(line, margin + rowHeaderW - 6, startY + i * headerLineH));
        });
      }

      for (let slot = 0; slot < total; slot += 1) {
        const c = slot % cols;
        const r = Math.floor(slot / cols);
        const x = gridLeft + c * (cellW + gap);
        const y = gridTop + r * (cellTotalH + gap);

        ctx.fillStyle = "#141d2c";
        ctx.fillRect(x, y, cellW, cellTotalH);
        ctx.strokeStyle = "#263349";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellTotalH - 1);

        const img = imagesBySlot.get(slot);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (img) {
          const pad = 8;
          const scale = Math.min((cellW - pad * 2) / img.width, (cellH - pad * 2) / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, x + (cellW - w) / 2, y + (cellH - h) / 2, w, h);
        } else {
          const status = itemsBySlot.get(slot)?.status;
          ctx.fillStyle = status === "failed" ? "#f87171" : "#5b6b82";
          ctx.font = `600 ${Math.max(16, Math.round(fontSize * 0.85))}px ${fontStack}`;
          ctx.fillText(status ? `✕ ${xyzStatusLabel(status)}` : "—", x + cellW / 2, y + cellH / 2);
        }

        ctx.fillStyle = "#0e1524";
        ctx.fillRect(x + 1, y + cellH, cellW - 2, labelH);
        ctx.fillStyle = "#dbeafe";
        ctx.font = `600 ${fontSize}px ${fontStack}`;
        const lines = cellLabelLines.get(slot) ?? [];
        const labelStartY = y + cellH + (labelH - (lines.length - 1) * fontLineH) / 2;
        lines.forEach((line, i) => ctx.fillText(line, x + cellW / 2, labelStartY + i * fontLineH));
      }

      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `xyz-grid-${Date.now()}.png`;
      a.click();
      pushToast("success", "网格导出成功");
    } catch (e) {
      pushToast("error", "网格导出失败", e instanceof Error ? e.message : String(e));
    }
  }

  function handleOpenLoraDetail(lora: LoraSelection) {
    setManagedModelType("loras");
    const hash = lora.sha256?.toLowerCase();
    const fallbackPreview = hash ? (loraExampleFilesByHash[hash]?.[0]?.path || loraExampleFilesByHash[hash]?.[0]?.url) : undefined;
    
    setLoraDetail({ 
      file_path: lora.filePath || lora.name, 
      file_name: lora.name.split("/").pop() || lora.name,
      model_name: lora.displayName || lora.name.split("/").pop() || lora.name,
      preview_url: lora.previewUrl || fallbackPreview,
      file_size: 0, 
      sha256: lora.sha256 
    } as LoraItem);
  }

  const handleSidebarSelect = useCallback((text: string, type: 'positive' | 'negative' | 'combo', target: 'positive' | 'negative') => {
    if (tab === "default") {
      if (target === "positive") {
        setDefaultParams(prev => ({ ...prev, positivePrompt: prev.positivePrompt + (prev.positivePrompt ? ", " : "") + text }));
      } else {
        setDefaultParams(prev => ({ ...prev, negativePrompt: prev.negativePrompt + (prev.negativePrompt ? ", " : "") + text }));
      }
    } else if (tab === "multi") {
      if (target === "positive") {
        setMultiParams(prev => ({ ...prev, globalPrompt: prev.globalPrompt + (prev.globalPrompt ? "\n" : "") + text }));
      } else {
        setMultiParams(prev => ({ ...prev, negativePrompt: prev.negativePrompt + (prev.negativePrompt ? ", " : "") + text }));
      }
    } else if (tab === "highres") {
      if (target === "positive") {
        setHighresParams(prev => ({ ...prev, positivePrompt: prev.positivePrompt + (prev.positivePrompt ? ", " : "") + text }));
      } else {
        setHighresParams(prev => ({ ...prev, negativePrompt: prev.negativePrompt + (prev.negativePrompt ? ", " : "") + text }));
      }
    }
    pushToast("info", "提示词已添加", `${text.slice(0, 20)}...`);
  }, [tab, setDefaultParams, setMultiParams, setHighresParams]);

  const currentPrompts = useMemo(() => {
    if (tab === "multi") {
      return { positive: multiParams.globalPrompt, negative: multiParams.negativePrompt };
    } else if (tab === "highres") {
      return { positive: highresParams.positivePrompt, negative: highresParams.negativePrompt };
    }
    return { positive: defaultParams.positivePrompt, negative: defaultParams.negativePrompt };
  }, [tab, defaultParams, multiParams, highresParams]);

  const addLora = useCallback((item: LoraItem, strength = 1, target = loraTarget) => {
    const hash = item.sha256?.toLowerCase();
    const localFiles = hash ? loraExampleFilesByHashRef.current[hash] ?? EMPTY_ARRAY : EMPTY_ARRAY;
    const previewMedia = pickCardPreviewMedia(item, localFiles);
    const selection: LoraSelection = {
      name: loraSyntaxName(item),
      displayName: item.model_name,
      strength,
      clipStrength: strength,
      active: true,
      filePath: item.file_path,
      sha256: item.sha256,
      previewUrl: previewMedia.path || previewMedia.url || item.preview_url,
    };
    if (target === "multi") {
      setMultiParams((prev) => ({ ...prev, loras: mergeLora(prev.loras, selection) }));
    } else if (target === "highres") {
      setHighresParams((prev) => ({ ...prev, loras: mergeLora(prev.loras, selection) }));
    } else {
      setDefaultParams((prev) => ({ ...prev, loras: mergeLora(prev.loras, selection) }));
    }
    pushToast("success", "LoRA 已插入", `${selection.name} -> ${templateLabels[target]}`);
  }, [loraTarget]);

  const handleLoraInsert = useCallback((item: LoraItem, target: TemplateKind) => {
    addLora(item, 1, target);
  }, [addLora]);

  function addTriggerWords(words: string[], target = loraTarget) {
    if (!words || words.length === 0) return;
    const text = words.join(", ");
    if (target === "multi") {
      setMultiParams((prev) => ({ ...prev, globalPrompt: prev.globalPrompt + (prev.globalPrompt ? ", " : "") + text }));
    } else if (target === "highres") {
      setHighresParams((prev) => ({ ...prev, positivePrompt: prev.positivePrompt + (prev.positivePrompt ? ", " : "") + text }));
    } else {
      setDefaultParams((prev) => ({ ...prev, positivePrompt: prev.positivePrompt + (prev.positivePrompt ? ", " : "") + text }));
    }
    pushToast("success", "触发词已应用", `已追加到 ${templateLabels[target]} 正向提示词`);
  }

  async function loadTriggerWords(item: LoraItem) {
    if (managedModelType !== "loras") return;
    const key = item.model_name || item.file_name;
    const words = await client.getLoraTriggerWords(key);
    setTriggerWords((prev) => ({ ...prev, [key]: words }));
    pushToast(words.length ? "success" : "info", "触发词已读取", words.length ? words.join(", ") : "该 LoRA 暂无触发词");
  }

  async function saveLoraTriggerWords(item: LoraItem, words: string[]) {
    if (managedModelType !== "loras") return words;
    const key = item.model_name || item.file_name;
    const cleanWords = uniqueStrings(words.map((word) => word.trim()).filter(Boolean));
    const nextCivitai = {
      ...((item.civitai as Record<string, unknown> | undefined) ?? {}),
      trainedWords: cleanWords,
    };
    try {
      const result = await client.saveLoraTriggerWords(item.file_path, cleanWords);
      if (result.success === false) {
        throw new Error(result.error || "Trigger words save failed");
      }
      setTriggerWords((prev) => ({ ...prev, [key]: cleanWords }));
      updateLoraItem(item.file_path, { civitai: nextCivitai });
      pushToast("success", "触发词已同步", cleanWords.length ? cleanWords.join(", ") : "已清空触发词");
      return cleanWords;
    } catch (error) {
      pushToast("error", "触发词同步失败", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  function updateLoraItem(filePath: string, patch: Partial<LoraItem>) {
    setLoraResult((prev) => ({
      ...prev,
      items: prev.items.map((item) => item.file_path === filePath ? { ...item, ...patch } : item),
    }));
    setLoraDetail((prev) => prev?.file_path === filePath ? { ...prev, ...patch } : prev);
  }

  async function toggleLoraFavorite(item: LoraItem) {
    const nextFavorite = !item.favorite;
    updateLoraItem(item.file_path, { favorite: nextFavorite });
    try {
      const result = await client.setManagedModelFavorite(managedModelType, item.file_path, nextFavorite);
      if (result.success === false) {
        throw new Error(result.error || "插件没有写回收藏状态");
      }
      pushToast("success", nextFavorite ? "已收藏 LoRA" : "已取消收藏", item.model_name || item.file_name);
    } catch (favoriteError) {
      updateLoraItem(item.file_path, { favorite: item.favorite });
      pushToast("error", "收藏写回失败", favoriteError instanceof Error ? favoriteError.message : String(favoriteError));
    }
  }

  function toggleLoraSelection(item: LoraItem) {
    setSelectedLoraPaths((prev) => prev.includes(item.file_path)
      ? prev.filter((path) => path !== item.file_path)
      : [...prev, item.file_path]);
  }

  function selectVisibleLoras() {
    const visiblePaths = loraResult.items.map((item) => item.file_path);
    const allSelected = visiblePaths.every((path) => selectedLoraPaths.includes(path));
    setSelectedLoraPaths((prev) => allSelected
      ? prev.filter((path) => !visiblePaths.includes(path))
      : uniqueStrings([...prev, ...visiblePaths]));
  }

  const changeManagedModelType = useCallback((nextType: ManagedModelType) => {
    if (nextType === managedModelType) return;
    setManagedModelType(nextType);
    setLoraQuery(defaultLoraQuery);
    setLoraResult(emptyLoraResult);
    setLoraFolders([]);
    setLoraBaseModels([]);
    setLoraTags([]);
    setSelectedLoraPaths([]);
    setLoraDetail(null);
    setLoraOperation(null);
  }, [managedModelType]);

  async function refreshLoraListsAfterMutation(message?: string) {
    await refreshLoras();
    if (message) pushToast("success", message);
  }

  async function pauseExampleDownloads() {
    try {
      const result = await client.pauseExampleImages();
      if (result.success === false) throw new Error(result.error || "暂停失败");
      await refreshExampleImageInfo();
      pushToast("success", "示例图下载已暂停");
    } catch (pauseError) {
      pushToast("error", "暂停示例图失败", pauseError instanceof Error ? pauseError.message : String(pauseError));
    }
  }

  async function resumeExampleDownloads() {
    try {
      const result = await client.resumeExampleImages();
      if (result.success === false) throw new Error(result.error || "恢复失败");
      startExampleStatusPolling();
      pushToast("success", "示例图下载已恢复");
    } catch (resumeError) {
      pushToast("error", "恢复示例图失败", resumeError instanceof Error ? resumeError.message : String(resumeError));
    }
  }

  async function stopExampleDownloads() {
    try {
      const result = await client.stopExampleImages();
      if (result.success === false) throw new Error(result.error || "停止失败");
      stopExampleStatusPolling();
      await refreshExampleImageInfo();
      pushToast("success", "示例图下载已停止");
    } catch (stopError) {
      pushToast("error", "停止示例图失败", stopError instanceof Error ? stopError.message : String(stopError));
    }
  }

  return (
    <div className={isAppSidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <AppSidebar
        isCollapsed={isAppSidebarCollapsed}
        onToggle={() => setIsAppSidebarCollapsed(!isAppSidebarCollapsed)}
        activeTab={tab}
        onTabChange={setTab}
        generationTabs={generationTabs}
        toolTabs={toolTabs}
      />
      <div className="app-main">
        {showWelcome && <WelcomeModal onClose={handleCloseWelcome} />}
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
              <button type="button" className="icon-button" onClick={() => setShowPromptEditor(true)} title="提示词编辑器">
                <Sparkles size={18} />
                <span>提示词</span>
              </button>
              <button type="button" className={showPromptSidebar ? "icon-button active" : "icon-button"} onClick={() => setShowPromptSidebar(!showPromptSidebar)} title="提示词仓库">
                <Bookmark size={18} />
                <span>仓库</span>
              </button>
              <button type="button" className="icon-button" onClick={() => setLoraOperation({ type: "translator" })} title="翻译工具">
                <Languages size={18} />
              </button>
            </div>
            
            <div className="action-divider" />
            
            <div className="action-group">
              <button type="button" className="icon-button" onClick={() => setLoraOperation({ type: "notifications" })} title="通知">
                <ListFilter size={18} />
              </button>
              <button type="button" className="icon-button" onClick={() => setLoraOperation({ type: "settings" })} title="设置">
                <Settings size={18} />
              </button>
            </div>
  
            <button type="button" className="icon-button danger" onClick={() => client.interrupt(progress.promptId)} disabled={!progress.running}>
              <PauseCircle size={18} />
              <span>中断</span>
            </button>
          </div>
        </header>
      
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
              <button className="primary-action" onClick={() => window.location.reload()}>
                <RefreshCw size={18} />
                重新连接
              </button>
              <button className="secondary-action" onClick={() => setLoraOperation({ type: "settings" })}>
                <Settings size={18} />
                修改 API 地址
              </button>
            </div>
            {connection.message && <div className="error-detail">{connection.message}</div>}
          </div>
        </div>
      )}

      <PromptEditorDialog 
        open={showPromptEditor} 
        onClose={() => setShowPromptEditor(false)}
        initialPositive={defaultParams.positivePrompt}
        initialNegative={defaultParams.negativePrompt}
        onApply={(positive, negative) => {
          setDefaultParams(prev => ({ ...prev, positivePrompt: positive, negativePrompt: negative }));
        }}
      />

      {loraOperation?.type === "translator" && (
        <TranslationToolDialog
          onClose={() => setLoraOperation(null)}
          translationSettings={translationSettings}
          onToast={pushToast}
        />
      )}

      <RunProgressStrip progress={progress} />

      <div className="layout-with-sidebar">
        <div className={["layout", results.length > 0 ? "has-output" : "no-output", tab === "loras" ? "lora-full" : ""].filter(Boolean).join(" ")}>
        <main className="workspace">
          {error && <div className="error-line">{error}</div>}

          {tab === "default" && (
            <section className="panel">
              <div className="panel-header">
                <PanelTitle icon={Wand2} title="默认生图" />
              </div>
              <div className="panel-body">
                <BaseControls 
                  params={defaultParams} 
                  options={options} 
                  setParams={setDefaultParams} 
                  apiBase={apiBase} 
                  settings={loraSettings}
                  localExampleFilesByHash={loraExampleFilesByHash}
                  onLoraDetail={handleOpenLoraDetail} 
                />
              </div>
              <div className="panel-footer" style={{ display: "flex", gap: "8px" }}>
                <button className="primary-action" style={{ flex: 1 }} type="button" onClick={() => runPrompt("默认生图", () => buildDefaultPrompt(defaultParams))}>
                  <Wand2 size={18} />
                  开始生成
                </button>
                <button 
                  type="button" 
                  onClick={() => setSimpleLoraTarget("default")}
                  title="添加 LoRA"
                  style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "center",
                    gap: "6px", 
                    padding: "0 16px",
                    backgroundColor: "var(--bg-panel, #2a2a2a)",
                    color: "var(--text-primary, #eaeaea)",
                    border: "1px solid var(--border-color, #444)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "13px",
                    transition: "all 0.2s ease"
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = "#333";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--bg-panel, #2a2a2a)";
                  }}
                >
                  <Plus size={16} /> 添加 LoRA
                </button>
                <button 
                  type="button" 
                  onClick={() => {
                    setHighresParams(prev => ({
                      ...prev,
                      positivePrompt: defaultParams.positivePrompt,
                      negativePrompt: defaultParams.negativePrompt,
                      loras: [...defaultParams.loras]
                    }));
                    setTab("highres");
                  }}
                  title="将当前提示词和 Lora 快捷发送到高清修复并跳转"
                  style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "center",
                    gap: "6px", 
                    padding: "0 16px",
                    backgroundColor: "var(--bg-panel, #2a2a2a)",
                    color: "var(--text-primary, #eaeaea)",
                    border: "1px solid var(--border-color, #444)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "13px"
                  }}
                >
                  <Send size={16} />
                  送到高修
                </button>
              </div>
            </section>
          )}

          {tab === "wd14" && (
            <section className="panel">
              <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <PanelTitle icon={ScanSearch} title="图片识别" />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setWd14Tab("single")} style={{ padding: "4px 12px", background: wd14Tab === "single" ? "var(--primary, #007bff)" : "var(--bg-panel, #2a2a2a)", color: "var(--text-primary, #fff)", border: "1px solid var(--border-color, #444)", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>WD 单图</button>
                  <button onClick={() => setWd14Tab("cl_single")} style={{ padding: "4px 12px", background: wd14Tab === "cl_single" ? "var(--primary, #007bff)" : "var(--bg-panel, #2a2a2a)", color: "var(--text-primary, #fff)", border: "1px solid var(--border-color, #444)", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>CL 单图</button>
                  <button onClick={() => setWd14Tab("cl_batch")} style={{ padding: "4px 12px", background: wd14Tab === "cl_batch" ? "var(--primary, #007bff)" : "var(--bg-panel, #2a2a2a)", color: "var(--text-primary, #fff)", border: "1px solid var(--border-color, #444)", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>CL 批量</button>
                  <button onClick={() => setWd14Tab("wd_batch")} style={{ padding: "4px 12px", background: wd14Tab === "wd_batch" ? "var(--primary, #007bff)" : "var(--bg-panel, #2a2a2a)", color: "var(--text-primary, #fff)", border: "1px solid var(--border-color, #444)", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>WD 批量</button>
                </div>
              </div>
              {wd14Tab === "single" && (
                <>
                  <div className="panel-body">
                    <div className="form-grid two">
                      <div className="field">
                        <span>图片</span>
                        <label 
                          onDragOver={(e) => { 
                            e.preventDefault(); 
                            e.currentTarget.style.borderColor = "#007bff";
                            e.currentTarget.style.backgroundColor = "rgba(0, 123, 255, 0.1)"; 
                          }}
                          onDragLeave={(e) => { 
                            e.preventDefault(); 
                            e.currentTarget.style.borderColor = "var(--border-color, #444)"; 
                            e.currentTarget.style.backgroundColor = "transparent"; 
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.currentTarget.style.borderColor = "var(--border-color, #444)"; 
                            e.currentTarget.style.backgroundColor = "transparent"; 
                            const file = e.dataTransfer.files?.[0];
                            if (file && file.type.startsWith("image/")) {
                              setWdFile(file);
                            }
                          }}
                          style={{ 
                            border: "2px dashed var(--border-color, #444)", 
                            padding: "16px", 
                            borderRadius: "4px", 
                            cursor: "pointer", 
                            display: "flex", 
                            alignItems: "center", 
                            justifyContent: "center",
                            flexDirection: "column",
                            transition: "all 0.2s",
                            background: "var(--bg-panel, #2a2a2a)"
                          }}
                        >
                          <input 
                            type="file" 
                            accept="image/*" 
                            onChange={(event) => setWdFile(event.target.files?.[0] ?? null)} 
                            style={{ display: "none" }} 
                          />
                          {wdFile ? (
                            <div style={{ color: "var(--text-primary, #fff)", fontSize: "13px", textAlign: "center", wordBreak: "break-all" }}>
                              {wdFile.name}
                            </div>
                          ) : (
                            <div style={{ color: "var(--text-secondary, #aaa)", fontSize: "13px" }}>
                              点击或拖拽图片到此处
                            </div>
                          )}
                        </label>
                      </div>
                      <SelectField label="模型" value={wd14.model} options={options.wdModels} onChange={(value) => setWd14((prev) => ({ ...prev, model: value }))} />
                      <SelectField label="设备" value={wd14.device} options={options.wdDevices} onChange={(value) => setWd14((prev) => ({ ...prev, device: value }))} />
                      <NumberField label="阈值" value={wd14.threshold} step={0.05} min={0} max={1} onChange={(value) => setWd14((prev) => ({ ...prev, threshold: value }))} />
                      <NumberField label="角色阈值" value={wd14.characterThreshold} step={0.05} min={0} max={1} onChange={(value) => setWd14((prev) => ({ ...prev, characterThreshold: value }))} />
                      <label className="field">
                        <span>排除 tags</span>
                        <input value={wd14.excludeTags} onChange={(event) => setWd14((prev) => ({ ...prev, excludeTags: event.target.value }))} />
                      </label>
                      <div className="toggle-row">
                        <label><input type="checkbox" checked={wd14.replaceUnderscore} onChange={(event) => setWd14((prev) => ({ ...prev, replaceUnderscore: event.target.checked }))} /> 替换下划线</label>
                        <label><input type="checkbox" checked={wd14.trailingComma} onChange={(event) => setWd14((prev) => ({ ...prev, trailingComma: event.target.checked }))} /> 末尾逗号</label>
                      </div>
                    </div>
                    <CopyableTextarea className="output-text" value={wdTags} />
                  </div>
                  <div className="panel-footer">
                    <button className="primary-action" type="button" onClick={runWd14}>
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
                            e.currentTarget.style.borderColor = "#007bff";
                            e.currentTarget.style.backgroundColor = "rgba(0, 123, 255, 0.1)"; 
                          }}
                          onDragLeave={(e) => { 
                            e.preventDefault(); 
                            e.currentTarget.style.borderColor = "var(--border-color, #444)"; 
                            e.currentTarget.style.backgroundColor = "transparent"; 
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.currentTarget.style.borderColor = "var(--border-color, #444)"; 
                            e.currentTarget.style.backgroundColor = "transparent"; 
                            const file = e.dataTransfer.files?.[0];
                            if (file && file.type.startsWith("image/")) {
                              setClFile(file);
                            }
                          }}
                          style={{ 
                            border: "2px dashed var(--border-color, #444)", 
                            padding: "16px", 
                            borderRadius: "4px", 
                            cursor: "pointer", 
                            display: "flex", 
                            alignItems: "center", 
                            justifyContent: "center",
                            flexDirection: "column",
                            transition: "all 0.2s",
                            background: "var(--bg-panel, #2a2a2a)"
                          }}
                        >
                          <input 
                            type="file" 
                            accept="image/*" 
                            onChange={(event) => setClFile(event.target.files?.[0] ?? null)} 
                            style={{ display: "none" }} 
                          />
                          {clFile ? (
                            <div style={{ color: "var(--text-primary, #fff)", fontSize: "13px", textAlign: "center", wordBreak: "break-all" }}>
                              {clFile.name}
                            </div>
                          ) : (
                            <div style={{ color: "var(--text-secondary, #aaa)", fontSize: "13px" }}>
                              点击或拖拽图片到此处
                            </div>
                          )}
                        </label>
                      </div>
                      <SelectField label="CL 模型" value={clSingleParams.modelName} options={options.clModels} onChange={(value) => setClSingleParams((prev) => ({ ...prev, modelName: value }))} />
                      <SelectField label="设备" value={clSingleParams.sessionMethod} options={options.wdDevices} onChange={(value) => setClSingleParams((prev) => ({ ...prev, sessionMethod: value }))} />
                      <NumberField label="General 阈值" value={clSingleParams.general} step={0.05} min={0} max={1} onChange={(value) => setClSingleParams((prev) => ({ ...prev, general: value }))} />
                      <NumberField label="Character 阈值" value={clSingleParams.character} step={0.05} min={0} max={1} onChange={(value) => setClSingleParams((prev) => ({ ...prev, character: value }))} />
                      <label className="field">
                        <span>Categories</span>
                        <input value={clSingleParams.categories} onChange={(event) => setClSingleParams((prev) => ({ ...prev, categories: event.target.value }))} />
                      </label>
                      <label className="field">
                        <span>排除 tags</span>
                        <input value={clSingleParams.excludeTags} onChange={(event) => setClSingleParams((prev) => ({ ...prev, excludeTags: event.target.value }))} />
                      </label>
                      <div className="toggle-row">
                        <label><input type="checkbox" checked={clSingleParams.replaceSpace} onChange={(event) => setClSingleParams((prev) => ({ ...prev, replaceSpace: event.target.checked }))} /> 替换空格为下划线</label>
                      </div>
                    </div>
                    <CopyableTextarea className="output-text" value={wdTags} />
                  </div>
                  <div className="panel-footer">
                    <button className="primary-action" type="button" onClick={runClSingle}>
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
                        <input value={clBatchParams.imageFolder} onChange={(e) => setClBatchParams(prev => ({ ...prev, imageFolder: e.target.value }))} placeholder={`例如: ${CONFIG.DEFAULT_TAG_IMAGE_FOLDER}`} />
                      </label>
                      <label className="field">
                        <span>输出目录</span>
                        <input value={clBatchParams.outputFolder} onChange={(e) => setClBatchParams(prev => ({ ...prev, outputFolder: e.target.value }))} placeholder="例如: ./ComfyUI-tag/cs" />
                      </label>
                      <label className="field">
                        <span>前置提示词</span>
                        <input value={clBatchParams.prependText} onChange={(e) => setClBatchParams(prev => ({ ...prev, prependText: e.target.value }))} placeholder="打标文本前置追加" />
                      </label>
                      <NumberField label="处理数量" value={clBatchParams.runCount} step={1} min={1} onChange={(value) => setClBatchParams((prev) => ({ ...prev, runCount: value }))} />
                      
                      <SelectField label="CL 模型" value={clBatchParams.modelName} options={options.clModels} onChange={(value) => setClBatchParams((prev) => ({ ...prev, modelName: value }))} />
                      <SelectField label="设备" value={clBatchParams.sessionMethod} options={options.wdDevices} onChange={(value) => setClBatchParams((prev) => ({ ...prev, sessionMethod: value }))} />
                      <NumberField label="General 阈值" value={clBatchParams.general} step={0.05} min={0} max={1} onChange={(value) => setClBatchParams((prev) => ({ ...prev, general: value }))} />
                      <NumberField label="Character 阈值" value={clBatchParams.character} step={0.05} min={0} max={1} onChange={(value) => setClBatchParams((prev) => ({ ...prev, character: value }))} />
                      <label className="field">
                        <span>Categories</span>
                        <input value={clBatchParams.categories} onChange={(e) => setClBatchParams(prev => ({ ...prev, categories: e.target.value }))} />
                      </label>
                      <label className="field">
                        <span>排除 tags</span>
                        <input value={clBatchParams.excludeTags} onChange={(e) => setClBatchParams(prev => ({ ...prev, excludeTags: e.target.value }))} />
                      </label>
                      <div className="toggle-row">
                        <label><input type="checkbox" checked={clBatchParams.replaceSpace} onChange={(event) => setClBatchParams((prev) => ({ ...prev, replaceSpace: event.target.checked }))} /> 替换空格为下划线</label>
                      </div>
                    </div>
                  </div>
                  <div className="panel-footer">
                    <button className="primary-action" type="button" onClick={() => runBatchTagger("cl")}>
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
                        <input value={wdBatchParams.imageFolder} onChange={(e) => setWdBatchParams(prev => ({ ...prev, imageFolder: e.target.value }))} placeholder={`例如: ${CONFIG.DEFAULT_TAG_IMAGE_FOLDER}`} />
                      </label>
                      <label className="field">
                        <span>输出目录</span>
                        <input value={wdBatchParams.outputFolder} onChange={(e) => setWdBatchParams(prev => ({ ...prev, outputFolder: e.target.value }))} placeholder="例如: ./ComfyUI-tag/cs" />
                      </label>
                      <label className="field">
                        <span>前置提示词</span>
                        <input value={wdBatchParams.prependText} onChange={(e) => setWdBatchParams(prev => ({ ...prev, prependText: e.target.value }))} placeholder="打标文本前置追加" />
                      </label>
                      <NumberField label="处理数量" value={wdBatchParams.runCount} step={1} min={1} onChange={(value) => setWdBatchParams((prev) => ({ ...prev, runCount: value }))} />
                      
                      <SelectField label="WD 模型" value={wdBatchParams.model} options={options.wdModels} onChange={(value) => setWdBatchParams((prev) => ({ ...prev, model: value }))} />
                      <SelectField label="设备" value={wdBatchParams.device} options={options.wdDevices} onChange={(value) => setWdBatchParams((prev) => ({ ...prev, device: value }))} />
                      <NumberField label="阈值" value={wdBatchParams.threshold} step={0.05} min={0} max={1} onChange={(value) => setWdBatchParams((prev) => ({ ...prev, threshold: value }))} />
                      <NumberField label="角色阈值" value={wdBatchParams.characterThreshold} step={0.05} min={0} max={1} onChange={(value) => setWdBatchParams((prev) => ({ ...prev, characterThreshold: value }))} />
                      <label className="field">
                        <span>排除 tags</span>
                        <input value={wdBatchParams.excludeTags} onChange={(e) => setWdBatchParams(prev => ({ ...prev, excludeTags: e.target.value }))} />
                      </label>
                      <div className="toggle-row">
                        <label><input type="checkbox" checked={wdBatchParams.replaceUnderscore} onChange={(event) => setWdBatchParams((prev) => ({ ...prev, replaceUnderscore: event.target.checked }))} /> 替换下划线</label>
                        <label><input type="checkbox" checked={wdBatchParams.trailingComma} onChange={(event) => setWdBatchParams((prev) => ({ ...prev, trailingComma: event.target.checked }))} /> 末尾逗号</label>
                      </div>
                    </div>
                  </div>
                  <div className="panel-footer">
                    <button className="primary-action" type="button" onClick={() => runBatchTagger("wd")}>
                      <ScanSearch size={18} />
                      开始 WD 批量打标
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {tab === "multi" && (
            <section className="panel">
              <div className="panel-header">
                <PanelTitle icon={UserRound} title="多人工作流" />
              </div>
              <div className="panel-body">
                <BaseControls 
                  params={multiParams} 
                  options={options} 
                  setParams={setMultiParams} 
                  apiBase={apiBase} 
                  settings={loraSettings}
                  localExampleFilesByHash={loraExampleFilesByHash}
                  hidePositive 
                  disableStickyPrompt 
                  onLoraDetail={handleOpenLoraDetail} 
                />
                <div className="multi-settings">
                  <TextAreaField label="全局 prompt" value={multiParams.globalPrompt} onChange={(value) => setMultiParams((prev) => ({ ...prev, globalPrompt: value }))} />
                  <div className="form-grid multi-options">
                    <SelectField label="语法模式" value={multiParams.syntaxMode} options={["attention_couple", "regional_prompts"]} onChange={(value) => setMultiParams((prev) => ({ ...prev, syntaxMode: value as MultiGenerationParams["syntaxMode"] }))} />
                    <SelectField 
                      label="融合算法" 
                      value={multiParams.fusionMode} 
                      options={[
                        { label: "Mask 叠加", value: "mask_overlap" },
                        { label: "Latent 融合", value: "latent_fusion" }
                      ]} 
                      onChange={(value) => setMultiParams((prev) => ({ ...prev, fusionMode: value as MultiGenerationParams["fusionMode"] }))} 
                    />
                    <NumberField label="多人画布宽" value={multiParams.canvasWidth} step={64} min={256} onChange={(value) => setMultiParams((prev) => ({ ...prev, canvasWidth: value }))} />
                    <NumberField label="多人画布高" value={multiParams.canvasHeight} step={64} min={256} onChange={(value) => setMultiParams((prev) => ({ ...prev, canvasHeight: value }))} />
                    <label className="field checkbox-field"><input type="checkbox" checked={multiParams.useFill} onChange={(event) => setMultiParams((prev) => ({ ...prev, useFill: event.target.checked }))} /> use_fill</label>
                  </div>
                </div>
                <div className="multi-editor-layout">
                  <MultiWorkspace
                    canvasWidth={multiParams.canvasWidth}
                    canvasHeight={multiParams.canvasHeight}
                    characters={multiParams.characters}
                    onChange={(characters) => setMultiParams((prev) => ({ ...prev, characters }))}
                  />
                </div>
              </div>
              <div className="panel-footer" style={{ display: "flex", gap: "8px" }}>
                <button className="primary-action" style={{ flex: 1 }} type="button" onClick={() => runPrompt("多人工作流", () => buildMultiPrompt(multiParams))}>
                  <UserRound size={18} />
                  运行多人工作流
                </button>
                <button 
                  type="button" 
                  onClick={() => setMultiParams((prev) => ({ ...prev, characters: addCharacter(prev.characters) }))}
                  title="新增角色"
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
                    transition: "all 0.2s ease"
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
                  <Plus size={16} /> 新增角色
                </button>
                <button 
                  type="button" 
                  onClick={() => setSimpleLoraTarget("multi")}
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
                    transition: "all 0.2s ease"
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
          )}

          {tab === "highres" && (
            <section className="panel">
              <div className="panel-header">
                <PanelTitle icon={ImageUp} title="高清修复" />
              </div>
              <div className="panel-body">
                <div className="segmented">
                  <button type="button" className={highresParams.enableUpscale ? "active" : ""} onClick={() => setHighresParams((prev) => ({ ...prev, enableUpscale: !prev.enableUpscale }))}>高清放大</button>
                  <button type="button" className={highresParams.enableSegsDetailer ? "active" : ""} onClick={() => setHighresParams((prev) => ({ ...prev, enableSegsDetailer: !prev.enableSegsDetailer }))}>全图修复</button>
                  <button type="button" className={highresParams.enableFaceDetailer ? "active" : ""} onClick={() => setHighresParams((prev) => ({ ...prev, enableFaceDetailer: !prev.enableFaceDetailer }))}>脸部修复</button>
                  <button type="button" className={highresParams.enableEyesDetailer ? "active" : ""} onClick={() => setHighresParams((prev) => ({ ...prev, enableEyesDetailer: !prev.enableEyesDetailer }))}>眼部修复</button>
                  <button type="button" className={highresParams.enableNsfwDetailer ? "active" : ""} onClick={() => setHighresParams((prev) => ({ ...prev, enableNsfwDetailer: !prev.enableNsfwDetailer }))}>NSFW修复</button>
                  <button type="button" className={highresParams.enableHandDetailer ? "active" : ""} onClick={() => setHighresParams((prev) => ({ ...prev, enableHandDetailer: !prev.enableHandDetailer }))}>手部修复</button>
                </div>
                <BaseControls 
                  params={highresParams} 
                  options={options} 
                  setParams={setHighresParams} 
                  apiBase={apiBase} 
                  settings={loraSettings}
                  localExampleFilesByHash={loraExampleFilesByHash}
                  onLoraDetail={handleOpenLoraDetail} 
                />
                <div className="xyz-fields-grid" style={{ marginBottom: "12px" }}>
                  <label className="field checkbox-field"><input type="checkbox" checked={highresParams.syncHighresSeed ?? true} onChange={(event) => setHighresParams((prev) => ({ ...prev, syncHighresSeed: event.target.checked }))} /> 同步基础 Seed</label>
                  <NumberField label={highresParams.randomizeHighresSeed ? "高修 seed（随机）" : "高修 seed"} value={highresParams.highresSeed} step={1} min={0} disabled={highresParams.syncHighresSeed !== false || highresParams.randomizeHighresSeed} onChange={(value) => setHighresParams((prev) => ({ ...prev, highresSeed: value }))} />
                  {highresParams.syncHighresSeed === false && (
                    <label className="field checkbox-field"><input type="checkbox" checked={highresParams.randomizeHighresSeed ?? true} onChange={(event) => setHighresParams((prev) => ({ ...prev, randomizeHighresSeed: event.target.checked }))} /> 随机高修 seed</label>
                  )}
                </div>
                <div className="form-grid three">
                  <SelectField label="放大方法" value={highresParams.upscaleMethod} options={options.upscaleMethods} onChange={(value) => setHighresParams((prev) => ({ ...prev, upscaleMethod: value }))} />
                  <NumberField label="放大倍率" value={highresParams.scaleBy} step={0.1} min={1} max={8} onChange={(value) => setHighresParams((prev) => ({ ...prev, scaleBy: value }))} />
                  <NumberField label="高修步数" value={highresParams.highresSteps} step={1} min={1} onChange={(value) => setHighresParams((prev) => ({ ...prev, highresSteps: value }))} />
                  <NumberField label="高修 CFG" value={highresParams.highresCfg} step={0.1} min={0} onChange={(value) => setHighresParams((prev) => ({ ...prev, highresCfg: value }))} />
                  <NumberField label="高修重绘" value={highresParams.highresDenoise} step={0.01} min={0} max={1} onChange={(value) => setHighresParams((prev) => ({ ...prev, highresDenoise: value }))} />
                </div>
                <div className="detailer-grid">
                  {highresParams.enableSegsDetailer && <DetailerControls title="全图修复参数" params={highresParams.segsDetailer ?? { ...makeDetailerParams(0.24), steps: 18, cfg: 6, guideSize: 512, maxSize: 1024 }} onChange={(detailer) => setHighresParams((prev) => ({ ...prev, segsDetailer: detailer }))} />}
                  {highresParams.enableHandDetailer && <DetailerControls title="手部修复参数" detector={highresParams.handDetector} detectors={options.detectors} params={highresParams.handDetailer ?? makeDetailerParams(0.38)} onDetector={(value) => setHighresParams((prev) => ({ ...prev, handDetector: value }))} onChange={(detailer) => setHighresParams((prev) => ({ ...prev, handDetailer: detailer }))} />}
                  {highresParams.enableFaceDetailer && <DetailerControls title="脸部修复参数" detector={highresParams.faceDetector} detectors={options.detectors} params={highresParams.faceDetailer ?? makeDetailerParams(0.25)} onDetector={(value) => setHighresParams((prev) => ({ ...prev, faceDetector: value }))} onChange={(detailer) => setHighresParams((prev) => ({ ...prev, faceDetailer: detailer }))} />}
                  {highresParams.enableEyesDetailer && <DetailerControls title="眼部修复参数" detector={highresParams.eyesDetector} detectors={options.detectors} params={highresParams.eyesDetailer ?? makeDetailerParams(0.24)} onDetector={(value) => setHighresParams((prev) => ({ ...prev, eyesDetector: value }))} onChange={(detailer) => setHighresParams((prev) => ({ ...prev, eyesDetailer: detailer }))} />}
                  {highresParams.enableNsfwDetailer && <DetailerControls title="NSFW修复参数" detector={highresParams.nsfwDetector} detectors={options.detectors} params={highresParams.nsfwDetailer ?? makeDetailerParams(0.3)} onDetector={(value) => setHighresParams((prev) => ({ ...prev, nsfwDetector: value }))} onChange={(detailer) => setHighresParams((prev) => ({ ...prev, nsfwDetailer: detailer }))} />}
                </div>
              </div>
              <div className="panel-footer" style={{ display: "flex", gap: "8px" }}>
                <button className="primary-action" style={{ flex: 1 }} type="button" onClick={() => runPrompt("高清修复", () => buildHighresPrompt(highresParams))}>
                  <ImageUp size={18} />
                  开始修复
                </button>
                <button 
                  type="button" 
                  onClick={() => setSimpleLoraTarget("highres")}
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
                    transition: "all 0.2s ease"
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
          )}

          {tab === "xyz" && (() => {
            const lorasOfTarget = getXyzLoras();
            const xyzFields: XyzField[] = [
              "seed",
              "steps",
              "cfg",
              "width",
              "height",
              "samplerName",
              "scheduler",
              "denoise",
              "positiveAppend",
              ...lorasOfTarget.flatMap((_, i) => [`loraName_${i}` as const, `loraStrength_${i}` as const]),
              "loraAppendName_1",
              "loraAppendStrength_1",
              "loraAppendName_2",
              "loraAppendStrength_2",
              "drawTextText",
              "drawTextFont",
            ];
            return (
            <section className="panel xyz-panel">
              <PanelTitle icon={SlidersHorizontal} title="XYZ 控制器" />
              <div className="xyz-head">
                <label className="field">
                  <span>目标模板</span>
                  <select value={xyzTarget} onChange={(event) => setXyzTarget(event.target.value as TemplateKind)}>
                    {Object.entries(templateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <div className="metric-card">
                  <strong>{buildXyzCombinations(xyzAxes, getXyzLoras()).length}</strong>
                  <span>组合</span>
                </div>
                <div className="xyz-preset-bar">
                  <button type="button" className="icon-button" onClick={() => setShowXyzHelp(true)}><CircleHelp size={16} /> 怎么用</button>
                  <button type="button" className="icon-button" onClick={() => setXyzAxes([{ enabled: true, field: "seed", values: "1,2,3" }, { enabled: false, field: "cfg", values: "5,7" }, { enabled: false, field: "steps", values: "20..30..10" }])}>Seed</button>
                  <button type="button" className="icon-button" onClick={() => setXyzAxes([{ enabled: true, field: "cfg", values: "5,7,9" }, { enabled: false, field: "steps", values: "20..30..10" }, { enabled: false, field: "seed", values: "1,2" }])}>CFG</button>
                  <button type="button" className="icon-button" onClick={() => setXyzAxes([{ enabled: true, field: "width", values: "768,1024" }, { enabled: true, field: "height", values: "1024,1536" }, { enabled: false, field: "seed", values: "1,2" }])}>尺寸</button>
                  <button type="button" className="icon-button" onClick={() => setXyzAxes([{ enabled: true, field: "loraStrength_0", values: "0.6,0.8,1" }, { enabled: false, field: "seed", values: "1,2" }, { enabled: false, field: "cfg", values: "5,7" }])}>LoRA 强度</button>
                  <button type="button" className="icon-button" onClick={() => setXyzAxes([{ enabled: true, field: "positiveAppend", values: "cinematic lighting\\nsoft light" }, { enabled: false, field: "seed", values: "1,2" }, { enabled: false, field: "cfg", values: "5,7" }])}>提示词追加</button>
                </div>
              </div>
              <div className="axis-list">
                {xyzAxes.map((axis, index) => (
                  <div className="axis-row" key={index}>
                    <label className="axis-toggle"><input type="checkbox" checked={axis.enabled} onChange={(event) => updateAxis(index, { enabled: event.target.checked })} /> {["X", "Y", "Z"][index]}</label>
                    <select value={axis.field} onChange={(event) => updateAxis(index, { field: event.target.value as XyzField })}>
                      {xyzFields.map((field) => <option key={field} value={field}>{fieldLabel(field, lorasOfTarget)}</option>)}
                    </select>
                    <input value={axis.values} onChange={(event) => updateAxis(index, { values: event.target.value })} />
                  </div>
                ))}
              </div>
              <XyzPreview
                axes={xyzAxes}
                lorasOfTarget={lorasOfTarget}
                excludedIndices={xyzExcludedIndices}
                onToggleIndex={(index) => {
                  setXyzExcludedIndices((prev) => {
                    const next = new Set(prev);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  });
                }}
              />
              <button className="primary-action" type="button" onClick={runXyz}>
                <SlidersHorizontal size={18} />
                顺序执行 XYZ
              </button>
              <div className="xyz-actions">
                <button type="button" className="icon-button danger" disabled={!progress.running} onClick={stopXyzQueue}><PauseCircle size={16} /> 中断队列</button>
                <button type="button" className="icon-button" disabled={!xyzResults.some((item) => item.status === "failed")} onClick={retryFailedXyz}><RefreshCw size={16} /> 重试失败</button>
                <button type="button" className="icon-button" disabled={xyzResults.length === 0} onClick={exportXyzResults}><FileText size={16} /> 导出结果</button>
                <button type="button" className="icon-button" disabled={xyzResults.length === 0} onClick={exportXyzGrid}><Grid3X3 size={16} /> 导出网格</button>
              </div>
              <div className="xyz-grid">
                {xyzResults.map((item) => (
                  <div className={`result-card xyz-result ${item.status}`} key={item.id}>
                    <div className="xyz-result-head">
                      <strong>{item.label}</strong>
                      <span>{xyzStatusLabel(item.status)}</span>
                    </div>
                    {item.result?.images[0] ? (
                      <img
                        src={item.result.images[0].url}
                        alt={item.label}
                        style={{ cursor: "zoom-in" }}
                        onClick={() => setOutputLightbox(item.result!.images[0].url)}
                      />
                    ) : (
                      <div className="xyz-image-placeholder" />
                    )}
                    {item.error && <p>{item.error}</p>}
                    {item.status !== "running" && item.status !== "queued" && (
                      <button type="button" className="lm-text-btn" onClick={() => rerunXyzItem(item)}><RefreshCw size={13} /> 重跑</button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )})()}

          {tab === "text" && (
            <section className="panel">
              <div className="panel-header">
                <PanelTitle icon={Type} title="文字特效 & 水印" />
              </div>
              <div className="panel-body">
                <DrawTextControls 
                  params={defaultParams} 
                  options={options} 
                  setParams={setDefaultParams} 
                  defaultParams={defaultParams}
                  multiParams={multiParams}
                  highresParams={highresParams}
                />
              </div>
              <div className="panel-footer" style={{ display: "flex", gap: "10px" }}>
                <button className="primary-action" style={{ flex: 1 }} type="button" onClick={() => runPrompt("默认生图", () => buildDefaultPrompt(defaultParams))}>
                  <Sparkles size={18} />
                  默认生图
                </button>
                <button className="primary-action" style={{ flex: 1, background: "linear-gradient(135deg, #743795, #9b51e0)", borderColor: "#9b51e0" }} type="button" onClick={() => runPrompt("多人", () => buildMultiPrompt({ ...multiParams, drawText: defaultParams.drawText }))}>
                  <UserRound size={18} />
                  多人
                </button>
                <button className="primary-action" style={{ flex: 1, background: "linear-gradient(135deg, #27ae60, #2ecc71)", borderColor: "#2ecc71" }} type="button" onClick={() => runPrompt("高清修复", () => buildHighresPrompt({ ...highresParams, drawText: defaultParams.drawText }))}>
                  <ImageUp size={18} />
                  高清
                </button>
              </div>
            </section>
          )}

          {tab === "loras" && (
            <section className="panel lora-panel">
              <LoraManagerPanel
                modelType={managedModelType}
                onModelTypeChange={changeManagedModelType}
                result={loraResult}
                query={loraQuery}
                setQuery={setLoraQuery}
                loading={loraLoading}
                hasMore={loraResult.page < loraResult.totalPages}
                folders={loraFolders}
                baseModels={loraBaseModels}
                tags={loraTags}
                density={loraDensity}
                setDensity={setLoraDensity}
                triggerWords={triggerWords}
                onRefresh={refreshLoras}
                onLoadMore={loadMoreManagedModels}
                onDetail={setLoraDetail}
                onInsert={handleLoraInsert}
                exampleStatus={exampleStatus}
                examplePending={examplePending}
                pullingExampleHashes={pullingExampleHashes}
                localExampleFilesByHash={loraExampleFilesByHash}
                onPullAllExamples={pullAllLoraExamples}
                apiBase={apiBase}
                settings={loraSettings}
              />
            </section>
          )}

          {tab === "notes" && (
            <section className="panel notes-panel" style={{ padding: 0, display: "flex", flexDirection: "row", overflow: "hidden" }}>
              {/* Sidebar */}
              <div style={{ width: "260px", borderRight: "1px solid #263244", display: "flex", flexDirection: "column", background: "#0c111a" }}>
                <div style={{ padding: "16px", borderBottom: "1px solid #263244" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "bold", color: "#e2e8f0" }}>
                      <FileText size={18} /> 记事本
                    </div>
                    <button type="button" className="lm-text-btn" onClick={handleAddNote} title="新建笔记">
                      <Plus size={18} />
                    </button>
                  </div>
                  <div style={{ position: "relative" }}>
                    <Search size={14} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
                    <input 
                      type="text" 
                      placeholder="搜索笔记..." 
                      value={notesSearch}
                      onChange={(e) => setNotesSearch(e.target.value)}
                      style={{ 
                        width: "100%", 
                        background: "#080b12", 
                        border: "1px solid #1e293b", 
                        borderRadius: "6px", 
                        padding: "6px 8px 6px 28px", 
                        fontSize: "12px", 
                        color: "#e2e8f0",
                        outline: "none"
                      }} 
                    />
                  </div>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "8px" }} className="custom-scrollbar">
                  {notes.filter(n => n.title.toLowerCase().includes(notesSearch.toLowerCase()) || n.content.toLowerCase().includes(notesSearch.toLowerCase())).length === 0 && (
                    <div className="empty-state" style={{ padding: "40px 0", fontSize: "12px" }}>
                      {notes.length === 0 ? "暂无笔记" : "未找到匹配项"}
                    </div>
                  )}
                  {notes
                    .filter(n => n.title.toLowerCase().includes(notesSearch.toLowerCase()) || n.content.toLowerCase().includes(notesSearch.toLowerCase()))
                    .map((note) => (
                    <div
                      key={note.id}
                      onClick={() => setActiveNoteId(note.id)}
                      style={{
                        padding: "10px 12px",
                        marginBottom: "4px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        background: activeNoteId === note.id ? "rgba(59, 130, 246, 0.12)" : "transparent",
                        border: activeNoteId === note.id ? "1px solid rgba(59, 130, 246, 0.3)" : "1px solid transparent",
                        color: activeNoteId === note.id ? "#93c5fd" : "#94a3b8",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                        transition: "all 0.15s ease",
                      }}
                      className="note-list-item"
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: activeNoteId === note.id ? "bold" : "normal", fontSize: "13px" }}>
                          {note.title || "未命名"}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteNote(note.id);
                          }}
                          className="delete-btn"
                          style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", padding: "2px", display: "flex", opacity: 0.6 }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div style={{ fontSize: "11px", color: "#64748b", display: "flex", justifyContent: "space-between" }}>
                        <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
                        {note.content.length > 0 && <span>{note.content.length} 字</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Editor */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "16px", background: "#080b12" }}>
                {activeNoteId && notes.find((n) => n.id === activeNoteId) ? (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
                        <input
                          type="text"
                          value={notes.find((n) => n.id === activeNoteId)?.title || ""}
                          onChange={(e) => updateActiveNote({ title: e.target.value })}
                          placeholder="笔记标题"
                          style={{
                            background: "transparent",
                            border: "none",
                            fontSize: "18px",
                            fontWeight: "bold",
                            color: "#e7edf7",
                            width: "100%",
                            outline: "none",
                          }}
                        />
                      </div>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <button
                          type="button"
                          className={`lm-text-btn ${isNotesWide ? "active" : ""}`}
                          onClick={() => setIsNotesWide(!isNotesWide)}
                          title={isNotesWide ? "显示输出面板" : "全宽模式"}
                          style={{
                            color: isNotesWide ? "#60a5fa" : "#64748b",
                            background: isNotesWide ? "rgba(59, 130, 246, 0.1)" : "transparent",
                            padding: "4px",
                            borderRadius: "4px"
                          }}
                        >
                          {isNotesWide ? <Minimize size={18} /> : <Maximize size={18} />}
                        </button>
                        {notesSaving && <span style={{ fontSize: "12px", color: "#60a5fa" }} className="animate-pulse">保存中...</span>}
                      </div>
                    </div>
                    
                    <RichTextEditor
                      value={notes.find((n) => n.id === activeNoteId)?.content || ""}
                      onChange={(content) => updateActiveNote({ content })}
                      onSave={() => saveNotes(notes)}
                      title={notes.find((n) => n.id === activeNoteId)?.title || "note"}
                      saving={notesSaving}
                      onClear={() => {
                        setConfirmDialog({
                          title: "清空内容",
                          message: "确定要清空当前笔记的所有内容吗？此操作无法撤销。",
                          onConfirm: () => {
                            updateActiveNote({ content: "" });
                          }
                        });
                      }}
                    />
                  </>
                ) : (
                  <div className="empty-state" style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px" }}>
                    <div style={{ background: "#111827", padding: "20px", borderRadius: "50%", color: "#374151" }}>
                      <FileText size={48} />
                    </div>
                    <div style={{ color: "#4b5563" }}>请在左侧选择或新建笔记</div>
                    <button type="button" className="primary-action" onClick={handleAddNote}>
                      <Plus size={16} /> 新建第一条笔记
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
        </main>

        {tab !== "loras" && !(tab === "notes" && isNotesWide) && (
          <aside className={results.length > 0 || progress.previewUrl ? "output-panel" : "output-panel is-empty"}>
            <div className="gallery">
              <h2><GalleryHorizontalEnd size={18} /> 输出</h2>
              {results.length === 0 && !progress.previewUrl && <div className="empty-state">暂无输出</div>}
              
              {progress.running && progress.previewUrl && (
                <div className="gallery-item" key="preview">
                  <div className="gallery-meta">
                    <Loader2 size={16} className="spin" />
                    <span>预览中...</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                    <img 
                      src={progress.previewUrl} 
                      alt="Preview" 
                      style={{ filter: "blur(2px)", transition: "filter 0.3s" }}
                    />
                  </div>
                </div>
              )}

              {results.map((result) => (
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
                          onClick={() => setOutputLightbox(image.url)}
                        />
                        {baseImages.length > 0 && (
                          <button 
                            className="secondary-action" 
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '100%' }}
                            onClick={() => setCompareLightbox([baseImages[Math.min(i, baseImages.length - 1)].url, image.url])}
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
         isOpen={showPromptSidebar} 
         onClose={() => setShowPromptSidebar(false)} 
         onSelect={handleSidebarSelect} 
         currentPositive={currentPrompts.positive}
         currentNegative={currentPrompts.negative}
       />
    </div>
      <ToastViewport toasts={toasts} onClose={(id) => setToasts((prev) => prev.filter((toast) => toast.id !== id))} />
      {showXyzHelp && <XyzHelpModal onClose={() => setShowXyzHelp(false)} />}

      {featureModal && <FeatureModal modal={featureModal} onClose={() => setFeatureModal(null)} />}
      {loraOperation && loraOperation.type !== "translator" && (
        <LoraOperationModal
          modelType={managedModelType}
          operation={loraOperation}
          client={client}
          settingsApiBase={apiBase}
          selectedItems={selectedLoraItems}
          notifications={notificationLog}
          onShowWelcome={() => {
            setLoraOperation(null);
            setShowWelcome(true);
          }}
          onClose={() => setLoraOperation(null)}
          onToast={pushToast}
          onSettingsSaved={(settings) => setLoraSettings(normalizeLoraManagerSettings(settings))}
          onApiBaseSaved={setApiBase}
          translationSettings={translationSettings}
          onTranslationSettingsSaved={setTranslationSettings}
          onMutated={async (message) => {
            setSelectedLoraPaths([]);
            setLoraDetail(null);
            await refreshLoraListsAfterMutation(message);
          }}
        />
      )}
      {outputLightbox && (
        <div className="lm-lightbox" role="dialog" aria-modal="true" aria-label="查看大图" onMouseDown={() => setOutputLightbox(null)}>
          <div className="lm-lightbox-content" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="lm-lightbox-close" title="关闭" onClick={() => setOutputLightbox(null)}><X size={18} /></button>
            <div className="lm-media-frame">
              <img src={outputLightbox} alt="大图" className="lm-media-asset" />
            </div>
          </div>
        </div>
      )}
      {compareLightbox && (
        <ImageComparerModal imageA={compareLightbox[0]} imageB={compareLightbox[1]} onClose={() => setCompareLightbox(null)} />
      )}

      {simpleLoraTarget && (
        <ModalFrame 
          title="简易 LoRA 管理器" 
          onClose={() => setSimpleLoraTarget(null)}
          style={{ width: "90vw", maxWidth: "1400px", height: "85vh", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
        >
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", margin: "-16px", marginTop: "0" }}>
            <LoraManagerPanel
              modelType={managedModelType}
              onModelTypeChange={changeManagedModelType}
              result={loraResult}
              query={loraQuery}
              setQuery={setLoraQuery}
              loading={loraLoading}
              hasMore={loraResult.page < loraResult.totalPages}
              folders={loraFolders}
              baseModels={loraBaseModels}
              tags={loraTags}
              density={loraDensity}
              setDensity={setLoraDensity}
              triggerWords={triggerWords}
              onRefresh={refreshLoras}
              onLoadMore={loadMoreManagedModels}
              onDetail={(item) => {
                setLoraDetail(item);
              }}
              onInsert={(item, target) => {
                addLora(item, 1, target);
              }}
              exampleStatus={exampleStatus}
              examplePending={examplePending}
              pullingExampleHashes={pullingExampleHashes}
              localExampleFilesByHash={loraExampleFilesByHash}
              onPullAllExamples={pullAllLoraExamples}
              apiBase={apiBase}
              settings={loraSettings}
              isSimple
            />
          </div>
        </ModalFrame>
      )}

      {loraDetail && (
        <LoraDetailModal
          modelType={managedModelType}
          item={loraDetail}
          triggerWords={triggerWords[loraDetail.model_name || loraDetail.file_name] ?? []}
          client={client}
          apiBase={apiBase}
          settings={loraSettings}
          onClose={() => setLoraDetail(null)}
          onInsert={(target, strength) => addLora(loraDetail, strength, target)}
          onInsertWords={(target, words) => addTriggerWords(words, target)}
          onTriggerWords={() => loadTriggerWords(loraDetail)}
          onSaveTriggerWords={(words) => saveLoraTriggerWords(loraDetail, words)}
          onToast={pushToast}
          pullingExamples={Boolean(loraDetail.sha256 && pullingExampleHashes.includes(loraDetail.sha256.toLowerCase()))}
          exampleStatus={exampleStatus}
          onPullExamples={pullLoraExamples}
        />
      )}

      {confirmDialog && (
        <ModalFrame title={confirmDialog.title} onClose={() => setConfirmDialog(null)}>
          <div style={{ padding: "24px" }}>
            <p style={{ color: "var(--text)", fontSize: "15px", margin: 0, lineHeight: 1.5 }}>
              {confirmDialog.message}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "24px" }}>
              <button
                type="button"
                className="lm-text-btn"
                onClick={() => setConfirmDialog(null)}
                style={{ padding: "8px 16px" }}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-action"
                style={{ background: "#ef4444", border: "1px solid #dc2626", padding: "8px 16px" }}
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
              >
                确定删除
              </button>
            </div>
          </div>
        </ModalFrame>
      )}

      </div>
    </div>
  );

  function updateAxis(index: number, patch: Partial<XyzAxis>) {
    setXyzAxes((prev) => prev.map((axis, axisIndex) => axisIndex === index ? { ...axis, ...patch } : axis));
    setXyzExcludedIndices(new Set());
  }
}

const ToastIcon = ({ type }: { type: Toast["type"] }) => {
  if (type === "success") return <CheckCircle2 size={20} color="#10b981" style={{ flexShrink: 0, marginTop: "2px" }} />;
  if (type === "error") return <X size={20} color="#ef4444" style={{ flexShrink: 0, marginTop: "2px" }} />;
  return <Info size={20} color="#3b82f6" style={{ flexShrink: 0, marginTop: "2px" }} />;
};

function ToastViewport({ toasts, onClose }: { toasts: Toast[]; onClose: (id: string) => void }) {
  return (
    <div className="toast-viewport">
      {toasts.map((toast) => (
        <div className={`toast ${toast.type}`} key={toast.id}>
          <ToastIcon type={toast.type} />
          <div className="toast-content" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <strong>{toast.title}</strong>
            {toast.message && <p>{toast.message}</p>}
          </div>
          <button type="button" className="toast-close" onClick={() => onClose(toast.id)} style={{ flexShrink: 0 }}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function ModalFrame({ title, children, onClose, className, style }: { title: string; children: ReactNode; onClose: () => void; className?: string; style?: React.CSSProperties }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className={`modal ${className || ""}`} style={style} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose}><X size={16} /> 关闭</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function XyzHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalFrame title="XYZ 控制器怎么用" onClose={onClose}>
      <div className="help-body">
        <p>XYZ 会按 X、Y、Z 三个轴组合参数，然后顺序提交到 ComfyUI。X 轴变化最快，适合 seed；Y/Z 适合 CFG、Steps、尺寸或 LoRA 强度。</p>
        <p>取值支持两种写法：逗号或换行枚举，例如 `5,7,9`；数值范围，例如 `20..40..10` 表示 20、30、40。</p>
        <p>“正向追加”会把轴值追加到正向提示词；多人模板中会追加到全局 prompt。“LoRA 强度”可以动态调节当前模板中已选择的对应 LoRA 权重。</p>
      </div>
    </ModalFrame>
  );
}

function FeatureModal({ modal, onClose }: { modal: { title: string; body: string }; onClose: () => void }) {
  return (
    <ModalFrame title={modal.title} onClose={onClose}>
      <div className="help-body">
        <p>{modal.body}</p>
      </div>
    </ModalFrame>
  );
}

function RunProgressStrip({ progress }: { progress: ProgressState }) {
  const percent = progress.max > 0 ? Math.min(100, Math.max(0, (progress.value / progress.max) * 100)) : 0;
  const show = progress.running || progress.label === "完成" || Boolean(progress.batch);
  if (!show) return null;
  const indeterminate = progress.running && percent <= 0;
  const batch = progress.batch;
  const batchPercent = batch && batch.total > 0 ? Math.min(100, Math.max(0, (batch.current / batch.total) * 100)) : 0;
  return (
    <div className="run-progress-strip" role="status" aria-live="polite">
      {batch && (
        <div className="run-progress-batch">
          <span className="batch-badge">XYZ</span>
          <strong>{batch.current}/{batch.total}</strong>
          <span className="batch-item" title={batch.itemLabel}>
            {batch.itemLabel || (progress.running ? "准备中" : "全部组合已处理")}
          </span>
          <div className="progress-track slim" aria-label="XYZ 批次进度">
            <span style={{ width: `${batchPercent}%` }} />
          </div>
        </div>
      )}
      <div className="run-progress-meta">
        <strong>{progress.label}</strong>
        <span>{progress.node ? `节点 ${progress.node}` : progress.promptId ? `任务 ${progress.promptId.slice(0, 8)}` : progress.running ? "等待提交" : ""}</span>
        <b>{indeterminate ? "处理中" : `${Math.round(percent)}%`}</b>
      </div>
      <div className={indeterminate ? "progress-track indeterminate" : "progress-track"} aria-label="生图进度">
        <span style={{ width: `${indeterminate ? 34 : percent}%` }} />
      </div>
    </div>
  );
}

function ExampleImagesProgressBar({ status, pullingCount = 0 }: { status: ExampleImagesStatus | null; pullingCount?: number }) {
  const progress = status?.status;
  const running = Boolean(status?.is_downloading || pullingCount > 0 || progress?.status === "running");
  const total = Math.max(1, Number(progress?.total ?? pullingCount ?? 1));
  const completed = Math.min(total, Math.max(0, Number(progress?.completed ?? 0)));
  const percent = Math.min(100, Math.max(0, (completed / total) * 100));
  const label = running
    ? progress?.current_model || (pullingCount > 0 ? `单独拉取 ${pullingCount} 个 LoRA` : "正在拉取示例图")
    : progress?.status === "completed"
      ? `示例图拉取完成：${completed}/${total}`
      : progress?.status === "error"
        ? progress.last_error || "示例图拉取失败"
        : "";
  if (!running && !label) return null;
  const indeterminate = running && completed === 0;
  return (
    <div className="lm-download-progress" role="status" aria-live="polite">
      <div className="lm-download-progress-meta">
        <strong>{running ? "示例图拉取中" : progress?.status === "error" ? "示例图拉取失败" : "示例图拉取完成"}</strong>
        <span title={label}>{label}</span>
        <b>{indeterminate ? "处理中" : `${completed}/${total}`}</b>
      </div>
      <div className={indeterminate ? "progress-track indeterminate" : "progress-track"} aria-label="示例图拉取进度">
        <span style={{ width: `${indeterminate ? 34 : percent}%` }} />
      </div>
    </div>
  );
}

function XyzPreview({
  axes,
  lorasOfTarget,
  excludedIndices,
  onToggleIndex,
}: {
  axes: XyzAxis[];
  lorasOfTarget?: { name: string; displayName?: string }[];
  excludedIndices: Set<number>;
  onToggleIndex: (index: number) => void;
}) {
  const allCombos = useMemo(() => buildXyzCombinations(axes, lorasOfTarget), [axes, lorasOfTarget]);
  const activeCount = allCombos.length - excludedIndices.size;
  const estMinutes = Math.ceil((activeCount * 15) / 60);

  return (
    <div className="xyz-preview">
      <div className="section-toolbar">
        <div className="preview-status">
          <strong>组合预览</strong>
          <span className="count-badge">
            {activeCount} / {allCombos.length} 活跃
          </span>
        </div>
        {activeCount > 0 && (
          <div className="est-time">
            <Clock size={14} />
            预计 {estMinutes} 分钟
          </div>
        )}
      </div>
      {allCombos.length === 0 ? (
        <div className="empty-strip">启用轴并填写取值后会显示组合预览</div>
      ) : (
        <div className="preview-table custom-scrollbar">
          {allCombos.slice(0, 100).map((combo, index) => {
            const isExcluded = excludedIndices.has(index);
            return (
              <div
                className={`preview-row ${isExcluded ? "excluded" : ""}`}
                key={`${combo.label}-${index}`}
                onClick={() => onToggleIndex(index)}
              >
                <div className="row-selector">
                  <div className={`checkbox-mini ${!isExcluded ? "checked" : ""}`}>
                    {!isExcluded && <div className="check-mark" />}
                  </div>
                  <span className="idx">{index + 1}</span>
                </div>
                <div className="row-content">
                  <strong className="label">{combo.label}</strong>
                  <code className="patch-info">{JSON.stringify(combo.patch)}</code>
                </div>
              </div>
            );
          })}
          {allCombos.length > 100 && <div className="empty-strip">仅预览前 100 个组合</div>}
        </div>
      )}
    </div>
  );
}

function LoraDetailModal({
  modelType,
  item,
  triggerWords,
  client,
  apiBase,
  settings,
  onClose,
  onInsert,
  onInsertWords,
  onTriggerWords,
  onSaveTriggerWords,
  onToast,
  pullingExamples,
  exampleStatus,
  onPullExamples,
}: {
  modelType: ManagedModelType;
  item: LoraItem;
  triggerWords: string[];
  client: ComfyClient;
  apiBase: string;
  settings: LoraManagerSettings;
  onClose: () => void;
  onInsert: (target: TemplateKind, strength: number) => void;
  onInsertWords: (target: TemplateKind, words: string[]) => void;
  onTriggerWords: () => void;
  onSaveTriggerWords: (words: string[]) => Promise<string[]>;
  onToast: (type: Toast["type"], title: string, message?: string) => void;
  pullingExamples: boolean;
  exampleStatus: ExampleImagesStatus | null;
  onPullExamples: (item: LoraItem) => Promise<LoraExampleMedia[]>;
}) {
  const [strength, setStrength] = useState(1);
  const [metadata, setMetadata] = useState<LoraMetadata | null>(null);
  const [localFiles, setLocalFiles] = useState<LoraExampleMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailError, setDetailError] = useState("");
  const [lightboxMedia, setLightboxMedia] = useState<{ media: LoraExampleMedia; index: number } | null>(null);
  const isLora = modelType === "loras";
  const key = item.model_name || item.file_name;
  const itemCivitai = item.civitai as LoraMetadata | undefined;
  const examples = useMemo(() => buildLoraExamples(apiBase, item, metadata, localFiles), [apiBase, item, metadata, localFiles]);
  const trainedWords = useMemo(() => uniqueStrings([
    ...triggerWords,
    ...(metadata?.trainedWords ?? []),
    ...(itemCivitai?.trainedWords ?? []),
  ]), [triggerWords, metadata, itemCivitai]);
  const tags = uniqueStrings([...(item.tags ?? []), ...(item.auto_tags ?? []), ...(metadata?.model?.tags ?? [])]);
  const versionName = metadata?.name ?? itemCivitai?.name ?? "N/A";
  const descriptionHtml = String(metadata?.description ?? metadata?.model?.description ?? item.notes ?? "");
  const usageSyntax = `<lora:${loraSyntaxName(item)}:${formatStrength(strength)}>`;
  const civitaiUrl = useMemo(() => buildLoraCivitaiUrl(item, metadata), [item, metadata]);

  function openCivitaiUrl() {
    if (!civitaiUrl) return;
    window.open(civitaiUrl, "_blank", "noopener,noreferrer");
  }

  async function handleSaveTriggerWords(words: string[]) {
    const savedWords = await onSaveTriggerWords(words);
    setMetadata((prev) => prev ? { ...prev, trainedWords: savedWords } : prev);
    return savedWords;
  }

  async function handlePullExamples() {
    const files = await onPullExamples(item);
    if (files.length > 0) {
      setLocalFiles(files);
    } else if (item.sha256) {
      const latestFiles = await client.getLoraExampleFiles(item.sha256).catch(() => []);
      setLocalFiles(latestFiles);
    }
    if (item.file_path) {
      const latestMetadata = await client.getManagedModelMetadataByPath(modelType, item.file_path).catch(() => undefined);
      if (latestMetadata) {
        setMetadata(latestMetadata);
      }
    }
  }

  useEffect(() => {
    let canceled = false;
    async function loadDetail() {
      setLoading(true);
      setDetailError("");
      
      let currentPath = item.file_path;
      let currentSha = item.sha256;

      let metadataTask = currentPath ? client.getManagedModelMetadataByPath(modelType, currentPath) : Promise.resolve(undefined);
      let [metadataResult] = await Promise.allSettled([metadataTask]);

      if ((metadataResult.status === "rejected" || (metadataResult.status === "fulfilled" && !metadataResult.value)) && currentPath) {
        try {
          const searchName = item.model_name || item.file_name || currentPath.split("/").pop() || "";
          if (searchName) {
            const searchRes = await client.listManagedModels(modelType, { search: searchName });
            const match = searchRes.items.find((x) => 
              x.model_name === searchName || 
              x.file_name === searchName || 
              x.file_path === currentPath ||
              loraSyntaxName(x) === currentPath
            );
            if (match?.file_path) {
              currentPath = match.file_path;
              currentSha = match.sha256;
              
              metadataTask = client.getManagedModelMetadataByPath(modelType, currentPath);
              const retryResult = await Promise.allSettled([metadataTask]);
              metadataResult = retryResult[0];
            }
          }
        } catch (e) {
          // Ignore search error
        }
      }

      const examplesTask = currentSha ? client.getLoraExampleFiles(currentSha) : Promise.resolve([]);
      const examplesResult = await Promise.allSettled([examplesTask]);
      
      if (canceled) return;
      if (metadataResult.status === "fulfilled") {
        setMetadata(metadataResult.value ?? null);
      } else {
        setDetailError(metadataResult.reason instanceof Error ? metadataResult.reason.message : String(metadataResult.reason));
      }
      if (examplesResult[0].status === "fulfilled") {
        setLocalFiles(examplesResult[0].value);
      } else if (!detailError) {
        setDetailError(examplesResult[0].reason instanceof Error ? examplesResult[0].reason.message : String(examplesResult[0].reason));
      }
      setLoading(false);
    }
    loadDetail();
    return () => {
      canceled = true;
    };
  }, [client, modelType, item]);

  return (
    <ModalFrame title={key} onClose={onClose}>
      <div className={isLora ? "lm-modal" : "lm-modal embedding-mode"}>
        <header className="lm-modal-header">
          <div className="lm-modal-title-row">
            <div className="lm-modal-title">
              <h2>{key}</h2>
              {civitaiUrl && (
                <button type="button" className="lm-civitai-link" title="前往 Civitai 对应模型" aria-label="前往 Civitai 对应模型" onClick={openCivitaiUrl}>
                  <Globe2 size={16} />
                  <span>Civitai</span>
                </button>
              )}
            </div>
          </div>
          <div className="lm-modal-actions">
            <button type="button" className="icon-button" disabled={!item.sha256 || pullingExamples} onClick={handlePullExamples}>
              <Download size={16} />
              {pullingExamples ? "拉取中" : "拉取示例图"}
            </button>
          </div>
          <TagCloud tags={tags} />
        </header>

        {detailError && <div className="empty-strip">详情数据读取失败：{detailError}</div>}

        <div className={examples.length > 0 || loading ? "lm-modal-body" : "lm-modal-body examples-empty"}>
          <section className="lm-info-section">
            <div className="lm-info-grid">
              <div className="lm-info-item lm-usage" style={{ gridColumn: "1 / -1", marginBottom: "8px" }}>
                <label>使用语法</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="lm-usage-row">
                    <code>{usageSyntax}</code>
                    <NumberField label="强度" value={strength} min={-10} max={10} step={0.05} onChange={setStrength} />
                    <button type="button" className="icon-button" onClick={() => {
                      navigator.clipboard?.writeText(usageSyntax);
                      onToast("success", "LoRA 语法已复制", usageSyntax);
                    }}><Copy size={16} /> 复制</button>
                  </div>
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    <button type="button" className="primary-action" onClick={() => onInsert("default", strength)}><BadgePlus size={16} /> 默认</button>
                    <button type="button" className="primary-action" onClick={() => onInsert("multi", strength)}><BadgePlus size={16} /> 多人</button>
                    <button type="button" className="primary-action" onClick={() => onInsert("highres", strength)}><BadgePlus size={16} /> 高修</button>
                  </div>
                </div>
              </div>
              <InfoItem label="版本" value={versionName} />
              <InfoItem label="文件名" value={item.file_name || "N/A"} />
              <InfoItem label="本地路径" value={item.file_path?.replace(/[^/]+$/, "") || item.folder || "N/A"} wide />
              <div className="lm-info-item lm-base-size">
                <div>
                  <label>基础模型</label>
                  <span>{metadata?.baseModel || item.base_model || "未知"}</span>
                </div>
                <div>
                  <label>文件大小</label>
                  <span>{formatBytes(item.file_size)}</span>
                </div>
              </div>

              <TriggerWordsPanel
                words={trainedWords}
                onRead={onTriggerWords}
                onSave={handleSaveTriggerWords}
                onCopy={(text) => {
                  navigator.clipboard?.writeText(text);
                  onToast("success", "触发词已复制", text);
                }}
                onInsertWords={onInsertWords}
              />

              <InfoItem 
                label="版本说明" 
                value={descriptionHtml} 
                wide 
                isHtml 
                onHtmlCopy={(text) => {
                  navigator.clipboard?.writeText(text);
                  onToast("success", "已复制该段内容", text);
                }} 
              />
            </div>
          </section>

          <section className="lm-showcase-section">
            <div className="lm-showcase-head">
              <strong className="lm-showcase-title">示例媒体 {examples.length ? `(${examples.length})` : ""}</strong>
            </div>
            <ExampleImagesProgressBar status={exampleStatus} pullingCount={pullingExamples ? 1 : 0} />
            <div className="lm-showcase-list">
                {loading && <div className="empty-strip">正在加载示例图片/视频...</div>}
                {!loading && examples.length === 0 && <div className="empty-strip">没有示例媒体，插件也会在这里显示导入入口</div>}
                {examples.map((media, index) => (
                  <LoraExampleCard
                    apiBase={apiBase}
                    media={media}
                    index={index}
                    key={`${media.source}-${media.url || media.path || index}`}
                    onToast={onToast}
                    settings={settings}
                    fallbackNsfwLevel={getItemNsfwLevel(item, metadata)}
                    onOpenMedia={(selectedMedia, selectedIndex) => setLightboxMedia({ media: selectedMedia, index: selectedIndex })}
                  />
                ))}
              </div>
          </section>
        </div>
        {lightboxMedia && (
          <MediaLightbox
            media={lightboxMedia.media}
            apiBase={apiBase}
            alt={`示例 ${lightboxMedia.index + 1}`}
            settings={settings}
            fallbackNsfwLevel={getItemNsfwLevel(item, metadata)}
            onClose={() => setLightboxMedia(null)}
          />
        )}
      </div>
    </ModalFrame>
  );
}

function LoraOperationModal({
  modelType,
  operation,
  client,
  selectedItems,
  notifications,
  onClose,
  onShowWelcome,
  onToast,
  onSettingsSaved,
  translationSettings,
  onTranslationSettingsSaved,
  settingsApiBase,
  onApiBaseSaved,
  onMutated,
}: {
  modelType: ManagedModelType;
  operation: LoraOperation;
  client: ComfyClient;
  settingsApiBase: string;
  selectedItems: LoraItem[];
  notifications: Toast[];
  onClose: () => void;
  onShowWelcome?: () => void;
  onToast: (type: Toast["type"], title: string, message?: string) => void;
  onSettingsSaved: (settings: LoraManagerSettings) => void;
  onApiBaseSaved: (base: string) => void;
  translationSettings: TranslationSettings;
  onTranslationSettingsSaved: (settings: TranslationSettings) => void;
  onMutated: (message?: string) => void | Promise<void>;
}) {
  const operationItems = "items" in operation ? operation.items : operation.type === "download" && operation.item ? [operation.item] : selectedItems;
  const [textValue, setTextValue] = useState(() => {
    if (operation.type === "rename") return operation.item.file_name;
    if (operation.type === "download") return String(loraModelId(operation.item) ?? "");
    return "";
  });
  const [secondaryValue, setSecondaryValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [duplicates, setDuplicates] = useState<LoraDuplicateGroup[]>([]);
  const [filenameConflicts, setFilenameConflicts] = useState<LoraDuplicateGroup[]>([]);
  const [updateRecords, setUpdateRecords] = useState<LoraUpdateRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<DoctorDiagnostic[]>([]);
  const [settings, setSettings] = useState<LoraManagerSettings>({});
  const [localTranslationSettings, setLocalTranslationSettings] = useState<TranslationSettings>(translationSettings);
  const [localApiBase, setLocalApiBase] = useState(settingsApiBase);
  const [activeTab, setActiveTab] = useState<"general" | "translation">("general");
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [rawData, setRawData] = useState<unknown>(null);

  const title = operationTitle(operation);

  async function loadOperationData() {
    setBusy(true);
    try {
      if (operation.type === "duplicates") {
        const [dupes, conflicts] = await Promise.all([
          client.findManagedModelDuplicates(modelType),
          client.findManagedModelFilenameConflicts(modelType),
        ]);
        setDuplicates(dupes.duplicates);
        setFilenameConflicts(conflicts.conflicts);
      }
      if (operation.type === "updates") {
        const result = await client.refreshManagedModelUpdates(modelType, { force: false });
        if (result.success === false) throw new Error(result.error || "更新检查失败");
        setUpdateRecords(result.records ?? []);
      }
      if (operation.type === "doctor") {
        const result = await client.getDoctorDiagnostics();
        if (result.success === false) throw new Error(result.error || "医生诊断失败");
        setDiagnostics(result.diagnostics ?? result.checks ?? []);
        setRawData(result);
      }
      if (operation.type === "settings") {
        try {
          const result = await client.getLoraManagerSettings();
          if (result.success !== false) {
            const nextSettings = normalizeLoraManagerSettings(result.settings ?? result);
            setSettings(nextSettings);
            setTextValue(String(nextSettings.example_images_path ?? ""));
            setSecondaryValue(String(nextSettings.lora_syntax_format ?? ""));
          }
        } catch (settingsError) {
          // 忽略设置读取失败，因为可能只是 API 地址没配对，允许用户继续修改 API 地址
          console.warn("Failed to load settings from server:", settingsError);
        }
      }
      if (operation.type === "civitai") {
        const hash = operation.item.sha256;
        if (!hash) throw new Error("该 LoRA 没有 SHA256");
        const result = await client.getManagedModelCivitaiByHash(modelType, hash);
        if (result.success === false) throw new Error(result.error || "Civitai 详情读取失败");
        setRawData(result);
      }
    } catch (error) {
      onToast("error", `${title}失败`, error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadOperationData();
  }, [operation.type, operation.type === "rename" || operation.type === "civitai" ? operation.item.file_path : operation.type === "download" ? operation.item?.file_path ?? "" : ""]);

  async function submitRename() {
    if (operation.type !== "rename") return;
    const nextName = textValue.trim();
    if (!nextName) {
      onToast("error", "重命名失败", "文件名不能为空");
      return;
    }
    setBusy(true);
    try {
      const result = await client.renameManagedModel(modelType, operation.item.file_path, nextName);
      if (result.success === false) throw new Error(result.error || "重命名失败");
      await onMutated("LoRA 已重命名");
      onClose();
    } catch (error) {
      onToast("error", "重命名失败", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitMove() {
    if (operation.type !== "move") return;
    const targetPath = textValue.trim();
    if (!targetPath || operation.items.length === 0) {
      onToast("error", "移动失败", "请选择 LoRA 并填写目标文件夹");
      return;
    }
    setBusy(true);
    try {
      const result = operation.items.length === 1
        ? await client.moveManagedModel(modelType, operation.items[0].file_path, targetPath, true)
        : await client.bulkMoveManagedModels(modelType, operation.items.map((item) => item.file_path), targetPath, true);
      if (result.success === false) throw new Error(result.error || "移动失败");
      await onMutated(`已移动 ${operation.items.length} 个 LoRA`);
      onClose();
    } catch (error) {
      onToast("error", "移动失败", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitDelete(items = operation.type === "delete" ? operation.items : []) {
    if (!items.length) {
      onToast("error", "删除失败", "没有选择 LoRA");
      return;
    }
    setBusy(true);
    try {
      const result = items.length === 1
        ? await client.deleteManagedModel(modelType, items[0].file_path)
        : await client.bulkDeleteManagedModels(modelType, items.map((item) => item.file_path));
      if (result.success === false) throw new Error(result.error || "删除失败");
      await onMutated(`已删除 ${items.length} 个 LoRA`);
      onClose();
    } catch (error) {
      onToast("error", "删除失败", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitDownload() {
    const modelId = Number(textValue || (operation.type === "download" ? loraModelId(operation.item) : undefined));
    const versionId = Number(secondaryValue || 0);
    if (!Number.isFinite(modelId) || modelId <= 0) {
      onToast("error", "下载失败", "请填写 Civitai model_id");
      return;
    }
    setBusy(true);
    try {
      const result = await client.downloadManagedModel(modelType, {
        model_id: modelId,
        model_version_id: versionId > 0 ? versionId : undefined,
        use_default_paths: true,
        source: "civitai",
      });
      if (result.success === false) throw new Error(result.error || "下载提交失败");
      onToast("success", "下载任务已提交", result.download_id ? `任务 ${result.download_id}` : undefined);
      if (result.download_id) {
        const progress = await client.getDownloadProgress(result.download_id).catch(() => null);
        setDownloadProgress(progress);
      }
    } catch (error) {
      onToast("error", "下载失败", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    const apiBaseChanged = localApiBase !== settingsApiBase;
    
    // 如果 API 地址变了，先尝试更新本地 API 地址，这样即使后端挂了也能切地址
    if (apiBaseChanged) {
      onApiBaseSaved(localApiBase);
    }

    // 只有在 API 地址没变或者后端可能可用的情况下才强制校验示例图目录
    if (!textValue.trim()) {
      if (!apiBaseChanged) {
        onToast("error", "必填项缺失", "第一次使用请务必配置【示例图目录】！");
        return;
      } else {
        // 如果改了 API 地址但没填目录，我们还是保存地址并关闭，但给个提醒
        onToast("success", "API 地址已更新");
        onClose();
        return;
      }
    }

    setBusy(true);
    try {
      const payload = {
        ...settings,
        example_images_path: textValue,
        lora_syntax_format: secondaryValue || settings.lora_syntax_format,
        onboarding_completed: true,
      };
      
      try {
        const result = await client.updateLoraManagerSettings(payload);
        if (result.success === false) throw new Error(result.error || "设置保存失败");
        const nextSettings = normalizeLoraManagerSettings(result.settings ?? payload);
        setSettings(nextSettings);
        onSettingsSaved(nextSettings);
      } catch (serverError) {
        // 如果后端不可达，但在改 API 地址，我们忽略后端保存失败
        if (!apiBaseChanged) {
          throw serverError;
        }
        console.warn("Failed to sync settings to server, but API base was updated:", serverError);
      }

      onTranslationSettingsSaved(localTranslationSettings);
      onToast("success", apiBaseChanged ? "设置已更新 (API 地址已修改)" : "设置已保存");
      onClose();
    } catch (error) {
      onToast("error", "设置保存失败", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function doctorAction(action: "repair" | "resolve" | "export") {
    setBusy(true);
    try {
      const result = action === "repair"
        ? await client.repairDoctorCache()
        : action === "resolve"
          ? await client.resolveDoctorFilenameConflicts()
          : await client.exportDoctorBundle();
      if (result.success === false) throw new Error(result.error || "医生操作失败");
      onToast("success", "医生操作完成", String(result.message || result.path || result.bundle_path || ""));
      await loadOperationData();
    } catch (error) {
      onToast("error", "医生操作失败", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalFrame title={title} onClose={onClose}>
      <div className="operation-modal">
        {busy && <div className="empty-strip">处理中...</div>}
        {operation.type === "rename" && (
          <>
            <TextInput label="新文件名" value={textValue} onChange={setTextValue} />
            <div className="operation-actions">
              <button type="button" className="primary-action" onClick={submitRename}><Settings size={16} /> 保存重命名</button>
            </div>
          </>
        )}
        {operation.type === "move" && (
          <>
            <div className="empty-strip">将移动 {operation.items.length} 个 LoRA。目标路径可填写插件默认 LoRA 根目录下的相对文件夹。</div>
            <TextInput label="目标文件夹" value={textValue} onChange={setTextValue} placeholder="例如 character/pony" />
            <ItemList items={operation.items} />
            <div className="operation-actions">
              <button type="button" className="primary-action" onClick={submitMove}><FolderOpen size={16} /> 确认移动</button>
            </div>
          </>
        )}
        {operation.type === "delete" && (
          <>
            <div className="empty-strip danger-text">将真实删除 {operation.items.length} 个 LoRA 文件及相关缓存。</div>
            <ItemList items={operation.items} />
            <div className="operation-actions">
              <button type="button" className="primary-action danger" onClick={() => submitDelete()}><Trash2 size={16} /> 确认删除</button>
            </div>
          </>
        )}
        {operation.type === "download" && (
          <>
            <TextInput label="Civitai model_id" value={textValue} onChange={setTextValue} placeholder="必填" />
            <TextInput label="model_version_id" value={secondaryValue} onChange={setSecondaryValue} placeholder="可选，留空下载默认版本" />
            {downloadProgress && <pre className="json-preview">{JSON.stringify(downloadProgress, null, 2)}</pre>}
            <div className="operation-actions">
              <button type="button" className="primary-action" onClick={submitDownload}><Download size={16} /> 提交下载</button>
              <button type="button" className="icon-button" onClick={() => client.pauseDownload()}><PauseCircle size={16} /> 暂停</button>
              <button type="button" className="icon-button" onClick={() => client.resumeDownload()}><PlayCircle size={16} /> 恢复</button>
              <button type="button" className="icon-button danger" onClick={() => client.cancelDownload()}><X size={16} /> 取消</button>
            </div>
          </>
        )}
        {operation.type === "duplicates" && (
          <DuplicatePane duplicates={duplicates} filenameConflicts={filenameConflicts} onDeleteCopies={(items) => submitDelete(items)} />
        )}
        {operation.type === "updates" && (
          <UpdatesPane modelType={modelType} records={updateRecords} client={client} onRefresh={loadOperationData} onToast={onToast} />
        )}
        {operation.type === "doctor" && (
          <DoctorPane diagnostics={diagnostics} rawData={rawData} onAction={doctorAction} />
        )}
        {operation.type === "settings" && (
          <div style={{ display: "flex", gap: "1.5rem", height: "65vh", minHeight: "450px", overflow: "hidden" }}>
            {/* Sidebar */}
            <div style={{ width: "200px", display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", paddingRight: "1rem", height: "100%" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", flex: 1, overflowY: "auto" }}>
                <button 
                  type="button" 
                  onClick={() => setActiveTab("general")} 
                  style={{ 
                    textAlign: "left", padding: "0.75rem 1rem", borderRadius: "8px", border: "none", cursor: "pointer", 
                    backgroundColor: activeTab === "general" ? "var(--surface-alt)" : "transparent",
                    color: activeTab === "general" ? "var(--text)" : "var(--muted)",
                    fontWeight: activeTab === "general" ? 600 : 400
                  }}
                >
                  ⚙️ 基本设置
                </button>
                <button 
                  type="button" 
                  onClick={() => setActiveTab("translation")} 
                  style={{ 
                    textAlign: "left", padding: "0.75rem 1rem", borderRadius: "8px", border: "none", cursor: "pointer", 
                    backgroundColor: activeTab === "translation" ? "var(--surface-alt)" : "transparent",
                    color: activeTab === "translation" ? "var(--text)" : "var(--muted)",
                    fontWeight: activeTab === "translation" ? 600 : 400
                  }}
                >
                  🌐 翻译设置
                </button>
              </div>
              <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
                <button type="button" className="primary-action" onClick={saveSettings} style={{ width: "100%", justifyContent: "center" }}>
                  <Settings size={16} /> 保存设置
                </button>
              </div>
            </div>

            {/* Content Area */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem", overflowY: "auto", paddingRight: "0.5rem" }}>
              {activeTab === "general" && (
                <>
                  <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem", fontWeight: 600 }}>基本设置</h3>
                  <TextInput label="API Base URL" value={localApiBase} onChange={setLocalApiBase} placeholder="/comfy" />
                  <TextInput label="示例图目录 (首次使用必填)" value={textValue} onChange={setTextValue} placeholder={`必须配置，例如 ${CONFIG.DEFAULT_EXAMPLE_IMAGE_PATH}`} />
                  <TextInput label="LoRA 语法格式" value={secondaryValue} onChange={setSecondaryValue} placeholder="legacy / full" />
                  <div className="form-grid two compact">
                    <label className="field checkbox-field">
                      <input
                        type="checkbox"
                        checked={settings.blur_mature_content !== false}
                        onChange={(event) => setSettings((prev) => ({ ...prev, blur_mature_content: event.target.checked }))}
                      />
                      模糊限制级内容
                    </label>
                    <label className="field">
                      <span>限制级模糊阈值</span>
                      <select
                        value={normalizeMatureBlurLevel(settings.mature_blur_level)}
                        onChange={(event) => setSettings((prev) => ({ ...prev, mature_blur_level: event.target.value }))}
                      >
                        {validMatureBlurLevels.map((level) => <option key={level} value={level}>{level}</option>)}
                      </select>
                    </label>
                  </div>
                  <pre className="json-preview">{JSON.stringify(settings, null, 2)}</pre>
                </>
              )}

              {activeTab === "translation" && (
                <>
                  <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem", fontWeight: 600 }}>翻译设置</h3>
                  <div className="form-grid two compact">
                    <label className="field">
                      <span>翻译服务商</span>
                      <select 
                        value={localTranslationSettings.provider} 
                        onChange={(e) => setLocalTranslationSettings({ ...localTranslationSettings, provider: e.target.value as TranslationProvider })}
                      >
                        <option value="mymemory">MyMemory (免费)</option>
                        <option value="baidu">百度翻译 (Baidu)</option>
                        <option value="aliyun">阿里云翻译 (Alibaba)</option>

                      </select>
                    </label>
                  </div>
                  {localTranslationSettings.provider === "baidu" && (
                    <div className="form-grid two compact">
                      <TextInput label="App ID" value={localTranslationSettings.baiduAppId || ""} onChange={(v) => setLocalTranslationSettings({ ...localTranslationSettings, baiduAppId: v })} placeholder="百度翻译 App ID" />
                      <label className="field text-field">
                        <span>Secret Key</span>
                        <input type="password" value={localTranslationSettings.baiduSecret || ""} onChange={(e) => setLocalTranslationSettings({ ...localTranslationSettings, baiduSecret: e.target.value })} placeholder="百度翻译 Secret Key" />
                      </label>
                    </div>
                  )}
                  {localTranslationSettings.provider === "aliyun" && (
                    <div className="form-grid two compact">
                      <TextInput label="AccessKey ID" value={localTranslationSettings.aliyunAccessKeyId || ""} onChange={(v) => setLocalTranslationSettings({ ...localTranslationSettings, aliyunAccessKeyId: v })} placeholder="阿里云 AccessKey ID" />
                      <label className="field text-field">
                        <span>AccessKey Secret</span>
                        <input type="password" value={localTranslationSettings.aliyunAccessKeySecret || ""} onChange={(e) => setLocalTranslationSettings({ ...localTranslationSettings, aliyunAccessKeySecret: e.target.value })} placeholder="阿里云 AccessKey Secret" />
                      </label>
                    </div>
                  )}

                </>
              )}

            </div>
          </div>
        )}
        {operation.type === "notifications" && (
          <div className="notification-log">
            {onShowWelcome && (
              <div 
                className="toast info" 
                style={{ cursor: "pointer", border: "1px solid var(--accent)" }}
                onClick={onShowWelcome}
              >
                <div>
                  <strong>系统环境与模型依赖说明 (点击查看)</strong>
                  <p>查看运行本项目所需的 6 大核心插件与全部底层生图模型的下载地址。</p>
                </div>
              </div>
            )}
            {notifications.length === 0 && <div className="empty-strip">暂无其他通知</div>}
            {notifications.map((toast) => (
              <div className={`toast ${toast.type}`} key={toast.id}>
                <div>
                  <strong>{toast.title}</strong>
                  {toast.message && <p>{toast.message}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
        {operation.type === "civitai" && (
          <pre className="json-preview">{JSON.stringify(rawData, null, 2)}</pre>
        )}
      </div>
    </ModalFrame>
  );
}

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ItemList({ items }: { items: LoraItem[] }) {
  return (
    <div className="operation-list">
      {items.map((item) => (
        <div className="lm-list-row" key={item.file_path}>
          <div>
            <strong>{item.model_name || item.file_name}</strong>
            <span>{item.file_path}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function DuplicatePane({ duplicates, filenameConflicts, onDeleteCopies }: { duplicates: LoraDuplicateGroup[]; filenameConflicts: LoraDuplicateGroup[]; onDeleteCopies: (items: LoraItem[]) => void }) {
  const groups = [...duplicates, ...filenameConflicts];
  return (
    <div className="lm-list-pane">
      <div className="section-toolbar">
        <strong>重复组 {groups.length}</strong>
      </div>
      {groups.length === 0 && <div className="empty-strip">没有发现重复项或文件名冲突</div>}
      {groups.map((group, index) => {
        const copies = group.models.slice(1);
        return (
          <div className="duplicate-group" key={`${group.hash ?? group.filename ?? index}`}>
            <div className="section-toolbar">
              <strong>{group.hash ?? group.filename ?? `重复组 ${index + 1}`}</strong>
              <button type="button" className="lm-text-btn danger" disabled={!copies.length} onClick={() => onDeleteCopies(copies)}><Trash2 size={13} /> 删除副本</button>
            </div>
            <ItemList items={group.models} />
          </div>
        );
      })}
    </div>
  );
}

function UpdatesPane({ modelType, records, client, onRefresh, onToast }: { modelType: ManagedModelType; records: LoraUpdateRecord[]; client: ComfyClient; onRefresh: () => void | Promise<void>; onToast: (type: Toast["type"], title: string, message?: string) => void }) {
  async function ignore(record: LoraUpdateRecord) {
    const modelId = updateRecordModelId(record);
    if (!modelId) return;
    try {
      const result = await client.ignoreManagedModelUpdate(modelType, modelId, !Boolean(record.shouldIgnore ?? record.should_ignore));
      if (result.success === false) throw new Error(result.error || "忽略更新失败");
      onToast("success", "更新状态已写回");
      await onRefresh();
    } catch (error) {
      onToast("error", "忽略更新失败", error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="lm-list-pane">
      <div className="section-toolbar">
        <strong>可更新 LoRA {records.length}</strong>
        <button type="button" className="lm-text-btn" onClick={() => onRefresh()}><RefreshCw size={13} /> 重新检查</button>
      </div>
      {records.length === 0 && <div className="empty-strip">没有发现可更新版本</div>}
      {records.map((record) => (
        <div className="lm-list-row" key={updateRecordModelId(record) ?? JSON.stringify(record).slice(0, 48)}>
          <div>
            <strong>{String(record.modelName ?? record.model_name ?? updateRecordModelId(record) ?? "未知模型")}</strong>
            <span>{String(record.latest_version_id ?? record.latestVersionId ?? "")}</span>
          </div>
          <button type="button" className="lm-text-btn" onClick={() => ignore(record)}>
            {record.shouldIgnore || record.should_ignore ? "恢复更新" : "忽略更新"}
          </button>
        </div>
      ))}
    </div>
  );
}

function DoctorPane({ diagnostics, rawData, onAction }: { diagnostics: DoctorDiagnostic[]; rawData: unknown; onAction: (action: "repair" | "resolve" | "export") => void | Promise<void> }) {
  return (
    <div className="lm-list-pane">
      <div className="operation-actions">
        <button type="button" className="primary-action" onClick={() => onAction("repair")}><RefreshCw size={16} /> 修复缓存</button>
        <button type="button" className="icon-button" onClick={() => onAction("resolve")}><Copy size={16} /> 解决文件名冲突</button>
        <button type="button" className="icon-button" onClick={() => onAction("export")}><FileText size={16} /> 导出诊断包</button>
      </div>
      {diagnostics.length === 0 && <pre className="json-preview">{JSON.stringify(rawData, null, 2)}</pre>}
      {diagnostics.map((item, index) => (
        <div className={`doctor-row ${String(item.status ?? item.severity ?? "info").toLowerCase()}`} key={item.key ?? item.label ?? index}>
          <strong>{String(item.label ?? item.title ?? item.key ?? `检查 ${index + 1}`)}</strong>
          <span>{String(item.status ?? item.severity ?? "")}</span>
          <p>{String(item.message ?? item.details ?? "")}</p>
        </div>
      ))}
    </div>
  );
}

function InfoItem({ label, value, wide = false, isHtml = false, onHtmlCopy }: { label: string; value: string; wide?: boolean; isHtml?: boolean; onHtmlCopy?: (text: string) => void }) {
  if (!value) return null;
  return (
    <div className="lm-info-item" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <label>{label}</label>
      {isHtml ? (
        <div 
          className="html-content" 
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value) }} 
          onClick={(e) => {
            const target = e.target as HTMLElement;
            const block = target.closest('pre, code');
            if (block && onHtmlCopy) {
              onHtmlCopy(block.textContent || "");
            }
          }}
        />
      ) : (
        <span>{value}</span>
      )}
    </div>
  );
}

function TagCloud({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div className="lm-tag-cloud">
      {tags.slice(0, 20).map((tag) => <span key={tag}>{tag}</span>)}
    </div>
  );
}

function TriggerWordsPanel({
  words,
  onRead,
  onSave,
  onCopy,
  onInsertWords,
}: {
  words: string[];
  onRead: () => void;
  onSave: (words: string[]) => Promise<string[]>;
  onCopy: (text: string) => void;
  onInsertWords?: (target: TemplateKind, words: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftWords, setDraftWords] = useState<string[]>(words);
  const [draftInput, setDraftInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraftWords(words);
    }
  }, [editing, words]);

  function startEditing() {
    setDraftWords(words);
    setDraftInput("");
    setEditing(true);
  }

  function addDraftWords(value = draftInput) {
    const nextWords = parseTriggerWordsInput(value);
    if (nextWords.length === 0) return;
    setDraftWords((current) => uniqueStrings([...current, ...nextWords]));
    setDraftInput("");
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addDraftWords();
    }
    if (event.key === "Escape") {
      setDraftInput("");
    }
  }

  async function saveDraftWords() {
    setSaving(true);
    try {
      const savedWords = await onSave(uniqueStrings([...draftWords, ...parseTriggerWordsInput(draftInput)]));
      setDraftWords(savedWords);
      setDraftInput("");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const visibleWords = editing ? draftWords : words;

  return (
    <div className={editing ? "lm-info-item lm-trigger-words editing" : "lm-info-item lm-trigger-words"}>
      <div className="lm-section-head">
        <label>触发词</label>
        <div className="lm-trigger-actions">
          {!editing && visibleWords.length > 0 && onInsertWords && (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginRight: '8px', paddingRight: '8px', borderRight: '1px solid var(--border-color)' }}>
              <button type="button" className="lm-text-btn" onClick={() => onInsertWords('default', visibleWords)} title="追加到默认生图正向提示词"><BadgePlus size={14} /> 默认</button>
              <button type="button" className="lm-text-btn" onClick={() => onInsertWords('multi', visibleWords)} title="追加到多人工作流正向提示词"><BadgePlus size={14} /> 多人</button>
              <button type="button" className="lm-text-btn" onClick={() => onInsertWords('highres', visibleWords)} title="追加到高清修复正向提示词"><BadgePlus size={14} /> 高修</button>
            </div>
          )}
          {!editing && <button type="button" className="lm-text-btn" onClick={onRead}><Brain size={14} /> 读取</button>}
          {!editing && <button type="button" className="lm-text-btn" onClick={startEditing}><Plus size={14} /> 编辑</button>}
          {editing && <button type="button" className="lm-text-btn" disabled={saving} onClick={saveDraftWords}><CheckCircle2 size={14} /> 保存</button>}
          {editing && <button type="button" className="lm-text-btn" disabled={saving} onClick={() => { setDraftWords(words); setDraftInput(""); setEditing(false); }}><X size={14} /> 取消</button>}
        </div>
      </div>
      {editing && (
        <div className="lm-trigger-editor">
          <input
            value={draftInput}
            placeholder="添加触发词，回车确认"
            onChange={(event) => setDraftInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <button type="button" className="lm-text-btn" onClick={() => addDraftWords()}><Plus size={14} /> 添加</button>
        </div>
      )}
      <div className="lm-trigger-tags">
        {visibleWords.length === 0 && <span className="muted-text">暂无触发词</span>}
        {visibleWords.map((word) => (
          <button type="button" key={word} onClick={() => editing ? undefined : onCopy(word)}>
            <span>{word}</span>
            {editing ? (
              <X
                size={13}
                onClick={(event) => {
                  event.stopPropagation();
                  setDraftWords((current) => current.filter((item) => item !== word));
                }}
              />
            ) : (
              <Copy size={13} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function LoraExampleCard({
  media,
  apiBase,
  index,
  onToast,
  settings,
  fallbackNsfwLevel = 0,
  onOpenMedia,
}: {
  media: LoraExampleMedia;
  apiBase: string;
  index: number;
  onToast: (type: Toast["type"], title: string, message?: string) => void;
  settings: LoraManagerSettings;
  fallbackNsfwLevel?: number;
  onOpenMedia?: (media: LoraExampleMedia, index: number) => void;
}) {
  const src = normalizePreview(apiBase, media.path || media.url);
  const meta = media.meta ?? {};
  const label = media.source === "local" ? "Local" : media.source === "preview" ? "Preview" : src ? "Civitai" : "Missing";
  const nsfwLevel = getMediaNsfwLevel(media, fallbackNsfwLevel);
  const canOpenMedia = Boolean(src) && !isLoraVideo(media, src);
  return (
    <article className={shouldBlurNsfwLevel(nsfwLevel, settings) ? "lm-example-card nsfw-content" : "lm-example-card"} data-nsfw-level={nsfwLevel}>
      <div className="lm-example-media">
        <div className="lm-media-badge">{isLoraVideo(media, src) ? <Film size={14} /> : <ImageIcon size={14} />} {label} #{index + 1}</div>
        {canOpenMedia && (
          <button type="button" className="lm-media-open-btn" title="查看大图" onClick={() => onOpenMedia?.(media, index)}>
            <Maximize2 size={15} />
          </button>
        )}
        <LoraMedia
          media={media}
          apiBase={apiBase}
          alt={`示例 ${index + 1}`}
          controls
          settings={settings}
          fallbackNsfwLevel={fallbackNsfwLevel}
          onOpen={canOpenMedia ? () => onOpenMedia?.(media, index) : undefined}
        />
      </div>
      <LoraExampleMetadata meta={meta} onToast={onToast} />
    </article>
  );
}

function MediaLightbox({
  media,
  apiBase,
  alt,
  settings,
  fallbackNsfwLevel,
  onClose,
}: {
  media: LoraExampleMedia;
  apiBase: string;
  alt: string;
  settings: LoraManagerSettings;
  fallbackNsfwLevel: number;
  onClose: () => void;
}) {
  return (
    <div className="lm-lightbox" role="dialog" aria-modal="true" aria-label="查看大图" onMouseDown={onClose}>
      <div className="lm-lightbox-content" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="lm-lightbox-close" title="关闭" onClick={onClose}><X size={18} /></button>
        <LoraMedia media={media} apiBase={apiBase} alt={alt} controls settings={settings} fallbackNsfwLevel={fallbackNsfwLevel} />
      </div>
    </div>
  );
}

function LoraExampleMetadata({ meta, onToast }: { meta: LoraMediaMeta; onToast: (type: Toast["type"], title: string, message?: string) => void }) {
  const prompt = String(meta.prompt ?? "");
  const negative = String(meta.negativePrompt ?? meta.negative_prompt ?? "");
  const params = [
    ["Size", meta.Size],
    ["Seed", meta.seed],
    ["Steps", meta.steps],
    ["Sampler", meta.sampler],
    ["CFG", meta.cfgScale],
    ["Clip Skip", meta.clipSkip],
    ["Model", meta.Model],
  ].filter(([, value]) => value !== undefined && value !== "");
  const hasMeta = params.length > 0 || prompt || negative;
  if (!hasMeta) {
    return <div className="lm-metadata-panel no-meta"><Info size={15} /> 没有生成参数</div>;
  }
  const copy = (title: string, text: string) => {
    navigator.clipboard?.writeText(text);
    onToast("success", `${title} 已复制`);
  };
  return (
    <div className="lm-metadata-panel">
      {params.length > 0 && (
        <div className="lm-param-tags">
          {params.map(([name, value]) => (
            <span key={name}><strong>{name}:</strong> {String(value)}</span>
          ))}
        </div>
      )}
      {prompt && <PromptBlock label="Prompt" value={prompt} onCopy={() => copy("Prompt", prompt)} />}
      {negative && <PromptBlock label="Negative Prompt" value={negative} onCopy={() => copy("Negative Prompt", negative)} />}
    </div>
  );
}

function PromptBlock({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="lm-prompt-block">
      <div className="lm-section-head">
        <label>{label}</label>
        <button type="button" className="lm-text-btn" onClick={onCopy}><Copy size={13} /> 复制</button>
      </div>
      <pre>{value}</pre>
    </div>
  );
}

const LoraMedia = memo(({
  media,
  apiBase,
  alt,
  controls = false,
  settings,
  fallbackNsfwLevel = 0,
  onOpen,
}: {
  media: LoraExampleMedia;
  apiBase: string;
  alt: string;
  controls?: boolean;
  settings: LoraManagerSettings;
  fallbackNsfwLevel?: number;
  onOpen?: () => void;
}) => {
  const src = normalizePreview(apiBase, media.path || media.url);
  const [revealed, setRevealed] = useState(false);
  const nsfwLevel = getMediaNsfwLevel(media, fallbackNsfwLevel);
  const shouldBlur = shouldBlurNsfwLevel(nsfwLevel, settings);
  const isBlurred = shouldBlur && !revealed;

  useEffect(() => {
    setRevealed(false);
  }, [src, shouldBlur]);

  if (!src) {
    return <div className="lm-media-empty"><Layers size={34} /></div>;
  }
  const mediaClassName = isBlurred ? "lm-media-asset blurred" : "lm-media-asset";
  const mediaClassWithOpen = onOpen && !isBlurred ? `${mediaClassName} openable` : mediaClassName;
  const warningText = getNsfwWarningText(nsfwLevel);
  const levelName = getNSFWLevelName(nsfwLevel);
  const toggleTitle = revealed ? "重新模糊限制级内容" : "显示限制级内容";
  const stopClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setRevealed((current) => !current);
  };

  const mediaNode = isLoraVideo(media, src) ? (
    <video
      src={src}
      controls={controls}
      autoPlay={!controls}
      muted
      loop
      playsInline
      preload="none"
      className={mediaClassWithOpen}
      data-nsfw-level={nsfwLevel}
    />
  ) : (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      draggable={false}
      className={mediaClassWithOpen}
      data-nsfw-level={nsfwLevel}
      onClick={onOpen && !isBlurred ? (event) => {
        event.stopPropagation();
        onOpen();
      } : undefined}
    />
  );

  return (
    <div className={shouldBlur ? "lm-media-frame nsfw-media-wrapper" : "lm-media-frame"} data-nsfw-level={nsfwLevel}>
      {mediaNode}
      {shouldBlur && (
        <button type="button" className="lm-restricted-toggle" title={toggleTitle} aria-label={toggleTitle} onClick={stopClick}>
          {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      )}
      {isBlurred && (
        <div className="lm-nsfw-overlay">
          <div className="lm-nsfw-warning">
            <p>{warningText}</p>
            <small>NSFW {levelName}</small>
            <button type="button" className="lm-show-content-btn" onClick={stopClick}>Show</button>
          </div>
        </div>
      )}
    </div>
  );
}, (prev, next) => {
  return prev.apiBase === next.apiBase &&
         prev.alt === next.alt &&
         prev.controls === next.controls &&
         prev.settings === next.settings &&
         prev.fallbackNsfwLevel === next.fallbackNsfwLevel &&
         prev.onOpen === next.onOpen &&
         prev.media.url === next.media.url &&
         prev.media.path === next.media.path &&
         prev.media.type === next.media.type &&
         prev.media.source === next.media.source;
});

function BaseControls<T extends BaseGenerationParams>({
  params,
  options,
  setParams,
  hidePositive = false,
  disableStickyPrompt = false,
  onLoraDetail,
  apiBase,
  settings,
  localExampleFilesByHash = {},
}: {
  params: T;
  options: OptionsState;
  setParams: (updater: (prev: T) => T) => void;
  hidePositive?: boolean;
  disableStickyPrompt?: boolean;
  onLoraDetail?: (lora: LoraSelection) => void;
  apiBase: string;
  settings: LoraManagerSettings;
  localExampleFilesByHash?: Record<string, LoraExampleMedia[]>;
}) {
  const setField = <K extends keyof T>(key: K, value: T[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <>
      <div className="form-grid three">
        <SelectField label="大模型" value={params.checkpoint} options={options.checkpoints} onChange={(value) => setField("checkpoint", value as T["checkpoint"])} />
        <label className="field">
          <span>宽高预设</span>
          <select value={findResolutionPreset(params.width, params.height)} onChange={(event) => {
            const preset = resolutionPresets.find((item) => item.label === event.target.value);
            if (preset) {
              setParams((prev) => ({ ...prev, width: preset.width, height: preset.height }));
            }
          }}>
            {resolutionPresets.map((preset) => <option key={preset.label} value={preset.label}>{preset.label}</option>)}
            <option value="custom">自定义</option>
          </select>
        </label>
        <NumberField label="宽" value={params.width} min={16} step={8} onChange={(value) => setField("width", value as T["width"])} />
        <NumberField label="高" value={params.height} min={16} step={8} onChange={(value) => setField("height", value as T["height"])} />
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
        <NumberField label="批量" value={params.batchSize} min={1} step={1} onChange={(value) => setField("batchSize", value as T["batchSize"])} />
        <NumberField label={params.randomizeSeed ? "Seed（随机生成）" : "Seed"} value={params.seed} min={0} step={1} disabled={params.randomizeSeed} onChange={(value) => setField("seed", value as T["seed"])} />
        <label className="field checkbox-field"><input type="checkbox" checked={params.randomizeSeed} onChange={(event) => setField("randomizeSeed", event.target.checked as T["randomizeSeed"])} /> 随机 seed</label>
        <NumberField label="Steps" value={params.steps} min={1} step={1} onChange={(value) => setField("steps", value as T["steps"])} />
        <NumberField label="CFG" value={params.cfg} min={0} step={0.1} onChange={(value) => setField("cfg", value as T["cfg"])} />
        <NumberField label="重绘" value={params.denoise} min={0} max={1} step={0.01} onChange={(value) => setField("denoise", value as T["denoise"])} />
        <SelectField label="采样器" value={params.samplerName} options={options.samplers} onChange={(value) => setField("samplerName", value as T["samplerName"])} />
        <SelectField label="调度器" value={params.scheduler} options={options.schedulers} onChange={(value) => setField("scheduler", value as T["scheduler"])} />
        <label className="field">
          <span>保存路径预设</span>
          <select value={findPathPreset(params.filenamePrefix)} onChange={(event) => {
            if (event.target.value !== "custom") {
              setField("filenamePrefix", event.target.value as T["filenamePrefix"]);
            }
          }}>
            {pathPresets.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
            <option value="custom">自定义</option>
          </select>
        </label>
        <label className="field">
          <span>保存前缀</span>
          <input value={params.filenamePrefix} onChange={(event) => setField("filenamePrefix", event.target.value as T["filenamePrefix"])} />
        </label>
      </div>
      {disableStickyPrompt ? (
        <>
          {!hidePositive && (
            <div className="form-grid two prompt-grid">
              <TextAreaField label="正向提示词" value={params.positivePrompt} onChange={(value) => setField("positivePrompt", value as T["positivePrompt"])} />
              <TextAreaField label="反向提示词" value={params.negativePrompt} onChange={(value) => setField("negativePrompt", value as T["negativePrompt"])} />
            </div>
          )}
          {hidePositive && (
            <TextAreaField label="反向提示词" value={params.negativePrompt} onChange={(value) => setField("negativePrompt", value as T["negativePrompt"])} />
          )}
        </>
      ) : (
        <>
          <div className="prompt-sticky-container">
            {!hidePositive && (
              <div className="form-grid two prompt-grid">
                <TextAreaField label="正向提示词" value={params.positivePrompt} onChange={(value) => setField("positivePrompt", value as T["positivePrompt"])} hideChips />
                <TextAreaField label="反向提示词" value={params.negativePrompt} onChange={(value) => setField("negativePrompt", value as T["negativePrompt"])} hideChips />
              </div>
            )}
            {hidePositive && (
              <TextAreaField label="反向提示词" value={params.negativePrompt} onChange={(value) => setField("negativePrompt", value as T["negativePrompt"])} hideChips />
            )}
          </div>
          <div className={hidePositive ? "form-grid prompt-grid" : "form-grid two prompt-grid"} style={{ marginTop: '0', paddingTop: '0' }}>
            {!hidePositive && (
              <div>
                {params.positivePrompt.trim() && <PromptTagBlocks value={params.positivePrompt} onChange={(value) => setField("positivePrompt", value as T["positivePrompt"])} />}
              </div>
            )}
            <div>
              {params.negativePrompt.trim() && <PromptTagBlocks value={params.negativePrompt} onChange={(value) => setField("negativePrompt", value as T["negativePrompt"])} />}
            </div>
          </div>
        </>
      )}
      <LoraChips loras={params.loras} onChange={(loras) => setField("loras", loras as T["loras"])} onDetail={onLoraDetail} apiBase={apiBase} settings={settings} localExampleFilesByHash={localExampleFilesByHash} />
    </>
  );
}

function ColorAlphaField({ label, value, onChange }: { label: string, value: string, onChange: (v: string) => void }) {
  const hex = value.slice(0, 7) || "#000000";
  const alphaHex = value.slice(7, 9) || "FF";
  const alpha = isNaN(parseInt(alphaHex, 16)) ? 255 : parseInt(alphaHex, 16);

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value + alphaHex);
  };
  const handleAlphaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newAlphaHex = parseInt(e.target.value).toString(16).padStart(2, "0").toUpperCase();
    onChange(hex + newAlphaHex);
  };

  return (
    <label className="field" style={{ display: "flex", flexDirection: "column" }}>
      <span>{label} (不透明度: {Math.round(alpha/255*100)}%)</span>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" }}>
        <input type="color" value={hex} onChange={handleColorChange} style={{ width: "32px", height: "24px", padding: 0, border: "none" }} />
        <input type="range" min={0} max={255} value={alpha} onChange={handleAlphaChange} style={{ flex: 1 }} />
      </div>
    </label>
  );
}

function DrawTextCanvas({ width, height, drawText, onChange }: { width: number; height: number; drawText: DrawTextParams; onChange: (patch: Partial<DrawTextParams>) => void }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [scale, setScale] = useState(1);
  const startRef = useRef<{ x: number, y: number, offsetX: number, offsetY: number } | null>(null);

  useEffect(() => {
    const updateScale = () => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        setScale(rect.width / width);
      }
    };
    
    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (canvasRef.current) observer.observe(canvasRef.current);
    
    return () => observer.disconnect();
  }, [width, height]);

  const handlePointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    let targetOffsetX = clickX;
    let targetOffsetY = clickY;
    if (drawText.horizontalAlign === "center") targetOffsetX -= width / 2;
    else if (drawText.horizontalAlign === "right") targetOffsetX -= width;
    if (drawText.verticalAlign === "center") targetOffsetY -= height / 2;
    else if (drawText.verticalAlign === "bottom") targetOffsetY -= height;

    const newOffsetX = Math.round(targetOffsetX);
    const newOffsetY = Math.round(targetOffsetY);

    onChange({
      offsetX: newOffsetX,
      offsetY: newOffsetY,
    });

    setIsDragging(true);
    startRef.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: newOffsetX,
      offsetY: newOffsetY,
    };
    canvasRef.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !startRef.current || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    
    const deltaX = (e.clientX - startRef.current.x) * scaleX;
    const deltaY = (e.clientY - startRef.current.y) * scaleY;
    
    onChange({
      offsetX: Math.round(startRef.current.offsetX + deltaX),
      offsetY: Math.round(startRef.current.offsetY + deltaY),
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    startRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };

  let previewX = drawText.offsetX;
  let previewY = drawText.offsetY;
  
  if (drawText.horizontalAlign === "center") previewX += width / 2;
  else if (drawText.horizontalAlign === "right") previewX += width;
  
  if (drawText.verticalAlign === "center") previewY += height / 2;
  else if (drawText.verticalAlign === "bottom") previewY += height;

  const displayX = (previewX / width) * 100;
  const displayY = (previewY / height) * 100;

  return (
    <div className="draw-text-canvas-container" style={{ margin: "20px 0", background: "#1a1a1a", border: "1px solid #333", borderRadius: "12px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div className="section-toolbar" style={{ padding: "8px 16px", background: "#222", fontSize: "13px", display: "flex", justifyContent: "space-between", borderBottom: "1px solid #333" }}>
        <span style={{ fontWeight: 600, color: "#aaa" }}>文字位置视觉调整 (点击/拖拽紫色准星)</span>
        <span style={{ color: "#888" }}>当前画布比例: {width} x {height} ({ (width/height).toFixed(2) }:1)</span>
      </div>
      <div 
        className="draw-text-canvas-wrapper"
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          background: "#0d0d0d",
          padding: "40px",
          minHeight: "400px",
          position: "relative"
        }}
      >
        <div 
          ref={canvasRef}
          className="draw-text-canvas"
          style={{ 
            position: "relative", 
            width: width >= height ? "100%" : "auto",
            height: height > width ? "450px" : "auto",
            maxWidth: width >= height ? "800px" : "auto",
            aspectRatio: `${width}/${height}`, 
            cursor: "crosshair",
            backgroundImage: "linear-gradient(45deg, #181818 25%, transparent 25%), linear-gradient(-45deg, #181818 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #181818 75%), linear-gradient(-45deg, transparent 75%, #181818 75%)",
            backgroundSize: "20px 20px",
            backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
            border: "2px solid #444",
            touchAction: "none",
            boxShadow: "0 10px 30px rgba(0,0,0,0.8)",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div 
            className="text-anchor"
            style={{
              position: "absolute",
              left: `${displayX}%`,
              top: `${displayY}%`,
              width: "24px",
              height: "24px",
              marginLeft: "-12px",
              marginTop: "-12px",
              background: "#ff00ff",
              border: "2px solid #fff",
              borderRadius: "50%",
              boxShadow: "0 0 20px rgba(255,0,255,0.9)",
              pointerEvents: "none",
              zIndex: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <div style={{ width: "2px", height: "100%", background: "#fff", position: "absolute", opacity: 0.8 }} />
            <div style={{ width: "100%", height: "2px", background: "#fff", position: "absolute", opacity: 0.8 }} />
          </div>
          <div 
            style={{
              position: "absolute",
              left: `${displayX}%`,
              top: `${displayY}%`,
              color: drawText.color.startsWith('#') ? drawText.color : "#fff",
              fontSize: `${drawText.size * scale}px`,
              fontWeight: 500,
              whiteSpace: "nowrap",
              transform: `translate(${drawText.horizontalAlign === 'center' ? '-50%' : drawText.horizontalAlign === 'right' ? '-100%' : '0'}, ${drawText.verticalAlign === 'center' ? '-50%' : drawText.verticalAlign === 'bottom' ? '-100%' : '0'}) rotate(${drawText.rotation}deg)`,
              opacity: 0.8,
              pointerEvents: "none",
              textShadow: "0 2px 4px rgba(0,0,0,0.8)",
              padding: "4px 8px",
              textDecoration: drawText.decoration.split(',').map(d => {
                if (d === 'underline') return 'underline';
                if (d === 'bold_underline') return 'underline 3px';
                if (d === 'double_underline') return 'underline double';
                if (d === 'dotted_underline') return 'underline dotted';
                if (d === 'dashed_underline') return 'underline dashed';
                if (d === 'dot_dash_underline') return 'underline dash-dot';
                if (d === 'wave_underline') return 'underline wavy';
                if (d === 'underline_bold_wavy') return 'underline wavy 4px';
                if (d === 'double_wave_underline') return 'underline wavy double';
                if (d === 'zigzag_underline') return 'underline wavy 2px';
                if (d === 'strikethrough') return 'line-through';
                if (d === 'double_strikethrough') return 'line-through double';
                if (d === 'double_strikethrough_bold') return 'line-through double 3px';
                if (d === 'overline') return 'overline';
                if (d === 'dashed_overline') return 'overline dashed';
                if (d === 'wave_overline') return 'overline wavy';
                if (d === 'overline_bold_wavy') return 'overline wavy 4px';
                if (d === 'underline_overline') return 'underline overline';
                if (d === 'double_underline_overline') return 'underline double overline';
                if (d === 'both') return 'underline line-through';
                if (d === 'cross_out') return 'line-through 4px red';
                return '';
              }).filter(Boolean).join(' '),
              outline: drawText.decoration.includes('box') ? '1px solid #fff' : 
                       drawText.decoration.includes('wavy_box') ? '1px solid #fff' :
                       drawText.decoration.includes('pill_border') ? '2px solid #fff' :
                       drawText.decoration.includes('double_box') ? 'double 4px #fff' : 
                       drawText.decoration.includes('dotted_box') ? 'dotted 2px #fff' :
                       drawText.decoration.includes('dashed_box') ? 'dashed 2px #fff' :
                       drawText.decoration.includes('stitch') ? 'dashed 1px rgba(255,255,255,0.5)' : 
                       drawText.decoration.includes('explosion') ? '2px solid #fff' : 'none',
              outlineOffset: drawText.decoration.includes('stitch') ? '-4px' : '0px',
              boxShadow: drawText.decoration.includes('neon_border') ? '0 0 5px #fff, 0 0 10px #fff, 0 0 20px #00f, 0 0 30px #00f' :
                         drawText.decoration.includes('shadow_box') ? '4px 4px 0px rgba(255,255,255,0.5)' : 
                         drawText.decoration.includes('highlight') ? `inset 0 -0.5em 0 ${drawText.backgroundColor.startsWith('#') && !drawText.backgroundColor.endsWith('00') ? drawText.backgroundColor : "rgba(255,255,0,0.4)"}` : 'none',
              background: (drawText.decoration.includes('background_box') || drawText.decoration.includes('rounded_box') || drawText.decoration.includes('tag') || drawText.decoration.includes('parallelogram') || drawText.decoration.includes('speech_bubble') || drawText.decoration.includes('comic_bubble') || drawText.decoration.includes('capsule') || drawText.decoration.includes('ribbon') || drawText.decoration.includes('leaf_box') || drawText.decoration.includes('trapezoid') || drawText.decoration.includes('double_ribbon') || drawText.decoration.includes('heart_box') || drawText.decoration.includes('cloud_bubble') || drawText.decoration.includes('banner') || drawText.decoration.includes('explosion')) ? (drawText.backgroundColor.startsWith('#') && !drawText.backgroundColor.endsWith('00') ? drawText.backgroundColor : "rgba(255,255,255,0.2)") : "transparent",
              borderRadius: drawText.decoration.includes('rounded_box') ? '12px' : 
                            drawText.decoration.includes('circle') ? '50%' : 
                            drawText.decoration.includes('tag') ? '0 8px 8px 0' : 
                            drawText.decoration.includes('speech_bubble') || drawText.decoration.includes('comic_bubble') || drawText.decoration.includes('cloud_bubble') ? '8px' : 
                            drawText.decoration.includes('capsule') || drawText.decoration.includes('pill_border') ? '50px' : "4px",
              border: drawText.decoration.includes('circle') || drawText.decoration.includes('rhombus') || drawText.decoration.includes('neon_border') || drawText.decoration.includes('comic_bubble') || drawText.decoration.includes('star_corners') || drawText.decoration.includes('diamond_ends') || drawText.decoration.includes('circle_ends') ? '1px solid #fff' : "none",
              clipPath: drawText.decoration.includes('rhombus') ? 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' : 
                        drawText.decoration.includes('tag') ? 'polygon(0% 0%, 85% 0%, 100% 50%, 85% 100%, 0% 100%)' : 
                        drawText.decoration.includes('parallelogram') ? 'polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)' :
                        drawText.decoration.includes('ribbon') ? 'polygon(10% 0%, 90% 0%, 100% 50%, 90% 100%, 10% 100%, 0% 50%)' :
                        drawText.decoration.includes('leaf_box') ? 'polygon(20% 0%, 100% 0%, 80% 100%, 0% 100%)' :
                        drawText.decoration.includes('trapezoid') ? 'polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%)' :
                        drawText.decoration.includes('heart_box') ? 'path("M 50 100 C 0 50 0 0 50 20 C 100 0 100 50 50 100 Z")' :
                        drawText.decoration.includes('banner') ? 'polygon(0% 0%, 100% 0%, 100% 100%, 50% 85%, 0% 100%)' :
                        drawText.decoration.includes('explosion') ? 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' :
                        drawText.decoration.includes('corners') ? 'polygon(0% 0%, 20% 0%, 20% 5%, 5% 5%, 5% 20%, 0% 20%, 0% 80%, 5% 80%, 5% 95%, 20% 95%, 20% 100%, 0% 100%, 100% 100%, 80% 100%, 80% 95%, 95% 95%, 95% 80%, 100% 80%, 100% 20%, 95% 20%, 95% 5%, 80% 5%, 80% 0%, 100% 0%)' : 'none',
            }}
          >
            {drawText.decoration.includes('bracket_parenthesis') ? `(${drawText.text || "文字预览位置"})` :
             drawText.decoration.includes('bracket_double') ? `[[${drawText.text || "文字预览位置"}]]` :
             drawText.decoration.includes('bracket') && !drawText.decoration.includes('bracket_square_bold') ? `[${drawText.text || "文字预览位置"}]` : 
             drawText.decoration.includes('bracket_square_bold') ? `【${drawText.text || "文字预览位置"}】` :
             drawText.decoration.includes('bracket_curly') ? `{${drawText.text || "文字预览位置"}}` :
             drawText.decoration.includes('bracket_angle') ? `<${drawText.text || "文字预览位置"}>` :
             drawText.decoration.includes('arrow_pointer') ? `${drawText.text || "文字预览位置"} ->` :
             drawText.decoration.includes('diamond_ends') ? `◆ ${drawText.text || "文字预览位置"} ◆` :
             drawText.decoration.includes('circle_ends') ? `● ${drawText.text || "文字预览位置"} ●` :
             (drawText.text || "文字预览位置")}
            {(drawText.decoration.includes('speech_bubble') || drawText.decoration.includes('comic_bubble') || drawText.decoration.includes('cloud_bubble') || drawText.decoration.includes('explosion')) && <div style={{ position: 'absolute', bottom: '-8px', left: '20px', width: '0', height: '0', borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderTop: `8px solid ${drawText.backgroundColor.startsWith('#') && !drawText.backgroundColor.endsWith('00') ? drawText.backgroundColor : "rgba(255,255,255,0.2)"}` }} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function DrawTextControls<T extends BaseGenerationParams>({
  params,
  options,
  setParams,
  defaultParams,
  multiParams,
  highresParams,
}: {
  params: T;
  options: OptionsState;
  setParams: (updater: (prev: T) => T) => void;
  defaultParams?: BaseGenerationParams;
  multiParams?: BaseGenerationParams;
  highresParams?: BaseGenerationParams;
}) {
  const drawText = params.drawText || makeBaseParams().drawText!;
  const updateDrawText = (patch: Partial<DrawTextParams>) => {
    setParams((prev) => ({ ...prev, drawText: { ...(prev.drawText || makeBaseParams().drawText!), ...patch } }));
  };

  const syncMode = drawText.syncMode || (drawText.syncWithImage ? 'default' : 'manual');
  
  let canvasWidth = drawText.width || 800;
  let canvasHeight = drawText.height || 600;

  if (syncMode === 'default') {
    canvasWidth = defaultParams?.width || params.width;
    canvasHeight = defaultParams?.height || params.height;
  } else if (syncMode === 'multi' && multiParams) {
    canvasWidth = multiParams.width;
    canvasHeight = multiParams.height;
  } else if (syncMode === 'highres' && highresParams) {
    canvasWidth = highresParams.width;
    canvasHeight = highresParams.height;
  }

  return (
    <div className="draw-text-config">
      <div className="toggle-row" style={{ marginBottom: "16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "20px", background: "rgba(255,255,255,0.03)", padding: "12px 16px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
         <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontWeight: 600 }}>
           <input type="checkbox" checked={drawText.enabled} onChange={(e) => updateDrawText({ enabled: e.target.checked })} style={{ width: "18px", height: "18px" }} /> 
           启用文字特效叠加
         </label>
         {drawText.enabled && (
           <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
             <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", color: syncMode === 'default' ? "#fff" : "#aaa" }}>
               <input type="radio" name="syncSize" checked={syncMode === 'default'} onChange={() => updateDrawText({ syncWithImage: true, syncMode: 'default' })} /> 
               同步默认尺寸 ({defaultParams?.width || params.width}x{defaultParams?.height || params.height})
             </label>
             {multiParams && (
               <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", color: syncMode === 'multi' ? "#fff" : "#aaa" }}>
                 <input type="radio" name="syncSize" checked={syncMode === 'multi'} onChange={() => updateDrawText({ syncWithImage: true, syncMode: 'multi' })} /> 
                 同步多人尺寸 ({multiParams.width}x{multiParams.height})
               </label>
             )}
             {highresParams && (
               <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", color: syncMode === 'highres' ? "#fff" : "#aaa" }}>
                 <input type="radio" name="syncSize" checked={syncMode === 'highres'} onChange={() => updateDrawText({ syncWithImage: true, syncMode: 'highres' })} /> 
                 同步高清尺寸 ({highresParams.width}x{highresParams.height})
               </label>
             )}
             <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", color: syncMode === 'manual' ? "#fff" : "#aaa" }}>
               <input type="radio" name="syncSize" checked={syncMode === 'manual'} onChange={() => updateDrawText({ syncWithImage: false, syncMode: 'manual', width: canvasWidth, height: canvasHeight })} /> 
               手动指定
             </label>
           </div>
         )}
         {drawText.enabled && syncMode === 'manual' && (
           <div style={{ display: "flex", gap: "12px", alignItems: "center", padding: "4px 12px", background: "rgba(255,255,255,0.05)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.1)" }}>
             <span style={{ fontSize: "12px", color: "#888", fontWeight: 600 }}>手动尺寸:</span>
             <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
               <input 
                 type="number" 
                 value={drawText.width} 
                 onChange={(e) => updateDrawText({ width: parseInt(e.target.value) || 0 })}
                 style={{ width: "70px", background: "#000", border: "1px solid #444", color: "#fff", padding: "2px 6px", borderRadius: "4px", fontSize: "12px" }}
               />
               <span style={{ color: "#666" }}>x</span>
               <input 
                 type="number" 
                 value={drawText.height} 
                 onChange={(e) => updateDrawText({ height: parseInt(e.target.value) || 0 })}
                 style={{ width: "70px", background: "#000", border: "1px solid #444", color: "#fff", padding: "2px 6px", borderRadius: "4px", fontSize: "12px" }}
               />
             </div>
           </div>
         )}
      </div>
      {drawText.enabled ? (
        <>
          <DrawTextCanvas 
            width={canvasWidth} 
            height={canvasHeight} 
            drawText={drawText} 
            onChange={updateDrawText} 
          />
          <div className="form-grid three">
            <label className="field" style={{ gridColumn: 'span 3' }}>
              <span>文字内容</span>
              <input value={drawText.text} onChange={(e) => updateDrawText({ text: e.target.value })} placeholder="输入要绘制的文字..." />
            </label>

            {/* Typography Group */}
            <div style={{ gridColumn: 'span 3', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '8px' }}>
              <SelectField label="字体" value={drawText.font} options={options.fonts} onChange={(value) => updateDrawText({ font: value })} />
              <NumberField label="字号" value={drawText.size} min={8} step={1} onChange={(value) => updateDrawText({ size: value })} />
              <ColorAlphaField label="文字颜色" value={drawText.color} onChange={(value) => updateDrawText({ color: value })} />
              
              <NumberField label="自动换行宽" value={drawText.maxWidth} min={0} step={1} onChange={(value) => updateDrawText({ maxWidth: value })} />
              <NumberField label="行间距" value={drawText.lineSpacing} step={1} onChange={(value) => updateDrawText({ lineSpacing: value })} />
              <NumberField label="字间距" value={drawText.letterSpacing} step={1} onChange={(value) => updateDrawText({ letterSpacing: value })} />
              
              <SelectField label="排列方向" value={drawText.layoutDirection} options={[{ label: "横向", value: "horizontal" }, { label: "纵向", value: "vertical" }]} onChange={(value) => updateDrawText({ layoutDirection: value as any })} />
              <SelectField label="水平对齐" value={drawText.horizontalAlign} options={[{ label: "居左", value: "left" }, { label: "居中", value: "center" }, { label: "居右", value: "right" }]} onChange={(value) => updateDrawText({ horizontalAlign: value })} />
              <SelectField label="垂直对齐" value={drawText.verticalAlign} options={[{ label: "居上", value: "top" }, { label: "居中", value: "center" }, { label: "居下", value: "bottom" }]} onChange={(value) => updateDrawText({ verticalAlign: value })} />
              
              <SelectField label="文字方向" value={drawText.direction} options={[{ label: "左到右", value: "ltr" }, { label: "右到左", value: "rtl" }]} onChange={(value) => updateDrawText({ direction: value })} />
              <NumberField label="文字旋转" value={drawText.rotation} step={0.1} onChange={(value) => updateDrawText({ rotation: value })} />
              <MultiSelectField 
                label="文字装饰" 
                value={drawText.decoration} 
                options={[
                  { label: "无", value: "none" },
                  { label: "下划线", value: "underline" },
                  { label: "粗下划线", value: "bold_underline" },
                  { label: "双下划线", value: "double_underline" },
                  { label: "点状下划线", value: "dotted_underline" },
                  { label: "虚线下划线", value: "dashed_underline" },
                  { label: "波浪下划线", value: "wave_underline" },
                  { label: "粗波浪下划线", value: "underline_bold_wavy" },
                  { label: "点划线下划线", value: "dot_dash_underline" },
                  { label: "双波浪下划线", value: "double_wave_underline" },
                  { label: "锯齿下划线", value: "zigzag_underline" },
                  { label: "删除线", value: "strikethrough" },
                  { label: "双删除线", value: "double_strikethrough" },
                  { label: "粗双删除线", value: "double_strikethrough_bold" },
                  { label: "上划线", value: "overline" },
                  { label: "虚线上划线", value: "dashed_overline" },
                  { label: "波浪上划线", value: "wave_overline" },
                  { label: "粗波浪上划线", value: "overline_bold_wavy" },
                  { label: "上下划线", value: "underline_overline" },
                  { label: "双上下划线", value: "double_underline_overline" },
                  { label: "下划线+删除线", value: "both" },
                  { label: "叉号划除", value: "cross_out" },
                  { label: "边框", value: "box" },
                  { label: "双线边框", value: "double_box" },
                  { label: "点状边框", value: "dotted_box" },
                  { label: "虚线边框", value: "dashed_box" },
                  { label: "波浪边框", value: "wavy_box" },
                  { label: "霓虹边框", value: "neon_border" },
                  { label: "投影边框", value: "shadow_box" },
                  { label: "直角边框", value: "corners" },
                  { label: "星角边框", value: "star_corners" },
                  { label: "缝线效果", value: "stitch" },
                  { label: "背景块", value: "background_box" },
                  { label: "圆角背景", value: "rounded_box" },
                  { label: "胶囊样式", value: "capsule" },
                  { label: "胶囊边框", value: "pill_border" },
                  { label: "荧光笔", value: "highlight" },
                  { label: "平行四边形", value: "parallelogram" },
                  { label: "梯形样式", value: "trapezoid" },
                  { label: "对话气泡", value: "speech_bubble" },
                  { label: "漫画气泡", value: "comic_bubble" },
                  { label: "云朵气泡", value: "cloud_bubble" },
                  { label: "爆炸气泡", value: "explosion" },
                  { label: "圆圈", value: "circle" },
                  { label: "菱形", value: "rhombus" },
                  { label: "标签样式", value: "tag" },
                  { label: "丝带样式", value: "ribbon" },
                  { label: "双丝带", value: "double_ribbon" },
                  { label: "条幅样式", value: "banner" },
                  { label: "树叶样式", value: "leaf_box" },
                  { label: "爱心背景", value: "heart_box" },
                  { label: "小括号 ()", value: "bracket_parenthesis" },
                  { label: "方括号 []", value: "bracket" },
                  { label: "双中括号 [[]]", value: "bracket_double" },
                  { label: "粗方括号 【】", value: "bracket_square_bold" },
                  { label: "大括号 {}", value: "bracket_curly" },
                  { label: "尖括号 <>", value: "bracket_angle" },
                  { label: "箭头指向 ->", value: "arrow_pointer" },
                  { label: "两端菱形", value: "diamond_ends" },
                  { label: "两端圆点", value: "circle_ends" }
                ]} 
                onChange={(value) => updateDrawText({ decoration: value as any })} 
              />
            </div>

            {/* Effects Group */}
            <div style={{ gridColumn: 'span 3', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginTop: '8px' }}>
              <NumberField label="描边粗细" value={drawText.strokeWidth} min={0} step={1} onChange={(value) => updateDrawText({ strokeWidth: value })} />
              <ColorAlphaField label="描边颜色" value={drawText.strokeColor} onChange={(value) => updateDrawText({ strokeColor: value })} />
              <div />

              <NumberField label="阴影距离" value={drawText.shadowDistance} min={0} step={1} onChange={(value) => updateDrawText({ shadowDistance: value })} />
              <NumberField label="阴影模糊" value={drawText.shadowBlur} min={0} step={1} onChange={(value) => updateDrawText({ shadowBlur: value })} />
              <ColorAlphaField label="阴影颜色" value={drawText.shadowColor} onChange={(value) => updateDrawText({ shadowColor: value })} />

              <NumberField label="发光模糊" value={drawText.glowBlur} min={0} step={1} onChange={(value) => updateDrawText({ glowBlur: value })} />
              <ColorAlphaField label="发光颜色" value={drawText.glowColor} onChange={(value) => updateDrawText({ glowColor: value })} />
              <ColorAlphaField label="背景颜色" value={drawText.backgroundColor} onChange={(value) => updateDrawText({ backgroundColor: value })} />
            </div>

            {/* Gradient & Positioning Group */}
            <div style={{ gridColumn: 'span 3', display: 'flex', gap: '16px', marginTop: '8px', alignItems: 'flex-start' }}>
              {/* Gradient Section */}
              <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end' }}>
                  <SelectField label="渐变模式" value={drawText.gradientDirection} options={[
                    { label: "无", value: "none" },
                    { label: "横向", value: "horizontal" },
                    { label: "纵向", value: "vertical" },
                    { label: "对角线", value: "diagonal" },
                    { label: "自定义角度", value: "angle" }
                  ]} onChange={(value) => updateDrawText({ gradientDirection: value as any })} />
                  {drawText.gradientDirection === "angle" && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingBottom: '2px' }}>
                      <span style={{ fontSize: '12px', color: '#888', fontWeight: 600 }}>渐变角度</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(0,0,0,0.3)', padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', height: '34px' }}>
                        <input 
                          type="number" 
                          value={drawText.gradientAngle || 0} 
                          onChange={(e) => updateDrawText({ gradientAngle: parseInt(e.target.value) || 0 })}
                          style={{ width: '40px', background: 'transparent', border: 'none', color: '#fff', fontSize: '13px', textAlign: 'center', outline: 'none' }}
                        />
                        <span style={{ color: '#666', fontSize: '14px' }}>°</span>
                      </div>
                    </div>
                  )}
                  <div style={{ flex: 1 }} />
                  {drawText.gradientDirection !== "none" && (
                    <button 
                      type="button" 
                      onClick={() => {
                        const colors = drawText.gradientColors || [drawText.color, drawText.color2];
                        updateDrawText({ gradientColors: [...colors, "#FFFFFF"] });
                      }}
                      style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '6px', background: '#3498db', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, height: '34px' }}
                    >
                      + 追加颜色
                    </button>
                  )}
                </div>
                
                {drawText.gradientDirection !== "none" && (
                  <div className="gradient-colors-editor" style={{ marginTop: '4px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {(drawText.gradientColors || [drawText.color, drawText.color2]).map((col, idx) => (
                        <div key={idx} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.05)', padding: '4px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                          <div style={{ width: '24px', height: '24px', borderRadius: '3px', overflow: 'hidden' }}>
                            <input 
                              type="color" 
                              value={col.substring(0, 7)} 
                              onChange={(e) => {
                                const newColors = [...(drawText.gradientColors || [drawText.color, drawText.color2])];
                                newColors[idx] = e.target.value;
                                updateDrawText({ gradientColors: newColors });
                              }}
                              style={{ width: '150%', height: '150%', margin: '-25%', border: 'none', padding: '0', cursor: 'pointer' }}
                            />
                          </div>
                          {(drawText.gradientColors || []).length > 2 && (
                            <button 
                              type="button" 
                              onClick={() => {
                                const newColors = (drawText.gradientColors || []).filter((_, i) => i !== idx);
                                updateDrawText({ gradientColors: newColors });
                              }}
                              style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', padding: '0', fontSize: '14px', lineHeight: 1 }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Positioning Section */}
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
                <NumberField label="X偏移" value={drawText.offsetX} step={1} onChange={(value) => updateDrawText({ offsetX: value })} />
                <NumberField label="Y偏移" value={drawText.offsetY} step={1} onChange={(value) => updateDrawText({ offsetY: value })} />
              </div>
            </div>
          </div>
        </>
      ) : (
        <div style={{ textAlign: "center", padding: "40px", color: "#666", background: "rgba(0,0,0,0.1)", borderRadius: "8px", border: "1px dashed #444" }}>
          文字功能已关闭。勾选上方“启用”开启高级文字特效与水印功能。
        </div>
      )}
    </div>
  );
}

type CanvasInteraction = {
  id: string;
  mode: "move" | MaskHandle;
  pointerId?: number;
  startX: number;
  startY: number;
  startMask: MultiCharacter["mask"];
  rect: { width: number; height: number };
};

function MultiWorkspace({
  canvasWidth,
  canvasHeight,
  characters,
  onChange,
}: {
  canvasWidth: number;
  canvasHeight: number;
  characters: MultiCharacter[];
  onChange: (characters: MultiCharacter[]) => void;
}) {
  const visibleCharacters = enabledCanvasCharacters(characters);
  const [selectedId, setSelectedId] = useState(visibleCharacters[0]?.id ?? "");

  useEffect(() => {
    if (selectedId && !characters.some((character) => character.id === selectedId)) {
      const visible = enabledCanvasCharacters(characters);
      setSelectedId(visible[0]?.id ?? "");
    }
  }, [characters, selectedId]);

  return (
    <>
      <MultiCanvasEditor
        canvasWidth={canvasWidth}
        canvasHeight={canvasHeight}
        characters={characters}
        onChange={onChange}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <CharacterEditor 
        characters={characters} 
        onChange={onChange} 
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
    </>
  );
}

function MultiCanvasEditor({
  canvasWidth,
  canvasHeight,
  characters,
  onChange,
  selectedId,
  onSelect,
}: {
  canvasWidth: number;
  canvasHeight: number;
  characters: MultiCharacter[];
  onChange: (characters: MultiCharacter[]) => void;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<CanvasInteraction | null>(null);
  const visibleCharacters = enabledCanvasCharacters(characters);
  const [interaction, setInteraction] = useState<CanvasInteraction | null>(null);

  useEffect(() => {
    if (!interaction) return;
    const move = (event: globalThis.MouseEvent | globalThis.PointerEvent) => {
      applyInteraction(event.clientX, event.clientY);
    };
    const end = () => {
      interactionRef.current = null;
      setInteraction(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [interaction]);

  function updateMask(id: string, mask: MultiCharacter["mask"]) {
    onChange(characters.map((character) => character.id === id ? { ...character, mask: roundCanvasMask(mask) } : character));
  }

  function startInteraction(event: PointerEvent<HTMLElement>, character: MultiCharacter, mode: CanvasInteraction["mode"]) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    canvasRef.current?.setPointerCapture(event.pointerId);
    beginInteraction(event.clientX, event.clientY, character, mode, event.pointerId, { width: rect.width, height: rect.height });
  }

  function startMouseInteraction(event: MouseEvent<HTMLElement>, character: MultiCharacter, mode: CanvasInteraction["mode"]) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || interactionRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    beginInteraction(event.clientX, event.clientY, character, mode, undefined, { width: rect.width, height: rect.height });
  }

  function beginInteraction(
    clientX: number,
    clientY: number,
    character: MultiCharacter,
    mode: CanvasInteraction["mode"],
    pointerId: number | undefined,
    rect: CanvasInteraction["rect"],
  ) {
    onSelect(character.id);
    const nextInteraction = {
      id: character.id,
      mode,
      pointerId,
      startX: clientX,
      startY: clientY,
      startMask: character.mask,
      rect,
    };
    interactionRef.current = nextInteraction;
    setInteraction(nextInteraction);
  }

  function moveInteraction(event: PointerEvent<HTMLDivElement>) {
    applyInteraction(event.clientX, event.clientY);
  }

  function endInteraction(event: PointerEvent<HTMLDivElement>) {
    if (interactionRef.current?.pointerId === event.pointerId) {
      canvasRef.current?.releasePointerCapture(event.pointerId);
      interactionRef.current = null;
      setInteraction(null);
    }
  }

  function moveMouseInteraction(event: MouseEvent<HTMLDivElement>) {
    applyInteraction(event.clientX, event.clientY);
  }

  function applyInteraction(clientX: number, clientY: number) {
    const current = interactionRef.current;
    if (!current) return;
    const deltaX = (clientX - current.startX) / current.rect.width;
    const deltaY = (clientY - current.startY) / current.rect.height;
    const nextMask = current.mode === "move"
      ? moveMaskRect(current.startMask, deltaX, deltaY)
      : resizeMaskRect(current.startMask, current.mode, deltaX, deltaY);
    updateMask(current.id, nextMask);
  }

  function endMouseInteraction() {
    interactionRef.current = null;
    setInteraction(null);
  }

  return (
    <div className="multi-canvas-panel">
      <div className="section-toolbar">
        <strong>角色画布</strong>
        <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: '#888' }}>
          <span>{canvasWidth}x{canvasHeight}</span>
          {findOverlapRegions(characters).length > 0 && (
            <span style={{ color: '#ff4757', fontWeight: 600 }}>重叠区域: {findOverlapRegions(characters).length}</span>
          )}
        </div>
      </div>
      <div
        className="multi-canvas"
        ref={canvasRef}
        onPointerMove={moveInteraction}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
        onMouseMove={moveMouseInteraction}
        onMouseUp={endMouseInteraction}
        onMouseLeave={endMouseInteraction}
      >
        {visibleCharacters.map((character) => {
          const style = {
            left: `${character.mask.x * 100}%`,
            top: `${character.mask.y * 100}%`,
            width: `${character.mask.width * 100}%`,
            height: `${character.mask.height * 100}%`,
            "--mask-color": character.color,
            "--mask-fill": hexToRgba(character.color, 0.28),
          } as CSSProperties;
          return (
            <div
              className={selectedId === character.id ? "mask-region selected" : "mask-region"}
              key={character.id}
              style={style}
              onPointerDown={(event) => startInteraction(event, character, "move")}
              onMouseDown={(event) => startMouseInteraction(event, character, "move")}
            >
              {character.feather > 0 && (
                <div 
                  className="mask-feather-preview" 
                  style={{ 
                    position: 'absolute', 
                    inset: 0, 
                    boxShadow: `inset 0 0 ${character.feather}px ${character.color}`,
                    opacity: 0.4,
                    pointerEvents: 'none',
                    borderRadius: 'inherit'
                  }} 
                />
              )}
              <span>{character.name}</span>
              {(["nw", "ne", "sw", "se"] as MaskHandle[]).map((handle) => (
                <button
                  aria-label={`${character.name} ${handle}`}
                  className={`mask-handle ${handle}`}
                  key={handle}
                  type="button"
                  onPointerDown={(event) => startInteraction(event, character, handle)}
                  onMouseDown={(event) => startMouseInteraction(event, character, handle)}
                />
              ))}
            </div>
          );
        })}
        {findOverlapRegions(characters).map((overlap, idx) => (
          <div 
            key={`overlap-${idx}`}
            className="mask-overlap-region"
            style={{
              position: 'absolute',
              left: `${overlap.rect.x * 100}%`,
              top: `${overlap.rect.y * 100}%`,
              width: `${overlap.rect.width * 100}%`,
              height: `${overlap.rect.height * 100}%`,
              backgroundColor: 'rgba(255, 71, 87, 0.15)',
              border: '1px dashed rgba(255, 71, 87, 0.4)',
              pointerEvents: 'none',
              zIndex: 10
            }}
          />
        ))}
        {visibleCharacters.length === 0 && <div className="canvas-empty">启用角色后会显示 mask 区域</div>}
        <div className="canvas-corner">{canvasWidth}x{canvasHeight}<br />缩放: 100%</div>
      </div>
    </div>
  );
}

function CharacterEditor({ characters, onChange, selectedId, onSelect }: { characters: MultiCharacter[]; onChange: (characters: MultiCharacter[]) => void; selectedId: string; onSelect: (id: string) => void }) {
  function update(index: number, patch: Partial<MultiCharacter>) {
    onChange(characters.map((character, characterIndex) => characterIndex === index ? { ...character, ...patch } : character));
  }

  function updateMask(index: number, patch: Partial<MultiCharacter["mask"]>) {
    onChange(characters.map((character, characterIndex) => characterIndex === index ? { ...character, mask: { ...character.mask, ...patch } } : character));
  }

  const selectedIndex = characters.findIndex(c => c.id === selectedId);
  const activeCharacter = characters[selectedIndex] || characters[0];
  const activeIndex = selectedIndex !== -1 ? selectedIndex : 0;

  return (
    <div className="character-panel">
      <div className="section-toolbar">
        <strong>角色控制</strong>
      </div>
      <div className="character-tabs">
        {characters.map((character, index) => (
          <button 
            key={character.id}
            type="button"
            className={`character-tab ${selectedId === character.id ? "active" : ""}`}
            onClick={() => onSelect(character.id)}
          >
            <span className="tab-color-dot" style={{ background: character.color }}></span>
            角色 {index + 1}
          </button>
        ))}
      </div>
      <div className="character-list">
        {activeCharacter && (
          <div className="character-card">
            <div className="character-head">
              <label><input type="checkbox" checked={activeCharacter.enabled} onChange={(event) => update(activeIndex, { enabled: event.target.checked })} /> 启用</label>
              <input className="character-name" value={activeCharacter.name} onChange={(event) => update(activeIndex, { name: event.target.value })} />
              <input type="color" value={activeCharacter.color} onChange={(event) => update(activeIndex, { color: event.target.value })} />
            </div>
            <TextAreaField label="角色 prompt" value={activeCharacter.prompt} onChange={(value) => update(activeIndex, { prompt: value })} />
            <div className="compact-coords" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <NumberField label="权重" value={activeCharacter.weight} step={0.1} onChange={(value) => update(activeIndex, { weight: value })} />
              <NumberField label="feather" value={activeCharacter.feather} step={1} onChange={(value) => update(activeIndex, { feather: value })} />
              <SelectField 
                label="融合模式" 
                value={activeCharacter.mask.blend_mode || "normal"} 
                options={[
                  { label: "正常", value: "normal" },
                  { label: "叠加", value: "additive" },
                  { label: "乘法", value: "multiply" }
                ]} 
                onChange={(value) => updateMask(activeIndex, { blend_mode: value })} 
              />
              <NumberField label="x" value={activeCharacter.mask.x} step={0.01} onChange={(value) => updateMask(activeIndex, { x: value })} />
              <NumberField label="y" value={activeCharacter.mask.y} step={0.01} onChange={(value) => updateMask(activeIndex, { y: value })} />
              <NumberField label="w" value={activeCharacter.mask.width} step={0.01} onChange={(value) => updateMask(activeIndex, { width: value })} />
              <NumberField label="h" value={activeCharacter.mask.height} step={0.01} onChange={(value) => updateMask(activeIndex, { height: value })} />
            </div>
            <div className="card-actions">
              <button type="button" onClick={() => onChange(autoBalanceWeights(characters))} title="根据重叠区域自动调整角色权重"><Boxes size={15} /> 平衡权重</button>
              <button type="button" onClick={() => onChange(duplicateCharacter(characters, activeIndex))}><Copy size={15} /> 复制角色</button>
              <button type="button" onClick={() => onChange(removeCharacter(characters, activeIndex))}><Trash2 size={15} /> 删除</button>
            </div>
          </div>
        )}
        {characters.length === 0 && <div className="empty-strip">暂无角色，点击“新增角色”开始</div>}
      </div>
    </div>
  );
}

function DetailerControls({
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
  const set = <K extends keyof DetailerParams>(key: K, value: DetailerParams[K]) => onChange({ ...params, [key]: value });
  return (
    <div className="sub-panel">
      <h3>{title}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px", marginBottom: "14px" }}>
        {detector !== undefined && detectors !== undefined && onDetector !== undefined && (
          <div style={{ gridColumn: "1 / -1" }}>
            <SelectField label="检测器" value={detector} options={detectors} onChange={onDetector} />
          </div>
        )}
        <NumberField label="guide" value={params.guideSize} step={8} min={64} onChange={(value) => set("guideSize", value)} />
        <NumberField label="max" value={params.maxSize} step={8} min={64} onChange={(value) => set("maxSize", value)} />
        <NumberField label="steps" value={params.steps} step={1} min={1} onChange={(value) => set("steps", value)} />
        <NumberField label="cfg" value={params.cfg} step={0.1} min={0} onChange={(value) => set("cfg", value)} />
        <NumberField label="denoise" value={params.denoise} step={0.01} min={0} max={1} onChange={(value) => set("denoise", value)} />
        <NumberField label="阈值" value={params.bboxThreshold} step={0.01} min={0} max={1} onChange={(value) => set("bboxThreshold", value)} />
        <NumberField label="扩张" value={params.bboxDilation} step={1} onChange={(value) => set("bboxDilation", value)} />
        <div style={{ gridColumn: "1 / -1" }}>
          <TextAreaField label="独立正向提示词" value={params.prompt ?? ""} placeholder="留空则继承全局正向提示词，输入空格则完全清空\n支持 Impact Pack 的 [LAB] 等分层语法" onChange={(value) => set("prompt", value)} />
        </div>
      </div>
    </div>
  );
}

type FolderTreeNode = {
  name: string;
  path: string;
  children: FolderTreeNode[];
};

const LoraCard = memo(({ 
  item, 
  words,
  previewNsfwLevel,
  previewUrl,
  previewPath,
  previewType,
  previewSource,
  settings, 
  apiBase, 
  onDetail, 
  onInsert 
}: {
  item: LoraItem;
  words: string[];
  previewNsfwLevel: number;
  previewUrl?: string;
  previewPath?: string;
  previewType?: string;
  previewSource?: string;
  settings: LoraManagerSettings;
  apiBase: string;
  onDetail: (item: LoraItem) => void;
  onInsert?: (item: LoraItem, target: TemplateKind) => void;
}) => {
  const key = item.model_name || item.file_name;
  const previewMedia = useMemo(() => ({
    url: previewUrl,
    path: previewPath,
    type: previewType,
    source: previewSource,
  } as LoraPreviewMedia), [previewUrl, previewPath, previewType, previewSource]);

  return (
    <article
      className={[
        "lora-card lm-model-card",
        shouldBlurNsfwLevel(previewNsfwLevel, settings) ? "nsfw-content" : "",
      ].filter(Boolean).join(" ")}
      data-nsfw-level={previewNsfwLevel}
      onClick={() => onDetail(item)}
      tabIndex={0}
    >
      <div className="lora-preview lm-card-preview">
        <LoraMedia
          media={previewMedia}
          apiBase={apiBase}
          alt={key}
          settings={settings}
          fallbackNsfwLevel={previewNsfwLevel}
        />
        {!previewMedia.path && !previewMedia.url && <Layers size={34} />}
        <div className="card-header lm-card-header">
          <div className="card-header-info">
            <span className="base-model-label" title={`${item.sub_type || "LoRA"} | ${item.base_model || "Unknown"}`}>
              <span className="model-sub-type">{subTypeAbbreviation(item.sub_type)}</span>
              <span className="model-separator" />
              <span className="model-base-type">{baseModelAbbreviation(item.base_model)}</span>
            </span>
            {item.update_available && <span className="model-update-badge">Update</span>}
          </div>
          <div className="card-quick-actions">
            <button type="button" title="添加到默认" onClick={(e) => { e.stopPropagation(); onInsert?.(item, "default"); }}>默认</button>
            <button type="button" title="添加到多人" onClick={(e) => { e.stopPropagation(); onInsert?.(item, "multi"); }}>多人</button>
            <button type="button" title="添加到高修" onClick={(e) => { e.stopPropagation(); onInsert?.(item, "highres"); }}>高修</button>
          </div>
        </div>
        <div className="card-footer lm-card-footer">
          <div className="lora-info model-info">
            <strong className="model-name">{key}</strong>
            <span className="version-name">{(item.civitai as LoraMetadata | undefined)?.name || item.folder || "local"}</span>
            <span>{item.folder || "root"} · {formatBytes(item.file_size)}</span>
            {words.length > 0 && <p>{words.slice(0, 2).join(" / ")}</p>}
          </div>
        </div>
      </div>
    </article>
  );
});

const FolderNodeButton = memo(({
  folder,
  selected,
  level,
  onSelect,
}: {
  folder: FolderTreeNode;
  selected: string;
  level: number;
  onSelect: (folder: string) => void;
}) => {
  return (
    <div className="lm-folder-node">
      <button
        type="button"
        className={selected === folder.path ? "selected" : ""}
        onClick={() => onSelect(folder.path)}
        style={{ paddingLeft: 12 + level * 16 }}
        title={folder.path}
      >
        <Folder size={15} />
        <span>{folder.name}</span>
      </button>
      {folder.children.map((child) => (
        <FolderNodeButton folder={child} selected={selected} level={level + 1} onSelect={onSelect} key={child.path} />
      ))}
    </div>
  );
});

const FolderSidebar = memo(({
  label,
  folders,
  selected,
  total,
  onSelect,
}: {
  label: string;
  folders: FolderTreeNode[];
  selected: string;
  total: number;
  onSelect: (folder: string) => void;
}) => {
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (sidebarRef.current) {
      const selectedEl = sidebarRef.current.querySelector(".selected") as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, []); // Only run on mount so it restores position when opening

  return (
    <aside className="lm-folder-sidebar" ref={sidebarRef}>
      <button type="button" className={selected === "" ? "lm-sidebar-root selected" : "lm-sidebar-root"} onClick={() => onSelect("")}>
        <span className="lm-sidebar-root-label"><FolderOpen size={16} /> 全部 {label}</span>
        <small>{total}</small>
      </button>
      <div className="lm-folder-tree">
        {folders.map((folder) => (
          <FolderNodeButton folder={folder} selected={selected} level={0} onSelect={onSelect} key={folder.path} />
        ))}
        {folders.length === 0 && <div className="empty-strip">暂无文件夹</div>}
      </div>
    </aside>
  );
});

const LoraManagerPanel = memo(({
  modelType,
  onModelTypeChange,
  result,
  query,
  setQuery,
  loading,
  hasMore,
  folders,
  baseModels,
  tags,
  density,
  setDensity,
  triggerWords,
  onRefresh,
  onLoadMore,
  onDetail,
  onInsert,
  exampleStatus,
  examplePending,
  pullingExampleHashes,
  localExampleFilesByHash,
  onPullAllExamples,
  apiBase,
  settings,
  isSimple,
}: {
  modelType: ManagedModelType;
  onModelTypeChange: (modelType: ManagedModelType) => void;
  result: LoraListResult;
  query: LoraQueryState;
  setQuery: (updater: (prev: LoraQueryState) => LoraQueryState) => void;
  loading: boolean;
  hasMore: boolean;
  folders: string[];
  baseModels: Array<{ name: string; count: number }>;
  tags: string[];
  density: "compact" | "medium" | "large";
  setDensity: (density: "compact" | "medium" | "large") => void;
  triggerWords: Record<string, string[]>;
  onRefresh: () => void | Promise<void>;
  onLoadMore: () => void | Promise<void>;
  onDetail: (item: LoraItem) => void;
  onInsert?: (item: LoraItem, target: TemplateKind) => void;
  exampleStatus: ExampleImagesStatus | null;
  examplePending: ExampleImagesPendingResult | null;
  pullingExampleHashes: string[];
  localExampleFilesByHash: Record<string, LoraExampleMedia[]>;
  onPullAllExamples: () => void | Promise<void>;
  apiBase: string;
  settings: LoraManagerSettings;
  isSimple?: boolean;
}) => {
  const isLora = modelType === "loras";
  const modelLabel = managedModelLabel(modelType);
  const visibleItems = result.items;
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const exampleProgress = exampleStatus?.status;
  const exampleDownloading = Boolean(exampleStatus?.is_downloading);
  const exampleSinglePulling = pullingExampleHashes.length > 0;
  const exampleBusy = exampleDownloading || exampleSinglePulling;
  const exampleStatusText = exampleDownloading
    ? `示例图拉取中 ${exampleProgress?.completed ?? 0}/${exampleProgress?.total ?? 0}`
    : exampleSinglePulling
      ? `单独拉取中 ${pullingExampleHashes.length} 个`
      : examplePending
        ? `示例图：待拉取 ${examplePending.pending_count} / 失败 ${examplePending.failed_count}`
        : "示例图状态未读取";
  const matureBlurLevel = normalizeMatureBlurLevel(settings.mature_blur_level);
  const matureBlurEnabled = settings.blur_mature_content !== false;
  const modelScrollRef = useRef<HTMLDivElement | null>(null);
  const updateQuery = useCallback((patch: Partial<LoraQueryState>) => {
    setQuery((prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }));
  }, [setQuery]);

  const handleFolderSelect = useCallback((folder: string) => {
     updateQuery({ folder });
   }, [updateQuery]);

   const handleBaseModelSelect = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    updateQuery({ baseModel: event.target.value });
  }, [updateQuery]);

  const handleTagSelect = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    updateQuery({ tag: event.target.value });
  }, [updateQuery]);

  const handleDensityChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setDensity(event.target.value as "compact" | "medium" | "large");
  }, [setDensity]);

  useEffect(() => {
    modelScrollRef.current?.scrollTo({ top: 0 });
  }, [modelType, query.search, query.folder, query.baseModel, query.tag]);

  function handleModelScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    if (!hasMore || loading) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 520) {
      void onLoadMore();
    }
  }

  return (
    <div className={isLora ? "lora-manager lm-plugin-shell" : "lora-manager lm-plugin-shell embedding-mode"}>
      <div className="lm-manager-head" style={isSimple ? { borderBottom: "none", paddingBottom: 0, marginBottom: -10 } : undefined}>
        {!isSimple && (
          <div className="lm-manager-title">
            <Boxes size={20} />
            <span>LoRA 管理器</span>
          </div>
        )}
        <div className="lm-plugin-nav lm-model-type-nav" role="navigation" aria-label="Model type">
          {[
            ["loras", "LoRA"],
            ["embeddings", "Embedding"],
          ].map(([value, label]) => (
            <button key={value} type="button" className={modelType === value ? "active" : ""} onClick={() => onModelTypeChange(value as ManagedModelType)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="lora-plugin-toolbar lm-plugin-toolbar">
        <select className="az-select" value="az" onChange={() => undefined} title="排序">
          <option value="az">A - Z</option>
        </select>
        <button type="button" className="icon-button" onClick={() => onRefresh()}><RefreshCw size={15} /> 刷新</button>
        <button type="button" className="icon-button lm-example-download-btn" disabled={exampleBusy} onClick={() => onPullAllExamples()}>
          <Download size={15} />
          {exampleBusy ? "拉取中" : "一键拉取示例图"}
        </button>
      </div>

      <div className="lm-browser">
        <FolderSidebar
          label={modelLabel}
          folders={folderTree}
          selected={query.folder}
          total={result.total}
          onSelect={handleFolderSelect}
        />
        <div className="lm-model-area">
          <div className="lora-filter-row lm-filter-row">
            <select value={query.folder} onChange={(e) => handleFolderSelect(e.target.value)}>
              <option value="">全部文件夹</option>
              {folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
            </select>
            <select value={query.baseModel} onChange={handleBaseModelSelect}>
              <option value="">全部模型类型</option>
              {baseModels.map((item) => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}
            </select>
            <select value={query.tag} onChange={handleTagSelect}>
              <option value="">全部标签</option>
              {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
            <select value={density} onChange={handleDensityChange}>
              <option value="compact">紧凑</option>
              <option value="medium">中等</option>
              <option value="large">大图</option>
            </select>
          </div>

          <div className="lora-summary lm-summary">
            <span className="lm-loaded-count">已加载 {visibleItems.length} / {result.total} {modelLabel}</span>
            <span className={matureBlurEnabled ? "lm-restriction-status active" : "lm-restriction-status"}>
              限制级：{matureBlurEnabled ? `${matureBlurLevel}+ 模糊` : "不模糊"}
            </span>
            {query.folder && <span>文件夹：{query.folder}</span>}
            <span className={exampleBusy ? "lm-example-status running" : "lm-example-status"} title={exampleProgress?.current_model || undefined}>
              {exampleBusy ? <RefreshCw size={13} /> : <ImageIcon size={13} />}
              {exampleStatusText}
            </span>
          </div>
          <ExampleImagesProgressBar status={exampleStatus} pullingCount={pullingExampleHashes.length} />

          <div className="lm-model-scroll" ref={modelScrollRef} onScroll={handleModelScroll}>
            <div className={`lora-grid lm-card-grid density-${density}`}>
              {visibleItems.map((item) => {
                const key = item.model_name || item.file_name;
                const hash = item.sha256?.toLowerCase();
                const localFiles = hash ? localExampleFilesByHash[hash] ?? EMPTY_ARRAY : EMPTY_ARRAY;
                const words = triggerWords[key] ?? extractItemTrainedWords(item);
                const previewNsfwLevel = getItemNsfwLevel(item);
                const previewMedia = pickCardPreviewMedia(item, localFiles);

                return (
                  <LoraCard
                    key={item.file_path}
                    item={item}
                    words={words}
                    previewNsfwLevel={previewNsfwLevel}
                    previewUrl={previewMedia.url}
                    previewPath={previewMedia.path}
                    previewType={previewMedia.type}
                    previewSource={previewMedia.source}
                    settings={settings}
                    apiBase={apiBase}
                    onDetail={onDetail}
                    onInsert={onInsert}
                  />
                );
              })}
              {visibleItems.length === 0 && <div className="empty-strip">没有匹配的 {modelLabel}，试试清空搜索或切换筛选</div>}
            </div>
            <div className="lm-load-status">
              {loading ? "正在加载..." : hasMore ? "滚动到底部继续加载" : `已加载全部 ${visibleItems.length} 个 ${modelLabel}`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

function LoraChips({ 
  loras, 
  onChange, 
  onDetail,
  apiBase,
  settings,
  localExampleFilesByHash = {}
}: { 
  loras: LoraSelection[]; 
  onChange: (loras: LoraSelection[]) => void; 
  onDetail?: (lora: LoraSelection) => void;
  apiBase: string;
  settings: LoraManagerSettings;
  localExampleFilesByHash?: Record<string, LoraExampleMedia[]>;
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [draggableIndex, setDraggableIndex] = useState<number | null>(null);
  const [isDraggingActive, setIsDraggingActive] = useState(false);
  const scrollIntervalRef = useRef<number | null>(null);
  const scrollParentRef = useRef<HTMLElement | null>(null);
  const scrollVelocityRef = useRef<number>(0);

  useEffect(() => {
    const handleGlobalDragEnd = () => {
      setDraggedIndex(null);
      setDraggableIndex(null);
      setIsDraggingActive(false);
      scrollParentRef.current = null;
      scrollVelocityRef.current = 0;
      if (scrollIntervalRef.current) {
        window.clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
    };

    window.addEventListener('dragend', handleGlobalDragEnd);
    return () => {
      window.removeEventListener('dragend', handleGlobalDragEnd);
      if (scrollIntervalRef.current) {
        window.clearInterval(scrollIntervalRef.current);
      }
    };
  }, []);

  // 统一的滚动定时器与位置监听管理
  useEffect(() => {
    const handleWindowDragOver = (e: DragEvent) => {
      if (!isDraggingActive || !scrollParentRef.current) return;
      
      const threshold = 80;  // 触发滚动的边缘距离
      const maxSpeed = 20;   // 最大滚动速度
      const { clientY } = e;
      
      const scrollParent = scrollParentRef.current;
      const rect = scrollParent.getBoundingClientRect();
      const relativeY = clientY - rect.top;

      // 严格的边界检查与强度裁剪
      if (relativeY >= 0 && relativeY < threshold) {
        // 靠近容器顶部，向上滚动
        const intensity = Math.max(0, Math.min(1, (threshold - relativeY) / threshold));
        scrollVelocityRef.current = -maxSpeed * Math.pow(intensity, 2);
      } else if (relativeY > rect.height - threshold && relativeY <= rect.height) {
        // 靠近容器底部，向下滚动
        const intensity = Math.max(0, Math.min(1, (relativeY - (rect.height - threshold)) / threshold));
        scrollVelocityRef.current = maxSpeed * Math.pow(intensity, 2);
      } else {
        // 超出边缘或在中间区域，立即停止
        scrollVelocityRef.current = 0;
      }
    };

    if (isDraggingActive) {
      window.addEventListener('dragover', handleWindowDragOver);
      scrollIntervalRef.current = window.setInterval(() => {
        if (scrollParentRef.current && scrollVelocityRef.current !== 0) {
          scrollParentRef.current.scrollBy(0, scrollVelocityRef.current);
        }
      }, 16);
    } else {
      window.removeEventListener('dragover', handleWindowDragOver);
      if (scrollIntervalRef.current) {
        window.clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
      scrollVelocityRef.current = 0;
    }

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      if (scrollIntervalRef.current) {
        window.clearInterval(scrollIntervalRef.current);
      }
    };
  }, [isDraggingActive]);

  if (!loras.length) {
    return (
      <div className="empty-strip">
        未选择 LoRA
      </div>
    );
  }

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    
    // 查找并缓存最近的可滚动祖先容器
    const getScrollParent = (node: HTMLElement | null): HTMLElement | null => {
      if (!node) return null;
      if (node.scrollHeight > node.clientHeight && 
          (window.getComputedStyle(node).overflowY === 'auto' || window.getComputedStyle(node).overflowY === 'scroll')) {
        return node;
      }
      return getScrollParent(node.parentElement);
    };
    scrollParentRef.current = getScrollParent(e.currentTarget as HTMLElement) || document.documentElement;

    // 延迟设置活跃状态，确保拖拽的 ghost image 是完全不透明的
    setTimeout(() => {
      setIsDraggingActive(true);
    }, 0);
  };

  const handleDragEnter = (e: React.DragEvent, index: number) => {
    if (draggedIndex === null || draggedIndex === index) return;
    
    const newLoras = [...loras];
    const draggedItem = newLoras[draggedIndex];
    newLoras.splice(draggedIndex, 1);
    newLoras.splice(index, 0, draggedItem);
    
    setDraggedIndex(index);
    onChange(newLoras);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDraggableIndex(null);
    setIsDraggingActive(false);
    scrollParentRef.current = null;
    scrollVelocityRef.current = 0;
    if (scrollIntervalRef.current) {
      window.clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  };

  return (
    <div className="lora-selection-grid">
      {loras.map((lora, index) => {
        const hash = lora.sha256?.toLowerCase();
        const fallbackPreview = hash ? (localExampleFilesByHash[hash]?.[0]?.path || localExampleFilesByHash[hash]?.[0]?.url) : undefined;
        const previewUrl = lora.previewUrl || fallbackPreview;
        // 使用更稳定的 key，避免重新排序时 Key 变化导致 DragEnd 丢失
        const cardKey = lora.sha256 ? `lora-${lora.sha256}` : `lora-${lora.name}-${index}`;

        return (
          <div 
            className={`lora-selection-card ${lora.active ? "" : "disabled"} ${draggedIndex === index ? "dragging" : ""} ${draggedIndex === index && isDraggingActive ? "dragging-active" : ""}`} 
            key={cardKey}
            draggable={draggableIndex === index}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnter={(e) => handleDragEnter(e, index)}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDrop={(e) => e.preventDefault()}
          >
            <div className="lora-card-preview" onClick={() => onDetail?.(lora)}>
              {previewUrl ? (
                <LoraMedia
                  media={{
                    url: previewUrl,
                    type: isVideoPath(previewUrl || "") ? "video" : "image",
                    source: "preview",
                  }}
                  apiBase={apiBase}
                  alt={lora.displayName || lora.name}
                  settings={settings}
                />
              ) : (
                <div className="lora-card-placeholder">
                  <Boxes size={24} opacity={0.2} />
                </div>
              )}
              <div 
                className="lora-card-handle"
                onMouseEnter={() => setDraggableIndex(index)}
                onMouseLeave={() => draggedIndex === null && setDraggableIndex(null)}
              >
                <GripVertical size={12} />
              </div>
            </div>
            
            <div className="lora-card-info">
              <div className="lora-card-header-row">
                <div className="lora-card-name" title={lora.displayName || lora.name}>
                  {lora.displayName || lora.name}
                </div>
                <div className="lora-card-actions" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
                  <label className="lora-card-toggle" onClick={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
                    <input 
                      type="checkbox" 
                      checked={lora.active} 
                      onDragStart={(e) => e.stopPropagation()}
                      onChange={(event) => onChange(loras.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))} 
                    />
                    <span className="checkbox-custom"></span>
                  </label>
                  <button 
                    className="lora-card-remove" 
                    type="button" 
                    title="移除"
                    onDragStart={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(loras.filter((_, itemIndex) => itemIndex !== index));
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className="lora-card-controls" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
                <div 
                  className="lora-slider-wrapper"
                  style={{ "--slider-thumb-pos": `${((lora.strength + 2) / 4) * 100}%` } as React.CSSProperties}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                >
                  <input 
                    className="lora-slider" 
                    type="range" 
                    value={lora.strength} 
                    min={-2} 
                    max={2} 
                    step={0.05} 
                    onDragStart={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onChange={(event) => onChange(loras.map((item, itemIndex) => itemIndex === index ? { ...item, strength: Number(event.target.value), clipStrength: Number(event.target.value) } : item))} 
                  />
                  <div 
                    className="lora-slider-track-fill" 
                    style={{ 
                      width: `${((lora.strength + 2) / 4) * 100}%`,
                      background: lora.strength >= 0 ? 'var(--accent)' : '#ef4444'
                    }}
                  ></div>
                </div>
                <input 
                  className="lora-number" 
                  type="number" 
                  value={lora.strength} 
                  min={-10} 
                  max={10} 
                  step={0.05} 
                  onDragStart={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onChange={(event) => onChange(loras.map((item, itemIndex) => itemIndex === index ? { ...item, strength: Number(event.target.value), clipStrength: Number(event.target.value) } : item))} 
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PanelTitle({ icon: Icon, title }: { icon: typeof Wand2; title: string }) {
  return (
    <div className="panel-title">
      <Icon size={20} />
      <h2>{title}</h2>
    </div>
  );
}

function NumberField({ label, value, min, max, step, disabled, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function TextField({ label, value, placeholder, disabled, onChange }: { label: string; value: string; placeholder?: string; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" value={value} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}


function SelectField({ label, value, options, onChange }: { 
  label: string; 
  value: string; 
  options: (string | { label: string; value: string })[]; 
  onChange: (value: string) => void 
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const val = typeof option === 'string' ? option : option.value;
          const lab = typeof option === 'string' ? option : option.label;
          return <option key={val} value={val}>{lab}</option>;
        })}
      </select>
    </label>
  );
}

function MultiSelectField({ label, value, options, onChange }: { 
  label: string; 
  value: string; 
  options: { label: string; value: string }[]; 
  onChange: (value: string) => void 
}) {
  const selectedValues = value.split(',').filter(v => v && v !== 'none');
  
  const toggleValue = (val: string) => {
    if (val === 'none') {
      onChange('none');
      return;
    }
    
    let newValues: string[];
    if (selectedValues.includes(val)) {
      newValues = selectedValues.filter(v => v !== val);
    } else {
      newValues = [...selectedValues, val];
    }
    
    if (newValues.length === 0) {
      onChange('none');
    } else {
      onChange(newValues.join(','));
    }
  };

  return (
    <div className="field" style={{ gridColumn: 'span 3', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
      <span style={{ fontWeight: 'bold', fontSize: '13px', color: 'rgba(255,255,255,0.7)' }}>{label} (可多选组合)</span>
      <div style={{ 
        display: 'flex', 
        flexWrap: 'wrap', 
        gap: '6px', 
        background: 'rgba(0,0,0,0.2)', 
        padding: '10px', 
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.1)',
        maxHeight: '200px',
        overflowY: 'auto'
      }}>
        {options.map((option) => {
          const isSelected = option.value === 'none' ? selectedValues.length === 0 : selectedValues.includes(option.value);
          return (
            <div 
              key={option.value}
              onClick={() => toggleValue(option.value)}
              style={{
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer',
                background: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)',
                color: isSelected ? '#60a5fa' : 'rgba(255,255,255,0.6)',
                border: '1px solid',
                borderColor: isSelected ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                transition: 'all 0.2s',
                userSelect: 'none'
              }}
            >
              {option.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
function CopyableTextarea({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
      <textarea className={className} style={{ flex: 1, width: "100%", resize: "none" }} value={value} readOnly />
      {value && (
        <button 
          type="button"
          onClick={handleCopy} 
          title="复制"
          style={{ 
            position: "absolute", top: "8px", right: "16px", 
            background: "rgba(42, 42, 42, 0.9)", border: "1px solid var(--border-color, #444)", 
            color: "var(--text-secondary, #aaa)", borderRadius: "4px", padding: "4px 8px", 
            cursor: "pointer", display: "flex", alignItems: "center", gap: "4px", fontSize: "12px",
            backdropFilter: "blur(4px)"
          }}>
          {copied ? <CheckCircle2 size={14} color="#4caf50" /> : <Copy size={14} />}
          {copied ? "已复制" : "复制"}
        </button>
      )}
    </div>
  );
}


function TextAreaField({ label, value, placeholder, onChange, hideChips }: { label: string; value: string; placeholder?: string; onChange: (value: string) => void; hideChips?: boolean }) {
  const isPrompt = label.toLowerCase().includes("prompt") || label.includes("提示词");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [translationSettings] = useLocalStorageState<TranslationSettings>("comfyui_translation_settings", defaultTranslationSettings);
  const [isTranslating, setIsTranslating] = useState(false);



  const handleTranslate = async () => {
    if (!value.trim() || isTranslating) return;
    setIsTranslating(true);
    try {
      const translated = await translateText(value, translationSettings);
      onChange(translated);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div className="field text-field">
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {label}
        {isPrompt && (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.preventDefault(); handleTranslate(); }} style={{ padding: '0 8px', height: '22px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--accent)', background: 'var(--accent-soft)', cursor: isTranslating ? 'wait' : 'pointer', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '4px', marginRight: '8px' }}>
              <Globe2 size={12} />
              {isTranslating ? "翻译中..." : "翻译为英文"}
            </button>
          </div>
        )}
      </span>
      <textarea 
        ref={textareaRef}
        value={value} 
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)} 
        onKeyDown={(e) => isPrompt && handlePromptWeightAdjustment(e, value, onChange)}
      />
      {isPrompt && value.trim() && !hideChips && (
        <PromptTagBlocks value={value} onChange={onChange} />
      )}
    </div>
  );
}


function ImageComparerModal({ imageA, imageB, onClose }: { imageA: string; imageB: string; onClose: () => void }) {
  const [sliderPos, setSliderPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const updateSlider = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setSliderPos(pos);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="对比图像"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        backgroundColor: 'rgba(0,0,0,0.9)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: '12px',
      }}
    >
      {/* Header bar */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: 'min(92vw, 1200px)', color: '#e7edf7', flexShrink: 0 }}
      >
        <span style={{ fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: '#93a4ba' }}>
          <Columns size={15} /> 拖动中间滑块对比
        </span>
        <button
          type="button"
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ background: 'none', border: 'none', color: '#93a4ba', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Comparison area */}
      <div
        ref={containerRef}
        onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); updateSlider(e.clientX); }}
        onPointerMove={(e) => { if (e.buttons === 1) updateSlider(e.clientX); }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
        style={{
          position: 'relative',
          maxWidth: 'min(92vw, 1200px)',
          maxHeight: 'calc(92vh - 50px)',
          cursor: 'col-resize',
          userSelect: 'none',
          lineHeight: 0,
          borderRadius: '8px',
          overflow: 'hidden',
          flexShrink: 1,
        }}
      >
        {/* Base image (A) — sets the natural dimensions */}
        <img
          src={imageA}
          alt="基础图像"
          style={{ display: 'block', maxWidth: '100%', maxHeight: 'calc(92vh - 50px)', objectFit: 'contain', pointerEvents: 'none' }}
          draggable={false}
        />

        {/* Repaired image (B) — overlaid, clipped by slider */}
        <img
          src={imageB}
          alt="修复结果"
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'contain',
            clipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
            pointerEvents: 'none',
          }}
          draggable={false}
        />

        {/* Slider divider line */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${sliderPos}%`,
          width: '2px',
          backgroundColor: '#fff',
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
          boxShadow: '0 0 6px rgba(0,0,0,0.8)',
        }}>
          {/* Handle circle */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '38px', height: '38px',
            borderRadius: '50%',
            backgroundColor: '#fff',
            border: '2px solid rgba(0,0,0,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#273142',
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
          }}>
            <Columns size={16} />
          </div>
        </div>

        {/* Labels */}
        <div style={{ position: 'absolute', top: '10px', left: '10px', padding: '4px 10px', backgroundColor: 'rgba(0,0,0,0.65)', color: '#fff', borderRadius: '4px', fontSize: '12px', pointerEvents: 'none' }}>基础图像</div>
        <div style={{ position: 'absolute', top: '10px', right: '10px', padding: '4px 10px', backgroundColor: 'rgba(59,130,246,0.75)', color: '#fff', borderRadius: '4px', fontSize: '12px', pointerEvents: 'none' }}>修复结果</div>
      </div>
    </div>
  );
}

function DraggableFloatingPreview({ images, onClose }: { images: OutputImage[]; onClose: () => void }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const draggingRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = { startX: e.clientX, startY: e.clientY, initX: pos.x, initY: pos.y };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - draggingRef.current.startX;
    const dy = e.clientY - draggingRef.current.startY;
    setPos({ x: draggingRef.current.initX + dx, y: draggingRef.current.initY + dy });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    draggingRef.current = null;
  };

  return (
    <div style={{
      position: "fixed",
      bottom: "20px",
      right: "20px",
      width: "400px",
      minWidth: "250px",
      minHeight: "200px",
      backgroundColor: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
      zIndex: 9999,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      resize: "both",
      transform: `translate(${pos.x}px, ${pos.y}px)`,
    }}>
      <div 
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ 
        padding: "10px 12px", 
        borderBottom: "1px solid var(--border)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        backgroundColor: "var(--surface-alt)",
        cursor: "move",
        userSelect: "none"
      }}>
        <h4 style={{ margin: 0, fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
          <Eye size={16} /> 进度预览
        </h4>
        <button 
          type="button" 
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-secondary)",
            cursor: "pointer",
            padding: "4px"
          }}
        >
          <X size={16} />
        </button>
      </div>
      <div style={{ padding: "12px", flex: 1, overflowY: "auto", cursor: "auto" }} onPointerDown={(e) => e.stopPropagation()}>
        {images.map((img, i) => (
          <div key={i} style={{ marginBottom: i < images.length - 1 ? "16px" : 0 }}>
            <div style={{ 
              fontSize: "12px", 
              color: "var(--text-secondary)", 
              marginBottom: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}>
              <span style={{ 
                backgroundColor: "var(--accent-blue-transparent)", 
                color: "var(--accent-blue)",
                padding: "2px 6px",
                borderRadius: "4px"
              }}>
                {img.nodeTitle || "未知阶段"}
              </span>
            </div>
            <img src={img.url} alt={img.nodeTitle} style={{ width: "100%", borderRadius: "4px", display: "block" }} draggable={false} />
          </div>
        ))}
      </div>
    </div>
  );
}



export default App;
