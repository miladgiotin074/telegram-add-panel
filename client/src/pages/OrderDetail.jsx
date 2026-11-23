import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, subscribeEvents, formatDateTime, formatDuration, formatNumber } from "../api.js";
import {
  AccountStatus,
  Badge,
  Countdown,
  Empty,
  Field,
  Modal,
  OrderStatus,
  Progress,
  Spinner,
  TargetStatus,
  cx,
  useToast,
} from "../components/ui.jsx";

const FILTERS = [
  { key: "all", label: "همه" },
  { key: "pending", label: "در انتظار" },
  { key: "added", label: "ادد شد" },
  { key: "already", label: "از قبل عضو" },
  { key: "skipped", label: "رد شد" },
  { key: "failed", label: "ناموفق" },
];

const PAGE_SIZE = 50;

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const logRef = useRef(null);

  const [order, setOrder] = useState(null);
  const [targets, setTargets] = useState({ items: [], total: 0, page: 1 });
  const [logs, setLogs] = useState([]);
  const [acctStats, setAcctStats] = useState([]);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const reloadOrder = () => api.orders.get(id).then(setOrder).catch((e) => toast(e.message, "error"));
  const reloadTargets = () =>
    api.orders.targets(id, { status: filter, q, page, pageSize: PAGE_SIZE }).then(setTargets).catch(() => {});
  const reloadLogs = () => api.orders.logs(id, 400).then(setLogs).catch(() => {});
  const reloadAccounts = () => api.orders.accounts(id).then(setAcctStats).catch(() => {});

  useEffect(() => {
    reloadOrder();
    reloadLogs();
    reloadAccounts();
  }, [id]);

  useEffect(() => {
    reloadTargets();
  }, [id, filter, q, page]);

  useEffect(() => {
    if (order?.settings && !settingsForm) setSettingsForm({ ...order.settings });
  }, [order]);

  useEffect(() => {
    let timer = null;
    const scheduleOrder = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        reloadOrder();
        reloadAccounts();
      }, 500);
    };

    const off = subscribeEvents((p) => {
      if (p.type === "order" && Number(p.data.id) === Number(id)) {
        setOrder(p.data);
        scheduleOrder();
      }
      if (p.type === "targets") {
        const rows = (p.data || []).filter((r) => Number(r.orderId) === Number(id));
        if (!rows.length) return;
        setTargets((prev) => {
          const map = new Map(prev.items.map((t) => [t.id, t]));
          let changed = false;
          for (const row of rows) {
            if (map.has(row.id)) {
              map.set(row.id, { ...map.get(row.id), ...row });
              changed = true;
            }
          }
          if (!changed) return prev;
          return { ...prev, items: prev.items.map((t) => map.get(t.id)) };
        });
        scheduleOrder();
      }
      if (p.type === "log" && Number(p.data.orderId) === Number(id)) {
        setLogs((prev) => [...prev, p.data].slice(-500));
      }
      if (p.type === "account") {
        setAcctStats((prev) => prev.map((a) => (a.id === p.data.id ? { ...a, ...p.data, addedForOrder: a.addedForOrder } : a)));
      }
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [id]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const usernamesWatch = useMemo(() => logs.slice(-1)[0]?.id, [logs]);

  if (!order) {
    return (
      <div className="p-6 text-sm text-slate-500">
        <Spinner /> در حال بارگذاری…
      </div>
    );
  }

  const running = order.status === "running";
  const settings = order.settings || {};

  const act = async (fn, message) => {
    try {
      await fn();
      if (message) toast(message, "success");
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const saveSettings = async () => {
    setBusy(true);
    try {
      const payload = await api.orders.update(id, {
        name: settingsForm.name,
        target: settingsForm.target,
        settings: {
          batchSize: Number(settingsForm.batchSize),
          maxPerAccount: Number(settingsForm.maxPerAccount),
          delayMinSec: Number(settingsForm.delayMinSec),
          delayMaxSec: Number(settingsForm.delayMaxSec),
          autoJoin: settingsForm.autoJoin,
          maxAttempts: Number(settingsForm.maxAttempts),
        },
      });
      setOrder(payload);
      setSettingsForm({ ...payload.settings, name: payload.name, target: payload.target });
      setShowSettings(false);
      toast("تنظیمات ذخیره شد", "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(targets.total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link to="/orders" className="hover:text-sky-400">
          سفارش‌ها
        </Link>
        <span>/</span>
        <span className="text-slate-300">{order.name}</span>
      </div>

      {/* هدر */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-bold text-slate-100">{order.name}</h1>
              <OrderStatus status={order.status} />
              {running && order.runtime?.phase ? (
                <Badge tone="sky">
                  <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                  {order.runtime.phase}
                  {order.runtime.accountName ? ` — ${order.runtime.accountName}` : ""}
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 text-sm text-slate-400">
              مقصد: {order.targetTitle || order.target}{" "}
              {order.targetType ? (
                <span className="text-slate-600">({order.targetType === "channel" ? "سوپرگروه/کانال" : "گروه ساده"})</span>
              ) : null}
            </div>
            {order.pauseReason ? <div className="mt-1 text-xs text-amber-400">{order.pauseReason}</div> : null}
            {order.fatalError ? <div className="mt-1 text-xs text-rose-400">{order.fatalError}</div> : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {!running ? (
              <button className="btn-success" onClick={() => act(() => api.orders.start(id), "سفارش شروع شد")}>
                {order.status === "pending" ? "▶ شروع" : "▶ ادامه"}
              </button>
            ) : (
              <>
                <button className="btn-warn" onClick={() => act(() => api.orders.pause(id), "موقتاً متوقف شد")}>
                  ⏸ توقف موقت
                </button>
                <button className="btn-danger" onClick={() => act(() => api.orders.stop(id), "متوقف شد")}>
                  ⏹ توقف
                </button>
              </>
            )}
            <button className="btn-ghost" onClick={() => setShowSettings(true)}>
              ⚙️ تنظیمات
            </button>
            <button
              className="btn-ghost"
              onClick={() => act(() => api.orders.retryFailed(id).then(reloadTargets), "یوزرهای ناموفق به صف برگشتند")}
            >
              ♻️ تلاش مجدد ناموفق‌ها
            </button>
            <button
              className="btn-danger"
              onClick={() => {
                if (confirm(`سفارش «${order.name}» حذف شود؟`)) act(async () => {
                  await api.orders.remove(id);
                  navigate("/orders");
                }, "سفارش حذف شد");
              }}
            >
              🗑 حذف
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="mb-2 text-xs text-slate-400">پیشرفت</div>
            <Progress value={order.stats.added} total={order.stats.total} tone="emerald" />
          </div>
          <div className="flex flex-wrap items-start gap-1.5 content-start">
            <Badge tone="slate">در انتظار: {formatNumber(order.stats.pending)}</Badge>
            <Badge tone="emerald">ادد شد: {formatNumber(order.stats.added)}</Badge>
            <Badge tone="sky">از قبل عضو: {formatNumber(order.stats.already)}</Badge>
            <Badge tone="amber">رد شد: {formatNumber(order.stats.skipped)}</Badge>
            <Badge tone="rose">ناموفق: {formatNumber(order.stats.failed)}</Badge>
          </div>
          <div className="text-xs text-slate-400">
            <div>شروع: {formatDateTime(order.startedAt)}</div>
            <div>پایان: {formatDateTime(order.finishedAt)}</div>
          </div>
          <div className="text-xs text-slate-400">
            <div>
              سقف هر اکانت: <span className="text-slate-200">{settings.maxPerAccount > 0 ? formatNumber(settings.maxPerAccount) : "∞"}</span>
            </div>
            <div>
              هر درخواست: <span className="text-slate-200">{settings.batchSize}</span> یوزر
            </div>
            <div>
              فاصله: <span className="text-slate-200">{settings.delayMinSec}–{settings.delayMaxSec}</span> ثانیه
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {/* اکانت‌ها */}
        <div className="card overflow-hidden">
          <div className="border-b border-panel-600 px-4 py-3 text-sm font-semibold text-slate-200">
            وضعیت اکانت‌های مبدا (چرخش خودکار)
          </div>
          {acctStats.length === 0 ? (
            <Empty text="اکانتی وجود ندارد" />
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-panel-800">
                  <tr className="border-b border-panel-600">
                    <th className="th">اکانت</th>
                    <th className="th">وضعیت</th>
                    <th className="th">ادد در این سفارش</th>
                    <th className="th">کل ادد</th>
                    <th className="th">محدودیت</th>
                  </tr>
                </thead>
                <tbody>
                  {acctStats.map((a) => (
                    <tr key={a.id} className={cx("border-b border-panel-700/60 last:border-0", a.excluded && "opacity-60")}>
                      <td className="td">
                        <div className="font-medium">{a.name}</div>
                        <div className="text-[11px] text-slate-500">{a.username ? `@${a.username}` : "—"}</div>
                      </td>
                      <td className="td">
                        <AccountStatus status={a.status} />
                      </td>
                      <td className="td">
                        <span className="text-slate-200">{formatNumber(a.addedForOrder)}</span>
                        <span className="text-slate-500"> / {a.maxPerAccount > 0 ? formatNumber(a.maxPerAccount) : "∞"}</span>
                      </td>
                      <td className="td">
                        {formatNumber(a.addedTotal)}
                        <span className="text-slate-500"> / {a.maxTotalAdds > 0 ? formatNumber(a.maxTotalAdds) : "∞"}</span>
                      </td>
                      <td className="td">
                        {a.floodUntil > Date.now() ? (
                          <Countdown until={a.floodUntil} className="text-amber-300" />
                        ) : a.excluded ? (
                          <span className="text-[11px] text-slate-500">کنار گذاشته شده</span>
                        ) : (
                          <span className="text-emerald-400 text-[11px]">آماده</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* لاگ */}
        <div className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-panel-600 px-4 py-3">
            <span className="text-sm font-semibold text-slate-200">لاگ زنده</span>
            <button className="text-[11px] text-slate-400 hover:text-sky-400" onClick={reloadLogs}>
              بازخوانی
            </button>
          </div>
          <div ref={logRef} className="h-80 overflow-y-auto bg-panel-900/60 p-3 font-mono text-[11px] leading-5">
            {logs.length === 0 ? (
              <div className="text-slate-600">لاگی ثبت نشده است…</div>
            ) : (
              logs.map((l) => (
                <div
                  key={l.id}
                  className={cx(
                    "flex gap-2 border-b border-panel-700/40 py-1 last:border-0",
                    l.level === "success" && "text-emerald-300",
                    l.level === "warn" && "text-amber-300",
                    l.level === "error" && "text-rose-300",
                    l.level === "info" && "text-slate-300",
                  )}
                >
                  <span className="shrink-0 text-slate-600">{new Date(l.createdAt).toLocaleTimeString("fa-IR")}</span>
                  {l.accountName ? <span className="shrink-0 text-violet-400">[{l.accountName}]</span> : null}
                  <span className="break-all">{l.message}</span>
                </div>
              ))
            )}
            <span data-watch={usernamesWatch} />
          </div>
        </div>
      </div>

      {/* لیست یوزرنیم‌ها */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-panel-600 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  setFilter(f.key);
                  setPage(1);
                }}
                className={cx(
                  "rounded-lg px-2.5 py-1 text-xs transition",
                  filter === f.key ? "bg-sky-600 text-white" : "bg-panel-700 text-slate-300 hover:bg-panel-600",
                )}
              >
                {f.label}
                {f.key !== "all" ? ` (${formatNumber(order.stats[f.key] || 0)})` : ""}
              </button>
            ))}
          </div>
          <input
            className="input w-56"
            placeholder="جستجوی یوزرنیم…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>

        {targets.items.length === 0 ? (
          <Empty text="موردی مطابق فیلتر یافت نشد" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-panel-600">
                  <th className="th">#</th>
                  <th className="th">کاربر</th>
                  <th className="th">وضعیت</th>
                  <th className="th">دلیل / پیام</th>
                  <th className="th">اکانت</th>
                  <th className="th">تلاش</th>
                  <th className="th">زمان</th>
                </tr>
              </thead>
              <tbody>
                {targets.items.map((t) => (
                  <tr key={t.id} className="border-b border-panel-700/60 last:border-0 hover:bg-panel-700/40">
                    <td className="td text-slate-500">{t.id}</td>
                    <td className="td font-mono">{t.username ? `@${t.username}` : t.label || `ID:${t.telegramId}`}</td>
                    <td className="td">
                      <TargetStatus status={t.status} />
                    </td>
                    <td className="td max-w-[280px] truncate text-slate-400" title={t.reason || ""}>
                      {t.reason || "—"}
                    </td>
                    <td className="td text-slate-400">
                      {t.accountId ? acctStats.find((a) => a.id === t.accountId)?.name || `#${t.accountId}` : "—"}
                    </td>
                    <td className="td text-slate-500">{t.attempts || 0}</td>
                    <td className="td text-[11px] text-slate-500">{t.doneAt ? formatDateTime(t.doneAt) : formatDateTime(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-panel-600 px-4 py-3 text-xs text-slate-400">
          <span>
            مجموع {formatNumber(targets.total)} — صفحه {page} از {totalPages}
          </span>
          <div className="flex gap-2">
            <button className="btn-ghost px-3 py-1 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              قبلی
            </button>
            <button
              className="btn-ghost px-3 py-1 text-xs"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              بعدی
            </button>
          </div>
        </div>
      </div>

      {/* تنظیمات سفارش */}
      <Modal
        open={showSettings && !!settingsForm}
        title="تنظیمات سفارش"
        onClose={() => setShowSettings(false)}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowSettings(false)}>
              انصراف
            </button>
            <button className="btn-primary" onClick={saveSettings} disabled={busy}>
              {busy ? <Spinner /> : null} ذخیره
            </button>
          </>
        }
      >
        {settingsForm ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نام سفارش">
              <input className="input" value={settingsForm.name} onChange={(e) => setSettingsForm({ ...settingsForm, name: e.target.value })} />
            </Field>
            <Field label="مقصد" hint="با تغییر مقصد، شناسایی مجدد انجام می‌شود.">
              <input className="input" value={settingsForm.target} onChange={(e) => setSettingsForm({ ...settingsForm, target: e.target.value })} />
            </Field>
            <Field label="سقف در هر درخواست">
              <input
                type="number"
                min="1"
                className="input"
                value={settingsForm.batchSize}
                onChange={(e) => setSettingsForm({ ...settingsForm, batchSize: e.target.value })}
              />
            </Field>
            <Field label="سقف کلی هر اکانت (۰=نامحدود)">
              <input
                type="number"
                min="0"
                className="input"
                value={settingsForm.maxPerAccount}
                onChange={(e) => setSettingsForm({ ...settingsForm, maxPerAccount: e.target.value })}
              />
            </Field>
            <Field label="حداقل فاصله (ثانیه)">
              <input
                type="number"
                min="1"
                className="input"
                value={settingsForm.delayMinSec}
                onChange={(e) => setSettingsForm({ ...settingsForm, delayMinSec: e.target.value })}
              />
            </Field>
            <Field label="حداکثر فاصله (ثانیه)">
              <input
                type="number"
                min="1"
                className="input"
                value={settingsForm.delayMaxSec}
                onChange={(e) => setSettingsForm({ ...settingsForm, delayMaxSec: e.target.value })}
              />
            </Field>
            <Field label="حداکثر تلاش هر یوزر">
              <input
                type="number"
                min="1"
                className="input"
                value={settingsForm.maxAttempts}
                onChange={(e) => setSettingsForm({ ...settingsForm, maxAttempts: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 pt-6 text-sm text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 accent-sky-500"
                checked={settingsForm.autoJoin}
                onChange={(e) => setSettingsForm({ ...settingsForm, autoJoin: e.target.checked })}
              />
              عضویت خودکار در گروه مقصد قبل از ادد (و خروج پس از پایان سهم)
            </label>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
