import { describe, expect, it } from "vitest";

import {
  datasetRootToDir,
  formatBytes,
  isInside,
  joinPath,
  normalizeDir,
  normalizeImageManagerState,
  parentOf,
  resolveDatasetDir,
  sortImages,
  splitBreadcrumb,
} from "./imageManager";

describe("normalizeDir", () => {
  it("统一分隔符、去尾反斜杠、盘符大写", () => {
    expect(normalizeDir("F:/AIimg/ComfyUI/output/")).toBe("F:\\AIimg\\ComfyUI\\output");
    expect(normalizeDir("f:\\a\\b\\\\")).toBe("F:\\a\\b");
    expect(normalizeDir("  F:\\a  ")).toBe("F:\\a");
  });

  it("盘根保持 F:\\ 形态", () => {
    expect(normalizeDir("f:\\")).toBe("F:\\");
    expect(parentOf("F:\\") === null).toBe(true);
  });

  it("空值返回空串", () => {
    expect(normalizeDir("")).toBe("");
    expect(normalizeDir("   ")).toBe("");
  });
});

describe("joinPath", () => {
  it("拼接时自动补反斜杠", () => {
    expect(joinPath("F:\\out", "Datasets/dataset/X")).toBe("F:\\out\\Datasets\\dataset\\X");
    expect(joinPath("F:\\out\\", "001")).toBe("F:\\out\\001");
    expect(joinPath("F:\\", "001")).toBe("F:\\001");
  });

  it("空子路径返回基路径，空基路径返回子路径", () => {
    expect(joinPath("F:\\out", "")).toBe("F:\\out");
    expect(joinPath("", "Datasets\\x")).toBe("Datasets\\x");
  });

  it("中文与空格原样保留", () => {
    expect(joinPath("F:\\输出 目录", "角色 A")).toBe("F:\\输出 目录\\角色 A");
  });
});

describe("parentOf", () => {
  it("逐级向上，盘根返回 null", () => {
    expect(parentOf("F:\\a\\b")).toBe("F:\\a");
    expect(parentOf("F:\\a")).toBe("F:\\");
    expect(parentOf("F:\\")).toBeNull();
    expect(parentOf("")).toBeNull();
  });
});

describe("isInside", () => {
  it("同路径与子路径算在内", () => {
    expect(isInside("F:\\out", "F:\\out")).toBe(true);
    expect(isInside("F:\\out", "F:\\OUT\\001\\a.png")).toBe(true);
  });

  it("同前缀兄弟目录不算在内", () => {
    expect(isInside("F:\\out", "F:\\output2\\a.png")).toBe(false);
    expect(isInside("F:\\out", "F:\\other\\a.png")).toBe(false);
    expect(isInside("", "F:\\out\\a.png")).toBe(false);
  });
});

describe("splitBreadcrumb", () => {
  it("从根目录逐段展开", () => {
    const crumbs = splitBreadcrumb("F:\\AIimg\\ComfyUI\\output", "F:\\AIimg\\ComfyUI\\output\\Datasets\\dataset\\X");
    expect(crumbs.map((item) => item.name)).toEqual(["output", "Datasets", "dataset", "X"]);
    expect(crumbs.at(-1)?.path).toBe("F:\\AIimg\\ComfyUI\\output\\Datasets\\dataset\\X");
  });

  it("当前目录不在根内时只给根", () => {
    expect(splitBreadcrumb("F:\\out", "C:\\other")).toEqual([{ name: "out", path: "F:\\out" }]);
  });

  it("盘根作为根目录时也能展开", () => {
    const crumbs = splitBreadcrumb("F:\\", "F:\\a\\b");
    expect(crumbs.map((item) => item.name)).toEqual(["F:\\", "a", "b"]);
    expect(crumbs[1].path).toBe("F:\\a");
  });
});

describe("sortImages", () => {
  const images = [
    { name: "010_00001_.png", size: 3, mtime: 30 },
    { name: "002_00001_.png", size: 1, mtime: 10 },
    { name: "001_00001_.png", size: 2, mtime: 20 },
  ];

  it("名称自然序（001/002/010 而不是 1/10/2）", () => {
    expect(sortImages(images, "name", "asc").map((item) => item.name)).toEqual([
      "001_00001_.png",
      "002_00001_.png",
      "010_00001_.png",
    ]);
    expect(sortImages(images, "name", "desc")[0].name).toBe("010_00001_.png");
  });

  it("按修改时间排序", () => {
    expect(sortImages(images, "mtime", "desc").map((item) => item.mtime)).toEqual([30, 20, 10]);
  });

  it("不改原数组", () => {
    const before = images.map((item) => item.name).join(",");
    sortImages(images, "name", "desc");
    expect(images.map((item) => item.name).join(",")).toBe(before);
  });
});

describe("formatBytes", () => {
  it("按量级格式化", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("datasetRootToDir", () => {
  it("文件名前缀的最后一段是文件名，不是目录——整串就是落盘目录", () => {
    expect(datasetRootToDir("Datasets/dataset/Baixiuxiu_anima/")).toBe("Datasets\\dataset\\Baixiuxiu_anima");
    expect(resolveDatasetDir("F:\\AIimg\\ComfyUI\\output", "Datasets/dataset/X/")).toBe(
      "F:\\AIimg\\ComfyUI\\output\\Datasets\\dataset\\X",
    );
  });

  it("abs 路径原样返回，空前缀回落到输出目录", () => {
    expect(resolveDatasetDir("F:\\out", "F:\\elsewhere\\imgs")).toBe("F:\\elsewhere\\imgs");
    expect(resolveDatasetDir("F:\\out", "")).toBe("F:\\out");
  });
});

describe("normalizeImageManagerState", () => {
  it("脏数据回落默认值", () => {
    const next = normalizeImageManagerState(
      { currentDir: "F:\\out\\", sortKey: "name", sortDir: "asc" },
      { currentDir: "F:\\out\\", sortKey: "oops", sortDir: "what" },
    );
    expect(next).toEqual({ currentDir: "F:\\out", sortKey: "name", sortDir: "asc" });
  });

  it("保留合法排序", () => {
    const next = normalizeImageManagerState(
      { currentDir: "", sortKey: "name", sortDir: "asc" },
      { sortKey: "mtime", sortDir: "desc" },
    );
    expect(next.sortKey).toBe("mtime");
    expect(next.sortDir).toBe("desc");
  });
});
