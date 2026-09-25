import type { ComfyPrompt, DetailerParams } from "../types";
import { resolveSeed } from "./seed";

/**
 * 局部修复链的共用实现。
 *
 * 从 `buildHighresPrompt` 中原样提取，供「高清修复」与「Anima 生图」两条链路共用：
 * 两者对 detailer 的需求完全一致（同一批 Impact 节点、同一套参数位），
 * 差别只在「引用来源」（model / clip / vae / 上游图像）与「执行顺序」。
 *
 * 注意：这里刻意**不使用** `ToDetailerPipe` / `EditDetailerPipe` / `FaceDetailerPipe`
 * ——那是原 Anima 工作流的"省连线"写法，与逐节点显式输入的 `FaceDetailer` 功能等价，
 * 而后者是本项目既有的、被 64 组合测试覆盖过的实现。
 */

export type DetailerChainStageKey = "segs" | "hand" | "nsfw" | "face" | "eyes";

export type DetailerChainStage = {
  key: DetailerChainStageKey;
  /** UltralyticsDetectorProvider 的 model_name（segs 阶段忽略它） */
  detector: string;
  params: DetailerParams;
  /** 主节点 `_meta.title`，同时用作预览前缀（`进入${detailerTitle}前`） */
  detailerTitle: string;
  /** 检测器节点 `_meta.title`（segs 阶段不使用） */
  detectorTitle: string;
};

export type DetailerChainInput = {
  /** 数组顺序即执行顺序（链式串联，顺序会影响最终画面） */
  stages: DetailerChainStage[];
  /** 上游图像 */
  image: [string, number];
  /** detailer 使用的 model 引用 */
  model: [string, number];
  /** `DifferentialDiffusion` 要包装的 model 引用（segs 阶段使用） */
  diffusionModel: [string, number];
  clip: [string, number];
  vae: [string, number];
  positive: [string, number];
  negative: [string, number];
  nextId: number;
  /** segs 阶段全图遮罩的尺寸 */
  segsMaskSize: { width: number; height: number };
  /**
   * `model` 是否已经过 `DifferentialDiffusion` 包装。
   * - 高修：false —— 链内部自己产出 `DifferentialDiffusion`，只给 SEGS 用；
   * - Anima：true  —— 调用方已建好 `DifferentialDiffusion`（包在 CFGZeroStar 之后），
   *   且所有 detailer 都用它，因此链内不再重复包装。
   */
  preDiffusedModel?: boolean;
  /** 整条链开始前插入的 PreviewImage 标题；不传则不插 */
  leadingPreviewTitle?: string;
  /**
   * 视为「刚解码出来、已有预览」的图引用，命中则不重复插预览。
   * 用于复刻高修原有的预览插入策略。
   */
  alreadyPreviewedRefs?: Array<[string, number]>;
};

function detectorNode(modelName: string, title: string) {
  return {
    class_type: "UltralyticsDetectorProvider",
    inputs: { model_name: modelName },
    _meta: { title },
  };
}

/**
 * 单个 detailer 的 `FaceDetailer` 节点。
 * sam_* / drop_size 的取值：调用方传入则用传入值，否则沿用项目原有的硬编码值
 * （高修从不传，因此其输出保持不变）。
 */
function faceDetailerNode(
  detailer: DetailerParams,
  image: [string, number],
  model: [string, number],
  clip: [string, number],
  vae: [string, number],
  positive: [string, number],
  negative: [string, number],
  detector: [string, number],
  isSegm: boolean,
  samModel: [string, number] | undefined,
  title: string,
) {
  const inputs: Record<string, unknown> = {
    image,
    model,
    clip,
    vae,
    guide_size: detailer.guideSize,
    guide_size_for: true,
    max_size: detailer.maxSize,
    seed: resolveSeed(0, true),
    steps: detailer.steps,
    cfg: detailer.cfg,
    sampler_name: detailer.samplerName,
    scheduler: detailer.scheduler,
    positive,
    negative,
    denoise: detailer.denoise,
    feather: detailer.feather,
    noise_mask: true,
    force_inpaint: true,
    bbox_threshold: detailer.bboxThreshold,
    bbox_dilation: detailer.bboxDilation,
    bbox_crop_factor: detailer.bboxCropFactor,
    sam_detection_hint: detailer.samDetectionHint ?? "center-1",
    sam_dilation: detailer.samDilation ?? 0,
    sam_threshold: detailer.samThreshold ?? 0.93,
    sam_bbox_expansion: 0,
    sam_mask_hint_threshold: detailer.samMaskHintThreshold ?? 0.7,
    sam_mask_hint_use_negative: detailer.samMaskHintUseNegative ?? "False",
    drop_size: detailer.dropSize ?? 10,
    bbox_detector: detector,
    wildcard: detailer.prompt ?? "",
    cycle: 1,
  };

  // 仅在显式提供时下发，保证高修（从不提供）的输出逐节点不变
  if (detailer.noiseMaskFeather !== undefined) inputs.noise_mask_feather = detailer.noiseMaskFeather;
  if (detailer.tiledEncode !== undefined) inputs.tiled_encode = detailer.tiledEncode;
  if (detailer.tiledDecode !== undefined) inputs.tiled_decode = detailer.tiledDecode;
  if (detailer.inpaintModel !== undefined) inputs.inpaint_model = detailer.inpaintModel;

  if (isSegm) {
    inputs.segm_detector_opt = [detector[0], 1];
  } else if (samModel) {
    inputs.sam_model_opt = samModel;
  }

  return {
    class_type: "FaceDetailer",
    inputs,
    _meta: { title },
  };
}

export function appendDetailerChain(
  prompt: ComfyPrompt,
  input: DetailerChainInput,
): { image: [string, number]; nextId: number } {
  let nextId = input.nextId;
  let currentImage: [string, number] = input.image;

  if (input.leadingPreviewTitle) {
    const previewId = String(nextId++);
    prompt[previewId] = {
      class_type: "PreviewImage",
      inputs: { images: currentImage },
      _meta: { title: input.leadingPreviewTitle },
    };
  }

  // SAM 惰性加载：只有真正需要（非 segm 检测器）时才产出节点
  let samModelId: string | null = null;
  const getSamModel = (): [string, number] => {
    if (!samModelId) {
      samModelId = String(nextId++);
      prompt[samModelId] = {
        class_type: "SAMLoader",
        inputs: { model_name: "sam_vit_b_01ec64.pth", device_mode: "AUTO" },
        _meta: { title: "SAM 加载器" },
      };
    }
    return [samModelId, 0];
  };

  const alreadyPreviewed = input.alreadyPreviewedRefs ?? [];

  for (const stage of input.stages) {
    if (!alreadyPreviewed.some((ref) => ref[0] === currentImage[0])) {
      const previewId = String(nextId++);
      prompt[previewId] = {
        class_type: "PreviewImage",
        inputs: { images: currentImage },
        _meta: { title: `进入${stage.detailerTitle}前` },
      };
    }

    if (stage.key === "segs") {
      const p = stage.params;

      const solidMaskId = String(nextId++);
      prompt[solidMaskId] = {
        class_type: "SolidMask",
        inputs: { value: 1, width: input.segsMaskSize.width, height: input.segsMaskSize.height },
        _meta: { title: "全图蒙版" },
      };

      const maskToSegsId = String(nextId++);
      prompt[maskToSegsId] = {
        class_type: "MaskToSEGS",
        inputs: {
          combined: false,
          crop_factor: 1,
          bbox_fill: false,
          drop_size: 10,
          contour_fill: false,
          mask: [solidMaskId, 0],
        },
        _meta: { title: "MASK to SEGS" },
      };

      let segsModelRef: [string, number] = input.model;
      if (!input.preDiffusedModel) {
        const diffDiffId = String(nextId++);
        prompt[diffDiffId] = {
          class_type: "DifferentialDiffusion",
          inputs: { strength: 1, model: input.diffusionModel },
          _meta: { title: "差异扩散" },
        };
        segsModelRef = [diffDiffId, 0];
      }

      const segsDetailerId = String(nextId++);
      prompt[segsDetailerId] = {
        class_type: "DetailerForEach",
        inputs: {
          guide_size: p.guideSize,
          guide_size_for: true,
          max_size: p.maxSize,
          seed: resolveSeed(0, true),
          steps: p.steps,
          cfg: p.cfg,
          sampler_name: p.samplerName,
          scheduler: p.scheduler,
          denoise: p.denoise,
          feather: p.feather,
          noise_mask: true,
          force_inpaint: true,
          wildcard: p.prompt ?? "",
          cycle: 1,
          inpaint_model: p.inpaintModel ?? false,
          noise_mask_feather: p.noiseMaskFeather ?? 32,
          tiled_encode: p.tiledEncode ?? false,
          tiled_decode: p.tiledDecode ?? false,
          image: currentImage,
          segs: [maskToSegsId, 0],
          model: segsModelRef,
          clip: input.clip,
          vae: input.vae,
          positive: input.positive,
          negative: input.negative,
        },
        _meta: { title: stage.detailerTitle },
      };
      currentImage = [segsDetailerId, 0];
      continue;
    }

    const detectorId = String(nextId++);
    const detailerId = String(nextId++);
    prompt[detectorId] = detectorNode(stage.detector, stage.detectorTitle);
    prompt[detailerId] = faceDetailerNode(
      stage.params,
      currentImage,
      input.model,
      input.clip,
      input.vae,
      input.positive,
      input.negative,
      [detectorId, 0],
      stage.detector.includes("segm"),
      getSamModel(),
      stage.detailerTitle,
    );
    currentImage = [detailerId, 0];
  }

  return { image: currentImage, nextId };
}
