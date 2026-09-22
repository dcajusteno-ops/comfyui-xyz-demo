import { expect, test } from "@playwright/test";

import { installApiMocks } from "./mocks";

const NAV_LABELS = [
  "默认生图",
  "多人工作流",
  "高清修复",
  "灵感老虎机",
  "WD1.4",
  "文字特效",
  "XYZ 控制器",
  "LoRA 管理",
  "记事本",
];

test.beforeEach(async ({ page }) => {
  // 预置「已看过欢迎页」标记：首次访问会弹出欢迎弹窗，其遮罩会拦截全部指针事件
  await page.addInitScript(() => {
    localStorage.setItem("comfyui_xyz_welcome_seen", "true");
  });
  await installApiMocks(page);
});

test("应用加载：主壳与全部标签页渲染", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "ComfyUI XYZ" })).toBeVisible();
  for (const label of NAV_LABELS) {
    await expect(page.locator(".nav-item", { hasText: label })).toBeVisible();
  }
});

test("默认生图：下拉选项由 object_info 填充（useOptions 解构错位回归防线）", async ({ page }) => {
  await page.goto("/");
  // 此前 useOptions 的 Promise.all 解构错位导致全部下拉为空——此断言守住选项填充
  await expect(page.getByLabel("大模型").locator("option")).toHaveCount(2);
  await expect(page.getByLabel("采样器").locator("option")).toHaveCount(2);
  await expect(page.getByLabel("调度器").locator("option")).toHaveCount(2);
});

test("标签切换：LoRA 管理器侧边栏折叠与持久化（D5）", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "LoRA 管理" }).click();
  await expect(page.locator(".lm-sidebar-root", { hasText: "全部 LoRA" })).toBeVisible();
  await expect(page.getByRole("button", { name: "收起 SDXL" })).toBeVisible();

  // 折叠 SDXL：子树隐藏
  await page.getByRole("button", { name: "收起 SDXL" }).click();
  await expect(page.getByRole("button", { name: "展开 SDXL" })).toBeVisible();
  await expect(page.locator(".lm-folder-node button", { hasText: "画师" })).toHaveCount(0);

  // 刷新后折叠状态持久保留
  await page.reload();
  await expect(page.getByRole("button", { name: "展开 SDXL" })).toBeVisible();
  await expect(page.locator(".lm-folder-node button", { hasText: "画师" })).toHaveCount(0);

  // 重新展开
  await page.getByRole("button", { name: "展开 SDXL" }).click();
  await expect(page.locator(".lm-folder-node button", { hasText: "画师" })).toBeVisible();
});

test("标签切换：WD1.4 面板激活", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "WD1.4" }).click();
  await expect(page.locator(".nav-item", { hasText: "WD1.4" })).toHaveClass(/active/);
});

test("简易 LoRA 管理器弹窗：打开与折叠交互", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("添加 LoRA").click();
  await expect(page.getByText("简易 LoRA 管理器")).toBeVisible();
  await expect(page.locator(".lm-sidebar-root", { hasText: "全部 LoRA" })).toBeVisible();
  // 叶子节点（动漫）无折叠箭头
  await expect(page.getByRole("button", { name: "收起 动漫" })).toHaveCount(0);
  // 折叠 SDXL：子树隐藏
  await page.getByRole("button", { name: "收起 SDXL" }).click();
  await expect(page.getByRole("button", { name: "展开 SDXL" })).toBeVisible();
  await expect(page.locator(".lm-folder-node button", { hasText: "画师" })).toHaveCount(0);
});

test("主题切换：昼夜模式", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("切换到暗色模式").click();
  await expect(page.getByTitle("切换到亮色模式")).toBeVisible();
});
