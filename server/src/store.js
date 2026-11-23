import { getDb, save } from "./db.js";
import { DEFAULT_ORDER_SETTINGS } from "./config.js";

export function findAccount(id) {
  return getDb().accounts.find((a) => a.id === Number(id)) || null;
}

export function findOrder(id) {
  return getDb().orders.find((o) => o.id === Number(id)) || null;
}

export function targetCounts(orderId) {
  const id = Number(orderId);
  const counts = { total: 0, pending: 0, added: 0, already: 0, skipped: 0, failed: 0 };
  for (const t of getDb().targets) {
    if (t.orderId !== id) continue;
    counts.total += 1;
    if (counts[t.status] != null) counts[t.status] += 1;
    else counts.pending += 1;
  }
  return counts;
}

export function serializeOrder(order) {
  if (!order) return null;
  return {
    ...order,
    settings: { ...DEFAULT_ORDER_SETTINGS, ...(order.settings || {}) },
    stats: targetCounts(order.id),
  };
}

/**
 * گرفتن لیست یوزرنیم‌های در انتظار.
 * یوزرهایی که از سقف تلاش گذشته‌اند، ناموفق علامت می‌خورند.
 */
export function getPendingTargets(orderId, limit, maxAttempts = 0) {
  const id = Number(orderId);
  const out = [];
  let touched = false;
  for (const t of getDb().targets) {
    if (t.orderId !== id || t.status !== "pending") continue;
    if (maxAttempts > 0 && (t.attempts || 0) >= maxAttempts) {
      t.status = "failed";
      t.reason = "از سقف تلاش مجاز گذشت";
      t.updatedAt = Date.now();
      touched = true;
      continue;
    }
    out.push(t);
    if (out.length >= limit) break;
  }
  if (touched) save();
  return out;
}

export function hasPendingTargets(orderId, maxAttempts = 0) {
  return getPendingTargets(orderId, 1, maxAttempts).length > 0;
}

export function markTarget(target, status, reason = null, accountId = null) {
  target.status = status;
  target.reason = reason;
  if (accountId != null) target.accountId = accountId;
  target.updatedAt = Date.now();
  if (status === "added" || status === "already") target.doneAt = Date.now();
  save();
}

export function resetFailedTargets(orderId) {
  const id = Number(orderId);
  let n = 0;
  for (const t of getDb().targets) {
    if (t.orderId !== id) continue;
    if (t.status === "failed" || t.status === "skipped") {
      t.status = "pending";
      t.reason = null;
      t.attempts = 0;
      t.updatedAt = Date.now();
      n += 1;
    }
  }
  if (n) save();
  return n;
}
