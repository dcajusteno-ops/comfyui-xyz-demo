import type { Page } from "@playwright/test";

// 与后端 /api/lm/* 返回形状一致的固定 mock（items / facets / settings）
export const MOCK_FOLDERS = ["SDXL", "SDXL/画师", "动漫"];

export const MOCK_ITEMS = [
  {
    model_name: "ashima-style",
    file_name: "ashima.safetensors",
    folder: "SDXL",
    file_path: "D:/loras/SDXL/ashima.safetensors",
    base_model: "Illustrious v1.0",
    sub_type: "lycoris",
    file_size: 267_900,
    sha256: "bb22",
    preview_nsfw_level: 0,
    update_available: false,
  },
  {
    model_name: "cunnyfunk",
    file_name: "cunnyfunk.safetensors",
    folder: "SDXL/画师",
    file_path: "D:/loras/SDXL/画师/cunnyfunk.safetensors",
    base_model: "Illustrious v1.0",
    sub_type: "locon",
    file_size: 76_700,
    sha256: "aa11",
    preview_nsfw_level: 0,
    update_available: false,
  },
  {
    model_name: "miku-appender",
    file_name: "miku.safetensors",
    folder: "动漫",
    file_path: "D:/loras/动漫/miku.safetensors",
    base_model: "NoobAI v1.1",
    sub_type: "lora",
    file_size: 40_000,
    sha256: "cc33",
    preview_nsfw_level: 16,
    update_available: false,
  },
];

const emptyList = {
  items: [],
  total: 0,
  page: 1,
  page_size: 48,
  total_pages: 1,
};

const OBJECT_INFO = {
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [["demo-a.safetensors", "demo-b.safetensors"]] } } },
  KSampler: { input: { required: { sampler_name: [["euler", "euler_ancestral"]], scheduler: [["simple", "karras"]] } } },
  "WD14Tagger|pysssss": { input: { required: { model: [["wd-v1-4-moat-tagger-v2"]] } } },
  cl_tagger_mira: { input: { required: { model_name: [["cl_tagger/cl_tagger_1_02.onnx"]] } } },
  UltralyticsDetectorProvider: { input: { required: {} } },
  LatentUpscaleBy: { input: { required: { upscale_method: [["nearest-exact", "bilinear"]] } } },
  ImageScale: { input: { required: { upscale_method: [["nearest-exact", "bilinear", "area", "bicubic", "lanczos"]] } } },
  DrawTextAdvanced: { input: { required: { font: [["default"]] } } },
};

const stats = { system: { comfyui_version: "e2e-mock" }, devices: [{ name: "cpu", type: "CPU" }] };

// 拦截全部 ComfyUI 代理请求（lm API 实际由 ComfyUI 侧 LoraManager 插件提供）
export async function installApiMocks(page: Page) {
  const json = (data: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(data) });

  await page.route(/\/comfy\/api\/lm\/loras\/list/, (route) =>
    route.fulfill(json({ ...emptyList, items: MOCK_ITEMS, total: MOCK_ITEMS.length }))
  );
  await page.route(/\/comfy\/api\/lm\/loras\/folders/, (route) => route.fulfill(json({ folders: MOCK_FOLDERS })));
  await page.route(/\/comfy\/api\/lm\/loras\/base-models/, (route) =>
    route.fulfill(json({ success: true, base_models: [{ name: "Illustrious v1.0", count: 2 }, { name: "NoobAI v1.1", count: 1 }] }))
  );
  await page.route(/\/comfy\/api\/lm\/loras\/top-tags/, (route) => route.fulfill(json({ success: true, tags: ["masterpiece", "1girl"] })));
  await page.route(/\/comfy\/api\/lm\/loras\/metadata/, (route) => route.fulfill(json({ success: true, metadata: MOCK_ITEMS[0] })));
  await page.route(/\/comfy\/api\/lm\/settings/, (route) => route.fulfill(json({ blur_mature_content: true, mature_blur_level: "R" })));
  await page.route(/\/comfy\/api\/lm\/embeddings\/(list|folders|base-models|top-tags)/, (route) =>
    route.fulfill(json({ ...emptyList, success: true }))
  );
  await page.route(/\/comfy\/api\/lm\/embeddings\/check-example-images-needed/, (route) => route.fulfill(json({ success: true, data: { pending: [], failed: [] } })));
  await page.route(/\/comfy\/api\/object_info/, (route) => route.fulfill(json(OBJECT_INFO)));
  await page.route(/\/comfy\/(api\/)?system_stats/, (route) => route.fulfill(json(stats)));

  // 前端持久化状态已走服务端 /api/ui-state（data/ui-state.json）：这里旁路掉，让每个
  // 用例都从空状态开始（与旧 localStorage 空 context 等价），同时防止 E2E 污染真实数据。
  await page.route(/\/api\/ui-state/, (route) => {
    const method = (route.request().method() ?? "GET").toUpperCase();
    if (method === "GET") {
      route.fulfill(json({ success: true, data: {}, revision: 0 }));
      return;
    }
    route.fulfill(json({ success: true, revision: 1 }));
  });

  // 断连覆盖层的显隐由 WebSocket 的 open/close 驱动，而 page.route 拦不住 WebSocket：
  // ComfyUI 不在运行时 onclose 会把状态置为 offline，全屏 .connection-overlay 随即拦截所有点击
  // （表现为 4 个需要点击的用例统一超时）。这里接管 /comfy/ws，握手成功即让状态回到 online；
  // 不调用 connectToServer()，故不会真的连到本机 ComfyUI。
  await page.routeWebSocket(/\/comfy\/ws/, (ws) => {
    ws.onMessage((message) => {
      if (typeof message === "string" && message.includes("ping")) ws.send("pong");
    });
  });
}
