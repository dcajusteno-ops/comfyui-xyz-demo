import type { XyzAxis, XyzAxisInsight, XyzRunItem } from "../types";
import { computeMetrics, normalizeBatch, DEFAULT_SCORE_WEIGHTS, type ImageMetrics } from "./imageMetrics";
import { fieldLabel, parseAxisValues } from "./xyz";

export type XyzCellScore = {
  url: string;
  item: XyzRunItem;
  metrics: ImageMetrics;
  score: number;
};

export type XyzReviewOutcome = {
  scoresByUrl: Record<string, number>;
  metricsByUrl: Record<string, ImageMetrics>;
  samples: XyzCellScore[];
  bestUrls: string[];
  insights: XyzAxisInsight[];
};

const MAX_SIDE = 160;

const yieldFrame = () => new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

function sourceSize(source: CanvasImageSource) {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth || source.width, height: source.naturalHeight || source.height };
  }
  return { width: (source as ImageBitmap).width, height: (source as ImageBitmap).height };
}

/** 将任意图像源降采样到最长边 maxSide 并计算指标。 */
function sampleImageSource(source: CanvasImageSource, maxSide: number): ImageMetrics {
  const { width, height } = sourceSize(source);
  if (width === 0 || height === 0) throw new Error("图片尺寸无效");

  const scale = Math.min(1, maxSide / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法创建 canvas 绘图上下文");
  ctx.drawImage(source, 0, 0, targetW, targetH);
  const data = ctx.getImageData(0, 0, targetW, targetH).data;
  return computeMetrics(data, targetW, targetH);
}

/** 从图片 URL 计算指标：fetch → 解码 → 降采样 → 评分。 */
export async function metricsForUrl(url: string, maxSide = MAX_SIDE): Promise<ImageMetrics> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片加载失败（HTTP ${response.status}）`);
  const blob = await response.blob();

  let bitmap: ImageBitmap | null = null;
  let objectUrl: string | null = null;
  let source: CanvasImageSource;

  if (typeof createImageBitmap === "function") {
    bitmap = await createImageBitmap(blob);
    source = bitmap;
  } else {
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("图片解码失败"));
      objectUrl = URL.createObjectURL(blob);
      img.src = objectUrl;
    });
  }

  try {
    return sampleImageSource(source, maxSide);
  } finally {
    if (bitmap) bitmap.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/** 按轴的取值聚合平均分，输出"哪个取值效果最好"的结论。 */
export function aggregateInsights(
  samples: XyzCellScore[],
  axes: XyzAxis[],
  lorasOfTarget?: { name: string; displayName?: string }[]
): XyzAxisInsight[] {
  const insights: XyzAxisInsight[] = [];

  for (const axis of axes) {
    if (!axis.enabled) continue;
    const parsed = parseAxisValues(axis.values, axis.field).map(String);
    if (parsed.length <= 1) continue;

    const axisLabel = fieldLabel(axis.field, lorasOfTarget);
    const accumulator = new Map<string, { sum: number; count: number }>();
    const prefix = `${axisLabel}=`;

    for (const sample of samples) {
      const segment = sample.item.label.split(" / ").find((part) => part.startsWith(prefix));
      if (!segment) continue;
      const value = segment.slice(prefix.length).trim();
      if (!value) continue;
      const entry = accumulator.get(value) ?? { sum: 0, count: 0 };
      entry.sum += sample.score;
      entry.count += 1;
      accumulator.set(value, entry);
    }

    if (accumulator.size < 1) continue;
    const averages = Array.from(accumulator.entries())
      .map(([value, entry]) => ({ value, average: entry.sum / entry.count, count: entry.count }))
      .sort((a, b) => b.average - a.average);
    const best = averages[0];
    insights.push({ fieldLabel: axisLabel, bestValue: best.value, bestAverage: best.average, averages });
  }

  return insights;
}

/**
 * 对 XYZ 结果逐张评分（分片执行，避免长任务阻塞主线程）。
 * 失败 / 无图 / 加载失败的单格会被跳过，不计入统计。
 */
export async function runXyzReview(
  items: XyzRunItem[],
  axes: XyzAxis[],
  lorasOfTarget?: { name: string; displayName?: string }[],
  onProgress?: (done: number, total: number, currentLabel: string) => void
): Promise<XyzReviewOutcome> {
  const candidates = items.filter((item) => item.status === "success" && item.result?.images?.length);
  const total = candidates.length;

  const samples: XyzCellScore[] = [];
  const metricsByUrl: Record<string, ImageMetrics> = {};

  for (let index = 0; index < total; index += 1) {
    const item = candidates[index];
    const url = item.result!.images![0].url;
    try {
      const metrics = await metricsForUrl(url);
      metricsByUrl[url] = metrics;
      samples.push({ url, item, metrics, score: 0 });
    } catch {
      /* 单格失败跳过，不中断整体复盘 */
    }
    onProgress?.(index + 1, total, item.label);
    if (index + 1 < total) await yieldFrame();
  }

  const scores = normalizeBatch(samples.map((sample) => sample.metrics), DEFAULT_SCORE_WEIGHTS);
  samples.forEach((sample, index) => {
    sample.score = scores[index] ?? 0;
  });

  const scoresByUrl: Record<string, number> = {};
  samples.forEach((sample) => {
    scoresByUrl[sample.url] = sample.score;
  });

  const sorted = [...samples].sort((a, b) => b.score - a.score);
  const bestCount = Math.max(1, Math.ceil(sorted.length * 0.1));
  const bestUrls = sorted.slice(0, bestCount).map((sample) => sample.url);

  const insights = aggregateInsights(samples, axes, lorasOfTarget);

  return { scoresByUrl, metricsByUrl, samples, bestUrls, insights };
}