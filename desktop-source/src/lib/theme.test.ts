import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ADVANCED_PALETTE_GROUPS,
  BASE_FALLBACK,
  BUILTIN_DARK,
  BUILTIN_DARK_ID,
  BUILTIN_LIGHT,
  BUILTIN_LIGHT_ID,
  DEFAULT_CAPTION_MODE,
  DEFAULT_WALLPAPER_DIM,
  PALETTE_GROUPS,
  PRESET_THEMES,
  THEME_CACHE_KEY,
  THEME_LIBRARY_VERSION,
  WALLPAPER_REF_RE,
  WALLPAPER_ROUTE_PREFIX,
  applyThemeToDom,
  buildThemeCache,
  buildWallpaperImage,
  clamp01,
  compositeOver,
  createDefaultLibrary,
  derivePaletteVars,
  deriveWindowAppearance,
  duplicateTheme,
  getActiveTheme,
  hexToRgb,
  isThemeEditable,
  isWallpaperActive,
  migrateLegacyTheme,
  newThemeId,
  nextThemeName,
  normalizeThemeLibrary,
  parseColor,
  readLibraryVersion,
  resolveSolidColor,
  rgbToColorRef,
  sanitizeUrl,
  viewportBandToImage,
  writeThemeCache,
} from "./theme";
import type { ThemeDefinition, ThemeLibraryState } from "./theme";

/* ------------------------------------------------------------------ *
 * 工具：读 <html> 的内联样式
 * jsdom 的 CSSStyleDeclaration 对自定义属性支持有版本差异，统一改读 style 属性字符串，
 * 这样断言的是「真的写进 DOM 了」，而不是「setProperty 没抛错」。
 * ------------------------------------------------------------------ */

const inlineStyle = () => document.documentElement.getAttribute("style") ?? "";
const inlineVar = (name: string): string | null => {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(inlineStyle());
  return m ? m[1].trim() : null;
};

const themeWith = (patch: Partial<ThemeDefinition>): ThemeDefinition => ({
  id: "t-test",
  name: "测试主题",
  base: "light",
  palette: {},
  wallpaper: { kind: "none", fit: "cover", dim: 0, surfaceAlpha: 0.72, blur: false },
  createdAt: 0,
  updatedAt: 0,
  ...patch,
});

const libraryWith = (theme: ThemeDefinition): ThemeLibraryState => ({
  version: 1,
  themes: [BUILTIN_LIGHT, BUILTIN_DARK, theme],
  activeThemeId: theme.id,
  windowChrome: true,
});

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("class");
  document.documentElement.removeAttribute("style");
});

afterEach(() => {
  document.documentElement.removeAttribute("class");
  document.documentElement.removeAttribute("style");
});

/* ------------------------------------------------------------------ */

describe("颜色工具", () => {
  it("hexToRgb 输出与 styles.css 的 --accent-rgb 同格式", () => {
    expect(hexToRgb("#d97706")).toBe("217, 119, 6");
    expect(hexToRgb("#fff")).toBe("255, 255, 255");
    expect(hexToRgb("d97706")).toBeNull();
    expect(hexToRgb("rgba(1,2,3,0.5)")).toBeNull();
    expect(hexToRgb(undefined)).toBeNull();
  });

  it("rgbToColorRef 输出 COLORREF（0x00BBGGRR，BGR 不是 RGB）", () => {
    // #d97706 → r=0xD9 g=0x77 b=0x06 → COLORREF 0x000677D9
    expect(rgbToColorRef("#d97706")).toBe(0x000677d9);
    expect(rgbToColorRef("#ffffff")).toBe(0x00ffffff);
    expect(rgbToColorRef("#0000ff")).toBe(0x00ff0000); // 纯蓝在 COLORREF 里高位
    expect(rgbToColorRef("nope")).toBeNull();
  });

  it("parseColor 支持 hex / rgb() / rgba()", () => {
    expect(parseColor("#ffffff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("rgba(0, 0, 0, 0.5)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor("#ffffffff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("var(--accent)")).toBeNull();
    expect(parseColor("")).toBeNull();
  });

  it("compositeOver 做标准 alpha 合成", () => {
    const fg = { r: 255, g: 255, b: 255, a: 0.5 };
    const bg = { r: 0, g: 0, b: 0, a: 1 };
    const mixed = compositeOver(fg, bg);
    expect(mixed.r).toBe(128);
    expect(mixed.g).toBe(128);
    expect(mixed.b).toBe(128);
    expect(mixed.a).toBe(1);
  });

  it("resolveSolidColor 把半透明色按页面底色摊平成实色", () => {
    expect(resolveSolidColor("#123456", "#000000", "light")).toBe("#123456");
    // 白色 50% 叠在 #fafaf9 上 → 接近白
    expect(resolveSolidColor("rgba(255, 255, 255, 0.5)", "#000000", "light")).toMatch(/^#f[0-9a-f]{5}$/);
    expect(resolveSolidColor("var(--x)", "#abcdef", "light")).toBe("#abcdef");
    expect(resolveSolidColor(undefined, "#abcdef", "dark")).toBe("#abcdef");
  });

  it("clamp01 处理越界与 NaN", () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });

  it("sanitizeUrl 只放行 http/https/data:image", () => {
    expect(sanitizeUrl("https://a.com/b.png")).toBe("https://a.com/b.png");
    expect(sanitizeUrl("http://a.com/b.png")).toBe("http://a.com/b.png");
    expect(sanitizeUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(sanitizeUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeUrl("  ")).toBe("");
    expect(sanitizeUrl(null)).toBe("");
  });

  it("壁纸 ref 白名单只接受 sha256 + 受支持扩展名", () => {
    const sha = "a".repeat(64);
    expect(WALLPAPER_REF_RE.test(`${sha}.png`)).toBe(true);
    expect(WALLPAPER_REF_RE.test(`${sha}.webp`)).toBe(true);
    expect(WALLPAPER_REF_RE.test(`${sha}.svg`)).toBe(false);
    expect(WALLPAPER_REF_RE.test(`${"a".repeat(63)}.png`)).toBe(false);
    expect(WALLPAPER_REF_RE.test(`../../etc/passwd.png`)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe("调色板分组", () => {
  it("基础组不含已被证实为死令牌的 card-bg（全仓库无 var(--card-bg) 引用）", () => {
    const tokens = PALETTE_GROUPS.flatMap((g) => g.tokens.map((t) => t.token));
    expect(tokens).not.toContain("card-bg");
    expect(tokens).toContain("accent");
    expect(tokens).toContain("surface");
  });

  it("内置兜底值覆盖基础组的每一个令牌", () => {
    for (const base of ["light", "dark"] as const) {
      for (const group of PALETTE_GROUPS) {
        for (const token of group.tokens) {
          expect(BASE_FALLBACK[base][token.token], `${base}/${token.token}`).toBeTruthy();
        }
      }
    }
  });

  it("高级组覆盖中性阶与装饰色", () => {
    const advanced = ADVANCED_PALETTE_GROUPS.flatMap((g) => g.tokens.map((t) => t.token));
    expect(advanced).toContain("slate-500");
    expect(advanced).toContain("char-1");
    expect(advanced).toContain("grad-purple");
  });
});

/* ------------------------------------------------------------------ */

describe("normalizeThemeLibrary", () => {
  it("无数据（首次运行）→ 内置两条 + 预置配色，active = 内置浅色", () => {
    const lib = normalizeThemeLibrary(undefined);
    expect(lib.themes[0].id).toBe(BUILTIN_LIGHT_ID);
    expect(lib.themes[1].id).toBe(BUILTIN_DARK_ID);
    expect(lib.themes.length).toBe(2 + PRESET_THEMES.length);
    expect(lib.activeThemeId).toBe(BUILTIN_LIGHT_ID);
    expect(lib.windowChrome).toBe(true);
    expect(lib.captionMode).toBe(DEFAULT_CAPTION_MODE);
  });

  it("captionMode / captionColor 归一化：仅接受白名单与合法颜色", () => {
    const bad = normalizeThemeLibrary({
      version: 1,
      themes: [],
      activeThemeId: BUILTIN_LIGHT_ID,
      captionMode: "bogus",
      captionColor: "not-a-color",
    });
    expect(bad.captionMode).toBe(DEFAULT_CAPTION_MODE);
    expect(bad.captionColor).toBeUndefined();

    const ok = normalizeThemeLibrary({
      version: 1,
      themes: [],
      activeThemeId: BUILTIN_LIGHT_ID,
      captionMode: "custom",
      captionColor: "#123456",
    });
    expect(ok.captionMode).toBe("custom");
    expect(ok.captionColor).toBe("#123456");
  });

  it("readLibraryVersion：缺失/非法一律当作 v1（必须走迁移，不能默认成当前版本）", () => {
    expect(readLibraryVersion(undefined)).toBe(1);
    expect(readLibraryVersion("垃圾")).toBe(1);
    expect(readLibraryVersion({})).toBe(1);
    expect(readLibraryVersion({ version: 0 })).toBe(1);
    expect(readLibraryVersion({ version: "3" })).toBe(1);
    expect(readLibraryVersion({ version: 2 })).toBe(2);
  });

  it("v1 → v2 迁移：只给「设了壁纸但压暗为 0」的主题补默认压暗", () => {
    const custom = {
      ...BUILTIN_DARK,
      id: "custom-x",
      name: "自定",
      builtin: false,
      wallpaper: {
        kind: "url" as const,
        url: "https://a/b.png",
        fit: "cover" as const,
        dim: 0,
        surfaceAlpha: 0.58,
        blur: true,
      },
    };
    const lib = normalizeThemeLibrary({ version: 1, themes: [custom], activeThemeId: "custom-x" });
    expect(lib.version).toBe(THEME_LIBRARY_VERSION);
    expect(lib.themes.find((t) => t.id === "custom-x")?.wallpaper.dim).toBe(DEFAULT_WALLPAPER_DIM);

    // 已是 v2 的库：用户显式选回 0 必须被尊重
    const zeroed = { ...custom, wallpaper: { ...custom.wallpaper, dim: 0 } };
    const lib2 = normalizeThemeLibrary({
      version: THEME_LIBRARY_VERSION,
      themes: [zeroed],
      activeThemeId: "custom-x",
    });
    expect(lib2.themes.find((t) => t.id === "custom-x")?.wallpaper.dim).toBe(0);

    // 没设壁纸的主题不受迁移影响
    const noWallpaper = {
      ...custom,
      id: "custom-y",
      wallpaper: { kind: "none" as const, fit: "cover" as const, dim: 0, surfaceAlpha: 0.58, blur: false },
    };
    const lib3 = normalizeThemeLibrary({ version: 1, themes: [noWallpaper], activeThemeId: "custom-y" });
    expect(lib3.themes.find((t) => t.id === "custom-y")?.wallpaper.dim).toBe(0);
  });

  it("已有库数据时不再补预置配色（用户可能主动删掉了）", () => {
    const stored = { version: 1, themes: [BUILTIN_LIGHT, BUILTIN_DARK], activeThemeId: BUILTIN_DARK_ID };
    const lib = normalizeThemeLibrary(stored);
    expect(lib.themes.length).toBe(2);
    expect(lib.activeThemeId).toBe(BUILTIN_DARK_ID);
  });

  it("themes 不是数组 → 回退到只有内置两条，不炸", () => {
    const lib = normalizeThemeLibrary({ version: 1, themes: "坏数据", activeThemeId: "x" });
    expect(lib.themes.map((t) => t.id)).toEqual([BUILTIN_LIGHT_ID, BUILTIN_DARK_ID]);
    expect(lib.activeThemeId).toBe(BUILTIN_LIGHT_ID);
  });

  it("剔除坏条目并丢弃伪造的 builtin 标记", () => {
    const lib = normalizeThemeLibrary({
      version: 1,
      themes: [
        null,
        42,
        { id: "ok", name: "正常", base: "dark", palette: { accent: "#123456" } },
        { id: "fake", name: "伪内置", base: "light", builtin: true },
        { name: "没有 id" },
      ],
      activeThemeId: "fake",
    });
    expect(lib.themes.map((t) => t.id)).toEqual([BUILTIN_LIGHT_ID, BUILTIN_DARK_ID, "ok", "fake"]);
    expect(lib.themes.find((t) => t.id === "fake")?.builtin).toBeUndefined();
  });

  it("activeThemeId 指向不存在的主题 → 回落内置浅色", () => {
    const lib = normalizeThemeLibrary({ version: 1, themes: [], activeThemeId: "ghost" });
    expect(lib.activeThemeId).toBe(BUILTIN_LIGHT_ID);
  });

  it("存储里的 builtin id 条目不会覆盖模块内定义", () => {
    const lib = normalizeThemeLibrary({
      version: 1,
      themes: [{ id: BUILTIN_LIGHT_ID, name: "被篡改", base: "dark", palette: { accent: "#f00" } }],
      activeThemeId: BUILTIN_LIGHT_ID,
    });
    const light = lib.themes.find((t) => t.id === BUILTIN_LIGHT_ID)!;
    expect(light.name).toBe("浅色");
    expect(light.base).toBe("light");
    expect(light.palette).toEqual({});
  });

  it("windowChrome 只有显式 false 才关闭", () => {
    expect(normalizeThemeLibrary({ version: 1, themes: [], windowChrome: false }).windowChrome).toBe(false);
    expect(normalizeThemeLibrary({ version: 1, themes: [] }).windowChrome).toBe(true);
  });

  it("createDefaultLibrary 返回独立副本（改一份不影响另一份）", () => {
    const a = createDefaultLibrary();
    const b = createDefaultLibrary();
    a.themes[2].palette.accent = "#000000";
    expect(b.themes[2].palette.accent).not.toBe("#000000");
  });

  it("newThemeId 每次不同", () => {
    expect(newThemeId()).not.toBe(newThemeId());
  });
});

describe("旧键迁移", () => {
  it("没有库数据 + 旧键 dark → 切到内置深色", () => {
    const lib = normalizeThemeLibrary(undefined, "dark");
    expect(lib.activeThemeId).toBe(BUILTIN_DARK_ID);
  });

  it("没有库数据 + 旧键 light / 缺失 → 保持内置浅色", () => {
    expect(normalizeThemeLibrary(undefined, "light").activeThemeId).toBe(BUILTIN_LIGHT_ID);
    expect(normalizeThemeLibrary(undefined, undefined).activeThemeId).toBe(BUILTIN_LIGHT_ID);
  });

  it("已有库数据时旧键不生效（否则用户选回浅色会被旧键反复拽回深色）", () => {
    const stored = { version: 1, themes: [], activeThemeId: BUILTIN_LIGHT_ID };
    expect(normalizeThemeLibrary(stored, "dark").activeThemeId).toBe(BUILTIN_LIGHT_ID);
  });

  it("migrateLegacyTheme 只动内置浅色这一种情况", () => {
    expect(migrateLegacyTheme(BUILTIN_LIGHT_ID, "dark")).toBe(BUILTIN_DARK_ID);
    expect(migrateLegacyTheme(BUILTIN_DARK_ID, "light")).toBe(BUILTIN_DARK_ID);
    expect(migrateLegacyTheme("custom-1", "dark")).toBe("custom-1");
  });
});

/* ------------------------------------------------------------------ */

describe("derivePaletteVars", () => {
  it("accent 自动派生 accent-rgb / accent-soft（亮色 alpha 0.08）", () => {
    const vars = derivePaletteVars(themeWith({ palette: { accent: "#16a34a" } }), false);
    expect(vars["accent"]).toBe("#16a34a");
    expect(vars["accent-rgb"]).toBe("22, 163, 74");
    expect(vars["accent-soft"]).toBe("rgba(22, 163, 74, 0.08)");
  });

  it("深色基底派生 alpha 0.15", () => {
    const vars = derivePaletteVars(themeWith({ base: "dark", palette: { accent: "#60a5fa", danger: "#fb7185" } }), false);
    expect(vars["accent-soft"]).toBe("rgba(96, 165, 250, 0.15)");
    expect(vars["danger-soft"]).toBe("rgba(251, 113, 133, 0.15)");
  });

  it("用户显式给了 -soft 就不覆盖", () => {
    const vars = derivePaletteVars(themeWith({ palette: { accent: "#16a34a", "accent-soft": "rgba(1,2,3,0.9)" } }), false);
    expect(vars["accent-soft"]).toBe("rgba(1,2,3,0.9)");
  });

  it("未覆盖的令牌不注入（交给 styles.css 的 :root / .dark）", () => {
    const vars = derivePaletteVars(themeWith({ palette: { accent: "#16a34a" } }), false);
    expect(vars["surface"]).toBeUndefined();
    expect(vars["text"]).toBeUndefined();
  });

  it("别名类令牌不派生（靠 styles.css 里的 var() 级联）", () => {
    const vars = derivePaletteVars(themeWith({ palette: { accent: "#16a34a" } }), false);
    expect(vars["row-active"]).toBeUndefined();
    expect(vars["badge-bg"]).toBeUndefined();
  });

  it("壁纸模式：表面令牌按 surfaceAlpha 半透明化，未覆盖的用内置兜底值", () => {
    const vars = derivePaletteVars(
      themeWith({ wallpaper: { kind: "url", url: "https://a/b.png", surfaceAlpha: 0.5 } }),
      true,
    );
    expect(vars["surface"]).toBe("rgba(255, 255, 255, 0.5)");
    // 深色兜底 topbar-bg 本身是 0.9 → 0.9 * 0.5 = 0.45
    const dark = derivePaletteVars(
      themeWith({
        base: "dark",
        palette: { "topbar-bg": "rgba(28, 25, 23, 0.9)" },
        wallpaper: { kind: "url", url: "https://a/b.png", surfaceAlpha: 0.5 },
      }),
      true,
    );
    expect(dark["topbar-bg"]).toBe("rgba(28, 25, 23, 0.45)");
  });

  it("壁纸模式：次级面板底色 surface-alt 也半透明化（否则侧栏树 / 卡片封面在壁纸下是一块死黑）", () => {
    const vars = derivePaletteVars(
      themeWith({ wallpaper: { kind: "url", url: "https://a/b.png", surfaceAlpha: 0.5 } }),
      true,
    );
    expect(vars["surface-alt"]).toBe("rgba(250, 250, 249, 0.5)");
    // 留边兜底色得是不透明实色，否则 contain/auto 的信箱区会透出浏览器画布
    expect(vars["wallpaper-page"]).toBe("#fafaf9");
    // toast / badge 面积小且要可读，仍保持不透明
    expect(vars["toast-bg"]).toBeUndefined();
    expect(vars["badge-bg"]).toBeUndefined();
  });

  it("壁纸模式：solid / glass / wallpaper-base 三档各就位（solid 必须真的不透明）", () => {
    const vars = derivePaletteVars(
      themeWith({ wallpaper: { kind: "url", url: "https://a/b.png", surfaceAlpha: 0.5 } }),
      true,
    );
    // 全 α：文字密集的条带（卡片信息面板、全屏大图覆盖层）。曾经从半透明化之后的值派生，
    // 结果 -solid 也是半透明 —— 大图查看的面板半透，身后弹窗的表格透上来糊成一片。
    expect(vars["surface-solid"]).toBe("#ffffff");
    expect(vars["surface-alt-solid"]).toBe("#fafaf9");
    // 半 α：workspace 内部的面板（0.5 × 0.5）
    expect(vars["surface-glass"]).toBe("rgba(255, 255, 255, 0.25)");
    // 页面级：内容区自身的磨砂底，α 就是 surfaceAlpha
    expect(vars["wallpaper-base"]).toBe("rgba(250, 250, 249, 0.5)");
  });

  it("非壁纸模式不注入 surface-alt / wallpaper-page / wallpaper-base（内置主题逐像素不变的前提）", () => {
    const vars = derivePaletteVars(themeWith({ palette: { accent: "#16a34a" } }), false);
    expect(vars["surface-alt"]).toBeUndefined();
    expect(vars["wallpaper-page"]).toBeUndefined();
    expect(vars["wallpaper-base"]).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */

describe("壁纸", () => {
  it("isWallpaperActive 按 kind 判定", () => {
    const ref = "a".repeat(64) + ".png";
    expect(isWallpaperActive({ kind: "none", ref })).toBe(false);
    expect(isWallpaperActive({ kind: "file", ref })).toBe(true);
    expect(isWallpaperActive({ kind: "file", ref: "../../etc" })).toBe(false);
    expect(isWallpaperActive({ kind: "url", url: "https://a/b.png" })).toBe(true);
    expect(isWallpaperActive({ kind: "url", url: "javascript:alert(1)" })).toBe(false);
  });

  it("buildWallpaperImage 用站内引用路径 / 直连 URL", () => {
    const ref = "a".repeat(64) + ".png";
    expect(buildWallpaperImage({ kind: "file", ref })).toBe(`url("/xyz/theme/wallpaper/${ref}")`);
    expect(buildWallpaperImage({ kind: "url", url: "https://a/b.png" })).toBe('url("https://a/b.png")');
    expect(buildWallpaperImage({ kind: "url", url: "javascript:1" })).toBe("none");
  });

  it("dim 以 linear-gradient 图层形式烘进 background-image", () => {
    const img = buildWallpaperImage({ kind: "url", url: "https://a/b.png", dim: 0.5 });
    expect(img.startsWith("linear-gradient(rgba(0, 0, 0, 0.5)")).toBe(true);
    expect(img.endsWith('url("https://a/b.png")')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe("deriveWindowAppearance（必须与 Go 侧 internal/winchrome 同算法）", () => {
  const brightness = (hex: string) => {
    const c = parseColor(hex)!;
    return c.r + c.g + c.b;
  };

  it("内置浅色 → 浅色标题栏", () => {
    const app = deriveWindowAppearance(BUILTIN_LIGHT);
    expect(app.dark).toBe(false);
    expect(brightness(app.captionColor)).toBeGreaterThan(700);
    expect(brightness(app.textColor)).toBeLessThan(400);
  });

  it("内置深色 → 深色标题栏", () => {
    const app = deriveWindowAppearance(BUILTIN_DARK);
    expect(app.dark).toBe(true);
    expect(brightness(app.captionColor)).toBeLessThan(150);
    expect(brightness(app.textColor)).toBeGreaterThan(600);
  });

  it("自定义 topbar-bg 直接成为标题栏底色", () => {
    const app = deriveWindowAppearance(themeWith({ palette: { "topbar-bg": "#123456" } }));
    expect(app.captionColor).toBe("#123456");
  });

  it("只改 surface 不影响标题栏（标题栏跟随顶栏 topbar-bg，与客户区最上方的 .topbar 连贯）", () => {
    const app = deriveWindowAppearance(themeWith({ palette: { surface: "#abcdef" } }));
    // 顶栏令牌未改 → 仍是内置浅色的近白顶栏
    expect(brightness(app.captionColor)).toBeGreaterThan(700);
  });

  it("壁纸模式：标题栏用「顶栏色按 surfaceAlpha 合成到页面底色」的实色", () => {
    const plain = deriveWindowAppearance(themeWith({ palette: { "topbar-bg": "#000000" } }));
    const wp = deriveWindowAppearance(
      themeWith({
        palette: { "topbar-bg": "#000000" },
        wallpaper: { kind: "url", url: "https://a/b.png", surfaceAlpha: 0.25 },
      }),
    );
    expect(plain.captionColor).toBe("#000000");
    // 25% 黑叠在 #fafaf9 上 → 明显不是纯黑，但仍比页面底色暗
    expect(wp.captionColor).not.toBe("#000000");
    expect(brightness(wp.captionColor)).toBeLessThan(brightness(BASE_FALLBACK.light["surface-alt"]));
  });

  it("输出的三个颜色都是实色 #rrggbb（DWM 只吃实色）", () => {
    for (const t of [BUILTIN_LIGHT, BUILTIN_DARK, ...PRESET_THEMES]) {
      const app = deriveWindowAppearance(t);
      for (const c of [app.captionColor, app.textColor, app.borderColor]) {
        expect(c, `${t.id}`).toMatch(/^#[0-9a-f]{6}$/);
      }
      // 带壁纸主色时也必须是实色
      const tinted = deriveWindowAppearance(t, { wallpaperTint: "#ff77aa" });
      for (const c of [tinted.captionColor, tinted.textColor, tinted.borderColor]) {
        expect(c, `${t.id} +tint`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("默认（取壁纸主色）：顶栏色按 surfaceAlpha 压在壁纸顶部色上 → 与顶栏实际渲染色一致", () => {
    const theme = themeWith({
      palette: { "topbar-bg": "#000000" },
      wallpaper: { kind: "url", url: "https://a/b.png", surfaceAlpha: 0.5 },
    });
    expect(deriveWindowAppearance(theme, { wallpaperTint: "#ffffff" }).captionColor).toBe("#808080");
    // 取样失败（离线 / 跨域）时退回页面底色合成，不能崩
    expect(deriveWindowAppearance(theme, { wallpaperTint: null }).captionColor).toMatch(/^#[0-9a-f]{6}$/);
    // 压暗也要算进去：50% 压暗把取样色压成 128 灰，再被 50% 顶栏压 → 64 → #404040
    const withDim = deriveWindowAppearance(
      themeWith({
        palette: { "topbar-bg": "#000000" },
        wallpaper: { kind: "url", url: "https://a/b.png", surfaceAlpha: 0.5, dim: 0.5 },
      }),
      { wallpaperTint: "#ffffff" },
    );
    expect(withDim.captionColor).toBe("#404040");
  });

  it("mode=theme：忽略壁纸主色，等价于旧行为", () => {
    const theme = themeWith({
      palette: { "topbar-bg": "#000000" },
      wallpaper: { kind: "url", url: "https://a/b.png", surfaceAlpha: 0.5 },
    });
    const withTint = deriveWindowAppearance(theme, { mode: "theme", wallpaperTint: "#ffffff" });
    const without = deriveWindowAppearance(theme, { mode: "theme" });
    expect(withTint.captionColor).toBe(without.captionColor);
    expect(withTint.captionColor).not.toBe("#808080");
  });

  it("mode=custom：直接用指定色、不做任何合成；非法色值退回主题算法", () => {
    const theme = themeWith({
      palette: { "topbar-bg": "#000000" },
      wallpaper: { kind: "url", url: "https://a/b.png", surfaceAlpha: 0.5 },
    });
    const app = deriveWindowAppearance(theme, {
      mode: "custom",
      customColor: "#123456",
      wallpaperTint: "#ffffff",
    });
    expect(app.captionColor).toBe("#123456");

    const bad = deriveWindowAppearance(BUILTIN_LIGHT, { mode: "custom", customColor: "nope" });
    expect(bad.captionColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("标题栏文字色：底色跟主题相反时自动反色（取壁纸主色后可能浅底浅字）", () => {
    const theme = themeWith({
      base: "dark",
      palette: { "topbar-bg": "#ffffff", text: "#f5f5f4" },
      wallpaper: { kind: "url", url: "https://a/b.png", surfaceAlpha: 1 },
    });
    const app = deriveWindowAppearance(theme, { wallpaperTint: "#ffffff" });
    expect(app.captionColor).toBe("#ffffff");
    expect(app.textColor).toBe("#111111");
    expect(app.dark).toBe(false); // 沉浸式深色要跟着标题栏底色的深浅走，否则窗口按钮字形反色
  });
});

/* ------------------------------------------------------------------ */

describe("viewportBandToImage（壁纸取样必须与 CSS 的 background 排布一致）", () => {
  it("cover：宽图铺满视口 → 顶部条带就是图片上边缘", () => {
    // 1600x900 进 1440x900：scale = max(0.9, 1) = 1，左右各裁 80
    const band = viewportBandToImage(1600, 900, "cover", 1440, 900, 10);
    expect(band).not.toBeNull();
    expect(band!.sx).toBeCloseTo(1440 * 0.2 + 80, 5);
    expect(band!.sw).toBeCloseTo(1440 * 0.6, 5);
    expect(band!.sy).toBe(0);
    expect(band!.sh).toBe(10);
  });

  it("cover：竖图在宽视口里上下被裁 → 条带取自图中部，绝不是图上边缘", () => {
    // 900x1600 进 1440x900：scale = 1.6，绘制高 2560，上下各裁 830
    const band = viewportBandToImage(900, 1600, "cover", 1440, 900, 10);
    expect(band).not.toBeNull();
    expect(band!.sy).toBeCloseTo(830 / 1.6, 5);
    expect(band!.sy).toBeGreaterThan(500);
  });

  it("contain：条带落在留边里就返回 null（交给调用方回退主题色）", () => {
    // 横图 contain 进高视口 → 上下留边，顶部条带整条在留边内
    expect(viewportBandToImage(1600, 900, "contain", 800, 1200, 10)).toBeNull();
    // 竖图 contain 进宽视口 → 顶部从 0 开始，能取到
    expect(viewportBandToImage(900, 1600, "contain", 1440, 900, 10)).not.toBeNull();
  });

  it("非法尺寸返回 null", () => {
    expect(viewportBandToImage(0, 100, "cover", 800, 600)).toBeNull();
    expect(viewportBandToImage(100, 100, "cover", 0, 600)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

describe("applyThemeToDom", () => {
  const html = () => document.documentElement;

  it("内置浅色：不加 dark，也不注入任何内联变量", () => {
    applyThemeToDom({ version: 1, themes: [BUILTIN_LIGHT, BUILTIN_DARK], activeThemeId: BUILTIN_LIGHT_ID });
    expect(html().classList.contains("dark")).toBe(false);
    expect(inlineStyle()).toBe("");
  });

  it("内置深色：只加 dark class", () => {
    applyThemeToDom({ version: 1, themes: [BUILTIN_LIGHT, BUILTIN_DARK], activeThemeId: BUILTIN_DARK_ID });
    expect(html().classList.contains("dark")).toBe(true);
    expect(inlineStyle()).toBe("");
  });

  it("自定义主题：注入内联 CSS 变量", () => {
    applyThemeToDom(libraryWith(themeWith({ palette: { accent: "#16a34a" } })));
    expect(inlineVar("--accent")).toBe("#16a34a");
    expect(inlineVar("--accent-rgb")).toBe("22, 163, 74");
    expect(inlineVar("--accent-soft")).toBe("rgba(22, 163, 74, 0.08)");
  });

  it("切回内置主题时内联变量被彻底清除（含 index.html 预绘制脚本留下的那批）", () => {
    // 模拟 index.html 内联脚本先设了一批变量
    html().style.setProperty("--accent", "#deadbe");
    html().style.setProperty("--surface", "#deadbe");
    applyThemeToDom(libraryWith(themeWith({ palette: { accent: "#16a34a" } })));
    expect(inlineVar("--accent")).toBe("#16a34a");

    applyThemeToDom({ version: 1, themes: [BUILTIN_LIGHT, BUILTIN_DARK], activeThemeId: BUILTIN_LIGHT_ID });
    expect(inlineStyle()).toBe("");
    expect(inlineVar("--accent")).toBeNull();
  });

  it("壁纸模式加 has-wallpaper class 并写入壁纸变量", () => {
    const ref = "a".repeat(64) + ".png";
    applyThemeToDom(
      libraryWith(
        themeWith({
          wallpaper: { kind: "file", ref, fit: "contain", dim: 0.2, surfaceAlpha: 0.6, blur: true },
        }),
      ),
    );
    expect(html().classList.contains("has-wallpaper")).toBe(true);
    expect(inlineVar("--wallpaper-image")).toContain(`/xyz/theme/wallpaper/${ref}`);
    expect(inlineVar("--wallpaper-fit")).toBe("contain");
    expect(inlineVar("--wallpaper-blur")).toBe("10px");
    expect(inlineVar("--surface")).toBe("rgba(255, 255, 255, 0.6)");
  });

  it("从壁纸主题切到非壁纸主题时壁纸变量被清掉", () => {
    const ref = "a".repeat(64) + ".png";
    applyThemeToDom(libraryWith(themeWith({ wallpaper: { kind: "file", ref } })));
    expect(html().classList.contains("has-wallpaper")).toBe(true);

    applyThemeToDom(libraryWith(themeWith({ palette: { accent: "#123456" } })));
    expect(html().classList.contains("has-wallpaper")).toBe(false);
    expect(inlineVar("--wallpaper-image")).toBeNull();
  });

  it("base 与 class 同步切换", () => {
    applyThemeToDom(libraryWith(themeWith({ base: "dark" })));
    expect(html().classList.contains("dark")).toBe(true);
    applyThemeToDom(libraryWith(themeWith({ base: "light" })));
    expect(html().classList.contains("dark")).toBe(false);
  });
});

describe("预绘制缓存", () => {
  it("buildThemeCache 含已派生变量与壁纸信息", () => {
    const ref = "a".repeat(64) + ".png";
    const cache = buildThemeCache(
      libraryWith(themeWith({ base: "dark", palette: { accent: "#60a5fa" }, wallpaper: { kind: "file", ref, blur: true } })),
    );
    expect(cache.base).toBe("dark");
    expect(cache.vars["accent-rgb"]).toBe("96, 165, 250");
    expect(cache.vars["accent-soft"]).toBe("rgba(96, 165, 250, 0.15)");
    expect(cache.wallpaperImage).toContain(ref);
    expect(cache.wallpaperBlur).toBe("10px");
  });

  it("非壁纸主题的 wallpaperImage 为 null", () => {
    const cache = buildThemeCache(libraryWith(themeWith({})));
    expect(cache.wallpaperImage).toBeNull();
    expect(cache.wallpaperFit).toBe("cover");
  });

  it("writeThemeCache 落进 localStorage，可被人肉读回", () => {
    writeThemeCache(libraryWith(themeWith({ base: "dark" })));
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).base).toBe("dark");
  });

  it("getActiveTheme 在 active 缺失时回落第一个（内置浅色）", () => {
    const lib: ThemeLibraryState = { version: 1, themes: [BUILTIN_LIGHT, BUILTIN_DARK], activeThemeId: "ghost" };
    expect(getActiveTheme(lib).id).toBe(BUILTIN_LIGHT_ID);
  });
});

/* ------------------------------------------------------------------ */

describe("只读与复制", () => {
  it("内置与预置都不可就地编辑，用户自建的可以", () => {
    expect(isThemeEditable(BUILTIN_LIGHT)).toBe(false);
    expect(isThemeEditable(BUILTIN_DARK)).toBe(false);
    for (const preset of PRESET_THEMES) {
      expect(preset.locked, preset.id).toBe(true);
      expect(isThemeEditable(preset), preset.id).toBe(false);
    }
    expect(isThemeEditable(themeWith({}))).toBe(true);
  });

  it("预置主题自带配色（不同于内置的空 palette）", () => {
    for (const preset of PRESET_THEMES) {
      expect(Object.keys(preset.palette).length, preset.id).toBeGreaterThan(5);
    }
    expect(BUILTIN_LIGHT.palette).toEqual({});
  });

  it("复制出来的主题可编辑、有新 id、与新名字", () => {
    const source = PRESET_THEMES[0];
    const copy = duplicateTheme(source, "我的霓虹");
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe("我的霓虹");
    expect(copy.builtin).toBe(false);
    expect(copy.locked).toBe(false);
    expect(isThemeEditable(copy)).toBe(true);
    // 配色原样带过来
    expect(copy.palette).toEqual(source.palette);
    // 改副本不能影响原主题（palette 是深拷贝）
    copy.palette.accent = "#000000";
    expect(source.palette.accent).toBe("#22d3ee");
  });

  it("复制内置主题也得到可编辑副本", () => {
    const copy = duplicateTheme(BUILTIN_DARK, "深色改");
    expect(isThemeEditable(copy)).toBe(true);
    expect(copy.palette).toEqual({});
  });

  it("nextThemeName 生成不重名的名字", () => {
    expect(nextThemeName([])).toBe("自定义主题");
    expect(nextThemeName([themeWith({ id: "a", name: "自定义主题" })])).toBe("自定义主题 2");
    expect(
      nextThemeName([
        themeWith({ id: "a", name: "自定义主题" }),
        themeWith({ id: "b", name: "自定义主题 2" }),
      ]),
    ).toBe("自定义主题 3");
  });

  it("locked 会随存储往返保留（预置读只读状态在刷新后仍在）", () => {
    const stored = {
      version: 1,
      themes: [{ id: "preset-cyber-neon", name: "被改名", base: "dark", locked: true, palette: {} }],
      activeThemeId: "preset-cyber-neon",
    };
    const lib = normalizeThemeLibrary(stored);
    const preset = lib.themes.find((t) => t.id === "preset-cyber-neon")!;
    expect(preset.locked).toBe(true);
    expect(isThemeEditable(preset)).toBe(false);
  });
});

describe("壁纸端点常量", () => {
  it("与 server/theme.ts / internal/api/theme.go 保持一致", () => {
    expect(WALLPAPER_ROUTE_PREFIX).toBe("/xyz/theme/wallpaper");
  });
});
