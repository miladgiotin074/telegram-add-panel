import { useEffect, useState } from "react";
import { api, subscribeEvents, formatDateTime, formatNumber } from "../api.js";
import {
  AccountStatus,
  Badge,
  Countdown,
  Empty,
  Field,
  Modal,
  Spinner,
  cx,
  useToast,
} from "../components/ui.jsx";

const EMPTY_FORM = { name: "", phone: "", session: "", apiId: "", apiHash: "", maxTotalAdds: 0 };
const EMPTY_WIZ = { step: "phone", token: "", phone: "", code: "", password: "", name: "", isCodeViaApp: false };

export default function Accounts() {
  const toast = useToast();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [wiz, setWiz] = useState(EMPTY_WIZ);
  const [wizBusy, setWizBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);

  /** تعداد اکانت‌های غیرفعال (وضعیت «خطا» و «غیرفعال») برای دکمه‌ی حذف دسته‌جمعی */
  const inactiveCount = accounts.filter((a) => a.status === "error" || a.status === "disabled").length;

  const load = async () => {
    try {
      setAccounts(await api.accounts.list());
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const off = subscribeEvents((p) => {
      if (p.type === "account") {
        setAccounts((prev) => {
          const exists = prev.some((a) => a.id === p.data.id);
          if (!exists) return [...prev, p.data].sort((a, b) => a.id - b.id);
          return prev.map((a) => (a.id === p.data.id ? p.data : a));
        });
      }
      if (p.type === "accountDeleted") setAccounts((prev) => prev.filter((a) => a.id !== p.data.id));
    });
    return off;
  }, []);

  const addAccount = async () => {
    setBusy(true);
    try {
      await api.accounts.create({ ...form, maxTotalAdds: Number(form.maxTotalAdds) || 0 });
      toast("اکانت اضافه شد", "success");
      setShowAdd(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const importAccounts = async () => {
    setBusy(true);
    try {
      const res = await api.accounts.import(importText);
      toast(`${res.created.length} اکانت اضافه شد`, "success");
      setShowImport(false);
      setImportText("");
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

  const checkAll = async () => {
    setBusy(true);
    try {
      await api.accounts.checkAll();
      toast("بررسی همه اکانت‌ها انجام شد", "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const removeInactive = () => {
    if (!inactiveCount) return;
    if (!confirm(`${inactiveCount} اکانت غیرفعال (خطا و غیرفعال) حذف شود؟ این کار قابل بازگشت نیست.`)) return;
    act(async () => {
      await api.accounts.removeInactive();
      await load();
    }, "اکانت‌های غیرفعال حذف شدند");
  };

  /* --------------------------- ویزارد ورود با شماره --------------------------- */

  const openWizard = () => {
    setWiz(EMPTY_WIZ);
    setShowWizard(true);
  };

  const closeWizard = async () => {
    const token = wiz.token;
    setShowWizard(false);
    setWiz(EMPTY_WIZ);
    if (token) {
      try {
        await api.accounts.login.cancel(token);
      } catch {
        /* بی‌اهمیت */
      }
    }
  };

  const wizStart = async () => {
    setWizBusy(true);
    try {
      const res = await api.accounts.login.start({ phone: wiz.phone.trim() });
      setWiz((w) => ({ ...w, step: "code", token: res.token, isCodeViaApp: res.isCodeViaApp }));
      toast(res.isCodeViaApp ? "کد در اپلیکیشن تلگرام ارسال شد" : "کد از طریق پیامک ارسال شد", "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setWizBusy(false);
    }
  };

  const wizVerify = async () => {
    setWizBusy(true);
    try {
      const res = await api.accounts.login.verify({ token: wiz.token, code: wiz.code.trim(), name: wiz.name.trim() });
      if (res.status === "need_password") {
        setWiz((w) => ({ ...w, step: "password" }));
        toast("این اکانت رمز دو مرحله‌ای دارد", "info");
        return;
      }
      toast("اکانت با موفقیت اضافه شد", "success");
      setShowWizard(false);
      setWiz(EMPTY_WIZ);
      load();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setWizBusy(false);
    }
  };

  const wizPassword = async () => {
    setWizBusy(true);
    try {
      await api.accounts.login.password({ token: wiz.token, password: wiz.password, name: wiz.name.trim() });
      toast("اکانت با موفقیت اضافه شد", "success");
      setShowWizard(false);
      setWiz(EMPTY_WIZ);
      load();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setWizBusy(false);
    }
  };

  /* ------------------------------- کلید شنود ------------------------------- */

  const toggleListen = async (a) => {
    const enabled = !a.listen?.enabled;
    try {
      await api.accounts.listen(a.id, enabled);
      toast(enabled ? "حالت شنود فعال شد" : "حالت شنود غیرفعال شد", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">اکانت‌ها (سشن‌های مبدا)</h1>
          <p className="mt-1 text-sm text-slate-400">
            سشن‌های شماره مجازی Teleporto را اینجا اضافه کنید؛ موتور ادد به‌صورت خودکار بین آن‌ها می‌چرخد.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={checkAll} disabled={busy || accounts.length === 0}>
            بررسی همه
          </button>
          <button className="btn-ghost" onClick={removeInactive} disabled={busy || inactiveCount === 0}>
            حذف غیرفعال‌ها{inactiveCount ? ` (${inactiveCount})` : ""}
          </button>
          <button className="btn-ghost" onClick={() => setShowImport(true)}>
            افزودن دسته‌ای
          </button>
          <button className="btn-ghost" onClick={() => setShowAdd(true)}>
            + افزودن با سشن
          </button>
          <button className="btn-primary" onClick={openWizard}>
            + افزودن با شماره
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-center text-sm text-slate-500">
            <Spinner /> در حال بارگذاری…
          </div>
        ) : accounts.length === 0 ? (
          <Empty text="هنوز اکانتی اضافه نشده است" />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-panel-600">
                <th className="th">#</th>
                <th className="th">نام</th>
                <th className="th">اکانت تلگرام</th>
                <th className="th">وضعیت</th>
                <th className="th">محدودیت</th>
                <th className="th">سقف کلی / ادد شده</th>
                <th className="th">شنود</th>
                <th className="th">آخرین بررسی</th>
                <th className="th">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-b border-panel-700/60 last:border-0 hover:bg-panel-700/40">
                  <td className="td text-slate-500">{a.id}</td>
                  <td className="td">
                    <div className="font-medium">{a.name}</div>
                    {a.phone ? <div className="text-[11px] text-slate-500">{a.phone}</div> : null}
                  </td>
                  <td className="td">
                    <div>{a.username ? `@${a.username}` : a.firstName || "—"}</div>
                    <div className="text-[11px] text-slate-500">{a.telegramId ? `ID: ${a.telegramId}` : a.sessionPreview}</div>
                  </td>
                  <td className="td">
                    <AccountStatus status={a.status} />
                    {a.statusMessage ? (
                      <div className="mt-1 max-w-[220px] truncate text-[11px] text-slate-500" title={a.statusMessage}>
                        {a.statusMessage}
                      </div>
                    ) : null}
                  </td>
                  <td className="td">
                    {a.floodUntil > Date.now() ? (
                      <Countdown until={a.floodUntil} className="text-amber-300" />
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="td">
                    <span className="text-slate-300">{formatNumber(a.addedTotal)}</span>
                    <span className="text-slate-500"> / {a.maxTotalAdds > 0 ? formatNumber(a.maxTotalAdds) : "∞"}</span>
                  </td>
                  <td className="td">
                    {a.listen?.enabled ? (
                      <>
                        <Badge tone="emerald">در حال شنود</Badge>
                        <div className="mt-1 text-[11px] text-slate-400">
                          جمع‌آوری: {formatNumber(a.collectedCount)}
                        </div>
                      </>
                    ) : (
                      <Badge tone="slate">غیرفعال</Badge>
                    )}
                  </td>
                  <td className="td text-slate-400">{formatDateTime(a.lastCheckedAt)}</td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        className={cx("px-2 py-1 text-xs", a.listen?.enabled ? "btn-danger" : "btn-ghost")}
                        onClick={() => toggleListen(a)}
                      >
                        {a.listen?.enabled ? "توقف شنود" : "شروع شنود"}
                      </button>
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => act(() => api.accounts.check(a.id).then(load), "بررسی انجام شد")}>
                        بررسی
                      </button>
                      <button
                        className="btn-ghost px-2 py-1 text-xs"
                        onClick={() =>
                          act(
                            () =>
                              api.accounts
                                .update(a.id, { status: a.status === "disabled" ? "active" : "disabled" })
                                .then(load),
                            "وضعیت اکانت تغییر کرد",
                          )
                        }
                      >
                        {a.status === "disabled" ? "فعال‌سازی" : "غیرفعال"}
                      </button>
                      <button
                        className="btn-ghost px-2 py-1 text-xs"
                        onClick={() => act(() => api.accounts.update(a.id, { resetCounters: true }).then(load), "شمارنده صفر شد")}
                      >
                        ریست
                      </button>
                      <button
                        className="btn-danger px-2 py-1 text-xs"
                        onClick={() => {
                          if (confirm(`اکانت «${a.name}» حذف شود؟`)) act(() => api.accounts.remove(a.id).then(load), "اکانت حذف شد");
                        }}
                      >
                        حذف
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {accounts.length > 0 ? (
        <p className="text-[11px] leading-5 text-slate-500">
          راهنما: «سقف کلی» حداکثر تعدادی است که این اکانت در کل (در همه سفارش‌ها) می‌تواند ادد کند؛ ۰ یعنی نامحدود.
          اکانت‌های «محدود شده» پس از پایان زمان محدودیت به‌صورت خودکار فعال می‌شوند.
        </p>
      ) : null}

      {/* افزودن اکانت */}
      <Modal
        open={showAdd}
        title="افزودن اکانت با سشن"
        onClose={() => setShowAdd(false)}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowAdd(false)}>
              انصراف
            </button>
            <button className="btn-primary" onClick={addAccount} disabled={busy || !form.session.trim()}>
              {busy ? <Spinner /> : null} ذخیره و بررسی
            </button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام نمایشی">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثلاً: اکانت ۱" />
          </Field>
          <Field label="شماره (اختیاری)">
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+98912…" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="رشته سشن (StringSession)" hint="سشن ساخته‌شده با api_id/api_hash شما. این مقدار محرمانه است و فقط روی سرور ذخیره می‌شود.">
              <textarea
                className="input h-28 font-mono text-xs"
                value={form.session}
                onChange={(e) => setForm({ ...form, session: e.target.value })}
                placeholder="1BVtsOK4…"
              />
            </Field>
          </div>
          <Field label="api_id (اختیاری)" hint="اگر خالی بماند از تنظیمات کلی استفاده می‌شود.">
            <input className="input" value={form.apiId} onChange={(e) => setForm({ ...form, apiId: e.target.value })} placeholder="1234567" />
          </Field>
          <Field label="api_hash (اختیاری)">
            <input className="input" value={form.apiHash} onChange={(e) => setForm({ ...form, apiHash: e.target.value })} placeholder="0123456789abcdef…" />
          </Field>
          <Field label="سقف کلی ادد این اکانت (۰ = نامحدود)">
            <input
              type="number"
              min="0"
              className="input"
              value={form.maxTotalAdds}
              onChange={(e) => setForm({ ...form, maxTotalAdds: e.target.value })}
            />
          </Field>
        </div>
      </Modal>

      {/* افزودن دسته‌ای */}
      <Modal
        open={showImport}
        title="افزودن دسته‌ای سشن‌ها"
        onClose={() => setShowImport(false)}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowImport(false)}>
              انصراف
            </button>
            <button className="btn-primary" onClick={importAccounts} disabled={busy || !importText.trim()}>
              {busy ? <Spinner /> : null} افزودن
            </button>
          </>
        }
      >
        <Field label="هر خط یک سشن" hint="هر رشته در یک خط جداگانه. نام‌ها خودکار تعیین می‌شوند و سشن‌ها به‌صورت موازی بررسی می‌شوند.">
          <textarea
            className="input h-56 font-mono text-xs"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={"1BVtsOK4…\n1BVtsOK4…"}
          />
        </Field>
        <p className={cx("mt-2 text-[11px]", "text-slate-500")}>
          تعداد خطوط: {importText.split(/\r?\n/).filter((l) => l.trim()).length}
        </p>
      </Modal>

      {/* ویزارد ورود با شماره */}
      <Modal
        open={showWizard}
        title="افزودن اکانت با شماره"
        width="max-w-lg"
        onClose={closeWizard}
        footer={
          <>
            <button className="btn-ghost" onClick={closeWizard} disabled={wizBusy}>
              انصراف
            </button>
            {wiz.step === "phone" ? (
              <button className="btn-primary" onClick={wizStart} disabled={wizBusy || wiz.phone.trim().length < 6}>
                {wizBusy ? <Spinner /> : null} ارسال کد
              </button>
            ) : null}
            {wiz.step === "code" ? (
              <button className="btn-primary" onClick={wizVerify} disabled={wizBusy || wiz.code.trim().length < 3}>
                {wizBusy ? <Spinner /> : null} تأیید کد
              </button>
            ) : null}
            {wiz.step === "password" ? (
              <button className="btn-primary" onClick={wizPassword} disabled={wizBusy || !wiz.password}>
                {wizBusy ? <Spinner /> : null} ورود
              </button>
            ) : null}
          </>
        }
      >
        <div className="mb-4 flex items-center gap-2 text-xs">
          {[
            { key: "phone", label: "شماره" },
            { key: "code", label: "کد" },
            { key: "password", label: "رمز دو مرحله‌ای" },
          ].map((s, i) => {
            const order = ["phone", "code", "password"];
            const active = order.indexOf(wiz.step) >= i;
            return (
              <div key={s.key} className="flex items-center gap-2">
                <span
                  className={cx(
                    "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
                    active ? "bg-sky-500 text-white" : "bg-panel-600 text-slate-400",
                  )}
                >
                  {i + 1}
                </span>
                <span className={active ? "text-slate-200" : "text-slate-500"}>{s.label}</span>
                {i < 2 ? <span className="text-slate-600">›</span> : null}
              </div>
            );
          })}
        </div>

        {wiz.step === "phone" ? (
          <Field
            label="شماره تلفن (با کد کشور)"
            hint="مثال: +989121234567. کد ورود به همین شماره ارسال می‌شود. api_id و api_hash باید در صفحه تنظیمات وارد شده باشند."
          >
            <input
              className="input"
              dir="ltr"
              value={wiz.phone}
              onChange={(e) => setWiz({ ...wiz, phone: e.target.value })}
              placeholder="+98912…"
            />
          </Field>
        ) : null}

        {wiz.step === "code" ? (
          <div className="space-y-4">
            <Field
              label="کد ورود"
              hint={
                wiz.isCodeViaApp
                  ? "کد به‌صورت پیام در اپلیکیشن تلگرام همان اکانت ارسال شده است."
                  : "کد از طریق پیامک به شماره ارسال شده است."
              }
            >
              <input
                className="input tracking-[0.4em]"
                dir="ltr"
                value={wiz.code}
                onChange={(e) => setWiz({ ...wiz, code: e.target.value })}
                placeholder="12345"
                autoFocus
              />
            </Field>
            <Field label="نام نمایشی (اختیاری)" hint="در صورت خالی بودن، از نام پروفایل تلگرام استفاده می‌شود.">
              <input className="input" value={wiz.name} onChange={(e) => setWiz({ ...wiz, name: e.target.value })} placeholder="مثلاً: اکانت ۱" />
            </Field>
          </div>
        ) : null}

        {wiz.step === "password" ? (
          <div className="space-y-4">
            <Field label="رمز دو مرحله‌ای" hint="این اکانت روی رمز دو مرحله‌ای (Cloud Password) تنظیم شده است.">
              <input
                type="password"
                className="input"
                dir="ltr"
                value={wiz.password}
                onChange={(e) => setWiz({ ...wiz, password: e.target.value })}
                placeholder="••••••••"
                autoFocus
              />
            </Field>
            <Field label="نام نمایشی (اختیاری)">
              <input className="input" value={wiz.name} onChange={(e) => setWiz({ ...wiz, name: e.target.value })} placeholder="مثلاً: اکانت ۱" />
            </Field>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
