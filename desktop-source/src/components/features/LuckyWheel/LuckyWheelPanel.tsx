import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Disc3, Lock, Plus, RotateCcw, Send, Sparkles, Trash2, Unlock, X } from "lucide-react";

import { PanelTitle } from "../../ui";
import { templateLabels } from "../../../constants";
import type { TemplateKind } from "../../../types";
import { usePersistentState } from "../../../hooks/usePersistentState";
import { loadPromptLibrary, type PromptRecord } from "../../../lib/promptLibrary";
import {
  DEFAULT_WHEEL_SECTORS,
  MAX_SECTORS,
  activeSectors as selectActiveSectors,
  buildSectorPool,
  collectResultTags,
  createDefaultSectors,
  drawTagForSector,
  joinResultTags,
  pickCandidateSectors,
  type SectorResult,
  type WheelSector,
} from "../../../lib/luckyWheel";
import { computeTargetRotation } from "../../../lib/spinWheel";
import { WheelDisc } from "./WheelDisc";

interface LuckyWheelPanelProps {
  onApplyPrompt: (tags: string[], target: TemplateKind) => void;
}

/** 历史快照：记录整盘结果，回填时无需按分类反推。 */
type HistoryItem = { time: number; snapshot: Record<string, SectorResult> };

/**
 * 随 ui-state 持久化的转盘状态：扇区配置、整盘结果、历史。
 * 不存 rotation / spinning —— 动画状态没有跨会话意义。
 */
type PersistedWheelState = {
  sectors: WheelSector[];
  results: Record<string, SectorResult>;
  history: HistoryItem[];
};

const WHEEL_STATE_KEY = "comfyui_xyz_wheel";

/** 最近一次抽中的结果（圆心 hub + 指针高亮），从 results 里按时间取，不单独存。 */
type LastDraw = { sectorId: string; label: string; tag: PromptRecord };

const SPIN_MS = 3200;
const CHAIN_SPIN_MS = 1800;
/** 提交时机必须晚于 transition 结束，否则先停的盘会与结果错位。 */
const COMMIT_BUFFER_MS = 120;
const HISTORY_LIMIT = 20;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export const LuckyWheelPanel = React.memo(({ onApplyPrompt }: LuckyWheelPanelProps) => {
  const [records, setRecords] = useState<PromptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // 扇区配置 / 整盘结果 / 历史都随 ui-state 持久化：切走标签页、重开应用都还在
  const [saved, setSaved] = usePersistentState<PersistedWheelState>(WHEEL_STATE_KEY, {
    sectors: createDefaultSectors(),
    results: {},
    history: [],
  });
  const sectors = saved.sectors;
  const results = saved.results;
  const history = saved.history;
  const [rotation, setRotation] = useState(0);
  /** 与本次 rotation 同批提交的过渡时长；空闲时为 0，避免复位角度时出现补间倒转 */
  const [spinDuration, setSpinDuration] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [chaining, setChaining] = useState(false);
  const [target, setTarget] = useState<TemplateKind>("default");
  const [copied, setCopied] = useState(false);
  const [copiedKey, setCopiedKey] = useState<number | null>(null);
  /** 「恢复默认扇区」的两步确认 */
  const [confirmReset, setConfirmReset] = useState(false);

  const recordsRef = useRef<PromptRecord[]>([]);
  const sectorsRef = useRef<WheelSector[]>(sectors);
  const resultsRef = useRef<Record<string, SectorResult>>({});
  const rotationRef = useRef(0);
  const busyRef = useRef(false);
  const chainingRef = useRef(false);
  const cancelRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError("");
    loadPromptLibrary()
      .then((list) => {
        recordsRef.current = list;
        setRecords(list);
      })
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () => () => {
      cancelRef.current = true;
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    },
    []
  );

  const applySectors = useCallback(
    (next: WheelSector[]) => {
      sectorsRef.current = next;
      setSaved((prev) => ({ ...prev, sectors: next }));
    },
    [setSaved]
  );

  const applyResults = useCallback(
    (next: Record<string, SectorResult>) => {
      resultsRef.current = next;
      setSaved((prev) => ({ ...prev, results: next }));
    },
    [setSaved]
  );

  const wait = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        const id = window.setTimeout(() => resolve(), Math.max(0, ms));
        timersRef.current.push(id);
      }),
    []
  );

  const active = useMemo(() => selectActiveSectors(sectors), [sectors]);
  const activeKey = active.map((sector) => sector.id).join("|");

  // 扇区集合变化后，旧的 rotation 对应的已不是同一个扇区 —— 复位指针，避免视觉错位。
  const prevActiveKeyRef = useRef(activeKey);
  useEffect(() => {
    if (prevActiveKeyRef.current === activeKey) return;
    prevActiveKeyRef.current = activeKey;
    rotationRef.current = 0;
    setSpinDuration(0);
    setRotation(0);
  }, [activeKey]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const record of records) {
      if (record.category) set.add(record.category);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [records]);

  const poolSizes = useMemo(() => {
    const sizes: Record<string, number> = {};
    for (const sector of sectors) sizes[sector.id] = buildSectorPool(sector, records).length;
    return sizes;
  }, [records, sectors]);

  const anyCandidates = useMemo(
    () => pickCandidateSectors(sectors, results, records, "any"),
    [sectors, results, records]
  );
  const emptyCandidates = useMemo(
    () => pickCandidateSectors(sectors, results, records, "empty"),
    [sectors, results, records]
  );

  const visibleTags = useMemo(() => collectResultTags(results, sectors), [results, sectors]);

  /** 最近一次抽中的结果：圆心 hub 与指针高亮都从它来（不单独存，切页回来也能恢复显示） */
  const lastDraw = useMemo<LastDraw | null>(() => {
    let latest: SectorResult | null = null;
    for (const result of Object.values(results)) {
      if (!latest || result.at > latest.at) latest = result;
    }
    if (!latest) return null;
    const sector = sectors.find((item) => item.id === latest.sectorId);
    return sector ? { sectorId: sector.id, label: sector.label, tag: latest.tag } : null;
  }, [results, sectors]);

  const pushHistory = useCallback(() => {
    setSaved((prev) => ({
      ...prev,
      history: [{ time: Date.now(), snapshot: { ...resultsRef.current } }, ...prev.history].slice(0, HISTORY_LIMIT),
    }));
  }, [setSaved]);

  /**
   * 单次转动：先定结果（扇区 + 词），再放动画，最后提交。
   * 顺序不可颠倒 —— 这是「指针指向 === 实际结果」的唯一保证。
   */
  const runSpin = useCallback(
    async (mode: "any" | "empty", durationMs: number): Promise<boolean> => {
      const list = sectorsRef.current;
      const candidates = pickCandidateSectors(list, resultsRef.current, recordsRef.current, mode);
      if (candidates.length === 0) return false;

      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      const displayOrder = selectActiveSectors(list);
      const winnerIndex = displayOrder.findIndex((sector) => sector.id === pick.sector.id);
      if (winnerIndex < 0) return false;

      const tag = drawTagForSector(pick.sector, recordsRef.current, Math.random, new Set<string>());
      if (!tag) return false;

      const reduced = prefersReducedMotion();
      const duration = reduced ? 0 : durationMs;
      const rotationTarget = computeTargetRotation(rotationRef.current, winnerIndex, displayOrder.length, {
        random: Math.random,
        ...(reduced ? { minTurns: 0, maxTurns: 0, offsetRatio: 0 } : {}),
      });

      busyRef.current = true;
      setSpinning(true);
      setSpinDuration(duration);
      rotationRef.current = rotationTarget;
      setRotation(rotationTarget);

      await wait(duration + (reduced ? 0 : COMMIT_BUFFER_MS));

      const cancelled = cancelRef.current;
      busyRef.current = false;
      setSpinning(false);
      if (cancelled) return false;

      applyResults({
        ...resultsRef.current,
        [pick.sector.id]: { sectorId: pick.sector.id, tag, locked: false, at: Date.now() },
      });
      return true;
    },
    [applyResults, wait]
  );

  const spinOnce = useCallback(async () => {
    if (busyRef.current || chainingRef.current) return;
    cancelRef.current = false;
    const ok = await runSpin("any", SPIN_MS);
    if (ok) pushHistory();
  }, [pushHistory, runSpin]);

  const spinAll = useCallback(async () => {
    if (busyRef.current || chainingRef.current) return;
    cancelRef.current = false;
    chainingRef.current = true;
    setChaining(true);

    let drawn = 0;
    while (!cancelRef.current) {
      const ok = await runSpin("empty", CHAIN_SPIN_MS);
      if (!ok) break;
      drawn += 1;
    }

    chainingRef.current = false;
    setChaining(false);
    if (drawn > 0) pushHistory();
  }, [pushHistory, runSpin]);

  const stopChain = useCallback(() => {
    cancelRef.current = true;
  }, []);

  // 空格 / 回车快捷转动（输入框与按钮聚焦时不抢键）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.code !== "Enter") return;
      if (event.repeat) return;
      const element = event.target as HTMLElement | null;
      if (!element) return;
      const tagName = element.tagName;
      if (
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT" ||
        tagName === "BUTTON" ||
        element.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      void spinOnce();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [spinOnce]);

  const toggleResultLock = useCallback(
    (sectorId: string) => {
      const current = resultsRef.current[sectorId];
      if (!current) return;
      applyResults({ ...resultsRef.current, [sectorId]: { ...current, locked: !current.locked } });
    },
    [applyResults]
  );

  const removeResult = useCallback(
    (sectorId: string) => {
      const next = { ...resultsRef.current };
      delete next[sectorId];
      applyResults(next);
    },
    [applyResults]
  );

  const clearResults = useCallback(() => {
    applyResults({});
  }, [applyResults]);

  const apply = useCallback(() => {
    if (visibleTags.length === 0) return;
    onApplyPrompt(
      visibleTags.map((tag) => tag.text_en),
      target
    );
  }, [visibleTags, target, onApplyPrompt]);

  const copyTags = useCallback(async () => {
    const text = joinResultTags(resultsRef.current, sectorsRef.current);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  }, []);

  const restoreHistory = useCallback(
    async (item: HistoryItem) => {
      const text = joinResultTags(item.snapshot, sectorsRef.current);
      applyResults({ ...item.snapshot });
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        setCopiedKey(item.time);
        window.setTimeout(() => setCopiedKey((prev) => (prev === item.time ? null : prev)), 1500);
      } catch {
        /* 剪贴板不可用时静默失败，回填仍然生效 */
      }
    },
    [applyResults]
  );

  const updateSector = useCallback(
    (id: string, patch: Partial<WheelSector>) => {
      applySectors(sectorsRef.current.map((sector) => (sector.id === id ? { ...sector, ...patch } : sector)));
    },
    [applySectors]
  );

  const addSector = useCallback(() => {
    const list = sectorsRef.current;
    if (list.length >= MAX_SECTORS) return;
    const used = new Set(list.map((sector) => sector.id));
    let id = `custom-${list.length + 1}`;
    let index = list.length + 1;
    while (used.has(id)) {
      index += 1;
      id = `custom-${index}`;
    }
    const customIndex = Math.max(1, list.length - DEFAULT_WHEEL_SECTORS.length + 1);
    applySectors([...list, { id, label: `自定义${customIndex}`, categories: [], extraTags: [], enabled: true }]);
  }, [applySectors]);

  const removeSector = useCallback(
    (id: string) => {
      const list = sectorsRef.current;
      if (list.length <= 1) return;
      applySectors(list.filter((sector) => sector.id !== id));
      const next = { ...resultsRef.current };
      delete next[id];
      applyResults(next);
    },
    [applyResults, applySectors]
  );

  /** 扇区配置现在是持久化的，给一个回到出厂映射的出口（两步确认，避免误伤自定义） */
  const resetSectors = useCallback(() => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    applySectors(createDefaultSectors());
  }, [applySectors, confirmReset]);

  const canSpin = !loading && !loadError && anyCandidates.length > 0;
  const winnerIndex = lastDraw ? active.findIndex((sector) => sector.id === lastDraw.sectorId) : -1;

  return (
    <section className="panel wheel-panel">
      <div className="panel-header">
        <PanelTitle icon={Disc3} title="幸运大转盘" />
      </div>
      <div className="panel-body wheel-body">
        {loading && <div className="wheel-status">正在加载词库（约 1.7 万词条）…</div>}

        {!loading && loadError && (
          <div className="wheel-status is-error">
            <p>{loadError}</p>
            <button type="button" className="icon-button" onClick={load}>
              <Sparkles size={16} /> 重试
            </button>
          </div>
        )}

        {!loading && !loadError && (
          <>
            <div
              className="wheel-arena"
              data-sector-count={active.length}
              data-winner-index={winnerIndex}
              data-winner-sector-id={lastDraw?.sectorId ?? ""}
              data-spinning={spinning ? "true" : "false"}
            >
              <WheelDisc
                sectors={active}
                results={results}
                winnerSectorId={lastDraw?.sectorId ?? null}
                rotation={rotation}
                durationMs={spinDuration}
                spinning={spinning}
                hubLabel={lastDraw?.label ?? null}
                hubTag={lastDraw?.tag ?? null}
              />
            </div>

            <div className="wheel-actions">
              <button type="button" className="primary-action wheel-lever" onClick={() => void spinOnce()} disabled={!canSpin || spinning || chaining}>
                <Sparkles size={18} />
                {spinning ? "转动中…" : "转动"}
                <kbd>空格</kbd>
              </button>
              <button
                type="button"
                className="icon-button wheel-chain"
                onClick={() => (chaining ? stopChain() : void spinAll())}
                disabled={!chaining && (spinning || emptyCandidates.length === 0)}
                title={chaining ? "停止连转" : "自动连转，直到每个扇区都抽到词"}
              >
                <Disc3 size={16} />
                {chaining ? "停止连转" : "转满整套"}
              </button>
              <button
                type="button"
                className="icon-button danger wheel-clear"
                onClick={clearResults}
                disabled={visibleTags.length === 0 || chaining}
              >
                <Trash2 size={16} /> 清空结果
              </button>
            </div>

            {!canSpin && (
              <div className="wheel-hint">
                当前没有可转的扇区：请检查扇区是否启用、分类是否命中词库，或在下方「编辑扇区」里补充候选词。
              </div>
            )}

            <div className="wheel-results" aria-live="polite">
              {active.map((sector) => {
                const drawn = results[sector.id];
                const emptyPool = (poolSizes[sector.id] ?? 0) === 0;
                return (
                  <div className="wheel-result-row" key={sector.id} data-sector-id={sector.id} data-tag={drawn?.tag.text_en ?? ""}>
                    <span className="wheel-result-label">{sector.label}</span>
                    {drawn ? (
                      <>
                        <span className="wheel-tag" title={drawn.tag.text_zh ? `${drawn.tag.text_en}：${drawn.tag.text_zh}` : drawn.tag.text_en}>
                          <span className="wheel-tag-text">{drawn.tag.text_en}</span>
                          {drawn.tag.text_zh ? <em className="wheel-tag-zh">{drawn.tag.text_zh}</em> : null}
                        </span>
                        <button
                          type="button"
                          className={`wheel-result-lock${drawn.locked ? " is-locked" : ""}`}
                          title={drawn.locked ? "解除锁定（重转会覆盖）" : "锁定结果（重转不会覆盖）"}
                          aria-pressed={drawn.locked}
                          onClick={() => toggleResultLock(sector.id)}
                        >
                          {drawn.locked ? <Lock size={13} /> : <Unlock size={13} />}
                        </button>
                        <button
                          type="button"
                          className="wheel-tag-remove"
                          title="移除该结果"
                          onClick={() => removeResult(sector.id)}
                        >
                          <X size={12} />
                        </button>
                      </>
                    ) : (
                      <span className="wheel-result-empty">{emptyPool ? "该扇区分类未命中词库" : "未抽取"}</span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="wheel-apply-bar">
              <select
                className="wheel-target"
                value={target}
                onChange={(event) => setTarget(event.target.value as TemplateKind)}
              >
                {Object.entries(templateLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button type="button" className="icon-button" disabled={visibleTags.length === 0} onClick={apply}>
                <Send size={16} /> 应用
              </button>
              <button type="button" className="icon-button" disabled={visibleTags.length === 0} onClick={() => void copyTags()}>
                <Copy size={16} /> {copied ? "已复制" : "复制"}
              </button>
            </div>

            {history.length > 0 && (
              <div className="wheel-history">
                <h4>历史（最近 {history.length} 次，点击复制并回填）</h4>
                {history.map((item, index) => {
                  const isCopied = copiedKey === item.time;
                  const joined = joinResultTags(item.snapshot, sectors);
                  return (
                    <button
                      key={item.time}
                      type="button"
                      className={`wheel-history-item${isCopied ? " is-copied" : ""}`}
                      title={`${new Date(item.time).toLocaleTimeString()} · 点击复制到剪贴板并回填`}
                      onClick={() => void restoreHistory(item)}
                    >
                      <span className="wheel-history-text">
                        {index + 1}. {joined || "（空）"}
                      </span>
                      <span className="wheel-history-meta">
                        {new Date(item.time).toLocaleTimeString()}
                        <Copy size={12} />
                        {isCopied ? "已复制" : "复制"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <details className="wheel-sectors">
              <summary>编辑扇区</summary>
              <div className="wheel-sector-list">
                {sectors.map((sector) => (
                  <div className="wheel-sector-row" key={sector.id}>
                    <input
                      className="wheel-sector-name"
                      value={sector.label}
                      onChange={(event) => updateSector(sector.id, { label: event.target.value })}
                      placeholder="扇区名"
                    />
                    <input
                      className="wheel-sector-cats"
                      list="wheel-category-suggestions"
                      placeholder="词库分类，逗号分隔（如：人物, face）"
                      value={sector.categories.join(", ")}
                      onChange={(event) =>
                        updateSector(sector.id, {
                          categories: event.target.value
                            .split(/[,，]/)
                            .map((part) => part.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                    <input
                      className="wheel-sector-extra"
                      placeholder="手填候选词，逗号分隔（可选）"
                      value={sector.extraTags.join(", ")}
                      onChange={(event) =>
                        updateSector(sector.id, {
                          extraTags: event.target.value
                            .split(/[,，]/)
                            .map((part) => part.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                    <span className={`wheel-sector-pool${(poolSizes[sector.id] ?? 0) === 0 ? " is-empty" : ""}`}>
                      {poolSizes[sector.id] ?? 0} 个候选
                    </span>
                    <label className="wheel-sector-enable">
                      <input
                        type="checkbox"
                        checked={sector.enabled}
                        onChange={(event) => updateSector(sector.id, { enabled: event.target.checked })}
                      />
                      启用
                    </label>
                    <button
                      type="button"
                      className="icon-button danger"
                      onClick={() => removeSector(sector.id)}
                      disabled={sectors.length <= 1}
                      title="删除此扇区"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" className="icon-button" onClick={addSector} disabled={sectors.length >= MAX_SECTORS}>
                <Plus size={16} /> 新增扇区
              </button>
              <button
                type="button"
                className={`icon-button${confirmReset ? " danger" : ""}`}
                onClick={resetSectors}
                onBlur={() => setConfirmReset(false)}
                title="把扇区恢复成出厂默认映射（会清掉自定义扇区与手填词）"
              >
                <RotateCcw size={16} /> {confirmReset ? "再点一次确认恢复" : "恢复默认"}
              </button>
              {sectors.length >= MAX_SECTORS && (
                <span className="wheel-sector-cap">已达上限 {MAX_SECTORS} 个扇区，再多标签就不易读清了</span>
              )}
              <datalist id="wheel-category-suggestions">
                {categories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </details>
          </>
        )}
      </div>
    </section>
  );
});

export default LuckyWheelPanel;
