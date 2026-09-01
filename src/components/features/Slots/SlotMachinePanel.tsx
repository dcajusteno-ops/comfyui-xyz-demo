import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Copy,
  Dices,
  Lock,
  Plus,
  Send,
  Sparkles,
  Shuffle,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { PanelTitle } from "../../ui";
import { templateLabels } from "../../../constants";
import type { TemplateKind } from "../../../types";
import {
  DEFAULT_SLOT_CONFIGS,
  buildSlotPool,
  drawFromPool,
  isCandidateRecord,
  joinSlotTags,
  normalizeCategory,
  rollSlots,
  type SlotConfig,
  type SlotRecord,
} from "../../../lib/slotMachine";

interface SlotMachinePanelProps {
  onApplyPrompt: (tags: string[], target: TemplateKind) => void;
}

type HistoryItem = { time: number; tags: SlotRecord[] };

/** 模块级词库缓存：所有实例共享，避免重复拉取 6.4MB 的 JSON。 */
let libraryCache: SlotRecord[] | null = null;

async function loadLibrary(): Promise<SlotRecord[]> {
  if (libraryCache) return libraryCache;
  const response = await fetch("/data/prompt-library/all_prompts_merged.cleaned.json");
  if (!response.ok) throw new Error(`词库加载失败（HTTP ${response.status}）`);
  const data: unknown = await response.json();
  const records = Array.isArray(data) ? data.filter(isCandidateRecord) : [];
  libraryCache = records;
  return records;
}

export const SlotMachinePanel = React.memo(({ onApplyPrompt }: SlotMachinePanelProps) => {
  const [records, setRecords] = useState<SlotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [slots, setSlots] = useState<SlotConfig[]>(() =>
    DEFAULT_SLOT_CONFIGS.map((slot) => ({ ...slot }))
  );
  const [tagsBySlot, setTagsBySlot] = useState<Record<string, SlotRecord[]>>({});
  const tagsRef = useRef<Record<string, SlotRecord[]>>({});
  const [rolling, setRolling] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [target, setTarget] = useState<TemplateKind>("default");
  const [copied, setCopied] = useState(false);
  const [copiedKey, setCopiedKey] = useState<number | null>(null);
  const spinTimerRef = useRef<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError("");
    loadLibrary()
      .then(setRecords)
      .catch((error) => setLoadError(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    return () => {
      if (spinTimerRef.current !== null) {
        window.clearInterval(spinTimerRef.current);
      }
    };
  }, [load]);

  const setTags = useCallback((next: Record<string, SlotRecord[]>) => {
    setTagsBySlot(next);
    tagsRef.current = next;
  }, []);

  const visibleTags = useMemo(() => {
    const all: SlotRecord[] = [];
    for (const slot of slots) {
      if (!slot.enabled) continue;
      all.push(...(tagsBySlot[slot.id] ?? []));
    }
    return all;
  }, [slots, tagsBySlot]);

  const enrichedTags = useMemo(() => {
     const all: { tag: SlotRecord; slotId: string; slotIndex: number }[] = [];
     slots.forEach((slot, index) => {
       if (!slot.enabled) return;
       (tagsBySlot[slot.id] ?? []).forEach((tag) => {
         all.push({ tag, slotId: slot.id, slotIndex: index });
       });
     });
     return all;
   }, [slots, tagsBySlot]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const record of records) {
      if (record.category) set.add(record.category);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [records]);

  const slotPool = useCallback(
    (config: SlotConfig) => buildSlotPool(records, config.categories),
    [records]
  );

  // 每个词槽的示例词（词池前 3 条），用于空态展示，让卡片不再"空"
  const poolHints = useMemo(() => {
    const hints: Record<string, SlotRecord[]> = {};
    for (const slot of slots) {
      hints[slot.id] = buildSlotPool(records, slot.categories).slice(0, 3);
    }
    return hints;
  }, [records, slots]);

  const updateSlot = useCallback((id: string, patch: Partial<SlotConfig>) => {
    setSlots((prev) => prev.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)));
  }, []);

  const roll = useCallback(() => {
    if (records.length === 0 || rolling) return;
    setRolling(true);

    const unlocked = slots.filter((slot) => slot.enabled && !slot.locked);
    const pools = new Map(unlocked.map((slot) => [slot.id, slotPool(slot)]));

    spinTimerRef.current = window.setInterval(() => {
      const next = { ...tagsRef.current };
      for (const slot of unlocked) {
        const pool = pools.get(slot.id) ?? [];
        next[slot.id] = drawFromPool(pool, Math.max(1, slot.count), new Set());
      }
      setTags(next);
    }, 90);

    window.setTimeout(() => {
      if (spinTimerRef.current !== null) {
        window.clearInterval(spinTimerRef.current);
        spinTimerRef.current = null;
      }
      const { draws } = rollSlots(slots, records);
      const final = { ...tagsRef.current };
      const merged: SlotRecord[] = [];
      for (const slot of slots) {
        if (!slot.enabled) continue;
        const draw = draws.find((entry) => entry.slotId === slot.id);
        if (draw) final[slot.id] = draw.tags;
        merged.push(...(final[slot.id] ?? []));
      }
      setTags(final);
      setHistory((prev) => [{ time: Date.now(), tags: merged }, ...prev].slice(0, 20));
      setRolling(false);
    }, 700);
  }, [records, rolling, slots, slotPool, setTags]);

  // 空格 / 回车快捷摇奖（输入框聚焦时不触发）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.code !== "Enter") return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
        return;
      }
      event.preventDefault();
      roll();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [roll]);

  const toggleLock = useCallback(
    (id: string) => {
      const slot = slots.find((entry) => entry.id === id);
      if (slot) updateSlot(id, { locked: !slot.locked });
    },
    [slots, updateSlot]
  );

  const removeTag = useCallback(
    (slotId: string, textEn: string) => {
      setTags({
        ...tagsRef.current,
        [slotId]: (tagsRef.current[slotId] ?? []).filter((tag) => tag.text_en !== textEn),
      });
    },
    [setTags]
  );

  const clearTags = useCallback(() => {
    setTags({});
  }, [setTags]);

  const apply = useCallback(() => {
    if (visibleTags.length === 0) return;
    onApplyPrompt(
      visibleTags.map((tag) => tag.text_en),
      target
    );
  }, [visibleTags, target, onApplyPrompt]);

  const copyTags = useCallback(async () => {
    const text = joinSlotTags(visibleTags);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  }, [visibleTags]);

  const restore = useCallback(
    (tags: SlotRecord[]) => {
      const next: Record<string, SlotRecord[]> = {};
      for (const slot of slots) {
        next[slot.id] = tags.filter((tag) =>
          slot.categories.some(
            (category) => normalizeCategory(category) === normalizeCategory(tag.category ?? "")
          )
        );
      }
      setTags(next);
    },
    [slots, setTags]
  );

  const copyHistory = useCallback(async (item: HistoryItem) => {
    const text = joinSlotTags(item.tags);
    if (!text) return;
    restore(item.tags);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(item.time);
      window.setTimeout(() => setCopiedKey((prev) => (prev === item.time ? null : prev)), 1500);
    } catch {
      /* 剪贴板不可用时静默失败，回填仍然生效 */
    }
  }, [restore]);

  const addCustomSlot = useCallback(() => {
    setSlots((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        label: `自定义${prev.length - DEFAULT_SLOT_CONFIGS.length + 1}`,
        categories: [],
        enabled: true,
        locked: false,
        count: 1,
      },
    ]);
  }, []);

  const removeCustomSlot = useCallback((id: string) => {
    setSlots((prev) => prev.filter((slot) => slot.id !== id));
    setTags(Object.fromEntries(Object.entries(tagsRef.current).filter(([key]) => key !== id)));
  }, [setTags]);

  const isCustomSlot = useCallback(
    (id: string) => !DEFAULT_SLOT_CONFIGS.some((slot) => slot.id === id),
    []
  );

  return (
    <section className="panel slots-panel">
      <div className="panel-header">
        <PanelTitle icon={Dices} title="灵感老虎机" />
      </div>
      <div className="panel-body slots-body">
        {loading && <div className="slots-status">正在加载词库（约 1.7 万词条）…</div>}

        {!loading && loadError && (
          <div className="slots-status is-error">
            <p>{loadError}</p>
            <button type="button" className="icon-button" onClick={load}>
              <Sparkles size={16} /> 重试
            </button>
          </div>
        )}

        {!loading && !loadError && (
          <>
            <div className="slots-row-grid">
              {slots.map((slot, index) => (
                <div
                  key={slot.id}
                  className={`slot-card${slot.enabled ? "" : " is-off"}${slot.locked ? " is-locked" : ""}`}
                  style={{ "--slot-accent": `var(--char-${(index % 6) + 1})` } as CSSProperties}
                >
                  <div className="slot-card-head">
                    <strong>{slot.label}</strong>
                    <button
                      type="button"
                      className="slot-lock"
                      title={slot.locked ? `解锁「${slot.label}」` : `锁定「${slot.label}」`}
                      onClick={() => toggleLock(slot.id)}
                    >
                      {slot.locked ? <Lock size={14} /> : <Unlock size={14} />}
                    </button>
                  </div>
                  <div className={`slot-window${rolling ? " is-spinning" : ""}`}>
                    {(tagsBySlot[slot.id] ?? []).length > 0 ? (
                      (tagsBySlot[slot.id] ?? []).map((tag) => (
                        <span
                          key={tag.text_en}
                          className="slot-window-tag"
                          title={tag.text_zh ? `${tag.text_en}（${tag.text_zh}）` : tag.text_en}
                        >
                          <span className="slot-window-tag-text">{tag.text_en}</span>
                          {tag.text_zh ? <em>{tag.text_zh}</em> : null}
                        </span>
                      ))
                    ) : (
                      <div className="slot-window-empty">
                        {!slot.enabled ? (
                          <span className="slot-window-hint">已停用</span>
                        ) : slot.locked ? (
                          <span className="slot-window-hint">
                            <Lock size={13} /> 已锁定
                          </span>
                        ) : rolling ? (
                          <span className="slot-window-hint is-rolling">
                            <Shuffle size={13} className="spin" /> 转动中…
                          </span>
                        ) : (
                          <>
                            <span className="slot-window-hint">
                              <Dices size={13} /> 等待拉杆
                            </span>
                            {poolHints[slot.id]?.length > 0 && (
                              <div className="slot-hint-tags">
                                {poolHints[slot.id].map((record) => (
                                  <span key={record.text_en} className="slot-hint-tag">
                                    {record.text_en}
                                  </span>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="slot-card-meta">
                    <span title={slot.categories.join(", ")}>
                      {slot.categories.slice(0, 2).join(" / ") || "未配置分类"}
                    </span>
                    <span>{slot.count} 个</span>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="primary-action slots-lever"
              onClick={roll}
              disabled={rolling || records.length === 0}
            >
              {rolling ? <Shuffle size={20} className="spin" /> : <Sparkles size={20} />}
              {rolling ? "转动中…" : "拉杆"}
              <kbd>空格</kbd>
            </button>

            <div className="slots-result">
              {enrichedTags.length === 0 ? (
                <span className="slots-empty-hint">
                  <Dices size={14} />
                  拉杆摇出的词条会出现在这里，点「应用」进入提示词框
                </span>
              ) : (
                enrichedTags.map(({ tag, slotId, slotIndex }, index) => (
                  <span
                    className="slot-tag-chip"
                    key={`${index}-${tag.text_en}`}
                    title={tag.text_zh ? `${tag.text_en}：${tag.text_zh}` : tag.text_en}
                    style={{ "--slot-accent": `var(--char-${(slotIndex % 6) + 1})` } as CSSProperties}
                  >
                    <span className="slot-tag-text">{tag.text_en}</span>
                    {tag.text_zh && <em className="slot-tag-zh">{tag.text_zh}</em>}
                    <button
                      type="button"
                      className="slot-tag-remove"
                      title="移除该词条"
                      onClick={() => removeTag(slotId, tag.text_en)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))
              )}
            </div>

            <div className="slots-apply-bar">
              <select
                className="slots-target"
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
              <button type="button" className="icon-button" disabled={visibleTags.length === 0} onClick={copyTags}>
                <Copy size={16} /> {copied ? "已复制" : "复制"}
              </button>
              <button type="button" className="icon-button danger" disabled={visibleTags.length === 0} onClick={clearTags}>
                <Trash2 size={16} /> 清空
              </button>
            </div>

            {history.length > 0 && (
              <div className="slots-history">
                <h4>历史（最近 {history.length} 次，点击复制并回填）</h4>
                {history.map((item, index) => {
                  const isCopied = copiedKey === item.time;
                  const joined = joinSlotTags(item.tags);
                  return (
                    <button
                      key={item.time}
                      type="button"
                      className={`slots-history-item${isCopied ? " is-copied" : ""}`}
                      title={`${new Date(item.time).toLocaleTimeString()} · 点击复制到剪贴板并回填`}
                      onClick={() => copyHistory(item)}
                    >
                      <span className="slots-history-text">
                        {index + 1}. {joined}
                      </span>
                      <span className="slots-history-meta">
                        {new Date(item.time).toLocaleTimeString()}
                        <Copy size={12} />
                        {isCopied ? "已复制" : "复制"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <details className="slots-advanced">
              <summary>词槽高级配置</summary>
              <div className="slots-adv-list">
                {slots.map((slot) => (
                  <div className="slots-adv-row" key={slot.id}>
                    <input
                      className="slots-adv-name"
                      value={slot.label}
                      onChange={(event) => updateSlot(slot.id, { label: event.target.value })}
                    />
                    <input
                      className="slots-adv-cats"
                      list="slots-category-suggestions"
                      placeholder="分类，逗号分隔（如：人物, face）"
                      value={slot.categories.join(", ")}
                      onChange={(event) =>
                        updateSlot(slot.id, {
                          categories: event.target.value
                            .split(/[,，]/)
                            .map((part) => part.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                    <select
                      className="slots-adv-count"
                      value={slot.count}
                      onChange={(event) => updateSlot(slot.id, { count: Number(event.target.value) })}
                      title="每次抽取词条数"
                    >
                      <option value={1}>1 个</option>
                      <option value={2}>2 个</option>
                    </select>
                    <label className="slots-adv-enable">
                      <input
                        type="checkbox"
                        checked={slot.enabled}
                        onChange={(event) => updateSlot(slot.id, { enabled: event.target.checked })}
                      />
                      启用
                    </label>
                    {isCustomSlot(slot.id) && (
                      <button
                        type="button"
                        className="icon-button danger"
                        onClick={() => removeCustomSlot(slot.id)}
                        title="删除此自定义槽"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" className="icon-button" onClick={addCustomSlot}>
                <Plus size={16} /> 新增自定义槽
              </button>
              <datalist id="slots-category-suggestions">
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

export default SlotMachinePanel;