import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, subscribeEvents, formatNumber } from "../api.js";
import { Empty, Field, Modal, OrderStatus, Progress, Spinner, useToast } from "../components/ui.jsx";

const normalize = (raw) => {
  let s = String(raw || "").trim();
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/^(t\.me|telegram\.me)\//i, "");
  s = s.replace(/^@/, "");
  return s.toLowerCase();
};

const parseList = (text) => {
  const seen = new Set();
  const out = [];
  for (const part of String(text || "").split(/[\s,;،\r\n\t]+/)) {
    const u = normalize(part);
    if (!u || seen.has(u) || !/^[a-z0-9_]{5,32}$/.test(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
};

const DEFAULT_FORM = {
  name: "",
  target: "",
  usernamesText: "",
  batchSize: 1,
  maxPerAccount: 40,
  delayMinSec: 20,
  delayMaxSec: 60,
  autoJoin: true,
  maxAttempts: 3,
};

export default function Orders() {
  const toast = useToast();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () => api.orders.list().then(setOrders).catch((e) => toast(e.message, "error")).finally(() => setLoading(false));
    load();
    const off = subscribeEvents((p) => {
      if (p.type === "order") {
        setOrders((prev) => {
          const others = prev.filter((o) => o.id !== p.data.id);
          return [...others, p.data].sort((a, b) => b.id - a.id);
        });
      }
      if (p.type === "orderDeleted") setOrders((prev) => prev.filter((o) => o.id !== p.data.id));
    });
    return off;
  }, []);

  const usernames = useMemo(() => parseList(form.usernamesText), [form.usernamesText]);

  const create = async () => {
    if (!form.target.trim()) return toast("مقصد را وارد کنید", "error");
    if (!usernames.length) return toast("حداقل یک یوزرنیم معتبر وارد کنید", "error");
    setBusy(true);
    try {
      const order = await api.orders.create({
        name: form.name,
        target: form.target,
        usernames,
        settings: {
          batchSize: Number(form.batchSize),
          maxPerAccount: Number(form.maxPerAccount),
          delayMinSec: Number(form.delayMinSec),
          delayMaxSec: Number(form.delayMaxSec),
          autoJoin: form.autoJoin,
          maxAttempts: Number(form.maxAttempts),
        },
      });
      toast(`سفارش «${order.name}» ساخته شد`, "success");
      setShowCreate(false);
      setForm(DEFAULT_FORM);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn, message) => {
    try {
      await fn();
      if (message) toast(message, "success");
    } catch (err) {
      toast(err.message, "error");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">سفارش‌ها</h1>
          <p className="mt-1 text-sm text-slate-400">هر سفارش یک لیست یوزرنیم و یک گروه مقصد دارد.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + سفارش جدید
        </button>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-center text-sm text-slate-500">
            <Spinner /> در حال بارگذاری…
          </div>
        ) : orders.length === 0 ? (
          <Empty text="هنوز سفارشی ثبت نشده است" />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-panel-600">
                <th className="th">#</th>
                <th className="th">نام</th>
                <th className="th">مقصد</th>
                <th className="th">وضعیت</th>
                <th className="th w-52">پیشرفت</th>
                <th className="th">نتیجه</th>
                <th className="th">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const running = o.status === "running";
                const finished = ["completed", "stopped", "failed", "paused", "pending"].includes(o.status);
                return (
                  <tr key={o.id} className="border-b border-panel-700/60 last:border-0 hover:bg-panel-700/40">
                    <td className="td text-slate-500">{o.id}</td>
                    <td className="td">
                      <Link to={`/orders/${o.id}`} className="font-medium text-sky-300 hover:text-sky-200">
                        {o.name}
                      </Link>
                      {o.pauseReason ? <div className="max-w-[240px] truncate text-[11px] text-amber-400/80">{o.pauseReason}</div> : null}
                    </td>
                    <td className="td text-slate-400">{o.targetTitle || o.target}</td>
                    <td className="td">
                      <OrderStatus status={o.status} />
                    </td>
                    <td className="td">
                      <Progress value={o.stats.added} total={o.stats.total} tone="emerald" />
                    </td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1 text-[11px]">
                        <span className="text-emerald-400">✓ {formatNumber(o.stats.added)}</span>
                        <span className="text-sky-400">عضو: {formatNumber(o.stats.already)}</span>
                        <span className="text-amber-400">رد: {formatNumber(o.stats.skipped)}</span>
                        <span className="text-rose-400">✗ {formatNumber(o.stats.failed)}</span>
                      </div>
                    </td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1.5">
                        {!running ? (
                          <button className="btn-success px-2 py-1 text-xs" onClick={() => act(() => api.orders.start(o.id), "سفارش شروع شد")}>
                            {o.status === "pending" ? "شروع" : "ادامه"}
                          </button>
                        ) : (
                          <>
                            <button className="btn-warn px-2 py-1 text-xs" onClick={() => act(() => api.orders.pause(o.id), "سفارش موقتاً متوقف شد")}>
                              توقف موقت
                            </button>
                            <button className="btn-danger px-2 py-1 text-xs" onClick={() => act(() => api.orders.stop(o.id), "سفارش متوقف شد")}>
                              توقف
                            </button>
                          </>
                        )}
                        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => navigate(`/orders/${o.id}`)}>
                          جزئیات
                        </button>
                        <button
                          className="btn-ghost px-2 py-1 text-xs"
                          onClick={() => {
                            if (confirm(`سفارش «${o.name}» حذف شود؟`)) act(() => api.orders.remove(o.id), "سفارش حذف شد");
                          }}
                        >
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={showCreate}
        title="ثبت سفارش جدید"
        onClose={() => setShowCreate(false)}
        width="max-w-3xl"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowCreate(false)}>
              انصراف
            </button>
            <button className="btn-primary" onClick={create} disabled={busy}>
              {busy ? <Spinner /> : null} ثبت سفارش ({formatNumber(usernames.length)} کاربر)
            </button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام سفارش">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثلاً: کمپین آبان" />
          </Field>
          <Field label="یوزرنیم یا لینک گروه مقصد" hint="مثال: @mygroup یا https://t.me/mygroup یا لینک دعوت + ‎https://t.me/+AbCd">
            <input className="input" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="@mygroup" />
          </Field>

          <div className="sm:col-span-2">
            <Field label="لیست یوزرنیم‌ها" hint="هر یوزرنیم در یک خط یا جداشده با کاما/فاصله. یوزرنیم‌های تکراری و نامعتبر حذف می‌شوند.">
              <textarea
                className="input h-44 text-xs"
                value={form.usernamesText}
                onChange={(e) => setForm({ ...form, usernamesText: e.target.value })}
                placeholder={"username1\nusername2\nusername3"}
              />
            </Field>
            <p className="mt-1 text-[11px] text-slate-500">
              یوزرنیم معتبر شناسایی‌شده: <span className="text-emerald-400">{formatNumber(usernames.length)}</span>
            </p>
          </div>

          <div className="sm:col-span-2 mt-1 rounded-lg border border-panel-600 bg-panel-900/50 p-4">
            <div className="mb-3 text-xs font-semibold text-slate-300">تنظیمات ضد‌محدودیت</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="سقف تعداد در هر درخواست ادد" hint="چند یوزر در یک درخواست InviteToChannel ارسال شود (پیشنهادی: ۱ تا ۵).">
                <input
                  type="number"
                  min="1"
                  max="100"
                  className="input"
                  value={form.batchSize}
                  onChange={(e) => setForm({ ...form, batchSize: e.target.value })}
                />
              </Field>
              <Field label="سقف کلی ادد هر اکانت مبدا در این سفارش" hint="وقتی اکانت به این سقف رسید، خودکار به اکانت بعدی سوییچ می‌شود. (۰ = نامحدود)">
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={form.maxPerAccount}
                  onChange={(e) => setForm({ ...form, maxPerAccount: e.target.value })}
                />
              </Field>
              <Field label="حداقل فاصله بین اددها (ثانیه)">
                <input
                  type="number"
                  min="1"
                  className="input"
                  value={form.delayMinSec}
                  onChange={(e) => setForm({ ...form, delayMinSec: e.target.value })}
                />
              </Field>
              <Field label="حداکثر فاصله بین اددها (ثانیه)" hint="تاخیر تصادفی بین این بازه انتخاب می‌شود تا رفتار شبیه کاربر واقعی شود.">
                <input
                  type="number"
                  min="1"
                  className="input"
                  value={form.delayMaxSec}
                  onChange={(e) => setForm({ ...form, delayMaxSec: e.target.value })}
                />
              </Field>
              <Field label="حداکثر تلاش برای هر یوزر" hint="اگر خطا مربوط به خود کاربر باشد، تا این تعداد تلاش می‌شود.">
                <input
                  type="number"
                  min="1"
                  className="input"
                  value={form.maxAttempts}
                  onChange={(e) => setForm({ ...form, maxAttempts: e.target.value })}
                />
              </Field>
              <label className="flex items-center gap-2 pt-6 text-sm text-slate-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-sky-500"
                  checked={form.autoJoin}
                  onChange={(e) => setForm({ ...form, autoJoin: e.target.checked })}
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
