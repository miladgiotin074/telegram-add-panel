import express from "express";
import { getDb, nextId, save, publicAccount, addLog } from "../db.js";
import { emit } from "../events.js";
import { startLogin, verifyLogin, submitPassword, finishLogin, cancelLogin } from "../telegram/login.js";

const router = express.Router();

function createAccountFromLogin(db, { session, profile, name, apiId, apiHash, phone }) {
  if (db.accounts.some((a) => a.session === session)) {
    return { error: "این سشن قبلاً اضافه شده است" };
  }
  const account = {
    id: nextId("account"),
    name: String(name || "").trim() || profile?.firstName || `اکانت ${db.counters.account}`,
    phone: phone || profile?.phone || null,
    session,
    apiId: String(apiId || ""),
    apiHash: String(apiHash || ""),
    username: profile?.username || null,
    firstName: profile?.firstName || "",
    lastName: profile?.lastName || "",
    telegramId: profile?.telegramId || null,
    status: "active",
    statusMessage: null,
    floodUntil: 0,
    maxTotalAdds: 0,
    addedTotal: 0,
    lastUsedAt: null,
    lastCheckedAt: Date.now(),
    lastErrorAt: null,
    lastErrorMessage: null,
    listen: { enabled: false, startedAt: null },
    collectedCount: 0,
    lastCollectAt: null,
    createdAt: Date.now(),
  };
  db.accounts.push(account);
  save();
  emit("account", publicAccount(account));
  addLog({ accountId: account.id, level: "info", message: `اکانت «${account.name}» با ورود شماره اضافه شد` });
  return { account };
}

/** مرحله ۱: ارسال کد */
router.post("/start", async (req, res) => {
  const db = getDb();
  const body = req.body || {};
  const apiId = Number(body.apiId || db.settings.apiId || 0);
  const apiHash = String(body.apiHash || db.settings.apiHash || "").trim();
  const phone = String(body.phone || "").trim();

  if (!apiId || !apiHash) {
    return res.status(400).json({ error: "api_id / api_hash تنظیم نشده است (در صفحه تنظیمات وارد کنید)" });
  }
  if (!phone) return res.status(400).json({ error: "شماره تلفن را وارد کنید" });

  try {
    const result = await startLogin({ apiId, apiHash, phone });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** مرحله ۲: تأیید کد */
router.post("/verify", async (req, res) => {
  const db = getDb();
  const { token, code, name } = req.body || {};
  if (!String(code || "").trim()) return res.status(400).json({ error: "کد را وارد کنید" });

  let result;
  try {
    result = await verifyLogin({ token, code });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (result.status === "need_password") return res.json({ status: "need_password" });
  if (result.status === "error") return res.status(400).json({ error: result.message });

  const created = createAccountFromLogin(db, {
    session: result.session,
    profile: result.profile,
    name,
    apiId: db.settings.apiId,
    apiHash: db.settings.apiHash,
    phone: null,
  });
  await finishLogin(token);
  if (created.error) return res.status(409).json({ error: created.error });
  res.status(201).json({ status: "ok", account: publicAccount(created.account) });
});

/** مرحله ۳: رمز دو مرحله‌ای */
router.post("/password", async (req, res) => {
  const db = getDb();
  const { token, password, name } = req.body || {};
  if (!String(password || "")) return res.status(400).json({ error: "رمز دو مرحله‌ای را وارد کنید" });

  let result;
  try {
    result = await submitPassword({ token, password });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (result.status === "error") return res.status(400).json({ error: result.message });

  const created = createAccountFromLogin(db, {
    session: result.session,
    profile: result.profile,
    name,
    apiId: db.settings.apiId,
    apiHash: db.settings.apiHash,
    phone: null,
  });
  await finishLogin(token);
  if (created.error) return res.status(409).json({ error: created.error });
  res.status(201).json({ status: "ok", account: publicAccount(created.account) });
});

/** انصراف در هر مرحله */
router.post("/cancel", async (req, res) => {
  await cancelLogin(req.body?.token);
  res.json({ ok: true });
});

/** اعتبارسنجی api/hash قبل از شروع (اختیاری) */
router.get("/config", (req, res) => {
  const db = getDb();
  res.json({
    hasCredentials: Boolean(db.settings.apiId && db.settings.apiHash),
  });
});

export default router;
