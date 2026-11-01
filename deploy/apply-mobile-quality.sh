#!/usr/bin/env bash
# Apply a reviewed local release bundle to the live checkout on its main branch.
set -euo pipefail
BUNDLE="$(cd "$(dirname "$0")" && pwd)"
APP=/srv/luckybox
BRANCH=claude/github-text-document-aja1hm
[ "$(id -u)" -eq 0 ] || { echo 'Запустите через sudo.'; exit 1; }
[ -f "$BUNDLE/source.tar.gz" ] || { echo 'Нужен полный release bundle рядом со скриптом.'; exit 1; }
GIT=(git -c "safe.directory=$APP" -C "$APP")
[ "$("${GIT[@]}" branch --show-current)" = "$BRANCH" ] || { echo 'Рабочая ветка сайта изменилась; автоматическая установка остановлена.'; exit 1; }
SOURCE=$(cat "$BUNDLE/source.sha")
BASE=$(cat "$BUNDLE/base.sha")
LIVE_HEAD=$("${GIT[@]}" rev-parse HEAD)
[ "$LIVE_HEAD" = "$BASE" ] || [ "$LIVE_HEAD" = "$SOURCE" ] || { echo 'На сайте появился другой коммит; нужен новый пакет.'; exit 1; }
# Check both versions before installing anything; a later edit must never be lost.
python3 - "$BUNDLE" "$APP" <<'PY'
import hashlib,json,pathlib,sys
bundle,app=map(pathlib.Path,sys.argv[1:])
files=json.loads((bundle/'manifest.json').read_text())
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
current=[digest(app/f['path']) for f in files]
if all(h==f['after'] for h,f in zip(current,files)):
 print('Эти изменения уже установлены.');sys.exit(0)
for h,f in zip(current,files):
 if h!=f['before']: raise SystemExit('Файл изменился после подготовки: '+f['path'])
PY
if "${GIT[@]}" apply --reverse --check "$BUNDLE/changes.patch" 2>/dev/null; then
  echo 'Этот пакет уже применён. Повторный запуск не нужен.'; exit 0
fi
"${GIT[@]}" apply --check "$BUNDLE/changes.patch"

STAGE=$(mktemp -d /tmp/luckybox-release-check.XXXXXX)
TEST_PID=''
cleanup() { [ -z "$TEST_PID" ] || kill "$TEST_PID" 2>/dev/null || true; }
trap cleanup EXIT
# The test checkout contains no production .env or database.
tar -xzf "$BUNDLE/source.tar.gz" -C "$STAGE"
echo '==> Установка зависимостей и проверки до изменения сайта'
(
 cd "$STAGE"
 export DOTENV_CONFIG_PATH=/dev/null
 npm ci
 npm audit --audit-level=low
 npm run test:modules
 npm run test:startup
 node test/mobile-quality.mjs
 npm run test:casino
 npm run test:auth
 npm run test:wager
 npm run test:payout-check
 node test/csv-security.mjs
 npx playwright install --with-deps chromium
)
start_test_server() {
 local mode=$1 port=$2 database=$3
 (
  cd "$STAGE"
  export DOTENV_CONFIG_PATH=/dev/null DEV_MODE="$mode" HOST=127.0.0.1 PORT="$port" DB_PATH="$STAGE/data/$database"
  export ADMIN_TG_IDS=999000001 RATE_LIMIT_READ=100000 RATE_LIMIT_AUTH=100000 RATE_LIMIT_PLAY=100000 RATE_LIMIT_CASHIER=100000 RATE_LIMIT_GUESS=100000
  export TELEGRAM_TOKEN= OPS_BOT_TOKEN= RESEND_API_KEY= SMTP_URL= DATABETRIX_AGENT_NAME= DATABETRIX_AGENT_TOKEN= SICILIA_MERCHANT= SICILIA_LOGIN= SICILIA_API_KEY= HELEKET_MERCHANT= HELEKET_API_KEY=
  export PAYOUT_DATA_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  exec node server/app.js
 ) > "$STAGE/server-$port.log" 2>&1 &
 TEST_PID=$!
 for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then return; fi
  kill -0 "$TEST_PID" 2>/dev/null || break
  sleep 1
 done
 cat "$STAGE/server-$port.log"; exit 1
}
mkdir -p "$STAGE/data"
start_test_server false 3099 security.db
(cd "$STAGE" && node test/security-http.mjs http://127.0.0.1:3099)
kill "$TEST_PID"; wait "$TEST_PID" 2>/dev/null || true; TEST_PID=''
start_test_server true 3097 ui.db
(
 cd "$STAGE"
 node test/api.mjs http://127.0.0.1:3097
 node test/ui.mjs http://127.0.0.1:3097
 node test/casino-layout.mjs http://127.0.0.1:3097
 node test/mobile-quality-ui.mjs http://127.0.0.1:3097
 node test/cashier-ui.mjs http://127.0.0.1:3097
 node test/startup-ui.mjs http://127.0.0.1:3097
 node tools/perf-audit.mjs http://127.0.0.1:3097 "$STAGE/performance.json"
)
kill "$TEST_PID"; wait "$TEST_PID" 2>/dev/null || true; TEST_PID=''

echo '==> Резервная копия базы и текущих файлов'
systemctl start luckybox-backup
BACKUP="/root/luckybox-before-mobile-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP"
python3 - "$BUNDLE" "$APP" "$BACKUP" <<'PY'
import json,pathlib,shutil,sys
bundle,app,backup=map(pathlib.Path,sys.argv[1:])
for f in json.loads((bundle/'manifest.json').read_text()):
 p=app/f['path']
 if p.exists():
  target=backup/'files'/f['path'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
shutil.copy2(bundle/'manifest.json',backup/'manifest.json')
PY
rollback() {
 echo "Установка не завершена; возвращаю прежние файлы. Копия: $BACKUP"
 python3 - "$APP" "$BACKUP" <<'PY'
import json,pathlib,shutil,sys
app,backup=map(pathlib.Path,sys.argv[1:])
for f in json.loads((backup/'manifest.json').read_text()):
 target=app/f['path'];old=backup/'files'/f['path']
 if old.exists(): shutil.copy2(old,target)
 elif target.exists(): target.unlink()
PY
 (cd "$APP" && npm ci --omit=dev) || true
 systemctl restart luckybox || true
 exit 1
}
trap rollback ERR
"${GIT[@]}" apply --check "$BUNDLE/changes.patch"
"${GIT[@]}" apply "$BUNDLE/changes.patch"
(cd "$APP" && npm ci --omit=dev && node --input-type=module -e "import 'dotenv/config'; if(process.env.DEV_MODE==='true') throw Error('DEV_MODE включён на рабочем сайте'); await import('./server/cases.js').then(m=>m.validateCases());")
python3 - "$BUNDLE" "$APP" <<'PY'
import json,os,pathlib,pwd,sys
bundle,app=map(pathlib.Path,sys.argv[1:]);owner=pwd.getpwnam('luckybox')
for f in json.loads((bundle/'manifest.json').read_text()):
 os.chown(app/f['path'],owner.pw_uid,owner.pw_gid)
 os.chmod(app/f['path'],f['mode'])
PY
systemctl restart luckybox
healthy=false
for i in $(seq 1 40); do
 if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then healthy=true; break; fi
 sleep 1
done
[ "$healthy" = true ] || { echo 'Сайт не поднялся'; false; }
curl -fsS http://127.0.0.1:3000/ -o "$BACKUP/installed.html"
grep -q 'mobile-quality-20261029' "$BACKUP/installed.html"
trap - ERR
# Import the reviewed commit and move the live main branch to that exact
# commit. Existing changes outside this release keep their index/worktree state.
python3 - "$BUNDLE" <<'PY' > "$BACKUP/paths"
import json,pathlib,sys
for f in json.loads((pathlib.Path(sys.argv[1])/'manifest.json').read_text()): print(f['path'])
PY
mapfile -t FILES < "$BACKUP/paths"
"${GIT[@]}" fetch "$BUNDLE/source.bundle" HEAD
[ "$("${GIT[@]}" rev-parse FETCH_HEAD)" = "$SOURCE" ]
"${GIT[@]}" reset --soft "$SOURCE"
"${GIT[@]}" reset "$SOURCE" -- "${FILES[@]}"
echo "Изменения установлены в основной ветке сайта. Проверки: $STAGE; копия: $BACKUP"
