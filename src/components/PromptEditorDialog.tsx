import { useState, useEffect, useMemo } from "react";
import { useLocalStorageState } from "../hooks/useLocalStorageState";
import { Sparkles, X, Plus, Search, Bookmark, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Heart, Copy } from "lucide-react";

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

export type EditorPart = {
  key: string;
  entryId: string;
  text: string;
  textZh: string;
  source: string;
  category: string;
};

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
  
  const [favorites, setFavorites] = useLocalStorageState<string[]>("comfyui_prompt_favorites", []);
  const [recents, setRecents] = useLocalStorageState<string[]>("comfyui_prompt_recents", []);
  const [customEntries] = useLocalStorageState<PromptEntry[]>("comfyui_prompt_custom", []);

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const [viewMode, setViewMode] = useState<"all" | "favorites" | "recent">("all");
  const [activeEditor, setActiveEditor] = useState<"positive" | "negative">("positive");
  const [page, setPage] = useState(1);
  const [itemsPerPage] = useState(12);

  const [positiveBase, setPositiveBase] = useState(initialPositive);
  const [negativeBase, setNegativeBase] = useState(initialNegative);
  const [positiveParts, setPositiveParts] = useState<EditorPart[]>([]);
  const [negativeParts, setNegativeParts] = useState<EditorPart[]>([]);
  const [quickInput, setQuickInput] = useState("");

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

  const categories = useMemo(() => {
    const counter = new Map<string, number>();
    allEntries.forEach(e => {
      const c = e.category || "未分类";
      counter.set(c, (counter.get(c) || 0) + 1);
    });
    return Array.from(counter.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [allEntries]);

  const filteredEntries = useMemo(() => {
    let list = allEntries;
    if (viewMode === "favorites") {
      const favSet = new Set(favorites);
      list = list.filter(e => favSet.has(e.id));
    } else if (viewMode === "recent") {
      const recSet = new Set(recents);
      list = list.filter(e => recSet.has(e.id));
      const rank = new Map(recents.map((id, i) => [id, i]));
      list.sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999));
    }

    if (activeCategory) {
      list = list.filter(e => (e.category || "未分类") === activeCategory);
    }

    if (search.trim()) {
      const keywords = search.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter(e => {
        const haystack = `${e.text_en} ${e.text_zh} ${e.search_text || ""}`.toLowerCase();
        return keywords.every(kw => haystack.includes(kw));
      });
    }

    return list;
  }, [allEntries, viewMode, favorites, recents, activeCategory, search]);

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

  const finalPositive = [positiveBase, ...positiveParts.map(p => p.text)].filter(Boolean).join(", ");
  const finalNegative = [negativeBase, ...negativeParts.map(p => p.text)].filter(Boolean).join(", ");

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
                <button onClick={() => { setViewMode("recent"); setPage(1); }} style={{ padding: "0.6rem 1rem", textAlign: "left", background: viewMode === "recent" ? "var(--surface)" : "transparent", border: viewMode === "recent" ? "1px solid var(--border)" : "1px solid transparent", color: viewMode === "recent" ? "var(--accent)" : "var(--text)", borderRadius: "6px", cursor: "pointer", fontWeight: viewMode === "recent" ? 600 : 400, display: "flex", justifyContent: "space-between" }}><span>近期使用</span><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{recents.length}</span></button>
                <button onClick={() => { setViewMode("favorites"); setPage(1); }} style={{ padding: "0.6rem 1rem", textAlign: "left", background: viewMode === "favorites" ? "var(--surface)" : "transparent", border: viewMode === "favorites" ? "1px solid var(--border)" : "1px solid transparent", color: viewMode === "favorites" ? "var(--accent)" : "var(--text)", borderRadius: "6px", cursor: "pointer", fontWeight: viewMode === "favorites" ? 600 : 400, display: "flex", justifyContent: "space-between" }}><span>我的收藏</span><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{favorites.length}</span></button>
              </div>
            </div>
            
            <div style={{ padding: "1rem", borderTop: "1px solid var(--border)", flex: 1, overflowY: "auto" }}>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.75rem", fontWeight: 600 }}>热门分类</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                <button 
                  onClick={() => { setActiveCategory(""); setPage(1); }} 
                  style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem", borderRadius: "100px", border: activeCategory === "" ? "1px solid var(--accent)" : "1px solid var(--border)", background: activeCategory === "" ? "var(--accent-soft)" : "var(--surface)", color: activeCategory === "" ? "var(--accent)" : "var(--text)", cursor: "pointer" }}
                >
                  全部
                </button>
                {categories.slice(0, 20).map(cat => (
                  <button 
                    key={cat.name} 
                    onClick={() => { setActiveCategory(cat.name); setPage(1); }} 
                    style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem", borderRadius: "100px", border: activeCategory === cat.name ? "1px solid var(--accent)" : "1px solid var(--border)", background: activeCategory === cat.name ? "var(--accent-soft)" : "var(--surface)", color: activeCategory === cat.name ? "var(--accent)" : "var(--text)", cursor: "pointer" }}
                  >
                    {cat.name} <span style={{ opacity: 0.7, fontSize: "0.7rem", marginLeft: "2px" }}>{cat.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Middle - Dictionary Results */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", backgroundColor: "var(--surface)" }}>
            <div style={{ padding: "1rem", borderBottom: "1px solid var(--border)", display: "flex", gap: "1rem" }}>
              <div style={{ position: "relative", flex: 1 }}>
                <Search size={18} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
                <input 
                  value={search} 
                  onChange={e => { setSearch(e.target.value); setPage(1); }} 
                  placeholder="搜索中英文词条..." 
                  style={{ width: "100%", padding: "0.75rem 1rem 0.75rem 2.5rem", borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "0.95rem" }} 
                />
              </div>
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
                        <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "80%" }}>{entry.text_en}</div>
                        <button onClick={(e) => { e.stopPropagation(); handleToggleFav(entry.id); }} style={{ background: "none", border: "none", color: favorites.includes(entry.id) ? "var(--danger)" : "var(--muted)", cursor: "pointer", padding: 0 }}>
                          <Heart size={16} fill={favorites.includes(entry.id) ? "var(--danger)" : "none"} />
                        </button>
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
              <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>共 {filteredEntries.length} 条结果</div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <button disabled={page <= 1} onClick={() => setPage(1)} className="icon-button" style={{ border: "none", color: page <= 1 ? "var(--border)" : "var(--muted)" }}><ChevronsLeft size={18} /></button>
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="icon-button" style={{ border: "none", color: page <= 1 ? "var(--border)" : "var(--muted)" }}><ChevronLeft size={18} /></button>
                <span style={{ margin: "0 0.5rem", fontSize: "0.85rem", color: "var(--text)" }}>{page} / {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="icon-button" style={{ border: "none", color: page >= totalPages ? "var(--border)" : "var(--muted)" }}><ChevronRight size={18} /></button>
                <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="icon-button" style={{ border: "none", color: page >= totalPages ? "var(--border)" : "var(--muted)" }}><ChevronsRight size={18} /></button>
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
                <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem", display: "flex", justifyContent: "space-between" }}>
                  <span>基础 Prompt</span>
                  <button onClick={() => activeEditor === "positive" ? setPositiveBase("") : setNegativeBase("")} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "0.8rem", cursor: "pointer", padding: 0 }}>清空</button>
                </div>
                <textarea 
                  value={activeEditor === "positive" ? positiveBase : negativeBase}
                  onChange={e => activeEditor === "positive" ? setPositiveBase(e.target.value) : setNegativeBase(e.target.value)}
                  placeholder="可直接粘贴当前项目的 Prompt..."
                  style={{ width: "100%", height: "100px", padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "0.9rem", resize: "none", fontFamily: "monospace" }}
                />
              </div>

              <div>
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
                  <button onClick={() => activeEditor === "positive" ? setPositiveParts([]) : setNegativeParts([])} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "0.8rem", cursor: "pointer", padding: 0 }}>清空</button>
                </div>
                
                <div style={{ flex: 1, border: "1px dashed var(--border-strong)", borderRadius: "8px", padding: "0.75rem", backgroundColor: "var(--surface)", display: "flex", flexWrap: "wrap", gap: "0.4rem", alignContent: "flex-start", minHeight: "150px", overflowY: "auto" }}>
                  {(activeEditor === "positive" ? positiveParts : negativeParts).map(part => (
                    <div key={part.key} style={{ display: "inline-flex", alignItems: "stretch", backgroundColor: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
                      <div style={{ padding: "0.3rem 0.6rem", fontSize: "0.85rem", color: "var(--text)" }} title={part.textZh || part.text}>
                        {part.text}
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
                <div style={{ width: "100%", height: "120px", padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--accent)", backgroundColor: "var(--accent-soft)", color: "var(--text)", fontSize: "0.85rem", overflowY: "auto", wordBreak: "break-all", fontFamily: "monospace" }}>
                  {activeEditor === "positive" ? finalPositive : finalNegative}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
