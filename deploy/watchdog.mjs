/**
 * Сторож: раз в минуту проверяет, что сайт жив, и пишет в служебный бот,
 * когда что-то сломалось и когда починилось.
 *
 * Отдельный процесс по таймеру systemd, а не часть сервера: упавший сервер
 * сам о своём падении не скажет. Проверки:
 *
 *   - сервер отвечает на /api/health изнутри машины (процесс и база живы);
 *   - сайт открывается снаружи по SITE_URL (nginx, сертификат, домен);
 *   - сертификат истекает не раньше чем через CERT_WARN_DAYS дней;
 *   - на диске больше DISK_WARN_FREE свободного места;
 *   - последняя копия базы не старше BACKUP_MAX_AGE_H часов.
 *
 * Тревога поднимается со второй подряд неудачи (FAILS_TO_ALERT): одна
 * потерянная проверка - это перезапуск при выкате, а не сбой. Каждая беда
 * сообщается один раз, при починке приходит «восстановлено» с длительностью
 * простоя. Состояние между запусками - в data/watchdog.json.
 *
 * Работает без сервера и без db.js: получателей читает из базы только на
 * чтение, а не может прочитать - пишет в OPS_ALERT_CHAT_ID.
 *
 *   node deploy/watchdog.mjs        (по таймеру: luckybox-watchdog.timer)
 */
import Database from 'better-sqlite3';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, statfsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import tls from 'node:tls';

import { alertRecipients, notifyAll, siteLabel, opsToken } from '../server/ops-notify.js';

const DB_PATH = resolve(process.env.DB_PATH || './data/app.db');
const DATA_DIR = dirname(DB_PATH);
const STATE_PATH = join(DATA_DIR, 'watchdog.json');
const BACKUP_DIR = process.env.BACKUP_DIR || join(DATA_DIR, 'backups');
const PORT = Number(process.env.PORT || 3000);
const SITE_URL = (process.env.SITE_URL || process.env.WEBAPP_URL || '').replace(/\/+$/, '');

const FAILS_TO_ALERT = 2;
const HTTP_TIMEOUT_MS = 10_000;
const CERT_WARN_DAYS = 14;
const DISK_WARN_FREE = 0.10;
// Копия раз в час, поэтому два с лишним часа без неё - уже не случайность.
const BACKUP_MAX_AGE_H = Number(process.env.WATCHDOG_BACKUP_MAX_AGE_H || 3);

if (!opsToken()) {
  console.log('OPS_BOT_TOKEN не задан: сторожу некуда писать, выходим');
  process.exit(0);
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(state) {
  try { writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); } catch (err) {
    console.error('Состояние сторожа не сохранилось:', err.message);
  }
}

async function httpOk(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) return `ответ ${res.status}`;
    const data = await res.json().catch(() => null);
    return data?.ok ? '' : 'ответ без ok';
  } catch (err) {
    return err.cause?.code || err.name === 'TimeoutError' ? `нет ответа (${err.cause?.code || 'таймаут'})` : err.message;
  }
}

function certDaysLeft(host) {
  return new Promise((done) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: HTTP_TIMEOUT_MS }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      done(cert?.valid_to ? (new Date(cert.valid_to) - Date.now()) / 86_400_000 : null);
    });
    socket.on('error', () => done(null));
    socket.on('timeout', () => { socket.destroy(); done(null); });
  });
}

/** Набор проверок: имя -> текст беды или пустая строка, если всё хорошо. */
async function runChecks() {
  const out = {};

  const local = await httpOk(`http://127.0.0.1:${PORT}/api/health`);
  out.server = local ? `Сервер не отвечает изнутри машины: ${local}. Смотрите journalctl -u luckybox.` : '';

  if (SITE_URL) {
    const outside = await httpOk(`${SITE_URL}/api/health`);
    // Изнутри жив, снаружи нет - значит nginx, сертификат или DNS.
    out.site = outside && !local ? `Сайт ${SITE_URL} не открывается снаружи: ${outside}. Проверьте nginx и домен.` : '';
    if (SITE_URL.startsWith('https://')) {
      const days = await certDaysLeft(new URL(SITE_URL).hostname);
      out.cert = days !== null && days < CERT_WARN_DAYS
        ? `Сертификат ${new URL(SITE_URL).hostname} истекает через ${Math.max(0, Math.floor(days))} дн. Проверьте certbot renew.` : '';
    }
  }

  try {
    const fs = statfsSync(DATA_DIR);
    const free = fs.bavail / fs.blocks;
    out.disk = free < DISK_WARN_FREE
      ? `На диске осталось ${(free * 100).toFixed(1)}% места. Почистите старые копии и журналы.` : '';
  } catch { out.disk = ''; }

  if (existsSync(BACKUP_DIR)) {
    const files = readdirSync(BACKUP_DIR).filter((f) => /^app-.*\.db\.gz$/.test(f)).sort();
    const last = files.at(-1);
    const ageH = last ? (Date.now() - statSync(join(BACKUP_DIR, last)).mtimeMs) / 3_600_000 : Infinity;
    out.backup = ageH > BACKUP_MAX_AGE_H
      ? (last ? `Копии базы не делаются: последняя ${ageH.toFixed(1)} ч назад.` : 'Копий базы нет ни одной.')
        + ' Проверьте systemctl status luckybox-backup.' : '';
  }
  return out;
}

function recipients() {
  try {
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    const ids = alertRecipients(db);
    db.close();
    return ids;
  } catch {
    return alertRecipients({ prepare: () => ({ all: () => [] }) });
  }
}

const minutes = (ms) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
};

const state = loadState();
const results = await runChecks();
const now = Date.now();
const messages = [];

for (const [name, problem] of Object.entries(results)) {
  const s = state[name] || { fails: 0, alerted: false, since: 0 };
  if (problem) {
    s.fails += 1;
    if (!s.since) s.since = now;
    if (s.fails >= FAILS_TO_ALERT && !s.alerted) {
      messages.push(`СБОЙ · ${siteLabel()}\n${problem}`);
      s.alerted = true;
    }
  } else {
    if (s.alerted) messages.push(`ВОССТАНОВЛЕНО · ${siteLabel()}\n${name === 'server' ? 'Сервер' : name === 'site' ? 'Сайт' : name === 'cert' ? 'Сертификат' : name === 'disk' ? 'Диск' : 'Копии базы'} снова в порядке, простой ${minutes(now - s.since)}.`);
    s.fails = 0; s.alerted = false; s.since = 0;
  }
  state[name] = s;
}

if (messages.length) {
  const ids = recipients();
  for (const text of messages) await notifyAll(ids, text);
}
saveState(state);
