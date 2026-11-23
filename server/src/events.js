import { EventEmitter } from "node:events";

/** گذرگاه رویداد برای ارسال زنده وضعیت به UI (SSE) */
export const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emit(type, data) {
  bus.emit("event", { type, data });
}
