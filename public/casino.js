/**
 * Казино: лобби игр провайдеров, окно запуска и экран игры.
 *
 * Вид согласован с заказчиком по макету (tools/casino-concept.html): плитка
 * 3:4, на телефоне три в ряд, на компьютере столько, сколько влезает по 150+
 * точек, как у Stake и 1Win. Плитки не растягиваются на всю строку.
 *
 * Игру клиент не крутит и денег не считает: игра живёт у провайдера в окне
 * iframe, а каждое списание и начисление приходит на сервер вызовом кошелька
 * от агрегатора. Клиенту остаётся показать баланс, поэтому, пока игра
 * открыта, он раз в несколько секунд спрашивает /api/me.
 *
 * Модуль не импортирует app.js (круг импортов уронил бы оба файла): всё
 * нужное приходит в createCasino. Все имена внутри фабрики - автономная
 * сборка складывает модули клиента в одну область видимости.
 */

export function createCasino(deps) {
  const { api, esc, money, toast, haptic, state, onUser, plural } = deps;

  /* Сколько плиток за один запрос: восемь рядов по шесть на компьютере и
     шестнадцать по три на телефоне - целые ряды в обоих случаях. */
  const PAGE = 48;
  // Пока игра открыта, баланс обновляется так часто. Чаще незачем: ставка в
  // слоте раз в две-три секунды, а лишний запрос - лишняя батарея телефона.
  const BALANCE_POLL_MS = 4000;
  const SEARCH_DEBOUNCE_MS = 250;

  const KINDS = [
    { id: 'slots', label: 'Слоты' },
    { id: 'live', label: 'Живое казино' },
    { id: 'fast', label: 'Быстрые' },
  ];

  const ui = {
    lobby: null,
    kind: 'slots',
    provider: null,
    q: '',
    sort: 'popular',
    games: [],
    total: 0,
    loading: false,
    seq: 0,
    poll: 0,
    searchTimer: 0,
  };

  const $ = (id) => document.getElementById(id);
  const root = () => $('casinoRoot');

  /* ---------- Каркас ---------- */

  function shell() {
    return `
      <div class="cz-head" id="czHead"></div>
      <div class="cz-tabs" id="czTabs" role="tablist"></div>
      <div class="cz-provrow" id="czProviders"></div>
      <div class="cz-tools">
        <label class="cz-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input id="czQ" type="search" placeholder="Найти игру" autocomplete="off" enterkeyhint="search">
        </label>
        <div class="cz-chips" role="group" aria-label="Порядок">
          <button class="cz-chip" data-sort="popular" aria-pressed="true">Популярные</button>
          <button class="cz-chip" data-sort="az" aria-pressed="false">А-Я</button>
        </div>
      </div>
      <div class="cz-count"><h2 id="czListTitle">Все игры</h2><span id="czShown"></span></div>
      <div class="cz-grid" id="czGrid"></div>
      <div class="cz-empty" id="czEmpty" hidden></div>
      <div class="cz-more" id="czMore" hidden>
        <div class="cz-progress"><i id="czBar"></i></div>
        <small id="czMoreText"></small>
        <button type="button" id="czMoreBtn">Показать ещё</button>
      </div>`;
  }

  function bind() {
    const r = root();
    if (r.dataset.bound) return;
    r.dataset.bound = '1';

    r.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-kind]');
      if (tab) { haptic('light'); setKind(tab.dataset.kind); return; }
      const prov = e.target.closest('[data-provider]');
      if (prov) { haptic('light'); openProvider(prov.dataset.provider); return; }
      if (e.target.closest('[data-back]')) { haptic('light'); openProvider(null); return; }
      const sort = e.target.closest('[data-sort]');
      if (sort) {
        ui.sort = sort.dataset.sort;
        r.querySelectorAll('[data-sort]').forEach((b) => b.setAttribute('aria-pressed', String(b === sort)));
        reload();
        return;
      }
      if (e.target.closest('#czMoreBtn')) { loadMore(); return; }
      const tile = e.target.closest('.cz-tile');
      if (tile) openSheet(ui.games[Number(tile.dataset.i)]);
    });

    r.addEventListener('input', (e) => {
      if (e.target.id !== 'czQ') return;
      clearTimeout(ui.searchTimer);
      ui.searchTimer = setTimeout(() => { ui.q = e.target.value.trim(); reload(); }, SEARCH_DEBOUNCE_MS);
    });
  }

  /* ---------- Шапка: лобби или страница провайдера ---------- */

  const kindLabel = (k) => KINDS.find((x) => x.id === k)?.label || '';
  const monogram = (name) => name.split(/[\s-]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  function rtpLine(kind) {
    // У живых столов отдачу задаёт провайдер, наша настройка к ним не
    // применяется - и число мы не показываем, чтобы не приписать им своё.
    return kind === 'live' ? 'по правилам провайдера' : `${ui.lobby.rtp}%`;
  }

  function renderHead() {
    const head = $('czHead');
    const p = ui.provider;
    if (p) {
      head.innerHTML = `
        <div class="cz-crumbs">
          <button data-back>Казино</button><i>›</i><span>${esc(kindLabel(p.kind))}</span><i>›</i><b>${esc(p.name)}</b>
        </div>
        <div class="cz-hero">
          <div class="cz-mono">${esc(monogram(p.name))}</div>
          <div class="cz-hero-text">
            <h1>${esc(p.name)}</h1>
            <p>${p.count.toLocaleString('ru-RU')} ${plural(p.count, 'игра', 'игры', 'игр')}</p>
          </div>
          <div class="cz-rtp">отдача<b>${esc(rtpLine(p.kind))}</b></div>
        </div>`;
    } else {
      const total = Object.values(ui.lobby.counts).reduce((a, b) => a + b, 0);
      head.innerHTML = `
        <div class="cz-hero is-lobby">
          <div class="cz-hero-text">
            <h1>Казино</h1>
            <p>${total.toLocaleString('ru-RU')} ${plural(total, 'игра', 'игры', 'игр')} от ${ui.lobby.providers.length} провайдеров</p>
          </div>
          <div class="cz-rtp">отдача слотов<b>${ui.lobby.rtp}%</b></div>
        </div>`;
    }

    const tabs = $('czTabs');
    tabs.hidden = Boolean(p);
    tabs.innerHTML = KINDS.filter((k) => ui.lobby.counts[k.id] > 0).map((k) => `
      <button class="cz-tab" role="tab" data-kind="${k.id}" aria-selected="${k.id === ui.kind}">
        ${k.label}<span>${ui.lobby.counts[k.id].toLocaleString('ru-RU')}</span>
      </button>`).join('');

    const row = $('czProviders');
    row.hidden = Boolean(p);
    const list = ui.lobby.providers.filter((x) => x.kind === ui.kind);
    // У одного провайдера своя страница не нужна: она повторила бы вкладку.
    row.innerHTML = list.length > 1 ? list.map((x) => `
      <button class="cz-pcard" data-provider="${esc(x.id)}">
        <b>${esc(x.name)}</b><span>${x.count.toLocaleString('ru-RU')} ${plural(x.count, 'игра', 'игры', 'игр')}</span>
      </button>`).join('') : '';
    $('czListTitle').textContent = p ? 'Все игры' : kindLabel(ui.kind);
  }

  /* ---------- Сетка ---------- */

  function tileHtml(g, i) {
    // Горизонтальная запасная обложка не обрезается под 3:4: она стоит
    // целиком поверх своей же размытой копии. Обрезка съела бы название.
    const art = g.vertical
      ? `<img src="${g.cover}" alt="" loading="lazy" decoding="async">`
      : `<img class="cz-blur" src="${g.cover}" alt="" loading="lazy" decoding="async"><img class="cz-fit" src="${g.cover}" alt="" loading="lazy" decoding="async">`;
    return `<button class="cz-tile" data-i="${i}" data-game="${esc(g.id)}">
      <span class="cz-art${g.vertical ? '' : ' is-wide'}">
        ${art}
        <span class="cz-hover">
          <span class="cz-play"><svg width="20" height="20" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#3a1d00"/></svg></span>
        </span>
      </span>
      <span class="cz-name">${esc(g.name)}</span>
      ${ui.provider ? '' : `<span class="cz-prov">${esc(g.provider)}</span>`}
    </button>`;
  }

  function renderGrid(fromIndex = 0) {
    const grid = $('czGrid');
    const html = ui.games.slice(fromIndex).map((g, k) => tileHtml(g, fromIndex + k)).join('');
    if (fromIndex === 0) grid.innerHTML = html;
    else grid.insertAdjacentHTML('beforeend', html);

    const shown = ui.games.length;
    $('czShown').textContent = ui.total ? `${shown.toLocaleString('ru-RU')} из ${ui.total.toLocaleString('ru-RU')}` : '';
    const empty = $('czEmpty');
    empty.hidden = ui.total > 0 || ui.loading;
    empty.textContent = ui.q ? `По запросу «${ui.q}» ничего нет` : 'Игр пока нет';
    const more = $('czMore');
    more.hidden = shown >= ui.total;
    $('czMoreText').textContent = `Показано ${shown.toLocaleString('ru-RU')} из ${ui.total.toLocaleString('ru-RU')}`;
    $('czBar').style.width = `${ui.total ? Math.max(2, (shown / ui.total) * 100) : 0}%`;
  }

  function skeleton() {
    $('czGrid').innerHTML = Array.from({ length: 12 }, () =>
      '<span class="cz-tile cz-skel"><span class="cz-art skel"></span><span class="cz-name skel"></span></span>').join('');
    $('czMore').hidden = true;
    $('czEmpty').hidden = true;
  }

  async function fetchPage(offset) {
    return api('/api/casino/games', {
      kind: ui.provider ? ui.provider.kind : ui.kind,
      provider: ui.provider?.id || '',
      q: ui.q,
      sort: ui.sort,
      offset,
      limit: PAGE,
    });
  }

  /*
   * Ответы на устаревшие запросы отбрасываются по номеру: игрок, быстро
   * перещёлкнувший вкладки, иначе увидел бы сетку той вкладки, ответ на
   * которую пришёл последним, а не той, на которой он стоит.
   */
  async function reload() {
    const seq = ++ui.seq;
    ui.loading = true;
    skeleton();
    try {
      const data = await fetchPage(0);
      if (seq !== ui.seq) return;
      ui.games = data.games;
      ui.total = data.total;
      ui.loading = false;
      renderGrid(0);
    } catch (err) {
      if (seq !== ui.seq) return;
      ui.loading = false;
      $('czGrid').innerHTML = '';
      toast(err.message);
    }
  }

  async function loadMore() {
    if (ui.loading || ui.games.length >= ui.total) return;
    const seq = ui.seq;
    ui.loading = true;
    const btn = $('czMoreBtn');
    btn.disabled = true;
    try {
      const data = await fetchPage(ui.games.length);
      if (seq !== ui.seq) return;
      const from = ui.games.length;
      ui.games = ui.games.concat(data.games);
      ui.total = data.total;
      renderGrid(from);
    } catch (err) {
      toast(err.message);
    } finally {
      ui.loading = false;
      btn.disabled = false;
    }
  }

  function setKind(kind) {
    if (ui.kind === kind && !ui.provider) return;
    ui.kind = kind;
    ui.provider = null;
    renderHead();
    reload();
  }

  function openProvider(id) {
    ui.provider = id ? ui.lobby.providers.find((p) => p.id === id) || null : null;
    if (ui.provider) ui.kind = ui.provider.kind;
    renderHead();
    reload();
    window.scrollTo({ top: 0 });
  }

  /* ---------- Вход в раздел ---------- */

  async function open() {
    const r = root();
    if (!r.firstChild) r.innerHTML = shell();
    bind();
    if (!ui.lobby) {
      skeleton();
      try {
        ui.lobby = await api('/api/casino/lobby');
      } catch (err) {
        toast(err.message);
        return;
      }
    }
    renderHead();
    if (!ui.games.length) reload();
  }

  /* ---------- Окно запуска ---------- */

  function openSheet(g) {
    if (!g) return;
    haptic('light');
    const sheet = $('czSheet');
    $('czSheetArt').style.backgroundImage = `url("${g.wide || g.cover}")`;
    $('czSheetArt').classList.toggle('is-cover', !g.wide);
    $('czSheetName').textContent = g.name;
    $('czSheetProv').textContent = g.provider;
    $('czSheetRtp').textContent = g.rtp ? `${g.rtp}%` : 'по правилам провайдера';
    const demo = $('czDemo');
    demo.hidden = !g.demo;
    demo.onclick = () => launch(g, true);
    $('czPlay').onclick = () => launch(g, false);
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('is-in'));
  }

  function closeSheet() {
    const sheet = $('czSheet');
    sheet.classList.remove('is-in');
    sheet.hidden = true;
  }

  /* ---------- Экран игры ---------- */

  async function launch(g, demo) {
    const btn = demo ? $('czDemo') : $('czPlay');
    btn.disabled = true;
    try {
      const data = await api('/api/casino/launch', { gameId: g.id, demo });
      closeSheet();
      openFrame(g, data, demo);
    } catch (err) {
      toast(err.message);
      haptic('error');
    } finally {
      btn.disabled = false;
    }
  }

  function renderFrameBalance() {
    const el = $('czFrameBalance');
    if (el && state.user) el.textContent = money(state.user.balance);
  }

  async function refreshUser() {
    try {
      const { user } = await api('/api/me');
      onUser(user);
      renderFrameBalance();
    } catch { /* сеть моргнула - следующий опрос поправит */ }
  }

  function openFrame(g, data, demo) {
    const frame = $('czFrame');
    $('czFrameName').textContent = demo ? `${g.name} · демо` : g.name;
    renderFrameBalance();
    const host = $('czFrameHost');
    host.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.className = 'cz-iframe';
    iframe.setAttribute('allow', 'autoplay; fullscreen; clipboard-write; encrypted-media');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    // Агрегатор отдаёт либо адрес, либо готовый HTML - одно из двух.
    if (data.url) iframe.src = data.url;
    else iframe.srcdoc = data.html || '';
    host.append(iframe);
    frame.hidden = false;
    document.body.classList.add('cz-playing');
    clearInterval(ui.poll);
    if (!demo) ui.poll = setInterval(refreshUser, BALANCE_POLL_MS);
  }

  function closeFrame() {
    const frame = $('czFrame');
    if (frame.hidden) return;
    clearInterval(ui.poll);
    ui.poll = 0;
    // Окно игры удаляется целиком, а не прячется: иначе звук игры и её
    // запросы шли бы дальше в невидимом iframe.
    $('czFrameHost').innerHTML = '';
    frame.hidden = true;
    document.body.classList.remove('cz-playing');
    refreshUser();
  }

  function bindOverlays() {
    const sheet = $('czSheet');
    if (sheet.dataset.bound) return;
    sheet.dataset.bound = '1';
    sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
    $('czFrameClose').addEventListener('click', () => { haptic('light'); closeFrame(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !sheet.hidden) closeSheet();
    });
  }

  return {
    open() { bindOverlays(); return open(); },
    close() { closeSheet(); closeFrame(); },
    /** Открыта ли сейчас игра: пока да, остальной интерфейс не трогаем. */
    playing: () => !$('czFrame').hidden,
  };
}
