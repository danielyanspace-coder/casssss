#!/usr/bin/env bash
#
# Первичная установка LuckyBox на чистый Ubuntu/Debian.
#
# Что делает: заводит системного пользователя, кладёт проект в /srv/luckybox,
# ставит зависимости, регистрирует две службы и таймер копий, настраивает
# nginx и выпускает сертификат.
#
# Чего НЕ делает: не заполняет .env. Токен бота, домен, ID администраторов и
# ключ шифрования знаете только вы, и подставлять их скриптом - верный способ
# однажды закоммитить их в репозиторий.
#
# Запуск:  sudo bash deploy/install.sh ваш-домен.ru
set -euo pipefail

DOMAIN="${1:-}"
[ -z "$DOMAIN" ] && { echo "Использование: sudo bash deploy/install.sh ваш-домен.ru"; exit 1; }

APP_DIR=/srv/luckybox
APP_USER=luckybox
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Проверка прав"
[ "$(id -u)" -eq 0 ] || { echo "Нужен root: sudo bash deploy/install.sh $DOMAIN"; exit 1; }

echo "==> Системные пакеты"
apt-get update -qq
apt-get install -y -qq curl git rsync nginx certbot build-essential rclone

echo "==> Node.js 20"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

echo "==> Пользователь $APP_USER"
# Без домашнего каталога и без входа в систему: служебной учётке они не нужны,
# а через них чаще всего и заходят.
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"

echo "==> Файлы в $APP_DIR"
mkdir -p "$APP_DIR"
# Копируем без локальных данных. Папка .git едет вместе с кодом: по ней
# deploy/update.sh забирает новые версии (git pull), и без неё первый же
# выкат падал бы на «not a git repository».
#
# Отдельно исключаются присланные исходники картинок (assets-src): это 235 МБ
# больших PNG, из которых уже собраны webp в public/assets. Серверу они не
# нужны ни для чего - нужны только при перегенерации картинок, а её делают на
# своей машине.
rsync -a --delete \
  --exclude 'node_modules' --exclude 'data' --exclude 'dist' \
  --exclude 'assets-src' \
  "$SRC"/ "$APP_DIR"/
mkdir -p "$APP_DIR/data/backups"

echo "==> Зависимости"
cd "$APP_DIR"
npm ci --omit=dev

echo "==> .env"
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  # Ключ шифрования номеров карт генерируем сразу: забыть его создать - значит
  # получить отказ на первой же заявке по карте, и уже с живыми игроками.
  KEY=$(openssl rand -hex 32)
  sed -i "s|^PAYOUT_DATA_KEY=.*|PAYOUT_DATA_KEY=$KEY|" "$APP_DIR/.env"
  sed -i "s|^SITE_URL=.*|SITE_URL=https://$DOMAIN|" "$APP_DIR/.env"
  echo "    Создан $APP_DIR/.env, ключ выплат сгенерирован."
  echo "    ЗАПОЛНИТЕ РУКАМИ ключи по списку deploy/SECRETS.md (RESEND_API_KEY, SICILIA_*, DATABETRIX_* и другие)."
else
  echo "    .env уже есть, не трогаю."
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

echo "==> Службы"
cp "$APP_DIR"/deploy/luckybox.service "$APP_DIR"/deploy/luckybox-bot.service \
   "$APP_DIR"/deploy/luckybox-backup.service "$APP_DIR"/deploy/luckybox-backup.timer \
   "$APP_DIR"/deploy/luckybox-watchdog.service "$APP_DIR"/deploy/luckybox-watchdog.timer \
   /etc/systemd/system/
systemctl daemon-reload
systemctl enable luckybox luckybox-bot luckybox-backup.timer luckybox-watchdog.timer

echo "==> nginx и сертификат"
# Два шага. Полный конфиг слушает 443 с сертификатом, и без сертификата nginx
# его не примет вовсе. Поэтому сначала временный конфиг только на 80 порту,
# через него certbot подтверждает домен (webroot), и уже потом полный.
CONF=/etc/nginx/sites-available/luckybox
CERT=/etc/letsencrypt/live/$DOMAIN/fullchain.pem
mkdir -p /var/www/html
# Конфиг слушает и IPv4, и IPv6. Если на машине IPv6 выключен, nginx не просто
# пропустит эти строки, а откажется стартовать: «socket() [::]:80 failed».
strip_ipv6() { [ -f /proc/net/if_inet6 ] || sed -i '/listen \[::\]/d' "$1"; }

if [ ! -f "$CERT" ]; then
  cat > "$CONF" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 503; }
}
NGINX
  strip_ipv6 "$CONF"
  ln -sf "$CONF" /etc/nginx/sites-enabled/luckybox
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
  # Перевыпуск раз в два месяца делает таймер certbot сам; после него nginx
  # должен перечитать сертификат, иначе через 90 дней сайт откроется с ошибкой.
  certbot certonly --webroot -w /var/www/html -d "$DOMAIN" --non-interactive --agree-tos \
    --register-unsafely-without-email --deploy-hook "systemctl reload nginx" || true
fi

if [ -f "$CERT" ]; then
  sed "s/ваш-домен\.ru/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf" > "$CONF"
  strip_ipv6 "$CONF"
  ln -sf "$CONF" /etc/nginx/sites-enabled/luckybox
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
  echo "    Сертификат есть, сайт отдаётся по https."
else
  echo "    СЕРТИФИКАТ НЕ ВЫПУЩЕН. Проверьте, что домен $DOMAIN указывает на этот"
  echo "    сервер (A-запись), и запустите установку ещё раз: sudo bash deploy/install.sh $DOMAIN"
fi

cat <<EOF

======================================================================
Установка закончена. Осталось:

1. Заполнить $APP_DIR/.env ключами по списку deploy/SECRETS.md:
     RESEND_API_KEY  - письма (сброс пароля)
     SICILIA_*, HELEKET_*, DATABETRIX_* - кассы и казино
     TELEGRAM_TOKEN, TELEGRAM_BOT_USERNAME - вход через Telegram и бот
   DEV_MODE обязан остаться false.

   ГЛАВНЫЙ АДМИН: $(grep '^ADMIN_EMAILS=' "$APP_DIR/.env" | cut -d= -f2-)
   Зарегистрируйтесь на сайте этой почтой СРАЗУ после запуска - аккаунт станет
   владельцем панели, если в .env заданы OPS_BOT_TOKEN и OPS_OWNER_CHAT_ID
   (вход подтверждается в Telegram владельца). Без них почта прав не даёт:
   задайте владельца через ADMIN_TG_IDS. Сменить владельца - ADMIN_EMAILS.

2. Запустить:
     sudo systemctl start luckybox luckybox-bot
     sudo systemctl start luckybox-backup luckybox-backup.timer luckybox-watchdog.timer

3. Проверить:
     curl -sf https://$DOMAIN/api/config > /dev/null && echo "сервер отвечает"
     systemctl status luckybox luckybox-bot
     journalctl -u luckybox -f

4. СОХРАНИТЬ PAYOUT_DATA_KEY из .env в другое место.
   Без него номера карт из резервной копии не расшифровать.
======================================================================
EOF
