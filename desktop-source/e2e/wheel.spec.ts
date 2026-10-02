import { expect, test } from "@playwright/test";

import { installApiMocks, installPromptLibraryMock, MOCK_CUSTOM_CATEGORY } from "./mocks";

/** 结果行中「已抽到词」的那些（data-tag 非空）。 */
const FILLED_ROWS = '.wheel-result-row:not([data-tag=""])';
/** 结果行中「尚未抽到词」的那些。 */
const EMPTY_ROWS = '.wheel-result-row[data-tag=""]';

/** 默认扇区数（`DEFAULT_WHEEL_SECTORS` 的长度）；盘面容量上限见 `MAX_SECTORS`。 */
const DEFAULT_SECTORS = 10;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("comfyui_xyz_welcome_seen", "true");
  });
  // 减动效：转盘瞬间落定，用例既跑得快，也顺带回归 prefers-reduced-motion 分支
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installApiMocks(page);
  await installPromptLibraryMock(page);
});

test("幸运大转盘：指针指向的扇区与实际抽到的结果一致", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "幸运大转盘" }).click();

  const arena = page.locator(".wheel-arena");
  await expect(arena).toHaveAttribute("data-sector-count", String(DEFAULT_SECTORS));
  await expect(page.locator(".wheel-sector")).toHaveCount(DEFAULT_SECTORS);
  await expect(page.locator(".wheel-result-row")).toHaveCount(DEFAULT_SECTORS);
  await expect(page.locator(EMPTY_ROWS)).toHaveCount(DEFAULT_SECTORS);

  // 单次转动：只应有一个扇区出结果，且「指针指向」必须等于「实际结果所在扇区」
  await page.locator(".wheel-lever").click();
  await expect(page.locator(FILLED_ROWS)).toHaveCount(1);

  const winnerSectorId = await arena.getAttribute("data-winner-sector-id");
  expect(winnerSectorId).toBeTruthy();
  await expect(page.locator(FILLED_ROWS)).toHaveAttribute("data-sector-id", winnerSectorId as string);
  // 结果行里的词同时出现在圆心 hub 上
  await expect(page.locator(".wheel-hub-text")).toHaveText(
    (await page.locator(FILLED_ROWS).getAttribute("data-tag")) as string
  );

  // 转满整套：每个扇区都抽到词
  await page.locator(".wheel-chain").click();
  await expect(page.locator(FILLED_ROWS)).toHaveCount(DEFAULT_SECTORS, { timeout: 30000 });
  await expect(page.locator(EMPTY_ROWS)).toHaveCount(0);

  // 已抽中的扇区会在标签尾部挂「✓」，排版预算必须把它算进去 —— 否则标签会冲出圆盘
  // （曾经的实现是在截断之后才拼 ✓，实测「光影氛围」冲出盘外）。这里量的是**已抽中**状态的几何。
  const labelRadii = await page.locator(".wheel-svg").evaluate((svg) => {
    const out: number[] = [];
    for (const node of Array.from(svg.querySelectorAll(".wheel-label"))) {
      const text = node as SVGGraphicsElement;
      const matrix = text.transform.baseVal.consolidate()!.matrix;
      const box = text.getBBox();
      const corners = [
        [box.x, box.y],
        [box.x + box.width, box.y],
        [box.x, box.y + box.height],
        [box.x + box.width, box.y + box.height],
      ].map(([x, y]) => ({ x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f }));
      out.push(Math.max(...corners.map((p) => Math.hypot(p.x - 100, p.y - 100))));
    }
    return out;
  });
  expect(labelRadii).toHaveLength(DEFAULT_SECTORS);
  // 盘半径 96，标签另有 2px 描边（±1 单位）
  expect(Math.max(...labelRadii)).toBeLessThanOrEqual(95);

  // 每个扇区名字都不该被截断（默认 10 个扇区时可用宽度是 5 个单位 = 2 个汉字 + ✓）
  const labelTexts = await page.locator(".wheel-label").allTextContents();
  for (const text of labelTexts) {
    expect(text, `扇区名被截断了：${text}`).not.toContain("…");
  }

  // 应用到大模型模板
  await page.getByRole("button", { name: "应用" }).click();
  await expect(page.locator(".toast", { hasText: "转盘结果已应用" })).toBeVisible();
});

test("幸运大转盘：离开页面再回来，结果与历史还在", async ({ page }) => {
  // 有状态的 ui-state mock：PUT 合并进 store、GET 回读 —— 模拟服务端 data/ui-state.json。
  // 注册在 installApiMocks 之后（Playwright 后注册的路由优先），只为这一条用例提供真实持久化语义。
  const store: Record<string, unknown> = {};
  await page.route(/\/api\/ui-state/, (route) => {
    const method = (route.request().method() ?? "GET").toUpperCase();
    if (method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: store, revision: 1 }),
      });
    }
    const body = route.request().postDataJSON() as { entries?: Record<string, unknown> } | null;
    Object.assign(store, body?.entries ?? {});
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, revision: 2 }),
    });
  });

  await page.goto("/");
  await page.locator(".nav-item", { hasText: "幸运大转盘" }).click();
  await page.locator(".wheel-lever").click();
  await expect(page.locator(FILLED_ROWS)).toHaveCount(1);
  const beforeTag = await page.locator(FILLED_ROWS).getAttribute("data-tag");
  const beforeSector = await page.locator(FILLED_ROWS).getAttribute("data-sector-id");
  expect(beforeTag).toBeTruthy();

  // 转盘状态走 800ms 防抖批量 PUT —— 等它落盘再刷新（reload 也会触发 beforeunload flush，这里等够更稳）
  await page.waitForTimeout(1200);
  expect(Object.keys(store), "转盘状态没有被持久化").toContain("comfyui_xyz_wheel");

  await page.reload();
  await expect(page.locator(FILLED_ROWS)).toHaveCount(1, { timeout: 30000 });
  await expect(page.locator(FILLED_ROWS)).toHaveAttribute("data-tag", beforeTag as string);
  await expect(page.locator(FILLED_ROWS)).toHaveAttribute("data-sector-id", beforeSector as string);
  // 历史与圆心 hub 也跟着恢复
  await expect(page.locator(".wheel-history-item")).toHaveCount(1);
  await expect(page.locator(".wheel-hub-text")).toHaveText(beforeTag as string);
});

test("幸运大转盘：扇区未开启「允许R18」时，负面词与限制级词都不会进入扇区", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "幸运大转盘" }).click();
  await expect(page.locator(".wheel-arena")).toHaveAttribute("data-sector-count", String(DEFAULT_SECTORS));

  // 连续转满整套若干轮，结果里不应出现 mock 词库中 scope=r18 / negative_default 的词
  for (let round = 0; round < 3; round += 1) {
    await page.locator(".wheel-chain").click();
    await expect(page.locator(FILLED_ROWS)).toHaveCount(DEFAULT_SECTORS, { timeout: 30000 });
    const tags = await page.locator(".wheel-result-row").evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-tag") ?? "")
    );
    expect(tags).not.toContain("bad anatomy");
    expect(tags).not.toContain("nsfw action");
    await page.locator(".wheel-clear").click();
    await expect(page.locator(EMPTY_ROWS)).toHaveCount(DEFAULT_SECTORS);
  }
});

test("幸运大转盘：「允许R18」按扇区放行，且不外溢", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "幸运大转盘" }).click();
  await expect(page.locator(".wheel-arena")).toHaveAttribute("data-sector-count", String(DEFAULT_SECTORS));

  await page.locator(".wheel-sectors > summary").click();

  // mock 词库里唯一一条 scope=r18 的词属于「动作」分类（角色/服饰/配件/动作）
  const actionRow = page.locator(".wheel-sector-row").nth(3);
  const characterRow = page.locator(".wheel-sector-row").nth(0);
  await expect(actionRow.locator(".wheel-sector-name")).toHaveValue("动作");
  await expect(characterRow.locator(".wheel-sector-name")).toHaveValue("角色");

  // 默认关：r18 词不进池（每个分类 3 条，动作扇区 = 3 个分类 × 3 = 9）
  await expect(actionRow.locator(".wheel-sector-pool")).toHaveText("9 个候选");

  await actionRow.locator(".wheel-sector-r18 input").check();
  await expect(actionRow.locator(".wheel-sector-r18")).toHaveClass(/is-on/);
  await expect(actionRow.locator(".wheel-sector-pool")).toHaveText("10 个候选");
  // 只有被勾选的那个扇区放行
  await expect(characterRow.locator(".wheel-sector-pool")).toHaveText("18 个候选");

  await actionRow.locator(".wheel-sector-r18 input").uncheck();
  await expect(actionRow.locator(".wheel-sector-pool")).toHaveText("9 个候选");
});

test("幸运大转盘：我自己导入的词条（customEntries）也能进扇区词池", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "幸运大转盘" }).click();
  await expect(page.locator(".wheel-arena")).toHaveAttribute("data-sector-count", String(DEFAULT_SECTORS));

  await page.locator(".wheel-sectors > summary").click();
  const row = page.locator(".wheel-sector-row").nth(3);
  await expect(row.locator(".wheel-sector-name")).toHaveValue("动作");

  // 逐字敲「自建分类, 动作」：既验证逗号不再被吞（否则会拼成假分类 → 0 个候选），
  // 也验证「自建分类」这个**只存在于我的词条里**的分类能命中（内置词库没有它）。
  // mock 里每个分类 3 条 → 自建分类 1 条 + 动作 3 条 = 4。
  const cats = row.locator(".wheel-sector-cats");
  await cats.click();
  await cats.press("Control+a");
  await cats.press("Delete");
  await cats.pressSequentially(`${MOCK_CUSTOM_CATEGORY}, 动作`);
  await expect(cats).toHaveValue(`${MOCK_CUSTOM_CATEGORY}, 动作`);
  await expect(row.locator(".wheel-sector-pool")).toHaveText("4 个候选");
});
