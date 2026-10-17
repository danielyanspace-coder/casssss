#!/usr/bin/env bash
#
# Выкат новой версии на уже работающий сервер.
#
# Порядок важен: сначала копия базы, потом код, потом перезапуск. Если что-то
# пойдёт не так на середине, копия свежая, а не вчерашняя.
#
# Запуск:  sudo bash /srv/luckybox/deploy/update.sh
set -euo pipefail

APP_DIR=/srv/luckybox
APP_USER=luckybox
BRANCH="${1:-claude/freespins-cases-logic-pa9pa1}"

[ "$(id -u)" -eq 0 ] || { echo "Нужен root"; exit 1; }

echo "==> Копия базы перед выкатом"
sudo -u "$APP_USER" env $(grep -v '^#' "$APP_DIR/.env" | xargs -d '\n') \
  node "$APP_DIR/deploy/backup.mjs"

echo "==> Свежий код ($BRANCH)"
cd "$APP_DIR"
git fetch --all
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Зависимости"
npm ci --omit=dev
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Проверка математики до перезапуска"
# Если решатель вероятностей не сходится, приложение всё равно упадёт при
# старте - лучше узнать об этом здесь, пока старая версия ещё работает.
sudo -u "$APP_USER" node "$APP_DIR/server/verify.js" > /dev/null

echo "==> Перезапуск"
systemctl restart luckybox
systemctl restart luckybox-bot

echo "==> Проверка"
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3000/api/config > /dev/null; then
    echo "Сервер отвечает. Выкат закончен."
    exit 0
  fi
  sleep 1
done

echo "Сервер не поднялся за 30 секунд. Логи:"
journalctl -u luckybox -n 50 --no-pager
exit 1
