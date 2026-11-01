#!/usr/bin/env bash
set -euo pipefail
STATE=/root/luckybox-accounts-job
mkdir -p "$STATE"
exec >> "$STATE/output.log" 2>&1
write_state() {
 printf '%s\n' "$1" > "$STATE/status.tmp"
 mv "$STATE/status.tmp" "$STATE/status"
}
finish() {
 code=$?
 trap - EXIT
 if [ "$code" -eq 0 ]; then
  if [ "${CHECK_ONLY:-0}" = 1 ]; then
   write_state "УСПЕШНО: проверки без применения завершены $(date -u --iso-8601=seconds)"
  else
   write_state "УСПЕШНО: проверка и применение завершены $(date -u --iso-8601=seconds)"
  fi
 else
  write_state "ОШИБКА: код $code, $(date -u --iso-8601=seconds). Подробности в журнале."
 fi
 cat "$STATE/status"
 exit "$code"
}
trap finish EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
write_state "ВЫПОЛНЯЕТСЯ: запущено $(date -u --iso-8601=seconds)"
cat "$STATE/status"
bash /root/luckybox-account-release/apply.sh
