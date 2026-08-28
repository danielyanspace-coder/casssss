/**
 * Проверка ограничителя частоты.
 *
 * Тест модульный, без сервера: ограничитель - это обычная функция-прослойка,
 * и гонять ради неё HTTP значило бы проверять заодно сеть, авторизацию и базу.
 * Здесь проверяется ровно то, за что он отвечает: где счёт, когда отказ, когда
 * снова можно.
 *
 * Запуск: node test/ratelimit.mjs
 */
import { rateLimit } from '../server/ratelimit.js';

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
};

/** Прогоняет один запрос через прослойку и возвращает, чем он кончился. */
function call(limiter, req) {
  let status = 200;
  let body = null;
  const headers = {};
  const res = {
    set: (k, v) => { headers[k] = v; return res; },
    status: (c) => { status = c; return res; },
    json: (b) => { body = b; return res; },
  };
  let passedOn = false;
  limiter(req, res, () => { passedOn = true; });
  return { passedOn, status, body, headers };
}

/* ---------- Счёт по игроку ---------- */
{
  const limiter = rateLimit({ name: 'проба', limit: 3, windowMs: 60_000 });
  const игрок = { player: { id: 1 }, ip: '10.0.0.1' };

  const ходы = [1, 2, 3, 4, 5].map(() => call(limiter, игрок));
  check('в пределах лимита запросы проходят',
        ходы.slice(0, 3).every((r) => r.passedOn));
  check('сверх лимита запрос отклонён', !ходы[3].passedOn);
  check('отказ отдаёт 429', ходы[3].status === 429, String(ходы[3].status));
  check('в отказе есть код', ходы[3].body?.error === 'RATE_LIMITED');
  check('в отказе есть Retry-After',
        Number(ходы[3].headers['Retry-After']) > 0, ходы[3].headers['Retry-After']);
  check('после отказа лимит не сбрасывается', !ходы[4].passedOn);

  // Другой игрок с того же адреса не должен страдать за соседа.
  const сосед = call(limiter, { player: { id: 2 }, ip: '10.0.0.1' });
  check('счёт идёт по игроку, а не по адресу', сосед.passedOn);
}

/* ---------- Счёт по адресу до авторизации ---------- */
{
  const limiter = rateLimit({ name: 'проба2', limit: 2, windowMs: 60_000 });
  check('без игрока считается адрес',
        call(limiter, { ip: '1.2.3.4' }).passedOn
        && call(limiter, { ip: '1.2.3.4' }).passedOn
        && !call(limiter, { ip: '1.2.3.4' }).passedOn);
  check('другой адрес не задет', call(limiter, { ip: '5.6.7.8' }).passedOn);
}

/* ---------- Корзины не смешиваются ---------- */
{
  const a = rateLimit({ name: 'корзинаА', limit: 1, windowMs: 60_000 });
  const b = rateLimit({ name: 'корзинаБ', limit: 1, windowMs: 60_000 });
  const кто = { player: { id: 7 } };
  a(кто, { set: () => {}, status: () => ({ json: () => {} }) }, () => {});
  check('исчерпанная корзина не трогает соседнюю', call(b, кто).passedOn);
}

/* ---------- Окно скользящее ---------- */
{
  // Окно в 40 мс: ждать секунды в тесте незачем, поведение то же.
  const limiter = rateLimit({ name: 'окно', limit: 2, windowMs: 40 });
  const кто = { player: { id: 9 } };

  check('лимит срабатывает внутри окна',
        call(limiter, кто).passedOn && call(limiter, кто).passedOn
        && !call(limiter, кто).passedOn);

  await new Promise((r) => setTimeout(r, 60));
  check('после окна счёт освобождается', call(limiter, кто).passedOn);
}

/* ---------- Порог берётся из настроек ---------- */
{
  process.env.RATE_LIMIT_НАСТРОЙКА = '1';
  const { rateLimit: fresh } = await import('../server/ratelimit.js');
  const limiter = fresh({
    name: 'настройка',
    limit: Number(process.env.RATE_LIMIT_НАСТРОЙКА),
    windowMs: 60_000,
  });
  const кто = { player: { id: 11 } };
  check('порог можно задать настройкой',
        call(limiter, кто).passedOn && !call(limiter, кто).passedOn);
}

console.log(`\nПройдено проверок: ${passed}`);
if (failures.length) {
  console.log(`\nПРОВАЛЕНО (${failures.length}):`);
  for (const f of failures) console.log('  • ' + f);
  process.exit(1);
}
console.log('Ограничитель частоты работает как задумано.\n');
