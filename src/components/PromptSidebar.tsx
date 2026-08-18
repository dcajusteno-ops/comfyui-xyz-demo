import React, { useState, useEffect, useMemo } from 'react';
import { Search, Heart, Clock, Bookmark, ChevronRight, ChevronLeft, Layout, Tag, Plus, Trash2, X } from 'lucide-react';

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

interface PromptSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (text: string, type: 'positive' | 'negative' | 'combo', target: 'positive' | 'negative') => void;
  currentPositive: string;
  currentNegative: string;
}

export function PromptSidebar({ isOpen, onClose, onSelect, currentPositive, currentNegative }: PromptSidebarProps) {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [customEntries, setCustomEntries] = useState<PromptEntry[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [dictionary, setDictionary] = useState<PromptEntry[]>([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'favorites' | 'recents' | 'templates' | 'library'>('favorites');
  const [loading, setLoading] = useState(false);
  
  // Pagination state
  const [page, setPage] = useState(1);
  const itemsPerPage = 24;

  // Custom entry form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [customForm, setCustomForm] = useState({ text_en: '', text_zh: '' });

  // Confirm dialog state
  const [confirmState, setConfirmState] = useState<{ isOpen: boolean; id: string; type: 'entry' | 'template' }>({
    isOpen: false,
    id: '',
    type: 'entry'
  });

  const handleSaveCurrent = async (target: 'positive' | 'negative') => {
    const text = target === 'positive' ? currentPositive : currentNegative;
    if (!text.trim()) return;

    const newEntry: PromptEntry = {
      id: `custom-${Date.now()}`,
      source: "我的词库",
      category: target === 'positive' ? "我的正向词" : "我的反向词",
      subcategory: "",
      scope: "default",
      text_en: text.trim(),
      text_zh: "",
    };

    const nextCustomEntries = [newEntry, ...customEntries];
    setCustomEntries(nextCustomEntries);
    setFavorites(prev => [newEntry.id, ...prev]);
    
    try {
      await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorites: [newEntry.id, ...favorites], recents, customEntries: nextCustomEntries, templates })
      });
      setActiveTab('favorites');
    } catch (e) {
      console.error("Failed to save prompt", e);
    }
  };

  const handleSaveManual = async () => {
    if (!customForm.text_en.trim() && !customForm.text_zh.trim()) return;

    const newEntry: PromptEntry = {
      id: `custom-${Date.now()}`,
      source: "我的词库",
      category: "手动添加",
      subcategory: "",
      scope: "default",
      text_en: customForm.text_en.trim(),
      text_zh: customForm.text_zh.trim(),
    };

    const nextCustomEntries = [newEntry, ...customEntries];
    setCustomEntries(nextCustomEntries);
    setFavorites(prev => [newEntry.id, ...prev]);
    
    try {
      await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorites: [newEntry.id, ...favorites], recents, customEntries: nextCustomEntries, templates })
      });
      setCustomForm({ text_en: '', text_zh: '' });
      setShowAddForm(false);
      setActiveTab('favorites');
    } catch (e) {
      console.error("Failed to save custom prompt", e);
    }
  };

  const handleDelete = async (id: string, type: 'entry' | 'template') => {
    setConfirmState({ isOpen: true, id, type });
  };

  const confirmDelete = async () => {
    const { id, type } = confirmState;
    let nextCustomEntries = customEntries;
    let nextTemplates = templates;
    let nextFavorites = favorites;

    if (type === 'entry') {
      nextCustomEntries = customEntries.filter(e => e.id !== id);
      nextFavorites = favorites.filter(fid => fid !== id);
    } else {
      nextTemplates = templates.filter(t => t.id !== id);
    }

    setCustomEntries(nextCustomEntries);
    setTemplates(nextTemplates);
    setFavorites(nextFavorites);

    try {
      await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorites: nextFavorites, recents, customEntries: nextCustomEntries, templates: nextTemplates })
      });
    } catch (e) {
      console.error("Failed to delete prompt", e);
    } finally {
      setConfirmState(prev => ({ ...prev, isOpen: false }));
    }
  };

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
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
        .finally(() => setLoading(false));

      if (dictionary.length === 0) {
        fetch("/data/prompt-library/all_prompts_merged.cleaned.json")
          .then(res => res.json())
          .then(data => setDictionary(data || []))
          .catch(err => console.error("Failed to load prompt dictionary", err));
      }
    }
  }, [isOpen]);

  const allEntries = useMemo(() => [...customEntries, ...dictionary], [customEntries, dictionary]);

  const { filteredItems, totalCount } = useMemo(() => {
    let list: any[] = [];
    if (activeTab === 'favorites') {
      const favSet = new Set(favorites);
      list = allEntries.filter(e => favSet.has(e.id));
    } else if (activeTab === 'recents') {
      const recSet = new Set(recents);
      list = allEntries.filter(e => recSet.has(e.id));
      const rank = new Map(recents.map((id, i) => [id, i]));
      list.sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999));
    } else if (activeTab === 'templates') {
      list = templates;
    } else {
      list = allEntries;
    }

    if (search.trim()) {
      const kw = search.toLowerCase();
      list = list.filter(item => {
        const text = 'name' in item 
          ? `${item.name} ${item.positive} ${item.negative}` 
          : `${item.text_en} ${item.text_zh} ${item.category}`;
        return text.toLowerCase().includes(kw);
      });
    }

    const total = list.length;
    const start = (page - 1) * itemsPerPage;
    const paginatedList = list.slice(start, start + itemsPerPage);

    return { filteredItems: paginatedList, totalCount: total };
  }, [activeTab, favorites, recents, customEntries, templates, allEntries, search, page]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, search]);

  if (!isOpen) return null;

  const totalPages = Math.ceil(totalCount / itemsPerPage);

  return (
    <div className="prompt-sidebar" style={{
      width: '320px',
      height: '100%',
      backgroundColor: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 200,
      position: 'fixed',
      right: 0,
      top: 0,
      bottom: 0,
      boxShadow: '-4px 0 12px rgba(0,0,0,0.1)'
    }}>
      <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bookmark size={18} className="text-accent" />
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>提示词仓库</h3>
        </div>
        <button className="icon-button" onClick={onClose}><X size={18} /></button>
      </div>

      <div style={{ padding: '0.75rem' }}>
        <div style={{ position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input 
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索提示词..."
            style={{ 
              width: '100%', 
              padding: '0.5rem 0.75rem 0.5rem 2rem', 
              borderRadius: '6px', 
              border: '1px solid var(--border)', 
              backgroundColor: 'var(--surface-alt)', 
              color: 'var(--text)',
              fontSize: '0.85rem'
            }}
          />
        </div>
      </div>

      <div style={{ padding: '0 0.75rem 0.75rem 0.75rem', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button 
          onClick={() => handleSaveCurrent('positive')}
          disabled={!currentPositive.trim()}
          style={{ 
            flex: 1, 
            padding: '0.4rem', 
            fontSize: '0.75rem', 
            borderRadius: '6px', 
            border: '1px solid var(--accent)', 
            backgroundColor: 'var(--accent-soft)', 
            color: 'var(--accent)',
            cursor: currentPositive.trim() ? 'pointer' : 'default',
            opacity: currentPositive.trim() ? 1 : 0.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            minWidth: '120px'
          }}
        >
          <Plus size={14} /> 收藏当前正向
        </button>
        <button 
          onClick={() => handleSaveCurrent('negative')}
          disabled={!currentNegative.trim()}
          style={{ 
            flex: 1, 
            padding: '0.4rem', 
            fontSize: '0.75rem', 
            borderRadius: '6px', 
            border: '1px solid var(--danger)', 
            backgroundColor: 'rgba(210, 75, 75, 0.1)', 
            color: 'var(--danger)',
            cursor: currentNegative.trim() ? 'pointer' : 'default',
            opacity: currentNegative.trim() ? 1 : 0.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            minWidth: '120px'
          }}
        >
          <Plus size={14} /> 收藏当前反向
        </button>
        <button 
          onClick={() => setShowAddForm(!showAddForm)}
          style={{ 
            width: '100%',
            padding: '0.4rem', 
            fontSize: '0.75rem', 
            borderRadius: '6px', 
            border: '1px dashed var(--border)', 
            backgroundColor: showAddForm ? 'var(--surface-alt)' : 'transparent', 
            color: 'var(--text)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            marginTop: '4px'
          }}
        >
          <Tag size={14} /> {showAddForm ? '取消添加' : '手动填入提示词'}
        </button>
      </div>

      {showAddForm && (
        <div style={{ padding: '0 0.75rem 0.75rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--surface-alt)' }}>
          <input 
            value={customForm.text_en}
            onChange={e => setCustomForm(p => ({ ...p, text_en: e.target.value }))}
            placeholder="英文提示词 (必填)"
            style={{ width: '100%', padding: '0.4rem', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--border)' }}
          />
          <input 
            value={customForm.text_zh}
            onChange={e => setCustomForm(p => ({ ...p, text_zh: e.target.value }))}
            placeholder="中文备注 (可选)"
            style={{ width: '100%', padding: '0.4rem', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--border)' }}
          />
          <button 
            onClick={handleSaveManual}
            disabled={!customForm.text_en.trim()}
            style={{ padding: '0.4rem', fontSize: '0.8rem', borderRadius: '4px', border: 'none', backgroundColor: 'var(--accent)', color: 'white', cursor: customForm.text_en.trim() ? 'pointer' : 'default', opacity: customForm.text_en.trim() ? 1 : 0.5 }}
          >
            保存到词库
          </button>
        </div>
      )}

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 0.5rem' }}>
        {[
          { id: 'favorites', icon: Heart, label: '收藏' },
          { id: 'templates', icon: Layout, label: '模板' },
          { id: 'recents', icon: Clock, label: '最近' },
          { id: 'library', icon: Tag, label: '词库' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              flex: 1,
              padding: '0.6rem 0.2rem',
              border: 'none',
              background: 'none',
              color: activeTab === tab.id ? 'var(--accent)' : 'var(--muted)',
              borderBottom: `2px solid ${activeTab === tab.id ? 'var(--accent)' : 'transparent'}`,
              cursor: 'pointer',
              fontSize: '0.8rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <tab.icon size={16} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>加载中...</div>
        ) : filteredItems.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
            {search ? '没有找到相关内容' : '暂无数据'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredItems.map((item) => {
              const isTemplate = 'positive' in item;
              return (
                <div 
                  key={item.id} 
                  className="sidebar-item"
                  style={{
                    padding: '0.75rem',
                    backgroundColor: 'var(--surface-alt)',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {isTemplate ? item.name : (item.text_zh || item.text_en)}
                    </div>
                    {item.id.startsWith('custom-') && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDelete(item.id, 'entry'); }}
                        style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '2px' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    {isTemplate && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDelete(item.id, 'template'); }}
                        style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '2px' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                    {isTemplate ? item.positive : item.text_en}
                  </div>
                  
                  <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
                    {isTemplate ? (
                      <>
                        <button 
                          onClick={() => onSelect(item.positive, 'positive', 'positive')}
                          style={{ flex: 1, padding: '2px 4px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', cursor: 'pointer' }}
                        >
                          应用正向
                        </button>
                        {item.negative && (
                          <button 
                            onClick={() => onSelect(item.negative, 'negative', 'negative')}
                            style={{ flex: 1, padding: '2px 4px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid var(--danger)', background: 'rgba(210, 75, 75, 0.1)', color: 'var(--danger)', cursor: 'pointer' }}
                          >
                            应用反向
                          </button>
                        )}
                        <button 
                          onClick={() => {
                            onSelect(item.positive, 'positive', 'positive');
                            if (item.negative) onSelect(item.negative, 'negative', 'negative');
                          }}
                          style={{ flex: 1, padding: '2px 4px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}
                        >
                          组合应用
                        </button>
                      </>
                    ) : (
                      <>
                        <button 
                          onClick={() => onSelect(item.text_en, 'positive', 'positive')}
                          style={{ flex: 1, padding: '2px 4px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', cursor: 'pointer' }}
                        >
                          入正向
                        </button>
                        <button 
                          onClick={() => onSelect(item.text_en, 'negative', 'negative')}
                          style={{ flex: 1, padding: '2px 4px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid var(--danger)', background: 'rgba(210, 75, 75, 0.1)', color: 'var(--danger)', cursor: 'pointer' }}
                        >
                          入反向
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ 
          padding: '0.75rem', 
          borderTop: '1px solid var(--border)', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          backgroundColor: 'var(--surface)'
        }}>
          <button 
            disabled={page === 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            style={{ 
              padding: '4px 8px', 
              fontSize: '0.75rem', 
              borderRadius: '4px', 
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-alt)',
              cursor: page === 1 ? 'default' : 'pointer',
              opacity: page === 1 ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '2px'
            }}
          >
            <ChevronLeft size={14} /> 上一页
          </button>
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            {page} / {totalPages}
          </span>
          <button 
            disabled={page === totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            style={{ 
              padding: '4px 8px', 
              fontSize: '0.75rem', 
              borderRadius: '4px', 
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-alt)',
              cursor: page === totalPages ? 'default' : 'pointer',
              opacity: page === totalPages ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '2px'
            }}
          >
            下一页 <ChevronRight size={14} />
          </button>
        </div>
      )}

      {confirmState.isOpen && (
        <div 
          style={{ 
            position: 'absolute', 
            inset: 0, 
            backgroundColor: 'rgba(0,0,0,0.5)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            zIndex: 200,
            backdropFilter: 'blur(2px)'
          }}
          onClick={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
        >
          <div 
            style={{ 
              width: '260px', 
              backgroundColor: 'var(--surface)', 
              borderRadius: '12px', 
              padding: '1.5rem', 
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
              border: '1px solid var(--border)',
              textAlign: 'center'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
              <Trash2 size={32} style={{ margin: '0 auto' }} />
            </div>
            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text)' }}>确认删除</h4>
            <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
              确定要删除这个{confirmState.type === 'entry' ? '词条' : '模板'}吗？此操作不可撤销。
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
                style={{ 
                  flex: 1, 
                  padding: '0.5rem', 
                  borderRadius: '6px', 
                  border: '1px solid var(--border)', 
                  backgroundColor: 'var(--surface-alt)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                取消
              </button>
              <button 
                onClick={confirmDelete}
                style={{ 
                  flex: 1, 
                  padding: '0.5rem', 
                  borderRadius: '6px', 
                  border: 'none', 
                  backgroundColor: 'var(--danger)',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                确定删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
