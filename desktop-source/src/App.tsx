import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppSidebar } from "./components/layout/AppSidebar";
import { AppModals } from "./components/layout/AppModals";
import { AppTopbar } from "./components/layout/AppTopbar";
import { ConnectionOverlay } from "./components/layout/ConnectionOverlay";
import { OutputPanel } from "./components/layout/OutputPanel";
import { WorkspacePanels } from "./components/layout/WorkspacePanels";
import type { WorkspaceHandlers } from "./components/layout/WorkspacePanels";
import { PromptSidebar } from "./components/PromptSidebar";
import { QueuePanel } from "./components/QueuePanel";
import { ToastViewport } from "./components/ui";
import { useWatermarkSettings } from "./hooks/useWatermarkSettings";

import { useAppContext } from "./app-context";
import { useToast } from "./hooks/useToast";
import { useUiState } from "./hooks/useUiState";
import { useNotes } from "./hooks/useNotes";
import { useLoras } from "./hooks/useLoras";
import { useGeneration } from "./hooks/useGeneration";
import { useParams } from "./hooks/useParams";
import { useTagging } from "./hooks/useTagging";
import { useXyz } from "./hooks/useXyz";
import { useOptions } from "./hooks/useOptions";
import { useMobileTasks } from "./hooks/useMobileTasks";
import { useNotifier } from "./hooks/useNotifier";
import { useSheetLora } from "./hooks/useSheetLora";
import { useDatasetRun } from "./hooks/useDatasetRun";
import type { DatasetRunCaps, DatasetStartMode } from "./hooks/useDatasetRun";

import { loraSyntaxName, mergeLora } from "./lib/lora-helper";
import { pickCardPreviewMedia } from "./lib/lora-media";
import { addCharacter } from "./lib/multiCharacters";
import {
  buildDefaultPrompt,
  buildHighresPrompt,
  buildMultiPrompt,
  buildAnimaPrompt,
} from "./lib/workflowBuilders";
import { buildSheetPrompt, composeSheetPromptFromParams } from "./lib/characterSheet";
import { buildCaptionsText, buildDatasetPlan, buildManifest, reseedDatasetConfig } from "./lib/dataset";
import { downloadTextFile } from "./lib/file-helper";
import {
  generationTabs as generationTabConfig,
  slotsTab,
  toolTabs as toolTabConfig,
  templateLabels,
  loraInsertTargetLabels,
} from "./constants";
import type { LoraSelection, TemplateKind, LoraInsertTarget, LoraItem, TabId, MobileTask, MobileTaskStatus, OutputImage, XyzCombination, AnimaGenerationParams, BaseGenerationParams, MultiGenerationParams, HighresParams, WatermarkBakeConfig, DrawTextParams } from "./types";
import type { AnimaApplyMode, AnimaComposerValues } from "./lib/anima/types";
import { mergeComposerSlots } from "./lib/anima/compose";
import { useWorkbenchComposer } from "./hooks/useAnimaComposer";
import { applyWardrobeSplitToValues } from "./lib/wardrobe/workbench";
import type { WardrobeWorkbenchSplit } from "./lib/wardrobe/types";
import { renderWatermarkLayers } from "./lib/watermark";
import { applySpecialXyzPatch } from "./lib/xyz";
import { openImageManagerService } from "./lib/imageService";
import { img2imgUpdater } from "./lib/paramBuilders";
import { appendPromptUpdater } from "./lib/promptAppend";
import { loadWildcards } from "./lib/wildcards";
import { WILDCARD_FILES } from "./lib/wildcards";

/**
 * 非首屏面板一律动态加载（其余面板在 WorkspacePanels 内）。
 * 这些面板的 barrel（`features/Xxx/index.ts`）没有 default 导出，故统一走
 * `.then(m => ({ default: m.Xxx }))`——这样 props 类型仍由真实组件推导，无需 `any`。
 */
const XyzController = lazy(() =>
  import("./components/features/Xyz").then((m) => ({ default: m.XyzController })),
);

/** 懒加载占位：复用现有 `.panel` + `.empty-state`，`styles.css` 零新增 */
const PanelFallback = () => (
  <div className="panel">
    <div className="empty-state">加载中…</div>
  </div>
);

function App() {
  const { apiBase, setApiBase, client, connection, tab, setTab } = useAppContext();

  // ===== Hooks =====
  const { toasts, notificationLog, pushToast, removeToast } = useToast();
  const ui = useUiState();
  const confirmDialog = ui.confirm;
  const tagging = useTagging();
  const { setWdTags } = tagging;
  const xyz = useXyz();
  const notesHook = useNotes({ tab, pushToast, confirm: confirmDialog });
  const notifier = useNotifier();
  const notifyComplete = notifier.notifyComplete;
  // 水印设置单点创建（参数 + 生图自动开关），useGeneration 与水印弹窗共用
  const watermarkSettings = useWatermarkSettings();

  const gen = useGeneration({ client, pushToast, notifyComplete: notifyComplete, watermark: watermarkSettings });
  const params = useParams();
  /**
   * 数据集队列放在 App 层：数据集面板是条件渲染，切走即卸载；
   * 队列若挂在面板里，100 张跑到一半切页就断了。
   */
  const datasetRun = useDatasetRun({
    client,
    pushToast,
    notifyComplete: notifyComplete,
    setGlobalProgress: gen.setProgress,
    setActiveTaskLabel: gen.setActiveTaskLabel,
  });
  const {
    items: datasetItems,
    run: datasetRunState,
    running: datasetRunning,
    current: datasetCurrent,
    replacePlan: replaceDatasetPlan,
    start: startDatasetRun,
    stop: stopDatasetRun,
    retryFailed: retryDatasetFailed,
    rerunOne: rerunDatasetOne,
    recoverFromHistory: recoverDatasetHistory,
  } = datasetRun;

  // 应用启动即惰性加载内置通配符词库到动态提示的模块级注册表
  useEffect(() => {
    void loadWildcards();
  }, []);

  // ===== 手机上传识别（局域网联动）全局同步 =====
  const mobile = useMobileTasks();
  const mobilePrevStatus = useRef<Record<string, MobileTaskStatus>>({});
  const mobileSynced = useRef(false);

  const handleMobileDone = useCallback((task: MobileTask) => {
    if (!task.tags) return;
    setWdTags(task.tags);
    pushToast("success", "手机识别完成", `${task.imageName} — tags 已同步到「图片识别」输出框`);
    notifyComplete("手机识别完成", `${task.imageName} — tags 已同步`);
  }, [pushToast, setWdTags, notifyComplete]);

  useEffect(() => {
    if (mobile.loading) return;
    const prev = mobilePrevStatus.current;
    if (!mobileSynced.current) {
      // 首帧作为基线：历史任务不触发重复提示
      mobileSynced.current = true;
      for (const t of mobile.tasks) prev[t.id] = t.status;
      return;
    }
    for (const t of mobile.tasks) {
      const before = prev[t.id];
      if (!before) {
        prev[t.id] = t.status;
        if (t.status === "done") {
          if (t.tags) handleMobileDone(t);
        } else {
          pushToast("info", "手机上传识别", `手机提交了 ${t.imageName}`);
        }
      } else if (before !== "done" && t.status === "done") {
        prev[t.id] = t.status;
        if (t.tags) handleMobileDone(t);
      } else {
        prev[t.id] = t.status;
      }
    }
    const liveIds = new Set(mobile.tasks.map((t) => t.id));
    for (const id of Object.keys(prev)) {
      if (!liveIds.has(id)) delete prev[id];
    }
  }, [mobile.loading, mobile.tasks, handleMobileDone, pushToast]);

  const { options, setOptions, loraSettings, setLoraSettings } = useOptions({
    client,
    pushToast,
    setDefaultParams: (updater) => params.setDefaultParams(updater),
    setMultiParams: (updater) => params.setMultiParams(updater),
    setHighresParams: (updater) => params.setHighresParams(updater),
    setAnimaParams: (updater) => params.setAnimaParams(updater),
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
    params.animaParams.loras.forEach(l => l.sha256 && hashes.add(l.sha256.toLowerCase()));
    params.sheetParams.anima.loras.forEach(l => l.sha256 && hashes.add(l.sha256.toLowerCase()));
    params.sheetParams.sdxl.loras.forEach(l => l.sha256 && hashes.add(l.sha256.toLowerCase()));
    return Array.from(hashes);
  }, [
    params.defaultParams.loras,
    params.multiParams.loras,
    params.highresParams.loras,
    params.animaParams.loras,
    params.sheetParams.anima.loras,
    params.sheetParams.sdxl.loras,
  ]);

  const loras = useLoras({
    client,
    pushToast,
    activeLoraHashes: allActiveHashes,
    loraSettings,
    setLoraSettings,
    tab: tab as TabId,
  });

  // 稳定成员解构：useCallback 只依赖具体 setter / 值，避免整个 hook 对象进 deps
  const {
    setShowThemePanel,
    setIsAppSidebarCollapsed,
    setShowPromptEditor,
    setShowPromptSidebar,
    setShowTranslation,
    setShowLauncher,
    setOutputLightbox,
    setCompareLightbox,
  } = ui;
  const { runPrompt, runWd14, runClSingle, runBatchTagger } = gen;
  const {
    loraExampleFilesByHash,
    setLoraDetail,
    setLoraOperation,
    setManagedModelType,
    loraTarget,
  } = loras;
  const { wd14, wdFile, clSingleParams, clFile, clBatchParams, wdBatchParams } = tagging;
  const { updateActiveNote } = notesHook;
  // AppSidebar 是 React.memo：回调必须是稳定引用，否则每次渲染都会击穿 memo
  const openThemePanel = useCallback(() => setShowThemePanel(true), [setShowThemePanel]);

  const loraNames = useMemo(
    () =>
      loras.loraResult.items
        .map((item) => item.file_name || (item.file_path ? item.file_path.split(/[\\/]/).pop() ?? "" : ""))
        .filter(Boolean),
    [loras.loraResult.items],
  );
  const wildcardNames = useMemo(() => [...WILDCARD_FILES] as string[], []);

  /**
   * 三视图 LoRA 检索：只在打开三视图页时发请求（一次），结果同时喂给面板展示与生成，
   * 避免「预览说挂了 A、生成却挂 B」。
   */
  const sheetLora = useSheetLora(client, tab === "sheet", params.sheetParams.lora.override);

  const handleOpenLoraDetail = useCallback((lora: LoraSelection | LoraItem) => {
    if ("sha256" in lora && "file_path" in lora) {
      setLoraDetail(lora as LoraItem);
      return;
    }
    const selection = lora as LoraSelection;
    setManagedModelType("loras");
    const hash = selection.sha256?.toLowerCase();
    const fallbackPreview = hash ? (loraExampleFilesByHash[hash]?.[0]?.path || loraExampleFilesByHash[hash]?.[0]?.url) : undefined;
    
    setLoraDetail({ 
      file_path: selection.filePath || selection.name, 
      file_name: selection.name.split("/").pop() || selection.name,
      model_name: selection.displayName || selection.name.split("/").pop() || selection.name,
      preview_url: selection.previewUrl || fallbackPreview,
      file_size: 0, 
      sha256: selection.sha256 
    } as LoraItem);
  }, [loraExampleFilesByHash, setLoraDetail, setManagedModelType]);

  const handleLoraInsert = useCallback((item: LoraItem, target: LoraInsertTarget, strength = 1) => {
    const hash = item.sha256?.toLowerCase();
    const localFiles = hash ? loraExampleFilesByHash[hash] ?? [] : [];
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

    /**
     * 穷举表：新增插入目标时漏写会在编译期报错。
     * 这里刻意不再用 `if/else` + `else → 默认生图`——那个兜底会把「三视图」的 LoRA
     * 静默写进默认生图面板，且不报任何错。
     */
    const inserters: Record<LoraInsertTarget, (value: LoraSelection) => void> = {
      default: (value) => params.setDefaultParams((prev) => ({ ...prev, loras: mergeLora(prev.loras, value) })),
      multi: (value) => params.setMultiParams((prev) => ({ ...prev, loras: mergeLora(prev.loras, value) })),
      highres: (value) => params.setHighresParams((prev) => ({ ...prev, loras: mergeLora(prev.loras, value) })),
      anima: (value) => params.setAnimaParams((prev) => ({ ...prev, loras: mergeLora(prev.loras, value) })),
      sheet: (value) =>
        params.setSheetParams((prev) =>
          prev.mode === "anima"
            ? { ...prev, anima: { ...prev.anima, loras: mergeLora(prev.anima.loras, value) } }
            : { ...prev, sdxl: { ...prev.sdxl, loras: mergeLora(prev.sdxl.loras, value) } },
        ),
      dataset: (value) =>
        params.setDatasetParams((prev) =>
          prev.mode === "anima"
            ? { ...prev, anima: { ...prev.anima, loras: mergeLora(prev.anima.loras, value) } }
            : { ...prev, sdxl: { ...prev.sdxl, loras: mergeLora(prev.sdxl.loras, value) } },
        ),
    };

    const insert = inserters[target];
    if (!insert) {
      pushToast("error", "LoRA 插入失败", `未知目标：${String(target)}`);
      return;
    }

    insert(selection);
    pushToast("success", "LoRA 已插入", `${selection.displayName} -> ${loraInsertTargetLabels[target]}`);
  }, [loraExampleFilesByHash, params, pushToast]);

  const handleSlotsApply = useCallback((tags: string[], target: TemplateKind) => {
    const clean = tags.map((tag) => tag.trim()).filter(Boolean);
    if (clean.length === 0) return;
    const text = clean.join(", ");
    const updater = appendPromptUpdater<MultiGenerationParams>(text, { useGlobal: target === "multi", dedupe: true });

    if (target === "multi") {
      params.setMultiParams(updater);
    } else if (target === "highres") {
      params.setHighresParams(appendPromptUpdater<HighresParams>(text, { useGlobal: false, dedupe: true }));
    } else if (target === "anima") {
      params.setAnimaParams(appendPromptUpdater<AnimaGenerationParams>(text, { useGlobal: false, dedupe: true }));
    } else {
      params.setDefaultParams(appendPromptUpdater<BaseGenerationParams>(text, { useGlobal: false, dedupe: true }));
    }
    pushToast("success", "转盘结果已应用", `已追加 ${clean.length} 个词条到 ${templateLabels[target]} 正向提示词`);
  }, [params, pushToast]);

  // 手机识图结果应用到工作流（与 handleSlotsApply 相同的追加/去重规则）
  const handleApplyTags = useCallback((tagsText: string, target: TemplateKind) => {
    const clean = tagsText.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
    if (clean.length === 0) return;
    const text = clean.join(", ");

    if (target === "multi") {
      params.setMultiParams(appendPromptUpdater<MultiGenerationParams>(text, { useGlobal: true, dedupe: true }));
    } else if (target === "highres") {
      params.setHighresParams(appendPromptUpdater<HighresParams>(text, { useGlobal: false, dedupe: true }));
    } else if (target === "anima") {
      params.setAnimaParams(appendPromptUpdater<AnimaGenerationParams>(text, { useGlobal: false, dedupe: true }));
    } else {
      params.setDefaultParams(appendPromptUpdater<BaseGenerationParams>(text, { useGlobal: false, dedupe: true }));
    }
    pushToast("success", "标签已应用", `已追加 ${clean.length} 个标签到 ${templateLabels[target]} 正向提示词`);
  }, [params, pushToast]);

  /**
   * T8：XYZ 复盘 → 最优组合一键回填。
   * 复盘的结论原本只是文字（「CFG=9 均值最高」），现在可以直接把**最优那张图对应的
   * 完整组合 patch** 应用到目标模板面板，闭合「批量试 → 选最优 → 回单张微调」。
   * 合并语义与 `buildXyzPrompt` 保持一致（positivePrompt 追加而非覆盖）。
   */
  const handleXyzApplyCombo = useCallback((combo: XyzCombination) => {
    const target = xyz.xyzTarget;
    if (target === "multi") {
      params.setMultiParams((prev) => {
        const patched = applySpecialXyzPatch(prev, combo);
        const promptAppend = combo.patch.positivePrompt;
        return promptAppend
          ? { ...patched, globalPrompt: [prev.globalPrompt, promptAppend].filter(Boolean).join("\n") }
          : patched;
      });
    } else if (target === "highres") {
      params.setHighresParams((prev) => applySpecialXyzPatch(prev, combo));
    } else if (target === "anima") {
      params.setAnimaParams((prev) => applySpecialXyzPatch(prev, combo));
    } else {
      params.setDefaultParams((prev) => applySpecialXyzPatch(prev, combo));
    }
    pushToast("success", "最优组合已回填", `${templateLabels[target]} ← ${combo.label}`);
    setTab(target);
  }, [xyz.xyzTarget, params, pushToast, setTab]);

  const handleSidebarSelect = useCallback((text: string, target: "positive" | "negative") => {
    // 词库 / 造型台 / 工作台没有自己的生成参数：在它们上面从仓库取词时落点应当是 Anima 模板
    const promptTab = tab === "anima-library" || tab === "wardrobe" || tab === "workbench" ? "anima" : tab;
    const opts = { useGlobal: promptTab === "multi", dedupe: false };
    // 三视图页没有 positivePrompt：正向落「角色描述」，负向落当前模型族的负向框
    const appendToSheet = (side: "positive" | "negative") =>
      params.setSheetParams((prev) => {
        const join = (current: string) => [current.trim(), text.trim()].filter(Boolean).join(", ");
        if (side === "positive") return { ...prev, characterPrompt: join(prev.characterPrompt) };
        return prev.mode === "anima"
          ? { ...prev, anima: { ...prev.anima, negativePrompt: join(prev.anima.negativePrompt) } }
          : { ...prev, sdxl: { ...prev.sdxl, negativePrompt: join(prev.sdxl.negativePrompt) } };
      });
    // 数据集页同理：正向落「角色固定词」（每条都带），负向落当前模型族
    const appendToDataset = (side: "positive" | "negative") =>
      params.setDatasetParams((prev) => {
        const join = (current: string) => [current.trim(), text.trim()].filter(Boolean).join(", ");
        if (side === "positive") return { ...prev, characterPrompt: join(prev.characterPrompt) };
        return prev.mode === "anima"
          ? { ...prev, anima: { ...prev.anima, negativePrompt: join(prev.anima.negativePrompt) } }
          : { ...prev, sdxl: { ...prev.sdxl, negativePrompt: join(prev.sdxl.negativePrompt) } };
      });
    // 负向框始终写 negativePrompt（multi 也没有单独的负向 globalPrompt），按 tab 落到对应面板
    if (target === "negative") {
      if (promptTab === "dataset") appendToDataset("negative");
      else if (promptTab === "sheet") appendToSheet("negative");
      else if (promptTab === "multi") params.setMultiParams(appendPromptUpdater<MultiGenerationParams>(text, { useGlobal: false, dedupe: false }));
      else if (promptTab === "highres") params.setHighresParams(appendPromptUpdater<HighresParams>(text, { useGlobal: false, dedupe: false }));
      else if (promptTab === "anima") params.setAnimaParams(appendPromptUpdater<AnimaGenerationParams>(text, { useGlobal: false, dedupe: false }));
      else params.setDefaultParams(appendPromptUpdater<BaseGenerationParams>(text, { useGlobal: false, dedupe: false }));
      pushToast("info", "提示词已添加", `${text.slice(0, 20)}...`);
      return;
    }
    if (promptTab === "dataset") {
      appendToDataset("positive");
    } else if (promptTab === "sheet") {
      appendToSheet("positive");
    } else if (promptTab === "multi") {
      params.setMultiParams(appendPromptUpdater<MultiGenerationParams>(text, opts));
    } else if (promptTab === "highres") {
      params.setHighresParams(appendPromptUpdater<HighresParams>(text, opts));
    } else if (promptTab === "anima") {
      params.setAnimaParams(appendPromptUpdater<AnimaGenerationParams>(text, opts));
    } else {
      params.setDefaultParams(appendPromptUpdater<BaseGenerationParams>(text, opts));
    }
    pushToast("info", "提示词已添加", `${text.slice(0, 20)}...`);
  }, [tab, params, pushToast]);

  function addTriggerWords(words: string[], target: LoraInsertTarget = loraTarget) {
    if (!words || words.length === 0) return;
    const text = words.join(", ");

    // 三视图页没有 positivePrompt：触发词追加到「角色描述」
    if (target === "sheet") {
      params.setSheetParams((prev) => ({
        ...prev,
        characterPrompt: [prev.characterPrompt.trim(), text].filter(Boolean).join(", "),
      }));
      pushToast("success", "触发词已应用", "已追加到 三视图 角色描述");
      return;
    }

    // 数据集工作台有独立的触发词字段（只影响 caption 与「挂了 LoRA 时的正向提示词」）
    if (target === "dataset") {
      params.setDatasetParams((prev) => ({
        ...prev,
        trigger: [prev.trigger.trim(), text].filter(Boolean).join(", "),
      }));
      pushToast("success", "触发词已应用", "已写入 数据集工作台 的触发词");
      return;
    }

    // 注意：追加键取**当前 tab**（multi→globalPrompt），而落点是 target——与历史行为保持一致
    const updater = appendPromptUpdater<MultiGenerationParams>(text, { useGlobal: tab === "multi", dedupe: false });

    if (target === "multi") {
      params.setMultiParams(updater);
    } else if (target === "highres") {
      params.setHighresParams(appendPromptUpdater<HighresParams>(text, { useGlobal: tab === "multi", dedupe: false }));
    } else if (target === "anima") {
      params.setAnimaParams(appendPromptUpdater<AnimaGenerationParams>(text, { useGlobal: tab === "multi", dedupe: false }));
    } else {
      params.setDefaultParams(appendPromptUpdater<BaseGenerationParams>(text, { useGlobal: tab === "multi", dedupe: false }));
    }
    pushToast("success", "触发词已应用", `已追加到 ${loraInsertTargetLabels[target]} 正向提示词`);
  }

  /** 上传任意图片到 ComfyUI input/（Anima 面板与三个新面板共用同一条通道） */
  const uploadImage = useCallback(async (file: File) => {
    const uploaded = await client.uploadImage(file);
    return uploaded.name;
  }, [client]);

  /**
   * Anima 词库 → Anima 模板正向提示词。
   * 追加走 appendPromptUpdater（按逗号去重），覆盖是整段替换。
   */
  const handleAnimaLibraryApply = useCallback((text: string, mode: AnimaApplyMode) => {
    const clean = text.trim();
    if (!clean) return;
    if (mode === "replace") {
      params.setAnimaParams((prev) => ({ ...prev, positivePrompt: clean }));
    } else {
      params.setAnimaParams(
        appendPromptUpdater<AnimaGenerationParams>(clean, { useGlobal: false, dedupe: true }),
      );
    }
    pushToast(
      "success",
      mode === "replace" ? "已覆盖 Anima 提示词" : "已追加到 Anima 提示词",
      `${clean.length} 字符`,
    );
  }, [params, pushToast]);

  /**
   * Anima 造型台 → Anima 模板正向提示词。
   * 与词库同一条写入路径：追加按逗号去重，覆盖是整段替换。
   */
  const handleWardrobeApply = useCallback((text: string, mode: AnimaApplyMode) => {
    const clean = text.trim();
    if (!clean) return;
    if (mode === "replace") {
      params.setAnimaParams((prev) => ({ ...prev, positivePrompt: clean }));
    } else {
      params.setAnimaParams(
        appendPromptUpdater<AnimaGenerationParams>(clean, { useGlobal: false, dedupe: true }),
      );
    }
    pushToast(
      "success",
      mode === "replace" ? "已覆盖 Anima 提示词" : "已追加到 Anima 提示词",
      `${clean.length} 字符 · 造型台`,
    );
  }, [params, pushToast]);

  // —— 公共工作台（独立页）：词库与造型台的词在这里合流 ——
  const [workbench, setWorkbench] = useWorkbenchComposer();

  /** 造型台结果区「工作台」按钮：内容五区 replace、extra 追加、画师保留，然后跳到工作台页。 */
  const handleSendToWorkbench = useCallback(
    (split: WardrobeWorkbenchSplit) => {
      setWorkbench((prev) => ({ ...prev, values: applyWardrobeSplitToValues(prev.values, split) }));
      setTab("workbench");
      pushToast("success", "已送入公共工作台", "内容分区已更新，画师保留；可继续加画师后写入提示词");
    },
    [setWorkbench, setTab, pushToast],
  );

  /** 词库拼接台「送入工作台」：整份分区追加并入（重复词去重），然后跳到工作台页。 */
  const handleLibraryToWorkbench = useCallback(
    (values: AnimaComposerValues) => {
      setWorkbench((prev) => ({ ...prev, values: mergeComposerSlots(prev.values, values, "append") }));
      setTab("workbench");
      pushToast("success", "已送入公共工作台", "词库拼接台的内容已并入工作台（重复词已去重）");
    },
    [setWorkbench, setTab, pushToast],
  );

  /* ---------------- 数据集工作台 ---------------- */

  const datasetConfig = params.datasetParams;

  /** 数据集提交需要的能力：Anima 节点能力 + 「> Save Text」是否可用（决定能否边出图边写 .txt） */
  const datasetCaps = useMemo<DatasetRunCaps>(
    () => ({ animaCaps: options.animaCaps, saveText: options.datasetCaps?.saveText === true }),
    [options.animaCaps, options.datasetCaps?.saveText],
  );

  const handleDatasetRegenerate = useCallback(() => {
    const apply = () => {
      // 换一批：同时换发牌种子与每张 seed，否则点多少次都是同一份计划、同一组图
      const next = reseedDatasetConfig(datasetConfig);
      const items = buildDatasetPlan(next);
      params.setDatasetParams((prev) => ({ ...prev, planSeed: next.planSeed, seedBase: next.seedBase }));
      replaceDatasetPlan(next, items);
      pushToast("success", "计划已重新生成", `${items.length} 条 · 新种子 ${next.seedBase}`);
    };
    if (datasetItems.some((item) => item.status === "success")) {
      confirmDialog(
        "重新规划会清空本页结果记录",
        "已出的图仍留在 ComfyUI 的 output 目录，但本页的序号 / caption 对应关系会被重置。继续？",
        apply,
      );
      return;
    }
    apply();
  }, [datasetConfig, datasetItems, params, pushToast, replaceDatasetPlan, confirmDialog]);

  const handleDatasetStart = useCallback(
    (mode: DatasetStartMode) => {
      if (gen.progress.running) {
        pushToast("info", "正在生成中", "等当前任务结束再开始数据集队列");
        return;
      }
      // 还没有计划时自动排一份再跑：不让「先点重新规划」变成开跑的前置条件
      if (!datasetItems.length) {
        const items = buildDatasetPlan(datasetConfig);
        replaceDatasetPlan(datasetConfig, items);
        pushToast("info", "已自动生成计划", `${items.length} 条 · 种子 ${datasetConfig.planSeed}`);
        void startDatasetRun(mode, datasetConfig, datasetCaps, undefined, items);
        return;
      }
      void startDatasetRun(mode, datasetConfig, datasetCaps);
    },
    [
      datasetCaps,
      datasetConfig,
      datasetItems.length,
      gen.progress.running,
      pushToast,
      replaceDatasetPlan,
      startDatasetRun,
    ],
  );

  const handleDatasetStop = useCallback(() => stopDatasetRun(), [stopDatasetRun]);

  const handleDatasetRetryFailed = useCallback(() => {
    void retryDatasetFailed(datasetConfig, datasetCaps);
  }, [datasetCaps, datasetConfig, retryDatasetFailed]);

  const handleDatasetRerunOne = useCallback(
    (id: string) => {
      void rerunDatasetOne(id, datasetConfig, datasetCaps);
    },
    [datasetCaps, datasetConfig, rerunDatasetOne],
  );

  const handleDatasetRecover = useCallback(() => {
    void recoverDatasetHistory();
  }, [recoverDatasetHistory]);

  const handleDatasetExportCaptions = useCallback(() => {
    const text = buildCaptionsText(datasetItems);
    if (!text) {
      pushToast("info", "没有可导出的 caption", "先成功生成至少一张");
      return;
    }
    downloadTextFile(`dataset-captions-${Date.now()}.txt`, text, "text/plain");
    pushToast("success", "已导出 caption 清单", "格式：文件路径<TAB>caption，按行拆分即可");
  }, [datasetItems, pushToast]);

  const handleDatasetExportManifest = useCallback(() => {
    const payload = buildManifest(datasetConfig, datasetRunState);
    downloadTextFile(`dataset-manifest-${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json");
    pushToast("success", "已导出 manifest", `${payload.items.length} 条记录`);
  }, [datasetConfig, datasetRunState, pushToast]);

  /**
   * Danbooru 随机图 → Anima 参考图。
   * 只填 imageName 不够：Anima 的图生图惰性条件是 `stages.img2img && imageName`，
   * 必须同时打开阶段开关（与输出图回流的处理一致）。
   */
  const handleAnimaReference = useCallback((imageName: string) => {
    params.setAnimaParams((prev) => ({
      ...prev,
      img2img: { ...prev.img2img, imageName },
      stages: { ...prev.stages, img2img: true },
    }));
    setTab("anima");
  }, [params, setTab]);

  // —— 自动水印烙入工作流（与手写层同款双图上传 + 链尾合成，见 insertWatermarkNode）——
  // auto 开：渲染水印双图（彩图黑底彩字 / mask 白字黑底）上传到 input/，并把烙入配置写进
  // default/multi/highres 的 drawText.watermark（Anima 构建时借用 default 的 drawText，
  // XYZ 的 withBorrowedDrawText 同理）→ ComfyUI 落盘的图片文件本身就带水印。
  // auto 关 / 烙入失败：写 disabled 配置（链尾不插节点），useGeneration 回退前端叠加。
  useEffect(() => {
    const wm = watermarkSettings.params;
    const width = params.defaultParams.width;
    const height = params.defaultParams.height;
    const write = (config: WatermarkBakeConfig) => {
      const patch = <T extends { drawText?: DrawTextParams }>(prev: T): T =>
        prev.drawText ? { ...prev, drawText: { ...prev.drawText, watermark: config } } : prev;
      params.setDefaultParams(patch);
      params.setMultiParams(patch);
      params.setHighresParams(patch);
    };
    if (!watermarkSettings.auto || !wm.text.trim()) {
      watermarkSettings.setBaked(false);
      write({ ...wm, enabled: false, imageName: "", maskName: "" });
      return;
    }
    // 防抖：弹窗里拖滑块会连续触发，等参数稳定再上传
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { colorBlob, maskBlob } = await renderWatermarkLayers(width, height, wm);
          const imageName = await uploadImage(new File([colorBlob], "xyz_watermark.png", { type: "image/png" }));
          const maskName = await uploadImage(new File([maskBlob], "xyz_watermark_mask.png", { type: "image/png" }));
          write({ ...wm, enabled: true, imageName, maskName, renderWidth: width, renderHeight: height });
          watermarkSettings.setBaked(true);
        } catch {
          watermarkSettings.setBaked(false);
          write({ ...wm, enabled: false, imageName: "", maskName: "" });
          pushToast("error", "自动水印烙入失败", "回退为仅前端叠加；请检查 ComfyUI 连接后重新调整水印参数");
        }
      })();
    }, 600);
    return () => clearTimeout(timer);
    // uploadImage/pushToast 为稳定引用；write 只改 drawText 不动尺寸，不会自触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watermarkSettings.auto, watermarkSettings.params, watermarkSettings.setBaked, params.defaultParams.width, params.defaultParams.height, connection.status]);

  /**
   * 把一张输出图复制进 input/ 后返回文件名。
   * 输出图存放在 ComfyUI 的 output/，而 LoadImage 只读 input/，故必须重新上传一份。
   */
  const promoteOutputToInput = useCallback(async (image: OutputImage) => {
    // 自动水印开启时 url 是水印版，回流用原图（originalUrl ?? url）
    const response = await fetch(image.originalUrl ?? image.url);
    if (!response.ok) throw new Error(`读取图像失败：${response.status}`);
    const blob = await response.blob();
    const file = new File([blob], image.filename, { type: blob.type || "image/png" });
    return uploadImage(file);
  }, [uploadImage]);

  const [queueOpen, setQueueOpen] = useState(false);

  /**
   * 输出图回流：把输出面板里的图变成某个面板的参考图。
   * 两个「只说一半就会静默失效」的点必须一并处理：
   * - Anima：惰性条件是 `stages.img2img && imageName`，只填图不开阶段开关不生效；
   * - 图片识别：runWd14 里 `wdFile` 优先于 `imageName`，不清掉本地文件会被顶替。
   */
  const handleSendImageTo = useCallback(async (image: OutputImage, target: TemplateKind | "wd14" | "sheet") => {
    try {
      const imageName = await promoteOutputToInput(image);
      if (target === "wd14") {
        tagging.setWdFile(null);
        tagging.setWd14((prev) => ({ ...prev, imageName }));
        setTab("wd14");
      } else if (target === "sheet") {
        // 三视图页的参考图是跨模型族共享的一份，开启后由 builder 映射到各自字段
        params.setSheetParams((prev) => ({ ...prev, reference: { enabled: true, imageName } }));
        setTab("sheet");
      } else if (target === "anima") {
        params.setAnimaParams((prev) => ({
          ...prev,
          img2img: { ...prev.img2img, imageName },
          stages: { ...prev.stages, img2img: true },
        }));
        setTab("anima");
      } else if (target === "multi") {
        // 三个新模板：开启图生图开关并填入参考图（开关关闭时即使有图也不会走图生图）
        params.setMultiParams(img2imgUpdater<MultiGenerationParams>({ enabled: true, imageName }));
        setTab("multi");
      } else if (target === "highres") {
        params.setHighresParams(img2imgUpdater<HighresParams>({ enabled: true, imageName }));
        setTab("highres");
      } else {
        params.setDefaultParams(img2imgUpdater<BaseGenerationParams>({ enabled: true, imageName }));
        setTab("default");
      }
      pushToast(
        "success",
        "已作为输入图",
        `${image.filename} → ${target === "wd14" ? "图片识别" : target === "sheet" ? "三视图" : templateLabels[target]}`,
      );
    } catch (error) {
      pushToast("error", "作为输入图失败", error instanceof Error ? error.message : String(error));
    }
  }, [promoteOutputToInput, tagging, params, setTab, pushToast]);

  const currentPrompts = useMemo(() => {
    if (tab === "multi") return { positive: params.multiParams.globalPrompt, negative: params.multiParams.negativePrompt };
    if (tab === "highres") return { positive: params.highresParams.positivePrompt, negative: params.highresParams.negativePrompt };
    if (tab === "anima" || tab === "anima-library" || tab === "wardrobe" || tab === "workbench") return { positive: params.animaParams.positivePrompt, negative: params.animaParams.negativePrompt };
    if (tab === "sheet") {
      return {
        positive: composeSheetPromptFromParams(params.sheetParams),
        negative: params.sheetParams[params.sheetParams.mode].negativePrompt,
      };
    }
    if (tab === "dataset") {
      // 数据集没有「当前一条」：正向框回显角色固定词，负向取当前模型族
      return {
        positive: params.datasetParams.characterPrompt,
        negative: params.datasetParams[params.datasetParams.mode].negativePrompt,
      };
    }
    return { positive: params.defaultParams.positivePrompt, negative: params.defaultParams.negativePrompt };
  }, [tab, params.defaultParams, params.multiParams, params.highresParams, params.animaParams, params.sheetParams, params.datasetParams]);

  // 侧边栏分组定义来自 constants 的 navGroups（历史上此处另有一份硬编码，导致新增入口时漏改；
  // 数字键 1–9 仍按 generationTabConfig + slotsTab + toolTabConfig 的旧顺序，见下方 digitTabs）

  /** 三视图生成：面板按钮与 Ctrl+Enter 共用同一份参数/LoRA 解析结果 */
  const buildCurrentSheetPrompt = useCallback(() => {
    const sheet = params.sheetParams;
    return buildSheetPrompt(sheet, {
      loraRef: sheetLora.resolved[sheet.mode].ref,
      drawText: params.defaultParams.drawText,
      animaCaps: options.animaCaps,
    });
  }, [params.sheetParams, params.defaultParams.drawText, sheetLora.resolved, options.animaCaps]);

  /** 当前 tab 的「生成」动作（Ctrl+Enter 触发；与面板按钮完全同源） */
  const runCurrentTab = useCallback(() => {
    // 数据集页刻意不接 Ctrl+Enter：一次要提交 100 张，误触代价太大（用工具栏按钮显式启动）
    if (tab === "dataset") return undefined;
    if (tab === "default") return runPrompt("默认生图", () => buildDefaultPrompt(params.defaultParams));
    if (tab === "multi") return runPrompt("多人工作流", () => buildMultiPrompt(params.multiParams));
    if (tab === "highres") return runPrompt("高清修复", () => buildHighresPrompt(params.highresParams));
    if (tab === "anima")
      return runPrompt("Anima 生图", () =>
        buildAnimaPrompt(
          { ...params.animaParams, drawText: params.defaultParams.drawText },
          options.animaCaps,
        ),
      );
    if (tab === "sheet") return runPrompt("三视图", buildCurrentSheetPrompt);
    return undefined;
  }, [tab, runPrompt, params, options.animaCaps, buildCurrentSheetPrompt]);

  /** 打开外置图片管理服务：可选带上数据集落点（filenameRoot），在系统浏览器里打开 */
  const openImageManager = useCallback(
    async (dir?: string) => {
      try {
        await openImageManagerService(dir);
      } catch (error) {
        pushToast("error", "打开图片管理失败", error instanceof Error ? error.message : String(error));
      }
    },
    [pushToast],
  );

  /* ---------------- 面板/顶栏回调：稳定引用，避免 progress tick 击穿 React.memo ---------------- */

  const runDefaultGeneration = useCallback(
    () => runPrompt("默认生图", () => buildDefaultPrompt(params.defaultParams)),
    [runPrompt, params.defaultParams],
  );
  const runMultiGeneration = useCallback(
    () => runPrompt("多人工作流", () => buildMultiPrompt(params.multiParams)),
    [runPrompt, params.multiParams],
  );
  const runHighresGeneration = useCallback(
    () => runPrompt("高清修复", () => buildHighresPrompt(params.highresParams)),
    [runPrompt, params.highresParams],
  );
  const runAnimaGeneration = useCallback(
    () =>
      runPrompt("Anima 生图", () =>
        buildAnimaPrompt(
          { ...params.animaParams, drawText: params.defaultParams.drawText },
          options.animaCaps,
        ),
      ),
    [runPrompt, params.animaParams, params.defaultParams.drawText, options.animaCaps],
  );
  const runSheetGeneration = useCallback(
    () => runPrompt("三视图", buildCurrentSheetPrompt),
    [runPrompt, buildCurrentSheetPrompt],
  );
  const sendDefaultToHighres = useCallback(() => {
    params.setHighresParams((prev) => ({
      ...prev,
      positivePrompt: params.defaultParams.positivePrompt,
      negativePrompt: params.defaultParams.negativePrompt,
      loras: [...params.defaultParams.loras],
    }));
    setTab("highres");
  }, [params, setTab]);

  const openOutputLightbox = useCallback(
    (url: string, originalUrl?: string) => setOutputLightbox({ url, originalUrl }),
    [setOutputLightbox],
  );
  const openImageCompare = useCallback(
    (urls: [string, string]) => setCompareLightbox(urls),
    [setCompareLightbox],
  );
  const resolveOutputUrl = useCallback(
    (file: { filename: string; subfolder?: string; type?: string }) => client.viewUrl(file),
    [client],
  );
  const openAnimaTab = useCallback(() => setTab("anima"), [setTab]);
  const openAnimaLibrary = useCallback(() => setTab("anima-library"), [setTab]);
  const openWardrobe = useCallback(() => setTab("wardrobe"), [setTab]);

  const toggleSidebar = useCallback(
    () => setIsAppSidebarCollapsed((collapsed) => !collapsed),
    [setIsAppSidebarCollapsed],
  );
  const openPromptEditor = useCallback(() => setShowPromptEditor(true), [setShowPromptEditor]);
  const togglePromptSidebar = useCallback(
    () => setShowPromptSidebar((open) => !open),
    [setShowPromptSidebar],
  );
  const closePromptSidebar = useCallback(
    () => setShowPromptSidebar(false),
    [setShowPromptSidebar],
  );
  const openTranslation = useCallback(() => setShowTranslation(true), [setShowTranslation]);
  const openLauncher = useCallback(() => setShowLauncher(true), [setShowLauncher]);
  const openQueue = useCallback(() => setQueueOpen(true), []);
  const openLoraNotifications = useCallback(
    () => setLoraOperation({ type: "notifications" }),
    [setLoraOperation],
  );
  const openLoraSettings = useCallback(
    () => setLoraOperation({ type: "settings" }),
    [setLoraOperation],
  );
  const interruptGeneration = useCallback(
    () => client.interrupt(gen.progress.promptId),
    [client, gen.progress.promptId],
  );
  const clearNotesContent = useCallback(
    () =>
      confirmDialog("清空内容", "确定要清空当前笔记的所有内容吗？此操作无法撤销。", () =>
        updateActiveNote({ content: "" }),
      ),
    [confirmDialog, updateActiveNote],
  );

  // 文字生图页与 WD/CL 反推：同样稳定化，避免面板 memo 失效
  const runTextMulti = useCallback(
    () =>
      runPrompt("多人", () =>
        buildMultiPrompt({ ...params.multiParams, drawText: params.defaultParams.drawText }),
      ),
    [runPrompt, params.multiParams, params.defaultParams.drawText],
  );
  const runTextHighres = useCallback(
    () =>
      runPrompt("高清修复", () =>
        buildHighresPrompt({ ...params.highresParams, drawText: params.defaultParams.drawText }),
      ),
    [runPrompt, params.highresParams, params.defaultParams.drawText],
  );
  const runWd14Generation = useCallback(() => {
    setWdTags("");
    return runWd14(wd14, wdFile).then((res) => setWdTags(res.texts.join("\n")));
  }, [runWd14, setWdTags, wd14, wdFile]);
  const runClSingleGeneration = useCallback(() => {
    setWdTags("");
    return runClSingle(clSingleParams, clFile).then((res) => setWdTags(res.texts.join("\n")));
  }, [runClSingle, setWdTags, clSingleParams, clFile]);
  const runBatchTaggerGeneration = useCallback(
    (type: "cl" | "wd") => {
      void runBatchTagger(type, clBatchParams, wdBatchParams);
    },
    [runBatchTagger, clBatchParams, wdBatchParams],
  );

  const workspaceHandlers = useMemo<WorkspaceHandlers>(
    () => ({
      runDefault: runDefaultGeneration,
      runMulti: runMultiGeneration,
      runHighres: runHighresGeneration,
      runAnima: runAnimaGeneration,
      runSheet: runSheetGeneration,
      runTextMulti,
      runTextHighres,
      runWd14: runWd14Generation,
      runClSingle: runClSingleGeneration,
      runBatchTagger: runBatchTaggerGeneration,
      sendDefaultToHighres,
      openLoraDetail: handleOpenLoraDetail,
      addCharacter,
      uploadImage,
      applyTags: handleApplyTags,
      openAnimaLibrary,
      openWardrobe,
      openAnimaTab,
      openOutputLightbox,
      resolveOutputUrl,
      openImageManager,
      clearNotes: clearNotesContent,
      slotsApply: handleSlotsApply,
      animaLibraryApply: handleAnimaLibraryApply,
      animaReference: handleAnimaReference,
      wardrobeApply: handleWardrobeApply,
      sendToWorkbench: handleSendToWorkbench,
      libraryToWorkbench: handleLibraryToWorkbench,
      loraInsert: handleLoraInsert,
      datasetStart: handleDatasetStart,
      datasetStop: handleDatasetStop,
      datasetRetryFailed: handleDatasetRetryFailed,
      datasetRerunOne: handleDatasetRerunOne,
      datasetRegenerate: handleDatasetRegenerate,
      datasetRecover: handleDatasetRecover,
      datasetExportCaptions: handleDatasetExportCaptions,
      datasetExportManifest: handleDatasetExportManifest,
    }),
    [
      runDefaultGeneration,
      runMultiGeneration,
      runHighresGeneration,
      runAnimaGeneration,
      runSheetGeneration,
      runTextMulti,
      runTextHighres,
      runWd14Generation,
      runClSingleGeneration,
      runBatchTaggerGeneration,
      sendDefaultToHighres,
      handleOpenLoraDetail,
      uploadImage,
      handleApplyTags,
      openAnimaLibrary,
      openWardrobe,
      openAnimaTab,
      openOutputLightbox,
      resolveOutputUrl,
      openImageManager,
      clearNotesContent,
      handleSlotsApply,
      handleAnimaLibraryApply,
      handleAnimaReference,
      handleWardrobeApply,
      handleSendToWorkbench,
      handleLibraryToWorkbench,
      handleLoraInsert,
      handleDatasetStart,
      handleDatasetStop,
      handleDatasetRetryFailed,
      handleDatasetRerunOne,
      handleDatasetRegenerate,
      handleDatasetRecover,
      handleDatasetExportCaptions,
      handleDatasetExportManifest,
    ],
  );

  // 全局快捷键（T10-②）：Ctrl+Enter 生成 · Ctrl+S 存预设 · 数字键切 tab
  useEffect(() => {
    const digitTabs = [...generationTabConfig, slotsTab, ...toolTabConfig];
    const isTypingTarget = (element: EventTarget | null) =>
      element instanceof HTMLElement &&
      (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;

      // 数字键切 tab（1..n 与侧边栏顺序一致）；输入框内不抢
      if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && !isTypingTarget(event.target)) {
        const index = Number(event.key) - 1;
        if (Number.isInteger(index) && index >= 0 && index < digitTabs.length) {
          setTab(digitTabs[index].id);
          return;
        }
      }

      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "enter" && !event.shiftKey) {
        const task = runCurrentTab();
        if (task) {
          event.preventDefault();
          void task.catch(() => undefined);
        }
        return;
      }
      if (key === "s" && ["default", "multi", "highres", "anima"].includes(tab)) {
        // PresetBar 监听该事件打开保存弹窗（避免为快捷键新增全局状态）
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("dsh:save-preset"));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tab, setTab, runCurrentTab]);

  return (
    <>
      <div className="app-shell">
      <AppSidebar
        isCollapsed={ui.isAppSidebarCollapsed}
        onToggle={toggleSidebar}
        activeTab={tab}
        onTabChange={setTab}
        onOpenThemePanel={openThemePanel}
      />
      
      <div className="app-main">
        <AppTopbar
          client={client}
          connection={connection}
          progress={gen.progress}
          promptSidebarOpen={ui.showPromptSidebar}
          onOpenPromptEditor={openPromptEditor}
          onTogglePromptSidebar={togglePromptSidebar}
          onOpenTranslation={openTranslation}
          onOpenLauncher={openLauncher}
          onOpenQueue={openQueue}
          onOpenNotifications={openLoraNotifications}
          onOpenSettings={openLoraSettings}
          onInterrupt={interruptGeneration}
        />

        <div className="layout-with-sidebar">
          {/* `lora-full` 是历史命名的「全宽无输出栏」布局，词库页同样需要 */}
          <div className={["layout", gen.results.length > 0 ? "has-output" : "no-output", tab === "loras" || tab === "anima-library" || tab === "wardrobe" || tab === "workbench" || tab === "dataset" ? "lora-full" : ""].filter(Boolean).join(" ")}>
            <main className="workspace">
              <Suspense fallback={<PanelFallback />}>
                <WorkspacePanels
                  tab={tab}
                  params={params}
                  options={options}
                  apiBase={apiBase}
                  loraSettings={loraSettings}
                  loras={loras}
                  loraNames={loraNames}
                  wildcardNames={wildcardNames}
                  sheetLora={sheetLora}
                  tagging={tagging}
                  mobile={mobile}
                  notes={notesHook}
                  workbench={workbench}
                  setWorkbench={setWorkbench}
                  datasetConfig={datasetConfig}
                  datasetItems={datasetItems}
                  datasetRunState={datasetRunState}
                  datasetRunning={datasetRunning}
                  datasetCurrent={datasetCurrent}
                  pushToast={pushToast}
                  confirm={ui.confirm}
                  handlers={workspaceHandlers}
                />

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
                    animaCaps={options.animaCaps}
                    options={options}
                    loraNames={loraNames}
                    onOutputLightbox={openOutputLightbox}
                    onApplyCombo={handleXyzApplyCombo}
                  />
                )}
              </Suspense>
            </main>

            {tab !== "loras" && tab !== "anima-library" && tab !== "wardrobe" && tab !== "workbench" && tab !== "dataset" && !(tab === "notes" && notesHook.isNotesWide) && (
              <OutputPanel
                results={gen.results}
                previewUrl={gen.progress.previewUrl}
                running={gen.progress.running}
                watermarkAuto={watermarkSettings.auto}
                onWatermarkAutoChange={watermarkSettings.setAuto}
                onOpenLightbox={openOutputLightbox}
                onOpenCompare={openImageCompare}
                onSendImageTo={handleSendImageTo}
              />
            )}
          </div>

          <PromptSidebar 
            isOpen={ui.showPromptSidebar} 
            onClose={closePromptSidebar} 
            onSelect={(text, type) => handleSidebarSelect(text, type === 'positive' ? 'positive' : 'negative')} 
            currentPositive={currentPrompts.positive}
            currentNegative={currentPrompts.negative}
          />
        </div>
      </div>
    </div>

      {/* T11：任务队列面板（查看运行中 / 等待中，单独移除或清空） */}
      {queueOpen && (
        <QueuePanel
          client={client}
          runningPromptId={gen.progress.promptId}
          onClose={() => setQueueOpen(false)}
          onToast={pushToast}
        />
      )}

      <AppModals
        loras={loras}
        ui={ui}
        client={client}
        watermark={watermarkSettings}
        translationSettings={options.translation}
        onTranslationSettingsSaved={(ts) => setOptions((prev) => ({ ...prev, translation: ts }))}
        apiBase={apiBase}
        setApiBase={setApiBase}
        pushToast={pushToast}
        toasts={toasts}
        notificationLog={notificationLog}
        tab={tab}
        params={params}
        onLoraInsert={handleLoraInsert}
        onAddTriggerWords={addTriggerWords}
      />

      <ToastViewport toasts={toasts} onClose={removeToast} />
      
      {connection.status !== "online" && connection.status !== "checking" && (
        <ConnectionOverlay
          apiBase={apiBase}
          message={connection.message}
          onReload={() => window.location.reload()}
          onOpenLauncher={openLauncher}
          onOpenSettings={openLoraSettings}
        />
      )}
    </>
  );
}

export default App;
