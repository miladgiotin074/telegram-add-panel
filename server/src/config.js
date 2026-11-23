import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 5000),
  dataDir: process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(__dirname, "..", "data"),
};

/** تنظیمات پیش‌فرض یک سفارش (قابل تغییر در فرم ثبت سفارش) */
export const DEFAULT_ORDER_SETTINGS = {
  /** سقف تعداد یوزر در هر درخواست ادد (InviteToChannel) */
  batchSize: 1,
  /** سقف کلی ادد برای هر اکانت مبدا در این سفارش (0 = نامحدود) */
  maxPerAccount: 40,
  /** حداقل فاصله بین هر ادد (ثانیه) */
  delayMinSec: 20,
  /** حداکثر فاصله بین هر ادد (ثانیه) */
  delayMaxSec: 60,
  /** در صورت لینک دعوت، اکانت قبل از ادد کردن جوین شود */
  autoJoin: true,
  /** حداکثر تلاش برای هر یوزر در صورت خطای مربوط به خود یوزر */
  maxAttempts: 3,
};

export const DEFAULT_SETTINGS = {
  apiId: "",
  apiHash: "",
  /** مدت خنک‌سازی اکانت بعد از خطای PEER_FLOOD (دقیقه) */
  peerFloodCooldownMinutes: 720,
  /** سقف نگهداری لاگ‌ها در دیتابیس */
  maxLogs: 3000,
  /** اگر FloodWait کمتر از این مقدار باشد، به‌جای سوییچ اکانت صبر می‌کنیم (ثانیه) */
  shortFloodWaitSeconds: 60,
  /** فقط کاربرانی جمع‌آوری شوند که «آخرین بازدید»شان حداکثر این تعداد ساعت پیش بوده (0 = بدون فیلتر) */
  recentActivityHours: 72,
  defaultSettings: { ...DEFAULT_ORDER_SETTINGS },
};
