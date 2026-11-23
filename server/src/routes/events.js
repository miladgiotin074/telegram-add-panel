import express from "express";
import { bus } from "../events.js";

const router = express.Router();

/** کانال رویداد زنده (Server-Sent Events) */
router.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({ type: "hello", data: { at: Date.now() } });

  const onEvent = (payload) => send(payload);
  bus.on("event", onEvent);

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    bus.off("event", onEvent);
    res.end();
  });
});

export default router;
