import { describe, expect, it } from "vitest";

import { buildFolderTree, collectAncestorPaths } from "./lora-helper";

describe("collectAncestorPaths", () => {
  it("返回深层路径的全部祖先（/ 连接，不含自身）", () => {
    expect(collectAncestorPaths("SDXL/cs/手部")).toEqual(["SDXL", "SDXL/cs"]);
  });

  it("根级路径无祖先", () => {
    expect(collectAncestorPaths("SDXL")).toEqual([]);
  });

  it("反斜杠分隔符归一化为 / 连接（与 buildFolderTree 节点路径一致）", () => {
    expect(collectAncestorPaths("SDXL\\cs")).toEqual(["SDXL"]);
    expect(collectAncestorPaths("动漫\\OVA\\全集")).toEqual(["动漫", "动漫/OVA"]);
  });

  it("空串返回空数组", () => {
    expect(collectAncestorPaths("")).toEqual([]);
  });
});

describe("buildFolderTree 既有行为守护", () => {
  it("混合分隔符去重建树，根按首次出现排序", () => {
    const tree = buildFolderTree(["SDXL/cs", "SDXL\\手部", "SDXL", "动漫"]);
    expect(tree.map((node) => node.path)).toEqual(["SDXL", "动漫"]);
    expect(tree[0].children.map((child) => child.path)).toEqual(["SDXL/cs", "SDXL/手部"]);
    expect(tree[0].children[0].children).toEqual([]);
  });

  it("深层路径复用同一父节点", () => {
    const tree = buildFolderTree(["A/b/c", "A/b/d"]);
    const branchB = tree[0].children[0];
    expect(branchB.name).toBe("b");
    expect(branchB.children.map((child) => child.name)).toEqual(["c", "d"]);
  });
});
