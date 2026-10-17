/**
 * Резервная копия базы.
 *
 * ПОЧЕМУ НЕ cp. База работает в режиме WAL: часть свежих записей лежит не в
 * app.db, а в app.db-wal, и меняются оба файла одновременно. Обычное
 * копирование во время работы даёт снимок, собранный из разных моментов, -
 * такая копия открывается, но может не содержать последних заявок или
 * оказаться повреждённой. Здесь используется собственный механизм SQLite: он
 * снимает согласованный снимок, не останавливая сервер.
 *
 * ЧТО КОПИЯ НЕ СОДЕРЖИТ. Ключ PAYOUT_DATA_KEY лежит в .env, а не в базе.
 * Номера карт зашифрованы им, и без ключа копия базы их не вернёт. Ключ надо
 * хранить отдельно и знать, где он лежит, - скрипт об этом напоминает, но
 * положить его за вас не может.
 *
 * ПОЧЕМУ КОПИИ СЖИМАЮТСЯ. База состоит из повторяющихся строк истории и
 * жмётся примерно в семь раз. При живом потоке игроков это решает: один раунд
 * весит около 230 байт, три сотни игроков за сутки дают четверть гигабайта, а
 * копий мы держим четырнадцать. Без сжатия они съедают диск за пару месяцев.
 *
 * КУДА. По умолчанию data/backups рядом с базой. Это защищает от испорченной
 * записи и ошибочного удаления, но НЕ от потери самого сервера. Настоящая
 * копия - та, что уехала на другую машину; см. RCLONE_REMOTE ниже.
 *
 * Запуск:  node deploy/backup.mjs
 * По расписанию: deploy/luckybox-backup.service + .timer
 */
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, statSync, unlinkSync, existsSync,
         createReadStream, createWriteStream } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { alertRecipients, notifyAll, siteLabel } from '../server/ops-notify.js';

const DB_PATH = process.env.DB_PATH || './data/app.db';
const OUT_DIR = process.env.BACKUP_DIR || join(dirname(DB_PATH), 'backups');

/** Сколько копий держим. Каждая - полный файл базы. */
const KEEP = Number(process.env.BACKUP_KEEP || 14);

/** Куда отправить копию с машины. Пусто - никуда, только локально. */
const REMOTE = process.env.RCLONE_REMOTE || '';

/*
 * Сбой копии - повод для оповещения: о несделанной копии узнают обычно в тот
 * день, когда она понадобилась. Получателей берём из той же базы, без неё -
 * только общий чат OPS_ALERT_CHAT_ID.
 */
async function fail(message) {
  console.error(message);
  let ids = [];
  try {
    const rdb = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    ids = alertRecipients(rdb);
    rdb.close();
  } catch { ids = alertRecipients({ prepare: () => ({ all: () => [] }) }); }
  await notifyAll(ids, `СБОЙ · ${siteLabel()}\nКопия базы не сделана: ${message}`);
  process.exit(1);
}

if (!existsSync(DB_PATH)) await fail(`база не найдена: ${DB_PATH}`);

mkdirSync(OUT_DIR, { recursive: true });

// Имя с датой в сортируемом виде: список файлов сам собой идёт по времени.
// Миллисекунды обязательны: два запуска в одну секунду - это ручной прогон
// поверх запуска по расписанию, и без них второй молча затрёт первый.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(OUT_DIR, `app-${stamp}.db`);

try {
  const db = new Database(DB_PATH, { readonly: true });
  await db.backup(target);
  db.close();
} catch (err) {
  await fail(`снимок не снялся: ${err.message}`);
}

/*
 * Целостность проверяем сразу: копия, о которой узнаёшь при восстановлении,
 * что она битая, - это отсутствие копии.
 *
 * Открываем на запись, чтобы следом свернуть журнал. Копия наследует режим
 * WAL, и любое открытие создаёт рядом app-….db-wal и -shm. Оставить их - это
 * три файла на копию вместо одного и риск восстановить базу без хвоста
 * журнала. После TRUNCATE копия становится самодостаточным файлом.
 */
const copy = new Database(target);
const integrity = copy.pragma('integrity_check', { simple: true });
copy.pragma('wal_checkpoint(TRUNCATE)');
copy.close();
for (const tail of ['-wal', '-shm']) {
  if (existsSync(target + tail)) unlinkSync(target + tail);
}

if (integrity !== 'ok') {
  unlinkSync(target);
  await fail(`копия повреждена (${integrity}) и удалена`);
}

const raw = statSync(target).size;

// Сжимаем и убираем несжатый файл: держать оба смысла нет, а место копии
// занимают всерьёз.
const packed = target + '.gz';
await pipeline(createReadStream(target), createGzip({ level: 9 }), createWriteStream(packed));
unlinkSync(target);

const size = statSync(packed).size;
console.log(`Копия готова: ${packed} `
  + `(${(size / 1024 / 1024).toFixed(2)} МБ, сжата в ${(raw / size).toFixed(1)} раза, целостность ok)`);

// Ротация: держим последние KEEP штук.
const old = readdirSync(OUT_DIR)
  .filter((f) => /^app-.*\.db\.gz$/.test(f))
  .sort()
  .slice(0, -KEEP);

for (const f of old) {
  unlinkSync(join(OUT_DIR, f));
  console.log(`Удалена старая копия: ${f}`);
}

// Отправка на другую машину, если настроена. Без неё копии переживают
// испорченную запись, но не пожар в дата-центре.
if (REMOTE) {
  try {
    execFileSync('rclone', ['copy', packed, REMOTE], { stdio: 'inherit' });
    console.log(`Отправлено в ${REMOTE}/${basename(packed)}`);
  } catch (err) {
    await fail(`не отправилась в ${REMOTE}: ${err.message}. Локальная копия есть.`);
  }
} else {
  console.log('RCLONE_REMOTE не задан: копия осталась только на этом сервере.');
}

console.log('Напоминание: PAYOUT_DATA_KEY из .env в копию не входит. '
  + 'Без него номера карт из этой базы расшифровать нельзя.');
