import React, { useMemo, useState } from 'react';
import { parsePromptTags, adjustWeightForTag, PromptTag } from '../lib/promptUtils';
import { translateText, defaultTranslationSettings, TranslationSettings } from '../lib/translation';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { Globe2 } from 'lucide-react';

interface PromptTagBlocksProps {
  value: string;
  onChange: (value: string) => void;
}

export function PromptTagBlocks({ value, onChange }: PromptTagBlocksProps) {
  const tags = useMemo(() => parsePromptTags(value), [value]);
  const [translationSettings] = useLocalStorageState<TranslationSettings>("comfyui_translation_settings", defaultTranslationSettings);
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [translating, setTranslating] = useState<Record<number, boolean>>({});

  if (tags.length === 0) return null;

  const handleAdjust = (tag: PromptTag, delta: number) => {
    const newText = adjustWeightForTag(value, tag, delta);
    onChange(newText);
  };

  const handleTranslateTag = async (tag: PromptTag, index: number) => {
    if (translating[index]) return;
    setTranslating(prev => ({ ...prev, [index]: true }));
    try {
      const result = await translateText(tag.word, translationSettings, "en2zh");
      setTranslations(prev => ({ ...prev, [index]: result }));
    } catch (err) {
      console.error(err);
      alert("翻译失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setTranslating(prev => ({ ...prev, [index]: false }));
    }
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px', padding: '4px' }}>
      {tags.map((tag, i) => (
        <div key={`${tag.start}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'stretch', 
            backgroundColor: 'var(--surface-alt)', 
            border: '1px solid var(--border)', 
            borderRadius: '6px', 
            overflow: 'hidden' 
          }}>
            <div style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', color: 'var(--text)', display: 'flex', alignItems: 'center' }}>
              {tag.word} {tag.weight !== 1.0 && <span style={{ marginLeft: '4px', color: 'var(--accent)', fontWeight: 600 }}>{tag.weight.toFixed(2)}</span>}
            </div>
            <div style={{ display: 'flex', borderLeft: '1px solid var(--border)' }}>
              <button 
                type="button" 
                onClick={(e) => { e.preventDefault(); handleAdjust(tag, 0.1); }}
                onMouseDown={(e) => e.preventDefault()}
                style={{ padding: '0 6px', border: 'none', backgroundColor: 'var(--tag-btn-bg)', cursor: 'pointer', color: 'var(--text)', borderRight: '1px solid var(--border)' }}
              >
                +
              </button>
              <button 
                type="button" 
                onClick={(e) => { e.preventDefault(); handleAdjust(tag, -0.1); }}
                onMouseDown={(e) => e.preventDefault()}
                style={{ padding: '0 6px', border: 'none', backgroundColor: 'var(--tag-btn-bg)', cursor: 'pointer', color: 'var(--text)', borderRight: '1px solid var(--border)' }}
              >
                -
              </button>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); handleTranslateTag(tag, i); }}
                onMouseDown={(e) => e.preventDefault()}
                style={{ padding: '0 6px', border: 'none', backgroundColor: 'var(--tag-btn-bg)', cursor: translating[i] ? 'wait' : 'pointer', color: 'var(--text)' }}
                title="翻译为中文"
              >
                <Globe2 size={12} />
              </button>
            </div>
          </div>
          {translations[i] && (
            <div style={{ fontSize: '0.75rem', color: 'var(--accent)', padding: '0 4px', textAlign: 'center' }}>
              {translations[i]}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
