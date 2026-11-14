import { describe, expect, it } from "vitest";
import type { LoraExampleMedia, LoraItem } from "../types";
import { isVideoPath, pickCardPreviewMedia } from "./lora-media";

const item: LoraItem = {
  model_name: "ashima",
  file_name: "ashima.safetensors",
  folder: "SDXL",
  file_path: "D:/loras/ashima.safetensors",
};

function localFile(name: string, isVideo: boolean): LoraExampleMedia {
  return {
    name,
    path: `/xyz/example-images/file/hash/${name}`,
    extension: name.slice(name.lastIndexOf(".")),
    is_video: isVideo,
    type: isVideo ? "video" : "image",
    source: "local",
  };
}

describe("isVideoPath", () => {
  it("识别 LoRA Manager 的预览地址（.mp4 后面是 &v=）", () => {
    expect(isVideoPath("/api/lm/previews?path=F%3A%2Fmodels%2Fcunny.mp4&v=1782470102396469200")).toBe(true);
    expect(isVideoPath("/xyz/example-images/file/hash/image_0.mp4?v=1")).toBe(true);
    expect(isVideoPath("https://example.com/a.webm")).toBe(true);
  });

  it("图片地址不误判", () => {
    expect(isVideoPath("/api/lm/previews?path=F%3A%2Fmodels%2Fcunny.jpeg&v=1782")).toBe(false);
    expect(isVideoPath("/xyz/example-images/file/hash/image_1.png?v=1")).toBe(false);
  });
});

describe("pickCardPreviewMedia", () => {
  it("image_0 是视频时，卡片封面改用后面的静帧图片", () => {
    const media = pickCardPreviewMedia(item, [
      localFile("image_0.mp4", true),
      localFile("image_1.webp", false),
      localFile("image_2.webp", false),
    ]);
    expect(media.name).toBe("image_1.webp");
    expect(media.type).toBe("image");
  });

  it("image_0 是图片时继续用 image_0（不受后面的视频影响）", () => {
    const media = pickCardPreviewMedia(item, [
      localFile("image_0.webp", false),
      localFile("image_1.mp4", true),
    ]);
    expect(media.name).toBe("image_0.webp");
  });

  it("只有视频时才退回视频封面", () => {
    const media = pickCardPreviewMedia(item, [localFile("image_0.mp4", true)]);
    expect(media.name).toBe("image_0.mp4");
    expect(media.type).toBe("video");
  });

  it("没有本地示例时回退到模型 preview_url", () => {
    const media = pickCardPreviewMedia(
      { ...item, preview_url: "/api/lm/previews?path=F%3A%2Fmodels%2Fcunny.mp4&v=1" },
      [],
    );
    expect(media.url).toBe("/api/lm/previews?path=F%3A%2Fmodels%2Fcunny.mp4&v=1");
    expect(media.type).toBe("video");
  });
});
