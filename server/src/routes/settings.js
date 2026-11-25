import express from "express";
import { getDb, save, addLog } from "../db.js";
import { DEFAULT_ORDER_SETTINGS } from "../config.js";

const router = express.Router();

function view(db) {
  const s = db.settings;
  return {
    apiId: s.apiId || "",
    hasApiHash: Boolean(s.apiHash),
    apiHashMasked: s.apiHash ? `${s.apiHash.slice(0, 4)}••••••••${s.apiHash.slice(-4)}` : "",
    peerFloodCooldownMinutes: s.peerFloodCooldownMinutes,
    maxLogs: s.maxLogs,
    shortFloodWaitSeconds: s.shortFloodWaitSeconds,
    recentActivityHours: s.recentActivityHours,
    collectOnlyUsername: s.collectOnlyUsername === true,
    defaultSettings: { ...DEFAULT_ORDER_SETTINGS, ...(s.defaultSettings || {}) },
  };
}

router.get("/", (req, res) => {
  res.json(view(getDb()));
});

router.patch("/", (req, res) => {
  const db = getDb();
  const body = req.body || {};

  if (body.apiId != null) db.settings.apiId = String(body.apiId).trim();
  if (body.apiHash != null && String(body.apiHash).trim()) db.settings.apiHash = String(body.apiHash).trim();
  if (body.clearApiHash) db.settings.apiHash = "";
  if (body.peerFloodCooldownMinutes != null) {
    db.settings.peerFloodCooldownMinutes = Math.max(1, Number(body.peerFloodCooldownMinutes) || 720);
  }
  if (body.maxLogs != null) db.settings.maxLogs = Math.max(100, Number(body.maxLogs) || 3000);
  if (body.shortFloodWaitSeconds != null) {
    db.settings.shortFloodWaitSeconds = Math.max(0, Number(body.shortFloodWaitSeconds) || 60);
  }
  if (body.recentActivityHours != null) {
    db.settings.recentActivityHours = Math.max(0, Number(body.recentActivityHours) || 0);
  }
  if (body.collectOnlyUsername != null) {
    db.settings.collectOnlyUsername = body.collectOnlyUsername === true || body.collectOnlyUsername === "true";
  }
  if (body.defaultSettings != null) {
    db.settings.defaultSettings = { ...db.settings.defaultSettings, ...body.defaultSettings };
  }

  save();
  addLog({ level: "info", message: "تنظیمات کلی ذخیره شد" });
  res.json(view(db));
});

export default router;
