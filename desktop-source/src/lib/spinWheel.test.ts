import { describe, expect, it } from "vitest";
import {
  CHECK_BADGE_UNITS,
  computeTargetRotation,
  measureLabelWidth,
  normalizeAngle,
  polarToCartesian,
  resolveWinnerIndex,
  sectorCenterAngle,
  sectorPath,
  truncateLabel,
  wheelLabelLayout,
  WHEEL_CENTER,
  WHEEL_HUB_R,
  WHEEL_OUTER_R,
} from "./spinWheel";
import { MAX_SECTORS } from "./luckyWheel";

/** 可复现随机源，避免单测因随机而抖动。 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 盘面最多能放多少个扇区 —— 几何断言要覆盖到上限，不能只测默认值。 */
const MAX_TEST_SECTORS = MAX_SECTORS;

describe("转盘几何：角度与极坐标", () => {
  it("极坐标以 12 点为 0°，顺时针为正", () => {
    expect(polarToCartesian(0, 0, 100, 0)).toEqual({ x: 0, y: -100 });
    const right = polarToCartesian(0, 0, 100, 90);
    expect(right.x).toBeCloseTo(100, 10);
    expect(right.y).toBeCloseTo(0, 10);
    const bottom = polarToCartesian(0, 0, 100, 180);
    expect(bottom.x).toBeCloseTo(0, 10);
    expect(bottom.y).toBeCloseTo(100, 10);
    const left = polarToCartesian(0, 0, 100, 270);
    expect(left.x).toBeCloseTo(-100, 10);
    expect(left.y).toBeCloseTo(0, 10);
  });

  it("归一化到 [0, 360)", () => {
    expect(normalizeAngle(-30)).toBe(330);
    expect(normalizeAngle(390)).toBe(30);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(-360)).toBe(0);
    expect(normalizeAngle(0)).toBe(0);
  });

  it("扇区中心角为 (i + 0.5) * 360/n", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => sectorCenterAngle(i, 6))).toEqual([30, 90, 150, 210, 270, 330]);
    expect([0, 1, 2, 3].map((i) => sectorCenterAngle(i, 4))).toEqual([45, 135, 225, 315]);
  });
});

describe("转盘几何：rotation 换算", () => {
  it("逆运算 resolveWinnerIndex 的定点值", () => {
    expect(resolveWinnerIndex(0, 6)).toBe(0);
    expect(resolveWinnerIndex(330, 6)).toBe(0);
    expect(resolveWinnerIndex(390, 6)).toBe(5);
    expect(resolveWinnerIndex(60, 6)).toBe(5);
    expect(resolveWinnerIndex(0, 1)).toBe(0);
    expect(resolveWinnerIndex(123, 0)).toBe(-1);
  });

  it("computeTargetRotation 的落点严格指向中奖扇区（往返一致性，核心防线）", () => {
    const random = mulberry32(20260928);
    for (let n = 2; n <= MAX_TEST_SECTORS; n += 1) {
      for (let winner = 0; winner < n; winner += 1) {
        for (let round = 0; round < 20; round += 1) {
          const prev = round * 137.5;
          const target = computeTargetRotation(prev, winner, n, { random });
          expect(resolveWinnerIndex(target, n)).toBe(winner);
        }
      }
    }
  });

  it("角度只向前累积，永不倒转", () => {
    const random = mulberry32(7);
    let current = 0;
    for (let i = 0; i < 50; i += 1) {
      const target = computeTargetRotation(current, i % 6, 6, { random });
      expect(target).toBeGreaterThan(current);
      expect(target - current).toBeGreaterThanOrEqual(360);
      current = target;
    }
  });

  it("offsetRatio = 0 时正好停在扇区中心；抖动上限不越出扇区", () => {
    const n = 6;
    const section = 360 / n;
    for (let winner = 0; winner < n; winner += 1) {
      const center = sectorCenterAngle(winner, n);
      const exact = computeTargetRotation(0, winner, n, { offsetRatio: 0, minTurns: 0, maxTurns: 0 });
      expect(normalizeAngle(-exact)).toBeCloseTo(center, 10);
    }

    let seed = 1;
    for (let winner = 0; winner < n; winner += 1) {
      const jittered = computeTargetRotation(0, winner, n, {
        offsetRatio: 0.49,
        minTurns: 0,
        maxTurns: 0,
        random: mulberry32(seed),
      });
      seed += 1;
      const landing = normalizeAngle(-jittered);
      const center = sectorCenterAngle(winner, n);
      // 与中心角的偏差必须严格小于半个扇区（不含端点）
      expect(Math.abs(landing - center)).toBeLessThan(section / 2);
      expect(resolveWinnerIndex(jittered, n)).toBe(winner);
    }
  });

  it("sectorCount 为 0 时返回原角度", () => {
    expect(computeTargetRotation(123, 0, 0)).toBe(123);
  });
});

describe("转盘几何：扇区 path 与标签布局", () => {
  it("四分之一扇区用 large=0，外弧顺时针、内弧逆时针", () => {
    const d = sectorPath(100, 100, 30, 96, 0, 90);
    expect(d).toContain("M 100 4");
    expect(d).toContain("A 96 96 0 0 1");
    expect(d).toContain("A 30 30 0 0 0");
    expect(d.endsWith("Z")).toBe(true);
  });

  it("跨度超过 180° 时 large=1", () => {
    expect(sectorPath(100, 100, 30, 96, 0, 120)).toContain("A 96 96 0 0 1");
    expect(sectorPath(100, 100, 30, 96, 0, 240)).toContain("A 96 96 0 1 1");
  });

  it("12 点起始点落在圆的顶端", () => {
    const start = polarToCartesian(WHEEL_CENTER, WHEEL_CENTER, WHEEL_OUTER_R, 0);
    expect(start.x).toBeCloseTo(100, 10);
    expect(start.y).toBeCloseTo(4, 10);
  });

  it("左半侧标签翻转 180° 以免倒置", () => {
    const right = wheelLabelLayout(0, 6, WHEEL_HUB_R, WHEEL_OUTER_R); // 中心角 30°
    expect(right.anchor).toBe("start");
    expect(right.rotate).toBeCloseTo(-60, 10);

    const left = wheelLabelLayout(3, 6, WHEEL_HUB_R, WHEEL_OUTER_R); // 中心角 210°
    expect(left.anchor).toBe("end");
    expect(left.rotate).toBeCloseTo(300, 10);
  });

  it("字号与可用宽度随扇区数收敛在可读区间", () => {
    for (let n = 2; n <= MAX_TEST_SECTORS; n += 1) {
      const layout = wheelLabelLayout(0, n, WHEEL_HUB_R, WHEEL_OUTER_R);
      expect(layout.fontSize).toBeGreaterThanOrEqual(9);
      expect(layout.fontSize).toBeLessThanOrEqual(13);
      expect(layout.maxChars).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("标签截断", () => {
  it("短标签原样返回，超长以省略号结尾且**总宽度不超过预算**", () => {
    expect(truncateLabel("cat", 6)).toBe("cat");
    // 省略号占 1 单位：「veryl…」是 6 单位，预算 5 只能到「very…」
    expect(truncateLabel("verylongtag", 5)).toBe("very…");
    expect(measureLabelWidth(truncateLabel("verylongtag", 5))).toBeLessThanOrEqual(5);
    expect(truncateLabel("   ", 5)).toBe("");
    expect(truncateLabel("x", 0)).toBe("");
    expect(truncateLabel("x", 1)).toBe("");
  });

  it("中文按 2 个单位计宽", () => {
    expect(measureLabelWidth("光影氛围")).toBe(8);
    expect(truncateLabel("光影氛围", 6)).toBe("光影…");
    expect(truncateLabel("光影氛围", 8)).toBe("光影氛围");
  });

  it("为「✓」徽标留出预算后仍不超宽（回归：曾经徽标是在截断之后拼上去的）", () => {
    for (let count = 2; count <= MAX_TEST_SECTORS; count += 1) {
      const layout = wheelLabelLayout(0, count, WHEEL_HUB_R, WHEEL_OUTER_R);
      const budget = Math.max(2, layout.maxChars - CHECK_BADGE_UNITS);
      for (const label of ["角色", "光影氛围", "A very long english tag", "机", "x"]) {
        const shown = truncateLabel(label, budget);
        // 文字 + ✓ 徽标的合计宽度必须落回扇区可用宽度内
        expect(measureLabelWidth(shown) + 1).toBeLessThanOrEqual(layout.maxChars);
      }
      // 两个字的分类名必须能完整显示（不能被徽标挤掉）
      expect(truncateLabel("角色", budget)).toBe("角色");
    }
  });

  it("可用宽度随扇区数收敛在可读区间", () => {
    for (let count = 2; count <= MAX_TEST_SECTORS; count += 1) {
      const layout = wheelLabelLayout(0, count, WHEEL_HUB_R, WHEEL_OUTER_R);
      expect(layout.maxChars).toBeGreaterThanOrEqual(5);
    }
  });
});
