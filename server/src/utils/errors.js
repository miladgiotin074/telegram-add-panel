/**
 * دسته‌بندی خطاهای تلگرام.
 * خطاها بر اساس errorMessage (رشته دقیق سرور تلگرام مثل FLOOD_WAIT_42) تشخیص داده می‌شوند
 * تا مستقل از نسخه کتابخانه پایدار بمانند.
 *
 * kind های ممکن:
 *  ACCOUNT_FLOOD  : محدودیت موقت روی اکانت -> سوییچ به اکانت بعدی
 *  ACCOUNT_SPAM   : PEER_FLOOD (اسپم‌بلاک) -> خنک‌سازی طولانی و سوییچ
 *  ACCOUNT_DEAD   : سشن از کار افتاده -> غیرفعال کردن اکانت
 *  ACCOUNT_FROZEN : اکانت فریز شده -> غیرفعال کردن اکانت
 *  ACCOUNT_NO_PERMISSION : اکانت دسترسی ادد در گروه مقصد ندارد (ادمین نیست) -> کنار گذاشتن همان اکانت
 *  ORDER_FATAL    : مشکل بنیادی (عدم دسترسی ادمین/گروه نامعتبر) -> توقف سفارش
 *  USER_ALREADY   : یوزر از قبل عضو است
 *  USER_SKIP      : یوزر قابل ادد نیست -> رد کردن همان یوزر
 *  NETWORK        : خطای شبکه -> تلاش مجدد
 *  UNKNOWN        : ناشناخته
 */

const EXACT = {
  PEER_FLOOD: "ACCOUNT_SPAM",

  SESSION_REVOKED: "ACCOUNT_DEAD",
  SESSION_EXPIRED: "ACCOUNT_DEAD",
  AUTH_KEY_UNREGISTERED: "ACCOUNT_DEAD",
  AUTH_KEY_INVALID: "ACCOUNT_DEAD",
  AUTH_KEY_DUPLICATED: "ACCOUNT_DEAD",
  AUTH_KEY_PERM_EMPTY: "ACCOUNT_DEAD",
  USER_DEACTIVATED: "ACCOUNT_DEAD",
  USER_DEACTIVATED_BAN: "ACCOUNT_DEAD",
  USER_BANNED: "ACCOUNT_DEAD",
  PHONE_NUMBER_BANNED: "ACCOUNT_DEAD",
  ACTIVE_USER_REQUIRED: "ACCOUNT_DEAD",

  CHAT_ADMIN_REQUIRED: "ACCOUNT_NO_PERMISSION",
  CHAT_WRITE_FORBIDDEN: "ACCOUNT_NO_PERMISSION",
  CHAT_FORBIDDEN: "ORDER_FATAL",
  CHANNEL_PRIVATE: "ORDER_FATAL",
  CHANNEL_INVALID: "ORDER_FATAL",
  CHAT_ID_INVALID: "ORDER_FATAL",
  PEER_ID_INVALID: "ORDER_FATAL",
  BROADCAST_REQUIRED: "ORDER_FATAL",
  CHAT_RESTRICTED: "ORDER_FATAL",
  USERS_TOO_MUCH: "ORDER_FATAL",
  USER_NOT_PARTICIPANT: "ORDER_FATAL",
  CHAT_MEMBER_ADD_FAILED: "ORDER_FATAL",
  INVITE_HASH_EXPIRED: "ORDER_FATAL",
  INVITE_HASH_INVALID: "ORDER_FATAL",

  USER_ALREADY_PARTICIPANT: "USER_ALREADY",

  USER_PRIVACY_RESTRICTED: "USER_SKIP",
  USER_NOT_MUTUAL_CONTACT: "USER_SKIP",
  USERNAME_NOT_OCCUPIED: "USER_SKIP",
  USERNAME_INVALID: "USER_SKIP",
  USERNAME_PURCHASE_AVAILABLE: "USER_SKIP",
  INPUT_USER_DEACTIVATED: "USER_SKIP",
  USER_CHANNELS_TOO_MUCH: "USER_SKIP",
  USER_BANNED_IN_CHANNEL: "USER_SKIP",
  USER_IS_BLOCKED: "USER_SKIP",
  YOU_BLOCKED_USER: "USER_SKIP",
  USER_ID_INVALID: "USER_SKIP",
  USER_NOT_FOUND: "USER_SKIP",
  PRIVACY_PREMIUM_REQUIRED: "USER_SKIP",
  CHAT_FORWARDS_RESTRICTED: "USER_SKIP",
  USER_KICKED: "USER_SKIP",
};

const FLOOD_PREFIXES = [
  "FLOOD_WAIT_",
  "SLOW_MODE_WAIT_",
  "FLOOD_PREMIUM_WAIT_",
  "2FA_CONFIRM_WAIT_",
];

const NETWORK_HINTS = [
  "TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EAI_AGAIN",
  "SOCKET",
  "DISCONNECT",
  "NETWORK",
];

export function classifyError(err) {
  const rawMessage = String(err?.errorMessage || err?.message || err || "");
  const code = rawMessage.split(":")[0].trim().toUpperCase();

  let seconds = typeof err?.seconds === "number" ? err.seconds : null;
  if (seconds == null) {
    const m = /^(?:FLOOD_WAIT_|SLOW_MODE_WAIT_|FLOOD_PREMIUM_WAIT_|2FA_CONFIRM_WAIT_)(\d+)$/.exec(code);
    if (m) seconds = Number(m[1]);
  }

  for (const prefix of FLOOD_PREFIXES) {
    if (code.startsWith(prefix)) {
      return { kind: "ACCOUNT_FLOOD", code, message: rawMessage, seconds: seconds ?? 60 };
    }
  }

  if (code.startsWith("FROZEN")) {
    return { kind: "ACCOUNT_FROZEN", code, message: rawMessage, seconds: null };
  }

  if (EXACT[code]) {
    return { kind: EXACT[code], code, message: rawMessage, seconds };
  }

  // انتقال بین دیتاسنترها توسط خود کتابخانه مدیریت می‌شود؛ اگر رسید یعنی موقتی است
  if (code.startsWith("NETWORK_MIGRATE_") || code.startsWith("PHONE_MIGRATE_") || code.startsWith("USER_MIGRATE_")) {
    return { kind: "NETWORK", code, message: rawMessage, seconds: null };
  }

  if (code.startsWith("INTERNAL_SERVER_ERROR") || code.startsWith("SERVER_ERROR")) {
    return { kind: "NETWORK", code, message: rawMessage, seconds: null };
  }

  if (NETWORK_HINTS.some((h) => code.includes(h) || rawMessage.toUpperCase().includes(h))) {
    return { kind: "NETWORK", code, message: rawMessage, seconds: null };
  }

  if (code.startsWith("USERNAME_")) {
    return { kind: "USER_SKIP", code, message: rawMessage, seconds: null };
  }

  return { kind: "UNKNOWN", code, message: rawMessage, seconds: null };
}

export function humanizeError(kind) {
  switch (kind) {
    case "ACCOUNT_FLOOD":
      return "FloodWait";
    case "ACCOUNT_SPAM":
      return "اسپم‌بلاک (PEER_FLOOD)";
    case "ACCOUNT_DEAD":
      return "سشن از کار افتاده";
    case "ACCOUNT_FROZEN":
      return "اکانت فریز شده";
    case "ACCOUNT_NO_PERMISSION":
      return "بدون دسترسی ادد در گروه مقصد";
    case "ORDER_FATAL":
      return "خطای بنیادی سفارش";
    case "USER_ALREADY":
      return "از قبل عضو بود";
    case "USER_SKIP":
      return "یوزر قابل ادد نبود";
    case "NETWORK":
      return "خطای شبکه";
    default:
      return "خطای ناشناخته";
  }
}
