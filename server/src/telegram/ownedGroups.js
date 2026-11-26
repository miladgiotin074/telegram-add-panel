import { Api } from "teleproto";
import { getDb, addLog } from "../db.js";
import { getClient } from "./manager.js";
import { emit } from "../events.js";

/**
 * جمع‌آوری گروه‌هایی که یک سشن سازنده (creator/owner) آن‌هاست.
 *
 * روش کار: با getDialogs همه‌ی گفتگوهای اکانت گرفته می‌شود و از میان آن‌ها
 * فقط سوپرگروه‌ها (Channel با megagroup) و گروه‌های ساده (Chat) که فلگ creator
 * دارند انتخاب می‌شوند (یعنی همین اکانت سازنده است). کانال‌ها (broadcast) حذف می‌شوند.
 * فیلد date تاریخ ساخت گروه است؛ خروجی از قدیمی‌ترین به جدیدترین مرتب می‌شود.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** حداکثر زمان هر اکانت؛ تا یک سشن معلق کل عملیات را متوقف نکند */
const PER_ACCOUNT_TIMEOUT_MS = 90000;
/** مکث کوتاه بین اکانت‌ها برای رعایت محدودیت‌های تلگرام */
const BETWEEN_ACCOUNTS_MS = 500;

let current = null; // آخرین اسنپ‌شات برای GET
let runningJob = null;

function idleSnapshot() {
  return {
    id: 0,
    mode: null,
    status: "idle",
    total: 0,
    done: 0,
    currentAccountId: null,
    results: [],
    startedAt: null,
    finishedAt: null,
    error: null,
  };
}

function snapshot(job) {
  return {
    id: job.id,
    mode: job.mode,
    status: job.status,
    total: job.total,
    done: job.done,
    currentAccountId: job.currentAccountId,
    results: job.results,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
  };
}

function publish(job) {
  current = snapshot(job);
  emit("ownedGroups", current);
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** گروه‌های ساخته‌شده‌ی یک اکانت (مرتب از قدیمی‌ترین) */
async function fetchOwnedGroups(client, accountId) {
  for (;;) {
    try {
      const dialogs = await client.getDialogs({});
      const groups = [];
      for (const dialog of dialogs) {
        const entity = dialog.entity;
        if (!entity || !entity.creator) continue;

        // فقط سوپرگروه (Channel با megagroup) و گروه ساده (Chat) — کانال‌ها رد می‌شوند
        let kind;
        if (entity.className === "Channel") {
          if (!entity.megagroup) continue; // کانال (broadcast)
          kind = "supergroup";
        } else if (entity.className === "Chat") {
          kind = "group";
        } else {
          continue;
        }

        groups.push({
          id: String(entity.id),
          title: entity.title || dialog.title || "",
          username: entity.username || null,
          date: entity.date ? Number(entity.date) * 1000 : null,
          kind,
          participantsCount: entity.participantsCount || 0,
        });
      }
      groups.sort((a, b) => (a.date || 0) - (b.date || 0));
      return groups;
    } catch (err) {
      const message = err?.errorMessage || err?.message || "";
      if (err?.seconds || /FLOOD_WAIT/i.test(message)) {
        const wait = (err.seconds || 30) + 1;
        addLog({ accountId, level: "warn", message: `گروه‌های ساخته‌شده: انتظار ${wait} ثانیه (FloodWait)` });
        await sleep(wait * 1000);
        continue; // همان اکانت را دوباره امتحان کن
      }
      throw err;
    }
  }
}

/** آیا برای این اکانت تایید دو مرحله‌ای (رمز ابری) فعال است؟ */
async function fetchHas2FA(client) {
  const pwd = await client.invoke(new Api.account.GetPassword());
  return Boolean(pwd?.hasPassword);
}

async function runJob(job, accounts) {
  job.status = "running";
  publish(job);

  try {
    for (const account of accounts) {
      if (job.stopRequested) break;

      job.currentAccountId = account.id;
      const entry = job.results.find((r) => r.accountId === account.id);
      entry.status = "running";
      publish(job);

      try {
        const { groups, has2FA } = await withTimeout(
          (async () => {
            const client = await getClient(account);
            const list = await fetchOwnedGroups(client, account.id);
            let twoFA = null;
            try {
              twoFA = await fetchHas2FA(client);
            } catch {
              /* اگر وضعیت تایید دو مرحله‌ای قابل خواندن نبود، نامشخص می‌ماند */
            }
            return { groups: list, has2FA: twoFA };
          })(),
          PER_ACCOUNT_TIMEOUT_MS,
          "مهلت دریافت لیست گروه‌ها به پایان رسید",
        );
        entry.groups = groups;
        entry.has2FA = has2FA;
        entry.status = "done";
        addLog({
          accountId: account.id,
          level: "info",
          message: `گروه‌های ساخته‌شده‌ی «${account.name}»: ${groups.length} مورد`,
        });
      } catch (err) {
        entry.status = "error";
        entry.error = err?.errorMessage || err?.message || "خطای نامشخص";
        addLog({
          accountId: account.id,
          level: "error",
          message: `گروه‌های ساخته‌شده‌ی «${account.name}» ناموفق: ${entry.error}`,
        });
      }

      job.done += 1;
      job.currentAccountId = null;
      publish(job);

      if (job.stopRequested) break;
      await sleep(BETWEEN_ACCOUNTS_MS);
    }

    job.status = job.stopRequested ? "stopped" : "completed";
  } catch (err) {
    job.status = "error";
    job.error = err?.message || "خطای نامشخص";
  } finally {
    job.finishedAt = Date.now();
    publish(job);
    runningJob = null;
  }
}

/**
 * شروع جمع‌آوری گروه‌های ساخته‌شده.
 * @param {{accountId?: number|string}} opts - نبود accountId یعنی همه‌ی اکانت‌های غیرغیرفعال
 */
export function startOwnedGroups({ accountId } = {}) {
  const db = getDb();
  if (runningJob && runningJob.status === "running") {
    throw new Error("یک عملیات در حال اجراست؛ کمی بعد دوباره تلاش کنید");
  }

  let accounts;
  let mode;
  if (accountId) {
    const account = db.accounts.find((a) => a.id === Number(accountId));
    if (!account) throw new Error("اکانت پیدا نشد");
    accounts = [account];
    mode = "single";
  } else {
    accounts = db.accounts.filter((a) => a.status !== "disabled");
    if (!accounts.length) throw new Error("هیچ اکانت فعالی برای بررسی وجود ندارد");
    mode = "all";
  }

  const job = {
    id: (current?.id || 0) + 1,
    mode,
    status: "running",
    total: accounts.length,
    done: 0,
    currentAccountId: null,
    results: accounts.map((a) => ({
      accountId: a.id,
      accountName: a.name,
      status: "pending",
      error: null,
      has2FA: null,
      groups: [],
    })),
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    stopRequested: false,
  };

  runningJob = job;
  publish(job);
  addLog({
    level: "info",
    message:
      mode === "all"
        ? `شروع جمع‌آوری گروه‌های ساخته‌شده‌ی همه اکانت‌ها (${accounts.length} اکانت)`
        : `شروع جمع‌آوری گروه‌های ساخته‌شده‌ی «${accounts[0].name}»`,
  });

  runJob(job, accounts).catch((err) => {
    job.status = "error";
    job.error = err?.message || "خطای نامشخص";
    job.finishedAt = Date.now();
    publish(job);
    runningJob = null;
  });

  return snapshot(job);
}

export function getOwnedGroups() {
  return current || idleSnapshot();
}

export function stopOwnedGroups() {
  if (runningJob && runningJob.status === "running") runningJob.stopRequested = true;
  return getOwnedGroups();
}
