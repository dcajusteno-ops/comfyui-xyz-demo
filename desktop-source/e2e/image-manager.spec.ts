import { expect, test, type Page } from "@playwright/test";

import { installApiMocks } from "./mocks";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("comfyui_xyz_welcome_seen", "true");
  });
  await installApiMocks(page);
});

/** 外置页面：独立 HTML，不挂主应用外壳 */
async function openStandalone(page: Page, query = "") {
  await page.goto(`/standalone.html${query}`);
  await expect(page.locator(".im-panel")).toBeVisible();
}

/** 一路下钻到数据集目录（3 张图） */
async function openDatasetFolder(page: Page) {
  await page.locator(".im-folder", { hasText: /^Datasets$/ }).click();
  await expect(page.locator(".im-folder", { hasText: /^dataset$/ })).toBeVisible();
  await page.locator(".im-folder", { hasText: /^dataset$/ }).click();
  await expect(page.locator(".im-folder", { hasText: /^Baixiuxiu_anima$/ })).toBeVisible();
  await page.locator(".im-folder", { hasText: /^Baixiuxiu_anima$/ }).click();
  await expect(page.locator(".im-thumb")).toHaveCount(3);
}

test("外置页面：独立地址渲染，不加载主应用外壳", async ({ page }) => {
  await openStandalone(page);
  // 主壳的标志性元素不该出现
  await expect(page.locator("h1", { hasText: "ComfyUI XYZ" })).toHaveCount(0);
  await expect(page.locator(".nav-item")).toHaveCount(0);
  await expect(page.locator(".im-root")).toContainText("F:\\mock\\ComfyUI\\output");
  await expect(page.locator(".im-root-tag")).toHaveText("自动探测");
  await expect(page.locator(".im-folder")).toHaveCount(2);
  await expect(page.locator(".im-thumb")).toHaveCount(1);
});

test("外置页面：?dir= 深链直接定位到数据集目录", async ({ page }) => {
  await openStandalone(page, "?dir=Datasets%2Fdataset");
  await expect(page.locator(".im-folder", { hasText: /^Baixiuxiu_anima$/ })).toBeVisible();
  await expect(page.locator(".im-crumb", { hasText: /^dataset$/ })).toBeVisible();
});

test("外置页面：切换子文件夹后网格更新", async ({ page }) => {
  await openStandalone(page);
  await openDatasetFolder(page);
  await expect(page.locator(".im-crumb", { hasText: /^Baixiuxiu_anima$/ })).toBeVisible();

  // 面包屑回根目录：图片只有根目录那一张
  await page.locator(".im-crumb", { hasText: /^output$/ }).click();
  await expect(page.locator(".im-thumb")).toHaveCount(1);
});

test("外置页面：全选 / 反选 / 单选计数", async ({ page }) => {
  await openStandalone(page);
  await openDatasetFolder(page);

  await page.getByRole("button", { name: "全选" }).click();
  await expect(page.locator(".im-check input:checked")).toHaveCount(3);
  await expect(page.locator(".im-danger")).toContainText("删除（3）");

  await page.getByRole("button", { name: "反选" }).click();
  await expect(page.locator(".im-check input:checked")).toHaveCount(0);
  await expect(page.locator(".im-danger")).toBeDisabled();

  await page.locator(".im-check input").first().check();
  await expect(page.locator(".im-check input:checked")).toHaveCount(1);
  await page.getByRole("button", { name: "清空" }).click();
  await expect(page.locator(".im-check input:checked")).toHaveCount(0);
});

test("外置页面：取消确认框不删除任何图片", async ({ page }) => {
  await openStandalone(page);
  await openDatasetFolder(page);

  await page.getByRole("button", { name: "全选" }).click();
  await page.locator(".im-danger").click();
  await expect(page.getByRole("dialog", { name: "删除图片" })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();

  await expect(page.locator(".im-thumb")).toHaveCount(3);
});

test("外置页面：确认后移到回收站并从网格移除", async ({ page }) => {
  await openStandalone(page);
  await openDatasetFolder(page);

  await page.getByRole("button", { name: "全选" }).click();
  await page.locator(".im-danger").click();
  await page.getByRole("button", { name: "确定删除" }).click();

  await expect(page.locator(".im-thumb")).toHaveCount(0);
  await expect(page.getByText(/已删除 3 张/)).toBeVisible();
});

test("外置页面：根目录对话框可一键使用检测到的输出目录", async ({ page }) => {
  await openStandalone(page);
  await page.getByRole("button", { name: /根目录…/ }).click();
  await expect(page.getByRole("dialog", { name: "选择默认根目录" })).toBeVisible();
  await expect(page.locator(".im-detect-row code")).toHaveText("F:\\mock\\ComfyUI\\output");

  await page.getByRole("button", { name: "用这个" }).click();
  await expect(page.getByRole("dialog", { name: "选择默认根目录" })).toHaveCount(0);
  await expect(page.locator(".im-root")).toContainText("F:\\mock\\ComfyUI\\output");
});

test("外置页面：灯箱左右切换，并可标记为删除备选", async ({ page }) => {
  await openStandalone(page);
  await openDatasetFolder(page);

  await page.locator(".im-thumb-open").first().click();
  await expect(page.locator(".lm-lightbox")).toBeVisible();
  await expect(page.locator(".lm-lightbox-caption")).toHaveText("001_00001_.png");
  await expect(page.locator(".lm-lightbox-counter")).toHaveText("1 / 3");

  await page.locator(".lm-lightbox-nav.next").click();
  await expect(page.locator(".lm-lightbox-caption")).toHaveText("002_00001_.png");
  await expect(page.locator(".lm-lightbox-counter")).toHaveText("2 / 3");

  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".lm-lightbox-caption")).toHaveText("001_00001_.png");

  await page.getByRole("button", { name: "标记删除" }).click();
  await expect(page.getByRole("button", { name: "取消标记" })).toBeVisible();
  await expect(page.locator(".lm-lightbox-marked")).toHaveText("已标记 1 张");

  await page.keyboard.press("Escape");
  await expect(page.locator(".lm-lightbox")).toHaveCount(0);
  // 灯箱里的标记会同步到网格的勾选与删除计数
  await expect(page.locator(".im-check input:checked")).toHaveCount(1);
  await expect(page.locator(".im-danger")).toContainText("删除（1）");
});

test("外置页面：关闭「移到回收站」后改为永久删除", async ({ page }) => {
  await openStandalone(page);
  await openDatasetFolder(page);

  const toggle = page.locator(".im-trash-toggle input");
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.locator(".im-trash-toggle")).toHaveClass(/is-off/);

  await page.locator(".im-check input").first().check();
  await expect(page.locator(".im-danger")).toContainText("永久删除（1）");
  await page.locator(".im-danger").click();

  await expect(page.getByRole("dialog", { name: "永久删除图片" })).toBeVisible();
  await expect(page.locator(".modal").getByText(/无法恢复/)).toBeVisible();
  await page.getByRole("button", { name: "确定删除" }).click();

  await expect(page.getByText(/已永久删除/)).toBeVisible();
  await expect(page.locator(".im-thumb")).toHaveCount(2);
});

test("数据集工作台：按钮把外置地址交给浏览器，并带上 filenameRoot", async ({ page }) => {
  await page.addInitScript(() => {
    const opened: string[] = [];
    (window as unknown as { __opened: string[] }).__opened = opened;
    window.open = ((url?: string | URL) => {
      opened.push(String(url ?? ""));
      return null;
    }) as typeof window.open;
  });
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "数据集工作台" }).click();
  await page.locator(".ds-toolbar").getByRole("button", { name: /图片管理/ }).click();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.length))
    .toBe(1);
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened[0]);
  // 外置服务地址 + 数据集落点（默认 filenameRoot = Datasets/dataset，不是它的父目录）
  expect(opened).toBe("http://127.0.0.1:9124/?dir=Datasets%2Fdataset");
});
