import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PromptTagBlocks } from "./PromptTagBlocks";

const VALUE = "masterpiece, (best quality:1.2), 1girl";

describe("PromptTagBlocks", () => {
  it("空值与纯空白渲染 null", () => {
    const { container } = render(<PromptTagBlocks value="" onChange={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    const blank = render(<PromptTagBlocks value="   " onChange={vi.fn()} />);
    expect(blank.container.firstChild).toBeNull();
  });

  it("渲染提示词胶囊：裸词与带权词（权重保留两位）", () => {
    render(<PromptTagBlocks value={VALUE} onChange={vi.fn()} />);
    expect(screen.getByText("masterpiece")).toBeInTheDocument();
    expect(screen.getByText("best quality")).toBeInTheDocument();
    expect(screen.getByText("1girl")).toBeInTheDocument();
    expect(screen.getByText("1.20")).toBeInTheDocument();
    expect(screen.queryByText("1.00")).not.toBeInTheDocument();
  });

  it("点按 + 权重增加 0.1 并回调 onChange", () => {
    const onChange = vi.fn();
    render(<PromptTagBlocks value={VALUE} onChange={onChange} />);
    const capsule = screen.getByText("best quality").parentElement as HTMLElement;
    fireEvent.click(within(capsule).getByRole("button", { name: "+" }));
    expect(onChange).toHaveBeenCalledWith("masterpiece, (best quality:1.3), 1girl");
  });

  it("点按 - 权重回落到 1.0 时去权重包装为裸词", () => {
    const onChange = vi.fn();
    render(<PromptTagBlocks value="masterpiece, (best quality:1.1), 1girl" onChange={onChange} />);
    const capsule = screen.getByText("best quality").parentElement as HTMLElement;
    fireEvent.click(within(capsule).getByRole("button", { name: "-" }));
    expect(onChange).toHaveBeenCalledWith("masterpiece, best quality, 1girl");
  });

  it("同一胶囊内 + / - 按钮独立于其他胶囊", () => {
    const onChange = vi.fn();
    render(<PromptTagBlocks value={VALUE} onChange={onChange} />);
    const masterCapsule = screen.getByText("masterpiece").parentElement as HTMLElement;
    fireEvent.click(within(masterCapsule).getByRole("button", { name: "+" }));
    // 裸词 +0.1 → 包装为 (masterpiece:1.1)，不影响其他胶囊
    expect(onChange).toHaveBeenCalledWith("(masterpiece:1.1), (best quality:1.2), 1girl");
  });
});
