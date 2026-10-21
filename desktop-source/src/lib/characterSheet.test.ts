import { describe, expect, it } from "vitest";
import type { LoraItem, LoraSelection, SheetParams } from "../types";
import { makeAnimaParams, makeBaseParams, makeHighresParams, makeSheetParams, normalizeSheetParams } from "./paramBuilders";
import {
  buildSheetPrompt,
  composeSheetPrompt,
  SHEET_LORAS,
  normalizeLoraKey,
  resolveSheetLora,
  splitPromptTags,
  toSheetAnimaParams,
  toSheetSdxlParams,
  upsertSheetLora,
} from "./characterSheet";

const ANIMA_LORA = SHEET_LORAS.anima.relativePath;
const SDXL_LORA = SHEET_LORAS.sdxl.relativePath;

function makeSheet(overrides: Partial<SheetParams> = {}): SheetParams {
  return { ...makeSheetParams(makeAnimaParams(), makeBaseParams()), ...overrides };
}

function loraItem(patch: Partial<LoraItem>): LoraItem {
  return {
    model_name: "x",
    file_name: "x.safetensors",
    folder: "",
    file_path: "",
    ...patch,
  } as LoraItem;
}

function promptTexts(prompt: Record<string, { class_type?: string; inputs?: Record<string, unknown> }>) {
  return Object.values(prompt)
    .filter((node) => node.class_type === "CLIPTextEncode")
    .map((node) => String(node.inputs?.text ?? ""));
}

function loraLoaderNode(prompt: Record<string, { class_type?: string; inputs?: Record<string, unknown> }>) {
  return Object.values(prompt).find((node) => node.class_type === "Lora Loader (LoraManager)");
}

describe("三视图提示词拼装", () => {
  it("切分中英逗号与换行，丢弃空段", () => {
    expect(splitPromptTags(" a, b，c\nd ,, ")).toEqual(["a", "b", "c", "d"]);
    expect(splitPromptTags("")).toEqual([]);
  });

  it("按固定顺序拼装：主体 → 触发词 → 视角 → 体型 → 背景 → 角色 → 画风", () => {
    const text = composeSheetPrompt({
      mode: "anima",
      subject: "1girl",
      character: "silver hair, blue eyes",
      style: "masterpiece, best quality",
      includeTrigger: true,
      includeBackground: true,
    });
    expect(text).toBe(
      "1girl, reference sheet, turnaround, multiple views, front view, side view, back view, " +
        "full body, standing, simple background, white background, silver hair, blue eyes, masterpiece, best quality",
    );
  });

  it("关掉触发词只去掉触发词，视角词仍在", () => {
    const text = composeSheetPrompt({
      mode: "sdxl",
      subject: "",
      character: "",
      style: "",
      includeTrigger: false,
      includeBackground: false,
    });
    expect(text).not.toContain("character sheet");
    expect(text).toContain("multiple views");
    expect(text).toContain("front view");
    expect(text).toContain("back view");
    expect(text).not.toContain("simple background");
  });

  it("主体与角色描述为空时不会出现前导逗号或空段", () => {
    const text = composeSheetPrompt({
      mode: "anima",
      subject: "",
      character: "",
      style: "",
      includeTrigger: false,
      includeBackground: false,
    });
    expect(text.startsWith(",")).toBe(false);
    expect(text).not.toMatch(/,\s*,/);
    expect(text.endsWith(",")).toBe(false);
  });

  it("去重大小写不敏感、下划线视同空格，保留首次出现的写法", () => {
    const text = composeSheetPrompt({
      mode: "anima",
      subject: "1girl",
      character: "Reference_Sheet, FRONT VIEW, front view, silver hair",
      style: "",
      includeTrigger: true,
      includeBackground: false,
    });
    expect(text.match(/reference[ _]sheet/gi)).toHaveLength(1);
    expect(text.match(/front view/gi)).toHaveLength(1);
    // 固定段先入列，所以保留下划线版本的是被丢弃的一方
    expect(text).toContain("reference sheet");
    expect(text).not.toContain("Reference_Sheet");
  });

  it("权重语法不参与去重（(masterpiece:1.2) 与裸词共存）", () => {
    const text = composeSheetPrompt({
      mode: "sdxl",
      subject: "",
      character: "(masterpiece:1.2), masterwork",
      style: "masterpiece, best quality",
      includeTrigger: false,
      includeBackground: false,
    });
    expect(text).toContain("(masterpiece:1.2)");
    expect(text).toContain("masterpiece");
  });
});

describe("三视图 LoRA 定位", () => {
  it("完整相对路径命中时返回库内的 folder/file_name", () => {
    const resolved = resolveSheetLora("anima", [
      loraItem({ folder: "AnimaLora/三视图", file_name: "Character Sheet for Anima.safetensors" }),
    ]);
    expect(resolved.matched).toBe(true);
    expect(resolved.source).toBe("list");
    expect(resolved.ref.name).toBe(ANIMA_LORA);
  });

  it("用户搬过目录（仅文件名相同）仍能命中", () => {
    const resolved = resolveSheetLora("sdxl", [
      loraItem({ folder: "其它/收藏", file_name: "TRcharactersheet-10.safetensors" }),
    ]);
    expect(resolved.matched).toBe(true);
    expect(resolved.ref.name).toBe("其它/收藏/TRcharactersheet-10.safetensors");
  });

  it("列表为空时按相对路径兜底", () => {
    const resolved = resolveSheetLora("anima", []);
    expect(resolved.matched).toBe(false);
    expect(resolved.source).toBe("fallback");
    expect(resolved.ref.name).toBe(ANIMA_LORA);
    expect(resolved.ref.displayName).toBe("Character Sheet for Anima.safetensors");
  });

  it("不会误命中别的三视图 LoRA（Krea2 四视图）", () => {
    const resolved = resolveSheetLora("sdxl", [
      loraItem({ folder: "Krea2-功能", file_name: "Krea2-四视图QuadView_krea2_v1.safetensors" }),
    ]);
    expect(resolved.matched).toBe(false);
    expect(resolved.ref.name).toBe(SDXL_LORA);
  });

  it("override 优先于内置默认", () => {
    const resolved = resolveSheetLora("anima", [], "收集/更好的三视图.safetensors");
    expect(resolved.ref.name).toBe("收集/更好的三视图.safetensors");
  });
});

describe("三视图 LoRA 注入", () => {
  it("名称归一：斜杠方向、扩展名、大小写都不影响判等", () => {
    expect(normalizeLoraKey("A/B/C.safetensors")).toBe("a\\b\\c");
    expect(normalizeLoraKey("a\\b\\c")).toBe("a\\b\\c");
  });

  it("空列表时插到首位", () => {
    const selection: LoraSelection = { name: ANIMA_LORA, strength: 0.7, clipStrength: 0.7, active: true };
    expect(upsertSheetLora([], selection)).toEqual([selection]);
  });

  it("同名（扩展名/斜杠不同）原地替换并更新权重，不新增条目", () => {
    const existing: LoraSelection = {
      name: "AnimaLora\\三视图\\Character Sheet for Anima",
      strength: 0.3,
      clipStrength: 0.3,
      active: false,
    };
    const next = upsertSheetLora([existing], {
      name: ANIMA_LORA,
      strength: 0.8,
      clipStrength: 0.8,
      active: true,
    });
    expect(next).toHaveLength(1);
    expect(next[0].strength).toBe(0.8);
    expect(next[0].active).toBe(true);
  });

  it("用户额外叠加的 LoRA 保留，三视图 LoRA 排第一", () => {
    const userLora: LoraSelection = { name: "style/ink", strength: 1, clipStrength: 1, active: true };
    const next = upsertSheetLora([userLora], {
      name: ANIMA_LORA,
      strength: 0.7,
      clipStrength: 0.7,
      active: true,
    });
    expect(next.map((item) => item.name)).toEqual([ANIMA_LORA, "style/ink"]);
  });
});

describe("三视图参数组装", () => {
  it("Anima：参考图开关映射到 stages.img2img，checkpoint 保持空串", () => {
    const sheet = makeSheet({
      mode: "anima",
      reference: { enabled: true, imageName: "ref.png" },
      subject: "1girl",
      characterPrompt: "silver hair",
    });
    const params = toSheetAnimaParams(sheet, null);
    expect(params.checkpoint).toBe("");
    expect(params.stages.img2img).toBe(true);
    expect(params.img2img.imageName).toBe("ref.png");
    expect(params.positivePrompt).toContain("front view");
    expect(params.positivePrompt).toContain("silver hair");
  });

  it("Anima：参考图关闭时不启用图生图", () => {
    const sheet = makeSheet({ mode: "anima", reference: { enabled: false, imageName: "ref.png" } });
    expect(toSheetAnimaParams(sheet, null).stages.img2img).toBe(false);
  });

  it("SDXL：参考图映射到 img2img.enabled，并清空遮罩", () => {
    const sheet = makeSheet({ mode: "sdxl", reference: { enabled: true, imageName: "ref.png" } });
    const params = toSheetSdxlParams(sheet, null);
    expect(params.img2img?.enabled).toBe(true);
    expect(params.img2img?.imageName).toBe("ref.png");
    expect(params.img2img?.maskName).toBe("");
  });

  it("LoRA 关闭时不注入；开启时首条即三视图 LoRA 且权重来自滑杆", () => {
    const sheet = makeSheet({ mode: "anima" });
    const ref = { name: ANIMA_LORA, displayName: "Character Sheet" };

    expect(toSheetAnimaParams({ ...sheet, lora: { ...sheet.lora, enabled: false } }, ref).loras).toHaveLength(0);

    const params = toSheetAnimaParams({ ...sheet, lora: { ...sheet.lora, weight: { anima: 0.55, sdxl: 0.9 } } }, ref);
    expect(params.loras).toHaveLength(1);
    expect(params.loras[0].strength).toBe(0.55);
    expect(params.loras[0].active).toBe(true);
  });
});

describe("三视图工作流分发", () => {
  it("Anima：走 UNET/CLIP/VAE 三加载器，不含 CheckpointLoaderSimple", () => {
    const sheet = makeSheet({ mode: "anima", subject: "1girl", characterPrompt: "silver hair" });
    const prompt = buildSheetPrompt(sheet, {
      loraRef: { name: ANIMA_LORA },
      animaCaps: { useEasyHiresFix: true, useImageResizeKJv2: true },
    });
    const types = Object.values(prompt).map((node) => node.class_type);
    expect(types).toContain("UNETLoader");
    expect(types).not.toContain("CheckpointLoaderSimple");
    expect(promptTexts(prompt).join(" ")).toContain("front view");

    const loader = loraLoaderNode(prompt);
    expect(loader?.inputs?.loras).toMatchObject({
      __value__: [{ name: "AnimaLora\\三视图\\Character Sheet for Anima", strength: 0.7 }],
    });
    const save = Object.values(prompt).find((node) => node.class_type === "SaveImage");
    expect(String(save?.inputs?.filename_prefix)).toContain("三视图/");
  });

  it("Anima + 参考图：出现 ImageResizeKJv2 与 VAEEncode，不再用空 latent", () => {
    const sheet = makeSheet({ mode: "anima", reference: { enabled: true, imageName: "ref.png" } });
    const prompt = buildSheetPrompt(sheet, {
      loraRef: { name: ANIMA_LORA },
      animaCaps: { useEasyHiresFix: true, useImageResizeKJv2: true },
    });
    const types = Object.values(prompt).map((node) => node.class_type);
    expect(types).toContain("ImageResizeKJv2");
    expect(types).toContain("VAEEncode");
    expect(prompt["46"]).toBeUndefined();
  });

  it("SDXL：走 CheckpointLoaderSimple，参考图走 ImageScale + VAEEncode", () => {
    const sheet = makeSheet({ mode: "sdxl", reference: { enabled: true, imageName: "ref.png" } });
    const prompt = buildSheetPrompt(sheet, { loraRef: { name: SDXL_LORA } });
    const types = Object.values(prompt).map((node) => node.class_type);
    expect(types).toContain("CheckpointLoaderSimple");
    expect(prompt["i2i_scale"]?.class_type).toBe("ImageScale");
    expect(prompt["i2i_encode"]?.class_type).toBe("VAEEncode");
    expect(prompt["6"]?.inputs?.latent_image).toEqual(["i2i_encode", 0]);
    expect(prompt["5"]).toBeUndefined();

    const loader = loraLoaderNode(prompt);
    expect(loader?.inputs?.loras).toMatchObject({
      __value__: [{ name: "AnimaLora\\三视图\\TRcharactersheet-10", strength: 0.9 }],
    });
  });

  it("SDXL 无参考图时仍用空 latent", () => {
    const sheet = makeSheet({ mode: "sdxl", reference: { enabled: false, imageName: "" } });
    const prompt = buildSheetPrompt(sheet, { loraRef: { name: SDXL_LORA } });
    expect(prompt["5"]?.class_type).toBe("EmptyLatentImage");
  });

  it("SDXL 修复全关时保持纯文生图（无放大 / 无 detailer）", () => {
    const sheet = makeSheet({ mode: "sdxl" });
    const prompt = buildSheetPrompt(sheet, { loraRef: { name: SDXL_LORA } });
    const types = Object.values(prompt).map((node) => node.class_type);
    expect(types).not.toContain("LatentUpscaleBy");
    expect(types).not.toContain("FaceDetailer");
    expect(types.filter((type) => type === "KSampler")).toHaveLength(1);
  });

  it("SDXL 开启修复后改走高清修复链路：放大 + 二次采样 + 脸部修复", () => {
    const sheet = makeSheet({ mode: "sdxl" });
    sheet.sdxl = { ...sheet.sdxl, enableUpscale: true, enableFaceDetailer: true };
    const prompt = buildSheetPrompt(sheet, { loraRef: { name: SDXL_LORA } });
    const types = Object.values(prompt).map((node) => node.class_type);
    expect(types).toContain("LatentUpscaleBy");
    expect(types).toContain("FaceDetailer");
    expect(types).toContain("UltralyticsDetectorProvider");
    // 基础采样 + 高清修复采样
    expect(types.filter((type) => type === "KSampler")).toHaveLength(2);
    // 参考图仍然生效：图生图只替换基础采样的 latent
    const save = Object.values(prompt).find((node) => node.class_type === "SaveImage");
    expect(String(save?.inputs?.filename_prefix)).toContain("三视图/");
  });
});

describe("三视图默认值", () => {
  it("清空提示词与 LoRA、继承模型、关闭两级放大、固定横版尺寸", () => {
    const anima = makeAnimaParams();
    anima.modelStack.unetName = "silvermoonmixAnima.safetensors";
    anima.positivePrompt = "旧提示词";
    anima.loras = [{ name: "old", strength: 1, clipStrength: 1, active: true }];

    const sheet = makeSheetParams(anima, makeBaseParams("noob.safetensors"));

    expect(sheet.anima.positivePrompt).toBe("");
    expect(sheet.anima.loras).toEqual([]);
    expect(sheet.sdxl.loras).toEqual([]);
    expect(sheet.anima.modelStack.unetName).toBe("silvermoonmixAnima.safetensors");
    expect(sheet.sdxl.checkpoint).toBe("noob.safetensors");
    expect(sheet.anima.width).toBe(1344);
    expect(sheet.anima.height).toBe(1024);
    expect(sheet.anima.stages.hiresFixPre).toBe(false);
    expect(sheet.anima.stages.hiresFixPost).toBe(false);
    expect(sheet.sdxl.filenamePrefix).toContain("三视图/");
    expect(sheet.lora.weight).toEqual({ anima: 0.7, sdxl: 0.9 });
  });

  it("深拷贝：改三视图页的 detailer 不会污染 Anima 面板", () => {
    const anima = makeAnimaParams();
    const sheet = makeSheetParams(anima, makeBaseParams());
    sheet.anima.handDetailer.denoise = 0.99;
    expect(anima.handDetailer.denoise).not.toBe(0.99);
  });

  it("SDXL 侧：以高清修复参数为骨架、修复开关从关闭开始，且与高清修复页互不影响", () => {
    const fix = makeHighresParams("noob.safetensors");
    fix.handDetailer.denoise = 0.41;
    fix.scaleBy = 1.8;

    const sheet = makeSheetParams(makeAnimaParams(), makeBaseParams("noob.safetensors"), fix);
    expect(sheet.sdxl.enableUpscale).toBe(false);
    expect(sheet.sdxl.enableFaceDetailer).toBe(false);
    // 骨架取值继承（用户调好的修复参数不必重填）
    expect(sheet.sdxl.handDetailer.denoise).toBe(0.41);
    expect(sheet.sdxl.scaleBy).toBe(1.8);

    sheet.sdxl.handDetailer.denoise = 0.9;
    expect(fix.handDetailer.denoise).toBe(0.41);
  });

  it("脏数据兜底：非法模式回落 anima，权重被 clamp", () => {
    const dirty = {
      ...makeSheet(),
      mode: "krea2",
      subject: "2girls",
      lora: { enabled: false, weight: { anima: -1, sdxl: 99 }, includeTrigger: false, includeBackground: true, override: {} },
    } as unknown as SheetParams;

    const fixed = normalizeSheetParams(dirty);
    expect(fixed.mode).toBe("anima");
    expect(fixed.subject).toBe("1girl");
    expect(fixed.lora.weight).toEqual({ anima: 0, sdxl: 2 });
    expect(fixed.lora.enabled).toBe(false);
  });
});
