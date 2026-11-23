#!/usr/bin/env bash
#
# راه‌اندازی خودکار و پایدار «پنل ادد تلگرام» روی سرور لینوکسی
#
# این اسکریپت: پیش‌نیازها (Node.js/npm) را نصب می‌کند، وابستگی‌ها را نصب و
# کلاینت را build می‌کند، و اپ را به‌صورت پایدار اجرا می‌کند
# (سرویس systemd با ری‌استارت خودکار و اجرا در بوت؛ در نبود systemd → nohup).
#
#   bash deploy.sh                # نصب پیش‌نیاز + بیلد + اجرای پایدار
#   bash deploy.sh --foreground   # اجرا در همین ترمینال (دیباگ؛ Ctrl+C برای خروج)
#   bash deploy.sh --service      # اجبار به حالت سرویس systemd
#   bash deploy.sh --nohup        # اجبار به حالت پس‌زمینه (بدون systemd)
#   bash deploy.sh --no-build     # رد کردن نصب/بیلد (فقط اجرا یا ری‌استارت)
#   bash deploy.sh --no-install   # رد کردن نصب پیش‌نیازها
#
# متغیّرهای محیطی اختیاری:
#   PORT      پورت سرور (پیش‌فرض 5000)
#   DATA_DIR  مسیر ذخیره‌ی داده‌ها (پیش‌فرض server/data)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

SERVICE_NAME="telegram-add-panel"
export PORT="${PORT:-5000}"
export DATA_DIR="${DATA_DIR:-$ROOT/server/data}"
NODE_MAJOR_MIN=18
NODE_MAJOR_INSTALL=20
LOG_DIR="$ROOT/logs"
PID_FILE="$LOG_DIR/app.pid"
LOG_FILE="$LOG_DIR/app.log"

MODE="auto"   # auto | foreground | service | nohup
DO_INSTALL=1
DO_BUILD=1

log()  { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; }

usage() {
  cat <<'EOF'
راه‌اندازی خودکار و پایدار «پنل ادد تلگرام»

  bash deploy.sh                نصب پیش‌نیاز + بیلد + اجرای پایدار
  bash deploy.sh --foreground   اجرا در همین ترمینال (دیباگ)
  bash deploy.sh --service      اجبار به حالت سرویس systemd
  bash deploy.sh --nohup        اجبار به حالت پس‌زمینه (بدون systemd)
  bash deploy.sh --no-build     رد کردن نصب/بیلد (فقط اجرا یا ری‌استارت)
  bash deploy.sh --no-install   رد کردن نصب پیش‌نیازها

متغیّرهای محیطی: PORT (پیش‌فرض 5000)، DATA_DIR (پیش‌فرض server/data)
EOF
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --foreground) MODE="foreground" ;;
    --service)    MODE="service" ;;
    --nohup)      MODE="nohup" ;;
    --no-build)   DO_BUILD=0 ;;
    --no-install) DO_INSTALL=0 ;;
    -h|--help)    usage ;;
    *) err "آرگومان ناشناخته: $arg"; exit 1 ;;
  esac
done

# ---------- دسترسی root ----------
CAN_ROOT=0
if [ "$(id -u)" -eq 0 ] || command -v sudo >/dev/null 2>&1; then
  CAN_ROOT=1
fi

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

pkg_install() {
  if command -v apt-get >/dev/null 2>&1; then
    run_root apt-get update -y && run_root apt-get install -y "$@"
  elif command -v dnf >/dev/null 2>&1; then
    run_root dnf install -y "$@"
  elif command -v yum >/dev/null 2>&1; then
    run_root yum install -y "$@"
  elif command -v apk >/dev/null 2>&1; then
    run_root apk add --no-cache "$@"
  else
    return 1
  fi
}

node_major() {
  command -v node >/dev/null 2>&1 || return 1
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || return 1
}

install_node() {
  if [ "$CAN_ROOT" -eq 0 ]; then
    err "برای نصب Node.js به دسترسی root/sudo نیاز است. آن را دستی نصب کنید یا با sudo اجرا کنید."
    exit 1
  fi
  log "نصب Node.js ${NODE_MAJOR_INSTALL}.x …"
  if command -v apt-get >/dev/null 2>&1; then
    pkg_install curl ca-certificates gnupg
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR_INSTALL}.x" | run_root bash -
    pkg_install nodejs
  elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
    pkg_install curl
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR_INSTALL}.x" | run_root bash -
    pkg_install nodejs
  elif command -v apk >/dev/null 2>&1; then
    pkg_install nodejs npm
  else
    err "مدیر بسته‌ی شناخته‌شده‌ای پیدا نشد؛ Node.js ${NODE_MAJOR_MIN}+ را دستی نصب کنید."
    exit 1
  fi
}

ensure_prereqs() {
  if [ "$DO_INSTALL" -eq 0 ]; then
    warn "نصب پیش‌نیازها رد شد (--no-install)"
  else
    local major
    major="$(node_major || true)"
    if [ -z "${major:-}" ]; then
      log "Node.js یافت نشد؛ نصب می‌شود."
      install_node
    elif [ "$major" -lt "$NODE_MAJOR_MIN" ]; then
      warn "نسخه‌ی Node.js فعلی (v$major) قدیمی است؛ نسخه‌ی ${NODE_MAJOR_INSTALL} نصب می‌شود."
      install_node
    else
      log "Node.js v$major یافت شد؛ نیازی به نصب نیست."
    fi
  fi
  if ! command -v node >/dev/null 2>&1; then
    err "Node.js در دسترس نیست."
    exit 1
  fi
  if ! command -v npm >/dev/null 2>&1; then
    err "npm در دسترس نیست؛ پس از نصب Node.js دوباره اجرا کنید."
    exit 1
  fi
  log "محیط: Node $(node --version) / npm $(npm --version)"
}

build_app() {
  if [ "$DO_BUILD" -eq 0 ]; then
    warn "نصب/بیلد رد شد (--no-build)"
  else
    log "نصب وابستگی‌های سرور…"
    npm --prefix server install --omit=dev
    log "نصب وابستگی‌های کلاینت…"
    npm --prefix client install
    log "ساخت نسخه‌ی production کلاینت…"
    npm --prefix client run build
  fi
  if [ ! -d client/dist ]; then
    err "پوشه‌ی client/dist پیدا نشد؛ بیلد کلاینت لازم است."
    exit 1
  fi
}

start_foreground() {
  log "اجرای سرور روی http://0.0.0.0:$PORT (Ctrl+C برای خروج)…"
  exec node server/src/index.js
}

start_nohup() {
  mkdir -p "$LOG_DIR"
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    log "توقف نمونه‌ی قبلی (PID $(cat "$PID_FILE"))…"
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    sleep 1
  fi
  log "اجرای سرور در پس‌زمینه روی پورت $PORT …"
  nohup node server/src/index.js >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 2
  if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    log "اپ اجرا شد (PID $(cat "$PID_FILE")). لاگ: $LOG_FILE"
  else
    err "اجرای اپ ناموفق بود. ۲۰ خط آخر لاگ:"
    tail -n 20 "$LOG_FILE" 2>/dev/null || true
    exit 1
  fi
}

install_service() {
  if [ "$CAN_ROOT" -eq 0 ]; then
    err "برای نصب سرویس systemd به دسترسی root/sudo نیاز است."
    exit 1
  fi
  mkdir -p "$LOG_DIR"
  local unit="/etc/systemd/system/${SERVICE_NAME}.service"
  local node_bin
  node_bin="$(command -v node)"
  log "نصب سرویس systemd: $unit"
  run_root tee "$unit" >/dev/null <<EOF
[Unit]
Description=Telegram Add Panel
After=network.target

[Service]
Type=simple
WorkingDirectory=$ROOT
Environment=PORT=$PORT
Environment=DATA_DIR=$DATA_DIR
ExecStart=$node_bin $ROOT/server/src/index.js
Restart=always
RestartSec=5
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE

[Install]
WantedBy=multi-user.target
EOF
  run_root systemctl daemon-reload
  run_root systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  run_root systemctl restart "$SERVICE_NAME"
  sleep 2
  if run_root systemctl is-active --quiet "$SERVICE_NAME"; then
    log "سرویس «$SERVICE_NAME» فعال و پایدار شد (ری‌استارت خودکار + اجرا در بوت)."
  else
    err "سرویس بالا نیامد. وضعیت:"
    run_root systemctl status "$SERVICE_NAME" --no-pager || true
    exit 1
  fi
}

# ---------- انتخاب حالت اجرا ----------
if [ "$MODE" = "auto" ]; then
  if [ "$CAN_ROOT" -eq 1 ] && command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    MODE="service"
  else
    MODE="nohup"
  fi
fi

ensure_prereqs
build_app

case "$MODE" in
  foreground) start_foreground ;;
  service)    install_service ;;
  nohup)      start_nohup ;;
esac

IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
log "آدرس اپ: http://${IP:-<server-ip>}:$PORT"
if [ "$MODE" = "service" ]; then
  log "مدیریت سرویس: systemctl {status|restart|stop} $SERVICE_NAME"
  log "مشاهده‌ی لاگ زنده: journalctl -u $SERVICE_NAME -f  (یا فایل $LOG_FILE)"
elif [ "$MODE" = "nohup" ]; then
  log "توقف اپ: kill \$(cat $PID_FILE)"
  log "مشاهده‌ی لاگ: tail -f $LOG_FILE"
fi
