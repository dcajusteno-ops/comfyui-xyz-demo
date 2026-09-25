import { describe, expect, it } from "vitest";
import { pickLanIp } from "./lanAddress";

describe("pickLanIp", () => {
  it("prefers private ranges and filters loopback/link-local", () => {
    expect(pickLanIp(["127.0.0.1", "169.254.1.1", "192.168.1.5", "10.0.0.2"])).toBe("192.168.1.5");
  });

  it("falls back to the first non-private v4 when nothing private exists", () => {
    expect(pickLanIp(["127.0.0.1", "8.8.8.8"])).toBe("8.8.8.8");
  });

  it("returns null when only loopback/link-local or nothing", () => {
    expect(pickLanIp(["127.0.0.1", "169.254.2.3"])).toBeNull();
    expect(pickLanIp([])).toBeNull();
  });

  it("ignores malformed entries", () => {
    expect(pickLanIp(["not-an-ip", "999.1.1.1", "192.168.0.10"])).toBe("192.168.0.10");
  });
});