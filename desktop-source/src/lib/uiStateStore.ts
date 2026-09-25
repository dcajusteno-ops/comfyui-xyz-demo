/**
 * 前端持久化状态的服务端后端（v0.6.x 起 localStorage 退役）。
 *
 * 数据统一存服务端 data/ui-state.json（/api/ui-state），不再依赖浏览器 localStorage：
 * - 与 ComfyUI 连接无关，离线可用（存的是本地服务的数据，不是 ComfyUI 的）；
 * - 不按 origin 隔离——dev（9999）与桌面 exe（9123）、端口顺延、清浏览器数据都不再"重置"；
 * - 旧 localStorage 数据在首次启动时一次性迁移（服务端为空 && 本地有 comfyui_*、xyz_* 前缀键），
 *   迁移后 localStorage 原样保留作为回滚备份。
 *
 * 生命周期：
 * 1. main.tsx 在 render 前 `await bootUiState()`（本地服务，通常 <10ms；失败降级 offline）；
 * 2. ready 状态下 usePersistentState 读写内存 store，变更经 800ms 防抖批量 PUT；
 * 3. offline（服务不可达，理论只在异常部署形态出现）→ hook 回退 localStorage，永不变砖。
 *
 * E2E（Playwright）：/api/ui-state 由 e2e/mocks.ts 路由拦截，不触达服务端。
 */

type BootState = "pending" | "ready" | "offline";

const FLUSH_DEBOUNCE_MS = 800;
const BOOT_TIMEOUT_MS = 4000;
/** 迁移/保存范围：与 ErrorBoundary.resetStorage 的前缀一致 */
const PERSISTED_PREFIXES = ["comfyui_", "xyz_"];

let bootState: BootState = "pending";
const store = new Map<string, unknown>();
const dirtyKeys = new Set<string>();
let flushTimer: number | null = null;

export function isServerBacked(): boolean {
  return bootState === "ready";
}

/** hook 初始化读取：ready 返回服务端值（可能 undefined = 无此 key）；否则 null（调用方走 localStorage 兜底） */
export function readStoredValue<T>(key: string): T | undefined | null {
  if (bootState !== "ready") return null;
  return store.get(key) as T | undefined;
}

/** boot 完成后、首帧渲染前同步应用主题，避免 dark 用户看到一帧 light */
export function applyBootTheme(): void {
  if (bootState !== "ready") return;
  const theme = store.get("comfyui_xyz_theme");
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else if (theme === "light") {
    document.documentElement.classList.remove("dark");
  }
}

/**
 * 启动加载：GET /api/ui-state → 灌内存 store →（服务端为空时）迁移旧 localStorage 数据。
 * 任何失败都降级为 offline（hook 回退 localStorage），保证应用总能启动。
 */
export async function bootUiState(): Promise<void> {
  try {
    const res = await fetch("/api/ui-state", { signal: AbortSignal.timeout(BOOT_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`ui-state GET ${res.status}`);
    const body = (await res.json()) as { data?: Record<string, unknown> };
    const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
    for (const [key, value] of Object.entries(data)) {
      store.set(key, value);
    }
    bootState = "ready";
    if (Object.keys(data).length === 0) {
      migrateLegacyLocalStorage();
    }
  } catch {
    bootState = "offline";
  }
}

/** 首次切换：服务端为空时，把 localStorage 里 comfyui_*、xyz_* 前缀的全部键值迁移上去 */
function migrateLegacyLocalStorage(): void {
  const entries: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !PERSISTED_PREFIXES.some((p) => key.startsWith(p))) continue;
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) continue;
        entries[key] = JSON.parse(raw);
      } catch {
        // 单个键损坏只跳过该键
      }
    }
  } catch {
    return; // localStorage 不可用，无迁移目标
  }
  if (Object.keys(entries).length === 0) return;
  for (const [key, value] of Object.entries(entries)) {
    store.set(key, value);
  }
  void putEntries(entries);
}

/** 调度一次防抖保存（hook set 时调用；同会话内立即写内存保证一致） */
export function scheduleUiStateSave(key: string, value: unknown): void {
  store.set(key, value);
  dirtyKeys.add(key);
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushNow();
  }, FLUSH_DEBOUNCE_MS);
}

/** 立即上传全部待保存 key（防抖到期 / beforeunload 时调用） */
export function flushNow(): void {
  if (dirtyKeys.size === 0 || bootState !== "ready") {
    dirtyKeys.clear();
    return;
  }
  const entries: Record<string, unknown> = {};
  for (const key of dirtyKeys) {
    entries[key] = store.get(key);
  }
  dirtyKeys.clear();
  void putEntries(entries);
}

async function putEntries(entries: Record<string, unknown>): Promise<void> {
  try {
    await fetch("/api/ui-state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
      keepalive: true,
    });
  } catch {
    // 网络抖动：内存与 localStorage 兜底仍在，下次变更会重新保存
  }
}

// 关窗/刷新时把防抖窗口内的最后变更带出去（最多丢一次极端情况下的批量）
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => flushNow());
}

/** 仅供测试：重置全部模块级状态（bootState / store / 防抖队列），用例间隔离用 */
export function __resetForTest(): void {
  bootState = "pending";
  store.clear();
  dirtyKeys.clear();
  if (flushTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(flushTimer);
  }
  flushTimer = null;
}
