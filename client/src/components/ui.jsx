import { createContext, useCallback, useContext, useEffect, useState } from "react";

export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

/* -------------------------------- Badge -------------------------------- */

const TONES = {
  emerald: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  sky: "bg-sky-500/15 text-sky-300 border border-sky-500/30",
  amber: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  rose: "bg-rose-500/15 text-rose-300 border border-rose-500/30",
  slate: "bg-slate-500/15 text-slate-300 border border-slate-500/30",
  indigo: "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30",
  violet: "bg-violet-500/15 text-violet-300 border border-violet-500/30",
};

export function Badge({ tone = "slate", children, className = "" }) {
  return <span className={cx("badge", TONES[tone] || TONES.slate, className)}>{children}</span>;
}

const ACCOUNT_STATUS = {
  active: { tone: "emerald", label: "فعال" },
  limited: { tone: "amber", label: "محدود شده" },
  error: { tone: "rose", label: "خطا" },
  frozen: { tone: "indigo", label: "فریز" },
  disabled: { tone: "slate", label: "غیرفعال" },
};

export function AccountStatus({ status }) {
  const s = ACCOUNT_STATUS[status] || { tone: "slate", label: status };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const ORDER_STATUS = {
  pending: { tone: "slate", label: "آماده" },
  running: { tone: "sky", label: "در حال اجرا" },
  paused: { tone: "amber", label: "متوقف (موقت)" },
  stopped: { tone: "slate", label: "متوقف" },
  completed: { tone: "emerald", label: "تمام شده" },
  failed: { tone: "rose", label: "خطا" },
};

export function OrderStatus({ status }) {
  const s = ORDER_STATUS[status] || { tone: "slate", label: status };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const TARGET_STATUS = {
  pending: { tone: "slate", label: "در انتظار" },
  added: { tone: "emerald", label: "ادد شد" },
  already: { tone: "sky", label: "از قبل عضو" },
  skipped: { tone: "amber", label: "رد شد" },
  failed: { tone: "rose", label: "ناموفق" },
};

export function TargetStatus({ status }) {
  const s = TARGET_STATUS[status] || { tone: "slate", label: status };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/* ------------------------------ Countdown ------------------------------ */

function formatShort(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function Countdown({ until, className = "" }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const remain = (Number(until) - Date.now()) / 1000;
  if (!until || remain <= 0) return null;
  return <span className={cx("tabular-nums", className)}>{formatShort(remain)}</span>;
}

/* ------------------------------- Progress ------------------------------ */

export function Progress({ value = 0, total = 0, tone = "sky" }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const bar = {
    sky: "bg-sky-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
  }[tone];
  return (
    <div className="w-full">
      <div className="h-2 w-full rounded-full bg-panel-600 overflow-hidden">
        <div className={cx("h-full rounded-full transition-all", bar)} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-400">
        <span>{pct}%</span>
        <span>
          {value} / {total}
        </span>
      </div>
    </div>
  );
}

/* --------------------------------- Modal -------------------------------- */

export function Modal({ open, title, onClose, children, footer, width = "max-w-2xl" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8">
      <div className={cx("card w-full shadow-2xl", width)}>
        <div className="flex items-center justify-between border-b border-panel-600 px-5 py-3">
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
          <button className="btn-ghost px-2 py-1" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-panel-600 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

/* -------------------------------- Misc --------------------------------- */

export function Spinner({ className = "" }) {
  return (
    <span
      className={cx(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-transparent",
        className,
      )}
    />
  );
}

export function Empty({ text = "موردی یافت نشد" }) {
  return <div className="py-10 text-center text-sm text-slate-500">{text}</div>;
}

export function Field({ label, hint, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11px] leading-5 text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = "sky" }) {
  const ring = {
    sky: "from-sky-500/20",
    emerald: "from-emerald-500/20",
    amber: "from-amber-500/20",
    rose: "from-rose-500/20",
    violet: "from-violet-500/20",
  }[tone];
  return (
    <div className="card relative overflow-hidden p-4">
      <div className={cx("pointer-events-none absolute inset-0 bg-gradient-to-bl to-transparent", ring)} />
      <div className="relative">
        <div className="text-xs text-slate-400">{label}</div>
        <div className="mt-2 text-2xl font-bold text-slate-100">{value}</div>
        {hint ? <div className="mt-1 text-[11px] text-slate-500">{hint}</div> : null}
      </div>
    </div>
  );
}

/* -------------------------------- Toast -------------------------------- */

const ToastCtx = createContext(() => {});

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const push = useCallback((message, type = "info") => {
    const id = Date.now() + Math.random();
    setItems((v) => [...v, { id, message, type }]);
    setTimeout(() => setItems((v) => v.filter((i) => i.id !== id)), 4500);
  }, []);

  const tone = {
    info: "border-sky-500/40 bg-sky-500/10 text-sky-200",
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    error: "border-rose-500/40 bg-rose-500/10 text-rose-200",
  };

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 left-4 z-[100] flex w-80 flex-col gap-2">
        {items.map((i) => (
          <div key={i.id} className={cx("rounded-lg border px-4 py-2.5 text-sm shadow-lg", tone[i.type] || tone.info)}>
            {i.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
