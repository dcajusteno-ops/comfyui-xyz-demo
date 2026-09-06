import { describe, expect, it } from "vitest";
import {
  applySnapshot,
  exportPresetsJson,
  makePreset,
  selectPresetsFor,
  validateImport,
} from "./generationPresets";
import type { GenerationPreset } from "../types";

const baseSnapshot = {
  checkpoint: "anything-v5.safetensors",
  positivePrompt: "1girl",
  width: 832,
  height: 1216,
};

describe("selectPresetsFor", () => {
  it("只返回目标模板的预设", () => {
    const presets: GenerationPreset[] = [
      makePreset("a", "default", {}),
      makePreset("b", "multi", {}),
      makePreset("c", "default", {}),
    ];
    expect(selectPresetsFor(presets, "default").map((p) => p.name)).toEqual(["a", "c"]);
    expect(selectPresetsFor(presets, "multi").map((p) => p.name)).toEqual(["b"]);
    expect(selectPresetsFor(presets, "highres")).toEqual([]);
  });
});

describe("validateImport", () => {
  it("接受 { presets: [] } 标准格式", () => {
    const payload = { version: 1, presets: [makePreset("x", "default", baseSnapshot)] };
    const result = validateImport(payload);
    expect(result.valid).toHaveLength(1);
    expect(result.skipped).toBe(0);
  });

  it("接受顶层数组", () => {
    const result = validateImport([makePreset("x", "default", baseSnapshot)]);
    expect(result.valid).toHaveLength(1);
  });

  it("跳过 target 非法或缺 snapshot 的条目", () => {
    const result = validateImport([
      makePreset("ok", "default", baseSnapshot),
      { id: "1", name: "bad-target", target: "nope", snapshot: {} },
      { id: "2", name: "no-snapshot", target: "default" },
      { id: "3", name: "", target: "default", snapshot: {} },
    ]);
    expect(result.valid.map((p) => p.name)).toEqual(["ok"]);
    expect(result.skipped).toBe(3);
  });

  it("对非数组/非对象返回 1 条 skipped", () => {
    expect(validateImport("hello").skipped).toBe(1);
    expect(validateImport(42).skipped).toBe(1);
  });
});

describe("exportPresetsJson", () => {
  it("导出后能import圆整", () => {
    const presets = [makePreset("preset-a", "highres", baseSnapshot)];
    const parsed = JSON.parse(exportPresetsJson(presets));
    expect(parsed.version).toBe(1);
    const back = validateImport(parsed);
    expect(back.valid).toHaveLength(1);
    expect(back.valid[0].name).toBe("preset-a");
  });
});

describe("applySnapshot", () => {
  it("正常回填并替换 checkpoint", () => {
    const current = { checkpoint: "old.safetensors", width: 512, height: 512 } as Record<string, unknown>;
    const { next, checkpointRejected } = applySnapshot(current, { checkpoint: "new.safetensors", width: 768 }, ["new.safetensors"]);
    expect(next.checkpoint).toBe("new.safetensors");
    expect(next.width).toBe(768);
    expect(next.height).toBe(512);
    expect(checkpointRejected).toBe(false);
  });

  it("checkpoint 不可用时保留当前值并标记", () => {
    const current = { checkpoint: "keep.safetensors", seed: 1 } as Record<string, unknown>;
    const { next, checkpointRejected } = applySnapshot(current, { checkpoint: "gone.safetensors", seed: 99 }, ["keep.safetensors"]);
    expect(next.checkpoint).toBe("keep.safetensors");
    expect(next.seed).toBe(99);
    expect(checkpointRejected).toBe(true);
  });

  it("snapshot 未携带 checkpoint 时不做校验", () => {
    const current = { checkpoint: "keep.safetensors" } as Record<string, unknown>;
    const { next, checkpointRejected } = applySnapshot(current, { width: 1024 }, []);
    expect(next.checkpoint).toBe("keep.safetensors");
    expect(checkpointRejected).toBe(false);
  });
});