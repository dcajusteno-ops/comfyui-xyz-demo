/**
 * DIY 主题系统 —— 类型 / 派生 / 应用 / 迁移 / 预绘制缓存。
 *
 * 设计要点：
 * - 本模块是**纯逻辑 + DOM 应用**，不依赖 React，因此可被 uiStateStore.ts（boot 阶段，
 *   React 渲染前）与 main.tsx 安全引用。
 * - 主题应用方式：在 <html> 上内联 `style.setProperty('--x', v)`。内联自定义属性在级联中
 *   优先于 `.dark { --x }` 这条类规则（全仓库没有对令牌用 !important），因此无需新增
 *   class 或 <style> 标签，内置主题（palette 为空）则完全不注入内联值、行为与改造前一致。
 * - 库整体存一个 key（THEME_LIBRARY_KEY）。usePersistentState 的 deepMerge 对数组是
 *   「整体替换」，而我们每次写回的都是完整数组，所以这个语义正是我们要的。
 * - 关联契约：Go 侧 internal/winchrome 的 AppearanceFromUIState 必须与 deriveWindowAppearance
 *   同算法（parity 对拍），改动请同步。
 */

export type ThemeBase = "light" | "dark";
/** 兼容旧导入：AppContext 历史上导出的 Theme 就是 light/dark 二元 */
export type Theme = ThemeBase;

export type WallpaperKind = "none" | "file" | "url";
export type WallpaperFit = "cover" | "contain" | "auto";

export type WallpaperConfig = {
  kind: WallpaperKind;
  /** kind==="file"：服务端返回的引用名（形如 <sha256>.<ext>），不含目录 */
  ref?: string;
  /** kind==="url"：用户粘贴的图片地址（仅放行 http/https/data:image） */
  url?: string;
  /** 默认 cover */
  fit?: WallpaperFit;
  /** 0~1，叠加黑色遮罩强度，默认 0 */
  dim?: number;
  /** 0~1，表面不透明度倾向（越小壁纸越明显），默认 0.72 */
  surfaceAlpha?: number;
  /** 是否对主面板加 backdrop-filter 模糊，默认 false */
  blur?: boolean;
};

/** key = 不含 `--` 前缀的 CSS 变量名，value = 合法 CSS 颜色 */
export type ThemePalette = Record<string, string>;

export type ThemeDefinition = {
  id: string;
  name: string;
  base: ThemeBase;
  palette: ThemePalette;
  wallpaper: WallpaperConfig;
  /** 内置主题：不可删除 / 改名 / 覆盖，且 palette 恒为空（完全交给 styles.css） */
  builtin?: boolean;
  /**
   * 预置主题：同样不可就地修改，但 palette 自带一套配色。
   * 之所以要单独一个标记而不是复用 builtin —— builtin 在 applyThemeToDom 里代表
   * 「零内联注入」，预置主题必须注入自己的配色，语义不同。
   * 想改就「复制」一份，避免把出厂配色改坏且无法复原。
   */
  locked?: boolean;
  createdAt: number;
  updatedAt: number;
};

/**
 * 窗口标题栏底色的取色策略（仅桌面 exe 生效）。
 * - `wallpaper`：取壁纸顶部主色，再按顶栏令牌的 alpha 合成 —— 标题栏与紧挨它的 .topbar 逐像素同色
 * - `theme`：完全不看壁纸，只按主题顶栏色算（壁纸开启时的效果是「合成到页面底色」）
 * - `custom`：直接用 captionColor，不做任何合成
 */
export type WindowCaptionMode = "wallpaper" | "theme" | "custom";

export const DEFAULT_CAPTION_MODE: WindowCaptionMode = "wallpaper";

export type ThemeLibraryState = {
  /** 结构版本，见 THEME_LIBRARY_VERSION */
  version: number;
  /** 恒含两个内置主题（light / dark），且它们始终排在数组最前 */
  themes: ThemeDefinition[];
  activeThemeId: string;
  /** 关掉则把 DWM 属性复位为系统默认；仅在桌面（exe）模式下于面板中显示 */
  windowChrome?: boolean;
  /** 标题栏取色策略，默认 wallpaper（没有壁纸时三种策略等价） */
  captionMode?: WindowCaptionMode;
  /** captionMode==="custom" 时用的标题栏底色 "#rrggbb" */
  captionColor?: string;
};

export const THEME_LIBRARY_KEY = "comfyui_xyz_theme_library";
/** 仅供 index.html 内联脚本在首帧前预绘制（内容 = ThemeCache） */
export const THEME_CACHE_KEY = "comfyui_xyz_theme_cache";
/** 改造前的旧键：值就是 "light" / "dark" */
export const LEGACY_THEME_KEY = "comfyui_xyz_theme";

/**
 * 主题库结构版本。改版本号 = 需要在 normalizeThemeLibrary 里给老数据补一刀。
 * v2：壁纸默认压暗 0（v1 的默认值）→ 0.35。0 压不住亮壁纸，壁纸透出来的那部分会把
 *     面板压成中灰，而深色主题的文字是浅色 —— 实测次要文字对比度只有 2.5 左右，读不清。
 */
export const THEME_LIBRARY_VERSION = 2;

export const BUILTIN_LIGHT_ID = "builtin-light";
export const BUILTIN_DARK_ID = "builtin-dark";

const DEFAULT_SURFACE_ALPHA = 0.72;

/**
 * 壁纸默认压暗强度。墙纸越花哨越需要它：面板再半透明也挡不住「亮到发白」的那几片，
 * 而压暗是把整张图的可读性上限一次性拉下来，比一味调高面板不透明度更省事。
 */
export const DEFAULT_WALLPAPER_DIM = 0.35;

/**
 * 内容区「玻璃层」系数：workspace 已经垫了一层全 α 的底，里面的面板若再叠满 α
 * 会把壁纸压到只剩百分之十几 —— 一整片灰 film，正是「壁纸模式很敷衍」的观感来源。
 * 面板改吃半 α 的玻璃变体，文字密集的部位（卡片信息面板）才用全 α 实底。
 * 分层结果是：壁纸 → 磨砂底 → 玻璃面板 → 实底文字区，四层各有各的透明度。
 */
const WALLPAPER_GLASS_FACTOR = 0.5;

/**
 * 壁纸模式下需要半透明化的表面令牌。
 *
 * surface-alt 必须在内：它是「次级面板底色」，全仓库约 50 处拿它当背景
 * （LoRA 侧栏树、工具条、卡片封面占位、各种工具页…）。漏掉它，这些区域在壁纸下就变成
 * 一整块不透明的死黑，和周围透出壁纸的面板割裂 —— 也就是「壁纸模式不好看」的根因。
 *
 * **input-bg 有意不在内**：输入框 / 文本域是文字最密集的部位，半透明之后亮壁纸会直接把
 * 它冲成浅色（实测 rgba(#0b0813, 0.46) 压在亮绿壁纸上整个发白），而且它在 `.workspace`
 * 的玻璃作用域里没有 blur 兜底。输入框走实底（见下方 input-bg 的摊平逻辑）。
 *
 * 其余保持不透明：toast / badge / preview 面积小且需要可读性。
 */
const WALLPAPER_SURFACE_TOKENS = [
  "surface",
  "surface-alt",
  "surface-hover",
  "sidebar-bg",
  "topbar-bg",
  "modal-bg",
] as const;

/**
 * surface-alt 半透明后会连「contain/auto 时图片之外的留边」一起透出浏览器画布（浅色下是刺眼的白），
 * 所以额外派生一个**不透明**的合成色，专门喂给 html 当兜底底色（见 styles.css 的 html.has-wallpaper）。
 */
export const WALLPAPER_PAGE_VAR = "wallpaper-page";

/**
 * 内容区（.workspace）自身的「页面级磨砂底」。
 * 必须独立成令牌：.workspace 会把自己的 `--surface-alt` 重指到更透的 -glass 变体，
 * 同一个元素的 `background` 里写 `var(--surface-alt)` 会解析成那个值而不是页面级的。
 * α = surfaceAlpha（半透，壁纸透得出来），面板级是它的 WALLPAPER_GLASS_FACTOR 倍。
 */
export const WALLPAPER_BASE_VAR = "wallpaper-base";

/* ------------------------------------------------------------------ *
 * 调色板分组
 * ------------------------------------------------------------------ */

export type PaletteToken = {
  /** 不含 `--` 前缀的 CSS 变量名 */
  token: string;
  label: string;
  /** 语义色（会被派生 -soft） */
  soft?: boolean;
  /** 不是纯色（如渐变），面板只提供文本输入，不给取色器 */
  textOnly?: boolean;
};

export type PaletteGroup = { id: string; label: string; tokens: PaletteToken[] };

/**
 * 基础组只暴露「基元」。styles.css 里大量令牌是这些基元的别名
 * （--row-active: var(--accent-soft)、--card-bg: var(--surface) 等），
 * 改基元即级联，无需在 UI 里重复列出。
 */
export const PALETTE_GROUPS: PaletteGroup[] = [
  {
    id: "accent",
    label: "强调色",
    tokens: [
      { token: "accent", label: "主色" },
      { token: "accent-hover", label: "主色 · 悬停" },
    ],
  },
  {
    id: "surface",
    label: "表面",
    tokens: [
      { token: "surface", label: "面板 / 卡片" },
      { token: "surface-alt", label: "页面底色" },
      { token: "surface-hover", label: "悬停底色" },
    ],
  },
  {
    id: "border",
    label: "边框",
    tokens: [
      { token: "border", label: "常规边框" },
      { token: "border-strong", label: "强调边框" },
    ],
  },
  {
    id: "text",
    label: "文字",
    tokens: [
      { token: "text", label: "正文" },
      { token: "muted", label: "次要文字" },
    ],
  },
  {
    id: "semantic",
    label: "语义色",
    tokens: [
      { token: "danger", label: "危险", soft: true },
      { token: "success", label: "成功", soft: true },
      { token: "warning", label: "警告", soft: true },
      { token: "info", label: "信息", soft: true },
    ],
  },
  {
    id: "component",
    label: "组件底色",
    tokens: [
      { token: "sidebar-bg", label: "左侧栏" },
      { token: "topbar-bg", label: "顶栏" },
      { token: "input-bg", label: "输入框" },
      { token: "modal-bg", label: "弹窗" },
    ],
  },
];

/** 高级折叠组：中性阶 + 装饰色 + 局部组件令牌 */
export const ADVANCED_PALETTE_GROUPS: PaletteGroup[] = [
  {
    id: "neutrals",
    label: "中性阶",
    tokens: [
      "slate-50", "slate-100", "slate-200", "slate-300", "slate-400",
      "slate-500", "slate-600", "slate-700", "slate-800", "slate-900", "slate-950",
    ].map((token) => ({ token, label: token.replace("slate-", "S") })),
  },
  {
    id: "decor",
    label: "装饰 / 角色",
    tokens: [
      { token: "grad-purple", label: "紫色渐变", textOnly: true },
      { token: "grad-green", label: "绿色渐变", textOnly: true },
      ...["char-1", "char-2", "char-3", "char-4", "char-5", "char-6"].map((token) => ({
        token,
        label: `角色 ${token.slice(-1)}`,
      })),
    ],
  },
  {
    id: "misc",
    label: "其它",
    tokens: [
      { token: "preview-bg", label: "预览区底色" },
      { token: "row-bg", label: "列表行" },
      { token: "row-hover", label: "列表行 · 悬停" },
      { token: "badge-bg", label: "徽标底色" },
      { token: "badge-text", label: "徽标文字" },
      { token: "toast-bg", label: "提示条底色" },
      { token: "toast-text", label: "提示条文字" },
      { token: "toast-muted", label: "提示条次要文字" },
      { token: "toast-border", label: "提示条边框" },
    ],
  },
];

/** 基础组 + 高级组，按此顺序渲染；查找令牌也用它 */
export const ALL_PALETTE_GROUPS: PaletteGroup[] = [...PALETTE_GROUPS, ...ADVANCED_PALETTE_GROUPS];

/** 按令牌名找分组，用于「这项属于哪一组」的提示与校验 */
export function findPaletteToken(token: string): PaletteToken | undefined {
  for (const group of ALL_PALETTE_GROUPS) {
    const hit = group.tokens.find((t) => t.token === token);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * 内置主题的令牌兜底值 —— 必须与 styles.css 的 `:root` / `.dark` 逐字一致。
 * 用途：(1) 高级组比对「是否已被用户覆盖」；(2) 壁纸模式下把未覆盖的表面令牌
 * 转成半透明时取色（避免为此读 getComputedStyle 触发布局）。
 */
export const BASE_FALLBACK: Record<ThemeBase, Record<string, string>> = {
  light: {
    accent: "#d97706",
    "accent-hover": "#b45309",
    surface: "#ffffff",
    "surface-alt": "#fafaf9",
    "surface-hover": "#f5f5f4",
    border: "#e7e5e4",
    "border-strong": "#d6d3d1",
    text: "#44403c",
    muted: "#78716c",
    danger: "#e11d48",
    success: "#10b981",
    warning: "#f59e0b",
    info: "#6366f1",
    "sidebar-bg": "#ffffff",
    "topbar-bg": "rgba(255, 255, 255, 0.9)",
    "input-bg": "#ffffff",
    "modal-bg": "#ffffff",
    "preview-bg": "#f8fafc",
    "badge-bg": "#f1f5f9",
    "badge-text": "#475569",
    "toast-bg": "rgba(255, 255, 255, 0.95)",
    "toast-text": "#1c1917",
    "toast-muted": "#78716c",
    "toast-border": "rgba(0, 0, 0, 0.1)",
    "row-bg": "rgba(0, 0, 0, 0.02)",
    "row-hover": "rgba(0, 0, 0, 0.04)",
  },
  dark: {
    accent: "#f59e0b",
    "accent-hover": "#fbbf24",
    surface: "#292524",
    "surface-alt": "#1c1917",
    "surface-hover": "#44403c",
    border: "#44403c",
    "border-strong": "#57534e",
    text: "#f5f5f4",
    muted: "#a8a29e",
    danger: "#fb7185",
    success: "#34d399",
    warning: "#fbbf24",
    info: "#818cf8",
    "sidebar-bg": "#1c1917",
    "topbar-bg": "rgba(28, 25, 23, 0.9)",
    "input-bg": "#1c1917",
    "modal-bg": "#292524",
    "preview-bg": "#0c121d",
    "badge-bg": "#1e293b",
    "badge-text": "#94a3b8",
    "toast-bg": "rgba(41, 37, 36, 0.95)",
    "toast-text": "#f5f5f4",
    "toast-muted": "#a8a29e",
    "toast-border": "rgba(255, 255, 255, 0.1)",
    "row-bg": "rgba(255, 255, 255, 0.03)",
    "row-hover": "rgba(255, 255, 255, 0.06)",
  },
};

/* ------------------------------------------------------------------ *
 * 颜色工具
 * ------------------------------------------------------------------ */

export type Rgba = { r: number; g: number; b: number; a: number };

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** "#rrggbb" | "#rgb" | "#rrggbbaa" → Rgba；非 hex 返回 null */
export function parseHex(value: unknown): Rgba | null {
  if (typeof value !== "string") return null;
  const m = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  if (h.length === 6) h += "ff";
  if (h.length !== 8) return null;
  const n = Number.parseInt(h, 16);
  return {
    r: (n >>> 24) & 255,
    g: (n >>> 16) & 255,
    b: (n >>> 8) & 255,
    a: (n & 255) / 255,
  };
}

/** "#rrggbb" → "217, 119, 6"（对齐 styles.css 的 --accent-rgb 格式）；非法返回 null */
export function hexToRgb(value: unknown): string | null {
  const c = parseHex(value);
  if (!c) return null;
  return `${c.r}, ${c.g}, ${c.b}`;
}

/** 任意受支持的 CSS 颜色（hex / rgb() / rgba()）→ Rgba；不支持则 null */
export function parseColor(value: unknown): Rgba | null {
  const hex = parseHex(value);
  if (hex) return hex;
  if (typeof value !== "string") return null;
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim());
  if (!m) return null;
  return {
    r: clamp255(Number.parseFloat(m[1])),
    g: clamp255(Number.parseFloat(m[2])),
    b: clamp255(Number.parseFloat(m[3])),
    a: m[4] === undefined ? 1 : clamp01(Number.parseFloat(m[4])),
  };
}

export function toCssRgba(c: Rgba): string {
  return `rgba(${clamp255(c.r)}, ${clamp255(c.g)}, ${clamp255(c.b)}, ${Number(clamp01(c.a).toFixed(3))})`;
}

export function toHex(c: Rgba): string {
  const p = (n: number) => clamp255(n).toString(16).padStart(2, "0");
  return `#${p(c.r)}${p(c.g)}${p(c.b)}`;
}

/** 标准 alpha 合成：fg 叠在 bg 之上 */
export function compositeOver(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (f: number, b: number) => (f * fg.a + b * bg.a * (1 - fg.a)) / a;
  return { r: clamp255(mix(fg.r, bg.r)), g: clamp255(mix(fg.g, bg.g)), b: clamp255(mix(fg.b, bg.b)), a };
}

/** sRGB 通道 → 线性光（WCAG 2.x 相对亮度用） */
function linearize(channel: number): number {
  const c = clamp01(channel / 255);
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 相对亮度 0~1 */
export function relativeLuminance(c: Rgba): number {
  return 0.2126 * linearize(c.r) + 0.7152 * linearize(c.g) + 0.0722 * linearize(c.b);
}

/** WCAG 对比度 1~21 */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** hex/rgb/rgba → "#rrggbb"（带 alpha 的先按 base 底色合成）；解析失败返回 fallback */
export function resolveSolidColor(value: unknown, fallback: string, base: ThemeBase): string {
  const c = parseColor(value);
  if (!c) return fallback;
  if (c.a >= 1) return toHex(c);
  const bg = parseColor(BASE_FALLBACK[base]["surface-alt"]);
  return bg ? toHex(compositeOver(c, bg)) : fallback;
}

/** COLORREF 是 0x00BBGGRR（BGR，不是 RGB）—— Go 侧 DwmSetWindowAttribute 用 */
export function rgbToColorRef(value: unknown): number | null {
  const c = parseHex(value);
  if (!c) return null;
  return (c.b << 16) | (c.g << 8) | c.r;
}

/**
 * URL 白名单：只放行 http/https/data:image，挡掉 javascript: / vbscript: 之类
 * 会被塞进 CSS `url()` 里的伪协议。
 */
export function sanitizeUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const v = value.trim();
  if (!v) return "";
  if (/^data:image\/[a-z0-9.+-]+;/i.test(v)) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return "";
}

/** 壁纸文件名白名单（sha256 + 受支持扩展名） */
export const WALLPAPER_REF_RE = /^[0-9a-f]{64}\.(png|jpg|jpeg|webp|gif|avif)$/;

/** 壁纸上传/服务端点；与 server/theme.ts 的 WALLPAPER_ROUTE_PREFIX、internal/api/theme.go 一致 */
export const WALLPAPER_ROUTE_PREFIX = "/xyz/theme/wallpaper";

/* ------------------------------------------------------------------ *
 * 内置主题与默认库
 * ------------------------------------------------------------------ */

function theme(
  id: string,
  name: string,
  base: ThemeBase,
  palette: ThemePalette,
  options: { builtin?: boolean; locked?: boolean } = {},
): ThemeDefinition {
  return {
    id,
    name,
    base,
    palette,
    wallpaper: {
      kind: "none",
      fit: "cover",
      dim: DEFAULT_WALLPAPER_DIM,
      surfaceAlpha: DEFAULT_SURFACE_ALPHA,
      blur: false,
    },
    ...(options.builtin ? { builtin: true } : {}),
    ...(options.locked ? { locked: true } : {}),
    createdAt: 0,
    updatedAt: 0,
  };
}

/** 内置浅色 / 深色：palette 为空 = 完全交给 styles.css，保证与改造前逐像素一致 */
export const BUILTIN_LIGHT = theme(BUILTIN_LIGHT_ID, "浅色", "light", {}, { builtin: true });
export const BUILTIN_DARK = theme(BUILTIN_DARK_ID, "深色", "dark", {}, { builtin: true });

/** 预置成品配色：开箱可用的 DIY 起点（只读，点「复制」生成可编辑副本） */
const PRESET = { locked: true } as const;

export const PRESET_THEMES: ThemeDefinition[] = [
  theme("preset-cyber-neon", "赛博霓虹", "dark", {
    accent: "#22d3ee",
    "accent-hover": "#67e8f9",
    surface: "#16121f",
    "surface-alt": "#0b0813",
    "surface-hover": "#241d33",
    border: "#3b2f52",
    "border-strong": "#55446f",
    text: "#ece9f5",
    muted: "#a99fc4",
    danger: "#fb7185",
    success: "#34d399",
    warning: "#fbbf24",
    info: "#a78bfa",
    "sidebar-bg": "#0b0813",
    "topbar-bg": "#0b0813",
    "input-bg": "#0b0813",
    "modal-bg": "#16121f",
  }, PRESET),
  theme("preset-deep-space", "深空蓝", "dark", {
    accent: "#60a5fa",
    "accent-hover": "#93c5fd",
    surface: "#1e293b",
    "surface-alt": "#0f172a",
    "surface-hover": "#334155",
    border: "#334155",
    "border-strong": "#475569",
    text: "#e2e8f0",
    muted: "#94a3b8",
    "sidebar-bg": "#0f172a",
    "topbar-bg": "#0f172a",
    "input-bg": "#0f172a",
    "modal-bg": "#1e293b",
  }, PRESET),
  theme("preset-forest", "森野绿", "light", {
    accent: "#16a34a",
    "accent-hover": "#15803d",
    surface: "#ffffff",
    "surface-alt": "#f4f9f4",
    "surface-hover": "#eaf3ea",
    border: "#d9e6d9",
    "border-strong": "#bcd4bc",
    text: "#1f2d22",
    muted: "#5f7364",
    "sidebar-bg": "#ffffff",
    "topbar-bg": "#ffffff",
    "input-bg": "#ffffff",
    "modal-bg": "#ffffff",
  }, PRESET),
  theme("preset-paper", "纸感素雅", "light", {
    accent: "#8c6f4a",
    "accent-hover": "#6f5637",
    surface: "#fffdf8",
    "surface-alt": "#f6f1e7",
    "surface-hover": "#efe8da",
    border: "#e3d9c6",
    "border-strong": "#cfc0a5",
    text: "#3b352b",
    muted: "#857a66",
    "sidebar-bg": "#fffdf8",
    "topbar-bg": "#fffdf8",
    "input-bg": "#fffdf8",
    "modal-bg": "#fffdf8",
  }, PRESET),
];

export function createDefaultLibrary(): ThemeLibraryState {
  return {
    version: 1,
    themes: [cloneTheme(BUILTIN_LIGHT), cloneTheme(BUILTIN_DARK), ...PRESET_THEMES.map(cloneTheme)],
    activeThemeId: BUILTIN_LIGHT_ID,
    windowChrome: true,
    captionMode: DEFAULT_CAPTION_MODE,
  };
}

/**
 * usePersistentState 的 defaultValue。
 * 注意：它只作为「默认值模板」被 deepMerge / normalizeThemeLibrary 消费，后者总会返回新对象，
 * 因此这个模块级常量不会被就地修改。
 */
export const DEFAULT_THEME_LIBRARY: ThemeLibraryState = createDefaultLibrary();

export function cloneTheme(t: ThemeDefinition): ThemeDefinition {
  return { ...t, palette: { ...t.palette }, wallpaper: { ...t.wallpaper } };
}

export function newThemeId(): string {
  return `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 复制一份主题（新 id、新名字、清除只读标记），用于「复制」「新建」 */
export function duplicateTheme(source: ThemeDefinition, name: string): ThemeDefinition {
  const now = Date.now();
  return {
    ...cloneTheme(source),
    id: newThemeId(),
    name,
    builtin: false,
    // cloneTheme 会把 locked 一起抄过来，但复制出来的必须可编辑
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 能否就地编辑。
 * 内置（palette 空，交给 styles.css）与预置（出厂配色）都只读 —— 点「复制」生成可编辑副本，
 * 免得用户把出厂配色改坏后无法复原。
 */
export function isThemeEditable(theme: ThemeDefinition): boolean {
  return theme.builtin !== true && theme.locked !== true;
}

/** 给新主题起个不重名的名字：「自定义主题」「自定义主题 2」… */
export function nextThemeName(existing: ThemeDefinition[]): string {
  const base = "自定义主题";
  const used = new Set(existing.map((t) => t.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/* ------------------------------------------------------------------ *
 * 归一化 / 迁移
 * ------------------------------------------------------------------ */

/** 注意：`raw && typeof raw === "object"` 这种写法在 raw 为 unknown 时会把结果收窄成 {}，
 *  后续取属性全部报错，所以统一走这个类型谓词。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeWallpaper(raw: unknown): WallpaperConfig {
  const w: Partial<WallpaperConfig> = isPlainObject(raw) ? (raw as Partial<WallpaperConfig>) : {};
  const kind: WallpaperKind = w.kind === "file" || w.kind === "url" ? w.kind : "none";
  const fit: WallpaperFit = w.fit === "contain" || w.fit === "auto" ? w.fit : "cover";
  return {
    kind,
    ref: typeof w.ref === "string" ? w.ref : undefined,
    url: typeof w.url === "string" ? w.url : undefined,
    fit,
    dim: clamp01(typeof w.dim === "number" ? w.dim : DEFAULT_WALLPAPER_DIM),
    surfaceAlpha:
      typeof w.surfaceAlpha === "number" ? clamp01(w.surfaceAlpha) : DEFAULT_SURFACE_ALPHA,
    blur: w.blur === true,
  };
}

function normalizeTheme(raw: unknown): ThemeDefinition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const t = raw as Partial<ThemeDefinition>;
  if (typeof t.id !== "string" || !t.id) return null;
  const base: ThemeBase = t.base === "dark" ? "dark" : "light";
  const palette: ThemePalette = {};
  if (t.palette && typeof t.palette === "object" && !Array.isArray(t.palette)) {
    for (const [k, v] of Object.entries(t.palette)) {
      if (typeof v === "string" && v.trim()) palette[k] = v.trim();
    }
  }
  const now = Date.now();
  return {
    id: t.id,
    name: typeof t.name === "string" && t.name.trim() ? t.name.trim() : "未命名主题",
    base,
    palette,
    wallpaper: normalizeWallpaper(t.wallpaper),
    // 外部数据不许伪造内置标记：内置主题只认模块内的 BUILTIN_LIGHT / BUILTIN_DARK。
    // locked 可以保留（它只让 UI 只读，而「复制」永远能造出可编辑副本，不会把用户锁死）。
    ...(t.locked ? { locked: true } : {}),
    createdAt: typeof t.createdAt === "number" ? t.createdAt : now,
    updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : now,
  };
}

/**
 * 旧键 → 新库的一次性迁移。
 * 仅当「存储里还没有主题库」时调用 —— 否则用户后来主动选回内置浅色会被旧键反复拽回深色。
 */
export function migrateLegacyTheme(activeThemeId: string, legacyBase: unknown): string {
  if (activeThemeId !== BUILTIN_LIGHT_ID) return activeThemeId;
  return legacyBase === "dark" ? BUILTIN_DARK_ID : activeThemeId;
}

/**
 * 离线（localStorage 兜底）路径下读旧键，供 legacy 迁移判断用。
 * 服务端路径的旧键在 uiStateStore.applyBootTheme 里读，不走这里。
 */
export function readLegacyBaseFromLocalStorage(): unknown {
  try {
    for (const key of [LEGACY_THEME_KEY, "xyz_theme"]) {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
  } catch {
    // localStorage 不可用
  }
  return undefined;
}

/**
 * 读存储里的主题库结构版本。
 * 缺失/非法一律当作 v1（= 需要迁移的老数据）；**不要**默认成当前版本，否则老数据会被跳过迁移。
 */
export function readLibraryVersion(raw: unknown): number {
  if (!isPlainObject(raw)) return 1;
  const v = raw.version;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 1;
}

/**
 * 把任意外部输入（服务端 ui-state / localStorage）归一化成合法库。
 * usePersistentState 的 deepMerge 只会「补默认值命中的路径」，修不了坏数据，故必须过这里。
 * 内置主题始终以模块内的定义为准（存储里若残留同名 id 条目会被丢弃）。
 *
 * allowLegacyMigration 默认取「首个入参表示没有存储数据」——但 hook 传进来的永远是合并后的值，
 * 那种场景必须显式传 allowLegacyMigration，否则迁移不会触发。
 */
export function normalizeThemeLibrary(
  raw: unknown,
  legacyBase?: unknown,
  options?: { allowLegacyMigration?: boolean },
): ThemeLibraryState {
  const hadStored = raw !== undefined && raw !== null;
  const candidate: Partial<ThemeLibraryState> = isPlainObject(raw)
    ? (raw as Partial<ThemeLibraryState>)
    : {};

  const themes: ThemeDefinition[] = [cloneTheme(BUILTIN_LIGHT), cloneTheme(BUILTIN_DARK)];
  const seen = new Set(themes.map((t) => t.id));
  const addTheme = (t: ThemeDefinition | null) => {
    if (!t || seen.has(t.id)) return; // 内置 id 一律以模块定义为准
    seen.add(t.id);
    themes.push(t);
  };
  if (hadStored) {
    for (const item of Array.isArray(candidate.themes) ? candidate.themes : []) {
      addTheme(normalizeTheme(item));
    }
  } else {
    // 首次运行（还没有库数据）：带上预置配色作为 DIY 起点
    for (const preset of PRESET_THEMES) addTheme(cloneTheme(preset));
  }

  let activeThemeId =
    typeof candidate.activeThemeId === "string" && candidate.activeThemeId
      ? candidate.activeThemeId
      : BUILTIN_LIGHT_ID;
  if (!themes.some((t) => t.id === activeThemeId)) activeThemeId = BUILTIN_LIGHT_ID;
  if (options?.allowLegacyMigration ?? !hadStored) {
    activeThemeId = migrateLegacyTheme(activeThemeId, legacyBase);
  }

  // v1 → v2：壁纸默认压暗从 0 提到 0.35。只动「设了壁纸却压暗为 0」的主题 ——
  // 压暗 0 是我们旧版的默认值（用户基本没碰过），而它在亮壁纸上根本压不住，
  // 会把面板冲成中灰、和深色主题的浅色文字糊在一起。
  if (hadStored && readLibraryVersion(candidate) < THEME_LIBRARY_VERSION) {
    for (const t of themes) {
      if (!isWallpaperActive(t.wallpaper)) continue;
      if ((t.wallpaper.dim ?? 0) === 0) t.wallpaper = { ...t.wallpaper, dim: DEFAULT_WALLPAPER_DIM };
    }
  }

  return {
    version: THEME_LIBRARY_VERSION,
    themes,
    activeThemeId,
    windowChrome: candidate.windowChrome !== false,
    captionMode: normalizeCaptionMode(candidate.captionMode),
    ...(typeof candidate.captionColor === "string" && parseColor(candidate.captionColor)
      ? { captionColor: candidate.captionColor }
      : {}),
  };
}

function normalizeCaptionMode(value: unknown): WindowCaptionMode {
  return value === "theme" || value === "custom" || value === "wallpaper"
    ? value
    : DEFAULT_CAPTION_MODE;
}

/* ------------------------------------------------------------------ *
 * 派生
 * ------------------------------------------------------------------ */

export function getActiveTheme(state: ThemeLibraryState): ThemeDefinition {
  return state.themes.find((t) => t.id === state.activeThemeId) ?? state.themes[0] ?? BUILTIN_LIGHT;
}

export function isWallpaperActive(wp: WallpaperConfig): boolean {
  if (wp.kind === "file") return WALLPAPER_REF_RE.test(wp.ref ?? "");
  if (wp.kind === "url") return sanitizeUrl(wp.url) !== "";
  return false;
}

/** 某个令牌的「当前生效值」：用户覆盖优先，否则取内置兜底 */
export function effectiveToken(theme: ThemeDefinition, token: string): string | undefined {
  const own = theme.palette[token];
  if (own) return own;
  return BASE_FALLBACK[theme.base][token];
}

/**
 * 计算需要内联注入的 CSS 变量。
 * - 用户显式覆盖的令牌原样写入；
 * - accent / 语义色额外派生 -rgb、-soft（浏览器无法从 hex 推出 rgba）；
 * - 别名类令牌（--row-active / --badge-* / --card-bg 等）不派生，靠 styles.css 里的 var() 级联；
 * - 壁纸模式下把表面令牌（含 surface-alt）按 surfaceAlpha 半透明化，壁纸才透得出来，
 *   并额外派生一枚**不透明**的 --wallpaper-page 给 html 当留边兜底色。
 */
export function derivePaletteVars(theme: ThemeDefinition, wallpaperOn: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  const softAlpha = theme.base === "dark" ? 0.15 : 0.08;

  for (const [k, v] of Object.entries(theme.palette)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }

  const accentRgb = hexToRgb(out["accent"]);
  if (accentRgb) out["accent-rgb"] = accentRgb;
  if (accentRgb && !out["accent-soft"]) out["accent-soft"] = `rgba(${accentRgb}, ${softAlpha})`;

  for (const tok of ["danger", "success", "warning", "info"]) {
    const rgb = hexToRgb(out[tok]);
    if (rgb && !out[`${tok}-soft`]) out[`${tok}-soft`] = `rgba(${rgb}, ${softAlpha})`;
  }

  if (wallpaperOn) {
    const alpha = clamp01(theme.wallpaper.surfaceAlpha ?? DEFAULT_SURFACE_ALPHA);
    // 留边兜底色：先拿未经半透明化的 surface-alt 合成出一枚实色，再让下面的循环把它变成 rgba
    const pageSolid = resolveSolidColor(
      out["surface-alt"],
      BASE_FALLBACK[theme.base]["surface-alt"],
      theme.base,
    );
    if (pageSolid) out[WALLPAPER_PAGE_VAR] = pageSolid;
    /* 半透明化之前先把原值留一份：-solid / -glass 必须从「原值」派生。
       若在半透明化之后再读 out[tok]，-solid 拿到的就是半透明值 —— 曾经的隐性缺陷：
       --surface-solid 解析成 rgba(...,0.46)，于是 .workspace 的磨砂底和卡片信息面板
       都不真的是实底（只是叠得够多看不出来）。 */
    const rawSurfaces: Record<string, string | undefined> = {};
    for (const tok of WALLPAPER_SURFACE_TOKENS) {
      const raw = out[tok] ?? BASE_FALLBACK[theme.base][tok] ?? BASE_FALLBACK[theme.base]["surface"];
      rawSurfaces[tok] = raw;
      const c = parseColor(raw);
      if (!c) continue;
      out[tok] = toCssRgba({ ...c, a: c.a * alpha });
    }

    // 分层用的变体（只给 surface / surface-alt，text 密集的 input-bg / modal-bg 保持实底）。
    // 三档，各司其职，别再混用：
    //   -solid = 全 α（文字密集的条带：卡片信息面板、全屏覆盖层）
    //   -glass = 半 α（workspace 内部的面板：底已经垫过，再叠满就成了一片死灰）
    //   --wallpaper-base = 页面级半透明（内容区自身那层磨砂底）
    // styles.css 在 .workspace 上把 --surface / --surface-alt 重指到 -glass，内部面板即整体换挡；
    // 令牌别名（--input-bg 等）都声明在 :root，不受 .workspace 作用域影响，仍是实底。
    const baseRaw = rawSurfaces["surface-alt"] ?? BASE_FALLBACK[theme.base]["surface-alt"];
    const baseC = parseColor(baseRaw);
    if (baseC) out[WALLPAPER_BASE_VAR] = toCssRgba({ ...baseC, a: baseC.a * alpha });

    for (const tok of ["surface", "surface-alt"] as const) {
      const raw = rawSurfaces[tok];
      const solid = resolveSolidColor(raw, BASE_FALLBACK[theme.base]["surface-alt"], theme.base);
      if (solid) out[`${tok}-solid`] = solid;
      const c = parseColor(raw);
      if (c) out[`${tok}-glass`] = toCssRgba({ ...c, a: c.a * alpha * WALLPAPER_GLASS_FACTOR });
    }

    // 输入框 / 文本域摊平成实色。没有定义 input-bg 的主题会从 --surface 级联过来（styles.css 的
    // `--input-bg: var(--surface)`），而 --surface 在壁纸模式下是半透明的 → 输入框跟着半透明，
    // 亮壁纸上整个发白。这里统一摊平：自带不透明值的原样保留，半透明的压到页面底色上。
    const inputBg = resolveSolidColor(
      out["input-bg"] ?? BASE_FALLBACK[theme.base]["input-bg"],
      BASE_FALLBACK[theme.base]["input-bg"],
      theme.base,
    );
    if (inputBg) out["input-bg"] = inputBg;
  }

  return out;
}

/** 壁纸的最终 URL（file → 服务端路由；url → 原样；非法/为空 → ""） */
export function wallpaperUrl(wp: WallpaperConfig): string {
  if (wp.kind === "file") {
    const ref = wp.ref ?? "";
    return WALLPAPER_REF_RE.test(ref) ? `${WALLPAPER_ROUTE_PREFIX}/${encodeURIComponent(ref)}` : "";
  }
  if (wp.kind === "url") return sanitizeUrl(wp.url);
  return "";
}

/** 壁纸的 CSS background-image 值（dim 烘成一层 linear-gradient，省掉 ::before） */
export function buildWallpaperImage(wp: WallpaperConfig): string {
  const url = wallpaperUrl(wp);
  if (!url) return "none";
  const layers: string[] = [];
  const dim = clamp01(wp.dim ?? 0);
  if (dim > 0) layers.push(`linear-gradient(rgba(0, 0, 0, ${Number(dim.toFixed(3))}), rgba(0, 0, 0, ${Number(dim.toFixed(3))}))`);
  layers.push(`url("${url}")`);
  return layers.join(", ");
}

/* ------------------------------------------------------------------ *
 * exe 窗口外观（DWM）
 * ------------------------------------------------------------------ */

export type WindowAppearance = {
  dark: boolean;
  /** "#rrggbb"；空串 = 复位为系统默认 */
  captionColor: string;
  textColor: string;
  borderColor: string;
};

export type WindowAppearanceOptions = {
  /** 取色策略，缺省 = DEFAULT_CAPTION_MODE（跟随壁纸） */
  mode?: WindowCaptionMode;
  /** mode==="custom" 时用的 "#rrggbb" */
  customColor?: string;
  /** 壁纸顶部取样色（resolveWallpaperTint 的结果）；null/缺省 = 没取到，回退主题色 */
  wallpaperTint?: string | null;
};

/** 标题栏文字至少要有的对比度（WCAG AA 正文标准）；不达标就换成纯白/近黑 */
const CAPTION_TEXT_MIN_CONTRAST = 4.5;
/** 相对亮度低于它就当作「深色底」→ 打开 DWM 沉浸式深色（窗口按钮字形随之反色） */
const DARK_SURFACE_LUMINANCE = 0.45;

/**
 * 窗口标题栏 / 边框外观。
 *
 * 取色源是「顶栏」令牌：窗口客户区最上方就是 .topbar，标题栏取同色才有连贯感。
 * 标题栏贴不了图，所以壁纸模式下按 captionMode 决定「顶栏色压在什么底色上」：
 * - `wallpaper`（默认）：压在壁纸顶部取样色上 —— 与紧挨标题栏的 .topbar 实际渲染色一致；
 * - `theme`：压在页面兜底底色上（与改造前的行为一致，不感知壁纸）；
 * - `custom`：直接用用户指定实色，不做任何合成。
 *
 * 必须保持纯函数：取样结果由调用方传进来。这样它既能被单测直接断言，
 * 也能保证「推给 Go 的值」和「Go 冷启动读落盘值」是同一个算法算出来的。
 */
export function deriveWindowAppearance(
  theme: ThemeDefinition,
  options: WindowAppearanceOptions = {},
): WindowAppearance {
  const base = theme.base;
  const wallpaperOn = isWallpaperActive(theme.wallpaper);
  const alpha = clamp01(theme.wallpaper.surfaceAlpha ?? DEFAULT_SURFACE_ALPHA);
  const mode = options.mode ?? DEFAULT_CAPTION_MODE;

  const captionSource = theme.palette["topbar-bg"] ?? BASE_FALLBACK[base]["topbar-bg"];
  const custom = parseColor(options.customColor);
  const rawTint = parseColor(options.wallpaperTint);
  // 壁纸压暗同样作用在顶栏背后那片图上 —— 取样色不一起压暗，标题栏就会比实际渲染出来的顶栏亮一截
  const tint = rawTint
    ? compositeOver({ r: 0, g: 0, b: 0, a: clamp01(theme.wallpaper.dim ?? 0) }, rawTint)
    : null;

  let caption: string;
  if (mode === "custom" && custom) {
    caption = toHex(custom);
  } else {
    const topbar = parseColor(captionSource);
    // 标题栏下面「实际可见的那一层」：壁纸顶部取样色 → 退回页面兜底底色
    const under =
      mode === "wallpaper" && wallpaperOn && tint
        ? tint
        : wallpaperOn
          ? parseColor(BASE_FALLBACK[base]["surface-alt"])
          : null;
    caption =
      under && topbar
        ? toHex(compositeOver({ ...topbar, a: topbar.a * alpha }, under))
        : resolveSolidColor(captionSource, BASE_FALLBACK[base]["surface-alt"], base);
  }

  const preferredText = resolveSolidColor(
    effectiveToken(theme, "text"),
    BASE_FALLBACK[base]["text"],
    base,
  );

  return {
    dark: isDarkSurface(caption, base === "dark"),
    captionColor: caption,
    textColor: pickReadableText(caption, preferredText),
    borderColor: resolveSolidColor(effectiveToken(theme, "border"), BASE_FALLBACK[base]["border"], base),
  };
}

function isDarkSurface(hex: string, fallbackDark: boolean): boolean {
  const c = parseColor(hex);
  if (!c) return fallbackDark;
  return relativeLuminance(c) < DARK_SURFACE_LUMINANCE;
}

/**
 * 标题栏文字色：优先沿用主题文本色，对比度不够时按底色深浅退到近黑/纯白。
 * 取壁纸主色或用户自定义标题栏色之后，底色可能跟主题预设的深浅相反，
 * 直接沿用主题文本色会出现「浅底浅字」而糊掉，这里兜住。
 */
function pickReadableText(bgHex: string, preferred: string): string {
  const bg = parseColor(bgHex);
  if (!bg) return preferred;
  const prefer = parseColor(preferred);
  if (prefer && contrastRatio(bg, prefer) >= CAPTION_TEXT_MIN_CONTRAST) return preferred;
  const onWhite = contrastRatio(bg, { r: 255, g: 255, b: 255, a: 1 });
  const onBlack = contrastRatio(bg, { r: 17, g: 17, b: 17, a: 1 });
  return onWhite >= onBlack ? "#ffffff" : "#111111";
}

/* ------------------------------------------------------------------ *
 * 壁纸顶部取色（标题栏用；只在渲染进程里跑，Node 侧一律返回 null）
 * ------------------------------------------------------------------ */

/** 取样画布尺寸：只要一枚「主色」，不需要分辨率 */
const TINT_SAMPLE_W = 48;
const TINT_SAMPLE_H = 6;
/** 视口顶部被采样的条带高度（px）—— 标题栏紧贴客户区顶端，取最上面这几行即可 */
const TINT_VIEWPORT_BAND = 10;
const TINT_CACHE_LIMIT = 8;
/** 同一张壁纸只取样一次；失败（含跨域污染）也缓存，避免反复重试 */
const tintCache = new Map<string, string | null>();

/**
 * 「视口顶部条带」→ 图片源坐标。
 *
 * 必须与 styles.css 里 `background: <image> center / <fit> no-repeat fixed` 的排布一致：
 * fixed → 按视口排版；center → 居中；cover/contain/auto → 三种缩放。
 * 映射错了会取到图上根本没显示出来的那一片颜色（例如竖图在宽窗口里上下都被裁掉，
 * 直接取图上边缘就等于取了个不可见的色）。返回 null = 该条带完全落在图片之外（contain/auto 留边）。
 */
export function viewportBandToImage(
  imageWidth: number,
  imageHeight: number,
  fit: WallpaperFit,
  viewportWidth: number,
  viewportHeight: number,
  bandHeight: number = TINT_VIEWPORT_BAND,
): { sx: number; sy: number; sw: number; sh: number } | null {
  if (imageWidth <= 0 || imageHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return null;
  const scale =
    fit === "contain"
      ? Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight)
      : fit === "auto"
        ? 1
        : Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const ox = (viewportWidth - imageWidth * scale) / 2;
  const oy = (viewportHeight - imageHeight * scale) / 2;

  // 视口顶部条带（取中间 60% 宽，避开左右边缘）∩ 图片实际绘制区域
  const x0 = Math.max(viewportWidth * 0.2, ox);
  const x1 = Math.min(viewportWidth * 0.8, ox + imageWidth * scale);
  const y0 = Math.max(0, oy);
  const y1 = Math.min(bandHeight, oy + imageHeight * scale);
  if (x1 <= x0 || y1 <= y0) return null;

  return {
    sx: (x0 - ox) / scale,
    sy: (y0 - oy) / scale,
    sw: (x1 - x0) / scale,
    sh: (y1 - y0) / scale,
  };
}

/**
 * 取壁纸顶部主色，供标题栏合成使用。
 * 返回 null 的场景（调用方据此回退到「跟随主题」）：
 * 非浏览器环境、图片加载失败（离线 / 防盗链）、canvas 被跨域污染读不出像素。
 */
export async function resolveWallpaperTint(wp: WallpaperConfig): Promise<string | null> {
  if (typeof document === "undefined" || typeof window === "undefined") return null;
  const url = wallpaperUrl(wp);
  if (!url) return null;
  if (tintCache.has(url)) return tintCache.get(url) ?? null;

  const hex = await sampleWallpaperTint(url, wp.fit ?? "cover");
  if (tintCache.size >= TINT_CACHE_LIMIT) {
    const oldest = tintCache.keys().next().value;
    if (oldest !== undefined) tintCache.delete(oldest);
  }
  tintCache.set(url, hex);
  return hex;
}

async function sampleWallpaperTint(url: string, fit: WallpaperFit): Promise<string | null> {
  try {
    const img = await loadImageElement(url);
    const rect = viewportBandToImage(
      img.naturalWidth,
      img.naturalHeight,
      fit,
      window.innerWidth || 1280,
      window.innerHeight || 800,
    );
    if (!rect) return null;

    const canvas = document.createElement("canvas");
    canvas.width = TINT_SAMPLE_W;
    canvas.height = TINT_SAMPLE_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, TINT_SAMPLE_W, TINT_SAMPLE_H);
    return averagePixels(ctx.getImageData(0, 0, TINT_SAMPLE_W, TINT_SAMPLE_H).data);
  } catch {
    return null; // 解码失败 / SecurityError（跨域图没给 CORS 头）
  }
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // 同源（本地上传的壁纸走自己的端点）不受影响；跨域图要服务端给了 CORS 头才读得到像素
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("wallpaper decode failed"));
    img.src = url;
  });
}

/** 按 alpha 加权平均；全透明返回 null */
function averagePixels(data: Uint8ClampedArray): string | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let i = 0; i < data.length; i += 4) {
    const weight = data[i + 3] / 255;
    r += data[i] * weight;
    g += data[i + 1] * weight;
    b += data[i + 2] * weight;
    a += weight;
  }
  if (a <= 0.001) return null;
  return toHex({ r: r / a, g: g / a, b: b / a, a: 1 });
}

/* ------------------------------------------------------------------ *
 * DOM 应用
 * ------------------------------------------------------------------ */

const WALLPAPER_VARS = ["--wallpaper-image", "--wallpaper-fit", "--wallpaper-blur"] as const;

/**
 * 清掉 <html> 上的全部内联自定义属性。
 *
 * 这里用「全清」而不是记录自己设过哪些：index.html 的内联脚本会在本模块加载之前先设一批变量，
 * 那条路径拿不到我们的记录，全清才能保证切回内置主题时颜色彻底复原。
 * 安全性：全仓库只有本模块往 documentElement 写自定义属性（其它运行时变量如 --mask-color /
 * --slot-accent 是写在具体元素的 JSX style 上的，不受影响）。
 */
function clearInlineThemeVars(root: HTMLElement): void {
  const style = root.style;
  for (let i = style.length - 1; i >= 0; i -= 1) {
    const prop = style.item(i);
    if (prop && prop.startsWith("--")) style.removeProperty(prop);
  }
}

function clearWallpaperVars(root: HTMLElement): void {
  for (const name of WALLPAPER_VARS) root.style.removeProperty(name);
}

/** 同步 <meta name="theme-color">（手机端浏览器地址栏 / 状态栏跟随主题） */
function syncThemeColorMeta(theme: ThemeDefinition): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const bg = resolveSolidColor(
    effectiveToken(theme, "surface-alt"),
    BASE_FALLBACK[theme.base]["surface-alt"],
    theme.base,
  );
  meta.setAttribute("content", bg);
}

/**
 * 把主题应用到 DOM：<html> 的 dark class + 内联 CSS 变量 + 壁纸变量。
 * 幂等：每次先清掉上一次注入的内联值，再按当前主题写 —— 这是「切回内置主题」能彻底复原的关键。
 */
export function applyThemeToDom(state: ThemeLibraryState): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const theme = getActiveTheme(state);

  root.classList.toggle("dark", theme.base === "dark");

  clearInlineThemeVars(root);

  const wallpaperOn = isWallpaperActive(theme.wallpaper);
  root.classList.toggle("has-wallpaper", wallpaperOn);

  if (theme.builtin && !wallpaperOn) {
    clearWallpaperVars(root);
    syncThemeColorMeta(theme);
    return; // 内置主题零内联注入，行为与改造前完全一致
  }

  const vars = derivePaletteVars(theme, wallpaperOn);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(`--${name}`, value);
  }

  if (wallpaperOn) {
    root.style.setProperty("--wallpaper-image", buildWallpaperImage(theme.wallpaper));
    root.style.setProperty("--wallpaper-fit", theme.wallpaper.fit ?? "cover");
    root.style.setProperty("--wallpaper-blur", theme.wallpaper.blur ? "10px" : "0px");
  } else {
    clearWallpaperVars(root);
  }

  syncThemeColorMeta(theme);
}

/* ------------------------------------------------------------------ *
 * 预绘制缓存（index.html 内联脚本消费，消除冷启动闪烁）
 * ------------------------------------------------------------------ */

export type ThemeCache = {
  base: ThemeBase;
  vars: Record<string, string>;
  wallpaperImage: string | null;
  wallpaperFit: string;
  wallpaperBlur: string;
};

export function buildThemeCache(state: ThemeLibraryState): ThemeCache {
  const theme = getActiveTheme(state);
  const wallpaperOn = isWallpaperActive(theme.wallpaper);
  return {
    base: theme.base,
    vars: derivePaletteVars(theme, wallpaperOn),
    wallpaperImage: wallpaperOn ? buildWallpaperImage(theme.wallpaper) : null,
    wallpaperFit: theme.wallpaper.fit ?? "cover",
    wallpaperBlur: theme.wallpaper.blur ? "10px" : "0px",
  };
}

export function writeThemeCache(state: ThemeLibraryState): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(buildThemeCache(state)));
  } catch {
    // 隐私模式 / 配额不足：缓存写不进去不影响功能，只是下次冷启动多一段闪烁
  }
}

/* ------------------------------------------------------------------ *
 * exe 窗口外观同步
 * ------------------------------------------------------------------ */

const WINDOW_APPEARANCE_PATH = "/xyz/window/appearance";
const WINDOW_SYNC_DEBOUNCE_MS = 100;

let desktopMode: boolean | null = null;
let syncTimer: number | null = null;
/** 探测结果出来之前收到的同步请求，探测完成后补推（否则开机那次会被静默丢掉） */
let pendingChrome: ThemeLibraryState | null = null;

export function isDesktopMode(): boolean {
  return desktopMode === true;
}

/** 探测是否运行在桌面（exe）窗口里 —— 以服务端 /xyz/window/appearance 的 desktop 字段为唯一判据 */
export async function probeWindowMode(): Promise<boolean> {
  try {
    const res = await fetch(WINDOW_APPEARANCE_PATH);
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { desktop?: unknown };
    desktopMode = body.desktop === true;
  } catch {
    desktopMode = false; // 纯前端 dev / 旧服务端：按浏览器模式处理
  }
  // 探测是异步的，而首次主题 effect 一定跑在它前面；不在这里补推的话，
  // 只有等用户手动改主题窗口外观才会同步过去。
  if (desktopMode && pendingChrome) {
    const state = pendingChrome;
    pendingChrome = null;
    scheduleWindowSync(state);
  }
  return desktopMode;
}

async function postWindowAppearance(appearance: WindowAppearance): Promise<void> {
  try {
    await fetch(WINDOW_APPEARANCE_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(appearance),
    });
  } catch {
    // 窗口皮肤是锦上添花，失败静默（下次主题变更会重试）
  }
}

/** 关掉「标题栏跟随主题」时推的复位值（空串 = 交还系统默认） */
const RESET_APPEARANCE: WindowAppearance = {
  dark: false,
  captionColor: "",
  textColor: "",
  borderColor: "",
};

function scheduleWindowSync(state: ThemeLibraryState): void {
  if (syncTimer !== null) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    const theme = getActiveTheme(state);
    if (state.windowChrome === false) {
      void postWindowAppearance(RESET_APPEARANCE);
      return;
    }
    const mode = state.captionMode ?? DEFAULT_CAPTION_MODE;
    const needsTint = mode === "wallpaper" && isWallpaperActive(theme.wallpaper);
    // 取样要等图片解码（异步），所以这里不能同步算完就发 —— 否则第一次推的永远是「没取到色」的旧值
    void (async () => {
      const tint = needsTint ? await resolveWallpaperTint(theme.wallpaper) : null;
      await postWindowAppearance(
        deriveWindowAppearance(theme, { mode, customColor: state.captionColor, wallpaperTint: tint }),
      );
    })();
  }, WINDOW_SYNC_DEBOUNCE_MS);
}

/**
 * 把当前主题对应的窗口外观推给后端（仅桌面模式）。
 * fire-and-forget + 100ms 防抖；Go 侧 Applier.Apply 自带去重，boot 时重复推送无害。
 */
export function syncWindowChrome(state: ThemeLibraryState): void {
  if (typeof window === "undefined") return;
  pendingChrome = state;
  if (!isDesktopMode()) return;
  pendingChrome = null;
  scheduleWindowSync(state);
}
