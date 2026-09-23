import { useId, useState } from "react";
import { ChevronUp, FolderOpen, Loader2 } from "lucide-react";

/**
 * 目录选择器（T10-①）：文本输入 + 一键列出当前目录下的子目录（点选追加一级）。
 * 数据来自 server/fsBrowse.ts 的只读接口 `/xyz/fs/folders`，不改任何提交逻辑——
 * 最终落进工作流的仍然是路径字符串。
 */
export function FolderField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const listId = useId();
  const [folders, setFolders] = useState<string[]>([]);
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function browse(target?: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/xyz/fs/folders?path=${encodeURIComponent(target ?? value.trim())}`);
      const data = (await res.json()) as {
        success?: boolean;
        path?: string;
        parent?: string | null;
        folders?: string[];
        error?: string;
      };
      if (!data.success) setError(data.error ?? "目录读取失败");
      setFolders(data.folders ?? []);
      setBrowsePath(data.path ?? null);
      setParentPath(data.parent ?? null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }

  const appendFolder = (name: string) => {
    const base = value.trim();
    const joined = base ? `${base.replace(/[\\/]+$/, "")}\\${name}` : name;
    onChange(`${joined}\\`);
  };

  return (
    <label className="field">
      <span>{label}</span>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          list={listId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          style={{ flex: 1, minWidth: 0 }}
        />
        <datalist id={listId}>
          {folders.map((name) => (
            <option key={name} value={`${value.trim().replace(/[\\/]+$/, "")}\\${name}\\`} />
          ))}
        </datalist>
        <button
          type="button"
          className="secondary-action"
          style={{ padding: "6px 8px", flexShrink: 0 }}
          disabled={loading}
          title="浏览该目录下的子目录"
          onClick={() => (browsePath && !error ? browse(browsePath) : void browse())}
        >
          {loading ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />}
        </button>
      </div>

      {browsePath && !error && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
          {parentPath && (
            <button
              type="button"
              className="lm-text-btn"
              title={`上一级：${parentPath}`}
              onClick={() => {
                onChange(parentPath.endsWith("\\") || parentPath.endsWith("/") ? parentPath : `${parentPath}\\`);
                void browse(parentPath);
              }}
            >
              <ChevronUp size={12} /> 上一级
            </button>
          )}
          {folders.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>（无子目录）</span>}
          {folders.map((name) => (
            <button
              key={name}
              type="button"
              className="lm-text-btn"
              title={`进入 ${name}`}
              onClick={() => {
                appendFolder(name);
                void browse(`${browsePath.replace(/[\\/]+$/, "")}\\${name}`);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {error && <span style={{ fontSize: 12, color: "var(--danger, #dc2626)" }}>{error}</span>}
    </label>
  );
}
