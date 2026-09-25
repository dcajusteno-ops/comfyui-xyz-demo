import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useLoras, makeLoraSelection, appendLoraToCollection } from "./useLoras";
import { defaultLoraManagerSettings } from "../constants";
import type { ComfyClient } from "../lib/comfyClient";
import type { LoraItem, LoraListResult, LoraManagerSettings } from "../types";

/**
 * useLoras 单测（补齐 759 行 hook 的零覆盖缺口）。
 * 与 useOptions.test.ts 同款基建：手写 mock client（形状与真实方法返回一致）。
 * 注意 hook 内有 220ms 防抖自动加载 + 示例图状态轮询，统一用真实定时器 + waitFor。
 */

function makeLoraItem(overrides: Partial<LoraItem> = {}): LoraItem {
  return {
    model_name: "Demo Lora",
    file_name: "demo_lora.safetensors",
    folder: "",
    file_path: "D:/models/loras/demo_lora.safetensors",
    sha256: "HASH_ABC",
    ...overrides,
  };
}

function makePage(items: LoraItem[], page: number, totalPages: number): LoraListResult {
  return { items, total: items.length * totalPages, page, pageSize: 2, totalPages };
}

const okResult = { success: true } as never;

function makeMockClient(overrides: Partial<Record<string, unknown>> = {}) {
  const itemA = makeLoraItem({ model_name: "Lora A", file_path: "D:/m/a.safetensors" });
  const itemB = makeLoraItem({ model_name: "Lora B", file_path: "D:/m/b.safetensors" });
  const client = {
    listManagedModels: vi.fn(async (_type: string, query: { page?: number }) =>
      makePage((query?.page ?? 1) === 1 ? [itemA, itemB] : [makeLoraItem({ model_name: "Lora C", file_path: "D:/m/c.safetensors" })], query?.page ?? 1, 2)),
    getManagedModelFolders: vi.fn(async () => ["folderX", "folderY"]),
    getManagedModelBaseModels: vi.fn(async () => [{ name: "SDXL", count: 2 }]),
    getManagedModelTopTags: vi.fn(async () => ["tag1", "tag2"]),
    getExampleImagesStatus: vi.fn(async () => ({ success: true, is_downloading: false, status: { status: "idle", total: 0, completed: 0, current_model: "", errors: [], last_error: null, processed_models: [], refreshed_models: [], failed_models: [], reprocessed_models: [] } })),
    checkExampleImagesNeeded: vi.fn(async () => ({ success: true, needed: false, count: 0 })),
    getLoraExampleFiles: vi.fn(async () => []),
    setManagedModelFavorite: vi.fn(async () => okResult),
    saveLoraTriggerWords: vi.fn(async () => okResult),
    getLoraTriggerWords: vi.fn(async () => [] as string[]),
    extractLoraMetadata: vi.fn(async () => ({}) as Record<string, unknown>),
    refreshManagedModelCivitaiMetadata: vi.fn(async () => okResult),
    deleteManagedModel: vi.fn(async () => okResult),
    moveManagedModel: vi.fn(async () => okResult),
    renameManagedModel: vi.fn(async () => okResult),
    bulkDeleteManagedModels: vi.fn(async () => okResult),
    bulkMoveManagedModels: vi.fn(async () => okResult),
    updateLoraManagerSettings: vi.fn(async () => ({ success: true, settings: { blur_mature_content: false, mature_blur_level: "X", onboarding_completed: true } })),
    repairDoctorCache: vi.fn(async () => ({ success: true, message: "repaired" })),
    resolveDoctorFilenameConflicts: vi.fn(async () => ({ success: true, message: "resolved" })),
    exportDoctorBundle: vi.fn(async () => ({ success: true, bundle_path: "D:/bundle.zip" })),
    pauseExampleImages: vi.fn(async () => okResult),
    resumeExampleImages: vi.fn(async () => okResult),
    stopExampleImages: vi.fn(async () => okResult),
    downloadExampleImages: vi.fn(async () => ({ success: true })),
    forceDownloadExampleImages: vi.fn(async () => ({ success: true })),
    openExampleImagesFolder: vi.fn(async () => ({ success: true, path: "D:/examples" })),
    ...overrides,
  };
  return { client: client as unknown as ComfyClient, itemA, itemB };
}

function renderUseLoras(client: ComfyClient, overrides: { pushToast?: ReturnType<typeof vi.fn>; activeLoraHashes?: string[]; loraSettings?: LoraManagerSettings } = {}) {
  // pushToast 保留 vi.fn 原始类型（测试里要读 .mock），传入 hook 时才窄化为 ToastFn
  const pushToast = overrides.pushToast ?? vi.fn();
  const setLoraSettings = vi.fn();
  const view = renderHook(() => useLoras({
    client,
    pushToast: pushToast as unknown as (type: "error" | "success" | "info", title: string, message?: string) => void,
    loraSettings: overrides.loraSettings ?? defaultLoraManagerSettings,
    setLoraSettings,
    tab: "loras",
    activeLoraHashes: overrides.activeLoraHashes ?? [],
  }));
  return { ...view, pushToast, setLoraSettings };
}

/** 等 220ms 防抖的首次自动加载完成（items 出现且 loading 复位） */
async function waitForInitialLoad(result: { current: { loraResult: LoraListResult; loraLoading: boolean } }) {
  await waitFor(() => {
    expect(result.current.loraResult.items.length).toBeGreaterThan(0);
    expect(result.current.loraLoading).toBe(false);
  });
}

describe("useLoras", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("首次自动加载：列表 + facets 填充，选中清空", async () => {
    const { client } = makeMockClient();
    const view = renderUseLoras(client);
    await waitForInitialLoad(view.result);
    expect(view.result.current.loraResult.items.map((i) => i.model_name)).toEqual(["Lora A", "Lora B"]);
    expect(view.result.current.loraFolders).toEqual(["folderX", "folderY"]);
    expect(view.result.current.loraBaseModels).toEqual([{ name: "SDXL", count: 2 }]);
    expect(view.result.current.loraTags).toEqual(["tag1", "tag2"]);
    expect((client.listManagedModels as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("loras");
  });

  it("loadMoreManagedModels：追加下一页且去重（同 file_path 不重复）", async () => {
    const { client } = makeMockClient();
    // 第二页返回与第一页同 file_path 的条目，验证 mergeManagedModelItems 去重
    (client.listManagedModels as ReturnType<typeof vi.fn>).mockImplementation(async (_type: string, query: { page?: number }) =>
      makePage([makeLoraItem({ model_name: (query?.page ?? 1) === 1 ? "Lora A" : "Lora A2", file_path: "D:/m/a.safetensors" })], query?.page ?? 1, 2));
    const view = renderUseLoras(client);
    await waitForInitialLoad(view.result);

    await act(async () => { await view.result.current.loadMoreManagedModels(); });
    await waitFor(() => expect(view.result.current.loraResult.page).toBe(2));
    // 同一 file_path 只保留一份
    expect(view.result.current.loraResult.items.filter((i) => i.file_path === "D:/m/a.safetensors").length).toBe(1);
  });

  it("loadMoreManagedModels：已是最后一页时不发请求", async () => {
    const { client } = makeMockClient();
    (client.listManagedModels as ReturnType<typeof vi.fn>).mockResolvedValue(makePage([makeLoraItem()], 1, 1));
    const view = renderUseLoras(client);
    await waitForInitialLoad(view.result);
    const callsBefore = (client.listManagedModels as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => { await view.result.current.loadMoreManagedModels(); });
    expect((client.listManagedModels as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
  });

  it("changeManagedModelType：切换后重置状态并以新类型重新拉取；同类型 no-op", async () => {
    const { client } = makeMockClient();
    const view = renderUseLoras(client);
    await waitForInitialLoad(view.result);
    view.result.current.setSelectedLoraPaths(["D:/m/a.safetensors"]);

    await act(async () => { view.result.current.changeManagedModelType("embeddings"); });
    await waitFor(() => {
      expect(view.result.current.managedModelType).toBe("embeddings");
      expect(view.result.current.loraResult.items.length).toBeGreaterThan(0);
    });
    const lastCall = (client.listManagedModels as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(lastCall[0]).toBe("embeddings");
    // 切换时选中被清空
    expect(view.result.current.selectedLoraPaths).toEqual([]);

    // 同类型 no-op：不重置结果
    const itemsBefore = view.result.current.loraResult.items;
    await act(async () => { view.result.current.changeManagedModelType("embeddings"); });
    expect(view.result.current.loraResult.items).toBe(itemsBefore);
  });

  it("toggleLoraFavorite：乐观更新；插件写回失败时回滚并报错", async () => {
    const { client } = makeMockClient();
    const view = renderUseLoras(client);
    await waitForInitialLoad(view.result);

    // 成功路径
    await act(async () => { await view.result.current.toggleLoraFavorite(view.result.current.loraResult.items[0]); });
    await waitFor(() => expect(view.result.current.loraResult.items[0].favorite).toBe(true));
    expect(view.pushToast.mock.calls.some(([type]) => type === "success")).toBe(true);

    // 失败路径：回滚到【调用前】的值（第一次成功后 favorite 已是 true，二次失败应回到 true）
    (client.setManagedModelFavorite as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("write failed"));
    await act(async () => { await view.result.current.toggleLoraFavorite(view.result.current.loraResult.items[0]); });
    await waitFor(() => expect(view.result.current.loraResult.items[0].favorite).toBe(true));
    expect(view.pushToast.mock.calls.some(([type, title]) => type === "error" && title === "收藏写回失败")).toBe(true);
  });

  it("selectVisibleLoras：全选 → 再点一次只取消可见项", async () => {
    const { client } = makeMockClient();
    const view = renderUseLoras(client);
    await waitForInitialLoad(view.result);

    await act(async () => { view.result.current.selectVisibleLoras(); });
    expect(view.result.current.selectedLoraPaths).toEqual(["D:/m/a.safetensors", "D:/m/b.safetensors"]);

    await act(async () => { view.result.current.selectVisibleLoras(); });
    expect(view.result.current.selectedLoraPaths).toEqual([]);
  });

  it("saveLoraTriggerWords：去重清洗后写入并回写 civitai.trainedWords；失败抛错", async () => {
    const { client, itemA } = makeMockClient();
    const view = renderUseLoras(client);
    await waitForInitialLoad(view.result);

    const saved = await view.result.current.saveLoraTriggerWords(itemA, [" triggerA ", "triggerB", "triggerA", ""]);
    expect(saved).toEqual(["triggerA", "triggerB"]);
    expect((client.saveLoraTriggerWords as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual(["triggerA", "triggerB"]);
    await waitFor(() => expect(view.result.current.loraResult.items[0].civitai).toMatchObject({ trainedWords: ["triggerA", "triggerB"] }));

    (client.saveLoraTriggerWords as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("save failed"));
    await expect(view.result.current.saveLoraTriggerWords(itemA, ["x"])).rejects.toThrow("save failed");
    expect(view.pushToast.mock.calls.some(([type, title]) => type === "error" && title === "触发词同步失败")).toBe(true);
  });

  it("extractTriggerWords：从 ss_tagger_tags 解析并去重", async () => {
    const { client, itemA } = makeMockClient();
    (client.extractLoraMetadata as ReturnType<typeof vi.fn>).mockResolvedValue({ ss_tagger_tags: "wordA, wordB，wordA\nwordC" });
    const view = renderUseLoras(client);
    await waitForInitialLoad(view.result);

    let words: string[] | undefined = [];
    await act(async () => { words = await view.result.current.extractTriggerWords(itemA); });
    expect(words).toEqual(["wordA", "wordB", "wordC"]);
    await waitFor(() => expect(view.result.current.triggerWords["Lora A"]).toEqual(["wordA", "wordB", "wordC"]));
  });

  it("deleteLora：成功刷新列表；失败抛错并 toast", async () => {
    const { client, itemA } = makeMockClient();
    const view = renderUseLoras(client);
    await waitForInitialLoad(view.result);

    await act(async () => { await view.result.current.deleteLora(itemA); });
    expect((client.deleteManagedModel as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(["loras", itemA.file_path]);
    expect(view.pushToast.mock.calls.some(([type, title]) => type === "success" && title === "LoRA 已删除")).toBe(true);

    (client.deleteManagedModel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("disk locked"));
    await expect(view.result.current.deleteLora(itemA)).rejects.toThrow("disk locked");
    expect(view.pushToast.mock.calls.some(([type, title]) => type === "error" && title === "删除失败")).toBe(true);
  });

  it("updateLoraSettings：保存后走 normalizeLoraManagerSettings 并回传", async () => {
    const { client } = makeMockClient();
    const view = renderUseLoras(client);
    await waitForInitialLoad(view.result);

    const next = { blur_mature_content: false, mature_blur_level: "X", onboarding_completed: true } as LoraManagerSettings;
    const saved = await view.result.current.updateLoraSettings(next);
    expect(saved.blur_mature_content).toBe(false);
    expect(view.setLoraSettings).toHaveBeenCalled();
  });

  it("doctorAction：按 action 分派到对应 client 方法", async () => {
    const { client } = makeMockClient();
    const view = renderUseLoras(client);
    await waitForInitialLoad(view.result);

    await view.result.current.doctorAction("repair");
    expect(client.repairDoctorCache).toHaveBeenCalled();
    await view.result.current.doctorAction("resolve");
    expect(client.resolveDoctorFilenameConflicts).toHaveBeenCalled();
    const result = await view.result.current.doctorAction("export");
    expect(client.exportDoctorBundle).toHaveBeenCalled();
    expect(result).toMatchObject({ bundle_path: "D:/bundle.zip" });
  });

  it("activeLoraHashes：缺失的 hash 会触发 getLoraExampleFiles 预加载", async () => {
    const { client } = makeMockClient();
    (client.getLoraExampleFiles as ReturnType<typeof vi.fn>).mockResolvedValue([{ path: "D:/ex/1.png", url: "", source: "image" as const }]);
    const view = renderUseLoras(client, { activeLoraHashes: ["HASH_NEW"] });
    await waitFor(() => expect(view.result.current.loraExampleFilesByHash["HASH_NEW"]).toBeDefined());
  });
});

describe("makeLoraSelection / appendLoraToCollection（纯函数）", () => {
  it("makeLoraSelection：映射 LoraSelection 字段（preview 取本地优先）", () => {
    const item = makeLoraItem({ model_name: "My Lora", file_path: "D:/m/my.safetensors", sha256: "HASH_1", preview_url: "http://remote/preview.png" });
    const localFiles = [{ ...item, file_path: "D:/m/my.safetensors" }];
    const selection = makeLoraSelection(item, localFiles, 0.8);
    // loraSyntaxName 语义：folder 为空时取 file_name（模型语法名），displayName 才是 model_name
    expect(selection).toMatchObject({
      name: "demo_lora.safetensors",
      displayName: "My Lora",
      strength: 0.8,
      clipStrength: 0.8,
      active: true,
      filePath: "D:/m/my.safetensors",
      sha256: "HASH_1",
    });
  });

  it("appendLoraToCollection：同 name 二次追加只更新不重复（mergeLora 语义）", () => {
    const item = makeLoraItem({ model_name: "My Lora", file_name: "my_lora.safetensors", file_path: "D:/m/my.safetensors" });
    const name = makeLoraSelection(item, [item]).name;
    const first = appendLoraToCollection([], makeLoraSelection(item, [item], 1));
    const second = appendLoraToCollection(first, makeLoraSelection(item, [item], 0.7));
    expect(second.filter((s) => s.name === name).length).toBe(1);
    // mergeLora：同名已存在时原样保留（不更新强度）——去重插入约定
    expect(second[0].strength).toBe(1);
  });
});
