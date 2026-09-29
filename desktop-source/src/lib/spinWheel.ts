/**
 * 转盘几何：纯函数，零 React / 零 DOM 依赖，`random` 可注入以便测试。
 *
 * 角度约定（全局唯一，渲染与换算必须共用）：
 *   0° = 12 点方向；顺时针为正；与 CSS `rotate()` 同向。
 *   指针固定在看板 0°。
 *   极坐标：x = cx + r·sin(θ)，y = cy − r·cos(θ)。
 *   扇区 i（共 n 个）占本地角 [i·(360/n), (i+1)·(360/n))，中心角 center_i = (i + 0.5)·(360/n)。
 */

export const WHEEL_SIZE = 200;
export const WHEEL_CENTER = WHEEL_SIZE / 2;
export const WHEEL_OUTER_R = 96;
export const WHEEL_HUB_R = 30;

/** 扇区显示名的截断按「英文 = 1 单位、CJK = 2 单位」计宽，见 truncateLabel。 */

export function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** 扇区中心角（度）。必须用中心角：用起始角会让指针停在扇区边缘。 */
export function sectorCenterAngle(index: number, count: number): number {
  return (index + 0.5) * (360 / count);
}

export function polarToCartesian(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

/** 圆环扇区 path（含内孔）。count === 1 时起止点重合导致弧退化，调用方需改用 <circle> 分支。 */
export function sectorPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startDeg: number,
  endDeg: number
): string {
  const o0 = polarToCartesian(cx, cy, rOuter, startDeg);
  const o1 = polarToCartesian(cx, cy, rOuter, endDeg);
  const i1 = polarToCartesian(cx, cy, rInner, endDeg);
  const i0 = polarToCartesian(cx, cy, rInner, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return (
    `M ${o0.x} ${o0.y} A ${rOuter} ${rOuter} 0 ${large} 1 ${o1.x} ${o1.y} ` +
    `L ${i1.x} ${i1.y} A ${rInner} ${rInner} 0 ${large} 0 ${i0.x} ${i0.y} Z`
  );
}

export type RotationOptions = {
  minTurns?: number;
  maxTurns?: number;
  offsetRatio?: number;
  random?: () => number;
};

/**
 * 计算让 winnerIndex 扇区中心停在指针下所需的目标角度。
 * 返回值严格大于 currentRotation（只向前累积），因此不会倒转。
 */
export function computeTargetRotation(
  currentRotation: number,
  winnerIndex: number,
  sectorCount: number,
  opts: RotationOptions = {}
): number {
  const { minTurns = 3, maxTurns = 6, offsetRatio = 0.3, random = Math.random } = opts;
  if (sectorCount <= 0) return currentRotation;

  const section = 360 / sectorCount;
  const center = sectorCenterAngle(winnerIndex, sectorCount);
  // 扇区内微抖动：|offsetRatio| 必须 < 0.5，否则指针会越出中奖扇区
  const jitter = (random() * 2 - 1) * Math.min(Math.abs(offsetRatio), 0.49) * section;
  const desiredMod = normalizeAngle(-(center + jitter));

  let delta = desiredMod - normalizeAngle(currentRotation);
  if (delta < 0) delta += 360;

  const span = Math.max(0, maxTurns - minTurns);
  const turns = minTurns + Math.floor(random() * (span + 1));
  return currentRotation + delta + turns * 360;
}

/** 逆运算：给定 rotation，返回指针实际指向的扇区索引。用于断言与调试。 */
export function resolveWinnerIndex(rotation: number, sectorCount: number): number {
  if (sectorCount <= 0) return -1;
  return Math.floor(normalizeAngle(-rotation) / (360 / sectorCount)) % sectorCount;
}

function charWidth(ch: string): number {
  return /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 2 : 1;
}

/** 按显示宽度量一段文字（英文 = 1 单位、CJK = 2 单位）。 */
export function measureLabelWidth(text: string): number {
  return Array.from(text.trim()).reduce((sum, ch) => sum + charWidth(ch), 0);
}

const ELLIPSIS = "…";
const ELLIPSIS_WIDTH = 1;

/** 已抽中的扇区要在标签尾部挂一个「✓」徽标，排版预算必须把它留出来。 */
export const CHECK_BADGE_UNITS = 2;

/**
 * 按显示宽度截断标签。
 * 注意：**省略号本身也占宽度**，截断时要先把它让出来，否则结果会超出 maxChars
 * （早期版本漏了这一步，长标签会冲出扇区）。
 */
export function truncateLabel(text: string, maxChars: number): string {
  const source = text.trim();
  if (!source || maxChars <= ELLIPSIS_WIDTH) return "";
  if (measureLabelWidth(source) <= maxChars) return source;

  const kept = Array.from(source);
  const widthOf = () => kept.reduce((sum, ch) => sum + charWidth(ch), 0);
  while (kept.length > 0 && widthOf() + ELLIPSIS_WIDTH > maxChars) kept.pop();
  return kept.length > 0 ? `${kept.join("")}${ELLIPSIS}` : "";
}

export type WheelLabelLayout = {
  x: number;
  y: number;
  rotate: number;
  anchor: "start" | "end";
  fontSize: number;
  maxChars: number;
};

/** 径向排布扇区标签；左半侧翻转 180° 以免文字倒置。 */
export function wheelLabelLayout(
  index: number,
  count: number,
  rInner: number = WHEEL_HUB_R,
  rOuter: number = WHEEL_OUTER_R
): WheelLabelLayout {
  const angle = sectorCenterAngle(index, count);
  // 起点贴着内圈外沿（圆心 hub 是 34% 直径 = 半径 34 单位，留一点余量），把径向长度尽量让给文字
  const rText = rInner + (rOuter - rInner) * 0.12;
  const point = polarToCartesian(WHEEL_CENTER, WHEEL_CENTER, rText, angle);
  const flip = Math.sin((angle * Math.PI) / 180) < 0;
  const fontSize = Math.min(13, Math.max(9, rOuter / 8 - count * 0.12));
  const maxChars = Math.max(2, Math.floor((rOuter - rText - 6) / (fontSize * 0.62)));
  return {
    x: point.x,
    y: point.y,
    rotate: flip ? angle + 90 : angle - 90,
    anchor: flip ? "end" : "start",
    fontSize,
    maxChars,
  };
}
