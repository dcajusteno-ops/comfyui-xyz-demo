import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  Bookmark,
  Dice5,
  Film,
  Loader2,
  Play,
  RefreshCw,
  Repeat,
  Settings2,
  Shirt,
  Sparkles,
  Square,
  Users,
} from "lucide-react";
import { ModalFrame, PanelTitle } from "../../ui";
import type {
  AnimaGenerationParams,
  JobResult,
  LoraExampleMedia,
  LoraItem,
  LoraManagerSettings,
  LoraSelection,
  OptionsState,
  OutputImage,
  Toast,
} from "../../../types";
import type { AnimaApplyMode } from "../../../lib/anima/types";
import { useWardrobeData } from "../../../hooks/useWardrobeData";
import { useWardrobe } from "../../../hooks/useWardrobe";
import { targetNum } from "../../../lib/wardrobe/levels";
import { getWardrobeData } from "../../../lib/wardrobe/store";
import { styleChoices } from "../../../lib/wardrobe/outfitStyle";
import { hairPickOptions } from "../../../lib/wardrobe/characters";
import { setLevel, setUi } from "../../../lib/wardrobe/state";
import { splitWardrobeToWorkbench } from "../../../lib/wardrobe/workbench";
import { sceneList } from "../../../lib/wardrobe/scenes";
import { applyOutfitOverlay } from "../../../lib/wardrobe/outfits";
import { applyLibraryOverlay } from "../../../lib/wardrobe/outfitLibrary";
import {
  WARDROBE_BREAST_SIZES,
  WARDROBE_HAIR_PICKS,
  WARDROBE_LEVELS,
  WARDROBE_TAG_CAPS,
} from "../../../lib/wardrobe/persist";
import { countTags } from "../../../lib/wardrobe/text";
import {
  WARDROBE_OUTPUT_ROOT,
  buildWardrobeGenerationParams,
  buildWardrobePrompt,
} from "../../../lib/wardrobe/generation";
import type {
  WardrobeDrawResult,
  WardrobeGenerationState,
  WardrobeWorkbenchSplit,
} from "../../../lib/wardrobe/types";
import { WardrobeTree } from "./WardrobeTree";
import { WardrobeCharacterLibrary } from "./WardrobeCharacterLibrary";
import { WardrobeSceneLibrary } from "./WardrobeSceneLibrary";
import { WardrobeOutfitLibrary } from "./WardrobeOutfitLibrary";
import { WardrobeDrySkinBar } from "./WardrobeDrySkinBar";
import { WardrobePresetBar } from "./WardrobePresetBar";
import { WardrobeResultPanel } from "./WardrobeResultPanel";
import { WardrobeLoraSection } from "./WardrobeLoraSection";
import { WardrobeGenerationSettings } from "./WardrobeGenerationSettings";
import { WardrobeGenerationGallery } from "./WardrobeGenerationGallery";
import { AnimaSelect } from "../AnimaLibrary/AnimaSelect";

type Props = {
  currentPrompt: string;
  onApplyPrompt: (text: string, mode: AnimaApplyMode) => void;
  onConfirm: (title: string, message: string, onConfirm: () => void) => void;
  pushToast: (type: Toast["type"], title: string, message?: string) => void;
  onOpenAnima: () => void;
  /** 公共工作台（独立页）当前的内容，用来判断要不要弹确认 */
  workbenchValues: Record<string, string>;
  /** 把拆好的分区桶送进公共工作台并跳转过去 */
  onSendToWorkbench: (split: WardrobeWorkbenchSplit) => void;
  /** 一键生图 / 连续生图：提交造型台自己构建的 Anima 工作流 */
  onGenerateImage: (params: AnimaGenerationParams) => Promise<JobResult | undefined>;
  /** 生成结果缩略图点击后打开灯箱 */
  onOpenGeneratedImage: (url: string, originalUrl?: string) => void;
  /** 在系统浏览器打开造型台专属图片管理页（定位到 造型台 输出目录） */
  onOpenImageManager: (dir?: string) => void;
  /** 造型台独立生图状态（App 层持久化，标准 LoRA 插入逻辑直接写入这里） */
  generation: WardrobeGenerationState;
  setGeneration: Dispatch<SetStateAction<WardrobeGenerationState>>;
  /** 打开全局简易 LoRA 管理器，插入目标固定为造型台 */
  onOpenLoraLibrary: () => void;
  loraChips: {
    apiBase: string;
    settings: LoraManagerSettings;
    localExampleFilesByHash: Record<string, LoraExampleMedia[]>;
    onDetail: (item: LoraSelection | LoraItem) => void;
  };
  options: OptionsState;
  /** 中断当前 ComfyUI 任务（连续生图的停止按钮） */
  onInterrupt: () => void;
};

/** 送入工作台时整体替换的分区；`extra` 追加，`artist` 永远保留（画师只归工作台管）。 */
const WORKBENCH_REPLACE_SLOTS = ["quality", "character", "clothing", "background", "pose"] as const;

const LEVEL_LABELS: Record<(typeof WARDROBE_LEVELS)[number], string> = {
  sfw: "全年龄",
  suggestive: "擦边",
  explicit: "成人",
  hardcore: "过激",
  extreme: "极端",
};

/**
 * 生成结果缓存：切换工作台页签会卸载造型台面板，`useState` 会被重置，
 * 导致「结果 N / 查看图片」入口消失。
 * 用模块级外部 store + `useSyncExternalStore`：即使连续生图还在旧实例里跑，
 * 新挂载的面板也能收到后续每一张图，结果数保持实时增长（仅本次会话）。
 */
let generatedImagesCache: OutputImage[] = [];
const generatedImagesListeners = new Set<() => void>();

function subscribeGeneratedImages(listener: () => void) {
  generatedImagesListeners.add(listener);
  return () => {
    generatedImagesListeners.delete(listener);
  };
}

function getGeneratedImagesSnapshot() {
  return generatedImagesCache;
}

function addGeneratedImages(images: OutputImage[]) {
  generatedImagesCache = [...images, ...generatedImagesCache].slice(0, 24);
  for (const listener of generatedImagesListeners) listener();
}

/** 静态档位数字：首屏数据未就绪时也要能渲染，不能调 targetNum()（它依赖数据包）。 */
const LEVEL_NUM: Record<(typeof WARDROBE_LEVELS)[number], number> = {
  sfw: 0,
  suggestive: 1,
  explicit: 2,
  hardcore: 3,
  extreme: 4,
};

export function WardrobePanel({
  currentPrompt,
  onApplyPrompt,
  onConfirm,
  pushToast,
  onOpenAnima,
  workbenchValues,
  onSendToWorkbench,
  onGenerateImage,
  onOpenGeneratedImage,
  onOpenImageManager,
  generation,
  setGeneration,
  onOpenLoraLibrary,
  loraChips,
  options,
  onInterrupt,
}: Props) {
  const data = useWardrobeData();
  const wardrobe = useWardrobe(pushToast);
  const [result, setResult] = useState<WardrobeDrawResult | null>(null);
  const [showDry, setShowDry] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLoraManager, setShowLoraManager] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  // 草稿提到面板层，标题栏按钮与结果区共用同一份文本
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const generatedImages = useSyncExternalStore(
    subscribeGeneratedImages,
    getGeneratedImagesSnapshot,
    getGeneratedImagesSnapshot,
  );
  const [loopRunning, setLoopRunning] = useState(false);
  const [loopProgress, setLoopProgress] = useState({ done: 0, total: 0 });
  const stopLoopRef = useRef(false);

  // 服装预设覆盖层要在数据就绪后合并进引擎（否则读不到 character-outfits.json）
  useEffect(() => {
    if (data.ready) applyOutfitOverlay(wardrobe.outfits);
  }, [data.ready, wardrobe.outfits]);

  // 全局服装库的 active / 袜鞋覆盖 / 场景覆盖同样在数据就绪后灌进引擎
  useEffect(() => {
    if (data.ready) applyLibraryOverlay(wardrobe.state.outfitLibrary);
  }, [data.ready, wardrobe.state.outfitLibrary]);

  const state = wardrobe.state;
  const lv = LEVEL_NUM[state.level] ?? 0;
  const shownText = result?.text ?? state.lastResult?.text ?? "";
  const shownMeta = result
    ? {
        levelNum: result.level_num,
        cap: result.cap,
        seed: state.seed,
        tagCount: countTags(result.text),
        notes: result.notes,
        dropped: result.dropped,
        repaired: result.report.repaired,
      }
    : {
        levelNum: state.lastResult?.levelNum ?? lv,
        cap: state.lastResult?.cap ?? 0,
        seed: state.lastResult?.seed ?? state.seed,
        tagCount: state.lastResult?.tagCount ?? 0,
        notes: state.lastResult?.notes ?? [],
        dropped: state.lastResult?.dropped ?? [],
        repaired: state.lastResult?.repaired ?? [],
      };

  // 抽取结果变化时同步草稿（与结果区原来的行为一致）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部文本变化时同步草稿
    setDraft(shownText);
  }, [shownText]);

  const runGenerate = async (prompt: string): Promise<JobResult | undefined> => {
    const clean = prompt.trim();
    if (!clean) return undefined;
    try {
      const job = await onGenerateImage(buildWardrobeGenerationParams(generation, clean));
      if (job?.images?.length) {
        addGeneratedImages(job.images);
      }
      return job;
    } catch {
      // runPrompt 已统一 toast 失败原因，这里只负责复位状态
      return undefined;
    }
  };

  const ensureModelSelected = (): boolean => {
    if (generation.params.modelStack.unetName) return true;
    pushToast("error", "未选择 UNet 模型", "请先在「生图设置」里选择模型");
    setShowSettings(true);
    return false;
  };

  const handleGenerate = async () => {
    if (generating || loopRunning) return;
    if (!ensureModelSelected()) return;
    const prompt = buildWardrobePrompt(generation, draft, state.qualityPrefix);
    if (!prompt) return;
    setGenerating(true);
    try {
      await runGenerate(prompt);
    } finally {
      setGenerating(false);
    }
  };

  const runContinuous = async () => {
    if (loopRunning) {
      stopLoopRef.current = true;
      onInterrupt();
      return;
    }
    if (generating) return;
    if (!ensureModelSelected()) return;

    const total = generation.continuousCount;
    stopLoopRef.current = false;
    setLoopRunning(true);
    setLoopProgress({ done: 0, total });
    try {
      for (let index = 0; index < total; index += 1) {
        if (stopLoopRef.current) break;
        // 连续模式每轮换一个临时种子：不写回面板 seed
        const drawn = wardrobe.run(Math.floor(Math.random() * 2 ** 31));
        if (!drawn) break;
        setDraft(drawn.text);
        const prompt = buildWardrobePrompt(generation, drawn.text, state.qualityPrefix);
        if (!prompt) break;
        const job = await runGenerate(prompt);
        if (!job) break;
        setLoopProgress({ done: index + 1, total });
      }
    } finally {
      setLoopRunning(false);
      stopLoopRef.current = false;
    }
  };

  const outfitTemplates = () => getWardrobeData("outfitTemplates")?.outfits ?? [];

  // 二级页签的条数：数据就绪后算一次（524 条，成本可忽略）
  const sceneCounts = useMemo(() => {
    const counts = { pair: 0, pose: 0, art: 0, weapon: 0, near: 0 } as Record<string, number>;
    if (!data.ready) return counts;
    for (const scene of sceneList()) {
      if (scene.group === "sfw" || scene.group === "nsfw") counts.pair += 1;
      else if (scene.group in counts) counts[scene.group] += 1;
    }
    return counts;
  }, [data.ready]);

  const outfitOptions = useMemo(
    () => (data.ready ? styleChoices().map((choice) => ({ value: choice, label: choice })) : []),
    [data.ready],
  );

  if (data.error) {
    return (
      <div className="wd-panel panel">
        <div className="panel-header">
          <PanelTitle icon={Shirt} title="Anima 造型台" />
        </div>
        <div className="panel-body">
          <div className="wd-empty-state">
            <p>造型台数据加载失败：{data.error}</p>
            <button type="button" className="primary-action" onClick={data.reload}>
              <RefreshCw size={14} /> 重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!data.ready) {
    return (
      <div className="wd-panel panel">
        <div className="panel-header">
          <PanelTitle icon={Shirt} title="Anima 造型台" />
        </div>
        <div className="panel-body">
          <div className="wd-empty-state">
            <Loader2 size={18} className="wd-spin" />
            <p>正在加载词库 / 角色库 / 场景库…</p>
          </div>
        </div>
      </div>
    );
  }

  const handleRun = () => {
    const next = wardrobe.run();
    if (next) setResult(next);
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      pushToast("success", "已复制", `${countTags(text)} 个标签`);
    } catch (error) {
      pushToast("error", "复制失败", error instanceof Error ? error.message : String(error));
    }
  };

  const handleApply = (text: string, mode: AnimaApplyMode) => {
    if (mode === "replace") {
      onConfirm(
        "覆盖 Anima 提示词",
        `当前正向提示词 ${currentPrompt.length} 字符将被替换为造型台结果（${text.length} 字符）。`,
        () => onApplyPrompt(text, "replace"),
      );
      return;
    }
    onApplyPrompt(text, "append");
  };

  /** 造型台结果 → 公共工作台（独立页）：内容分区整体替换、extra 追加、画师保留。 */
  const handleToWorkbench = () => {
    const saved = state.lastResult?.slots;
    const split: WardrobeWorkbenchSplit =
      saved ?? splitWardrobeToWorkbench(result?.state, shownText.split(",").map((t) => t.trim()));
    const occupied = WORKBENCH_REPLACE_SLOTS.some((slot) => (workbenchValues[slot] ?? "").trim());

    const doSend = () => onSendToWorkbench(split);

    if (occupied) {
      onConfirm(
        "更新公共工作台",
        "造型台结果会替换工作台里的质量 / 角色 / 服装 / 背景 / 姿势分区，「额外」追加、画师与手改内容保留。继续吗？",
        doSend,
      );
      return;
    }
    doSend();
  };

  return (
    <>
      <div className={`wd-panel panel${showDry ? " has-dryskin" : ""}`}>
      <div className="panel-header wd-header">
        <PanelTitle icon={Shirt} title="Anima 造型台" />
        <div className="wd-level-bar" role="group" aria-label="档位">
          {WARDROBE_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={`wd-level${state.level === level && !state.randomLevel ? " is-on" : ""}`}
              onClick={() =>
                wardrobe.setState((prev) => ({ ...setLevel(prev, level), randomLevel: false }))
              }
              title={`L${targetNum()[level]} · ${LEVEL_LABELS[level]}`}
            >
              <em>L{targetNum()[level]}</em>
              {LEVEL_LABELS[level]}
            </button>
          ))}
          <button
            type="button"
            className={`wd-level wd-level-random${state.randomLevel ? " is-on" : ""}`}
            onClick={() =>
              wardrobe.setState((prev) => ({ ...prev, randomLevel: !prev.randomLevel }))
            }
            title="随机档位：每次抽取从 L0-L4 中随机，连续生图时每轮都可能不同"
          >
            <em>
              <Dice5 size={11} />
            </em>
            随机
          </button>
        </div>
        <label className="wd-seed">
          seed
          <input
            type="number"
            value={state.seed}
            min={-1}
            max={2 ** 31 - 1}
            onChange={(event) =>
              wardrobe.setState((prev) => ({ ...prev, seed: Number(event.target.value) || -1 }))
            }
            title="-1 = 每次重抽；固定数字 = 可复现"
          />
          <button
            type="button"
            className="wd-icon-btn"
            title="随机一个 seed"
            onClick={() =>
              wardrobe.setState((prev) => ({ ...prev, seed: Math.floor(Math.random() * 2 ** 31) }))
            }
          >
            <Dice5 size={14} />
          </button>
        </label>
        <button
          type="button"
          className="primary-action wd-run"
          onClick={handleRun}
          disabled={loopRunning || generating}
        >
          <Play size={15} /> 抽一次
        </button>
        <button
          type="button"
          className="primary-action wd-generate"
          onClick={() => void handleGenerate()}
          disabled={!draft.trim() || generating || loopRunning}
          aria-busy={generating && !loopRunning}
          title="用当前抽取结果直接生成（沿用造型台自己的模型 / 尺寸 / 采样参数与 LoRA）"
        >
          {generating && !loopRunning ? (
            <Loader2 size={15} className="wd-spin" />
          ) : (
            <Sparkles size={15} />
          )}
          {generating && !loopRunning ? "生成中…" : "一键生图"}
        </button>
        <button
          type="button"
          className="secondary-action wd-continuous"
          onClick={() => void runContinuous()}
          disabled={!loopRunning && generating}
          aria-busy={loopRunning}
          title={
            loopRunning
              ? "停止连续生图（会中断当前这一张）"
              : `连续 ${generation.continuousCount} 次：每轮重新抽词并生成一张`
          }
        >
          {loopRunning ? <Square size={15} /> : <Repeat size={15} />}
          {loopRunning
            ? `停止 ${loopProgress.done}/${loopProgress.total}`
            : `连抽 ${generation.continuousCount} 次`}
        </button>
        <button
          type="button"
          className="wd-icon-btn"
          onClick={() => setShowSettings(true)}
          title="造型台生图设置（模型 / 尺寸 / 采样 / LoRA）"
          aria-label="造型台生图设置"
        >
          <Settings2 size={16} />
        </button>
      </div>

      <div className="wd-toolbar">
        <div className="wd-toolbar-group">
          <label className="wd-tool">
            标签上限
            <AnimaSelect
              value={state.tagCap}
              options={WARDROBE_TAG_CAPS.map((cap) => ({ value: cap, label: cap }))}
              onChange={(value) => wardrobe.setState((prev) => ({ ...prev, tagCap: value }))}
              ariaLabel="标签上限"
              size="sm"
            />
          </label>
          <label className="wd-tool">
            基础概率
            <input
              type="number"
              min={0.05}
              max={1}
              step={0.05}
              value={state.baseProb}
              onChange={(event) =>
                wardrobe.setState((prev) => ({ ...prev, baseProb: Number(event.target.value) || 0.65 }))
              }
            />
          </label>
        </div>

        <span className="wd-toolbar-sep" aria-hidden="true" />

        <div className="wd-toolbar-group">
          <label className="wd-tool">
            服装风格
            <AnimaSelect
              value={state.outfitStyle}
              options={outfitOptions}
              onChange={(value) => wardrobe.setState((prev) => ({ ...prev, outfitStyle: value }))}
              ariaLabel="服装风格"
              size="sm"
            />
          </label>
          <label className="wd-tool">
            胸部
            <AnimaSelect
              value={state.breastSize}
              options={WARDROBE_BREAST_SIZES.map((value) => ({ value, label: value }))}
              onChange={(value) => wardrobe.setState((prev) => ({ ...prev, breastSize: value }))}
              ariaLabel="胸部大小"
              size="sm"
            />
          </label>
        </div>

        <span className="wd-toolbar-sep" aria-hidden="true" />

        <div className="wd-toolbar-group">
          <label className="wd-mini-check">
            <input
              type="checkbox"
              checked={state.appearanceFollow}
              onChange={(event) =>
                wardrobe.setState((prev) => ({ ...prev, appearanceFollow: event.target.checked }))
              }
            />
            外貌对齐
          </label>
          <label className="wd-mini-check">
            <input
              type="checkbox"
              checked={state.hairFollow}
              onChange={(event) => wardrobe.setState((prev) => ({ ...prev, hairFollow: event.target.checked }))}
            />
            发型对齐
          </label>
          <label className="wd-mini-check">
            <input
              type="checkbox"
              checked={state.roleFavOnly}
              onChange={(event) => wardrobe.setState((prev) => ({ ...prev, roleFavOnly: event.target.checked }))}
            />
            角色仅收藏
          </label>
          <label className="wd-mini-check" title="勾上 = 这一抽完全不抽角色（手填/已选也一并让路）">
            <input
              type="checkbox"
              checked={!state.rolePick}
              onChange={(event) => wardrobe.setState((prev) => ({ ...prev, rolePick: !event.target.checked }))}
            />
            不指定角色
          </label>
          <label className="wd-mini-check" title="只选 1 位角色又赶上双女人数时，同作品优先自动补一位（插件 V6 默认开）">
            <input
              type="checkbox"
              checked={state.duoRoleFill}
              onChange={(event) => wardrobe.setDuoRoleFill(event.target.checked)}
            />
            双女补位
          </label>
        </div>

        <button
          type="button"
          className={`wd-dryskin-toggle${state.drySkin.enabled ? " is-on" : ""}`}
          onClick={() => setShowDry((prev) => !prev)}
          title="成品层剔除会加皮肤水珠的词条（默认关，关闭时零影响）"
        >
          <Sparkles size={13} /> 干爽过滤{state.drySkin.enabled ? " · 开" : ""}
        </button>
      </div>
      {showDry && (
        <WardrobeDrySkinBar
          state={state}
          onClose={() => setShowDry(false)}
          onChange={(patch) => wardrobe.setDrySkin(patch)}
        />
      )}

      <div className="wd-body">
        <aside className="wd-left">
          <div className="wd-advanced">
            <label className="wd-tool wd-tool-wide">
              手填角色（force_role）
              <input
                value={state.forceRole}
                placeholder="角色 trigger，如 hatsune miku, vocaloid"
                onChange={(event) => wardrobe.setState((prev) => ({ ...prev, forceRole: event.target.value }))}
              />
            </label>
            <label className="wd-tool wd-tool-wide">
              手写补充（拼在末尾）
              <textarea
                value={state.extraBody}
                rows={2}
                placeholder="pointy ears, smile"
                onChange={(event) => wardrobe.setState((prev) => ({ ...prev, extraBody: event.target.value }))}
              />
            </label>
            <details className="wd-hair-picks">
              <summary>发型选择器（4 项）</summary>
              {WARDROBE_HAIR_PICKS.map((key) => (
                <label key={key} className="wd-tool wd-tool-wide">
                  {key}
                  <AnimaSelect
                    value={state.hairPicks[key] ?? "角色标签发型"}
                    options={hairPickOptions(key).map((value) => ({ value, label: value }))}
                    onChange={(value) =>
                      wardrobe.setState((prev) => ({
                        ...prev,
                        hairPicks: { ...prev.hairPicks, [key]: value },
                      }))
                    }
                    ariaLabel={`${key} 发型选择`}
                    size="sm"
                  />
                </label>
              ))}
            </details>
          </div>
          <WardrobeTree state={state} setState={wardrobe.setState} lv={lv} />
        </aside>

        <section className="wd-right">
          <div className="wd-view-bar">
            {(
              [
                ["chars", "角色库", Users],
                ["outfits", "服装库", Shirt],
                ["scenes", "场景", Film],
                ["presets", "预设", Bookmark],
              ] as const
            ).map(([view, label, Icon]) => (
              <button
                key={view}
                type="button"
                className={`wd-view-tab${state.ui.view === view ? " is-on" : ""}`}
                onClick={() => wardrobe.setState((prev) => setUi(prev, { view }))}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
            <span className="wd-view-hint">
              <Sparkles size={12} /> {state.lastResult ? "上一轮结果在下方" : "选角色 / 套场景后抽一次"}
            </span>
          </div>
          {state.ui.view === "scenes" && (
            <div className="wd-subtabs">
              {(
                [
                  ["pair", "搭配"],
                  ["pose", "姿势"],
                  ["art", "艺术"],
                  ["weapon", "武器"],
                  ["near", "特写"],
                ] as const
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  className={`wd-subtab${state.ui.sceneTab === tab ? " is-on" : ""}`}
                  onClick={() => wardrobe.setState((prev) => setUi(prev, { sceneTab: tab }))}
                  title={tab === "pair" ? "档位分组（sfw / nsfw）" : "勾选后随机 / 手动套用"}
                >
                  {label}
                  <em>{sceneCounts[tab] ?? 0}</em>
                </button>
              ))}
            </div>
          )}
          <div className="wd-view-body">
            {state.ui.view === "chars" && (
              <WardrobeCharacterLibrary
                state={state}
                setState={wardrobe.setState}
                selected={wardrobe.selectedRoles}
                favorites={wardrobe.favoriteChars}
                favoriteWorks={wardrobe.favoriteWorks}
                outfits={wardrobe.outfits}
                outfitTemplates={data.ready ? outfitTemplates() : []}
                onToggleRole={wardrobe.toggleRole}
                onToggleFavorite={wardrobe.toggleFavoriteCharacter}
                onToggleWork={wardrobe.toggleFavoriteWork}
                onSaveOutfit={wardrobe.saveOutfit}
                onDeleteOutfit={wardrobe.removeOutfit}
                onEnableOutfit={wardrobe.toggleOutfit}
              />
            )}
            {state.ui.view === "outfits" && (
              <WardrobeOutfitLibrary
                state={state}
                onToggleActive={wardrobe.toggleLibraryActive}
                onOverride={wardrobe.setLibraryOverride}
                onSceneOverride={wardrobe.setLibrarySceneOverride}
              />
            )}
            {state.ui.view === "scenes" && (
              <WardrobeSceneLibrary
                state={state}
                setState={wardrobe.setState}
                favorites={wardrobe.favoriteScenes}
                tab={state.ui.sceneTab}
                onToggleFavorite={wardrobe.toggleFavoriteScene}
                onApply={wardrobe.applyScene}
                onClear={wardrobe.clearScene}
                onApplyNear={wardrobe.applyNearScene}
                onRestoreNear={wardrobe.restoreNear}
                onSetPickMode={wardrobe.setPickPoolMode}
                onTogglePick={wardrobe.togglePickPoolId}
                onSelectPickAll={(ids) => {
                  for (const id of ids) {
                    if (!state.pickPool.ids.includes(id)) wardrobe.togglePickPoolId(id);
                  }
                }}
                onClearPick={wardrobe.clearPickPool}
              />
            )}
            {state.ui.view === "presets" && (
              <WardrobePresetBar
                presets={wardrobe.presets}
                onSave={wardrobe.savePreset}
                onLoad={wardrobe.loadPreset}
                onDelete={wardrobe.deletePreset}
              />
            )}
          </div>
          <WardrobeResultPanel
            text={shownText}
            levelNum={shownMeta.levelNum}
            cap={shownMeta.cap}
            seed={shownMeta.seed}
            tagCount={shownMeta.tagCount}
            notes={shownMeta.notes}
            dropped={shownMeta.dropped}
            repaired={shownMeta.repaired}
            qualityPrefix={state.qualityPrefix}
            onQualityPrefix={(value) => wardrobe.setState((prev) => ({ ...prev, qualityPrefix: value }))}
            onApply={handleApply}
            onCopy={handleCopy}
            onToWorkbench={handleToWorkbench}
            onOpenAnima={onOpenAnima}
            onOpenImageFolder={() => onOpenImageManager(WARDROBE_OUTPUT_ROOT)}
            draft={draft}
            onDraftChange={setDraft}
            generating={generating || loopRunning}
            generatedImages={generatedImages}
            onOpenImage={onOpenGeneratedImage}
            generation={generation}
            onOpenLoraManager={() => setShowLoraManager(true)}
            onOpenGallery={() => setShowGallery(true)}
          />
        </section>
      </div>
      </div>
      {showSettings && (
        <WardrobeGenerationSettings
          state={generation}
          options={options}
          onChange={setGeneration}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showLoraManager && (
        <ModalFrame
          title="造型台 LoRA 与触发词"
          onClose={() => setShowLoraManager(false)}
          style={{ width: "min(980px, 94vw)", maxHeight: "86vh", display: "flex", flexDirection: "column" }}
        >
          <div className="wd-lora-manager-modal">
            <WardrobeLoraSection
              state={generation}
              onChange={setGeneration}
              onOpenLibrary={onOpenLoraLibrary}
              onOpenLoraDetail={loraChips.onDetail}
              apiBase={loraChips.apiBase}
              loraSettings={loraChips.settings}
              loraExampleFilesByHash={loraChips.localExampleFilesByHash}
            />
          </div>
          <div className="panel-footer wd-modal-foot">
            <button type="button" className="primary-action" onClick={() => setShowLoraManager(false)}>
              完成
            </button>
          </div>
        </ModalFrame>
      )}
      {showGallery && (
        <WardrobeGenerationGallery
          images={generatedImages}
          generating={generating || loopRunning}
          progress={loopProgress}
          onOpenImage={onOpenGeneratedImage}
          onClose={() => setShowGallery(false)}
        />
      )}
    </>
  );
}
