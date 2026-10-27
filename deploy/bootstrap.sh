#!/usr/bin/env bash
#
# Развёртывание LUCKYBOX на чистом сервере одной командой.
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/danielyanspace-coder/casssss/claude/github-text-document-aja1hm/deploy/bootstrap.sh)
#
# Именно «bash <(curl ...)», а не «curl ... | bash»: скрипт задаёт вопросы, и
# при конвейере клавиатура была бы занята самим скриптом.
#
# Что делает, по шагам, с проверкой после каждого:
#   1. Проверяет сервер: root, Ubuntu/Debian, память, диск, внешний IP.
#   2. Спрашивает домен и ключи. Ключи вводятся вслепую и никуда, кроме
#      /srv/luckybox/.env, не пишутся: ни в журнал, ни на экран.
#   3. Проверяет токен служебного бота у Telegram.
#   4. Направляет поддомен DuckDNS на сервер и ждёт, пока DNS это подхватит.
#   5. Брандмауэр: открыты только SSH, 80 и 443.
#   6. Скачивает проект и запускает deploy/install.sh (Node, nginx,
#      сертификат, службы).
#   7. Вписывает ключи в .env, запускает службы, проверяет сайт снаружи.
#   8. Печатает, что вписано, чего не хватает и что делать дальше.
#
# ОТКАТ. Ошибка на любом шаге после начала установки возвращает сервер как
# было: прежний конфиг nginx и .env, службы останавливаются, если до этого не
# работали. База (/srv/luckybox/data) не трогается никогда: при повторном
# запуске она остаётся как есть, а перед запуском уже работающего сайта
# снимается копия.
#
# Запускать повторно можно: уже вписанные ключи остаются, пустой ответ на
# вопрос ничего не меняет.
set -euo pipefail

REPO_URL=https://github.com/danielyanspace-coder/casssss.git
BRANCH=claude/github-text-document-aja1hm
SRC=/root/casssss
APP_DIR=/srv/luckybox
ENV_FILE=$APP_DIR/.env
NGINX_CONF=/etc/nginx/sites-available/luckybox
LOG=/var/log/luckybox-setup.log
# Сколько ждать, пока DuckDNS разнесёт новый адрес: обычно минута.
DNS_WAIT_SEC=300
# Сколько ждать, пока сервер поднимется после запуска служб.
HEALTH_WAIT_SEC=60
OPS_BOT_NAME=luckyspec_bot
GAME_BOT_NAME=luckybox_bot

C_OK=$'\e[32m'; C_ERR=$'\e[31m'; C_WARN=$'\e[33m'; C_B=$'\e[1m'; C_0=$'\e[0m'
step() { echo; echo "${C_B}==> $*${C_0}"; }
ok()   { echo "    ${C_OK}✓${C_0} $*"; }
warn() { echo "    ${C_WARN}!${C_0} $*"; }
die()  { echo; echo "${C_ERR}${C_B}ОШИБКА:${C_0} $*"; exit 1; }

# Ввод с клавиатуры, даже если скрипт пришёл конвейером.
ask() {        # ask ПЕРЕМЕННАЯ "Вопрос" [по умолчанию]
  local __v; read -r -p "    $2${3:+ [$3]}: " __v </dev/tty || true
  printf -v "$1" '%s' "${__v:-${3:-}}"
}
ask_secret() { # ввод не виден на экране
  local __v; read -r -s -p "    $2 (Enter - пропустить): " __v </dev/tty || true; echo
  printf -v "$1" '%s' "$__v"
}

[ "$(id -u)" -eq 0 ] || die "Нужен root. Зайдите как root или выполните: sudo -i, и повторите команду."
# Журнал установки без ключей: ключи читаются read -s и в вывод не попадают.
exec > >(tee -a "$LOG") 2>&1
echo "Журнал установки: $LOG ($(date '+%F %T'))"

# ---------------------------------------------------------------------------
# Откат
# ---------------------------------------------------------------------------
BACKUP_DIR=""
INSTALL_STARTED=0
WAS_RUNNING=0
# На выходе, а не на ERR: die() завершает скрипт через exit, а exit ловушку
# ERR не вызывает. Успешный конец снимает флаг, и откат молчит.
rollback() {
  local code=$?
  [ "$code" -ne 0 ] && [ "$INSTALL_STARTED" = 1 ] || exit "$code"
  echo
  echo "${C_ERR}${C_B}Установка прервалась, возвращаю сервер как было.${C_0}"
  if [ -n "$BACKUP_DIR" ] && [ -f "$BACKUP_DIR/nginx.conf" ]; then
    cp "$BACKUP_DIR/nginx.conf" "$NGINX_CONF"
    echo "    конфиг nginx возвращён"
  elif [ -n "$BACKUP_DIR" ] && [ ! -f "$BACKUP_DIR/nginx.conf" ]; then
    rm -f /etc/nginx/sites-enabled/luckybox "$NGINX_CONF"
    [ -f /etc/nginx/sites-available/default ] && ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
    echo "    конфиг nginx проекта убран"
  fi
  if command -v nginx >/dev/null && nginx -t >/dev/null 2>&1; then systemctl reload nginx 2>/dev/null || true; fi
  if [ -n "$BACKUP_DIR" ] && [ -f "$BACKUP_DIR/env" ]; then
    cp "$BACKUP_DIR/env" "$ENV_FILE"; chmod 600 "$ENV_FILE"
    echo "    .env возвращён"
  fi
  if [ "$WAS_RUNNING" = 1 ]; then
    systemctl restart luckybox luckybox-bot 2>/dev/null || true
    echo "    прежняя версия сайта снова запущена"
  else
    systemctl stop luckybox luckybox-bot 2>/dev/null || true
    echo "    службы остановлены"
  fi
  echo
  echo "База не тронута. Что случилось - в журнале $LOG"
  echo "Последние строки журнала сервера:"
  journalctl -u luckybox -n 25 --no-pager 2>/dev/null || true
  echo
  echo "Исправьте причину (чаще всего - домен не указывает на сервер) и запустите команду снова."
  exit "$code"
}
trap rollback EXIT

# ---------------------------------------------------------------------------
# 1. Сервер
# ---------------------------------------------------------------------------
step "1/8 Проверка сервера"
. /etc/os-release 2>/dev/null || true
case "${ID:-}" in
  ubuntu|debian) ok "Система: ${PRETTY_NAME:-$ID}" ;;
  *) die "Нужна Ubuntu 22.04/24.04 или Debian, а здесь ${PRETTY_NAME:-неизвестная система}." ;;
esac
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
DISK_GB=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
[ "$MEM_MB" -ge 1800 ] && ok "Память: ${MEM_MB} МБ" || warn "Памяти ${MEM_MB} МБ, рекомендуется от 2 ГБ: будет тесно."
[ "$DISK_GB" -ge 10 ] && ok "Свободно на диске: ${DISK_GB} ГБ" || die "Свободно ${DISK_GB} ГБ, нужно хотя бы 10."
apt-get update -qq
apt-get install -y -qq curl git ufw dnsutils ca-certificates >/dev/null
MY_IP=$(curl -fsS4 --max-time 10 https://api.ipify.org || true)
[ -n "$MY_IP" ] && ok "Внешний IP сервера: $MY_IP" || die "Не удалось узнать внешний IP: у сервера нет выхода в интернет?"

# ---------------------------------------------------------------------------
# 2. Вопросы
# ---------------------------------------------------------------------------
step "2/8 Домен и ключи"
existing() { [ -f "$ENV_FILE" ] && grep -E "^$1=.+" "$ENV_FILE" >/dev/null 2>&1; }
CUR_DOMAIN=""
[ -f "$ENV_FILE" ] && CUR_DOMAIN=$(grep '^SITE_URL=' "$ENV_FILE" | cut -d= -f2- | sed -e 's#^https\?://##' -e 's#/.*##' || true)
[ "$CUR_DOMAIN" = "example.com" ] && CUR_DOMAIN=""
echo "    Домен, на котором будет сайт, например luckybox.duckdns.org"
ask DOMAIN "Домен" "$CUR_DOMAIN"
DOMAIN=$(echo "$DOMAIN" | tr 'A-Z' 'a-z' | sed -e 's#^https\?://##' -e 's#/.*$##' -e 's/ //g')
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || die "«$DOMAIN» не похоже на домен."

echo
echo "    Дальше ключи. Ввод не виден на экране - это нормально. Вставка: правая кнопка мыши."
echo "    Нет ключа под рукой - просто Enter, впишете потом: nano $ENV_FILE"
declare -A KEYS=()
want() {       # want ПЕРЕМЕННАЯ "Что это"
  if existing "$1"; then ok "$1 уже вписан, оставляю"; return; fi
  local v; ask_secret v "$2"
  [ -n "$v" ] && KEYS[$1]="$v"
  return 0
}
if [[ "$DOMAIN" == *.duckdns.org ]]; then want DUCKDNS_TOKEN "Токен DuckDNS (duckdns.org, вверху страницы)"; fi
want OPS_BOT_TOKEN "Токен служебного бота @$OPS_BOT_NAME (@BotFather -> /mybots)"
echo "    Ключи для денег и казино (можно пропустить и вписать позже):"
want SICILIA_MERCHANT "Sicilia: ID мерчанта"
want SICILIA_LOGIN "Sicilia: логин для подписи"
want SICILIA_API_KEY "Sicilia: API-ключ"
want DATABETRIX_AGENT_NAME "Databetrix: имя агента"
want DATABETRIX_AGENT_TOKEN "Databetrix: токен агента"
want RESEND_API_KEY "Resend: ключ для писем сброса пароля"
want TELEGRAM_TOKEN "Токен игрового бота @$GAME_BOT_NAME"

# ---------------------------------------------------------------------------
# 3. Проверка ключей, которые можно проверить до установки
# ---------------------------------------------------------------------------
step "3/8 Проверка ключей"
tg_name() { { curl -fsS --max-time 10 "https://api.telegram.org/bot$1/getMe" 2>/dev/null || true; } | sed -n 's/.*"username":"\([^"]*\)".*/\1/p'; }
if [ -n "${KEYS[OPS_BOT_TOKEN]:-}" ]; then
  N=$(tg_name "${KEYS[OPS_BOT_TOKEN]}")
  [ -n "$N" ] || die "Telegram не принял токен служебного бота. Проверьте, что скопирован целиком."
  [ "$N" = "$OPS_BOT_NAME" ] && ok "Служебный бот: @$N" || warn "Токен от бота @$N, а ждали @$OPS_BOT_NAME. Оставляю, но проверьте."
fi
if [ -n "${KEYS[TELEGRAM_TOKEN]:-}" ]; then
  N=$(tg_name "${KEYS[TELEGRAM_TOKEN]}")
  [ -n "$N" ] || die "Telegram не принял токен игрового бота."
  ok "Игровой бот: @$N"
  KEYS[TELEGRAM_BOT_USERNAME]="$N"
fi
# Два процесса на одном токене Telegram не пускает: подтверждения входа в
# панель перестали бы доходить.
if [ -n "${KEYS[OPS_BOT_TOKEN]:-}" ] && [ "${KEYS[OPS_BOT_TOKEN]:-}" = "${KEYS[TELEGRAM_TOKEN]:-x}" ]; then
  die "Служебный и игровой бот должны быть РАЗНЫМИ ботами с разными токенами."
fi
[ ${#KEYS[@]} -gt 0 ] || ok "Новых ключей нет"

# ---------------------------------------------------------------------------
# 4. Домен
# ---------------------------------------------------------------------------
step "4/8 Домен $DOMAIN"
DTOKEN="${KEYS[DUCKDNS_TOKEN]:-}"
[ -z "$DTOKEN" ] && existing DUCKDNS_TOKEN && DTOKEN=$(grep '^DUCKDNS_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
if [[ "$DOMAIN" == *.duckdns.org ]] && [ -n "$DTOKEN" ]; then
  SUB=${DOMAIN%.duckdns.org}; SUB=${SUB##*.}
  R=$(curl -fsS --max-time 15 "https://www.duckdns.org/update?domains=$SUB&token=$DTOKEN&ip=$MY_IP" || echo FAIL)
  [ "$R" = "OK" ] || die "DuckDNS ответил «$R». Поддомен «$SUB» заведён на duckdns.org под этим токеном?"
  ok "DuckDNS: $SUB.duckdns.org -> $MY_IP"
fi
echo "    Жду, пока $DOMAIN укажет на $MY_IP (до $((DNS_WAIT_SEC / 60)) мин)..."
RESOLVED=""
for _ in $(seq 1 $((DNS_WAIT_SEC / 10))); do
  RESOLVED=$(dig +short A "$DOMAIN" @1.1.1.1 2>/dev/null | tail -1 || true)
  [ "$RESOLVED" = "$MY_IP" ] && break
  sleep 10
done
[ "$RESOLVED" = "$MY_IP" ] || die "$DOMAIN указывает на «${RESOLVED:-никуда}», а сервер $MY_IP. На duckdns.org впишите IP $MY_IP в поле current ip и нажмите update ip, потом запустите команду снова."
ok "$DOMAIN указывает на этот сервер"

# ---------------------------------------------------------------------------
# 5. Брандмауэр
# ---------------------------------------------------------------------------
step "5/8 Брандмауэр"
# SSH открывается ДО включения: иначе текущее соединение оборвалось бы.
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ok "Открыты только SSH, 80 и 443"

# ---------------------------------------------------------------------------
# 6. Установка
# ---------------------------------------------------------------------------
step "6/8 Установка проекта (5-10 минут)"
BACKUP_DIR=$(mktemp -d /root/luckybox-before-setup.XXXX)
[ -f "$NGINX_CONF" ] && cp "$NGINX_CONF" "$BACKUP_DIR/nginx.conf"
[ -f "$ENV_FILE" ] && cp "$ENV_FILE" "$BACKUP_DIR/env"
systemctl is-active --quiet luckybox 2>/dev/null && WAS_RUNNING=1
if [ "$WAS_RUNNING" = 1 ] && [ -f "$APP_DIR/data/app.db" ]; then
  systemctl start luckybox-backup && ok "Копия базы перед обновлением снята"
fi
INSTALL_STARTED=1

if [ -d "$SRC/.git" ]; then
  git -C "$SRC" fetch -q origin "$BRANCH"
  git -C "$SRC" checkout -q "$BRANCH"
  git -C "$SRC" reset -q --hard "origin/$BRANCH"
  ok "Код обновлён в $SRC"
else
  rm -rf "$SRC"
  git clone -q -b "$BRANCH" "$REPO_URL" "$SRC"
  ok "Код скачан в $SRC"
fi
bash "$SRC/deploy/install.sh" "$DOMAIN"
[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] || die "Сертификат для $DOMAIN не выпустился."
ok "Сертификат выпущен, nginx настроен"
# install.sh не трогает уже существующий .env: при смене домена адрес надо
# поправить здесь.
sed -i "s|^SITE_URL=.*|SITE_URL=https://$DOMAIN|" "$ENV_FILE"

# ---------------------------------------------------------------------------
# 7. Ключи и запуск
# ---------------------------------------------------------------------------
step "7/8 Ключи и запуск"
# Значение подставляется через окружение awk, а не через sed: в ключах
# бывают / | & и прочее, что sed понял бы как свою команду.
env_set() {
  K="$1" V="$2" awk -v k="$1" 'BEGIN{FS=OFS="="; done=0}
    $1==k {print k "=" ENVIRON["V"]; done=1; next} {print}
    END{if(!done) print k "=" ENVIRON["V"]}' "$ENV_FILE" > "$ENV_FILE.tmp"
  cat "$ENV_FILE.tmp" > "$ENV_FILE"; rm -f "$ENV_FILE.tmp"
}
for k in "${!KEYS[@]}"; do env_set "$k" "${KEYS[$k]}"; ok "$k вписан"; done
grep -q '^DEV_MODE=false' "$ENV_FILE" || env_set DEV_MODE false
grep -q '^PAYOUT_DATA_KEY=.\+' "$ENV_FILE" || die "В .env нет PAYOUT_DATA_KEY - установщик должен был его создать."
chown luckybox:luckybox "$ENV_FILE"; chmod 600 "$ENV_FILE"
ok "DEV_MODE=false, у .env права 600"

systemctl daemon-reload
systemctl enable --now luckybox-backup.timer luckybox-watchdog.timer >/dev/null 2>&1
systemctl restart luckybox
systemctl restart luckybox-bot || warn "Игровой бот не запустился (без TELEGRAM_TOKEN это нормально)"
echo "    Жду, пока сервер поднимется..."
UP=""
for _ in $(seq 1 "$HEALTH_WAIT_SEC"); do
  curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null 2>&1 && { UP=1; break; }
  sleep 1
done
[ -n "$UP" ] || die "Сервер не поднялся за $HEALTH_WAIT_SEC секунд."
ok "Сервер отвечает"
curl -fsS --max-time 15 "https://$DOMAIN/api/health" >/dev/null || die "Сервер работает, но https://$DOMAIN снаружи не открывается."
ok "https://$DOMAIN открывается снаружи"
# Сервер слушает только себя: снаружи всё идёт через nginx.
if ss -ltn 2>/dev/null | grep -q '0.0.0.0:3000\|\*:3000'; then warn "Порт 3000 открыт наружу, проверьте HOST в .env"; else ok "Порт приложения закрыт снаружи"; fi

INSTALL_STARTED=0
rm -rf "$BACKUP_DIR"

# ---------------------------------------------------------------------------
# 8. Итог
# ---------------------------------------------------------------------------
step "8/8 Готово"
filled() { grep -E "^$1=.+" "$ENV_FILE" >/dev/null 2>&1; }
status() { if filled "$1"; then echo "    ${C_OK}✓${C_0} $1  $2"; else echo "    ${C_WARN}·${C_0} $1  $2 - НЕ ВПИСАН"; fi; }
cat <<EOF

    Сайт:              https://$DOMAIN
    Кабинет партнёров: https://$DOMAIN/partners/

${C_B}СОХРАНИТЕ ЭТОТ КЛЮЧ себе (менеджер паролей, заметка в телефоне):${C_0}
    PAYOUT_DATA_KEY=$(grep '^PAYOUT_DATA_KEY=' "$ENV_FILE" | cut -d= -f2-)
    Без него номера карт в заявках на вывод не расшифровать никогда. Не меняйте его.

${C_B}Что вписано в $ENV_FILE:${C_0}
EOF
status OPS_BOT_TOKEN "служебный бот: вход в админку и оповещения"
status DUCKDNS_TOKEN "смена домена одной командой"
status SICILIA_API_KEY "приём и выплаты по СБП и карте"
status DATABETRIX_AGENT_TOKEN "игры казино"
status RESEND_API_KEY "письма сброса пароля"
status TELEGRAM_TOKEN "вход через Telegram и напоминания"
status RCLONE_REMOTE "копии базы в облако"
cat <<EOF
    Вписать недостающее: nano $ENV_FILE, потом: systemctl restart luckybox luckybox-bot

${C_B}Сделайте сейчас:${C_0}
    1. В Telegram с аккаунта 8602356502 откройте @$OPS_BOT_NAME и нажмите Start.
    2. На https://$DOMAIN зарегистрируйтесь почтой $(grep '^ADMIN_EMAILS=' "$ENV_FILE" | cut -d= -f2-).
    3. Откройте админку и подтвердите вход в боте кнопкой «Это я».

${C_B}Адреса для кабинетов шлюзов:${C_0}
    Sicilia, колбэк:      https://$DOMAIN/api/webhooks/sicilia   (и пришлите им IP $MY_IP в белый список)
    Databetrix, кошелёк:  https://$DOMAIN/api/casino/wallet
    Heleket, вебхук:      https://$DOMAIN/api/webhooks/heleket

${C_B}Потом пригодится:${C_0}
    обновить проект:  sudo bash $APP_DIR/deploy/update.sh
    сменить домен:    sudo luckybox-domain новый.duckdns.org
    журнал сервера:   journalctl -u luckybox -n 50 --no-pager

Настоящие деньги - только после пробных платежей на 100-500 ₽ (deploy/LAUNCH.md, пункт 4).
EOF
