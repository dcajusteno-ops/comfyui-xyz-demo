import React, { useEffect, useState } from "react";
import { Check, Copy, Smartphone } from "lucide-react";

type MobileInfo = { mobileUrl: string; lanIp: string | null };

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  }
}

/**
 * 手机访问入口二维码（内容为 http://<局域网IP>:端口/#/mobile-tag）。
 * 局域网地址由服务端探测，避免浏览器无法获取本机 IP 的问题。
 */
export const MobileQrBox = () => {
  const [info, setInfo] = useState<MobileInfo | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/mobile/info");
        const data = (await res.json()) as { success: boolean; data?: MobileInfo; error?: string };
        if (!alive) return;
        if (!data.success || !data.data) throw new Error(data.error || "获取局域网地址失败");
        setInfo(data.data);
        if (data.data.mobileUrl) {
          const { renderQrDataUrl } = await import("../../../lib/qrCode");
          const url = await renderQrDataUrl(data.data.mobileUrl, 220);
          if (alive) setQrDataUrl(url);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleCopy = async () => {
    if (!info?.mobileUrl) return;
    const ok = await copyText(info.mobileUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "6px 0" }}>
      {error ? (
        <div style={{ fontSize: 13, color: "#dc2626", textAlign: "center", padding: "12px", background: "rgba(220,38,38,0.08)", borderRadius: 8, width: "100%" }}>
          {error}（请确认已联网并刷新重试）
        </div>
      ) : qrDataUrl ? (
        <img src={qrDataUrl} alt="手机访问二维码" style={{ width: 190, height: 190, borderRadius: 8, border: "1px solid var(--border)" }} />
      ) : (
        <div style={{ width: 190, height: 190, borderRadius: 8, border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>
          二维码生成中…
        </div>
      )}

      {info?.mobileUrl && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, maxWidth: "100%" }}>
            <Smartphone size={14} color="var(--muted)" style={{ flexShrink: 0 }} />
            <code style={{ fontSize: 13, wordBreak: "break-all", background: "var(--surface-alt)", padding: "4px 8px", borderRadius: 6 }}>{info.mobileUrl}</code>
          </div>
          <button className="secondary-action" onClick={handleCopy} style={{ padding: "4px 12px", height: 28, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "已复制" : "复制地址"}
          </button>
        </>
      )}
    </div>
  );
};