// Adopt the inline loader's requests once; keep player responses in memory only.
const earlyResponses = globalThis.__LB_STARTUP_RESPONSES;
if (earlyResponses) delete globalThis.__LB_STARTUP_RESPONSES;
/**
 * Этот маленький модуль запускается после первого кадра заставки,
 * параллельно загрузке разметки и графа app.js.
 * Ответ игрока живёт только в памяти текущей страницы, без кеша и хранилищ.
 */
async function startupRequest(path, options) {
  const res = await (earlyResponses?.[path] || fetch(path, { ...options, cache: 'no-store' }));
  const data = await res.json();
  if (path === '/api/me' && res.status === 401) return null;
  if (!res.ok) {
    const err = new Error(data.message || data.error || `Ошибка ${res.status}`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return path === '/api/me' ? data.user : data;
}

// Обрабатываем отказы сразу: основной модуль ещё может быть в пути.
const startupRequests = Promise.allSettled([
  startupRequest('/api/config', { headers: { 'X-Case-Catalog': 'summary' } }),
  startupRequest('/api/me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }),
]);

export async function loadStartupData() {
  const results = await startupRequests;
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
  }
  return results.map((result) => result.value);
}
