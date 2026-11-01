#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'Запустите через sudo.'; exit 1; }
CHECK_ONLY=0
case "${1:-}" in
 --check) CHECK_ONLY=1 ;;
 "") ;;
 *) echo "Использование: $0 [--check]"; exit 2 ;;
esac
UNIT=luckybox-accounts-apply.service
STATE=/root/luckybox-accounts-job
mkdir -p "$STATE"
exec 9>"$STATE/start.lock"
flock -n 9 || { echo 'Запуск уже выполняется.'; exit 1; }
active=$(systemctl show "$UNIT" -p ActiveState --value 2>/dev/null || true)
sub=$(systemctl show "$UNIT" -p SubState --value 2>/dev/null || true)
if [[ "$active" = activating || "$active" = deactivating || ( "$active" = active && "$sub" != exited ) ]]; then
 echo 'Установка уже выполняется. Статус: sudo bash /root/luckybox-accounts-status.sh'
 exit 0
fi
systemctl stop "$UNIT" 2>/dev/null || true
systemctl reset-failed "$UNIT" 2>/dev/null || true
if [ -f "$STATE/status" ]; then
 archive="$STATE/history/$(date -u +%Y%m%dT%H%M%S)-$$"
 mkdir -p "$archive"
 cp "$STATE/status" "$archive/status"
 [ ! -f "$STATE/output.log" ] || cp "$STATE/output.log" "$archive/output.log"
fi
: > "$STATE/output.log"
printf 'Ожидает запуска: %s\n' "$(date -u --iso-8601=seconds)" > "$STATE/status"
if ! systemd-run --unit="$UNIT" --description='Luckybox: проверка и применение обновления' \
 --property="Environment=CHECK_ONLY=$CHECK_ONLY" --property=Type=exec --property=RemainAfterExit=yes --property=KillMode=control-group \
 --property=TimeoutStopSec=30s --property=RuntimeMaxSec=90min \
 /bin/bash /root/luckybox-accounts-worker.sh; then
 echo 'Ошибка запуска фоновой службы.' > "$STATE/status"
 exit 1
fi
echo 'Запущено в фоне. Можно выйти из SSH.'
echo 'Статус: sudo bash /root/luckybox-accounts-status.sh'
