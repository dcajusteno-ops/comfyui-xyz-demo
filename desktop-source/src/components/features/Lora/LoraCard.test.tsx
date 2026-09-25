import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoraCard } from "./LoraCard";
import type { LoraItem, LoraManagerSettings } from "../../../types";

const baseSettings: LoraManagerSettings = { blur_mature_content: true, mature_blur_level: "R" };

const baseItem: LoraItem = {
  model_name: "cunnyfunk",
  file_name: "cunnyfunk.safetensors",
  folder: "SDXL/画师",
  file_path: "D:/loras/SDXL/画师/cunnyfunk.safetensors",
  base_model: "Illustrious",
  sub_type: "LoCon",
  file_size: 76000,
};

function renderCard(overrides: {
  item?: LoraItem;
  words?: string[];
  previewNsfwLevel?: number;
  previewUrl?: string;
  settings?: LoraManagerSettings;
} = {}) {
  const onDetail = vi.fn();
  const onInsert = vi.fn();
  const view = render(
    <LoraCard
      item={overrides.item ?? baseItem}
      words={overrides.words ?? ["masterpiece", "best quality"]}
      previewNsfwLevel={overrides.previewNsfwLevel ?? 0}
      previewUrl={overrides.previewUrl}
      settings={overrides.settings ?? baseSettings}
      apiBase="/comfy"
      onDetail={onDetail}
      onInsert={onInsert}
    />
  );
  return { ...view, onDetail, onInsert };
}

describe("LoraCard", () => {
  it("渲染模型信息：名称 / 子类型缩写 / 基础模型缩写 / 触发词前两个", () => {
    renderCard();
    expect(screen.getByText("cunnyfunk")).toBeInTheDocument();
    expect(screen.getByText("LyCO")).toBeInTheDocument();
    expect(screen.getByText("Illustrious")).toBeInTheDocument();
    expect(screen.getByText("masterpiece / best quality")).toBeInTheDocument();
  });

  it("Update 徽标仅在 update_available 时渲染", () => {
    const { rerender } = renderCard();
    expect(screen.queryByText("Update")).not.toBeInTheDocument();
    rerender(
      <LoraCard
        item={{ ...baseItem, update_available: true }}
        words={["masterpiece"]}
        previewNsfwLevel={0}
        settings={baseSettings}
        apiBase="/comfy"
        onDetail={vi.fn()}
      />
    );
    expect(screen.getByText("Update")).toBeInTheDocument();
  });

  it("NSFW 高于模糊阈值时卡片带 nsfw-content 类并渲染模糊遮罩", () => {
    renderCard({ previewNsfwLevel: 16, previewUrl: "/view.png" });
    expect(screen.getByText("cunnyfunk").closest("article")).toHaveClass("nsfw-content");
    expect(screen.getByText("cunnyfunk").closest("article")).toHaveAttribute("data-nsfw-level", "16");
    expect(screen.getByRole("img")).toHaveClass("blurred");
    expect(screen.getByText("XXX-rated Content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show" })).toBeInTheDocument();
  });

  it("低于阈值或关闭模糊时不模糊", () => {
    const { unmount } = renderCard({ previewNsfwLevel: 2, previewUrl: "/view.png" });
    expect(screen.getByRole("img")).not.toHaveClass("blurred");
    expect(screen.queryByText("XXX-rated Content")).not.toBeInTheDocument();
    unmount();
    renderCard({
      previewNsfwLevel: 16,
      previewUrl: "/view.png",
      settings: { blur_mature_content: false, mature_blur_level: "R" },
    });
    expect(screen.getByRole("img")).not.toHaveClass("blurred");
  });

  it("Show 按钮临时显示限制级内容", () => {
    renderCard({ previewNsfwLevel: 16, previewUrl: "/view.png" });
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByRole("img")).not.toHaveClass("blurred");
    expect(screen.queryByText("XXX-rated Content")).not.toBeInTheDocument();
  });

  it("点击卡片触发 onDetail；点击快捷按钮触发 onInsert 且不冒泡到 onDetail", () => {
    const { onDetail, onInsert } = renderCard({ previewUrl: "/view.png" });
    fireEvent.click(screen.getByText("cunnyfunk"));
    expect(onDetail).toHaveBeenCalledWith(baseItem);
    fireEvent.click(screen.getByTitle("添加到默认"));
    expect(onInsert).toHaveBeenCalledWith(baseItem, "default");
    expect(onDetail).toHaveBeenCalledTimes(1);
  });
});
