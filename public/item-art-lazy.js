/**
 * Те же рисунки, что в item-art-hd.js, но темы загружаются по необходимости.
 * Плюшки нужны на разных экранах сразу и остаются в маленьком общем наборе.
 * Перед построением карточек вызывающий обязан дождаться preloadItemArt.
 */
import { hdKit } from './hd/kit.js';
import { hdSpecial } from './hd/special.js';

const ART_LOADERS = {
  arctic: () => import('./hd/arctic.js').then((m) => m.HD_ARCTIC),
  atom: () => import('./hd/atom.js').then((m) => m.HD_ATOM),
  braavos: () => import('./hd/braavos.js').then((m) => m.HD_BRAAVOS),
  casino: () => import('./hd/casino.js').then((m) => m.HD_CASINO),
  circus: () => import('./hd/circus.js').then((m) => m.HD_CIRCUS),
  crystal: () => import('./hd/crystal.js').then((m) => m.HD_CRYSTAL),
  cyber: () => import('./hd/cyber.js').then((m) => m.HD_CYBER),
  deepsea: () => import('./hd/deepsea.js').then((m) => m.HD_DEEPSEA),
  desert: () => import('./hd/desert.js').then((m) => m.HD_DESERT),
  dragon: () => import('./hd/dragon.js').then((m) => m.HD_DRAGON),
  dubai: () => import('./hd/dubai.js').then((m) => m.HD_DUBAI),
  forge: () => import('./hd/forge.js').then((m) => m.HD_FORGE),
  fortress: () => import('./hd/fortress.js').then((m) => m.HD_FORTRESS),
  galaxy: () => import('./hd/galaxy.js').then((m) => m.HD_GALAXY),
  garage: () => import('./hd/garage.js').then((m) => m.HD_GARAGE),
  goldmine: () => import('./hd/goldmine.js').then((m) => m.HD_GOLDMINE),
  highgarden: () => import('./hd/highgarden.js').then((m) => m.HD_HIGHGARDEN),
  monaco: () => import('./hd/monaco.js').then((m) => m.HD_MONACO),
  neon: () => import('./hd/neon.js').then((m) => m.HD_NEON),
  noir: () => import('./hd/noir.js').then((m) => m.HD_NOIR),
  orbit: () => import('./hd/orbit.js').then((m) => m.HD_ORBIT),
  pharaoh: () => import('./hd/pharaoh.js').then((m) => m.HD_PHARAOH),
  phoenix: () => import('./hd/phoenix.js').then((m) => m.HD_PHOENIX),
  pirate: () => import('./hd/pirate.js').then((m) => m.HD_PIRATE),
  racing: () => import('./hd/racing.js').then((m) => m.HD_RACING),
  rio: () => import('./hd/rio.js').then((m) => m.HD_RIO),
  royal: () => import('./hd/royal.js').then((m) => m.HD_ROYAL),
  rune: () => import('./hd/rune.js').then((m) => m.HD_RUNE),
  samurai: () => import('./hd/samurai.js').then((m) => m.HD_SAMURAI),
  santorini: () => import('./hd/santorini.js').then((m) => m.HD_SANTORINI),
  shadow: () => import('./hd/shadow.js').then((m) => m.HD_SHADOW),
  singapore: () => import('./hd/singapore.js').then((m) => m.HD_SINGAPORE),
  steampunk: () => import('./hd/steampunk.js').then((m) => m.HD_STEAMPUNK),
  street: () => import('./hd/street.js').then((m) => m.HD_STREET),
  toxic: () => import('./hd/toxic.js').then((m) => m.HD_TOXIC),
  vampire: () => import('./hd/vampire.js').then((m) => m.HD_VAMPIRE),
  vault: () => import('./hd/vault.js').then((m) => m.HD_VAULT),
  vegas: () => import('./hd/vegas.js').then((m) => m.HD_VEGAS),
  volcano: () => import('./hd/volcano.js').then((m) => m.HD_VOLCANO),
  westeros: () => import('./hd/westeros.js').then((m) => m.HD_WESTEROS),
  winterfell: () => import('./hd/winterfell.js').then((m) => m.HD_WINTERFELL),
};
const loadedArt = new Map();
const pendingArt = new Map();
const artAttempts = new Map();

function artThemes(items) {
  return [...new Set(items.map((item) => String(item?.art || '').split('/')[0])
    .filter((theme) => Object.hasOwn(ART_LOADERS, theme)))];
}

export function itemArtReady(items) {
  return artThemes(items).every((theme) => loadedArt.has(theme));
}

/** Один запрос на тему, даже если её одновременно требуют кейс и лента. */
export async function preloadItemArt(items) {
  await Promise.all(artThemes(items).map((theme) => {
    if (loadedArt.has(theme)) return;
    if (!pendingArt.has(theme)) {
      const attempt = artAttempts.get(theme) || 0;
      artAttempts.set(theme, attempt + 1);
      // Браузер помнит отказ import по URL. Новый URL позволяет повторить
      // загрузку после обрыва сети; theme берётся только из ART_LOADERS.
      const retrySource = `${typeof __LB_ART_BASE__ === 'undefined' ? './hd/' : __LB_ART_BASE__}${theme}.js?retry=${attempt}`;
      const loading = attempt === 0 ? ART_LOADERS[theme]()
        : import(retrySource).then((m) => m[`HD_${theme.toUpperCase()}`]);
      const job = loading.then((draws) => {
        loadedArt.set(theme, draws);
        globalThis.document?.dispatchEvent?.(new Event('lb:art-ready'));
      }).finally(() => pendingArt.delete(theme));
      pendingArt.set(theme, job);
    }
    return pendingArt.get(theme);
  }));
}

// Keep the bounded template cache used by the original registry. Generating
// the same complex SVG on every reel tile caused avoidable work each spin.
const lazyArtTemplates = new Map();
let lazyArtInstance = 0;

/** Original SVGs, with unique gradient and clip namespaces for each tile. */
export function itemArtHd(key) {
  if (!key) return null;
  let template = lazyArtTemplates.get(key);
  if (!template) {
    const [theme, idx] = String(key).split('/');
    const draw = theme === 'perk' || theme === 'jackpot'
      ? hdSpecial(key) : loadedArt.get(theme)?.[Number(idx)];
    if (!draw) return null;
    const k = hdKit('__hd_instance__');
    template = k.svg(draw(k));
    if (lazyArtTemplates.size >= 128) lazyArtTemplates.delete(lazyArtTemplates.keys().next().value);
    lazyArtTemplates.set(key, template);
  }
  return template.replace(/__hd_instance__/g, `hd_lazy_${lazyArtInstance++}_`);
}

/** Фон идёт по одной теме и уступает сети выбранного пользователем кейса. */
export function warmItemArt(cases) {
  if (globalThis.navigator?.connection?.saveData) return;
  const themes = artThemes(cases.flatMap((c) => c.items || []));
  let index = 0;
  const step = async () => {
    if (index >= themes.length) return;
    if (document.hidden || document.body.classList.contains('case-open')
        || !document.getElementById('caseLoader').hidden) {
      setTimeout(step, 1000);
      return;
    }
    const theme = themes[index++];
    try { await preloadItemArt([{ art: `${theme}/0` }]); } catch { /* Повтор при открытии кейса. */ }
    setTimeout(step, 350);
  };
  setTimeout(step, 2500);
}
