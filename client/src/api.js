const BASE = "/api";

// لاگ دقیق خطاهای سمت مرورگر (برای عیب‌یابی در کنسول DevTools)
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[پنل] خطای مهارنشده (rejection):", e.reason);
  });
  window.addEventListener("error", (e) => {
    console.error(
      "[پنل] خطای جاوااسکریپت:",
      e.message,
      `${e.filename}:${e.lineno}:${e.colno}`,
      e.error
    );
  });
}

async function request(path, { method = "GET", body } = {}) {
  const url = BASE + path;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // خطای شبکه: سرور در دسترس نیست یا اتصال قطع شده
    console.error(`[api] شبکه: ${method} ${url} — اتصال برقرار نشد`, err);
    throw new Error("ارتباط با سرور برقرار نشد (اتصال قطع شد یا سرور در دسترس نیست)");
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    console.error(`[api] خطای پاسخ: ${method} ${url} → ${res.status} ${res.statusText}`, data);
    throw new Error((data && data.error) || `خطا (${res.status})`);
  }
  return data;
}

/**
 * افزودن دسته‌ای سشن‌ها: به قطعه‌های کوچک تقسیم و پشت‌سرهم ارسال می‌شود.
 * دلیل: بعضی لایه‌های میانی شبکه (پروکسی/فیلتر) POST با حجم بزرگ را بلاک می‌کنند
 * و ۵۰۳ برمی‌گردانند؛ با قطعه‌های کوچک این مشکل رخ نمی‌دهد.
 */
const IMPORT_CHUNK_SIZE = 10;

async function importAccountsInChunks(sessions) {
  const lines = String(sessions || "")
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error("هیچ سشنی وارد نشده است");

  const created = [];
  const skipped = [];
  for (let i = 0; i < lines.length; i += IMPORT_CHUNK_SIZE) {
    const chunk = lines.slice(i, i + IMPORT_CHUNK_SIZE).join("\n");
    const res = await request("/accounts/import", { method: "POST", body: { sessions: chunk } });
    if (res && res.created) created.push(...res.created);
    if (res && res.skipped) skipped.push(...res.skipped);
  }
  return { created, skipped, validating: created.length };
}

export const api = {
  stats: () => request("/stats"),

  settings: {
    get: () => request("/settings"),
    update: (body) => request("/settings", { method: "PATCH", body }),
  },

  accounts: {
    list: () => request("/accounts"),
    create: (body) => request("/accounts", { method: "POST", body }),
    import: importAccountsInChunks,
    checkAll: () => request("/accounts/check-all", { method: "POST" }),
    check: (id) => request(`/accounts/${id}/check`, { method: "POST" }),
    update: (id, body) => request(`/accounts/${id}`, { method: "PATCH", body }),
    remove: (id) => request(`/accounts/${id}`, { method: "DELETE" }),
    removeInactive: () => request("/accounts/delete-inactive", { method: "POST" }),
    listen: (id, enabled) => request(`/accounts/${id}/listen`, { method: "POST", body: { enabled } }),
    login: {
      start: (body) => request("/accounts/login/start", { method: "POST", body }),
      verify: (body) => request("/accounts/login/verify", { method: "POST", body }),
      password: (body) => request("/accounts/login/password", { method: "POST", body }),
      cancel: (token) => request("/accounts/login/cancel", { method: "POST", body: { token } }),
    },
  },

  senders: {
    list: (params = {}) => request(`/senders?${new URLSearchParams(params)}`),
    stats: () => request("/senders/stats"),
    remove: (id) => request(`/senders/${id}`, { method: "DELETE" }),
    clear: () => request("/senders/clear", { method: "POST" }),
  },

  scan: {
    list: () => request("/scan"),
    start: (body) => request("/scan", { method: "POST", body }),
    pause: (id) => request(`/scan/${id}/pause`, { method: "POST" }),
    resume: (id) => request(`/scan/${id}/resume`, { method: "POST" }),
    stop: (id) => request(`/scan/${id}/stop`, { method: "POST" }),
  },

  orders: {
    list: () => request("/orders"),
    create: (body) => request("/orders", { method: "POST", body }),
    get: (id) => request(`/orders/${id}`),
    update: (id, body) => request(`/orders/${id}`, { method: "PATCH", body }),
    remove: (id) => request(`/orders/${id}`, { method: "DELETE" }),
    start: (id) => request(`/orders/${id}/start`, { method: "POST" }),
    pause: (id) => request(`/orders/${id}/pause`, { method: "POST" }),
    stop: (id) => request(`/orders/${id}/stop`, { method: "POST" }),
    accounts: (id) => request(`/orders/${id}/accounts`),
    targets: (id, params = {}) => request(`/orders/${id}/targets?${new URLSearchParams(params)}`),
    logs: (id, limit = 300) => request(`/orders/${id}/logs?limit=${limit}`),
    retryFailed: (id) => request(`/orders/${id}/retry-failed`, { method: "POST" }),
  },
};

/* ---------------------- کانال رویداد زنده (SSE) ---------------------- */

const listeners = new Set();
let source = null;

function ensureStream() {
  if (source) return;
  source = new EventSource(`${BASE}/events`);
  source.onmessage = (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    for (const fn of listeners) fn(payload);
  };
  source.onerror = () => {
    /* مرورگر به صورت خودکار دوباره وصل می‌شود */
  };
}

export function subscribeEvents(fn) {
  listeners.add(fn);
  ensureStream();
  return () => listeners.delete(fn);
}

/* ------------------------------ ابزارها ------------------------------ */

export function formatNumber(n) {
  return (Number(n) || 0).toLocaleString("en-US");
}

export function formatDateTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.toLocaleDateString("fa-IR")} ${d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (h) parts.push(`${h} ساعت`);
  if (m) parts.push(`${m} دقیقه`);
  parts.push(`${sec} ثانیه`);
  return parts.join(" و ");
}
