import { describe, expect, it } from "vitest";
import {
  TEXT_OUTPUT_KEYS,
  collectNodeImages,
  collectNodeTexts,
  mergeJobResult,
} from "./comfyResult";
import type { JobResult, OutputImage } from "../types";

/** 简易 viewUrl，形态与 ComfyClient.viewUrl 一致但不依赖实例 */
const viewUrl = (image: { filename: string; subfolder?: string; type?: string }) =>
  `/comfy/api/view?filename=${image.filename}&type=${image.type ?? "output"}`;

const image = (filename: string): OutputImage => ({
  filename,
  url: `/comfy/api/view?filename=${filename}&type=output`,
});

describe("collectNodeTexts", () => {
  it("A1 单个字符串输出", () => {
    expect(collectNodeTexts({ text: "hello" })).toEqual(["hello"]);
  });

  it("A2 普通字符串数组逐项产出（非字符数组）", () => {
    // 注意：判定是「全部为单字符字符串」才算字符数组。["a","b"] 会被拼成 "ab"（见 A3），
    // 多字符数组才是逐项输出
    expect(collectNodeTexts({ text: ["1girl", "solo"] })).toEqual(["1girl", "solo"]);
  });

  it("A3 字符数组拼接成一条（ComfyUI 按字符拆分的输出）", () => {
    expect(collectNodeTexts({ text: ["1", "g", "i", "r", "l"] })).toEqual(["1girl"]);
  });

  it("A4 数字数组逐项转字符串", () => {
    expect(collectNodeTexts({ text: [1, 2] })).toEqual(["1", "2"]);
  });

  it("A5 数组里的对象被过滤，其余保留", () => {
    expect(collectNodeTexts({ text: [{ a: 1 }, "ok", null, 3] })).toEqual(["ok", "3"]);
  });

  it("A6 空串 / 纯空白 / null / undefined 一律不产出且不抛错", () => {
    expect(collectNodeTexts({ text: "" })).toEqual([]);
    expect(collectNodeTexts({ text: "   " })).toEqual([]);
    expect(collectNodeTexts({ text: null })).toEqual([]);
    expect(collectNodeTexts({ text: undefined })).toEqual([]);
    expect(collectNodeTexts({})).toEqual([]);
    expect(collectNodeTexts(null)).toEqual([]);
    expect(collectNodeTexts(undefined)).toEqual([]);
    expect(collectNodeTexts({ text: [] })).toEqual([]);
    expect(collectNodeTexts({ text: [{}, {}] })).toEqual([]);
  });

  it("A7 优先键命中时不走兜底（不会重复产出）", () => {
    // 若误把兜底判定写成「全局累积值为空」，这里会因兜底再扫一遍而产出重复
    expect(collectNodeTexts({ text: "once", extra: "once" })).toEqual(["once"]);
  });

  it("A8 优先键全未命中时，扫描本节点其它键", () => {
    expect(collectNodeTexts({ custom_key: "from-fallback" })).toEqual(["from-fallback"]);
  });

  it("A9 连续处理多个节点时，第二个节点同样能走兜底（本任务书 1.2(b) 的修复点）", () => {
    // 旧实现里 extractHistory 用函数级累积数组判断「本节点有无文本」，
    // 第二个节点因为累积值非空而永远进不了兜底分支，输出被丢弃
    const first = collectNodeTexts({ custom_a: "first-node" });
    const second = collectNodeTexts({ custom_b: "second-node" });
    expect(first).toEqual(["first-node"]);
    expect(second).toEqual(["second-node"]);
  });

  it("A10 同一节点内 text 与 tags 内容相同 —— 由调用方 merge 阶段去重，本函数如实产出两条", () => {
    expect(collectNodeTexts({ text: "1girl", tags: "1girl" })).toEqual(["1girl", "1girl"]);
  });

  it("优先键列表是共享常量（两处实现合并的唯一来源）", () => {
    expect(TEXT_OUTPUT_KEYS).toEqual(["text", "texts", "STRING", "string", "tags", "csv"]);
  });
});

describe("collectNodeImages", () => {
  it("A11 正常输出：url 走注入的 viewUrl，nodeTitle 原样带上", () => {
    const images = collectNodeImages(
      { images: [{ filename: "a.png", subfolder: "默认生图", type: "output" }] },
      "保存图像",
      viewUrl,
    );
    expect(images).toEqual([
      {
        filename: "a.png",
        subfolder: "默认生图",
        type: "output",
        url: "/comfy/api/view?filename=a.png&type=output",
        nodeTitle: "保存图像",
      },
    ]);
  });

  it("A12 nodeTitle 为 undefined 时照常产出（两条路径的取值口径本就不同）", () => {
    const images = collectNodeImages({ images: [{ filename: "b.png" }] }, undefined, viewUrl);
    expect(images).toHaveLength(1);
    expect(images[0].nodeTitle).toBeUndefined();
    expect(images[0].url).toContain("type=output");
  });

  it("A13 非对象 / 缺 filename 的项被忽略，不抛错", () => {
    expect(
      collectNodeImages({ images: ["str", 42, null, { nope: 1 }, { filename: "ok.png" }] }, "t", viewUrl),
    ).toEqual([expect.objectContaining({ filename: "ok.png" })]);
    expect(collectNodeImages({ images: "not-an-array" }, "t", viewUrl)).toEqual([]);
    expect(collectNodeImages({}, "t", viewUrl)).toEqual([]);
    expect(collectNodeImages(null, "t", viewUrl)).toEqual([]);
  });
});

describe("mergeJobResult", () => {
  it("A14 图片按 url 去重", () => {
    const merged = mergeJobResult(null, "p1", [image("a.png"), image("a.png"), image("b.png")], []);
    expect(merged.images.map((i) => i.filename)).toEqual(["a.png", "b.png"]);
  });

  it("A15 文本按内容去重且保持首次出现顺序", () => {
    const merged = mergeJobResult(null, "p1", [], ["b", "a", "b", "c", "a"]);
    expect(merged.texts).toEqual(["b", "a", "c"]);
  });

  it("A16 acc 为 null 时正确初始化；非 null 时原地累加并返回同一对象", () => {
    const fresh = mergeJobResult(null, "p1", [], []);
    expect(fresh).toEqual({ promptId: "p1", images: [], texts: [], rawHistory: {} });

    const existing: JobResult = { promptId: "p1", images: [image("a.png")], texts: ["x"], rawHistory: { keep: true } };
    const next = mergeJobResult(existing, "p1", [image("a.png"), image("b.png")], ["x", "y"]);
    expect(next).toBe(existing); // 对象标识不变
    expect(next.images.map((i) => i.filename)).toEqual(["a.png", "b.png"]);
    expect(next.texts).toEqual(["x", "y"]);
    expect(next.rawHistory).toEqual({ keep: true });
  });
});
