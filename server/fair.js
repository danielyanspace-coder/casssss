/**
 * Provably fair: результат нельзя подкрутить задним числом.
 *
 * Схема стандартная для таких игр:
 *   1. Сервер генерирует случайный serverSeed и показывает игроку только его
 *      SHA-256 хеш — до начала игры.
 *   2. Игрок задаёт свой clientSeed (может поменять в любой момент).
 *   3. Каждое открытие использует nonce, который увеличивается на единицу.
 *   4. roll = HMAC-SHA256(serverSeed, "clientSeed:nonce") -> число [0, 1).
 *   5. Когда игрок меняет seed, сервер раскрывает старый serverSeed, и любой
 *      прошлый ролл можно пересчитать и сверить с хешем.
 *
 * Сервер не может подменить serverSeed после того, как показал хеш: хеш
 * от другого seed не сойдётся.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';

export function generateServerSeed() {
  return randomBytes(32).toString('hex');
}

export function hashSeed(seed) {
  return createHash('sha256').update(seed).digest('hex');
}

export function generateClientSeed() {
  return randomBytes(8).toString('hex');
}

/**
 * Считает число в [0, 1) из тройки (serverSeed, clientSeed, nonce).
 *
 * Берём первые 8 hex-символов HMAC (32 бита) и делим на 2^32. Делитель именно
 * 2^32, а не 2^32-1, чтобы результат никогда не был равен единице.
 */
export function computeRoll(serverSeed, clientSeed, nonce) {
  const hmac = createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');
  const slice = hmac.slice(0, 8);
  return parseInt(slice, 16) / 0x100000000;
}
