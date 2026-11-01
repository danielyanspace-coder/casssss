// Administrative UI is loaded only when the panel is opened. All authorization stays on the server.
export function createAdminUI({api,toast,fmt,esc,state,playerIdent,money,mountIcons,haptic,openBlankTab,withCashBusy,STATUS_LABEL,payoutRequisites,receiptDataUrl}) {
const pct = (v) => (v === null || v === undefined ? '-' : `${(v * 100).toFixed(2)}%`);

async function loadAdminOverview() {
  let d;
  try { d = await api('/api/admin/overview'); }
  catch (err) { toast(err.message); return; }

  const kpis = [
    { label: 'Игроков', value: fmt(d.users.total), sub: `активных: ${fmt(d.users.active || 0)}` },
    { label: 'Раундов', value: fmt(d.rounds.total) },
    { label: 'Поставлено', value: fmt(d.rounds.wagered) },
    { label: 'Выплачено', value: fmt(d.rounds.paid) },
    {
      label: 'Прибыль заведения',
      value: `${d.rounds.profit >= 0 ? '+' : ''}${fmt(d.rounds.profit)}`,
      cls: d.rounds.profit >= 0 ? 'plus' : 'minus',
      sub: `фактический RTP: ${pct(d.rounds.rtp)}`,
    },
    { label: 'Единиц на руках', value: fmt(d.users.balance), sub: `заблокировано: ${fmt(d.users.blocked || 0)}` },
  ];

  const gameRows = d.byGame.map((g) => `<tr>
      <td>${({ case: 'Кейсы', crash: 'Краш', roulette: 'Рулетка' })[g.game] || g.game}</td>
      <td class="num">${fmt(g.rounds)}</td>
      <td class="num">${fmt(g.wagered)}</td>
      <td class="num">${fmt(g.profit)}</td>
      <td class="num">${pct(g.rtp)}</td>
    </tr>`).join('');

  const winRows = d.topWins.map((w) => `<tr>
      <td>${esc(w.username || w.first_name || w.user_id)}</td>
      <td>${esc(w.subtitle)}</td>
      <td class="num">${fmt(w.payout)}</td>
    </tr>`).join('');

  document.getElementById('admin-overview').innerHTML = `
    <div class="admin-kpis">
      ${kpis.map((k) => `<div class="kpi">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value ${k.cls || ''}">${k.value}</div>
        ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ''}
      </div>`).join('')}
    </div>

    <h2 class="section-title">За сутки</h2>
    <div class="admin-kpis">
      <div class="kpi"><div class="kpi-label">Раундов</div><div class="kpi-value">${fmt(d.today.rounds)}</div></div>
      <div class="kpi"><div class="kpi-label">Игроков</div><div class="kpi-value">${fmt(d.today.players)}</div></div>
      <div class="kpi"><div class="kpi-label">Поставлено</div><div class="kpi-value">${fmt(d.today.wagered)}</div></div>
      <div class="kpi"><div class="kpi-label">Прибыль</div>
        <div class="kpi-value ${d.today.profit >= 0 ? 'plus' : 'minus'}">${fmt(d.today.profit)}</div></div>
    </div>

    <h2 class="section-title">По играм</h2>
    <table class="admin-table">
      <thead><tr><th>Игра</th><th class="num">Раундов</th><th class="num">Ставки</th>
        <th class="num">Прибыль</th><th class="num">RTP</th></tr></thead>
      <tbody>${gameRows || '<tr><td colspan="5">Нет данных</td></tr>'}</tbody>
    </table>

    <h2 class="section-title">Крупнейшие выигрыши</h2>
    <table class="admin-table">
      <thead><tr><th>Игрок</th><th>Что</th><th class="num">Выплата</th></tr></thead>
      <tbody>${winRows || '<tr><td colspan="3">Нет данных</td></tr>'}</tbody>
    </table>
  `;

  renderAdminFeed(d.recent);
}

function renderAdminFeed(recent) {
  document.getElementById('admin-feed').innerHTML = recent.length
    ? recent.map((r) => {
        const profit = r.payout - r.bet;
        return `<div class="history-row" style="--tier-color:${profit >= 0 ? 'var(--green)' : 'var(--line)'}">
          <div class="history-main">
            <div class="history-item">${esc(r.subtitle)}</div>
            <div class="history-case">${esc(r.username || r.first_name || ('#' + r.user_id))}
              · ${esc(r.title)} · ${r.free ? 'подарок' : fmt(r.bet)}</div>
          </div>
          <div class="history-right">
            <div class="history-value">${fmt(r.payout)}</div>
            <div class="history-mult ${profit >= 0 ? 'plus' : 'minus'}">${r.multiplier.toFixed(2)}x</div>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty">Пока нет раундов</div>';
}

async function loadAdminUsers() {
  let d;
  try { d = await api('/api/admin/users', { query: state.admin.query }); }
  catch (err) { toast(err.message); return; }

  state.admin.users = d.rows;
  const list = document.getElementById('adminUserList');

  list.innerHTML = d.rows.length ? d.rows.map((u) => {
    const name = u.username ? '@' + u.username : (u.first_name || 'Без имени');
    const letter = (u.first_name || u.username || '?').trim().charAt(0).toUpperCase();
    return `<div class="user-row ${u.is_blocked ? 'blocked' : ''}" data-user="${u.id}">
      <div class="user-avatar">${esc(letter)}</div>
      <div class="user-main">
        <div class="user-name">${esc(name)}${u.is_admin ? ' <span class="admin-tag">АДМИН</span>' : ''}</div>
        <div class="user-meta">${esc(playerIdent(u))} · раундов ${fmt(u.total_rounds)}
          · RTP ${u.total_spent ? ((u.total_won / u.total_spent) * 100).toFixed(0) + '%' : '-'}</div>
      </div>
      <div class="user-bal">${fmt(u.balance)}</div>
    </div>`;
  }).join('') : '<div class="empty">Никого не найдено</div>';

  list.querySelectorAll('.user-row').forEach((row) => {
    row.addEventListener('click', () => openAdminUser(Number(row.dataset.user)));
  });
}

async function openAdminUser(userId) {
  let d;
  try { d = await api('/api/admin/user', { userId }); }
  catch (err) { toast(err.message); return; }

  const u = d.user;
  const name = u.username ? '@' + u.username : (u.first_name || 'Без имени');

  const logRows = d.log.map((l) => {
    const who = l.admin_username ? '@' + l.admin_username : (l.admin_name || '');
    return `<div class="log-row">
      <span>${esc(BO_ACTIONS[l.action] || l.action)}${l.note ? ` · ${esc(l.note)}` : ''}
        <div class="bo-sub">${esc(who)} · ${boDateTime(l.created_at)}</div></span>
      <b class="${l.amount > 0 ? 'plus' : l.amount < 0 ? 'minus' : ''}">${l.amount ? fmt(l.amount) : ''}</b>
    </div>`;
  }).join('');

  const histRows = d.history.slice(0, 12).map((h) => `<div class="log-row">
      <span>${esc(h.title)} · ${esc(h.subtitle)}</span>
      <b class="${h.payout >= h.bet ? 'plus' : 'minus'}">${fmt(h.payout - h.bet)}</b>
    </div>`).join('');

  const detail = document.getElementById('adminDetail');
  detail.innerHTML = `
    <div class="detail-head">
      <button class="btn btn-outline" id="detailBack"><span data-ico="back"></span></button>
      <div style="flex:1">
        <div class="user-name" style="font-size:19px">${esc(name)}</div>
        <div class="user-meta">${esc(playerIdent(u))}</div>
      </div>
    </div>

    ${boKpis([
      { label: 'Баланс', value: fmt(u.balance),
        sub: `к выводу: ${fmt(d.money.withdrawable)}` },
      { label: 'Пополнил', value: fmt(d.money.deposited),
        sub: d.money.bonus ? `бонусами ещё ${fmt(d.money.bonus)}` : '' },
      { label: 'Вывел', value: fmt(d.money.paidOut),
        sub: d.money.pendingOut ? `в заявках ${fmt(d.money.pendingOut)}` : '' },
      { label: 'Касса заработала', value: fmt(d.money.deposited - d.money.paidOut),
        cls: d.money.deposited - d.money.paidOut >= 0 ? 'plus' : 'minus',
        sub: 'пополнил минус вывел' },
      { label: 'Раундов', value: fmt(u.total_rounds),
        sub: `поставил ${fmt(u.total_spent)}` },
      { label: 'Его отдача', value: u.total_spent
          ? ((u.total_won / u.total_spent) * 100).toFixed(1) + '%' : '-',
        cls: u.total_spent && u.total_won > u.total_spent ? 'minus' : '',
        sub: `выиграл ${fmt(u.total_won)}` },
      { label: 'Долг по обороту', value: fmt(d.money.depositDebt),
        cls: d.money.depositDebt ? 'minus' : 'plus',
        sub: d.money.depositDebt ? 'вывод закрыт, пока не отыграет' : 'вывод открыт' },
      { label: 'Бонусный счёт', value: fmt(d.money.bonusBalance || 0),
        sub: d.money.wagerRequired ? `отыграть ${fmt(d.money.wagerRequired)}` : 'вывод не запирает' },
      { label: 'Бонусы в деньги', value: fmt(d.money.bonusConverted || 0),
        sub: `ещё можно ${fmt(d.money.bonusCashoutLeft || 0)}` },
    ])}

    <div class="bo-daybar">
      За сутки: поставил <b>${fmt(d.day.wagered)}</b> ·
      проиграл <b>${fmt(d.day.lost)}</b> ·
      пополнил <b>${fmt(d.day.deposited)}</b>
    </div>

    ${boCan('players.balance') ? `
    <h2 class="section-title">Запросы на пополнение</h2>
    <div class="bo-table-wrap"><table><thead><tr><th>ID</th><th>Дата</th><th>Способ</th><th>Сумма</th><th>Статус</th></tr></thead>
    <tbody>${[...(d.paymentRequests || []).map(r => ({ ...r, source: r.terminal === 'mk' ? 'Мобильная коммерция' : 'Сицилия' })), ...(d.cryptoRequests || []).map(r => ({ ...r, source: 'Криптовалюта' }))].sort((a,b) => b.created_at-a.created_at).map(r => `<tr><td>#${r.id}</td><td>${new Date(r.created_at).toLocaleString('ru-RU')}</td><td>${esc(r.source)}</td><td>${money(r.amount)}</td><td>${esc(r.status)}</td></tr>`).join('') || '<tr><td colspan="5">Запросов нет</td></tr>'}</tbody></table></div>
    <h2 class="section-title">Изменить баланс</h2>
    <div class="amount-row">
      <input class="seed-input" id="adjAmount" type="number" inputmode="numeric" placeholder="сумма">
      <input class="seed-input" id="adjNote" placeholder="комментарий" maxlength="200">
    </div>
    <label class="adj-mode">
      <input type="checkbox" id="adjCorrection">
      <span>Корректировка: деньги придут без отыгрыша</span>
    </label>
    <label class="adj-mode"><input type="checkbox" id="adjDispute"><span>По спору (пополнения Сицилии)</span></label>
    <select class="seed-input" id="adjDisputeMethod"><option value="sbp">СБП</option><option value="card">Карта</option><option value="mk">Мобильная коммерция</option></select>
    <p class="adj-hint">Обычное начисление считается пополнением, и его надо
      прокрутить через ставки, прежде чем откроется вывод. Для возврата после
      сбоя или компенсации ставьте галочку - иначе поддержка своими руками
      запрёт игроку вывод.${state.admin.me?.balanceCap
        ? ` Ваш потолок одной правки: ${fmt(state.admin.me.balanceCap)}.` : ''}</p>
    <div class="admin-actions">
      <button class="btn btn-primary" id="adjPlus"><span data-ico="plus"></span> Начислить</button>
      <button class="btn btn-outline" id="adjMinus"><span data-ico="minus"></span> Списать</button>
    </div>` : ''}

    ${boCan('players.gift') ? `
    <h2 class="section-title">Подарочный кейс</h2>
    <div class="amount-row">
      <select class="seed-input" id="voucherCase">
        ${state.config.cases.map((c) => `<option value="${c.id}">${esc(c.name)} · ${fmt(c.price)}</option>`).join('')}
      </select>
      <input class="seed-input" id="voucherCount" type="number" value="1" min="1" max="100" style="max-width:80px">
    </div>
    <button class="btn btn-outline btn-wide" id="grantVoucher">Выдать кейс</button>` : ''}

    ${boCan('players.limits') ? `
    <h2 class="section-title">Лимиты ответственной игры</h2>
    <p class="game-sub">Ужесточение действует сразу, ослабление - через сутки.
      Лимит, который снимается в ту минуту, когда очень хочется играть, не лимит.</p>
    <div class="bo-settings">
      <label class="bo-field"><b>Пополнение в сутки</b>
        <i>0 - без ограничения</i>
        <input class="seed-input" type="number" id="limDeposit" value="${d.limits.deposit_day || 0}"></label>
      <label class="bo-field"><b>Проигрыш в сутки</b>
        <i>0 - без ограничения</i>
        <input class="seed-input" type="number" id="limLoss" value="${d.limits.loss_day || 0}"></label>
      <label class="bo-field"><b>Оборот в сутки</b>
        <i>0 - без ограничения</i>
        <input class="seed-input" type="number" id="limWager" value="${d.limits.wager_day || 0}"></label>
      <label class="bo-field"><b>Самоисключение, дней</b>
        <i>Продлить можно, укоротить - нет</i>
        <input class="seed-input" type="number" id="limExclude" value="0"></label>
    </div>
    ${d.limits.pending_at ? `<p class="adj-hint">Ослабление вступит в силу
      ${boDateTime(d.limits.pending_at)}.</p>` : ''}
    ${d.limits.excluded_until > Date.now() ? `<p class="adj-hint">Самоисключение
      до ${boDateTime(d.limits.excluded_until)}.</p>` : ''}
    <button class="btn btn-outline btn-wide" id="saveLimits">Сохранить лимиты</button>` : ''}

    ${boCan('players.block') ? `
    <h2 class="section-title">Доступ</h2>
    <button class="btn ${u.is_blocked ? 'btn-primary' : 'btn-outline'} btn-wide" id="toggleBlock">
      <span data-ico="block"></span> ${u.is_blocked ? 'Разблокировать' : 'Заблокировать'}
    </button>` : ''}

    ${boCan('players.notes') ? `
    <h2 class="section-title">Заметки</h2>
    <div class="amount-row">
      <input class="seed-input" id="noteText" maxlength="2000" placeholder="что важно знать следующему">
      <button class="btn btn-sm" id="noteAdd">Добавить</button>
    </div>
    ${d.notes.length ? d.notes.map((n) => `<div class="bo-note">
      <div>${esc(n.text)}</div>
      <div class="bo-sub">${esc(n.author_username ? '@' + n.author_username
        : (n.author_name || '#' + n.author_id))} · ${boDateTime(n.created_at)}
        <button class="bo-userlink" data-note-del="${n.id}">убрать</button></div>
    </div>`).join('') : '<div class="empty">Пока ничего</div>'}` : ''}

    ${d.vouchers.length ? `<h2 class="section-title">Подарки на руках</h2>
      ${d.vouchers.map((v) => `<div class="log-row"><span>${esc(
        state.config.cases.find((c) => c.id === v.case_id)?.name || v.case_id)}</span>
        <b>×${v.count}</b></div>`).join('')}` : ''}

    <h2 class="section-title">Действия администраторов</h2>
    ${logRows || '<div class="empty">Пока ничего</div>'}

    <h2 class="section-title">Последние раунды</h2>
    ${histRows || '<div class="empty">Пока ничего</div>'}
  `;

  detail.hidden = false;
  mountIcons(detail);

  document.getElementById('detailBack').addEventListener('click', () => { detail.hidden = true; });

  const adjust = async (sign) => {
    const raw = Math.abs(Math.trunc(Number(document.getElementById('adjAmount').value)));
    if (!raw) { toast('Укажите сумму'); return; }
    try {
      await api('/api/admin/balance', {
        userId, amount: sign * raw,
        note: document.getElementById('adjNote').value,
        asDeposit: !document.getElementById('adjCorrection').checked,
        dispute: document.getElementById('adjDispute').checked,
        disputeMethod: document.getElementById('adjDisputeMethod').value,
      });
      toast(sign > 0 ? `Начислено ${fmt(raw)}` : `Списано ${fmt(raw)}`);
      haptic('success');
      openAdminUser(userId);
      loadAdminUsers();
    } catch (err) { toast(err.message); haptic('error'); }
  };

  document.getElementById('adjPlus')?.addEventListener('click', () => adjust(1));
  document.getElementById('adjMinus')?.addEventListener('click', () => adjust(-1));

  document.getElementById('saveLimits')?.addEventListener('click', async () => {
    const num = (id) => Math.max(0, Math.trunc(Number(document.getElementById(id).value) || 0));
    try {
      await api('/api/admin/player/limits', { userId, patch: {
        deposit_day: num('limDeposit'), loss_day: num('limLoss'),
        wager_day: num('limWager'), excludedDays: num('limExclude'),
      } });
      toast('Лимиты сохранены');
      openAdminUser(userId);
    } catch (err) { toast(err.message); }
  });

  document.getElementById('noteAdd')?.addEventListener('click', async () => {
    const text = document.getElementById('noteText').value.trim();
    if (!text) { toast('Пустая заметка'); return; }
    try {
      await api('/api/admin/player/note', { userId, text });
      openAdminUser(userId);
    } catch (err) { toast(err.message); }
  });

  detail.querySelectorAll('[data-note-del]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api('/api/admin/player/note/delete', { noteId: Number(b.dataset.noteDel) });
        openAdminUser(userId);
      } catch (err) { toast(err.message); }
    };
  });

  document.getElementById('grantVoucher')?.addEventListener('click', async () => {
    try {
      await api('/api/admin/voucher', {
        userId,
        caseId: document.getElementById('voucherCase').value,
        count: Number(document.getElementById('voucherCount').value) || 1,
      });
      toast('Кейс выдан');
      haptic('success');
      openAdminUser(userId);
    } catch (err) { toast(err.message); haptic('error'); }
  });

  document.getElementById('toggleBlock')?.addEventListener('click', async () => {
    try {
      await api('/api/admin/block', { userId, blocked: !u.is_blocked });
      toast(u.is_blocked ? 'Разблокирован' : 'Заблокирован');
      openAdminUser(userId);
      loadAdminUsers();
    } catch (err) { toast(err.message); haptic('error'); }
  });
}

/* ---------- Панель: разделы и права ---------- */

/*
 * Список разделов с правом, которое их открывает.
 *
 * Право одно на раздел - то, без которого раздел бессмысленен. Внутри раздела
 * отдельные кнопки прячутся по своим правам: финансист видит заявки на вывод,
 * но кнопку «Выплатить» видит только с finance.payouts.resolve.
 */
const BO_SECTIONS = [
  { id: 'overview', name: 'Сводка', group: 'Обзор', need: 'reports.view', load: () => loadAdminOverview() },
  { id: 'reports', name: 'Отчёты', group: 'Обзор', need: 'reports.view', load: () => loadAdminReports() },
  { id: 'funnel', name: 'Воронка', group: 'Обзор', need: 'reports.view', load: () => loadAdminFunnel() },
  { id: 'feed', name: 'Лента', group: 'Обзор', need: 'reports.view', load: () => loadAdminOverview() },

  { id: 'users', name: 'Игроки', group: 'Игроки', need: 'players.view', load: () => loadAdminUsers() },
  { id: 'risk', name: 'Риск', group: 'Игроки', need: 'risk.view', load: () => loadAdminRisk() },

  { id: 'deposits', name: 'Пополнения', group: 'Финансы', need: 'finance.payouts.view', load: () => loadAdminDeposits() },
  { id: 'payouts', name: 'Выводы', group: 'Финансы', need: 'finance.payouts.view', load: () => loadAdminPayouts() },

  { id: 'promos', name: 'Промокоды', group: 'Промо', need: 'promo.view', load: () => loadAdminPromos() },
  { id: 'partners', name: 'Партнёры', group: 'Промо', need: 'partners.view', load: () => loadAdminPartners() },

  { id: 'casino', name: 'Казино', group: 'Система', need: 'games.manage', load: () => loadAdminCasino() },
  { id: 'settings', name: 'Настройки', group: 'Система', need: 'settings.manage', load: () => loadAdminSettings() },
  { id: 'staff', name: 'Сотрудники', group: 'Система', need: 'staff.manage', load: () => loadAdminStaff() },
  { id: 'journal', name: 'Журнал', group: 'Система', need: 'journal.view', load: () => loadAdminJournal() },
];

function boCan(permission) {
  return state.admin.perms?.has(permission) || false;
}

function boOpen(id) {
  const section = BO_SECTIONS.find((s) => s.id === id);
  if (!section || !boCan(section.need)) return;
  state.admin.tab = id;
  document.querySelectorAll('[data-admin-tab]').forEach((b) =>
    b.classList.toggle('active', b.dataset.adminTab === id));
  document.querySelectorAll('.admin-pane').forEach((p) =>
    p.classList.toggle('active', p.id === `admin-${id}`));
  document.getElementById('adminDetail').hidden = true;
  section.load();
  haptic('light');
}

/**
 * Собирает панель под права вошедшего.
 *
 * Вызывается при каждом входе в раздел: состав команды меняют на ходу, и
 * панель, собранная один раз при загрузке страницы, показывала бы вчерашние
 * права до перезагрузки.
 */
/* ---------- Подтверждение входа в панель ---------- */

/*
 * Если на сервере включён служебный бот, панель открывается только после
 * подтверждения в Telegram (server/ops.js). Экран сам опрашивает сервер и
 * открывает панель, как только в боте нажали «Это я».
 */
const GATE_POLL_MS = 2000;
const gateState = { poll: 0, id: 0 };

function showAdminShell(open) {
  document.getElementById('boGate').hidden = open;
  document.getElementById('boShell').hidden = !open;
  if (open) clearInterval(gateState.poll);
}

/** true - панель можно открывать. */
async function adminGateOk() {
  let st;
  try { st = await api('/api/admin/2fa/status'); }
  catch (err) { toast(err.message); return false; }
  if (!st.required || st.confirmed) { showAdminShell(true); return true; }
  renderAdminGate(st);
  return false;
}

async function renderAdminGate(st) {
  clearInterval(gateState.poll);
  if (!st) {
    try { st = await api('/api/admin/2fa/status'); } catch (err) { toast(err.message); return; }
  }
  showAdminShell(false);
  const box = document.getElementById('boGate');

  if (!st.linked) {
    box.innerHTML = `
      <div class="bo-gate-card">
        <div class="bo-gate-title">Привяжите Telegram</div>
        <p>Вход в панель подтверждается в служебном боте${st.bot ? ` <b>@${esc(st.bot)}</b>` : ''}.
          Откройте его по кнопке ниже и нажмите Start - бот запомнит этот Telegram.
          Сюда же будут приходить оповещения о сбоях.</p>
        <button class="btn btn-primary btn-wide" id="gateLink">Открыть служебного бота</button>
        <button class="btn btn-outline btn-wide" id="gateLinked">Я нажал Start</button>
      </div>`;
    document.getElementById('gateLink').onclick = async () => {
      const tab = openBlankTab();
      try {
        const { url } = await api('/api/admin/2fa/link');
        if (tab && !tab.closed) tab.location.href = url; else window.open(url, '_blank', 'noopener');
      } catch (err) { tab?.close(); toast(err.message); }
    };
    document.getElementById('gateLinked').onclick = () => initAdminPanel();
    return;
  }

  box.innerHTML = `
    <div class="bo-gate-card">
      <div class="bo-gate-title">Подтвердите вход</div>
      <p>Мы отправим запрос в служебного бота${st.bot ? ` <b>@${esc(st.bot)}</b>` : ''}.
        Нажмите там «Это я» - панель откроется сама. Не пришло - введите код из сообщения.</p>
      <button class="btn btn-primary btn-wide" id="gateSend">Отправить запрос в Telegram</button>
      <div class="bo-gate-wait" id="gateWait" hidden>
        <div class="bo-gate-status" id="gateStatus">Ждём подтверждения в Telegram…</div>
        <div class="bo-gate-code">
          <input class="seed-input" id="gateCode" inputmode="numeric" maxlength="6" placeholder="Код из сообщения">
          <button class="btn btn-outline" id="gateCodeBtn">Подтвердить</button>
        </div>
      </div>
    </div>`;

  const status = (text) => { document.getElementById('gateStatus').textContent = text; };
  document.getElementById('gateSend').onclick = async () => {
    const btn = document.getElementById('gateSend');
    btn.disabled = true;
    try {
      const r = await api('/api/admin/2fa/request');
      gateState.id = r.id;
      document.getElementById('gateWait').hidden = false;
      btn.textContent = 'Отправить ещё раз';
      status('Ждём подтверждения в Telegram…');
      clearInterval(gateState.poll);
      gateState.poll = setInterval(async () => {
        if (state.view !== 'admin') { clearInterval(gateState.poll); return; }
        try {
          const p = await api('/api/admin/2fa/poll', { id: gateState.id });
          if (p.confirmed) { clearInterval(gateState.poll); initAdminPanel(); return; }
          if (p.status === 'denied') { clearInterval(gateState.poll); status('Вход отклонён в Telegram. Сессия закрыта.'); }
          if (p.status === 'expired' || p.status === 'burned') { clearInterval(gateState.poll); status('Запрос устарел, отправьте новый.'); }
        } catch { /* сеть моргнула - следующий опрос */ }
      }, GATE_POLL_MS);
    } catch (err) { toast(err.message); }
    btn.disabled = false;
  };
  document.getElementById('gateCodeBtn').onclick = async () => {
    try {
      await api('/api/admin/2fa/code', { id: gateState.id, code: document.getElementById('gateCode').value });
      initAdminPanel();
    } catch (err) { status(err.message); haptic('error'); }
  };
}

async function initAdminPanel() {
  if (!(await adminGateOk())) return;
  let me;
  try { me = await api('/api/admin/me'); }
  catch (err) { toast(err.message); return; }

  state.admin.perms = new Set(me.permissions);
  state.admin.me = me;

  document.getElementById('boWho').innerHTML =
    `${esc(me.roleName || 'Без роли')} · прав: ${me.permissions.length}` +
    (me.balanceCap ? ` · правка баланса до ${fmt(me.balanceCap)}` : '');

  const allowed = BO_SECTIONS.filter((s) => boCan(s.need));
  const groups = [];
  for (const section of allowed) {
    let group = groups.find((g) => g.name === section.group);
    if (!group) groups.push(group = { name: section.group, items: [] });
    group.items.push(section);
  }

  document.getElementById('boNav').innerHTML = groups.map((g) => `
    <div class="bo-group">
      <div class="bo-group-name">${esc(g.name)}</div>
      ${g.items.map((s) => `<button class="bo-link" data-admin-tab="${s.id}">${esc(s.name)}${
        s.id === 'deposits' && me.sections?.disputes ? ` <span class="bo-badge" title="Споры ждут решения">${fmt(me.sections.disputes)}</span>` : ''}</button>`).join('')}
    </div>`).join('') || '<div class="empty">Разделов нет</div>';

  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.addEventListener('click', () => boOpen(btn.dataset.adminTab));
  });

  const first = allowed.find((s) => s.id === state.admin.tab) || allowed[0];
  if (first) boOpen(first.id);
  else document.getElementById('boNav').innerHTML =
    '<div class="empty">Доступа ни к одному разделу нет</div>';
}


/* ---------- Панель: казино ---------- */

/*
 * Состояние каталога и деньги казино. Отдачу здесь не меняют: она в
 * «Настройках» рядом с выключателями игр, а тут видно, какое число
 * применяется на самом деле (с учётом пределов агрегатора).
 */
async function loadAdminCasino() {
  const pane = document.getElementById('admin-casino');
  pane.innerHTML = '<div class="empty">Загрузка...</div>';
  let d;
  try { d = await api('/api/admin/casino'); } catch (err) { pane.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  const s = d.sync;
  const syncLine = !d.configured
    ? 'Ключи агрегатора не заданы: каталог из снимка в репозитории'
    : s.running ? 'Идёт обновление каталога...'
    : s.at ? `${s.ok ? 'Обновлён' : 'Ошибка обновления'} ${boDateTime(s.at)}${s.ok ? '' : `: ${esc(s.message)}`}`
    : 'Ещё не обновлялся';
  const row = (label, m) => `<tr><td>${label}</td><td class="num">${money(m.bets)}</td><td class="num">${money(m.wins)}</td>
    <td class="num">${money(m.ggr)}</td><td class="num">${fmt(m.rounds)}</td><td class="num">${fmt(m.players)}</td></tr>`;
  pane.innerHTML = `
    ${boKpis([
      { label: 'Игр в лобби', value: fmt(s.games), sub: `провайдеров ${fmt(s.providers)}` },
      { label: 'Отдача слотов', value: `${d.rtp}%`, sub: `пределы агрегатора ${d.rtpRange[0]}-${d.rtpRange[1]}%` },
      { label: 'Доход кассы за 30 дней', value: money(d.month.ggr), sub: 'ставки минус выигрыши', cls: d.month.ggr >= 0 ? 'plus' : 'minus' },
    ])}
    <div class="bo-subtitle">Каталог</div>
    <p class="bo-note">${syncLine}. По расписанию каталог обновляется сам.</p>
    <div class="admin-actions">
      <button class="btn btn-outline btn-sm" id="casinoSync" ${d.configured ? '' : 'disabled'}>Обновить сейчас</button>
    </div>
    <div class="bo-subtitle">Деньги</div>
    ${boTable([{ label: 'Период' }, { label: 'Ставки', num: true }, { label: 'Выигрыши', num: true },
      { label: 'Доход', num: true }, { label: 'Раундов', num: true }, { label: 'Игроков', num: true }],
      [row('Сутки', d.today), row('7 дней', d.week), row('30 дней', d.month)])}`;
  document.getElementById('casinoSync')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await api('/api/admin/casino/sync'); toast('Каталог обновлён'); } catch (err) { toast(err.message); }
    loadAdminCasino();
  });
}

/* ---------- Панель: общие кирпичи ---------- */

const boDate = (t) => new Date(t).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
const boDateTime = (t) => new Date(t).toLocaleString('ru-RU',
  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function boKpis(items) {
  return `<div class="admin-kpis">${items.map((k) => `<div class="kpi">
    <div class="kpi-label">${esc(k.label)}</div>
    <div class="kpi-value ${k.cls || ''}">${k.value}</div>
    ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ''}
  </div>`).join('')}</div>`;
}

function boTable(head, rows, empty = 'Нет данных') {
  return `<div class="bo-scroll"><table class="admin-table">
    <thead><tr>${head.map((h) => `<th class="${h.num ? 'num' : ''}">${esc(h.label ?? h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.length ? rows.join('')
      : `<tr><td colspan="${head.length}">${esc(empty)}</td></tr>`}</tbody>
  </table></div>`;
}

/*
 * Столбики рисуются делениями, а не картинкой и не библиотекой.
 *
 * График в панели нужен ровно для одного: увидеть, что позавчера было не как
 * обычно. Для этого хватает высоты столбика, а тянуть ради этого рисовалку в
 * проект без сборщика - значит тянуть её и на телефон игрока.
 */
function boBars(points, { key, label, color = 'var(--cyan)' }) {
  const max = Math.max(1, ...points.map((p) => Math.abs(p[key])));
  return `<div class="bo-chart" role="img" aria-label="${esc(label)}">
    ${points.map((p) => {
      const value = p[key];
      const height = Math.round((Math.abs(value) / max) * 100);
      return `<div class="bo-bar" title="${boDate(p.day)}: ${fmt(value)}">
        <i style="height:${Math.max(2, height)}%;background:${value < 0 ? 'var(--pink)' : color}"></i>
        <span>${boDate(p.day)}</span>
      </div>`;
    }).join('')}
  </div>`;
}

/* ---------- Панель: отчёты ---------- */

async function loadAdminReports() {
  const box = document.getElementById('admin-reports');
  box.innerHTML = '<div class="empty">Считаем...</div>';

  let d;
  try { d = await api('/api/admin/reports', { days: state.admin.reportDays }); }
  catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  const sum = (key) => d.daily.reduce((a, r) => a + r[key], 0);
  const wagered = sum('wagered');
  const paid = sum('paid');

  const dayRows = [...d.daily].reverse().map((r) => `<tr>
    <td>${boDate(r.day)}</td>
    <td class="num">${fmt(r.rounds)}</td>
    <td class="num">${fmt(r.players)}</td>
    <td class="num">${fmt(r.wagered)}</td>
    <td class="num ${r.ggr >= 0 ? 'plus' : 'minus'}">${fmt(r.ggr)}</td>
    <td class="num">${pct(r.rtp)}</td>
    <td class="num">${fmt(r.deposits)}</td>
    <td class="num">${fmt(r.payouts)}</td>
    <td class="num ${r.net >= 0 ? 'plus' : 'minus'}">${fmt(r.net)}</td>
    <td class="num">${fmt(r.signups)}</td>
  </tr>`);

  const caseRows = d.cases.slice(0, 30).map((c) => `<tr>
    <td>${esc(c.title)}</td>
    <td class="num">${fmt(c.opened)}</td>
    <td class="num">${fmt(c.players)}</td>
    <td class="num">${fmt(c.wagered)}</td>
    <td class="num ${c.ggr >= 0 ? 'plus' : 'minus'}">${fmt(c.ggr)}</td>
    <td class="num">${pct(c.rtp)}</td>
  </tr>`);

  box.innerHTML = `
    <div class="admin-tabs" id="reportPeriod">
      ${[7, 30, 90].map((n) => `<button class="tab ${n === state.admin.reportDays ? 'active' : ''}"
        data-report-days="${n}">${n} дней</button>`).join('')}
      <button class="tab" id="exportDaily">Выгрузить дни</button>
      <button class="tab" id="exportCases">Выгрузить кейсы</button>
    </div>

    ${boKpis([
      { label: 'Поставлено', value: fmt(wagered) },
      { label: 'Выплачено', value: fmt(paid) },
      { label: 'Доход с игры', value: fmt(wagered - paid),
        cls: wagered - paid >= 0 ? 'plus' : 'minus',
        sub: `фактическая отдача ${pct(wagered ? paid / wagered : null)}` },
      { label: 'Пополнено', value: fmt(sum('deposits')) },
      { label: 'Выведено', value: fmt(sum('payouts')) },
      { label: 'Чистый приход', value: fmt(sum('deposits') - sum('payouts')),
        cls: sum('deposits') - sum('payouts') >= 0 ? 'plus' : 'minus',
        sub: 'пополнения минус выплаты' },
      { label: 'Регистраций', value: fmt(sum('signups')) },
    ])}

    <h2 class="section-title">Доход с игры по дням</h2>
    ${boBars(d.daily, { key: 'ggr', label: 'Доход по дням', color: 'var(--green)' })}

    <h2 class="section-title">Чистый приход кассы по дням</h2>
    <p class="game-sub">Пополнения минус выплаты. Доход с игры считает ставки,
      но выигрыш на балансе игрока ещё не выведен и ничей.</p>
    ${boBars(d.daily, { key: 'net', label: 'Приход кассы по дням' })}

    <h2 class="section-title">По дням</h2>
    ${boTable(
      ['Дата', { label: 'Раундов', num: 1 }, { label: 'Игроков', num: 1 },
       { label: 'Ставки', num: 1 }, { label: 'Доход', num: 1 }, { label: 'Отдача', num: 1 },
       { label: 'Пополнено', num: 1 }, { label: 'Выведено', num: 1 },
       { label: 'Чисто', num: 1 }, { label: 'Регистраций', num: 1 }],
      dayRows)}

    <h2 class="section-title">По кейсам</h2>
    ${boTable(
      ['Кейс', { label: 'Открытий', num: 1 }, { label: 'Игроков', num: 1 },
       { label: 'Ставки', num: 1 }, { label: 'Доход', num: 1 }, { label: 'Отдача', num: 1 }],
      caseRows)}
  `;

  box.querySelectorAll('[data-report-days]').forEach((btn) => {
    btn.onclick = () => {
      state.admin.reportDays = Number(btn.dataset.reportDays);
      loadAdminReports();
    };
  });
  box.querySelector('#exportDaily').onclick = () => boExport('daily');
  box.querySelector('#exportCases').onclick = () => boExport('cases');
}

/**
 * Выгрузка отчёта файлом.
 *
 * Скачивание собрано вручную через Blob, а не ссылкой на ручку: отчёт
 * отдаётся только на POST, чтобы чужая страница не могла подсунуть ссылку
 * на выгрузку и заставить браузер сотрудника её открыть.
 */
async function boExport(kind) {
  try {
    const res = await fetch('/api/admin/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, days: state.admin.reportDays }),
    });
    if (!res.ok) throw new Error('Не удалось выгрузить');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `luckybox-${kind}-${state.admin.reportDays}d.csv`;
    a.click();
    // Отзыв ссылки сразу после click() в Safari и Firefox иногда отменял загрузку.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Файл готов');
  } catch (err) { toast(err.message); }
}

/* ---------- Панель: пополнения ---------- */

/*
 * Все пополнения через шлюзы одним списком. Главное здесь - номера: наш (его
 * шлюз видит в каждом запросе) и шлюза (его видно в их кабинете). При споре
 * сотрудник ищет сделку по любому номеру, который ему назвали, и копирует
 * нужный одним нажатием, а не переписывает руками.
 */
const DEP_FILTERS = [
  ['all', 'Все'], ['credited', 'Зачислены'], ['open', 'Ждут оплаты'], ['failed', 'Не оплачены'], ['dispute', 'Споры'],
];
const DEP_STATUS = {
  created: 'создан', pending: 'ждёт оплаты', processing: 'в обработке', completed: 'зачислен',
  cancelled: 'отменён шлюзом', error: 'ошибка шлюза', unclaimed: 'отозван', expired: 'не оплачен вовремя',
  paid: 'зачислен', paid_over: 'зачислен с переплатой', failed: 'не прошёл', wrong_amount: 'не та сумма',
  cancel: 'отменён', fail: 'не прошёл', system_fail: 'сбой шлюза', process: 'в обработке', check: 'проверяется',
};
const DISPUTE_STATUS = {
  new: 'Игрок сообщил: деньги не пришли', sent: 'Апелляция у шлюза', won: 'Спор выигран, зачислено',
  lost: 'Шлюз отказал', declined: 'Отказано сотрудником',
};
/* Сколько дней выгружать: финансист сверяется с выпиской за месяц. */
const EXPORT_DAYS = [7, 30, 90];

function idChip(label, value) {
  if (!value) return '';
  return `<button class="dep-id" type="button" data-copy="${esc(String(value))}" title="Скопировать">
    <span>${esc(label)}</span><b>${esc(String(value))}</b></button>`;
}

function bindIdChips(box) {
  box.querySelectorAll('[data-copy]').forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Скопировано'); haptic('light'); }
      catch { toast('Скопируйте вручную'); }
    });
  });
}

function exportBarHtml() {
  return `<div class="dep-export">
    <span>Выгрузка в Excel</span>
    <select class="seed-input" id="depExportDays">${EXPORT_DAYS.map((d) =>
      `<option value="${d}"${d === 30 ? ' selected' : ''}>${d} дн.</option>`).join('')}</select>
    <button class="btn btn-outline btn-sm" data-fin-export="deposits">Пополнения</button>
    <button class="btn btn-outline btn-sm" data-fin-export="payouts">Выводы</button>
  </div>`;
}

function bindExportBar(box) {
  box.querySelectorAll('[data-fin-export]').forEach((b) => b.addEventListener('click', () =>
    finExport(b.dataset.finExport, Number(box.querySelector('#depExportDays')?.value) || 30)));
}

/* Скачивание тем же способом, что и отчёты: POST и Blob, а не ссылка. */
async function finExport(kind, days) {
  try {
    const res = await fetch('/api/admin/export/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, days }),
    });
    if (!res.ok) throw new Error('Не удалось выгрузить');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `luckybox-${kind}-${days}d.csv`;
    a.click();
    // Отзыв ссылки сразу после click() в Safari и Firefox иногда отменял загрузку.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Файл готов');
  } catch (err) { toast(err.message); }
}

/*
 * Чек с телефона - это фото на 4-8 МБ. Пережимаем в JPEG по длинной стороне
 * RECEIPT_MAX_SIDE: текст чека читается, а файл в разы меньше, что важно на
 * мобильной связи и для лимита шлюза. Не вышло (старый браузер) - уходит как есть.
 */
async function loadAdminDeposits({ more = false } = {}) {
  const box = document.getElementById('admin-deposits');
  const st = state.admin.dep || (state.admin.dep = { filter: 'all', q: '', rows: [] });
  if (!more) st.rows = [];
  if (!box.dataset.built) {
    box.dataset.built = '1';
    box.innerHTML = `
      <div id="depKpis"></div>
      <div class="admin-search">
        <input class="seed-input" id="depSearch" placeholder="номер наш или шлюза, почта, ник, id игрока">
        <button class="btn btn-sm" id="depSearchBtn">Найти</button>
      </div>
      <div class="admin-tabs" id="depFilter">${DEP_FILTERS.map(([id, name]) =>
        `<button class="tab${id === st.filter ? ' active' : ''}" data-dep-filter="${id}">${name}</button>`).join('')}</div>
      <div id="depList"></div>
      <button class="btn btn-outline" id="depMore" hidden>Показать ещё</button>
      ${exportBarHtml()}`;
    const search = () => { st.q = box.querySelector('#depSearch').value.trim(); loadAdminDeposits(); };
    box.querySelector('#depSearchBtn').addEventListener('click', search);
    box.querySelector('#depSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
    box.querySelectorAll('[data-dep-filter]').forEach((b) => b.addEventListener('click', () => {
      st.filter = b.dataset.depFilter;
      box.querySelectorAll('[data-dep-filter]').forEach((x) => x.classList.toggle('active', x === b));
      loadAdminDeposits();
    }));
    box.querySelector('#depMore').addEventListener('click', () => loadAdminDeposits({ more: true }));
    bindExportBar(box);
  }

  const list = box.querySelector('#depList');
  if (!more) list.innerHTML = '<span class="skel skel-line"></span>'.repeat(4);
  let d;
  try {
    d = await api('/api/admin/deposits', {
      q: st.q, filter: st.filter, before: more && st.rows.length ? st.rows[st.rows.length - 1].created_at : 0,
    });
  } catch (err) { list.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  st.rows.push(...d.rows);
  st.meta = d;

  const s = d.summary;
  box.querySelector('#depKpis').innerHTML = `<div class="admin-kpis">
    <div class="kpi"><div class="kpi-label">Зачислено за сутки</div>
      <div class="kpi-value plus">${money(s.paidSum)}</div><div class="kpi-sub">${fmt(s.paidCount)} оплат</div></div>
    <div class="kpi"><div class="kpi-label">Доходят до оплаты</div>
      <div class="kpi-value">${s.conversion == null ? '-' : Math.round(s.conversion * 100) + '%'}</div>
      <div class="kpi-sub">из созданных за сутки</div></div>
    <div class="kpi${s.disputesNew ? ' kpi-alert' : ''}"><div class="kpi-label">Споры ждут решения</div>
      <div class="kpi-value">${fmt(s.disputesNew)}</div><div class="kpi-sub">сообщили игроки</div></div>
    <div class="kpi"><div class="kpi-label">Апелляции у шлюза</div>
      <div class="kpi-value">${fmt(s.disputesSent)}</div><div class="kpi-sub">ждём решения Sicilia</div></div>
  </div>`;

  list.innerHTML = st.rows.length ? st.rows.map((r) => depositRowHtml(r, d)).join('')
    : `<div class="empty">${st.q ? 'Ничего не нашлось' : 'Пополнений нет'}</div>`;
  box.querySelector('#depMore').hidden = d.rows.length < 50;
  bindIdChips(list);
  bindDepositRows(list);
}

function depositRowHtml(r, meta) {
  const paid = !!r.paid_at;
  const name = r.username ? '@' + r.username : (r.email || r.first_name || ('#' + r.user_id));
  const tone = paid ? 'paid' : ['created', 'pending', 'processing', 'process', 'check'].includes(r.status) ? 'processing' : 'rejected';
  const d = r.dispute;
  const canAct = meta.canResolve && r.source === 'sicilia' && !paid;
  const disputeBox = d ? `<div class="dep-dispute is-${d.status}">
      <b>${esc(DISPUTE_STATUS[d.status] || d.status)}</b>
      <small>${d.source === 'player' ? 'Сообщил игрок' : 'Открыл сотрудник'} · ${new Date(d.createdAt).toLocaleString('ru-RU')}</small>
      ${d.comment ? `<p>«${esc(d.comment)}»</p>` : ''}
      ${d.receipt ? `<a class="dep-receipt" href="${esc(d.receipt)}" target="_blank" rel="noopener"><img src="${esc(d.receipt)}" alt="Чек" loading="lazy"><span>Открыть чек</span></a>` : ''}
      ${d.appealReason ? `<p>Ответ шлюза: ${esc(d.appealReason)}</p>` : ''}
      ${d.staffNote ? `<p>Ответ игроку: ${esc(d.staffNote)}</p>` : ''}
      ${d.error ? `<p class="dep-error">Не ушло в шлюз: ${esc(d.error)}</p>` : ''}
    </div>` : '';
  const newDispute = d && d.status === 'new';
  const actions = canAct ? `<div class="dep-actions" data-dep-actions="${r.id}">
      <button class="btn btn-outline btn-sm" data-dep-recheck="${r.id}">Проверить у шлюза</button>
      ${['created', 'pending', 'processing'].includes(r.status) ? `<button class="btn btn-outline btn-sm" data-dep-cancel="${r.id}">Отменить у шлюза</button>` : ''}
      ${!d || !['new', 'sent'].includes(d.status) || newDispute
        ? `<button class="btn btn-sm" data-dep-appeal="${r.id}" data-dispute="${newDispute ? d.id : ''}">${newDispute ? 'Отправить спор в Sicilia' : 'Открыть спор'}</button>` : ''}
      ${newDispute ? `<button class="btn btn-outline btn-sm" data-dep-decline="${d.id}">Отказать</button>` : ''}
    </div>
    <div class="dep-form" data-dep-form="${r.id}" hidden></div>` : '';
  return `<div class="payout-row admin ${tone}">
    <div class="payout-head">
      <b>${money(r.amount)}${paid && r.credited !== r.amount ? ` <small class="dep-fact">зачислено ${money(r.credited)}</small>` : ''}</b>
      <span class="payout-status ${tone}">${esc(DEP_STATUS[r.status] || r.status)}</span>
    </div>
    <div class="payout-date">${r.source === 'sicilia' ? (r.terminal === 'mk' ? 'Мобильная коммерция · Sicilia' : 'СБП / карта · Sicilia') : `Криптовалюта${r.currency ? ' ' + esc(r.currency) : ''} · Heleket`} ·
      <a href="#" data-dep-user="${r.user_id}">${esc(name)}</a> · ${esc(playerIdent(r, r.user_id))}</div>
    <div class="payout-date">Создан ${new Date(r.created_at).toLocaleString('ru-RU')}${paid ? ` · зачислен ${new Date(r.paid_at).toLocaleString('ru-RU')}` : ''}</div>
    <div class="dep-ids">${idChip('Наш номер', r.number)}${idChip(r.source === 'sicilia' ? 'Номер Sicilia' : 'Номер Heleket', r.gateway_id)}</div>
    ${disputeBox}
    ${actions}
  </div>`;
}

function bindDepositRows(list) {
  list.querySelectorAll('[data-dep-user]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    openAdminUser(Number(a.dataset.depUser));
  }));
  list.querySelectorAll('[data-dep-recheck]').forEach((b) => b.addEventListener('click', () => withCashBusy(b, async () => {
    try {
      const r = await api('/api/admin/deposit/recheck', { id: Number(b.dataset.depRecheck) });
      toast(r.credited ? `Зачислено ${money(r.amount)}` : `Шлюз отвечает: ${DEP_STATUS[r.status] || r.status || 'нет ордера'}`);
      loadAdminDeposits();
    } catch (err) { toast(err.message); }
  })));
  list.querySelectorAll('[data-dep-cancel]').forEach((b) => b.addEventListener('click', () => {
    // Второе нажатие подтверждает: отмена оплаты, которую игрок сейчас
    // переводит, оставит его деньги у трейдера до разбора.
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Точно отменить?'; return; }
    withCashBusy(b, async () => {
      try {
        const r = await api('/api/admin/deposit/cancel', { id: Number(b.dataset.depCancel) });
        toast(r.credited ? `Оплата успела пройти: зачислено ${money(r.amount)}` : 'Оплата отменена у шлюза');
        loadAdminDeposits();
      } catch (err) { toast(err.message); }
    });
  }));
  list.querySelectorAll('[data-dep-appeal]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.depAppeal;
    const form = list.querySelector(`[data-dep-form="${id}"]`);
    const row = state.admin.dep.rows.find((x) => x.source === 'sicilia' && String(x.id) === id);
    const fromPlayer = !!b.dataset.dispute;
    if (!state.admin.dep.meta.siteUrl) { toast('Не задан SITE_URL: шлюзу не по чему открыть чек'); return; }
    form.hidden = !form.hidden;
    if (form.hidden) return;
    form.innerHTML = `
      <label class="dep-label">Причина для шлюза</label>
      <textarea class="seed-input" rows="2" data-f="reason" placeholder="Например: перевод выполнен, чек приложен, сумма совпадает">${esc(row?.dispute?.comment || '')}</textarea>
      <label class="dep-label">${fromPlayer ? 'Свой чек, если чек игрока не годится' : 'Чек перевода (фото или скриншот)'}</label>
      <label class="dep-file"><span data-f="filename">Выбрать файл</span><input type="file" accept="image/*" data-f="file" hidden></label>
      <div class="admin-actions"><button class="btn btn-primary" data-f="send">Отправить апелляцию</button></div>`;
    form.querySelector('[data-f="file"]').addEventListener('change', (e) => {
      form.querySelector('[data-f="filename"]').textContent = e.target.files[0]?.name || 'Выбрать файл';
    });
    form.querySelector('[data-f="send"]').addEventListener('click', (e) => withCashBusy(e.currentTarget, async () => {
      try {
        const image = await receiptDataUrl(form.querySelector('[data-f="file"]').files[0]);
        if (!fromPlayer && !image) { toast('Приложите чек'); return; }
        const r = await api('/api/admin/dispute/open', {
          orderId: Number(id), disputeId: fromPlayer ? Number(b.dataset.dispute) : undefined,
          reason: form.querySelector('[data-f="reason"]').value, image,
        });
        toast(r.credited ? 'Пока открывали спор, деньги пришли: зачислено' : 'Апелляция открыта, решение придёт от шлюза');
        haptic('success');
        loadAdminDeposits();
      } catch (err) { toast(err.message); }
    }));
  }));
  list.querySelectorAll('[data-dep-decline]').forEach((b) => b.addEventListener('click', () => {
    const form = b.closest('.payout-row').querySelector('[data-dep-form]');
    form.hidden = false;
    form.innerHTML = `
      <label class="dep-label">Ответ игроку: почему отказано</label>
      <textarea class="seed-input" rows="2" data-f="note" placeholder="Например: перевод ушёл на реквизиты другого платежа"></textarea>
      <div class="admin-actions"><button class="btn btn-outline" data-f="send">Отказать</button></div>`;
    form.querySelector('[data-f="send"]').addEventListener('click', (e) => withCashBusy(e.currentTarget, async () => {
      try {
        await api('/api/admin/dispute/decline', { id: Number(b.dataset.depDecline), note: form.querySelector('[data-f="note"]').value });
        toast('Игрок увидит ответ в кассе');
        loadAdminDeposits();
      } catch (err) { toast(err.message); }
    }));
  }));
}

/* ---------- Панель: риск ---------- */

async function loadAdminRisk() {
  const box = document.getElementById('admin-risk');
  box.innerHTML = '<div class="empty">Проверяем...</div>';

  let d;
  try { d = await api('/api/admin/risk'); }
  catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  const openLink = (id, label) =>
    `<button class="bo-userlink" data-open-user="${id}">${esc(label)}</button>`;

  const signals = [
    {
      title: 'Один номер СБП на нескольких аккаунтах',
      hint: 'Самый прямой признак мультиаккаунта: деньги сходятся в один кошелёк.',
      head: ['Номер', { label: 'Аккаунтов', num: 1 }, { label: 'Сумма заявок', num: 1 }, 'Кто'],
      rows: d.sharedPhone.map((r) => `<tr>
        <td>${esc(r.phone)}</td><td class="num">${r.accounts}</td>
        <td class="num">${fmt(r.amount)}</td>
        <td>${String(r.users).split(',').map((id) => openLink(id, '#' + id)).join(' ')}</td></tr>`),
    },
    {
      title: 'Один криптокошелёк на нескольких аккаунтах',
      head: ['Адрес', { label: 'Аккаунтов', num: 1 }, { label: 'Сумма заявок', num: 1 }, 'Кто'],
      rows: d.sharedWallet.map((r) => `<tr>
        <td class="bo-mono">${esc(String(r.address).slice(0, 18))}…</td>
        <td class="num">${r.accounts}</td><td class="num">${fmt(r.amount)}</td>
        <td>${String(r.users).split(',').map((id) => openLink(id, '#' + id)).join(' ')}</td></tr>`),
    },
    {
      title: 'Заявка на вывод при почти нулевом обороте',
      hint: 'Так выглядит и вымывание бонусов, и прогон чужих денег через площадку.',
      head: ['Игрок', { label: 'Заявка', num: 1 }, { label: 'Поставил всего', num: 1 },
             { label: 'Раундов', num: 1 }, 'Статус'],
      rows: d.quickCashout.map((r) => `<tr>
        <td>${openLink(r.user_id, r.username ? '@' + r.username : (r.first_name || '#' + r.user_id))}</td>
        <td class="num">${fmt(r.amount)}</td><td class="num">${fmt(r.total_spent)}</td>
        <td class="num">${fmt(r.total_rounds)}</td><td>${esc(r.status)}</td></tr>`),
    },
    {
      title: 'Отдача игрока сильно выше заявленной',
      hint: 'Само по себе это везение. Ровно так же выглядит и найденная дыра, поэтому смотреть стоит.',
      head: ['Игрок', { label: 'Поставил', num: 1 }, { label: 'Выиграл', num: 1 },
             { label: 'Его отдача', num: 1 }, { label: 'Баланс', num: 1 }],
      rows: d.hotPlayers.map((r) => `<tr>
        <td>${openLink(r.id, r.username ? '@' + r.username : (r.first_name || '#' + r.id))}</td>
        <td class="num">${fmt(r.total_spent)}</td><td class="num">${fmt(r.total_won)}</td>
        <td class="num plus">${((r.total_won / r.total_spent) * 100).toFixed(0)}%</td>
        <td class="num">${fmt(r.balance)}</td></tr>`),
    },
    {
      title: 'Свежие аккаунты с бонусом и без единой ставки',
      head: ['Игрок', { label: 'Промокодов', num: 1 }, { label: 'Баланс', num: 1 }, 'Заведён'],
      rows: d.bonusOnly.map((r) => `<tr>
        <td>${openLink(r.id, r.username ? '@' + r.username : (r.first_name || '#' + r.id))}</td>
        <td class="num">${r.redemptions}</td><td class="num">${fmt(r.balance)}</td>
        <td>${boDateTime(r.created_at)}</td></tr>`),
    },
  ];

  const total = signals.reduce((a, s) => a + s.rows.length, 0);

  box.innerHTML = `
    <p class="game-sub">Сигнал это повод посмотреть, а не повод заблокировать.
      Ни один из них ничего не делает сам.</p>
    ${boKpis([{ label: 'Сигналов', value: fmt(total),
                cls: total ? 'minus' : 'plus',
                sub: total ? 'есть что проверить' : 'чисто' }])}
    ${signals.map((s) => `
      <h2 class="section-title">${esc(s.title)}</h2>
      ${s.hint ? `<p class="game-sub">${esc(s.hint)}</p>` : ''}
      ${boTable(s.head, s.rows, 'Чисто')}`).join('')}
  `;

  box.querySelectorAll('[data-open-user]').forEach((b) => {
    b.onclick = () => openAdminUser(Number(b.dataset.openUser));
  });
}

/* ---------- Панель: настройки площадки ---------- */

async function loadAdminSettings() {
  const box = document.getElementById('admin-settings');
  box.innerHTML = '<div class="empty">Загружаем...</div>';

  let d;
  try { d = await api('/api/admin/settings'); }
  catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  const groups = [];
  for (const row of d.rows) {
    let g = groups.find((x) => x.name === row.group);
    if (!g) groups.push(g = { name: row.group, items: [] });
    g.items.push(row);
  }

  box.innerHTML = `
    <p class="game-sub">Меняется на лету, без выката. Каждая правка попадает
      в журнал вместе с тем, что было до неё.</p>
    ${groups.map((g) => `
      <h2 class="section-title">${esc(g.name)}</h2>
      <div class="bo-settings">
        ${g.items.map((row) => row.type === 'bool' ? `
          <label class="bo-toggle">
            <input type="checkbox" data-setting="${row.key}" ${row.value === '1' ? 'checked' : ''}>
            <span><b>${esc(row.label)}</b>${row.hint ? `<i>${esc(row.hint)}</i>` : ''}</span>
          </label>` : `
          <label class="bo-field">
            <b>${esc(row.label)}</b>
            ${row.hint ? `<i>${esc(row.hint)}</i>` : ''}
            <input class="seed-input" type="number" inputmode="numeric"
                   data-setting="${row.key}" value="${esc(row.value)}">
          </label>`).join('')}
      </div>`).join('')}
    <button class="btn btn-primary btn-wide" id="saveSettings">Сохранить</button>
  `;

  box.querySelector('#saveSettings').onclick = async () => {
    const patch = {};
    box.querySelectorAll('[data-setting]').forEach((el) => {
      patch[el.dataset.setting] = el.type === 'checkbox' ? el.checked : el.value;
    });
    try {
      await api('/api/admin/settings/save', { patch });
      toast('Сохранено');
      haptic('success');
      loadAdminSettings();
    } catch (err) { toast(err.message); haptic('error'); }
  };
}

/* ---------- Панель: сотрудники ---------- */

async function loadAdminStaff() {
  const box = document.getElementById('admin-staff');
  box.innerHTML = '<div class="empty">Загружаем...</div>';

  let d;
  try { d = await api('/api/admin/staff'); }
  catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  state.admin.staff = d;
  const roleName = (id) => d.roles.find((r) => r.id === id)?.name || id;

  const rows = d.rows.map((r) => {
    const name = r.username ? '@' + r.username : (r.first_name || 'Без имени');
    return `<tr class="${r.active ? '' : 'bo-off'}">
      <td>${esc(name)}<div class="bo-sub">${esc(playerIdent(r, r.user_id))}</div></td>
      <td>${esc(roleName(r.role))}${r.added_by === null ? '<div class="bo-sub">из настроек сервера</div>' : ''}</td>
      <td class="num">${fmt(r.actions || 0)}</td>
      <td>${r.last_action ? boDateTime(r.last_action) : 'не заходил'}</td>
      <td>${r.active ? '<span class="bo-ok">работает</span>' : '<span class="bo-no">выключен</span>'}</td>
      <td class="bo-rowact">
        <button class="btn btn-sm" data-staff-edit="${r.user_id}">Править</button>
        ${r.user_id === d.meId ? '' : `<button class="btn btn-sm btn-outline" data-staff-del="${r.user_id}">Убрать</button>`}
      </td>
    </tr>`;
  });

  box.innerHTML = `
    <p class="game-sub">Роль это заготовка набора прав. Поправки сверху дают
      «поддержка, но ещё и промокоды» без новой роли.</p>

    ${boTable(['Сотрудник', 'Роль', { label: 'Действий', num: 1 }, 'Последнее', 'Статус', ''], rows,
              'Пока только вы')}

    <h2 class="section-title">Роли</h2>
    <div class="bo-roles">
      ${d.roles.map((r) => `<div class="bo-role ${d.assignable.includes(r.id) ? '' : 'bo-off'}">
        <b>${esc(r.name)}</b>
        <p>${esc(r.description)}</p>
        <span>${r.permissions.length} прав${r.balanceCap ? ` · правка баланса до ${fmt(r.balanceCap)}` : ''}</span>
        ${d.assignable.includes(r.id) ? '' : '<span class="bo-no">вам недоступна</span>'}
      </div>`).join('')}
    </div>

    <h2 class="section-title">Добавить или изменить</h2>
    <div id="staffForm"></div>
  `;

  renderStaffForm(null);

  box.querySelectorAll('[data-staff-edit]').forEach((b) => {
    b.onclick = () => {
      const row = d.rows.find((r) => r.user_id === Number(b.dataset.staffEdit));
      renderStaffForm(row);
      document.getElementById('staffForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  });
  box.querySelectorAll('[data-staff-del]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Убрать сотрудника из панели?')) return;
      try {
        await api('/api/admin/staff/remove', { userId: Number(b.dataset.staffDel) });
        toast('Убран');
        loadAdminStaff();
      } catch (err) { toast(err.message); }
    };
  });
}

function renderStaffForm(row) {
  const d = state.admin.staff;
  const box = document.getElementById('staffForm');
  const parse = (raw) => { try { return JSON.parse(raw || '[]'); } catch { return []; } };
  const extra = new Set(row ? parse(row.extra_perms) : []);
  const denied = new Set(row ? parse(row.denied_perms) : []);
  const role = row?.role || d.assignable[d.assignable.length - 1] || d.roles[0].id;

  const byGroup = d.groups.map((g) => ({
    ...g, items: d.permissions.filter((p) => p.group === g.id),
  }));

  box.innerHTML = `
    <div class="bo-settings">
      <label class="bo-field">
        <b>Кто</b>
        <i>Почта, Telegram ID, ник или внутренний номер. Человек должен сначала зарегистрироваться на сайте.</i>
        <input class="seed-input" id="staffKey" value="${row ? esc(row.email || row.tg_id || row.user_id) : ''}"
               ${row ? 'readonly' : ''} placeholder="почта, 123456789 или @nickname">
      </label>
      <label class="bo-field">
        <b>Роль</b>
        <select class="seed-input" id="staffRole">
          ${d.roles.filter((r) => d.assignable.includes(r.id)).map((r) =>
            `<option value="${r.id}" ${r.id === role ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
        </select>
      </label>
      <label class="bo-field">
        <b>Потолок одной правки баланса</b>
        <i>Пусто - как у роли. Ноль - без потолка.</i>
        <input class="seed-input" id="staffCap" type="number" inputmode="numeric"
               value="${row && row.balance_cap !== null ? row.balance_cap : ''}">
      </label>
      <label class="bo-field">
        <b>Заметка</b>
        <input class="seed-input" id="staffNote" maxlength="300" value="${row ? esc(row.note || '') : ''}">
      </label>
      <label class="bo-toggle">
        <input type="checkbox" id="staffActive" ${!row || row.active ? 'checked' : ''}>
        <span><b>Доступ включён</b><i>Выключенный сотрудник остаётся в списке, но в панель не входит</i></span>
      </label>
    </div>

    <h3 class="bo-subtitle">Поправки к роли</h3>
    <p class="game-sub">Слева выдать сверх роли, справа отобрать. Выдать можно
      только то, что есть у вас самих.</p>
    <div class="bo-perms">
      ${byGroup.map((g) => `
        <div class="bo-perm-group">
          <div class="bo-group-name">${esc(g.name)}</div>
          ${g.items.map((p) => `
            <div class="bo-perm ${d.grantable.includes(p.id) ? '' : 'bo-off'}">
              <span><b>${esc(p.label)}</b>${p.hint ? `<i>${esc(p.hint)}</i>` : ''}</span>
              <label title="Выдать сверх роли">
                <input type="checkbox" data-extra="${p.id}" ${extra.has(p.id) ? 'checked' : ''}
                       ${d.grantable.includes(p.id) ? '' : 'disabled'}>+
              </label>
              <label title="Отобрать у роли">
                <input type="checkbox" data-denied="${p.id}" ${denied.has(p.id) ? 'checked' : ''}>&minus;
              </label>
            </div>`).join('')}
        </div>`).join('')}
    </div>

    <div class="admin-actions">
      <button class="btn btn-primary" id="staffSave">${row ? 'Сохранить' : 'Добавить'}</button>
      ${row ? '<button class="btn btn-outline" id="staffCancel">Отмена</button>' : ''}
    </div>
  `;

  box.querySelector('#staffSave').onclick = async () => {
    const payload = {
      userKey: box.querySelector('#staffKey').value.trim(),
      role: box.querySelector('#staffRole').value,
      balanceCap: box.querySelector('#staffCap').value === ''
        ? null : Number(box.querySelector('#staffCap').value),
      note: box.querySelector('#staffNote').value,
      active: box.querySelector('#staffActive').checked,
      extra: [...box.querySelectorAll('[data-extra]:checked')].map((i) => i.dataset.extra),
      denied: [...box.querySelectorAll('[data-denied]:checked')].map((i) => i.dataset.denied),
    };
    if (!payload.userKey) { toast('Укажите, кого добавляем'); return; }
    try {
      await api('/api/admin/staff/save', payload);
      toast('Сохранено');
      haptic('success');
      loadAdminStaff();
    } catch (err) { toast(err.message); haptic('error'); }
  };
  box.querySelector('#staffCancel')?.addEventListener('click', () => renderStaffForm(null));
}

/* ---------- Панель: журнал ---------- */

const BO_ACTIONS = {
  credit: 'Начисление', debit: 'Списание', block: 'Блокировка',
  unblock: 'Разблокировка', voucher: 'Выдан кейс', payout_paid: 'Вывод выплачен',
  payout_rejected: 'Вывод отклонён', payout_processing: 'Вывод в работе',
  partner_payout: 'Выплата партнёру', promo_save: 'Промокод сохранён',
  promo_delete: 'Промокод удалён', partner_save: 'Партнёр сохранён',
  staff_add: 'Сотрудник добавлен', staff_update: 'Права изменены',
  staff_remove: 'Сотрудник убран', settings: 'Настройки', limits: 'Лимиты',
  note_add: 'Заметка', note_delete: 'Заметка удалена', export: 'Выгрузка',
};

async function loadAdminJournal() {
  const box = document.getElementById('admin-journal');
  box.innerHTML = '<div class="empty">Загружаем...</div>';

  let d;
  try { d = await api('/api/admin/journal', { action: state.admin.journalAction || '' }); }
  catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  const rows = d.rows.map((l) => {
    const who = l.admin_username ? '@' + l.admin_username : (l.admin_name || '#' + l.admin_id);
    const target = l.target_id
      ? (l.target_username ? '@' + l.target_username : (l.target_name || '#' + l.target_id))
      : '';
    let meta = '';
    if (l.meta) {
      try {
        meta = Object.entries(JSON.parse(l.meta))
          .map(([k, v]) => `${k}: ${typeof v === 'object' && v && 'before' in v
            ? `${v.before} → ${v.after}` : JSON.stringify(v)}`)
          .join(', ');
      } catch { meta = ''; }
    }
    return `<tr>
      <td>${boDateTime(l.created_at)}</td>
      <td>${esc(who)}</td>
      <td>${esc(BO_ACTIONS[l.action] || l.action)}</td>
      <td>${esc(target)}</td>
      <td class="num ${l.amount > 0 ? 'plus' : l.amount < 0 ? 'minus' : ''}">${l.amount ? fmt(l.amount) : ''}</td>
      <td class="bo-sub">${esc(l.note || '')}${meta ? `<br>${esc(meta)}` : ''}</td>
    </tr>`;
  });

  box.innerHTML = `
    <p class="game-sub">Всё, что сотрудники делают руками. Записи не правятся
      и не удаляются.</p>
    <div class="admin-tabs">
      <button class="tab ${state.admin.journalAction ? '' : 'active'}" data-journal="">Все</button>
      ${d.actions.slice(0, 10).map((a) => `<button class="tab
        ${state.admin.journalAction === a.action ? 'active' : ''}"
        data-journal="${esc(a.action)}">${esc(BO_ACTIONS[a.action] || a.action)} · ${a.n}</button>`).join('')}
    </div>
    ${boTable(['Когда', 'Кто', 'Что', 'Кому', { label: 'Сумма', num: 1 }, 'Подробности'], rows,
              'Пока ничего')}
    <p class="game-sub">Показано ${d.rows.length} из ${fmt(d.total)}.</p>
  `;

  box.querySelectorAll('[data-journal]').forEach((b) => {
    b.onclick = () => { state.admin.journalAction = b.dataset.journal; loadAdminJournal(); };
  });
}

/* ---------- Админка: воронка ---------- */

/*
 * Воронка по когорте: игроки, зарегистрированные за период, и то, докуда
 * каждый дошёл. Считает сервер, здесь только рисование.
 *
 * Показываем обе доли сразу - от когорты и от предыдущего шага. От когорты
 * видно, сколько людей теряется вообще; от предыдущего - на каком именно шаге
 * они уходят. По одной доле из двух вывод получается неверный.
 */
async function loadAdminFunnel() {
  const box = document.getElementById('funnelBody');
  box.innerHTML = '<div class="empty">Считаем...</div>';

  let d;
  try { d = await api('/api/admin/funnel', { days: state.admin.funnelDays || 7 }); }
  catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  const f = d.funnel;
  if (!f.cohort) {
    box.innerHTML = '<div class="empty">За этот период новых игроков не было</div>';
    return;
  }

  const steps = f.steps.map((s, i) => {
    const width = Math.max(1, Math.round(s.ofCohort * 100));
    const lost = i > 0 ? f.steps[i - 1].users - s.users : 0;
    return `<div class="funnel-step">
      <div class="funnel-bar" style="width:${width}%"></div>
      <div class="funnel-head">
        <span class="funnel-title">${esc(s.title)}</span>
        <span class="funnel-users">${fmt(s.users)}</span>
      </div>
      <div class="funnel-sub">
        ${pct(s.ofCohort)} от всех${i > 0 ? ` · ${pct(s.ofPrev)} от предыдущего` : ''}
        ${lost > 0 ? `<span class="funnel-drop"> · потеряно ${fmt(lost)}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  const events = d.events.map((e) => `<tr>
      <td>${esc(e.name)}</td>
      <td class="num">${fmt(e.total)}</td>
      <td class="num">${fmt(e.users)}</td>
    </tr>`).join('');

  box.innerHTML = `
    <div class="admin-kpis">
      <div class="kpi"><div class="kpi-label">Новых игроков</div>
        <div class="kpi-value">${fmt(f.cohort)}</div></div>
      <div class="kpi"><div class="kpi-label">Пополнений</div>
        <div class="kpi-value">${fmt(f.deposits)}</div></div>
      <div class="kpi"><div class="kpi-label">Внесено</div>
        <div class="kpi-value">${fmt(f.deposited)}</div></div>
      <div class="kpi"><div class="kpi-label">На игрока</div>
        <div class="kpi-value">${fmt(Math.round(f.arpu))}</div>
        <div class="kpi-sub">внесено / новых игроков</div></div>
    </div>

    <h2 class="section-title">Шаги</h2>
    ${steps}

    <h2 class="section-title">Все события за период</h2>
    <table class="admin-table">
      <thead><tr><th>Событие</th><th class="num">Всего</th><th class="num">Игроков</th></tr></thead>
      <tbody>${events || '<tr><td colspan="3">Пока пусто</td></tr>'}</tbody>
    </table>
  `;
}

document.querySelectorAll('[data-funnel-days]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.admin.funnelDays = Number(btn.dataset.funnelDays);
    document.querySelectorAll('[data-funnel-days]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    loadAdminFunnel();
  });
});

/* ---------- Админка: промокоды ---------- */

/** Дата в формате поля input[type=date] и обратно в миллисекунды. */
const dateValue = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
const dateMs = (v, endOfDay) =>
  (v ? new Date(v + (endOfDay ? 'T23:59:59' : 'T00:00:00')).getTime() : null);

async function loadAdminPromos() {
  let d;
  try { d = await api('/api/admin/promos'); }
  catch (err) { toast(err.message); return; }

  let partners = [];
  try { partners = (await api('/api/admin/partners')).rows; } catch { /* необязательно */ }

  const box = document.getElementById('admin-promos');

  box.innerHTML = `
    <div class="admin-form">
      <div class="form-grid">
        <div class="wide">
          <label>Код</label>
          <input class="seed-input" id="pmCode" placeholder="WELCOME" maxlength="32">
        </div>
        <div class="wide">
          <label>Тип</label>
          <select class="seed-input" id="pmType">
            <option value="balance">Начисление на баланс</option>
            <option value="deposit_pct">Процент к пополнению</option>
            <option value="free_case">Бесплатный кейс</option>
          </select>
        </div>

        <div data-when="balance"><label>Сумма</label>
          <input class="seed-input" id="pmAmount" type="number" min="0" value="500"></div>

        <div data-when="deposit_pct"><label>Процент</label>
          <input class="seed-input" id="pmPct" type="number" min="0" max="500" value="100"></div>
        <div data-when="deposit_pct"><label>Потолок бонуса</label>
          <input class="seed-input" id="pmMaxBonus" type="number" min="0" value="0"></div>
        <div data-when="deposit_pct"><label>Мин. пополнение</label>
          <input class="seed-input" id="pmMinDep" type="number" min="0" value="0"></div>

        <div data-when="free_case"><label>Кейс</label>
          <select class="seed-input" id="pmCase">
            ${d.cases.map((c) => `<option value="${c.id}">${esc(c.name)} · ${fmt(c.price)}</option>`).join('')}
          </select></div>
        <div data-when="free_case"><label>Сколько штук</label>
          <input class="seed-input" id="pmCaseCount" type="number" min="1" value="1"></div>

        <div><label>Отыгрыш, ×</label>
          <input class="seed-input" id="pmWager" type="number" min="0" step="0.5" value="3"></div>
        <div><label>Всего активаций</label>
          <input class="seed-input" id="pmMaxUses" type="number" min="0" value="0"></div>
        <div><label>На игрока</label>
          <input class="seed-input" id="pmPerUser" type="number" min="0" value="1"></div>
        <div><label>Партнёр</label>
          <select class="seed-input" id="pmPartner">
            <option value="">нет</option>
            ${partners.map((p) => `<option value="${p.partner.id}">${
              esc(p.partner.name || p.partner.email || p.partner.tg_id)}</option>`).join('')}
          </select></div>
        <div><label>Действует с</label>
          <input class="seed-input" id="pmFrom" type="date"></div>
        <div><label>Действует по</label>
          <input class="seed-input" id="pmTo" type="date"></div>
        <div class="wide">
          <label class="check">
            <input type="checkbox" id="pmNewOnly"> только игрокам без пополнений
          </label>
        </div>
        <div class="wide"><label>Заметка</label>
          <input class="seed-input" id="pmNote" maxlength="200"></div>
      </div>
      <button class="btn btn-primary btn-wide" id="pmSave">Сохранить промокод</button>
      <div class="kpi-sub" style="margin-top:8px">
        Ноль в лимитах означает «без ограничения». Отыгрыш ноль - бонус можно
        выводить сразу, так что для щедрых кодов его лучше не оставлять пустым.
      </div>
    </div>

    <h2 class="section-title">Промокоды</h2>
    ${d.rows.length ? d.rows.map(promoRowHtml).join('') : '<div class="empty">Пока пусто</div>'}
  `;

  // Показываем только поля, относящиеся к выбранному типу: иначе форма просит
  // заполнить то, что для этого типа не значит ничего.
  const syncType = () => {
    const t = document.getElementById('pmType').value;
    box.querySelectorAll('[data-when]').forEach((el) => {
      el.style.display = el.dataset.when === t ? '' : 'none';
    });
  };
  document.getElementById('pmType').addEventListener('change', syncType);
  syncType();

  document.getElementById('pmSave').addEventListener('click', savePromo);

  box.querySelectorAll('[data-promo-edit]').forEach((btn) => {
    btn.addEventListener('click', () => fillPromoForm(
      d.rows.find((r) => r.id === Number(btn.dataset.promoEdit))));
  });
  box.querySelectorAll('[data-promo-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const r = await api('/api/admin/promo/delete', { id: Number(btn.dataset.promoDel) });
        toast(r.disabled ? 'Код отключён (по нему были активации)' : 'Код удалён');
        loadAdminPromos();
      } catch (err) { toast(err.message); }
    });
  });
}

function promoRowHtml(p) {
  const bits = [];
  if (p.type === 'balance') bits.push(`+${fmt(p.amount)} на баланс`);
  if (p.type === 'deposit_pct') {
    bits.push(`+${p.pct}% к пополнению`);
    if (p.min_deposit) bits.push(`от ${fmt(p.min_deposit)}`);
    if (p.max_bonus) bits.push(`макс ${fmt(p.max_bonus)}`);
  }
  if (p.type === 'free_case') bits.push(`кейс ${esc(p.case_id)} ×${p.case_count}`);
  if (p.wager_multiplier) bits.push(`отыгрыш ×${p.wager_multiplier}`);
  bits.push(`активаций ${p.used_count}${p.max_uses ? ' из ' + p.max_uses : ''}`);
  if (p.per_user_limit) bits.push(`на игрока ${p.per_user_limit}`);
  if (p.new_players_only) bits.push('только новым');
  if (p.expires_at) bits.push(`до ${new Date(p.expires_at).toLocaleDateString('ru-RU')}`);
  if (p.partner_name || p.partner_tg) bits.push(`партнёр: ${esc(p.partner_name || p.partner_tg)}`);

  return `<div class="promo-row ${p.is_active ? '' : 'off'}">
    <div>
      <div class="promo-code">${esc(p.code)}</div>
      <div class="promo-meta">${bits.join(' · ')}</div>
    </div>
    <div class="promo-actions">
      <button class="btn btn-outline btn-sm" data-promo-edit="${p.id}">Изм.</button>
      <button class="btn btn-outline btn-sm" data-promo-del="${p.id}">×</button>
    </div>
  </div>`;
}

function fillPromoForm(p) {
  if (!p) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('pmCode', p.code);
  set('pmType', p.type);
  set('pmAmount', p.amount);
  set('pmPct', p.pct);
  set('pmMaxBonus', p.max_bonus);
  set('pmMinDep', p.min_deposit);
  if (p.case_id) set('pmCase', p.case_id);
  set('pmCaseCount', p.case_count);
  set('pmWager', p.wager_multiplier);
  set('pmMaxUses', p.max_uses);
  set('pmPerUser', p.per_user_limit);
  set('pmPartner', p.partner_id || '');
  set('pmFrom', dateValue(p.starts_at));
  set('pmTo', dateValue(p.expires_at));
  set('pmNote', p.note || '');
  document.getElementById('pmNewOnly').checked = !!p.new_players_only;
  document.getElementById('pmType').dispatchEvent(new Event('change'));
  document.getElementById('admin-promos').scrollIntoView({ behavior: 'smooth' });
}

async function savePromo() {
  const val = (id) => document.getElementById(id)?.value;
  try {
    const r = await api('/api/admin/promo/save', {
      code: val('pmCode'),
      type: val('pmType'),
      amount: val('pmAmount'),
      pct: val('pmPct'),
      max_bonus: val('pmMaxBonus'),
      min_deposit: val('pmMinDep'),
      case_id: val('pmCase'),
      case_count: val('pmCaseCount'),
      wager_multiplier: val('pmWager'),
      max_uses: val('pmMaxUses'),
      per_user_limit: val('pmPerUser'),
      partner_id: val('pmPartner') || null,
      starts_at: dateMs(val('pmFrom'), false),
      expires_at: dateMs(val('pmTo'), true),
      new_players_only: document.getElementById('pmNewOnly').checked,
      note: val('pmNote'),
    });
    toast(r.created ? `Промокод ${r.code} создан` : `Промокод ${r.code} обновлён`);
    haptic('success');
    loadAdminPromos();
  } catch (err) { toast(err.message); haptic('error'); }
}

/* ---------- Админка: партнёры ---------- */

async function loadAdminPartners() {
  let d;
  try { d = await api('/api/admin/partners'); }
  catch (err) { toast(err.message); return; }

  const box = document.getElementById('admin-partners');
  // Управление программой - в кабинете /partners: доли, сетка, заявки на
  // вывод и сверка со шлюзом. Здесь список для взгляда и заведение партнёра
  // из существующего игрока.
  box.innerHTML = `
    <a class="btn btn-primary btn-wide" href="/partners/" target="_blank" rel="noopener">Открыть кабинет партнёров</a>
    <div class="admin-form" style="margin-top:14px">
      <div class="form-grid">
        <div><label>Игрок</label>
          <input class="seed-input" id="ptTg" placeholder="почта, Telegram ID или номер"></div>
        <div><label>Доля, %</label>
          <input class="seed-input" id="ptShare" type="number" min="0" max="90" value="50"></div>
        <div class="wide"><label>Имя</label>
          <input class="seed-input" id="ptName" maxlength="80"></div>
      </div>
      <button class="btn btn-outline btn-wide" id="ptSave">Сделать партнёром</button>
    </div>

    <h2 class="section-title">Партнёры</h2>
    ${d.rows.length ? d.rows.map((r) => `<div class="promo-row ${r.status === 'active' ? '' : 'off'}">
        <div>
          <div class="promo-code">${esc(r.name || 'Партнёр')}</div>
          <div class="promo-meta">#${r.id} · ${esc(r.email || '')} · доля ${r.share}% · игроков ${fmt(r.total.signups)}</div>
        </div>
        <div style="text-align:right">
          <div class="promo-code">${money(r.balance.available)}</div>
          <div class="promo-meta">к выводу</div>
        </div>
      </div>`).join('') : '<div class="empty">Пока пусто</div>'}
  `;

  document.getElementById('ptSave').addEventListener('click', async () => {
    try {
      await api('/api/admin/partner/save', {
        userKey: document.getElementById('ptTg').value,
        share_pct: document.getElementById('ptShare').value,
        name: document.getElementById('ptName').value,
      });
      toast('Партнёр сохранён');
      haptic('success');
      loadAdminPartners();
    } catch (err) { toast(err.message); haptic('error'); }
  });
}

/* ---------- Админка: заявки на вывод ---------- */

/*
 * Шлюз Sicilia в заявках: баланс мерчанта сверху и кнопка выплаты у заявок
 * на карту и по СБП. Банк подставляется по названию из заявки, но выбирает и
 * подтверждает его человек: ошибка в банке при СБП - деньги не тому.
 */
const SICILIA_STATUS = {
  opened: 'отправлено, ждёт обработки', in_progress: 'в обработке у шлюза', completed: 'выплачено',
  cancelled: 'отменено шлюзом', error: 'ошибка', unclaimed: 'отозвано',
};
async function siciliaAdminInfo() {
  const cached = state.admin.sicilia;
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached;
  try {
    state.admin.sicilia = { at: Date.now(), ...(await api('/api/admin/sicilia')) };
  } catch {
    state.admin.sicilia = { at: Date.now(), configured: false, banks: [] };
  }
  return state.admin.sicilia;
}

function siciliaPayoutBlock(p, gateway, info) {
  const g = gateway[p.id];
  const line = g ? `<div class="payout-comment">Sicilia: ${esc(SICILIA_STATUS[g.status] || g.status)}${g.error ? ` - ${esc(g.error)}` : ''}${
    g.checkUrl ? ` · <a href="${esc(g.checkUrl)}" target="_blank" rel="noopener">чек</a>` : ''}</div>
    <div class="dep-ids">${idChip('Наш номер', g.invid)}${g.gatewayId ? idChip('Номер Sicilia', g.gatewayId) : ''}</div>` : '';
  const dead = g && ['cancelled', 'error', 'unclaimed'].includes(g.status);
  // Отзыв - пока ордер не закрыт шлюзом; возврат в «ожидают» - когда шлюз
  // выплату отменил, а заявка ещё «в работе».
  const manage = info.configured && g && p.status === 'processing' ? `<div class="admin-actions">
    ${['opened', 'in_progress'].includes(g.status) ? `<button class="btn btn-outline btn-sm" data-sic-recall="${p.id}">Отозвать из Sicilia</button>` : ''}
    ${dead ? `<button class="btn btn-outline btn-sm" data-sic-release="${p.id}">Вернуть в ожидание</button>` : ''}
  </div>` : '';
  const canSend = info.configured && (p.method === 'sbp' || p.method === 'card')
    && (p.status === 'pending' || p.status === 'processing')
    && (!g || dead);
  if (!canSend) return line + manage;
  const options = info.banks.map((b) => `<option value="${esc(b.code)}"${b.code === p.gatewayBank ? ' selected' : ''}>${esc(b.name)}</option>`).join('');
  return `${line}${manage}<div class="admin-actions sicilia-send">
    <select class="seed-input" data-sic-bank="${p.id}"><option value="">Банк получателя…</option>${options}</select>
    <button class="btn btn-outline" data-sic-pay="${p.id}" data-amount="${p.amount}">Выплатить через Sicilia</button>
  </div>`;
}

/*
 * Плашка проверки заявки на вывод. Зелёная - всё сошлось, красная - есть
 * подозрения, с причинами. Красную нельзя двинуть к выплате, пока сотрудник
 * не разобрал причины и не подтвердил заявку комментарием: подозрение не
 * должно уйти деньгами одним нажатием «взять в работу».
 */
function riskPlate(p) {
  const c = p.check;
  if (!c) return '';
  const green = c.verdict === 'green';
  const why = green ? 'Математика сходится, источники денег подтверждены'
    : esc((c.reasons || []).join(' · '));
  const ok = c.override
    ? `<div class="risk-override">Подтверждено сотрудником: «${esc(c.override.comment)}»</div>` : '';
  return `<div class="risk-plate ${green ? 'risk-green' : 'risk-red'}">
      <span class="risk-dot" aria-hidden="true"></span>
      <div class="risk-text"><b>${green ? 'Проверено системой' : 'Есть подозрения'}</b><small>${why}</small></div>
      <button class="risk-more" data-risk-open="${p.id}" type="button">Подробнее</button>
    </div>
    ${ok}
    <div class="risk-details" data-risk-details="${p.id}" hidden></div>`;
}

/** Полный разбор проверки: каждый пункт с подробностями. */
function riskDetailsHtml(c) {
  const s = c.summary || {};
  const rows = c.checks.map((x) => `<li class="${x.ok ? 'ok' : x.level === 'info' ? 'info' : 'bad'}">
      <span>${x.ok ? '✓' : x.level === 'info' ? 'i' : '✗'}</span>
      <div><b>${esc(x.title)}</b><small>${esc(x.detail || '')}</small></div></li>`).join('');
  return `<ul class="risk-list">${rows}</ul>
    <div class="risk-summary">Пополнил ${money(s.deposited || 0)} · выплачено ${money(s.paidOut || 0)} ·
      итог игр ${money(s.gamesNet || 0)} · раундов ${fmt(s.rounds || 0)} · лучший выигрыш ${money(s.bestWin || 0)} ·
      аккаунту ${fmt(s.accountAgeDays || 0)} дн. · проверено ${new Date(c.checkedAt).toLocaleString('ru-RU')}</div>
    <button class="btn btn-outline btn-sm" data-risk-recheck="${c.payoutId || ''}" type="button">Перепроверить</button>`;
}

async function loadAdminPayouts() {
  let d;
  try { d = await api('/api/admin/payouts', { status: state.admin.payoutStatus || 'pending' }); }
  catch (err) { toast(err.message); return; }
  const sic = d.siciliaReady ? await siciliaAdminInfo() : { configured: false, banks: [] };

  const box = document.getElementById('payoutAdminList');
  const s = d.stats;

  const head = `<div class="admin-kpis">
    <div class="kpi"><div class="kpi-label">Ожидают решения</div>
      <div class="kpi-value">${fmt(s.pendingCount)}</div>
      <div class="kpi-sub">на ${money(s.pendingSum)}</div></div>
    <div class="kpi"><div class="kpi-label">Выплачено всего</div>
      <div class="kpi-value minus">${money(s.paidSum)}</div></div>
    <div class="kpi"><div class="kpi-label">В работе</div>
      <div class="kpi-value">${fmt(s.processingCount)}</div>
      <div class="kpi-sub">на ${money(s.processingSum)}</div></div>
    ${sic.configured ? `<div class="kpi"><div class="kpi-label">Баланс Sicilia</div>
      <div class="kpi-value">${sic.balance ? money(Math.floor(sic.balance.balance)) : '-'}</div>
      <div class="kpi-sub">${sic.balance ? `заморожено ${money(Math.floor(sic.balance.frozen_balance || 0))}` : esc(sic.balanceError || '')}</div></div>` : ''}
  </div>`;

  if (!d.rows.length) {
    box.innerHTML = head + '<div class="empty">Заявок нет</div>' + exportBarHtml();
    bindExportBar(box);
    return;
  }

  box.innerHTML = head + d.rows.map((p) => {
    const name = p.username ? '@' + p.username : (p.first_name || ('#' + p.user_id));
    return `<div class="payout-row admin ${p.status}">
      <div class="payout-head">
        <b>${money(p.amount)}${p.requested_amount ? ` <small class="dep-fact">из ${money(p.requested_amount)}</small>` : ''}</b>
        <span class="payout-status ${p.status}">${STATUS_LABEL[p.status] || p.status}</span>
      </div>
      <div class="payout-date">${esc(name)} · ${esc(playerIdent(p, p.user_id))} ·
        баланс ${money(p.balance)} · ${new Date(p.created_at).toLocaleString('ru-RU')}</div>
      <div class="payout-requisites">${payoutRequisites(p, { full: true })}</div>
      ${riskPlate(p)}
      ${p.comment ? `<div class="payout-comment">${esc(p.comment)}</div>` : ''}
      ${p.check && p.check.verdict === 'red' && !p.check.override && ['pending', 'processing'].includes(p.status) ? `
        <textarea class="seed-input risk-note" data-risk-note="${p.id}" rows="2"
          placeholder="Почему заявку можно выплатить: что проверено вручную"></textarea>
        <div class="admin-actions">
          <button class="btn btn-primary" data-risk-ok="${p.id}">Подтвердить заявку</button>
          <button class="btn btn-outline" data-resolve="rejected" data-id="${p.id}">Отклонить</button>
        </div>
        <input class="seed-input payout-note" data-note="${p.id}" placeholder="комментарий игроку (при отклонении)">` : `
      ${siciliaPayoutBlock(p, d.gateway || {}, sic)}
      ${p.status === 'pending' ? `
        <input class="seed-input payout-note" data-note="${p.id}" placeholder="комментарий игроку">
        <div class="admin-actions">
          <button class="btn btn-primary" data-resolve="processing" data-id="${p.id}">Взять в работу</button>
          <button class="btn btn-outline" data-resolve="rejected" data-id="${p.id}">Отклонить</button>
        </div>` : p.status === 'processing' ? `
        <input class="seed-input payout-note" data-note="${p.id}" placeholder="комментарий игроку">
        <div class="admin-actions">
          <button class="btn btn-primary" data-resolve="paid" data-id="${p.id}">Выполнено</button>
        </div>` : ''}`}
    </div>`;
  }).join('');

  box.insertAdjacentHTML('beforeend', exportBarHtml());
  bindExportBar(box);
  bindIdChips(box);

  const openDetails = async (id, recheck = false) => {
    const panel = box.querySelector(`[data-risk-details="${id}"]`);
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = '<span class="skel skel-line"></span>';
    try {
      const { check } = await api('/api/admin/payout/check', { id, recheck });
      panel.innerHTML = riskDetailsHtml({ ...check, payoutId: id });
      panel.querySelector('[data-risk-recheck]')?.addEventListener('click', async () => {
        await openDetails(id, true);
        loadAdminPayouts();
      });
    } catch (err) { panel.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  };
  box.querySelectorAll('[data-risk-open]').forEach((btn) => btn.addEventListener('click', () => {
    const id = Number(btn.dataset.riskOpen);
    const panel = box.querySelector(`[data-risk-details="${id}"]`);
    if (panel && !panel.hidden) { panel.hidden = true; return; }
    openDetails(id);
  }));

  box.querySelectorAll('[data-risk-ok]').forEach((btn) => btn.addEventListener('click', async () => {
    const id = Number(btn.dataset.riskOk);
    const comment = box.querySelector(`[data-risk-note="${id}"]`)?.value || '';
    try {
      await api('/api/admin/payout/override', { id, comment });
      toast('Заявка подтверждена, решение записано в журнал');
      haptic('success');
      loadAdminPayouts();
    } catch (err) { toast(err.message); haptic('error'); }
  }));

  // Выплата через шлюз - вторым нажатием: первое показывает, сколько и куда.
  const sicAction = (attr, path, ok) => box.querySelectorAll(`[${attr}]`).forEach((btn) => btn.addEventListener('click', () =>
    withCashBusy(btn, async () => {
      try {
        const r = await api(path, { id: Number(btn.getAttribute(attr)) });
        toast(ok(r));
        haptic('success');
      } catch (err) { toast(err.message); haptic('error'); }
      loadAdminPayouts();
    })));
  sicAction('data-sic-recall', '/api/admin/sicilia/payout/recall',
    (r) => (r.payoutStatus === 'pending' ? 'Выплата отозвана, заявка снова ждёт решения' : 'Запрос на отзыв отправлен'));
  sicAction('data-sic-release', '/api/admin/sicilia/payout/release', () => 'Заявка снова ждёт решения');

  box.querySelectorAll('[data-sic-pay]').forEach((btn) => {
    // Сменили банк после первого нажатия - подтверждение снимается: уйти
    // выплата должна ровно в тот банк, что был показан на кнопке.
    box.querySelector(`[data-sic-bank="${btn.dataset.sicPay}"]`)?.addEventListener('change', () => {
      btn.dataset.armed = '';
      btn.textContent = 'Выплатить через Sicilia';
      btn.classList.replace('btn-primary', 'btn-outline');
    });
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.sicPay);
      const select = box.querySelector(`[data-sic-bank="${id}"]`);
      const bank = select?.value || '';
      if (!bank) { toast('Выберите банк получателя'); return; }
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = `Подтвердить: ${money(Number(btn.dataset.amount))} · ${select.selectedOptions[0].textContent}`;
        btn.classList.replace('btn-outline', 'btn-primary');
        return;
      }
      btn.disabled = true;
      try {
        await api('/api/admin/sicilia/payout', { id, bank });
        toast('Выплата отправлена в Sicilia');
        haptic('success');
      } catch (err) { toast(err.message); haptic('error'); }
      loadAdminPayouts();
    });
  });

  box.querySelectorAll('[data-resolve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const note = box.querySelector(`[data-note="${id}"]`)?.value || '';
      const status = btn.dataset.resolve;

      if (status === 'rejected' && !note.trim()) {
        toast('Укажите причину отклонения - игрок её увидит');
        return;
      }

      // Второе нажатие, пока идёт первое, не шлёт второй запрос.
      await withCashBusy(btn, async () => {
        try {
          await api('/api/admin/payout/resolve', { id, status, comment: note });
          toast(status === 'paid' ? 'Заявка выполнена' : status === 'processing' ? 'Заявка поставлена в работу' : 'Заявка отклонена, средства возвращены');
          haptic('success');
          loadAdminPayouts();
        } catch (err) { toast(err.message); haptic('error'); }
      });
    });
  });
}

document.querySelectorAll('[data-payout-status]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.admin.payoutStatus = btn.dataset.payoutStatus;
    document.querySelectorAll('[data-payout-status]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    loadAdminPayouts();
  });
});

document.getElementById('adminSearchBtn').addEventListener('click', () => {
  state.admin.query = document.getElementById('adminSearch').value.trim();
  loadAdminUsers();
});


return {initAdminPanel,renderAdminGate};
}
