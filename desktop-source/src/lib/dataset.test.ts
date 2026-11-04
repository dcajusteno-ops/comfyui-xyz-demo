import { describe, expect, it } from "vitest";
import type { DatasetAxisKey, DatasetConfig, LoraSelection } from "../types";
import { makeDatasetParams, normalizeDatasetParams } from "./paramBuilders";
import { dedupeKey } from "./characterSheet";
import { matchesLoraFamily } from "./lora-helper";
import {
  AXIS_CONFLICTS,
  DATASET_AXIS_ORDER,
  DATASET_DEFAULT_POOLS,
  DATASET_FORBIDDEN_IN_CAPTION,
  DATASET_LEGACY_POOLS_V1,
} from "./dataset/pools";
import { buildCaption, composeDatasetPrompt, isForbiddenInCaption } from "./dataset/compose";
import { MAX_DATASET_COUNT, MIN_DATASET_COUNT, buildDatasetPlan, normalizePool, reseedDatasetConfig } from "./dataset/plan";
import { buildDatasetPrompt, datasetItemPrefix, toDatasetAnimaParams, toDatasetSdxlParams } from "./dataset/build";
import { buildCaptionsText, buildManifest } from "./dataset/caption";
import { buildDatasetCaptionPrompt } from "./dataset/captionNode";
import { buildDatasetSignature } from "./dataset/signature";

function makeLora(name: string, strength = 1, active = true): LoraSelection {
  return { name, strength, clipStrength: strength, active };
}

/** caption 配置夹具：以默认值为底，只改需要覆盖的开关 */
function captionOf(patch: Partial<DatasetConfig["caption"]> = {}): DatasetConfig["caption"] {
  return { ...makeDatasetParams().caption, ...patch };
}

function baseConfig(patch: Partial<DatasetConfig> = {}): DatasetConfig {
  const config = makeDatasetParams();
  return {
    ...config,
    planSeed: 12345,
    seedBase: 500,
    targetCount: 12,
    ...patch,
  };
}

function onlyAxis(axis: DatasetAxisKey, perItem = 1): DatasetConfig {
  const config = baseConfig({ targetCount: 30 });
  for (const key of DATASET_AXIS_ORDER) {
    config.axes[key] = { ...config.axes[key], enabled: key === axis, perItem };
  }
  return config;
}

describe("数据集词池", () => {
  it("八个轴都有足量且互不重复的词", () => {
    expect(DATASET_AXIS_ORDER).toHaveLength(8);
    // 守住扩容后的下限：100 张训练集需要的是一条轴上的多轮变化，不是每轴三五个词
    const minPool: Record<DatasetAxisKey, number> = {
      pose: 60,
      expression: 40,
      camera: 14,
      shot: 10,
      scene: 100,
      lighting: 30,
      outfit: 50,
      extra: 30,
    };
    for (const axis of DATASET_AXIS_ORDER) {
      const pool = DATASET_DEFAULT_POOLS[axis];
      expect(pool.length).toBeGreaterThanOrEqual(minPool[axis]);
      const keys = pool.map((tag) => dedupeKey(tag));
      expect(new Set(keys).size).toBe(keys.length);
      for (const tag of pool) {
        expect(tag).not.toMatch(/[,，\n]/);
        expect(isForbiddenInCaption(tag)).toBe(false);
      }
    }
  });

  it("互斥表不含重复项，且词都在池里", () => {
    const signatures = new Set<string>();
    const all = new Set(DATASET_AXIS_ORDER.flatMap((axis) => DATASET_DEFAULT_POOLS[axis].map((tag) => dedupeKey(tag))));
    for (const [a, b] of AXIS_CONFLICTS) {
      const key = [dedupeKey(a), dedupeKey(b)].sort().join("|");
      expect(signatures.has(key)).toBe(false);
      signatures.add(key);
      expect(all.has(dedupeKey(a))).toBe(true);
      expect(all.has(dedupeKey(b))).toBe(true);
    }
  });

  it("禁用词表覆盖画质/水印类", () => {
    for (const word of ["masterpiece", "best quality", "watermark"]) {
      expect(DATASET_FORBIDDEN_IN_CAPTION.map((item) => dedupeKey(item))).toContain(dedupeKey(word));
    }
  });

  it("池归一化按逗号/换行切分并去重", () => {
    expect(normalizePool(["a, b", "A", "c\nd"])).toEqual(["a", "b", "c", "d"]);
  });
});

describe("词池升级迁移", () => {
  it("旧版原封未动的池会换成扩容后的池", () => {
    const base = makeDatasetParams();
    const stored = {
      ...base,
      axes: {
        ...base.axes,
        pose: { ...base.axes.pose, pool: [...DATASET_LEGACY_POOLS_V1.pose] },
        scene: { ...base.axes.scene, pool: [...DATASET_LEGACY_POOLS_V1.scene] },
      },
    };
    const next = normalizeDatasetParams(stored);
    expect(next.axes.pose.pool).toEqual(DATASET_DEFAULT_POOLS.pose);
    expect(next.axes.scene.pool).toEqual(DATASET_DEFAULT_POOLS.scene);
    // 没被旧值覆盖的轴保持当前默认池
    expect(next.axes.expression.pool).toEqual(DATASET_DEFAULT_POOLS.expression);
  });

  it("用户删改过的池不会被迁移覆盖", () => {
    const base = makeDatasetParams();
    const stored = {
      ...base,
      axes: {
        ...base.axes,
        pose: { ...base.axes.pose, pool: ["standing", "sitting", "kneeling"] },
      },
    };
    expect(normalizeDatasetParams(stored).axes.pose.pool).toEqual(["standing", "sitting", "kneeling"]);
  });
});

describe("提示词拼装", () => {
  it("顺序固定：主体 → 角色固定词 → 画风 → 变化词", () => {
    const config = baseConfig({
      subject: "1boy",
      characterPrompt: "blue_hair, red eyes",
      style: { anima: "masterpiece, best quality", sdxl: "" },
    });
    const result = composeDatasetPrompt(config, { pose: ["standing"], expression: ["smile"] });
    expect(result.text.startsWith("1boy, blue_hair, red eyes, masterpiece, best quality")).toBe(true);
    expect(result.text.endsWith("standing, smile")).toBe(true);
    expect(result.variableTags).toEqual(["standing", "smile"]);
  });

  it("与固定词重复的变化词会被丢弃并记录", () => {
    const config = baseConfig({ characterPrompt: "blue_hair, smile" });
    const result = composeDatasetPrompt(config, { expression: ["smile"], pose: ["standing"] });
    expect(result.variableTags).toEqual(["standing"]);
    expect(result.droppedTags).toEqual(["smile"]);
    expect(result.text.match(/smile/g)).toHaveLength(1);
  });

  it("加权语法不参与去重", () => {
    const config = baseConfig({ characterPrompt: "smile" });
    const result = composeDatasetPrompt(config, { expression: ["(smile:1.2)"] });
    expect(result.variableTags).toEqual(["(smile:1.2)"]);
    expect(result.droppedTags).toEqual([]);
  });

  it("没有挂 LoRA 时触发词不进正向提示词", () => {
    const config = baseConfig({ trigger: "mychar" });
    expect(composeDatasetPrompt(config, {}).text).not.toContain("mychar");

    const withLora = baseConfig({
      trigger: "mychar",
      anima: {
        ...baseConfig().anima,
        loras: [{ name: "chars/a.safetensors", strength: 1, clipStrength: 1, active: true }],
      },
    });
    expect(composeDatasetPrompt(withLora, {}).text).toContain("mychar");
  });
});

describe("caption", () => {
  it("触发词在首位，画风与画质永不进入", () => {
    const config = baseConfig({
      trigger: "mychar",
      characterPrompt: "blue hair, masterpiece",
      style: { anima: "best quality, anime coloring", sdxl: "" },
      caption: captionOf({ includeTrigger: true, includeCharacter: true }),
    });
    const caption = buildCaption(config, ["standing", "smile"]);
    expect(caption.startsWith("mychar, blue hair")).toBe(true);
    expect(caption).toContain("standing");
    expect(caption).not.toContain("masterpiece");
    expect(caption).not.toContain("best quality");
    expect(caption).not.toContain("anime coloring");
  });

  it("关闭触发词与角色词后只留变化词", () => {
    const config = baseConfig({
      trigger: "mychar",
      characterPrompt: "blue hair",
      caption: captionOf({ includeTrigger: false, includeCharacter: false }),
    });
    expect(buildCaption(config, ["standing"])).toBe("standing");
  });

  it("caption 的 tag 集合与 compose 的有效变化词一致", () => {
    const config = baseConfig({
      characterPrompt: "blue hair",
      caption: captionOf({ includeTrigger: false, includeCharacter: false }),
    });
    const composed = composeDatasetPrompt(config, { pose: ["standing"], scene: ["cafe"] });
    expect(buildCaption(config, composed.variableTags)).toBe(composed.variableTags.join(", "));
  });
});

describe("计划生成", () => {
  it("条数精确且被夹在 4..300", () => {
    expect(buildDatasetPlan(baseConfig({ targetCount: 100 }))).toHaveLength(100);
    expect(buildDatasetPlan(baseConfig({ targetCount: 1 }))).toHaveLength(MIN_DATASET_COUNT);
    expect(buildDatasetPlan(baseConfig({ targetCount: 9999 }))).toHaveLength(MAX_DATASET_COUNT);
  });

  it("同种子逐字段可复现，换种子结果不同", () => {
    const config = baseConfig({ targetCount: 20 });
    const a = buildDatasetPlan(config);
    const b = buildDatasetPlan(config);
    expect(b).toEqual(a);

    const c = buildDatasetPlan({ ...config, planSeed: 999 });
    const same = c.filter((item, i) => item.fingerprint === a[i].fingerprint).length;
    expect(same).toBeLessThan(a.length * 0.5);
  });

  it("100 条的变化指纹与 seed 全唯一", () => {
    const items = buildDatasetPlan(baseConfig({ targetCount: 100 }));
    const fingerprints = items.map((item) => item.fingerprint);
    expect(new Set(fingerprints).size).toBe(100);
    const seeds = items.map((item) => item.seed);
    expect(new Set(seeds).size).toBe(100);
    for (const seed of seeds) {
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 53);
      expect(Number.isInteger(seed)).toBe(true);
    }
  });

  it("单轴启用时每个值覆盖次数极差不超过 1", () => {
    for (const axis of DATASET_AXIS_ORDER) {
      const config = onlyAxis(axis);
      const items = buildDatasetPlan(config);
      const counts = new Map<string, number>();
      for (const tag of DATASET_DEFAULT_POOLS[axis]) counts.set(dedupeKey(tag), 0);
      for (const item of items) {
        for (const tag of item.tags[axis] ?? []) {
          const key = dedupeKey(tag);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      const values = [...counts.values()];
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    }
  });

  it("固定词里已有的词不会被变化轴重复选中", () => {
    const config = baseConfig({ targetCount: 20, characterPrompt: "smile, standing" });
    const items = buildDatasetPlan(config);
    for (const item of items) {
      const picked = Object.values(item.tags).flat();
      expect(picked.map((tag) => dedupeKey(tag))).not.toContain("smile");
      expect(picked.map((tag) => dedupeKey(tag))).not.toContain("standing");
    }
  });

  it("item id / index / 文件名前缀一一对应且不重复", () => {
    const config = baseConfig({ targetCount: 20 });
    const items = buildDatasetPlan(config);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    expect(items.map((item) => item.index)).toEqual(items.map((_, i) => i + 1));
    const prefixes = items.map((item) => datasetItemPrefix(config, item));
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes[0]).toBe("Datasets/dataset/001");
    expect(prefixes[19]).toBe("Datasets/dataset/020");
  });

  it("全部轴关闭时仍能凑够条数（prompt 相同但可跑）", () => {
    const config = baseConfig({ targetCount: 6 });
    for (const key of DATASET_AXIS_ORDER) config.axes[key] = { ...config.axes[key], enabled: false };
    const items = buildDatasetPlan(config);
    expect(items).toHaveLength(6);
    expect(items[0].prompt).toBe(items[5].prompt);
  });
});

describe("换一批（重新规划）", () => {
  it("会同时换发牌种子与每张 seed，连续两次也不同", () => {
    const config = baseConfig({ targetCount: 8 });
    const first = buildDatasetPlan(config);

    const next = reseedDatasetConfig(config);
    expect(next.planSeed !== config.planSeed || next.seedBase !== config.seedBase).toBe(true);
    // 除种子外其余配置原样保留
    expect(next.targetCount).toBe(config.targetCount);
    expect(next.axes).toBe(config.axes);

    const second = buildDatasetPlan(next);
    expect(second.map((item) => item.seed)).not.toEqual(first.map((item) => item.seed));

    const third = buildDatasetPlan(reseedDatasetConfig(config));
    expect(third.map((item) => item.seed)).not.toEqual(second.map((item) => item.seed));
  });

  it("同一种子仍可复现（换一批不等于每次都不确定）", () => {
    const config = baseConfig({ targetCount: 6 });
    const a = buildDatasetPlan(config);
    const b = buildDatasetPlan({ ...config });
    expect(b.map((item) => item.seed)).toEqual(a.map((item) => item.seed));
    expect(b.map((item) => item.fingerprint)).toEqual(a.map((item) => item.fingerprint));
  });
});

describe("提交参数", () => {
  it("Anima：种子钉死、单批、存图开、无水印、独立前缀", () => {
    const config = baseConfig();
    const [item] = buildDatasetPlan(config);
    const params = toDatasetAnimaParams(config, item);
    expect(params.randomizeSeed).toBe(false);
    expect(params.seed).toBe(item.seed);
    expect(params.batchSize).toBe(1);
    expect(params.stages.saveImage).toBe(true);
    expect(params.stages.img2img).toBe(false);
    expect(params.drawText).toBeUndefined();
    expect(params.filenamePrefix).toBe(`Datasets/dataset/${String(item.index).padStart(3, "0")}`);
    expect(params.positivePrompt).toBe(item.prompt);
  });

  it("Anima：开参考图时切到图生图并带上文件名", () => {
    const config = baseConfig({ reference: { enabled: true, imageName: "ref.png" } });
    const [item] = buildDatasetPlan(config);
    const params = toDatasetAnimaParams(config, item);
    expect(params.stages.img2img).toBe(true);
    expect(params.img2img.imageName).toBe("ref.png");
  });

  it("SDXL：同样钉死种子/批次/前缀，并清空遮罩", () => {
    const config = baseConfig({ mode: "sdxl", reference: { enabled: true, imageName: "ref.png" } });
    const [item] = buildDatasetPlan(config);
    const params = toDatasetSdxlParams(config, item);
    expect(params.randomizeSeed).toBe(false);
    expect(params.randomizeHighresSeed).toBe(false);
    expect(params.highresSeed).toBe(item.seed);
    expect(params.batchSize).toBe(1);
    expect(params.drawText).toBeUndefined();
    expect(params.img2img).toMatchObject({ enabled: true, imageName: "ref.png", maskName: "" });
  });

  it("按模型族分发到既有链路，且提示词逐字进入 CLIPTextEncode", () => {
    const animaConfig = baseConfig({ mode: "anima" });
    const [animaItem] = buildDatasetPlan(animaConfig);
    const animaPrompt = buildDatasetPrompt(animaConfig, animaItem);
    const texts = Object.values(animaPrompt).map((node) => String(node.inputs?.text ?? ""));
    expect(texts).toContain(animaItem.prompt);
    expect(Object.values(animaPrompt).some((node) => node.class_type === "UNETLoader")).toBe(true);

    const sdxlConfig = baseConfig({ mode: "sdxl" });
    const [sdxlItem] = buildDatasetPlan(sdxlConfig);
    const sdxlPrompt = buildDatasetPrompt(sdxlConfig, sdxlItem);
    expect(Object.values(sdxlPrompt).some((node) => node.class_type === "CheckpointLoaderSimple")).toBe(true);
    const sdxlTexts = Object.values(sdxlPrompt).map((node) => String(node.inputs?.text ?? ""));
    expect(sdxlTexts).toContain(sdxlItem.prompt);
  });
});

describe("同名 .txt（> Save Text）", () => {
  const file = { filename: "001_00001_.png", subfolder: "Datasets/dataset/001", type: "output" };
  const saveConfig = baseConfig({ caption: captionOf({ saveTxt: true, saveTxtMode: "caption" }) });
  const [item] = buildDatasetPlan(saveConfig);

  it("用图片文件名做 filename_opt，落盘即 <图片同名>.txt", () => {
    const prompt = buildDatasetCaptionPrompt(saveConfig, item, file);
    expect(prompt).not.toBeNull();
    const entry = Object.entries(prompt!).find(([, node]) => node.class_type === "> Save Text");
    expect(entry).toBeTruthy();
    const saveNode = entry![1];
    expect(saveNode.inputs).toMatchObject({ filename_prefix: "caption", folder: "Datasets/dataset/001" });

    const textRef = saveNode.inputs.text as [string, number];
    const nameRef = saveNode.inputs.filename_opt as [string, number];
    expect(prompt![textRef[0]].class_type).toBe("> Text");
    expect(prompt![textRef[0]].inputs.text).toBe(item.caption);
    expect(prompt![nameRef[0]].inputs.text).toBe("001_00001_");
  });

  it("内容是完整提示词时写 item.prompt", () => {
    const promptConfig = baseConfig({ caption: captionOf({ saveTxt: true, saveTxtMode: "prompt" }) });
    const [promptItem] = buildDatasetPlan(promptConfig);
    const prompt = buildDatasetCaptionPrompt(promptConfig, promptItem, file)!;
    const values = Object.values(prompt);
    expect(values.some((node) => node.inputs.text === promptItem.prompt)).toBe(true);
    expect(values.some((node) => node.inputs.text === promptItem.caption)).toBe(false);
  });

  it("关闭开关或文件名异常时不生成写文件任务", () => {
    expect(
      buildDatasetCaptionPrompt(baseConfig({ caption: captionOf({ saveTxt: false }) }), item, file),
    ).toBeNull();
    expect(buildDatasetCaptionPrompt(saveConfig, item, { filename: "" })).toBeNull();
  });
});

describe("导出", () => {
  it("caption 清单只含成功项，且一行一图", () => {
    const items = buildDatasetPlan(baseConfig({ targetCount: 8 }));
    items[0].status = "success";
    items[0].files = [{ filename: "001_00001_.png", subfolder: "Datasets/dataset/001", type: "output" }];
    items[1].status = "failed";
    const text = buildCaptionsText(items);
    expect(text.split("\n")).toHaveLength(1);
    expect(text.startsWith("Datasets/dataset/001/001_00001_\t")).toBe(true);
  });

  it("manifest 带参数快照与统计", () => {
    const config = baseConfig({ targetCount: 8 });
    const items = buildDatasetPlan(config);
    items[0].status = "success";
    const manifest = buildManifest(config, {
      version: 1,
      mode: config.mode,
      planSeed: config.planSeed,
      createdAt: 0,
      signature: buildDatasetSignature(config),
      items,
    });
    expect(manifest.counts.total).toBe(8);
    expect(manifest.counts.success).toBe(1);
    expect(manifest.settings.width).toBe(1024);
    expect(manifest.settings.loras).toEqual([]);
    expect(manifest.items).toHaveLength(8);
  });

  it("manifest 记录当前族生效中的 LoRA（可复现）", () => {
    const config = baseConfig({
      anima: {
        ...baseConfig().anima,
        loras: [
          makeLora("chars/hero.safetensors", 0.8),
          { ...makeLora("chars/off.safetensors", 1), active: false },
        ],
      },
    });
    const manifest = buildManifest(config, {
      version: 1,
      mode: config.mode,
      planSeed: config.planSeed,
      createdAt: 0,
      signature: buildDatasetSignature(config),
      items: buildDatasetPlan(config),
    });
    expect(manifest.settings.loras).toHaveLength(1);
    expect(manifest.settings.loras[0]).toMatchObject({
      name: "chars/hero.safetensors",
      strength: 0.8,
      clipStrength: 0.8,
    });
  });
});

describe("计划签名", () => {
  it("同配置两次调用结果相同", () => {
    const config = baseConfig();
    expect(buildDatasetSignature(config)).toBe(buildDatasetSignature({ ...config }));
  });

  it("LoRA 增删、权重、触发词、角色词、轴、caption、张数都会改变签名", () => {
    const base = baseConfig();
    const baseline = buildDatasetSignature(base);
    const variants: DatasetConfig[] = [
      { ...base, anima: { ...base.anima, loras: [makeLora("chars/hero.safetensors", 1)] } },
      { ...base, trigger: "mychar" },
      { ...base, characterPrompt: "blue hair" },
      { ...base, axes: { ...base.axes, pose: { ...base.axes.pose, enabled: false } } },
      { ...base, axes: { ...base.axes, pose: { ...base.axes.pose, perItem: 2 } } },
      { ...base, axes: { ...base.axes, pose: { ...base.axes.pose, pool: ["only-one"] } } },
      { ...base, caption: captionOf({ includeTrigger: false, includeCharacter: true }) },
      { ...base, targetCount: 20 },
      { ...base, seedBase: 999 },
      { ...base, filenameRoot: "Datasets/other" },
      { ...base, reference: { enabled: true, imageName: "ref.png" } },
      { ...base, subject: "1boy" },
      { ...base, style: { ...base.style, anima: "masterpiece" } },
    ];
    for (const variant of variants) {
      expect(buildDatasetSignature(variant)).not.toBe(baseline);
    }
  });

  it("改权重、LoRA 顺序、启停都会改变签名", () => {
    const first = makeLora("chars/a.safetensors", 0.7);
    const second = makeLora("chars/b.safetensors", 0.9);
    const base = baseConfig();
    const withBoth = { ...base, anima: { ...base.anima, loras: [first, second] } };
    const signature = buildDatasetSignature(withBoth);

    expect(
      buildDatasetSignature({ ...base, anima: { ...base.anima, loras: [{ ...first, strength: 0.75 }, second] } }),
    ).not.toBe(signature);
    expect(
      buildDatasetSignature({ ...base, anima: { ...base.anima, loras: [second, first] } }),
    ).not.toBe(signature);
    expect(
      buildDatasetSignature({ ...base, anima: { ...base.anima, loras: [{ ...first, active: false }, second] } }),
    ).not.toBe(signature);
  });

  it("停用的 LoRA 不参与签名（与没挂等价）", () => {
    const base = baseConfig();
    const off = { ...makeLora("chars/a.safetensors", 1), active: false };
    expect(buildDatasetSignature({ ...base, anima: { ...base.anima, loras: [off] } })).toBe(
      buildDatasetSignature(base),
    );
  });

  it("模型栈 / 采样参数变化不影响签名（只影响出图质量）", () => {
    const base = baseConfig();
    const baseline = buildDatasetSignature(base);
    expect(
      buildDatasetSignature({
        ...base,
        anima: { ...base.anima, modelStack: { ...base.anima.modelStack, unetName: "other.safetensors" }, steps: 30 },
      }),
    ).toBe(baseline);
  });

  it("切换模型族后签名不同（两族的 LoRA/画风不同）", () => {
    const base = baseConfig();
    expect(buildDatasetSignature({ ...base, mode: "sdxl" })).not.toBe(buildDatasetSignature(base));
  });
});

describe("模型族匹配", () => {
  it("Anima 系按 base_model / 文件名命中", () => {
    expect(matchesLoraFamily("anima", { base_model: "Anima", file_name: "x.safetensors" })).toBe(true);
    expect(matchesLoraFamily("anima", { base_model: "", file_name: "anima-style.safetensors" })).toBe(true);
    expect(matchesLoraFamily("anima", { base_model: "Illustrious v1.0", file_name: "x.safetensors" })).toBe(false);
  });

  it("SDXL 系覆盖 Illustrious / NoobAI / Pony / SDXL", () => {
    for (const baseModel of ["Illustrious v1.0", "NoobAI v1.1", "Pony", "SDXL 1.0", "Stable Diffusion XL"]) {
      expect(matchesLoraFamily("sdxl", { base_model: baseModel, file_name: "x.safetensors" })).toBe(true);
    }
    expect(matchesLoraFamily("sdxl", { base_model: "Anima", file_name: "x.safetensors" })).toBe(false);
  });
});
