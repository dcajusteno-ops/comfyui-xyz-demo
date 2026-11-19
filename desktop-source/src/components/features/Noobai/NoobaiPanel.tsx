import React, { useEffect, useRef, useState } from "react";

export interface NoobaiPanelProps {
  apiBase?: string;
}

export const NoobaiPanel: React.FC<NoobaiPanelProps> = () => {
  const [serviceUrl, setServiceUrl] = useState<string>("");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchService = async () => {
      try {
        const res = await fetch("/xyz/noobai/service");
        if (res.ok) {
          const data = (await res.json()) as { success?: boolean; url?: string };
          if (!cancelled && data.url) {
            setServiceUrl(data.url);
            return;
          }
        }
      } catch {
        // Fallback below
      }
      if (!cancelled) {
        setServiceUrl("http://127.0.0.1:9135/");
      }
    };
    void fetchService();
    return () => {
      cancelled = true;
    };
  }, []);

  const syncTheme = () => {
    if (!iframeRef.current?.contentWindow) return;
    const isDark = document.documentElement.classList.contains("dark");
    const themeMode = isDark ? "dark" : "light";
    try {
      iframeRef.current.contentWindow.postMessage(
        { type: "comfy-theme", theme: themeMode },
        "*"
      );
    } catch {
      // 忽略跨域或未就绪错误
    }
  };

  useEffect(() => {
    const observer = new MutationObserver(() => {
      syncTheme();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const initialTheme =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";

  const targetSrc = serviceUrl
    ? `${serviceUrl}?theme=${encodeURIComponent(initialTheme)}&embed=1`
    : "";

  return (
    <div className="noobai-panel-container">
      {targetSrc ? (
        <iframe
          ref={iframeRef}
          src={targetSrc}
          title="NoobAI 标签抽取"
          allow="clipboard-read; clipboard-write; fullscreen"
          className="noobai-frame"
          onLoad={syncTheme}
        />
      ) : (
        <div className="empty-state">正在连接 NoobAI 服务…</div>
      )}
    </div>
  );
};
