import DOMPurify from "dompurify";
import { Copy } from "lucide-react";

export function InfoItem({ label, value, wide = false, isHtml = false, onHtmlCopy }: { label: string; value: string; wide?: boolean; isHtml?: boolean; onHtmlCopy?: (text: string) => void }) {
  if (!value) return null;
  return (
    <div className="lm-info-item" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <label>{label}</label>
      {isHtml ? (
        <div 
          className="html-content" 
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value) }} 
          onClick={(e) => {
            const target = e.target as HTMLElement;
            const block = target.closest('pre, code');
            if (block && onHtmlCopy) {
              onHtmlCopy(block.textContent || "");
            }
          }}
        />
      ) : (
        <span>{value}</span>
      )}
    </div>
  );
}

export function TagCloud({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div className="lm-tag-cloud">
      {tags.slice(0, 20).map((tag) => <span key={tag}>{tag}</span>)}
    </div>
  );
}

export function PromptBlock({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="lm-prompt-block">
      <div className="lm-section-head">
        <label>{label}</label>
        <button type="button" className="lm-text-btn" onClick={onCopy}><Copy size={13} /> 复制</button>
      </div>
      <pre>{value}</pre>
    </div>
  );
}
