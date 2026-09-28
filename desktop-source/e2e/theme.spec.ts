import { expect, test, type Page } from "@playwright/test";

import { installApiMocks } from "./mocks";

/**
 * DIY 主题系统 E2E。
 *
 * 覆盖：主题面板入口、主题库列表、只读语义（内置/预置不可就地改，须先复制）、切主题的实时应用
 * （html class + 内联变量）、手改颜色与单项还原、高级折叠组、非桌面模式下标题栏开关禁用，
 * 以及「切回内置主题要把内联变量清干净」这条最容易回归的约束。
 *
 * 不覆盖：壁纸上传（需要构造 PNG；该链路由 server/theme.test.ts 的契约测试 +
 * .workbuddy/verify-theme-ui.cjs 走真实中间件端到端验证）。
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("comfyui_xyz_welcome_seen", "true");
  });
  await installApiMocks(page);
});

async function openThemePanel(page: Page) {
  await page.goto("/");
  await page.locator(".theme-toggle").click();
  await expect(page.locator(".theme-panel")).toBeVisible();
}

/**
 * 按「名字」精确定位主题行。
 * 不能用 `.theme-library-item:has-text("深色")`：每行的元信息里也带「深色/浅色」，
 * 会同时命中「深空蓝」「赛博霓虹」等，触发 strict mode violation。
 */
const themeRow = (page: Page, name: string) =>
  page.locator(".theme-library-item").filter({
    has: page.locator(".theme-library-name", { hasText: new RegExp(`^${name}$`) }),
  });

const inlineVars = (page: Page) =>
  page.evaluate(() => {
    const style = document.documentElement.getAttribute("style") ?? "";
    const vars: Record<string, string> = {};
    for (const part of style.split(";")) {
      const [name, value] = part.split(":");
      if (name && value) vars[name.trim()] = value.trim();
    }
    return { cls: document.documentElement.className, vars, styleLen: style.length };
  });

const accentVar = async (page: Page) => (await inlineVars(page)).vars["--accent"];

const BUILTINS = ["浅色", "深色"];
const PRESETS = ["赛博霓虹", "深空蓝", "森野绿", "纸感素雅"];

test("主题库：内置 + 预置都在列表里，且都是只读（无重命名/删除）", async ({ page }) => {
  await openThemePanel(page);

  for (const name of [...BUILTINS, ...PRESETS]) {
    await expect(themeRow(page, name)).toHaveCount(1);
  }
  for (const name of [...BUILTINS, ...PRESETS]) {
    await expect(themeRow(page, name).getByTitle("删除")).toHaveCount(0);
    await expect(themeRow(page, name).getByTitle("重命名")).toHaveCount(0);
  }
  // 预置带自己的徽标，内置带「内置」
  await expect(themeRow(page, "浅色")).toContainText("内置");
  await expect(themeRow(page, "赛博霓虹")).toContainText("预置");
});

test("切主题：实时应用 html class 与内联 CSS 变量", async ({ page }) => {
  await openThemePanel(page);

  await themeRow(page, "赛博霓虹").locator(".theme-library-main").click();
  const cyber = await inlineVars(page);
  expect(cyber.cls).toContain("dark");
  expect(cyber.vars["--accent"]).toBe("#22d3ee");
  // accent 的派生值必须跟着走（浏览器推不出 rgba，只能由 derivePaletteVars 生成）
  expect(cyber.vars["--accent-rgb"]).toBe("34, 211, 238");
  expect(cyber.vars["--accent-soft"]).toMatch(/^rgba\(34, 211, 238/);

  await themeRow(page, "森野绿").locator(".theme-library-main").click();
  const forest = await inlineVars(page);
  expect(forest.cls).not.toContain("dark");
  expect(forest.vars["--accent"]).toBe("#16a34a");
});

test("只读主题：调色板禁用，「复制并编辑」生成可编辑副本", async ({ page }) => {
  await openThemePanel(page);
  await themeRow(page, "赛博霓虹").locator(".theme-library-main").click();

  await expect(page.locator(".theme-palette-swatch").first()).toBeDisabled();
  await expect(page.getByText(/这套主题不可就地修改/)).toBeVisible();

  await page.locator(".theme-tabs button", { hasText: "复制并编辑" }).click();
  await expect(page.locator(".theme-palette-swatch").first()).toBeEnabled();
  await expect(themeRow(page, "自定义主题")).toHaveCount(1);
  // 副本带上了原主题的配色
  expect(await accentVar(page)).toBe("#22d3ee");
});

test("配色编辑：手改实时生效，单项还原回落到内置基底值", async ({ page }) => {
  await openThemePanel(page);
  await themeRow(page, "赛博霓虹").locator(".theme-library-main").click();
  await page.locator(".theme-tabs button", { hasText: "复制并编辑" }).click();

  // 按 label 的 title（= 令牌名）定位，避免受行内「已改」标记影响
  const accentRow = page.locator(".theme-palette-row").filter({
    has: page.locator('.theme-palette-label[title="accent"]'),
  });
  const accentText = accentRow.locator(".theme-palette-text");

  // 副本沿用了预置的整套配色，所以一开始就是「已改」状态
  await expect(accentRow.locator(".theme-palette-overridden")).toHaveCount(1);

  await accentText.fill("#ff3366");
  await expect.poll(() => accentVar(page)).toBe("#ff3366");
  await expect(accentRow.locator(".theme-palette-overridden")).toHaveCount(1);

  // 「还原为内置值」= 从 palette 里删掉该键，于是这项跟随基底的 styles.css 值（不再有内联值）
  await accentRow.getByTitle("还原为内置值").click();
  await expect.poll(async () => (await inlineVars(page)).vars["--accent"]).toBeUndefined();
  await expect(accentRow.locator(".theme-palette-overridden")).toHaveCount(0);
});

test("放弃本次修改：整体回滚到打开面板时的状态", async ({ page }) => {
  await openThemePanel(page); // 打开时生效的是内置浅色
  await themeRow(page, "赛博霓虹").locator(".theme-library-main").click();
  await page.locator(".theme-tabs button", { hasText: "复制并编辑" }).click();
  await page
    .locator(".theme-palette-row")
    .filter({ has: page.locator('.theme-palette-label[title="accent"]') })
    .locator(".theme-palette-text")
    .fill("#00ff00");
  await expect.poll(() => accentVar(page)).toBe("#00ff00");

  await page.locator(".theme-panel-footer").getByText("放弃本次修改").click();
  const back = await inlineVars(page);
  expect(back.cls).toBe("");
  expect(back.styleLen).toBe(0);
});

test("高级折叠组：展开后可见中性阶与装饰色，渐变不给取色器", async ({ page }) => {
  await openThemePanel(page);
  await themeRow(page, "赛博霓虹").locator(".theme-library-main").click();

  await expect(page.locator('.theme-palette-row:has-text("S500")')).toHaveCount(0);
  await page.locator(".theme-advanced-toggle").click();
  await expect(page.locator('.theme-palette-row:has-text("S500")')).toBeVisible();
  await expect(page.locator('.theme-palette-row:has-text("角色 1")')).toBeVisible();
  await expect(page.locator('.theme-palette-row:has-text("紫色渐变") input[type="color"]')).toHaveCount(0);
});

test("基础页：非桌面模式下标题栏开关与基底切换都不可用", async ({ page }) => {
  await openThemePanel(page);
  await page.locator(".theme-tab", { hasText: "基础" }).click();

  await expect(page.locator('.theme-check input[type="checkbox"]')).toBeDisabled();
  await expect(page.locator(".theme-check")).toContainText("当前不是桌面窗口模式");

  // 内置主题的基底不可改（改了就成第二个内置了）
  const baseSegments = page.locator(".theme-segmented button");
  await expect(baseSegments.first()).toBeDisabled();
  await expect(baseSegments.nth(1)).toBeDisabled();
});

test("基础页（桌面模式）：标题栏取色策略可选，并把算好的外观推给窗口", async ({ page }) => {
  // 覆盖 /xyz/window/appearance：假装跑在桌面窗口里（desktop:true），顺带记录前端推过来的外观。
  // 必须在 goto 之前注册，否则 probeWindowMode 那次 GET 会落到 vite 插件的 desktop:false stub 上。
  const posts: Array<Record<string, unknown>> = [];
  const json = (data: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  await page.route(/\/xyz\/window\/appearance/, (route) => {
    if (route.request().method() === "POST") {
      posts.push(JSON.parse(route.request().postData() ?? "null") as Record<string, unknown>);
      return route.fulfill(json({ success: true, desktop: true, caps: {} }));
    }
    return route.fulfill(
      json({
        success: true,
        desktop: true,
        appearance: { dark: false, captionColor: "", textColor: "", borderColor: "" },
        caps: { immersiveDark: true, captionColor: true, textColor: true, borderColor: true },
      })
    );
  });

  await openThemePanel(page);
  await page.locator(".theme-tab", { hasText: "基础" }).click();

  // 桌面模式下开关可用，且出现取色策略
  await expect(page.locator('.theme-check input[type="checkbox"]')).toBeEnabled();
  const modeButtons = page.locator(".theme-segmented button");
  await expect(modeButtons.filter({ hasText: "取壁纸主色" })).toHaveCount(1);
  await expect(modeButtons.filter({ hasText: "取壁纸主色" })).toHaveClass(/active/);

  await modeButtons.filter({ hasText: "自定义" }).click();
  await page.locator('.theme-palette-row:has-text("标题栏底色") .theme-palette-text').fill("#123456");
  await expect.poll(() => posts.some((p) => p.captionColor === "#123456")).toBe(true);
});

test("切回内置主题：dark 类与全部内联变量都被清理干净", async ({ page }) => {
  await openThemePanel(page);
  await themeRow(page, "深空蓝").locator(".theme-library-main").click();
  expect(await accentVar(page)).toBe("#60a5fa");

  await themeRow(page, "浅色").locator(".theme-library-main").click();
  const back = await inlineVars(page);
  expect(back.cls).toBe("");
  // 内置主题零内联注入：守住「自定义主题留下的内联值不会脏到内置主题」
  expect(back.styleLen).toBe(0);
});

test("新建与删除：生成可编辑副本，删除需确认", async ({ page }) => {
  await openThemePanel(page);
  const before = await page.locator(".theme-library-item").count();

  await page.locator(".theme-text-btn", { hasText: "新建" }).click();
  await expect(page.locator(".theme-library-item")).toHaveCount(before + 1);
  await expect(themeRow(page, "自定义主题")).toHaveCount(1);

  // 自建主题可以重命名
  await themeRow(page, "自定义主题").getByTitle("重命名").click();
  await page.locator(".theme-rename-input").fill("我的主题");
  await page.locator(".theme-rename-input").press("Enter");
  await expect(themeRow(page, "我的主题")).toHaveCount(1);

  // 删除会走全局确认弹窗
  await themeRow(page, "我的主题").getByTitle("删除").click();
  await expect(page.getByText("删除主题")).toBeVisible();
  await page.getByRole("button", { name: "确定删除" }).click();
  await expect(page.locator(".theme-library-item")).toHaveCount(before);
});
