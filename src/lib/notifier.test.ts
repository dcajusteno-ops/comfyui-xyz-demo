import { describe, expect, it } from "vitest";
import { shouldNotify } from "./notifier";
import type { NotifierSettings } from "./notifier";

const base: NotifierSettings = { desktopNotifications: true, sound: true, notifyWhenHidden: true };

describe("shouldNotify", () => {
  it("总开关关闭时不通知", () => {
    expect(shouldNotify(true, { ...base, desktopNotifications: false })).toBe(false);
    expect(shouldNotify(false, { ...base, desktopNotifications: false })).toBe(false);
  });

  it("仅后台提醒开启时，前台不通知、后台通知", () => {
    expect(shouldNotify(false, base)).toBe(false);
    expect(shouldNotify(true, base)).toBe(true);
  });

  it("仅后台提醒关闭时，前台也通知", () => {
    const settings = { ...base, notifyWhenHidden: false };
    expect(shouldNotify(false, settings)).toBe(true);
    expect(shouldNotify(true, settings)).toBe(true);
  });
});