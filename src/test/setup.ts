import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom 未实现滚动 API（FolderSidebar 记忆滚动、模型区滚动使用），统一 stub
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}
if (!Element.prototype.scrollBy) {
  Element.prototype.scrollBy = vi.fn();
}
