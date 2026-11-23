export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export const randInt = (min, max) => {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
};

/** تاخیر تصادفی بر اساس بازه ثانیه‌ای */
export const randDelayMs = (minSec, maxSec) => randInt(minSec, maxSec) * 1000;

/** خواب قابل‌توقف: هر ۵۰۰ms بررسی می‌کند که سفارش متوقف نشده باشد */
export async function interruptibleSleep(ms, isCancelled) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (isCancelled && isCancelled()) return;
    await sleep(Math.min(500, end - Date.now()));
  }
}
