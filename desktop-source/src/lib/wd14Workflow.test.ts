import { describe, expect, it } from "vitest";
import { buildWd14Workflow } from "./wd14Workflow";

const baseParams = {
  imageName: "photo.png",
  model: "wd-v1-4-moat-tagger-v2",
  threshold: 0.35,
  characterThreshold: 0.85,
  replaceUnderscore: true,
  trailingComma: true,
  excludeTags: "blur, lowres",
  device: "GPU",
};

describe("buildWd14Workflow", () => {
  it("assembly nodes and links match the desktop WD14 workflow", () => {
    const prompt = buildWd14Workflow(baseParams);
    expect(prompt["1"].class_type).toBe("LoadImage");
    expect(prompt["1"].inputs.image).toBe("photo.png");
    expect(prompt["2"].class_type).toBe("WD14Tagger|pysssss");
    expect(prompt["2"].inputs).toMatchObject({
      image: ["1", 0],
      model: "wd-v1-4-moat-tagger-v2",
      threshold: 0.35,
      character_threshold: 0.85,
      replace_underscore: true,
      trailing_comma: true,
      exclude_tags: "blur, lowres",
      device: "GPU",
    });
    expect(prompt["3"].class_type).toBe("PreviewImage");
    expect(prompt["4"].class_type).toBe("> Save Text");
    expect(prompt["4"].inputs.text).toEqual(["2", 0]);
  });

  it("omits device key when not provided", () => {
    const prompt = buildWd14Workflow({ ...baseParams, imageName: "x.png", device: "" });
    expect("device" in (prompt["2"].inputs as Record<string, unknown>)).toBe(false);
  });
});