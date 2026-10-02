import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadPromptLibrary,
  resetPromptLibraryCache,
  type PromptRecord,
} from "./promptLibrary";
import { buildSectorPool } from "./luckyWheel";

/**
 * 词库加载口径：内置 JSON + `/api/prompts` 的 customEntries 合并。
 * 用户导入词典就是为了能用上它 —— 转盘不该看不见自己导入的词条。
 */
const BUILTIN: PromptRecord[] = [
  { id: "b1", category: "动作", scope: "normal", text_en: "jumping", text_zh: "跳跃" },
  { id: "b2", category: "动作", scope: "r18", text_en: "nsfw-action", text_zh: "限制级" },
  { id: "b3", category: "动作", scope: "negative_default", text_en: "bad", text_zh: "负面" },
  { id: "b4", category: "动作", scope: "normal", text_en: "has, comma", text_zh: "整句" },
];

const custom = (overrides: Partial<PromptRecord>): PromptRecord => ({
  id: "c1",
  source: "本地文件",
  category: "我的分类",
  scope: "default",
  text_en: "my-tag",
  text_zh: "我的词",
  ...overrides,
});

function stubFetch(opts: { custom?: unknown; customFails?: boolean; builtinFails?: boolean } = {}) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(String(url));
    if (String(url).includes("/api/prompts")) {
      if (opts.customFails) throw new Error("boom");
      return { ok: true, status: 200, json: async () => ({ success: true, data: { customEntries: opts.custom ?? [] } }) };
    }
    if (opts.builtinFails) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => BUILTIN };
  };
  vi.stubGlobal("fetch", vi.fn(impl));
  return calls;
}

describe("词库加载：内置 + 我的词条", () => {
  afterEach(() => {
    resetPromptLibraryCache();
    vi.unstubAllGlobals();
  });

  it("合并两个数据源，且同名时用我的中英对照（我的词条在前，词池去重先出现者胜）", async () => {
    const calls = stubFetch({
      custom: [custom({ category: "动作", text_en: "jumping", text_zh: "我的跳跃" }), custom({})],
    });
    const records = await loadPromptLibrary();

    expect(calls.filter((url) => url.includes("/api/prompts"))).toHaveLength(1);
    // 加载阶段不去重：我的词条在前，内置的同名词条照旧保留（不同分类可能各自需要它）
    expect(records.map((r) => r.text_en)).toEqual(["jumping", "my-tag", "jumping", "nsfw-action"]);
    expect(records[0].text_zh).toBe("我的跳跃");

    // 落到同一个扇区词池时才按 text_en 去重 —— 留下的是排在前面的「我的」那条
    const pool = buildSectorPool({ id: "a", label: "动作", categories: ["动作"], extraTags: [], enabled: true }, records);
    expect(pool.map((r) => `${r.text_en}|${r.text_zh}`)).toEqual(["jumping|我的跳跃"]);
  });

  it("我的词条接口失败时静默降级为仅内置", async () => {
    stubFetch({ customFails: true });
    const records = await loadPromptLibrary();
    expect(records.map((r) => r.text_en).sort()).toEqual(["jumping", "nsfw-action"]);
  });

  it("我的词条里不符合候选判据的（无分类 / 整句 / 负面）一并剔除", async () => {
    stubFetch({
      custom: [
        custom({ text_en: "keep-me" }),
        custom({ text_en: "no-category", category: "" }),
        custom({ text_en: "multi, tag" }),
        custom({ text_en: "neg", scope: "negative_default" }),
        custom({ text_en: "r18-kept", scope: "r18" }),
      ],
    });
    const records = await loadPromptLibrary();
    const mine = records.filter((r) => r.source === "本地文件").map((r) => r.text_en);
    expect(mine).toEqual(["keep-me", "r18-kept"]);
  });

  it("内置词库失败仍然报错（面板据此显示错误态）", async () => {
    stubFetch({ builtinFails: true });
    await expect(loadPromptLibrary()).rejects.toThrow(/词库加载失败/);
  });

  it("模块级缓存：第二次调用不再发请求", async () => {
    const calls = stubFetch({ custom: [] });
    await loadPromptLibrary();
    await loadPromptLibrary();
    expect(calls).toHaveLength(2); // 内置 1 次 + 我的词条 1 次
  });
});
