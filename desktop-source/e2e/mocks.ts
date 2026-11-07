import type { Page } from "@playwright/test";

import { DEFAULT_WHEEL_SECTORS } from "../src/lib/luckyWheel";

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
  // 数据集「边出图边写同名 .txt」依赖；存在即视为可用
  "> Save Text": {
    input: {
      required: {
        text: ["STRING", { forceInput: true }],
        filename_prefix: ["STRING", { default: "ComfyUI" }],
        folder: ["STRING", { default: "" }],
      },
    },
  },
};

const stats = { system: { comfyui_version: "e2e-mock" }, devices: [{ name: "cpu", type: "CPU" }] };

/** 图片管理器的假输出目录树：只放 png（服务端本身会过滤非图片） */
const IMAGE_ROOT = "F:\\mock\\ComfyUI\\output";
const IMAGE_DATASET_DIR = `${IMAGE_ROOT}\\Datasets\\dataset\\Baixiuxiu_anima`;
const IMAGE_FOLDERS: Record<string, string[]> = {
  [IMAGE_ROOT]: ["Datasets", "2026-01-01"],
  [`${IMAGE_ROOT}\\Datasets`]: ["dataset"],
  [`${IMAGE_ROOT}\\Datasets\\dataset`]: ["Baixiuxiu_anima"],
  [IMAGE_DATASET_DIR]: [],
  [`${IMAGE_ROOT}\\2026-01-01`]: [],
};

/** 1×1 透明 png：`<img>` 能正常解码，且不需要额外夹具文件 */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// 拦截全部 ComfyUI 代理请求（lm API 实际由 ComfyUI 侧 LoraManager 插件提供）
export async function installApiMocks(page: Page) {
  const json = (data: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(data) });

  // 图片管理器：config / browse / file / delete。delete 有状态，删完网格真的会少条目。
  let imageRoot = IMAGE_ROOT;
  let trashEnabled = true;
  const imageFiles: Record<string, string[]> = {
    [IMAGE_ROOT]: ["root_00001_.png"],
    [IMAGE_DATASET_DIR]: ["001_00001_.png", "002_00001_.png", "010_00001_.png"],
  };
  const imageConfig = () => ({
    success: true,
    rootDir: imageRoot,
    rootSource: imageRoot === IMAGE_ROOT ? "detected" : "saved",
    savedRootDir: imageRoot === IMAGE_ROOT ? "" : imageRoot,
    outputDir: IMAGE_ROOT,
    outputDirSource: "argv-main",
    outputDirExists: true,
    rootExists: true,
    trashEnabled,
    drives: ["C:\\", "D:\\", "F:\\"],
  });

  await page.route(/\/xyz\/images\/service/, (route) =>
    route.fulfill(json({ success: true, url: "http://127.0.0.1:9124/" })),
  );

  await page.route(/\/xyz\/images\/config/, async (route) => {
    if ((route.request().method() ?? "GET").toUpperCase() === "POST") {
      const body = route.request().postDataJSON() as { rootDir?: string; trashEnabled?: boolean } | null;
      if (typeof body?.rootDir === "string" && body.rootDir.trim()) imageRoot = body.rootDir.trim();
      if (typeof body?.trashEnabled === "boolean") trashEnabled = body.trashEnabled;
    }
    await route.fulfill(json(imageConfig()));
  });

  await page.route(/\/xyz\/images\/browse/, async (route) => {
    const requestUrl = new URL(route.request().url());
    const dir = requestUrl.searchParams.get("dir") || imageRoot;
    const folders = IMAGE_FOLDERS[dir];
    if (!folders) {
      await route.fulfill(
        json({
          success: false,
          dir,
          parent: null,
          folders: [],
          images: [],
          total: 0,
          truncated: false,
          error: "ENOENT: no such file or directory",
          nearest: imageRoot,
        }),
      );
      return;
    }
    const names = imageFiles[dir] ?? [];
    await route.fulfill(
      json({
        success: true,
        dir,
        parent: dir === imageRoot ? "F:\\mock\\ComfyUI" : dir.slice(0, dir.lastIndexOf("\\")),
        folders,
        images: names.map((name, index) => ({ name, size: 1024 * (index + 1), mtime: 1_760_000_000_000 + index * 60_000 })),
        total: names.length,
        truncated: false,
        error: "",
        nearest: "",
      }),
    );
  });

  await page.route(/\/xyz\/images\/file/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TINY_PNG }),
  );

  await page.route(/\/xyz\/images\/delete/, async (route) => {
    const body = route.request().postDataJSON() as { paths?: string[] } | null;
    const deleted: string[] = [];
    for (const path of body?.paths ?? []) {
      const dir = path.slice(0, path.lastIndexOf("\\"));
      const name = path.slice(path.lastIndexOf("\\") + 1);
      const list = imageFiles[dir] ?? [];
      const index = list.indexOf(name);
      if (index >= 0) {
        list.splice(index, 1);
        deleted.push(path);
      }
    }
    await route.fulfill(json({ success: true, deleted, failed: [], mode: trashEnabled ? "trash" : "delete" }));
  });

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

  // 前端持久化状态已走服务端 /api/ui-state（data/ui-state.json）：这里用一个 test 内
  // 存活的字典模拟服务端，既让每个用例从空状态开始、不污染真实数据，又让「刷新后保留
  // 折叠状态 / 当前 tab」这类用例名副其实（此前 GET 恒返回 {}，刷新后必然回默认值）。
  const uiState: Record<string, unknown> = {};
  let uiRevision = 0;
  await page.route(/\/api\/ui-state/, async (route) => {
    const method = (route.request().method() ?? "GET").toUpperCase();
    if (method === "GET") {
      await route.fulfill(json({ success: true, data: uiState, revision: uiRevision }));
      return;
    }
    if (method === "PUT") {
      const body = route.request().postDataJSON() as { entries?: Record<string, unknown> } | null;
      if (body?.entries) Object.assign(uiState, body.entries);
      uiRevision += 1;
    }
    await route.fulfill(json({ success: true, revision: uiRevision }));
  });

  await page.route(/\/api\/prompts/, (route) =>
    route.fulfill(
      json({
        success: true,
        data: { favorites: [], recents: [], customEntries: [], templates: [], revision: 0 },
      })
    )
  );

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

/**
 * 幸运大转盘的 mock 词库：直接沿用 `DEFAULT_WHEEL_SECTORS` 用到的分类，
 * 保证「默认扇区一定有词可抽」这条不会因为改了默认映射而悄悄失配。
 */
const PROMPT_CATEGORIES = [...new Set(DEFAULT_WHEEL_SECTORS.flatMap((sector) => sector.categories))];

/** 只存在于「我的词条」（customEntries）里的分类，用来验证转盘能吃到用户导入的词条。 */
export const MOCK_CUSTOM_CATEGORY = "自建分类";

/**
 * 拦截内置词库请求，返回覆盖全部默认分类的小词库。
 * 只给「幸运大转盘」的用例挂载：其它用例不关心词库内容，装上去只会拖慢它们。
 */
export async function installPromptLibraryMock(page: Page) {
  const records = PROMPT_CATEGORIES.flatMap((category, categoryIndex) =>
    Array.from({ length: 3 }, (_, i) => ({
      id: `${categoryIndex}-${i}`,
      source: "e2e",
      category,
      scope: "normal",
      // 必须是唯一英文词，否则会与同一词池内的去重规则相撞
      text_en: `tag-${categoryIndex}-${i}`,
      text_zh: `${category}词${i + 1}`,
    }))
  ).concat([
    // 负面词库与 NSFW 词：断言它们不会出现在扇区候选里
    { id: "neg", source: "e2e", category: "人物", scope: "negative_default", text_en: "bad anatomy", text_zh: "负面" },
    { id: "r18", source: "e2e", category: "动作", scope: "r18", text_en: "nsfw action", text_zh: "限制级" },
  ]);

  await page.route(/\/data\/prompt-library\/.*\.json/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(records),
    })
  );

  // 用户词条（`/api/prompts` 的 customEntries）：转盘词池 = 内置 + 我的词条，
  // 这里给一条只存在于「我的词条」里的分类，用来在真实浏览器里守住这条合并链路。
  // 后注册的路由优先匹配，因此覆盖 installApiMocks 里那份空数据。
  await page.route(/\/api\/prompts/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          favorites: [],
          recents: [],
          customEntries: [
            { id: "mine", source: "本地文件", category: MOCK_CUSTOM_CATEGORY, scope: "default", text_en: "my-own-tag", text_zh: "我的词" },
          ],
          templates: [],
          revision: 0,
        },
      }),
    })
  );
}
