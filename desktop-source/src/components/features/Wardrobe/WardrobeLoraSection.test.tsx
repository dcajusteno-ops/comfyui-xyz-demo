import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WardrobeLoraSection } from "./WardrobeLoraSection";
import { defaultWardrobeGeneration } from "../../../lib/wardrobe/generation";
import type { WardrobeGenerationState } from "../../../lib/wardrobe/types";

const loraSettings = { blur_mature_content: true, mature_blur_level: "R" };

function makeState(): WardrobeGenerationState {
  return {
    ...defaultWardrobeGeneration(),
    manualTriggers: ["manual trigger"],
    params: {
      ...defaultWardrobeGeneration().params,
      loras: [
        {
          name: "styles/style.safetensors",
          displayName: "Style LoRA",
          strength: 0.8,
          clipStrength: 0.8,
          active: true,
          triggerWords: ["style trigger"],
        },
      ],
    },
  };
}

function renderSection(overrides: Partial<Parameters<typeof WardrobeLoraSection>[0]> = {}) {
  const state = makeState();
  const onChange = vi.fn();
  const onOpenLibrary = vi.fn();
  render(
    <WardrobeLoraSection
      state={state}
      onChange={onChange}
      onOpenLibrary={onOpenLibrary}
      onOpenLoraDetail={vi.fn()}
      apiBase="/comfy"
      loraSettings={loraSettings}
      loraExampleFilesByHash={{}}
      {...overrides}
    />,
  );
  return { state, onChange, onOpenLibrary };
}

describe("WardrobeLoraSection", () => {
  it("复用 LoraChips 展示已有 LoRA，并保留触发词编辑", () => {
    renderSection();

    expect(screen.getByText(/启用 1 \/ 1/)).toBeInTheDocument();
    expect(screen.getByText(/触发词当前会追加 2 个/)).toBeInTheDocument();
    expect(screen.getAllByText("Style LoRA").length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("style trigger")).toBeInTheDocument();
    expect(screen.getByDisplayValue("manual trigger")).toBeInTheDocument();
  });

  it("触发词失焦写回造型台状态", () => {
    const { state, onChange } = renderSection();

    fireEvent.blur(screen.getByDisplayValue("style trigger"), {
      target: { value: "style trigger, extra" },
    });

    const updater = onChange.mock.calls[0][0] as (
      prev: WardrobeGenerationState,
    ) => WardrobeGenerationState;
    expect(updater(state).params.loras[0].triggerWords).toEqual(["style trigger", "extra"]);
  });

  it("添加 LoRA 打开全局管理器，移除走 LoraChips 的同一套回调", () => {
    const { state, onChange, onOpenLibrary } = renderSection();

    fireEvent.click(screen.getByRole("button", { name: /添加 LoRA/ }));
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle("移除"));
    const updater = onChange.mock.calls[0][0] as (
      prev: WardrobeGenerationState,
    ) => WardrobeGenerationState;
    expect(updater(state).params.loras).toEqual([]);
  });
});
