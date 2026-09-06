import { useMemo, useState } from "react";
import { CircleAlert, CircleHelp, Info, ShieldCheck, Wand2 } from "lucide-react";
import { lintPrompt, type PromptLintContext } from "../../lib/promptLint";
import type { PromptLintIssue } from "../../types";

const SEVERITY_ICON = {
  error: CircleAlert,
  warning: CircleHelp,
  info: Info,
} as const;

const SEVERITY_COLOR = {
  error: "#dc2626",
  warning: "#d97706",
  info: "#64748b",
} as const;

export function PromptLintBadge({
  value,
  onChange,
  context,
  getTextarea,
}: {
  value: string;
  onChange: (text: string) => void;
  context?: PromptLintContext;
  /** 可选：返回宿主 textarea，用于"定位"跳转选中问题区间 */
  getTextarea?: () => HTMLTextAreaElement | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const issues = useMemo(() => lintPrompt(value, context), [value, context?.loraNames, context?.wildcardNames]);

  if (!value.trim()) return null;

  const topSeverity: PromptLintIssue["severity"] | null = issues.length
    ? issues.some((i) => i.severity === "error")
      ? "error"
      : issues.some((i) => i.severity === "warning")
      ? "warning"
      : "info"
    : null;

  const fixableCount = issues.filter((i) => i.fixable).length;

  const applyFix = (issue: PromptLintIssue) => {
    if (!issue.fix) return;
    onChange(issue.fix(value));
  };

  const applyAllFixes = () => {
    let next = value;
    for (const issue of issues) {
      if (issue.fix) next = issue.fix(next);
    }
    onChange(next);
  };

  const locate = (issue: PromptLintIssue) => {
    if (!getTextarea) return;
    const ta = getTextarea();
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(issue.start, issue.end);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        {topSeverity ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "3px 10px",
              fontSize: "12px",
              borderRadius: 999,
              border: `1px solid ${SEVERITY_COLOR[topSeverity]}`,
              background: `${SEVERITY_COLOR[topSeverity]}1a`,
              color: SEVERITY_COLOR[topSeverity],
              cursor: "pointer",
            }}
          >
            <ShieldCheck size={13} />
            {issues.length} 个提示
          </button>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#16a34a" }}>
            <ShieldCheck size={13} /> 无提示
          </span>
        )}
        {fixableCount > 0 && (
          <button
            type="button"
            onClick={applyAllFixes}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "2px 10px",
              fontSize: "12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface-alt)",
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            <Wand2 size={12} /> 修复可修复项（{fixableCount}）
          </button>
        )}
      </div>

      {expanded && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          {issues.map((issue, idx) => {
            const Icon = SEVERITY_ICON[issue.severity];
            return (
              <li
                key={`${issue.code}-${idx}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  color: "var(--text)",
                  padding: "4px 6px",
                  borderRadius: 6,
                  cursor: getTextarea ? "pointer" : "default",
                }}
                onClick={() => locate(issue)}
              >
                <Icon size={13} style={{ color: SEVERITY_COLOR[issue.severity], flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{issue.message}</span>
                {issue.fixable && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      applyFix(issue);
                    }}
                    style={{ fontSize: "11px", padding: "1px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--accent)", cursor: "pointer", flexShrink: 0 }}
                  >
                    修复
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}