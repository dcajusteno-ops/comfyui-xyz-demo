// 自动水印烙入链回归防线：四模板链尾必须消费 wm_mix 输出，且水印盖在手写层之上。
// 「enabled 但缺文件名不插链」守住烘焙失败回退场景（链尾不插节点=工作流与未开启逐节点一致）。
import { describe, expect, it } from "vitest";
import {
  makeAnimaParams,
  makeBaseParams,
  makeHighresParams,
  makeMultiParams,
} from "./paramBuilders";
import { buildDefaultPrompt, buildMultiPrompt, buildHighresPrompt, buildAnimaPrompt } from "./workflowBuilders";

const ANIMA_CAPS = { useEasyHiresFix: true, useImageResizeKJv2: true } as never;

const wmEnabled = {
  enabled: true,
  text: "TEST",
  fontSize: 32,
  color: "#FFFFFF",
  opacity: 60,
  position: "bottom-right" as const,
  margin: 24,
  rotation: 0,
  imageName: "xyz_watermark.png",
  maskName: "xyz_watermark_mask.png",
};

describe("insertWatermarkNode", () => {
  it("默认生图：wm 链存在，SaveImage 指向 wm_mix，且接在手写层之后", () => {
    const base = makeBaseParams();
    const prompt = buildDefaultPrompt({
      ...base,
      drawText: {
        ...base.drawText!,
        handwriting: { enabled: true, imageName: "hw.png", maskName: "hw_mask.png" },
        watermark: { ...wmEnabled },
      },
    });
    expect(prompt["wm_load"]).toBeDefined();
    expect(prompt["wm_mix"]?.class_type).toBe("ImageCompositeMasked");
    expect(prompt["wm_mask"]?.class_type).toBe("ImageToMask");
    // SaveImage 消费 wm_mix 输出
    expect(prompt["999_save"]?.inputs.images).toEqual(["wm_mix", 0]);
    // wm 叠加在手写层之上：wm_mix.destination 指向 hw_mix
    expect(prompt["wm_mix"]?.inputs.destination).toEqual(["hw_mix", 0]);
    // wm 的遮罩走 red 通道
    expect(prompt["wm_mask"]?.inputs.channel).toBe("red");
  });

  it("默认生图：未配置 watermark 时无 wm_* 节点", () => {
    const prompt = buildDefaultPrompt(makeBaseParams());
    expect(Object.keys(prompt).filter((k) => k.startsWith("wm_"))).toHaveLength(0);
  });

  it("默认生图：enabled 但缺文件名时不插链（烘焙失败回退场景）", () => {
    const base = makeBaseParams();
    const prompt = buildDefaultPrompt({
      ...base,
      drawText: { ...base.drawText!, watermark: { ...wmEnabled, imageName: "", maskName: "" } },
    });
    expect(Object.keys(prompt).filter((k) => k.startsWith("wm_"))).toHaveLength(0);
  });

  it("多人/高修/Anima：链尾 SaveImage（或 Preview）消费 wm_mix 输出", () => {
    const multi = makeMultiParams();
    const multiPrompt = buildMultiPrompt({
      ...multi,
      drawText: { ...multi.drawText!, watermark: { ...wmEnabled } },
    });
    expect(multiPrompt["999_save"]?.inputs.images).toEqual(["wm_mix", 0]);

    const highres = makeHighresParams();
    const highresPrompt = buildHighresPrompt({
      ...highres,
      drawText: { ...highres.drawText!, watermark: { ...wmEnabled } },
    });
    const highresSave = Object.values(highresPrompt).find((n) => n.class_type === "SaveImage");
    expect(highresSave?.inputs.images).toEqual(["wm_mix", 0]);

    const anima = makeAnimaParams();
    const animaPrompt = buildAnimaPrompt(
      {
        ...anima,
        drawText: { ...makeBaseParams().drawText!, watermark: { ...wmEnabled } },
      },
      ANIMA_CAPS,
    );
    // anima 有多个中间 SaveImage（detailer 链），链尾按固定键找（与断言惯例一致）
    const animaTail = animaPrompt["999_save"] ?? animaPrompt["998_preview"];
    expect(animaTail?.inputs.images).toEqual(["wm_mix", 0]);
  });
});
