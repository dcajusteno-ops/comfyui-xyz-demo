import { expect, test, type Page } from "@playwright/test";

import { installApiMocks } from "./mocks";

/**
 * 数据集工作台：只覆盖不依赖 ComfyUI 的路径（规划 / 轴编辑 / 模式切换 / LoRA 落入 / 导出）。
 * 真实出图需要 ComfyUI，属于手动验证（见 e2e/run-generation.mjs 的定位）。
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("comfyui_xyz_welcome_seen", "true");
  });
  await installApiMocks(page);
});

async function openDataset(page: Page) {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "数据集工作台" }).click();
  await expect(page.locator(".ds-panel")).toBeVisible();
}

/** 走项目原有的「简易 LoRA 管理器」插入第一个 LoRA（简易模式只有一个目标按钮） */
async function addFirstLoraFromManager(page: Page) {
  await page.getByRole("button", { name: "从 LoRA 管理器添加" }).click();
  await expect(page.getByText("简易 LoRA 管理器 · 添加到「数据集工作台」")).toBeVisible();
  const card = page.locator(".lora-card").first();
  await card.hover();
  await expect(card.locator(".card-quick-actions button")).toHaveCount(1);
  await card.getByRole("button", { name: "添加到数据集工作台" }).click();
}

test("数据集：重新规划按目标张数生成计划", async ({ page }) => {
  await openDataset(page);
  await expect(page.locator(".ds-card-head", { hasText: "生成计划" })).toBeVisible();
  await expect(page.getByText(/还没有计划/)).toBeVisible();

  await page.getByLabel("目标张数").fill("12");
  await page.locator(".ds-toolbar").getByRole("button", { name: "重新规划" }).click();

  await expect(page.locator(".ds-card-head", { hasText: "生成计划" })).toContainText("共 12 条");
  // 每页 20 条：12 条全部在一页
  await expect(page.locator(".ds-row:not(.ds-row-head)")).toHaveCount(12);
  await expect(page.locator(".ds-row:not(.ds-row-head)").first()).toContainText("001");
  await expect(page.locator(".ds-row:not(.ds-row-head)").first().locator(".ds-caption")).not.toHaveText("—");

  // 再次重新规划必须换一批（Seed 列要变），否则「换了等于没换」
  const firstSeed = await page.locator(".ds-row:not(.ds-row-head)").first().locator(".ds-seed").innerText();
  await page.locator(".ds-toolbar").getByRole("button", { name: "重新规划" }).click();
  await expect(page.locator(".ds-row:not(.ds-row-head)").first().locator(".ds-seed")).not.toHaveText(firstSeed);
});

test("数据集：模式切换后两套参数各自保留", async ({ page }) => {
  await openDataset(page);

  // Anima 默认：模型栈是 UNet / CLIP / VAE（e2e 的 object_info mock 不含 UNETLoader，不断言选项）
  await expect(page.getByLabel("UNet 模型")).toBeVisible();

  await page.locator(".ds-segmented").getByRole("button", { name: "SDXL" }).click();
  // SDXL 侧是 checkpoint 下拉，不再有 UNet
  await expect(page.getByLabel("大模型")).toBeVisible();
  await expect(page.getByLabel("UNet 模型")).toHaveCount(0);

  await page.locator(".ds-segmented").getByRole("button", { name: "Anima" }).click();
  await expect(page.getByLabel("UNet 模型")).toBeVisible();
});

test("数据集：改轴池后重新规划，旧词不再出现", async ({ page }) => {
  await openDataset(page);
  await page.getByLabel("目标张数").fill("8");
  await page.locator(".ds-toolbar").getByRole("button", { name: "重新规划" }).click();
  await expect(page.locator(".ds-row:not(.ds-row-head)")).toHaveCount(8);
  // 每条都有且只有一个姿势词（发牌是洗过牌的，第一条不一定是 standing）
  await expect(page.locator('.ds-tags em[title="姿势"]')).toHaveCount(8);

  // 姿势是第一个轴：展开 → 整池替换 → 失焦提交
  const pose = page.locator(".ds-axis").first();
  await pose.locator("summary").click();
  const pool = pose.locator("textarea");
  await pool.fill("aaa\nbbb");
  await pool.blur();

  await page.locator(".ds-toolbar").getByRole("button", { name: "重新规划" }).click();
  await expect(page.locator(".ds-row:not(.ds-row-head)")).toHaveCount(8);
  await expect(page.locator('.ds-tags em[title="姿势"]')).toHaveCount(8);
  await expect(page.locator('.ds-tags em[title="姿势"]').first()).toHaveText(/aaa|bbb/);
});

test("数据集：导出 manifest 带全部条目", async ({ page }) => {
  await openDataset(page);
  await page.getByLabel("目标张数").fill("6");
  await page.locator(".ds-toolbar").getByRole("button", { name: "重新规划" }).click();
  await expect(page.locator(".ds-row:not(.ds-row-head)")).toHaveCount(6);

  const downloadPromise = page.waitForEvent("download");
  await page.locator(".ds-toolbar").getByRole("button", { name: "manifest" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^dataset-manifest-\d+\.json$/);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(payload.items).toHaveLength(6);
  expect(payload.counts.total).toBe(6);
  expect(payload.mode).toBe("anima");
});

test("数据集：用原有 LoRA 管理器添加，计划过期提示出现", async ({ page }) => {
  await openDataset(page);
  await page.getByLabel("目标张数").fill("6");
  await page.locator(".ds-toolbar").getByRole("button", { name: "重新规划" }).click();
  await expect(page.locator(".ds-row:not(.ds-row-head)")).toHaveCount(6);
  await expect(page.locator(".ds-stale")).toHaveCount(0);

  await addFirstLoraFromManager(page);

  // 插入即落进数据集当前族，弹窗关闭，徽标与 chips 同步
  await expect(page.getByText("简易 LoRA 管理器 · 添加到「数据集工作台」")).toHaveCount(0);
  await expect(page.locator(".ds-anchor-chip")).toContainText("LoRA × 1");
  await expect(page.locator(".lora-selection-card")).toHaveCount(1);
  // 计划是加 LoRA 之前排的 → 过期横幅
  await expect(page.locator(".ds-stale")).toBeVisible();
});

test("数据集：切模型族后提示另一族已挂的 LoRA 数量", async ({ page }) => {
  await openDataset(page);
  await addFirstLoraFromManager(page);
  await expect(page.locator(".ds-anchor-chip")).toContainText("LoRA × 1");

  await page.locator(".ds-segmented").getByRole("button", { name: "SDXL" }).click();
  await expect(page.getByText(/另一族（Anima）已挂 1 个/)).toBeVisible();
  await expect(page.locator(".ds-anchor-chip")).toContainText("未配置");

  await page.locator(".ds-segmented").getByRole("button", { name: "Anima" }).click();
  await expect(page.locator(".lora-selection-card")).toHaveCount(1);
});

test("数据集：manifest 记录当前族生效的 LoRA", async ({ page }) => {  await openDataset(page);
  await page.getByLabel("目标张数").fill("6");
  await page.locator(".ds-toolbar").getByRole("button", { name: "重新规划" }).click();
  await addFirstLoraFromManager(page);
  await expect(page.locator(".lora-selection-card")).toHaveCount(1);

  const downloadPromise = page.waitForEvent("download");
  await page.locator(".ds-toolbar").getByRole("button", { name: "manifest" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(payload.settings.loras).toHaveLength(1);
  expect(payload.settings.loras[0].name).toContain("ashima");
  expect(payload.settings.loras[0].strength).toBe(1);
});

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("数据集：还没有计划时点「开始生成」会自动排计划并开跑", async ({ page }) => {
  // 出图三件套：提交、历史、取图（否则队列会在提交阶段就失败）
  let counter = 0;
  let captionPrompts = 0;
  await page.route(/\/comfy\/api\/prompt$/, async (route) => {
    const payload = route.request().postDataJSON() as
      | { prompt?: Record<string, { class_type?: string }> }
      | null;
    const nodes = Object.values(payload?.prompt ?? {});
    if (nodes.some((node) => node.class_type === "> Save Text")) captionPrompts += 1;
    counter += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ prompt_id: `pid-${counter}`, number: counter }),
    });
  });
  await page.route(/\/comfy\/api\/history\//, async (route) => {
    const id = route.request().url().split("/").pop() ?? "pid-1";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        [id]: {
          outputs: { "9": { images: [{ filename: `${id}.png`, subfolder: "Datasets/dataset/001", type: "output" }] } },
          status: { completed: true },
        },
      }),
    });
  });
  await page.route(/\/comfy\/api\/view/, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PIXEL_PNG }));

  await openDataset(page);
  // SDXL 侧的 checkpoint 由 mock 提供，避开 Anima 模型栈在 e2e 里为空的问题
  await page.locator(".ds-segmented").getByRole("button", { name: "SDXL" }).click();
  await page.getByLabel("目标张数").fill("4");
  await expect(page.getByText(/还没有计划/)).toBeVisible();

  await page.locator(".ds-toolbar").getByRole("button", { name: "开始生成" }).click();
  // 未配置角色锚点 → 二次确认
  await expect(page.getByText("未配置角色锚点")).toBeVisible();
  await page.getByRole("button", { name: "确定删除" }).click();

  // 计划自动出现并逐条跑到成功
  await expect(page.locator(".ds-row:not(.ds-row-head)")).toHaveCount(4);
  await expect(page.locator(".ds-status-success")).toHaveCount(4, { timeout: 30000 });
  // 默认开启 .txt：每张图后应各有一个写文件任务
  await expect.poll(() => captionPrompts, { timeout: 30000 }).toBe(4);
});
