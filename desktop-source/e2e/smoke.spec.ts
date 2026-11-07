import { expect, test } from "@playwright/test";

import { installApiMocks } from "./mocks";

const NAV_LABELS = [
  "默认生图",
  "多人工作流",
  "高清修复",
  "三视图",
  "数据集工作台",
  "幸运大转盘",
  "WD1.4",
  "文字特效",
  "XYZ 控制器",
  "LoRA 管理",
  "Anima 词库",
  "Anima 造型台",
  "Anima 工作台",
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

test("三视图：模式切换与三视图 LoRA 的兜底挂载", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "三视图" }).click();

  await expect(page.getByRole("heading", { name: "三视图", exact: true })).toBeVisible();
  // mock 的 LoRA 列表里没有三视图 LoRA → 应提示「按相对路径挂载」而不是报错/空白
  await expect(page.getByText(/已按相对路径挂载/)).toBeVisible();

  // 切到 SDXL：LoRA 规格随模型族变化
  await page.getByRole("button", { name: "SDXL · Illustrious / NoobAI" }).click();
  await expect(page.getByText("三视图 LoRA（Illustrious）")).toBeVisible();
});

test("LoRA 卡片快捷插入：六个目标都可达（含 Anima / 三视图 / 数据集）", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "LoRA 管理" }).click();

  const card = page.locator(".lora-card").first();
  await card.hover();
  const actions = card.locator(".card-quick-actions button");
  await expect(actions).toHaveCount(6);
  await expect(actions.filter({ hasText: "Anima" })).toBeVisible();
  await expect(actions.filter({ hasText: "三视" })).toBeVisible();
  await expect(actions.filter({ hasText: "数据" })).toBeVisible();

  // 点三视图必须落到三视图页的 LoRA 列表，而不是静默写进默认生图
  await actions.filter({ hasText: "三视" }).click();
  await expect(page.getByText(/-> 三视图/)).toBeVisible();
  await page.locator(".nav-item", { hasText: "三视图" }).click();
  await expect(page.locator(".lora-selection-card", { hasText: "ashima-style" })).toHaveCount(1);
});

test("默认生图：下拉选项由 object_info 填充（useOptions 解构错位回归防线）", async ({ page }) => {
  await page.goto("/");
  // 此前 useOptions 的 Promise.all 解构错位导致全部下拉为空——此断言守住选项填充。
  // 下拉已换成自带弹层的自定义组件（原生 select 在深色下是灰底白字），
  // 因此改为「打开弹层 → 数选项」：数量不对同样是解构错位的信号。
  for (const label of ["大模型", "采样器", "调度器"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator(".al-select-popup .al-select-option")).toHaveCount(2);
    await page.keyboard.press("Escape");
  }
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

test("主题：侧栏入口打开主题面板", async ({ page }) => {
  await page.goto("/");
  // 侧栏底部按钮已由「深色/浅色模式」快切改为「主题」面板入口
  await expect(page.locator(".theme-toggle")).toHaveText(/主题/);
  await page.locator(".theme-toggle").click();
  await expect(page.locator(".theme-panel")).toBeVisible();
  // 用名字精确匹配：行的元信息里也带「深色/浅色」，用 hasText 会命中多行
  await expect(
    page.locator(".theme-library-item").filter({ has: page.locator(".theme-library-name", { hasText: /^深色$/ }) }),
  ).toHaveCount(1);
  await expect(page.locator(".theme-library-item", { hasText: "赛博霓虹" })).toHaveCount(1);
});

test("Anima 词库：入口、五分区与拼接预览", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "Anima 词库" }).click();
  await expect(page.getByRole("heading", { name: "Anima 词库" })).toBeVisible();
  await expect(page.locator(".al-section-tabs button")).toHaveCount(5);

  // 安装包必须内嵌全部词库（exe 的 dist 由 go:embed 打包，漏拷数据文件在这里兜底）
  const manifest = await page.evaluate(async () => (await fetch("/data/anima/manifest.json")).json());
  expect(manifest.source.version).toBe("3.3.1");
  expect(manifest.counts.artists).toBe(40600);
  expect(manifest.counts.characters).toBe(8000);

  // 原生 select 的弹层在深色下是系统浅底 + 主题亮字，必须走自绘下拉
  await expect(page.locator(".al-gallery select")).toHaveCount(0);
  await page.getByLabel("排序").click();
  await expect(page.locator(".al-select-popup")).toBeVisible();
  await expect(page.locator(".al-select-option")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(page.locator(".al-select-popup")).toHaveCount(0);

  // Danbooru：分级是下拉多选，默认全年龄；可叠加敏感
  await page.locator(".al-view-tabs button", { hasText: "Danbooru" }).click();
  await expect(page.getByRole("button", { name: "分级" })).toContainText("全年龄");
  await page.getByRole("button", { name: "分级" }).click();
  await expect(page.locator(".al-select-option")).toHaveCount(5);
  await page.locator(".al-select-option", { hasText: "敏感 sensitive" }).click();
  await expect(page.getByRole("button", { name: "分级" })).toContainText("全年龄 + 敏感");
  await page.keyboard.press("Escape");

  await page.locator(".al-view-tabs button", { hasText: "拼接台" }).click();
  await page.locator(".al-composer-section textarea").nth(1).fill("dairi, by wlop");
  await expect(page.locator(".al-preview-text")).toHaveValue("@dairi, @wlop");
});

test("侧边栏：三组归位、折叠状态持久化", async ({ page }) => {
  await page.goto("/");
  const generate = page.locator('[data-group="generate"]');
  const anima = page.locator('[data-group="anima"]');
  const tools = page.locator('[data-group="tools"]');

  // 三组各管一类；生成组 6 项（数据集工作台显示在生成组），Anima 工坊 3 项带同族圆点
  await expect(generate.locator(".nav-item")).toHaveCount(6);
  await expect(anima.locator(".nav-item")).toHaveCount(3);
  await expect(anima.locator(".nav-item-dot")).toHaveCount(3);
  await expect(tools.locator(".nav-item")).toHaveCount(6);

  // Anima 工坊条目可达
  await anima.locator(".nav-item", { hasText: "Anima 工作台" }).click();
  await expect(page.locator(".wb-panel")).toBeVisible();

  // 折叠「工具」组：条目隐藏，组头显示计数
  await tools.locator(".nav-group-head").click();
  await expect(tools.locator(".nav-item")).toHaveCount(0);
  await expect(tools.locator(".nav-group-head")).toContainText("6 项");

  // 折叠状态持久化（ui-state）：刷新后工具组仍折叠，其它组不受影响
  await page.reload();
  await expect(tools.locator(".nav-item")).toHaveCount(0);
  await expect(tools.locator(".nav-group-head")).toContainText("6 项");
  await expect(anima.locator(".nav-item")).toHaveCount(3);
});
