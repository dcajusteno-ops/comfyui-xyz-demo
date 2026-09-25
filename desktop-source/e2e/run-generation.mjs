// 手动验证脚本：驱动真实应用（dev server + 真实 ComfyUI）各跑一遍生图（不带 LoRA / 带 LoRA）。
// 运行：node e2e/run-generation.mjs   （不属于 npm run test:e2e 冒烟套件，需要真实 ComfyUI）
import { chromium } from "@playwright/test";

const BASE = process.env.APP_BASE ?? "http://127.0.0.1:9999";
const COMFY = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";
const GEN_TIMEOUT = 300_000;

const log = (...a) => console.log("[gen-run]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("xyz_welcome_seen", "true"));

  // 捕获实际提交的 workflow 与 prompt_id（pass-through，不拦截真实请求）
  const submissions = [];
  await page.route("**/comfy/api/prompt", async (route) => {
    const body = route.request().postDataJSON();
    const response = await route.fetch();
    let promptId = null;
    try { promptId = (await response.json())?.prompt_id ?? null; } catch {}
    submissions.push({ body, promptId });
    log("workflow 已提交 → prompt_id:", promptId);
    await route.fulfill({ response });
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  // 1. 等待 options 加载（大模型下拉有选项）
  await page.waitForFunction(() => {
    const labels = Array.from(document.querySelectorAll("label.field"));
    const target = labels.find((el) => el.querySelector("span")?.textContent === "大模型");
    const select = target?.querySelector("select");
    return !!select && select.options.length > 0;
  }, null, { timeout: 45_000 });
  const checkpointOptions = await page.getByLabel("大模型").locator("option").allTextContents();
  log("✓ 大模型下拉选项:", checkpointOptions.join(" | "));

  // 用简短确定性的正向提示词（本脚本自己的上下文，不读用户浏览器 localStorage）
  // 注意：TextAreaField 渲染为 div.field.text-field + span（无 label 关联），需按容器定位
  const positiveTextarea = page.locator(".field.text-field", { hasText: "正向提示词" }).first().locator("textarea");
  await positiveTextarea.fill("1girl, masterpiece, best quality, looking at viewer");

  // 2. 记录初始 LoRA chips
  const chipNames = async () => {
    const cards = page.locator(".lora-selection-card");
    const count = await cards.count();
    const names = [];
    for (let i = 0; i < count; i++) names.push((await cards.nth(i).locator(".lora-card-name").textContent()) ?? "");
    return names;
  };
  const removeAllChips = async () => {
    for (let i = 0; i < 20; i++) {
      const removeBtns = page.getByTitle("移除");
      if ((await removeBtns.count()) === 0) break;
      await removeBtns.first().click();
      await sleep(150);
    }
  };
  const initialChips = await chipNames();
  log("初始 LoRA chips:", initialChips.length ? initialChips.join(" | ") : "(无)");

  // 3. 轮询 ComfyUI history 直到完成（权威完成信号）
  const waitGenerationDone = async (promptId) => {
    const deadline = Date.now() + GEN_TIMEOUT;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${COMFY}/api/history/${promptId}`);
        const data = await res.json();
        const entry = data?.[promptId];
        if (entry?.status?.status_str === "error") return { statusStr: "error", imageCount: 0 };
        if (entry?.status?.completed) {
          const outputs = entry.outputs ?? {};
          const imageCount = Object.values(outputs).reduce((acc, out) => acc + (out.images?.length ?? 0), 0);
          return { statusStr: entry.status.status_str ?? "success", imageCount };
        }
      } catch { /* 轮询失败重试 */ }
      await sleep(2000);
    }
    return { statusStr: "timeout", imageCount: 0 };
  };

  // 4. UI 输出面板出现新结果
  const assertUiOutput = async (prevCount) => {
    await page.waitForFunction(
      (prev) => document.querySelectorAll(".gallery-item").length > prev,
      prevCount,
      { timeout: 60_000 }
    );
  };

  const parseSubmission = (sub) => {
    const workflow = sub?.body?.prompt ?? {};
    return {
      loaderText: workflow["2"]?.inputs?.text ?? "",
      lorasList: workflow["2"]?.inputs?.loras?.__value__ ?? [],
    };
  };

  // ===== Run 1：不带 LoRA =====
  log("===== Run 1：不带 LoRA =====");
  if (initialChips.length > 0) {
    await removeAllChips();
    log("已临时移除原 chips:", initialChips.join(" | "));
  }
  if ((await chipNames()).length !== 0) throw new Error("Run 1 前置失败：chips 未清空");
  const galleryBefore1 = await page.locator(".gallery-item").count();
  await page.getByRole("button", { name: "开始生成" }).click();
  const deadline1 = Date.now() + 30_000;
  while (Date.now() < deadline1 && submissions.length === 0) await sleep(300);
  const sub1 = submissions[0];
  if (!sub1?.promptId) throw new Error("Run 1 失败：未捕获 prompt_id");
  const parsed1 = parseSubmission(sub1);
  log("Run 1 Lora Loader text:", JSON.stringify(parsed1.loaderText), "loras list:", JSON.stringify(parsed1.lorasList));
  const done1 = await waitGenerationDone(sub1.promptId);
  log("Run 1 ComfyUI 状态:", done1.statusStr, "输出图片数:", done1.imageCount);
  await assertUiOutput(galleryBefore1);
  log("✓ Run 1 UI 输出面板已出现结果");

  // ===== Run 2：带 LoRA =====
  log("===== Run 2：带 LoRA =====");
  await page.getByTitle("添加 LoRA").click();
  await page.waitForFunction(() => document.querySelectorAll(".lm-model-card").length > 0, null, { timeout: 45_000 });
  const cards = page.locator(".lm-model-card");
  const total = await cards.count();
  let picked = -1;
  for (let i = 0; i < total; i++) {
    const level = Number((await cards.nth(i).getAttribute("data-nsfw-level")) ?? "0");
    if (level < 4) { picked = i; break; }
  }
  if (picked < 0) picked = 0;
  const cardName = (await cards.nth(picked).locator(".model-name").textContent()) ?? "";
  log("选择 LoRA 卡片:", cardName, "| nsfw level:", (await cards.nth(picked).getAttribute("data-nsfw-level")));
  await cards.nth(picked).getByTitle("添加到默认").click();
  await sleep(400);
  const closeBtn = page.getByRole("button", { name: /关闭/ });
  if ((await closeBtn.count()) > 0) await closeBtn.first().click();
  await sleep(300);
  const chipsNow = await chipNames();
  log("当前 LoRA chips:", chipsNow.join(" | "));
  if (chipsNow.length === 0) throw new Error("Run 2 前置失败：LoRA 未插入");

  const galleryBefore2 = await page.locator(".gallery-item").count();
  await page.getByRole("button", { name: "开始生成" }).click();
  const deadline2 = Date.now() + 30_000;
  while (Date.now() < deadline2 && submissions.length < 2) await sleep(300);
  const sub2 = submissions[1];
  if (!sub2?.promptId) throw new Error("Run 2 失败：未捕获 prompt_id");
  const parsed2 = parseSubmission(sub2);
  log("Run 2 Lora Loader text:", JSON.stringify(parsed2.loaderText), "loras list:", JSON.stringify(parsed2.lorasList));
  const done2 = await waitGenerationDone(sub2.promptId);
  log("Run 2 ComfyUI 状态:", done2.statusStr, "输出图片数:", done2.imageCount);
  await assertUiOutput(galleryBefore2);
  log("✓ Run 2 UI 输出面板已出现结果");

  // ===== 断言汇总 =====
  if (parsed1.loaderText.includes("<lora:") || parsed1.lorasList.length > 0) {
    throw new Error("Run 1 断言失败：workflow 不应包含 LoRA");
  }
  if (!parsed2.loaderText.includes("<lora:") && parsed2.lorasList.length === 0) {
    throw new Error("Run 2 断言失败：workflow 应包含 LoRA");
  }
  if (done1.statusStr !== "success" || done2.statusStr !== "success") {
    throw new Error(`生成失败: Run1=${done1.statusStr} Run2=${done2.statusStr}`);
  }

  // ===== 恢复初始状态 =====
  if (initialChips.length === 0) {
    await removeAllChips();
    log("已恢复初始状态（移除测试 LoRA）");
  } else {
    log("原 chips 非空，未自动恢复原选择，请手动检查:", initialChips.join(" | "));
  }

  log("===== 全部完成：两遍生图验证通过（不带 LoRA ✓ / 带 LoRA ✓） =====");
} finally {
  await browser.close();
}
