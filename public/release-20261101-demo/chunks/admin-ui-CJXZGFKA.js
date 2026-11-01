function Le({api:p,toast:m,fmt:c,esc:o,state:b,playerIdent:T,money:y,mountIcons:se,haptic:v,openBlankTab:ne,withCashBusy:L,STATUS_LABEL:ie,payoutRequisites:de,receiptDataUrl:le}){let w=e=>e==null?"-":`${(e*100).toFixed(2)}%`;async function U(){let e;try{e=await p("/api/admin/overview")}catch(s){m(s.message);return}let t=[{label:"Игроков",value:c(e.users.total),sub:`активных: ${c(e.users.active||0)}`},{label:"Раундов",value:c(e.rounds.total)},{label:"Поставлено",value:c(e.rounds.wagered)},{label:"Выплачено",value:c(e.rounds.paid)},{label:"Прибыль заведения",value:`${e.rounds.profit>=0?"+":""}${c(e.rounds.profit)}`,cls:e.rounds.profit>=0?"plus":"minus",sub:`фактический RTP: ${w(e.rounds.rtp)}`},{label:"Единиц на руках",value:c(e.users.balance),sub:`заблокировано: ${c(e.users.blocked||0)}`}],a=e.byGame.map(s=>`<tr>
      <td>${{case:"Кейсы",crash:"Краш",roulette:"Рулетка"}[s.game]||s.game}</td>
      <td class="num">${c(s.rounds)}</td>
      <td class="num">${c(s.wagered)}</td>
      <td class="num">${c(s.profit)}</td>
      <td class="num">${w(s.rtp)}</td>
    </tr>`).join(""),i=e.topWins.map(s=>`<tr>
      <td>${o(s.username||s.first_name||s.user_id)}</td>
      <td>${o(s.subtitle)}</td>
      <td class="num">${c(s.payout)}</td>
    </tr>`).join("");document.getElementById("admin-overview").innerHTML=`
    <div class="admin-kpis">
      ${t.map(s=>`<div class="kpi">
        <div class="kpi-label">${s.label}</div>
        <div class="kpi-value ${s.cls||""}">${s.value}</div>
        ${s.sub?`<div class="kpi-sub">${s.sub}</div>`:""}
      </div>`).join("")}
    </div>

    <h2 class="section-title">За сутки</h2>
    <div class="admin-kpis">
      <div class="kpi"><div class="kpi-label">Раундов</div><div class="kpi-value">${c(e.today.rounds)}</div></div>
      <div class="kpi"><div class="kpi-label">Игроков</div><div class="kpi-value">${c(e.today.players)}</div></div>
      <div class="kpi"><div class="kpi-label">Поставлено</div><div class="kpi-value">${c(e.today.wagered)}</div></div>
      <div class="kpi"><div class="kpi-label">Прибыль</div>
        <div class="kpi-value ${e.today.profit>=0?"plus":"minus"}">${c(e.today.profit)}</div></div>
    </div>

    <h2 class="section-title">По играм</h2>
    <table class="admin-table">
      <thead><tr><th>Игра</th><th class="num">Раундов</th><th class="num">Ставки</th>
        <th class="num">Прибыль</th><th class="num">RTP</th></tr></thead>
      <tbody>${a||'<tr><td colspan="5">Нет данных</td></tr>'}</tbody>
    </table>

    <h2 class="section-title">Крупнейшие выигрыши</h2>
    <table class="admin-table">
      <thead><tr><th>Игрок</th><th>Что</th><th class="num">Выплата</th></tr></thead>
      <tbody>${i||'<tr><td colspan="3">Нет данных</td></tr>'}</tbody>
    </table>
  `,oe(e.recent)}function oe(e){document.getElementById("admin-feed").innerHTML=e.length?e.map(t=>{let a=t.payout-t.bet;return`<div class="history-row" style="--tier-color:${a>=0?"var(--green)":"var(--line)"}">
          <div class="history-main">
            <div class="history-item">${o(t.subtitle)}</div>
            <div class="history-case">${o(t.username||t.first_name||"#"+t.user_id)}
              · ${o(t.title)} · ${t.free?"подарок":c(t.bet)}</div>
          </div>
          <div class="history-right">
            <div class="history-value">${c(t.payout)}</div>
            <div class="history-mult ${a>=0?"plus":"minus"}">${t.multiplier.toFixed(2)}x</div>
          </div>
        </div>`}).join(""):'<div class="empty">Пока нет раундов</div>'}async function j(){let e;try{e=await p("/api/admin/users",{query:b.admin.query})}catch(a){m(a.message);return}b.admin.users=e.rows;let t=document.getElementById("adminUserList");t.innerHTML=e.rows.length?e.rows.map(a=>{let i=a.username?"@"+a.username:a.first_name||"Без имени",s=(a.first_name||a.username||"?").trim().charAt(0).toUpperCase();return`<div class="user-row ${a.is_blocked?"blocked":""}" data-user="${a.id}">
      <div class="user-avatar">${o(s)}</div>
      <div class="user-main">
        <div class="user-name">${o(i)}${a.is_admin?' <span class="admin-tag">АДМИН</span>':""}</div>
        <div class="user-meta">${o(T(a))} · раундов ${c(a.total_rounds)}
          · RTP ${a.total_spent?(a.total_won/a.total_spent*100).toFixed(0)+"%":"-"}</div>
      </div>
      <div class="user-bal">${c(a.balance)}</div>
    </div>`}).join(""):'<div class="empty">Никого не найдено</div>',t.querySelectorAll(".user-row").forEach(a=>{a.addEventListener("click",()=>h(Number(a.dataset.user)))})}async function h(e){let t;try{t=await p("/api/admin/user",{userId:e})}catch(l){m(l.message);return}let a=t.user,i=a.username?"@"+a.username:a.first_name||"Без имени",s=t.log.map(l=>{let u=l.admin_username?"@"+l.admin_username:l.admin_name||"";return`<div class="log-row">
      <span>${o(H[l.action]||l.action)}${l.note?` · ${o(l.note)}`:""}
        <div class="bo-sub">${o(u)} · ${f(l.created_at)}</div></span>
      <b class="${l.amount>0?"plus":l.amount<0?"minus":""}">${l.amount?c(l.amount):""}</b>
    </div>`}).join(""),n=t.history.slice(0,12).map(l=>`<div class="log-row">
      <span>${o(l.title)} · ${o(l.subtitle)}</span>
      <b class="${l.payout>=l.bet?"plus":"minus"}">${c(l.payout-l.bet)}</b>
    </div>`).join(""),r=document.getElementById("adminDetail");r.innerHTML=`
    <div class="detail-head">
      <button class="btn btn-outline" id="detailBack"><span data-ico="back"></span></button>
      <div style="flex:1">
        <div class="user-name" style="font-size:19px">${o(i)}</div>
        <div class="user-meta">${o(T(a))}</div>
      </div>
    </div>

    ${A([{label:"Баланс",value:c(a.balance),sub:`к выводу: ${c(t.money.withdrawable)}`},{label:"Пополнил",value:c(t.money.deposited),sub:t.money.bonus?`бонусами ещё ${c(t.money.bonus)}`:""},{label:"Вывел",value:c(t.money.paidOut),sub:t.money.pendingOut?`в заявках ${c(t.money.pendingOut)}`:""},{label:"Касса заработала",value:c(t.money.deposited-t.money.paidOut),cls:t.money.deposited-t.money.paidOut>=0?"plus":"minus",sub:"пополнил минус вывел"},{label:"Раундов",value:c(a.total_rounds),sub:`поставил ${c(a.total_spent)}`},{label:"Его отдача",value:a.total_spent?(a.total_won/a.total_spent*100).toFixed(1)+"%":"-",cls:a.total_spent&&a.total_won>a.total_spent?"minus":"",sub:`выиграл ${c(a.total_won)}`},{label:"Долг по обороту",value:c(t.money.depositDebt),cls:t.money.depositDebt?"minus":"plus",sub:t.money.depositDebt?"вывод закрыт, пока не отыграет":"вывод открыт"},{label:"Бонусный счёт",value:c(t.money.bonusBalance||0),sub:t.money.wagerRequired?`отыграть ${c(t.money.wagerRequired)}`:"вывод не запирает"},{label:"Бонусы в деньги",value:c(t.money.bonusConverted||0),sub:`ещё можно ${c(t.money.bonusCashoutLeft||0)}`}])}

    <div class="bo-daybar">
      За сутки: поставил <b>${c(t.day.wagered)}</b> ·
      проиграл <b>${c(t.day.lost)}</b> ·
      пополнил <b>${c(t.day.deposited)}</b>
    </div>

    ${_("players.balance")?`
    <h2 class="section-title">Запросы на пополнение</h2>
    <div class="bo-table-wrap"><table><thead><tr><th>ID</th><th>Дата</th><th>Способ</th><th>Сумма</th><th>Статус</th></tr></thead>
    <tbody>${[...(t.paymentRequests||[]).map(l=>({...l,source:l.terminal==="mk"?"Мобильная коммерция":"Сицилия"})),...(t.cryptoRequests||[]).map(l=>({...l,source:"Криптовалюта"}))].sort((l,u)=>u.created_at-l.created_at).map(l=>`<tr><td>#${l.id}</td><td>${new Date(l.created_at).toLocaleString("ru-RU")}</td><td>${o(l.source)}</td><td>${y(l.amount)}</td><td>${o(l.status)}</td></tr>`).join("")||'<tr><td colspan="5">Запросов нет</td></tr>'}</tbody></table></div>
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
      запрёт игроку вывод.${b.admin.me?.balanceCap?` Ваш потолок одной правки: ${c(b.admin.me.balanceCap)}.`:""}</p>
    <div class="admin-actions">
      <button class="btn btn-primary" id="adjPlus"><span data-ico="plus"></span> Начислить</button>
      <button class="btn btn-outline" id="adjMinus"><span data-ico="minus"></span> Списать</button>
    </div>`:""}

    ${_("players.gift")?`
    <h2 class="section-title">Подарочный кейс</h2>
    <div class="amount-row">
      <select class="seed-input" id="voucherCase">
        ${b.config.cases.map(l=>`<option value="${l.id}">${o(l.name)} · ${c(l.price)}</option>`).join("")}
      </select>
      <input class="seed-input" id="voucherCount" type="number" value="1" min="1" max="100" style="max-width:80px">
    </div>
    <button class="btn btn-outline btn-wide" id="grantVoucher">Выдать кейс</button>`:""}

    ${_("players.limits")?`
    <h2 class="section-title">Лимиты ответственной игры</h2>
    <p class="game-sub">Ужесточение действует сразу, ослабление - через сутки.
      Лимит, который снимается в ту минуту, когда очень хочется играть, не лимит.</p>
    <div class="bo-settings">
      <label class="bo-field"><b>Пополнение в сутки</b>
        <i>0 - без ограничения</i>
        <input class="seed-input" type="number" id="limDeposit" value="${t.limits.deposit_day||0}"></label>
      <label class="bo-field"><b>Проигрыш в сутки</b>
        <i>0 - без ограничения</i>
        <input class="seed-input" type="number" id="limLoss" value="${t.limits.loss_day||0}"></label>
      <label class="bo-field"><b>Оборот в сутки</b>
        <i>0 - без ограничения</i>
        <input class="seed-input" type="number" id="limWager" value="${t.limits.wager_day||0}"></label>
      <label class="bo-field"><b>Самоисключение, дней</b>
        <i>Продлить можно, укоротить - нет</i>
        <input class="seed-input" type="number" id="limExclude" value="0"></label>
    </div>
    ${t.limits.pending_at?`<p class="adj-hint">Ослабление вступит в силу
      ${f(t.limits.pending_at)}.</p>`:""}
    ${t.limits.excluded_until>Date.now()?`<p class="adj-hint">Самоисключение
      до ${f(t.limits.excluded_until)}.</p>`:""}
    <button class="btn btn-outline btn-wide" id="saveLimits">Сохранить лимиты</button>`:""}

    ${_("players.block")?`
    <h2 class="section-title">Доступ</h2>
    <button class="btn ${a.is_blocked?"btn-primary":"btn-outline"} btn-wide" id="toggleBlock">
      <span data-ico="block"></span> ${a.is_blocked?"Разблокировать":"Заблокировать"}
    </button>`:""}

    ${_("players.notes")?`
    <h2 class="section-title">Заметки</h2>
    <div class="amount-row">
      <input class="seed-input" id="noteText" maxlength="2000" placeholder="что важно знать следующему">
      <button class="btn btn-sm" id="noteAdd">Добавить</button>
    </div>
    ${t.notes.length?t.notes.map(l=>`<div class="bo-note">
      <div>${o(l.text)}</div>
      <div class="bo-sub">${o(l.author_username?"@"+l.author_username:l.author_name||"#"+l.author_id)} · ${f(l.created_at)}
        <button class="bo-userlink" data-note-del="${l.id}">убрать</button></div>
    </div>`).join(""):'<div class="empty">Пока ничего</div>'}`:""}

    ${t.vouchers.length?`<h2 class="section-title">Подарки на руках</h2>
      ${t.vouchers.map(l=>`<div class="log-row"><span>${o(b.config.cases.find(u=>u.id===l.case_id)?.name||l.case_id)}</span>
        <b>×${l.count}</b></div>`).join("")}`:""}

    <h2 class="section-title">Действия администраторов</h2>
    ${s||'<div class="empty">Пока ничего</div>'}

    <h2 class="section-title">Последние раунды</h2>
    ${n||'<div class="empty">Пока ничего</div>'}
  `,r.hidden=!1,se(r),document.getElementById("detailBack").addEventListener("click",()=>{r.hidden=!0});let d=async l=>{let u=Math.abs(Math.trunc(Number(document.getElementById("adjAmount").value)));if(!u){m("Укажите сумму");return}try{await p("/api/admin/balance",{userId:e,amount:l*u,note:document.getElementById("adjNote").value,asDeposit:!document.getElementById("adjCorrection").checked,dispute:document.getElementById("adjDispute").checked,disputeMethod:document.getElementById("adjDisputeMethod").value}),m(l>0?`Начислено ${c(u)}`:`Списано ${c(u)}`),v("success"),h(e),j()}catch($){m($.message),v("error")}};document.getElementById("adjPlus")?.addEventListener("click",()=>d(1)),document.getElementById("adjMinus")?.addEventListener("click",()=>d(-1)),document.getElementById("saveLimits")?.addEventListener("click",async()=>{let l=u=>Math.max(0,Math.trunc(Number(document.getElementById(u).value)||0));try{await p("/api/admin/player/limits",{userId:e,patch:{deposit_day:l("limDeposit"),loss_day:l("limLoss"),wager_day:l("limWager"),excludedDays:l("limExclude")}}),m("Лимиты сохранены"),h(e)}catch(u){m(u.message)}}),document.getElementById("noteAdd")?.addEventListener("click",async()=>{let l=document.getElementById("noteText").value.trim();if(!l){m("Пустая заметка");return}try{await p("/api/admin/player/note",{userId:e,text:l}),h(e)}catch(u){m(u.message)}}),r.querySelectorAll("[data-note-del]").forEach(l=>{l.onclick=async()=>{try{await p("/api/admin/player/note/delete",{noteId:Number(l.dataset.noteDel)}),h(e)}catch(u){m(u.message)}}}),document.getElementById("grantVoucher")?.addEventListener("click",async()=>{try{await p("/api/admin/voucher",{userId:e,caseId:document.getElementById("voucherCase").value,count:Number(document.getElementById("voucherCount").value)||1}),m("Кейс выдан"),v("success"),h(e)}catch(l){m(l.message),v("error")}}),document.getElementById("toggleBlock")?.addEventListener("click",async()=>{try{await p("/api/admin/block",{userId:e,blocked:!a.is_blocked}),m(a.is_blocked?"Разблокирован":"Заблокирован"),h(e),j()}catch(l){m(l.message),v("error")}})}let P=[{id:"overview",name:"Сводка",group:"Обзор",need:"reports.view",load:()=>U()},{id:"reports",name:"Отчёты",group:"Обзор",need:"reports.view",load:()=>J()},{id:"funnel",name:"Воронка",group:"Обзор",need:"reports.view",load:()=>Z()},{id:"feed",name:"Лента",group:"Обзор",need:"reports.view",load:()=>U()},{id:"users",name:"Игроки",group:"Игроки",need:"players.view",load:()=>j()},{id:"risk",name:"Риск",group:"Игроки",need:"risk.view",load:()=>$e()},{id:"deposits",name:"Пополнения",group:"Финансы",need:"finance.payouts.view",load:()=>k()},{id:"payouts",name:"Выводы",group:"Финансы",need:"finance.payouts.view",load:()=>S()},{id:"promos",name:"Промокоды",group:"Промо",need:"promo.view",load:()=>R()},{id:"partners",name:"Партнёры",group:"Промо",need:"partners.view",load:()=>ae()},{id:"casino",name:"Казино",group:"Система",need:"games.manage",load:()=>K()},{id:"settings",name:"Настройки",group:"Система",need:"settings.manage",load:()=>Y()},{id:"staff",name:"Сотрудники",group:"Система",need:"staff.manage",load:()=>C()},{id:"journal",name:"Журнал",group:"Система",need:"journal.view",load:()=>Q()}];function _(e){return b.admin.perms?.has(e)||!1}function O(e){let t=P.find(a=>a.id===e);!t||!_(t.need)||(b.admin.tab=e,document.querySelectorAll("[data-admin-tab]").forEach(a=>a.classList.toggle("active",a.dataset.adminTab===e)),document.querySelectorAll(".admin-pane").forEach(a=>a.classList.toggle("active",a.id===`admin-${e}`)),document.getElementById("adminDetail").hidden=!0,t.load(),v("light"))}let ce=2e3,g={poll:0,id:0};function F(e){document.getElementById("boGate").hidden=e,document.getElementById("boShell").hidden=!e,e&&clearInterval(g.poll)}async function re(){let e;try{e=await p("/api/admin/2fa/status")}catch(t){return m(t.message),!1}return!e.required||e.confirmed?(F(!0),!0):(W(e),!1)}async function W(e){if(clearInterval(g.poll),!e)try{e=await p("/api/admin/2fa/status")}catch(i){m(i.message);return}F(!1);let t=document.getElementById("boGate");if(!e.linked){t.innerHTML=`
      <div class="bo-gate-card">
        <div class="bo-gate-title">Привяжите Telegram</div>
        <p>Вход в панель подтверждается в служебном боте${e.bot?` <b>@${o(e.bot)}</b>`:""}.
          Откройте его по кнопке ниже и нажмите Start - бот запомнит этот Telegram.
          Сюда же будут приходить оповещения о сбоях.</p>
        <button class="btn btn-primary btn-wide" id="gateLink">Открыть служебного бота</button>
        <button class="btn btn-outline btn-wide" id="gateLinked">Я нажал Start</button>
      </div>`,document.getElementById("gateLink").onclick=async()=>{let i=ne();try{let{url:s}=await p("/api/admin/2fa/link");i&&!i.closed?i.location.href=s:window.open(s,"_blank","noopener")}catch(s){i?.close(),m(s.message)}},document.getElementById("gateLinked").onclick=()=>q();return}t.innerHTML=`
    <div class="bo-gate-card">
      <div class="bo-gate-title">Подтвердите вход</div>
      <p>Мы отправим запрос в служебного бота${e.bot?` <b>@${o(e.bot)}</b>`:""}.
        Нажмите там «Это я» - панель откроется сама. Не пришло - введите код из сообщения.</p>
      <button class="btn btn-primary btn-wide" id="gateSend">Отправить запрос в Telegram</button>
      <div class="bo-gate-wait" id="gateWait" hidden>
        <div class="bo-gate-status" id="gateStatus">Ждём подтверждения в Telegram…</div>
        <div class="bo-gate-code">
          <input class="seed-input" id="gateCode" inputmode="numeric" maxlength="6" placeholder="Код из сообщения">
          <button class="btn btn-outline" id="gateCodeBtn">Подтвердить</button>
        </div>
      </div>
    </div>`;let a=i=>{document.getElementById("gateStatus").textContent=i};document.getElementById("gateSend").onclick=async()=>{let i=document.getElementById("gateSend");i.disabled=!0;try{let s=await p("/api/admin/2fa/request");g.id=s.id,document.getElementById("gateWait").hidden=!1,i.textContent="Отправить ещё раз",a("Ждём подтверждения в Telegram…"),clearInterval(g.poll),g.poll=setInterval(async()=>{if(b.view!=="admin"){clearInterval(g.poll);return}try{let n=await p("/api/admin/2fa/poll",{id:g.id});if(n.confirmed){clearInterval(g.poll),q();return}n.status==="denied"&&(clearInterval(g.poll),a("Вход отклонён в Telegram. Сессия закрыта.")),(n.status==="expired"||n.status==="burned")&&(clearInterval(g.poll),a("Запрос устарел, отправьте новый."))}catch{}},ce)}catch(s){m(s.message)}i.disabled=!1},document.getElementById("gateCodeBtn").onclick=async()=>{try{await p("/api/admin/2fa/code",{id:g.id,code:document.getElementById("gateCode").value}),q()}catch(i){a(i.message),v("error")}}}async function q(){if(!await re())return;let e;try{e=await p("/api/admin/me")}catch(s){m(s.message);return}b.admin.perms=new Set(e.permissions),b.admin.me=e,document.getElementById("boWho").innerHTML=`${o(e.roleName||"Без роли")} · прав: ${e.permissions.length}`+(e.balanceCap?` · правка баланса до ${c(e.balanceCap)}`:"");let t=P.filter(s=>_(s.need)),a=[];for(let s of t){let n=a.find(r=>r.name===s.group);n||a.push(n={name:s.group,items:[]}),n.items.push(s)}document.getElementById("boNav").innerHTML=a.map(s=>`
    <div class="bo-group">
      <div class="bo-group-name">${o(s.name)}</div>
      ${s.items.map(n=>`<button class="bo-link" data-admin-tab="${n.id}">${o(n.name)}${n.id==="deposits"&&e.sections?.disputes?` <span class="bo-badge" title="Споры ждут решения">${c(e.sections.disputes)}</span>`:""}</button>`).join("")}
    </div>`).join("")||'<div class="empty">Разделов нет</div>',document.querySelectorAll("[data-admin-tab]").forEach(s=>{s.addEventListener("click",()=>O(s.dataset.adminTab))});let i=t.find(s=>s.id===b.admin.tab)||t[0];i?O(i.id):document.getElementById("boNav").innerHTML='<div class="empty">Доступа ни к одному разделу нет</div>'}async function K(){let e=document.getElementById("admin-casino");e.innerHTML='<div class="empty">Загрузка...</div>';let t;try{t=await p("/api/admin/casino")}catch(n){e.innerHTML=`<div class="empty">${o(n.message)}</div>`;return}let a=t.sync,i=t.configured?a.running?"Идёт обновление каталога...":a.at?`${a.ok?"Обновлён":"Ошибка обновления"} ${f(a.at)}${a.ok?"":`: ${o(a.message)}`}`:"Ещё не обновлялся":"Ключи агрегатора не заданы: каталог из снимка в репозитории",s=(n,r)=>`<tr><td>${n}</td><td class="num">${y(r.bets)}</td><td class="num">${y(r.wins)}</td>
    <td class="num">${y(r.ggr)}</td><td class="num">${c(r.rounds)}</td><td class="num">${c(r.players)}</td></tr>`;e.innerHTML=`
    ${A([{label:"Игр в лобби",value:c(a.games),sub:`провайдеров ${c(a.providers)}`},{label:"Отдача слотов",value:`${t.rtp}%`,sub:`пределы агрегатора ${t.rtpRange[0]}-${t.rtpRange[1]}%`},{label:"Доход кассы за 30 дней",value:y(t.month.ggr),sub:"ставки минус выигрыши",cls:t.month.ggr>=0?"plus":"minus"}])}
    <div class="bo-subtitle">Каталог</div>
    <p class="bo-note">${i}. По расписанию каталог обновляется сам.</p>
    <div class="admin-actions">
      <button class="btn btn-outline btn-sm" id="casinoSync" ${t.configured?"":"disabled"}>Обновить сейчас</button>
    </div>
    <div class="bo-subtitle">Деньги</div>
    ${x([{label:"Период"},{label:"Ставки",num:!0},{label:"Выигрыши",num:!0},{label:"Доход",num:!0},{label:"Раундов",num:!0},{label:"Игроков",num:!0}],[s("Сутки",t.today),s("7 дней",t.week),s("30 дней",t.month)])}`,document.getElementById("casinoSync")?.addEventListener("click",async n=>{n.target.disabled=!0;try{await p("/api/admin/casino/sync"),m("Каталог обновлён")}catch(r){m(r.message)}K()})}let M=e=>new Date(e).toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit"}),f=e=>new Date(e).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});function A(e){return`<div class="admin-kpis">${e.map(t=>`<div class="kpi">
    <div class="kpi-label">${o(t.label)}</div>
    <div class="kpi-value ${t.cls||""}">${t.value}</div>
    ${t.sub?`<div class="kpi-sub">${t.sub}</div>`:""}
  </div>`).join("")}</div>`}function x(e,t,a="Нет данных"){return`<div class="bo-scroll"><table class="admin-table">
    <thead><tr>${e.map(i=>`<th class="${i.num?"num":""}">${o(i.label??i)}</th>`).join("")}</tr></thead>
    <tbody>${t.length?t.join(""):`<tr><td colspan="${e.length}">${o(a)}</td></tr>`}</tbody>
  </table></div>`}function G(e,{key:t,label:a,color:i="var(--cyan)"}){let s=Math.max(1,...e.map(n=>Math.abs(n[t])));return`<div class="bo-chart" role="img" aria-label="${o(a)}">
    ${e.map(n=>{let r=n[t],d=Math.round(Math.abs(r)/s*100);return`<div class="bo-bar" title="${M(n.day)}: ${c(r)}">
        <i style="height:${Math.max(2,d)}%;background:${r<0?"var(--pink)":i}"></i>
        <span>${M(n.day)}</span>
      </div>`}).join("")}
  </div>`}async function J(){let e=document.getElementById("admin-reports");e.innerHTML='<div class="empty">Считаем...</div>';let t;try{t=await p("/api/admin/reports",{days:b.admin.reportDays})}catch(d){e.innerHTML=`<div class="empty">${o(d.message)}</div>`;return}let a=d=>t.daily.reduce((l,u)=>l+u[d],0),i=a("wagered"),s=a("paid"),n=[...t.daily].reverse().map(d=>`<tr>
    <td>${M(d.day)}</td>
    <td class="num">${c(d.rounds)}</td>
    <td class="num">${c(d.players)}</td>
    <td class="num">${c(d.wagered)}</td>
    <td class="num ${d.ggr>=0?"plus":"minus"}">${c(d.ggr)}</td>
    <td class="num">${w(d.rtp)}</td>
    <td class="num">${c(d.deposits)}</td>
    <td class="num">${c(d.payouts)}</td>
    <td class="num ${d.net>=0?"plus":"minus"}">${c(d.net)}</td>
    <td class="num">${c(d.signups)}</td>
  </tr>`),r=t.cases.slice(0,30).map(d=>`<tr>
    <td>${o(d.title)}</td>
    <td class="num">${c(d.opened)}</td>
    <td class="num">${c(d.players)}</td>
    <td class="num">${c(d.wagered)}</td>
    <td class="num ${d.ggr>=0?"plus":"minus"}">${c(d.ggr)}</td>
    <td class="num">${w(d.rtp)}</td>
  </tr>`);e.innerHTML=`
    <div class="admin-tabs" id="reportPeriod">
      ${[7,30,90].map(d=>`<button class="tab ${d===b.admin.reportDays?"active":""}"
        data-report-days="${d}">${d} дней</button>`).join("")}
      <button class="tab" id="exportDaily">Выгрузить дни</button>
      <button class="tab" id="exportCases">Выгрузить кейсы</button>
    </div>

    ${A([{label:"Поставлено",value:c(i)},{label:"Выплачено",value:c(s)},{label:"Доход с игры",value:c(i-s),cls:i-s>=0?"plus":"minus",sub:`фактическая отдача ${w(i?s/i:null)}`},{label:"Пополнено",value:c(a("deposits"))},{label:"Выведено",value:c(a("payouts"))},{label:"Чистый приход",value:c(a("deposits")-a("payouts")),cls:a("deposits")-a("payouts")>=0?"plus":"minus",sub:"пополнения минус выплаты"},{label:"Регистраций",value:c(a("signups"))}])}

    <h2 class="section-title">Доход с игры по дням</h2>
    ${G(t.daily,{key:"ggr",label:"Доход по дням",color:"var(--green)"})}

    <h2 class="section-title">Чистый приход кассы по дням</h2>
    <p class="game-sub">Пополнения минус выплаты. Доход с игры считает ставки,
      но выигрыш на балансе игрока ещё не выведен и ничей.</p>
    ${G(t.daily,{key:"net",label:"Приход кассы по дням"})}

    <h2 class="section-title">По дням</h2>
    ${x(["Дата",{label:"Раундов",num:1},{label:"Игроков",num:1},{label:"Ставки",num:1},{label:"Доход",num:1},{label:"Отдача",num:1},{label:"Пополнено",num:1},{label:"Выведено",num:1},{label:"Чисто",num:1},{label:"Регистраций",num:1}],n)}

    <h2 class="section-title">По кейсам</h2>
    ${x(["Кейс",{label:"Открытий",num:1},{label:"Игроков",num:1},{label:"Ставки",num:1},{label:"Доход",num:1},{label:"Отдача",num:1}],r)}
  `,e.querySelectorAll("[data-report-days]").forEach(d=>{d.onclick=()=>{b.admin.reportDays=Number(d.dataset.reportDays),J()}}),e.querySelector("#exportDaily").onclick=()=>V("daily"),e.querySelector("#exportCases").onclick=()=>V("cases")}async function V(e){try{let t=await fetch("/api/admin/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind:e,days:b.admin.reportDays})});if(!t.ok)throw new Error("Не удалось выгрузить");let a=await t.blob(),i=URL.createObjectURL(a),s=document.createElement("a");s.href=i,s.download=`luckybox-${e}-${b.admin.reportDays}d.csv`,s.click(),setTimeout(()=>URL.revokeObjectURL(i),1e3),m("Файл готов")}catch(t){m(t.message)}}let ue=[["all","Все"],["credited","Зачислены"],["open","Ждут оплаты"],["failed","Не оплачены"],["dispute","Споры"]],z={created:"создан",pending:"ждёт оплаты",processing:"в обработке",completed:"зачислен",cancelled:"отменён шлюзом",error:"ошибка шлюза",unclaimed:"отозван",expired:"не оплачен вовремя",paid:"зачислен",paid_over:"зачислен с переплатой",failed:"не прошёл",wrong_amount:"не та сумма",cancel:"отменён",fail:"не прошёл",system_fail:"сбой шлюза",process:"в обработке",check:"проверяется"},me={new:"Игрок сообщил: деньги не пришли",sent:"Апелляция у шлюза",won:"Спор выигран, зачислено",lost:"Шлюз отказал",declined:"Отказано сотрудником"},pe=[7,30,90];function I(e,t){return t?`<button class="dep-id" type="button" data-copy="${o(String(t))}" title="Скопировать">
    <span>${o(e)}</span><b>${o(String(t))}</b></button>`:""}function X(e){e.querySelectorAll("[data-copy]").forEach(t=>{t.dataset.bound||(t.dataset.bound="1",t.addEventListener("click",async a=>{a.stopPropagation();try{await navigator.clipboard.writeText(t.dataset.copy),m("Скопировано"),v("light")}catch{m("Скопируйте вручную")}}))})}function B(){return`<div class="dep-export">
    <span>Выгрузка в Excel</span>
    <select class="seed-input" id="depExportDays">${pe.map(e=>`<option value="${e}"${e===30?" selected":""}>${e} дн.</option>`).join("")}</select>
    <button class="btn btn-outline btn-sm" data-fin-export="deposits">Пополнения</button>
    <button class="btn btn-outline btn-sm" data-fin-export="payouts">Выводы</button>
  </div>`}function D(e){e.querySelectorAll("[data-fin-export]").forEach(t=>t.addEventListener("click",()=>be(t.dataset.finExport,Number(e.querySelector("#depExportDays")?.value)||30)))}async function be(e,t){try{let a=await fetch("/api/admin/export/finance",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind:e,days:t})});if(!a.ok)throw new Error("Не удалось выгрузить");let i=URL.createObjectURL(await a.blob()),s=document.createElement("a");s.href=i,s.download=`luckybox-${e}-${t}d.csv`,s.click(),setTimeout(()=>URL.revokeObjectURL(i),1e3),m("Файл готов")}catch(a){m(a.message)}}async function k({more:e=!1}={}){let t=document.getElementById("admin-deposits"),a=b.admin.dep||(b.admin.dep={filter:"all",q:"",rows:[]});if(e||(a.rows=[]),!t.dataset.built){t.dataset.built="1",t.innerHTML=`
      <div id="depKpis"></div>
      <div class="admin-search">
        <input class="seed-input" id="depSearch" placeholder="номер наш или шлюза, почта, ник, id игрока">
        <button class="btn btn-sm" id="depSearchBtn">Найти</button>
      </div>
      <div class="admin-tabs" id="depFilter">${ue.map(([d,l])=>`<button class="tab${d===a.filter?" active":""}" data-dep-filter="${d}">${l}</button>`).join("")}</div>
      <div id="depList"></div>
      <button class="btn btn-outline" id="depMore" hidden>Показать ещё</button>
      ${B()}`;let r=()=>{a.q=t.querySelector("#depSearch").value.trim(),k()};t.querySelector("#depSearchBtn").addEventListener("click",r),t.querySelector("#depSearch").addEventListener("keydown",d=>{d.key==="Enter"&&r()}),t.querySelectorAll("[data-dep-filter]").forEach(d=>d.addEventListener("click",()=>{a.filter=d.dataset.depFilter,t.querySelectorAll("[data-dep-filter]").forEach(l=>l.classList.toggle("active",l===d)),k()})),t.querySelector("#depMore").addEventListener("click",()=>k({more:!0})),D(t)}let i=t.querySelector("#depList");e||(i.innerHTML='<span class="skel skel-line"></span>'.repeat(4));let s;try{s=await p("/api/admin/deposits",{q:a.q,filter:a.filter,before:e&&a.rows.length?a.rows[a.rows.length-1].created_at:0})}catch(r){i.innerHTML=`<div class="empty">${o(r.message)}</div>`;return}a.rows.push(...s.rows),a.meta=s;let n=s.summary;t.querySelector("#depKpis").innerHTML=`<div class="admin-kpis">
    <div class="kpi"><div class="kpi-label">Зачислено за сутки</div>
      <div class="kpi-value plus">${y(n.paidSum)}</div><div class="kpi-sub">${c(n.paidCount)} оплат</div></div>
    <div class="kpi"><div class="kpi-label">Доходят до оплаты</div>
      <div class="kpi-value">${n.conversion==null?"-":Math.round(n.conversion*100)+"%"}</div>
      <div class="kpi-sub">из созданных за сутки</div></div>
    <div class="kpi${n.disputesNew?" kpi-alert":""}"><div class="kpi-label">Споры ждут решения</div>
      <div class="kpi-value">${c(n.disputesNew)}</div><div class="kpi-sub">сообщили игроки</div></div>
    <div class="kpi"><div class="kpi-label">Апелляции у шлюза</div>
      <div class="kpi-value">${c(n.disputesSent)}</div><div class="kpi-sub">ждём решения Sicilia</div></div>
  </div>`,i.innerHTML=a.rows.length?a.rows.map(r=>ve(r,s)).join(""):`<div class="empty">${a.q?"Ничего не нашлось":"Пополнений нет"}</div>`,t.querySelector("#depMore").hidden=s.rows.length<50,X(i),ye(i)}function ve(e,t){let a=!!e.paid_at,i=e.username?"@"+e.username:e.email||e.first_name||"#"+e.user_id,s=a?"paid":["created","pending","processing","process","check"].includes(e.status)?"processing":"rejected",n=e.dispute,r=t.canResolve&&e.source==="sicilia"&&!a,d=n?`<div class="dep-dispute is-${n.status}">
      <b>${o(me[n.status]||n.status)}</b>
      <small>${n.source==="player"?"Сообщил игрок":"Открыл сотрудник"} · ${new Date(n.createdAt).toLocaleString("ru-RU")}</small>
      ${n.comment?`<p>«${o(n.comment)}»</p>`:""}
      ${n.receipt?`<a class="dep-receipt" href="${o(n.receipt)}" target="_blank" rel="noopener"><img src="${o(n.receipt)}" alt="Чек" loading="lazy"><span>Открыть чек</span></a>`:""}
      ${n.appealReason?`<p>Ответ шлюза: ${o(n.appealReason)}</p>`:""}
      ${n.staffNote?`<p>Ответ игроку: ${o(n.staffNote)}</p>`:""}
      ${n.error?`<p class="dep-error">Не ушло в шлюз: ${o(n.error)}</p>`:""}
    </div>`:"",l=n&&n.status==="new",u=r?`<div class="dep-actions" data-dep-actions="${e.id}">
      <button class="btn btn-outline btn-sm" data-dep-recheck="${e.id}">Проверить у шлюза</button>
      ${["created","pending","processing"].includes(e.status)?`<button class="btn btn-outline btn-sm" data-dep-cancel="${e.id}">Отменить у шлюза</button>`:""}
      ${!n||!["new","sent"].includes(n.status)||l?`<button class="btn btn-sm" data-dep-appeal="${e.id}" data-dispute="${l?n.id:""}">${l?"Отправить спор в Sicilia":"Открыть спор"}</button>`:""}
      ${l?`<button class="btn btn-outline btn-sm" data-dep-decline="${n.id}">Отказать</button>`:""}
    </div>
    <div class="dep-form" data-dep-form="${e.id}" hidden></div>`:"";return`<div class="payout-row admin ${s}">
    <div class="payout-head">
      <b>${y(e.amount)}${a&&e.credited!==e.amount?` <small class="dep-fact">зачислено ${y(e.credited)}</small>`:""}</b>
      <span class="payout-status ${s}">${o(z[e.status]||e.status)}</span>
    </div>
    <div class="payout-date">${e.source==="sicilia"?e.terminal==="mk"?"Мобильная коммерция · Sicilia":"СБП / карта · Sicilia":`Криптовалюта${e.currency?" "+o(e.currency):""} · Heleket`} ·
      <a href="#" data-dep-user="${e.user_id}">${o(i)}</a> · ${o(T(e,e.user_id))}</div>
    <div class="payout-date">Создан ${new Date(e.created_at).toLocaleString("ru-RU")}${a?` · зачислен ${new Date(e.paid_at).toLocaleString("ru-RU")}`:""}</div>
    <div class="dep-ids">${I("Наш номер",e.number)}${I(e.source==="sicilia"?"Номер Sicilia":"Номер Heleket",e.gateway_id)}</div>
    ${d}
    ${u}
  </div>`}function ye(e){e.querySelectorAll("[data-dep-user]").forEach(t=>t.addEventListener("click",a=>{a.preventDefault(),h(Number(t.dataset.depUser))})),e.querySelectorAll("[data-dep-recheck]").forEach(t=>t.addEventListener("click",()=>L(t,async()=>{try{let a=await p("/api/admin/deposit/recheck",{id:Number(t.dataset.depRecheck)});m(a.credited?`Зачислено ${y(a.amount)}`:`Шлюз отвечает: ${z[a.status]||a.status||"нет ордера"}`),k()}catch(a){m(a.message)}}))),e.querySelectorAll("[data-dep-cancel]").forEach(t=>t.addEventListener("click",()=>{if(t.dataset.armed!=="1"){t.dataset.armed="1",t.textContent="Точно отменить?";return}L(t,async()=>{try{let a=await p("/api/admin/deposit/cancel",{id:Number(t.dataset.depCancel)});m(a.credited?`Оплата успела пройти: зачислено ${y(a.amount)}`:"Оплата отменена у шлюза"),k()}catch(a){m(a.message)}})})),e.querySelectorAll("[data-dep-appeal]").forEach(t=>t.addEventListener("click",()=>{let a=t.dataset.depAppeal,i=e.querySelector(`[data-dep-form="${a}"]`),s=b.admin.dep.rows.find(r=>r.source==="sicilia"&&String(r.id)===a),n=!!t.dataset.dispute;if(!b.admin.dep.meta.siteUrl){m("Не задан SITE_URL: шлюзу не по чему открыть чек");return}i.hidden=!i.hidden,!i.hidden&&(i.innerHTML=`
      <label class="dep-label">Причина для шлюза</label>
      <textarea class="seed-input" rows="2" data-f="reason" placeholder="Например: перевод выполнен, чек приложен, сумма совпадает">${o(s?.dispute?.comment||"")}</textarea>
      <label class="dep-label">${n?"Свой чек, если чек игрока не годится":"Чек перевода (фото или скриншот)"}</label>
      <label class="dep-file"><span data-f="filename">Выбрать файл</span><input type="file" accept="image/*" data-f="file" hidden></label>
      <div class="admin-actions"><button class="btn btn-primary" data-f="send">Отправить апелляцию</button></div>`,i.querySelector('[data-f="file"]').addEventListener("change",r=>{i.querySelector('[data-f="filename"]').textContent=r.target.files[0]?.name||"Выбрать файл"}),i.querySelector('[data-f="send"]').addEventListener("click",r=>L(r.currentTarget,async()=>{try{let d=await le(i.querySelector('[data-f="file"]').files[0]);if(!n&&!d){m("Приложите чек");return}let l=await p("/api/admin/dispute/open",{orderId:Number(a),disputeId:n?Number(t.dataset.dispute):void 0,reason:i.querySelector('[data-f="reason"]').value,image:d});m(l.credited?"Пока открывали спор, деньги пришли: зачислено":"Апелляция открыта, решение придёт от шлюза"),v("success"),k()}catch(d){m(d.message)}})))})),e.querySelectorAll("[data-dep-decline]").forEach(t=>t.addEventListener("click",()=>{let a=t.closest(".payout-row").querySelector("[data-dep-form]");a.hidden=!1,a.innerHTML=`
      <label class="dep-label">Ответ игроку: почему отказано</label>
      <textarea class="seed-input" rows="2" data-f="note" placeholder="Например: перевод ушёл на реквизиты другого платежа"></textarea>
      <div class="admin-actions"><button class="btn btn-outline" data-f="send">Отказать</button></div>`,a.querySelector('[data-f="send"]').addEventListener("click",i=>L(i.currentTarget,async()=>{try{await p("/api/admin/dispute/decline",{id:Number(t.dataset.depDecline),note:a.querySelector('[data-f="note"]').value}),m("Игрок увидит ответ в кассе"),k()}catch(s){m(s.message)}}))}))}async function $e(){let e=document.getElementById("admin-risk");e.innerHTML='<div class="empty">Проверяем...</div>';let t;try{t=await p("/api/admin/risk")}catch(n){e.innerHTML=`<div class="empty">${o(n.message)}</div>`;return}let a=(n,r)=>`<button class="bo-userlink" data-open-user="${n}">${o(r)}</button>`,i=[{title:"Один номер СБП на нескольких аккаунтах",hint:"Самый прямой признак мультиаккаунта: деньги сходятся в один кошелёк.",head:["Номер",{label:"Аккаунтов",num:1},{label:"Сумма заявок",num:1},"Кто"],rows:t.sharedPhone.map(n=>`<tr>
        <td>${o(n.phone)}</td><td class="num">${n.accounts}</td>
        <td class="num">${c(n.amount)}</td>
        <td>${String(n.users).split(",").map(r=>a(r,"#"+r)).join(" ")}</td></tr>`)},{title:"Один криптокошелёк на нескольких аккаунтах",head:["Адрес",{label:"Аккаунтов",num:1},{label:"Сумма заявок",num:1},"Кто"],rows:t.sharedWallet.map(n=>`<tr>
        <td class="bo-mono">${o(String(n.address).slice(0,18))}…</td>
        <td class="num">${n.accounts}</td><td class="num">${c(n.amount)}</td>
        <td>${String(n.users).split(",").map(r=>a(r,"#"+r)).join(" ")}</td></tr>`)},{title:"Заявка на вывод при почти нулевом обороте",hint:"Так выглядит и вымывание бонусов, и прогон чужих денег через площадку.",head:["Игрок",{label:"Заявка",num:1},{label:"Поставил всего",num:1},{label:"Раундов",num:1},"Статус"],rows:t.quickCashout.map(n=>`<tr>
        <td>${a(n.user_id,n.username?"@"+n.username:n.first_name||"#"+n.user_id)}</td>
        <td class="num">${c(n.amount)}</td><td class="num">${c(n.total_spent)}</td>
        <td class="num">${c(n.total_rounds)}</td><td>${o(n.status)}</td></tr>`)},{title:"Отдача игрока сильно выше заявленной",hint:"Само по себе это везение. Ровно так же выглядит и найденная дыра, поэтому смотреть стоит.",head:["Игрок",{label:"Поставил",num:1},{label:"Выиграл",num:1},{label:"Его отдача",num:1},{label:"Баланс",num:1}],rows:t.hotPlayers.map(n=>`<tr>
        <td>${a(n.id,n.username?"@"+n.username:n.first_name||"#"+n.id)}</td>
        <td class="num">${c(n.total_spent)}</td><td class="num">${c(n.total_won)}</td>
        <td class="num plus">${(n.total_won/n.total_spent*100).toFixed(0)}%</td>
        <td class="num">${c(n.balance)}</td></tr>`)},{title:"Свежие аккаунты с бонусом и без единой ставки",head:["Игрок",{label:"Промокодов",num:1},{label:"Баланс",num:1},"Заведён"],rows:t.bonusOnly.map(n=>`<tr>
        <td>${a(n.id,n.username?"@"+n.username:n.first_name||"#"+n.id)}</td>
        <td class="num">${n.redemptions}</td><td class="num">${c(n.balance)}</td>
        <td>${f(n.created_at)}</td></tr>`)}],s=i.reduce((n,r)=>n+r.rows.length,0);e.innerHTML=`
    <p class="game-sub">Сигнал это повод посмотреть, а не повод заблокировать.
      Ни один из них ничего не делает сам.</p>
    ${A([{label:"Сигналов",value:c(s),cls:s?"minus":"plus",sub:s?"есть что проверить":"чисто"}])}
    ${i.map(n=>`
      <h2 class="section-title">${o(n.title)}</h2>
      ${n.hint?`<p class="game-sub">${o(n.hint)}</p>`:""}
      ${x(n.head,n.rows,"Чисто")}`).join("")}
  `,e.querySelectorAll("[data-open-user]").forEach(n=>{n.onclick=()=>h(Number(n.dataset.openUser))})}async function Y(){let e=document.getElementById("admin-settings");e.innerHTML='<div class="empty">Загружаем...</div>';let t;try{t=await p("/api/admin/settings")}catch(i){e.innerHTML=`<div class="empty">${o(i.message)}</div>`;return}let a=[];for(let i of t.rows){let s=a.find(n=>n.name===i.group);s||a.push(s={name:i.group,items:[]}),s.items.push(i)}e.innerHTML=`
    <p class="game-sub">Меняется на лету, без выката. Каждая правка попадает
      в журнал вместе с тем, что было до неё.</p>
    ${a.map(i=>`
      <h2 class="section-title">${o(i.name)}</h2>
      <div class="bo-settings">
        ${i.items.map(s=>s.type==="bool"?`
          <label class="bo-toggle">
            <input type="checkbox" data-setting="${s.key}" ${s.value==="1"?"checked":""}>
            <span><b>${o(s.label)}</b>${s.hint?`<i>${o(s.hint)}</i>`:""}</span>
          </label>`:`
          <label class="bo-field">
            <b>${o(s.label)}</b>
            ${s.hint?`<i>${o(s.hint)}</i>`:""}
            <input class="seed-input" type="number" inputmode="numeric"
                   data-setting="${s.key}" value="${o(s.value)}">
          </label>`).join("")}
      </div>`).join("")}
    <button class="btn btn-primary btn-wide" id="saveSettings">Сохранить</button>
  `,e.querySelector("#saveSettings").onclick=async()=>{let i={};e.querySelectorAll("[data-setting]").forEach(s=>{i[s.dataset.setting]=s.type==="checkbox"?s.checked:s.value});try{await p("/api/admin/settings/save",{patch:i}),m("Сохранено"),v("success"),Y()}catch(s){m(s.message),v("error")}}}async function C(){let e=document.getElementById("admin-staff");e.innerHTML='<div class="empty">Загружаем...</div>';let t;try{t=await p("/api/admin/staff")}catch(s){e.innerHTML=`<div class="empty">${o(s.message)}</div>`;return}b.admin.staff=t;let a=s=>t.roles.find(n=>n.id===s)?.name||s,i=t.rows.map(s=>{let n=s.username?"@"+s.username:s.first_name||"Без имени";return`<tr class="${s.active?"":"bo-off"}">
      <td>${o(n)}<div class="bo-sub">${o(T(s,s.user_id))}</div></td>
      <td>${o(a(s.role))}${s.added_by===null?'<div class="bo-sub">из настроек сервера</div>':""}</td>
      <td class="num">${c(s.actions||0)}</td>
      <td>${s.last_action?f(s.last_action):"не заходил"}</td>
      <td>${s.active?'<span class="bo-ok">работает</span>':'<span class="bo-no">выключен</span>'}</td>
      <td class="bo-rowact">
        <button class="btn btn-sm" data-staff-edit="${s.user_id}">Править</button>
        ${s.user_id===t.meId?"":`<button class="btn btn-sm btn-outline" data-staff-del="${s.user_id}">Убрать</button>`}
      </td>
    </tr>`});e.innerHTML=`
    <p class="game-sub">Роль это заготовка набора прав. Поправки сверху дают
      «поддержка, но ещё и промокоды» без новой роли.</p>

    ${x(["Сотрудник","Роль",{label:"Действий",num:1},"Последнее","Статус",""],i,"Пока только вы")}

    <h2 class="section-title">Роли</h2>
    <div class="bo-roles">
      ${t.roles.map(s=>`<div class="bo-role ${t.assignable.includes(s.id)?"":"bo-off"}">
        <b>${o(s.name)}</b>
        <p>${o(s.description)}</p>
        <span>${s.permissions.length} прав${s.balanceCap?` · правка баланса до ${c(s.balanceCap)}`:""}</span>
        ${t.assignable.includes(s.id)?"":'<span class="bo-no">вам недоступна</span>'}
      </div>`).join("")}
    </div>

    <h2 class="section-title">Добавить или изменить</h2>
    <div id="staffForm"></div>
  `,N(null),e.querySelectorAll("[data-staff-edit]").forEach(s=>{s.onclick=()=>{let n=t.rows.find(r=>r.user_id===Number(s.dataset.staffEdit));N(n),document.getElementById("staffForm").scrollIntoView({behavior:"smooth",block:"center"})}}),e.querySelectorAll("[data-staff-del]").forEach(s=>{s.onclick=async()=>{if(confirm("Убрать сотрудника из панели?"))try{await p("/api/admin/staff/remove",{userId:Number(s.dataset.staffDel)}),m("Убран"),C()}catch(n){m(n.message)}}})}function N(e){let t=b.admin.staff,a=document.getElementById("staffForm"),i=l=>{try{return JSON.parse(l||"[]")}catch{return[]}},s=new Set(e?i(e.extra_perms):[]),n=new Set(e?i(e.denied_perms):[]),r=e?.role||t.assignable[t.assignable.length-1]||t.roles[0].id,d=t.groups.map(l=>({...l,items:t.permissions.filter(u=>u.group===l.id)}));a.innerHTML=`
    <div class="bo-settings">
      <label class="bo-field">
        <b>Кто</b>
        <i>Почта, Telegram ID, ник или внутренний номер. Человек должен сначала зарегистрироваться на сайте.</i>
        <input class="seed-input" id="staffKey" value="${e?o(e.email||e.tg_id||e.user_id):""}"
               ${e?"readonly":""} placeholder="почта, 123456789 или @nickname">
      </label>
      <label class="bo-field">
        <b>Роль</b>
        <select class="seed-input" id="staffRole">
          ${t.roles.filter(l=>t.assignable.includes(l.id)).map(l=>`<option value="${l.id}" ${l.id===r?"selected":""}>${o(l.name)}</option>`).join("")}
        </select>
      </label>
      <label class="bo-field">
        <b>Потолок одной правки баланса</b>
        <i>Пусто - как у роли. Ноль - без потолка.</i>
        <input class="seed-input" id="staffCap" type="number" inputmode="numeric"
               value="${e&&e.balance_cap!==null?e.balance_cap:""}">
      </label>
      <label class="bo-field">
        <b>Заметка</b>
        <input class="seed-input" id="staffNote" maxlength="300" value="${e?o(e.note||""):""}">
      </label>
      <label class="bo-toggle">
        <input type="checkbox" id="staffActive" ${!e||e.active?"checked":""}>
        <span><b>Доступ включён</b><i>Выключенный сотрудник остаётся в списке, но в панель не входит</i></span>
      </label>
    </div>

    <h3 class="bo-subtitle">Поправки к роли</h3>
    <p class="game-sub">Слева выдать сверх роли, справа отобрать. Выдать можно
      только то, что есть у вас самих.</p>
    <div class="bo-perms">
      ${d.map(l=>`
        <div class="bo-perm-group">
          <div class="bo-group-name">${o(l.name)}</div>
          ${l.items.map(u=>`
            <div class="bo-perm ${t.grantable.includes(u.id)?"":"bo-off"}">
              <span><b>${o(u.label)}</b>${u.hint?`<i>${o(u.hint)}</i>`:""}</span>
              <label title="Выдать сверх роли">
                <input type="checkbox" data-extra="${u.id}" ${s.has(u.id)?"checked":""}
                       ${t.grantable.includes(u.id)?"":"disabled"}>+
              </label>
              <label title="Отобрать у роли">
                <input type="checkbox" data-denied="${u.id}" ${n.has(u.id)?"checked":""}>&minus;
              </label>
            </div>`).join("")}
        </div>`).join("")}
    </div>

    <div class="admin-actions">
      <button class="btn btn-primary" id="staffSave">${e?"Сохранить":"Добавить"}</button>
      ${e?'<button class="btn btn-outline" id="staffCancel">Отмена</button>':""}
    </div>
  `,a.querySelector("#staffSave").onclick=async()=>{let l={userKey:a.querySelector("#staffKey").value.trim(),role:a.querySelector("#staffRole").value,balanceCap:a.querySelector("#staffCap").value===""?null:Number(a.querySelector("#staffCap").value),note:a.querySelector("#staffNote").value,active:a.querySelector("#staffActive").checked,extra:[...a.querySelectorAll("[data-extra]:checked")].map(u=>u.dataset.extra),denied:[...a.querySelectorAll("[data-denied]:checked")].map(u=>u.dataset.denied)};if(!l.userKey){m("Укажите, кого добавляем");return}try{await p("/api/admin/staff/save",l),m("Сохранено"),v("success"),C()}catch(u){m(u.message),v("error")}},a.querySelector("#staffCancel")?.addEventListener("click",()=>N(null))}let H={credit:"Начисление",debit:"Списание",block:"Блокировка",unblock:"Разблокировка",voucher:"Выдан кейс",payout_paid:"Вывод выплачен",payout_rejected:"Вывод отклонён",payout_processing:"Вывод в работе",partner_payout:"Выплата партнёру",promo_save:"Промокод сохранён",promo_delete:"Промокод удалён",partner_save:"Партнёр сохранён",staff_add:"Сотрудник добавлен",staff_update:"Права изменены",staff_remove:"Сотрудник убран",settings:"Настройки",limits:"Лимиты",note_add:"Заметка",note_delete:"Заметка удалена",export:"Выгрузка"};async function Q(){let e=document.getElementById("admin-journal");e.innerHTML='<div class="empty">Загружаем...</div>';let t;try{t=await p("/api/admin/journal",{action:b.admin.journalAction||""})}catch(i){e.innerHTML=`<div class="empty">${o(i.message)}</div>`;return}let a=t.rows.map(i=>{let s=i.admin_username?"@"+i.admin_username:i.admin_name||"#"+i.admin_id,n=i.target_id?i.target_username?"@"+i.target_username:i.target_name||"#"+i.target_id:"",r="";if(i.meta)try{r=Object.entries(JSON.parse(i.meta)).map(([d,l])=>`${d}: ${typeof l=="object"&&l&&"before"in l?`${l.before} → ${l.after}`:JSON.stringify(l)}`).join(", ")}catch{r=""}return`<tr>
      <td>${f(i.created_at)}</td>
      <td>${o(s)}</td>
      <td>${o(H[i.action]||i.action)}</td>
      <td>${o(n)}</td>
      <td class="num ${i.amount>0?"plus":i.amount<0?"minus":""}">${i.amount?c(i.amount):""}</td>
      <td class="bo-sub">${o(i.note||"")}${r?`<br>${o(r)}`:""}</td>
    </tr>`});e.innerHTML=`
    <p class="game-sub">Всё, что сотрудники делают руками. Записи не правятся
      и не удаляются.</p>
    <div class="admin-tabs">
      <button class="tab ${b.admin.journalAction?"":"active"}" data-journal="">Все</button>
      ${t.actions.slice(0,10).map(i=>`<button class="tab
        ${b.admin.journalAction===i.action?"active":""}"
        data-journal="${o(i.action)}">${o(H[i.action]||i.action)} · ${i.n}</button>`).join("")}
    </div>
    ${x(["Когда","Кто","Что","Кому",{label:"Сумма",num:1},"Подробности"],a,"Пока ничего")}
    <p class="game-sub">Показано ${t.rows.length} из ${c(t.total)}.</p>
  `,e.querySelectorAll("[data-journal]").forEach(i=>{i.onclick=()=>{b.admin.journalAction=i.dataset.journal,Q()}})}async function Z(){let e=document.getElementById("funnelBody");e.innerHTML='<div class="empty">Считаем...</div>';let t;try{t=await p("/api/admin/funnel",{days:b.admin.funnelDays||7})}catch(n){e.innerHTML=`<div class="empty">${o(n.message)}</div>`;return}let a=t.funnel;if(!a.cohort){e.innerHTML='<div class="empty">За этот период новых игроков не было</div>';return}let i=a.steps.map((n,r)=>{let d=Math.max(1,Math.round(n.ofCohort*100)),l=r>0?a.steps[r-1].users-n.users:0;return`<div class="funnel-step">
      <div class="funnel-bar" style="width:${d}%"></div>
      <div class="funnel-head">
        <span class="funnel-title">${o(n.title)}</span>
        <span class="funnel-users">${c(n.users)}</span>
      </div>
      <div class="funnel-sub">
        ${w(n.ofCohort)} от всех${r>0?` · ${w(n.ofPrev)} от предыдущего`:""}
        ${l>0?`<span class="funnel-drop"> · потеряно ${c(l)}</span>`:""}
      </div>
    </div>`}).join(""),s=t.events.map(n=>`<tr>
      <td>${o(n.name)}</td>
      <td class="num">${c(n.total)}</td>
      <td class="num">${c(n.users)}</td>
    </tr>`).join("");e.innerHTML=`
    <div class="admin-kpis">
      <div class="kpi"><div class="kpi-label">Новых игроков</div>
        <div class="kpi-value">${c(a.cohort)}</div></div>
      <div class="kpi"><div class="kpi-label">Пополнений</div>
        <div class="kpi-value">${c(a.deposits)}</div></div>
      <div class="kpi"><div class="kpi-label">Внесено</div>
        <div class="kpi-value">${c(a.deposited)}</div></div>
      <div class="kpi"><div class="kpi-label">На игрока</div>
        <div class="kpi-value">${c(Math.round(a.arpu))}</div>
        <div class="kpi-sub">внесено / новых игроков</div></div>
    </div>

    <h2 class="section-title">Шаги</h2>
    ${i}

    <h2 class="section-title">Все события за период</h2>
    <table class="admin-table">
      <thead><tr><th>Событие</th><th class="num">Всего</th><th class="num">Игроков</th></tr></thead>
      <tbody>${s||'<tr><td colspan="3">Пока пусто</td></tr>'}</tbody>
    </table>
  `}document.querySelectorAll("[data-funnel-days]").forEach(e=>{e.addEventListener("click",()=>{b.admin.funnelDays=Number(e.dataset.funnelDays),document.querySelectorAll("[data-funnel-days]").forEach(t=>t.classList.remove("active")),e.classList.add("active"),Z()})});let ee=e=>e?new Date(e).toISOString().slice(0,10):"",te=(e,t)=>e?new Date(e+(t?"T23:59:59":"T00:00:00")).getTime():null;async function R(){let e;try{e=await p("/api/admin/promos")}catch(s){m(s.message);return}let t=[];try{t=(await p("/api/admin/partners")).rows}catch{}let a=document.getElementById("admin-promos");a.innerHTML=`
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
            ${e.cases.map(s=>`<option value="${s.id}">${o(s.name)} · ${c(s.price)}</option>`).join("")}
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
            ${t.map(s=>`<option value="${s.partner.id}">${o(s.partner.name||s.partner.email||s.partner.tg_id)}</option>`).join("")}
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
    ${e.rows.length?e.rows.map(ge).join(""):'<div class="empty">Пока пусто</div>'}
  `;let i=()=>{let s=document.getElementById("pmType").value;a.querySelectorAll("[data-when]").forEach(n=>{n.style.display=n.dataset.when===s?"":"none"})};document.getElementById("pmType").addEventListener("change",i),i(),document.getElementById("pmSave").addEventListener("click",fe),a.querySelectorAll("[data-promo-edit]").forEach(s=>{s.addEventListener("click",()=>he(e.rows.find(n=>n.id===Number(s.dataset.promoEdit))))}),a.querySelectorAll("[data-promo-del]").forEach(s=>{s.addEventListener("click",async()=>{try{let n=await p("/api/admin/promo/delete",{id:Number(s.dataset.promoDel)});m(n.disabled?"Код отключён (по нему были активации)":"Код удалён"),R()}catch(n){m(n.message)}})})}function ge(e){let t=[];return e.type==="balance"&&t.push(`+${c(e.amount)} на баланс`),e.type==="deposit_pct"&&(t.push(`+${e.pct}% к пополнению`),e.min_deposit&&t.push(`от ${c(e.min_deposit)}`),e.max_bonus&&t.push(`макс ${c(e.max_bonus)}`)),e.type==="free_case"&&t.push(`кейс ${o(e.case_id)} ×${e.case_count}`),e.wager_multiplier&&t.push(`отыгрыш ×${e.wager_multiplier}`),t.push(`активаций ${e.used_count}${e.max_uses?" из "+e.max_uses:""}`),e.per_user_limit&&t.push(`на игрока ${e.per_user_limit}`),e.new_players_only&&t.push("только новым"),e.expires_at&&t.push(`до ${new Date(e.expires_at).toLocaleDateString("ru-RU")}`),(e.partner_name||e.partner_tg)&&t.push(`партнёр: ${o(e.partner_name||e.partner_tg)}`),`<div class="promo-row ${e.is_active?"":"off"}">
    <div>
      <div class="promo-code">${o(e.code)}</div>
      <div class="promo-meta">${t.join(" · ")}</div>
    </div>
    <div class="promo-actions">
      <button class="btn btn-outline btn-sm" data-promo-edit="${e.id}">Изм.</button>
      <button class="btn btn-outline btn-sm" data-promo-del="${e.id}">×</button>
    </div>
  </div>`}function he(e){if(!e)return;let t=(a,i)=>{let s=document.getElementById(a);s&&(s.value=i)};t("pmCode",e.code),t("pmType",e.type),t("pmAmount",e.amount),t("pmPct",e.pct),t("pmMaxBonus",e.max_bonus),t("pmMinDep",e.min_deposit),e.case_id&&t("pmCase",e.case_id),t("pmCaseCount",e.case_count),t("pmWager",e.wager_multiplier),t("pmMaxUses",e.max_uses),t("pmPerUser",e.per_user_limit),t("pmPartner",e.partner_id||""),t("pmFrom",ee(e.starts_at)),t("pmTo",ee(e.expires_at)),t("pmNote",e.note||""),document.getElementById("pmNewOnly").checked=!!e.new_players_only,document.getElementById("pmType").dispatchEvent(new Event("change")),document.getElementById("admin-promos").scrollIntoView({behavior:"smooth"})}async function fe(){let e=t=>document.getElementById(t)?.value;try{let t=await p("/api/admin/promo/save",{code:e("pmCode"),type:e("pmType"),amount:e("pmAmount"),pct:e("pmPct"),max_bonus:e("pmMaxBonus"),min_deposit:e("pmMinDep"),case_id:e("pmCase"),case_count:e("pmCaseCount"),wager_multiplier:e("pmWager"),max_uses:e("pmMaxUses"),per_user_limit:e("pmPerUser"),partner_id:e("pmPartner")||null,starts_at:te(e("pmFrom"),!1),expires_at:te(e("pmTo"),!0),new_players_only:document.getElementById("pmNewOnly").checked,note:e("pmNote")});m(t.created?`Промокод ${t.code} создан`:`Промокод ${t.code} обновлён`),v("success"),R()}catch(t){m(t.message),v("error")}}async function ae(){let e;try{e=await p("/api/admin/partners")}catch(a){m(a.message);return}let t=document.getElementById("admin-partners");t.innerHTML=`
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
    ${e.rows.length?e.rows.map(a=>`<div class="promo-row ${a.status==="active"?"":"off"}">
        <div>
          <div class="promo-code">${o(a.name||"Партнёр")}</div>
          <div class="promo-meta">#${a.id} · ${o(a.email||"")} · доля ${a.share}% · игроков ${c(a.total.signups)}</div>
        </div>
        <div style="text-align:right">
          <div class="promo-code">${y(a.balance.available)}</div>
          <div class="promo-meta">к выводу</div>
        </div>
      </div>`).join(""):'<div class="empty">Пока пусто</div>'}
  `,document.getElementById("ptSave").addEventListener("click",async()=>{try{await p("/api/admin/partner/save",{userKey:document.getElementById("ptTg").value,share_pct:document.getElementById("ptShare").value,name:document.getElementById("ptName").value}),m("Партнёр сохранён"),v("success"),ae()}catch(a){m(a.message),v("error")}})}let ke={opened:"отправлено, ждёт обработки",in_progress:"в обработке у шлюза",completed:"выплачено",cancelled:"отменено шлюзом",error:"ошибка",unclaimed:"отозвано"};async function we(){let e=b.admin.sicilia;if(e&&Date.now()-e.at<5*6e4)return e;try{b.admin.sicilia={at:Date.now(),...await p("/api/admin/sicilia")}}catch{b.admin.sicilia={at:Date.now(),configured:!1,banks:[]}}return b.admin.sicilia}function _e(e,t,a){let i=t[e.id],s=i?`<div class="payout-comment">Sicilia: ${o(ke[i.status]||i.status)}${i.error?` - ${o(i.error)}`:""}${i.checkUrl?` · <a href="${o(i.checkUrl)}" target="_blank" rel="noopener">чек</a>`:""}</div>
    <div class="dep-ids">${I("Наш номер",i.invid)}${i.gatewayId?I("Номер Sicilia",i.gatewayId):""}</div>`:"",n=i&&["cancelled","error","unclaimed"].includes(i.status),r=a.configured&&i&&e.status==="processing"?`<div class="admin-actions">
    ${["opened","in_progress"].includes(i.status)?`<button class="btn btn-outline btn-sm" data-sic-recall="${e.id}">Отозвать из Sicilia</button>`:""}
    ${n?`<button class="btn btn-outline btn-sm" data-sic-release="${e.id}">Вернуть в ожидание</button>`:""}
  </div>`:"";if(!(a.configured&&(e.method==="sbp"||e.method==="card")&&(e.status==="pending"||e.status==="processing")&&(!i||n)))return s+r;let l=a.banks.map(u=>`<option value="${o(u.code)}"${u.code===e.gatewayBank?" selected":""}>${o(u.name)}</option>`).join("");return`${s}${r}<div class="admin-actions sicilia-send">
    <select class="seed-input" data-sic-bank="${e.id}"><option value="">Банк получателя…</option>${l}</select>
    <button class="btn btn-outline" data-sic-pay="${e.id}" data-amount="${e.amount}">Выплатить через Sicilia</button>
  </div>`}function Se(e){let t=e.check;if(!t)return"";let a=t.verdict==="green",i=a?"Математика сходится, источники денег подтверждены":o((t.reasons||[]).join(" · ")),s=t.override?`<div class="risk-override">Подтверждено сотрудником: «${o(t.override.comment)}»</div>`:"";return`<div class="risk-plate ${a?"risk-green":"risk-red"}">
      <span class="risk-dot" aria-hidden="true"></span>
      <div class="risk-text"><b>${a?"Проверено системой":"Есть подозрения"}</b><small>${i}</small></div>
      <button class="risk-more" data-risk-open="${e.id}" type="button">Подробнее</button>
    </div>
    ${s}
    <div class="risk-details" data-risk-details="${e.id}" hidden></div>`}function Ee(e){let t=e.summary||{};return`<ul class="risk-list">${e.checks.map(i=>`<li class="${i.ok?"ok":i.level==="info"?"info":"bad"}">
      <span>${i.ok?"✓":i.level==="info"?"i":"✗"}</span>
      <div><b>${o(i.title)}</b><small>${o(i.detail||"")}</small></div></li>`).join("")}</ul>
    <div class="risk-summary">Пополнил ${y(t.deposited||0)} · выплачено ${y(t.paidOut||0)} ·
      итог игр ${y(t.gamesNet||0)} · раундов ${c(t.rounds||0)} · лучший выигрыш ${y(t.bestWin||0)} ·
      аккаунту ${c(t.accountAgeDays||0)} дн. · проверено ${new Date(e.checkedAt).toLocaleString("ru-RU")}</div>
    <button class="btn btn-outline btn-sm" data-risk-recheck="${e.payoutId||""}" type="button">Перепроверить</button>`}async function S(){let e;try{e=await p("/api/admin/payouts",{status:b.admin.payoutStatus||"pending"})}catch(d){m(d.message);return}let t=e.siciliaReady?await we():{configured:!1,banks:[]},a=document.getElementById("payoutAdminList"),i=e.stats,s=`<div class="admin-kpis">
    <div class="kpi"><div class="kpi-label">Ожидают решения</div>
      <div class="kpi-value">${c(i.pendingCount)}</div>
      <div class="kpi-sub">на ${y(i.pendingSum)}</div></div>
    <div class="kpi"><div class="kpi-label">Выплачено всего</div>
      <div class="kpi-value minus">${y(i.paidSum)}</div></div>
    <div class="kpi"><div class="kpi-label">В работе</div>
      <div class="kpi-value">${c(i.processingCount)}</div>
      <div class="kpi-sub">на ${y(i.processingSum)}</div></div>
    ${t.configured?`<div class="kpi"><div class="kpi-label">Баланс Sicilia</div>
      <div class="kpi-value">${t.balance?y(Math.floor(t.balance.balance)):"-"}</div>
      <div class="kpi-sub">${t.balance?`заморожено ${y(Math.floor(t.balance.frozen_balance||0))}`:o(t.balanceError||"")}</div></div>`:""}
  </div>`;if(!e.rows.length){a.innerHTML=s+'<div class="empty">Заявок нет</div>'+B(),D(a);return}a.innerHTML=s+e.rows.map(d=>{let l=d.username?"@"+d.username:d.first_name||"#"+d.user_id;return`<div class="payout-row admin ${d.status}">
      <div class="payout-head">
        <b>${y(d.amount)}${d.requested_amount?` <small class="dep-fact">из ${y(d.requested_amount)}</small>`:""}</b>
        <span class="payout-status ${d.status}">${ie[d.status]||d.status}</span>
      </div>
      <div class="payout-date">${o(l)} · ${o(T(d,d.user_id))} ·
        баланс ${y(d.balance)} · ${new Date(d.created_at).toLocaleString("ru-RU")}</div>
      <div class="payout-requisites">${de(d,{full:!0})}</div>
      ${Se(d)}
      ${d.comment?`<div class="payout-comment">${o(d.comment)}</div>`:""}
      ${d.check&&d.check.verdict==="red"&&!d.check.override&&["pending","processing"].includes(d.status)?`
        <textarea class="seed-input risk-note" data-risk-note="${d.id}" rows="2"
          placeholder="Почему заявку можно выплатить: что проверено вручную"></textarea>
        <div class="admin-actions">
          <button class="btn btn-primary" data-risk-ok="${d.id}">Подтвердить заявку</button>
          <button class="btn btn-outline" data-resolve="rejected" data-id="${d.id}">Отклонить</button>
        </div>
        <input class="seed-input payout-note" data-note="${d.id}" placeholder="комментарий игроку (при отклонении)">`:`
      ${_e(d,e.gateway||{},t)}
      ${d.status==="pending"?`
        <input class="seed-input payout-note" data-note="${d.id}" placeholder="комментарий игроку">
        <div class="admin-actions">
          <button class="btn btn-primary" data-resolve="processing" data-id="${d.id}">Взять в работу</button>
          <button class="btn btn-outline" data-resolve="rejected" data-id="${d.id}">Отклонить</button>
        </div>`:d.status==="processing"?`
        <input class="seed-input payout-note" data-note="${d.id}" placeholder="комментарий игроку">
        <div class="admin-actions">
          <button class="btn btn-primary" data-resolve="paid" data-id="${d.id}">Выполнено</button>
        </div>`:""}`}
    </div>`}).join(""),a.insertAdjacentHTML("beforeend",B()),D(a),X(a);let n=async(d,l=!1)=>{let u=a.querySelector(`[data-risk-details="${d}"]`);if(u){u.hidden=!1,u.innerHTML='<span class="skel skel-line"></span>';try{let{check:$}=await p("/api/admin/payout/check",{id:d,recheck:l});u.innerHTML=Ee({...$,payoutId:d}),u.querySelector("[data-risk-recheck]")?.addEventListener("click",async()=>{await n(d,!0),S()})}catch($){u.innerHTML=`<div class="empty">${o($.message)}</div>`}}};a.querySelectorAll("[data-risk-open]").forEach(d=>d.addEventListener("click",()=>{let l=Number(d.dataset.riskOpen),u=a.querySelector(`[data-risk-details="${l}"]`);if(u&&!u.hidden){u.hidden=!0;return}n(l)})),a.querySelectorAll("[data-risk-ok]").forEach(d=>d.addEventListener("click",async()=>{let l=Number(d.dataset.riskOk),u=a.querySelector(`[data-risk-note="${l}"]`)?.value||"";try{await p("/api/admin/payout/override",{id:l,comment:u}),m("Заявка подтверждена, решение записано в журнал"),v("success"),S()}catch($){m($.message),v("error")}}));let r=(d,l,u)=>a.querySelectorAll(`[${d}]`).forEach($=>$.addEventListener("click",()=>L($,async()=>{try{let E=await p(l,{id:Number($.getAttribute(d))});m(u(E)),v("success")}catch(E){m(E.message),v("error")}S()})));r("data-sic-recall","/api/admin/sicilia/payout/recall",d=>d.payoutStatus==="pending"?"Выплата отозвана, заявка снова ждёт решения":"Запрос на отзыв отправлен"),r("data-sic-release","/api/admin/sicilia/payout/release",()=>"Заявка снова ждёт решения"),a.querySelectorAll("[data-sic-pay]").forEach(d=>{a.querySelector(`[data-sic-bank="${d.dataset.sicPay}"]`)?.addEventListener("change",()=>{d.dataset.armed="",d.textContent="Выплатить через Sicilia",d.classList.replace("btn-primary","btn-outline")}),d.addEventListener("click",async()=>{let l=Number(d.dataset.sicPay),u=a.querySelector(`[data-sic-bank="${l}"]`),$=u?.value||"";if(!$){m("Выберите банк получателя");return}if(d.dataset.armed!=="1"){d.dataset.armed="1",d.textContent=`Подтвердить: ${y(Number(d.dataset.amount))} · ${u.selectedOptions[0].textContent}`,d.classList.replace("btn-outline","btn-primary");return}d.disabled=!0;try{await p("/api/admin/sicilia/payout",{id:l,bank:$}),m("Выплата отправлена в Sicilia"),v("success")}catch(E){m(E.message),v("error")}S()})}),a.querySelectorAll("[data-resolve]").forEach(d=>{d.addEventListener("click",async()=>{let l=Number(d.dataset.id),u=a.querySelector(`[data-note="${l}"]`)?.value||"",$=d.dataset.resolve;if($==="rejected"&&!u.trim()){m("Укажите причину отклонения - игрок её увидит");return}await L(d,async()=>{try{await p("/api/admin/payout/resolve",{id:l,status:$,comment:u}),m($==="paid"?"Заявка выполнена":$==="processing"?"Заявка поставлена в работу":"Заявка отклонена, средства возвращены"),v("success"),S()}catch(E){m(E.message),v("error")}})})})}return document.querySelectorAll("[data-payout-status]").forEach(e=>{e.addEventListener("click",()=>{b.admin.payoutStatus=e.dataset.payoutStatus,document.querySelectorAll("[data-payout-status]").forEach(t=>t.classList.remove("active")),e.classList.add("active"),S()})}),document.getElementById("adminSearchBtn").addEventListener("click",()=>{b.admin.query=document.getElementById("adminSearch").value.trim(),j()}),{initAdminPanel:q,renderAdminGate:W}}export{Le as createAdminUI};
