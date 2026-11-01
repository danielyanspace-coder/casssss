var T=b=>new Promise(h=>setTimeout(h,b));var Pt={menu:"M4 7h16M4 12h16M4 17h16",sound:"M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z",mute:"M4 9v6h4l5 4V5L8 9H4zm11 1 5 5m0-5-5 5",full:"M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",info:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5v1m0 3v5",table:"M4 5h16v14H4zM4 10h16M4 15h16M10 5v14",clock:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 2",gear:"M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8 3-2 .5-.6 1.5 1 1.8-1.6 1.6-1.8-1-1.5.6L13 19h-2l-.5-2-1.5-.6-1.8 1-1.6-1.6 1-1.8L6 12.5 4 12v-2l2-.5.6-1.5-1-1.8 1.6-1.6 1.8 1L10.5 5 11 3h2l.5 2 1.5.6 1.8-1 1.6 1.6-1 1.8.6 1.5 2 .5z",gift:"M4 11h16v9H4zM3 7h18v4H3zm9 0v13M12 7S9 3 7 4.5 8.5 7 12 7zm0 0s3-4 5-2.5S15.5 7 12 7z",music:"M9 18V5l10-2v13M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z",spark:"M12 3v4m0 10v4M3 12h4m10 0h4M6 6l3 3m6 6 3 3M18 6l-3 3M9 15l-3 3",close:"M6 6l12 12M18 6 6 18",minus:"M6 12h12",plus:"M12 6v12M6 12h12",play:"M8 5l11 7-11 7z",stop:"M7 7h10v10H7z",back:"M15 5l-7 7 7 7",alert:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9l6 6m0-6-6 6"},o=(b,h="sl-ico")=>`<svg class="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
     <path d="${Pt[b]}"></path></svg>`,gt="luckybox.slot.settings",N={sound:!0,animation:!0,fast:!1};function jt(){try{let b=localStorage.getItem(gt);return b?{...N,...JSON.parse(b)}:{...N}}catch{return{...N}}}function K(b){try{localStorage.setItem(gt,JSON.stringify(b))}catch{}}function zt(b){let{api:h,esc:p,fmt:$,money:d,toast:S,haptic:v,state:u,sounds:ht={}}=b,e={cards:[],slot:null,bet:100,busy:!1,auto:0,free:null,history:[],spinNo:0,settings:jt(),reels:[],lastAnswer:null},vt={buttonClick:"tick",spinStart:"bet",reelSpin:null,reelStop:"land",win:"collect",bigWin:"bigWin",scatter:"reveal",bonus:"bigWin"};function f(t){if(!e.settings.sound)return;let s=vt[t];if(s)try{ht[s]?.()}catch{}}let w=()=>document.getElementById("slotRoot"),Y=()=>document.getElementById("slotShelf"),L={list:()=>h("/api/slots",{}),describe:t=>h("/api/slot",{slotId:t}),getSpinResult:(t,s)=>h("/api/slot/spin",{slotId:t,bet:s}),getFreeSpinResult:t=>h("/api/slot/free",{slotId:t}),buyBonus:(t,s)=>h("/api/slot/buy",{slotId:t,bet:s})};function yt(){return`
      <div class="game-head">
        <h1 class="game-title">СЛОТЫ</h1>
        <p class="game-sub">Пять барабанов, двадцать линий, бесплатные вращения
          и четыре джекпота. Отдача ${(e.cards[0]?.rtp*100||94).toFixed(0)}%.</p>
      </div>
      <div class="sl-shelf">
        ${e.cards.map(t=>`
          <button class="sl-card" data-slot="${p(t.id)}" data-theme="${p(t.theme)}">
            <img class="sl-card-cover" src="${t.cover}" alt="" loading="lazy">
            <span class="sl-card-body">
              <span class="sl-card-name">${p(t.name)}</span>
              <span class="sl-card-tag">${p(t.tagline)}</span>
              <span class="sl-card-blurb">${p(t.blurb)}</span>
              <span class="sl-card-facts">
                <span>${t.lines} линий</span>
                <span>Отдача ${(t.rtp*100).toFixed(0)}%</span>
                <span>Джекпот ${$(t.topJackpot)} ₽</span>
              </span>
            </span>
          </button>`).join("")}
      </div>`}async function Q(){let t=Y();if(!t)return;if(!e.cards.length)try{e.cards=(await L.list()).slots}catch(n){S(n.message);return}t.innerHTML=yt(),t.hidden=!1;let s=w();s&&(s.hidden=!0,s.innerHTML=""),t.querySelectorAll("[data-slot]").forEach(n=>{n.addEventListener("click",()=>{f("buttonClick"),v("light"),bt(n.dataset.slot)})})}let X=t=>e.slot.art.symbols[t]||"";function F(t,s="sl-sym"){return`<img class="${s}" src="${X(t)}" alt="" draggable="false">`}function $t(){return e.slot.jackpots.map(t=>`
      <div class="sl-jp sl-jp-${t.id}">
        <span class="sl-jp-name">${t.name}</span>
        <span class="sl-jp-sum">${d(t.amount)}</span>
      </div>`).join("")}function wt(t){return`<div class="sl-reel" data-reel="${t}">
      <div class="sl-strip">
        ${Array.from({length:8},()=>'<div class="sl-cell"><img class="sl-sym" alt="" draggable="false"></div>').join("")}
      </div>
    </div>`}function Mt(){let t=w();if(!t||!e.slot)return;let s=e.slot;t.innerHTML=`
      <div class="sl-stage" id="slotStage" data-theme="${p(s.theme)}" data-slot-id="${p(s.id)}">
        <div class="sl-bg"></div>

        <div class="sl-top">
          <button class="sl-back" data-act="shelf">${o("back")}<span>Слоты</span></button>
          <img class="sl-logo" src="${s.art.logo}" alt="${p(s.name)}">
          <div class="sl-jackpots">${$t()}</div>
          <div class="sl-bonus-badge" id="slotBonusBadge" hidden>
            <span class="sl-bonus-title">БЕСПЛАТНЫЕ ВРАЩЕНИЯ</span>
            <span class="sl-bonus-left" id="slotBonusLeft"></span>
          </div>
        </div>

        <div class="sl-rail">
          <button class="sl-round" data-act="menu" aria-label="Меню">${o("menu")}</button>
          <button class="sl-round" data-act="sound" id="slotSound" aria-label="Звук">${o("sound")}</button>
          <button class="sl-round" data-act="full" aria-label="Во весь экран">${o("full")}</button>
        </div>

        <div class="sl-main">
          <div class="sl-machine">
            <div class="sl-frame"></div>
            <div class="sl-reels" id="slotReels">
              ${Array.from({length:s.reels},(n,l)=>wt(l)).join("")}
              <svg class="sl-lines" id="slotLines" viewBox="0 0 100 60" preserveAspectRatio="none"></svg>
            </div>
            <div class="sl-linetag" id="slotLineTag" hidden></div>
          </div>

          <div class="sl-panel">
            <div class="sl-balance">
              <span class="sl-label">БАЛАНС</span>
              <span class="sl-value" id="slotBalance">${d((u.user?.activeWallet==="bonus"?u.user?.bonusBalance:u.user?.balance)||0)}</span>
            </div>

            <div class="sl-bet">
              <button class="sl-round sl-bet-btn" data-act="bet-down" aria-label="Уменьшить ставку">${o("minus")}</button>
              <button class="sl-bet-box" data-act="bet-pick">
                <span class="sl-label">СТАВКА</span>
                <span class="sl-value" id="slotBet">${d(e.bet)}</span>
              </button>
              <button class="sl-round sl-bet-btn" data-act="bet-up" aria-label="Увеличить ставку">${o("plus")}</button>
            </div>

            <button class="sl-btn sl-btn-max" data-act="max">МАКС<br>СТАВКА</button>

            <button class="sl-spin" id="slotSpin" aria-label="Крутить">
              <img src="${s.art.spin}" alt="">
              <span class="sl-spin-count" id="slotSpinCount"></span>
            </button>

            <button class="sl-btn sl-btn-auto" data-act="auto">АВТО<br><span id="slotAutoMark">ВЫКЛ</span></button>
            <button class="sl-btn sl-btn-buy" data-act="buy">${o("gift","sl-ico sl-ico-gift")}<span>КУПИТЬ<br>БОНУС</span></button>
          </div>

          <div class="sl-win" id="slotWin" hidden>
            <span class="sl-label">ВЫИГРЫШ</span>
            <span class="sl-win-sum" id="slotWinSum">0 ₽</span>
          </div>

          <div class="sl-tools">
            <button class="sl-round" data-act="paytable" aria-label="Таблица выплат">${o("table")}</button>
            <button class="sl-round" data-act="history" aria-label="История">${o("clock")}</button>
            <button class="sl-round" data-act="settings" aria-label="Настройки">${o("gear")}</button>
          </div>
        </div>

        <aside class="sl-side">
          <div class="sl-card-panel">
            <div class="sl-panel-head">ТАБЛИЦА ВЫПЛАТ</div>
            ${tt()}
          </div>
          <div class="sl-card-panel">
            <div class="sl-panel-head">${o("clock","sl-ico sl-ico-sm")} ИСТОРИЯ</div>
            <div class="sl-history-list" id="slotHistory">${W()}</div>
          </div>
        </aside>

        <div class="sl-banner" id="slotBanner" hidden></div>
      </div>

      <div class="sl-modal" id="slotModal" hidden>
        <div class="sl-modal-box">
          <button class="sl-modal-close" data-act="modal-close" aria-label="Закрыть">${o("close")}</button>
          <div class="sl-modal-body" id="slotModalBody"></div>
        </div>
      </div>`,Nt(),H(),A(),y(),B()}function Z(){let t=e.slot.lines.length;return e.slot.payUnit==="total"?"Выплаты указаны в ОБЩИХ ставках: «5 - 100x» это сто ваших ставок.":`Выплаты указаны в ставках НА ЛИНИЮ. Линий ${t}, ставка на линию
         равна общей, делённой на ${t}.`}function tt(){let t=e.slot.symbols.map(l=>`
      <div class="sl-pay">
        ${F(l.id,"sl-pay-img")}
        <div class="sl-pay-nums">
          <span>5 - ${$(l.shown[2])}x</span>
          <span>4 - ${$(l.shown[1])}x</span>
          <span>3 - ${$(l.shown[0])}x</span>
        </div>
      </div>`).join(""),s=Object.entries(e.slot.scatterPays).map(([l,a])=>`${l} - ${a}x ставки`).join(", "),n=e.slot.freeMultiplier>1?` Во время бонуса выигрыши по линиям умножаются на ${e.slot.freeMultiplier}.`:"";return`
      <div class="sl-pay-grid">${t}</div>
      <div class="sl-pay-special">
        <div class="sl-pay">
          ${F("wild","sl-pay-img")}
          <div class="sl-pay-text"><b>WILD</b><br>Заменяет все символы, кроме SCATTER.
            Не выпадает на первом и пятом барабане.</div>
        </div>
        <div class="sl-pay">
          ${F("scatter","sl-pay-img")}
          <div class="sl-pay-text"><b>SCATTER</b><br>3 и больше в любом месте:
            ${e.slot.freeSpins} бесплатных вращений. Платит ${p(s)}.</div>
        </div>
      </div>
      <p class="sl-pay-note">${Z()} Линии считаются слева направо от
        первого барабана.${n} Отдача игры ${(e.slot.rtp*100).toFixed(0)}%.</p>`}function W(){return e.history.length?e.history.map(t=>`
      <div class="sl-history-row">
        <span class="sl-h-id">#${t.id}</span>
        <span class="sl-h-bet">${$(t.bet)} ₽</span>
        <span class="sl-h-win ${t.win>0?"is-win":""}">${t.win>0?"+":""}${$(t.win)} ₽</span>
        <span class="sl-h-time">${t.time}</span>
      </div>`).join(""):'<div class="sl-history-empty">Прокрутов ещё не было</div>'}function x(t,s){e.spinNo++;let n=new Date;e.history.unshift({id:e.spinNo,bet:t,win:s,time:`${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`}),e.history=e.history.slice(0,40);let l=document.getElementById("slotHistory");l&&(l.innerHTML=W())}function H(){let t=w()?.querySelectorAll(".sl-reel");t?.length&&(e.reels=Array.from(t).map((s,n)=>{let l=s.querySelector(".sl-strip"),a=l.firstElementChild?.getBoundingClientRect().height||0,c=e.reels[n],r=c&&c.el===s?c:{el:s,pos:c?.pos??0,expanded:!1};return Object.assign(r,{strip:l,cells:Array.from(l.children),cell:a,index:n,length:e.slot.strips[n].length,base:null})}),e.reels.forEach(I))}function I(t){let s=Math.floor(t.pos),n=t.pos-s;if(s!==t.base){t.base=s;let l=e.slot.strips[t.index],a=t.length;for(let c=0;c<t.cells.length;c++){let r=t.expanded&&c<e.slot.rows?"wild":l[((s+c)%a+a)%a],i=t.cells[c];i.dataset.sym!==r&&(i.dataset.sym=r,i.firstElementChild.src=X(r))}}t.strip.style.transform=`translate3d(0, ${-n*t.cell}px, 0)`}function st(t){e.reels.forEach((s,n)=>{s.pos=t[n]%s.length,s.base=null,I(s)})}let et=t=>1-Math.pow(1-t,3);function St(t,s,n,l){return new Promise(a=>{let c=performance.now()+l,r=t.length,i=t.pos,E=i-(2+Math.random()*.4)*r,M=s-Math.ceil((s-E)/r)*r,Rt=.32;function J(mt){if(mt<c){requestAnimationFrame(J);return}let C=Math.min(1,(mt-c)/n),_t=C>.86?Math.sin((C-.86)/.14*Math.PI)*Rt:0;if(t.pos=i+(M-i)*et(C)-_t,I(t),C<1){requestAnimationFrame(J);return}t.pos=(s%r+r)%r,t.base=null,I(t),a()}requestAnimationFrame(J)})}let nt=["#ffd45e","#5ee0ff","#ff8ad4","#9dff74","#ffb3f0"];function R(){w()?.querySelectorAll(".sl-cell.is-win, .sl-cell.is-scatter").forEach(n=>n.classList.remove("is-win","is-scatter"));let t=document.getElementById("slotLines");t&&(t.innerHTML="");let s=document.getElementById("slotLineTag");s&&(s.hidden=!0)}function _(t,s){return e.reels[t]?.cells[s]||null}function lt(t,s){let n=document.getElementById("slotLines");if(!n)return;let l=t.cells.map(([a,c])=>{let r=(a+.5)/e.slot.reels*100,i=(c+.5)/e.slot.rows*60;return`${r.toFixed(2)},${i.toFixed(2)}`}).join(" ");n.insertAdjacentHTML("beforeend",`<polyline points="${l}" fill="none" stroke="${s}" stroke-width="0.9"
         stroke-linecap="round" stroke-linejoin="round" class="sl-line"></polyline>`)}function at(t){let s=document.getElementById("slotLineTag");s&&(s.textContent=t,s.hidden=!1)}async function it(t){if(R(),t.scatters>=3){for(let s=0;s<e.slot.reels;s++)for(let n=0;n<e.slot.rows;n++){let l=_(s,n);l?.dataset.sym==="scatter"&&l.classList.add("is-scatter")}f("scatter")}if(t.wins.length)if(t.wins.forEach((s,n)=>{lt(s,nt[n%nt.length]),s.cells.forEach(([l,a])=>_(l,a)?.classList.add("is-win"))}),t.wins.length>1&&e.settings.animation&&!e.settings.fast){await T(1e3);for(let s of t.wins)R(),lt(s,"#ffd45e"),s.cells.forEach(([n,l])=>_(n,l)?.classList.add("is-win")),at(`Линия ${s.line+1} - ${d(s.payout)}`),await T(620)}else t.wins.length===1&&at(`Линия ${t.wins[0].line+1} - ${d(t.wins[0].payout)}`)}async function P(t,s=900){let n=document.getElementById("slotWin"),l=document.getElementById("slotWinSum");if(!n||!l)return;if(t<=0){n.hidden=!0;return}if(n.hidden=!1,!e.settings.animation){l.textContent=d(t);return}let a=e.settings.fast?s*.35:s,c=performance.now();await new Promise(r=>{function i(E){let M=Math.min(1,(E-c)/a);l.textContent=d(Math.round(t*et(M))),M<1?requestAnimationFrame(i):r()}requestAnimationFrame(i)})}async function Ot(t,s,n,l=1800){let a=document.getElementById("slotBanner");a&&(a.className=`sl-banner ${n}`,a.innerHTML=`<div class="sl-banner-title">${p(t)}</div>
                    <div class="sl-banner-sub">${p(s)}</div>`,a.hidden=!1,await T(e.settings.fast?l*.35:l),a.hidden=!0)}function Bt(t,s){let n=t/s;return n>=50?{title:"MEGA WIN",cls:"is-mega"}:n>=20?{title:"BIG WIN",cls:"is-big"}:null}function j(t,s){return new Promise(n=>{m(`
        <div class="sl-bigwin ${t==="MEGA WIN"?"is-mega":""}">
          <div class="sl-bigwin-title">${p(t)}</div>
          <div class="sl-bigwin-sum">${d(s)}</div>
          <button class="sl-gold-btn" data-act="modal-close">ПРОДОЛЖИТЬ</button>
        </div>`,{onClose:n}),setTimeout(()=>{rt()&&g()},4e3)})}function B(){let t=document.getElementById("slotBonusBadge"),s=document.getElementById("slotBonusLeft"),n=document.getElementById("slotSpinCount");t&&(t.hidden=!e.free,s&&e.free&&(s.textContent=`Осталось ${e.free.spinsLeft}`),n&&(n.textContent=e.free?e.free.spinsLeft:""),document.getElementById("slotStage")?.classList.toggle("is-bonus",!!e.free))}async function O(){let t=0;for(;e.free&&e.free.spinsLeft>0;){let s;try{s=await L.getFreeSpinResult(e.slot.id)}catch(n){S(n.message);break}e.free.spinsLeft=s.spinsLeft,t=s.sessionWin,B(),await ot(s,{free:!0}),s.payout>0&&(f("win"),await P(s.payout,700)),z(s),await T(e.settings.fast?160:420)}e.free=null,B(),e.reels.forEach(s=>{s.expanded=!1,s.base=null,I(s)}),t>0&&(x(0,t),await j("БОНУС ЗАВЕРШЁН",t))}function z(t){t.user&&b.onUser?.(t.user);let s=document.getElementById("slotBalance");s&&(s.textContent=d((t.user?.activeWallet==="bonus"?t.user?.bonusBalance:t.user?.balance)??t.balance??0))}async function ot(t,{free:s=!1}={}){R();let n=document.getElementById("slotWin");if(n&&(n.hidden=!0),f("spinStart"),e.reels.forEach((i,E)=>{i.expanded=s&&t.grid[E].every(M=>M==="wild"),i.el.classList.toggle("is-expanded",i.expanded),i.base=null}),!e.settings.animation){st(t.offsets),await it(t);return}let l=e.settings.fast?640*.35:640,a=e.settings.fast?140*.35:140,c=[],r=0;for(let i=0;i<e.reels.length;i++)i===e.slot.reels-1&&!e.settings.fast&&t.grid.slice(0,i).flat().filter(M=>M==="scatter").length>=2&&(r+=900,e.reels[i].el.classList.add("is-anticipating")),c.push(St(e.reels[i],t.offsets[i],l,i*a+r).then(()=>{e.reels[i].el.classList.remove("is-anticipating"),f("reelStop")}));await Promise.all(c),await it(t)}async function q(){if(e.busy||!e.slot)return;if(e.free){S("Идут бесплатные вращения");return}if(((u.user?.activeWallet==="bonus"?u.user?.bonusBalance:u.user?.balance)??0)<e.bet){e.auto=0,y(),k();return}e.busy=!0,U(!0);let t;try{t=await L.getSpinResult(e.slot.id,e.bet)}catch(s){e.busy=!1,e.auto=0,y(),U(!1),/INSUFFICIENT|Не хватает/.test(String(s.message))?k():S(s.message);return}if(e.lastAnswer=t,await ot(t),z(t),x(e.bet,t.payout),t.payout>0){let s=Bt(t.payout,e.bet);s?(f("bigWin"),v("success"),await P(t.payout,600),await j(s.title,t.payout)):(f("win"),await P(t.payout))}t.jackpot&&(f("bigWin"),v("success"),x(0,t.jackpot.amount),await j(`JACKPOT ${t.jackpot.name}`,t.jackpot.amount)),t.freeSpins>0&&(e.auto=0,y(),e.free={spinsLeft:t.freeSpins,lineBet:t.lineBet},B(),f("bonus"),v("success"),await V(t.freeSpins),await O()),e.busy=!1,U(!1),e.auto!==0&&!e.free&&(e.auto>0&&e.auto--,y(),e.auto!==0&&(await T(e.settings.fast?120:380),q()))}function U(t){let s=document.getElementById("slotSpin");s&&(s.classList.toggle("is-spinning",t),s.disabled=t)}function G(t){let s=e.slot.bets;e.bet=s.includes(t)?t:s[0];let n=document.getElementById("slotBet");n&&(n.textContent=d(e.bet))}function ct(t){let s=e.slot.bets,n=s.indexOf(e.bet);G(s[Math.min(s.length-1,Math.max(0,n+t))]),f("buttonClick"),v("light")}function Et(){let t=(u.user?.activeWallet==="bonus"?u.user?.bonusBalance:u.user?.balance)??0,s=e.slot.bets.filter(n=>n<=t);G(s.length?s[s.length-1]:e.slot.bets[0]),f("buttonClick"),v("medium")}let Lt=[10,25,50,100,-1];function y(){let t=document.getElementById("slotAutoMark");t&&(t.textContent=e.auto===0?"ВЫКЛ":e.auto===-1?"∞":e.auto),w()?.querySelector(".sl-btn-auto")?.classList.toggle("is-on",e.auto!==0)}function It(){m(`
      <h2 class="sl-modal-title">АВТОИГРА</h2>
      <div class="sl-auto-row">
        ${Lt.map(t=>`<button class="sl-chip ${e.auto===t?"is-on":""}"
           data-act="auto-set" data-n="${t}">${t===-1?"∞":t}</button>`).join("")}
      </div>
      <button class="sl-gold-btn sl-gold-btn-quiet" data-act="auto-stop">
        ${o("stop","sl-ico sl-ico-sm")} ОСТАНОВИТЬ</button>
      <p class="sl-modal-note">Автопрокрут останавливается сам, когда кончились
        вращения, не хватило денег или запустился бонус.</p>`)}let D=null,rt=()=>!document.getElementById("slotModal")?.hidden;function m(t,{onClose:s=null}={}){let n=document.getElementById("slotModal"),l=document.getElementById("slotModalBody");!n||!l||(l.innerHTML=t,n.hidden=!1,D=s)}function g(){let t=document.getElementById("slotModal");t&&(t.hidden=!0);let s=D;D=null,s&&s()}function Tt(){return`
      <h2 class="sl-modal-title">МЕНЮ</h2>
      <div class="sl-menu-list">
        <button class="sl-menu-item" data-act="paytable">${o("table")}<span>Таблица выплат</span></button>
        <button class="sl-menu-item" data-act="rules">${o("info")}<span>Правила игры</span></button>
        <button class="sl-menu-item" data-act="settings">${o("gear")}<span>Настройки</span></button>
        <button class="sl-menu-item" data-act="history">${o("clock")}<span>История</span></button>
        <button class="sl-menu-item" data-act="shelf">${o("back")}<span>Другие слоты</span></button>
      </div>`}function xt(){let t=e.slot.lines.length,s=e.slot.freeMultiplier>1?`<li>Во время бесплатных вращений выигрыши по линиям умножаются на
           ${e.slot.freeMultiplier}.</li>`:"";return`
      <h2 class="sl-modal-title">ПРАВИЛА ИГРЫ</h2>
      <ul class="sl-rules">
        <li>Пять барабанов по три символа, ${t} линий. Линии считаются
          слева направо и обязательно от первого барабана: разрыв обрывает цепочку.</li>
        <li>${Z()}</li>
        <li><b>WILD</b> заменяет любой символ, кроме SCATTER. На первом и пятом
          барабане он не встречается.</li>
        <li><b>SCATTER</b> платит из любого места экрана. Три и больше дают
          ${e.slot.freeSpins} бесплатных вращений.</li>
        <li>Во время бесплатных вращений WILD расширяется на весь барабан.
          Внутри бонуса новые вращения не выдаются.</li>
        ${s}
        <li>Джекпоты разыгрываются отдельно от барабанов. Шанс пропорционален
          ставке: чем крупнее ставка, тем больше прав на приз.</li>
        <li>Отдача игры ${(e.slot.rtp*100).toFixed(0)}%. Покупка бонуса стоит
          ${$(e.slot.buyBonusPrice)} ставок и имеет ту же отдачу, что и обычный прокрут.</li>
      </ul>`}function ut(){let t=(s,n,l)=>`
      <label class="sl-switch">
        ${o(l)}
        <span>${n}</span>
        <input type="checkbox" data-opt="${s}" ${e.settings[s]?"checked":""}>
      </label>`;return`
      <h2 class="sl-modal-title">НАСТРОЙКИ</h2>
      ${t("sound","Звук","sound")}
      ${t("animation","Анимация","spark")}
      ${t("fast","Быстрый прокрут","play")}
      <button class="sl-gold-btn sl-gold-btn-quiet" data-act="settings-reset">Сбросить</button>
      <p class="sl-modal-note">Выключенная анимация показывает результат сразу.
        На исход и на выплату это не влияет никак: результат решает сервер до
        начала вращения.</p>`}function kt(){let t=e.slot.buyBonusPrice*e.bet;return`
      <h2 class="sl-modal-title">КУПИТЬ БОНУС</h2>
      <div class="sl-buy-art" style="background-image:url('${e.slot.art.bonus}')">
        <span>БОНУСНЫЙ РАУНД</span>
      </div>
      <p class="sl-modal-lead">${e.slot.freeSpins} бесплатных вращений с
        расширяющимися WILD при ставке ${d(e.bet)}.</p>
      <div class="sl-buy-price">${d(t)}</div>
      <p class="sl-modal-note">Цена посчитана из матожидания бонуса: покупка
        имеет ту же отдачу, что и обычный прокрут. Дешевле обычной игры бонус
        не бывает, и дороже тоже.</p>
      <button class="sl-gold-btn" data-act="buy-go">КУПИТЬ</button>
      <button class="sl-gold-btn sl-gold-btn-quiet" data-act="modal-close">ОТМЕНА</button>`}function At(){let t=(u.user?.activeWallet==="bonus"?u.user?.bonusBalance:u.user?.balance)??0;return`
      <h2 class="sl-modal-title">ВЫБЕРИТЕ СТАВКУ</h2>
      <div class="sl-bet-grid">
        ${e.slot.bets.map(s=>`<button class="sl-chip ${s===e.bet?"is-on":""}
          ${s>t?"is-off":""}" data-act="bet-set" data-n="${s}">${$(s)}</button>`).join("")}
      </div>
      <p class="sl-modal-note">Ставка делится между ${e.slot.lines.length} линиями.
        Серым отмечены ставки, на которые не хватает баланса.</p>`}function k(){v("error"),m(`
      <div class="sl-alert">
        ${o("alert","sl-ico sl-ico-alert")}
        <h2 class="sl-modal-title">НЕДОСТАТОЧНО СРЕДСТВ</h2>
        <p class="sl-modal-lead">Для этой ставки требуется ${d(e.bet)}.<br>
          Пожалуйста, уменьшите ставку.</p>
        <button class="sl-gold-btn" data-act="modal-close">OK</button>
        <button class="sl-gold-btn sl-gold-btn-quiet" data-act="cashier">ПОПОЛНИТЬ</button>
      </div>`)}function V(t){return new Promise(s=>{m(`
        <div class="sl-free" style="background-image:url('${e.slot.art.bonus}')">
          <h2 class="sl-modal-title">БЕСПЛАТНЫЕ ВРАЩЕНИЯ</h2>
          <div class="sl-free-count">${t}</div>
          <div class="sl-free-sub">БЕСПЛАТНЫХ ВРАЩЕНИЙ</div>
          <p class="sl-free-note">Собрано 3 или более символов SCATTER</p>
          <button class="sl-gold-btn" data-act="modal-close">НАЧАТЬ</button>
        </div>`,{onClose:s}),setTimeout(()=>{rt()&&g()},5e3)})}async function Ct(){if(e.busy||e.free)return;let t=e.slot.buyBonusPrice*e.bet;if(((u.user?.activeWallet==="bonus"?u.user?.bonusBalance:u.user?.balance)??0)<t){g(),k();return}e.busy=!0;let s;try{s=await L.buyBonus(e.slot.id,e.bet)}catch(n){e.busy=!1,/INSUFFICIENT|Не хватает/.test(String(n.message))?(g(),k()):S(n.message);return}g(),z(s),x(s.price,0),e.free={spinsLeft:s.spinsLeft,lineBet:s.lineBet},B(),f("bonus"),await V(s.spinsLeft),await O(),e.busy=!1}function Nt(){let t=w();t&&(document.getElementById("slotSpin")?.addEventListener("click",()=>{if(f("buttonClick"),v("medium"),e.auto!==0){e.auto=0,y();return}q()}),!t.dataset.bound&&(t.dataset.bound="1",t.addEventListener("click",s=>{if(s.target.id==="slotModal"){g();return}let n=s.target.closest("[data-act]");if(!n)return;let l=n.dataset.act;l==="bet-down"?ct(-1):l==="bet-up"?ct(1):l==="bet-pick"?m(At()):l==="bet-set"?(G(Number(n.dataset.n)),g()):l==="max"?Et():l==="auto"?It():l==="auto-set"?(e.auto=Number(n.dataset.n),y(),g(),e.busy||q()):l==="auto-stop"?(e.auto=0,y(),g()):l==="buy"?m(kt()):l==="buy-go"?Ct():l==="menu"?m(Tt()):l==="rules"?m(xt()):l==="paytable"?m(`<h2 class="sl-modal-title">ТАБЛИЦА ВЫПЛАТ</h2>${tt()}`):l==="history"?m(`<h2 class="sl-modal-title">ИСТОРИЯ</h2>
        <div class="sl-history-list">${W()}</div>`):l==="settings"?m(ut()):l==="settings-reset"?(e.settings={...N},K(e.settings),A(),m(ut())):l==="modal-close"?g():l==="sound"?Ft():l==="full"?Wt():l==="cashier"?(g(),b.onCashier?.()):l==="shelf"&&(g(),pt(),Q())}),t.addEventListener("change",s=>{let n=s.target.dataset?.opt;n&&(e.settings[n]=s.target.checked,K(e.settings),A())}),window.addEventListener("resize",ft),document.addEventListener("fullscreenchange",ft)))}let dt=0;function ft(){clearTimeout(dt),dt=setTimeout(()=>{w()?.offsetParent&&H()},180)}function Ft(){e.settings.sound=!e.settings.sound,K(e.settings),A(),v("light")}function A(){let t=document.getElementById("slotSound");t&&(t.innerHTML=o(e.settings.sound?"sound":"mute"))}function Wt(){let t=document.getElementById("slotStage");if(!t)return;let s=()=>setTimeout(H,80);if(document.fullscreenElement){document.exitFullscreen?.().then(s).catch(s);return}let n=t.requestFullscreen?.bind(t);n?n().then(s).catch(()=>{t.classList.toggle("is-full"),s()}):(t.classList.toggle("is-full"),s())}async function bt(t){let s;try{s=await L.describe(t)}catch(a){S(a.message);return}e.slot=s.slot,e.history=[],e.spinNo=0,e.auto=0,e.bet=e.slot.bets.includes(100)?100:e.slot.bets[0],e.free=s.session?{spinsLeft:s.session.spinsLeft,lineBet:s.session.lineBet}:null;let n=Y();n&&(n.hidden=!0);let l=w();l&&(l.hidden=!1),Mt(),st(e.slot.strips.map(a=>Math.floor(Math.random()*a.length))),e.free&&(B(),await V(e.free.spinsLeft),await O())}function pt(){e.auto=0,y()}function Ht(){let t=document.getElementById("slotBalance");t&&(t.textContent=d((u.user?.activeWallet==="bonus"?u.user?.bonusBalance:u.user?.balance)||0))}return{openShelf:Q,open:bt,close:pt,refreshBalance:Ht}}export{zt as createSlot};
