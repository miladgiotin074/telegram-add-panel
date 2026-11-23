/** ابزارهای مربوط به پارس کردن یوزرنیم و لینک گروه مقصد */

export function normalizeUsername(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/^www\./i, "");
  s = s.replace(/^(t\.me|telegram\.me|telegram\.dog)\//i, "");
  s = s.replace(/^@/, "");
  return s.toLowerCase();
}

/**
 * تشخیص نوع مقصد: یوزرنیم عمومی یا لینک دعوت خصوصی
 * @returns {{kind:'username'|'invite', value:string}|null}
 */
export function parseTarget(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;

  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/^www\./i, "");
  s = s.replace(/^(t\.me|telegram\.me|telegram\.dog)\//i, "");
  s = s.replace(/\?.*$/, "");
  s = s.replace(/\/+$/, "");

  if (!s) return null;
  if (s.startsWith("+")) return { kind: "invite", value: s.slice(1) };
  if (/^joinchat\//i.test(s)) return { kind: "invite", value: s.replace(/^joinchat\//i, "") };

  s = s.replace(/^@/, "");
  return { kind: "username", value: s.toLowerCase() };
}

/** تبدیل متن چندخطی/کاما جدا شده به لیست یوزرنیم یکتا */
export function parseUsernameList(text) {
  const parts = String(text || "")
    .split(/[\s,;،\r\n\t]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const u = normalizeUsername(part);
    if (!u || seen.has(u)) continue;
    // یوزرنیم معتبر تلگرام: ۵ تا ۳۲ کاراکتر، حروف/عدد/underscore
    if (!/^[a-z0-9_]{5,32}$/.test(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}
