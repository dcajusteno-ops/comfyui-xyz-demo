import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * Node 22+ 会在全局注入 localStorage / sessionStorage 访问器：没有
 * `--localstorage-file` 时读取结果是 undefined。vitest 的 jsdom 环境把
 * jsdom window 当作 globalThis，但 Node 的访问器会遮蔽 jsdom 的实现，
 * 于是 `localStorage.clear()` 直接抛 TypeError（Node 26 实测 116 条测试全红）。
 *
 * 这里只在全局缺失时补一个内存版 Storage；已有实现（旧 Node / 浏览器环境）
 * 一律不动。
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

function installMemoryStorage(name: "localStorage" | "sessionStorage") {
  if (typeof globalThis[name] !== "undefined") return;
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: new MemoryStorage(),
  });
}

installMemoryStorage("localStorage");
installMemoryStorage("sessionStorage");

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
