#!/usr/bin/env bash
set -Eeuo pipefail
BUNDLE=${1:-/root/luckybox-freespin-release}
APP=/srv/luckybox
BRANCH=claude/github-text-document-aja1hm
[ "$(id -u)" = 0 ] || { echo 'Нужен sudo'; exit 1; }
exec 8>/root/luckybox-quality-apply.lock
flock -n 8 || { echo 'Другая установка уже выполняется'; exit 1; }
GIT=(git -c "safe.directory=$APP" -C "$APP")
BASE=$(cat "$BUNDLE/base.sha")
SOURCE=$(cat "$BUNDLE/source.sha")
verify_files() {
 python3 - "$BUNDLE" "$APP" "$1" <<'PY'
import hashlib,json,pathlib,sys
bundle,app=map(pathlib.Path,sys.argv[1:3]);version=sys.argv[3]
for f in json.loads((bundle/'manifest.json').read_text()):
 p=app/f['path'];h=hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
 if h!=f[version]: raise SystemExit('Файл изменился: '+f['path']+'; установка остановлена, чужие изменения не перезаписаны')
PY
}
[ "$("${GIT[@]}" branch --show-current)" = "$BRANCH" ] || { echo 'Рабочая ветка сайта изменилась'; exit 1; }
LIVE=$("${GIT[@]}" rev-parse HEAD)
if [ "$LIVE" = "$SOURCE" ]; then
 verify_files after
 echo 'Этот пакет уже установлен.'; exit 0
fi
[ "$LIVE" = "$BASE" ] || { echo 'На сайте другой коммит; нужен новый пакет'; exit 1; }
verify_files before
"${GIT[@]}" apply --check "$BUNDLE/changes.patch"
STAGE=$(mktemp -d /tmp/luckybox-freespin-check.XXXXXX)
echo "Проверки: $STAGE"
TEST_PID=''
MUTATED=false
BACKUP=''
cleanup() {
 code=$?
 trap - EXIT
 [ -z "$TEST_PID" ] || kill "$TEST_PID" 2>/dev/null || true
 if [ "$code" -ne 0 ] && [ "$MUTATED" = true ]; then
  echo "Ошибка после начала применения; восстановление файлов из $BACKUP"
  python3 - "$BUNDLE" "$APP" "$BACKUP" <<'PY'
import json,pathlib,shutil,sys
bundle,app,backup=map(pathlib.Path,sys.argv[1:])
for f in json.loads((bundle/'manifest.json').read_text()):
 p=app/f['path'];old=backup/f['path']
 if old.exists(): shutil.copy2(old,p)
 elif p.exists(): p.unlink()
PY
  # Only our branch movement and index entries are undone. Other paths stay intact.
  if [ "$("${GIT[@]}" rev-parse HEAD)" = "$SOURCE" ]; then
   "${GIT[@]}" update-ref "refs/heads/$BRANCH" "$BASE" "$SOURCE"
   "${GIT[@]}" reset "$BASE" -- "${FILES[@]}"
  fi
 fi
 [ "$code" = 0 ] || echo "ОШИБКА: код $code. Проверки и снимки сохранены в $STAGE"
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
run_check 'Зависимости' 10m npm ci
run_check 'Модули' 2m npm run test:modules
run_check 'Загрузка' 3m npm run test:startup
run_check 'Отмена серии и reduced motion' 2m node test/mobile-quality.mjs
run_check 'Установка Chromium и WebKit' 15m npx playwright install --with-deps chromium webkit
export MOTION_RESULTS="$STAGE/motion-results"
run_check 'Полная растровая сцена: Chromium и WebKit' 8m node test/freespin-raster-ui.mjs
# A fresh test DB and an empty dotenv keep checks separate from live accounts.
(
 export HOST=127.0.0.1 PORT=3107 DB_PATH="$STAGE/test-data/app.db" DEV_MODE=true ADMIN_TG_IDS=999000001
 export RATE_LIMIT_READ=100000 RATE_LIMIT_PLAY=100000 RATE_LIMIT_AUTH=100000
 export PAYOUT_DATA_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
 export TELEGRAM_TOKEN= OPS_BOT_TOKEN= RESEND_API_KEY= SMTP_URL= DATABETRIX_AGENT_NAME= DATABETRIX_AGENT_TOKEN= SICILIA_MERCHANT= SICILIA_LOGIN= SICILIA_API_KEY= HELEKET_MERCHANT= HELEKET_API_KEY=
 exec node server/app.js
) > "$STAGE/server.log" 2>&1 &
TEST_PID=$!
ready=false
for ((i=0;i<40;i++)); do
 if curl -fsS http://127.0.0.1:3107/api/health >/dev/null 2>&1; then ready=true; break; fi
 kill -0 "$TEST_PID" 2>/dev/null || break
 sleep 1
done
[ "$ready" = true ] || { cat "$STAGE/server.log"; exit 1; }
run_check 'Закрытие серии и возврат в интерфейсе' 5m node test/mobile-quality-ui.mjs http://127.0.0.1:3107
kill "$TEST_PID"; wait "$TEST_PID" 2>/dev/null || true; TEST_PID=''
# Import the commit before touching the running site. Ref update uses compare-and-swap.
"${GIT[@]}" fetch "$BUNDLE/source.bundle" HEAD
[ "$("${GIT[@]}" rev-parse FETCH_HEAD)" = "$SOURCE" ]
[ "$("${GIT[@]}" branch --show-current)" = "$BRANCH" ]
[ "$("${GIT[@]}" rev-parse HEAD)" = "$BASE" ]
verify_files before
mapfile -t FILES < <(python3 -c 'import json,sys; print("\n".join(f["path"] for f in json.load(open(sys.argv[1]))))' "$BUNDLE/manifest.json")
BACKUP="/root/luckybox-before-freespin-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$BACKUP"
python3 - "$BUNDLE" "$APP" "$BACKUP" <<'PY'
import json,pathlib,shutil,sys
bundle,app,backup=map(pathlib.Path,sys.argv[1:])
for f in json.loads((bundle/'manifest.json').read_text()):
 p=app/f['path']
 if p.exists():
  target=backup/f['path'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
PY
MUTATED=true
# Replace only the reviewed files, preserving production ownership and permissions.
python3 - "$BUNDLE" "$APP" "$STAGE" <<'PY'
import json,os,pathlib,pwd,shutil,sys
bundle,app,stage=map(pathlib.Path,sys.argv[1:]);owner=pwd.getpwnam('luckybox')
for f in json.loads((bundle/'manifest.json').read_text()):
 target=app/f['path'];target.parent.mkdir(parents=True,exist_ok=True)
 old=target.stat() if target.exists() else None
 tmp=target.with_name(target.name+'.freespin-new')
 shutil.copyfile(stage/f['path'],tmp)
 os.chown(tmp,old.st_uid if old else owner.pw_uid,old.st_gid if old else owner.pw_gid)
 os.chmod(tmp,old.st_mode & 0o777 if old else f['mode'])
 os.replace(tmp,target)
PY
verify_files after
"${GIT[@]}" update-ref "refs/heads/$BRANCH" "$SOURCE" "$BASE"
"${GIT[@]}" reset "$SOURCE" -- "${FILES[@]}"
# Static JS/CSS are revalidated by the server; no process restart is needed.
curl -fsS --max-time 20 http://127.0.0.1:3000/api/health > "$STAGE/live-health.json"
for path in motion.js styles.css; do
 curl -fsS --max-time 20 "http://127.0.0.1:3000/$path" -o "$STAGE/live-$path"
 cmp "$STAGE/live-$path" "$APP/public/$path"
done
MUTATED=false
echo "УСПЕШНО: изменения применены в рабочей ветке $BRANCH, коммит $SOURCE"
echo "Проверки и снимки: $STAGE; резервная копия: $BACKUP"
