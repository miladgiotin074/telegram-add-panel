import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { ToastProvider, cx } from "./components/ui.jsx";
import { api, subscribeEvents } from "./api.js";
import Dashboard from "./pages/Dashboard.jsx";
import Accounts from "./pages/Accounts.jsx";
import Orders from "./pages/Orders.jsx";
import OrderDetail from "./pages/OrderDetail.jsx";
import Senders from "./pages/Senders.jsx";
import Settings from "./pages/Settings.jsx";

const NAV = [
  { to: "/", label: "داشبورد", icon: "📊", end: true },
  { to: "/orders", label: "سفارش‌ها", icon: "📦" },
  { to: "/accounts", label: "اکانت‌ها (سشن‌ها)", icon: "👤" },
  { to: "/senders", label: "کاربران جمع‌آوری‌شده", icon: "🎯" },
  { to: "/settings", label: "تنظیمات", icon: "⚙️" },
];

function Sidebar() {
  const [orders, setOrders] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    const load = () => api.orders.list().then((d) => alive && setOrders(d)).catch(() => {});
    load();
    const off = subscribeEvents((payload) => {
      if (payload.type === "order") {
        setOrders((prev) => {
          const others = prev.filter((o) => o.id !== payload.data.id);
          const next = [payload.data, ...others].sort((a, b) => b.id - a.id);
          return next;
        });
      }
      if (payload.type === "orderDeleted") {
        setOrders((prev) => prev.filter((o) => o.id !== payload.data.id));
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const running = orders.filter((o) => o.status === "running");

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-panel-600 bg-panel-800">
      <div className="border-b border-panel-600 px-5 py-5">
        <div className="text-lg font-bold text-slate-100">پنل ادد تلگرام</div>
        <div className="mt-1 text-[11px] text-slate-500">مدیریت ادد گروه با سشن‌های Teleproto</div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cx(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition",
                isActive ? "bg-sky-600/20 text-sky-300 border border-sky-600/40" : "text-slate-300 hover:bg-panel-700",
              )
            }
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}

        <div className="pt-4">
          <div className="px-3 pb-2 text-[11px] font-semibold text-slate-500">
            در حال اجرا ({running.length})
          </div>
          {running.length === 0 ? (
            <div className="px-3 text-[11px] text-slate-600">سفارشی در حال اجرا نیست</div>
          ) : (
            running.map((o) => (
              <button
                key={o.id}
                onClick={() => navigate(`/orders/${o.id}`)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-xs text-slate-300 hover:bg-panel-700"
              >
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
                <span className="truncate">{o.name}</span>
              </button>
            ))
          )}
        </div>
      </nav>

      <div className="border-t border-panel-600 px-4 py-3 text-[11px] leading-5 text-slate-500">
        برای اطمینان از سشن‌ها ابتدا در صفحه «تنظیمات» مقدار api_id و api_hash را وارد کنید.
      </div>
    </aside>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <div className="flex h-full">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-6 py-6">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/:id" element={<OrderDetail />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/senders" element={<Senders />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
