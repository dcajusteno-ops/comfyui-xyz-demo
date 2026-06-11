import { describe, expect, it } from "vitest";
import { findPathPreset, findResolutionPreset, pathPresets, resolutionPresets } from "./presets";

describe("generation presets", () => {
  it("matches known resolution presets and keeps custom values editable", () => {
    expect(resolutionPresets.map((preset) => preset.label)).toContain("1024x1536");
    expect(findResolutionPreset(832, 1216)).toBe("832x1216");
    expect(findResolutionPreset(900, 1200)).toBe("custom");
  });

  it("matches save path presets and supports custom paths", () => {
    expect(pathPresets.map((preset) => preset.value)).toContain("多人/%date:yyyy-MM-dd%/ComfyUI");
    expect(pathPresets.map((preset) => preset.value)).toContain("%date:yyyy-MM-dd%/ComfyUI");
    expect(findPathPreset("XYZ/%date:yyyy-MM-dd%/ComfyUI")).toBe("XYZ/%date:yyyy-MM-dd%/ComfyUI");
    expect(findPathPreset("%date:yyyy-MM-dd%/ComfyUI")).toBe("%date:yyyy-MM-dd%/ComfyUI");
    expect(findPathPreset("my/custom/path")).toBe("custom");
  });
});
