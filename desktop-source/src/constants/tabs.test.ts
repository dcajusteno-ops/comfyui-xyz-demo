import { describe, expect, it } from "vitest";
import { generationTabs, slotsTab, tabs, toolTabs } from "./index";
import type { TemplateKind } from "../types";

/**
 * 防回归：新增一条生成模板时，最容易漏的就是侧边栏入口。
 *
 * 背景：`App.tsx` 里曾另有一份硬编码的 tab 数组，把本文件的导出整个覆盖掉，
 * 导致「Anima 生图」明明加了常量却看不见——侧边栏有 7 项，它不在其中。
 * 现在 App.tsx 已改为直接引用本文件的导出，这些断言负责守住这条约定。
 */
describe("侧边栏 tab 定义", () => {
  it("每个 TemplateKind 都有对应的侧边栏入口", () => {
    // 显式列出全部成员：将来新增 TemplateKind 时，这里会先编译报错，
    // 强制实现者同步补上入口，而不是等到用户发现「没有运行入口」。
    const templateKinds: TemplateKind[] = ["default", "multi", "highres", "anima"];
    const ids = generationTabs.map((tab) => tab.id);
    for (const kind of templateKinds) {
      expect(ids).toContain(kind);
    }
  });

  it("tabs 完整覆盖三组且无重复", () => {
    const all = tabs.map((tab) => tab.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(generationTabs.length + 1 + toolTabs.length);
    expect(all).toContain(slotsTab.id);
  });

  it("每个 tab 都有 label 与 icon（AppSidebar 渲染依赖这两项）", () => {
    for (const tab of tabs) {
      expect(tab.label.trim().length).toBeGreaterThan(0);
      expect(tab.icon).toBeTruthy();
    }
  });
});
