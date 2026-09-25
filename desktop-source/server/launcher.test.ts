import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLaunchCommand, isWebUrl, splitLaunchArgs } from "./launcher";

/**
 * 外部工具启动器（复刻 comfyui-demo-main 的 app_feature_launcher.go）：
 * ext 分派语义与 Go 侧 internal/launcher 的 resolveLaunchCommand 逐条对齐，
 * 两侧测试用例成对存在，防止单边改动造成 dev 与 exe 行为分叉。
 */
describe("splitLaunchArgs", () => {
  it("按任意空白切分并丢弃空段（对齐 strings.Fields）", () => {
    expect(splitLaunchArgs("--listen 0.0.0.0")).toEqual(["--listen", "0.0.0.0"]);
    expect(splitLaunchArgs("  --a   --b \t --c \n")).toEqual(["--a", "--b", "--c"]);
    expect(splitLaunchArgs("")).toEqual([]);
    expect(splitLaunchArgs("   ")).toEqual([]);
  });
});

describe("buildLaunchCommand", () => {
  it(".exe 直接以目标路径启动，工作目录为所在目录", () => {
    const cmd = buildLaunchCommand("D:\\tools\\merger.exe", "--listen 0.0.0.0");
    expect(cmd).toEqual({
      file: "D:\\tools\\merger.exe",
      args: ["--listen", "0.0.0.0"],
      cwd: "D:\\tools",
    });
  });

  it(".exe 无参数时 args 为空数组", () => {
    const cmd = buildLaunchCommand("D:\\tools\\viewer.exe", "");
    expect(cmd.file).toBe("D:\\tools\\viewer.exe");
    expect(cmd.args).toEqual([]);
    expect(cmd.cwd).toBe("D:\\tools");
  });

  it.each([".bat", ".cmd", ".html", ".htm", ".url"])("%s 走 cmd /c start（大小写不敏感）", (ext) => {
    const cmd = buildLaunchCommand(`D:\\tools\\script${ext.toUpperCase()}`, "--flag");
    expect(cmd.file).toBe("cmd.exe");
    // 与原实现一致：start 的空标题占位在前，目标路径在后
    expect(cmd.args).toEqual(["/c", "start", "", `D:\\tools\\script${ext.toUpperCase()}`, "--flag"]);
    expect(cmd.cwd).toBe("D:\\tools");
  });

  it("未知扩展名（.txt 等）按可执行文件直接启动（与原实现一致，启动失败由 spawn 报错）", () => {
    const cmd = buildLaunchCommand("D:\\notes\\readme.txt", "");
    expect(cmd.file).toBe("D:\\notes\\readme.txt");
    expect(cmd.cwd).toBe("D:\\notes");
  });

  it("http(s) 网址走 cmd /c start，优先于扩展名分派（URL 路径含 .html 也不误判），工作目录为进程工作目录", () => {
    const cmd = buildLaunchCommand("https://example.com/preview.html", "--port 3000");
    expect(cmd.file).toBe("cmd.exe");
    expect(cmd.args).toEqual(["/c", "start", "", "https://example.com/preview.html", "--port", "3000"]);
    expect(cmd.cwd).toBe(path.resolve(process.cwd()));

    expect(buildLaunchCommand("HTTP://localhost:5199", "").args).toEqual(["/c", "start", "", "HTTP://localhost:5199"]);
    expect(buildLaunchCommand("http://localhost:5199", "").file).toBe("cmd.exe");
  });
});

describe("isWebUrl", () => {
  it("识别 http/https 网址（大小写不敏感），本地路径与其它协议不误判", () => {
    expect(isWebUrl("http://localhost:5199")).toBe(true);
    expect(isWebUrl("HTTPS://Example.com/page")).toBe(true);
    expect(isWebUrl("D:\\tools\\app.exe")).toBe(false);
    expect(isWebUrl("ftp://example.com")).toBe(false);
    expect(isWebUrl("httpx://weird")).toBe(false);
    expect(isWebUrl("")).toBe(false);
  });
});
