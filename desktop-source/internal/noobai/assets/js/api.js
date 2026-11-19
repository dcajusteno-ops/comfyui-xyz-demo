/* NoobAI 抽取 · 网络层
   唯一的出口：超时、错误体解析、全量合并写设置都在这里收口。 */
const API = "/api";
const TIMEOUT_MS = 20000;

export class ApiError extends Error {
  constructor(message, status, path) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
  }
}

function withTimeout(ms) {
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
    return AbortSignal.timeout(ms);
  }
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

async function request(path, opts = {}) {
  let res;
  try {
    res = await fetch(API + path, Object.assign({
      cache: "no-store",
      signal: withTimeout(opts.timeout || TIMEOUT_MS),
    }, opts));
  } catch (err) {
    if (err && err.name === "TimeoutError") throw new ApiError("请求超时，请检查后台服务", 0, path);
    if (err && err.name === "AbortError") throw new ApiError("请求超时，请检查后台服务", 0, path);
    throw new ApiError("无法连接后台服务", 0, path);
  }

  let payload = null;
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    try { payload = await res.json(); } catch (e) { payload = null; }
  }

  if (!res.ok) {
    const msg = payload && payload.error ? payload.error : `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, path);
  }
  if (payload && payload.ok === false) {
    throw new ApiError(payload.error || "请求失败", res.status, path);
  }
  return payload;
}

export function getJSON(path) {
  return request(path);
}

export function postJSON(path, body) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

/* 卸载/隐藏时用 beacon 发一份，避免普通 fetch 被丢弃 */
export function postOnUnload(path, body) {
  try {
    const blob = new Blob([JSON.stringify(body || {})], { type: "application/json" });
    if (navigator.sendBeacon && navigator.sendBeacon(API + path, blob)) return;
  } catch (e) { /* 退回 keepalive */ }
  try {
    fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      keepalive: true,
    }).catch(() => {});
  } catch (e) { /* 忽略 */ }
}
