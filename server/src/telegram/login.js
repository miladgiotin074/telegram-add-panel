import crypto from "node:crypto";
import { TelegramClient, Api } from "teleproto";
import { StringSession } from "teleproto/sessions";

/**
 * جریان ورود تعاملی (شماره → کد → رمز دو مرحله‌ای).
 * کلاینت بین مراحل زنده نگه داشته می‌شود چون کلید احراز هویت داخل سشن همان کلاینت است.
 */

const LOGIN_TTL_MS = 10 * 60 * 1000;
/** token -> { client, apiId, apiHash, phone, phoneCodeHash, createdAt } */
const pending = new Map();

function makeClient(apiId, apiHash) {
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 3,
    floodSleepThreshold: 60,
    autoReconnect: false,
    deviceModel: "PC 64bit",
    systemVersion: "Windows 10",
    appVersion: "4.16.8",
    langCode: "en",
    systemLangCode: "en",
  });
  client.setLogLevel("error");
  return client;
}

async function safeDisconnect(client) {
  try {
    await client.disconnect();
  } catch {
    /* ignore */
  }
}

function requireEntry(token) {
  const entry = pending.get(String(token || ""));
  if (!entry) throw new Error("جلسه ورود پیدا نشد یا منقضی شده است؛ دوباره تلاش کنید");
  return entry;
}

function profileOf(me) {
  if (!me) return null;
  return {
    telegramId: me.id != null ? String(me.id) : null,
    username: me.username || null,
    firstName: me.firstName || "",
    lastName: me.lastName || "",
    phone: me.phone || null,
  };
}

/** مرحله ۱: ارسال کد به شماره */
export async function startLogin({ apiId, apiHash, phone }) {
  const client = makeClient(apiId, apiHash);
  await client.connect();

  let sent;
  try {
    sent = await client.sendCode({ apiId, apiHash }, phone);
  } catch (err) {
    await safeDisconnect(client);
    throw new Error(err.errorMessage || err.message || "ارسال کد ناموفق بود");
  }

  if (sent.emailRequired || sent.emailCodeSent) {
    await safeDisconnect(client);
    throw new Error("این اکانت کد را از طریق ایمیل می‌خواهد که پشتیبانی نمی‌شود");
  }

  const token = crypto.randomBytes(16).toString("hex");
  pending.set(token, {
    client,
    apiId,
    apiHash,
    phone,
    phoneCodeHash: sent.phoneCodeHash,
    createdAt: Date.now(),
  });

  return { token, isCodeViaApp: Boolean(sent.isCodeViaApp) };
}

/** مرحله ۲: تأیید کد ارسال‌شده */
export async function verifyLogin({ token, code }) {
  const entry = requireEntry(token);
  try {
    await entry.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: entry.phone,
        phoneCodeHash: entry.phoneCodeHash,
        phoneCode: String(code || "").trim(),
      }),
    );
  } catch (err) {
    if (err.errorMessage === "SESSION_PASSWORD_NEEDED") {
      return { status: "need_password" };
    }
    return { status: "error", message: err.errorMessage || err.message };
  }

  const me = await entry.client.getMe();
  return { status: "ok", session: entry.client.session.save(), profile: profileOf(me) };
}

/** مرحله ۳ (در صورت نیاز): رمز دو مرحله‌ای */
export async function submitPassword({ token, password }) {
  const entry = requireEntry(token);
  try {
    await entry.client.signInWithPassword(
      { apiId: entry.apiId, apiHash: entry.apiHash },
      { password: async () => String(password || ""), onError: async () => true },
    );
  } catch (err) {
    return { status: "error", message: err.errorMessage || err.message || "رمز نادرست است" };
  }

  const me = await entry.client.getMe();
  return { status: "ok", session: entry.client.session.save(), profile: profileOf(me) };
}

/** پایان کار: بستن کلاینت موقت و پاک کردن توکن */
export async function finishLogin(token) {
  const entry = pending.get(String(token || ""));
  if (!entry) return;
  pending.delete(String(token));
  await safeDisconnect(entry.client);
}

/** انصراف از ورود */
export async function cancelLogin(token) {
  await finishLogin(token);
}

/** پاک‌سازی خودکار جلسه‌های کهنه */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of pending.entries()) {
    if (now - entry.createdAt > LOGIN_TTL_MS) {
      pending.delete(token);
      safeDisconnect(entry.client);
    }
  }
}, 60 * 1000);
sweeper.unref?.();
