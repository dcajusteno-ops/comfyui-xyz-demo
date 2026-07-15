import { useState, useEffect, useMemo, useRef } from "react";
import { useLocalStorageState } from "../hooks/useLocalStorageState";
import { Sparkles, X, Plus, Search, Bookmark, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Heart, Copy, Globe2, Upload } from "lucide-react";
import { handlePromptWeightAdjustment } from "../lib/promptUtils";
import { PromptTagBlocks } from "./PromptTagBlocks";
import { translateText, defaultTranslationSettings } from "../lib/translation";
import type { TranslationSettings } from "../lib/translation";

export type PromptEntry = {
  id: string;
  source: string;
  category: string;
  subcategory: string;
  scope: string;
  text_en: string;
  text_zh: string;
  search_text?: string;
};

export type PromptTemplate = {
  id: string;
  name: string;
  category: string;
  positive: string;
  negative: string;
};

export type EditorPart = {
  key: string;
  entryId: string;
  text: string;
  textZh: string;
  source: string;
  category: string;
};

const positivePresetPacks = [
  { id: 'portrait', name: '人物基础', terms: ['masterpiece', 'best quality', '1girl', 'detailed face', 'soft lighting'] },
  { id: 'cinematic', name: '电影感', terms: ['cinematic lighting', 'dramatic shadows', 'depth of field', 'film grain', 'high contrast'] },
  { id: 'camera', name: '镜头语言', terms: ['close-up', '85mm lens', 'bokeh', 'dynamic composition', 'sharp focus'] },
  { id: 'illustration', name: '插画细节', terms: ['highly detailed', 'clean lineart', 'delicate texture', 'rich colors', 'beautiful composition'] },
];

const negativePresetPacks = [
  { id: 'common', name: '通用负面', terms: ['low quality', 'worst quality', 'blurry', 'bad anatomy', 'text', 'watermark'] },
  { id: 'handfix', name: '手部修正', terms: ['bad hands', 'extra fingers', 'missing fingers', 'mutated hands', 'poorly drawn hands'] },
  { id: 'facefix', name: '面部修正', terms: ['deformed face', 'bad eyes', 'cross-eyed', 'extra eyes', 'poorly drawn face'] },
  { id: 'artifact', name: '杂项瑕疵', terms: ['jpeg artifacts', 'cropped', 'duplicate', 'out of frame', 'extra limbs'] },
];

export function PromptEditorDialog({ 
  open, 
  onClose,
  initialPositive = "",
  initialNegative = "",
  onApply
}: { 
  open: boolean; 
  onClose: () => void;
  initialPositive?: string;
  initialNegative?: string;
  onApply?: (positive: string, negative: string) => void;
}) {
  const [entries, setEntries] = useState<PromptEntry[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [customEntries, setCustomEntries] = useState<PromptEntry[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/prompts")
      .then(r => r.json())
      .then(res => {
        if (res.success && res.data) {
          setFavorites(res.data.favorites || []);
          setRecents(res.data.recents || []);
          setCustomEntries(res.data.customEntries || []);
          setTemplates(res.data.templates || []);
        }
      })
      .catch(e => console.error("Failed to load prompts state", e))
      .finally(() => setDataLoaded(true));
  }, []);

  const firstLoadRef = useRef(true);
  useEffect(() => {
    if (!dataLoaded) return;
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorites, recents, customEntries, templates })
      }).catch(e => console.error("Failed to save state", e));
    }, 500);
    return () => clearTimeout(timer);
  }, [favorites, recents, customEntries, templates, dataLoaded]);

  const [customForm, setCustomForm] = useState({ text_zh: "", text_en: "", category: "我的词库" });
  const [templateForm, setTemplateForm] = useState({ name: "", category: "我的模板" });
  const [importForm, setImportForm] = useState({ text: "", open: false });
  const [importingNetwork, setImportingNetwork] = useState(false);
  const [importUrl, setImportUrl] = useState("");

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const [activeSource, setActiveSource] = useState("");
  const [activeSubcategory, setActiveSubcategory] = useState("");
  const [activeScope, setActiveScope] = useState("");
  const [viewMode, setViewMode] = useState<"all" | "favorites" | "recent" | "templates">("all");
  const [activeEditor, setActiveEditor] = useState<"positive" | "negative">("positive");
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(12);

  const [positiveBase, setPositiveBase] = useState(initialPositive);
  const [negativeBase, setNegativeBase] = useState(initialNegative);
  const [positiveParts, setPositiveParts] = useState<EditorPart[]>([]);
  const [negativeParts, setNegativeParts] = useState<EditorPart[]>([]);
  const [quickInput, setQuickInput] = useState("");
  const [translationSettings] = useLocalStorageState<TranslationSettings>("comfyui_translation_settings", defaultTranslationSettings);
  const [isTranslating, setIsTranslating] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleTranslate = async (direction: "zh2en" | "en2zh" = "zh2en") => {
    const val = activeEditor === "positive" ? positiveBase : negativeBase;
    const setter = activeEditor === "positive" ? setPositiveBase : setNegativeBase;
    
    if (!val.trim() || isTranslating) return;
    setIsTranslating(true);
    try {
      const translated = await translateText(val, translationSettings, direction);
      setter(translated);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTranslating(false);
    }
  };

  const handleAdjust = (delta: number) => {
    if (!textareaRef.current) return;
    const target = textareaRef.current;
    const e = {
      ctrlKey: true,
      key: delta > 0 ? "ArrowUp" : "ArrowDown",
      preventDefault: () => {},
      target: target
    } as unknown as React.KeyboardEvent<HTMLTextAreaElement>;
    
    const val = activeEditor === "positive" ? positiveBase : negativeBase;
    const setter = activeEditor === "positive" ? setPositiveBase : setNegativeBase;
    handlePromptWeightAdjustment(e, val, setter);
    target.focus();
  };

  useEffect(() => {
    if (open && entries.length === 0) {
      setLoading(true);
      fetch("/data/prompt-library/all_prompts_merged.cleaned.json")
        .then(res => res.json())
        .then(data => {
          setEntries(data || []);
          setLoading(false);
        })
        .catch(err => {
          console.error("Failed to load prompt dictionary", err);
          setLoading(false);
        });
    }
  }, [open, entries.length]);

  useEffect(() => {
    if (open) {
      setPositiveBase(initialPositive);
      setNegativeBase(initialNegative);
      setPositiveParts([]);
      setNegativeParts([]);
    }
  }, [open, initialPositive, initialNegative]);

  const allEntries = useMemo(() => [...customEntries, ...entries], [customEntries, entries]);

  const filteredForSource = useMemo(() => {
    let list = allEntries;
    if (viewMode === "favorites") {
      const favSet = new Set(favorites);
      list = list.filter(e => favSet.has(e.id));
    } else if (viewMode === "recent") {
      const recSet = new Set(recents);
      list = list.filter(e => recSet.has(e.id));
    } else if (viewMode === "templates") {
      list = templates.map(t => ({
        id: t.id,
        source: "我的模板",
        category: t.category,
        subcategory: "模板",
        scope: "default",
        text_en: t.positive,
        text_zh: t.name,
        search_text: t.negative
      }));
    }
    return list;
  }, [allEntries, viewMode, favorites, recents, templates]);

  const filteredForCategory = useMemo(() => {
    let list = filteredForSource;
    if (activeSource) list = list.filter(e => (e.source || "未分类") === activeSource);
    return list;
  }, [filteredForSource, activeSource]);

  const filteredForSubcategory = useMemo(() => {
    let list = filteredForCategory;
    if (activeCategory) list = list.filter(e => (e.category || "未分类") === activeCategory);
    return list;
  }, [filteredForCategory, activeCategory]);

  const filteredForScope = useMemo(() => {
    let list = filteredForSubcategory;
    if (activeSubcategory) list = list.filter(e => (e.subcategory || "未分类") === activeSubcategory);
    return list;
  }, [filteredForSubcategory, activeSubcategory]);

  const { sources, categories, subcategories, scopes } = useMemo(() => {
    const sMap = new Map<string, number>();
    const cMap = new Map<string, number>();
    const subMap = new Map<string, number>();
    const scMap = new Map<string, number>();

    filteredForSource.forEach(e => {
      const s = e.source || "未分类"; sMap.set(s, (sMap.get(s) || 0) + 1);
    });

    filteredForCategory.forEach(e => {
      const c = e.category || "未分类"; cMap.set(c, (cMap.get(c) || 0) + 1);
    });

    filteredForSubcategory.forEach(e => {
      const sub = e.subcategory || "未分类"; subMap.set(sub, (subMap.get(sub) || 0) + 1);
    });

    filteredForScope.forEach(e => {
      const sc = e.scope || "default"; scMap.set(sc, (scMap.get(sc) || 0) + 1);
    });

    const sortMap = (m: Map<string, number>) => Array.from(m.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    return {
      sources: sortMap(sMap),
      categories: sortMap(cMap),
      subcategories: sortMap(subMap),
      scopes: sortMap(scMap),
    };
  }, [filteredForSource, filteredForCategory, filteredForSubcategory, filteredForScope]);

  const filteredEntries = useMemo(() => {
    let list = filteredForScope;
    if (activeScope) list = list.filter(e => (e.scope || "default") === activeScope);

    if (search.trim()) {
      const keywords = search.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter(e => {
        const haystack = `${e.text_en} ${e.text_zh} ${e.search_text || ""}`.toLowerCase();
        return keywords.every(kw => haystack.includes(kw));
      });
    }

    if (viewMode === "recent") {
      const rank = new Map(recents.map((id, i) => [id, i]));
      list.sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999));
    }

    return list;
  }, [filteredForScope, activeScope, search, viewMode, recents]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / itemsPerPage));
  const paginated = useMemo(() => {
    const start = (page - 1) * itemsPerPage;
    return filteredEntries.slice(start, start + itemsPerPage);
  }, [filteredEntries, page, itemsPerPage]);

  const handleToggleFav = (id: string) => {
    setFavorites(prev => prev.includes(id) ? prev.filter(x => x !== id) : [id, ...prev]);
  };

  const handleRemember = (id: string) => {
    setRecents(prev => [id, ...prev.filter(x => x !== id)].slice(0, 100));
  };

  const addPart = (entry: PromptEntry) => {
    if (viewMode === "templates") {
      if (entry.text_en) setPositiveBase(prev => prev ? prev + ", " + entry.text_en : entry.text_en);
      if (entry.search_text) setNegativeBase(prev => prev ? prev + ", " + entry.search_text : (entry.search_text || ""));
      return;
    }

    if (!entry.text_en) return;
    const part: EditorPart = {
      key: `${entry.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      entryId: entry.id,
      text: entry.text_en,
      textZh: entry.text_zh,
      source: entry.source,
      category: entry.category,
    };
    if (activeEditor === "positive") {
      setPositiveParts(prev => [...prev, part]);
    } else {
      setNegativeParts(prev => [...prev, part]);
    }
    handleRemember(entry.id);
  };

  const addManual = () => {
    const terms = quickInput.split(/[,，\n]/).map(t => t.trim()).filter(Boolean);
    if (!terms.length) return;
    const parts = terms.map(t => ({
      key: `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      entryId: "",
      text: t,
      textZh: "",
      source: "manual",
      category: "",
    }));
    if (activeEditor === "positive") {
      setPositiveParts(prev => [...prev, ...parts]);
    } else {
      setNegativeParts(prev => [...prev, ...parts]);
    }
    setQuickInput("");
  };

  const removePart = (key: string, isPositive: boolean) => {
    if (isPositive) {
      setPositiveParts(prev => prev.filter(p => p.key !== key));
    } else {
      setNegativeParts(prev => prev.filter(p => p.key !== key));
    }
  };

  const applyPresetPack = (pack: { terms: string[] }, isPositive: boolean) => {
    const parts = isPositive ? positiveParts : negativeParts;
    const seen = new Set(parts.map(p => p.text.toLowerCase().trim()));
    const newParts = pack.terms.filter(t => !seen.has(t.toLowerCase().trim())).map(t => ({
      key: `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      entryId: "",
      text: t,
      textZh: "",
      source: "manual",
      category: "",
    }));
    
    if (isPositive) {
      setPositiveParts(prev => [...prev, ...newParts]);
    } else {
      setNegativeParts(prev => [...prev, ...newParts]);
    }
  };

  const dedupeParts = (isPositive: boolean) => {
    const parts = isPositive ? positiveParts : negativeParts;
    const seen = new Set<string>();
    const next = parts.filter(p => {
      const key = p.text.toLowerCase().trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (isPositive) {
      setPositiveParts(next);
    } else {
      setNegativeParts(next);
    }
  };

  const movePart = (index: number, direction: 'up' | 'down', isPositive: boolean) => {
    const parts = isPositive ? [...positiveParts] : [...negativeParts];
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= parts.length) return;
    [parts[index], parts[nextIndex]] = [parts[nextIndex], parts[index]];
    if (isPositive) {
      setPositiveParts(parts);
    } else {
      setNegativeParts(parts);
    }
  };

  const handleSaveCustomPrompt = () => {
    if (!customForm.text_en && !customForm.text_zh) return;
    const newEntry: PromptEntry = {
      id: `custom-${Date.now()}`,
      source: "我的词库",
      category: customForm.category.trim() || "未分类",
      subcategory: "",
      scope: "default",
      text_en: customForm.text_en.trim(),
      text_zh: customForm.text_zh.trim(),
    };
    setCustomEntries(prev => [newEntry, ...prev]);
    setCustomForm({ text_zh: "", text_en: "", category: "我的词库" });
  };

  const handleBatchImport = () => {
    if (!importForm.text.trim()) return;
    const lines = importForm.text.split('\n').filter(Boolean);
    const newCustoms: PromptEntry[] = [];
    lines.forEach(line => {
      const parts = line.split(/[,\t，]/).map(s => s.trim());
      if (parts.length >= 2) {
        newCustoms.push({
          id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          source: "我的词库",
          category: parts[2] || "批量导入",
          subcategory: "",
          scope: "default",
          text_zh: parts[0],
          text_en: parts[1],
        });
      }
    });
    setCustomEntries(prev => [...newCustoms, ...prev]);
    setImportForm({ text: "", open: false });
  };

  const handleLocalFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      if (!content) return;
      if (file.name.endsWith('.json')) {
        try {
          const data = JSON.parse(content);
          if (!Array.isArray(data)) throw new Error("JSON must be an array");
          const newCustoms = data.map((item: any) => ({
             id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
             source: item.source || "本地文件",
             category: item.category || "未分类",
             subcategory: item.subcategory || "",
             scope: item.scope || "default",
             text_en: item.text_en || "",
             text_zh: item.text_zh || item.name || ""
          })).filter((x: any) => x.text_en || x.text_zh);
          setCustomEntries(prev => [...newCustoms, ...prev]);
          alert(`成功导入 ${newCustoms.length} 条词条`);
        } catch (err: any) {
          alert("JSON 解析失败: " + err.message);
        }
      } else {
        const lines = content.split('\n').filter(Boolean);
        const newCustoms: PromptEntry[] = [];
        lines.forEach(line => {
          const parts = line.split(/[,\t，]/).map(s => s.trim());
          if (parts.length >= 2) {
            newCustoms.push({
              id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              source: "本地文件",
              category: parts[2] || "批量导入",
              subcategory: "",
              scope: "default",
              text_zh: parts[0],
              text_en: parts[1],
            });
          }
        });
        setCustomEntries(prev => [...newCustoms, ...prev]);
        alert(`成功导入 ${newCustoms.length} 条词条`);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleDeleteCustom = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCustomEntries(prev => prev.filter(x => x.id !== id));
  };

  const finalPositive = [positiveBase, ...positiveParts.map(p => p.text)].filter(Boolean).join(", ");
  const finalNegative = [negativeBase, ...negativeParts.map(p => p.text)].filter(Boolean).join(", ");

  const handleSaveTemplate = (type: "positive" | "negative" | "combo") => {
    if (!templateForm.name) return;
    const newTemplate: PromptTemplate = {
      id: `template-${Date.now()}`,
      name: templateForm.name,
      category: templateForm.category || "我的模板",
      positive: (type === "combo" || type === "positive") ? finalPositive : "",
      negative: (type === "combo" || type === "negative") ? finalNegative : ""
    };
    setTemplates(prev => [newTemplate, ...prev]);
    setTemplateForm({ name: "", category: "我的模板" });
  };

  const handleNetworkImport = async () => {
    if (!importUrl.trim()) return;
    setImportingNetwork(true);
    try {
      const res = await fetch(importUrl);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("JSON format must be an array");
      const newCustoms: PromptEntry[] = data.map((item: any) => ({
        id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        source: item.source || "网络导入",
        category: item.category || "未分类",
        subcategory: item.subcategory || "",
        scope: item.scope || "default",
        text_en: item.text_en || "",
        text_zh: item.text_zh || item.name || ""
      })).filter(x => x.text_en || x.text_zh);
      setCustomEntries(prev => [...newCustoms, ...prev]);
      alert(`成功导入 ${newCustoms.length} 条网络词条`);
      setImportUrl("");
    } catch (err: any) {
      alert("网络导入失败: " + err.message);
    } finally {
      setImportingNetwork(false);
    }
  };

  const handleApply = () => {
    if (onApply) {
      onApply(finalPositive, finalNegative);
    }
    onClose();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
  };

  if (!open) return null;

  return (
    <div className="prompt-editor-overlay" style={{ position: "fixed", inset: 0, backgroundColor: "rgba(31, 42, 68, 0.4)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
      <div className="prompt-editor-dialog" style={{ width: "95vw", height: "90vh", maxWidth: "1400px", backgroundColor: "var(--surface)", borderRadius: "12px", border: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden", color: "var(--text)", boxShadow: "var(--shadow)" }}>
        
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.5rem", borderBottom: "1px solid var(--border)", backgroundColor: "var(--surface)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ backgroundColor: "var(--accent-soft)", padding: "0.4rem", borderRadius: "8px", color: "var(--accent)" }}><Sparkles size={20} /></div>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 600, color: "var(--text)" }}>提示词编辑器</h2>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "2px" }}>Stable Diffusion 提示词优化工具 · 词库 {allEntries.length} 条</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button className="icon-button" onClick={() => copyToClipboard(finalPositive + "\\n" + finalNegative)} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}><Copy size={16} /> 复制全部</button>
            <button className="primary-action" onClick={handleApply}>完成并应用</button>
            <button className="icon-button" onClick={onClose} style={{ border: "none" }}><X size={20} /></button>
          </div>
        </div>

        {/* Content */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          
          {/* Left Sidebar - Library */}
          <div style={{ width: "260px", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", backgroundColor: "var(--surface-alt)" }}>
            <div style={{ padding: "1rem" }}>
              <h3 style={{ fontSize: "0.9rem", color: "var(--muted)", margin: "0 0 1rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}><Bookmark size={16} /> 灵动词库</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <button onClick={() => { setViewMode("all"); setPage(1); }} style={{ padding: "0.6rem 1rem", textAlign: "left", background: viewMode === "all" ? "var(--surface)" : "transparent", border: viewMode === "all" ? "1px solid var(--border)" : "1px solid transparent", color: viewMode === "all" ? "var(--accent)" : "var(--text)", borderRadius: "6px", cursor: "pointer", fontWeight: viewMode === "all" ? 600 : 400 }}>所有词条</button>
                <button onClick={() => { setViewMode("templates"); setPage(1); }} style={{ padding: "0.6rem 1rem", textAlign: "left", background: viewMode === "templates" ? "var(--surface)" : "transparent", border: viewMode === "templates" ? "1px solid var(--border)" : "1px solid transparent", color: viewMode === "templates" ? "var(--accent)" : "var(--text)", borderRadius: "6px", cursor: "pointer", fontWeight: viewMode === "templates" ? 600 : 400, display: "flex", justifyContent: "space-between" }}><span>组合模板</span><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{templates.length}</span></button>
                <button onClick={() => { setViewMode("recent"); setPage(1); }} style={{ padding: "0.6rem 1rem", textAlign: "left", background: viewMode === "recent" ? "var(--surface)" : "transparent", border: viewMode === "recent" ? "1px solid var(--border)" : "1px solid transparent", color: viewMode === "recent" ? "var(--accent)" : "var(--text)", borderRadius: "6px", cursor: "pointer", fontWeight: viewMode === "recent" ? 600 : 400, display: "flex", justifyContent: "space-between" }}><span>近期使用</span><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{recents.length}</span></button>
                <button onClick={() => { setViewMode("favorites"); setPage(1); }} style={{ padding: "0.6rem 1rem", textAlign: "left", background: viewMode === "favorites" ? "var(--surface)" : "transparent", border: viewMode === "favorites" ? "1px solid var(--border)" : "1px solid transparent", color: viewMode === "favorites" ? "var(--accent)" : "var(--text)", borderRadius: "6px", cursor: "pointer", fontWeight: viewMode === "favorites" ? 600 : 400, display: "flex", justifyContent: "space-between" }}><span>我的收藏</span><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{favorites.length}</span></button>
              </div>
            </div>
            
            <div style={{ padding: "1rem", borderTop: "1px solid var(--border)", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
              {importForm.open ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", height: "100%" }}>
                  <div style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>批量导入词库</span>
                    <button onClick={() => setImportForm(p => ({ ...p, open: false }))} style={{ background: "none", border: "none", color: "var(--text)", cursor: "pointer" }}><X size={14} /></button>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>格式: <code>中文, 英文, 分类</code> (每行一条)</div>
                  <textarea value={importForm.text} onChange={e => setImportForm(p => ({ ...p, text: e.target.value }))} style={{ flex: 1, padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "0.8rem", resize: "none" }} />
                  <button onClick={handleBatchImport} style={{ padding: "0.4rem", borderRadius: "6px", border: "1px solid var(--accent)", backgroundColor: "var(--accent-soft)", color: "var(--accent)", fontSize: "0.8rem", cursor: "pointer" }}>确认导入</button>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 600 }}>词库管理</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <button onClick={() => setImportForm(p => ({ ...p, open: true }))} style={{ flex: 1, padding: "0.4rem", fontSize: "0.8rem", borderRadius: "6px", border: "1px dashed var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer", textAlign: "left" }}>+ 批量导入词条</button>
                      <label style={{ flex: 1, padding: "0.4rem", fontSize: "0.8rem", borderRadius: "6px", border: "1px dashed var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.25rem" }}>
                        <Upload size={14} /> 上传文件
                        <input type="file" accept=".txt,.csv,.json" onChange={handleLocalFileImport} style={{ display: "none" }} />
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.25rem" }}>
                      <input value={importUrl} onChange={e => setImportUrl(e.target.value)} placeholder="网络词库 JSON URL" style={{ flex: 1, padding: "0.4rem", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "0.75rem" }} />
                      <button onClick={handleNetworkImport} disabled={importingNetwork || !importUrl.trim()} style={{ padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "0.75rem", cursor: "pointer", opacity: (importingNetwork || !importUrl.trim()) ? 0.5 : 1 }}>
                        {importingNetwork ? "..." : "导入"}
                      </button>
                    </div>
                    <button onClick={() => { if (confirm("确定要清空自定义词库吗？")) setCustomEntries([]); }} style={{ padding: "0.4rem", fontSize: "0.8rem", borderRadius: "6px", border: "1px solid var(--danger)", background: "rgba(210, 75, 75, 0.1)", color: "var(--danger)", cursor: "pointer", textAlign: "left", marginTop: "0.5rem" }}>清空所有自定义词条</button>
                  </div>
                </>
              )}
            </div>

            <div style={{ padding: "1rem", borderTop: "1px solid var(--border)", backgroundColor: "var(--surface)" }}>
              <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem", fontWeight: 600 }}>添加到我的词库</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <input value={customForm.text_en} onChange={e => setCustomForm(p => ({...p, text_en: e.target.value}))} placeholder="英文提示词" style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface-alt)", color: "var(--text)", fontSize: "0.8rem" }} />
                <input value={customForm.text_zh} onChange={e => setCustomForm(p => ({...p, text_zh: e.target.value}))} placeholder="中文提示词" style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface-alt)", color: "var(--text)", fontSize: "0.8rem" }} />
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input value={customForm.category} onChange={e => setCustomForm(p => ({...p, category: e.target.value}))} placeholder="分类 (默认: 我的词库)" style={{ flex: 1, padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface-alt)", color: "var(--text)", fontSize: "0.8rem" }} />
                  <button onClick={handleSaveCustomPrompt} disabled={!customForm.text_en && !customForm.text_zh} style={{ padding: "0 0.6rem", borderRadius: "6px", border: "1px solid var(--accent)", backgroundColor: "var(--accent-soft)", color: "var(--accent)", fontSize: "0.8rem", cursor: "pointer", opacity: (!customForm.text_en && !customForm.text_zh) ? 0.5 : 1 }}>保存</button>
                </div>
              </div>
            </div>
          </div>

          {/* Middle - Dictionary Results */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", backgroundColor: "var(--surface)" }}>
            <div style={{ padding: "1rem", borderBottom: "1px solid var(--border)", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ position: "relative", flex: 1, minWidth: "150px" }}>
                <Search size={18} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
                <input 
                  value={search} 
                  onChange={e => { setSearch(e.target.value); setPage(1); }} 
                  placeholder="搜索中英文词条..." 
                  style={{ width: "100%", padding: "0.5rem 1rem 0.5rem 2.5rem", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "0.9rem" }} 
                />
              </div>
              
              <select value={activeSource} onChange={e => { setActiveSource(e.target.value); setPage(1); }} style={{ padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "0.85rem", minWidth: "100px" }}>
                <option value="">全部来源</option>
                {sources.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
              
              <select value={activeCategory} onChange={e => { setActiveCategory(e.target.value); setPage(1); }} style={{ padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "0.85rem", minWidth: "100px" }}>
                <option value="">全部分类</option>
                {categories.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
              
              <select value={activeSubcategory} onChange={e => { setActiveSubcategory(e.target.value); setPage(1); }} style={{ padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "0.85rem", minWidth: "100px" }}>
                <option value="">全部子分类</option>
                {subcategories.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
              
              <select value={activeScope} onChange={e => { setActiveScope(e.target.value); setPage(1); }} style={{ padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "0.85rem", minWidth: "100px" }}>
                <option value="">全部作用域</option>
                {scopes.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "1rem", position: "relative" }}>
              {loading ? (
                <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>加载词库中...</div>
              ) : paginated.length === 0 ? (
                <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>没有找到匹配的词条</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "0.75rem" }}>
                  {paginated.map(entry => (
                    <div key={entry.id} onClick={() => addPart(entry)} style={{ padding: "0.8rem", backgroundColor: "var(--surface-alt)", borderRadius: "8px", border: "1px solid var(--border)", cursor: "pointer", position: "relative", transition: "all 0.2s" }} onMouseEnter={e => e.currentTarget.style.borderColor = "var(--border-strong)"} onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.25rem" }}>
                        <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "80%" }} title={entry.text_en}>{entry.text_en}</div>
                        <div style={{ display: "flex", gap: "0.2rem" }}>
                          {entry.id.startsWith('custom-') && (
                            <button onClick={(e) => handleDeleteCustom(entry.id, e)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }} title="删除自定义词条">
                              <X size={16} />
                            </button>
                          )}
                          {entry.id.startsWith('template-') && (
                            <button onClick={(e) => { e.stopPropagation(); setTemplates(prev => prev.filter(t => t.id !== entry.id)); }} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }} title="删除模板">
                              <X size={16} />
                            </button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); handleToggleFav(entry.id); }} style={{ background: "none", border: "none", color: favorites.includes(entry.id) ? "var(--danger)" : "var(--muted)", cursor: "pointer", padding: 0 }}>
                            <Heart size={16} fill={favorites.includes(entry.id) ? "var(--danger)" : "none"} />
                          </button>
                        </div>
                      </div>
                      <div style={{ fontSize: "0.85rem", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.text_zh || "-"}</div>
                      <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.4rem" }}>
                        <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.4rem", backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: "4px", color: "var(--muted)" }}>{entry.category || "未分类"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pagination */}
            <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "var(--surface-alt)" }}>
              <div style={{ fontSize: "0.85rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: "1rem" }}>
                <span>共 {filteredEntries.length} 条结果</span>
                <select value={itemsPerPage} onChange={e => { setItemsPerPage(Number(e.target.value)); setPage(1); }} style={{ padding: "0.2rem 0.5rem", borderRadius: "4px", border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "0.8rem" }}>
                  <option value={8}>8 / 页</option>
                  <option value={12}>12 / 页</option>
                  <option value={24}>24 / 页</option>
                  <option value={48}>48 / 页</option>
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <button disabled={page <= 1} onClick={() => setPage(1)} className="icon-button" style={{ border: "none", color: page <= 1 ? "var(--border)" : "var(--muted)" }}><ChevronsLeft size={16} /></button>
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="icon-button" style={{ border: "none", color: page <= 1 ? "var(--border)" : "var(--muted)" }}><ChevronLeft size={16} /></button>
                
                <div style={{ display: "flex", gap: "0.25rem", margin: "0 0.5rem" }}>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let p = page;
                    if (page < 3) p = i + 1;
                    else if (page > totalPages - 2) p = Math.max(1, totalPages - 4 + i);
                    else p = page - 2 + i;
                    if (p < 1 || p > totalPages) return null;
                    return (
                      <button key={p} onClick={() => setPage(p)} style={{ padding: "0.2rem 0.5rem", minWidth: "24px", borderRadius: "4px", border: page === p ? "1px solid var(--accent)" : "1px solid transparent", backgroundColor: page === p ? "var(--accent-soft)" : "transparent", color: page === p ? "var(--accent)" : "var(--text)", cursor: "pointer", fontSize: "0.85rem" }}>{p}</button>
                    );
                  })}
                </div>

                <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="icon-button" style={{ border: "none", color: page >= totalPages ? "var(--border)" : "var(--muted)" }}><ChevronRight size={16} /></button>
                <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="icon-button" style={{ border: "none", color: page >= totalPages ? "var(--border)" : "var(--muted)" }}><ChevronsRight size={16} /></button>
              </div>
            </div>
          </div>

          {/* Right - Editor */}
          <div style={{ width: "420px", display: "flex", flexDirection: "column", backgroundColor: "var(--surface-alt)" }}>
            <div style={{ display: "flex", padding: "1rem", gap: "0.5rem", borderBottom: "1px solid var(--border)" }}>
              <button onClick={() => setActiveEditor("positive")} style={{ flex: 1, padding: "0.6rem", borderRadius: "6px", border: activeEditor === "positive" ? "1px solid var(--accent)" : "1px solid var(--border)", backgroundColor: activeEditor === "positive" ? "var(--accent)" : "var(--surface)", color: activeEditor === "positive" ? "white" : "var(--text)", cursor: "pointer", fontWeight: activeEditor === "positive" ? 600 : 400 }}>正向编辑区</button>
              <button onClick={() => setActiveEditor("negative")} style={{ flex: 1, padding: "0.6rem", borderRadius: "6px", border: activeEditor === "negative" ? "1px solid var(--danger)" : "1px solid var(--border)", backgroundColor: activeEditor === "negative" ? "var(--danger)" : "var(--surface)", color: activeEditor === "negative" ? "white" : "var(--text)", cursor: "pointer", fontWeight: activeEditor === "negative" ? 600 : 400 }}>反向编辑区</button>
            </div>

            <div style={{ flex: 1, padding: "1rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "1rem" }}>
              
              <div>
                <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>基础 Prompt</span>
                  <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto', marginRight: '10px', alignItems: 'center' }}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.preventDefault(); handleTranslate("zh2en"); }} style={{ padding: '0 8px', height: '22px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--accent)', background: 'var(--accent-soft)', cursor: isTranslating ? 'wait' : 'pointer', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '4px', marginRight: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      <Globe2 size={12} />
                      {isTranslating ? "翻译中..." : "翻译为英文"}
                    </button>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.preventDefault(); handleTranslate("en2zh"); }} style={{ padding: '0 8px', height: '22px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--accent)', background: 'var(--accent-soft)', cursor: isTranslating ? 'wait' : 'pointer', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '4px', marginRight: '8px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      <Globe2 size={12} />
                      {isTranslating ? "翻译中..." : "翻译为中文"}
                    </button>
                    <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 'normal', marginRight: '4px' }}>权重:</span>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleAdjust(0.1)} style={{ padding: '0 6px', height: '22px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-alt)', cursor: 'pointer', color: 'var(--text)' }}>+0.1</button>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleAdjust(-0.1)} style={{ padding: '0 6px', height: '22px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-alt)', cursor: 'pointer', color: 'var(--text)' }}>-0.1</button>
                  </div>
                  <button onClick={() => activeEditor === "positive" ? setPositiveBase("") : setNegativeBase("")} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "0.8rem", cursor: "pointer", padding: 0 }}>清空</button>
                </div>
                <textarea 
                  ref={textareaRef}
                  value={activeEditor === "positive" ? positiveBase : negativeBase}
                  onChange={e => activeEditor === "positive" ? setPositiveBase(e.target.value) : setNegativeBase(e.target.value)}
                  onKeyDown={e => {
                    const val = activeEditor === "positive" ? positiveBase : negativeBase;
                    const setter = activeEditor === "positive" ? setPositiveBase : setNegativeBase;
                    handlePromptWeightAdjustment(e, val, setter);
                  }}
                  placeholder="可直接粘贴当前项目的 Prompt..."
                  style={{ width: "100%", height: "100px", padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "0.9rem", resize: "none", fontFamily: "monospace" }}
                />
                <div style={{ marginTop: '8px' }}>
                  <PromptTagBlocks 
                    value={activeEditor === "positive" ? positiveBase : negativeBase}
                    onChange={e => activeEditor === "positive" ? setPositiveBase(e) : setNegativeBase(e)}
                  />
                </div>
              </div>

              <div>
                <div style={{ padding: "0.5rem", backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", marginBottom: "1rem" }}>
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.5rem" }}>常用预设词包</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    {(activeEditor === "positive" ? positivePresetPacks : negativePresetPacks).map(pack => (
                      <button 
                        key={pack.id} 
                        onClick={() => applyPresetPack(pack, activeEditor === "positive")}
                        style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem", borderRadius: "100px", border: "1px solid var(--border)", background: "var(--surface-alt)", color: "var(--text)", cursor: "pointer" }}
                      >
                        {pack.name}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem" }}>手动补充词条，支持逗号分隔</div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input 
                    value={quickInput}
                    onChange={e => setQuickInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addManual()}
                    placeholder="例如: masterpiece, best quality"
                    style={{ flex: 1, padding: "0.6rem 0.8rem", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "0.9rem" }}
                  />
                  <button onClick={addManual} className="icon-button" style={{ padding: "0 1rem" }}><Plus size={16} /></button>
                </div>
              </div>

              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem", display: "flex", justifyContent: "space-between" }}>
                  <span>已选词条 ({activeEditor === "positive" ? positiveParts.length : negativeParts.length} 条)</span>
                  <div style={{ display: "flex", gap: "1rem" }}>
                    <button onClick={() => dedupeParts(activeEditor === "positive")} style={{ background: "none", border: "none", color: "var(--accent)", fontSize: "0.8rem", cursor: "pointer", padding: 0 }}>去重</button>
                    <button onClick={() => activeEditor === "positive" ? setPositiveParts([]) : setNegativeParts([])} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "0.8rem", cursor: "pointer", padding: 0 }}>清空</button>
                  </div>
                </div>
                
                <div style={{ flex: 1, border: "1px dashed var(--border-strong)", borderRadius: "8px", padding: "0.75rem", backgroundColor: "var(--surface)", display: "flex", flexWrap: "wrap", gap: "0.4rem", alignContent: "flex-start", minHeight: "150px", overflowY: "auto" }}>
                  {(activeEditor === "positive" ? positiveParts : negativeParts).map((part, index) => (
                    <div key={part.key} style={{ display: "inline-flex", alignItems: "stretch", backgroundColor: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
                      <div style={{ padding: "0.3rem 0.6rem", fontSize: "0.85rem", color: "var(--text)" }} title={part.textZh || part.text}>
                        {part.text}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)" }}>
                        <button onClick={() => movePart(index, 'up', activeEditor === "positive")} disabled={index === 0} style={{ padding: "0 0.2rem", height: "12px", background: "none", border: "none", borderBottom: "1px solid var(--border)", fontSize: "0.55rem", color: "var(--muted)", cursor: index === 0 ? "default" : "pointer", opacity: index === 0 ? 0.3 : 1 }}>▲</button>
                        <button onClick={() => movePart(index, 'down', activeEditor === "positive")} disabled={index === (activeEditor === "positive" ? positiveParts : negativeParts).length - 1} style={{ padding: "0 0.2rem", height: "12px", background: "none", border: "none", fontSize: "0.55rem", color: "var(--muted)", cursor: index === (activeEditor === "positive" ? positiveParts : negativeParts).length - 1 ? "default" : "pointer", opacity: index === (activeEditor === "positive" ? positiveParts : negativeParts).length - 1 ? 0.3 : 1 }}>▼</button>
                      </div>
                      <button onClick={() => removePart(part.key, activeEditor === "positive")} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 0.4rem", backgroundColor: "rgba(210, 75, 75, 0.1)", color: "var(--danger)", border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer" }}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {(activeEditor === "positive" ? positiveParts : negativeParts).length === 0 && (
                    <div style={{ width: "100%", textAlign: "center", color: "var(--muted)", marginTop: "2rem", fontSize: "0.9rem" }}>还没有加入词条。在左侧点击词条即可添加。</div>
                  )}
                </div>
              </div>

              <div>
                <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem", display: "flex", justifyContent: "space-between" }}>
                  <span>最终 {activeEditor === "positive" ? "正向" : "反向"} Prompt</span>
                  <button onClick={() => copyToClipboard(activeEditor === "positive" ? finalPositive : finalNegative)} style={{ background: "none", border: "none", color: "var(--accent)", fontSize: "0.8rem", cursor: "pointer", padding: 0 }}>复制</button>
                </div>
                <div style={{ width: "100%", height: "120px", padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--accent)", backgroundColor: "var(--accent-soft)", color: "var(--text)", fontSize: "0.85rem", overflowY: "auto", wordBreak: "break-all", fontFamily: "monospace", marginBottom: "1rem" }}>
                  {activeEditor === "positive" ? finalPositive : finalNegative}
                </div>
                
                <div style={{ padding: "1rem", backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <span style={{ fontSize: "0.85rem", color: "var(--muted)", whiteSpace: "nowrap" }}>保存模板:</span>
                    <input value={templateForm.name} onChange={e => setTemplateForm(p => ({...p, name: e.target.value}))} placeholder="模板名称" style={{ flex: 1, padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface-alt)", color: "var(--text)", fontSize: "0.8rem" }} />
                    <input value={templateForm.category} onChange={e => setTemplateForm(p => ({...p, category: e.target.value}))} placeholder="分类" style={{ width: "80px", padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--surface-alt)", color: "var(--text)", fontSize: "0.8rem" }} />
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button onClick={() => handleSaveTemplate('positive')} disabled={!templateForm.name} style={{ flex: 1, padding: "0.4rem", borderRadius: "6px", border: "1px solid var(--accent)", backgroundColor: "transparent", color: "var(--accent)", fontSize: "0.8rem", cursor: "pointer", opacity: !templateForm.name ? 0.5 : 1 }}>存为正向</button>
                    <button onClick={() => handleSaveTemplate('negative')} disabled={!templateForm.name} style={{ flex: 1, padding: "0.4rem", borderRadius: "6px", border: "1px solid var(--danger)", backgroundColor: "transparent", color: "var(--danger)", fontSize: "0.8rem", cursor: "pointer", opacity: !templateForm.name ? 0.5 : 1 }}>存为反向</button>
                    <button onClick={() => handleSaveTemplate('combo')} disabled={!templateForm.name} style={{ flex: 1, padding: "0.4rem", borderRadius: "6px", border: "1px solid var(--accent)", backgroundColor: "var(--accent-soft)", color: "var(--accent)", fontSize: "0.8rem", cursor: "pointer", opacity: !templateForm.name ? 0.5 : 1 }}>存为组合</button>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
