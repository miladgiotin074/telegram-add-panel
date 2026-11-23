import express from "express";
import { getDb } from "../db.js";
import { isOrderRunning } from "../engine/engine.js";

const router = express.Router();

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

router.get("/", (req, res) => {
  const db = getDb();
  const today = startOfToday();

  const accounts = {
    total: db.accounts.length,
    active: 0,
    limited: 0,
    error: 0,
    frozen: 0,
    disabled: 0,
  };
  for (const a of db.accounts) {
    if (accounts[a.status] != null) accounts[a.status] += 1;
  }

  const orders = {
    total: db.orders.length,
    running: db.orders.filter((o) => isOrderRunning(o.id)).length,
    pending: 0,
    paused: 0,
    stopped: 0,
    completed: 0,
    failed: 0,
  };
  for (const o of db.orders) {
    const key = o.status === "running" ? "running" : o.status;
    if (orders[key] != null && key !== "running") orders[key] += 1;
  }

  const targets = { total: db.targets.length, pending: 0, added: 0, already: 0, skipped: 0, failed: 0 };
  let addedToday = 0;
  for (const t of db.targets) {
    if (targets[t.status] != null) targets[t.status] += 1;
    if (t.status === "added" && (t.doneAt || 0) >= today) addedToday += 1;
  }

  res.json({ accounts, orders, targets, addedToday, totalAdded: targets.added });
});

export default router;
