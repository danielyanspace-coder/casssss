/**
 * Кабинет партнёра и его админка: /partners.
 *
 * Отдельная страница, но вход общий с сайтом: та же cookie-сессия, та же
 * почта и пароль (/api/auth/login). Что показать, решает ответ /api/pc/me:
 * партнёру - его кабинет, сотруднику - разделы по его правам. Права здесь
 * только прячут разделы; защищает сервер, need() на каждой ручке.
 *
 * Сотруднику разделы админа открываются после подтверждения входа в
 * Telegram, как и в панели сайта: те же ручки /api/admin/2fa/*.
 */

const S = {
  me: null,
  tab: '',
  days: 30,
  fin: { days: 30, day: '' },
  reqStatus: 'pending',
  gatePoll: 0,
};

const $ = (id) => document.getElementById(id);
const app = $('app');

/* ---------- Форматирование ---------- */

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const fmt = (n) => nf.format(Number(n) || 0);
const rub = (n) => `${fmt(n)} ₽`;
const signedRub = (n) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${fmt(Math.abs(n))} ₽`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = (t) => (t ? new Date(t).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '');
const dateTime = (t) => (t ? new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const can = (perm) => !!S.me?.staff?.permissions?.includes(perm);
const plural = (n, a, b, c) => {
  const m10 = n % 10; const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c;
};

/* ---------- Сеть ---------- */

async function api(path, body = {}) {
  const res = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const err = Object.assign(new Error(data?.error || `Ошибка ${res.status}`), { status: res.status, code: data?.code });
    if (res.status === 401) { S.me = null; renderAuth(); }
    throw err;
  }
  return data;
}

let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function openSheet(html, wide = false) {
  const body = $('sheetBody');
  body.className = `sheet${wide ? ' wide' : ''}`;
  body.innerHTML = html;
  $('sheet').hidden = false;
  return body;
}
function closeSheet() { $('sheet').hidden = true; $('sheetBody').innerHTML = ''; }
$('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Скопировано'); }
  catch { toast(text); }
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Запуск ---------- */

async function boot() {
  try {
    S.me = await api('/api/pc/me');
  } catch (err) {
    if (err.status !== 401) app.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    return;
  }
  renderShell();
}

function tabsFor(me) {
  const t = [];
  if (me.partner) t.push(['cabinet', 'Кабинет']);
  if (me.staff) {
    if (can('partners.view')) t.push(['overview', 'Обзор'], ['partners', 'Партнёры'], ['requests', 'Заявки']);
    if (can('finance.reports')) t.push(['finance', 'Финансы']);
    if (can('settings.manage')) t.push(['settings', 'Настройки']);
  }
  return t;
}

function renderShell() {
  const me = S.me;
  $('barRight').hidden = false;
  $('who').textContent = me.partner?.name ? `${me.partner.name} · ${me.user.email || ''}` : (me.user.email || me.user.nick || '');
  const tabs = tabsFor(me);
  if (!tabs.length) { $('tabs').hidden = true; renderJoin(); return; }
  if (!tabs.some(([id]) => id === S.tab)) S.tab = tabs[0][0];
  const nav = $('tabs');
  nav.hidden = tabs.length < 2;
  nav.innerHTML = tabs.map(([id, name]) => `<button class="tab ${id === S.tab ? 'on' : ''}" data-tab="${id}" type="button">
      ${esc(name)}${id === 'requests' ? '<span class="dot" id="reqDot" hidden></span>' : ''}</button>`).join('');
  nav.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.tab; renderShell(); }; });
  renderTab();
}

function renderTab() {
  clearInterval(S.gatePoll);
  const admin = S.tab !== 'cabinet';
  if (admin && needsGate()) { renderGate(); return; }
  ({
    cabinet: () => renderCabinet(),
    overview: renderOverview,
    partners: renderPartners,
    requests: renderRequests,
    finance: renderFinance,
    settings: renderSettings,
  }[S.tab] || (() => {}))();
  if (admin && can('partners.view')) refreshReqDot();
}

function needsGate() {
  const tf = S.me?.staff?.twoFactor;
  return !!(tf && tf.required && !tf.confirmed);
}

async function refreshReqDot() {
  try {
    const d = await api('/api/pc/admin/payouts', { status: 'pending' });
    const dot = $('reqDot');
    if (dot) { dot.textContent = d.rows.length; dot.hidden = !d.rows.length; }
  } catch { /* число на вкладке - удобство */ }
}

$('logout').onclick = async () => {
  try { await api('/api/auth/logout'); } catch { /* выходим всё равно */ }
  S.me = null;
  renderAuth();
};

/* ============================================================
   ВХОД
   ============================================================ */

function renderAuth(mode = 'login') {
  $('barRight').hidden = true;
  $('tabs').hidden = true;
  const reg = mode === 'register';
  app.innerHTML = `
    <div class="auth bento">
      <section class="tile pitch span-7">
        <h3>Партнёрская программа</h3>
        <h1>Приводите игроков.<br>Получайте половину дохода.</h1>
        <p class="note">Ваш промокод дарит новичку бесплатный кейс и прибавку к первому пополнению. Каждый игрок,
          зарегистрированный по коду, закрепляется за вами навсегда.</p>
        <div class="pts">
          <div class="pt"><b>50%</b><span>дохода с ваших игроков, пожизненно</span></div>
          <div class="pt"><b>USDT</b><span>вывод на TRC20, ERC20 или BEP20</span></div>
          <div class="pt"><b>24/7</b><span>статистика по дням, кодам и игрокам</span></div>
        </div>
      </section>
      <section class="tile span-5">
        <div class="switch chips">
          <button class="chip ${reg ? '' : 'on'}" data-mode="login" type="button">Вход</button>
          <button class="chip ${reg ? 'on' : ''}" data-mode="register" type="button">Регистрация</button>
        </div>
        <form id="authForm" autocomplete="on">
          ${reg ? `
          <label class="field"><span>Имя или название команды</span><input class="input" name="name" maxlength="60" required></label>
          <label class="field"><span>Telegram для связи</span><input class="input" name="contact" maxlength="80" placeholder="@username"></label>` : ''}
          <label class="field"><span>Почта</span><input class="input" name="email" type="email" autocomplete="email" required></label>
          <label class="field"><span>Пароль</span><input class="input" name="password" type="password" minlength="8"
            autocomplete="${reg ? 'new-password' : 'current-password'}" required></label>
          <div class="form-err" id="authErr"></div>
          <button class="btn wide" type="submit">${reg ? 'Стать партнёром' : 'Войти'}</button>
        </form>
        <p class="note" style="margin-top:14px">${reg
          ? 'Уже играете на LUCKYBOX? Войдите своим аккаунтом и нажмите «Стать партнёром».'
          : 'Тот же вход, что на сайте. Забыли пароль? Восстановите его <a href="/">на сайте</a>.'}</p>
      </section>
    </div>`;
  app.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => renderAuth(b.dataset.mode); });
  $('authForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    $('authErr').textContent = '';
    try {
      await api(reg ? '/api/pc/register' : '/api/auth/login', f);
      await boot();
    } catch (err) {
      $('authErr').textContent = err.message;
      btn.disabled = false;
    }
  };
}

function renderJoin() {
  const open = S.me.rules?.signupOpen;
  app.innerHTML = `
    <div class="auth bento">
      <section class="tile pitch span-7">
        <h3>Партнёрская программа</h3>
        <h1>Ваш аккаунт ещё не партнёрский</h1>
        <p class="note">Партнёр получает свой промокод и долю дохода с игроков, которых привёл. Это тот же аккаунт,
          что на сайте: отдельный пароль не нужен.</p>
      </section>
      <section class="tile span-5">
        ${open ? `
        <form id="joinForm">
          <label class="field"><span>Имя или название команды</span><input class="input" name="name" maxlength="60" value="${esc(S.me.user.nick)}" required></label>
          <label class="field"><span>Telegram для связи</span><input class="input" name="contact" maxlength="80" placeholder="@username"></label>
          <div class="form-err" id="joinErr"></div>
          <button class="btn wide" type="submit">Стать партнёром</button>
        </form>` : '<p class="note">Набор партнёров сейчас закрыт. Напишите в поддержку сайта.</p>'}
      </section>
    </div>`;
  const form = $('joinForm');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/api/pc/join', Object.fromEntries(new FormData(e.target))); await boot(); }
      catch (err) { $('joinErr').textContent = err.message; }
    };
  }
}

/* ============================================================
   ПОДТВЕРЖДЕНИЕ ВХОДА СОТРУДНИКА
   ============================================================ */

function renderGate() {
  const tf = S.me.staff.twoFactor;
  app.innerHTML = `
    <div class="bento"><section class="tile span-6" style="grid-column-start:auto">
      <h3>Админ</h3>
      ${tf.linked ? `
        <div class="mid">Подтвердите вход</div>
        <p class="note">Отправим запрос в служебного бота${tf.bot ? ` <b>@${esc(tf.bot)}</b>` : ''}. Нажмите там «Это я»,
          и разделы откроются сами. Не пришло - введите код из сообщения.</p>
        <div class="hero-actions"><button class="btn" id="gSend" type="button">Отправить запрос в Telegram</button></div>
        <div id="gWait" hidden style="margin-top:14px">
          <p class="note" id="gStatus">Ждём подтверждения...</p>
          <div class="row"><input class="input" id="gCode" inputmode="numeric" maxlength="6" placeholder="Код из сообщения">
            <button class="btn alt" id="gCodeBtn" type="button">Подтвердить</button></div>
        </div>` : `
        <div class="mid">Привяжите Telegram</div>
        <p class="note">Вход в админку подтверждается в служебном боте. Откройте его и нажмите Start.</p>
        <div class="hero-actions"><button class="btn" id="gLink" type="button">Открыть служебного бота</button>
          <button class="btn alt" id="gDone" type="button">Я нажал Start</button></div>`}
    </section></div>`;
  const recheck = async () => { S.me = await api('/api/pc/me'); renderShell(); };
  if (!tf.linked) {
    $('gLink').onclick = async () => {
      try { const { url } = await api('/api/admin/2fa/link'); window.open(url, '_blank', 'noopener'); }
      catch (err) { toast(err.message); }
    };
    $('gDone').onclick = recheck;
    return;
  }
  let challenge = 0;
  $('gSend').onclick = async () => {
    try {
      challenge = (await api('/api/admin/2fa/request')).id;
      $('gWait').hidden = false;
      clearInterval(S.gatePoll);
      S.gatePoll = setInterval(async () => {
        try {
          const p = await api('/api/admin/2fa/poll', { id: challenge });
          if (p.confirmed) { clearInterval(S.gatePoll); recheck(); }
          else if (p.status === 'denied') { clearInterval(S.gatePoll); $('gStatus').textContent = 'Вход отклонён в Telegram.'; }
          else if (p.status === 'expired' || p.status === 'burned') { clearInterval(S.gatePoll); $('gStatus').textContent = 'Запрос устарел, отправьте новый.'; }
        } catch { /* следующий опрос */ }
      }, 2500);
    } catch (err) { toast(err.message); }
  };
  $('gCodeBtn').onclick = async () => {
    try { await api('/api/admin/2fa/code', { id: challenge, code: $('gCode').value }); recheck(); }
    catch (err) { $('gStatus').textContent = err.message; }
  };
}

/* ============================================================
   КАБИНЕТ ПАРТНЁРА
   ============================================================ */

const STATUS = {
  pending: ['wait', 'В обработке'], paid: ['ok', 'Выплачено'], rejected: ['bad', 'Отклонено'],
};

function daysChips(current, attr = 'data-days') {
  return `<div class="chips">${[7, 30, 90, 365].map((d) => `<button class="chip ${d === current ? 'on' : ''}" ${attr}="${d}" type="button">${d === 365 ? 'год' : `${d} дн`}</button>`).join('')}</div>`;
}

function barsHtml(series, key, label) {
  const max = Math.max(1, ...series.map((s) => Math.max(0, s[key])));
  return `<div class="bars">${series.map((s) => {
    const v = Math.max(0, s[key]);
    return `<i class="${v > 0 ? 'v' : ''}" style="height:${Math.max(2, Math.round(v / max * 100))}%" data-t="${esc(s.day.slice(5))}: ${esc(label(v))}"></i>`;
  }).join('')}</div>
  <div class="bars-axis"><span>${esc(series[0]?.day.slice(5) || '')}</span><span>${esc(series.at(-1)?.day.slice(5) || '')}</span></div>`;
}

/**
 * Кабинет. adminView - тот же кабинет глазами админа (из списка партнёров):
 * деньги те же, плюс управление долями и статусом.
 */
async function renderCabinet(adminView = null) {
  const target = adminView ? openSheet('<div class="skel tile"></div>', true) : app;
  if (!adminView) app.innerHTML = '<div class="bento"><div class="tile span-12 skel"></div></div>';
  let d;
  try {
    d = adminView
      ? await api('/api/pc/admin/partner', { id: adminView, days: S.days })
      : await api('/api/pc/dashboard', { days: S.days });
  } catch (err) { target.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  const b = d.balance;
  const link = (code) => `${location.origin}/?promo=${encodeURIComponent(code)}`;
  const blocked = d.partner.status !== 'active';

  target.innerHTML = `
    ${adminView ? `<div class="sheet-head"><div><h2>${esc(d.partner.name || `Партнёр #${d.partner.id}`)}</h2>
      <p class="note">#${d.partner.id} · ${esc(d.partner.email || 'без почты')} · ${esc(d.partner.contact || 'контакт не указан')} · с ${date(d.partner.createdAt)}</p></div>
      <button class="ghost" id="shClose" type="button">Закрыть</button></div>` : ''}
    <div class="bento">
      <section class="tile hero span-7">
        <h3>Доступно к выводу</h3>
        <div class="big pos">${rub(b.available)}</div>
        <div class="hero-row">
          <span>Начислено всего <b>${rub(b.accrued)}</b></span>
          <span>Выплачено <b>${rub(b.paid)}</b></span>
          ${b.pending ? `<span>В обработке <b>${rub(b.pending)}</b></span>` : ''}
          <span>Сегодня <b>${rub(b.today)}</b></span>
        </div>
        ${adminView ? '' : `<div class="hero-actions">
          <button class="btn" id="wdBtn" type="button" ${blocked || b.available < d.rules.minWithdraw ? 'disabled' : ''}>Вывести в USDT</button>
        </div>
        <p class="note" style="margin-top:10px">${blocked ? 'Кабинет приостановлен: вывод и новые коды закрыты.'
          : `Минимум ${rub(d.rules.minWithdraw)}. Сегодняшний доход станет доступен завтра: сутки сначала закрываются.`}</p>`}
      </section>
      <section class="tile span-5">
        <h3>Ваша доля</h3>
        <div class="big">${fmt(d.share)}<small>%</small></div>
        <p class="sub">дохода с ваших игроков, пожизненно</p>
        ${d.carry < 0 ? `<p class="note warn" style="margin-top:12px">Ваши игроки сейчас в плюсе на ${rub(-d.carry)}.
          Доля снова пойдёт, когда этот минус отыграется: он переносится, а не списывается с вас.</p>` : ''}
        ${d.network.length ? `<p class="note" style="margin-top:12px">Плюс доход сети: ${d.network.map((n) => `${esc(n.name)} ${fmt(n.pct)}%`).join(', ')}</p>` : ''}
      </section>

      <section class="tile span-12">
        <div class="tile-head"><h3>За период</h3>${daysChips(S.days)}</div>
        <div class="bento" style="--gap:10px">
          ${[['Регистрации', fmt(d.period.signups)], ['Первые депозиты', fmt(d.period.ftd)],
             ['Депозиты', rub(d.period.deposits)], ['Доход с игроков', signedRub(d.period.ngr)]]
            .map(([k, v]) => `<div class="tile kpi span-3" style="padding:14px 16px;background:var(--tile-2)"><span>${k}</span><b>${v}</b></div>`).join('')}
        </div>
        ${barsHtml(d.series, 'earned', rub)}
        <p class="note" style="margin-top:6px">Начислено вам по дням. Сутки по Москве.</p>
      </section>

      <section class="tile span-7">
        <div class="tile-head"><h3>Промокоды</h3><span class="note">${d.promos.length} из ${d.rules.codesMax || 'без лимита'}</span></div>
        ${adminView || blocked ? '' : `<form class="row" id="promoForm" style="margin-bottom:6px">
          <input class="input" name="code" placeholder="СВОЙКОД" maxlength="20" autocapitalize="characters" required>
          <button class="btn" type="submit">Создать</button></form>
          <div class="form-err" id="promoErr"></div>`}
        <div class="list">${d.promos.length ? d.promos.map((p) => `
          <div class="li">
            <div class="l"><b class="code">${esc(p.code)} ${p.active ? '' : '<span class="tag">выключен</span>'}</b>
              <span>${fmt(p.activations)} ${plural(p.activations, 'регистрация', 'регистрации', 'регистраций')} · ${fmt(p.ftd)} FTD · ${rub(p.deposits)} · доход ${signedRub(p.ngr)}</span></div>
            <div class="r row" style="flex-wrap:nowrap">
              <button class="btn alt sm" data-copy="${esc(link(p.code))}" type="button">Ссылка</button>
              ${adminView ? '' : `<button class="btn alt sm" data-toggle="${p.id}" data-on="${p.active ? 0 : 1}" type="button">${p.active ? 'Выкл' : 'Вкл'}</button>`}
            </div>
          </div>`).join('') : '<div class="empty">Создайте первый код: он же ссылка для вашей аудитории.</div>'}</div>
      </section>

      <section class="tile span-5">
        <h3>Что получает игрок по коду</h3>
        <div class="mid">Кейс «Начало»<br>+${fmt(d.rules.promoPct)}% к пополнению</div>
        <p class="note" style="margin-top:10px">Код вводится при регистрации или открывается ссылкой. Бонус
          ${d.rules.promoMax ? `до ${rub(d.rules.promoMax)}, ` : ''}от пополнения в ${rub(d.rules.promoMinDeposit)}, отыгрывается по правилам сайта.
          Игрок закрепляется за вами навсегда, второй код его не переманит.</p>
        <div class="kv" style="margin-top:14px">
          <span>Всего игроков</span><b>${fmt(d.total.signups)}</b>
          <span>Из них пополнили</span><b>${fmt(d.total.ftd)}</b>
          <span>Депозиты за всё время</span><b>${rub(d.total.deposits)}</b>
          <span>Доход за всё время</span><b>${signedRub(d.total.ngr)}</b>
        </div>
      </section>

      <section class="tile span-7">
        <h3>Игроки</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Игрок</th><th>Код</th><th>Пришёл</th><th class="n">Депозиты</th><th>Неделя</th></tr></thead>
          <tbody>${d.referrals.length ? d.referrals.map((r) => `<tr><td>#${r.id}</td><td class="code">${esc(r.code || '')}</td>
            <td>${date(r.createdAt)}</td><td class="n">${rub(r.deposits)}</td><td>${r.active ? '<span class="tag ok">играл</span>' : '<span class="tag">нет</span>'}</td></tr>`).join('')
            : '<tr><td colspan="5" class="empty">Пока никто не пришёл</td></tr>'}</tbody>
        </table></div>
      </section>

      <section class="tile span-5">
        <h3>Выводы</h3>
        <div class="list">${d.payouts.length ? d.payouts.map((p) => {
          const [cls, label] = STATUS[p.status] || ['', p.status];
          return `<div class="li"><div class="l"><b>${rub(p.amount)}${p.usdt ? ` · ${esc(p.usdt)} USDT` : ''}</b>
            <span>${dateTime(p.created_at)}${p.network ? ` · ${esc(p.network)} ${esc(String(p.address || '').slice(0, 6))}...${esc(String(p.address || '').slice(-4))}` : ''}${p.txid ? ` · tx ${esc(p.txid.slice(0, 10))}...` : ''}${p.reason ? ` · ${esc(p.reason)}` : ''}${p.comment ? ` · ${esc(p.comment)}` : ''}</span></div>
            <div class="r"><span class="tag ${cls}">${label}</span>${p.status === 'pending' && !adminView ? ` <button class="ghost" data-cancel="${p.id}" type="button">Отменить</button>` : ''}</div></div>`;
        }).join('') : '<div class="empty">Выводов пока не было</div>'}</div>
      </section>

      ${adminView ? adminPartnerControls(d) : `<section class="tile span-12">
        <h3>Профиль</h3>
        <form class="row" id="profForm">
          <input class="input" name="name" value="${esc(d.partner.name || '')}" maxlength="60" placeholder="Имя">
          <input class="input" name="contact" value="${esc(d.partner.contact || '')}" maxlength="80" placeholder="Telegram">
          <button class="btn alt" type="submit">Сохранить</button>
        </form></section>`}
    </div>`;

  target.querySelectorAll('[data-days]').forEach((el) => {
    el.onclick = () => { S.days = Number(el.dataset.days); renderCabinet(adminView); };
  });
  target.querySelectorAll('[data-copy]').forEach((el) => { el.onclick = () => copy(el.dataset.copy); });
  if (adminView) {
    $('shClose').onclick = closeSheet;
    bindAdminPartnerControls(d);
    return;
  }
  target.querySelectorAll('[data-toggle]').forEach((el) => {
    el.onclick = async () => {
      try { await api('/api/pc/promo/toggle', { id: Number(el.dataset.toggle), active: el.dataset.on === '1' }); renderCabinet(); }
      catch (err) { toast(err.message); }
    };
  });
  target.querySelectorAll('[data-cancel]').forEach((el) => {
    el.onclick = async () => {
      try { await api('/api/pc/payout/cancel', { id: Number(el.dataset.cancel) }); renderCabinet(); }
      catch (err) { toast(err.message); }
    };
  });
  const pf = $('promoForm');
  if (pf) {
    pf.onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/api/pc/promo/create', { code: e.target.code.value }); toast('Код создан'); renderCabinet(); }
      catch (err) { $('promoErr').textContent = err.message; }
    };
  }
  $('profForm').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/pc/profile', Object.fromEntries(new FormData(e.target))); toast('Сохранено'); }
    catch (err) { toast(err.message); }
  };
  const wd = $('wdBtn');
  if (wd) wd.onclick = () => openWithdraw(d);
}

async function openWithdraw(d) {
  let rate = 0;
  try { rate = (await api('/api/pc/payout/quote')).rate; } catch { /* покажем без оценки */ }
  const body = openSheet(`
    <div class="sheet-head"><div><h2>Вывод в USDT</h2>
      <p class="note">Доступно ${rub(d.balance.available)} · минимум ${rub(d.rules.minWithdraw)}</p></div>
      <button class="ghost" id="wdClose" type="button">Закрыть</button></div>
    <form id="wdForm">
      <label class="field"><span>Сумма, ₽</span><input class="input" name="amount" type="number" min="${d.rules.minWithdraw}"
        max="${d.balance.available}" value="${d.balance.available}" required></label>
      <label class="field"><span>Сеть</span><select class="input" name="network">${d.rules.networks.map((n) => `<option>${n}</option>`).join('')}</select></label>
      <label class="field"><span>Адрес кошелька USDT</span><input class="input" name="address" autocomplete="off" spellcheck="false" required></label>
      <p class="note" id="wdEst">${rate ? `Курс ${fmt(rate)} ₽ за 1 USDT` : 'Курс USDT сейчас недоступен'}</p>
      <div class="form-err" id="wdErr"></div>
      <button class="btn wide" type="submit">Отправить заявку</button>
      <p class="note" style="margin-top:10px">Проверьте сеть и адрес: монеты, отправленные не в ту сеть, не вернуть.
        Заявку обрабатывает человек, обычно в течение суток.</p>
    </form>`);
  const est = () => {
    const v = Number(body.querySelector('[name=amount]').value) || 0;
    if (rate) $('wdEst').textContent = `≈ ${fmt(Math.floor(v / rate * 100) / 100)} USDT по курсу ${fmt(rate)} ₽`;
  };
  body.querySelector('[name=amount]').oninput = est;
  est();
  $('wdClose').onclick = closeSheet;
  $('wdForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api('/api/pc/payout', Object.fromEntries(new FormData(e.target)));
      closeSheet();
      toast('Заявка отправлена');
      renderCabinet();
    } catch (err) { $('wdErr').textContent = err.message; btn.disabled = false; }
  };
}

/* ---------- Карточка партнёра в админке ---------- */

function adminPartnerControls(d) {
  const open = d.shares.filter((s) => s.to_at == null);
  const own = open.find((s) => s.beneficiary_id === d.partner.id && s.source_id === d.partner.id);
  const above = open.filter((s) => s.source_id === d.partner.id && s.beneficiary_id !== d.partner.id);
  const below = open.filter((s) => s.beneficiary_id === d.partner.id && s.source_id !== d.partner.id);
  return `
    <section class="tile span-6">
      <h3>Доля и статус</h3>
      <form class="row" id="ownShare" style="margin-top:8px">
        <input class="input" name="pct" type="number" step="0.1" min="0" max="90" value="${own ? own.pct : d.share}">
        <button class="btn alt" type="submit">Сохранить долю, %</button>
      </form>
      <p class="note" style="margin-top:8px">Новая доля действует с сегодняшнего дня, прошлые начисления не меняются.</p>
      <div class="hero-actions">
        ${d.partner.status === 'active'
          ? '<button class="btn danger" id="stBlock" type="button">Приостановить кабинет</button>'
          : '<button class="btn" id="stOpen" type="button">Открыть кабинет</button>'}
      </div>
    </section>
    <section class="tile span-6">
      <h3>Сетка: кто получает сверху с его игроков</h3>
      <div class="list">${above.length ? above.map((s) => `<div class="li"><div class="l"><b>${esc(s.beneficiary_name || `#${s.beneficiary_id}`)}</b>
        <span>#${s.beneficiary_id} · с ${date(s.from_at)}</span></div>
        <div class="r row" style="flex-wrap:nowrap"><b>${fmt(s.pct)}%</b><button class="ghost" data-unshare="${s.beneficiary_id}" type="button">Снять</button></div></div>`).join('')
        : '<div class="empty">Никого. Добавьте партнёра, который получает процент с игроков этого.</div>'}</div>
      <form class="row" id="addShare" style="margin-top:8px">
        <input class="input" name="key" placeholder="Номер, почта или имя партнёра" required>
        <input class="input" name="pct" type="number" step="0.1" min="0.1" max="90" placeholder="%" style="flex:0 1 90px" required>
        <button class="btn alt" type="submit">Добавить</button>
      </form>
      ${below.length ? `<p class="note" style="margin-top:12px">Сам получает сверху: ${below.map((s) => `${esc(s.source_name || `#${s.source_id}`)} ${fmt(s.pct)}%`).join(', ')}</p>` : ''}
      <p class="note" style="margin-top:8px">Это сверх его доли, из дохода заведения. Всего с игроков одного партнёра можно раздать до 90%.</p>
    </section>
    <section class="tile span-12">
      <h3>История долей</h3>
      <div class="table-wrap"><table><thead><tr><th>Получатель</th><th>С игроков</th><th class="n">%</th><th>С</th><th>По</th></tr></thead>
      <tbody>${d.shares.map((s) => `<tr><td>${esc(s.beneficiary_name || `#${s.beneficiary_id}`)}</td><td>${esc(s.source_name || `#${s.source_id}`)}</td>
        <td class="n">${fmt(s.pct)}</td><td>${dateTime(s.from_at)}</td><td>${s.to_at ? dateTime(s.to_at) : 'действует'}</td></tr>`).join('')}</tbody></table></div>
    </section>`;
}

function bindAdminPartnerControls(d) {
  const pid = d.partner.id;
  const reload = () => renderCabinet(pid);
  const share = async (body) => {
    try { await api('/api/pc/admin/share', body); toast('Сохранено'); reload(); }
    catch (err) { toast(err.message); }
  };
  $('ownShare').onsubmit = (e) => { e.preventDefault(); share({ beneficiaryId: pid, sourceId: pid, pct: e.target.pct.value }); };
  $('addShare').onsubmit = (e) => { e.preventDefault(); share({ beneficiaryKey: e.target.key.value, sourceId: pid, pct: e.target.pct.value }); };
  document.querySelectorAll('[data-unshare]').forEach((el) => {
    el.onclick = () => share({ beneficiaryId: Number(el.dataset.unshare), sourceId: pid, pct: 0 });
  });
  const status = async (s) => {
    try { await api('/api/pc/admin/status', { id: pid, status: s }); reload(); }
    catch (err) { toast(err.message); }
  };
  if ($('stBlock')) $('stBlock').onclick = () => status('blocked');
  if ($('stOpen')) $('stOpen').onclick = () => status('active');
}

/* ============================================================
   АДМИН: ОБЗОР И ПАРТНЁРЫ
   ============================================================ */

async function renderOverview() {
  app.innerHTML = '<div class="bento"><div class="tile span-12 skel"></div></div>';
  let d;
  try { d = await api('/api/pc/admin/overview', { days: S.days }); }
  catch (err) { app.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  const t = d.totals;
  app.innerHTML = `
    <div class="bento">
      <section class="tile hero span-5">
        <h3>Должны партнёрам</h3>
        <div class="big">${rub(t.owed)}</div>
        <div class="hero-row"><span>Начислено <b>${rub(t.accrued)}</b></span><span>Выплачено <b>${rub(t.paid)}</b></span>
          <span>В заявках <b>${rub(t.pending)}</b></span></div>
        <p class="note" style="margin-top:10px">Сюда входит и сегодняшнее, ещё не закрытое начисление.</p>
      </section>
      <section class="tile span-3"><h3>Заявки на вывод</h3><div class="big ${t.requests ? 'warn' : ''}">${fmt(t.requests)}</div>
        <button class="btn alt sm" id="goReq" type="button">Открыть</button></section>
      <section class="tile span-4"><h3>Партнёров</h3><div class="big">${fmt(t.partners)}</div>
        <p class="sub">активных ${fmt(t.active)}</p></section>
      <section class="tile span-12">
        <div class="tile-head"><h3>Трафик партнёров</h3>${daysChips(S.days)}</div>
        <div class="bento" style="--gap:10px">
          ${[['Регистрации', fmt(t.period.signups)], ['Первые депозиты', fmt(t.period.ftd)], ['Депозиты', rub(t.period.deposits)],
             ['Доход с их игроков', signedRub(t.period.ngr)]]
            .map(([k, v]) => `<div class="tile kpi span-3" style="padding:14px 16px;background:var(--tile-2)"><span>${k}</span><b>${v}</b></div>`).join('')}
        </div>
        ${barsHtml(d.series, 'deposits', rub)}
        <p class="note" style="margin-top:6px">Депозиты игроков партнёров по дням.</p>
      </section>
      <section class="tile span-12">
        <div class="tile-head"><h3>Лучшие за период</h3></div>
        ${partnersTable([...d.rows].sort((a, b) => b.period.deposits - a.period.deposits).slice(0, 10))}
      </section>
    </div>`;
  bindDays(renderOverview);
  $('goReq').onclick = () => { S.tab = 'requests'; renderShell(); };
  bindPartnerRows();
}

function bindDays(rerender) {
  app.querySelectorAll('[data-days]').forEach((el) => { el.onclick = () => { S.days = Number(el.dataset.days); rerender(); }; });
}

function partnersTable(rows) {
  if (!rows.length) return '<div class="empty">Партнёров пока нет</div>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Партнёр</th><th class="n">Доля</th><th class="n">Рег.</th><th class="n">FTD</th><th class="n">Депозиты</th>
      <th class="n">Доход</th><th class="n">Доступно</th><th class="n">Выплачено</th><th>Сетка</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="click" data-pid="${r.id}">
      <td><b>${esc(r.name || `#${r.id}`)}</b><br><span class="note">#${r.id} · ${esc(r.email || '')}</span></td>
      <td class="n">${fmt(r.share)}%</td><td class="n">${fmt(r.period.signups)}</td><td class="n">${fmt(r.period.ftd)}</td>
      <td class="n">${rub(r.period.deposits)}</td><td class="n ${r.period.ngr < 0 ? 'neg' : ''}">${signedRub(r.period.ngr)}</td>
      <td class="n pos">${rub(r.balance.available)}</td><td class="n">${rub(r.balance.paid)}</td>
      <td>${r.network.length ? r.network.map((n) => `#${n.beneficiaryId} ${fmt(n.pct)}%`).join(', ') : ''}</td>
      <td>${r.status === 'active' ? '' : '<span class="tag bad">стоп</span>'}</td></tr>`).join('')}</tbody></table></div>`;
}

function bindPartnerRows() {
  app.querySelectorAll('[data-pid]').forEach((el) => { el.onclick = () => renderCabinet(Number(el.dataset.pid)); });
}

async function renderPartners() {
  app.innerHTML = '<div class="bento"><div class="tile span-12 skel"></div></div>';
  let d;
  try { d = await api('/api/pc/admin/overview', { days: S.days }); }
  catch (err) { app.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  app.innerHTML = `
    <div class="bento">
      <section class="tile span-12">
        <div class="tile-head"><h3>Все партнёры · ${fmt(d.rows.length)}</h3>
          <div class="row"><input class="input" id="pSearch" placeholder="Поиск: имя, почта, номер" style="min-width:220px">${daysChips(S.days)}</div></div>
        <div id="pTable">${partnersTable(d.rows)}</div>
        <p class="note" style="margin-top:10px">Нажмите на партнёра: его кабинет, доля, сетка и история.</p>
      </section>
    </div>`;
  bindDays(renderPartners);
  bindPartnerRows();
  $('pSearch').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    $('pTable').innerHTML = partnersTable(d.rows.filter((r) => !q || String(r.id) === q
      || (r.name || '').toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q)));
    bindPartnerRows();
  };
}

/* ============================================================
   АДМИН: ЗАЯВКИ ПАРТНЁРОВ
   ============================================================ */

async function renderRequests() {
  app.innerHTML = '<div class="bento"><div class="tile span-12 skel"></div></div>';
  let d;
  try { d = await api('/api/pc/admin/payouts', { status: S.reqStatus }); }
  catch (err) { app.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  const total = d.rows.reduce((a, r) => a + r.amount, 0);
  app.innerHTML = `
    <div class="bento">
      <section class="tile span-12">
        <div class="tile-head"><h3>Запросы партнёров · ${fmt(d.rows.length)} на ${rub(total)}</h3>
          <div class="chips">${[['pending', 'Ждут'], ['paid', 'Выплачены'], ['rejected', 'Отклонены'], ['all', 'Все']]
            .map(([k, v]) => `<button class="chip ${k === S.reqStatus ? 'on' : ''}" data-st="${k}" type="button">${v}</button>`).join('')}</div></div>
        <div class="list">${d.rows.length ? d.rows.map((r) => {
          const [cls, label] = STATUS[r.status] || ['', r.status];
          return `<div class="li" style="align-items:flex-start">
            <div class="l"><b>${rub(r.amount)}${r.usdt ? ` · ${esc(r.usdt)} USDT` : ''} <span class="tag ${cls}">${label}</span></b>
              <span>${esc(r.partner_name || '')} #${r.partner_id} · ${esc(r.partner_email || '')} · ${dateTime(r.created_at)}${r.rate ? ` · курс ${fmt(r.rate)}` : ''}</span><br>
              ${r.address ? `<span class="code" style="font-size:13px;word-break:break-all;white-space:normal">${esc(r.network)} ${esc(r.address)}</span>` : ''}
              ${r.txid ? `<br><span>tx ${esc(r.txid)}</span>` : ''}${r.reason ? `<br><span>${esc(r.reason)}</span>` : ''}${r.comment ? `<br><span>${esc(r.comment)}</span>` : ''}</div>
            <div class="r row" style="flex-wrap:nowrap">${r.address ? `<button class="btn alt sm" data-copy="${esc(r.address)}" type="button">Адрес</button>` : ''}
              ${r.status === 'pending' && can('partners.pay') ? `<button class="btn sm" data-pay="${r.id}" type="button">Выплачено</button>
                <button class="btn danger sm" data-rej="${r.id}" type="button">Отклонить</button>` : ''}</div>
          </div>`;
        }).join('') : '<div class="empty">Пусто</div>'}</div>
      </section>
    </div>`;
  app.querySelectorAll('[data-st]').forEach((el) => { el.onclick = () => { S.reqStatus = el.dataset.st; renderRequests(); }; });
  app.querySelectorAll('[data-copy]').forEach((el) => { el.onclick = () => copy(el.dataset.copy); });
  const byId = (id) => d.rows.find((r) => r.id === Number(id));
  app.querySelectorAll('[data-pay]').forEach((el) => {
    el.onclick = () => {
      const r = byId(el.dataset.pay);
      openSheet(`<div class="sheet-head"><div><h2>Отметить выплату</h2>
        <p class="note">${esc(r.partner_name || '')} · ${rub(r.amount)} · ${esc(r.network)}</p></div><button class="ghost" id="x" type="button">Закрыть</button></div>
        <p class="code" style="word-break:break-all">${esc(r.address)}</p>
        <form id="payForm"><label class="field"><span>Отправлено, USDT</span><input class="input" name="usdt" value="${esc(r.usdt || '')}" inputmode="decimal"></label>
        <label class="field"><span>Хеш транзакции</span><input class="input" name="txid" spellcheck="false"></label>
        <div class="form-err" id="payErr"></div>
        <button class="btn wide" type="submit">Выплачено</button>
        <p class="note" style="margin-top:8px">Отмечайте после отправки монет. Партнёр увидит сумму и хеш в истории.</p></form>`);
      $('x').onclick = closeSheet;
      $('payForm').onsubmit = async (e) => {
        e.preventDefault();
        try { await api('/api/pc/admin/payout/resolve', { id: r.id, action: 'paid', ...Object.fromEntries(new FormData(e.target)) }); closeSheet(); renderRequests(); refreshReqDot(); }
        catch (err) { $('payErr').textContent = err.message; }
      };
    };
  });
  app.querySelectorAll('[data-rej]').forEach((el) => {
    el.onclick = () => {
      const r = byId(el.dataset.rej);
      openSheet(`<div class="sheet-head"><div><h2>Отклонить заявку</h2><p class="note">${esc(r.partner_name || '')} · ${rub(r.amount)}</p></div>
        <button class="ghost" id="x" type="button">Закрыть</button></div>
        <form id="rejForm"><label class="field"><span>Причина (увидит партнёр)</span><input class="input" name="reason" required minlength="3"></label>
        <div class="form-err" id="rejErr"></div><button class="btn danger wide" type="submit">Отклонить, сумма вернётся в доступное</button></form>`);
      $('x').onclick = closeSheet;
      $('rejForm').onsubmit = async (e) => {
        e.preventDefault();
        try { await api('/api/pc/admin/payout/resolve', { id: r.id, action: 'reject', reason: e.target.reason.value }); closeSheet(); renderRequests(); refreshReqDot(); }
        catch (err) { $('rejErr').textContent = err.message; }
      };
    };
  });
}

/* ============================================================
   АДМИН: ФИНАНСЫ
   ============================================================ */

/* Баланс, который присылает шлюз: поле называется у них по-своему. */
function gatewayNumber(g) {
  if (!g || typeof g !== 'object') return null;
  for (const k of ['balance', 'available', 'available_balance', 'amount', 'sum']) {
    const v = Number(g[k] ?? g.data?.[k]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

async function renderFinance() {
  app.innerHTML = '<div class="bento"><div class="tile span-12 skel"></div></div>';
  let d; let cash;
  try {
    [d, cash] = await Promise.all([
      api('/api/pc/admin/finance/sicilia', { days: S.fin.days, day: S.fin.day || null }),
      api('/api/pc/admin/finance/cash', { days: S.fin.days }),
    ]);
  } catch (err) { app.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  const L = d.ledger;
  const gw = gatewayNumber(d.gateway);
  const diff = gw == null ? null : Math.round((gw - d.owed) * 100) / 100;
  const hourly = L.granularity === 'hour';
  const issues = Object.entries(d.issues).filter(([, v]) => v.rows.length);
  const noFees = !L.fees.payinPct && !L.fees.payoutPct && !L.fees.payoutFixed;

  app.innerHTML = `
    <div class="bento">
      <section class="tile hero span-5">
        <h3>Sicilia должна нам</h3>
        <div class="big ${d.owed < 0 ? 'neg' : 'pos'}">${rub(d.owed)}</div>
        <p class="note">Наш расчёт за всё время: принято минус комиссия, минус выплаты с комиссией, минус их переводы нам.</p>
        ${noFees ? '<p class="note warn" style="margin-top:8px">Комиссии Sicilia не вписаны (Настройки), долг посчитан без них.</p>' : ''}
      </section>
      <section class="tile span-4">
        <h3>Баланс по данным Sicilia</h3>
        <div class="mid">${gw == null ? '<span class="note">нет ответа</span>' : rub(gw)}</div>
        ${gw == null ? `<p class="note">${esc(d.gatewayError || 'Шлюз не прислал число')}</p>`
          : `<p class="note ${Math.abs(diff) < 1 ? 'pos' : 'warn'}" style="margin-top:8px">${Math.abs(diff) < 1 ? 'Сходится с нашим расчётом'
            : `Расходится на ${signedRub(diff)}: проверьте расхождения ниже и расчёты`}</p>`}
      </section>
      <section class="tile span-3">
        <h3>Обязательства перед игроками</h3>
        <div class="mid">${rub(cash.liabilities.playersBalance)}</div>
        <p class="note">на балансах · ещё ${rub(cash.liabilities.pendingPayouts)} в ${fmt(cash.liabilities.pendingPayoutsCount)} заявках на вывод</p>
      </section>

      <section class="tile span-12">
        <div class="tile-head"><h3>${hourly ? `Сверка с Sicilia по часам · ${esc(S.fin.day)}` : 'Сверка с Sicilia по дням'}</h3>
          <div class="row">${hourly ? '<button class="btn alt sm" id="backDays" type="button">К дням</button>' : daysChips(S.fin.days, 'data-fdays')}
            <button class="btn alt sm" id="csv" type="button">CSV для сверки</button></div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>${hourly ? 'Час' : 'День'}</th><th class="n">Пополнений</th><th class="n">Принято</th><th class="n">Комиссия</th>
            <th class="n">Выплат</th><th class="n">Выплачено</th><th class="n">Комиссия</th><th class="n">Расчёты</th><th class="n">За ${hourly ? 'час' : 'день'}</th><th class="n">Долг на конец</th></tr></thead>
          <tbody>${L.rows.map((r) => `<tr class="${hourly ? '' : 'click'}" ${hourly ? '' : `data-day="${esc(r.label)}"`}>
            <td>${esc(r.label)}</td><td class="n">${fmt(r.payinCount)}</td><td class="n">${rub(r.payin)}${r.payin !== r.payinOrdered ? `<br><span class="note warn">выставлено ${rub(r.payinOrdered)}</span>` : ''}</td>
            <td class="n">${rub(r.payinFee)}</td><td class="n">${fmt(r.payoutCount)}</td><td class="n">${rub(r.payout)}</td><td class="n">${rub(r.payoutFee)}</td>
            <td class="n">${r.settled ? signedRub(r.settled) : ''}</td><td class="n ${r.net < 0 ? 'neg' : ''}">${signedRub(r.net)}</td><td class="n"><b>${rub(r.balance)}</b></td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Итого</td><td class="n">${fmt(L.total.payinCount)}</td><td class="n">${rub(L.total.payin)}</td><td class="n">${rub(L.total.payinFee)}</td>
            <td class="n">${fmt(L.total.payoutCount)}</td><td class="n">${rub(L.total.payout)}</td><td class="n">${rub(L.total.payoutFee)}</td>
            <td class="n">${signedRub(L.total.settled)}</td><td class="n">${signedRub(L.total.net)}</td><td class="n">${rub(L.closing)}</td></tr></tfoot>
        </table></div>
        <p class="note" style="margin-top:8px">На начало периода долг был ${rub(L.opening)}. Комиссия: приём ${fmt(L.fees.payinPct)}%, выплата ${fmt(L.fees.payoutPct)}% + ${rub(L.fees.payoutFixed)}.
          ${L.fees.guessed ? `У ${fmt(L.fees.guessed)} старых сделок комиссия не записана, взята текущая.` : ''} ${hourly ? '' : 'Нажмите на день, чтобы увидеть часы.'} Сутки по Москве.</p>
      </section>

      <section class="tile span-7">
        <h3>Расхождения и деньги под вопросом</h3>
        ${issues.length ? issues.map(([key, v]) => `<details style="border-top:1px solid var(--line);padding:10px 0">
          <summary style="cursor:pointer;display:flex;justify-content:space-between;gap:10px"><b>${esc(v.title)}</b><span class="warn">${fmt(v.rows.length)} · ${rub(v.sum)}</span></summary>
          <p class="note">${esc(v.hint)}</p>
          <div class="table-wrap"><table><thead><tr><th>Наш номер</th><th>Шлюза</th><th>Игрок</th><th class="n">Сумма</th><th class="n">Шлюз</th><th>Когда</th></tr></thead>
          <tbody>${v.rows.map((r) => `<tr><td class="code" data-copy="${esc(r.invid)}" style="cursor:copy">${esc(r.invid)}</td><td data-copy="${esc(r.gatewayId ?? '')}" style="cursor:copy">${esc(r.gatewayId ?? '')}</td>
            <td>#${r.userId}</td><td class="n">${rub(r.amount)}</td><td class="n">${r.fact != null ? rub(r.fact) : r.credited != null ? rub(r.credited) : esc(r.status)}</td>
            <td>${dateTime(r.paidAt || r.createdAt)}</td></tr>`).join('')}</tbody></table></div></details>`).join('')
          : '<div class="empty">Расхождений нет</div>'}
      </section>

      <section class="tile span-5">
        <h3>Расчёты с Sicilia</h3>
        ${d.canSettle ? `<form id="stForm" style="margin-top:8px">
          <label class="field"><span>Что произошло</span><select class="input" name="kind">
            <option value="withdraw">Sicilia перевела нам</option><option value="topup">Мы завели на баланс шлюза</option>
            <option value="fee">Удержание шлюза</option><option value="adjust">Поправка (минус в пользу шлюза)</option></select></label>
          <div class="row"><input class="input" name="amount" inputmode="decimal" placeholder="Сумма, ₽" required>
            <input class="input" name="usdt" inputmode="decimal" placeholder="USDT, если в монете"></div>
          <div class="row" style="margin-top:10px"><input class="input" name="at" type="datetime-local">
            <input class="input" name="txid" placeholder="Хеш или номер перевода"></div>
          <label class="field" style="margin-top:10px"><span>Комментарий</span><input class="input" name="note" maxlength="300"></label>
          <div class="form-err" id="stErr"></div><button class="btn wide" type="submit">Записать</button>
        </form>` : '<p class="note">Вносить расчёты может сотрудник с правом «Вносить расчёты со шлюзом».</p>'}
        <div class="list" style="margin-top:10px">${L.settlements.length ? L.settlements.map((s) => `<div class="li"><div class="l">
          <b>${esc(s.label)} · ${signedRub(s.signed)}</b><span>${dateTime(s.at)}${s.usdt ? ` · ${esc(s.usdt)} USDT` : ''}${s.txid ? ` · ${esc(s.txid)}` : ''}${s.note ? ` · ${esc(s.note)}` : ''}</span></div>
          ${d.canSettle ? `<div class="r"><button class="ghost" data-void="${s.id}" type="button">Погасить</button></div>` : ''}</div>`).join('')
          : '<div class="empty">За период расчётов нет</div>'}</div>
      </section>

      <section class="tile span-12">
        <div class="tile-head"><h3>Касса проекта по дням</h3><span class="note">все каналы</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>День</th><th class="n">Рег.</th><th class="n">FTD</th><th class="n">СБП/карта</th><th class="n">Крипто</th><th class="n">Вручную</th>
            <th class="n">Выводы СБП</th><th class="n">Выводы крипто</th><th class="n">Партнёрам</th><th class="n">Движение</th><th class="n">Кейсы и игры</th><th class="n">Казино</th><th class="n">Бонусы</th><th class="n">Доход</th></tr></thead>
          <tbody>${cash.rows.map((r) => `<tr><td>${esc(r.day)}</td><td class="n">${fmt(r.signups)}</td><td class="n">${fmt(r.ftd)}</td>
            <td class="n">${rub(r.depSicilia)}</td><td class="n">${rub(r.depCrypto)}</td><td class="n">${rub(r.depOther)}</td>
            <td class="n">${rub(r.payoutSbp)}</td><td class="n">${rub(r.payoutCrypto)}</td><td class="n">${rub(r.partnerPaid)}</td>
            <td class="n ${r.cashNet < 0 ? 'neg' : ''}">${signedRub(r.cashNet)}</td><td class="n">${signedRub(r.ggrCases)}</td><td class="n">${signedRub(r.ggrCasino)}</td>
            <td class="n">${rub(r.bonusConverted)}</td><td class="n ${r.ngr < 0 ? 'neg' : 'pos'}"><b>${signedRub(r.ngr)}</b></td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Итого</td><td class="n">${fmt(cash.total.signups)}</td><td class="n">${fmt(cash.total.ftd)}</td><td class="n">${rub(cash.total.depSicilia)}</td>
            <td class="n">${rub(cash.total.depCrypto)}</td><td class="n">${rub(cash.total.depOther)}</td><td class="n">${rub(cash.total.payoutSbp)}</td>
            <td class="n">${rub(cash.total.payoutCrypto)}</td><td class="n">${rub(cash.total.partnerPaid)}</td><td class="n">${signedRub(cash.total.cashNet)}</td>
            <td class="n">${signedRub(cash.total.ggrCases)}</td><td class="n">${signedRub(cash.total.ggrCasino)}</td><td class="n">${rub(cash.total.bonusConverted)}</td>
            <td class="n">${signedRub(cash.total.ngr)}</td></tr></tfoot>
        </table></div>
        <p class="note" style="margin-top:8px">Движение - пришло минус ушло. Доход - ставки своими деньгами минус выигрыши минус бонусы, перешедшие в деньги.</p>
      </section>
    </div>`;

  app.querySelectorAll('[data-fdays]').forEach((el) => { el.onclick = () => { S.fin.days = Number(el.dataset.fdays); renderFinance(); }; });
  app.querySelectorAll('[data-day]').forEach((el) => { el.onclick = () => { S.fin.day = el.dataset.day; renderFinance(); }; });
  if ($('backDays')) $('backDays').onclick = () => { S.fin.day = ''; renderFinance(); };
  app.querySelectorAll('[data-copy]').forEach((el) => { el.onclick = () => el.dataset.copy && copy(el.dataset.copy); });
  $('csv').onclick = async () => {
    try { download(`sicilia-${new Date().toISOString().slice(0, 10)}.csv`, await api('/api/pc/admin/finance/export', { days: S.fin.days })); }
    catch (err) { toast(err.message); }
  };
  const st = $('stForm');
  if (st) {
    st.onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (f.at) f.at = new Date(f.at).getTime();
      try { await api('/api/pc/admin/finance/settle', f); toast('Записано'); renderFinance(); }
      catch (err) { $('stErr').textContent = err.message; }
    };
  }
  app.querySelectorAll('[data-void]').forEach((el) => {
    el.onclick = async () => {
      if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.textContent = 'Точно?'; return; }
      try { await api('/api/pc/admin/finance/settle/void', { id: Number(el.dataset.void) }); renderFinance(); }
      catch (err) { toast(err.message); }
    };
  });
}

/* ============================================================
   АДМИН: НАСТРОЙКИ
   ============================================================ */

async function renderSettings() {
  let d;
  try { d = await api('/api/pc/admin/settings'); }
  catch (err) { app.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  const groups = [...new Set(d.rows.map((r) => r.group))];
  app.innerHTML = `<form id="setForm" class="bento">${groups.map((g) => `
    <section class="tile span-6"><h3>${esc(g === 'Sicilia' ? 'Условия Sicilia' : 'Партнёрская программа')}</h3>
      ${d.rows.filter((r) => r.group === g).map((r) => r.type === 'bool'
        ? `<label class="row" style="margin:12px 0;flex-wrap:nowrap"><input type="checkbox" name="${r.key}" ${r.value === '1' ? 'checked' : ''}>
            <span>${esc(r.label)}${r.hint ? `<br><span class="note">${esc(r.hint)}</span>` : ''}</span></label>`
        : `<label class="field" style="margin-top:12px"><span>${esc(r.label)}${r.hint ? ` · ${esc(r.hint)}` : ''}</span>
            <input class="input" name="${r.key}" value="${esc(r.value)}" inputmode="decimal"></label>`).join('')}
    </section>`).join('')}
    <section class="tile span-12"><button class="btn" type="submit">Сохранить</button>
      <p class="note" style="margin-top:8px">Доля и условия кода - для новых партнёров и новых кодов. У заведённых доля меняется в карточке партнёра.
        Комиссии Sicilia записываются в каждую сделку в момент её проведения.</p></section></form>`;
  $('setForm').onsubmit = async (e) => {
    e.preventDefault();
    const patch = {};
    for (const r of d.rows) {
      const el = e.target.elements[r.key];
      patch[r.key] = r.type === 'bool' ? el.checked : el.value;
    }
    try { await api('/api/pc/admin/settings/save', { patch }); toast('Сохранено'); renderSettings(); }
    catch (err) { toast(err.message); }
  };
}

boot();
