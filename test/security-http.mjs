import assert from 'node:assert/strict';

// Только изолированный сервер с DEV_MODE=false и одноразовой базой.
const base = process.argv[2] || 'http://127.0.0.1:3099';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Use a local test server');
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
async function post(path, body = {}, cookie = '', headers = {}) {
  const response = await fetch(base + path, { method:'POST',
    headers: { 'Content-Type':'application/json', ...(cookie ? { Cookie:cookie } : {}), ...headers },
    body: JSON.stringify(body), redirect:'manual' });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}
const guest = await post('/api/me');
check(guest.response.status === 401, 'DEV_MODE must be disabled: guest cannot get a player');
for (const path of ['/api/admin/users', '/api/admin/settings', '/api/wallet', '/api/payouts']) {
  const { response } = await post(path);
  check([401, 403, 404].includes(response.status), `Guest cannot access ${path}`);
  check(response.headers.get('cache-control') === 'no-store', 'API errors cannot be cached');
}
for (const path of ['/.env', '/.env.bak-20261028-102154', '/data/app.db', '/server/app.js', '/.git/config']) {
  const response = await fetch(base + path, { redirect:'manual' });
  check(response.status === 404, `Private file is not public: ${path}`);
}
const checkSafe = (value) => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    check(!/^(password_hash|passwordHash|server_seed|serverSeed|token_hash|tokenHash|agentToken|apiKey|card_enc)$/i.test(key), 'Private field must not appear in a response');
    checkSafe(child);
  }
};
const unique = Date.now().toString(36);
async function register(suffix) {
  const {response, data} = await post('/api/auth/register', {
    email:`quality-${unique}-${suffix}@example.com`, password:'TestOnlyPassword123!', nick:`Quality ${suffix}`,
  });
  check(response.status === 200, 'Test registration succeeds');
  check(data.user.balance === 0 && !data.user.isAdmin, 'A new player has zero funds and no staff access');
  checkSafe(data);
  const cookies = response.headers.getSetCookie();
  const session = cookies.find(c => c.startsWith('lb_session='));
  check(session && /HttpOnly/i.test(session) && /SameSite=Lax/i.test(session), 'Session cookie is HttpOnly and SameSite');
  check(response.headers.get('cache-control') === 'no-store', 'Account responses cannot be cached');
  check(response.headers.get('x-content-type-options') === 'nosniff', 'API uses nosniff');
  check(!response.headers.has('x-powered-by'), 'Framework header is disabled');
  return {user:data.user, cookie:session.split(';')[0]};
}
const first = await register('a');
const second = await register('b');
const me = await post('/api/me', { userId:first.user.id }, second.cookie);
check(me.data.user.id === second.user.id, 'Body userId cannot switch account identity');
checkSafe(me.data);
const forbidden = await post('/api/admin/users', {}, first.cookie);
check(forbidden.response.status === 403, 'Ordinary player cannot list users');
const crossOrigin = await post('/api/me', {}, first.cookie, {Origin:'https://foreign.invalid'});
check(crossOrigin.response.status === 403, 'Cross-origin account request is rejected');
const fakeSession = await post('/api/me', {}, 'lb_session=forged', {'X-User-Id':String(first.user.id)});
check(fakeSession.response.status === 401, 'Forged cookie and user header cannot authenticate');
await post('/api/auth/logout', {}, first.cookie);
const loggedOut = await post('/api/me', {}, first.cookie);
check(loggedOut.response.status === 401, 'Logout invalidates the session');
console.log(`HTTP security: ${checks} checks passed (authorization, isolation, private fields/files, cookies, cache, origin, logout)`);
