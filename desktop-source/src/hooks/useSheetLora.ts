import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComfyClient } from "../lib/comfyClient";
import type { LoraItem, SheetMode } from "../types";
import { resolveSheetLora, type SheetLoraResolution } from "../lib/characterSheet";
import { matchesLoraFamily } from "../lib/lora-helper";

/** 兜底按目录检索时用的路径（与内置 LoRA 规格里的相对路径同源） */
const SHEET_LORA_FOLDER = "AnimaLora/三视图";

type SheetLoraCandidates = Record<SheetMode, LoraItem[]>;

/**
 * 三视图 LoRA 检索。
 *
 * 为什么不复用 `useLoras.loraResult.items`：它在挂载时只拉第 1 页（按名字排序），
 * 而三视图 LoRA 在 `AnimaLora/三视图/` 下，多半不在首页——靠它匹配会稳定失手。
 * 这里在**打开三视图页时**单独检索一次：先按关键字 "sheet"，没结果再按目录兜底。
 * 两次都失败也只降级为「按相对路径挂载」，页面照常可用。
 */
export function useSheetLora(
  client: ComfyClient,
  active: boolean,
  override: Partial<Record<SheetMode, string>> = {},
) {
  const [items, setItems] = useState<LoraItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const search = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const bySearch = await client.listManagedModels("loras", { search: "sheet", pageSize: 100 });
      let next = bySearch.items ?? [];
      if (next.length === 0) {
        const byFolder = await client.listManagedModels("loras", {
          folder: SHEET_LORA_FOLDER,
          pageSize: 100,
        });
        next = byFolder.items ?? [];
      }
      setItems(next);
      setError(null);
    } catch (cause) {
      // LoRA 库不可用（插件未连接/接口变更）不做阻断：解析会回落相对路径
      setItems([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [active, client]);

  useEffect(() => {
    if (!active) return;
    // 与 useLoras 一致：轻微延迟发起，避免切 tab 时立刻打请求（也让 setState 不落在 effect 同步段）
    const timer = window.setTimeout(() => {
      void search();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [search, reloadToken, active]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  const resolved = useMemo(
    () =>
      ({
        anima: resolveSheetLora("anima", items, override.anima),
        sdxl: resolveSheetLora("sdxl", items, override.sdxl),
      }) as Record<SheetMode, SheetLoraResolution>,
    [items, override.anima, override.sdxl],
  );

  const candidates = useMemo<SheetLoraCandidates>(() => {
    const pick = (mode: SheetMode) =>
      items.filter((item) => matchesLoraFamily(mode, item) && /sheet|三视图/i.test(item.file_name ?? ""));
    return { anima: pick("anima"), sdxl: pick("sdxl") };
  }, [items]);

  return { items, loading, error, resolved, candidates, reload };
}
