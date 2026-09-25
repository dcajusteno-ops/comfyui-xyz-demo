import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoraChips } from "./LoraChips";
import type { LoraManagerSettings, LoraSelection } from "../../../types";

const settings: LoraManagerSettings = { blur_mature_content: true, mature_blur_level: "R" };

const firstLora: LoraSelection = {
  name: "cunnyfunk",
  displayName: "CunnyFunky Style",
  strength: 0.8,
  clipStrength: 0.8,
  active: true,
  sha256: "abc123",
};

const secondLora: LoraSelection = {
  name: "ashima",
  strength: -0.5,
  clipStrength: -0.5,
  active: false,
};

function renderChips(loras: LoraSelection[] = [firstLora, secondLora]) {
  const onChange = vi.fn();
  render(<LoraChips loras={loras} onChange={onChange} apiBase="/comfy" settings={settings} />);
  return { onChange };
}

describe("LoraChips", () => {
  it("空列表渲染空态", () => {
    render(<LoraChips loras={[]} onChange={vi.fn()} apiBase="/comfy" settings={settings} />);
    expect(screen.getByText("未选择 LoRA")).toBeInTheDocument();
  });

  it("渲染卡片名称与禁用态", () => {
    renderChips();
    expect(screen.getByText("CunnyFunky Style")).toBeInTheDocument();
    expect(screen.getByText("ashima").closest(".lora-selection-card")).toHaveClass("disabled");
    expect(screen.getByText("CunnyFunky Style").closest(".lora-selection-card")).not.toHaveClass("disabled");
  });

  it("勾选开关更新 active 并回调 onChange", () => {
    const { onChange } = renderChips();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const [nextLoras] = onChange.mock.calls[0];
    expect(nextLoras[0]).toMatchObject({ name: "cunnyfunk", active: false });
    expect(nextLoras[1]).toBe(secondLora);
  });

  it("移除按钮删除对应卡片并回调 onChange", () => {
    const { onChange } = renderChips();
    fireEvent.click(screen.getAllByTitle("移除")[0]);
    const [nextLoras] = onChange.mock.calls[0];
    expect(nextLoras).toEqual([secondLora]);
  });

  it("滑杆调整同步 strength 与 clipStrength", () => {
    const { onChange } = renderChips();
    fireEvent.change(screen.getAllByRole("slider")[0], { target: { value: "1.5" } });
    const [nextLoras] = onChange.mock.calls[0];
    expect(nextLoras[0]).toMatchObject({ name: "cunnyfunk", strength: 1.5, clipStrength: 1.5 });
    expect(nextLoras[1]).toBe(secondLora);
  });

  it("数字输入框调整同步 strength 与 clipStrength", () => {
    const { onChange } = renderChips();
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "-1" } });
    const [nextLoras] = onChange.mock.calls[0];
    expect(nextLoras[0]).toMatchObject({ name: "cunnyfunk", strength: -1, clipStrength: -1 });
  });
});
