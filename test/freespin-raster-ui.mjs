import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { itemArtHd } from '../public/item-art-hd.js';
const output = process.env.MOTION_RESULTS || '/tmp/luckybox-freespin-results';
mkdirSync(output, { recursive: true });
const emblem = itemArtHd('perk/fs/20');
assert.ok(emblem.includes('<svg'), 'Use the real filtered emblem, not a simplified fixture');
const reports = [];
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/motion.js' || path === '/styles.css') return route.fulfill({
        contentType: path.endsWith('.js') ? 'text/javascript' : 'text/css',
        body: readFileSync(new URL('../public' + path, import.meta.url), 'utf8'),
      });
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><link rel="stylesheet" href="/styles.css"><div class="opener-scroll" style="height:100vh"></div><div id="emblem" style="position:absolute;left:10px;top:10px;width:40px;height:40px"></div><div id="pips" style="position:absolute;top:70px;display:flex"></div><script type="module">import {createMotion} from '/motion.js'; window.motion=createMotion({money:String,artFor:()=>'',tierColor:()=> '#ffd34d',snd:{}});</script>` });
    });
    await page.goto('http://motion.test/'); await page.waitForFunction(() => window.motion);
    await page.evaluate(() => {
      window.startScene = (count, emblem) => {
        window.tokens = []; window.prepared = 0; window.complete = false; window.samples = [];
        let last = performance.now();
        const sample = now => { window.samples.push(now - last); last = now; if (!window.complete) requestAnimationFrame(sample); };
        requestAnimationFrame(sample);
        document.querySelector('#pips').innerHTML = '<i style="display:block;width:10px;height:10px"></i>'.repeat(count);
        window.scene = window.motion.purchase({ count, emblem, prepare: () => {
          window.prepared++;
          return { emblem: document.querySelector('#emblem'), pips: [...document.querySelector('#pips').children], onToken: i => window.tokens.push(i) };
        }}).then(() => { window.complete = true; });
      };
    });
    for (const count of [10, 20, 30]) {
      await page.evaluate(({count,emblem}) => window.startScene(count,emblem), {count,emblem});
      await page.waitForSelector('.mo-fs-raster');
      assert.equal(await page.locator('.mo-fs-raster svg, .mo-tok svg').count(), 0, 'Moving layers must contain no SVG');
      assert.equal(await page.locator('.mo-fs-raster .mo-metal').count(), 0, 'Moving title must contain no filtered text');
      assert.equal(await page.locator('.mo-metal-bitmap').count(), 3);
      await page.screenshot({path: `${output}/${name}-${count}.png`});
      await page.waitForFunction(() => window.complete, null, {timeout: 15000});
      const result = await page.evaluate(() => ({ tokens: window.tokens, prepared: window.prepared,
        nodes: document.querySelectorAll('.mo-layer > *, .mo-top > *').length,
        receded: document.body.classList.contains('mo-receded'),
        animations: document.querySelector('.mo-root').getAnimations({subtree:true}).length,
        frames: window.samples.length, slowFrames: window.samples.filter(n => n > 34).length,
      }));
      assert.deepEqual(result.tokens, Array.from({length:count}, (_,i) => i));
      assert.equal(result.prepared, 1); assert.equal(result.nodes, 0); assert.equal(result.receded, false); assert.equal(result.animations, 0);
      reports.push({engine:name, count, ...result});
    }
    for (const delay of [0, 400, 1600, 3400, 5200]) {
      await page.evaluate(({emblem,delay}) => {
        window.startScene(30,emblem);
        setTimeout(() => window.motion.reset(), delay);
      }, {emblem,delay});
      await page.waitForFunction(() => window.complete, null, {timeout:15000});
      const before = await page.evaluate(() => window.tokens.length);
      await page.waitForTimeout(1100);
      assert.equal(await page.evaluate(() => window.tokens.length), before, 'Cancelled callbacks must not refill pips');
      assert.equal(await page.locator('.mo-layer > *, .mo-top > *').count(), 0);
      assert.equal(await page.evaluate(() => document.body.classList.contains('mo-receded')), false);
      assert.notEqual(await page.locator('#emblem').evaluate(el => el.style.visibility), 'hidden');
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    // createMotion captures the preference once, as the app does.
    await page.reload(); await page.waitForFunction(() => window.motion);
    await page.evaluate(emblem => window.motion.purchase({count:10,emblem,prepare:()=>({pips:[]})}), emblem);
    assert.equal(await page.locator('.mo-layer > *, .mo-top > *').count(), 0);
    assert.deepEqual(errors, []);
    console.log(`${name}: full touch scene 10/20/30, raster layers, exact tokens, cancellation at five stages, reduced motion passed`);
  } finally { await browser.close(); }
}
writeFileSync(`${output}/report.json`, JSON.stringify(reports,null,2));
