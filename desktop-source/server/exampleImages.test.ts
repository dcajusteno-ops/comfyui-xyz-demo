import { describe, expect, it } from "vitest";
import { isAllowedMediaUrl, isPrivateIp } from "./exampleImages";

/**
 * SSRF 防护契约（09-22 体检修复项的正式防线）：
 * metadata/civitai payload 可携带任意 URL，只有公网 http(s) 目标允许下载。
 */
describe("isPrivateIp", () => {
  it.each([
    ["127.0.0.1", true],
    ["127.9.9.9", true],
    ["10.1.2.3", true],
    ["0.0.0.0", true],
    ["0.1.2.3", true],
    ["169.254.1.1", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["192.168.1.1", true],
    ["100.64.0.1", true],
    ["100.127.255.255", true],
    ["::1", true],
    ["::", true],
    ["fe80::1", true],
    ["fc00::1", true],
    ["fd12:3456::1", true],
    ["::ffff:127.0.0.1", true],
    ["::ffff:192.168.0.9", true],
    // 非法 IPv4 一律按私有处理（拒绝而非放行）
    ["999.1.1.1", true],
    ["1.2.3", true],
    ["1.2.3.4.5", true],
  ])("%s → %s", (ip, expected) => {
    expect(isPrivateIp(ip)).toBe(expected);
  });

  it.each([
    ["8.8.8.8", false],
    ["172.32.0.1", false],
    ["100.63.255.255", false],
    ["100.128.0.0", false],
    ["2606:4700::1111", false],
  ])("公网地址 %s 不拦截", (ip, expected) => {
    expect(isPrivateIp(ip)).toBe(expected);
  });
});

describe("isAllowedMediaUrl", () => {
  it("允许公网 http(s) URL", () => {
    expect(isAllowedMediaUrl("https://civitai.com/images/x.png")).toBe(true);
    expect(isAllowedMediaUrl("http://cdn.example.com/a.jpg")).toBe(true);
    expect(isAllowedMediaUrl("https://172.32.0.1/a.png")).toBe(true);
  });

  it.each([
    // 私网 / 回环
    "http://127.0.0.1/a.png",
    "http://localhost/a.png",
    "http://foo.localhost/a.png",
    "http://host.internal/a.png",
    "http://server.local/a.png",
    "http://169.254.169.254/latest/meta-data",
    "http://192.168.1.10:8188/api/view",
    "http://[::1]/a.png",
    // 非http(s)协议
    "file:///etc/passwd",
    "ftp://cdn.example.com/a.png",
    "data:image/png;base64,AAAA",
    // 形式不是 URL
    "not a url",
    "",
  ])("拒绝 %s", (value) => {
    expect(isAllowedMediaUrl(value)).toBe(false);
  });
});
