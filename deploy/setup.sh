#!/usr/bin/env bash
#
# Настройка сервера одной командой и отчёт другой.
#
#   1) запуск (ключи передаются в окружении, в репозитории их нет):
#      curl -fsSL <raw>/deploy/setup.sh -o /root/lb-setup.sh
#      DUCKDNS_TOKEN=... SICILIA_API_KEY=... bash /root/lb-setup.sh   (от root)
#   2) в любое время потом:
#      luckybox-report
#
# Скрипт сразу уходит в фон и не зависит от SSH: закрыли терминал, уснул
# телефон - работа идёт. Что он делает, по порядку:
#   - вписывает переданные ключи в .env (прежний .env остаётся копией рядом);
#   - выкатывает свежий код (deploy/update.sh);
#   - направляет домены DuckDNS на сервер, выпускает сертификаты;
#     главный домен - сайт, остальные - переадресация на него;
#   - перезапускает службы и проверяет всё снаружи;
#   - пишет отчёт: адреса для чужих кабинетов, IP для белых списков, что
#     работает и чего не хватает.
#
# Переменные (все необязательные, пустые не трогают .env):
#   MAIN_DOMAIN        главный домен сайта
#   EXTRA_DOMAINS      дополнительные домены через пробел (переадресация)
#   DUCKDNS_TOKEN  SICILIA_API_KEY  SICILIA_MERCHANT  SICILIA_LOGIN
#   DATABETRIX_AGENT_NAME  DATABETRIX_AGENT_TOKEN
#   TELEGRAM_TOKEN     бот с промокодами (ник берётся у Telegram сам)
#   SICILIA_IPS        адреса Sicilia для белого списка колбэков (дописываются)
set -uo pipefail

APP_DIR=/srv/luckybox
ENV_FILE="$APP_DIR/.env"
LOG=/root/luckybox-setup.log
REPORT=/root/luckybox-report.txt
STATE=/root/luckybox-setup.state
SELF="$(readlink -f "$0")"
MAIN_DOMAIN="${MAIN_DOMAIN:-}"
EXTRA_DOMAINS="${EXTRA_DOMAINS:-}"
# Сколько ждать, пока DuckDNS разошлёт новый адрес домена.
DNS_WAIT_SEC=180

[ "$(id -u)" -eq 0 ] || { echo "Нужен root: sudo -i, потом команду заново"; exit 1; }

# Команда отчёта. Ставится при первом запуске, работает и пока настройка идёт.
install_report_cmd() {
  cat > /usr/local/bin/luckybox-report <<EOF
#!/usr/bin/env bash
echo "Состояние: \$(cat $STATE 2>/dev/null || echo 'настройка не запускалась')"
echo
if [ -f $REPORT ] && ! grep -q '^идёт' $STATE 2>/dev/null; then cat $REPORT
else echo "Последние строки журнала ($LOG):"; tail -n 15 $LOG 2>/dev/null; fi
EOF
  chmod 755 /usr/local/bin/luckybox-report
}

# ---------- Первый запуск: уходим в фон ----------
if [ -z "${LB_SETUP_CHILD:-}" ]; then
  [ -d "$APP_DIR" ] || { echo "Нет $APP_DIR: сначала установка (deploy/LAUNCH.md)"; exit 1; }
  # Занятая блокировка - значит, фоновая копия ещё работает.
  if ! flock -n /run/luckybox-setup.lock true; then
    echo "Настройка уже идёт. Посмотреть: luckybox-report"; exit 0
  fi
  install_report_cmd
  echo "идёт: старт" > "$STATE"
  LB_SETUP_CHILD=1 setsid nohup bash "$SELF" > "$LOG" 2>&1 < /dev/null &
  echo
  echo "Настройка запущена в фоне, займёт 5-15 минут. Терминал можно закрыть."
  echo "Итог в любое время:   luckybox-report"
  echo
  exit 0
fi

# ---------- Дальше работает фоновая копия ----------
exec 9>/run/luckybox-setup.lock
flock -n 9 || { echo "Вторая копия настройки, выходим"; exit 0; }

step() { echo "идёт: $1" > "$STATE"; echo; echo "==> $1 ($(date '+%H:%M:%S'))"; }
OK=(); BAD=(); TODO=()
ok()   { OK+=("$1"); echo "    OK: $1"; }
bad()  { BAD+=("$1"); echo "    НЕТ: $1"; }
todo() { TODO+=("$1"); }

env_get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- ; }
# Значение через ENVIRON, а не подстановкой в программу awk: в ключах бывают
# / | & и кавычки. Через cat >, чтобы у .env остались хозяин и права.
env_set() {
  local key="$1"
  KEY="$key" VAL="$2" awk 'BEGIN{k=ENVIRON["KEY"]; v=ENVIRON["VAL"]; done=0}
    index($0, k "=") == 1 { if (!done) print k "=" v; done=1; next } { print }
    END { if (!done) print k "=" v }' "$ENV_FILE" > "$ENV_FILE.tmp" && cat "$ENV_FILE.tmp" > "$ENV_FILE"
  rm -f "$ENV_FILE.tmp"
}

# ---------- 1. Ключи ----------
step "ключи в .env"
cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
for k in DUCKDNS_TOKEN SICILIA_API_KEY SICILIA_MERCHANT SICILIA_LOGIN DATABETRIX_AGENT_NAME DATABETRIX_AGENT_TOKEN; do
  v="${!k:-}"
  if [ -n "$v" ]; then env_set "$k" "$v"; echo "    $k вписан"; fi
done
if [ -n "${TELEGRAM_TOKEN:-}" ]; then
  if [ "$TELEGRAM_TOKEN" = "$(env_get OPS_BOT_TOKEN)" ]; then
    bad "TELEGRAM_TOKEN совпадает со служебным ботом - не вписан"
  else
    ME="$(curl -fsS --max-time 15 "https://api.telegram.org/bot$TELEGRAM_TOKEN/getMe" || true)"
    BOT_USER="$(printf '%s' "$ME" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')"
    if [ -n "$BOT_USER" ]; then
      env_set TELEGRAM_TOKEN "$TELEGRAM_TOKEN"
      env_set TELEGRAM_BOT_USERNAME "$BOT_USER"
      env_set PROJECT_BOT_USERNAME "$BOT_USER"
      ok "бот @$BOT_USER принял токен"
    else
      bad "Telegram не принял токен бота с промокодами"
    fi
  fi
fi
# Адрес Sicilia в белом списке колбэков: дописываем, прежние адреса не
# трогаем. С чужого адреса колбэк получает 403 (деньги всё равно зачислит
# сверка раз в 5 минут, но с задержкой).
SICILIA_IPS="${SICILIA_IPS:-91.206.228.46}"
cur="$(env_get SICILIA_CALLBACK_IPS)"
for ip in ${SICILIA_IPS//,/ }; do
  case ",$cur," in *",$ip,"*) ;; *) cur="${cur:+$cur,}$ip" ;; esac
done
env_set SICILIA_CALLBACK_IPS "$cur"
echo "    SICILIA_CALLBACK_IPS=$cur"
[ "$(env_get DEV_MODE)" = "true" ] && { env_set DEV_MODE false; echo "    DEV_MODE выключен"; }

# ---------- 2. Код ----------
step "выкат свежего кода"
if bash "$APP_DIR/deploy/update.sh"; then ok "код обновлён"; else bad "выкат кода упал - см. $LOG"; fi

# ---------- 3. Домены ----------
[ -n "$MAIN_DOMAIN" ] || MAIN_DOMAIN="$(env_get SITE_URL | sed -e 's#^https\?://##' -e 's#/.*$##')"
MY_IP="$(curl -fsS4 --max-time 10 https://api.ipify.org || true)"
TOKEN="$(env_get DUCKDNS_TOKEN)"

wait_dns() {
  local d="$1" r=""
  for _ in $(seq 1 $((DNS_WAIT_SEC / 10))); do
    r="$(getent ahostsv4 "$d" | awk '{print $1; exit}' || true)"
    [ -n "$r" ] && { [ -z "$MY_IP" ] || [ "$r" = "$MY_IP" ]; } && return 0
    sleep 10
  done
  return 1
}

step "DuckDNS"
if [ -n "$TOKEN" ]; then
  for d in $MAIN_DOMAIN $EXTRA_DOMAINS; do
    case "$d" in *.duckdns.org) ;; *) continue ;; esac
    sub="${d%.duckdns.org}"; sub="${sub##*.}"
    r="$(curl -fsS --max-time 15 "https://www.duckdns.org/update?domains=$sub&token=$TOKEN&ip=" || echo FAIL)"
    [ "$r" = "OK" ] && ok "DuckDNS: $d указывает на сервер" || bad "DuckDNS не принял $d (ответ $r): поддомен заведён под этим токеном?"
  done
else
  todo "DUCKDNS_TOKEN не задан: домены на duckdns.org направить вручную"
fi

step "сертификаты дополнительных доменов"
mkdir -p /var/www/html "$APP_DIR/data"
touch "$APP_DIR/data/old-domains"
for d in $EXTRA_DOMAINS; do
  if ! wait_dns "$d"; then bad "$d не указывает на сервер ($MY_IP) - сертификат не выпущен"; continue; fi
  if [ ! -f "/etc/letsencrypt/live/$d/fullchain.pem" ]; then
    # Временный блок на 80 порту ровно под этот домен - как в domain.sh.
    cat > /etc/nginx/sites-enabled/luckybox-acme-extra <<NGINX
server {
    listen 80;
    server_name $d;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 404; }
}
NGINX
    nginx -t && systemctl reload nginx
    certbot certonly --webroot -w /var/www/html -d "$d" --non-interactive --agree-tos \
      --register-unsafely-without-email --deploy-hook "systemctl reload nginx" || true
    rm -f /etc/nginx/sites-enabled/luckybox-acme-extra
    systemctl reload nginx
  fi
  if [ -f "/etc/letsencrypt/live/$d/fullchain.pem" ]; then
    grep -qx "$d" "$APP_DIR/data/old-domains" || echo "$d" >> "$APP_DIR/data/old-domains"
    ok "сертификат $d"
  else
    bad "сертификат $d не выпущен - см. $LOG"
  fi
done

step "главный домен $MAIN_DOMAIN: сертификат, nginx, SITE_URL"
if [ -n "$MAIN_DOMAIN" ] && bash "$APP_DIR/deploy/domain.sh" "$MAIN_DOMAIN" --rebuild; then
  ok "домен $MAIN_DOMAIN настроен"
else
  bad "домен $MAIN_DOMAIN не настроен - см. $LOG"
fi

# ---------- 4. Службы ----------
step "перезапуск служб"
systemctl restart luckybox
sleep 2
systemctl restart luckybox-bot 2>/dev/null || true
sleep 6

# ---------- 5. Проверки ----------
step "проверка снаружи"
SITE="https://$MAIN_DOMAIN"
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@"; }

[ "$(code "$SITE/api/health")" = "200" ] && ok "сайт открывается: $SITE" || bad "сайт $SITE не отвечает по https"
for d in $EXTRA_DOMAINS; do
  loc="$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 15 "https://$d/")"
  case "$loc" in "$SITE"*) ok "https://$d переадресует на сайт" ;; *) bad "https://$d не переадресует (ответ: ${loc:-нет})" ;; esac
done
w="$(code -X POST -H 'Content-Type: application/json' -d '{}' "$SITE/api/casino/wallet")"
[ "$w" != "000" ] && [ "$w" != "502" ] && [ "$w" != "404" ] && ok "кошелёк казино доступен снаружи (HTTP $w)" || bad "кошелёк казино не отвечает (HTTP $w)"
s="$(code -X POST -H 'Content-Type: application/json' -d '{}' "$SITE/api/webhooks/sicilia")"
[ "$s" != "000" ] && [ "$s" != "502" ] && [ "$s" != "404" ] && ok "колбэк Sicilia доступен снаружи (HTTP $s)" || bad "колбэк Sicilia не отвечает (HTTP $s)"

systemctl is-active --quiet luckybox && ok "служба сайта работает" || bad "служба сайта не работает: journalctl -u luckybox -n 50"
if [ -n "$(env_get TELEGRAM_TOKEN)" ]; then
  systemctl is-active --quiet luckybox-bot && ok "бот с промокодами запущен" || bad "бот не запущен: journalctl -u luckybox-bot -n 30"
fi
OPS="$(env_get OPS_BOT_TOKEN)"
if [ -n "$OPS" ]; then
  curl -fsS --max-time 15 "https://api.telegram.org/bot$OPS/getMe" | grep -q '"ok":true' && ok "служебный бот на месте" || bad "служебный бот: Telegram не принял OPS_BOT_TOKEN"
fi

# Sicilia: настоящий запрос баланса мерчанта. Отказ 403 значит, что адрес
# сервера не в их белом списке.
SIC=""
if [ -n "$(env_get SICILIA_API_KEY)" ] && [ -n "$(env_get SICILIA_MERCHANT)" ] && [ -n "$(env_get SICILIA_LOGIN)" ]; then
  SIC="$(cd "$APP_DIR" && timeout 40 sudo -u luckybox node -e "
    import('dotenv/config').then(() => import('./server/sicilia.js')).then(async (m) => {
      try { const r = await m.merchantBalance(); console.log('ok', JSON.stringify(r).slice(0, 200)); }
      catch (e) { console.log('err', e.status || '', String(e.message || e).slice(0, 200)); }
      process.exit(0);
    });" 2>&1 | tail -1)"
  case "$SIC" in ok*) ok "Sicilia отвечает: ${SIC#ok }" ;; *) bad "Sicilia: ${SIC:-нет ответа}" ;; esac
else
  todo "Sicilia: вписать SICILIA_MERCHANT и SICILIA_LOGIN (из кабинета merchant.sicilia.ink) - без них касса СБП не включится"
fi
[ -n "$(env_get DATABETRIX_AGENT_TOKEN)" ] || todo "Databetrix: не вписан ключ агента"
todo "Databetrix: пополнить баланс агента в кабинете (Top up) - без него игры казино не запускаются"

# ---------- 6. Отчёт ----------
{
  echo "LUCKYBOX - итог настройки, $(date '+%d.%m.%Y %H:%M')"
  echo "=================================================================="
  echo
  echo "Сайт:          $SITE"
  echo "Админка:       $SITE/admin"
  echo "Партнёры:      $SITE/partners"
  for d in $EXTRA_DOMAINS; do echo "Доп. домен:    https://$d  -> переадресация на сайт"; done
  echo "IP сервера:    ${MY_IP:-не определился}"
  echo
  echo "ВПИСАТЬ В ЧУЖИЕ КАБИНЕТЫ"
  echo "  Sicilia      колбэк (callback URL):  $SITE/api/webhooks/sicilia"
  echo "               их адреса у нас в белом списке: $(env_get SICILIA_CALLBACK_IPS)"
  echo "               IP для белого списка:   ${MY_IP:-?}"
  echo "  Databetrix   кошелёк:                $SITE/api/casino/wallet"
  echo "  Heleket      вебхук:                 $SITE/api/webhooks/heleket"
  [ -n "${BOT_USER:-}" ] && echo "  @BotFather   /setdomain для @$BOT_USER:  $MAIN_DOMAIN  (кнопка «Войти через Telegram»)"
  echo
  echo "РАБОТАЕТ"
  for x in "${OK[@]}"; do echo "  + $x"; done
  if [ "${#BAD[@]}" -gt 0 ]; then
    echo; echo "НЕ РАБОТАЕТ"
    for x in "${BAD[@]}"; do echo "  - $x"; done
  fi
  if [ "${#TODO[@]}" -gt 0 ]; then
    echo; echo "ОСТАЛОСЬ СДЕЛАТЬ"
    for x in "${TODO[@]}"; do echo "  * $x"; done
  fi
  echo
  echo "Ключи в .env (только есть/нет, без значений):"
  for k in SITE_URL DUCKDNS_TOKEN TELEGRAM_TOKEN OPS_BOT_TOKEN OPS_OWNER_CHAT_ID ADMIN_EMAILS SICILIA_MERCHANT SICILIA_LOGIN SICILIA_API_KEY \
           DATABETRIX_AGENT_NAME DATABETRIX_AGENT_TOKEN HELEKET_MERCHANT HELEKET_API_KEY PAYOUT_DATA_KEY RESEND_API_KEY; do
    [ -n "$(env_get "$k")" ] && echo "  $k: есть" || echo "  $k: НЕТ"
  done
  echo
  echo "Полный журнал: $LOG"
} > "$REPORT"
chmod 600 "$REPORT" "$LOG"

if [ "${#BAD[@]}" -gt 0 ]; then echo "готово с ошибками: ${#BAD[@]}" > "$STATE"; else echo "готово" > "$STATE"; fi
echo; cat "$REPORT"
