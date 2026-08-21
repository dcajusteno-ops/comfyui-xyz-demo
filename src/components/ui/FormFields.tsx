import { useRef, useState } from "react";
import { CheckCircle2, Copy, Globe2 } from "lucide-react";
import { handlePromptWeightAdjustment } from "../../lib/promptUtils";
import { translateText, defaultTranslationSettings } from "../../lib/translation";
import type { TranslationSettings } from "../../lib/translation";
import { useLocalStorageState } from "../../hooks/useLocalStorageState";
import { PromptTagBlocks } from "../PromptTagBlocks";

export function NumberField({ label, value, min, max, step, disabled, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export function TextField({ label, value, placeholder, disabled, onChange }: { label: string; value: string; placeholder?: string; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" value={value} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function SelectField({ label, value, options, onChange }: { 
  label: string; 
  value: string; 
  options: (string | { label: string; value: string })[]; 
  onChange: (value: string) => void 
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const val = typeof option === 'string' ? option : option.value;
          const lab = typeof option === 'string' ? option : option.label;
          return <option key={val} value={val}>{lab}</option>;
        })}
      </select>
    </label>
  );
}

export function MultiSelectField({ label, value, options, onChange }: { 
  label: string; 
  value: string; 
  options: { label: string; value: string }[]; 
  onChange: (value: string) => void 
}) {
  const selectedValues = value.split(',').filter(v => v && v !== 'none');
  
  const toggleValue = (val: string) => {
    if (val === 'none') {
      onChange('none');
      return;
    }
  
    let newValues: string[];
    if (selectedValues.includes(val)) {
      newValues = selectedValues.filter(v => v !== val);
    } else {
      newValues = [...selectedValues, val];
    }
  
    if (newValues.length === 0) {
      onChange('none');
    } else {
      onChange(newValues.join(','));
    }
  };

  return (
    <div className="field" style={{ gridColumn: 'span 3', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
      <span style={{ fontWeight: 'bold', fontSize: '13px', color: 'var(--muted)' }}>{label} (可多选组合)</span>
      <div style={{ 
        display: 'flex', 
        flexWrap: 'wrap', 
        gap: '6px', 
        background: 'var(--surface-alt)', 
        padding: '10px', 
        borderRadius: '8px',
        border: '1px solid var(--border)',
        maxHeight: '200px',
        overflowY: 'auto'
      }}>
        {options.map((option) => {
          const isSelected = option.value === 'none' ? selectedValues.length === 0 : selectedValues.includes(option.value);
          return (
            <div 
              key={option.value}
              onClick={() => toggleValue(option.value)}
              style={{
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer',
                background: isSelected ? 'var(--accent)' : 'var(--surface)',
                color: isSelected ? 'white' : 'var(--text)',
                border: '1px solid',
                borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                transition: 'all 0.2s',
                userSelect: 'none'
              }}
            >
              {option.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CopyableTextarea({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
      <textarea className={className} style={{ flex: 1, width: "100%", resize: "none" }} value={value} readOnly />
      {value && (
        <button 
          type="button"
          onClick={handleCopy} 
          title="复制"
          style={{ 
            position: "absolute", top: "8px", right: "16px", 
            background: "var(--surface)", border: "1px solid var(--border)", 
            color: "var(--muted)", borderRadius: "4px", padding: "4px 8px", 
            cursor: "pointer", display: "flex", alignItems: "center", gap: "4px", fontSize: "12px",
            backdropFilter: "blur(4px)"
          }}>
          {copied ? <CheckCircle2 size={14} color="var(--accent)" /> : <Copy size={14} />}
          {copied ? "已复制" : "复制"}
        </button>
      )}
    </div>
  );
}

export function TextAreaField({ label, value, placeholder, onChange, hideChips }: { label: string; value: string; placeholder?: string; onChange: (value: string) => void; hideChips?: boolean }) {
  const isPrompt = label.toLowerCase().includes("prompt") || label.includes("提示词");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [translationSettings] = useLocalStorageState<TranslationSettings>("comfyui_translation_settings", defaultTranslationSettings);
  const [isTranslating, setIsTranslating] = useState(false);

  const handleTranslate = async () => {
    if (!value.trim() || isTranslating) return;
    setIsTranslating(true);
    try {
      const translated = await translateText(value, translationSettings);
      onChange(translated);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div className="field text-field">
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {label}
        {isPrompt && (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.preventDefault(); handleTranslate(); }} style={{ padding: '0 8px', height: '22px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--accent)', background: 'var(--accent-soft)', cursor: isTranslating ? 'wait' : 'pointer', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '4px', marginRight: '8px' }}>
              <Globe2 size={12} />
              {isTranslating ? "翻译中..." : "翻译为英文"}
            </button>
          </div>
        )}
      </span>
      <textarea 
        ref={textareaRef}
        value={value} 
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)} 
        onKeyDown={(e) => isPrompt && handlePromptWeightAdjustment(e, value, onChange)}
      />
      {isPrompt && value.trim() && !hideChips && (
        <PromptTagBlocks value={value} onChange={onChange} />
      )}
    </div>
  );
}
