#!/usr/bin/env bash
#
# راه‌اندازی تک‌دستوری «پنل ادد تلگرام»
#
#   bash deploy.sh            # نصب + build + اجرا
#   bash deploy.sh --no-build # اجرای سریع بدون نصب/بیلد مجدد (روی سرور Linux)
#
# متغیّرهای محیطی اختیاری:
#   PORT      پورت سرور (پیش‌فرض 5000)
#   DATA_DIR  مسیر ذخیره‌ی داده‌ها (پیش‌فرض server/data)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

export PORT="${PORT:-5000}"

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; }

SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --no-build) SKIP_BUILD=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) err "آرگومان ناشناخته: $arg"; exit 1 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  err "Node.js نصب نیست. ابتدا Node 18+ را نصب کنید."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  err "npm نصب نیست."
  exit 1
fi

log "Node $(node --version) / npm $(npm --version)"

if [ "$SKIP_BUILD" -eq 0 ]; then
  log "نصب وابستگی‌های سرور…"
  npm --prefix server install --omit=dev

  log "نصب وابستگی‌های کلاینت…"
  npm --prefix client install

  log "ساخت نسخه‌ی production کلاینت…"
  npm --prefix client run build
else
  log "رد کردن مرحله‌ی نصب/بیلد (--no-build)"
fi

if [ ! -d "client/dist" ]; then
  err "پوشه‌ی client/dist پیدا نشد. بدون آن سرور رابط کاربری را سرو نمی‌کند."
  exit 1
fi

log "اجرای سرور روی پورت $PORT …"
exec node server/src/index.js
