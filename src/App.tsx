import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { useLocalStorageState } from "./hooks/useLocalStorageState";
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent, ReactNode, UIEvent } from "react";
import {
  BadgePlus,
  Boxes,
  Brain,
  ChevronLeft,
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
} from "lucide-react";
import { cloneMultiCharacterConfig } from "./data/multiTemplate";
import { handlePromptWeightAdjustment } from "./lib/promptUtils";
import { ComfyClient } from "./lib/comfyClient";
import { enabledCanvasCharacters, moveMaskRect, resizeMaskRect } from "./lib/multiCanvas";
import { ImageGalleryItem } from "./components/ImageGalleryItem";
import { PromptEditorDialog } from "./components/PromptEditorDialog";
import { PromptTagBlocks } from "./components/PromptTagBlocks";
import { RichTextEditor } from "./components/RichTextEditor";
import { WelcomeModal } from "./components/WelcomeModal";
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
  LoraQueryState,
  LoraSelection,
  LoraUpdateRecord,
  ManagedModelType,
  MultiCharacter,
  MultiGenerationParams,
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
} from "./types";

type TabId = "default" | "wd14" | "multi" | "highres" | "xyz" | "loras" | "notes";

type OptionsState = {
  checkpoints: string[];
  samplers: string[];
  schedulers: string[];
  wdModels: string[];
  wdDevices: string[];
  clModels: string[];
  detectors: string[];
  upscaleMethods: string[];
};

type XyzRunItem = {
  id: string;
  label: string;
  patch: Partial<BaseGenerationParams>;
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  result?: JobResult;
  error?: string;
};

type LoraOperation =
  | { type: "rename"; item: LoraItem }
  | { type: "move"; items: LoraItem[] }
  | { type: "delete"; items: LoraItem[] }
  | { type: "download"; item?: LoraItem }
  | { type: "duplicates" }
  | { type: "updates" }
  | { type: "doctor" }
  | { type: "settings" }
  | { type: "notifications" }
  | { type: "civitai"; item: LoraItem };

const fallbackOptions: OptionsState = {
  checkpoints: ["anything-v5-PrtRE.safetensors"],
  samplers: ["euler_ancestral", "euler", "dpmpp_2m"],
  schedulers: ["simple", "karras", "normal"],
  wdModels: ["wd-v1-4-moat-tagger-v2"],
  wdDevices: ["GPU", "CPU"],
  clModels: ["cl_tagger/cl_tagger_1_02.onnx"],
  detectors: ["bbox/hand_yolov8s.pt", "bbox/face_yolov8m.pt"],
  upscaleMethods: ["nearest-exact", "bilinear", "bicubic"],
};

const tabs: Array<{ id: TabId; label: string; icon: typeof Wand2 }> = [
  { id: "default", label: "默认生图", icon: Wand2 },
  { id: "wd14", label: "WD1.4", icon: ScanSearch },
  { id: "multi", label: "多人工作流", icon: UserRound },
  { id: "highres", label: "高清修复", icon: ImageUp },
  { id: "xyz", label: "XYZ 控制器", icon: SlidersHorizontal },
  { id: "loras", label: "LoRA 管理", icon: Boxes },
  { id: "notes", label: "记事本", icon: FileText },
];



const templateLabels: Record<TemplateKind, string> = {
  default: "默认生图",
  multi: "多人工作流",
  highres: "高清修复",
};

const defaultLoraQuery: LoraQueryState = {
  search: "",
  folder: "",
  baseModel: "",
  tag: "",
  page: 1,
  pageSize: 48,
};

const emptyLoraResult: LoraListResult = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 48,
  totalPages: 1,
};

function managedModelLabel(modelType: ManagedModelType) {
  return modelType === "embeddings" ? "Embedding" : "LoRA";
}

function managedModelExampleType(modelType: ManagedModelType) {
  return modelType === "embeddings" ? "embedding" : "lora";
}

const NSFW_LEVELS = {
  UNKNOWN: 0,
  PG: 1,
  PG13: 2,
  R: 4,
  X: 8,
  XXX: 16,
  BLOCKED: 32,
} as const;

type MatureBlurLevel = "PG13" | "R" | "X" | "XXX";

const validMatureBlurLevels: MatureBlurLevel[] = ["PG13", "R", "X", "XXX"];

const defaultLoraManagerSettings: LoraManagerSettings = {
  blur_mature_content: true,
  mature_blur_level: "R",
};

function makeBaseParams(checkpoint = fallbackOptions.checkpoints[0]): BaseGenerationParams {
  return {
    checkpoint,
    positivePrompt: "",
    negativePrompt: "",
    width: 832,
    height: 1216,
    batchSize: 1,
    seed: 42,
    randomizeSeed: true,
    steps: 20,
    cfg: 7,
    samplerName: "euler_ancestral",
    scheduler: "simple",
    denoise: 1,
    filenamePrefix: "默认生图/%date:yyyy-MM-dd%/ComfyUI",
    loras: [],
  };
}

function makeMultiParams(checkpoint = fallbackOptions.checkpoints[0]): MultiGenerationParams {
  const template = cloneMultiCharacterConfig();
  return {
    ...makeBaseParams(checkpoint),
    width: 1024,
    height: 1536,
    steps: 25,
    cfg: 5,
    scheduler: "karras",
    filenamePrefix: "多人/%date:yyyy-MM-dd%/ComfyUI",
    globalPrompt: "",
    syntaxMode: "attention_couple",
    useFill: false,
    canvasWidth: 1024,
    canvasHeight: 1024,
    characters: template.characters,
  };
}

function makeDetailerParams(denoise: number): DetailerParams {
  return {
    guideSize: 1024,
    maxSize: 1400,
    steps: 20,
    cfg: 7,
    denoise,
    feather: 5,
    bboxThreshold: 0.5,
    bboxDilation: 10,
    bboxCropFactor: 3,
    samplerName: "euler_ancestral",
    scheduler: "simple",
  };
}

function makeHighresParams(checkpoint = fallbackOptions.checkpoints[0]): HighresParams {
  return {
    ...makeBaseParams(checkpoint),
    filenamePrefix: "高清修复/%date:yyyy-MM-dd%/ComfyUI",
    enableUpscale: true,
    enableSegsDetailer: false,
    enableHandDetailer: false,
    enableFaceDetailer: false,
    enableEyesDetailer: false,
    enableNsfwDetailer: false,
    upscaleMethod: "nearest-exact",
    scaleBy: 1.5,
    highresSeed: 43,
    syncHighresSeed: true,
    randomizeHighresSeed: true,
    highresSteps: 20,
    highresCfg: 8,
    highresDenoise: 0.58,
    handDetector: "bbox/hand_yolov8s.pt",
    faceDetector: "bbox/face_yolov8m.pt",
    eyesDetector: "bbox/Eyeful_v2-Individual.pt",
    nsfwDetector: "segm/ntd11_anime_nsfw_segm_v5-variant1.pt",
    handDetailer: makeDetailerParams(0.38),
    faceDetailer: makeDetailerParams(0.25),
    eyesDetailer: makeDetailerParams(0.24),
    nsfwDetailer: makeDetailerParams(0.3),
    segsDetailer: { ...makeDetailerParams(0.24), steps: 18, cfg: 6, guideSize: 512, maxSize: 1024 },
  };
}

function App() {
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

  const [tab, setTab] = useLocalStorageState<TabId>("comfyui_active_tab", "default");
  const [apiBase, setApiBase] = useState("/comfy");
  const client = useMemo(() => new ComfyClient(apiBase), [apiBase]);
  const [options, setOptions] = useState<OptionsState>(fallbackOptions);
  const [connection, setConnection] = useState("检查中");
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
    imageFolder: "F:\\AI_lora\\lora-data-img\\tag-cs",
    outputFolder: "./ComfyUI-tag/cs",
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
    imageFolder: "F:\\AI_lora\\lora-data-img\\tag-cs",
    outputFolder: "./ComfyUI-tag/cs",
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
  const [loraQuery, setLoraQuery] = useState<LoraQueryState>(defaultLoraQuery);
  const [loraLoading, setLoraLoading] = useState(false);
  const [loraFolders, setLoraFolders] = useState<string[]>([]);
  const [loraBaseModels, setLoraBaseModels] = useState<Array<{ name: string; count: number }>>([]);
  const [loraTags, setLoraTags] = useState<string[]>([]);
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

  async function saveNotes(currentNotes: NoteItem[]) {
    setNotesSaving(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: currentNotes }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      pushToast("success", "笔记已保存");
    } catch (err) {
      pushToast("error", "保存笔记失败", String(err));
    } finally {
      setNotesSaving(false);
    }
  }

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

  const [progress, setProgress] = useState<ProgressState>({
    running: false,
    value: 0,
    max: 1,
    label: "空闲",
  });
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
  const [xyzResults, setXyzResults] = useState<XyzRunItem[]>([]);
  const examplePollRef = useRef<number | null>(null);
  const loraLoadingRef = useRef(false);
  const xyzCancelRef = useRef(false);
  const selectedLoraItems = useMemo(
    () => loraResult.items.filter((item) => selectedLoraPaths.includes(item.file_path)),
    [loraResult.items, selectedLoraPaths],
  );

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
        const [stats, checkpointInfo, ksamplerInfo, wdInfo, clInfo, detectorInfo, upscaleInfo, managerSettings] = await Promise.all([
          client.getSystemStats(),
          client.getObjectInfo("CheckpointLoaderSimple"),
          client.getObjectInfo("KSampler"),
          client.getObjectInfo("WD14Tagger|pysssss").catch(() => null),
          client.getObjectInfo("cl_tagger_mira").catch(() => null),
          client.getObjectInfo("UltralyticsDetectorProvider").catch(() => null),
          client.getObjectInfo("LatentUpscaleBy").catch(() => null),
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
        };
        setOptions(nextOptions);
        const managerSettingsResult = managerSettings as LoraManagerSettings & { settings?: LoraManagerSettings };
        setLoraSettings(normalizeLoraManagerSettings(managerSettingsResult.settings ?? managerSettingsResult));
        const system = stats as { system?: { comfyui_version?: string }; devices?: Array<{ name: string }> };
        setConnection(`在线 ${system.system?.comfyui_version ?? ""}`);
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
        setConnection("离线");
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

  useEffect(() => {
    if (tab !== "loras") return;
    let canceled = false;
    const hashes = uniqueStrings(loraResult.items.map((item) => item.sha256?.toLowerCase()).filter(Boolean));
    const missingHashes = hashes.filter((hash) => !(hash in loraExampleFilesByHash));
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
  }, [client, tab, loraResult.items, loraExampleFilesByHash]);

  useEffect(() => {
    return () => {
      stopExampleStatusPolling();
    };
  }, []);

  async function refreshLoras(query = loraQuery) {
    await loadManagedModelsPage(managedModelType, query, 1, { append: false, reloadFacets: true });
  }

  async function loadMoreManagedModels() {
    if (loraLoadingRef.current || loraResult.page >= loraResult.totalPages) return;
    await loadManagedModelsPage(managedModelType, loraQuery, loraResult.page + 1, { append: true, reloadFacets: false });
  }

  async function loadManagedModelsPage(
    modelType: ManagedModelType,
    query: LoraQueryState,
    pageNumber: number,
    options: { append: boolean; reloadFacets: boolean },
  ) {
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
        : Promise.resolve<[string[], Array<{ name: string; count: number }>, string[]]>([loraFolders, loraBaseModels, loraTags]);
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
  }

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

  async function pullAllLoraExamples() {
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
  }

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

  async function runPrompt(label: string, promptFactory: () => ReturnType<typeof buildDefaultPrompt>) {
    setError("");
    try {
      setProgress({ running: true, value: 0, max: 1, label: `${label} 准备中` });
      pushToast("info", `${label} 已提交`, "正在等待 ComfyUI 执行");
      const result = await client.runPrompt(promptFactory(), (prog) => {
        setProgress(prog);
      });
      setResults((prev) => [result, ...prev].slice(0, 24));
      pushToast("success", `${label} 完成`, result.images.length ? `输出 ${result.images.length} 张图片` : undefined);
      return result;
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setError(message);
      setProgress({ running: false, value: 0, max: 1, label: "失败" });
      pushToast("error", `${label} 失败`, message);
      throw runError;
    }
  }

  async function runBatchTagger(type: "cl" | "wd") {
    setError("");
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
    xyzCancelRef.current = false;
    if (reset) {
      setXyzResults(items);
    }
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (xyzCancelRef.current) {
        setXyzResults((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: "cancelled" } : entry));
        continue;
      }
      setProgress({
        running: true,
        value: index,
        max: items.length,
        label: `XYZ ${index + 1}/${items.length}`,
      });
      setXyzResults((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: "running", error: undefined } : entry));
      try {
        const result = await runPrompt(item.label, () => buildXyzPrompt(item));
        setXyzResults((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: "success", result } : entry));
      } catch (runError) {
        const message = runError instanceof Error ? runError.message : String(runError);
        setXyzResults((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: "failed", error: message } : entry));
        pushToast("error", `XYZ 组合失败：${item.label}`, message);
      }
    }
    setProgress({ running: false, value: 1, max: 1, label: "XYZ 完成" });
    pushToast("success", "XYZ 执行结束", `已处理 ${items.length} 个组合`);
  }

  async function runXyz() {
    const combos = buildXyzCombinations(xyzAxes, getXyzLoras());
    if (!combos.length) {
      pushToast("error", "XYZ 无法运行", "至少需要启用一个轴并填写取值");
      return;
    }
    const items = combos.map((combo) => ({
      id: crypto.randomUUID(),
      label: combo.label,
      patch: combo.patch,
      status: "queued" as const,
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
    const successfulItems = xyzResults.filter((item) => item.status === "success" && item.result?.images[0]);
    if (successfulItems.length === 0) {
      pushToast("info", "没有可导出的结果", "网格中没有成功的生成图像");
      return;
    }
    pushToast("info", "正在生成网格", "请稍候...");

    const activeAxes = xyzAxes.filter((axis) => axis.enabled && axis.values.trim());
    let cols = 1;
    if (activeAxes.length > 0) {
      const lastAxisValues = parseAxisValues(activeAxes[activeAxes.length - 1].values, activeAxes[activeAxes.length - 1].field);
      cols = lastAxisValues.length > 0 ? lastAxisValues.length : 1;
    }
    const rows = Math.ceil(successfulItems.length / cols);

    try {
      const loadedImages = await Promise.all(
        successfulItems.map((item) => {
          return new Promise<{ img: HTMLImageElement; label: string }>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve({ img, label: item.label });
            img.onerror = () => reject(new Error(`加载图像失败: ${item.label}`));
            img.src = item.result!.images[0].url;
          });
        }),
      );

      const maxWidth = Math.max(...loadedImages.map((l) => l.img.width));
      const maxHeight = Math.max(...loadedImages.map((l) => l.img.height));
      const labelHeight = 40;

      const canvas = document.createElement("canvas");
      canvas.width = cols * maxWidth;
      canvas.height = rows * (maxHeight + labelHeight);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建 canvas 绘图上下文");

      ctx.fillStyle = "#1e1e1e";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      loadedImages.forEach((item, index) => {
        const c = index % cols;
        const r = Math.floor(index / cols);
        const x = c * maxWidth;
        const y = r * (maxHeight + labelHeight);

        ctx.fillStyle = "#000000";
        ctx.fillRect(x, y, maxWidth, labelHeight);

        ctx.fillStyle = "#ffffff";
        ctx.font = "16px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(item.label, x + maxWidth / 2, y + labelHeight / 2);

        const imgX = x + (maxWidth - item.img.width) / 2;
        const imgY = y + labelHeight + (maxHeight - item.img.height) / 2;
        ctx.drawImage(item.img, imgX, imgY);
      });

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

  function addLora(item: LoraItem, strength = 1, target = loraTarget) {
    const selection: LoraSelection = {
      name: loraSyntaxName(item),
      displayName: item.model_name,
      strength,
      clipStrength: strength,
      active: true,
      filePath: item.file_path,
      sha256: item.sha256,
    };
    if (target === "multi") {
      setMultiParams((prev) => ({ ...prev, loras: mergeLora(prev.loras, selection) }));
    } else if (target === "highres") {
      setHighresParams((prev) => ({ ...prev, loras: mergeLora(prev.loras, selection) }));
    } else {
      setDefaultParams((prev) => ({ ...prev, loras: mergeLora(prev.loras, selection) }));
    }
    pushToast("success", "LoRA 已插入", `${selection.name} -> ${templateLabels[target]}`);
  }

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

  function changeManagedModelType(nextType: ManagedModelType) {
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
  }

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
    <div className="app-shell">
      {showWelcome && <WelcomeModal onClose={handleCloseWelcome} />}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={22} />
          </div>
          <div>
            <h1>ComfyUI XYZ 控制台</h1>
            <span>{connection}</span>
          </div>
        </div>
        <nav className="tabs" aria-label="模板导航">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" className={tab === item.id ? "tab active" : "tab"} onClick={() => setTab(item.id)}>
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="top-actions">
          <button type="button" className="icon-button" onClick={() => setShowPromptEditor(true)}>
            <Sparkles size={18} />
            提示词编辑器
          </button>
          <button type="button" className="icon-button" onClick={() => setLoraOperation({ type: "settings" })}>
            <Settings size={18} />
            设置
          </button>
          <button type="button" className="icon-button" onClick={() => setLoraOperation({ type: "notifications" })}>
            <ListFilter size={18} />
            通知
          </button>
          <button type="button" className="icon-button danger" onClick={() => client.interrupt(progress.promptId)} disabled={!progress.running}>
            <PauseCircle size={18} />
            中断
          </button>
        </div>
      </header>

      <PromptEditorDialog 
        open={showPromptEditor} 
        onClose={() => setShowPromptEditor(false)}
        initialPositive={defaultParams.positivePrompt}
        initialNegative={defaultParams.negativePrompt}
        onApply={(positive, negative) => {
          setDefaultParams(prev => ({ ...prev, positivePrompt: positive, negativePrompt: negative }));
        }}
      />

      <RunProgressStrip progress={progress} />

      <div className={["layout", results.length > 0 ? "has-output" : "no-output", tab === "loras" ? "lora-full" : ""].filter(Boolean).join(" ")}>
        <main className="workspace">
          {error && <div className="error-line">{error}</div>}

          {tab === "default" && (
            <section className="panel">
              <div className="panel-header">
                <PanelTitle icon={Wand2} title="默认生图" />
              </div>
              <div className="panel-body">
                <BaseControls params={defaultParams} options={options} setParams={setDefaultParams} onLoraDetail={(lora) => setLoraDetail({ file_path: lora.filePath || lora.name, file_name: lora.name.split("/").pop() || lora.name, file_size: 0, sha256: lora.sha256 } as LoraItem)} />
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
                        <input value={clBatchParams.imageFolder} onChange={(e) => setClBatchParams(prev => ({ ...prev, imageFolder: e.target.value }))} placeholder="例如: F:\AI_lora\lora-data-img" />
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
                        <input value={wdBatchParams.imageFolder} onChange={(e) => setWdBatchParams(prev => ({ ...prev, imageFolder: e.target.value }))} placeholder="例如: F:\AI_lora\lora-data-img" />
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
                <BaseControls params={multiParams} options={options} setParams={setMultiParams} hidePositive onLoraDetail={(lora) => setLoraDetail({ file_path: lora.filePath || lora.name, file_name: lora.name.split("/").pop() || lora.name, file_size: 0, sha256: lora.sha256 } as LoraItem)} />
                <div className="multi-settings">
                  <TextAreaField label="全局 prompt" value={multiParams.globalPrompt} onChange={(value) => setMultiParams((prev) => ({ ...prev, globalPrompt: value }))} />
                  <div className="form-grid multi-options">
                    <SelectField label="语法模式" value={multiParams.syntaxMode} options={["attention_couple", "regional_prompts"]} onChange={(value) => setMultiParams((prev) => ({ ...prev, syntaxMode: value as MultiGenerationParams["syntaxMode"] }))} />
                    <NumberField label="多人画布宽" value={multiParams.canvasWidth} step={64} min={256} onChange={(value) => setMultiParams((prev) => ({ ...prev, canvasWidth: value }))} />
                    <NumberField label="多人画布高" value={multiParams.canvasHeight} step={64} min={256} onChange={(value) => setMultiParams((prev) => ({ ...prev, canvasHeight: value }))} />
                    <label className="field checkbox-field"><input type="checkbox" checked={multiParams.useFill} onChange={(event) => setMultiParams((prev) => ({ ...prev, useFill: event.target.checked }))} /> use_fill</label>
                  </div>
                </div>
                <div className="multi-editor-layout">
                  <MultiCanvasEditor
                    canvasWidth={multiParams.canvasWidth}
                    canvasHeight={multiParams.canvasHeight}
                    characters={multiParams.characters}
                    onChange={(characters) => setMultiParams((prev) => ({ ...prev, characters }))}
                  />
                  <CharacterEditor characters={multiParams.characters} onChange={(characters) => setMultiParams((prev) => ({ ...prev, characters }))} />
                </div>
              </div>
              <div className="panel-footer" style={{ display: "flex", gap: "8px" }}>
                <button className="primary-action" style={{ flex: 1 }} type="button" onClick={() => runPrompt("多人工作流", () => buildMultiPrompt(multiParams))}>
                  <UserRound size={18} />
                  运行多人工作流
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
                <BaseControls params={highresParams} options={options} setParams={setHighresParams} onLoraDetail={(lora) => setLoraDetail({ file_path: lora.filePath || lora.name, file_name: lora.name.split("/").pop() || lora.name, file_size: 0, sha256: lora.sha256 } as LoraItem)} />
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
              ...lorasOfTarget.map((_, i) => `loraStrength_${i}` as const)
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
              <XyzPreview axes={xyzAxes} lorasOfTarget={getXyzLoras()} />
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
                      <img src={item.result.images[0].url} alt={item.label} />
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
                onInsert={(item, target) => addLora(item, 1, target)}
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
              <div style={{ width: "240px", borderRight: "1px solid #263244", display: "flex", flexDirection: "column", background: "#0c111a" }}>
                <div style={{ padding: "16px", borderBottom: "1px solid #263244", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "bold" }}>
                    <FileText size={18} /> 记事本
                  </div>
                  <button type="button" className="lm-text-btn" onClick={handleAddNote} title="新建笔记">
                    <Plus size={18} />
                  </button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
                  {notes.length === 0 && <div className="empty-state" style={{ padding: "20px 0" }}>暂无笔记</div>}
                  {notes.map((note) => (
                    <div
                      key={note.id}
                      onClick={() => setActiveNoteId(note.id)}
                      style={{
                        padding: "10px 12px",
                        marginBottom: "6px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        background: activeNoteId === note.id ? "rgba(59, 130, 246, 0.15)" : "transparent",
                        border: activeNoteId === note.id ? "1px solid rgba(59, 130, 246, 0.4)" : "1px solid transparent",
                        boxShadow: activeNoteId === note.id ? "0 0 15px rgba(59, 130, 246, 0.1) inset" : "none",
                        color: activeNoteId === note.id ? "#93c5fd" : "#94a3b8",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        transition: "all 0.2s ease-in-out",
                      }}
                    >
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {note.title || "未命名"}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteNote(note.id);
                        }}
                        style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", padding: 0 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Editor */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px", background: "#080b12" }}>
                {activeNoteId && notes.find((n) => n.id === activeNoteId) ? (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                      <input
                        type="text"
                        value={notes.find((n) => n.id === activeNoteId)?.title || ""}
                        onChange={(e) => updateActiveNote({ title: e.target.value })}
                        placeholder="笔记标题"
                        style={{
                          background: "transparent",
                          border: "none",
                          fontSize: "20px",
                          fontWeight: "bold",
                          color: "#e7edf7",
                          width: "60%",
                          outline: "none",
                        }}
                      />
                      <button
                        type="button"
                        className="primary-action"
                        onClick={() => saveNotes(notes)}
                        disabled={notesSaving}
                        style={{ minWidth: "80px" }}
                      >
                        {notesSaving ? "保存中..." : "保存记录"}
                      </button>
                    </div>
                    
                    <RichTextEditor
                      value={notes.find((n) => n.id === activeNoteId)?.content || ""}
                      onChange={(content) => updateActiveNote({ content })}
                      onSave={() => saveNotes(notes)}
                      title={notes.find((n) => n.id === activeNoteId)?.title || "note"}
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
                  <div className="empty-state" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    请在左侧选择或新建笔记
                  </div>
                )}
              </div>
            </section>
          )}
        </main>

        {tab !== "loras" && (
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
      <ToastViewport toasts={toasts} onClose={(id) => setToasts((prev) => prev.filter((toast) => toast.id !== id))} />
      {showXyzHelp && <XyzHelpModal onClose={() => setShowXyzHelp(false)} />}
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
      {featureModal && <FeatureModal modal={featureModal} onClose={() => setFeatureModal(null)} />}
      {loraOperation && (
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
                setSimpleLoraTarget(null);
              }}
              onInsert={(item) => {
                addLora(item, 1, simpleLoraTarget);
                pushToast("success", "已添加 LoRA", `成功添加 ${item.model_name || item.file_name}`);
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
  );

  function updateAxis(index: number, patch: Partial<XyzAxis>) {
    setXyzAxes((prev) => prev.map((axis, axisIndex) => axisIndex === index ? { ...axis, ...patch } : axis));
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
          <div className="toast-content" style={{ flex: 1, minWidth: 0 }}>
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
  const show = progress.running || progress.label === "完成";
  if (!show) return null;
  const indeterminate = progress.running && percent <= 0;
  return (
    <div className="run-progress-strip" role="status" aria-live="polite">
      <div className="run-progress-meta">
        <strong>{progress.label}</strong>
        <span>{progress.node ? `节点 ${progress.node}` : progress.promptId ? `任务 ${progress.promptId.slice(0, 8)}` : "等待提交"}</span>
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

function XyzPreview({ axes, lorasOfTarget }: { axes: XyzAxis[], lorasOfTarget?: { name: string; displayName?: string }[] }) {
  const combos = buildXyzCombinations(axes, lorasOfTarget);
  return (
    <div className="xyz-preview">
      <div className="section-toolbar">
        <strong>组合预览</strong>
        <span>{combos.length} 个组合</span>
      </div>
      {combos.length === 0 ? (
        <div className="empty-strip">启用轴并填写取值后会显示组合预览</div>
      ) : (
        <div className="preview-table">
          {combos.slice(0, 80).map((combo, index) => (
            <div className="preview-row" key={`${combo.label}-${index}`}>
              <span>{index + 1}</span>
              <strong>{combo.label}</strong>
              <code>{JSON.stringify(combo.patch)}</code>
            </div>
          ))}
          {combos.length > 80 && <div className="empty-strip">仅预览前 80 个组合</div>}
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

      if (metadataResult.status === "rejected" && currentPath && !currentPath.includes(".")) {
        try {
          const searchRes = await client.listManagedModels(modelType, { search: item.model_name || item.file_name });
          const match = searchRes.items.find((x) => x.model_name === (item.model_name || item.file_name) || x.file_name === (item.file_name || item.file_path));
          if (match?.file_path) {
            Object.assign(item, match);
            currentPath = match.file_path;
            currentSha = match.sha256;
            
            metadataTask = client.getManagedModelMetadataByPath(modelType, currentPath);
            const retryResult = await Promise.allSettled([metadataTask]);
            metadataResult = retryResult[0];
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
        const result = await client.getLoraManagerSettings();
        if (result.success === false) throw new Error(result.error || "设置读取失败");
        const nextSettings = normalizeLoraManagerSettings(result.settings ?? result);
        setSettings(nextSettings);
        setTextValue(String(nextSettings.example_images_path ?? ""));
        setSecondaryValue(String(nextSettings.lora_syntax_format ?? ""));
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
    setBusy(true);
    try {
      const payload = {
        ...settings,
        example_images_path: textValue,
        lora_syntax_format: secondaryValue || settings.lora_syntax_format,
      };
      const result = await client.updateLoraManagerSettings(payload);
      if (result.success === false) throw new Error(result.error || "设置保存失败");
      const nextSettings = normalizeLoraManagerSettings(result.settings ?? payload);
      setSettings(nextSettings);
      onSettingsSaved(nextSettings);
      onApiBaseSaved(localApiBase);
      onTranslationSettingsSaved(localTranslationSettings);
      onToast("success", "设置已保存");
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
                  <TextInput label="示例图目录" value={textValue} onChange={setTextValue} placeholder="F:\\AI_lora\\img" />
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

function LoraMedia({
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
}) {
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
      preload="metadata"
      className={mediaClassWithOpen}
      data-nsfw-level={nsfwLevel}
    />
  ) : (
    <img
      src={src}
      alt={alt}
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
}

function BaseControls<T extends BaseGenerationParams>({
  params,
  options,
  setParams,
  hidePositive = false,
  onLoraDetail,
}: {
  params: T;
  options: OptionsState;
  setParams: (updater: (prev: T) => T) => void;
  hidePositive?: boolean;
  onLoraDetail?: (lora: LoraSelection) => void;
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
      {!hidePositive && (
        <div className="form-grid two prompt-grid">
          <TextAreaField label="正向提示词" value={params.positivePrompt} onChange={(value) => setField("positivePrompt", value as T["positivePrompt"])} />
          <TextAreaField label="反向提示词" value={params.negativePrompt} onChange={(value) => setField("negativePrompt", value as T["negativePrompt"])} />
        </div>
      )}
      {hidePositive && (
        <TextAreaField label="反向提示词" value={params.negativePrompt} onChange={(value) => setField("negativePrompt", value as T["negativePrompt"])} />
      )}
      <LoraChips loras={params.loras} onChange={(loras) => setField("loras", loras as T["loras"])} onDetail={onLoraDetail} />
    </>
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

function MultiCanvasEditor({
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
  const canvasRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<CanvasInteraction | null>(null);
  const visibleCharacters = enabledCanvasCharacters(characters);
  const [selectedId, setSelectedId] = useState(visibleCharacters[0]?.id ?? "");
  const [interaction, setInteraction] = useState<CanvasInteraction | null>(null);

  useEffect(() => {
    if (!visibleCharacters.some((character) => character.id === selectedId)) {
      setSelectedId(visibleCharacters[0]?.id ?? "");
    }
  }, [characters, selectedId, visibleCharacters]);

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
    setSelectedId(character.id);
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
        <span>{canvasWidth}x{canvasHeight}</span>
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
        {visibleCharacters.length === 0 && <div className="canvas-empty">启用角色后会显示 mask 区域</div>}
        <div className="canvas-corner">{canvasWidth}x{canvasHeight}<br />缩放: 100%</div>
      </div>
    </div>
  );
}

function CharacterEditor({ characters, onChange }: { characters: MultiCharacter[]; onChange: (characters: MultiCharacter[]) => void }) {
  function update(index: number, patch: Partial<MultiCharacter>) {
    onChange(characters.map((character, characterIndex) => characterIndex === index ? { ...character, ...patch } : character));
  }

  function updateMask(index: number, patch: Partial<MultiCharacter["mask"]>) {
    onChange(characters.map((character, characterIndex) => characterIndex === index ? { ...character, mask: { ...character.mask, ...patch } } : character));
  }

  return (
    <div className="character-panel">
      <div className="section-toolbar">
        <strong>角色控制</strong>
        <button type="button" className="icon-button" onClick={() => onChange(addCharacter(characters))}>
          <Plus size={16} />
          新增角色
        </button>
      </div>
      <div className="character-list">
        {characters.map((character, index) => (
          <div className="character-card" key={character.id}>
            <div className="character-head">
              <label><input type="checkbox" checked={character.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} /> 角色 {index + 1}</label>
              <input className="character-name" value={character.name} onChange={(event) => update(index, { name: event.target.value })} />
              <input type="color" value={character.color} onChange={(event) => update(index, { color: event.target.value })} />
            </div>
            <TextAreaField label="角色 prompt" value={character.prompt} onChange={(value) => update(index, { prompt: value })} />
            <div className="mini-grid">
              <NumberField label="权重" value={character.weight} step={0.1} onChange={(value) => update(index, { weight: value })} />
              <NumberField label="feather" value={character.feather} step={1} onChange={(value) => update(index, { feather: value })} />
              <NumberField label="x" value={character.mask.x} step={0.01} onChange={(value) => updateMask(index, { x: value })} />
              <NumberField label="y" value={character.mask.y} step={0.01} onChange={(value) => updateMask(index, { y: value })} />
              <NumberField label="w" value={character.mask.width} step={0.01} onChange={(value) => updateMask(index, { width: value })} />
              <NumberField label="h" value={character.mask.height} step={0.01} onChange={(value) => updateMask(index, { height: value })} />
            </div>
            <div className="card-actions">
              <button type="button" onClick={() => onChange(duplicateCharacter(characters, index))}><Copy size={15} /> 复制</button>
              <button type="button" onClick={() => onChange(removeCharacter(characters, index))}><Trash2 size={15} /> 删除</button>
            </div>
          </div>
        ))}
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
      </div>
    </div>
  );
}

type FolderTreeNode = {
  name: string;
  path: string;
  children: FolderTreeNode[];
};

function LoraManagerPanel({
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
}) {
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
  const updateQuery = (patch: Partial<LoraQueryState>) => {
    setQuery((prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }));
  };

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
          onSelect={(folder) => updateQuery({ folder })}
        />
        <div className="lm-model-area">
          <div className="lora-filter-row lm-filter-row">
            <select value={query.folder} onChange={(event) => updateQuery({ folder: event.target.value })}>
              <option value="">全部文件夹</option>
              {folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
            </select>
            <select value={query.baseModel} onChange={(event) => updateQuery({ baseModel: event.target.value })}>
              <option value="">全部模型类型</option>
              {baseModels.map((item) => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}
            </select>
            <select value={query.tag} onChange={(event) => updateQuery({ tag: event.target.value })}>
              <option value="">全部标签</option>
              {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
            <select value={density} onChange={(event) => setDensity(event.target.value as "compact" | "medium" | "large")}>
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
              const words = triggerWords[key] ?? extractItemTrainedWords(item);
              const previewNsfwLevel = getItemNsfwLevel(item);
              const previewMedia = pickCardPreviewMedia(item, localExampleFilesByHash);
              return (
                <article
                  className={[
                    "lora-card lm-model-card",
                    shouldBlurNsfwLevel(previewNsfwLevel, settings) ? "nsfw-content" : "",
                  ].filter(Boolean).join(" ")}
                  data-nsfw-level={previewNsfwLevel}
                  key={item.file_path}
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
                      <div className="card-quick-actions" onClick={(e) => e.stopPropagation()}>
                        <button type="button" title="添加到默认" onClick={() => onInsert?.(item, "default")}>默认</button>
                        <button type="button" title="添加到多人" onClick={() => onInsert?.(item, "multi")}>多人</button>
                        <button type="button" title="添加到高修" onClick={() => onInsert?.(item, "highres")}>高修</button>
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
}

function FolderSidebar({
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
}) {
  return (
    <aside className="lm-folder-sidebar">
      <button type="button" className={selected === "" ? "lm-sidebar-root selected" : "lm-sidebar-root"} onClick={() => onSelect("")}>
        <span className="lm-sidebar-root-label"><FolderOpen size={16} /> All {label}</span>
        <span><FolderOpen size={16} /> 全部 LoRA</span>
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
}

function FolderNodeButton({
  folder,
  selected,
  level,
  onSelect,
}: {
  folder: FolderTreeNode;
  selected: string;
  level: number;
  onSelect: (folder: string) => void;
}) {
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
}

function LoraChips({ loras, onChange, onDetail }: { loras: LoraSelection[]; onChange: (loras: LoraSelection[]) => void; onDetail?: (lora: LoraSelection) => void }) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

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
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    const newLoras = [...loras];
    const [dragged] = newLoras.splice(draggedIndex, 1);
    newLoras.splice(index, 0, dragged);
    onChange(newLoras);
    setDraggedIndex(null);
  };

  return (
    <div className="lora-compact-list">
      {loras.map((lora, index) => (
        <div 
          className={`lora-compact-row ${lora.active ? "" : "disabled"} ${draggedIndex === index ? "dragging" : ""}`} 
          key={lora.name + index}
          draggable
          onDragStart={(e) => handleDragStart(e, index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDrop={(e) => handleDrop(e, index)}
          onDragEnd={() => setDraggedIndex(null)}
          style={{ cursor: "grab" }}
        >
          <label className="lora-compact-toggle">
            <input type="checkbox" checked={lora.active} onChange={(event) => onChange(loras.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))} />
          </label>
          <div className="lora-compact-name" title={lora.displayName || lora.name} onClick={() => onDetail?.(lora)} style={onDetail ? { cursor: "pointer", textDecoration: "underline" } : undefined}>
            {lora.displayName || lora.name}
          </div>
          <div className="lora-compact-controls">
            <input className="lora-slider" type="range" value={lora.strength} min={-2} max={2} step={0.05} onChange={(event) => onChange(loras.map((item, itemIndex) => itemIndex === index ? { ...item, strength: Number(event.target.value), clipStrength: Number(event.target.value) } : item))} />
            <input className="lora-number" type="number" value={lora.strength} min={-10} max={10} step={0.05} onChange={(event) => onChange(loras.map((item, itemIndex) => itemIndex === index ? { ...item, strength: Number(event.target.value), clipStrength: Number(event.target.value) } : item))} />
          </div>
          <button className="lora-compact-remove" type="button" onClick={() => onChange(loras.filter((_, itemIndex) => itemIndex !== index))}>
            ×
          </button>
        </div>
      ))}
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

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
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


function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
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
        onChange={(event) => onChange(event.target.value)} 
        onKeyDown={(e) => isPrompt && handlePromptWeightAdjustment(e, value, onChange)}
      />
      {isPrompt && value.trim() && (
        <PromptTagBlocks value={value} onChange={onChange} />
      )}
    </div>
  );
}

function mergeLora(loras: LoraSelection[], selection: LoraSelection) {
  if (loras.some((lora) => lora.name === selection.name)) {
    return loras;
  }
  return [...loras, selection];
}

function readCombo(data: unknown, node: string, input: string, fallback: string[]) {
  const entry = (data as Record<string, { input?: { required?: Record<string, unknown> } }>)[node]?.input?.required?.[input];
  if (Array.isArray(entry) && Array.isArray(entry[0])) {
    return entry[0].map(String);
  }
  return fallback;
}

function normalizePreview(apiBase: string, preview?: string) {
  if (!preview) return "";
  if (/^https?:\/\//.test(preview)) return preview;
  if (preview.startsWith("/xyz/")) return preview;
  if (preview.startsWith("/")) return `${apiBase}${preview}`;
  return `${apiBase}/${preview}`;
}

function normalizeLoraManagerSettings(settings?: LoraManagerSettings | null): LoraManagerSettings {
  return {
    ...defaultLoraManagerSettings,
    ...(settings ?? {}),
    blur_mature_content: settings?.blur_mature_content ?? defaultLoraManagerSettings.blur_mature_content,
    mature_blur_level: normalizeMatureBlurLevel(settings?.mature_blur_level),
  };
}

function normalizeMatureBlurLevel(value: unknown): MatureBlurLevel {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return validMatureBlurLevels.includes(normalized as MatureBlurLevel) ? normalized as MatureBlurLevel : "R";
}

function getMatureBlurThreshold(settings?: LoraManagerSettings | null) {
  const level = normalizeMatureBlurLevel(settings?.mature_blur_level);
  return NSFW_LEVELS[level] ?? NSFW_LEVELS.R;
}

function normalizeNsfwLevel(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function getItemNsfwLevel(item: LoraItem, metadata?: LoraMetadata | null) {
  const explicitLevel = normalizeNsfwLevel(item.preview_nsfw_level);
  if (explicitLevel > 0 || item.preview_nsfw_level !== undefined) {
    return explicitLevel;
  }
  const itemCivitai = item.civitai as LoraMetadata | undefined;
  return metadata?.model?.nsfw || itemCivitai?.model?.nsfw ? NSFW_LEVELS.R : NSFW_LEVELS.UNKNOWN;
}

function getMediaNsfwLevel(media: LoraExampleMedia, fallbackLevel = 0) {
  if (media.nsfwLevel !== undefined) {
    return normalizeNsfwLevel(media.nsfwLevel);
  }
  const metadata = media.metadata as Record<string, unknown> | undefined;
  const meta = media.meta as Record<string, unknown> | undefined;
  const metadataLevel = normalizeNsfwLevel(metadata?.nsfwLevel ?? meta?.nsfwLevel);
  if (metadataLevel > 0) return metadataLevel;
  if (metadata?.nsfw === true || meta?.nsfw === true) return NSFW_LEVELS.R;
  return normalizeNsfwLevel(fallbackLevel);
}

function shouldBlurNsfwLevel(level: number, settings?: LoraManagerSettings | null) {
  return settings?.blur_mature_content !== false && normalizeNsfwLevel(level) >= getMatureBlurThreshold(settings);
}

function getNSFWLevelName(level: number) {
  const normalized = normalizeNsfwLevel(level);
  if (normalized >= NSFW_LEVELS.BLOCKED) return "Blocked";
  if (normalized >= NSFW_LEVELS.XXX) return "XXX";
  if (normalized >= NSFW_LEVELS.X) return "X";
  if (normalized >= NSFW_LEVELS.R) return "R";
  if (normalized >= NSFW_LEVELS.PG13) return "PG13";
  if (normalized >= NSFW_LEVELS.PG) return "PG";
  return "Unknown";
}

function getNsfwWarningText(level: number) {
  const normalized = normalizeNsfwLevel(level);
  if (normalized >= NSFW_LEVELS.XXX) return "XXX-rated Content";
  if (normalized >= NSFW_LEVELS.X) return "X-rated Content";
  if (normalized >= NSFW_LEVELS.R) return "R-rated Content";
  return "Mature Content";
}

function buildLoraExamples(
  _apiBase: string,
  item: LoraItem,
  metadata: LoraMetadata | null,
  localFiles: LoraExampleMedia[],
) {
  const remoteImages = [...(metadata?.images ?? []), ...(metadata?.customImages ?? [])].filter(Boolean);
  if (remoteImages.length > 0) {
    return remoteImages.map((remote, index) => {
      const local = findMatchingLocalExample(remote, index, localFiles);
      if (!local) {
        return { ...remote, source: remote.source ?? "civitai" };
      }
      return mergeRemoteWithLocalExample(remote, local);
    });
  }

  const dedupedLocal = dedupeLocalExamples(localFiles);
  if (dedupedLocal.length > 0) {
    return dedupedLocal.map(normalizeLocalExample);
  }

  const merged: LoraExampleMedia[] = [];
  if (item.preview_url) {
    merged.push({
      url: item.preview_url,
      type: isVideoPath(item.preview_url) ? "video" : "image",
      source: "preview",
      nsfwLevel: getItemNsfwLevel(item, metadata),
    });
  }
  return merged;
}

function mergeRemoteWithLocalExample(remote: LoraExampleMedia, local: LoraExampleMedia) {
  const localExample = normalizeLocalExample(local);
  return {
    ...remote,
    ...localExample,
    source: "local" as const,
    meta: remote.meta ?? localExample.meta,
    nsfwLevel: localExample.nsfwLevel ?? remote.nsfwLevel,
  };
}

function pickCardPreviewMedia(item: LoraItem, localFilesByHash: Record<string, LoraExampleMedia[]>): LoraExampleMedia {
  const hash = item.sha256?.toLowerCase();
  const localFiles = hash ? localFilesByHash[hash] ?? [] : [];
  const localPreview = pickPreferredLocalExample(localFiles.filter((file) => /^image_0\./i.test(localExampleName(file))))
    ?? pickPreferredLocalExample(localFiles);
  if (localPreview) {
    return {
      ...normalizeLocalExample(localPreview),
      nsfwLevel: item.preview_nsfw_level ?? localPreview.nsfwLevel,
    };
  }
  return {
    url: item.preview_url,
    type: isVideoPath(item.preview_url ?? "") ? "video" : "image",
    nsfwLevel: item.preview_nsfw_level,
    source: "preview",
  };
}

function normalizeLocalExample(local: LoraExampleMedia): LoraExampleMedia {
  const localSource = localExampleSource(local);
  const normalized = {
    ...local,
    source: "local" as const,
    type: local.is_video ? "video" : local.type ?? (isVideoPath(localSource) ? "video" : "image"),
  };
  if (!normalized.path && localSource) {
    normalized.path = localSource;
  }
  if (!normalized.url && localSource) {
    normalized.url = localSource;
  }
  return normalized;
}

function findMatchingLocalExample(remote: LoraExampleMedia, index: number, localFiles: LoraExampleMedia[]) {
  const customId = remote.id !== undefined && remote.id !== null ? `custom_${String(remote.id)}` : "";
  const candidates = localFiles.filter((file) => {
    const name = localExampleName(file);
    const imageMatch = name.match(/^image_(\d+)\./i);
    if (customId) {
      return name.startsWith(customId) || Boolean(imageMatch && Number(imageMatch[1]) === index);
    }
    return Boolean(imageMatch && Number(imageMatch[1]) === index);
  });
  return pickPreferredLocalExample(candidates);
}

function dedupeLocalExamples(localFiles: LoraExampleMedia[]) {
  const byKey = new Map<string, LoraExampleMedia>();
  for (const file of localFiles) {
    const key = localExampleKey(file);
    const current = byKey.get(key);
    if (!current || localExampleScore(file) > localExampleScore(current)) {
      byKey.set(key, file);
    }
  }
  return Array.from(byKey.values());
}

function pickPreferredLocalExample(files: LoraExampleMedia[]) {
  return files.reduce<LoraExampleMedia | undefined>((best, file) => {
    if (!best || localExampleScore(file) > localExampleScore(best)) {
      return file;
    }
    return best;
  }, undefined);
}

function localExampleKey(file: LoraExampleMedia) {
  const name = localExampleName(file);
  return name.replace(/\.[^.]+$/, "").toLowerCase();
}

function localExampleName(file: LoraExampleMedia) {
  const value = file.name || localExampleSource(file);
  return value.split(/[\\/]/).pop() || value;
}

function localExampleSource(file: LoraExampleMedia) {
  return file.path || file.url || "";
}

function localExampleExtension(file: LoraExampleMedia) {
  const fromType = file.extension || localExampleName(file).match(/\.[^.]+$/)?.[0] || "";
  return fromType.toLowerCase();
}

function localExampleScore(file: LoraExampleMedia) {
  if (isLoraVideo(file, localExampleSource(file))) return 50;
  const extension = localExampleExtension(file);
  if (extension === ".webp") return 40;
  if (extension === ".png") return 30;
  if (extension === ".jpg" || extension === ".jpeg") return 20;
  if (extension === ".gif") return 10;
  return 0;
}

function isLoraVideo(media: LoraExampleMedia, src = "") {
  return Boolean(media.is_video || media.type === "video" || isVideoPath(src || media.path || media.url || ""));
}

function isVideoPath(value: string) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(value);
}

function buildFolderTree(folders: string[]) {
  const roots: FolderTreeNode[] = [];
  const lookup = new Map<string, FolderTreeNode>();
  for (const folder of folders) {
    const parts = folder.split(/[\\/]/).filter(Boolean);
    let path = "";
    let siblings = roots;
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      let node = lookup.get(path);
      if (!node) {
        node = { name: part, path, children: [] };
        lookup.set(path, node);
        siblings.push(node);
      }
      siblings = node.children;
    }
  }
  return roots;
}

function extractItemTrainedWords(item: LoraItem) {
  const civitai = item.civitai as LoraMetadata | undefined;
  return uniqueStrings(civitai?.trainedWords ?? []);
}

function subTypeAbbreviation(value?: string) {
  const normalized = value?.toLowerCase();
  if (normalized === "locon" || normalized === "lycoris") return "LyCO";
  if (normalized === "dora") return "DoRA";
  if (normalized === "loha") return "LoHA";
  return "LoRA";
}

function baseModelAbbreviation(value?: string) {
  const text = value || "Unknown";
  const normalized = text.toLowerCase();
  if (normalized.includes("stable diffusion xl") || normalized.includes("sdxl")) return "SDXL";
  if (normalized.includes("stable diffusion 1.5") || normalized.includes("sd 1.5")) return "SD1.5";
  if (normalized.includes("illustrious")) return "Illustrious";
  if (normalized.includes("pony")) return "Pony";
  return text.length > 14 ? `${text.slice(0, 12)}...` : text;
}

function uniqueStrings(values: Array<string | undefined | null>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    result.push(text);
  }
  return result;
}

function mergeManagedModelItems(currentItems: LoraItem[], nextItems: LoraItem[]) {
  const byPath = new Map<string, LoraItem>();
  for (const item of currentItems) {
    byPath.set(item.file_path || `${item.model_name}-${item.file_name}`, item);
  }
  for (const item of nextItems) {
    byPath.set(item.file_path || `${item.model_name}-${item.file_name}`, item);
  }
  return Array.from(byPath.values());
}

function parseTriggerWordsInput(value: string) {
  return uniqueStrings(value.split(/[\n]+/).map((word) => word.trim()).filter(Boolean));
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function formatStrength(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function loraSyntaxName(item: LoraItem) {
  if (item.folder && item.file_name) {
    return `${item.folder}/${item.file_name}`;
  }
  return item.file_name || item.model_name;
}

function roundCanvasMask(mask: MultiCharacter["mask"]) {
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return {
    ...mask,
    x: round(mask.x),
    y: round(mask.y),
    width: round(mask.width),
    height: round(mask.height),
  };
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((part) => `${part}${part}`).join("")
    : normalized.padEnd(6, "0").slice(0, 6);
  const number = Number.parseInt(value, 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function formatBytes(value?: number) {
  if (!value) return "未知";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function initialTabFromUrl(): TabId {
  if (typeof window === "undefined") return "default";
  const tabParam = new URLSearchParams(window.location.search).get("tab");
  const match = tabs.find((item) => item.id === tabParam);
  return match?.id ?? "default";
}

function loraModelId(item?: LoraItem) {
  if (!item) return undefined;
  const civitai = item.civitai as LoraMetadata | undefined;
  const metadata = item.metadata as LoraMetadata | undefined;
  const fromRaw = [
    civitai?.modelId,
    metadata?.modelId,
    (item.civitai as Record<string, unknown> | undefined)?.modelId,
    (item.metadata as Record<string, unknown> | undefined)?.modelId,
    (item.civitai as Record<string, unknown> | undefined)?.model_id,
    (item.metadata as Record<string, unknown> | undefined)?.model_id,
  ].find((value) => Number.isFinite(Number(value)));
  return fromRaw === undefined ? undefined : Number(fromRaw);
}

function buildLoraCivitaiUrl(item: LoraItem, metadata?: LoraMetadata | null) {
  const itemCivitai = item.civitai as Record<string, unknown> | undefined;
  const itemMetadata = item.metadata as Record<string, unknown> | undefined;
  const loadedMetadata = metadata as Record<string, unknown> | null | undefined;
  const modelId = firstFiniteNumber([
    itemCivitai?.modelId,
    itemCivitai?.model_id,
    loadedMetadata?.modelId,
    loadedMetadata?.model_id,
    itemMetadata?.modelId,
    itemMetadata?.model_id,
  ]);
  const versionId = firstFiniteNumber([
    itemCivitai?.id,
    itemCivitai?.modelVersionId,
    itemCivitai?.model_version_id,
    loadedMetadata?.id,
    loadedMetadata?.modelVersionId,
    loadedMetadata?.model_version_id,
    itemMetadata?.id,
    itemMetadata?.modelVersionId,
    itemMetadata?.model_version_id,
  ]);
  if (modelId !== undefined) {
    const base = `https://civitai.red/models/${encodeURIComponent(String(modelId))}`;
    return versionId !== undefined ? `${base}?modelVersionId=${encodeURIComponent(String(versionId))}` : base;
  }
  if (versionId !== undefined) {
    return `https://civitai.red/model-versions/${encodeURIComponent(String(versionId))}`;
  }
  if (item.from_civitai) {
    return `https://civitai.red/models?query=${encodeURIComponent(item.model_name || item.file_name)}`;
  }
  return null;
}

function firstFiniteNumber(values: unknown[]) {
  const value = values.find((candidate) => Number.isFinite(Number(candidate)) && String(candidate).trim() !== "");
  return value === undefined ? undefined : Number(value);
}

function updateRecordModelId(record: LoraUpdateRecord) {
  const value = record.modelId ?? record.model_id;
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function operationTitle(operation: LoraOperation) {
  const titles: Record<LoraOperation["type"], string> = {
    rename: "重命名 LoRA",
    move: "移动 LoRA",
    delete: "删除 LoRA",
    download: "下载 LoRA",
    duplicates: "重复项管理",
    updates: "更新检查",
    doctor: "医生检查",
    settings: "全局设置",
    notifications: "通知队列",
    civitai: "Civitai 详情",
  };
  return titles[operation.type];
}

function xyzStatusLabel(status: XyzRunItem["status"]) {
  const labels: Record<XyzRunItem["status"], string> = {
    queued: "等待",
    running: "运行中",
    success: "完成",
    failed: "失败",
    cancelled: "已中断",
  };
  return labels[status];
}

function downloadTextFile(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
