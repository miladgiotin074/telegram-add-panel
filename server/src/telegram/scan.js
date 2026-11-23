import { getDb, addLog } from "../db.js";
import { getClient } from "./manager.js";
import { emit } from "../events.js";
import { collectMessage } from "./collect.js";
import { resolveEntity } from "./resolver.js";

/**
 * موتور اسکن سابقه‌ی چت یک گروه: از آخرین پیام به عقب (بالا) می‌رود و
 * فرستنده‌های یکتا را با همان قواعد شنود (نادیده‌گرفتن ربات/مدیر) و لینک پیام ذخیره می‌کند.
 */

const jobs = new Map();
let counter = 0;
const BATCH = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function snapshot(job) {
  return {
    id: job.id,
    accountId: job.accountId,
    accountName: job.accountName,
    groupLink: job.groupLink,
    groupTitle: job.groupTitle,
    groupId: job.groupId,
    status: job.status,
    scanned: job.scanned,
    collected: job.collected,
    limit: job.limit,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
  };
}

function emitJob(job) {
  emit("scan", snapshot(job));
}

async function runScan(job, client, entity) {
  job.status = "running";
  emitJob(job);
  let offsetId = 0;

  try {
    for (;;) {
      // کنترل توقف/تأخیر
      if (job.stopRequested) {
        job.status = "stopped";
        break;
      }
      while (job.paused && !job.stopRequested) await sleep(400);
      if (job.stopRequested) {
        job.status = "stopped";
        break;
      }

      let messages;
      try {
        messages = await client.getMessages(entity, { limit: BATCH, offsetId });
      } catch (err) {
        if (err?.seconds || /FLOOD_WAIT/i.test(err?.errorMessage || "")) {
          const wait = (err.seconds || 30) + 1;
          addLog({ accountId: job.accountId, level: "warn", message: `اسکن: انتظار ${wait} ثانیه به‌خاطر FloodWait` });
          await sleep(wait * 1000);
          continue; // همان دسته را دوباره امتحان کن
        }
        throw err;
      }

      if (!messages || messages.length === 0) break;

      let minId = offsetId || Infinity;
      for (const msg of messages) {
        if (msg.id && msg.id < minId) minId = msg.id;
        job.scanned += 1;
        try {
          const res = await collectMessage({ accountId: job.accountId, client, msg, chat: entity });
          if (res.stored) job.collected += 1;
        } catch {
          /* collectMessage خودش خطا را لاگ می‌کند */
        }
        if (job.limit && job.scanned >= job.limit) break;
        if (job.paused || job.stopRequested) break;
      }

      emitJob(job);

      if (job.limit && job.scanned >= job.limit) {
        job.status = "completed";
        break;
      }
      if (job.paused || job.stopRequested) continue;

      if (!Number.isFinite(minId)) break;
      offsetId = minId;
      if (messages.length < BATCH) break;
      await sleep(300); // مکث کوتاه بین دسته‌ها برای رعایت محدودیت‌ها
    }

    if (job.status === "running" || job.status === "paused") job.status = "completed";
  } catch (err) {
    job.status = "error";
    job.error = err?.errorMessage || err?.message || "خطای نامشخص";
    addLog({ accountId: job.accountId, level: "error", message: `اسکن «${job.groupTitle || job.groupLink}» ناموفق: ${job.error}` });
  } finally {
    job.finishedAt = Date.now();
    emitJob(job);
    addLog({
      accountId: job.accountId,
      level: "info",
      message: `اسکن «${job.groupTitle || job.groupLink}» پایان یافت — بررسی‌شده: ${job.scanned}، ذخیره‌شده: ${job.collected}`,
    });
  }
}

export async function startScan({ accountId, groupLink, limit = 0 }) {
  const db = getDb();
  const account = db.accounts.find((a) => a.id === Number(accountId));
  if (!account) throw new Error("اکانت پیدا نشد");
  if (!groupLink || !String(groupLink).trim()) throw new Error("لینک گروه را وارد کنید");

  const client = await getClient(account);
  const resolved = await resolveEntity(client, String(groupLink).trim(), true);

  const job = {
    id: ++counter,
    accountId: account.id,
    accountName: account.name,
    groupLink: String(groupLink).trim(),
    groupTitle: resolved.title || null,
    groupId: resolved.id || null,
    status: "running",
    scanned: 0,
    collected: 0,
    limit: Number(limit) > 0 ? Number(limit) : 0,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    paused: false,
    stopRequested: false,
  };
  jobs.set(job.id, job);
  emitJob(job);
  addLog({ accountId: account.id, level: "info", message: `شروع اسکن «${job.groupTitle || job.groupLink}»` });

  runScan(job, client, resolved.entity).catch(() => {});
  return snapshot(job);
}

export function listScans() {
  return [...jobs.values()].sort((a, b) => b.id - a.id).map(snapshot);
}

export function pauseScan(id) {
  const job = jobs.get(Number(id));
  if (!job) throw new Error("عملیات پیدا نشد");
  if (job.status === "running") {
    job.paused = true;
    job.status = "paused";
    emitJob(job);
  }
  return snapshot(job);
}

export function resumeScan(id) {
  const job = jobs.get(Number(id));
  if (!job) throw new Error("عملیات پیدا نشد");
  if (job.status === "paused") {
    job.paused = false;
    job.status = "running";
    emitJob(job);
  }
  return snapshot(job);
}

export function stopScan(id) {
  const job = jobs.get(Number(id));
  if (!job) throw new Error("عملیات پیدا نشد");
  job.stopRequested = true;
  job.paused = false;
  if (job.status === "paused") {
    job.status = "stopped";
    job.finishedAt = Date.now();
    emitJob(job);
  }
  return snapshot(job);
}

export function stopAllScans() {
  for (const job of jobs.values()) {
    job.stopRequested = true;
    job.paused = false;
  }
}
