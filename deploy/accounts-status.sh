#!/usr/bin/env bash
set -euo pipefail
STATE=/root/luckybox-accounts-job
if [ ! -f "$STATE/status" ]; then
 echo 'Фоновая установка ещё не запускалась.'
 exit 0
fi
cat "$STATE/status"
echo
if ! systemctl show luckybox-accounts-apply.service \
 --property=ActiveState --property=SubState --property=Result --property=ExecMainStatus --property=ActiveEnterTimestamp; then
 echo 'Не удалось получить состояние systemd.'
fi
echo
 echo 'Последние 25 строк журнала:'
tail -n 25 "$STATE/output.log" 2>/dev/null || true
echo
 echo 'Полный журнал: /root/luckybox-accounts-job/output.log'
