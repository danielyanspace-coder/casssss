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
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx build-essential

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
# Копируем без .git и локальных данных: на сервере нужен только рабочий код.
#
# Отдельно исключаются присланные исходники картинок (assets-src): это 235 МБ
# больших PNG, из которых уже собраны webp в public/assets. Серверу они не
# нужны ни для чего - нужны только при перегенерации картинок, а её делают на
# своей машине.
rsync -a --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'data' --exclude 'dist' \
  --exclude 'assets-src' --exclude 'android-gateway' \
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
  echo "    ЗАПОЛНИТЕ РУКАМИ ключи по списку deploy/SECRETS.md (RESEND_API_KEY, BEELINE_PHONE и другие)."
else
  echo "    .env уже есть, не трогаю."
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

echo "==> Службы"
cp "$APP_DIR"/deploy/luckybox.service "$APP_DIR"/deploy/luckybox-bot.service \
   "$APP_DIR"/deploy/luckybox-backup.service "$APP_DIR"/deploy/luckybox-backup.timer \
   /etc/systemd/system/
systemctl daemon-reload
systemctl enable luckybox luckybox-bot luckybox-backup.timer

echo "==> nginx"
sed "s/ваш-домен\.ru/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/luckybox

# Конфиг слушает и IPv4, и IPv6. Если на машине IPv6 выключен, nginx не просто
# пропустит эти строки, а откажется стартовать: «socket() [::]:80 failed».
# Проверяем и убираем их, иначе установка падает на ровном месте, а причина
# выглядит как поломка nginx.
if [ ! -f /proc/net/if_inet6 ]; then
  echo "    IPv6 на машине нет - убираю строки listen [::]"
  sed -i '/listen \[::\]/d' /etc/nginx/sites-available/luckybox
fi
ln -sf /etc/nginx/sites-available/luckybox /etc/nginx/sites-enabled/luckybox
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Сертификат"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || {
  echo "    Certbot не отработал. Проверьте, что домен $DOMAIN указывает на этот сервер,"
  echo "    и повторите: sudo certbot --nginx -d $DOMAIN"
}

cat <<EOF

======================================================================
Установка закончена. Осталось:

1. Заполнить $APP_DIR/.env ключами по списку deploy/SECRETS.md:
     RESEND_API_KEY  - письма (сброс пароля)
     BEELINE_PHONE   - номер для приёма платежей
     SICILIA_*, HELEKET_*, DATABETRIX_* - кассы и казино
     TELEGRAM_TOKEN, TELEGRAM_BOT_USERNAME - вход через Telegram и бот
   DEV_MODE обязан остаться false.

   ГЛАВНЫЙ АДМИН: $(grep '^ADMIN_EMAILS=' "$APP_DIR/.env" | cut -d= -f2-)
   Зарегистрируйтесь на сайте этой почтой - аккаунт сразу станет владельцем
   панели. Сменить владельца - строка ADMIN_EMAILS в $APP_DIR/.env.

2. Запустить:
     sudo systemctl start luckybox luckybox-bot
     sudo systemctl start luckybox-backup

3. Проверить:
     curl -sf https://$DOMAIN/api/config > /dev/null && echo "сервер отвечает"
     systemctl status luckybox luckybox-bot
     journalctl -u luckybox -f

4. СОХРАНИТЬ PAYOUT_DATA_KEY из .env в другое место.
   Без него номера карт из резервной копии не расшифровать.
======================================================================
EOF
