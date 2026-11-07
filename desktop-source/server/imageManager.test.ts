import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  argValue,
  detectOutputDir,
  isImageName,
  isInsideRoot,
  isLocalComfyTarget,
  listDir,
  nearestExistingDir,
  planDelete,
  readImageSettings,
  writeImageSettings,
} from "./imageManager";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "xyz-image-manager-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("argValue", () => {
  it("识别 --flag value 与 --flag=value", () => {
    expect(argValue(["--output-directory", "D:\\out"], "--output-directory")).toBe("D:\\out");
    expect(argValue(["--output-directory=D:\\out"], "--output-directory")).toBe("D:\\out");
  });

  it("值是另一个 flag 时视为缺值", () => {
    expect(argValue(["--output-directory", "--auto-launch"], "--output-directory")).toBe("");
  });
});

describe("detectOutputDir", () => {
  const comfyRoot = path.join(path.sep, "AIimg", "ComfyUI");

  it("环境变量优先级最高", () => {
    const envDir = path.join(path.sep, "custom", "out");
    expect(detectOutputDir([path.join(comfyRoot, "main.py")], envDir)).toEqual({
      outputDir: path.resolve(envDir),
      outputDirSource: "env",
    });
  });

  it("--output-directory 优先于 main.py 同级 output", () => {
    const argv = [path.join(comfyRoot, "main.py"), "--output-directory", path.join(path.sep, "out2")];
    const result = detectOutputDir(argv, "");
    expect(result.outputDirSource).toBe("argv-output");
    expect(result.outputDir).toBe(path.resolve(path.join(path.sep, "out2")));
  });

  it("--base-directory 解析成 <base>/output", () => {
    const base = path.join(path.sep, "base-dir");
    const argv = [path.join(comfyRoot, "main.py"), `--base-directory=${base}`];
    expect(detectOutputDir(argv, "")).toEqual({
      outputDir: path.join(path.resolve(base), "output"),
      outputDirSource: "argv-base",
    });
  });

  it("只有绝对 main.py 时才推导 <dir>/output", () => {
    const argv = [path.join(comfyRoot, "main.py")];
    expect(detectOutputDir(argv, "")).toEqual({
      outputDir: path.join(path.resolve(comfyRoot), "output"),
      outputDirSource: "argv-main",
    });
  });

  it("main.py 是相对路径时不瞎猜（防把仓库目录当输出目录）", () => {
    expect(detectOutputDir(["main.py", "--auto-launch"], "")).toEqual({
      outputDir: "",
      outputDirSource: "none",
    });
    expect(detectOutputDir(null, "")).toEqual({ outputDir: "", outputDirSource: "none" });
  });

  it("相对 --output-directory 且不知道启动目录时同样不猜", () => {
    expect(detectOutputDir(["main.py", "--output-directory", "out"], "").outputDirSource).toBe("none");
  });
});

describe("isLocalComfyTarget", () => {
  it("只认回环地址", () => {
    expect(isLocalComfyTarget("http://127.0.0.1:8188")).toBe(true);
    expect(isLocalComfyTarget("http://localhost:8188/")).toBe(true);
    expect(isLocalComfyTarget("http://192.168.1.9:8188")).toBe(false);
    expect(isLocalComfyTarget("not a url")).toBe(false);
  });
});

describe("isImageName", () => {
  it("大小写不敏感，只放行白名单扩展名", () => {
    expect(isImageName("a.PNG")).toBe(true);
    expect(isImageName("a.jpeg")).toBe(true);
    expect(isImageName("a.webp")).toBe(true);
    expect(isImageName("a.txt")).toBe(false);
    expect(isImageName("a.png.txt")).toBe(false);
    expect(isImageName("noext")).toBe(false);
  });
});

describe("isInsideRoot", () => {
  const root = path.join(path.sep, "data", "output");

  it("同路径算在内，子路径算在内", () => {
    expect(isInsideRoot(root, root)).toBe(true);
    expect(isInsideRoot(root, path.join(root, "001", "a.png"))).toBe(true);
  });

  it("按分隔符边界判断，前缀相同的兄弟目录不算在内", () => {
    expect(isInsideRoot(root, `${root}2${path.sep}a.png`)).toBe(false);
    expect(isInsideRoot(root, path.join(path.sep, "data", "other", "a.png"))).toBe(false);
    expect(isInsideRoot(root, path.dirname(root))).toBe(false);
  });

  it("根目录为空时一律 false", () => {
    expect(isInsideRoot("", path.join(root, "a.png"))).toBe(false);
  });
});

describe("listDir", () => {
  it("只收图片与目录，其他文件被过滤", async () => {
    const dir = await makeTempDir();
    await mkdir(path.join(dir, "001"));
    await writeFile(path.join(dir, "a.png"), "x");
    await writeFile(path.join(dir, "b.JPG"), "x");
    await writeFile(path.join(dir, "c.txt"), "x");
    await writeFile(path.join(dir, "d.json"), "{}");

    const listing = await listDir(dir);
    expect(listing.folders).toEqual(["001"]);
    expect(listing.images.map((item) => item.name)).toEqual(["a.png", "b.JPG"]);
    expect(listing.images[0].size).toBe(1);
    expect(listing.total).toBe(2);
    expect(listing.truncated).toBe(false);
  });

  it("目录不存在时抛错（由调用方转成 nearest）", async () => {
    await expect(listDir(path.join(os.tmpdir(), "xyz-not-exist-xyz"))).rejects.toBeTruthy();
  });
});

describe("nearestExistingDir", () => {
  it("不存在时向上找最近一个存在目录", async () => {
    const dir = await makeTempDir();
    const missing = path.join(dir, "a", "b", "c");
    expect(await nearestExistingDir(missing)).toBe(path.resolve(dir));
  });
});

describe("image settings", () => {
  it("缺省 trashEnabled = true，局部更新互不覆盖", async () => {
    const repoRoot = await makeTempDir();
    expect(await readImageSettings(repoRoot)).toEqual({ rootDir: "", trashEnabled: true });

    await writeImageSettings(repoRoot, { rootDir: "F:\\AIimg\\ComfyUI\\output" });
    await writeImageSettings(repoRoot, { trashEnabled: false });

    expect(await readImageSettings(repoRoot)).toEqual({
      rootDir: "F:\\AIimg\\ComfyUI\\output",
      trashEnabled: false,
    });
  });
});

describe("planDelete", () => {
  it("拒绝相对路径 / 非图片 / 目录 / 根外 / 重复", async () => {
    const root = await makeTempDir();
    // 目录也用图片扩展名，才能走到 isFile() 这条校验
    await mkdir(path.join(root, "sub.png"));
    await writeFile(path.join(root, "a.png"), "x");
    await writeFile(path.join(root, "note.txt"), "x");
    const outside = await makeTempDir();
    await writeFile(path.join(outside, "b.png"), "x");

    const plan = await planDelete(
      [
        path.join(root, "a.png"),
        path.join(root, "a.png"),
        path.join(root, "note.txt"),
        path.join(root, "sub.png"),
        path.join(outside, "b.png"),
        "relative.png",
        path.join(root, "missing.png"),
      ],
      root,
    );

    expect(plan.accepted).toEqual([path.join(root, "a.png")]);
    const reasons = plan.failed.map((item) => item.error);
    expect(reasons).toContain("重复路径");
    expect(reasons).toContain("不是支持的图片格式");
    expect(reasons).toContain("只允许删除常规文件");
    expect(reasons).toContain("不在默认根目录内");
    expect(reasons).toContain("必须是绝对路径");
    expect(reasons).toContain("文件不存在");
  });

  it("非数组直接失败", async () => {
    const root = await makeTempDir();
    const plan = await planDelete("nope", root);
    expect(plan.accepted).toEqual([]);
    expect(plan.failed[0].error).toBe("paths 必须是数组");
  });
});
