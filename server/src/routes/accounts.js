import express from "express";
import { getDb, nextId, save, publicAccount, addLog } from "../db.js";
import { checkAccount, closeClient, dropClient } from "../telegram/manager.js";
import { startListener, stopListener, isListening } from "../telegram/listener.js";
import { emit } from "../events.js";

const router = express.Router();

/** سقف اتصال‌های همزمان به تلگرام هنگام اعتبارسنجی (جلوگیری از پرش حافظه/سوکت) */
const CHECK_CONCURRENCY = 4;
/** حداکثر زمان اعتبارسنجی هر سشن (میلی‌ثانیه) تا یک سشن خراب کل درخواست را معلق نکند */
const CHECK_TIMEOUT_MS = 30000;

function cleanSession(value) {
  return String(value || "").trim();
}

/** اجرای موازی با سقف همزمانی */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("مهلت اعتبارسنجی سشن به پایان رسید")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** اعتبارسنجی سشن‌ها در پس‌زمینه (بدون بلوکه کردن پاسخ HTTP، تا درخواست کوتاه و امن بماند) */
function validateAccountsInBackground(accounts) {
  mapLimit(accounts, CHECK_CONCURRENCY, async (account) => {
    try {
      const info = await withTimeout(checkAccount(account), CHECK_TIMEOUT_MS);
      Object.assign(account, info);
      account.status = "active";
      account.statusMessage = null;
    } catch (err) {
      account.status = "error";
      account.statusMessage = err.message;
      // آزادسازی منابع سشن نامعتبر تا سرور با انبوه سشن‌های خراب اشباع نشود
      dropClient(account.id);
    }
    account.lastCheckedAt = Date.now();
    emit("account", publicAccount(account));
    save();
  }).catch((err) => {
    console.error("[accounts] خطا در اعتبارسنجی پس‌زمینه:", err?.message || err);
  });
}

router.get("/", (req, res) => {
  const db = getDb();
  res.json(db.accounts.map(publicAccount));
});

router.post("/", async (req, res) => {
  const db = getDb();
  const { name, phone, session, apiId, apiHash, maxTotalAdds, validate } = req.body || {};
  const sessionValue = cleanSession(session);

  if (!sessionValue) {
    return res.status(400).json({ error: "رشته سشن (Session) الزامی است" });
  }
  if (db.accounts.some((a) => a.session === sessionValue)) {
    return res.status(409).json({ error: "این سشن قبلاً اضافه شده است" });
  }

  const account = {
    id: nextId("account"),
    name: String(name || "").trim() || `اکانت ${db.counters.account}`,
    phone: String(phone || "").trim() || null,
    session: sessionValue,
    apiId: String(apiId || "").trim() || "",
    apiHash: String(apiHash || "").trim() || "",
    username: null,
    firstName: "",
    lastName: "",
    telegramId: null,
    status: "active",
    statusMessage: null,
    floodUntil: 0,
    maxTotalAdds: Number(maxTotalAdds) > 0 ? Number(maxTotalAdds) : 0,
    addedTotal: 0,
    lastUsedAt: null,
    lastCheckedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    listen: { enabled: false, startedAt: null },
    collectedCount: 0,
    lastCollectAt: null,
    createdAt: Date.now(),
  };
  db.accounts.push(account);
  save();

  if (validate !== false) {
    try {
      const info = await checkAccount(account);
      Object.assign(account, info);
      account.status = "active";
      account.statusMessage = null;
      account.lastCheckedAt = Date.now();
    } catch (err) {
      account.status = "error";
      account.statusMessage = err.message;
      account.lastCheckedAt = Date.now();
    }
    save();
  }

  emit("account", publicAccount(account));
  addLog({
    accountId: account.id,
    level: account.status === "active" ? "info" : "error",
    message: `اکانت «${account.name}» اضافه شد${account.status === "active" ? " و تأیید شد" : ` (خطا: ${account.statusMessage})`}`,
  });

  res.status(201).json(publicAccount(account));
});

/** افزودن دسته‌ای سشن‌ها */
router.post("/import", async (req, res) => {
  const db = getDb();
  const raw = String(req.body?.sessions || req.body?.text || "");
  const lines = raw
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return res.status(400).json({ error: "هیچ سشنی وارد نشده است" });

  const created = [];
  const skipped = [];
  for (const line of lines) {
    const sessionValue = cleanSession(line);
    if (!sessionValue) continue;
    if (db.accounts.some((a) => a.session === sessionValue)) {
      skipped.push(sessionValue.slice(0, 12));
      continue;
    }
    const account = {
      id: nextId("account"),
      name: `اکانت ${db.counters.account}`,
      phone: null,
      session: sessionValue,
      apiId: "",
      apiHash: "",
      username: null,
      firstName: "",
      lastName: "",
      telegramId: null,
      status: "active",
      statusMessage: null,
      floodUntil: 0,
      maxTotalAdds: 0,
      addedTotal: 0,
      lastUsedAt: null,
      lastCheckedAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      listen: { enabled: false, startedAt: null },
      collectedCount: 0,
      lastCollectAt: null,
      createdAt: Date.now(),
    };
    db.accounts.push(account);
    created.push(account);
  }
  save();
  addLog({ level: "info", message: `افزودن دسته‌ای سشن‌ها: ${created.length} اکانت اضافه شد` });

  // پاسخ فوری می‌دهیم؛ اعتبارسنجی در پس‌زمینه انجام می‌شود تا درخواست HTTP
  // طولانی نشود (جلوگیری از تایم‌اوت/۵۰۳ روی مسیر شبکه). نتایج زنده از طریق SSE می‌آید.
  res.status(201).json({ created: created.map(publicAccount), skipped, validating: created.length });
  validateAccountsInBackground(created);
});

/** بررسی سلامت همه اکانت‌ها */
router.post("/check-all", async (req, res) => {
  const db = getDb();
  await mapLimit(db.accounts, CHECK_CONCURRENCY, async (account) => {
    try {
      const info = await withTimeout(checkAccount(account), CHECK_TIMEOUT_MS);
      Object.assign(account, info);
      if (account.status === "error" || account.status === "disabled") return;
      account.status = "active";
      account.statusMessage = null;
    } catch (err) {
      if (account.status !== "disabled") {
        account.status = "error";
        account.statusMessage = err.message;
      }
    }
    account.lastCheckedAt = Date.now();
    emit("account", publicAccount(account));
  });
  save();
  res.json(db.accounts.map(publicAccount));
});

/** حذف دسته‌جمعی اکانت‌های غیرفعال (وضعیت «خطا» و «غیرفعال») */
router.post("/delete-inactive", async (req, res) => {
  const db = getDb();
  const statuses = ["error", "disabled"];
  const victims = db.accounts.filter((a) => statuses.includes(a.status));

  for (const account of victims) {
    stopListener(account.id, { silent: true });
    await closeClient(account.id);
    emit("accountDeleted", { id: account.id });
  }
  for (let i = db.accounts.length - 1; i >= 0; i--) {
    if (statuses.includes(db.accounts[i].status)) db.accounts.splice(i, 1);
  }

  save();
  if (victims.length) {
    addLog({ level: "warn", message: `حذف دسته‌جمعی: ${victims.length} اکانت غیرفعال پاک شد` });
  }
  res.json({ ok: true, deleted: victims.length });
});

router.patch("/:id", (req, res) => {
  const db = getDb();
  const account = db.accounts.find((a) => a.id === Number(req.params.id));
  if (!account) return res.status(404).json({ error: "اکانت پیدا نشد" });

  const body = req.body || {};
  if (body.name != null) account.name = String(body.name).trim() || account.name;
  if (body.phone != null) account.phone = String(body.phone).trim() || null;
  if (body.apiId != null) account.apiId = String(body.apiId).trim();
  if (body.apiHash != null) account.apiHash = String(body.apiHash).trim();
  if (body.maxTotalAdds != null) account.maxTotalAdds = Number(body.maxTotalAdds) > 0 ? Number(body.maxTotalAdds) : 0;
  if (body.status != null && ["active", "disabled"].includes(body.status)) {
    account.status = body.status;
    if (body.status === "active") {
      account.floodUntil = 0;
      account.statusMessage = null;
    }
  }
  if (body.session != null && String(body.session).trim()) {
    account.session = String(body.session).trim();
    account.statusMessage = null;
  }
  if (body.resetCounters) {
    account.addedTotal = 0;
    account.floodUntil = 0;
    account.statusMessage = null;
    if (account.status !== "disabled") account.status = "active";
  }

  save();
  emit("account", publicAccount(account));
  res.json(publicAccount(account));
});

router.post("/:id/check", async (req, res) => {
  const db = getDb();
  const account = db.accounts.find((a) => a.id === Number(req.params.id));
  if (!account) return res.status(404).json({ error: "اکانت پیدا نشد" });

  try {
    const info = await checkAccount(account);
    Object.assign(account, info);
    if (account.status !== "disabled") account.status = "active";
    account.statusMessage = null;
  } catch (err) {
    account.status = "error";
    account.statusMessage = err.message;
  }
  account.lastCheckedAt = Date.now();
  save();
  emit("account", publicAccount(account));
  res.json(publicAccount(account));
});

/** روشن/خاموش کردن حالت شنود */
router.post("/:id/listen", async (req, res) => {
  const db = getDb();
  const account = db.accounts.find((a) => a.id === Number(req.params.id));
  if (!account) return res.status(404).json({ error: "اکانت پیدا نشد" });

  const enabled = req.body?.enabled !== false && req.body?.enabled !== "false";
  try {
    if (enabled) await startListener(account.id);
    else stopListener(account.id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  res.json({ ...publicAccount(account), listening: isListening(account.id) });
});

router.delete("/:id", async (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const index = db.accounts.findIndex((a) => a.id === id);
  if (index === -1) return res.status(404).json({ error: "اکانت پیدا نشد" });

  stopListener(id, { silent: true });
  await closeClient(id);
  const [removed] = db.accounts.splice(index, 1);
  save();
  emit("accountDeleted", { id });
  addLog({ level: "warn", message: `اکانت «${removed.name}» حذف شد` });
  res.json({ ok: true });
});

export default router;
