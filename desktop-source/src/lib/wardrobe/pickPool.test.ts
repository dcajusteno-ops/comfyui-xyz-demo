import { beforeAll, describe, expect, it } from "vitest";
import { draw } from "./draw";
import { emptyWeights } from "./weights";
import { nearSlimProfile } from "./near";
import { sceneList } from "./scenes";
import { primeWardrobeData } from "./testData";

beforeAll(() => primeWardrobeData());

const nearScenes = () => sceneList().filter((scene) => scene.group === "near");
const poseScenes = () => sceneList().filter((scene) => scene.group === "pose");

describe("V6：勾选池", () => {
  it("同 seed 同一条；落成 forced.n_canon", () => {
    const ids = nearScenes().slice(0, 5).map((scene) => scene.id).join(",");
    const a = draw({ level: "sfw", seed: 42, weights: emptyWeights(), pickPoolMode: "near", pickPoolIds: ids });
    const b = draw({ level: "sfw", seed: 42, weights: emptyWeights(), pickPoolMode: "near", pickPoolIds: ids });
    expect(a.text).toBe(b.text);
    expect(ids.split(",")).toContain(String(a.state.n_canon));
    expect(a.notes.some((note) => note.includes("勾选池随机"))).toBe(true);
  });

  it("档位只升不降：L3 的条目会抬高整张图", () => {
    const l3 = nearScenes().filter((scene) => scene.level >= 3);
    expect(l3.length).toBeGreaterThan(0);
    const result = draw({
      level: "sfw",
      seed: 1,
      weights: emptyWeights(),
      pickPoolMode: "near",
      pickPoolIds: l3.map((scene) => scene.id).join(","),
    });
    expect(result.level_num).toBeGreaterThanOrEqual(3);
    expect(result.notes.some((note) => note.includes("只升不降"))).toBe(true);
  });

  it("特写模式连收紧取景一起做（人数钉死、角色让路）", () => {
    const scene = nearScenes().find((row) => nearSlimProfile(row)?.dropRole);
    expect(scene).toBeTruthy();
    const result = draw({
      level: "explicit",
      seed: 5,
      weights: emptyWeights(),
      pickPoolMode: "near",
      pickPoolIds: scene!.id,
    });
    expect(result.state.n_canon).toBe(scene!.id);
    expect(String(result.state.count ?? "")).toBe(scene!.count_lock || "1girl, solo");
    expect(result.notes.some((note) => note.includes("特写收紧取景"))).toBe(true);
  });

  it("非法 id 全过滤 → 忽略勾选池并写提示", () => {
    const result = draw({
      level: "sfw",
      seed: 2,
      weights: emptyWeights(),
      pickPoolMode: "pose",
      pickPoolIds: "nope,zzz",
    });
    expect(result.notes.some((note) => note.includes("全都不在场景库"))).toBe(true);
  });

  it("用户显式 forced.n_canon 优先于勾选池", () => {
    const pose = poseScenes()[0];
    const pinned = poseScenes()[1];
    const result = draw({
      level: "explicit",
      seed: 3,
      weights: emptyWeights(),
      forced: { n_canon: pinned.id },
      pickPoolMode: "pose",
      pickPoolIds: pose.id,
    });
    expect(result.state.n_canon).toBe(pinned.id);
  });
});
