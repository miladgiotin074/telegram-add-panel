import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { flushNow, getDb } from "./db.js";
import accountsRouter from "./routes/accounts.js";
import loginRouter from "./routes/login.js";
import ordersRouter from "./routes/orders.js";
import scanRouter from "./routes/scan.js";
import sendersRouter from "./routes/senders.js";
import settingsRouter from "./routes/settings.js";
import statsRouter from "./routes/stats.js";
import eventsRouter from "./routes/events.js";
import { resetRunningOrders, startAccountRehabTicker, stopAll } from "./engine/engine.js";
import { closeAll } from "./telegram/manager.js";
import { startEnabledListeners, stopAllListeners } from "./telegram/listener.js";
import { stopAllScans } from "./telegram/scan.js";

const app = express();

// پیشوند زمان (ISO) برای همه‌ی لاگ‌ها؛ در app.log هیچ timestamp دیگری اضافه نمی‌شود
for (const level of ["log", "info", "warn", "error"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => original(`[${new Date().toISOString()}]`, ...args);
}

app.use(cors());
app.use(express.json({ limit: "25mb" }));

// لاگ دقیق درخواست‌های API (برای عیب‌یابی مسیر/تایم‌اوت/قطع اتصال)
app.use("/api", (req, res, next) => {
  const startedAt = Date.now();
  const size = req.headers["content-length"] || 0;
  console.log(`[api] → ${req.method} ${req.originalUrl} (${size}b) از ${req.ip}`);

  res.on("finish", () => {
    const ms = Date.now() - startedAt;
    const line = `[api] ← ${req.method} ${req.originalUrl} ${res.statusCode} (${ms}ms)`;
    if (res.statusCode >= 400) console.warn(`${line} ⚠`);
    else if (ms > 3000) console.warn(`${line} [کند]`);
    else console.log(line);
  });

  // اگر اتصال قبل از ارسال پاسخ قطع شود (نشانه‌ی پروکسی/تایم‌اوت/کلاینت قطع‌کننده)
  res.on("close", () => {
    if (!res.writableEnded) {
      console.warn(
        `[api] ✂ اتصال پیش از پاسخ بسته شد: ${req.method} ${req.originalUrl} (${Date.now() - startedAt}ms)`
      );
    }
  });

  res.on("error", (err) => {
    console.error(`[api] خطای پاسخ ${req.method} ${req.originalUrl}:`, err?.stack || err);
  });

  next();
});

app.get("/api/health", (req, res) => {
  const db = getDb();
  res.json({
    ok: true,
    accounts: db.accounts.length,
    orders: db.orders.length,
    targets: db.targets.length,
    hasApiCredentials: Boolean(db.settings.apiId && db.settings.apiHash),
  });
});

app.use("/api/accounts/login", loginRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/scan", scanRouter);
app.use("/api/senders", sendersRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/stats", statsRouter);
app.use("/api/events", eventsRouter);

// مسیرهای API ناشناخته → 404 جیسون
app.use("/api", (req, res) => {
  res.status(404).json({ error: "مسیر پیدا نشد" });
});

// سرو کردن فایل‌های ساخته‌شده‌ی کلاینت (production)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "..", "..", "client", "dist");

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: همه‌ی مسیرهای غیر-API به index.html
  app.get("*", (req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  app.use((req, res) => {
    res
      .status(404)
      .json({ error: "مسیر پیدا نشد (نسخه‌ی build کلاینت یافت نشد؛ ابتدا آن را بسازید)" });
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[api] ❌ خطای سرور در ${req.method} ${req.originalUrl}:`, err?.stack || err);
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({ error: err?.message || "خطای داخلی سرور" });
});

// محافظ: یک خطای پرت‌شده (مثلاً از سوکت تلگرام) نباید کل سرور را از کار بیندازد
process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandledRejection:", reason?.stack || reason);
});
process.on("uncaughtException", (err) => {
  console.error("[process] uncaughtException:", err?.stack || err);
});

resetRunningOrders();
startAccountRehabTicker();

const server = app.listen(config.port, async () => {
  console.log(`\n  🚀 API روی http://localhost:${config.port} آماده است`);
  console.log(`  📦 داده‌ها در: ${config.dataDir}\n`);
  try {
    await startEnabledListeners();
  } catch (err) {
    console.error("[listener] خطا در راه‌اندازی شنود:", err.message);
  }
});

async function shutdown() {
  console.log("\nدر حال خاموش شدن…");
  stopAllListeners();
  stopAllScans();
  await stopAll();
  await closeAll();
  flushNow();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
