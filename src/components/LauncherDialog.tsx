import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  FileText,
  FolderOpen,
  Gamepad2,
  Globe,
  Image as ImageIcon,
  Keyboard,
  Monitor,
  Music,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Terminal,
  Trash2,
  Video,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { ModalFrame } from "./ui";
import type { LauncherTool } from "../types";
import type { useUiState } from "../hooks/useUiState";
import {
  addLauncherTool,
  deleteLauncherTool,
  extractLauncherIcon,
  fetchLauncherTools,
  runLauncherTool,
  updateLauncherTool,
} from "../lib/launcherClient";

/**
 * 外部工具启动器（复刻 comfyui-demo-main 的 LauncherDialog，样式按本项目规范重写）。
 * 工具配置存在本地服务端 data/launcher-tools.json，启动动作不经过 ComfyUI——
 * **未连接服务（离线）时完全可用**。
 */

type ToastFn = (type: "success" | "error" | "info", title: string, message?: string) => void;

/** 内置图标（lucide-react，名称即选择键；与 Go/TS 端无关，仅前端展示） */
const BUILTIN_ICONS: Record<string, LucideIcon> = {
  Terminal,
  Globe,
  FolderOpen,
  ImageIcon,
  Music,
  Video,
  FileText,
  Wrench,
  Bot,
  Keyboard,
  Monitor,
  Gamepad2,
  Sparkles,
};

type FormState = {
  id: string | null; // null = 新增
  name: string;
  path: string;
  args: string;
  icon: string;
};

const EMPTY_FORM: FormState = { id: null, name: "", path: "", args: "", icon: "" };

export function LauncherDialog({
  ui,
  onToast,
  onClose,
}: {
  ui: ReturnType<typeof useUiState>;
  onToast: ToastFn;
  onClose: () => void;
}) {
  const [tools, setTools] = useState<LauncherTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  // 首次加载自包含（await 之后的 setState 不属于同步 effect，且卸载后不再写状态）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchLauncherTools();
        if (!cancelled) setTools(list);
      } catch (error) {
        if (!cancelled) onToast("error", "工具列表加载失败", error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onToast]);

  const reloadTools = useCallback(async () => {
    try {
      setTools(await fetchLauncherTools());
    } catch (error) {
      onToast("error", "工具列表加载失败", error instanceof Error ? error.message : String(error));
    }
  }, [onToast]);

  async function handleRun(tool: LauncherTool) {
    try {
      await runLauncherTool(tool.id);
      onToast("success", `已启动「${tool.name}」`);
    } catch (error) {
      onToast("error", "启动失败", error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDelete(tool: LauncherTool) {
    ui.confirm("删除外部工具", `确定要删除「${tool.name}」吗？只移除启动器里的配置，不会删除原始文件。`, () => {
      void (async () => {
        try {
          await deleteLauncherTool(tool.id);
          onToast("success", "工具已删除");
          if (form?.id === tool.id) setForm(null);
          await reloadTools();
        } catch (error) {
          onToast("error", "删除失败", error instanceof Error ? error.message : String(error));
        }
      })();
    });
  }

  async function handleSave() {
    if (!form) return;
    if (!form.name.trim() || !form.path.trim()) {
      onToast("error", "名称和路径不能为空");
      return;
    }
    setSaving(true);
    const input = { name: form.name.trim(), path: form.path.trim(), args: form.args.trim(), icon: form.icon };
    try {
      if (form.id) {
        await updateLauncherTool(form.id, input);
        onToast("success", "工具已更新");
      } else {
        await addLauncherTool(input);
        onToast("success", "工具已添加");
      }
      setForm(null);
      await reloadTools();
    } catch (error) {
      onToast("error", "保存失败", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleExtractIcon(force = false) {
    if (!form) return;
    const target = form.path.trim();
    if (!target.toLowerCase().endsWith(".exe")) return;
    // 未强制时，已有「提取的程序图标」（data URL）就不重复提取，避免覆盖用户选的内置图标
    if (!force && form.icon.startsWith("data:")) return;
    try {
      const icon = await extractLauncherIcon(target);
      setForm((prev) => (prev ? { ...prev, icon } : prev));
    } catch {
      // 提取失败静默（例如非 PE 文件），保留默认图标
    }
  }

  // 表单预览图标：内置图标渲染组件，data URL 渲染 <img>，否则默认 Terminal
  const PreviewIcon = form?.icon && BUILTIN_ICONS[form.icon] ? BUILTIN_ICONS[form.icon] : Terminal;
  const previewIsImage = Boolean(form?.icon && form.icon.startsWith("data:"));

  return createPortal(
    <ModalFrame title="外部工具" onClose={onClose}>
      <div style={{ display: "flex", gap: 14, minWidth: 720, maxWidth: 860, minHeight: 380, maxHeight: "62vh" }}>
        {/* 左：工具列表 */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>已配置工具（{tools.length}）</span>
            <button
              type="button"
              className="lm-text-btn"
              style={{ marginLeft: "auto" }}
              title="添加工具"
              onClick={() => setForm({ ...EMPTY_FORM })}
            >
              <Plus size={13} /> 添加
            </button>
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              paddingRight: 2,
            }}
          >
            {!loading && tools.length === 0 && (
              <div className="empty-state" style={{ padding: "36px 0" }}>
                <Terminal size={26} style={{ display: "block", margin: "0 auto 8px", opacity: 0.6 }} />
                暂无工具，点右上「添加」配置第一个
              </div>
            )}
            {tools.map((tool) => {
              const Builtin = tool.icon && !tool.icon.startsWith("data:") ? BUILTIN_ICONS[tool.icon] : undefined;
              return (
                <div
                  key={tool.id}
                  role="button"
                  tabIndex={0}
                  title="双击启动"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--surface-alt)",
                    cursor: "pointer",
                  }}
                  onDoubleClick={() => void handleRun(tool)}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: "var(--accent-soft)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      color: "var(--accent)",
                    }}
                  >
                    {tool.icon && tool.icon.startsWith("data:") ? (
                      <img src={tool.icon} alt="" width={20} height={20} style={{ objectFit: "contain" }} />
                    ) : Builtin ? (
                      <Builtin size={16} />
                    ) : (
                      <Terminal size={16} />
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {tool.name}
                    </div>
                    <div
                      title={tool.path}
                      style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                      {tool.path}
                    </div>
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 4, flexShrink: 0 }}>
                    <button type="button" className="lm-text-btn" title="启动" onClick={() => void handleRun(tool)}>
                      <Play size={13} />
                    </button>
                    <button
                      type="button"
                      className="lm-text-btn"
                      title="编辑"
                      onClick={() =>
                        setForm({ id: tool.id, name: tool.name, path: tool.path, args: tool.args ?? "", icon: tool.icon ?? "" })
                      }
                    >
                      <Pencil size={12} />
                    </button>
                    <button type="button" className="lm-text-btn" title="删除" onClick={() => void handleDelete(tool)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            支持 .exe / .bat / .cmd / .html / .url 等；双击条目即可启动，与 ComfyUI 连接状态无关。
          </div>
        </div>

        {/* 右：添加 / 编辑表单 */}
        {form && (
          <div
            style={{
              width: 320,
              flexShrink: 0,
              borderLeft: "1px solid var(--border)",
              paddingLeft: 14,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              overflowY: "auto",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>{form.id ? "编辑工具" : "添加工具"}</div>

            <label className="field" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>名称</span>
              <input
                value={form.name}
                placeholder="例如：模型合并器"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>

            <label className="field" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>目标路径</span>
              <input
                value={form.path}
                placeholder="D:\工具\程序.exe 或 脚本.bat"
                onChange={(e) => setForm({ ...form, path: e.target.value })}
                onBlur={() => void handleExtractIcon(false)}
              />
            </label>

            <label className="field" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>启动参数（可选）</span>
              <input
                value={form.args}
                placeholder="例如：--listen 0.0.0.0"
                onChange={(e) => setForm({ ...form, args: e.target.value })}
              />
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>图标</span>
              <button
                type="button"
                className="lm-text-btn"
                disabled={!form.path.trim().toLowerCase().endsWith(".exe")}
                title="从 exe 提取程序图标"
                onClick={() => void handleExtractIcon(true)}
                style={{ opacity: form.path.trim().toLowerCase().endsWith(".exe") ? 1 : 0.45 }}
              >
                提取程序图标
              </button>
              <button type="button" className="lm-text-btn" style={{ marginLeft: "auto" }} onClick={() => setForm({ ...form, icon: "" })}>
                使用默认
              </button>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: 10,
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--accent-soft)",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-alt)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent)",
                  flexShrink: 0,
                }}
              >
                {previewIsImage ? (
                  <img src={form?.icon} alt="" width={24} height={24} style={{ objectFit: "contain" }} />
                ) : (
                  <PreviewIcon size={20} />
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {form.icon.startsWith("data:") ? "当前使用程序图标" : form.icon ? "当前使用内置图标" : "当前使用默认图标"}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>内置图标</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 1fr)",
                  gap: 4,
                  padding: 8,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                }}
              >
                {Object.entries(BUILTIN_ICONS).map(([name, Icon]) => (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    onClick={() => setForm({ ...form, icon: name })}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 7,
                      borderRadius: 6,
                      border: "none",
                      cursor: "pointer",
                      color: form.icon === name ? "var(--accent-contrast, #fff)" : "var(--muted)",
                      background: form.icon === name ? "var(--accent)" : "transparent",
                    }}
                  >
                    <Icon size={16} />
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 8 }}>
              <button type="button" className="secondary-action" onClick={() => setForm(null)}>
                取消
              </button>
              <button type="button" className="primary-action" disabled={saving} onClick={() => void handleSave()}>
                保存
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalFrame>,
    document.body,
  );
}
