/**
 * 抽取总装（`draw()` 的移植）。
 *
 * ⚠️ 顺序是踩过坑定下来的，任何"优化"都会改变 RNG 消耗序列，进而破掉与插件的
 * 逐字对拍：
 *   pre_place → pre_outfit → pre_hands → 主循环 → 法典场景 → 角色 → 外貌/发型/胸围
 *   → 禁项复核 → sanitize → colorize → 密度二分（最多 8 轮）→ trim → 保底
 *   → collect → repair → 超档回滚。
 */
import {
  HAIR_LEN_TAGS,
  HAIR_PICK_AUTO,
  HAIR_STYLE_FIELDS,
  HAIR_TIE_TAGS,
  PARTNER_GATED_FIELDS,
  SOLO_OK_PARTNER_OPTS,
  MULTI_CLEAR_FIELDS,
  GROUP_ONLY_TAGS,
  applyAppearance,
  applyHairStyle,
  applySelectedRoles,
  blockedByWeight,
  charFeatFor,
  countHasPartner,
  countIsGroup,
  appearanceFor,
  expandRoles,
  girlCountFor,
  hairStyleFor,
  pickRandomRoles,
  parseSelectedRoles,
  stripRoleWorks,
} from "./characters";
import { collect } from "./collect";
import {
  eligibleOptions,
  effectiveLevel as effectiveLevelImpl,
  fieldByKey,
  fieldValueNum,
  levelLabel,
  optionLevel,
  resolveLevel,
  tagLevel,
  targetNum,
} from "./levels";
import { bansFor, biasFor, handSlot, handSlotState } from "./link";
import {
  allowedOutfit,
  colorize,
  fieldOptionBias,
  layerBias,
  resolveChoice,
  styleBans,
  styleBias,
} from "./outfitStyle";
import { clampProb, deriveSeed, pyRound, WardrobeRandom } from "./rng";
import { repairTags } from "./repair";
import { sanitize } from "./sanitize";
import {
  applyBans,
  applyPreset,
  canon,
  canonPoolForDraw,
  sceneLevelLayered,
  sceneSaysNoRole,
  sceneIndex,
  tagCapFor,
  tagWindow,
  trimToCap,
} from "./scenes";
import { FIELD_SLOT } from "./slots";
import { requireWardrobeData } from "./store";
import type { WardrobeDrawInput, WardrobeDrawResult, WardrobeDrawnItem, WardrobeWeights } from "./types";
import {
  DEFAULT_BASE_PROB,
  emptyWeights,
  fieldWeight,
  optionWeight,
  parseWeights,
  sectionWeight,
  validateWeights,
  WEIGHT_MAX,
  weightedPick,
  weightStats,
} from "./weights";

type Pick3 = [zh: string, en: string, num: number];
type Drawn5 = [field: string, zh: string, en: string, num: number, weight: number];

const LEVEL_FLOOR_ORDER = [
  "n_act",
  "n_pos",
  "n_orgasm",
  "n_cum",
  "n_theme",
  "pose_risque",
  "n_exposure",
  "n_state",
  "n_body",
  "n_fabric",
  "cloth_state_sfw",
];

const SCENE_APPEAR_P = 0.12;
const SCENE_ALWAYS = false;

function has(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function enabledOrDefault(value: string[] | null | undefined): Set<string> {
  if (value === null || value === undefined) {
    return new Set(requireWardrobeData("pools").sections.map((s) => s.id));
  }
  return new Set(value);
}

export function draw(input: WardrobeDrawInput = {}): WardrobeDrawResult {
  const weights: WardrobeWeights = input.weights ? parseWeights(input.weights) : emptyWeights();
  const levelKey = resolveLevel(input.level ?? "suggestive");
  const lv = targetNum()[levelKey] ?? 1;
  const locks = new Set(input.locks ?? []);
  const forced: Record<string, string> = { ...(input.forced ?? {}) };
  const notes: string[] = [];
  const seeded = input.seed !== null && input.seed !== undefined && Number(input.seed) >= 0;
  const seed = seeded ? Math.trunc(Number(input.seed)) : undefined;

  const baseProb =
    typeof input.baseProb === "number" && Number.isFinite(input.baseProb) && input.baseProb > 0
      ? input.baseProb
      : DEFAULT_BASE_PROB;
  const rawCap = input.tagCap;
  const autoCap =
    rawCap === undefined || rawCap === null || rawCap === "自动" || String(rawCap).trim() === "";
  const fixedCap = autoCap ? 0 : Math.trunc(Number(rawCap)) || 0;

  const enabled = enabledOrDefault(input.enabledSections);
  if (!enabled.has("count")) notes.push("①数量与身份段已关闭 —— 正文不含人数标签，请确认上游是否补齐");

  const badWeights = validateWeights(weights);
  if (badWeights.length) notes.push(...badWeights.slice(0, 6));

  const selectedRaw = typeof input.selectedRoles === "string"
    ? parseSelectedRoles(input.selectedRoles)
    : (input.selectedRoles ?? []);
  const selectedRoles = selectedRaw.filter(Boolean);
  const forceRole = String(input.forceRole ?? "").trim();
  const roleFavOnly = Boolean(input.roleFavOnly);
  const favorites = input.favorites ?? [];
  const favoritesCount = favorites.length;
  const appearanceFollow = input.appearanceFollow !== false;
  const hairFollow = input.hairFollow !== false;
  const hairPicks = input.hairPicks ?? {};
  const outfitStyle = input.outfitStyle ?? "随机";
  const worksFilter = input.roleWorks
    ? Array.isArray(input.roleWorks)
      ? input.roleWorks
      : String(input.roleWorks).split(/[|;\n,，]/).map((s) => s.trim()).filter(Boolean)
    : [];
  const worksResolved = worksFilter.length
    ? (() => {
        const known = new Set<string>();
        for (const work of requireWardrobeData("characters").works) {
          for (const key of [work.id, work.en, work.zh]) known.add(String(key ?? "").toLowerCase());
        }
        return worksFilter.map((raw) => {
          const key = raw.trim().toLowerCase();
          const match = requireWardrobeData("characters").works.find(
            (w) => w.id.toLowerCase() === key || w.en.toLowerCase() === key || w.zh.toLowerCase() === key,
          );
          return match?.id ?? (known.has(key) ? key : "");
        }).filter(Boolean);
      })()
    : [];
  if (worksFilter.length && worksResolved.length === 0) {
    notes.push(`⚠️ 作品串没认出来：\`${worksFilter.join("|")}\`（可用作品 slug / 英文名 / 中文名）`);
  }

  const sceneCoin = new WardrobeRandom(
    deriveSeed(seeded ? seed! : Math.floor(Math.random() * 0x3fffffff) + 1, "scene_level", 0),
  ).random();
  const variantSeed = seeded ? seed! : Math.floor(Math.random() * 0x3fffffff) + 1;
  const variantPick = seeded
    ? new WardrobeRandom(deriveSeed(seed!, "variant", 0)).random()
    : Math.random();

  let rng = seeded ? new WardrobeRandom(seed!) : new WardrobeRandom();

  const onePass = (
    passRng: WardrobeRandom,
    effP: number,
    variantPickValue: number | undefined,
    variantSeedValue: number,
  ): [Record<string, unknown>, Drawn5[], string[]] => {
    const st: Record<string, unknown> = {};
    const dr: Drawn5[] = [];
    const nt: string[] = [];
    const pre = new Map<string, Pick3>();
    const F = forced;
    const preRng = passRng.clone();

    const prePlace = () => {
      const key = "place";
      const found = fieldByKey(key);
      if (!found) return;
      const { section, field } = found;
      if (!enabled.has(section) || locks.has(key)) return;
      if (has(F, key)) {
        const en = F[key];
        const zh = (field.opts ?? []).find(([, e]) => e === en)?.[0] ?? en;
        pre.set(key, [zh, en, optionLevel(key, en)]);
        st[key] = en;
        return;
      }
      const sw = sectionWeight(weights, section);
      const fw = fieldWeight(weights, key);
      if (sw <= 0 || fw <= 0) return;
      const pool = eligibleOptions(key, lv);
      if (!pool.length) return;
      if (!(field.req || fw >= WEIGHT_MAX)) {
        if (!(passRng.random() < clampProb(effP * sw * fw))) return;
      }
      const pick = weightedPick(passRng, pool, (it) =>
        optionWeight(weights, key, it[1]) * sw * fw * fieldOptionBias(key, outfitStyle, it[1]),
      );
      if (!pick) return;
      pre.set(key, pick);
      st[key] = pick[1];
    };

    const preOutfit = () => {
      for (const key of ["outfit", "top", "bottom"]) {
        if (has(st, key) || locks.has(key)) continue;
        const found = fieldByKey(key);
        if (!found) continue;
        const { section, field } = found;
        if (!enabled.has(section)) continue;
        if (has(F, key)) {
          const en = F[key];
          const zh = (field.opts ?? []).find(([, e]) => e === en)?.[0] ?? en;
          pre.set(key, [zh, en, optionLevel(key, en)]);
          st[key] = en;
          continue;
        }
        const sw = sectionWeight(weights, section);
        const fw = fieldWeight(weights, key);
        if (sw <= 0 || fw <= 0) continue;
        let pool = eligibleOptions(key, lv);
        if (key === "outfit") pool = allowedOutfit(pool, outfitStyle);
        const sbans = styleBans(st, key, outfitStyle);
        if (sbans.size) {
          const kept = pool.filter((it) => !sbans.has(it[1]));
          if (kept.length) pool = kept;
        }
        if (!pool.length) continue;
        const lb = layerBias(st, key, outfitStyle);
        if (!(field.req || fw >= WEIGHT_MAX)) {
          if (!(preRng.random() < clampProb(effP * sw * fw * lb))) continue;
        }
        const pick = weightedPick(preRng, pool, (it) =>
          optionWeight(weights, key, it[1]) * sw * fw * styleBias(st, key, it[1], outfitStyle),
        );
        if (!pick) continue;
        pre.set(key, pick);
        st[key] = pick[1];
      }
    };

    const preHands = () => {
      for (const key of ["arms_hands", "pose_risque"]) {
        if (has(st, key) || locks.has(key)) continue;
        const found = fieldByKey(key);
        if (!found) continue;
        const { section, field } = found;
        if (!enabled.has(section)) continue;
        if (has(F, key)) {
          const en = F[key];
          const zh = (field.opts ?? []).find(([, e]) => e === en)?.[0] ?? en;
          pre.set(key, [zh, en, optionLevel(key, en)]);
          st[key] = en;
          continue;
        }
        const sw = sectionWeight(weights, section);
        const fw = fieldWeight(weights, key);
        if (sw <= 0 || fw <= 0) continue;
        let pool = eligibleOptions(key, lv);
        if (!pool.length) continue;
        const bans = new Set([...bansFor(st, key), ...styleBans(st, key, outfitStyle)]);
        if (bans.size) {
          const kept = pool.filter((it) => !bans.has(it[1]));
          if (kept.length && kept.length !== pool.length) {
            nt.push(`上肢单槽：${field.lab || key} 剔除 ${pool.length - kept.length} 项（手已被占用）`);
            pool = kept;
          }
        }
        const take = field.req || fw >= WEIGHT_MAX
          ? true
          : preRng.random() < clampProb(effP * sw * fw * layerBias(st, key, outfitStyle));
        if (!take) continue;
        const pick = weightedPick(preRng, pool, (it) =>
          optionWeight(weights, key, it[1]) *
          sw *
          fw *
          biasFor(st, key, it[1]) *
          styleBias(st, key, it[1], outfitStyle) *
          fieldOptionBias(key, outfitStyle, it[1]),
        );
        if (!pick) continue;
        pre.set(key, pick);
        st[key] = pick[1];
      }
    };

    prePlace();
    preOutfit();
    preHands();

    for (const section of requireWardrobeData("pools").sections) {
      if (!enabled.has(section.id)) continue;
      const sw = sectionWeight(weights, section.id);
      if (sw <= 0) continue;
      for (const field of section.fields) {
        const key = field.key;
        if (key === "role") continue;
        if (locks.has(key)) continue;
        if (pre.has(key)) {
          const [zh, en, num] = pre.get(key)!;
          st[key] = en;
          dr.push([key, zh, en, num, optionWeight(weights, key, en)]);
          continue;
        }
        if (has(F, key)) {
          st[key] = F[key];
          continue;
        }
        if (field.type === "text" || !field.opts?.length) continue;

        const fw = fieldWeight(weights, key);
        if (fw <= 0) continue;

        let pool = eligibleOptions(key, lv);
        if (
          PARTNER_GATED_FIELDS.includes(key) &&
          !(selectedRoles.length || forceRole) &&
          !countHasPartner(String(st.count ?? ""))
        ) {
          const kept = pool.filter((it) => SOLO_OK_PARTNER_OPTS.has(String(it[1]).trim().toLowerCase()));
          if (kept.length !== pool.length) {
            nt.push(`人数相容：${field.lab || key} 剔除 ${pool.length - kept.length} 项需要伴侣的选项（当前 solo）`);
            pool = kept;
          }
          if (!pool.length) continue;
        }
        if (key === "outfit") pool = allowedOutfit(pool, outfitStyle);
        if (key === "n_canon") {
          pool = canonPoolForDraw(pool, lv, weights);
          const [layered, note] = sceneLevelLayered(pool, lv, weights, sceneCoin);
          pool = layered;
          if (note) nt.push(note);
        }
        if (!pool.length) continue;

        const bans = new Set([...bansFor(st, key), ...styleBans(st, key, outfitStyle)]);
        if (bans.size) {
          const kept = pool.filter((it) => !bans.has(it[1]));
          if (kept.length && kept.length !== pool.length) {
            nt.push(`联动：${field.lab || key} 剔除 ${pool.length - kept.length} 项矛盾的候选`);
            pool = kept;
          }
        }

        let take: boolean;
        if (field.req || fw >= WEIGHT_MAX) take = true;
        else if (key === "n_canon" && lv >= 1) {
          take = SCENE_ALWAYS ? true : passRng.random() < SCENE_APPEAR_P;
        } else if (
          (key === "outfit" || key === "makeup") &&
          !["", "auto"].includes(resolveChoice(outfitStyle))
        ) {
          take = true;
        } else {
          take = passRng.random() < clampProb(effP * sw * fw * layerBias(st, key, outfitStyle));
        }
        if (!take) continue;

        const pick = weightedPick(passRng, pool, (it) =>
          optionWeight(weights, key, it[1]) *
          sw *
          fw *
          biasFor(st, key, it[1]) *
          styleBias(st, key, it[1], outfitStyle) *
          fieldOptionBias(key, outfitStyle, it[1]),
        );
        if (!pick) {
          nt.push(`字段「${field.lab}」候选权重全为 0，本次未抽取`);
          continue;
        }
        st[key] = pick[1];
        dr.push([key, pick[0], pick[1], pick[2], optionWeight(weights, key, pick[1])]);
      }
    }

    const presetId = String(st.n_canon ?? "");
    if (presetId && canon().has(presetId)) {
      const fl = new Set<string>([...locks, ...Object.keys(forced)]);
      if (!["", "auto"].includes(resolveChoice(outfitStyle))) fl.add("outfit");
      const filled = applyPreset(st, presetId, lv, weights, fl, passRng, variantPickValue, variantSeedValue);
      if (filled.length) nt.push(`已应用法典场景：${filled.join("、")}`);
    }

    const sel = expandRoles(selectedRoles);
    let triggers: string[] = [];
    let autoRole = false;
    if (forceRole) {
      triggers = expandRoles([forceRole]);
      if (sel.length) nt.push("手填角色已覆盖角色库里的选择");
    } else if (sel.length) {
      triggers = sel;
    } else if (locks.has("role")) {
      nt.push("角色字段已锁定 → 不自动抽角色（特写搭配用这招把画框锁在局部）");
    } else if (sceneSaysNoRole(st.n_canon)) {
      nt.push("场景声明「画框里没有脸」→ 不自动抽角色（角色名会把镜头拉回面部）；要角色请在面板里显式选择");
    } else {
      const want = girlCountFor(String(st.count ?? ""));
      let got = pickRandomRoles(passRng, lv, want, worksResolved, roleFavOnly, favorites);
      if (!got.length && roleFavOnly && worksResolved.length) {
        got = pickRandomRoles(passRng, lv, want, [], true, favorites);
        if (got.length) nt.push(`⚠️ 指定作品 ∩ 收藏为空 → 已退化为「只在收藏内」随机（${got.length} 位）`);
      }
      if (!got.length && roleFavOnly) {
        got = pickRandomRoles(passRng, lv, want, worksResolved, false, favorites);
        if (!got.length && worksResolved.length) got = pickRandomRoles(passRng, lv, want);
        if (got.length) {
          nt.push(
            "⚠️ 收藏池在当前档位没有可用角色" +
              (favoritesCount === 0 ? "（收藏 0 位）" : `（收藏 ${favoritesCount} 位）`) +
              ` → 已回退到普通随机（${got.length} 位）`,
          );
        }
      }
      if (!got.length && worksResolved.length) {
        got = pickRandomRoles(passRng, lv, want);
        if (got.length) nt.push(`⚠️ 指定的作品在当前档位下没有可用角色 → 已回退全库随机（${got.length} 位）`);
      }
      if (got.length) {
        triggers = got;
        autoRole = true;
        const src = worksResolved.length && roleFavOnly
          ? `作品 ${worksResolved.map((w) => `\`${w}\``).join("/")} ∩ 收藏`
          : worksResolved.length
            ? `作品 ${worksResolved.map((w) => `\`${w}\``).join("/")}`
            : roleFavOnly
              ? "收藏"
              : "全库";
        nt.push(`未选角色 → 从${src}按人数组合抽了 ${got.length} 位：${got.map((g) => `\`${g}\``).join("、")}`);
      }
    }

    if (triggers.length) {
      // ⚠️ 与插件逐字对齐：Python 这里读的是**外层** `state`（在一次抽取内始终是
      //    空 dict，best-of-8 结束后才赋值），所以 `_count_locked` 恒为 False，
      //    选中角色总会改写人数标签。虽然注释声称要保护场景 count_lock，
      //    但实现没生效 —— 我们选择复刻实现，保证同 seed 同结果。
      nt.push(...applySelectedRoles(st, triggers, lv, !autoRole));
      st._role_count = triggers.length;
    }

    if (st.role) {
      if (triggers.length >= 2) {
        st._appearance = "multi";
        nt.push("多位角色：已跳过外貌对齐（各自保留官方特征）");
      } else if (!appearanceFollow) {
        st._appearance = "off";
        nt.push("角色外貌对齐已关闭 —— 发色/瞳色按随机与权重决定");
      } else if (!Object.keys(appearanceFor(String(st.role))).length) {
        st._appearance = "nodata";
        nt.push("该角色没有外貌数据（不在 APPEAR 表，角色库里也没特征 tags）—— 发色瞳色交给模型自己认");
      } else {
        const changed = applyAppearance(st, weights);
        st._appearance = changed.length ? "applied" : "blocked";
        if (changed.length) nt.push(`角色外貌已对齐（会覆盖发色/瞳色等选项权重）：${changed.join("、")}`);
      }
    }

    if (st.role) {
      const hp = hairPicks;
      const explicit = HAIR_STYLE_FIELDS.some(
        (k) => ![HAIR_PICK_AUTO, ""].includes(String(hp[k] ?? HAIR_PICK_AUTO).trim()),
      );
      if (triggers.length >= 2) {
        st._hair_style = "multi";
      } else if (explicit) {
        const changed = applyHairStyle(st, weights, hp);
        st._hair_style = changed.length ? "picked" : "blocked";
        if (changed.length) nt.push(`发型按选择器指定：${changed.join("、")}`);
      } else if (!hairFollow) {
        st._hair_style = "off";
        nt.push("角色发型对齐已关闭 —— 发型按随机与权重决定");
      } else if (!Object.keys(hairStyleFor(String(st.role))).length) {
        st._hair_style = "nodata";
        nt.push("该角色没有官方发型数据 —— 发型交给随机");
      } else {
        const changed = applyHairStyle(st, weights);
        st._hair_style = changed.length ? "applied" : "blocked";
        if (changed.length) nt.push(`角色发型已对齐（长度 / 束法 / 卷度）：${changed.join("、")}`);
      }
    }

    const breast = String(input.breastSize ?? "").trim();
    const breastMap: Record<string, string> = {
      平胸: "flat chest",
      小胸: "small breasts",
      中等: "medium breasts",
      大胸: "large breasts",
      巨乳: "huge breasts",
      爆乳: "gigantic breasts",
    };
    const breastEn = breastMap[breast];
    if (breastEn) {
      st.figure = breastEn;
      st._breast_size = breastEn;
      nt.push(`胸部大小：身材轮廓锁定为「${breast}」（${breastEn}）`);
    } else if (input.bigBreasts) {
      st.figure = "huge breasts";
      st._big_breasts = true;
      nt.push("巨乳开关：身材轮廓锁定为「巨乳」（huge breasts）（旧版开关兼容，建议改用「胸部大小」下拉）");
    }

    const ban2 = applyBans(st, presetId);
    if (ban2.length) nt.push(`禁项·参数复核后清空：${ban2.join("、")}`);

    const cleared = sanitize(st);
    if (cleared.length) nt.push(`互斥消解清空：${cleared.join("、")}`);

    for (const n of colorize(st)) nt.push(n);
    return [st, dr, nt];
  };

  const collectWithFeat = (st: Record<string, unknown>, extraBody: string): string[] => {
    let eb = extraBody;
    if (appearanceFollow && Number(st._role_count ?? 1) < 2) {
      const [featRaw, drops, sets] = charFeatFor(String(st.role ?? ""), seed);
      let feat = featRaw;
      const explicit = new Set((st._hair_picks_explicit as string[] | undefined) ?? []);
      if (feat.length && explicit.has("hair_len")) feat = feat.filter((x) => !HAIR_LEN_TAGS.has(x));
      if (feat.length && explicit.has("hair_tie")) feat = feat.filter((x) => !HAIR_TIE_TAGS.has(x));
      if (feat.length) {
        eb = eb.trim() ? `${eb.trim()}, ${feat.join(", ")}` : feat.join(", ");
        st._char_feat = feat.join(", ");
      }
      for (const key of drops) {
        if (explicit.has(key)) continue;
        st[key] = "";
      }
      for (const [key, value] of Object.entries(sets)) st[key] = value;
    }
    return collect(st, eb);
  };

  const extraBody = String(input.extraBody ?? "");
  let best:
    | {
        sc: number[];
        state: Record<string, unknown>;
        drawn: Drawn5[];
        stepNotes: string[];
        tags: string[];
        cap: number;
      }
    | null = null;
  const densityNotes: string[] = [];
  let rLo = 0.05;
  let rHi = 1.8;
  let ratio = 1;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt === 0) rng = seeded ? new WardrobeRandom(seed!) : new WardrobeRandom();
    else {
      rng = new WardrobeRandom(deriveSeed(seeded ? seed! : Math.random(), "density", attempt));
    }
    const effP = clampProb(baseProb * ratio);
    const [state, drawn, stepNotes] = onePass(rng, effP, variantPick, variantSeed);
    const cap = autoCap ? tagCapFor(String(state.count ?? "")) : fixedCap;
    const tags = collectWithFeat(state, extraBody);
    const n = repairTags(tags, lv)[0].length;

    if (!autoCap) {
      best = { sc: [0, 0], state, drawn, stepNotes, tags, cap };
      break;
    }

    const [lo, hi] = tagWindow(String(state.count ?? ""));
    const score = lo <= n && n <= hi ? 0 : n < lo ? lo - n : n - hi;
    const hasScene = Boolean(state.n_canon);
    const sc = lv <= 0 ? [score, hasScene ? 0 : 1] : [hasScene ? 0 : 1, score];
    if (
      best === null ||
      sc[0] < best.sc[0] ||
      (sc[0] === best.sc[0] && sc[1] < best.sc[1])
    ) {
      best = { sc, state, drawn, stepNotes, tags, cap };
    }
    if (score === 0 && (lv <= 0 || hasScene)) break;

    const target = Math.floor((lo + hi) / 2);
    if (n < target) rLo = ratio;
    else rHi = ratio;
    const newRatio = pyRound((rLo + rHi) / 2, 3);
    if (Math.abs(newRatio - ratio) < 1e-3) break;
    ratio = newRatio;
    densityNotes.push(`标签数 ${n}（目标 ${lo}–${hi}）→ 密度 ${ratio} 再试`);
  }

  if (!best) throw new Error("draw 没有产生任何候选结果");
  const chosen = best as {
    sc: number[];
    state: Record<string, unknown>;
    drawn: Drawn5[];
    stepNotes: string[];
    tags: string[];
    cap: number;
  };
  const state = chosen.state;
  const cap = chosen.cap;
  notes.push(...densityNotes);
  notes.push(...chosen.stepNotes);

  const dropped = trimToCap(state, cap, weights);

  const floor = ensureLevelFloor(
    state,
    lv,
    weights,
    new Set([...locks, ...Object.keys(forced)]),
    String(state.n_canon ?? ""),
    new WardrobeRandom(deriveSeed(variantSeed, "level_floor", lv)),
  );
  if (floor.length) {
    notes.push(...floor);
    const clearedAfterFloor = sanitize(state);
    if (clearedAfterFloor.length) notes.push(`保底后消解：${clearedAfterFloor.join("、")}`);
    if (floor[0].includes("补 `") && effectiveLevelOf(state) < lv) {
      notes.push(`高等级保底失效：补的锚点被互斥消解清掉，本张实际 L${effectiveLevelOf(state)} < 选 L${lv}`);
    }
  }

  let tags = collectWithFeat(state, extraBody);
  const [repairedTags, fixNotes] = repairTags(tags, lv);
  tags = repairedTags;

  state._weights_tuned = weightStats(weights).total;

  let report = checkAdmission(tags, state, lv);
  let tries = 0;
  while (report.over_level && tries < (input.maxRetry ?? 8) && Object.keys(forced).length === 0) {
    tries += 1;
    for (const key of report.over_fields) delete state[key];
    for (const key of report.over_fields) {
      const pool = eligibleOptions(key, lv);
      if (!pool.length) continue;
      const pick = weightedPick(rng, pool, (it) => optionWeight(weights, key, it[1]));
      if (pick) state[key] = pick[1];
    }
    tags = collectWithFeat(state, extraBody);
    const [fixed, moreFix] = repairTags(tags, lv);
    tags = fixed;
    for (const note of moreFix) if (!fixNotes.includes(note)) fixNotes.push(note);
    report = checkAdmission(tags, state, lv);
  }
  if (tries) notes.push(`超档回滚 ${tries} 轮`);
  if (fixNotes.length) {
    notes.push(`成品自动修复 ${fixNotes.length} 项：${fixNotes.slice(0, 8).join("；")}${fixNotes.length > 8 ? "…" : ""}`);
  }

  const outTags = stripRoleWorks(tags, state);
  const outText = outTags.join(", ");
  const drawnItems: WardrobeDrawnItem[] = chosen.drawn.map(([field, zh, en, num, weight]) => ({
    field,
    zh,
    en,
    level: num,
    weight: pyRound(weight, 2),
  }));

  return {
    text: outText,
    state,
    level: levelKey,
    level_num: lv,
    level_label: levelLabel(levelKey),
    cap,
    report: {
      over_level: report.over_level,
      over_fields: report.over_fields,
      notes,
      drawn: drawnItems,
      dropped,
      seeded,
      repaired: fixNotes,
      role_full: ((state._role_triggers as string[] | undefined) ?? []).map(String),
    },
    notes,
    dropped,
    cn_summary: "",
    tags: outTags,
  };
}

/* ------------------------------------------------------------------ *
 * 高等级保底
 * ------------------------------------------------------------------ */

export function levelFloorCandidates(fieldKey: string, lv: number, state: Record<string, unknown>): Array<[string, string]> {
  const found = fieldByKey(fieldKey);
  if (!found) return [];
  const count = String(state.count ?? "");
  const solo = !countHasPartner(count);
  const multi = girlCountFor(count) >= 2;
  const bans = bansFor(state, fieldKey);
  const out: Array<[string, string]> = [];
  const handSlots = handSlot();
  const holders = Object.keys(handSlotState(state)).length > 0;

  for (const [zh, en] of found.field.opts ?? []) {
    if (bans.has(en)) continue;
    if (tagLevel(en) !== lv) continue;
    if (optionLevel(fieldKey, en) > lv) continue;
    if (handSlots[fieldKey]?.includes(en) && holders) continue;
    const low = String(en).trim().toLowerCase();
    if (MULTI_CLEAR_FIELDS.includes(fieldKey) && multi) continue;
    if (solo && PARTNER_GATED_FIELDS.includes(fieldKey) && !SOLO_OK_PARTNER_OPTS.has(low)) continue;
    if (GROUP_ONLY_TAGS.has(low) && !countIsGroup(count)) continue;
    out.push([zh, en]);
  }
  return out;
}

function effectiveLevelOf(state: Record<string, unknown>): number {
  return effectiveLevelImpl(state);
}

export function ensureLevelFloor(
  state: Record<string, unknown>,
  lv: number,
  weights: WardrobeWeights,
  locks: Set<string>,
  presetId: string,
  rng: WardrobeRandom,
): string[] {
  if (lv <= 0) return [];
  const real = effectiveLevelImpl(state);
  if (real >= lv) return [];
  const dropped = new Set(sceneIndex().get(String(presetId ?? ""))?.drop_fields ?? []);
  const tried: string[] = [];
  for (const key of LEVEL_FLOOR_ORDER) {
    if (locks.has(key) || dropped.has(key)) continue;
    if (blockedByWeight(weights, key)) continue;
    const found = fieldByKey(key);
    if (!found) continue;
    const cands = levelFloorCandidates(key, lv, state);
    if (!cands.length) {
      tried.push(key);
      continue;
    }
    const pick = weightedPick(rng, cands, (it) => Math.max(0, optionWeight(weights, key, it[1])));
    const chosen = pick ?? cands[0];
    state[key] = chosen[1];
    return [`高等级保底：实际 L${real} < 选 L${lv}，补 \`${found.field.lab || key}\` = ${chosen[0]}（${chosen[1]}）`];
  }
  return [
    `高等级保底：实际 L${real} < 选 L${lv}，但无可用载体（已锁 / 已闭麦：${tried.join("、") || "全部字段"}）—— 本张会低于所选档`,
  ];
}

export function checkAdmission(
  tags: readonly string[],
  state: Record<string, unknown>,
  lv: number,
): { over_level: boolean; over_fields: string[] } {
  void tags;
  const over = Object.entries(state)
    .filter(([key, value]) => !key.startsWith("_") && value && FIELD_SLOT[key] && fieldValueNum(key, String(value)) > lv)
    .map(([key]) => key)
    .sort();
  return { over_level: over.length > 0, over_fields: over };
}
