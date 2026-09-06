import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ComfyClient } from "../lib/comfyClient";
import { 
  buildClBatchPrompt, 
  buildWdBatchPrompt,
  buildWd14Prompt,
  buildClSinglePrompt,
  buildDefaultPrompt,
  buildMultiPrompt,
  buildHighresPrompt
} from "../lib/workflowBuilders";
import { buildXyzCombinations, applySpecialXyzPatch, fieldLabel, parseAxisValues } from "../lib/xyz";
import { downloadTextFile } from "../lib/file-helper";
import { xyzStatusLabel } from "../lib/app-utils";
import { templateLabels } from "../constants";
import type {
  ClBatchParams,
  ComfyPrompt,
  JobResult,
  ProgressState,
  Toast,
  WdBatchParams,
  Wd14Params,
  ClSingleParams,
  XyzAxis,
  XyzRunItem,
  TemplateKind,
  BaseGenerationParams,
  MultiGenerationParams,
  HighresParams,
  LoraSelection
} from "../types";

type ToastFn = (type: Toast["type"], title: string, message?: string) => void;

export function useGeneration({ client, pushToast, notifyComplete }: { client: ComfyClient; pushToast: ToastFn; notifyComplete?: (title: string, message?: string) => void }) {
  const [progress, setProgress] = useState<ProgressState>({
    running: false,
    value: 0,
    max: 1,
    label: "空闲",
  });
  const [activeTaskLabel, setActiveTaskLabel] = useState("");
  const [results, setResults] = useState<JobResult[]>([]);
  const [error, setError] = useState("");
  const xyzCancelRef = useRef(false);
  const baseDocTitleRef = useRef(document.title);
  
  const [xyzResults, setXyzResults] = useState<XyzRunItem[]>([]);

  useEffect(() => {
    if (progress.running) {
      const percent = progress.max > 0 ? Math.round((progress.value / progress.max) * 100) : 0;
      let prefix = `${percent}%`;
      if (progress.batch) {
        prefix = `[${progress.batch.current}/${progress.batch.total}] ${prefix}`;
      }
      const taskPart = activeTaskLabel ? ` | ${activeTaskLabel}` : "";
      document.title = `${prefix}${taskPart} - ${baseDocTitleRef.current}`;
    } else if (document.title !== baseDocTitleRef.current) {
      document.title = baseDocTitleRef.current;
    }
  }, [progress.running, progress.value, progress.max, progress.batch, activeTaskLabel]);

  const runPrompt = useCallback(async (
    label: string,
    promptFactory: () => ComfyPrompt,
    onProgress: (progress: ProgressState) => void = (prog) => setProgress(prog),
    taskLabel?: string,
  ) => {
    setError("");
    setActiveTaskLabel(taskLabel || label);
    try {
      onProgress({ running: true, value: 0, max: 1, label: `${label} 准备中` });
      pushToast("info", `${label} 已提交`, "正在等待 ComfyUI 执行");
      const result = await client.runPrompt(promptFactory(), onProgress);
      setResults((prev) => [result, ...prev].slice(0, 24));
      pushToast("success", `${label} 完成`, result.images.length ? `输出 ${result.images.length} 张图片` : undefined);
      notifyComplete?.(`${label} 完成`, result.images.length ? `输出 ${result.images.length} 张图片` : "任务已完成");
      return result;
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setError(message);
      onProgress({ running: false, value: 0, max: 1, label: "失败" });
      pushToast("error", `${label} 失败`, message);
      throw runError;
    }
  }, [client, pushToast, notifyComplete]);

  const runBatchTagger = useCallback(async (type: "cl" | "wd", clBatchParams: ClBatchParams, wdBatchParams: WdBatchParams) => {
    setError("");
    setActiveTaskLabel(type === "cl" ? "CL 批量打标" : "WD 批量打标");
    const params = type === "cl" ? clBatchParams : wdBatchParams;
    try {
      pushToast("info", "批量打标已启动", `计划处理 ${params.runCount} 张`);
      let successCount = 0;
      for (let i = 0; i < params.runCount; i++) {
        if (xyzCancelRef.current) break;
        const prompt = type === "cl"
          ? buildClBatchPrompt(clBatchParams, i)
          : buildWdBatchPrompt(wdBatchParams, i);

        await client.runPrompt(prompt, setProgress);
        successCount++;
      }
      pushToast("success", "批量打标完成", `成功处理 ${successCount} 张`);
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setError(message);
      pushToast("error", "批量打标失败", message);
    }
  }, [client, pushToast]);

  const runWd14 = useCallback(async (wd14: Wd14Params, wdFile: File | null) => {
    setError("");
    setActiveTaskLabel("WD1.4");
    try {
      if (!wdFile && !wd14.imageName) {
        throw new Error("请先选择一张图片");
      }
      let imageName = wd14.imageName;
      if (wdFile) {
        const uploaded = await client.uploadImage(wdFile);
        imageName = uploaded.name;
      }
      const result = await client.runPrompt(buildWd14Prompt({ ...wd14, imageName }), setProgress);
      setResults((prev) => [result, ...prev].slice(0, 24));
      pushToast("success", "WD1.4 识别完成", result.texts.length ? "标签已写入输出框" : "任务已完成");
      notifyComplete?.("WD1.4 识别完成", result.texts.length ? "标签已写入输出框" : "任务已完成");
      return result;
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setError(message);
      pushToast("error", "WD1.4 识别失败", message);
      throw runError;
    }
  }, [client, pushToast, notifyComplete]);

  const runClSingle = useCallback(async (clSingleParams: ClSingleParams, clFile: File | null) => {
    setError("");
    setActiveTaskLabel("CL 单图识别");
    try {
      if (!clFile && !clSingleParams.imageName) {
        throw new Error("请先选择一张图片");
      }
      let imageName = clSingleParams.imageName;
      if (clFile) {
        const uploaded = await client.uploadImage(clFile);
        imageName = uploaded.name;
      }
      const result = await client.runPrompt(buildClSinglePrompt({ ...clSingleParams, imageName }), setProgress);
      setResults((prev) => [result, ...prev].slice(0, 24));
      pushToast("success", "CL 单图识别完成", result.texts.length ? "标签已写入输出框" : "任务已完成");
      notifyComplete?.("CL 单图识别完成", result.texts.length ? "标签已写入输出框" : "任务已完成");
      return result;
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setError(message);
      pushToast("error", "CL 单图识别失败", message);
      throw runError;
    }
  }, [client, pushToast, notifyComplete]);

  const buildXyzPrompt = useCallback((
    combo: Pick<XyzRunItem, "label" | "patch">,
    xyzTarget: TemplateKind,
    defaultParams: BaseGenerationParams,
    multiParams: MultiGenerationParams,
    highresParams: HighresParams
  ) => {
    if (xyzTarget === "multi") {
      const patched = applySpecialXyzPatch(multiParams, combo);
      const promptAppend = combo.patch.positivePrompt;
      return buildMultiPrompt({
        ...patched,
        globalPrompt: promptAppend ? [multiParams.globalPrompt, promptAppend].filter(Boolean).join("\n") : patched.globalPrompt,
      });
    }
    if (xyzTarget === "highres") {
      return buildHighresPrompt(applySpecialXyzPatch(highresParams, combo));
    }
    return buildDefaultPrompt(applySpecialXyzPatch(defaultParams, combo));
  }, []);

  const runXyzItems = useCallback(async (
    items: XyzRunItem[], 
    reset = false,
    xyzTarget: TemplateKind,
    defaultParams: BaseGenerationParams,
    multiParams: MultiGenerationParams,
    highresParams: HighresParams
  ) => {
    setError("");
    setActiveTaskLabel("XYZ 控制器");
    xyzCancelRef.current = false;
    if (reset) {
      setXyzResults(items);
    }

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (xyzCancelRef.current) {
        setXyzResults((prev) => prev.map((entry) => entry.id === item.id && entry.status === "queued" ? { ...entry, status: "cancelled" } : entry));
        continue;
      }

      const batch = { current: index + 1, total: items.length, itemLabel: item.label };
      setProgress({
        running: true,
        value: index,
        max: items.length,
        label: `XYZ ${index + 1}/${items.length}`,
        batch,
      });

      setXyzResults((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: "running", error: undefined } : entry));

      try {
        const result = await client.runPrompt(
          buildXyzPrompt(item, xyzTarget, defaultParams, multiParams, highresParams),
          (prog) => setProgress({ ...prog, batch })
        );
        setXyzResults((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: "success", result } : entry));
        setResults((prev) => [result, ...prev].slice(0, 24));
      } catch (runError) {
        const message = runError instanceof Error ? runError.message : String(runError);
        setXyzResults((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: "failed", error: message } : entry));
        pushToast("error", `XYZ 组合失败：${item.label}`, message);
      }
    }

    setProgress({
      running: false,
      value: 1,
      max: 1,
      label: "XYZ 完成",
      batch: { current: items.length, total: items.length, itemLabel: "" },
    });
    pushToast("success", "XYZ 执行结束", `已处理 ${items.length} 个组合`);
    notifyComplete?.("XYZ 执行结束", `已处理 ${items.length} 个组合`);
  }, [client, pushToast, buildXyzPrompt, notifyComplete]);

  const runXyz = useCallback(async (
    xyzAxes: XyzAxis[], 
    xyzExcludedIndices: Set<number>,
    xyzTarget: TemplateKind,
    lorasOfTarget: LoraSelection[],
    defaultParams: BaseGenerationParams,
    multiParams: MultiGenerationParams,
    highresParams: HighresParams
  ) => {
    const combos = buildXyzCombinations(xyzAxes, lorasOfTarget, xyzExcludedIndices);
    if (!combos.length) {
      pushToast("error", "XYZ 无法运行", "至少需要启用一个轴并填写取值，且不能全部被排除");
      return;
    }
    const items = combos.map((combo) => ({
      id: crypto.randomUUID(),
      label: combo.label,
      patch: combo.patch,
      status: "queued" as const,
      comboIndex: combo.originalIndex,
    }));
    await runXyzItems(items, true, xyzTarget, defaultParams, multiParams, highresParams);
  }, [pushToast, runXyzItems]);

  const stopXyzQueue = useCallback(() => {
    xyzCancelRef.current = true;
    client.interrupt(progress.promptId).catch(() => undefined);
    setProgress((prev) => ({ ...prev, running: false, label: "XYZ 已中断" }));
    pushToast("info", "XYZ 队列已请求中断");
  }, [client, progress.promptId, pushToast]);

  const rerunXyzItem = useCallback(async (
    item: XyzRunItem,
    xyzTarget: TemplateKind,
    defaultParams: BaseGenerationParams,
    multiParams: MultiGenerationParams,
    highresParams: HighresParams
  ) => {
    await runXyzItems(
      [{ ...item, id: crypto.randomUUID(), status: "queued", result: undefined, error: undefined }], 
      true, 
      xyzTarget, 
      defaultParams, 
      multiParams, 
      highresParams
    );
  }, [runXyzItems]);

  const retryFailedXyz = useCallback(async (
    xyzTarget: TemplateKind,
    defaultParams: BaseGenerationParams,
    multiParams: MultiGenerationParams,
    highresParams: HighresParams
  ) => {
    const failed = xyzResults.filter((item) => item.status === "failed");
    if (!failed.length) {
      pushToast("info", "没有失败组合", "当前 XYZ 结果里没有需要重试的组合");
      return;
    }
    const items = failed.map((item) => ({ ...item, id: crypto.randomUUID(), status: "queued" as const, result: undefined, error: undefined }));
    await runXyzItems(items, true, xyzTarget, defaultParams, multiParams, highresParams);
  }, [xyzResults, pushToast, runXyzItems]);

  const exportXyzResults = useCallback((xyzTarget: TemplateKind, xyzAxes: XyzAxis[]) => {
    const payload = {
      exportedAt: new Date().toISOString(),
      target: xyzTarget,
      axes: xyzAxes,
      items: xyzResults.map((item) => ({
        label: item.label,
        status: item.status,
        patch: item.patch,
        error: item.error,
        promptId: item.result?.promptId,
        images: item.result?.images ?? [],
        texts: item.result?.texts ?? [],
      })),
    };
    downloadTextFile(`xyz-results-${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json");
    pushToast("success", "XYZ 结果已导出", "已生成 JSON manifest");
  }, [xyzResults, pushToast]);

  const exportXyzGrid = useCallback(async (
    xyzTarget: TemplateKind,
    xyzAxes: XyzAxis[],
    lorasOfTarget: LoraSelection[]
  ) => {
    const drawableItems = xyzResults.filter((item) => item.status === "success" && item.result?.images[0]);
    if (drawableItems.length === 0) {
      pushToast("info", "没有可导出的结果", "网格中没有成功的生成图像");
      return;
    }
    pushToast("info", "正在生成网格", "请稍候...");

    const activeAxes = xyzAxes.filter((axis) => axis.enabled && axis.values.trim());
    const lastAxis = activeAxes[activeAxes.length - 1];
    const lastAxisValues = lastAxis ? parseAxisValues(lastAxis.values, lastAxis.field) : [];
    const cols = lastAxisValues.length > 0 ? lastAxisValues.length : 1;

    const slotOf = (item: XyzRunItem) => (typeof item.comboIndex === "number" ? item.comboIndex : xyzResults.indexOf(item));
    const total = Math.max(...xyzResults.map((item) => slotOf(item))) + 1;
    const rows = Math.ceil(total / cols);

    try {
      const imagesBySlot = new Map<number, HTMLImageElement>();
      await Promise.all(
        drawableItems.map(
          (item) =>
            new Promise<void>((resolve, reject) => {
              const img = new Image();
              img.crossOrigin = "anonymous";
              img.onload = () => {
                imagesBySlot.set(slotOf(item), img);
                resolve();
              };
              img.onerror = () => reject(new Error(`加载图像失败: ${item.label}`));
              img.src = item.result!.images[0].url;
            }),
        ),
      );

      const itemsBySlot = new Map<number, XyzRunItem>();
      xyzResults.forEach((item) => itemsBySlot.set(slotOf(item), item));
      const combos = buildXyzCombinations(xyzAxes, lorasOfTarget);
      const labelOfSlot = (slot: number) => itemsBySlot.get(slot)?.label ?? combos[slot]?.label ?? "";

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建 canvas 绘图上下文");
      const fontStack = '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';

      const cellW = Math.max(...[...imagesBySlot.values()].map((img) => img.width));
      const cellH = Math.max(...[...imagesBySlot.values()].map((img) => img.height));
      const fontSize = Math.min(30, Math.max(18, Math.round(cellW / 26)));
      const headerFontSize = Math.min(24, Math.max(16, Math.round(cellW / 34)));
      const gap = 14;
      const margin = 28;
      const fontLineH = Math.round(fontSize * 1.45);
      const headerLineH = Math.round(headerFontSize * 1.4);

      const prettyValue = (value: string | number) => {
        const text = String(value);
        if (/[\\/]/.test(text) && /\.[A-Za-z0-9]{2,16}$/.test(text)) {
          return text.split(/[\\/]/).pop() || text;
        }
        return text;
      };
      const prettyLabel = (label: string) =>
        label
          .split(" / ")
          .map((segment) => {
            const eq = segment.indexOf("=");
            return eq > 0 ? `${segment.slice(0, eq + 1)}${prettyValue(segment.slice(eq + 1))}` : segment;
          })
          .join(" / ");

      const wrapWidth = (text: string, maxWidth: number) => {
        const lines: string[] = [];
        let current = "";
        for (const ch of text) {
          if (current && ctx.measureText(current + ch).width > maxWidth) {
            lines.push(current);
            current = ch;
          } else {
            current += ch;
          }
        }
        if (current) lines.push(current);
        return lines;
      };
      const wrapLabel = (label: string, maxWidth: number, maxLines: number) => {
        const lines = label.split(" / ").flatMap((segment) => wrapWidth(segment, maxWidth));
        if (lines.length <= maxLines) return lines;
        const kept = lines.slice(0, maxLines);
        let last = kept[maxLines - 1];
        while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
          last = last.slice(0, -1);
        }
        kept[maxLines - 1] = `${last}…`;
        return kept;
      };

      ctx.font = `600 ${fontSize}px ${fontStack}`;
      const cellLabelLines = new Map<number, string[]>();
      let maxCellLabelLines = 1;
      for (let slot = 0; slot < total; slot += 1) {
        const lines = wrapLabel(prettyLabel(labelOfSlot(slot)), cellW - 24, 2);
        cellLabelLines.set(slot, lines);
        maxCellLabelLines = Math.max(maxCellLabelLines, lines.length);
      }
      const labelH = fontLineH * maxCellLabelLines + 16;
      const cellTotalH = cellH + labelH;

      ctx.font = `600 ${headerFontSize}px ${fontStack}`;
      const rowHeaderOf = (row: number) => {
        const parts = prettyLabel(labelOfSlot(row * cols)).split(" / ");
        return parts.length > 1 ? parts.slice(0, -1).join(" / ") : "";
      };
      const rowHeaderMaxLines = Math.max(2, Math.min(6, Math.floor((cellTotalH - 16) / headerLineH)));
      const rowHeaders = Array.from({ length: rows }, (_, row) => rowHeaderOf(row));
      const hasRowHeaders = rowHeaders.some(Boolean);
      const rowHeaderW = hasRowHeaders
        ? Math.min(
            340,
            Math.max(
              ...rowHeaders
                .filter(Boolean)
                .flatMap((header) => wrapLabel(header, 328, rowHeaderMaxLines))
                .map((line) => ctx.measureText(line).width),
            ) + 24,
          )
        : 0;
      const rowHeaderLines = rowHeaders.map((header) => (header ? wrapLabel(header, rowHeaderW - 12, rowHeaderMaxLines) : []));

      const colHeaders = lastAxisValues.map((value) => `${fieldLabel(lastAxis.field, lorasOfTarget)}=${prettyValue(value)}`);
      const colHeaderLines = colHeaders.map((header) => wrapLabel(header, cellW, 2));
      const maxColHeaderLines = Math.max(1, ...colHeaderLines.map((lines) => lines.length));
      const colHeaderH = colHeaders.length ? headerLineH * maxColHeaderLines + 18 : 0;
      const titleH = 96;
      const gridW = cols * cellW + (cols - 1) * gap;
      const gridH = rows * cellTotalH + (rows - 1) * gap;
      canvas.width = margin * 2 + rowHeaderW + (hasRowHeaders ? gap : 0) + gridW;
      canvas.height = margin + titleH + colHeaderH + (colHeaderH ? gap : 0) + gridH + margin;

      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const fitText = (text: string, maxWidth: number) => {
        if (!text || ctx.measureText(text).width <= maxWidth) return text;
        let truncated = text;
        while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
          truncated = truncated.slice(0, -1);
        }
        return `${truncated}…`;
      };

      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      const title = `XYZ 网格 · ${templateLabels[xyzTarget]} · ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#e2e8f0";
      ctx.font = `700 30px ${fontStack}`;
      ctx.fillText(title, margin, margin + 38);
      const subtitle = activeAxes
        .map((axis) => `${fieldLabel(axis.field, lorasOfTarget)}: ${axis.values.replace(/[\n,]+/g, ",").trim()}`)
        .join(" ｜ ");
      if (subtitle) {
        ctx.fillStyle = "#8ea0b8";
        ctx.font = `400 18px ${fontStack}`;
        ctx.fillText(fitText(subtitle, canvas.width - margin * 2), margin, margin + 70);
      }

      const gridTop = margin + titleH + colHeaderH + (colHeaderH ? gap : 0);
      const gridLeft = margin + rowHeaderW + (hasRowHeaders ? gap : 0);

      if (colHeaders.length) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#93c5fd";
        ctx.font = `600 ${headerFontSize}px ${fontStack}`;
        colHeaderLines.forEach((lines, c) => {
          const centerX = gridLeft + c * (cellW + gap) + cellW / 2;
          const startY = margin + titleH + (colHeaderH - (lines.length - 1) * headerLineH) / 2;
          lines.forEach((line, i) => ctx.fillText(line, centerX, startY + i * headerLineH));
        });
      }

      if (hasRowHeaders) {
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#93c5fd";
        ctx.font = `600 ${headerFontSize}px ${fontStack}`;
        rowHeaderLines.forEach((lines, r) => {
          if (!lines.length) return;
          const centerY = gridTop + r * (cellTotalH + gap) + cellH / 2;
          const startY = centerY - ((lines.length - 1) * headerLineH) / 2;
          lines.forEach((line, i) => ctx.fillText(line, margin + rowHeaderW - 6, startY + i * headerLineH));
        });
      }

      for (let slot = 0; slot < total; slot += 1) {
        const c = slot % cols;
        const r = Math.floor(slot / cols);
        const x = gridLeft + c * (cellW + gap);
        const y = gridTop + r * (cellTotalH + gap);

        ctx.fillStyle = "#141d2c";
        ctx.fillRect(x, y, cellW, cellTotalH);
        ctx.strokeStyle = "#263349";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellTotalH - 1);

        const img = imagesBySlot.get(slot);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (img) {
          const pad = 8;
          const scale = Math.min((cellW - pad * 2) / img.width, (cellH - pad * 2) / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, x + (cellW - w) / 2, y + (cellH - h) / 2, w, h);
        } else {
          const status = itemsBySlot.get(slot)?.status;
          ctx.fillStyle = status === "failed" ? "#f87171" : "#5b6b82";
          ctx.font = `600 ${Math.max(16, Math.round(fontSize * 0.85))}px ${fontStack}`;
          ctx.fillText(status ? `✕ ${xyzStatusLabel(status)}` : "—", x + cellW / 2, y + cellH / 2);
        }

        ctx.fillStyle = "#0e1524";
        ctx.fillRect(x + 1, y + cellH, cellW - 2, labelH);
        ctx.fillStyle = "#dbeafe";
        ctx.font = `600 ${fontSize}px ${fontStack}`;
        const lines = cellLabelLines.get(slot) ?? [];
        const labelStartY = y + cellH + (labelH - (lines.length - 1) * fontLineH) / 2;
        lines.forEach((line, i) => ctx.fillText(line, x + cellW / 2, labelStartY + i * fontLineH));
      }

      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `xyz-grid-${Date.now()}.png`;
      a.click();
      pushToast("success", "网格导出成功");
    } catch (e) {
      pushToast("error", "网格导出失败", e instanceof Error ? e.message : String(e));
    }
  }, [xyzResults, pushToast]);

  return useMemo(() => ({
    progress,
    setProgress,
    activeTaskLabel,
    setActiveTaskLabel,
    results,
    setResults,
    error,
    setError,
    xyzResults,
    setXyzResults,
    xyzCancelRef,
    runPrompt,
    runBatchTagger,
    runWd14,
    runClSingle,
    runXyz,
    runXyzItems,
    stopXyzQueue,
    rerunXyzItem,
    retryFailedXyz,
    exportXyzResults,
    exportXyzGrid,
  }), [
    progress,
    activeTaskLabel,
    results,
    error,
    xyzResults,
    runPrompt,
    runBatchTagger,
    runWd14,
    runClSingle,
    runXyz,
    runXyzItems,
    stopXyzQueue,
    rerunXyzItem,
    retryFailedXyz,
    exportXyzResults,
    exportXyzGrid,
  ]);
}
