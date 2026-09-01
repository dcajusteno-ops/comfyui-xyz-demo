import { describe, expect, it } from "vitest";
import { computeMetrics, normalizeBatch, type ImageMetrics } from "./imageMetrics";

function makeImage(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number]
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
}

const uniform = (value: number) =>
  (width: number, height: number) =>
    makeImage(width, height, () => [value, value, value, 255]);

const checkerboard = (width: number, height: number) =>
  makeImage(width, height, (x, y) => {
    const level = (x + y) % 2 === 0 ? 0 : 255;
    return [level, level, level, 255];
  });

const saturated = (width: number, height: number) =>
  makeImage(width, height, (x, y) => {
    const i = (x + y) % 3;
    return i === 0 ? [255, 0, 0, 255] : i === 1 ? [0, 255, 0, 255] : [0, 0, 255, 255];
  });

describe("image metrics", () => {
  it("treats a uniform gray image as flat: zero sharpness and zero color", () => {
    const metrics = computeMetrics(uniform(128)(32, 32), 32, 32);
    expect(metrics.sharpness).toBeCloseTo(0, 4);
    expect(metrics.colorfulness).toBeCloseTo(0, 4);
    expect(metrics.exposure).toBe(1);
    expect(metrics.darkRatio).toBe(0);
    expect(metrics.brightRatio).toBe(0);
  });

  it("ranks a sharp checkerboard sharper than a near-flat image", () => {
    const sharp = computeMetrics(checkerboard(64, 64), 64, 64);
    // 少量噪声模拟"模糊但有细节"的图像
    const noisyFlat = makeImage(64, 64, (x, y) => {
      const v = 128 + ((x * 31 + y * 17) % 5);
      return [v, v, v, 255];
    });
    const blurry = computeMetrics(noisyFlat, 64, 64);
    expect(sharp.sharpness).toBeGreaterThan(blurry.sharpness * 10);
  });

  it("penalizes blown-out highlight exposure", () => {
    const allWhite = computeMetrics(uniform(255)(32, 32), 32, 32);
    expect(allWhite.brightRatio).toBe(1);
    expect(allWhite.exposure).toBe(0);
  });

  it("detects colorfulness difference between saturated and gray", () => {
    const colorful = computeMetrics(saturated(32, 32), 32, 32);
    const gray = computeMetrics(uniform(128)(32, 32), 32, 32);
    expect(colorful.colorfulness).toBeGreaterThan(gray.colorfulness + 0.3);
  });

  it("normalizes a batch to a 0-100 relative score", () => {
    const sharp = computeMetrics(checkerboard(64, 64), 64, 64);
    const blurry = computeMetrics(uniform(128)(64, 64), 64, 64);
    const [sharpScore, blurryScore] = normalizeBatch([sharp, blurry]) as [number, number];
    expect(sharpScore).toBeGreaterThan(blurryScore);
    expect(sharpScore).toBeGreaterThanOrEqual(0);
    expect(sharpScore).toBeLessThanOrEqual(100);
  });

  it("keeps null samples as null and does not crash on empty input", () => {
    expect(normalizeBatch([])).toEqual([]);
    expect(normalizeBatch([null] as (ImageMetrics | null)[])).toEqual([null]);
  });
});