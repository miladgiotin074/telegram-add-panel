import { Api } from "teleproto";
import { getDb, save, addLog, publicAccount } from "../db.js";
import { emit } from "../events.js";
import {
  findOrder,
  getPendingTargets,
  hasPendingTargets,
  markTarget,
  serializeOrder,
  targetCounts,
} from "../store.js";
import { getClient, dropClient, closeClient } from "../telegram/manager.js";
import { resolveTarget, resolveUsername, joinTarget, leaveTarget, rpcError } from "../telegram/resolver.js";
import { inviteUsers } from "../telegram/adder.js";
import { classifyError } from "../utils/errors.js";
import { randDelayMs, interruptibleSleep } from "../utils/delay.js";

/** orderId -> runner */
const runners = new Map();
/** اکانت‌هایی که همین الان در حال استفاده‌اند */
const busyAccounts = new Set();
/** orderId -> مقصد resolve شده (فقط برای متادیتا: عنوان/نوع/بررسی کانال) */
const targetCache = new Map();
/** "orderId:accountId" -> { target, targetString } — inputChannel با access_hash مخصوص همان اکانت */
const accountTargets = new Map();
/** orderId -> Map(accountId -> target) — اکانت‌هایی که همین حالا در گروه مقصد عضو هستند */
const joinedAccounts = new Map();

const ACCOUNT_KINDS = new Set(["ACCOUNT_FLOOD", "ACCOUNT_SPAM", "ACCOUNT_DEAD", "ACCOUNT_FROZEN", "ACCOUNT_NO_PERMISSION"]);

function emitOrder(order) {
  emit("order", serializeOrder(order));
}
function emitAccount(account) {
  emit("account", publicAccount(account));
}
function emitTargets(rows) {
  if (!rows?.length) return;
  emit("targets", rows);
}

export function isOrderRunning(orderId) {
  return runners.has(Number(orderId));
}

/** بعد از ری‌استارت، سفارش‌های در حال اجرا را متوقف نگه می‌داریم */
export function resetRunningOrders() {
  let changed = false;
  for (const order of getDb().orders) {
    if (order.status === "running") {
      order.status = "paused";
      order.pauseReason = "سرور ری‌استارت شد؛ برای ادامه، سفارش را مجدداً استارت کنید";
      order.updatedAt = Date.now();
      changed = true;
    }
  }
  if (changed) save();
}

export function startOrder(orderId) {
  const id = Number(orderId);
  const order = findOrder(id);
  if (!order) throw new Error("سفارش پیدا نشد");
  if (runners.has(id)) return serializeOrder(order);

  const activeAccounts = getDb().accounts.filter((a) => a.status === "active");
  if (activeAccounts.length === 0) {
    throw new Error("هیچ اکانت فعالی برای شروع وجود ندارد");
  }

  order.status = "running";
  order.pauseReason = null;
  order.fatalError = null;
  order.blockedAccounts = [];
  order.startedAt = order.startedAt || Date.now();
  order.finishedAt = null;
  order.updatedAt = Date.now();
  save();
  emitOrder(order);

  const runner = { id, cancelled: false };
  runners.set(id, runner);
  addLog({ orderId: id, level: "info", message: `▶️ سفارش «${order.name}» شروع شد` });

  runner.promise = runLoop(order, runner)
    .catch((err) => {
      addLog({ orderId: id, level: "error", message: `خطای غیرمنتظره در اجرای سفارش: ${err.message}` });
    })
    .finally(() => {
      runners.delete(id);
      invalidateTargetCache(id);
      const fresh = findOrder(id);
      if (fresh && fresh.status === "running") {
        fresh.status = "paused";
        fresh.pauseReason = fresh.pauseReason || "اجرای سفارش متوقف شد";
        fresh.updatedAt = Date.now();
        save();
        emitOrder(fresh);
      }
    });

  return serializeOrder(order);
}

export function stopOrder(orderId, status = "stopped", reason = null) {
  const id = Number(orderId);
  const runner = runners.get(id);
  if (runner) runner.cancelled = true;

  const order = findOrder(id);
  if (order && order.status === "running") {
    order.status = status;
    order.pauseReason = reason;
    order.updatedAt = Date.now();
    save();
    emitOrder(order);
  }
  addLog({
    orderId: id,
    level: "warn",
    message: status === "stopped" ? "⏹ سفارش متوقف شد" : "⏸ سفارش موقتاً متوقف شد",
  });
  return order;
}

export async function stopAll() {
  const pending = [];
  for (const [id, runner] of runners) {
    runner.cancelled = true;
    const order = findOrder(id);
    if (order && order.status === "running") {
      order.status = "paused";
      order.pauseReason = "خاموش شدن سرور";
      save();
    }
    if (runner.promise) pending.push(runner.promise.catch(() => {}));
  }
  if (pending.length) {
    // کمی صبر تا اکانت‌ها فرصت کنند از گروه مقصد خارج شوند (حداکثر ۵ ثانیه)
    await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 5000))]);
  }
}

/* ---------------------------------- loop --------------------------------- */

async function runLoop(order, runner) {
  try {
    await runOrderLoop(order, runner);
  } finally {
    // پس از پایان کار سفارش (تکمیل/توقف/خطا)، اکانت‌های باقی‌مانده از گروه مقصد خارج می‌شوند
    await leaveJoined(order);
  }
}

async function runOrderLoop(order, runner) {
  const id = order.id;

  while (!runner.cancelled) {
    const fresh = findOrder(id);
    if (!fresh || fresh.status !== "running") return;
    Object.assign(order, fresh);
    order.accountCounts = order.accountCounts || {};

    if (!hasPendingTargets(id, order.settings.maxAttempts)) {
      finishOrder(order, "completed");
      return;
    }

    const selection = selectAccount(order);
    if (selection.none) {
      order.status = "paused";
      order.pauseReason = selection.reason || "اکانت قابل استفاده‌ای باقی نمانده است";
      order.updatedAt = Date.now();
      save();
      emitOrder(order);
      addLog({ orderId: id, level: "warn", message: `⏸ ${order.pauseReason}` });
      return;
    }
    if (selection.waitMs) {
      await interruptibleSleep(selection.waitMs, () => runner.cancelled);
      continue;
    }

    const account = selection.account;
    busyAccounts.add(account.id);
    order.runtime = { accountId: account.id, accountName: account.name, phase: "اتصال" };
    emitOrder(order);

    try {
      const client = await getClient(account);
      order.runtime.phase = "شناسایی مقصد";
      emitOrder(order);

      const meta = await ensureTarget(order, client);
      if (!meta) return; // سفارش fatal شد

      // access_hash کانال مقصد مخصوص هر اکانت است؛ پس مقصد را برای همین اکانت resolve می‌کنیم
      const target = await targetForAccount(order, account, client);

      // پیش‌نیاز ادد: اکانت باید عضو گروه مقصد باشد
      if (order.settings.autoJoin !== false) {
        order.runtime.phase = "عضویت در مقصد";
        emitOrder(order);
        const joined = await ensureJoined(order, account, client, target, runner);
        if (!joined) continue;
      }

      const batchSize = target.type === "chat" ? 1 : Math.max(1, Number(order.settings.batchSize) || 1);
      const pending = getPendingTargets(id, batchSize, order.settings.maxAttempts);
      if (pending.length === 0) {
        finishOrder(order, "completed");
        return;
      }

      order.runtime.phase = "ادد کردن";
      emitOrder(order);
      await processBatch(order, account, client, target, pending, runner);

      // اگر سهم این اکانت به پایان رسید (سقف سفارش/سقف کلی)، از گروه خارج شود
      if (order.settings.autoJoin !== false) {
        await leaveIfCapped(order, account, client, target);
      }
    } catch (err) {
      const info = classifyError(err);
      if (ACCOUNT_KINDS.has(info.kind) || info.kind === "ORDER_FATAL") {
        await handleAccountFailure(order, account, info, runner);
      } else if (info.kind === "NETWORK") {
        dropClient(account.id);
        addLog({
          orderId: id,
          accountId: account.id,
          level: "warn",
          message: `🔌 خطای شبکه روی اکانت «${account.name}» (${info.code}) — تلاش مجدد`,
        });
        await interruptibleSleep(5000, () => runner.cancelled);
      } else {
        addLog({
          orderId: id,
          accountId: account.id,
          level: "error",
          message: `خطا در پردازش دسته: ${info.code}`,
        });
        await interruptibleSleep(5000, () => runner.cancelled);
      }
    } finally {
      busyAccounts.delete(account.id);
      delete order.runtime;
      save();
      emitOrder(order);
    }
  }
}

function selectAccount(order) {
  const db = getDb();
  const now = Date.now();
  const counts = order.accountCounts || {};
  const maxPerAccount = Number(order.settings.maxPerAccount) || 0;

  const activeAll = db.accounts.filter((a) => a.status === "active");
  const blocked = new Set(order.blockedAccounts || []);
  const active = activeAll.filter((a) => !blocked.has(a.id));
  if (active.length === 0) {
    return {
      none: true,
      reason: activeAll.length
        ? "اکانت‌های دارای دسترسی ادد در گروه مقصد تمام شدند (بقیه ادمین گروه مقصد نیستند)"
        : "هیچ اکانت فعالی وجود ندارد",
    };
  }

  const withinAccountCap = (a) =>
    (!a.maxTotalAdds || a.maxTotalAdds <= 0 || (a.addedTotal || 0) < a.maxTotalAdds) &&
    (!maxPerAccount || (counts[a.id] || 0) < maxPerAccount);

  const eligible = active.filter(
    (a) => !busyAccounts.has(a.id) && (a.floodUntil || 0) <= now && withinAccountCap(a),
  );

  if (eligible.length) {
    eligible.sort(
      (a, b) => (counts[a.id] || 0) - (counts[b.id] || 0) || (a.lastUsedAt || 0) - (b.lastUsedAt || 0),
    );
    return { account: eligible[0] };
  }

  if (active.some((a) => busyAccounts.has(a.id))) {
    return { waitMs: 2000 };
  }

  const flooded = active.filter((a) => (a.floodUntil || 0) > now);
  if (flooded.length) {
    const allCapped = active.every((a) => !withinAccountCap(a));
    if (allCapped) {
      return { none: true, reason: "سقف ادد همه اکانت‌ها برای این سفارش تکمیل شد" };
    }
    const earliest = Math.min(...flooded.map((a) => a.floodUntil));
    return { waitMs: Math.max(1000, Math.min(earliest - now, 30000)) };
  }

  return { none: true, reason: "سقف ادد همه اکانت‌ها برای این سفارش تکمیل شد" };
}

async function ensureTarget(order, client) {
  if (targetCache.has(order.id)) return targetCache.get(order.id);

  let target;
  try {
    target = await resolveTarget(client, order.target, order.settings.autoJoin !== false);
  } catch (err) {
    const info = classifyError(err);
    if (info.kind === "ORDER_FATAL" || info.kind === "USER_SKIP") {
      const account = { id: order.runtime?.accountId ?? null, name: order.runtime?.accountName ?? "" };
      await setOrderFatal(order, info, account);
      return null;
    }
    throw err;
  }

  if (target.isBroadcast) {
    await setOrderFatal(
      order,
      { code: "CHAT_ID_INVALID", message: "مقصد یک کانال (broadcast) است و امکان ادد عضو ندارد", kind: "ORDER_FATAL" },
      null,
    );
    return null;
  }

  targetCache.set(order.id, target);
  order.targetTitle = target.title || null;
  order.targetType = target.type;
  save();
  emitOrder(order);
  addLog({
    orderId: order.id,
    level: "info",
    message: `🎯 مقصد شناسایی شد: ${target.title || order.target}`,
  });
  return target;
}

async function processBatch(order, account, client, target, pending, runner) {
  /* 1) تبدیل یوزرها به InputUser */
  const resolved = [];
  const changedRows = [];

  for (const row of pending) {
    try {
      const inputUser = await resolveInputUser(client, row);
      resolved.push({ row, inputUser });
    } catch (err) {
      const info = classifyError(err);
      if (ACCOUNT_KINDS.has(info.kind) || info.kind === "ORDER_FATAL") {
        await handleAccountFailure(order, account, info, runner);
        return;
      }
      if (info.kind === "NETWORK") {
        dropClient(account.id);
        addLog({
          orderId: order.id,
          accountId: account.id,
          level: "warn",
          message: `🔌 خطای شبکه در resolve یوزرها — تلاش مجدد`,
        });
        await interruptibleSleep(5000, () => runner.cancelled);
        return;
      }
      row.attempts = (row.attempts || 0) + 1;
      markTarget(row, "failed", `شناسایی نشد: ${info.message}`, null);
      changedRows.push(row);
      addLog({
        orderId: order.id,
        accountId: account.id,
        level: "warn",
        message: `⛔ ${labelOf(row)} شناسایی نشد: ${info.message}`,
      });
    }
  }

  if (changedRows.length) emitTargets(changedRows.map(targetRowEvent));
  if (!resolved.length) {
    save();
    emitOrder(order);
    return;
  }

  /* 2) ارسال درخواست ادد */
  let batchError = null;
  try {
    await inviteUsers(client, target, resolved.map((r) => r.inputUser));
  } catch (err) {
    batchError = err;
  }

  if (!batchError) {
    for (const r of resolved) {
      markTarget(r.row, "added", null, account.id);
      bumpCount(order, account);
    }
    emitTargets(resolved.map((r) => targetRowEvent(r.row)));
    addLog({
      orderId: order.id,
      accountId: account.id,
      level: "success",
      message: `✅ ${resolved.length} کاربر ادد شد: ${resolved.map((r) => labelOf(r.row)).join(", ")}`,
    });
  } else {
    const info = classifyError(batchError);

    if (ACCOUNT_KINDS.has(info.kind) || info.kind === "ORDER_FATAL") {
      await handleAccountFailure(order, account, info, runner);
      return; // یوزرها pending می‌مانند تا با اکانت بعدی تلاش شوند
    }
    if (info.kind === "NETWORK") {
      dropClient(account.id);
      addLog({
        orderId: order.id,
        accountId: account.id,
        level: "warn",
        message: `🔌 خطای شبکه در ادد کردن (${info.code}) — تلاش مجدد`,
      });
      await interruptibleSleep(5000, () => runner.cancelled);
      return;
    }

    // خطای مربوط به یکی از یوزرها → تک‌تک تلاش می‌کنیم تا مقصر مشخص شود
    for (let i = 0; i < resolved.length; i++) {
      const r = resolved[i];
      try {
        await inviteUsers(client, target, [r.inputUser]);
        markTarget(r.row, "added", null, account.id);
        bumpCount(order, account);
        emitTargets([targetRowEvent(r.row)]);
        addLog({
          orderId: order.id,
          accountId: account.id,
          level: "success",
          message: `✅ ${labelOf(r.row)} ادد شد`,
        });
      } catch (err2) {
        const info2 = classifyError(err2);

        if (ACCOUNT_KINDS.has(info2.kind) || info2.kind === "ORDER_FATAL") {
          await handleAccountFailure(order, account, info2, runner);
          return;
        }
        if (info2.kind === "NETWORK") {
          dropClient(account.id);
          await interruptibleSleep(5000, () => runner.cancelled);
          return;
        }

        r.row.attempts = (r.row.attempts || 0) + 1;
        const status = info2.kind === "USER_ALREADY" ? "already" : info2.kind === "USER_SKIP" ? "skipped" : "failed";
        markTarget(r.row, status, info2.message, account.id);
        emitTargets([targetRowEvent(r.row)]);
        addLog({
          orderId: order.id,
          accountId: account.id,
          level: status === "already" ? "info" : "warn",
          message: `${status === "already" ? "👤 از قبل عضو" : "⛔ رد شد"} ${labelOf(r.row)}: ${info2.message}`,
        });
      }

      if (i < resolved.length - 1 && !runner.cancelled) {
        await interruptibleSleep(delayMs(order), () => runner.cancelled);
      }
    }
  }

  account.lastUsedAt = Date.now();
  save();
  emitOrder(order);
  emitAccount(account);

  /* 3) فاصله بین درخواست‌های ادد */
  if (!runner.cancelled) {
    await interruptibleSleep(delayMs(order), () => runner.cancelled);
  }
}

/* --------------------------------- helpers -------------------------------- */

function delayMs(order) {
  return randDelayMs(order.settings.delayMinSec, order.settings.delayMaxSec);
}

function bumpCount(order, account) {
  order.accountCounts = order.accountCounts || {};
  order.accountCounts[account.id] = (order.accountCounts[account.id] || 0) + 1;
  account.addedTotal = (account.addedTotal || 0) + 1;
  account.lastUsedAt = Date.now();
}

/* ------------------- عضویت/خروج اکانت از گروه مقصد ------------------- */

/** آیا این اکانت سهم خودش از سفارش را تکمیل کرده است؟ */
function accountReachedCap(order, account) {
  const maxPerAccount = Number(order.settings.maxPerAccount) || 0;
  const counts = order.accountCounts || {};
  if (maxPerAccount > 0 && (counts[account.id] || 0) >= maxPerAccount) return true;
  if (account.maxTotalAdds > 0 && (account.addedTotal || 0) >= account.maxTotalAdds) return true;
  return false;
}

/** کلید وضعیت هر اکانت در هر سفارش */
function stateKey(orderId, accountId) {
  return `${orderId}:${accountId}`;
}

/** نقشه‌ی اکانت‌های عضو: orderId -> Map(accountId -> target) */
function joinedMap(orderId) {
  let m = joinedAccounts.get(Number(orderId));
  if (!m) {
    m = new Map();
    joinedAccounts.set(Number(orderId), m);
  }
  return m;
}

/**
 * مقصد مخصوص همین اکانت.
 * access_hash کانال بین اکانت‌ها معتبر نیست؛ پس هر اکانت باید مقصد را با سشن خودش resolve کند.
 */
async function targetForAccount(order, account, client) {
  const key = stateKey(order.id, account.id);
  const cached = accountTargets.get(key);
  if (cached && cached.targetString === order.target) return cached.target;
  const target = await resolveTarget(client, order.target, order.settings.autoJoin !== false);
  accountTargets.set(key, { target, targetString: order.target });
  return target;
}

/** عضویت اکانت در گروه مقصد پیش از ادد کردن (یک‌بار برای هر اکانت در این سفارش) */
async function ensureJoined(order, account, client, target, runner) {
  if (target.type !== "channel") return true; // گروه ساده امکان جوین خودکار ندارد
  const joined = joinedMap(order.id);
  const prev = joined.get(account.id);
  if (prev && prev.id === target.id) return true;
  if (prev) {
    // مقصد عوض شده است؛ ابتدا از مقصد قبلی خارج شو
    try {
      await leaveTarget(client, prev);
    } catch {
      /* ignore */
    }
    joined.delete(account.id);
  }

  try {
    await joinTarget(client, target);
    joined.set(account.id, target);
    addLog({
      orderId: order.id,
      accountId: account.id,
      level: "info",
      message: `🔗 اکانت «${account.name}» در گروه مقصد عضو شد`,
    });
    return true;
  } catch (err) {
    const info = classifyError(err);
    if (ACCOUNT_KINDS.has(info.kind)) {
      await handleAccountFailure(order, account, info, runner);
      return false;
    }
    if (info.kind === "NETWORK") dropClient(account.id);
    addLog({
      orderId: order.id,
      accountId: account.id,
      level: "error",
      message: `⚠️ اکانت «${account.name}» نتوانست در گروه مقصد عضو شود: ${info.message}`,
    });
    await interruptibleSleep(5000, () => runner.cancelled);
    return false;
  }
}

/** اگر سهم اکانت تمام شده، از گروه مقصد خارج شود */
async function leaveIfCapped(order, account, client, target) {
  const joined = joinedAccounts.get(order.id);
  if (!joined || !joined.has(account.id)) return;
  if (!accountReachedCap(order, account)) return;
  try {
    await leaveTarget(client, target);
    joined.delete(account.id);
    addLog({
      orderId: order.id,
      accountId: account.id,
      level: "info",
      message: `🚪 اکانت «${account.name}» سهم خود را تکمیل کرد و از گروه مقصد خارج شد`,
    });
  } catch (err) {
    addLog({
      orderId: order.id,
      accountId: account.id,
      level: "warn",
      message: `⚠️ خروج اکانت «${account.name}» از گروه مقصد ناموفق بود: ${err.message}`,
    });
  }
}

/** خروج همه‌ی اکانت‌های باقی‌مانده‌ی این سفارش از گروه مقصد */
async function leaveJoined(order) {
  const joined = joinedAccounts.get(order.id);
  joinedAccounts.delete(order.id);
  // پاکسازی کش مقصد این سفارش
  for (const key of [...accountTargets.keys()]) {
    if (key.startsWith(`${order.id}:`)) accountTargets.delete(key);
  }
  if (!joined || !joined.size) return;

  for (const [accountId, target] of joined) {
    if (target?.type !== "channel") continue;
    const account = getDb().accounts.find((a) => a.id === accountId);
    if (!account) continue;
    try {
      const client = await getClient(account);
      await leaveTarget(client, target);
      addLog({
        orderId: order.id,
        accountId,
        level: "info",
        message: `🚪 اکانت «${account.name}» از گروه مقصد خارج شد`,
      });
    } catch (err) {
      addLog({
        orderId: order.id,
        accountId,
        level: "warn",
        message: `⚠️ خروج اکانت «${account.name}» از گروه مقصد ناموفق بود: ${err.message}`,
      });
    }
  }
}

/** تجزیه لینک پیام گروه: t.me/username/id یا t.me/c/internalId/id */
function parseMessageLink(link) {
  const s = String(link || "").trim();
  let m = s.match(/t\.me\/c\/(\d+)\/(\d+)/i);
  if (m) return { private: true, internalId: m[1], messageId: Number(m[2]) };
  m = s.match(/t\.me\/([A-Za-z0-9_]{4,})\/(\d+)/i);
  if (m) return { private: false, username: m[1], messageId: Number(m[2]) };
  return null;
}

/**
 * resolve تازه‌ی کاربر از روی «لینک پیام» با سشن همین اکانت.
 * access_hash کاربر بین اکانت‌ها/سشن‌ها معتبر نیست؛ پس مقدار تازه از خود پیام خوانده می‌شود.
 * در صورت هر شکستی null برمی‌گرداند تا مسیر جایگزین (access_hash ذخیره‌شده) امتحان شود.
 */
async function resolveUserFromLink(client, row) {
  const parsed = parseMessageLink(row.messageLink);
  if (!parsed) return null;

  let peer;
  if (!parsed.private) {
    peer = parsed.username;
  } else if (row.sourceGroupAccessHash) {
    peer = new Api.InputPeerChannel({
      channelId: BigInt("100" + parsed.internalId),
      accessHash: BigInt(row.sourceGroupAccessHash),
    });
  } else {
    return null;
  }

  try {
    const msgs = await client.getMessages(peer, { ids: [parsed.messageId] });
    const msg = Array.isArray(msgs) ? msgs[0] : msgs;
    if (!msg || msg.className === "MessageEmpty") return null;

    let sender = null;
    try {
      sender = await msg.getSender();
    } catch {
      /* ignore */
    }
    if (!sender || sender.className !== "User" || sender.accessHash == null) return null;
    if (row.telegramId != null && String(sender.id) !== String(row.telegramId)) return null;

    return new Api.InputUser({ userId: sender.id, accessHash: sender.accessHash });
  } catch {
    return null;
  }
}

/**
 * تبدیل یک ردیف مقصد به InputUser.
 * ترتیب: یوزرنیم → resolve تازه از لینک پیام → access_hash ذخیره‌شده (فقط به‌عنوان آخرین راه).
 */
async function resolveInputUser(client, row) {
  if (row.username) {
    const { inputUser } = await resolveUsername(client, row.username);
    return inputUser;
  }
  if (row.messageLink) {
    const fromLink = await resolveUserFromLink(client, row);
    if (fromLink) return fromLink;
  }
  if (row.telegramId != null && row.accessHash != null) {
    return new Api.InputUser({ userId: row.telegramId, accessHash: BigInt(row.accessHash) });
  }
  throw rpcError("USER_ID_INVALID", "اطلاعات این کاربر برای ادد کردن ناقص است");
}

/** برچسب نمایشی یک ردیف مقصد */
function labelOf(row) {
  if (row.username) return `@${row.username}`;
  if (row.label) return row.label;
  return row.telegramId != null ? `ID:${row.telegramId}` : "کاربر";
}

function targetRowEvent(row) {
  return {
    id: row.id,
    orderId: row.orderId,
    username: row.username || null,
    telegramId: row.telegramId ?? null,
    label: row.label || null,
    status: row.status,
    reason: row.reason || null,
    accountId: row.accountId ?? null,
    attempts: row.attempts || 0,
    updatedAt: row.updatedAt,
    doneAt: row.doneAt || null,
  };
}

async function setOrderFatal(order, info, account) {
  order.status = "failed";
  order.fatalError = info.message;
  order.pauseReason = `خطای بنیادی: ${info.code}`;
  order.updatedAt = Date.now();
  delete order.runtime;
  save();
  emitOrder(order);
  addLog({
    orderId: order.id,
    accountId: account?.id ?? null,
    level: "error",
    message: `🛑 خطای بنیادی سفارش (${info.code}): ${info.message} — اطمینان حاصل کنید اکانت‌ها ادمین گروه با دسترسی «افزودن کاربر» هستند`,
  });
}

async function handleAccountFailure(order, account, info, runner) {
  const db = getDb();
  const now = Date.now();

  if (info.kind === "ACCOUNT_FLOOD") {
    const seconds = info.seconds || 60;
    account.floodUntil = now + seconds * 1000;
    account.statusMessage = `FloodWait ${seconds}s`;
    account.lastErrorAt = now;
    account.lastErrorMessage = info.message;
    save();
    emitAccount(account);
    addLog({
      orderId: order.id,
      accountId: account.id,
      level: "warn",
      message: `⏳ اکانت «${account.name}» به مدت ${seconds} ثانیه محدود شد؛ سوییچ به اکانت بعدی`,
    });
    return;
  }

  if (info.kind === "ACCOUNT_SPAM") {
    const cooldownMs = (Number(db.settings.peerFloodCooldownMinutes) || 720) * 60 * 1000;
    account.status = "limited";
    account.floodUntil = now + cooldownMs;
    account.statusMessage = "PEER_FLOOD (اسپم‌بلاک)";
    account.lastErrorAt = now;
    account.lastErrorMessage = info.message;
    save();
    emitAccount(account);
    await closeClient(account.id);
    addLog({
      orderId: order.id,
      accountId: account.id,
      level: "error",
      message: `🚫 اکانت «${account.name}» اسپم‌بلاک شد (PEER_FLOOD) و برای ${Math.round(
        cooldownMs / 60000,
      )} دقیقه کنار گذاشته شد`,
    });
    return;
  }

  if (info.kind === "ACCOUNT_DEAD") {
    account.status = "error";
    account.statusMessage = `سشن از کار افتاده (${info.code})`;
    account.lastErrorAt = now;
    account.lastErrorMessage = info.message;
    save();
    emitAccount(account);
    await closeClient(account.id);
    addLog({
      orderId: order.id,
      accountId: account.id,
      level: "error",
      message: `❌ اکانت «${account.name}» از کار افتاد (${info.code}) و غیرفعال شد`,
    });
    return;
  }

  if (info.kind === "ACCOUNT_FROZEN") {
    account.status = "frozen";
    account.statusMessage = `اکانت فریز شده (${info.code})`;
    account.lastErrorAt = now;
    account.lastErrorMessage = info.message;
    save();
    emitAccount(account);
    await closeClient(account.id);
    addLog({
      orderId: order.id,
      accountId: account.id,
      level: "error",
      message: `🧊 اکانت «${account.name}» فریز شده است (${info.code})`,
    });
    return;
  }

  if (info.kind === "ACCOUNT_NO_PERMISSION") {
    order.blockedAccounts = Array.isArray(order.blockedAccounts) ? order.blockedAccounts : [];
    if (!order.blockedAccounts.includes(account.id)) order.blockedAccounts.push(account.id);
    account.lastErrorAt = now;
    account.lastErrorMessage = info.message;
    save();
    emitOrder(order);
    emitAccount(account);
    addLog({
      orderId: order.id,
      accountId: account.id,
      level: "warn",
      message: `⛔ اکانت «${account.name}» دسترسی «افزودن کاربر» در گروه مقصد ندارد و برای این سفارش کنار گذاشته شد`,
    });
    return;
  }

  if (info.kind === "ORDER_FATAL") {
    runner.cancelled = true;
    await setOrderFatal(order, info, account);
  }
}

function finishOrder(order, status) {
  order.status = status;
  order.finishedAt = Date.now();
  order.updatedAt = Date.now();
  if (status === "completed") order.pauseReason = null;
  delete order.runtime;
  save();
  emitOrder(order);

  const s = targetCounts(order.id);
  addLog({
    orderId: order.id,
    level: "success",
    message: `🏁 سفارش پایان یافت — ادد شده: ${s.added} | از قبل عضو: ${s.already} | رد شده: ${s.skipped} | ناموفق: ${s.failed}`,
  });
}

/* ------------------------- تیکر آزادسازی اکانت‌ها ------------------------- */

let rehabTimer = null;

export function startAccountRehabTicker() {
  if (rehabTimer) return;
  rehabTimer = setInterval(() => {
    const db = getDb();
    const now = Date.now();
    let changed = false;
    for (const account of db.accounts) {
      if (account.status === "limited" && (account.floodUntil || 0) <= now) {
        account.status = "active";
        account.floodUntil = 0;
        account.statusMessage = null;
        changed = true;
        emitAccount(account);
        addLog({
          accountId: account.id,
          level: "info",
          message: `✅ محدودیت اکانت «${account.name}» تمام شد و مجدداً فعال شد`,
        });
      }
    }
    if (changed) save();
  }, 30_000);
  rehabTimer.unref?.();
}

export function invalidateTargetCache(orderId) {
  const id = Number(orderId);
  targetCache.delete(id);
  for (const key of [...accountTargets.keys()]) {
    if (key.startsWith(`${id}:`)) accountTargets.delete(key);
  }
}
