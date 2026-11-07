import { expect, test } from "@playwright/test";

import { installApiMocks } from "./mocks";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("comfyui_xyz_welcome_seen", "true");
  });
  await installApiMocks(page);
});

test("造型台：15 段参数树、档位闸门与内置数据", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "Anima 造型台" }).click();
  await expect(page.locator(".wd-panel")).toBeVisible();
  await expect(page.locator(".wd-section")).toHaveCount(15);

  const manifest = await page.evaluate(async () => {
    const response = await fetch("/data/wardrobe/manifest.json");
    return response.json();
  });
  expect(manifest.counts.characters).toBe(2390);
  expect(manifest.counts.scenes).toBe(361);
  expect(manifest.counts.thumbs).toBeGreaterThan(2400);

  // L0：cloth_nsfw / pose_nsfw / special_nsfw 三段没有可用选项；canon 含 L0 场景仍可用
  await page.locator(".wd-level", { hasText: "全年龄" }).click();
  await expect(page.locator(".wd-section.is-locked-by-level")).toHaveCount(3);
  await page.locator(".wd-level", { hasText: "极端" }).click();
  await expect(page.locator(".wd-section.is-locked-by-level")).toHaveCount(0);
});

test("造型台：同 seed 可复现，并能写入 Anima 正向提示词", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "Anima 造型台" }).click();
  await expect(page.locator(".wd-panel")).toBeVisible();

  await page.locator(".wd-seed input").fill("42");
  await page.locator(".wd-run").click();
  const first = await page.locator(".wd-result-text").inputValue();
  expect(first.length).toBeGreaterThan(0);

  await page.locator(".wd-run").click();
  await expect(page.locator(".wd-result-text")).toHaveValue(first);

  await page.locator(".wd-result-actions").getByRole("button", { name: "替换" }).click();
  await page.getByRole("button", { name: "确定删除" }).click();
  await expect(page.getByText(/已覆盖 Anima 提示词/)).toBeVisible();

  await page.locator(".nav-item", { hasText: "Anima 生图" }).click();
  const values = await page.locator("textarea").evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLTextAreaElement).value),
  );
  expect(values.some((value) => value === first)).toBe(true);
});

test("造型台：角色搜索与场景套用", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "Anima 造型台" }).click();
  await expect(page.locator(".wd-panel")).toBeVisible();

  await page.locator(".wd-chars .wd-search input").fill("miku");
  await expect(page.locator(".wd-char").first()).toBeVisible();
  const cardCount = await page.locator(".wd-char").count();
  expect(cardCount).toBeGreaterThan(0);
  await page.locator(".wd-char").first().click();
  await expect(page.locator(".wd-selected-bar")).toContainText("已选 1");

  await page.locator(".wd-level", { hasText: "成人" }).click();
  await page.locator(".wd-view-tab", { hasText: "场景库" }).click();
  await page.locator(".wd-scene-card").first().locator(".wd-apply-scene").click();
  await expect(page.getByText("已套用场景", { exact: true })).toBeVisible();

  // 场景套用后 n_canon 字段权重应为 3.0（必现）
  await page.locator(".wd-section", { hasText: "法典验证场景" }).locator(".wd-section-toggle").click();
  await expect(page.locator(".wd-section", { hasText: "法典验证场景" })).toContainText("必现");
});

test("造型台 → 独立工作台：分区拆桶、画师官方位置、词库可再送入", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "Anima 造型台" }).click();
  await expect(page.locator(".wd-panel")).toBeVisible();

  await page.locator(".wd-seed input").fill("42");
  await page.locator(".wd-run").click();
  const drawn = await page.locator(".wd-result-text").inputValue();
  expect(drawn.length).toBeGreaterThan(0);

  // 结果区「工作台」按钮 → 跳到独立的「Anima 工作台」页
  await page.locator(".wd-result-actions").getByRole("button", { name: "工作台" }).click();
  await expect(page.locator(".wb-panel")).toBeVisible();
  await expect(page.locator(".wb-panel .al-composer")).toBeVisible();

  // 分区 textarea 顺序 = COMPOSER_SLOT_META：0 质量 / 1 画师 / 2 角色 / ...
  const slotValue = async (index: number) =>
    page.locator(".wb-panel .al-composer-section textarea").nth(index).inputValue();
  const character = await slotValue(2);
  expect(character.length).toBeGreaterThan(0);
  const firstTag = drawn.split(",")[0].trim();
  expect(character).toContain(firstTag);

  // 画师快取：搜索 → 点加入 → 落在「画师」分区并带 @
  await page.locator(".al-artist-pick-input input").click();
  await page.locator(".al-artist-pick-input input").fill("dairi");
  await expect(page.locator(".al-artist-pick-item").first()).toBeVisible();
  await page.locator(".al-artist-pick-item").first().click();
  const artist = await slotValue(1);
  expect(artist).toContain("@");

  // 官方顺序守卫：预览里画师出现在角色之前
  const preview = await page.locator(".al-preview-text").inputValue();
  const artistHead = artist.split(",")[0].trim();
  expect(preview.indexOf(artistHead)).toBeGreaterThan(-1);
  expect(preview.indexOf(artistHead)).toBeLessThan(preview.indexOf(firstTag));

  // 词库拼接台与工作台是两份独立状态；用「送入工作台」按钮把词并过去
  await page.locator(".nav-item", { hasText: "Anima 词库" }).click();
  await page.locator(".segmented button", { hasText: "拼接台" }).click();
  const libArtist = await page.locator(".al-composer-section textarea").nth(1).inputValue();
  expect(libArtist).not.toContain("dairi");
  await page.locator(".al-composer-section textarea").nth(1).fill("by wlop");
  await page.locator(".al-preview-actions").getByRole("button", { name: "送入工作台" }).click();
  await expect(page.locator(".wb-panel")).toBeVisible();
  const merged = await slotValue(1);
  expect(merged).toContain("wlop");
  expect(merged).toContain("dairi");
});

test("工作台：清空一次确认后生效（回归：双重确认被吞）", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "Anima 工作台" }).click();
  await expect(page.locator(".wb-panel .al-composer")).toBeVisible();

  // 手填两个分区
  const slots = page.locator(".wb-panel .al-composer-section textarea");
  await slots.nth(0).fill("masterpiece, best quality");
  await slots.nth(2).fill("1girl, solo");
  await expect(page.locator(".al-preview-text")).toHaveValue(/masterpiece/);

  // 清空：只允许一次确认
  await page.locator(".al-preview-actions").getByRole("button", { name: "清空" }).click();
  await page.getByRole("button", { name: "确定删除" }).click();
  const values = await page.locator(".wb-panel .al-composer-section textarea").evaluateAll((nodes) => nodes.map((node) => (node as HTMLTextAreaElement).value));
  expect(values).toEqual(["", "", "", "", "", "", ""]);
  await expect(page.locator(".al-preview-text")).toHaveValue("");
});

test("造型台 v5：场景画幅 / 随机场景开关 / 作品收藏 / 服装预设弹窗", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "Anima 造型台" }).click();
  await expect(page.locator(".wd-panel")).toBeVisible();

  // ① 场景画幅徽标 + 三段筛选
  await page.locator(".wd-view-tab", { hasText: "场景库" }).click();
  await expect(page.locator(".wd-scene-aspect-badge").first()).toBeVisible();
  const badges = await page.locator(".wd-scene-aspect-badge").allTextContents();
  expect(badges.every((text) => ["竖", "横", "通"].includes(text.trim()))).toBe(true);

  await page.locator(".wd-scene-aspect", { hasText: "竖屏·通用" }).click();
  const portraitBadges = await page.locator(".wd-scene-aspect-badge").allTextContents();
  expect(portraitBadges.length).toBeGreaterThan(0);
  expect(portraitBadges.every((text) => ["竖", "通"].includes(text.trim()))).toBe(true);

  // ② 随机场景开关（v5.0.1：不勾 = 一条都不出）
  const scenePick = page.locator(".wd-scene-pick input[type=checkbox]");
  await expect(scenePick).not.toBeChecked();
  await scenePick.check();
  await expect(scenePick).toBeChecked();
  await scenePick.uncheck();

  // ③ 作品 IP 收藏：选一个作品 → 星标 → 出现在收藏条并带 ★ 前缀
  await page.locator(".wd-view-tab", { hasText: "角色库" }).click();
  await page.locator(".wd-work-select .al-select-trigger").click();
  await page.locator(".al-select-popup [role=option]").nth(1).click();
  await expect(page.locator(".wd-work-fav")).toBeEnabled();
  await page.locator(".wd-work-fav").click();
  await expect(page.locator(".wd-work-favs")).toContainText("★");

  // ④ 服装预设弹窗：tifa 有内置预设（先把作品筛选清回「全部」）
  await page.locator(".wd-work-select .al-select-trigger").click();
  await page.locator(".al-select-popup [role=option]").nth(0).click();
  await page.locator(".wd-chars .wd-search input").fill("tifa");
  const card = page.locator(".wd-char").first();
  await expect(card).toBeVisible();
  await card.hover();
  await card.locator(".wd-outfit-btn").click();
  await expect(page.locator(".wd-outfit-modal")).toBeVisible();
  await expect(page.locator(".wd-outfit-row").first()).toBeVisible();
  await page.locator(".wd-outfit-row").first().locator(".wd-outfit-dot").click();
  await expect(page.locator(".wd-outfit-status")).toContainText("当前已启用");
  await page.locator(".wd-modal-head .wd-icon-btn").click();
  await expect(page.locator(".wd-outfit-modal")).toHaveCount(0);
});
