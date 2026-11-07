import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronUp, Folder, Loader2 } from "lucide-react";

import { ModalFrame } from "../../ui";
import { joinPath, normalizeDir } from "../../../lib/imageManager";

export type RootDirDialogProps = {
  initialDir: string;
  detectedDir: string;
  detectedExists: boolean;
  drives: string[];
  onClose: () => void;
  onApply: (dir: string) => void;
};

/**
 * 根目录选择器：可自由浏览全盘（只读），确认后写服务端 data/image-settings.json。
 * 刻意不复用 /xyz/fs/folders——两套目录语义混用会让「上级/子目录」行为不一致。
 */
export function RootDirDialog({
  initialDir,
  detectedDir,
  detectedExists,
  drives,
  onClose,
  onApply,
}: RootDirDialogProps) {
  const [dir, setDir] = useState("");
  const [input, setInput] = useState(normalizeDir(initialDir));
  const [folders, setFolders] = useState<string[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const booted = useRef(false);

  const browse = useCallback(async (target: string) => {
    const next = normalizeDir(target);
    if (!next) return;
    setLoading(true);
    setError("");
    const request = async (path: string) => {
      const response = await fetch(`/xyz/images/browse?dir=${encodeURIComponent(path)}`);
      return (await response.json()) as {
        success?: boolean;
        dir?: string;
        parent?: string | null;
        folders?: string[];
        error?: string;
        nearest?: string;
      };
    };
    try {
      let data = await request(next);
      if (!data.success) {
        const nearest = normalizeDir(data.nearest ?? "");
        if (nearest && nearest !== next) data = await request(nearest);
      }
      if (!data.success) {
        setError(data.error || "目录读取失败");
        return;
      }
      setDir(data.dir ?? next);
      setInput(data.dir ?? next);
      setFolders(data.folders ?? []);
      setParent(data.parent ?? null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const start = normalizeDir(initialDir) || normalizeDir(detectedDir);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 首次打开时自动浏览初始目录
    if (start) void browse(start);
  }, [initialDir, detectedDir, browse]);

  return (
    <ModalFrame title="选择默认根目录" onClose={onClose} className="im-root-dialog">
      <div className="im-dialog-body">
        <section>
          <h4>检测到的 ComfyUI 输出目录</h4>
          {detectedDir ? (
            <div className="im-detect-row">
              <code title={detectedDir}>{detectedDir}</code>
              <span className={`im-detect-state${detectedExists ? " is-ok" : " is-bad"}`}>
                {detectedExists ? "本机可用" : "本机不存在"}
              </span>
              <button type="button" className="secondary-action" disabled={!detectedExists} onClick={() => void browse(detectedDir)}>
                转到
              </button>
              <button type="button" className="primary-action" disabled={!detectedExists} onClick={() => onApply(detectedDir)}>
                用这个
              </button>
            </div>
          ) : (
            <p className="im-muted">未探测到（ComfyUI 不在本机，或启动参数里没有可解析的目录）。</p>
          )}
        </section>

        <section>
          <h4>浏览文件夹</h4>
          <div className="im-dialog-path">
            <input
              value={input}
              spellCheck={false}
              placeholder="F:\AIimg\ComfyUI\output"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void browse(input);
              }}
            />
            <button type="button" className="secondary-action" disabled={loading} onClick={() => void browse(input)}>
              {loading ? <Loader2 size={14} className="spin" /> : "转到"}
            </button>
          </div>

          {drives.length > 0 && (
            <div className="im-drives">
              {drives.map((drive) => (
                <button key={drive} type="button" className="ghost-btn" onClick={() => void browse(drive)}>
                  {drive}
                </button>
              ))}
            </div>
          )}

          <div className="im-dialog-list">
            <button
              type="button"
              className="im-folder"
              disabled={!parent || loading}
              onClick={() => parent && void browse(parent)}
            >
              <ChevronUp size={14} />
              <span>上一级</span>
            </button>
            {folders.map((name) => (
              <button
                key={name}
                type="button"
                className="im-folder"
                title={joinPath(dir, name)}
                onClick={() => void browse(joinPath(dir, name))}
              >
                <Folder size={14} />
                <span>{name}</span>
              </button>
            ))}
            {!loading && folders.length === 0 && <p className="im-muted im-side-empty">（无子文件夹）</p>}
          </div>
          {error && <p className="im-error">{error}</p>}
        </section>
      </div>

      <div className="im-dialog-foot">
        <span className="im-muted">
          当前：<code>{dir || "—"}</code>
        </span>
        <span className="im-spacer" />
        <button type="button" className="secondary-action" onClick={onClose}>
          取消
        </button>
        <button type="button" className="primary-action" disabled={!dir} onClick={() => onApply(dir)}>
          设为默认根目录
        </button>
      </div>
    </ModalFrame>
  );
}
