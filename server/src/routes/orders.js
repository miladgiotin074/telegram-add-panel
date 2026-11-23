import express from "express";
import { getDb, nextId, save, addLog, publicAccount } from "../db.js";
import { DEFAULT_ORDER_SETTINGS } from "../config.js";
import { parseUsernameList, normalizeUsername } from "../utils/target.js";
import { findOrder, serializeOrder, targetCounts, resetFailedTargets } from "../store.js";
import { startOrder, stopOrder, isOrderRunning, invalidateTargetCache } from "../engine/engine.js";
import { emit } from "../events.js";

const router = express.Router();

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function sanitizeSettings(input = {}) {
  const db = getDb();
  const base = { ...DEFAULT_ORDER_SETTINGS, ...(db.settings.defaultSettings || {}), ...(input || {}) };
  const delayMinSec = clampInt(base.delayMinSec, 1, 86400, 20);
  const delayMaxSec = clampInt(base.delayMaxSec, delayMinSec, 86400, 60);
  return {
    batchSize: clampInt(base.batchSize, 1, 100, 1),
    maxPerAccount: clampInt(base.maxPerAccount, 0, 1000000, 40),
    delayMinSec,
    delayMaxSec,
    autoJoin: base.autoJoin !== false,
    maxAttempts: clampInt(base.maxAttempts, 1, 50, 3),
  };
}

router.get("/", (req, res) => {
  const db = getDb();
  const orders = [...db.orders]
    .sort((a, b) => b.id - a.id)
    .map((o) => ({ ...serializeOrder(o), running: isOrderRunning(o.id) }));
  res.json(orders);
});

/** نام نمایشی یک کاربر جمع‌آوری‌شده */
function senderLabel(s) {
  return [s.firstName, s.lastName].filter(Boolean).join(" ") || (s.username ? `@${s.username}` : String(s.telegramId));
}

/** ساخت لیست مقاصد (تارگت) از کاربران جمع‌آوری‌شده؛ اولویت با انتخاب‌های صریح است */
function pickSenders(db, senderIds, filter) {
  let senders = db.senders;
  if (Array.isArray(senderIds) && senderIds.length) {
    const set = new Set(senderIds.map(Number));
    senders = senders.filter((s) => set.has(s.id));
  } else if (filter) {
    const q = String(filter.q || "").trim().toLowerCase();
    if (q) {
      senders = senders.filter(
        (s) =>
          (s.username || "").toLowerCase().includes(q) ||
          String(s.telegramId).includes(q) ||
          `${s.firstName || ""} ${s.lastName || ""}`.toLowerCase().includes(q) ||
          (s.sourceGroupTitle || "").toLowerCase().includes(q),
      );
    }
    if (filter.accountId) senders = senders.filter((s) => String(s.accountId) === String(filter.accountId));
    if (filter.group) senders = senders.filter((s) => String(s.sourceGroupId) === String(filter.group));
  }
  return senders.map((s) => ({
    username: s.username || null,
    telegramId: String(s.telegramId),
    accessHash: s.accessHash != null ? String(s.accessHash) : null,
    messageLink: s.messageLink || null,
    sourceGroupId: s.sourceGroupId != null ? String(s.sourceGroupId) : null,
    sourceGroupAccessHash: s.sourceGroupAccessHash != null ? String(s.sourceGroupAccessHash) : null,
    label: senderLabel(s),
  }));
}

router.post("/", (req, res) => {
  const db = getDb();
  const { name, target, settings, usernames, usernamesText, senderIds, senderFilter } = req.body || {};

  const targetValue = String(target || "").trim();
  if (!targetValue) return res.status(400).json({ error: "یوزرنیم یا لینک گروه مقصد الزامی است" });

  const fromSenders = (Array.isArray(senderIds) && senderIds.length) || senderFilter != null;
  let newTargets;
  if (fromSenders) {
    newTargets = pickSenders(db, senderIds, senderFilter);
    if (!newTargets.length) return res.status(400).json({ error: "کاربری برای افزودن انتخاب نشده است" });
  } else {
    const list = Array.isArray(usernames)
      ? [...new Set(usernames.map(normalizeUsername).filter((u) => /^[a-z0-9_]{5,32}$/.test(u)))]
      : parseUsernameList(usernamesText || "");
    if (!list.length) return res.status(400).json({ error: "حداقل یک یوزرنیم معتبر لازم است" });
    newTargets = list.map((username) => ({ username, telegramId: null, accessHash: null, label: `@${username}` }));
  }

  const order = {
    id: nextId("order"),
    name: String(name || "").trim() || `سفارش ${db.counters.order}`,
    target: targetValue,
    targetTitle: null,
    targetType: null,
    status: "pending",
    pauseReason: null,
    fatalError: null,
    settings: sanitizeSettings(settings),
    accountCounts: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };
  db.orders.push(order);

  for (const t of newTargets) {
    db.targets.push({
      id: nextId("target"),
      orderId: order.id,
      username: t.username || null,
      telegramId: t.telegramId ?? null,
      accessHash: t.accessHash ?? null,
      messageLink: t.messageLink || null,
      sourceGroupId: t.sourceGroupId ?? null,
      sourceGroupAccessHash: t.sourceGroupAccessHash ?? null,
      label: t.label || null,
      status: "pending",
      reason: null,
      accountId: null,
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      doneAt: null,
    });
  }

  save();
  const payload = serializeOrder(order);
  emit("order", payload);
  addLog({ orderId: order.id, level: "info", message: `📦 سفارش «${order.name}» با ${newTargets.length} کاربر ساخته شد` });
  res.status(201).json(payload);
});

router.get("/:id", (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "سفارش پیدا نشد" });
  res.json({ ...serializeOrder(order), running: isOrderRunning(order.id) });
});

router.patch("/:id", (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "سفارش پیدا نشد" });

  const body = req.body || {};
  if (body.name != null) order.name = String(body.name).trim() || order.name;
  if (body.target != null) {
    const t = String(body.target).trim();
    if (t && t !== order.target) {
      order.target = t;
      order.targetTitle = null;
      order.targetType = null;
      invalidateTargetCache(order.id);
    }
  }
  if (body.settings != null) order.settings = sanitizeSettings({ ...order.settings, ...body.settings });
  order.updatedAt = Date.now();
  save();

  const payload = serializeOrder(order);
  emit("order", payload);
  res.json(payload);
});

router.delete("/:id", async (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const index = db.orders.findIndex((o) => o.id === id);
  if (index === -1) return res.status(404).json({ error: "سفارش پیدا نشد" });

  stopOrder(id, "stopped", "سفارش حذف شد");
  const [removed] = db.orders.splice(index, 1);
  db.targets = db.targets.filter((t) => t.orderId !== id);
  db.logs = db.logs.filter((l) => l.orderId !== id);
  save();
  invalidateTargetCache(id);
  emit("orderDeleted", { id });
  addLog({ level: "warn", message: `سفارش «${removed.name}» حذف شد` });
  res.json({ ok: true });
});

router.post("/:id/start", (req, res) => {
  try {
    const payload = startOrder(Number(req.params.id));
    res.json(payload);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/pause", (req, res) => {
  const order = stopOrder(Number(req.params.id), "paused", "توسط کاربر موقتاً متوقف شد");
  if (!order) return res.status(404).json({ error: "سفارش پیدا نشد" });
  res.json(serializeOrder(order));
});

router.post("/:id/stop", (req, res) => {
  const order = stopOrder(Number(req.params.id), "stopped", "توسط کاربر متوقف شد");
  if (!order) return res.status(404).json({ error: "سفارش پیدا نشد" });
  res.json(serializeOrder(order));
});

/** آمار کامل به‌ازای هر اکانت برای این سفارش */
router.get("/:id/accounts", (req, res) => {
  const db = getDb();
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "سفارش پیدا نشد" });
  const counts = order.accountCounts || {};
  const rows = db.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    username: a.username,
    status: a.status,
    statusMessage: a.statusMessage,
    floodUntil: a.floodUntil || 0,
    addedForOrder: counts[a.id] || 0,
    maxPerAccount: order.settings.maxPerAccount,
    addedTotal: a.addedTotal || 0,
    maxTotalAdds: a.maxTotalAdds || 0,
    available: a.status === "active" && (a.floodUntil || 0) <= Date.now(),
    excluded:
      a.status !== "active" ||
      (a.floodUntil || 0) > Date.now() ||
      (order.settings.maxPerAccount > 0 && (counts[a.id] || 0) >= order.settings.maxPerAccount) ||
      (a.maxTotalAdds > 0 && (a.addedTotal || 0) >= a.maxTotalAdds),
  }));
  res.json(rows);
});

router.get("/:id/targets", (req, res) => {
  const db = getDb();
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "سفارش پیدا نشد" });

  const status = req.query.status ? String(req.query.status) : null;
  const q = req.query.q ? String(req.query.q).toLowerCase() : null;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 50));

  let rows = db.targets.filter((t) => t.orderId === order.id);
  if (status && status !== "all") rows = rows.filter((t) => t.status === status);
  if (q) {
    rows = rows.filter(
      (t) =>
        String(t.username || "").includes(q) ||
        String(t.label || "").toLowerCase().includes(q) ||
        String(t.telegramId || "").includes(q) ||
        String(t.reason || "").toLowerCase().includes(q),
    );
  }

  const total = rows.length;
  const start = (page - 1) * pageSize;
  res.json({
    items: rows.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    counts: targetCounts(order.id),
  });
});

router.get("/:id/logs", (req, res) => {
  const db = getDb();
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "سفارش پیدا نشد" });
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 300));
  const logs = db.logs
    .filter((l) => l.orderId === order.id)
    .slice(-limit)
    .map((l) => ({ ...l, accountName: db.accounts.find((a) => a.id === l.accountId)?.name || null }));
  res.json(logs);
});

router.post("/:id/retry-failed", (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "سفارش پیدا نشد" });
  const n = resetFailedTargets(order.id);
  if (order.status !== "running") {
    order.status = "pending";
    order.pauseReason = null;
    order.fatalError = null;
  }
  order.updatedAt = Date.now();
  save();
  emit("order", serializeOrder(order));
  addLog({ orderId: order.id, level: "info", message: `♻️ ${n} یوزر برای تلاش مجدد به صف برگشت` });
  res.json({ ok: true, reset: n, order: serializeOrder(order) });
});

export default router;
