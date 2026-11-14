import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WardrobeResultPanel } from "./WardrobeResultPanel";
import { defaultWardrobeGeneration } from "../../../lib/wardrobe/generation";
import type { WardrobeGenerationState } from "../../../lib/wardrobe/types";

type Props = ComponentProps<typeof WardrobeResultPanel>;

function makeGeneration(overrides: Partial<WardrobeGenerationState> = {}): WardrobeGenerationState {
  return { ...defaultWardrobeGeneration(), ...overrides };
}

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    text: "1girl, solo",
    levelNum: 0,
    cap: 45,
    seed: 1,
    tagCount: 2,
    notes: [],
    dropped: [],
    repaired: [],
    qualityPrefix: false,
    onQualityPrefix: vi.fn(),
    onApply: vi.fn(),
    onCopy: vi.fn(),
    onToWorkbench: vi.fn(),
    onOpenAnima: vi.fn(),
    onOpenImageFolder: vi.fn(),
    draft: "1girl, solo",
    onDraftChange: vi.fn(),
    generating: false,
    generatedImages: [],
    onOpenImage: vi.fn(),
    generation: makeGeneration(),
    onOpenLoraManager: vi.fn(),
    onOpenGallery: vi.fn(),
    ...overrides,
  };
}

describe("WardrobeResultPanel 一键生图", () => {
  it("编辑正文时把草稿回传给面板层", () => {
    const onDraftChange = vi.fn();
    render(<WardrobeResultPanel {...makeProps({ onDraftChange })} />);

    fireEvent.change(screen.getByPlaceholderText(/点「抽一次」生成正文/), {
      target: { value: "1girl, solo, smile" },
    });

    expect(onDraftChange).toHaveBeenCalledWith("1girl, solo, smile");
  });

  it("生成中显示占位，完成后展示缩略图组并可打开灯箱", () => {
    const onOpenImage = vi.fn();
    const { rerender } = render(
      <WardrobeResultPanel
        {...makeProps({
          generating: true,
          generatedImages: [{ filename: "old.png", url: "/view/old.png" }],
          onOpenImage,
        })}
      />,
    );
    expect(screen.getByText("正在生成…")).toBeInTheDocument();

    rerender(
      <WardrobeResultPanel
        {...makeProps({
          generatedImages: [
            { filename: "new.png", url: "/view/new.png" },
            { filename: "old.png", url: "/view/old.png" },
          ],
          onOpenImage,
        })}
      />,
    );

    expect(screen.getByAltText("最近一次生成")).toHaveAttribute("src", "/view/new.png");
    fireEvent.click(screen.getByAltText("最近一次生成"));

    expect(onOpenImage).toHaveBeenCalledWith("/view/new.png", undefined);
    expect(screen.queryByText("正在生成…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "结果 2" })).toBeInTheDocument();
  });

  it("LoRA 摘要只展示数量，编辑入口走独立弹窗", () => {
    const onOpenLoraManager = vi.fn();
    const onOpenGallery = vi.fn();
    const generation = makeGeneration({
      params: {
        ...defaultWardrobeGeneration().params,
        loras: [
          {
            name: "style-a",
            displayName: "Style LoRA",
            strength: 0.8,
            clipStrength: 0.8,
            active: true,
            triggerWords: ["style trigger"],
          },
          {
            name: "style-b",
            displayName: "Off LoRA",
            strength: 1,
            clipStrength: 1,
            active: false,
            triggerWords: [],
          },
        ],
      },
    });
    render(
      <WardrobeResultPanel
        {...makeProps({
          generation,
          onOpenLoraManager,
          onOpenGallery,
          generatedImages: [
            { filename: "a.png", url: "/view/a.png" },
            { filename: "b.png", url: "/view/b.png" },
          ],
        })}
      />,
    );

    const loraChip = screen.getByRole("button", { name: "LoRA 1/2" });
    expect(loraChip).toBeInTheDocument();

    fireEvent.click(loraChip);
    expect(onOpenLoraManager).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "结果 2" }));
    expect(onOpenGallery).toHaveBeenCalledTimes(1);
  });

  it("图片管理入口打开造型台专属输出目录", () => {
    const onOpenImageFolder = vi.fn();
    render(<WardrobeResultPanel {...makeProps({ onOpenImageFolder })} />);

    fireEvent.click(screen.getByRole("button", { name: "图片管理" }));

    expect(onOpenImageFolder).toHaveBeenCalledTimes(1);
  });
});
