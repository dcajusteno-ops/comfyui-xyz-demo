import { describe, expect, it } from "vitest";
import {
  computeWatermarkAnchor,
  DEFAULT_WATERMARK_PARAMS,
  mapWithConcurrency,
  normalizeWatermarkParams,
} from "./watermark";

describe("computeWatermarkAnchor", () => {
  const W = 800;
  const H = 600;

  it("九宫格：margin 贴未旋转图边，锚点为文字包围盒中心", () => {
    // 32px 字号的包围盒按调用方传入，这里用固定 100x40 验证几何
    const textW = 100;
    const textH = 40;
    const margin = 24;

    expect(computeWatermarkAnchor(W, H, textW, textH, { position: "top-left", margin })).toEqual({
      x: margin + textW / 2,
      y: margin + textH / 2,
    });
    expect(computeWatermarkAnchor(W, H, textW, textH, { position: "bottom-right", margin })).toEqual({
      x: W - margin - textW / 2,
      y: H - margin - textH / 2,
    });
    expect(computeWatermarkAnchor(W, H, textW, textH, { position: "middle-center", margin })).toEqual({
      x: W / 2,
      y: H / 2,
    });
    expect(computeWatermarkAnchor(W, H, textW, textH, { position: "top-center", margin })).toEqual({
      x: W / 2,
      y: margin + textH / 2,
    });
    expect(computeWatermarkAnchor(W, H, textW, textH, { position: "middle-left", margin })).toEqual({
      x: margin + textW / 2,
      y: H / 2,
    });
  });

  it("margin=0 时文字贴边（包围盒一半越出边界属预期，绘制居中语义）", () => {
    const anchor = computeWatermarkAnchor(W, H, 100, 40, { position: "bottom-right", margin: 0 });
    expect(anchor.x).toBe(W - 50);
    expect(anchor.y).toBe(H - 20);
  });

  it("负 margin 被按 0 处理", () => {
    const anchor = computeWatermarkAnchor(W, H, 100, 40, { position: "top-left", margin: -5 });
    expect(anchor.x).toBe(50);
    expect(anchor.y).toBe(20);
  });
});

describe("normalizeWatermarkParams", () => {
  it("默认值原样通过", () => {
    expect(normalizeWatermarkParams({ ...DEFAULT_WATERMARK_PARAMS })).toEqual(DEFAULT_WATERMARK_PARAMS);
  });

  it("越界数值被 clamp", () => {
    const normalized = normalizeWatermarkParams({
      ...DEFAULT_WATERMARK_PARAMS,
      fontSize: 9999,
      margin: -10,
      opacity: 0,
      rotation: 180,
    });
    expect(normalized.fontSize).toBe(500);
    expect(normalized.margin).toBe(0);
    expect(normalized.opacity).toBe(1);
    expect(normalized.rotation).toBe(90);
  });

  it("NaN / 非有限数值回退默认", () => {
    const normalized = normalizeWatermarkParams({
      ...DEFAULT_WATERMARK_PARAMS,
      fontSize: Number.NaN,
      opacity: Number.POSITIVE_INFINITY,
    });
    expect(normalized.fontSize).toBe(DEFAULT_WATERMARK_PARAMS.fontSize);
    expect(normalized.opacity).toBe(DEFAULT_WATERMARK_PARAMS.opacity);
  });

  it("非法 position 回退默认 bottom-right", () => {
    const normalized = normalizeWatermarkParams({
      ...DEFAULT_WATERMARK_PARAMS,
      position: "diagonal" as never,
    });
    expect(normalized.position).toBe("bottom-right");
  });

  it("平铺 tile 是合法位置", () => {
    expect(normalizeWatermarkParams({ ...DEFAULT_WATERMARK_PARAMS, position: "tile" }).position).toBe("tile");
  });

  it("非法 color（非 6 位 hex）回退默认", () => {
    const normalized = normalizeWatermarkParams({
      ...DEFAULT_WATERMARK_PARAMS,
      color: "red",
    });
    expect(normalized.color).toBe(DEFAULT_WATERMARK_PARAMS.color);
    expect(normalizeWatermarkParams({ ...DEFAULT_WATERMARK_PARAMS, color: "#AbCdEf" }).color).toBe("#AbCdEf");
  });

  it("text 非字符串回退空串", () => {
    const normalized = normalizeWatermarkParams({
      ...DEFAULT_WATERMARK_PARAMS,
      text: 42 as never,
    });
    expect(normalized.text).toBe("");
  });
});

describe("mapWithConcurrency", () => {
  it("保持顺序且限制并发", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("空数组直接返回空", async () => {
    expect(await mapWithConcurrency([], 2, async (n) => n)).toEqual([]);
  });
});
