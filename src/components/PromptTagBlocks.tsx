import React, { useMemo } from 'react';
import { parsePromptTags, adjustWeightForTag, PromptTag } from '../lib/promptUtils';

interface PromptTagBlocksProps {
  value: string;
  onChange: (value: string) => void;
}

export function PromptTagBlocks({ value, onChange }: PromptTagBlocksProps) {
  const tags = useMemo(() => parsePromptTags(value), [value]);

  if (tags.length === 0) return null;

  const handleAdjust = (tag: PromptTag, delta: number) => {
    const newText = adjustWeightForTag(value, tag, delta);
    onChange(newText);
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px', maxHeight: '150px', overflowY: 'auto', padding: '4px' }}>
      {tags.map((tag, i) => (
        <div key={`${tag.start}-${i}`} style={{ 
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
              style={{ padding: '0 6px', border: 'none', backgroundColor: 'rgba(255,255,255,0.05)', cursor: 'pointer', color: 'var(--text)', borderRight: '1px solid var(--border)' }}
            >
              +
            </button>
            <button 
              type="button" 
              onClick={(e) => { e.preventDefault(); handleAdjust(tag, -0.1); }}
              onMouseDown={(e) => e.preventDefault()}
              style={{ padding: '0 6px', border: 'none', backgroundColor: 'rgba(255,255,255,0.05)', cursor: 'pointer', color: 'var(--text)' }}
            >
              -
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
