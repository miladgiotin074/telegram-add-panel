import express from "express";
import { startScan, listScans, pauseScan, resumeScan, stopScan } from "../telegram/scan.js";

const router = express.Router();

/** لیست عملیات‌های اسکن */
router.get("/", (req, res) => {
  res.json(listScans());
});

/** شروع اسکن سابقه‌ی یک گروه */
router.post("/", async (req, res) => {
  try {
    const { accountId, groupLink, limit } = req.body || {};
    const job = await startScan({ accountId, groupLink, limit });
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err.errorMessage || err.message });
  }
});

router.post("/:id/pause", (req, res) => {
  try {
    res.json(pauseScan(req.params.id));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post("/:id/resume", (req, res) => {
  try {
    res.json(resumeScan(req.params.id));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post("/:id/stop", (req, res) => {
  try {
    res.json(stopScan(req.params.id));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
