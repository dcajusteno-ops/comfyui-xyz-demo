import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  CheckCircle2,
  Columns,
  GalleryHorizontalEnd,
  Languages,
  ListFilter,
  ListOrdered,
  Loader2,
  PauseCircle,
  RefreshCw,
  Settings,
  Sparkles,
  Wrench,
} from "lucide-react";

import { AppSidebar } from "./components/layout/AppSidebar";
import { GlobalModals } from "./components/GlobalModals";
import { PromptSidebar } from "./components/PromptSidebar";
import { QueuePanel } from "./components/QueuePanel";
import { ToastViewport, RunProgressStrip, VramBadge } from "./components/ui";

// 首屏必需，随主包同步加载；**必须从具体文件引**，走 `features/Generation` 的
// barrel 会把下面所有懒加载面板的依赖（MultiWorkspace / DrawTextControls 等）
// 一并拉进主 chunk，分包就白做了。
import { DefaultGenerationPanel } from "./components/features/Generation/DefaultGenerationPanel";

/**
 * 非首屏面板一律动态加载。
 * 这些面板的 barrel（`features/Xxx/index.ts`）没有 default 导出，故统一走
 * `.then(m => ({ default: m.Xxx }))`——这样 props 类型仍由真实组件推导，无需 `any`。
 */
const MultiGenerationPanel = lazy(() =>
  import("./components/features/Generation/MultiGenerationPanel").then((m) => ({ default: m.MultiGenerationPanel })),
);
const HighresGenerationPanel = lazy(() =>
  import("./components/features/Generation/HighresGenerationPanel").then((m) => ({ default: m.HighresGenerationPanel })),
);
const AnimaGenerationPanel = lazy(() =>
  import("./components/features/Generation/AnimaGenerationPanel").then((m) => ({ default: m.AnimaGenerationPanel })),
);
const TextGenerationPanel = lazy(() =>
  import("./components/features/Generation/TextGenerationPanel").then((m) => ({ default: m.TextGenerationPanel })),
);
const TaggingPanel = lazy(() =>
  import("./components/features/Tagging/TaggingPanel").then((m) => ({ default: m.TaggingPanel })),
);
const NotesManagerPanel = lazy(() =>
  import("./components/features/Notes/NotesManagerPanel").then((m) => ({ default: m.NotesManagerPanel })),
);
const XyzController = lazy(() =>
  import("./components/features/Xyz").then((m) => ({ default: m.XyzController })),
);
const LoraManagerPanel = lazy(() =>
  import("./components/features/Lora").then((m) => ({ default: m.LoraManagerPanel })),
);
const SlotMachinePanel = lazy(() =>
  import("./components/features/Slots").then((m) => ({ default: m.SlotMachinePanel })),
);

/** 懒加载占位：复用现有 `.panel` + `.empty-state`，`styles.css` 零新增 */
const PanelFallback = () => (
  <div className="panel">
    <div className="empty-state">加载中…</div>
  </div>
);

/**
 * 输出面板的一行标题摘要。
 * 以前只显示 `promptId.slice(0,8)`，出几张图后就分不清哪张是哪张了。
 * 元信息来自 useGeneration 在提交时从**实际工作流**里读出的参数；缺失时逐级降级。
 */
function jobTitle(result: JobResult) {
  const meta = result.meta;
  if (!meta) return result.promptId.slice(0, 8);
  const parts: string[] = [meta.label];
  if (meta.width && meta.height) parts.push(`${meta.width}×${meta.height}`);
  if (meta.steps !== undefined) parts.push(`${meta.steps} 步`);
  if (meta.seed !== undefined) parts.push(`seed ${meta.seed}`);
  return parts.join(" · ");
}

/**
 * 「追加词条到目标模板正向提示词」的 updater。
 * multi 用 globalPrompt，其余模板用 positivePrompt；dedupe=true 时按逗号切分去重
 * （灵感老虎机 / 手机标签），false 时原样追加（触发词 / 提示词仓库）。
 */
function appendPromptUpdater<T extends BaseGenerationParams | MultiGenerationParams>(
  text: string,
  options: { useGlobal: boolean; dedupe: boolean },
) {
  return (prev: T): T => {
    const key = options.useGlobal ? "globalPrompt" : "positivePrompt";
    const current = String((prev as unknown as Record<string, unknown>)[key] ?? "").trim();
    let addition = text;
    if (options.dedupe) {
      const existing = new Set(current.split(/[,，]/).map((part) => part.trim().toLowerCase()));
      const toAdd = text
        .split(/[,，]/)
        .map((part) => part.trim())
        .filter((part) => part && !existing.has(part.toLowerCase()));
      if (toAdd.length === 0) return prev;
      addition = toAdd.join(", ");
    }
    return { ...prev, [key]: current ? `${current}, ${addition}` : addition } as T;
  };
}

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
import { useMobileTasks } from "./hooks/useMobileTasks";
import { useNotifier } from "./hooks/useNotifier";

import { loraSyntaxName, mergeLora } from "./lib/lora-helper";
import { pickCardPreviewMedia } from "./lib/lora-media";
import { addCharacter } from "./lib/multiCharacters";
import {
  buildDefaultPrompt,
  buildHighresPrompt,
  buildMultiPrompt,
  buildAnimaPrompt,
} from "./lib/workflowBuilders";
import {
  generationTabs as generationTabConfig,
  slotsTab,
  toolTabs as toolTabConfig,
  templateLabels,
} from "./constants";
import type { LoraSelection, TemplateKind, LoraItem, TabId, MobileTask, MobileTaskStatus, OutputImage, JobResult, XyzCombination, AnimaGenerationParams, BaseGenerationParams, MultiGenerationParams, HighresParams } from "./types";
import { applySpecialXyzPatch } from "./lib/xyz";
import { img2imgUpdater } from "./lib/paramBuilders";
import { loadWildcards } from "./lib/wildcards";
import { WILDCARD_FILES } from "./lib/wildcards";

function App() {
  const { apiBase, setApiBase, client, connection, tab, setTab } = useAppContext();

  // ===== Hooks =====
  const { toasts, notificationLog, pushToast, removeToast } = useToast();
  const ui = useUiState();
  const tagging = useTagging();
  const xyz = useXyz();
  const notesHook = useNotes({ tab, pushToast, confirm: ui.confirm });
  const notifier = useNotifier();

  const gen = useGeneration({ client, pushToast, notifyComplete: notifier.notifyComplete });
  const params = useParams();

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
    tagging.setWdTags(task.tags);
    pushToast("success", "手机识别完成", `${task.imageName} — tags 已同步到「图片识别」输出框`);
    notifier.notifyComplete("手机识别完成", `${task.imageName} — tags 已同步`);
  }, [pushToast, tagging, notifier.notifyComplete]);

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
  }, [mobile.loading, mobile.tasks, handleMobileDone]);

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
    return Array.from(hashes);
  }, [params.defaultParams.loras, params.multiParams.loras, params.highresParams.loras, params.animaParams.loras]);

  const loras = useLoras({
    client,
    pushToast,
    activeLoraHashes: allActiveHashes,
    loraSettings,
    setLoraSettings,
    tab: tab as TabId,
  });

  const loraNames = useMemo(
    () =>
      loras.loraResult.items
        .map((item) => item.file_name || (item.file_path ? item.file_path.split(/[\\/]/).pop() ?? "" : ""))
        .filter(Boolean),
    [loras.loraResult.items],
  );
  const wildcardNames = useMemo(() => [...WILDCARD_FILES] as string[], []);

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
    } else if (target === "anima") {
      params.setAnimaParams((prev) => ({ ...prev, loras: mergeLora(prev.loras, selection) }));
    } else {
      params.setDefaultParams((prev) => ({ ...prev, loras: mergeLora(prev.loras, selection) }));
    }
    pushToast("success", "LoRA 已插入", `${selection.displayName} -> ${templateLabels[target]}`);
  }, [loras.loraExampleFilesByHash, params.setDefaultParams, params.setMultiParams, params.setHighresParams, params.setAnimaParams, pushToast]);

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
    pushToast("success", "灵感已应用", `已追加 ${clean.length} 个词条到 ${templateLabels[target]} 正向提示词`);
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
    const opts = { useGlobal: tab === "multi", dedupe: false };
    // negative 侧始终写 negativePrompt（multi 也没有单独的负向 globalPrompt），按 tab 落到对应面板
    if (target === "negative") {
      if (tab === "multi") params.setMultiParams(appendPromptUpdater<MultiGenerationParams>(text, { useGlobal: false, dedupe: false }));
      else if (tab === "highres") params.setHighresParams(appendPromptUpdater<HighresParams>(text, { useGlobal: false, dedupe: false }));
      else if (tab === "anima") params.setAnimaParams(appendPromptUpdater<AnimaGenerationParams>(text, { useGlobal: false, dedupe: false }));
      else params.setDefaultParams(appendPromptUpdater<BaseGenerationParams>(text, { useGlobal: false, dedupe: false }));
      pushToast("info", "提示词已添加", `${text.slice(0, 20)}...`);
      return;
    }
    if (tab === "multi") {
      params.setMultiParams(appendPromptUpdater<MultiGenerationParams>(text, opts));
    } else if (tab === "highres") {
      params.setHighresParams(appendPromptUpdater<HighresParams>(text, opts));
    } else if (tab === "anima") {
      params.setAnimaParams(appendPromptUpdater<AnimaGenerationParams>(text, opts));
    } else {
      params.setDefaultParams(appendPromptUpdater<BaseGenerationParams>(text, opts));
    }
    pushToast("info", "提示词已添加", `${text.slice(0, 20)}...`);
  }, [tab, params, pushToast]);

  function addTriggerWords(words: string[], target = loras.loraTarget) {
    if (!words || words.length === 0) return;
    const text = words.join(", ");
    // 注意：追加键取**当前 tab**（multi→globalPrompt），而落点是 loraTarget——与历史行为保持一致
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
    pushToast("success", "触发词已应用", `已追加到 ${templateLabels[target]} 正向提示词`);
  }

  /** 上传任意图片到 ComfyUI input/（Anima 面板与三个新面板共用同一条通道） */
  const uploadImage = useCallback(async (file: File) => {
    const uploaded = await client.uploadImage(file);
    return uploaded.name;
  }, [client]);

  /**
   * 把一张输出图复制进 input/ 后返回文件名。
   * 输出图存放在 ComfyUI 的 output/，而 LoadImage 只读 input/，故必须重新上传一份。
   */
  const promoteOutputToInput = useCallback(async (image: OutputImage) => {
    const response = await fetch(image.url);
    if (!response.ok) throw new Error(`读取图像失败：${response.status}`);
    const blob = await response.blob();
    const file = new File([blob], image.filename, { type: blob.type || "image/png" });
    return uploadImage(file);
  }, [uploadImage]);

  const [uploadingImageKey, setUploadingImageKey] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);

  /**
   * 输出图回流：把输出面板里的图变成某个面板的参考图。
   * 两个「只说一半就会静默失效」的点必须一并处理：
   * - Anima：惰性条件是 `stages.img2img && imageName`，只填图不开阶段开关不生效；
   * - 图片识别：runWd14 里 `wdFile` 优先于 `imageName`，不清掉本地文件会被顶替。
   */
  const handleSendImageTo = useCallback(async (image: OutputImage, target: TemplateKind | "wd14") => {
    try {
      const imageName = await promoteOutputToInput(image);
      if (target === "wd14") {
        tagging.setWdFile(null);
        tagging.setWd14((prev) => ({ ...prev, imageName }));
        setTab("wd14");
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
        `${image.filename} → ${target === "wd14" ? "图片识别" : templateLabels[target]}`,
      );
    } catch (error) {
      pushToast("error", "作为输入图失败", error instanceof Error ? error.message : String(error));
    }
  }, [promoteOutputToInput, tagging, params, setTab, pushToast]);

  const currentPrompts = useMemo(() => {
    if (tab === "multi") return { positive: params.multiParams.globalPrompt, negative: params.multiParams.negativePrompt };
    if (tab === "highres") return { positive: params.highresParams.positivePrompt, negative: params.highresParams.negativePrompt };
    if (tab === "anima") return { positive: params.animaParams.positivePrompt, negative: params.animaParams.negativePrompt };
    return { positive: params.defaultParams.positivePrompt, negative: params.defaultParams.negativePrompt };
  }, [tab, params.defaultParams, params.multiParams, params.highresParams, params.animaParams]);

  // 侧边栏 tab 定义统一来自 constants（历史上此处另有一份硬编码，导致新增入口时漏改）
  const generationTabs = useMemo(() => [...generationTabConfig, slotsTab], []);
  const toolTabs = useMemo(() => toolTabConfig, []);

  /** 当前 tab 的「生成」动作（Ctrl+Enter 触发；与面板按钮完全同源） */
  const runCurrentTab = useCallback(() => {
    if (tab === "default") return gen.runPrompt("默认生图", () => buildDefaultPrompt(params.defaultParams));
    if (tab === "multi") return gen.runPrompt("多人工作流", () => buildMultiPrompt(params.multiParams));
    if (tab === "highres") return gen.runPrompt("高清修复", () => buildHighresPrompt(params.highresParams));
    if (tab === "anima")
      return gen.runPrompt("Anima 生图", () =>
        buildAnimaPrompt(
          { ...params.animaParams, drawText: params.defaultParams.drawText },
          options.animaCaps,
        ),
      );
    return undefined;
  }, [tab, gen, params, options.animaCaps]);

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
        onToggle={() => ui.setIsAppSidebarCollapsed(!ui.isAppSidebarCollapsed)}
        activeTab={tab}
        onTabChange={setTab}
        generationTabs={generationTabs}
        toolTabs={toolTabs}
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
            {/* T10-③：显存占用指示（/system_stats 轮询，空闲过低时预警） */}
            <VramBadge client={client} />
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
              {/* 外部工具启动器：不经过 ComfyUI，离线可用 */}
              <button type="button" className="icon-button" onClick={() => ui.setShowLauncher(true)} title="外部工具（一键启动本地程序/脚本）">
                <Wrench size={18} />
              </button>
            </div>
            
            <div className="action-divider" />
            
            <div className="action-group">
              <button type="button" className="icon-button" onClick={() => setQueueOpen(true)} title="任务队列（查看 / 移除 / 清空）">
                <ListOrdered size={18} />
                <span>队列</span>
              </button>
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
              <Suspense fallback={<PanelFallback />}>
              {tab === "default" && (
                <DefaultGenerationPanel
                  params={params.defaultParams}
                  setParams={params.setDefaultParams}
                  options={options}
                  apiBase={apiBase}
                  loraSettings={loraSettings}
                  loraExampleFilesByHash={loras.loraExampleFilesByHash}
                  loraNames={loraNames}
                  wildcardNames={wildcardNames}
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
                  onUploadImage={uploadImage}
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
                  loraNames={loraNames}
                  wildcardNames={wildcardNames}
                  onRunGeneration={() => gen.runPrompt("多人工作流", () => buildMultiPrompt(params.multiParams))}
                  onOpenLoraDetail={handleOpenLoraDetail}
                  onSetSimpleLoraTarget={loras.setSimpleLoraTarget}
                  onAddCharacter={addCharacter}
                  onUploadImage={uploadImage}
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
                  loraNames={loraNames}
                  wildcardNames={wildcardNames}
                  onRunGeneration={() => gen.runPrompt("高清修复", () => buildHighresPrompt(params.highresParams))}
                  onOpenLoraDetail={handleOpenLoraDetail}
                  onSetSimpleLoraTarget={loras.setSimpleLoraTarget}
                  onUploadImage={uploadImage}
                />
              )}

              {tab === "anima" && (
                <AnimaGenerationPanel
                  params={params.animaParams}
                  setParams={params.setAnimaParams}
                  options={options}
                  apiBase={apiBase}
                  loraSettings={loraSettings}
                  loraExampleFilesByHash={loras.loraExampleFilesByHash}
                  loraNames={loraNames}
                  wildcardNames={wildcardNames}
                  onRunGeneration={() =>
                    gen.runPrompt("Anima 生图", () =>
                      // 与多人/高修一致：水印在「文字特效 & 水印」页配置，生成时借用到这里
                      buildAnimaPrompt(
                        { ...params.animaParams, drawText: params.defaultParams.drawText },
                        options.animaCaps,
                      ),
                    )
                  }
                  onOpenLoraDetail={handleOpenLoraDetail}
                  onSetSimpleLoraTarget={loras.setSimpleLoraTarget}
                  onUploadImage={uploadImage}
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
                  onApplyTags={handleApplyTags}
                  mobileTasks={mobile.tasks}
                  onRemoveMobileTask={mobile.remove}
                  onClearMobileTasks={mobile.clear}
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
                  animaCaps={options.animaCaps}
                  options={options}
                  loraNames={loraNames}
                  onOutputLightbox={ui.setOutputLightbox}
                  onApplyCombo={handleXyzApplyCombo}
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
              </Suspense>
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
                        <span
                          title={result.promptId + (result.meta ? ` | ${jobTitle(result)}` : "")}
                          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
                        >
                          {jobTitle(result)}
                        </span>
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
                            {(() => {
                              const key = `${result.promptId}-${image.filename}`;
                              const busy = uploadingImageKey === key;
                              return (
                                <select
                                  value=""
                                  disabled={busy}
                                  title="把这张图作为其它面板的参考图"
                                  style={{ width: "100%" }}
                                  onChange={(event) => {
                                    const target = event.target.value as TemplateKind | "wd14";
                                    if (!target) return;
                                    setUploadingImageKey(key);
                                    void handleSendImageTo(image, target).finally(() => setUploadingImageKey(null));
                                  }}
                                >
                                  <option value="">{busy ? "上传中…" : "作为输入图 ▾"}</option>
                                  <option value="default">→ 默认生图</option>
                                  <option value="multi">→ 多人工作流</option>
                                  <option value="highres">→ 高清修复</option>
                                  <option value="anima">→ Anima 生图</option>
                                  <option value="wd14">→ 图片识别（反推）</option>
                                </select>
                              );
                            })()}
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

          const updater = <T extends BaseGenerationParams | MultiGenerationParams>(prev: T): T => {
            const posKey = tab === "multi" ? "globalPrompt" : "positivePrompt";
            return {
              ...prev,
              [posKey]: append(String((prev as unknown as Record<string, unknown>)[posKey] ?? ""), pos),
              negativePrompt: append(prev.negativePrompt ?? "", neg)
            } as T;
          };

          if (tab === "multi") {
            params.setMultiParams(updater);
          } else if (tab === "highres") {
            params.setHighresParams(updater);
          } else if (tab === "anima") {
            params.setAnimaParams(updater);
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
        onDoctorAction={loras.doctorAction}
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
              {/* 断连时也能用的离线功能入口：外部工具启动器（不依赖 ComfyUI） */}
              <button type="button" className="secondary-action" onClick={() => ui.setShowLauncher(true)} title="离线可用：一键启动本地程序/脚本/网页">
                <Wrench size={18} />
                外部工具
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
