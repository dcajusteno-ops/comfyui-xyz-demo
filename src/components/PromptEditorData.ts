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
