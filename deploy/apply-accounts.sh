#!/usr/bin/env bash
set -Eeuo pipefail
BUNDLE=${1:-/root/luckybox-account-release}
APP=/srv/luckybox
BRANCH=claude/github-text-document-aja1hm
[ "$(id -u)" = 0 ] || { echo 'Нужен sudo'; exit 1; }
exec 8>/root/luckybox-quality-apply.lock
flock -n 8 || { echo 'Другая установка уже выполняется'; exit 1; }
GIT=(git -c "safe.directory=$APP" -C "$APP")
CHECK_ONLY=${CHECK_ONLY:-0}
[[ "$CHECK_ONLY" = 0 || "$CHECK_ONLY" = 1 ]] || { echo "CHECK_ONLY должен быть 0 или 1"; exit 1; }
BASE=$(cat "$BUNDLE/base.sha")
SOURCE=$(cat "$BUNDLE/source.sha")
verify_files() {
 python3 - "$BUNDLE" "$APP" "$1" <<'PY'
import hashlib,json,pathlib,sys
bundle,app=map(pathlib.Path,sys.argv[1:3]);version=sys.argv[3]
for f in json.loads((bundle/'manifest.json').read_text()):
 p=app/f['path'];h=hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
 if h!=f[version]: raise SystemExit('Файл изменился: '+f['path']+'; чужие изменения не перезаписаны')
PY
}
[ "$("${GIT[@]}" branch --show-current)" = "$BRANCH" ] || { echo 'Рабочая ветка сайта изменилась'; exit 1; }
LIVE=$("${GIT[@]}" rev-parse HEAD)
if [ "$LIVE" = "$SOURCE" ]; then verify_files after; echo 'Этот пакет уже установлен.'; exit 0; fi
[ "$LIVE" = "$BASE" ] || { echo 'На сайте другой коммит; нужен новый пакет'; exit 1; }
verify_files before
"${GIT[@]}" apply --check "$BUNDLE/changes.patch"
STAGE=$(mktemp -d /tmp/luckybox-accounts-check.XXXXXX)
chmod 700 "$STAGE"
TEST_PID=''
MUTATED=false
STOPPED=false
MAINTAINED=false
WATCHDOG=false
BACKUP=''
restore_maintenance() {
 [ "$MAINTAINED" = true ] || return 0
 (cd "$APP"; DOTENV_CONFIG_PATH="$APP/.env" node -r dotenv/config --input-type=module - "$BACKUP/maintenance.json" <<'JS'
import fs from 'node:fs';import {setting,saveSettings} from './server/db.js';
const old=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
saveSettings(0,{maintenance:old});
JS
 )
 MAINTAINED=false
}
cleanup() {
 code=$?
 trap - EXIT
 [ -z "$TEST_PID" ] || kill "$TEST_PID" 2>/dev/null || true
 if [ "$code" -ne 0 ] && [ "$MUTATED" = true ]; then
  systemctl stop luckybox luckybox-bot || true
  echo "Ошибка применения; возвращаю прежний код из $BACKUP/files. Схема добавочная, денежные записи не откатываются."
  python3 - "$BUNDLE" "$APP" "$BACKUP/files" <<'PY'
import json,pathlib,shutil,sys
bundle,app,backup=map(pathlib.Path,sys.argv[1:])
for f in json.loads((bundle/'manifest.json').read_text()):
 p=app/f['path'];old=backup/f['path']
 if old.exists(): shutil.copy2(old,p)
 elif p.exists(): p.unlink()
PY
  if [ "$("${GIT[@]}" rev-parse HEAD)" = "$SOURCE" ]; then
   "${GIT[@]}" update-ref "refs/heads/$BRANCH" "$BASE" "$SOURCE"
   "${GIT[@]}" reset "$BASE" -- "${FILES[@]}"
  fi
 fi
 restore_maintenance || echo 'Не удалось вернуть прежний режим обслуживания; проверьте Настройки -> Режим'
 if [ "$STOPPED" = true ]; then systemctl start luckybox luckybox-bot || true; fi
 if [ "$WATCHDOG" = true ]; then systemctl start luckybox-watchdog.timer || true; fi
 [ "$code" = 0 ] || echo "ОШИБКА: код $code. Полные проверки: $STAGE"
 exit "$code"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
run_check() {
 local label=$1 limit=$2 result=0 progress
 shift 2
 echo "==> $label"
 (elapsed=0; while sleep 20; do elapsed=$((elapsed+20)); echo "    $label: $elapsed с"; done) &
 progress=$!
 timeout --foreground --signal=TERM --kill-after=10s "$limit" "$@" || result=$?
 kill "$progress" 2>/dev/null || true
 wait "$progress" 2>/dev/null || true
 [ "$result" = 0 ] || { echo "Проверка не пройдена: $label, код $result"; return "$result"; }
}
tar -xzf "$BUNDLE/source.tar.gz" -C "$STAGE"
cd "$STAGE"
export DOTENV_CONFIG_PATH=/dev/null
# Проверки используют закреплённую в lockfile версию браузеров, отдельно от рабочего сайта.
run_check 'Зависимости проверок' 10m npm ci
run_check 'Модули' 2m npm run test:modules
run_check 'Математика' 10m npm run verify
for task in startup accounts payout-check wager start-case slots casino sicilia partners crypto fortune; do
 run_check "$task" 4m npm run "test:$task"
done
DB_PATH="$STAGE/x2-test.db" run_check 'Удвоители' 2m npm run test:x2
# Снимок работающей базы через SQLite backup, без cp и без вывода секретов .env.
(
 cd "$APP"
 DOTENV_CONFIG_PATH="$APP/.env" node -r dotenv/config --input-type=module - "$STAGE/migration.db" <<'JS'
import Database from 'better-sqlite3';
const db=new Database(process.env.DB_PATH || './data/app.db',{readonly:true,fileMustExist:true});
await db.backup(process.argv[2]);db.close();
JS
)
DB_PATH="$STAGE/migration.db" run_check 'Миграция копии рабочей базы и исторические раунды' 4m node test/upgrade-snapshot.mjs
run_check 'Chromium и WebKit' 15m npx playwright install --with-deps chromium webkit
(
 export HOST=127.0.0.1 PORT=3117 DB_PATH="$STAGE/test-data/app.db" DEV_MODE=true ADMIN_TG_IDS=999000001
 export RATE_LIMIT_READ=100000 RATE_LIMIT_PLAY=100000 RATE_LIMIT_AUTH=100000 RATE_LIMIT_CASHIER=100000 RATE_LIMIT_GUESS=100000
 export PAYOUT_DATA_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
 export TELEGRAM_TOKEN= OPS_BOT_TOKEN= RESEND_API_KEY= SMTP_URL= DATABETRIX_AGENT_NAME= DATABETRIX_AGENT_TOKEN= SICILIA_MERCHANT= SICILIA_LOGIN= SICILIA_API_KEY= HELEKET_MERCHANT= HELEKET_API_KEY=
 exec node server/app.js
) > "$STAGE/server.log" 2>&1 &
TEST_PID=$!
ready=false
for ((i=0;i<50;i++)); do
 if curl -fsS http://127.0.0.1:3117/api/health >/dev/null 2>&1; then ready=true; break; fi
 kill -0 "$TEST_PID" 2>/dev/null || break
 sleep 1
done
[ "$ready" = true ] || { cat "$STAGE/server.log"; exit 1; }
run_check 'API и денежные операции' 10m node test/api.mjs http://127.0.0.1:3117
DEBUG=pw:browser run_check 'Счета и поиск банков: Chromium/WebKit' 5m node test/accounts-ui.mjs http://127.0.0.1:3117
run_check 'Интерфейс' 10m node test/ui.mjs http://127.0.0.1:3117
run_check 'Автономная сборка' 8m npm run demo
run_check 'Интерфейс автономной сборки' 10m node test/ui.mjs "file://$STAGE/dist/luckybox.html"
kill "$TEST_PID"; wait "$TEST_PID" 2>/dev/null || true; TEST_PID=''
if [ "$CHECK_ONLY" = 1 ]; then
 echo "УСПЕШНО: все проверки пройдены без применения. Результаты: $STAGE"
 exit 0
fi
"${GIT[@]}" fetch "$BUNDLE/source.bundle" HEAD
[ "$("${GIT[@]}" rev-parse FETCH_HEAD)" = "$SOURCE" ]
[ "$("${GIT[@]}" rev-parse HEAD)" = "$BASE" ]
verify_files before
mapfile -t FILES < <(python3 -c 'import json,sys; print("\n".join(f["path"] for f in json.load(open(sys.argv[1]))))' "$BUNDLE/manifest.json")
BACKUP="/root/luckybox-before-accounts-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -m 700 "$BACKUP"
systemctl start luckybox-backup
python3 - "$BUNDLE" "$APP" "$BACKUP/files" <<'PY'
import json,pathlib,shutil,sys
bundle,app,backup=map(pathlib.Path,sys.argv[1:])
for f in json.loads((bundle/'manifest.json').read_text()):
 p=app/f['path']
 if p.exists():
  target=backup/f['path'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
PY
MAINTAINED=true
(
 cd "$APP"
 DOTENV_CONFIG_PATH="$APP/.env" node -r dotenv/config --input-type=module - "$BACKUP/maintenance.json" <<'JS'
import fs from 'node:fs';import {setting,saveSettings} from './server/db.js';
fs.writeFileSync(process.argv[2],JSON.stringify(setting('maintenance')));
saveSettings(0,{maintenance:true});
JS
)
if systemctl is-active --quiet luckybox-watchdog.timer; then WATCHDOG=true; systemctl stop luckybox-watchdog.timer; fi
systemctl stop luckybox-watchdog.service || true
STOPPED=true
systemctl stop luckybox luckybox-bot
verify_files before
MUTATED=true
python3 - "$BUNDLE" "$APP" "$STAGE" <<'PY'
import json,os,pathlib,pwd,shutil,sys
bundle,app,stage=map(pathlib.Path,sys.argv[1:]);owner=pwd.getpwnam('luckybox')
for f in json.loads((bundle/'manifest.json').read_text()):
 target=app/f['path'];target.parent.mkdir(parents=True,exist_ok=True)
 old=target.stat() if target.exists() else None
 tmp=target.with_name(target.name+'.accounts-new')
 shutil.copyfile(stage/f['path'],tmp)
 os.chown(tmp,old.st_uid if old else owner.pw_uid,old.st_gid if old else owner.pw_gid)
 os.chmod(tmp,old.st_mode & 0o777 if old else f['mode']);os.replace(tmp,target)
PY
verify_files after
"${GIT[@]}" update-ref "refs/heads/$BRANCH" "$SOURCE" "$BASE"
"${GIT[@]}" reset "$SOURCE" -- "${FILES[@]}"
systemctl start luckybox luckybox-bot
live_ready=false
for ((i=0;i<40;i++)); do
 if curl -fsS --max-time 3 http://127.0.0.1:3000/api/health > "$STAGE/live-health.json"; then live_ready=true; break; fi
 sleep 1
done
[ "$live_ready" = true ]
for service in luckybox luckybox-bot; do systemctl is-active --quiet "$service"; done
curl -fsS --max-time 20 http://127.0.0.1:3000/app.js -o "$STAGE/live-app.js"
cmp "$STAGE/live-app.js" "$APP/public/app.js"
restore_maintenance
MUTATED=false
STOPPED=false
if [ "$WATCHDOG" = true ]; then systemctl start luckybox-watchdog.timer; WATCHDOG=false; fi
echo "УСПЕШНО: сайт обновлён в основной ветке $BRANCH, коммит $SOURCE"
echo "Проверки: $STAGE; резервная копия: $BACKUP"
