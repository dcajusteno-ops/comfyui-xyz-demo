/**
 * 随机后的自相矛盾消解（`sanitize()` 的移植）。
 *
 * 返回被清掉/改写的字段 key（用于报告）。纪律：只清值、不重抽 ——
 * 与 drop_fields / ban_tags 同一条规矩，rng 消耗保持不变。
 */
import { GROUP_ONLY_TAGS, SOLO_OK_PARTNER_OPTS, PARTNER_GATED_FIELDS, countHasPartner, countIsGroup } from "./characters";
import { bansFor, handAll, handOrder, handSlot, handSlotState, handWinner } from "./link";

const NUDE_STATES = ["completely nude", "topless", "bottomless", "nude with accessories only"];
const TRUE_NUDE = ["completely nude", "nude with accessories only"];
const LOFI_DEVICES = ["selfie", "webcam footage", "security camera footage"];
const PRO_DOF = ["focus on face", "depth of field, blurry background"];

function sortedByOrder(keys: string[], order: string[]): string[] {
  return [...keys].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

export function sanitize(state: Record<string, unknown>): string[] {
  const cleared: string[] = [];
  let protectedFields = new Set((state._preset_fields as string[] | undefined) ?? []);

  const clear = (key: string) => {
    if (state[key]) {
      state[key] = "";
      cleared.push(key);
    }
  };

  /** 固定值 vs 随机值冲突：让随机那一侧退。 */
  const yieldRandom = (fixedKey: string, randomKey: string, convert?: string): boolean => {
    if (protectedFields.has(fixedKey) && !protectedFields.has(randomKey)) {
      if (convert) {
        state[randomKey] = convert;
        cleared.push(`${randomKey}(改为 ${convert})`);
      } else {
        clear(randomKey);
      }
      return true;
    }
    return false;
  };

  // ── 上肢单槽 ────────────────────────────────────────────────
  let holders = handSlotState(state);
  let extra = String(state.n_extra ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const allHands = handAll();
  const extraHand = extra.filter((t) => allHands.has(t));
  const order = handOrder();

  if (extraHand.length && Object.keys(holders).length) {
    for (const key of sortedByOrder(Object.keys(holders), order)) {
      if (protectedFields.has(key)) continue;
      state[key] = "";
      cleared.push(`${key}（上肢单槽，让位给 extra 的 ${extraHand.join(",")}）`);
    }
    const left = Object.keys(holders).filter((k) => protectedFields.has(k));
    if (left.length) {
      const slot = handSlot();
      const drop = new Set(
        extraHand.filter((tag) => left.some((key) => (slot[key] ?? []).includes(tag))),
      );
      if (drop.size) {
        extra = extra.filter((tag) => !drop.has(tag));
        state.n_extra = extra.join(", ");
        cleared.push(
          `n_extra（上肢单槽，去掉与 ${left.join("、")} 重复的 ${[...drop].sort().join(",")}）`,
        );
      }
    }
    holders = handSlotState(state);
  }

  if (Object.keys(holders).length > 1) {
    const winner = handWinner(state);
    for (const key of sortedByOrder(Object.keys(holders), order)) {
      if (key === winner) continue;
      state[key] = "";
      cleared.push(`${key}（上肢单槽，让位给 ${winner}）`);
    }
  }

  // ── 人数相容 ────────────────────────────────────────────────
  if (!countHasPartner(String(state.count ?? ""))) {
    for (const key of PARTNER_GATED_FIELDS) {
      const value = String(state[key] ?? "").trim();
      if (value && !SOLO_OK_PARTNER_OPTS.has(value.toLowerCase())) {
        state[key] = "";
        cleared.push(`${key}（\`${value}\` 需要伴侣，与当前人数不符）`);
      }
    }
  }

  if (!countIsGroup(String(state.count ?? ""))) {
    for (const key of ["n_theme", "n_cum"]) {
      const value = String(state[key] ?? "").trim().toLowerCase();
      if (GROUP_ONLY_TAGS.has(value)) {
        state[key] = "";
        cleared.push(`${key}（\`${value}\` 是三人以上才成立的元素，与当前人数不符）`);
      }
    }
  }

  // ── 服装 / 鞋袜 ─────────────────────────────────────────────
  if (NUDE_STATES.includes(String(state.n_state ?? ""))) {
    if (!yieldRandom("outfit", "n_state")) clear("outfit");
  }

  if (TRUE_NUDE.includes(String(state.n_state ?? ""))) {
    if (!yieldRandom("n_fabric", "n_state")) clear("n_fabric");
  }

  if (String(state.socks ?? "").includes("pantyhose") && state.shoes === "bare feet") {
    if (!yieldRandom("shoes", "socks")) {
      state.shoes = "high heels";
      cleared.push("shoes(改高跟鞋)");
    }
  }

  // ── 蒙眼 / 视线 / 景别 / 景深 ───────────────────────────────
  if (state.n_theme === "blindfold") {
    if (state.accessory === "glasses") clear("accessory");
    const orgasm = String(state.n_orgasm ?? "");
    if (orgasm.includes("heart-shaped pupils") || orgasm.includes("rolled back eyes")) {
      clear("n_orgasm");
    }
  }

  if (String(state.pose_base ?? "").includes("facing away") && state.eye_gaze === "looking at viewer") {
    clear("eye_gaze");
  }

  if (String(state.viewpoint ?? "").includes("pov") && state.shot_size === "full body") {
    if (!yieldRandom("shot_size", "viewpoint")) {
      state.shot_size = "cowboy shot";
      cleared.push("shot_size(改七分身)");
    }
  }

  if (LOFI_DEVICES.includes(String(state.device ?? "")) && PRO_DOF.includes(String(state.dof ?? ""))) {
    if (!yieldRandom("dof", "device")) clear("dof");
  }

  if (state.viewpoint === "from above" && state.eye_gaze === "looking up") {
    state.eye_gaze = "looking at viewer";
    cleared.push("eye_gaze(改注视镜头)");
  }
  if (state.viewpoint === "from below" && state.eye_gaze === "looking down") {
    state.eye_gaze = "looking at viewer";
    cleared.push("eye_gaze(改注视镜头)");
  }

  // ── 联动矛盾（抽取期看不见的那批）──────────────────────────
  protectedFields = new Set((state._preset_fields as string[] | undefined) ?? []);
  for (const fieldKey of Object.keys(state).filter((k) => !k.startsWith("_"))) {
    const value = state[fieldKey];
    if (!value || !bansFor(state, fieldKey).has(String(value))) continue;
    if (!protectedFields.has(fieldKey)) {
      clear(fieldKey);
      continue;
    }
    let moved = false;
    for (const candidate of ["place", "prop", "weather", "emotion", "n_act", "n_theme"]) {
      if (candidate === fieldKey || protectedFields.has(candidate) || !state[candidate]) continue;
      const saved = state[candidate];
      state[candidate] = "";
      if (!bansFor(state, fieldKey).has(String(value))) {
        cleared.push(`${candidate}（让位给场景固定值 ${fieldKey}）`);
        moved = true;
        break;
      }
      state[candidate] = saved;
    }
    if (!moved) cleared.push(`${fieldKey}（场景固定值，冲突时保留）`);
  }

  return cleared;
}
