#!/usr/bin/env bash
#
# Смена домена сайта одной командой.
#
#   sudo luckybox-domain новый-домен.duckdns.org
#   (то же самое: sudo bash /srv/luckybox/deploy/domain.sh новый-домен)
#   sudo luckybox-domain тот-же-домен --rebuild   - собрать заново
#
# Что делает, по порядку:
#   1. Для поддомена DuckDNS направляет его на этот сервер (нужен
#      DUCKDNS_TOKEN в .env; сам поддомен заводится на duckdns.org заранее).
#   2. Ждёт, пока домен начнёт указывать на этот сервер: сертификат без этого
#      не выпустить.
#   3. Выпускает сертификат Let's Encrypt на новый домен.
#   4. Собирает конфиг nginx заново из deploy/nginx.conf. Все прежние домены,
#      у которых есть сертификат, остаются живыми и отвечают переадресацией
#      на новый с тем же путём: старые ссылки партнёров (?promo=...) и
#      закладки игроков продолжают работать.
#   5. Меняет SITE_URL в .env и перезапускает службы.
#   6. Проверяет, что сайт отвечает по новому адресу.
#
# Ошибка на любом шаге до перезапуска ничего не ломает: старый конфиг nginx
# возвращается, .env не трогается.
#
# Чего скрипт сделать не может - адреса в чужих кабинетах. Их список он
# печатает в конце.
set -euo pipefail

APP_DIR=/srv/luckybox
ENV_FILE="$APP_DIR/.env"
CONF=/etc/nginx/sites-available/luckybox
ACME_CONF=/etc/nginx/sites-enabled/luckybox-acme
OLD_LIST="$APP_DIR/data/old-domains"
# Сколько ждать, пока DNS начнёт указывать на сервер: DuckDNS обычно
# успевает за минуту, регистраторы - дольше.
DNS_WAIT_SEC=180

NEW="${1:-}"
FORCE="${2:-}"
NEW="$(echo "$NEW" | tr 'A-Z' 'a-z' | sed -e 's#^https\?://##' -e 's#/.*$##')"

[ "$(id -u)" -eq 0 ] || { echo "Нужен root: sudo luckybox-domain $NEW"; exit 1; }
[[ "$NEW" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || {
  echo "Использование: sudo luckybox-domain новый-домен.duckdns.org"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Нет $ENV_FILE: сначала установка (deploy/install.sh)"; exit 1; }

OLD="$(grep '^SITE_URL=' "$ENV_FILE" | cut -d= -f2- | sed -e 's#^https\?://##' -e 's#/.*$##')"
# --rebuild: тот же домен, но собрать заново (сертификат, nginx, прежние
# домены). Нужен, когда SITE_URL уже вписан, а сертификата ещё нет, и когда
# добавился домен-переадресация (deploy/setup.sh).
if [ "$OLD" = "$NEW" ] && [ "$FORCE" != "--rebuild" ]; then echo "Сайт уже работает на $NEW"; exit 0; fi
echo "==> Смена домена: ${OLD:-нет} -> $NEW"

env_get() { grep "^$1=" "$ENV_FILE" | cut -d= -f2- || true; }

# --- 1. DuckDNS ---
if [[ "$NEW" == *.duckdns.org ]]; then
  TOKEN="$(env_get DUCKDNS_TOKEN)"
  if [ -n "$TOKEN" ]; then
    SUB="${NEW%.duckdns.org}"
    SUB="${SUB##*.}"
    # Пустой ip - DuckDNS берёт адрес, с которого пришёл запрос, то есть этот сервер.
    R="$(curl -fsS "https://www.duckdns.org/update?domains=$SUB&token=$TOKEN&ip=" || echo FAIL)"
    if [ "$R" = "OK" ]; then echo "    DuckDNS: $SUB указывает на этот сервер"
    else echo "    DuckDNS ответил «$R». Поддомен $SUB заведён на duckdns.org под этим токеном?"; exit 1; fi
  else
    echo "    DUCKDNS_TOKEN в .env не задан: направьте $NEW на IP сервера на duckdns.org сами"
  fi
fi

# --- 2. DNS ---
MY_IP="$(curl -fsS4 https://api.ipify.org || true)"
echo "==> Ждём, пока $NEW укажет на ${MY_IP:-этот сервер}"
ok=""
RESOLVED=""
for _ in $(seq 1 $((DNS_WAIT_SEC / 10))); do
  RESOLVED="$(getent ahostsv4 "$NEW" | awk '{print $1; exit}' || true)"
  if [ -n "$RESOLVED" ] && { [ -z "$MY_IP" ] || [ "$RESOLVED" = "$MY_IP" ]; }; then ok=1; break; fi
  sleep 10
done
if [ -z "$ok" ] && [ "$FORCE" != "--force" ]; then
  echo "    $NEW указывает на ${RESOLVED:-никуда}, а сервер ${MY_IP}. Сертификат не выпустить."
  echo "    Проверьте A-запись и запустите снова (или с --force, если сервер за прокси)."
  exit 1
fi

# --- 3. Сертификат ---
mkdir -p /var/www/html
CERT="/etc/letsencrypt/live/$NEW/fullchain.pem"
if [ ! -f "$CERT" ]; then
  echo "==> Сертификат для $NEW"
  # Временный блок на 80 порту ровно под новый домен: подтверждение не должно
  # зависеть от того, какой server_name сейчас в основном конфиге.
  cat > "$ACME_CONF" <<NGINX
server {
    listen 80;
    server_name $NEW;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 404; }
}
NGINX
  nginx -t && systemctl reload nginx
  certbot certonly --webroot -w /var/www/html -d "$NEW" --non-interactive --agree-tos \
    --register-unsafely-without-email --deploy-hook "systemctl reload nginx" || true
  rm -f "$ACME_CONF"
  systemctl reload nginx
  [ -f "$CERT" ] || { echo "    Сертификат не выпущен, сайт остался на $OLD"; exit 1; }
fi

# --- 4. nginx ---
echo "==> Конфиг nginx"
touch "$OLD_LIST"
if [ -n "$OLD" ] && [ "$OLD" != "$NEW" ] && ! grep -qx "$OLD" "$OLD_LIST"; then echo "$OLD" >> "$OLD_LIST"; fi
cp "$CONF" "$CONF.bak" 2>/dev/null || true
sed "s/ваш-домен\.ru/$NEW/g" "$APP_DIR/deploy/nginx.conf" > "$CONF"
OLD_WITH_CERT=""
while read -r d; do
  if [ -n "$d" ] && [ "$d" != "$NEW" ] && [ -f "/etc/letsencrypt/live/$d/fullchain.pem" ]; then
    OLD_WITH_CERT="$OLD_WITH_CERT $d"
  fi
done < "$OLD_LIST"
if [ -n "$OLD_WITH_CERT" ]; then
  # Прежние домены: 80 порт для продления их сертификатов и переадресация,
  # 443 - переадресация на новый адрес с тем же путём и параметрами.
  {
    echo ""
    echo "# Прежние домены сайта (deploy/domain.sh): переадресация на $NEW."
    echo "server {"
    echo "    listen 80;"
    echo "    listen [::]:80;"
    echo "    server_name$OLD_WITH_CERT;"
    echo "    location /.well-known/acme-challenge/ { root /var/www/html; }"
    echo "    location / { return 301 https://$NEW\$request_uri; }"
    echo "}"
    for d in $OLD_WITH_CERT; do
      echo "server {"
      echo "    listen 443 ssl http2;"
      echo "    listen [::]:443 ssl http2;"
      echo "    server_name $d;"
      echo "    ssl_certificate     /etc/letsencrypt/live/$d/fullchain.pem;"
      echo "    ssl_certificate_key /etc/letsencrypt/live/$d/privkey.pem;"
      echo "    return 301 https://$NEW\$request_uri;"
      echo "}"
    done
  } >> "$CONF"
fi
[ -f /proc/net/if_inet6 ] || sed -i '/listen \[::\]/d' "$CONF"
if ! nginx -t; then
  echo "    Конфиг не прошёл проверку, возвращаю прежний"
  [ -f "$CONF.bak" ] && cp "$CONF.bak" "$CONF" && systemctl reload nginx
  exit 1
fi

# --- 5. Приложение ---
echo "==> SITE_URL и перезапуск"
sed -i "s|^SITE_URL=.*|SITE_URL=https://$NEW|" "$ENV_FILE"
systemctl reload nginx
systemctl restart luckybox
systemctl restart luckybox-bot 2>/dev/null || true

# --- 6. Проверка ---
ok=""
for _ in $(seq 1 15); do
  if curl -fsS "https://$NEW/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ -n "$ok" ] && echo "    https://$NEW отвечает" || echo "    ВНИМАНИЕ: https://$NEW пока не отвечает, смотрите journalctl -u luckybox -n 50"

cat <<EOF

======================================================================
Сайт переехал на https://$NEW
Старые адреса: ${OLD_WITH_CERT:- нет}. Они переадресуют на новый.

Поменяйте адрес в чужих кабинетах - сам скрипт туда не дотянется:
  Sicilia      колбэк         https://$NEW/api/webhooks/sicilia
               (пока не поменяли, деньги не теряются: сверка раз в 5 минут
               спрашивает статусы сама, просто зачисление дольше)
  Databetrix   кошелёк        https://$NEW/api/casino/wallet
               (без этого ставки в казино не пройдут, менять сразу)
  Heleket      вебхук         https://$NEW/api/webhooks/heleket
  @BotFather   /setdomain     $NEW  (кнопка «Войти через Telegram»)
  UptimeRobot  монитор        https://$NEW/api/health
Партнёрам: ссылки со старым доменом работают, новые берутся в кабинете
https://$NEW/partners/ сами.
======================================================================
EOF
