import express from "express";
import { getDb, clearSenders, removeSender, addLog } from "../db.js";

const router = express.Router();

/** لیست کاربران جمع‌آوری‌شده با جستجو، فیلتر و صفحه‌بندی */
router.get("/", (req, res) => {
  const db = getDb();
  const { q = "", accountId = "", group = "", page = "1", pageSize = "50" } = req.query;
  const query = String(q).trim().toLowerCase();

  let items = db.senders;
  if (query) {
    items = items.filter(
      (s) =>
        (s.username || "").toLowerCase().includes(query) ||
        String(s.telegramId).includes(query) ||
        `${s.firstName || ""} ${s.lastName || ""}`.toLowerCase().includes(query) ||
        (s.sourceGroupTitle || "").toLowerCase().includes(query),
    );
  }
  if (accountId) items = items.filter((s) => String(s.accountId) === String(accountId));
  if (group) items = items.filter((s) => String(s.sourceGroupId) === String(group));

  items = [...items].sort((a, b) => b.collectedAt - a.collectedAt);

  const total = items.length;
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 50));
  const p = Math.max(1, Number(page) || 1);
  const start = (p - 1) * ps;

  res.json({ total, page: p, pageSize: ps, items: items.slice(start, start + ps) });
});

/** آمار کاربران جمع‌آوری‌شده */
router.get("/stats", (req, res) => {
  const db = getDb();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayStart = startOfDay.getTime();

  const byAccount = new Map();
  const byGroup = new Map();
  let today = 0;
  for (const s of db.senders) {
    const accKey = s.accountId ?? 0;
    byAccount.set(accKey, (byAccount.get(accKey) || 0) + 1);
    const gKey = s.sourceGroupId || "unknown";
    if (!byGroup.has(gKey)) byGroup.set(gKey, { title: s.sourceGroupTitle || "نامشخص", count: 0 });
    byGroup.get(gKey).count += 1;
    if (s.collectedAt >= todayStart) today += 1;
  }

  res.json({
    total: db.senders.length,
    today,
    accounts: db.accounts.map((a) => ({ id: a.id, name: a.name, collected: byAccount.get(a.id) || 0 })),
    groups: [...byGroup.entries()]
      .map(([id, v]) => ({ id, title: v.title, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
  });
});

/** حذف یک فرستنده */
router.delete("/:id", (req, res) => {
  const removed = removeSender(req.params.id);
  if (!removed) return res.status(404).json({ error: "کاربر پیدا نشد" });
  res.json({ ok: true });
});

/** حذف همه کاربران جمع‌آوری‌شده */
router.post("/clear", (req, res) => {
  const count = clearSenders();
  addLog({ level: "warn", message: `همه کاربران جمع‌آوری‌شده حذف شدند (${count} مورد)` });
  res.json({ ok: true, count });
});

export default router;
