import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadJsonFile,
  normalizeImportedEntries,
  toPortableEntries,
  type PromptEntry,
} from "./PromptEditorData";

const entry = (over: Partial<PromptEntry> = {}): PromptEntry => ({
  id: "custom-1",
  source: "本地文件",
  category: "环境&生物",
  subcategory: "中型陆地哺乳",
  scope: "default",
  text_en: "siberian husky",
  text_zh: "哈士奇",
  ...over,
});

describe("词库导出 toPortableEntries", () => {
  it("只保留可移植字段（丢掉本地 id / search_text）", () => {
    const [out] = toPortableEntries([entry({ search_text: "husky 哈士奇" })]);
    expect(Object.keys(out).sort()).toEqual(
      ["category", "scope", "source", "subcategory", "text_en", "text_zh"].sort(),
    );
  });

  it("空字段补默认值（可选字段缺失不会导出 undefined）", () => {
    const [out] = toPortableEntries([
      entry({ source: "", category: "", subcategory: "", scope: "", text_en: "a", text_zh: "" }),
    ]);
    expect(out).toEqual({
      source: "本地文件",
      category: "未分类",
      subcategory: "",
      scope: "default",
      text_en: "a",
      text_zh: "",
    });
  });
});

describe("词库导入 normalizeImportedEntries", () => {
  it("补默认值、丢空白条目、id 互不相同", () => {
    const out = normalizeImportedEntries([
      { text_en: "a", text_zh: "甲" },
      { text_en: "", text_zh: "" },
      { text_en: "b", text_zh: "乙", source: "x", category: "y", scope: "r18" },
      "不是对象",
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      source: "本地文件",
      category: "未分类",
      subcategory: "",
      scope: "default",
      text_en: "a",
      text_zh: "甲",
    });
    expect(out[1]).toMatchObject({ source: "x", category: "y", scope: "r18" });
    expect(new Set(out.map((e) => e.id)).size).toBe(2);
  });

  it("缺 text_zh 时回退到 name（兼容旧词库格式）", () => {
    const [out] = normalizeImportedEntries([{ text_en: "apple", name: "苹果" }]);
    expect(out.text_zh).toBe("苹果");
  });

  it("非数组直接抛错（调用方据此提示用户）", () => {
    expect(() => normalizeImportedEntries({ text_en: "a" })).toThrow("JSON must be an array");
    expect(() => normalizeImportedEntries(null)).toThrow("JSON must be an array");
  });
});

describe("导出 / 导入互逆", () => {
  it("导出再导入：语义字段逐字不变（id 由导入端重新生成）", () => {
    const original = [
      entry(),
      entry({ id: "custom-2", source: "我的词库", category: "手动添加", subcategory: "", text_en: "off shoulder", text_zh: "露肩" }),
      entry({ id: "custom-3", scope: "r18", text_en: "nsfw", text_zh: "限制级" }),
    ];
    const roundTripped = normalizeImportedEntries(
      JSON.parse(JSON.stringify(toPortableEntries(original))),
    );
    const semantic = (e: PromptEntry) => ({
      source: e.source,
      category: e.category,
      subcategory: e.subcategory,
      scope: e.scope,
      text_en: e.text_en,
      text_zh: e.text_zh,
    });
    expect(roundTripped.map(semantic)).toEqual(original.map(semantic));
  });
});

describe("downloadJsonFile", () => {
  const created: Blob[] = [];

  afterEach(() => {
    created.length = 0;
    vi.unstubAllGlobals();
  });

  // jsdom 的 Blob 没有 .text()，统一走 FileReader
  const readBlob = (b: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(b);
    });

  it("生成一个带正确文件名的下载，内容是缩进过的 JSON", async () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (b: Blob) => {
        created.push(b);
        return "blob:stub";
      },
      revokeObjectURL: vi.fn(),
    });
    const clicks: string[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    };

    try {
      downloadJsonFile("我的词库-2026-09-28.json", [{ text_en: "a" }]);
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
    }

    expect(clicks).toEqual(["我的词库-2026-09-28.json"]);
    expect(created).toHaveLength(1);
    const text = await readBlob(created[0]);
    expect(JSON.parse(text)).toEqual([{ text_en: "a" }]);
    expect(text).toContain("\n  "); // 缩进 2 空格，人类可读
    // 不留残骸：生成的 <a> 已移除
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
