/**
 * 文字水印：纯几何 + canvas 薄壳。
 *
 * 设计约定（与手写板同源）：
 * - 图片一律 fetch → blob → createImageBitmap 加载，避免 crossOrigin 直接引用导致 canvas 被污染
 *   （toBlob 会抛 SecurityError）；
 * - 锚点按「未旋转的文字包围盒 + margin」计算，绘制时绕文字中心旋转——大角度时文字角
 *   可能越过 margin，属预期行为（与常见水印工具一致），不做旋转膨胀补偿；
 * - 字体栈沿用 exportXyzGrid 先例：Windows WebView2 必有微软雅黑，中文无豆腐块风险。
 */

export type WatermarkPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  /** 平铺整图（防盗图）：文字沿旋转方向铺满画布，margin 不参与 */
  | "tile";

export type WatermarkParams = {
  /** 水印内容（空字符串时不绘制） */
  text: string;
  /** 字号 px */
  fontSize: number;
  /** hex 颜色，如 "#FFFFFF" */
  color: string;
  /** 不透明度 1-100 */
  opacity: number;
  position: WatermarkPosition;
  /** 距图边距离 px */
  margin: number;
  /** 旋转角度（度），-90 ~ 90 */
  rotation: number;
};

export const WATERMARK_POSITIONS: readonly WatermarkPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

/** 九宫格之外的「平铺整图」位置（UI 上是九宫格下方的独立按钮） */
export const TILE_POSITION: WatermarkPosition = "tile";

function isValidPosition(value: unknown): value is WatermarkPosition {
  return WATERMARK_POSITIONS.includes(value as WatermarkPosition) || value === TILE_POSITION;
}

export const DEFAULT_WATERMARK_PARAMS: WatermarkParams = {
  text: "",
  fontSize: 32,
  color: "#FFFFFF",
  opacity: 60,
  position: "bottom-right",
  margin: 24,
  rotation: 0,
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * usePersistentState 第三参 normalize：deepMerge 只补默认值命中的路径，
 * 修不了类型错乱的坏数据（越界数值 / 非法枚举 / 非法颜色），这里统一兜底。
 */
export function normalizeWatermarkParams(merged: WatermarkParams): WatermarkParams {
  const raw = (merged ?? {}) as Partial<WatermarkParams>;
  return {
    text: typeof raw.text === "string" ? raw.text : DEFAULT_WATERMARK_PARAMS.text,
    fontSize: clamp(Math.round(toNumber(raw.fontSize, DEFAULT_WATERMARK_PARAMS.fontSize)), 6, 500),
    color: typeof raw.color === "string" && HEX_COLOR_RE.test(raw.color) ? raw.color : DEFAULT_WATERMARK_PARAMS.color,
    opacity: clamp(Math.round(toNumber(raw.opacity, DEFAULT_WATERMARK_PARAMS.opacity)), 1, 100),
    position: isValidPosition(raw.position) ? raw.position : DEFAULT_WATERMARK_PARAMS.position,
    margin: clamp(Math.round(toNumber(raw.margin, DEFAULT_WATERMARK_PARAMS.margin)), 0, 500),
    rotation: clamp(toNumber(raw.rotation, DEFAULT_WATERMARK_PARAMS.rotation), -90, 90),
  };
}

/** usePersistentState 第三参 normalize（auto 布尔开关）：boolean 之外的存储值一律回退 false */
export function normalizeWatermarkAuto(merged: unknown): boolean {
  return typeof merged === "boolean" ? merged : false;
}

/**
 * 纯几何：给定画布尺寸与文字包围盒，返回文字「中心锚点」（旋转前）。
 * margin 贴未旋转的图边；旋转由调用方绕该锚点进行。
 */
export function computeWatermarkAnchor(
  canvasW: number,
  canvasH: number,
  textW: number,
  textH: number,
  params: Pick<WatermarkParams, "position" | "margin">,
): { x: number; y: number } {
  const halfW = textW / 2;
  const halfH = textH / 2;
  const margin = Math.max(0, params.margin);

  let x: number;
  if (params.position.endsWith("left")) {
    x = margin + halfW;
  } else if (params.position.endsWith("right")) {
    x = canvasW - margin - halfW;
  } else {
    x = canvasW / 2;
  }

  let y: number;
  if (params.position.startsWith("top")) {
    y = margin + halfH;
  } else if (params.position.startsWith("bottom")) {
    y = canvasH - margin - halfH;
  } else {
    y = canvasH / 2;
  }

  return { x, y };
}

/**
 * 薄壳绘制：把水印画到已含底图的 ctx 上。
 * - 九宫格：锚点按未旋转文字包围盒 + margin，旋转绕文字中心；
 * - tile：以画布中心为轴整体旋转，奇偶行错位半步，铺满对角线覆盖范围（margin 不参与）。
 */
export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  params: WatermarkParams,
): void {
  const text = params.text;
  if (!text.trim()) return;
  ctx.save();
  ctx.globalAlpha = clamp(params.opacity, 1, 100) / 100;
  ctx.fillStyle = params.color;
  ctx.font = `600 ${params.fontSize}px "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(text);
  const textW = metrics.width;
  const ascent = metrics.actualBoundingBoxAscent;
  const descent = metrics.actualBoundingBoxDescent;
  // 老浏览器/异常环境兜底：em 高度近似 1.2 倍字号
  const textH =
    Number.isFinite(ascent) && Number.isFinite(descent) && ascent + descent > 0
      ? ascent + descent
      : params.fontSize * 1.2;

  if (params.position === TILE_POSITION) {
    // 对角线覆盖：旋转后仍铺满四角。步长与字号挂钩，防止大图上文字稀得看不见
    const diagonal = Math.hypot(canvasW, canvasH);
    const stepX = Math.max(textW * 2.2, 160);
    const stepY = Math.max(textH * 5, 120);
    ctx.translate(canvasW / 2, canvasH / 2);
    if (params.rotation !== 0) {
      ctx.rotate((params.rotation * Math.PI) / 180);
    }
    const half = diagonal / 2;
    let row = 0;
    for (let y = -half; y <= half + stepY; y += stepY, row += 1) {
      // 奇偶行错开半步，视觉上更均匀
      const stagger = row % 2 === 0 ? 0 : stepX / 2;
      for (let x = -half; x <= half + stepX; x += stepX) {
        ctx.fillText(text, x + stagger, y);
      }
    }
    ctx.restore();
    return;
  }

  const anchor = computeWatermarkAnchor(canvasW, canvasH, textW, textH, params);
  ctx.translate(anchor.x, anchor.y);
  if (params.rotation !== 0) {
    ctx.rotate((params.rotation * Math.PI) / 180);
  }
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * 对一张图（任意同源 URL）合成水印，返回新 blob URL。
 * 调用方负责 URL.revokeObjectURL 生命周期。
 */
export async function applyWatermarkToUrl(url: string, params: WatermarkParams): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取图片失败：${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建 canvas 上下文");
    ctx.drawImage(bitmap, 0, 0);
    drawWatermark(ctx, canvas.width, canvas.height, params);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!out) throw new Error("水印图导出失败");
    return URL.createObjectURL(out);
  } finally {
    bitmap.close();
  }
}

/** 有限并发 map（自动水印批量处理用，避免大批量 XYZ 解码风暴） */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 烙入工作流用：把水印渲染成两张同尺寸 PNG（约定与手写层完全一致，缺一不可）：
 * - 彩图：黑底 + 彩色水印文字（ComfyUI LoadImage 会 convert("RGB") 丢 alpha，黑底即透明区）；
 * - mask 图：白字黑底，red 通道即 alpha（半透明文字导出为灰度，合成时线性混合 ≈ alpha 混合）。
 * 尺寸 = 导出时的生图尺寸；工作流链尾 ImageScale 会拉伸到实际出图尺寸（与手写层同款容错）。
 */
export async function renderWatermarkLayers(
  width: number,
  height: number,
  params: WatermarkParams,
): Promise<{ colorBlob: Blob; maskBlob: Blob }> {
  const make = (color: string) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建 canvas 上下文");
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
    drawWatermark(ctx, width, height, { ...params, color });
    return canvas;
  };

  const colorCanvas = make(params.color);
  const maskCanvas = make("#FFFFFF");
  const [colorBlob, maskBlob] = await Promise.all([
    new Promise<Blob | null>((resolve) => colorCanvas.toBlob(resolve, "image/png")),
    new Promise<Blob | null>((resolve) => maskCanvas.toBlob(resolve, "image/png")),
  ]);
  if (!colorBlob || !maskBlob) throw new Error("水印层导出失败");
  return { colorBlob, maskBlob };
}
