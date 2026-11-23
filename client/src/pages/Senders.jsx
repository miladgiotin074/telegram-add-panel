import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, subscribeEvents, formatDateTime, formatNumber } from "../api.js";
import { Badge, Empty, Field, Modal, Spinner, StatCard, useToast } from "../components/ui.jsx";

const PAGE_SIZE = 50;

const ORDER_EMPTY = {
  name: "",
  target: "",
  scope: "selected",
  batchSize: 1,
  maxPerAccount: 40,
  delayMinSec: 20,
  delayMaxSec: 60,
  autoJoin: true,
  maxAttempts: 3,
};

const SCAN_STATUS = {
  running: { tone: "sky", label: "در حال اجرا" },
  paused: { tone: "amber", label: "توقف موقت" },
  completed: { tone: "emerald", label: "تمام شد" },
  stopped: { tone: "slate", label: "متوقف" },
  error: { tone: "rose", label: "خطا" },
};

export default function Senders() {
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [accountId, setAccountId] = useState("");
  const [stats, setStats] = useState({ total: 0, today: 0, accounts: [], groups: [] });
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [scanForm, setScanForm] = useState({ accountId: "", groupLink: "", limit: "" });
  const [scanBusy, setScanBusy] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [showOrder, setShowOrder] = useState(false);
  const [orderForm, setOrderForm] = useState(ORDER_EMPTY);
  const [orderBusy, setOrderBusy] = useState(false);
  const [defaults, setDefaults] = useState(null);
  const filtersRef = useRef({ q: "", accountId: "" });

  const upsertJob = (job) =>
    setJobs((prev) => {
      const idx = prev.findIndex((j) => j.id === job.id);
      if (idx === -1) return [job, ...prev];
      const next = [...prev];
      next[idx] = job;
      return next;
    });

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.senders.list({ q, accountId, page, pageSize: PAGE_SIZE });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      setStats(await api.senders.stats());
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    filtersRef.current = { q, accountId };
  }, [q, accountId]);

  useEffect(() => {
    load();
  }, [page, accountId]);

  useEffect(() => {
    loadStats();
    api.accounts.list().then(setAccounts).catch(() => {});
    api.scan.list().then(setJobs).catch(() => {});
    api.settings.get().then((s) => setDefaults(s.defaultSettings || null)).catch(() => {});
    const off = subscribeEvents((p) => {
      if (p.type === "scan") {
        upsertJob(p.data);
      }
      if (p.type === "sender") {
        setStats((s) => ({ ...s, total: s.total + 1, today: s.today + 1 }));
        // فقط اگر روی صفحه اول و بدون جستجو باشیم، آیتم جدید را بالای لیست اضافه کن
        if (page === 1 && !filtersRef.current.q && !filtersRef.current.accountId) {
          setItems((prev) => [p.data, ...prev].slice(0, PAGE_SIZE));
          setTotal((t) => t + 1);
        }
      }
      if (p.type === "senderDeleted") {
        setItems((prev) => prev.filter((s) => s.id !== p.data.id));
        setTotal((t) => Math.max(0, t - 1));
        loadStats();
      }
      if (p.type === "sendersCleared") {
        setItems([]);
        setTotal(0);
        loadStats();
      }
    });
    return off;
  }, [page]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const search = (e) => {
    e.preventDefault();
    setPage(1);
    load();
  };

  const clearAll = async () => {
    if (!confirm("همه کاربران جمع‌آوری‌شده حذف شوند؟ این کار قابل بازگشت نیست.")) return;
    try {
      const res = await api.senders.clear();
      toast(`${res.count} کاربر حذف شد`, "success");
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const remove = async (id) => {
    try {
      await api.senders.remove(id);
      setSelected((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      toast(err.message, "error");
    }
  };

  /* ------------------------- ثبت سفارش از کاربران ------------------------- */

  const toggleSelect = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pageIds = useMemo(() => items.map((s) => s.id), [items]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const toggleSelectPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  const openOrder = () => {
    setOrderForm({
      ...ORDER_EMPTY,
      ...(defaults || {}),
      scope: selected.size > 0 ? "selected" : "filtered",
    });
    setShowOrder(true);
  };

  const createOrder = async () => {
    if (!orderForm.target.trim()) return toast("گروه مقصد را وارد کنید", "error");
    const useSelected = orderForm.scope === "selected";
    if (useSelected && selected.size === 0) return toast("کاربری انتخاب نشده است", "error");
    if (!useSelected && total === 0) return toast("کاربری مطابق فیلتر فعلی وجود ندارد", "error");

    setOrderBusy(true);
    try {
      const body = {
        name: orderForm.name,
        target: orderForm.target.trim(),
        settings: {
          batchSize: Number(orderForm.batchSize),
          maxPerAccount: Number(orderForm.maxPerAccount),
          delayMinSec: Number(orderForm.delayMinSec),
          delayMaxSec: Number(orderForm.delayMaxSec),
          autoJoin: orderForm.autoJoin,
          maxAttempts: Number(orderForm.maxAttempts),
        },
      };
      if (useSelected) body.senderIds = [...selected];
      else body.senderFilter = { q, accountId };

      const order = await api.orders.create(body);
      toast(`سفارش «${order.name}» ساخته شد`, "success");
      setShowOrder(false);
      setSelected(new Set());
      navigate(`/orders/${order.id}`);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setOrderBusy(false);
    }
  };

  /* ---------------------------- جمع‌آوری از گروه ---------------------------- */

  const startScan = async () => {
    if (!scanForm.accountId) return toast("اکانت را انتخاب کنید", "error");
    if (!scanForm.groupLink.trim()) return toast("لینک گروه را وارد کنید", "error");
    setScanBusy(true);
    try {
      const job = await api.scan.start({
        accountId: Number(scanForm.accountId),
        groupLink: scanForm.groupLink.trim(),
        limit: Number(scanForm.limit) || 0,
      });
      upsertJob(job);
      setScanForm((f) => ({ ...f, groupLink: "" }));
      toast("اسکن شروع شد", "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setScanBusy(false);
    }
  };

  const scanAction = async (fn) => {
    try {
      upsertJob(await fn());
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const nameOf = (s) => [s.firstName, s.lastName].filter(Boolean).join(" ") || s.username || s.telegramId;

  const groupCount = useMemo(() => stats.groups?.length || 0, [stats]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">کاربران جمع‌آوری‌شده</h1>
          <p className="mt-1 text-sm text-slate-400">
            فرستنده‌های یکتای گروه‌های شنودشده؛ برای هر کاربر یک لینک پیام از گروه مبدأ ذخیره شده است.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={openOrder} disabled={total === 0}>
            ثبت سفارش ادد{selected.size ? ` (${formatNumber(selected.size)})` : ""}
          </button>
          <button className="btn-danger" onClick={clearAll} disabled={total === 0}>
            حذف همه
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="کل کاربران یکتا" value={formatNumber(stats.total)} tone="emerald" />
        <StatCard label="جمع‌آوری امروز" value={formatNumber(stats.today)} tone="sky" />
        <StatCard label="گروه‌های مبدأ" value={formatNumber(groupCount)} tone="violet" />
      </div>

      {/* جمع‌آوری از سابقه گروه */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-slate-200">جمع‌آوری از سابقه‌ی گروه</h2>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">
          لینک یک گروه را بدهید تا پیام‌های آن از آخر به اول (بالا) مرور شوند. برای هر کاربر یکتای
          غیرربات/غیرادمین یک لینک پیام ذخیره می‌شود — دقیقاً مثل حالت شنود، فقط به‌جای انتظار برای پیام جدید.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="اکانت">
              <select
                className="input"
                value={scanForm.accountId}
                onChange={(e) => setScanForm({ ...scanForm, accountId: e.target.value })}
              >
                <option value="">انتخاب اکانت…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="min-w-[220px] flex-1">
            <Field label="لینک گروه">
              <input
                className="input"
                dir="ltr"
                value={scanForm.groupLink}
                onChange={(e) => setScanForm({ ...scanForm, groupLink: e.target.value })}
                placeholder="https://t.me/… یا @group یا لینک دعوت"
              />
            </Field>
          </div>
          <div className="w-40">
            <Field label="حداکثر پیام (اختیاری)">
              <input
                type="number"
                min="0"
                className="input"
                value={scanForm.limit}
                onChange={(e) => setScanForm({ ...scanForm, limit: e.target.value })}
                placeholder="همه"
              />
            </Field>
          </div>
          <button className="btn-primary" onClick={startScan} disabled={scanBusy}>
            {scanBusy ? <Spinner /> : null} شروع اسکن
          </button>
        </div>

        {jobs.length ? (
          <div className="mt-4 space-y-2">
            {jobs.map((job) => {
              const st = SCAN_STATUS[job.status] || { tone: "slate", label: job.status };
              const pct = job.limit ? Math.min(100, Math.round((job.scanned / job.limit) * 100)) : null;
              const active = job.status === "running" || job.status === "paused";
              return (
                <div key={job.id} className="rounded-lg border border-panel-600 bg-panel-700/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      <span className="text-sm text-slate-200">{job.groupTitle || job.groupLink}</span>
                      <span className="text-[11px] text-slate-500">اکانت: {job.accountName}</span>
                    </div>
                    {active ? (
                      <div className="flex gap-2">
                        {job.status === "running" ? (
                          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => scanAction(() => api.scan.pause(job.id))}>
                            توقف موقت
                          </button>
                        ) : (
                          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => scanAction(() => api.scan.resume(job.id))}>
                            ادامه
                          </button>
                        )}
                        <button className="btn-danger px-2 py-1 text-xs" onClick={() => scanAction(() => api.scan.stop(job.id))}>
                          پایان
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-2 text-[11px] text-slate-400">
                    بررسی‌شده: {formatNumber(job.scanned)} • ذخیره‌شده: {formatNumber(job.collected)}
                    {job.limit ? ` • سقف: ${formatNumber(job.limit)}` : ""}
                    {job.error ? ` • خطا: ${job.error}` : ""}
                  </div>
                  {pct != null ? (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-panel-600">
                      <div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="card p-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={search}>
          <div className="min-w-[220px] flex-1">
            <Field label="جستجو">
              <input
                className="input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="یوزرنیم، نام، آیدی یا نام گروه…"
              />
            </Field>
          </div>
          <div className="w-56">
            <Field label="فیلتر اکانت">
              <select className="input" value={accountId} onChange={(e) => { setAccountId(e.target.value); setPage(1); }}>
                <option value="">همه اکانت‌ها</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <button className="btn-primary" type="submit">
            اعمال
          </button>
        </form>
      </div>

      <div className="card overflow-x-auto">
        {!loading && items.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-panel-600 px-4 py-3 text-xs text-slate-400">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-sky-500" checked={allPageSelected} onChange={toggleSelectPage} />
              انتخاب همه‌ی این صفحه
            </label>
            {selected.size > 0 ? (
              <>
                <span className="text-slate-300">{formatNumber(selected.size)} کاربر انتخاب شده</span>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setSelected(new Set())}>
                  پاک‌کردن انتخاب
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {loading ? (
          <div className="p-6 text-center text-sm text-slate-500">
            <Spinner /> در حال بارگذاری…
          </div>
        ) : items.length === 0 ? (
          <Empty text="هنوز کاربری جمع‌آوری نشده است. یک اکانت را در حالت شنود قرار دهید یا سابقه‌ی یک گروه را اسکن کنید." />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-panel-600">
                <th className="th w-8"></th>
                <th className="th">#</th>
                <th className="th">کاربر</th>
                <th className="th">گروه مبدأ</th>
                <th className="th">لینک پیام</th>
                <th className="th">اکانت شنود</th>
                <th className="th">زمان</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b border-panel-700/60 last:border-0 hover:bg-panel-700/40">
                  <td className="td">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-sky-500"
                      checked={selected.has(s.id)}
                      onChange={() => toggleSelect(s.id)}
                    />
                  </td>
                  <td className="td text-slate-500">{s.id}</td>
                  <td className="td">
                    <div className="font-medium text-slate-200">{nameOf(s)}</div>
                    <div className="text-[11px] text-slate-500">
                      {s.username ? `@${s.username} · ` : ""}ID: {s.telegramId}
                    </div>
                  </td>
                  <td className="td">
                    <div className="max-w-[180px] truncate text-slate-300" title={s.sourceGroupTitle || ""}>
                      {s.sourceGroupTitle || "—"}
                    </div>
                  </td>
                  <td className="td">
                    {s.messageLink ? (
                      <a
                        className="text-sky-300 hover:text-sky-200 hover:underline"
                        href={s.messageLink}
                        target="_blank"
                        rel="noreferrer"
                        dir="ltr"
                      >
                        {s.messageLink}
                      </a>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="td text-slate-400">{s.accountId ?? "—"}</td>
                  <td className="td whitespace-nowrap text-slate-400">{formatDateTime(s.collectedAt)}</td>
                  <td className="td">
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => remove(s.id)}>
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            صفحه {page} از {pages} — {formatNumber(total)} کاربر
          </span>
          <div className="flex gap-2">
            <button className="btn-ghost px-3 py-1" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              قبلی
            </button>
            <button className="btn-ghost px-3 py-1" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              بعدی
            </button>
          </div>
        </div>
      ) : null}

      {stats.accounts?.length ? (
        <div className="card p-4">
          <div className="mb-3 text-sm font-semibold text-slate-200">جمع‌آوری به تفکیک اکانت</div>
          <div className="flex flex-wrap gap-2">
            {stats.accounts.map((a) => (
              <Badge key={a.id} tone={a.collected ? "sky" : "slate"}>
                {a.name}: {formatNumber(a.collected)}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <Modal
        open={showOrder}
        title="ثبت سفارش افزودن به گروه مقصد"
        onClose={() => setShowOrder(false)}
        width="max-w-3xl"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowOrder(false)}>
              انصراف
            </button>
            <button className="btn-primary" onClick={createOrder} disabled={orderBusy}>
              {orderBusy ? <Spinner /> : null} ثبت سفارش
            </button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام سفارش">
            <input
              className="input"
              value={orderForm.name}
              onChange={(e) => setOrderForm({ ...orderForm, name: e.target.value })}
              placeholder="مثلاً: کمپین آبان"
            />
          </Field>
          <Field label="گروه مقصد" hint="یوزرنیم، لینک گروه یا لینک دعوت">
            <input
              className="input"
              dir="ltr"
              value={orderForm.target}
              onChange={(e) => setOrderForm({ ...orderForm, target: e.target.value })}
              placeholder="@mygroup"
            />
          </Field>

          <div className="sm:col-span-2">
            <div className="mb-2 text-xs font-semibold text-slate-300">دامنه‌ی کاربران</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${
                  orderForm.scope === "selected" ? "border-sky-500 bg-sky-500/10 text-slate-100" : "border-panel-600 text-slate-300"
                } ${selected.size === 0 ? "opacity-50" : ""}`}
              >
                <input
                  type="radio"
                  name="order-scope"
                  className="h-4 w-4 accent-sky-500"
                  checked={orderForm.scope === "selected"}
                  disabled={selected.size === 0}
                  onChange={() => setOrderForm({ ...orderForm, scope: "selected" })}
                />
                کاربران انتخاب‌شده ({formatNumber(selected.size)})
              </label>
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${
                  orderForm.scope === "filtered" ? "border-sky-500 bg-sky-500/10 text-slate-100" : "border-panel-600 text-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="order-scope"
                  className="h-4 w-4 accent-sky-500"
                  checked={orderForm.scope === "filtered"}
                  onChange={() => setOrderForm({ ...orderForm, scope: "filtered" })}
                />
                همه‌ی کاربران مطابق فیلتر فعلی ({formatNumber(total)})
              </label>
            </div>
          </div>

          <div className="sm:col-span-2 rounded-lg border border-panel-600 bg-panel-900/50 p-4">
            <div className="mb-3 text-xs font-semibold text-slate-300">تنظیمات ضد‌محدودیت</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="سقف تعداد در هر درخواست ادد" hint="پیشنهادی: ۱ تا ۵">
                <input
                  type="number"
                  min="1"
                  className="input"
                  value={orderForm.batchSize}
                  onChange={(e) => setOrderForm({ ...orderForm, batchSize: e.target.value })}
                />
              </Field>
              <Field label="سقف کلی ادد هر اکانت مبدا" hint="۰ = نامحدود">
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={orderForm.maxPerAccount}
                  onChange={(e) => setOrderForm({ ...orderForm, maxPerAccount: e.target.value })}
                />
              </Field>
              <Field label="حداقل فاصله بین اددها (ثانیه)">
                <input
                  type="number"
                  min="1"
                  className="input"
                  value={orderForm.delayMinSec}
                  onChange={(e) => setOrderForm({ ...orderForm, delayMinSec: e.target.value })}
                />
              </Field>
              <Field label="حداکثر فاصله بین اددها (ثانیه)">
                <input
                  type="number"
                  min="1"
                  className="input"
                  value={orderForm.delayMaxSec}
                  onChange={(e) => setOrderForm({ ...orderForm, delayMaxSec: e.target.value })}
                />
              </Field>
              <Field label="حداکثر تلاش برای هر کاربر">
                <input
                  type="number"
                  min="1"
                  className="input"
                  value={orderForm.maxAttempts}
                  onChange={(e) => setOrderForm({ ...orderForm, maxAttempts: e.target.value })}
                />
              </Field>
              <label className="flex items-center gap-2 pt-6 text-sm text-slate-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-sky-500"
                  checked={orderForm.autoJoin}
                  onChange={(e) => setOrderForm({ ...orderForm, autoJoin: e.target.checked })}
                />
                عضویت خودکار در گروه مقصد قبل از ادد (و خروج پس از پایان سهم هر اکانت)
              </label>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
