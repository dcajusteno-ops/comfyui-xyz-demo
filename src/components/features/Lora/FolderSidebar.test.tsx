import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FolderSidebar } from "./FolderSidebar";
import type { FolderTreeNode } from "../../../types";

const tree: FolderTreeNode[] = [
  {
    name: "SDXL",
    path: "SDXL",
    children: [
      { name: "cs", path: "SDXL/cs", children: [] },
      {
        name: "画师",
        path: "SDXL/画师",
        children: [{ name: "风格", path: "SDXL/画师/风格", children: [] }],
      },
    ],
  },
  { name: "动漫", path: "动漫", children: [] },
];

function renderSidebar(overrides: { selected?: string; onSelect?: (folder: string) => void } = {}) {
  const onSelect = overrides.onSelect ?? vi.fn();
  return render(
    <FolderSidebar
      label="LoRA"
      folders={tree}
      selected={overrides.selected ?? ""}
      total={99}
      onSelect={onSelect}
    />
  );
}

describe("FolderSidebar 折叠交互", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("有子文件夹的节点渲染折叠箭头（展开态），叶子节点无箭头", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "收起 SDXL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起 画师" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收起 cs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收起 动漫" })).not.toBeInTheDocument();
  });

  it("点击箭头仅切换折叠：不触发选择，子树隐藏后可再展开", () => {
    const onSelect = vi.fn();
    renderSidebar({ onSelect });
    fireEvent.click(screen.getByRole("button", { name: "收起 SDXL" }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByText("cs")).not.toBeInTheDocument();
    expect(screen.queryByText("画师")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开 SDXL" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "展开 SDXL" }));
    expect(screen.getByText("cs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起 SDXL" })).toHaveAttribute("aria-expanded", "true");
  });

  it("点击文件夹名仍选中并高亮", () => {
    const onSelect = vi.fn();
    const { rerender } = renderSidebar({ onSelect });
    fireEvent.click(screen.getByText("SDXL"));
    expect(onSelect).toHaveBeenCalledWith("SDXL");
    rerender(
      <FolderSidebar label="LoRA" folders={tree} selected="SDXL" total={99} onSelect={onSelect} />
    );
    expect(screen.getByText("SDXL").closest("button")).toHaveClass("selected");
  });

  it("选中项位于折叠父级内时，祖先自动展开且选中项可见（任务书 3.2.2）", () => {
    const onSelect = vi.fn();
    const { rerender } = renderSidebar({ onSelect });
    fireEvent.click(screen.getByRole("button", { name: "收起 SDXL" }));
    expect(screen.queryByText("cs")).not.toBeInTheDocument();
    // 模拟右侧「全部文件夹」下拉选中深层路径
    rerender(
      <FolderSidebar label="LoRA" folders={tree} selected="SDXL/cs" total={99} onSelect={onSelect} />
    );
    expect(screen.getByText("cs")).toBeInTheDocument();
    expect(screen.getByText("cs").closest("button")).toHaveClass("selected");
    // 更深层折叠状态独立保留：再折叠 SDXL 后 画师 子树整体隐藏
    fireEvent.click(screen.getByRole("button", { name: "收起 画师" }));
    expect(screen.queryByText("风格")).not.toBeInTheDocument();
    expect(screen.getByText("cs")).toBeInTheDocument();
  });

  it("折叠状态持久化到 localStorage（D5），重挂载后保留", () => {
    const onSelect = vi.fn();
    const { unmount } = renderSidebar({ onSelect });
    fireEvent.click(screen.getByRole("button", { name: "收起 SDXL" }));
    expect(JSON.parse(localStorage.getItem("comfyui_lora_sidebar_collapsed") ?? "[]")).toEqual(["SDXL"]);
    unmount();
    renderSidebar({ onSelect });
    expect(screen.queryByText("cs")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开 SDXL" })).toBeInTheDocument();
  });

  it("嵌套折叠按路径独立记录：折叠父级不影响兄弟子树的展开状态", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "收起 画师" }));
    expect(screen.queryByText("风格")).not.toBeInTheDocument();
    expect(screen.getByText("cs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开 画师" }));
    expect(screen.getByText("风格")).toBeInTheDocument();
  });
});
