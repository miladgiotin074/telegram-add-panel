import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Field, Spinner, useToast } from "../components/ui.jsx";

const EMPTY = {
  apiId: "",
  apiHash: "",
  hasApiHash: false,
  apiHashMasked: "",
  peerFloodCooldownMinutes: 720,
  maxLogs: 3000,
  shortFloodWaitSeconds: 60,
  recentActivityHours: 72,
  collectOnlyUsername: false,
  defaultSettings: {
    batchSize: 1,
    maxPerAccount: 40,
    delayMinSec: 20,
    delayMaxSec: 60,
    autoJoin: true,
    maxAttempts: 3,
  },
};

export default function Settings() {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [clearHash, setClearHash] = useState(false);

  const load = async () => {
    try {
      const data = await api.settings.get();
      setForm({ ...EMPTY, ...data, apiHash: "", defaultSettings: { ...EMPTY.defaultSettings, ...(data.defaultSettings || {}) } });
      setClearHash(false);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setDefault = (patch) => setForm((f) => ({ ...f, defaultSettings: { ...f.defaultSettings, ...patch } }));

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        apiId: form.apiId,
        peerFloodCooldownMinutes: Number(form.peerFloodCooldownMinutes),
        maxLogs: Number(form.maxLogs),
        shortFloodWaitSeconds: Number(form.shortFloodWaitSeconds),
        recentActivityHours: Number(form.recentActivityHours),
        collectOnlyUsername: Boolean(form.collectOnlyUsername),
        defaultSettings: {
          batchSize: Number(form.defaultSettings.batchSize),
          maxPerAccount: Number(form.defaultSettings.maxPerAccount),
          delayMinSec: Number(form.defaultSettings.delayMinSec),
          delayMaxSec: Number(form.defaultSettings.delayMaxSec),
          maxAttempts: Number(form.defaultSettings.maxAttempts),
          autoJoin: form.defaultSettings.autoJoin,
        },
      };
      if (clearHash) body.clearApiHash = true;
      else if (form.apiHash.trim()) body.apiHash = form.apiHash.trim();

      const data = await api.settings.update(body);
      setForm({ ...EMPTY, ...data, apiHash: "", defaultSettings: { ...EMPTY.defaultSettings, ...(data.defaultSettings || {}) } });
      setClearHash(false);
      toast("تنظیمات ذخیره شد", "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-sm text-slate-500">
        <Spinner /> در حال بارگذاری…
      </div>
    );
  }

  const d = form.defaultSettings;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">تنظیمات کلی</h1>
          <p className="mt-1 text-sm text-slate-400">
            اعتبارنامه‌های تلگرام، کول‌داون اسپم‌بلاک و مقادیر پیش‌فرض فرم ثبت سفارش.
          </p>
        </div>
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? <Spinner /> : null} ذخیره
        </button>
      </div>

      {/* اعتبارنامه‌های تلگرام */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-200">اعتبارنامه‌های تلگرام (api_id / api_hash)</h2>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">
          سشن‌های Teleporto فقط در صورتی کار می‌کنند که api_id و api_hash مربوط به همان اکانت ساخته‌شده را
          وارد کنید (از my.telegram.org). در صورت خالی گذاشتن هر اکانت، از همین مقادیر استفاده می‌شود.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="api_id">
            <input
              className="input"
              value={form.apiId}
              onChange={(e) => setForm({ ...form, apiId: e.target.value })}
              placeholder="1234567"
            />
          </Field>
          <Field
            label="api_hash"
            hint={
              form.hasApiHash
                ? `مقدار ذخیره‌شده: ${form.apiHashMasked} — برای تغییر، مقدار جدید وارد کنید.`
                : "هنوز ذخیره نشده است."
            }
          >
            <input
              className="input"
              value={form.apiHash}
              disabled={clearHash}
              onChange={(e) => setForm({ ...form, apiHash: e.target.value })}
              placeholder={form.hasApiHash ? "برای تغییر مقدار جدید وارد کنید" : "0123456789abcdef…"}
            />
          </Field>
        </div>
        {form.hasApiHash ? (
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 accent-sky-500"
              checked={clearHash}
              onChange={(e) => setClearHash(e.target.checked)}
            />
            حذف مقدار ذخیره‌شده‌ی api_hash
          </label>
        ) : null}
      </div>

      {/* رفتار موتور */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-200">رفتار موتور و محدودیت‌ها</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field
            label="کول‌داون اسپم‌بلاک (دقیقه)"
            hint="مدتی که اکانت پس از خطای PEER_FLOOD کنار گذاشته می‌شود."
          >
            <input
              type="number"
              min="1"
              className="input"
              value={form.peerFloodCooldownMinutes}
              onChange={(e) => setForm({ ...form, peerFloodCooldownMinutes: e.target.value })}
            />
          </Field>
          <Field
            label="آستانه FloodWait کوتاه (ثانیه)"
            hint="اگر FloodWait کمتر از این مقدار باشد، به‌جای سوییچ اکانت منتظر می‌مانیم."
          >
            <input
              type="number"
              min="0"
              className="input"
              value={form.shortFloodWaitSeconds}
              onChange={(e) => setForm({ ...form, shortFloodWaitSeconds: e.target.value })}
            />
          </Field>
          <Field label="سقف نگهداری لاگ‌ها" hint="تعداد لاگ‌های نگهداری‌شده در دیتابیس.">
            <input
              type="number"
              min="100"
              className="input"
              value={form.maxLogs}
              onChange={(e) => setForm({ ...form, maxLogs: e.target.value })}
            />
          </Field>
        </div>
      </div>

      {/* فیلتر جمع‌آوری کاربران */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-200">فیلتر جمع‌آوری کاربران</h2>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">
          در حالت شنود و اسکن، فقط کاربرانی ذخیره می‌شوند که «آخرین بازدید»شان به تازگی بوده است. کاربرانی که
          آخرین بازدیدشان یک هفته پیش یا قدیمی‌تر است (و همچنین وضعیت پنهان) نادیده گرفته می‌شوند.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field
            label="حداکثر فاصله‌ی آخرین بازدید (ساعت)"
            hint="مثلاً ۷۲ یعنی حداکثر ۳ روز پیش. مقدار ۰ فیلتر را غیرفعال می‌کند."
          >
            <input
              type="number"
              min="0"
              className="input"
              value={form.recentActivityHours}
              onChange={(e) => setForm({ ...form, recentActivityHours: e.target.value })}
            />
          </Field>
          <label className="flex items-start gap-2 text-sm text-slate-300 sm:col-span-2 sm:pt-6">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-sky-500"
              checked={form.collectOnlyUsername}
              onChange={(e) => setForm({ ...form, collectOnlyUsername: e.target.checked })}
            />
            <span>
              فقط کاربران دارای یوزرنیم ذخیره شوند
              <span className="mt-0.5 block text-[11px] leading-5 text-slate-500">
                کاربران بدون یوزرنیم ذخیره نمی‌شوند؛ در نتیجه ادد کردن هم با resolve کردن یوزرنیم انجام می‌شود.
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* پیش‌فرض سفارش */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-200">مقادیر پیش‌فرض ثبت سفارش</h2>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">
          این مقادیر در فرم «ساخت سفارش جدید» به‌صورت پیش‌فرض قرار می‌گیرند و برای هر سفارش قابل تغییرند.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="سقف در هر درخواست (batch)" hint="تعداد یوزر در هر InviteToChannel. برای گروه ساده همیشه ۱.">
            <input
              type="number"
              min="1"
              className="input"
              value={d.batchSize}
              onChange={(e) => setDefault({ batchSize: e.target.value })}
            />
          </Field>
          <Field label="سقف کلی هر اکانت (۰=نامحدود)">
            <input
              type="number"
              min="0"
              className="input"
              value={d.maxPerAccount}
              onChange={(e) => setDefault({ maxPerAccount: e.target.value })}
            />
          </Field>
          <Field label="حداکثر تلاش هر یوزر">
            <input
              type="number"
              min="1"
              className="input"
              value={d.maxAttempts}
              onChange={(e) => setDefault({ maxAttempts: e.target.value })}
            />
          </Field>
          <Field label="حداقل فاصله بین اددها (ثانیه)">
            <input
              type="number"
              min="1"
              className="input"
              value={d.delayMinSec}
              onChange={(e) => setDefault({ delayMinSec: e.target.value })}
            />
          </Field>
          <Field label="حداکثر فاصله بین اددها (ثانیه)">
            <input
              type="number"
              min="1"
              className="input"
              value={d.delayMaxSec}
              onChange={(e) => setDefault({ delayMaxSec: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 pt-6 text-sm text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 accent-sky-500"
              checked={d.autoJoin}
              onChange={(e) => setDefault({ autoJoin: e.target.checked })}
            />
            عضویت خودکار در گروه مقصد قبل از ادد (و خروج پس از پایان سهم)
          </label>
        </div>
      </div>
    </div>
  );
}
