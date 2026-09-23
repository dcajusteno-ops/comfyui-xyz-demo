import { useCallback, useEffect, useState } from "react";
import { Gpu } from "lucide-react";
import type { ComfyClient } from "../../lib/comfyClient";

type DeviceStats = { name?: string; vram_total?: number; vram_free?: number };

const POLL_MS = 30_000;
/** 空闲显存低于总量 15% 视为紧张（Anima 默认档 4096×6144 一开就会撞上） */
const WARN_RATIO = 0.15;

const formatGb = (bytes?: number) =>
  typeof bytes === "number" && Number.isFinite(bytes) ? (bytes / 1024 ** 3).toFixed(1) : null;

/**
 * 显存占用指示（T10-③）：复用 ComfyUI 的 /system_stats，30s 轮询 + 生成开始/结束时立即刷新。
 * 只做提示，不阻断生成。
 */
export function VramBadge({ client }: { client: ComfyClient }) {
  const [device, setDevice] = useState<DeviceStats | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const stats = (await client.getSystemStats()) as { devices?: DeviceStats[] };
      const first = stats?.devices?.[0];
      if (first && typeof first.vram_total === "number") {
        setDevice(first);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const total = formatGb(device?.vram_total);
  const free = formatGb(device?.vram_free);
  const tight =
    device?.vram_total !== undefined &&
    device?.vram_free !== undefined &&
    device.vram_total > 0 &&
    device.vram_free / device.vram_total < WARN_RATIO;

  if (failed || !total) {
    return (
      <span
        title="无法读取显存信息（ComfyUI /system_stats 不可用）"
        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--muted)" }}
      >
        <Gpu size={14} /> 显存 --
      </span>
    );
  }

  return (
    <span
      title={`GPU：${device?.name ?? "未知"}\n空闲 ${free} / 共 ${total} GB${tight ? "\n⚠️ 空闲显存偏低，大分辨率任务可能 OOM" : ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        color: tight ? "var(--danger, #dc2626)" : "var(--muted)",
        fontWeight: tight ? 600 : 400,
      }}
    >
      <Gpu size={14} /> 显存 {free}/{total} GB{tight ? " ⚠️" : ""}
    </span>
  );
}
