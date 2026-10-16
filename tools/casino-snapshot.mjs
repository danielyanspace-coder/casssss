/**
 * Снимок каталога казино для репозитория.
 *
 *   DATABETRIX_AGENT_NAME=... DATABETRIX_AGENT_TOKEN=... \
 *   NODE_USE_ENV_PROXY=1 node tools/casino-snapshot.mjs  ->  server/casino-catalog.json
 *
 * Тот же buildCatalog, что у живой синхронизации, поэтому снимок - ровно
 * те строки, которые легли бы в базу. На нём работают разработка без ключа,
 * тесты и автономная сборка. Обновлять, когда партнёр заметно поменял
 * каталог: рабочий сервер снимком не пользуется, он синхронизируется сам.
 */
import { writeFileSync } from 'node:fs';

process.env.DB_PATH = process.env.DB_PATH || './data/snapshot-tmp.db';
const { buildCatalog, casinoEnv, SNAPSHOT_PATH } = await import('../server/casino.js');

const env = casinoEnv();
if (!env.agent || !env.token) throw new Error('нужны DATABETRIX_AGENT_NAME и DATABETRIX_AGENT_TOKEN');
const headers = { 'x-agent-name': env.agent, 'x-agent-token': env.token };

async function get(path) {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${env.base}${path}`, { headers, signal: AbortSignal.timeout(60_000) });
      if (res.ok) return res.json();
      last = new Error(`${res.status} ${path}`);
    } catch (err) { last = err; }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw last;
}

const raw = [];
for (let offset = 0; ; offset += 500) {
  const page = await get(`/api/game/get-games?offset=${offset}&length=500`);
  raw.push(...page.items);
  if (raw.length >= page.total || !page.items.length) break;
}
const providers = await get('/api/game/get-providers');
const built = buildCatalog(raw, providers);
// Без времени и прочего шума: снимок должен меняться в git только тогда,
// когда поменялся сам каталог.
writeFileSync(SNAPSHOT_PATH, JSON.stringify({ providers: built.providers, games: built.games }));
console.log(`снимок: игр ${built.games.length}, провайдеров ${built.providers.length}`);
