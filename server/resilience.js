/** Bounded work: reject before allocating expensive bodies or KDF jobs. */
export function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export function createAdmission({ normal = 128, callbacks = 32, streams = 512, uploads = 4 } = {}) {
  const active = { normal: 0, callbacks: 0, streams: 0, uploads: 0 };
  const caps = { normal, callbacks, streams, uploads };
  let draining = false;
  function middleware(req, res, next) {
    if (req.path === '/api/health') return next();
    if (!req.path.startsWith('/api/')) return next();
    const lane = req.path === '/api/casino/wallet' || req.path.startsWith('/api/webhooks/') || req.path.startsWith('/api/reserve/')
      ? 'callbacks' : req.path === '/api/payments/events'
        ? 'streams' : ['/api/sicilia/report', '/api/admin/dispute/open'].includes(req.path) ? 'uploads' : 'normal';
    if (draining || active[lane] >= caps[lane]) {
      res.set('Retry-After', '2');
      return res.status(503).json({ error: draining ? 'SERVER_DRAINING' : 'SERVER_BUSY', retryAfter: 2 });
    }
    active[lane]++;
    let released = false;
    const release = () => { if (!released) { released = true; active[lane]--; } };
    res.once('finish', release);
    res.once('close', release);
    next();
  }
  return { middleware, drain: () => { draining = true; }, snapshot: () => ({ ...active, draining }) };
}

export function createWorkLimit(limit = 4) {
  let active = 0;
  return async function run(fn) {
    if (active >= limit) throw Object.assign(new Error('Сервер занят. Повторите позже'), { status: 503, code: 'SERVER_BUSY' });
    active++;
    try { return await fn(); } finally { active--; }
  };
}

/** Await each run before scheduling the next; slow providers cannot pile up. */
export function serialInterval(fn, delay) {
  let stopped = false;
  let timer;
  const schedule = () => {
    timer = setTimeout(async () => {
      try { await fn(); } catch (err) { console.error('[background]', err.message); }
      finally { if (!stopped) schedule(); }
    }, delay);
    timer.unref();
  };
  schedule();
  return () => { stopped = true; clearTimeout(timer); };
}
