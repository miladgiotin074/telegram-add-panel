import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { getDb } from "../db.js";

/** کلاینت‌های زنده به تفکیک اکانت */
const clients = new Map();

function credentials(account) {
  const db = getDb();
  const apiId = Number(account.apiId || db.settings.apiId || 0);
  const apiHash = account.apiHash || db.settings.apiHash || "";
  if (!apiId || !apiHash) {
    throw new Error("api_id / api_hash تنظیم نشده است (در صفحه تنظیمات وارد کنید)");
  }
  return { apiId, apiHash };
}

function createClient(account, apiId, apiHash) {
  const session = new StringSession(account.session || "");
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 3,
    // خودمان FloodWait را مدیریت می‌کنیم تا بتوانیم بین اکانت‌ها سوییچ کنیم
    floodSleepThreshold: 0,
    autoReconnect: true,
    deviceModel: "PC 64bit",
    systemVersion: "Windows 10",
    appVersion: "4.16.8",
    langCode: "en",
    systemLangCode: "en",
  });
  client.setLogLevel("error");
  return client;
}

/** اتصال (یا بازگرداندن کلاینت متصل) برای یک اکانت */
export async function getClient(account) {
  const cached = clients.get(account.id);
  if (cached) {
    try {
      if (!cached.client.connected) await cached.client.connect();
      return cached.client;
    } catch {
      clients.delete(account.id);
    }
  }

  const { apiId, apiHash } = credentials(account);
  const client = createClient(account, apiId, apiHash);
  await client.connect();
  const me = await client.getMe();
  if (!me) {
    await safeDisconnect(client);
    throw new Error("سشن معتبر نیست (unauthorized)");
  }

  // ذخیره تغییرات سشن (مثلاً DC فعلی)
  try {
    const saved = client.session.save();
    if (saved && saved !== account.session) account.session = saved;
  } catch {
    /* ignore */
  }

  clients.set(account.id, { client });
  return client;
}

/** بررسی سلامت اکانت و برگرداندن اطلاعات کاربر */
export async function checkAccount(account) {
  const client = await getClient(account);
  const me = await client.getMe();
  return {
    telegramId: me?.id ? me.id.toString() : null,
    username: me?.username || null,
    firstName: me?.firstName || "",
    lastName: me?.lastName || "",
    phone: me?.phone || account.phone || null,
  };
}

async function safeDisconnect(client) {
  try {
    await client.disconnect();
  } catch {
    /* ignore */
  }
}

export async function closeClient(accountId) {
  const entry = clients.get(accountId);
  if (!entry) return;
  clients.delete(accountId);
  await safeDisconnect(entry.client);
}

/** قطع اتصال یک اکانت تا بار بعدی از نو وصل شود (بعد از خطای شبکه) */
export function dropClient(accountId) {
  const entry = clients.get(accountId);
  if (!entry) return;
  clients.delete(accountId);
  safeDisconnect(entry.client);
}

export async function closeAll() {
  const ids = [...clients.keys()];
  await Promise.all(ids.map((id) => closeClient(id)));
}
