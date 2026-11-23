import { Api } from "teleproto";
import { getDb, save, addLog, hasSender, addSender, publicAccount } from "../db.js";
import { emit } from "../events.js";

/**
 * منطق مشترک جمع‌آوری فرستنده‌ها (هم برای شنود زنده و هم برای اسکن سابقه چت).
 * فقط پیام متنی گروه؛ ربات‌ها و مدیران/سازنده‌ها نادیده گرفته می‌شوند؛
 * برای هر کاربر یکتا فقط «لینک پیام» ذخیره می‌شود.
 */

/** آیدی‌های در حال پردازش (جلوگیری از ذخیره‌ی همزمان تکراری) */
const reserved = new Set();
/** کش مدیران/سازنده‌ها: "chatId:senderId" */
const adminSkip = new Set();

/** ساخت لینک پیام گروه: t.me/username/id یا t.me/c/internal/id */
export function linkFrom(chat, messageId) {
  if (!chat || messageId == null) return null;
  if (chat.username) return `https://t.me/${chat.username}/${messageId}`;
  const digits = String(chat.id).replace("-", "");
  if (digits.length > 10 && digits.startsWith("100")) {
    return `https://t.me/c/${digits.slice(3)}/${messageId}`;
  }
  return null;
}

/** آیا این انتیتی یک گروه (ساده یا سوپرگروه) است؟ */
export function isGroupChat(chat) {
  if (!chat) return false;
  if (chat.className === "Chat") return true;
  if (chat.className === "Channel") return Boolean(chat.megagroup);
  return false;
}

/**
 * آیا آخرین بازدید کاربر به تازگی بوده است؟
 * hours = 0 یعنی بدون فیلتر.
 * وضعیت‌های LastWeek / LastMonth / Empty (پنهان) رد می‌شوند.
 */
export function isRecentlyActive(sender, hours) {
  if (!hours || hours <= 0) return true;
  const st = sender?.status;
  if (!st) return false;
  const cls = st.className;
  if (cls === "UserStatusOnline") return true;
  if (cls === "UserStatusRecently") return true; // یعنی حداکثر چند روز اخیر
  if (cls === "UserStatusOffline") {
    const was = Number(st.wasOnline) || 0;
    if (!was) return false;
    return Date.now() / 1000 - was <= hours * 3600;
  }
  return false; // LastWeek / LastMonth / Empty
}

/** آیا کاربر مدیر یا سازنده‌ی گروه است؟ */
export async function isAdminOrCreator(client, chat, sender, senderId) {
  try {
    if (chat?.className === "Channel") {
      const res = await client.getParticipant(chat, sender || senderId);
      const cls = res?.participant?.className;
      return cls === "ChannelParticipantCreator" || cls === "ChannelParticipantAdmin";
    }
    // گروه ساده
    const full = await client.invoke(new Api.messages.GetFullChat({ chatId: chat.id }));
    const parts = full?.fullChat?.participants?.participants || [];
    const found = parts.find((p) => String(p.userId) === String(senderId));
    return found
      ? found.className === "ChatParticipantCreator" || found.className === "ChatParticipantAdmin"
      : false;
  } catch {
    // در صورت خطا محتاطانه عمل می‌کنیم و کاربر را ذخیره می‌کنیم
    return false;
  }
}

/**
 * بررسی یک پیام و ذخیره‌ی فرستنده‌ی یکتای آن.
 * @returns {Promise<{stored: boolean, reason: string, record?: any}>}
 */
export async function collectMessage({ accountId, client, msg, chat: chatArg }) {
  const db = getDb();
  const account = db.accounts.find((a) => a.id === accountId);
  if (!account) return { stored: false, reason: "account" };
  if (!msg) return { stored: false, reason: "empty" };
  if (msg.out) return { stored: false, reason: "out" }; // پیام خود اکانت

  let chat = chatArg || null;
  if (!chat) {
    try {
      chat = await msg.getChat();
    } catch {
      chat = null;
    }
  }
  if (!isGroupChat(chat)) return { stored: false, reason: "not-group" };

  const text = String(msg.text || "").trim();
  if (!text) return { stored: false, reason: "non-text" }; // فقط پیام‌های متنی

  // فقط فرستنده‌ی کاربر (نه ادمین ناشناس که به‌نام کانال پست می‌کند)
  const from = msg.fromId;
  if (!from || from.className !== "PeerUser") return { stored: false, reason: "anon" };

  const senderId = msg.senderId != null ? String(msg.senderId) : null;
  if (!senderId) return { stored: false, reason: "no-sender" };
  if (account.telegramId && senderId === String(account.telegramId)) return { stored: false, reason: "self" };

  // کاربرانی که قبلاً مدیر/سازنده تشخیص داده شدند را سریع رد کن
  const skipKey = `${msg.chatId}:${senderId}`;
  if (adminSkip.has(skipKey)) return { stored: false, reason: "admin" };

  // یکتایی سراسری
  if (hasSender(senderId)) return { stored: false, reason: "dup" };
  if (reserved.has(senderId)) return { stored: false, reason: "busy" };
  reserved.add(senderId);

  try {
    const messageLink = linkFrom(chat, msg.id);
    if (!messageLink) {
      // گروه ساده بدون لینک پیام → ذخیره نمی‌کنیم تا در گروه لینک‌دار ثبت شود
      reserved.delete(senderId);
      return { stored: false, reason: "no-link" };
    }

    let sender = null;
    try {
      sender = await msg.getSender();
    } catch {
      /* ignore */
    }
    if (sender && sender.className && sender.className !== "User") {
      reserved.delete(senderId);
      return { stored: false, reason: "not-user" };
    }

    // ربات‌ها را ذخیره نکن
    if (sender && sender.bot) {
      reserved.delete(senderId);
      return { stored: false, reason: "bot" };
    }

    // فقط کاربرانی که اخیراً آنلاین بوده‌اند
    if (!isRecentlyActive(sender, db.settings.recentActivityHours)) {
      reserved.delete(senderId);
      return { stored: false, reason: "inactive" };
    }

    // مدیران و سازنده‌های گروه را ذخیره نکن
    if (await isAdminOrCreator(client, chat, sender, senderId)) {
      adminSkip.add(skipKey);
      reserved.delete(senderId);
      return { stored: false, reason: "admin" };
    }

    const record = addSender({
      telegramId: senderId,
      accessHash: sender?.accessHash != null ? String(sender.accessHash) : null,
      username: sender?.username || null,
      firstName: sender?.firstName || "",
      lastName: sender?.lastName || "",
      sourceGroupId: chat?.id != null ? String(chat.id) : null,
      sourceGroupAccessHash: chat?.accessHash != null ? String(chat.accessHash) : null,
      sourceGroupTitle: chat?.title || null,
      sourceMessageId: msg.id ?? null,
      messageLink,
      accountId,
    });

    account.collectedCount = (account.collectedCount || 0) + 1;
    account.lastCollectAt = Date.now();
    save();
    emit("account", publicAccount(account));
    addLog({
      accountId,
      level: "success",
      message: `کاربر جدید: ${record.username ? "@" + record.username : senderId} از «${record.sourceGroupTitle || "گروه"}»`,
    });

    return { stored: true, record };
  } catch (err) {
    reserved.delete(senderId);
    addLog({
      accountId,
      level: "error",
      message: `ذخیره لینک پیام ${senderId} ناموفق بود: ${err.errorMessage || err.message}`,
    });
    return { stored: false, reason: "error", error: err };
  }
}
