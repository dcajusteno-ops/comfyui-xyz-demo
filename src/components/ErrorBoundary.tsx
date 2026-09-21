import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, RefreshCw } from "lucide-react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * 渲染期兜底：任何子树抛错时不再白屏，而是给出错误摘要与自救入口。
 *
 * 「重置本地配置」会清除本应用写入的全部 localStorage（comfyui_* / xyz_* 前缀）——
 * 参数结构演进后，旧的持久化数据是历史上最常见的一类渲染崩溃来源。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 保留到控制台，便于开发期定位；生产环境不弹任何打断性 UI
    console.error("渲染异常（ErrorBoundary 捕获）:", error, info.componentStack);
  }

  private resetStorage = () => {
    const prefixes = ["comfyui_", "xyz_"];
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && prefixes.some((p) => key.startsWith(p))) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "var(--surface)",
          color: "var(--text)",
        }}
      >
        <div
          className="panel"
          style={{
            maxWidth: "640px",
            width: "100%",
            border: "1px solid var(--danger)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <div className="panel-header">
            <h2 style={{ display: "flex", alignItems: "center", gap: "8px", margin: 0, color: "var(--danger)" }}>
              <AlertTriangle size={20} /> 页面渲染出错
            </h2>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <p style={{ margin: 0, fontSize: "14px" }}>
              界面在渲染过程中遇到了未预期的异常。大多数情况来自本地保存的旧配置与新版本不兼容，重置本地配置即可恢复。
            </p>
            <div
              style={{
                background: "var(--surface-alt)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "10px 12px",
                fontSize: "12px",
                color: "var(--danger)",
                wordBreak: "break-all",
              }}
            >
              {error.message || String(error)}
            </div>
            {error.stack && (
              <details>
                <summary style={{ cursor: "pointer", fontSize: "12px", color: "var(--muted)" }}>技术详情</summary>
                <pre
                  style={{
                    margin: "8px 0 0",
                    fontSize: "11px",
                    color: "var(--muted)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    maxHeight: "200px",
                    overflow: "auto",
                  }}
                >
                  {error.stack}
                </pre>
              </details>
            )}
          </div>
          <div className="panel-footer" style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="secondary-action"
              onClick={() => window.location.reload()}
            >
              <RefreshCw size={14} /> 仅刷新页面
            </button>
            <button type="button" className="primary-action" onClick={this.resetStorage}>
              <RotateCcw size={14} /> 重置本地配置并刷新
            </button>
          </div>
        </div>
      </div>
    );
  }
}
