import express from "express";
import { startOwnedGroups, getOwnedGroups, stopOwnedGroups } from "../telegram/ownedGroups.js";

const router = express.Router();

/** آخرین نتیجه‌ی جمع‌آوری گروه‌های ساخته‌شده (owner) */
router.get("/", (req, res) => {
  res.json(getOwnedGroups());
});

/** شروع جمع‌آوری؛ body: { accountId? } — نبود accountId یعنی همه‌ی اکانت‌ها */
router.post("/scan", (req, res) => {
  try {
    const { accountId } = req.body || {};
    res.json(startOwnedGroups({ accountId }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/stop", (req, res) => {
  res.json(stopOwnedGroups());
});

export default router;
