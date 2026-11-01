/** Реальный браузерный замер без кеша и повторно, без ставок и изменения аккаунта. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = process.argv[2];
if (!target || !/^https?:\/\//.test(target)) {
  throw new Error('Запуск: node tools/measure-startup.mjs https://домен [папка отчёта]');
}
const output = resolve(process.argv[3] || '/tmp/luckybox-startup-measure');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const profile of [
    { name: 'desktop', viewport: { width: 1440, height: 900 }, latency: 0, cpu: 1 },
    { name: 'mobile', viewport: { width: 390, height: 844 }, latency: 120, cpu: 4 },
  ]) {
    for (let run = 1; run <= 3; run++) {
      const context = await browser.newContext({ viewport: profile.viewport, isMobile: profile.name === 'mobile' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.clearBrowserCache');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
      if (profile.latency) {
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false, latency: profile.latency,
          downloadThroughput: 3_000_000 / 8, uploadThroughput: 1_500_000 / 8,
          connectionType: 'cellular4g',
        });
      }
      await page.addInitScript(() => {
        window.__startupMeasure = { longTasks: [], lcp: null };
        for (const type of ['longtask', 'largest-contentful-paint']) {
          try {
            new PerformanceObserver((list) => {
              for (const e of list.getEntries()) {
                if (type === 'longtask') window.__startupMeasure.longTasks.push({ start: e.startTime, duration: e.duration });
                else window.__startupMeasure.lcp = e.startTime;
              }
            }).observe({ type, buffered: true });
          } catch { /* Не все браузеры поддерживают эти записи. */ }
        }
        const observer = new MutationObserver(() => {
          if (document.querySelector('.case-card') && !document.getElementById('bootStatus')) {
            performance.mark('startup:cases-ready'); observer.disconnect();
          }
        });
        observer.observe(document, { subtree: true, childList: true });
      });
      for (const cache of ['empty', 'warm']) {
        if (cache === 'empty') await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
        else await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => performance.getEntriesByName('startup:cases-ready').length > 0, null, { timeout: 60000 });
        const initial = await page.evaluate(() => {
          const n = performance.getEntriesByType('navigation')[0];
          const ready = performance.getEntriesByName('startup:cases-ready')[0].startTime;
          return {
            casesReadyMs: ready, ttfbMs: n.responseStart - n.startTime,
            dnsMs: n.domainLookupEnd - n.domainLookupStart,
            connectMs: n.connectEnd - n.connectStart,
            domContentLoadedMs: n.domContentLoadedEventEnd,
            paints: performance.getEntriesByType('paint').map((e) => ({ name: e.name, ms: e.startTime })),
            ...window.__startupMeasure,
            resources: performance.getEntriesByType('resource').filter((e) => e.startTime < ready).map((e) => ({
              path: new URL(e.name).pathname, type: e.initiatorType,
              startMs: e.startTime, durationMs: e.duration, transferBytes: e.transferSize, decodedBytes: e.decodedBodySize,
            })),
          };
        });
        const result = { profile: profile.name, run, cache, ...initial, errors: [...errors] };
        results.push(result);
        writeFileSync(resolve(output, 'measurements.json'), JSON.stringify(results, null, 2));
        console.log(JSON.stringify({ profile: profile.name, run, cache, casesReadyMs: Math.round(initial.casesReadyMs), ttfbMs: Math.round(initial.ttfbMs) }));
        if (run === 1) {
          await page.evaluate(async () => {
            await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 5000))]);
            await Promise.race([Promise.all([...document.images].filter((img) => {
              const r = img.getBoundingClientRect(); return r.width && r.height && r.top < innerHeight && r.bottom > 0;
            }).map((img) => img.decode().catch(() => {}))), new Promise((r) => setTimeout(r, 5000))]);
          });
          await page.screenshot({ path: resolve(output, `${profile.name}-${cache}.png`), animations: 'disabled' });
        }
      }
      await context.close();
    }
  }
} finally { await browser.close(); }
console.log(`Отчёт и снимки: ${output}`);
