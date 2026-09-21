import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("测试爆炸: 旧配置不兼容");
  return <div>正常内容</div>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // React 渲染抛错时必然打 console.error，mock 掉避免测试输出噪音
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.clear();
    localStorage.setItem("comfyui_default_params", "{}");
    localStorage.setItem("comfyui_anima_params", "{}");
    localStorage.setItem("xyz_theme", "dark");
    localStorage.setItem("unrelated_key", "keep me");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("子组件正常时直接渲染，不显示兜底", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("正常内容")).toBeInTheDocument();
    expect(screen.queryByText("页面渲染出错")).not.toBeInTheDocument();
  });

  it("子组件抛错时显示兜底界面与错误摘要", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("页面渲染出错")).toBeInTheDocument();
    // 错误摘要与折叠的技术详情都会包含该文本
    expect(screen.getAllByText(/测试爆炸/).length).toBeGreaterThan(0);
    expect(screen.queryByText("正常内容")).not.toBeInTheDocument();
  });

  it("重置本地配置：清除 comfyui_* 与 xyz_* 键，保留无关键", () => {
    vi.stubGlobal("location", { ...window.location, reload: vi.fn() });
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByText("重置本地配置并刷新"));
    expect(localStorage.getItem("comfyui_default_params")).toBeNull();
    expect(localStorage.getItem("comfyui_anima_params")).toBeNull();
    expect(localStorage.getItem("xyz_theme")).toBeNull();
    expect(localStorage.getItem("unrelated_key")).toBe("keep me");
  });
});
