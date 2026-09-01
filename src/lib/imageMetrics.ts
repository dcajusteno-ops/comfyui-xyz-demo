/**
 * 图像质量评分（纯前端、零依赖）。
 * 分数只在同批次内做相对比较，不跨批次对比。
 */

export type ImageMetrics = {
  /** 灰度 Laplacian 方差，衡量清晰度（越高越锐利）。 */
  sharpness: number;
  /** 曝光健康度 0-1：死黑 / 过曝越少越接近 1。 */
  exposure: number;
  /** RMS 对比度归一化 0-1。 */
  contrast: number;
  /** 色彩丰富度（Hasler–Süsstrunk 度量）归一化 0-1。 */
  colorfulness: number;
  /** 死黑像素占比（灰度 < 5）。 */
  darkRatio: number;
  /** 过曝像素占比（灰度 > 250）。 */
  brightRatio: number;
};

export type ScoreWeights = {
  sharpness: number;
  exposure: number;
  contrast: number;
  colorfulness: number;
};

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  sharpness: 0.5,
  exposure: 0.2,
  contrast: 0.2,
  colorfulness: 0.1,
};

const METRIC_KEYS: Array<keyof ScoreWeights> = ["sharpness", "exposure", "contrast", "colorfulness"];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** 从 RGBA 像素数组计算四项图像质量指标（传入前建议先降采样）。 */
export function computeMetrics(data: Uint8ClampedArray, width: number, height: number): ImageMetrics {
  const length = data.length / 4;
  const lum = new Float64Array(length);

  let sum = 0;
  let sumSq = 0;
  let dark = 0;
  let bright = 0;
  let rgSum = 0;
  let rgSq = 0;
  let ybSum = 0;
  let ybSq = 0;

  for (let i = 0; i < length; i += 1) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[i] = y;
    sum += y;
    sumSq += y * y;
    if (y < 5) dark += 1;
    if (y > 250) bright += 1;

    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    rgSum += rg;
    rgSq += rg * rg;
    ybSum += yb;
    ybSq += yb * yb;
  }

  const mean = sum / length;
  const std = Math.sqrt(Math.max(0, sumSq / length - mean * mean));
  const contrast = clamp(std / 128, 0, 1);

  const muRg = rgSum / length;
  const muYb = ybSum / length;
  const sigmaRg = Math.sqrt(Math.max(0, rgSq / length - muRg * muRg));
  const sigmaYb = Math.sqrt(Math.max(0, ybSq / length - muYb * muYb));
  const colorfulness = clamp(
    (Math.sqrt(sigmaRg * sigmaRg + sigmaYb * sigmaYb) + 0.3 * Math.sqrt(muRg * muRg + muYb * muYb)) / 150,
    0,
    1
  );

  let lapSumSq = 0;
  let lapCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const lap = 4 * lum[i] - lum[i - width] - lum[i + width] - lum[i - 1] - lum[i + 1];
      lapSumSq += lap * lap;
      lapCount += 1;
    }
  }
  const sharpness = lapCount > 0 ? lapSumSq / lapCount : 0;

  const darkRatio = dark / length;
  const brightRatio = bright / length;
  const exposure = clamp(1 - darkRatio * 2 - brightRatio * 2, 0, 1);

  return { sharpness, exposure, contrast, colorfulness, darkRatio, brightRatio };
}

/**
 * 对一批样本做分指标 min-max 归一化并加权合成 0-100 综合分。
 * 某指标在批内无差异（min === max）时按满分 1 处理；null 样本返回 null。
 */
export function normalizeBatch(
  samples: Array<ImageMetrics | null>,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS
): Array<number | null> {
  const ranges: Record<string, { min: number; max: number }> = {};
  for (const key of METRIC_KEYS) {
    const values = samples.filter((sample): sample is ImageMetrics => sample !== null).map((sample) => sample[key]);
    if (values.length === 0) {
      ranges[key] = { min: 0, max: 1 };
      continue;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    ranges[key] = min === max ? { min: 0, max: 1 } : { min, max };
  }

  return samples.map((sample) => {
    if (!sample) return null;
    let score = 0;
    for (const key of METRIC_KEYS) {
      const { min, max } = ranges[key];
      const span = max - min;
      const normalized = span === 0 ? 1 : (sample[key] - min) / span;
      score += normalized * weights[key];
    }
    return Math.round(clamp(score * 100, 0, 100) * 10) / 10;
  });
}