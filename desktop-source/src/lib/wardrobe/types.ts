/**
 * 造型台的数据类型。
 *
 * 与 `src/types.ts` 的分工：这里只描述「插件数据的形状」，不参与 App 的持久化
 * 参数类型；UI 状态（权重、锁定、选中角色…）也放这里，避免污染全局类型。
 */

export type WardrobeLevelKey =
  | "sfw"
  | "suggestive"
  | "explicit"
  | "hardcore"
  | "extreme"
  | "any";

export type WardrobeSlot =
  | "count"
  | "character"
  | "appearance"
  | "clothing"
  | "pose"
  | "expression"
  | "camera"
  | "scene"
  | "lighting"
  | "detail"
  | "free";

export type WardrobeFieldOption = [zh: string, en: string];

export type WardrobeField = {
  key: string;
  lab: string;
  req: boolean;
  type: "select" | "text" | "preset" | string;
  tail: boolean;
  opts?: WardrobeFieldOption[];
};

export type WardrobeSection = {
  id: string;
  title: string;
  open?: boolean;
  cls?: string;
  fields: WardrobeField[];
};

export type WardrobeMutexRule = { source: string; flags: string };

export type WardrobeMutexGroup = { id: string; a: WardrobeMutexRule; b: WardrobeMutexRule };

export type WardrobeAppear = {
  hair?: string;
  eyes?: string;
  skin?: string;
  figure?: string;
};

export type WardrobePools = {
  _meta: { schema?: string; [key: string]: unknown };
  sections: WardrobeSection[];
  canon: Record<string, Record<string, string>>;
  appear: Record<string, WardrobeAppear>;
  mutex_groups: WardrobeMutexGroup[];
};

export type WardrobeLevels = {
  _meta: { poolsSha256?: string; [key: string]: unknown };
  section_max: Record<string, number>;
  section_floor: Record<string, number>;
  canon_levels: Record<string, number>;
  tag_levels: Record<string, number>;
  option_levels: Record<string, Record<string, number>>;
};

export type WardrobeNsfwTable = {
  label: string;
  level: number;
  tags: string[];
  patterns: string[];
};

export type WardrobeNsfwTables = {
  _meta: Record<string, unknown>;
  levels: string[];
  levelZh: Record<string, string>;
  levelRank: Record<string, number>;
  targetNum: Record<string, number>;
  numOf: Record<string, number>;
  levelAlias: Record<string, string>;
  nsfwMax: number;
  nsfwLabel: Record<string, string>;
  nsfwKeyOfNum: Record<string, string>;
  scale: Array<{ num: number; key: string; zh: string; desc: string }>;
  exactOnly: string[];
  explicitTags: string[];
  explicitExceptions: string[];
  explicitPatterns: string[];
  suggestiveTags: string[];
  tables: Record<string, WardrobeNsfwTable>;
  hardcoreCategories: string[];
  extremeCategories: string[];
  categoryOrder: string[];
};

export type WardrobeOverrideRow = {
  field: string;
  en: string;
  level: number;
  why: string;
};

export type WardrobeOverrides = {
  _meta: Record<string, unknown>;
  sectionFloor: Record<string, number>;
  levelDemote: WardrobeOverrideRow[];
  levelRaise: WardrobeOverrideRow[];
};

export type WardrobeStyleInfo = { key: string; zh: string };

export type WardrobeOutfitStyle = {
  _meta: Record<string, unknown>;
  styles: WardrobeStyleInfo[];
  styleChoices: string[];
  styleOf: Record<string, Record<string, string>>;
  styleBans: Array<{ style: string; field: string; tags: string[] }>;
  styleCompat: Array<{ a: string; b: string; factor: number }>;
  styleMakeup: Record<string, Record<string, number> | string[]>;
  styleColor: Record<string, string[]>;
  styleSceneBias: Record<string, Record<string, string[]>>;
  styleOutfitPrefer: Array<{ a: string; b: string; factor: number }>;
  placeStyle: Record<string, string>;
  anchorBans: Array<{ anchor: string; field: string; tags: string[] }>;
  outfitPartial: string[];
  colorTags: string[];
  colorZh: Record<string, string>;
  sockColorTargets: string[];
  bodyColorTargets: string[];
  constants: Record<string, number>;
};

export type WardrobeLink = {
  _meta: Record<string, unknown>;
  actPosBan: Record<string, string[]>;
  emotionBan: Record<string, Record<string, string[]>>;
  placeTheme: Record<string, string>;
  themeWeight: Record<string, Record<string, Record<string, number>>>;
  themeBan: Record<string, Record<string, string[]>>;
  handAll: string[];
  handSlot: Record<string, string[]>;
  handOrder: string[];
  handPriority: Record<string, number>;
};

export type WardrobeCharacter = {
  tag: string;
  name: string;
  zh?: string;
  work: string;
  trigger: string;
  pop: number;
  hair?: string;
  eyes?: string;
  tags?: string[];
  src?: string;
  thumb: string;
};

export type WardrobeWork = {
  id: string;
  en: string;
  zh: string;
  count: number;
  pop: number;
  target?: boolean;
};

export type WardrobeCharacters = {
  _meta: Record<string, unknown>;
  works: WardrobeWork[];
  characters: WardrobeCharacter[];
};

/** 角色覆盖层：edits 按 tag 打补丁，custom 整条追加（插件的 user_characters.json）。 */
export type WardrobeUserCharacters = {
  _meta?: Record<string, unknown>;
  edits: Record<string, Partial<WardrobeCharacter> & { tags?: string[] }>;
  custom: WardrobeCharacter[];
};

export type WardrobeScene = {
  id: string;
  zh: string;
  group: string;
  desc?: string;
  tags: Record<string, string>;
  extra?: string;
  level: number;
  theme?: string;
  count_lock?: string;
  drop_fields?: string[];
  random_fields?: Record<string, string[]>;
  random_variants?: unknown;
  manual_only?: boolean;
  ban_tags?: string[];
  no_role?: boolean;
  role_ok?: boolean;
  /** v4.4.2：场景级自然语言（不是 tag，repair 与自检要放行整句） */
  scene_nl?: string;
};

export type WardrobeScenes = {
  _meta: Record<string, unknown>;
  groups: Array<{ id: string; title: string; desc?: string }>;
  scenes: WardrobeScene[];
};

export type WardrobeColorCell = { tag: string; n: number; ok: boolean };

export type WardrobeColorMatrix = {
  _meta: Record<string, unknown>;
  matrix: Record<string, Record<string, WardrobeColorCell>>;
};

export type WardrobeHairStyle = {
  _meta: Record<string, unknown>;
  styles: Record<string, { hair_curl?: string; hair_len?: string; hair_tie?: string }>;
};

export type WardrobeCharFeat = {
  _meta: Record<string, unknown>;
  feats: Record<
    string,
    {
      note?: string;
      extras?: string[];
      drop?: string[];
      drop_reason?: string;
      set?: Record<string, string>;
      pick?: Record<string, string[]>;
    }
  >;
};

/** 场景推荐画幅（v5.0.1 旁挂表）：portrait / landscape / both。 */
export type WardrobeSceneAspect = "portrait" | "landscape" | "both";

export type WardrobeSceneAspects = {
  _meta?: Record<string, unknown>;
  aspects: Record<string, { a: WardrobeSceneAspect | string; why?: string }>;
};

/** 正文角色 tag（v5.0.11）：`{trigger: {out: "texas, arknights"}}`。 */
export type WardrobeCharOutputTags = {
  _meta?: Record<string, unknown>;
  tags: Record<string, { out: string; ref?: string; src?: string; posts?: number }>;
};

export type WardrobeCharAliases = {
  _meta?: Record<string, unknown>;
  aliases: Record<string, string>;
};

/** 角色服装预设（用户数据）：启用后锁死该角色的服装字段。 */
export type WardrobeOutfitSet = {
  id: string;
  zh?: string;
  level?: number;
  tags?: string[];
  fields?: Record<string, string>;
  drop?: string[];
  verified?: boolean;
  note?: string;
};

export type WardrobeOutfitRecord = {
  enabled?: string;
  list?: WardrobeOutfitSet[];
};

export type WardrobeCharacterOutfits = {
  _meta?: Record<string, unknown>;
  outfits: Record<string, WardrobeOutfitRecord>;
};

/** 用户编辑的服装预设（ui-state 里存的覆盖层）。 */
export type WardrobeOutfitStore = {
  version: 1;
  roles: Record<string, WardrobeOutfitRecord>;
};

/** 服装预设模板（六套日常），弹窗「一键模板」用。 */
export type WardrobeOutfitTemplate = {
  id: string;
  zh?: string;
  level?: number;
  tags?: string[];
  fields?: Record<string, string>;
  drop?: string[];
  verified?: boolean;
  note?: string;
};

export type WardrobeOutfitTemplates = {
  _meta?: Record<string, unknown>;
  outfits: WardrobeOutfitTemplate[];
};

/** 复杂词条的自然语言补充句：`{n_act: {"irrumatio": "整句"}}`。 */
export type WardrobeTermHints = Record<string, unknown>;

export type WardrobeManifest = {
  schema: string;
  source: {
    plugin: string;
    repo: string;
    version: string;
    license: string;
    poolsSha256?: string;
    poolsSha256Actual?: string;
  };
  counts: Record<string, number | unknown> & {
    characters: number;
    scenes: number;
    thumbs: number;
    thumbBytes: number;
  };
  levels: Array<{ num: number; key: string; zh: string; desc: string }>;
  missingThumbs: string[];
  files: Record<string, string>;
  derived: Record<string, string>;
};

/** 三层权重，与插件 weights_json 完全同构，可直接互通 */
export type WardrobeWeights = {
  sections: Record<string, number>;
  fields: Record<string, number>;
  options: Record<string, Record<string, number>>;
};

export type WardrobeApplyMode = "append" | "replace";

export type WardrobeHairPick = {
  hair_len: string;
  hair_tie: string;
  hair_curl: string;
  hair_acc: string;
};

/** 造型台结果 → 公共工作台（拼接台）的分区桶。 */
export type WardrobeWorkbenchSplit = Partial<
  Record<
    "quality" | "artist" | "character" | "clothing" | "background" | "pose" | "extra",
    string[]
  >
>;

export type WardrobeLastResult = {
  text: string;
  levelNum: number;
  cap: number;
  seed: number;
  tagCount: number;
  drawn: Array<{ field: string; zh: string; en: string; level: number; weight: number }>;
  dropped: string[];
  repaired: string[];
  notes: string[];
  /** 抽取时就按工作台分区拆好的桶；老存档没有，走词表兜底 */
  slots?: WardrobeWorkbenchSplit;
  at: number;
};

export type WardrobeUiState = {
  version: 1;
  level: Exclude<WardrobeLevelKey, "any">;
  seed: number;
  baseProb: number;
  tagCap: string;
  outfitStyle: string;
  breastSize: string;
  appearanceFollow: boolean;
  hairFollow: boolean;
  hairPicks: WardrobeHairPick;
  extraBody: string;
  weights: WardrobeWeights;
  locks: string[];
  forced: Record<string, string>;
  disabledSections: string[];
  selectedRoles: string[];
  roleWorks: string[];
  roleFavOnly: boolean;
  /** v4.1.0：这一抽要不要角色（压过 forceRole / selectedRoles） */
  rolePick: boolean;
  /** v5.0.1：是否随机抽取场景搭配（不勾 = 一条都不出） */
  scenePick: boolean;
  forceRole: string;
  applyMode: WardrobeApplyMode;
  qualityPrefix: boolean;
  lastResult?: WardrobeLastResult;
  ui: {
    view: "chars" | "scenes" | "presets";
    expanded: string[];
    openField?: string;
    charQuery: string;
    charWork: string;
    charFavOnly: boolean;
    charSort: "pop" | "name";
    charPageSize: number;
    sceneGroup: string;
    sceneQuery: string;
  };
};

export type WardrobeFavorites = {
  version: 1;
  characters: string[];
  scenes: string[];
  /** v5.0.4：作品 IP 收藏（值是作品 slug） */
  works: string[];
};

export type WardrobePreset = {
  id: string;
  name: string;
  createdAt: number;
  level: WardrobeUiState["level"];
  weights: WardrobeWeights;
  locks: string[];
  disabledSections: string[];
  selectedRoles: string[];
  outfitStyle: string;
  extraBody: string;
};

export type WardrobePresetStore = {
  version: 1;
  items: Record<string, WardrobePreset>;
};

export type WardrobeDrawInput = {
  level?: string;
  seed?: number | null;
  baseProb?: number;
  weights?: WardrobeWeights;
  enabledSections?: string[] | null;
  locks?: string[];
  tagCap?: string | number;
  forced?: Record<string, string>;
  forceRole?: string;
  extraBody?: string;
  maxRetry?: number;
  appearanceFollow?: boolean;
  selectedRoles?: string | string[];
  bigBreasts?: boolean;
  breastSize?: string;
  roleWorks?: string | string[];
  outfitStyle?: string;
  roleFavOnly?: boolean;
  /** v4.1.0：False = 一个角色都不抽（forceRole / selectedRoles 一并让路） */
  rolePick?: boolean;
  /** v5.0.1：True = 必抽一条场景；False = 一条都不出 */
  scenePick?: boolean;
  hairFollow?: boolean;
  hairPicks?: Record<string, string>;
  favorites?: string[];
};

export type WardrobeDrawnItem = {
  field: string;
  zh: string;
  en: string;
  level: number;
  weight: number;
};

export type WardrobeDrawResult = {
  text: string;
  state: Record<string, unknown>;
  level: WardrobeLevelKey;
  level_num: number;
  level_label: string;
  cap: number;
  report: {
    over_level: boolean;
    over_fields: string[];
    notes: string[];
    drawn: WardrobeDrawnItem[];
    dropped: string[];
    seeded: boolean;
    repaired: string[];
    role_full: string[];
  };
  notes: string[];
  dropped: string[];
  cn_summary: string;
  tags: string[];
};
