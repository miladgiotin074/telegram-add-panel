import { NewMessage } from "teleproto/events";
import { getDb, save, addLog, publicAccount } from "../db.js";
import { getClient } from "./manager.js";
import { emit } from "../events.js";
import { collectMessage } from "./collect.js";

/**
 * موتور شنود زنده: پیام‌های جدید گروه‌ها را می‌گیرد و به ماژول مشترک collect می‌سپارد.
 * (بدون فوروارد؛ فقط ذخیره‌ی لینک پیام فرستنده‌های یکتا)
 */

/** accountId -> { client, handler, event } */
const listeners = new Map();

export function isListening(accountId) {
  return listeners.has(Number(accountId));
}

export function listeningAccountIds() {
  return [...listeners.keys()];
}

async function handleEvent(accountId, event) {
  const listener = listeners.get(accountId);
  if (!listener) return;
  await collectMessage({ accountId, client: listener.client, msg: event.message });
}

/** فعال‌سازی شنود برای یک اکانت */
export async function startListener(accountId) {
  const id = Number(accountId);
  const db = getDb();
  const account = db.accounts.find((a) => a.id === id);
  if (!account) throw new Error("اکانت پیدا نشد");

  if (listeners.has(id)) {
    account.listen = { enabled: true, startedAt: account.listen?.startedAt || Date.now() };
    save();
    return;
  }

  const client = await getClient(account);

  const handler = (event) => {
    handleEvent(id, event).catch(() => {});
  };
  const eventBuilder = new NewMessage({ incoming: true });
  client.addEventHandler(handler, eventBuilder);

  listeners.set(id, { client, handler, event: eventBuilder });

  account.listen = { enabled: true, startedAt: Date.now() };
  save();
  emit("account", publicAccount(account));
  addLog({ accountId: id, level: "info", message: `شنود اکانت «${account.name}» فعال شد` });
}

/** غیرفعال‌سازی شنود */
export function stopListener(accountId, { silent = false } = {}) {
  const id = Number(accountId);
  const entry = listeners.get(id);
  if (entry) {
    try {
      entry.client.removeEventHandler(entry.handler, entry.event);
    } catch {
      /* ignore */
    }
    listeners.delete(id);
  }
  const account = getDb().accounts.find((a) => a.id === id);
  if (account) {
    account.listen = { enabled: false, startedAt: null };
    save();
    emit("account", publicAccount(account));
    if (!silent) addLog({ accountId: id, level: "info", message: `شنود اکانت «${account.name}» غیرفعال شد` });
  }
}

/** اطمینان از زنده بودن هندلرها (در صورت reconnect شدن کلاینت) */
async function ensureAlive() {
  for (const [id, entry] of [...listeners.entries()]) {
    const account = getDb().accounts.find((a) => a.id === id);
    if (!account) {
      stopListener(id, { silent: true });
      continue;
    }
    try {
      if (!entry.client.connected) {
        const client = await getClient(account);
        if (client !== entry.client) {
          try {
            entry.client.removeEventHandler(entry.handler, entry.event);
          } catch {
            /* ignore */
          }
          client.addEventHandler(entry.handler, entry.event);
          entry.client = client;
        }
      }
    } catch (err) {
      addLog({ accountId: id, level: "error", message: `اتصال مجدد شنود ناموفق: ${err.message}` });
    }
  }
}

let ticker = null;

/** راه‌اندازی شنود برای همه اکانت‌های فعال‌شده (هنگام بالا آمدن سرور) */
export async function startEnabledListeners() {
  const db = getDb();
  const ids = db.accounts.filter((a) => a.listen?.enabled).map((a) => a.id);
  for (const id of ids) {
    try {
      await startListener(id);
    } catch (err) {
      const account = db.accounts.find((a) => a.id === id);
      if (account) account.listen = { enabled: false, startedAt: null };
      save();
      addLog({ accountId: id, level: "error", message: `شنود اکانت «${account?.name}» فعال نشد: ${err.message}` });
    }
  }
  if (ids.length) {
    console.log(`  👂 شنود ${listeners.size} اکانت فعال شد`);
  }
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => ensureAlive().catch(() => {}), 45 * 1000);
  ticker.unref?.();
}

export function stopAllListeners() {
  for (const id of [...listeners.keys()]) stopListener(id, { silent: true });
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}
