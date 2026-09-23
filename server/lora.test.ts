import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { isAllowedSafetensorsPath } from "./lora";

/**
 * 路径白名单契约（09-22 任意文件读取漏洞修复项的正式防线）。
 */
const ROOTS_ENV = "XYZ_LORA_ALLOWED_ROOTS";
const savedEnv = process.env[ROOTS_ENV];

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ROOTS_ENV];
  else process.env[ROOTS_ENV] = savedEnv;
});

describe("isAllowedSafetensorsPath", () => {
  it("未配置白名单根目录时：只校验扩展名与空字节", () => {
    delete process.env[ROOTS_ENV];
    expect(isAllowedSafetensorsPath("D:/models/loras/some.safetensors")).toBe(true);
    expect(isAllowedSafetensorsPath("D:/models/loras/some.SAFETENSORS")).toBe(true);
    expect(isAllowedSafetensorsPath("D:/models/loras/some.png")).toBe(false);
    expect(isAllowedSafetensorsPath("D:/models/loras/some.safetensors.exe")).toBe(false);
    expect(isAllowedSafetensorsPath("")).toBe(false);
    expect(isAllowedSafetensorsPath("D:/a\0.safetensors")).toBe(false);
  });

  it("配置白名单根目录后：路径必须落在根内", () => {
    const root = path.resolve("D:/models");
    process.env[ROOTS_ENV] = root;
    expect(isAllowedSafetensorsPath(path.join(root, "loras", "a.safetensors"))).toBe(true);
    expect(isAllowedSafetensorsPath(path.join(root, "a.safetensors"))).toBe(true);
    expect(isAllowedSafetensorsPath(path.resolve("E:/elsewhere/a.safetensors"))).toBe(false);
  });

  it("支持多个根目录（Windows 分号分隔）", () => {
    process.env[ROOTS_ENV] = `${path.resolve("D:/models")};${path.resolve("E:/ckpt")}`;
    expect(isAllowedSafetensorsPath(path.resolve("E:/ckpt/x.safetensors"))).toBe(true);
    expect(isAllowedSafetensorsPath(path.resolve("F:/elsewhere/x.safetensors"))).toBe(false);
  });

  it("前缀相似的目录名不会被误判为根内（路径段级校验）", () => {
    const root = path.resolve("D:/models");
    process.env[ROOTS_ENV] = root;
    const sneaky = `${root}-evil/a.safetensors`;
    expect(isAllowedSafetensorsPath(sneaky)).toBe(false);
  });
});
