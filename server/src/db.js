import fs from "node:fs";
import path from "node:path";
import { config, DEFAULT_SETTINGS } from "./config.js";
import { emit } from "./events.js";

const DB_FILE = path.join(config.dataDir, "db.json");

const EMPTY = () => ({
  settings: { ...DEFAULT_SETTINGS },
  accounts: [],
  orders: [],
  targets: [],
  senders: [],
  logs: [],
  counters: { account: 0, order: 0, target: 0, sender: 0, log: 0 },
});

let state = load();
let saveTimer = null;
let dirty = false;

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      const base = EMPTY();
      return {
        settings: { ...base.settings, ...(raw.settings || {}), defaultSettings: { ...base.settings.defaultSettings, ...(raw.settings?.defaultSettings || {}) } },
        accounts: raw.accounts || [],
        orders: raw.orders || [],
        targets: raw.targets || [],
        senders: raw.senders || [],
        logs: raw.logs || [],
        counters: { ...base.counters, ...(raw.counters || {}) },
      };
    }
  } catch (err) {
    console.error("[db] خطا در خواندن دیتابیس، از صفر شروع می‌شود:", err.message);
  }
  return EMPTY();
}

export function getDb() {
  return state;
}

export function save() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(flushNow, 150);
}

export function flushNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error("[db] خطا در ذخیره دیتابیس:", err.message);
  }
}

export function nextId(kind) {
  state.counters[kind] = (state.counters[kind] || 0) + 1;
  return state.counters[kind];
}

/* ---------- کاربران جمع‌آوری‌شده (سندرهای یکتا) ---------- */

/** ایندکس سریع آیدی‌های یکتا برای جلوگیری از ذخیره تکراری */
const senderIndex = new Set();
for (const s of state.senders) senderIndex.add(String(s.telegramId));

export function hasSender(telegramId) {
  return senderIndex.has(String(telegramId));
}

export function addSender(data) {
  const record = {
    id: nextId("sender"),
    telegramId: String(data.telegramId),
    accessHash: data.accessHash != null ? String(data.accessHash) : null,
    username: data.username || null,
    firstName: data.firstName || "",
    lastName: data.lastName || "",
    sourceGroupId: data.sourceGroupId != null ? String(data.sourceGroupId) : null,
    sourceGroupAccessHash: data.sourceGroupAccessHash != null ? String(data.sourceGroupAccessHash) : null,
    sourceGroupTitle: data.sourceGroupTitle || null,
    sourceMessageId: data.sourceMessageId ?? null,
    messageLink: data.messageLink || null,
    accountId: data.accountId ?? null,
    collectedAt: Date.now(),
  };
  state.senders.push(record);
  senderIndex.add(record.telegramId);
  save();
  emit("sender", record);
  return record;
}

export function clearSenders() {
  const count = state.senders.length;
  state.senders = [];
  senderIndex.clear();
  save();
  emit("sendersCleared", { count });
  return count;
}

export function removeSender(id) {
  const index = state.senders.findIndex((s) => s.id === Number(id));
  if (index === -1) return null;
  const [removed] = state.senders.splice(index, 1);
  // اگر همان کاربر دوباره پیام داد، باید بتواند مجدداً ذخیره شود
  senderIndex.delete(String(removed.telegramId));
  save();
  emit("senderDeleted", { id: removed.id });
  return removed;
}

export function addLog({ orderId = null, accountId = null, level = "info", message }) {
  const entry = {
    id: nextId("log"),
    orderId,
    accountId,
    level,
    message,
    createdAt: Date.now(),
  };
  state.logs.push(entry);
  const max = state.settings.maxLogs || 3000;
  if (state.logs.length > max) {
    state.logs.splice(0, state.logs.length - max);
  }
  save();

  /* ارسال زنده لاگ به UI (کانال SSE) با نام اکانت برای نمایش */
  const accountName = accountId ? state.accounts.find((a) => a.id === accountId)?.name || null : null;
  emit("log", { ...entry, accountName });
  return entry;
}

/** حذف اطلاعات حساس اکانت برای ارسال به کلاینت */
export function publicAccount(account) {
  if (!account) return null;
  const { session, apiHash, ...rest } = account;
  return {
    ...rest,
    hasSession: Boolean(session),
    sessionPreview: session ? `${session.slice(0, 8)}…${session.slice(-6)}` : null,
  };
}

export function publicOrder(order) {
  if (!order) return null;
  return { ...order };
}

process.on("exit", flushNow);
process.on("SIGINT", () => {
  flushNow();
  process.exit(0);
});
