/** 从 PromptEditorDialog.tsx 拆出（T14）：条目/模板类型与内置预设包，逻辑逐字未改 */
export type PromptEntry = {
  id: string;
  source: string;
  category: string;
  subcategory: string;
  scope: string;
  text_en: string;
  text_zh: string;
  search_text?: string;
};

export type PromptTemplate = {
  id: string;
  name: string;
  category: string;
  positive: string;
  negative: string;
};

export type EditorPart = {
  key: string;
  entryId: string;
  text: string;
  textZh: string;
  source: string;
  category: string;
};

/* ------------------------------------------------------------------ *
 * 词库导入 / 导出（T15）
 *
 * 上传的原始文件**不会被保留** —— 只留解析后的词条，所以用户想把自己的词库
 * 拿出去只能翻服务端 `data/prompts_state.json`。这里给出一对互逆的纯函数：
 * 导出压成可移植形状、导入再归一化回 PromptEntry（id 由导入端重新生成）。
 *
 * 两个方向**必须共用同一个形状**，否则「导出再导入」会静默丢字段。
 * ------------------------------------------------------------------ */

/** 可移植词条：只含语义字段，不带本地 id / search_text */
export type PortablePromptEntry = {
  source: string;
  category: string;
  subcategory: string;
  scope: string;
  text_en: string;
  text_zh: string;
};

/** 导出：自定义词条 → 可移植形状 */
export function toPortableEntries(entries: PromptEntry[]): PortablePromptEntry[] {
  return entries.map((e) => ({
    source: e.source || "本地文件",
    category: e.category || "未分类",
    subcategory: e.subcategory || "",
    scope: e.scope || "default",
    text_en: e.text_en || "",
    text_zh: e.text_zh || "",
  }));
}

/**
 * 导入：任意外部 JSON 数组 → PromptEntry。逐条补默认值，丢掉中英文都空的条目。
 * 非数组直接抛错（调用方负责提示用户）；缺 text_zh 时回退到 name 字段（兼容旧词库格式）。
 */
export function normalizeImportedEntries(raw: unknown): PromptEntry[] {
  if (!Array.isArray(raw)) throw new Error("JSON must be an array");
  const stamp = Date.now();
  return raw
    .map((item: Record<string, unknown>, index) => ({
      id: `custom-${stamp}-${index}-${Math.random().toString(16).slice(2)}`,
      source: typeof item?.source === "string" && item.source ? item.source : "本地文件",
      category: typeof item?.category === "string" && item.category ? item.category : "未分类",
      subcategory: typeof item?.subcategory === "string" ? item.subcategory : "",
      scope: typeof item?.scope === "string" && item.scope ? item.scope : "default",
      text_en: typeof item?.text_en === "string" ? item.text_en : "",
      text_zh:
        typeof item?.text_zh === "string" && item.text_zh
          ? item.text_zh
          : typeof item?.name === "string"
            ? item.name
            : "",
    }))
    .filter((x) => x.text_en || x.text_zh);
}

/** 触发一次浏览器下载（Blob + a[download]，与项目里其它下载实现同一套路） */
export function downloadJsonFile(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export const positivePresetPacks = [
  { id: 'portrait', name: '人物基础', terms: ['masterpiece', 'best quality', '1girl', 'detailed face', 'soft lighting'] },
  { id: 'cinematic', name: '电影感', terms: ['cinematic lighting', 'dramatic shadows', 'depth of field', 'film grain', 'high contrast'] },
  { id: 'camera', name: '镜头语言', terms: ['close-up', '85mm lens', 'bokeh', 'dynamic composition', 'sharp focus'] },
  { id: 'illustration', name: '插画细节', terms: ['highly detailed', 'clean lineart', 'delicate texture', 'rich colors', 'beautiful composition'] },
];

export const negativePresetPacks = [
  { id: 'common', name: '通用负面', terms: ['low quality', 'worst quality', 'blurry', 'bad anatomy', 'text', 'watermark'] },
  { id: 'handfix', name: '手部修正', terms: ['bad hands', 'extra fingers', 'missing fingers', 'mutated hands', 'poorly drawn hands'] },
  { id: 'facefix', name: '面部修正', terms: ['deformed face', 'bad eyes', 'cross-eyed', 'extra eyes', 'poorly drawn face'] },
  { id: 'artifact', name: '杂项瑕疵', terms: ['jpeg artifacts', 'cropped', 'duplicate', 'out of frame', 'extra limbs'] },
];
