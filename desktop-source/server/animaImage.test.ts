import { describe, expect, it } from "vitest";
import { isAllowedAnimaImageUrl } from "./animaImage";

describe("Anima 图片代理白名单", () => {
  it("放行 donmai.us 的 https 图片域", () => {
    expect(isAllowedAnimaImageUrl("https://cdn.donmai.us/sample/a.jpg")).toBe(true);
    expect(isAllowedAnimaImageUrl("https://danbooru.donmai.us/data/a.jpg")).toBe(true);
    expect(isAllowedAnimaImageUrl("https://media.donmai.us/a.webp")).toBe(true);
  });

  it("拒绝 http、外域、伪造后缀与本地地址", () => {
    expect(isAllowedAnimaImageUrl("http://cdn.donmai.us/a.jpg")).toBe(false);
    expect(isAllowedAnimaImageUrl("https://evil.example/a.jpg")).toBe(false);
    expect(isAllowedAnimaImageUrl("https://cdn.donmai.us.evil.example/a.jpg")).toBe(false);
    expect(isAllowedAnimaImageUrl("https://127.0.0.1/a.jpg")).toBe(false);
    expect(isAllowedAnimaImageUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedAnimaImageUrl("")).toBe(false);
  });
});
