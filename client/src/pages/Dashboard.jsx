import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, subscribeEvents, formatNumber } from "../api.js";
import { AccountStatus, Badge, Empty, OrderStatus, Progress, StatCard } from "../components/ui.jsx";

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    let timer = null;
    const load = async () => {
      try {
        const [s, o] = await Promise.all([api.stats(), api.orders.list()]);
        setStats(s);
        setOrders(o);
      } catch {
        /* ignore */
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 600);
    };
    load();
    const off = subscribeEvents((p) => {
      if (["order", "targets", "account", "orderDeleted", "accountDeleted"].includes(p.type)) schedule();
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, []);

  if (!stats) return <div className="text-sm text-slate-500">در حال بارگذاری…</div>;

  const recent = orders.slice(0, 6);
  const t = stats.targets;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-100">داشبورد</h1>
        <p className="mt-1 text-sm text-slate-400">نمای کلی اکانت‌ها و سفارش‌های ادد</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="اکانت‌های فعال"
          value={formatNumber(stats.accounts.active)}
          hint={`از مجموع ${formatNumber(stats.accounts.total)} اکانت`}
          tone="emerald"
        />
        <StatCard
          label="سفارش‌های در حال اجرا"
          value={formatNumber(stats.orders.running)}
          hint={`مجموع ${formatNumber(stats.orders.total)} سفارش`}
          tone="sky"
        />
        <StatCard label="کل ادد شده" value={formatNumber(stats.totalAdded)} hint="روی همه سفارش‌ها" tone="violet" />
        <StatCard label="ادد امروز" value={formatNumber(stats.addedToday)} hint="از ابتدای امروز" tone="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">وضعیت یوزرنیم‌ها</h2>
            <span className="text-xs text-slate-500">مجموع {formatNumber(t.total)}</span>
          </div>
          <div className="mb-4">
            <Progress value={t.added} total={t.total} tone="emerald" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="slate">در انتظار: {formatNumber(t.pending)}</Badge>
            <Badge tone="emerald">ادد شد: {formatNumber(t.added)}</Badge>
            <Badge tone="sky">از قبل عضو: {formatNumber(t.already)}</Badge>
            <Badge tone="amber">رد شد: {formatNumber(t.skipped)}</Badge>
            <Badge tone="rose">ناموفق: {formatNumber(t.failed)}</Badge>
          </div>
        </div>

        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">وضعیت اکانت‌ها</h2>
          <ul className="space-y-2 text-sm">
            {[
              ["فعال", stats.accounts.active, "emerald"],
              ["محدود شده", stats.accounts.limited, "amber"],
              ["فریز", stats.accounts.frozen, "indigo"],
              ["خطا", stats.accounts.error, "rose"],
              ["غیرفعال", stats.accounts.disabled, "slate"],
            ].map(([label, value, tone]) => (
              <li key={label} className="flex items-center justify-between">
                <span className="text-slate-400">{label}</span>
                <Badge tone={tone}>{formatNumber(value)}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between border-b border-panel-600 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-200">آخرین سفارش‌ها</h2>
          <Link to="/orders" className="text-xs text-sky-400 hover:text-sky-300">
            مشاهده همه →
          </Link>
        </div>
        {recent.length === 0 ? (
          <Empty text="هنوز سفارشی ثبت نشده است" />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-panel-600">
                <th className="th">نام</th>
                <th className="th">مقصد</th>
                <th className="th">وضعیت</th>
                <th className="th w-56">پیشرفت</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {recent.map((o) => (
                <tr key={o.id} className="border-b border-panel-700/60 last:border-0 hover:bg-panel-700/40">
                  <td className="td font-medium">{o.name}</td>
                  <td className="td text-slate-400">{o.targetTitle || o.target}</td>
                  <td className="td">
                    <OrderStatus status={o.status} />
                  </td>
                  <td className="td w-56">
                    <Progress value={o.stats.added} total={o.stats.total} tone="emerald" />
                  </td>
                  <td className="td text-left">
                    <Link to={`/orders/${o.id}`} className="text-xs text-sky-400 hover:text-sky-300">
                      جزئیات →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
