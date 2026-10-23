# LUCKYBOX - навигационная карта кода

Справочник для помощников: получили задачу - нашли здесь файл и имя
функции - открыли файл поиском по имени. Без перебора grep'ом по всему
проекту.

## Как пользоваться

- Карта - **указатель**, а не правила. Почему сделано так, что нельзя
  трогать и что ломается - в `CLAUDE.md` (читать до первой правки).
  Математика - `README.md`, незаполненное - `NEDOSTATOK.md`, выкат -
  `deploy/README.md`, `deploy/LAUNCH.md`, ключи - `deploy/SECRETS.md`.
- Номеров строк здесь нет намеренно: они устаревают с каждой правкой. Ищите
  по имени функции, константы, селектора или заголовку блока:
  `grep -n "function openCase" public/app.js`,
  `grep -n "КАССА: ПОПОЛНЕНИЯ" server/db.js`.
- Большие файлы разбиты заголовками-комментариями вида
  `/* ====... ИМЯ БЛОКА ====... */` и `/* ---------- Подблок ---------- */`.
  Оглавления ниже идут в порядке блоков в файле.
- Нашли расхождение карты с кодом - правьте карту в том же коммите.

Быстрый поиск блока:

```bash
grep -nE '^\s*/\*\s*=+' -A1 public/app.js | grep -v '===='   # заголовки блоков
grep -nE '^/\* -{5,}' public/app.js                          # подблоки
grep -nE "^app\.(get|post)\(" server/app.js                  # все ручки
```

---

## 1. Корень проекта

| Файл | Что это |
|---|---|
| `CLAUDE.md` | правила проекта и «почему», обязательно |
| `README.md` | математика кейсов и игр подробно |
| `NEDOSTATOK.md` | что ещё не заполнено |
| `package.json` | скрипты `npm run ...` (dev, verify, demo, test:*) |
| `.env.example` | все переменные окружения с комментариями |
| `.gitattributes` | `eol=lf`, не трогать |
| `build-standalone.mjs` | автономная сборка в один HTML (`npm run demo`) |
| `server/` | Node + Express + SQLite |
| `public/` | клиент без сборщика (ES-модули) |
| `test/` | проверки, каждая своим `npm run test:*` |
| `tools/` | подготовка картинок и снимков (на своей машине) |
| `deploy/` | systemd, nginx, копии, сторож, установка, выкат |
| `assets-src/` | присланные PNG-исходники (на сервер не едут) |
| `dist/` | результат сборки: `luckybox.html`, `luckybox-admin.html`, `motion-demo.html` |
| `data/` | база по умолчанию (`app.db`, копии в `data/backups`) |

---

## 2. server/ по файлам

### server/app.js - HTTP, авторизация, все ручки

Подробное оглавление - в разделе 3, все маршруты - в разделе 5.

### server/db.js - SQLite и все денежные транзакции

Подробное оглавление - в разделе 4.

### server/auth.js - пароли, сессии в cookie, виджет Telegram

- `SESSION_COOKIE`, `SESSION_TTL_MS`, `RESET_TTL_MS`, `PASSWORD_MIN`, `NICK_MIN/MAX` - константы.
- `normalizeEmail`, `checkPassword`, `normalizeNick` - проверка ввода.
- `hashPassword`, `verifyPassword` - scrypt-хеш пароля.
- `burnPasswordCheck` - пустая проверка для одинакового времени ответа.
- `verifyTelegramLogin` - подпись виджета Telegram Login (SHA-256 от токена).
- `deviceId` - cookie `lb_dev` (устройство для `user_access`).
- `startSession`, `endSession`, `currentSessionHash` - сессия в httpOnly-cookie.
- `resolveUser` - игрок по cookie (и `DEV_MODE`-подмена, `X-Dev-Anon`).
- `isSameOrigin` - сверка Origin.
- `newResetToken`, `resetTokenHash` - токен сброса пароля.

### server/cases.js - 68 кейсов, решатель вероятностей

- `TIERS`, `CATEGORIES` - ступени редкости и полки (start, classic, themed, premium, elite, risk, bonus, country, got, season).
- `LADDER_FILLER`, `PAYBACK_STEPS`, `PAYBACK_WEIGHTS`, `TAIL_FROM`, `TAIL_STEPS`, `WEIGHT_BREAK` - устройство лестницы.
- `PROFILES` - профили риска (`evShare`, `beta`), `stepWeight` - вес ступени хвоста.
- `ladderFor` - лестница из 20 ступеней для кейса.
- `SPECS` - **список кейсов**: кортеж `[id, name, tagline, category, price, rtp, maxMultiplier, profileId, themeId, perks, extra]`, `extra.art` - имя файла обложки.
- `PERK_LABELS`, `freeSpinSpec` - плюшки и фриспины.
- `buildCase` - сборка кейса: решение уравнений, плюшки, джекпоты, `art`-ключи, скины.
- `CASES`, `getCase`, `pickItem` - готовые кейсы и выбор предмета по роллу.
- `FREESPIN_PACKS`, `roundPackPrice`, `freeSpinPackPrice`, `PACK_ROUND_MAX_CUT` - пачки фриспинов.
- `validateCases` - роняет старт при сумме вероятностей не 1 или расхождении матожидания.
- `publicCase` - кейс для клиента (без лишнего).

### server/themes.js - тематические наборы предметов

- `THEMES` - 41 тема по 20 предметов от дешёвого к дорогому. **Порядок обязан совпадать с `public/hd/<тема>.js`.**
- `VISUALS` - фирменное оформление темы (семейство + материал главного приза).
- `FAMILIES`, `SHAPES`, `MATERIALS`, `THEME_IDS`.

### server/card-skins.js - оформление предмета

- `FAMILY_BY_TIER`, `SHAPE_OF_FAMILY`, `MATERIALS_BY_FAMILY`, `QUIET_FAMILIES` - таблицы.
- `skinsForCase` - раздача скинов всему кейсу перебором с возвратом (без повторов пары).
- `skinFor` - скин одного предмета (хеш FNV-1a), `hash`, `rotate`, `spareFamilies`.
- `validateSkins` - роняет старт при опечатке или мёртвом семействе.

### server/games.js - краш, рулетка, апгрейд, риск-игра

- `CRASH_CONFIG`, `crashPointFromRoll`, `crashMultiplierAt`, `crashTimeToReach`.
- `ROULETTE_WHEEL`, `ROULETTE_PAYOUTS`, `ROULETTE_COLORS`, `ROULETTE_CONFIG`, `rouletteSlotFromRoll`, `rouletteColorOf`.
- `GAMBLE_CONFIG` (множитель ×4.2), `gambleAceFromRoll`.
- `UPGRADE_CONFIG`, `upgradeTarget`, `upgradeChance`, `upgradeWinFromRoll`.
- `validateGames`, `validateGamble`, `validateUpgrade`.

### server/fair.js - provably fair

- `generateServerSeed`, `hashSeed`, `generateClientSeed`, `computeRoll(serverSeed, clientSeed, nonce)`.

### server/fortune.js - колесо фортуны (веса руками)

- `FORTUNE_SEGMENTS`, `SEGMENT_DEG`, `SEGMENTS_START_DEG` - сектора картинки (те же числа в `tools/banners.mjs` и `test/ui.mjs`).
- `PERCENT_*`, `VOUCHER_*`, `CASH_PRIZE`, `GIFT_CASE_MAX_PRICE` - призы.
- `SPINS_PER_CYCLE`, `SPIN_COOLDOWN_MS`, `MIN_DEPOSIT` - право на прокрут.
- `pickSegment`, `pickAmount`, `validateFortune`.

### server/feed.js - витрина выпадений («Выигрывают сейчас»)

- `FEED_MIN_MULTIPLIER`, `FEED_MIN_VALUE`, `FEED_BIG_SHARE`, `FEED_REAL_SHARE`, `FEED_SYNTHETIC`, `FEED_CONFIG`.
- `getFeed`, `startFeed`, `stopFeed`; внутри `synthetic`, `randomNick`, `weightedPick`.

### server/slot-engine.js - математика слотов

- `ROWS`, `REELS`, `WILD`, `SCATTER`, `PAYLINES`, `LINES`.
- `buildSlot` - точный счёт отдачи перебором, `jackpotBudget` внутри.
- `offsetFrom`, `offsetsFrom`, `gridFrom` - позиции лент и сетка.
- `evaluate` - выплата по сетке (множитель фриспинов здесь).
- `jackpotFrom`, `jackpotRoll`, `validateSlot`, `hitFrequency`.

### server/slots.js - два слота и реестр

- `SLOT_RTP` (0.94), `SLOTS` (TREASURE ISLAND, GOLDEN LEGACY), `SLOT_BY_ID`, `getSlot`.
- `publicSlot`, `slotCard`, `validateSlots`, `mathFingerprint`.

### server/casino.js - протокол агрегатора Databetrix

- `casinoEnv`, `casinoConfigured`, `allowedProviders` (`DEFAULT_PROVIDERS`), `RTP_SOURCE`, `isSport`, `kindOf`, `PROVIDER_ORDER`, `HITS`.
- `request` - вызов API агрегатора с повторами.
- `buildCatalog` - три фильтра договора (провайдеры, источник Sloter, без спорта).
- `storefrontLists` - топ и новинки партнёрской витрины.
- `syncCatalog`, `syncStatus`, `startCatalogSync`, `loadSnapshot`, `SNAPSHOT_PATH`.
- `launchGame` - запуск игры (`minRtp = maxRtp`).
- `coverFile`, `readCover` - кеш обложек через sharp (`casino-covers/`).
- `probeCover`, `probeCovers`, `checkCoversInBackground` - признак `cover_state`.

### server/casino-db.js - кошелёк казино, копейки, каталог в базе

- `toKop`, `kopToRub`, `userKop`, `userBalanceRub`, `writeKop` - копейки (`users.balance_kop`).
- `CASINO_RTP_MIN/MAX`, `casinoRtp` - отдача из настройки `casino_rtp`.
- `casinoPlayerId`, `userFromCasinoId` (`lb<id>`), `casinoExcluded` (самоисключение).
- `casinoWallet` - **кошелёк**: get_balance, bet, win, rollback, cashout; `dedupeKey`, `roundBets`, `rollbackTargets`, `addWager`, `MESSAGES`.
- `saveCatalog`, `setCoverState`, `gamesWithoutCoverState`, `gamesWithoutCover`, `catalogStats`.
- `VISIBLE_SQL` (игры без обложки скрыты), `POPULAR_ORDER`, `FEATURED_SQL`, `COVER_SQL`, `NEW_WHERE`, `categoryWhere`.
- `casinoGames`, `casinoHome` (блоки лобби), `bigWins`, `uniqueByName`, `casinoGame`, `casinoProviders`, `casinoHistory`, `casinoSummary`.

### server/casino-categories.js - вкладки и блоки лобби (общие с автономной сборкой)

- `CASINO_TABS`, `POPULAR_SIZE`, `BLOCK_SIZE`, `MIN_BLOCK_GAMES`.
- `CASINO_CATEGORIES` (шаблоны по названию), `PROVIDER_BLOCKS`, `FEATURED_GAMES`, `BURIED_GAMES`.
- `coverRank`, `categoryById`, `categoriesFor`, `matchesPattern`.

### server/casino-catalog.json - снимок каталога (пишет `tools/casino-snapshot.mjs`)

### server/crypto.js - криптокасса Heleket

- `CRYPTO_MIN/MAX`, `COINS`, `NETWORKS`, `isConfigured`.
- `signBody`, `verifyWebhook`, `webhookIpAllowed`.
- `coins`, `rates`, `createDeposit`, `applyWebhook`, `listDeposits`, `getDeposit`, `refreshDeposit`.
- Курс USDT по бирже Rapira: `rapiraRate`, `payoutRate` (плюс `PAYOUT_MARKUP` 5%), `payoutQuote` (заявка на вывод), `cashierRates` (оба курса для кассы).

### server/sicilia.js - СБП и карта, шлюз Sicilia

- Окружение и подписи: `siciliaEnv`, `isConfigured`, `payinReady`, `signPayin`, `signInvid`, `signPayout`, `verifyCallback`, `isAppealCallback`, `callbackIpAllowed`, `DEEPLINK_BANKS`.
- Пополнение: `createDeposit` (подписанная ссылка окна), `applyPayinStatus`, `confirmPayin` (зачисление через `check-status`), `refreshDeposit`, `reopenDeposit`, `cancelDeposit`, `staffCancelDeposit`, `listDeposits`, `recheckDeposit`.
- Выплаты: `banks`, `matchBank` (только точное совпадение), `sendPayout`, `applyPayoutStatus`, `confirmPayout`, `recallPayout`, `releasePayout`, `gatewayPayout`, `gatewayPayouts`, `merchantBalance`.
- Колбэк: `handleCallback`, `applyAppealCallback`.
- Сверка: `reconcile`, `startReconcile`, `RECONCILE_MS`, `LATE_WINDOW_MS`, `LATE_EVERY_MS`.
- Споры и чеки: `receiptDir`, `saveReceipt`, `receiptFile`, `RECEIPT_MAX_BYTES`, `RECEIPT_NAME_RE`, `DISPUTE_WINDOW_MS`, `reportDeposit`, `openAppeal`, `declineDispute`, `openDisputesCount`, `adminDispute`.

### server/cashdesk.js - касса в панели (только чтение)

- `adminDeposits`, `depositsSummary`, `DEPOSITS_PAGE` - все пополнения с номерами.
- `depositsCsvRows`, `payoutsCsvRows`, `toCsv` - выгрузка сделок.

### server/payout-check.js - проверка заявки на вывод

- `checkPayout` - полная проверка, итог в `payout_checks`; `payoutCheck` - прочитать последнюю.
- `overridePayoutCheck` - снятие барьера сотрудником с комментарием, `payoutCleared`.
- Внутри: `checkLedger`, `checkSources`, `checkRound`, `checkFairness`, `checkBonuses`, `checkLinked`, `summary`, `CHECK_VERSION`, `canonicalEmail`.

### server/staff.js - роли и права

- `PERMISSION_GROUPS`, `PERMISSIONS`, `PERMISSION_IDS`, `isPermission`.
- `ROLES` (owner, admin, finance, support, risk, marketing, analyst), `ROLE_BY_ID`, `BOOTSTRAP_ROLE`.
- `permissionsFor`, `balanceCapFor`, `canManage`, `grantableBy`, `assignableRoles`, `publicRoles`.

Права: `players.view`, `players.notes`, `players.balance`, `players.gift`,
`players.block`, `players.limits`, `finance.payouts.view`,
`finance.payouts.resolve`, `promo.view`, `promo.edit`, `partners.view`,
`partners.edit`, `partners.pay`, `risk.view`, `journal.view`,
`reports.view`, `games.manage`, `settings.manage`, `staff.manage`.

### server/settings-defs.js - настройки площадки

- `SETTING_DEFS`: `maintenance`, `registration_open`, `payouts_open`,
  `deposits_open`, `min_payout`, `games_cases`, `games_crash`,
  `games_roulette`, `games_upgrade`, `games_fortune`, `games_casino`,
  `casino_rtp`, `games_slots`. Чтение - `setting()` в `db.js`, ворота игр - `gameGate()` в `app.js`.

### server/ratelimit.js - ограничитель частоты

- `rateLimit` - фабрика; `limits` - готовые: `play`, `read`, `cashier`, `guess`, `auth`, `webhook` (пороги из `RATE_LIMIT_*`).

### server/ops.js - служебный бот: тревоги и вход в панель

- `opsConfigured`, `twoFactorRequired`, `ADMIN_2FA_TTL_MS`.
- `alert`, `inform`, `countError` - оповещения (не бросают и не ждут), `ALERT_REPEAT_MS`.
- `createLink`, `linkChat` - привязка Telegram сотрудника.
- `sessionConfirmed`, `twoFactorState`, `requestApproval`, `confirmByCode`, `challengeStatus` - подтверждение входа.
- `startOpsBot`, `stopOpsBot`, `pollOnce`, `onCallback`, `onMessage`, `approve`, `deny`; `_test` для тестов.

### server/ops-notify.js - отправка служебным ботом без db.js

- `opsToken`, `tg`, `alertRecipients`, `notifyAll`, `siteLabel` (зовут сторож и копии).

### server/mailer.js - письма (сброс пароля)

- `isMailConfigured`, `sendMail` (Resend или `SMTP_URL`, `log` - в журнал), `lastLoggedMail`.

### server/subscription.js - бесплатный кейс за подписку на канал

- `FREE_CASE_COOLDOWN_MS`, `isConfigured`, `subscriptionConfig`, `isSubscribed`.

### server/bot.js - игровой бот, отдельный процесс (`npm run bot`)

- `remind`, `sweep` - напоминания (`pendingSpinReminders`, `freeCaseReminders` из db.js), тихие часы `isQuietNow`, `moscowHour`.

### server/verify.js - `npm run verify`

- Инварианты и Монте-Карло по всем кейсам и играм (`ROUNDS`).

---

## 3. server/app.js - оглавление

Блоки по порядку:

| Блок | Что внутри |
|---|---|
| (начало, без заголовка) | импорты; `validateCases/Games/Gamble/Upgrade/Slots/Skins` на старте; `OWNER_KEYS`, `OWNER_EMAILS_GUARDED`; `app`, `wrapAsync`; `express.static` |
| middleware | `auth` (вход обязателен), `browse` (гость тоже), `maintenanceGate`, `gameGate(key)` (настройка `games_*`), `need(perm)`, `adminConfirmed`, `staffOnly`, `adminOnly`; `publicUser` (что уходит игроку), `parseBet`, `sendInsufficient`, `minPayoutNow` |
| КОНФИГ И ИГРОК | `/api/health`, `/api/config` (кейсы, игры, правила бонусов, `open` - включённость разделов) |
| ВИТРИНА КРУПНЫХ ВЫПАДЕНИЙ | `/api/feed`, `withItemLook` |
| ВХОД НА САЙТ | `authGate`, `authError`, `welcome`, `loginLocked`/`loginFailed` (`LOGIN_FAIL_*`), `siteUrl`, `/api/me`, `/api/auth/*`, `/api/track` |
| КЕЙСЫ | `mergeFreeSpinGrants`, `MAX_BATCH`, `/api/open`, `/api/freespins/buy` |
| РУЛЕТКА | `/api/roulette`, `labelOf` |
| КРАШ | `/api/crash/start|state|cashout`, `/api/freespins/pending|ack` |
| ПРОМОКОДЫ | `promoCaseResolver`, `/api/promo/redeem|state` |
| ПАРТНЁРУ | `/api/partner/stats` |
| АДМИНКА: ПРОМОКОДЫ И ПАРТНЁРЫ | `/api/admin/promo*`, `/api/admin/partner*` |
| ПРОЧЕЕ | `/api/bonus`, `/api/history` |
| КАССА | `/api/wallet`, `/api/bonus/refuse`, `/api/payout/create|cancel` |
| РИСК-ИГРА | `/api/gamble/pick|skip` |
| АПГРЕЙД | `/api/upgrade` |
| БЕСПЛАТНЫЙ КЕЙС ЗА ПОДПИСКУ, КОЛЕСО ФОРТУНЫ, МИНИ-ИГРЫ | заголовки-указатели (ручки ниже, мини-игры удалены) |
| КАЗИНО: ИГРЫ ПРОВАЙДЕРОВ | `publicCasinoGame`, `CASINO_KINDS`, `CASINO_PAGE_MAX`, `/api/casino/lobby|home|games|launch|history`, `sendCover`, `/casino/cover/:id`, `/casino/wide/:id`, `/api/admin/casino*` |
| СЛОТЫ | `slotLineBet`, `askSlot`, `/api/slots`, `/api/slot*`, затем `/api/fortune/*`, `/api/free-case/*`, `/api/fair/*` |
| АДМИНКА | `/api/admin/overview|funnel|users|user|balance|block|voucher|payouts|payout/*`, `riskGate` (409 RISK) |
| КРИПТОКАССА HELEKET | `/api/crypto/*`, `/api/webhooks/heleket` |
| СБП И КАРТА: ШЛЮЗ SICILIA | `/api/sicilia/*`, `/api/webhooks/sicilia`, `/receipts/:name`, `/api/admin/deposit*`, `/api/admin/dispute/*`, `/api/admin/export/finance`, `/api/admin/sicilia*`, затем `sameSecret` и `/api/casino/wallet` |
| ПОТОК СОБЫТИЙ О ПЛАТЕЖАХ | `paymentStreams`, `emitPayment`, `STREAMS_PER_PLAYER`, `GET /api/payments/events` (SSE) |
| БЭК-ОФИС | подблок «Подтверждение входа в панель»: `/api/admin/2fa/*`; `/api/admin/me`, `/api/admin/staff*`, `/api/admin/journal`, `/api/admin/settings*`, `/api/admin/player/*`, `/api/admin/risk`, `/api/admin/reports`, `/api/admin/export` |
| (конец) | обработчик ошибок `app.use((err, ...))`, `PORT`, `listen`, `CRASH_EXIT_DELAY_MS`, метка падения `RUN_MARK`/`crashedBefore`, запуск `startFeed`, `startReconcile`, `startCatalogSync`, `startOpsBot` |

---

## 4. server/db.js - оглавление

| Блок | Ключевые функции |
|---|---|
| (начало) схема и миграции | `db`; шифрование карт `payoutKey`, `encryptCard`, `decryptCard`, `cardHash`, `ensureCardHashes`, `payoutCardDigits`; `CREATE TABLE` основных таблиц; `ensureColumn`; миграции (`games_slots_hidden_v1`, `pending_deposit_bonus_new`); `relaxNotNull` (снятие NOT NULL с `tg_id`); таблицы `sessions`, `password_resets` |
| БОНУСНЫЙ СЧЁТ, ЖУРНАЛ ДЕНЕГ, ИСТОРИЯ SEED | таблицы `bonus_events`, `server_seeds`, `ledger`, `ledger_ctx`, `user_access` и триггеры журнала; `rememberSeed`, `seedByHash`; `ledgerOpen`, `ledgerClose`, `ledgerLink`, `withLedger`, **`moneyTx(kind, fn)`**; `recordAccess`; аккаунты `insertNewUser`, `getOrCreateUser`, `findUserByTgId`, `findUserByEmail`, `createEmailUser`, `linkTelegram`, `setEmailLogin`, `setPasswordHash` |
| Сессии | `createSession`, `sessionByHash`, `extendSession`, `deleteSession`, `deleteUserSessions`, `purgeExpiredSessions` |
| Сброс пароля | `lastPasswordResetAt`, `createPasswordReset`, `usePasswordReset`; далее `getUserById`, `bumpNonce`, `settleRound` |
| Кейсы и рулетка | `playInstantRound` (рулетка, апгрейд) |
| Слот | `getSlotSession`, `playSlotSpin`, `buySlotBonus`, `playSlotFreeSpin`, `awardSlotJackpot` |
| Краш | `startCrashRound`, `getCrashRound`, `finishCrashRound`, `crashTier` |
| История, seed-ы, бонус | `getHistory`, `setClientSeed`, `rotateServerSeed`, `claimBonus`, `BONUS_CONFIG` |
| ПЛЮШКИ: ×2, подарочные кейсы, бонусы | `getVouchers`, `addVoucher` |
| Удвоители | `getX2Perks`, `x2Count`, `x2Available`, `addX2`, `spendX2` (ключ `*` - с колеса) |
| Колесо фортуны | `fortuneState`, `fortuneHistory`, `playFortuneSpin` |
| Бесплатный кейс за подписку | `grantFreeCase`, `freeCaseState` |
| Витрина выпадений | `recentPublicDrops`; затем **кейсы**: `MAX_FREE_SPINS`, `runFreeSpinSeries`, `x10Rules`, **`playCaseRound`**, `buyFreeSpins`, `playCaseBatch` |
| Незавершённая серия фриспинов | `savePendingSpins`, `getPendingSpins`, `clearPendingSpins` |
| ОТЫГРЫШ И БОНУСНЫЙ СЧЁТ | `HOUSE_RTP`, `bonusRules`, `wagerWeight`, `spendable`, **`chargeBet`**, `splitPayout`, `creditPayout`, `bonusInFlight`, `closeStaleCrashRounds`, `closeOpenCrashRounds`, `consumeWager`, `grantBonus`, `bonusAllowance`, `settleBonus`, `refuseBonus`, `getBonusEvents`, `firstDepositRules`, `firstDepositBonus`, **`registerDeposit`**, `withdrawable` |
| АНАЛИТИКА | `FUNNEL_STEPS`, `CLIENT_EVENTS` (закрытый список), `trackEvent`, `funnelStats`, `eventTotals` |
| НАПОМИНАНИЯ БОТА | `pendingSpinReminders`, `freeCaseReminders`, `markNoticeSent` |
| ПРОМОКОДЫ | `normalizePromoCode`, `getPromoByCode`, `redeemPromo`, `pendingDepositBonus`, `myPromoRedemptions` |
| ПАРТНЁРЫ | `getPartnerForUser`, `partnerStats`, `partnerReferrals` |
| АДМИНКА | `adminOverview`, `adminUsers`, **`staffSafeUser`**, `adminUserDetail`, `adminAdjustBalance`, `applyDepositBonus`, `adminSetBlocked`, `adminGrantVoucher`, `adminRecentRounds` |
| РИСК-ИГРА ПОСЛЕ ПРОКРУТА | `playGamble`, `clearGamble` |
| Админка: промокоды | `adminSavePromo`, `adminListPromos`, `adminDeletePromo` |
| Админка: партнёры | `adminSavePartner`, `adminListPartners`, `adminPayPartner`, `partnerPayoutHistory` |
| КАССА: ПОПОЛНЕНИЯ И ВЫВОДЫ | `MIN_PAYOUT`, `PAYOUT_STEP`, `payoutStep`, `getDeposits`, `getPayouts`, `pendingPayoutTotal`, `createPayout`, `cancelPayout`, `resolvePayout`, `startPayout`, `completePayout`, `completePayoutPartial`, `unstartPayout`, `adminPayouts`, `payoutForGateway`, `payoutStats` |
| БЭК-ОФИС | `logAdmin` |
| Сотрудники | `staffRow`, `staffList`, `syncStaff`, `findOwnerUser`, `isOwnerKeyed`, `findUserByAnyId`, `staffSave`, `staffRemove` |
| Заметки в карточке игрока | `playerNotes`, `addPlayerNote`, `deletePlayerNote` |
| Лимиты ответственной игры | `LIMIT_COOLDOWN_MS`, `getPlayerLimits`, `setPlayerLimits`, `assertPlayAllowed`, `assertDepositAllowed`, `REAL_DEPOSIT_SQL`, `dayActivity` |
| Настройки площадки | `settingsAll`, **`setting(key)`**, `saveSettings` |
| Журнал | `adminJournal` |
| Отчёты | `revenueDaily`, `caseReport` (в app.js импортируется как `caseRevenueReport`), `riskSignals` |

Где меняются деньги: только `db.js` (через `moneyTx`), `crypto.js`,
`sicilia.js`, `casino-db.js`. Прямой `UPDATE users` - запрещён (см. CLAUDE.md).

---

## 5. HTTP ручки (server/app.js)

Все POST, если не сказано иное. Промежуточные слои: `auth` - вход
обязателен; `browse` - гостю тоже можно; `limits.*` - частота;
`gameGate('x')` - выключатель `games_x`. Для `/api/admin/*` проверка права
`need('...')` (внутри неё же подтверждение входа служебным ботом).

### Служебное и конфиг

| Маршрут | Обработчик / что зовёт |
|---|---|
| GET `/api/health` | проверка живости (сторож) |
| GET `/api/config` | `subscriptionConfig`, `minPayoutNow`, `setting`, `casinoRtp`, `firstDepositRules` |
| GET `/api/feed` | `recentPublicDrops`, `getFeed` |
| `/api/me` | `publicUser` |
| `/api/track` | `trackEvent` (только `CLIENT_EVENTS`) |
| GET `/favicon.ico` | редирект |

### Вход (auth)

| Маршрут | Что зовёт |
|---|---|
| `/api/auth/register` | `createEmailUser`, `hashPassword`, `welcome` (настройка `registration_open`) |
| `/api/auth/login` | `findUserByEmail`, `verifyPassword`, `burnPasswordCheck`, `loginLocked` |
| `/api/auth/telegram` | `verifyTelegramLogin`, `findUserByTgId`, `getOrCreateUser` |
| `/api/auth/logout` | `endSession` |
| `/api/auth/link-telegram` | `verifyTelegramLogin`, `linkTelegram` |
| `/api/auth/password` | `setPasswordHash`, `setEmailLogin`, `deleteUserSessions` |
| `/api/auth/forgot` | `newResetToken`, `createPasswordReset`, `sendMail` |
| `/api/auth/reset` | `usePasswordReset`, `resetTokenHash` |

### Кейсы, фриспины, игры

| Маршрут | Что зовёт |
|---|---|
| `/api/open` | `getCase`, `playCaseBatch` (-> `playCaseRound`), `computeRoll`, `pickItem` |
| `/api/freespins/buy` | `freeSpinPackPrice`, `buyFreeSpins` |
| `/api/freespins/pending` / `ack` | `getPendingSpins` / `clearPendingSpins` |
| `/api/roulette` | `playInstantRound`, `rouletteSlotFromRoll`, `rouletteColorOf` |
| `/api/crash/start` | `startCrashRound`, `crashPointFromRoll` |
| `/api/crash/state` / `cashout` | `getCrashRound`, `crashMultiplierAt`, `finishCrashRound` |
| `/api/upgrade` | `upgradeTarget`, `upgradeChance`, `playInstantRound` |
| `/api/gamble/pick` / `skip` | `playGamble`, `gambleAceFromRoll` / `clearGamble` |
| `/api/slots`, `/api/slot` | список / `askSlot`, `getSlotSession`, `publicSlot` |
| `/api/slot/spin` | `playSlotSpin`, `offsetsFrom`, `gridFrom` |
| `/api/slot/free` | `playSlotFreeSpin`, `evaluateSlot` |
| `/api/slot/buy` | `buySlotBonus` |
| `/api/fortune/state` / `spin` | `fortuneState`, `fortuneHistory` / `playFortuneSpin` |
| `/api/free-case/state` / `claim` | `freeCaseState` / `isSubscribed`, `grantFreeCase` |
| `/api/fair/client-seed` / `rotate` | `setClientSeed` / `rotateServerSeed` |
| `/api/history` | `getHistory` |
| `/api/bonus` | отключена, отвечает 410 (стартового бонуса нет) |

### Промо и партнёры (игрок)

| Маршрут | Что зовёт |
|---|---|
| `/api/promo/redeem` | `redeemPromo` |
| `/api/promo/state` | `pendingDepositBonus`, `myPromoRedemptions` |
| `/api/partner/stats` | `getPartnerForUser`, `partnerStats`, `partnerReferrals`, `partnerPayoutHistory` |

### Касса, выводы, бонус

| Маршрут | Что зовёт |
|---|---|
| `/api/wallet` | `withdrawable`, `getDeposits`, `getPayouts`, `bonusAllowance`, `bonusRules` |
| `/api/bonus/refuse` | `refuseBonus` |
| `/api/payout/create` | `createPayout`, затем `checkPayout` (настройки `payouts_open`, `min_payout`) |
| `/api/payout/cancel` | `cancelPayout` |
| GET `/api/payments/events` | SSE-поток `emitPayment` |

### Криптокасса Heleket

| Маршрут | Что зовёт |
|---|---|
| `/api/crypto/options` | `crypto.coins`, `crypto.rates` |
| `/api/crypto/create` | `crypto.createDeposit` |
| `/api/crypto/list` | `crypto.listDeposits` |
| `/api/crypto/refresh` | `crypto.refreshDeposit` |
| `/api/webhooks/heleket` | `crypto.webhookIpAllowed`, `verifyWebhook`, `applyWebhook` |

### СБП и карта (Sicilia)

| Маршрут | Что зовёт |
|---|---|
| `/api/sicilia/options` | `sicilia.siciliaEnv`, `payinReady` |
| `/api/sicilia/create` | `sicilia.createDeposit` |
| `/api/sicilia/cancel` / `reopen` | `cancelDeposit` / `reopenDeposit` |
| `/api/sicilia/list` / `refresh` | `listDeposits` / `refreshDeposit` |
| `/api/sicilia/report` | `reportDeposit` (спор «деньги не пришли» с чеком) |
| `/api/webhooks/sicilia` | `callbackIpAllowed`, `verifyCallback`, `handleCallback` |
| GET `/receipts/:name` | `receiptFile` (без входа, для трейдера шлюза) |

### Казино провайдеров

| Маршрут | Что зовёт |
|---|---|
| `/api/casino/lobby` (browse) | `casinoProviders`, `casinoRtp` |
| `/api/casino/home` (browse) | `casinoHome` |
| `/api/casino/games` (browse) | `categoryById`, `casinoGames` |
| `/api/casino/launch` | `casinoGame`, `casinoExcluded`, `launchGame` |
| `/api/casino/history` | `casinoHistory` |
| GET `/casino/cover/:id`, `/casino/wide/:id` | `sendCover` -> `readCover` |
| `/api/casino/wallet` | **кошелёк агрегатора**: `sameSecret`, `casinoWallet`; без ограничителя частоты |

### Админка (`/api/admin/*`)

| Маршрут | need | Что зовёт |
|---|---|---|
| `/api/admin/me` | `adminOnly` | права, `balanceCapFor`, `openDisputesCount` |
| `/api/admin/2fa/status|link|request|poll|code` | `staffOnly` | `twoFactorState`, `createLink`, `requestApproval`, `challengeStatus`, `confirmByCode` |
| `/api/admin/overview` | reports.view | `adminOverview`, `adminRecentRounds` |
| `/api/admin/funnel` | reports.view | `funnelStats`, `eventTotals` |
| `/api/admin/reports` | reports.view | `revenueDaily`, `caseRevenueReport` |
| `/api/admin/export` | reports.view | CSV отчётов, `logAdmin` |
| `/api/admin/users` | players.view | `adminUsers` |
| `/api/admin/user` | players.view | `adminUserDetail` |
| `/api/admin/balance` | players.balance | `balanceCapFor`, `adminAdjustBalance` |
| `/api/admin/block` | players.block | `canManage`, `adminSetBlocked` |
| `/api/admin/voucher` | players.gift | `adminGrantVoucher` |
| `/api/admin/player/note`, `/note/delete` | players.notes | `addPlayerNote`, `deletePlayerNote` |
| `/api/admin/player/limits` | players.limits | `setPlayerLimits`, `dayActivity` |
| `/api/admin/payouts` | finance.payouts.view | `adminPayouts`, `payoutCheck`, `sicilia.matchBank`, `payoutStats` |
| `/api/admin/payout/check` | finance.payouts.view | `checkPayout` |
| `/api/admin/payout/override` | finance.payouts.resolve | `overridePayoutCheck` |
| `/api/admin/payout/resolve` | finance.payouts.resolve | `riskGate`, `startPayout`, `completePayout`, `resolvePayout` |
| `/api/admin/deposits` | finance.payouts.view | `adminDeposits`, `depositsSummary` |
| `/api/admin/deposit/recheck` | finance.payouts.view | `sicilia.recheckDeposit` |
| `/api/admin/deposit/cancel` | finance.payouts.resolve | `sicilia.staffCancelDeposit` |
| `/api/admin/dispute/open` | finance.payouts.resolve | `sicilia.openAppeal` |
| `/api/admin/dispute/decline` | finance.payouts.resolve | `sicilia.declineDispute` |
| `/api/admin/export/finance` | finance.payouts.view | `depositsCsvRows`, `payoutsCsvRows`, `toCsv` |
| `/api/admin/sicilia` | finance.payouts.view | `merchantBalance`, `banks`, `payinReady` |
| `/api/admin/sicilia/payout` | finance.payouts.resolve | `riskGate`, `sicilia.sendPayout` |
| `/api/admin/sicilia/payout/recall` | finance.payouts.resolve | `sicilia.recallPayout` |
| `/api/admin/sicilia/payout/release` | finance.payouts.resolve | `sicilia.releasePayout` |
| `/api/admin/promos` | promo.view | `adminListPromos` |
| `/api/admin/promo/save`, `/delete` | promo.edit | `adminSavePromo`, `adminDeletePromo` |
| `/api/admin/partners` | partners.view | `adminListPartners` |
| `/api/admin/partner/save` | partners.edit | `adminSavePartner` |
| `/api/admin/partner/pay` | partners.pay | `adminPayPartner` |
| `/api/admin/casino` | games.manage | `syncStatus`, `casinoSummary` |
| `/api/admin/casino/sync` | games.manage | `syncCatalog` |
| `/api/admin/settings`, `/save` | settings.manage | `settingsAll`, `saveSettings` |
| `/api/admin/staff` | staff.manage | `staffList`, `publicRoles`, `assignableRoles` |
| `/api/admin/staff/save` | staff.manage | `findUserByAnyId`, `canManage`, `staffSave` |
| `/api/admin/staff/remove` | staff.manage | `staffRemove` |
| `/api/admin/journal` | journal.view | `adminJournal` |
| `/api/admin/risk` | risk.view | `riskSignals` |

### Вебхуки (без `auth`, с `limits.webhook`)

`/api/webhooks/heleket`, `/api/webhooks/sicilia`; кошелёк казино
`/api/casino/wallet` (защита адресами `CASINO_CALLBACK_IPS` и ключом агента).
Колбэки сами не зачисляют: будят `check-status` (Sicilia) или проверяют подпись (Heleket).

**Добавить ручку:** в нужный блок `server/app.js` (раздел 3) по образцу
соседей: `auth` + `limits.*` + (`gameGate`) или `need('право')`; денежную
логику - функцией в `db.js` внутри `moneyTx`; заглушку той же ручки - в
`routes` в `build-standalone.mjs`; проверку - в `test/api.mjs`.

---

## 6. public/ по файлам

### public/index.html - вся разметка

Порядок в файле: `<head>` (шрифты Google Fonts с `display=swap`) ->
`#moneyRain`, `#sideNav` (боковое меню ПК), шапка (`#topStats`,
`#topAuth`), меню-картинка (`#menuBackdrop`, `#menuPhoto`, `#menuExtra`) ->
разделы `<section class="view" id="view-...">` -> экран открытия кейса
`#opener` -> подвал `#siteFooter` -> окна поверх (`#docBackdrop`,
`#buyBackdrop`, `#authBackdrop`, `#onbBackdrop`, `#feedBackdrop`,
`#fortuneStepsBackdrop`, `#fortuneWinBackdrop`, `#fxLayer`, `#toast`,
`#czSheet`, `#czFrame`). Скрипт - `<script type="module" src="/app.js">`.

### public/app.js - основной клиент (оглавление в разделе 7)

### public/styles.css - все стили, mobile-first

Блоки (заголовки `/* ==== ... */`) по порядку: LUCKYBOX - оформление
(токены, база), ШАПКА-ПОСТЕР, СОБСТВЕННЫЕ ИКОНКИ, ОБЛОЖКИ КЕЙСОВ, СЕЗОННЫЙ
КЕЙС, АДМИНКА, ПАНЕЛЬ УПРАВЛЕНИЯ: ОБОЛОЧКА, ПОЛКИ КЕЙСОВ (`--shelf-cols`,
`--shelf-gap`, `--shelf-cell`), ЭКРАН ПРОКРУТА, ПРАЗДНИЧНЫЕ ЭФФЕКТЫ (дважды),
ОБРЯД ОТКРЫТИЯ, ПОДВАЛ И ПРАВОВЫЕ ДОКУМЕНТЫ, КАССА, ФРИСПИНЫ, КАРТОЧКА С
ПРИСЛАННЫМ АРТОМ, МЕНЮ-СЕТКА, ЭКРАН КЕЙСА: СОСТАВ ПОД КНОПКОЙ (`--hist-cols`,
`--hist-rows`), ПОДВАЛ, LUCKY FORTUNE, ЛЕНТА ВЫИГРЫШЕЙ, БЕСПЛАТНЫЙ КЕЙС,
АПГРЕЙД, КРИПТОКАССА, КАССА: оформление, **КОМПЬЮТЕР** (основной блок
`@media (min-width: 1024px)`, `.banner-stack`), СЛОТЫ, СЛОТЫ: КОМПЬЮТЕР,
СИСТЕМА КАРТОЧЕК ВЫИГРЫША (`data-family`, `data-shape`, `data-material`,
`--safe-b`, `--safe-x`), КОМПОЗИЦИЯ КАРТОЧКИ, ВЕРТИКАЛЬНАЯ ПЛИТКА БАРАБАНА,
ПОКАЗ ВЫИГРЫША И ФРИСПИНОВ (motion.js, `mo-*`, `mo-receded`), ЖИВОЙ ГЛАВНЫЙ
ЭКРАН И ПОПОЛНЕНИЕ, КОМПЬЮТЕР: ЧЁТКОСТЬ ВМЕСТО ДЫМКИ, КАЗИНО: ЛОББИ (`cz-*`).

Найти стиль: `grep -n "\.open-bar" public/styles.css`. Десктоп - в блоках
«КОМПЬЮТЕР», а не отдельным файлом.

### public/motion.js - показ выигрыша и фриспинов

- `MOTION_LEVELS` (пороги ×4, ×12, ×50, ×150), `MOTION_NICE_AT`.
- `createMotion()` -> `{ win, purchase, retrigger, payout, seriesEnd, reset, recede, levelOf, inspect, closeInspect, doubler }`.
- Внутри: `ACCENTS` (акцент темы), `heroCard`, `bigWin`, `levelUp`, `shower`, `coins`, `sparks`, `flash`, `ring`, `slash`, `shake`, `stampLabel`, `floatText`.
- В `app.js` создаётся лениво: `motion()`.

### public/casino.js - лобби казино, провайдеры, окно и экран игры

- `createCasino()` -> `{ open, close, focusBlock, playing }`.
- Внутри: `shell`, `renderSeg` (меню Слоты/Live/Быстрые), `renderChips`, `syncBanners`, `renderHome`/`loadHome` (блоки), `blockHtml`, `tileHtml`, `onCoverError` (`COVER_RETRY_MS`, затем `?w=1`, затем убрать), `renderFast`/`loadFast` (наши Краш и Апгрейд), `renderList`, `renderGrid`, `fetchPage`, `loadMore`, `renderProviders`, `providerMark`, навигация-стек `go`/`back`, `setKind`, `openChip`, `openSheet`/`closeSheet` (окно запуска `#czSheet`), `launch`, `openFrame`/`closeFrame` (iframe `#czFrame`), `refreshUser` (`BALANCE_POLL_MS`).

### public/slots.js - слоты (раздел выключен настройкой `games_slots`)

- `createSlot()` -> `{ openShelf, open, close, refreshBalance }`.
- Внутри: `shelfHtml`, `render`, `reelHtml`, `layoutReels`, `spinReel`, `runReels`, `spin`, `showWins`, `drawLine`, `bigWinModal`, `playFreeSeries`, `buyBonus`, `paytableHtml`, `rulesHtml`, `settingsHtml`, `autoModal`, `bind` (`dataset.bound`), `setBet`/`stepBet`/`maxBet`.

### public/legal.js - документы и реквизиты

- `LICENSE`, `COMPANY` (`entities`, `support`), `PARTNERS` (блок в «Честности»), `DOCS` (тексты соглашений), `footerHtml`. Лицензию менять только по документам.

### public/icons.js - собственные SVG-иконки

- `iconCases`, `iconCrash`, `iconRoulette`, `iconFair`, `iconAdmin`, `iconCoin`, `iconX2`, `iconGift`, `iconSlot`, `iconTelegram` и др., `GAME_ICONS`; знаки подвала `markF1`, `markITF`, `markGambling`, `markWorldGame`. В `app.js` собраны в `ICONS`, ставятся по `data-ico` (`mountIcons`).

### public/covers.js - обложки кейсов

- `caseCover` (процедурная запасная), `caseArtSrc` (обложка полки `/assets/covers/<art>.webp`), `caseStageSrc` (крупная сцены `/assets/covers/stage/`), `porschePhotoSrc`, `porscheCover`, `artCover`.

### public/item-art.js, item-art64.js, item-art-hd.js, hd/ - рисунки предметов

- `item-art.js`: `itemArt`, `itemArtMaterial`, `artFor`, `ART_COUNT` - 74 мотива 24x24 (счётчик `matSeq`).
- `item-art64.js`: `itemArt64`, `art64For`, `ART64_COUNT` - 46 мотивов 64x64 (имена на `64`).
- `item-art-hd.js`: `HD_THEMES` (реестр тем), `hdDrawFor(key)`, `itemArtHd(key)` - по ключу `art` (`samurai/19`, `perk/fs/10`, `jackpot/<кейс>`).
- `hd/kit.js`: движок `hdKit`, `HD_MAT`, `hdTone`, `hdMix`, `hdRect`, `hdEll`, `hdNgon`, `hdPoly`, `hdStar`.
- `hd/parts.js`: `hdSuit`, `hdCard`, `hdChip`, `hdCoin`, `hdBottle`, `hdKey`, `hdIngot`, `hdFeather`.
- `hd/special.js`: `hdSpecial`, `HD_SPECIAL_SAMPLES` - плюшки и джекпоты.
- `hd/<тема>.js`: по 20 рисунков, экспорт `HD_<ТЕМА>`. Темы: arctic, atom, braavos, casino, circus, crystal, cyber, deepsea, desert, dragon, dubai, forge, fortress, galaxy, garage, goldmine, highgarden, monaco, neon, noir, orbit, pharaoh, phoenix, pirate, racing, rio, royal, rune, samurai, santorini, shadow, singapore, steampunk, street, toxic, vampire, vault, vegas, volcano, westeros, winterfell.

### Прочее в public/

- `coin-art.js`: `coinMark`, `coinColor` - значки криптовалют.
- `sounds.js`: WebAudio, `soundEnabled`, `toggleSound`, `snd*` (`sndSpinStart`, `sndBigWin`, `sndCrash`, `sndJackpot`, ...).
- `provider-logos.js`: `PROVIDER_LOGOS` - генерируется `tools/provider-logos.mjs`, руками не править.
- `sbp-banks.json` - список банков СБП (инлайнится в автономной сборке).
- `assets/covers/` - обложки кейсов, `assets/covers/stage/` - крупные; `assets/ui/` - баннеры (`hero-*.webp`, `hero-jackpot.webp`, `promo-*.webp`), меню (`nav-*.webp`), фриспины (`fs-*.webp`), колесо (`fortune-*.webp`), слоты (`gl-*`, ...), логотипы провайдеров (`prov-*.webp`), `fast-*.webp`, `logo.webp`; `assets/menu.webp`, `assets/porsche.webp`.

---

## 7. public/app.js - оглавление

Начало файла (до первого заголовка): импорты, `state` (общее состояние:
`config`, `user`, `view`, `crash`, `admin`, `fortune`, ...), `ICONS`, `mountIcons`.

| Блок | Ключевые функции и константы |
|---|---|
| API И УТИЛИТЫ | `api()` (fetch, 401 AUTH -> окно входа), `fmt`, `fmtMoney`, **`money()`**, `esc`, `plural`, `playerIdent`, `tierColor`, `CATEGORY_COLORS`, `toast`, `toastAction`, `needMoney`, `track`, `openCashier`, `haptic`, `buildMoneyRain`, `motion()` |
| ПРАЗДНИЧНЫЕ ЭФФЕКТЫ | `winnerTile`, `fxLayer`, `fxAdd`, `fxConfetti`, `fxShout`, `celebrate`, `FX_PALETTES` |
| БАЛАНС, ПЛЮШКИ, СТАТИСТИКА | `renderBalance`, `spendableMoney`, `renderPerkBar`, `wireCaseCardFx`, `celebrateDeposit`, `coinShower`, `countBalance`, `showFirstDepositChest`; **`applyUser`** (новый ответ сервера -> весь интерфейс) |
| КЕЙСЫ | полки `THEMED_SHELVES`, `SHELVES`, `caseCardHtml`, `featuredHtml`, `renderCases`, `renderBonuses`; экран кейса `applyCaseTheme`, **`openCase`**, `resumePendingSpins`, `renderCaseStage`, `playRitual`; лента `STRIP_LENGTH`, `WINNER_INDEX`, `renderIdleReel`, `measureReel`, **`weightedSample`**, `skinOfCase`, `skinAttrs`, `tileArt`, `tileHtml`, `reelWrapHtml`, **`startOpening`**, `reelItem`, `playDoublers`, `spinReels`, `SPIN_DURATION` |
| ПОКУПКА ФРИСПИНОВ | `renderFreeSpinBuy`, `freeSpinPackPrice`, `confirmBuyFreeSpins` (`.buy-scene`, `BUY_ORBIT_MAX`), `buyFreeSpins`, `fitOpenBtn` |
| АВТООТКРЫТИЕ | `AUTO_COUNTS`, `runAutoOpen`, `showAutoResult`, `collectFreeSpins`, `mergeFreeSpinGrants`, `runFreeSpins`, `seriesRatio`, `endBonusMode`, `showBatchResult`, `showCaseResult`, `setAgainButton` |
| Вспомогательное для экрана прокрута | `viewersFor`, `previewBalance`, `updateOpenerBalance`, `historyItem`, `inspectHistory`, `loadCaseHistory` (`HISTORY_LOAD`), **`closeOpener`**, `returnToCaseIdle` |
| РИСК-ИГРА | `renderGamble`, `pickGambleCard`, `gambleBurst`, `gambleStamp`, `GAMBLE_*` |
| ПАНЕЛИ СТАВОК | `betValue`, `setBet`, `wireBetPanel` |
| КРАШ | `CRASH_MILESTONES`, `drawCrashGraph`, `resetCrashGraph`, `createCrashFx`, `crashFx`, `startCrash`, `runCrashLoop`, `pollCrashState`, `cashoutCrash`, `finishCrash`, `pushRecent` |
| РУЛЕТКА | `ROUL_*` (`ROUL_TRACK_R`, `ROUL_POCKET_R`), `renderColorPicker`, `renderRouletteWheel`, `rouletteMarkSvg` (`data-sector`), `placeRouletteBall`, `spinRouletteWheel`, `spinRoulette` |
| ЧЕСТНОСТЬ | `decodeInto`, `renderFairPartners`, `renderFairCasino`, `renderFair` |
| АДМИНКА | `loadAdminOverview`, `renderAdminFeed`, `loadAdminUsers`, `openAdminUser` (карточка игрока: баланс, блок, заметки, лимиты, подарки) |
| Панель: разделы и права | **`BO_SECTIONS`** (id, группа, право, загрузчик), `boCan`, `boOpen` |
| Подтверждение входа в панель | `GATE_POLL_MS`, `showAdminShell`, `adminGateOk`, `renderAdminGate`, **`initAdminPanel`** |
| Панель: казино | `loadAdminCasino` |
| Панель: общие кирпичи | `boDate`, `boDateTime`, `boKpis`, `boTable`, `boBars` |
| Панель: отчёты | `loadAdminReports`, `boExport` |
| Панель: пополнения | `DEP_FILTERS`, `DEP_STATUS`, `DISPUTE_STATUS`, `idChip`, `bindIdChips`, `exportBarHtml`, `finExport`, `receiptDataUrl`, `loadAdminDeposits`, `depositRowHtml`, `bindDepositRows` |
| Панель: риск | `loadAdminRisk` |
| Панель: настройки площадки | `loadAdminSettings` |
| Панель: сотрудники | `loadAdminStaff`, `renderStaffForm` |
| Панель: журнал | `BO_ACTIONS`, `loadAdminJournal` |
| Админка: воронка | `loadAdminFunnel` |
| Админка: промокоды | `loadAdminPromos`, `promoRowHtml`, `fillPromoForm`, `savePromo` |
| Админка: партнёры | `loadAdminPartners`, `partnerRowHtml` |
| Админка: заявки на вывод | `SICILIA_STATUS`, `siciliaAdminInfo`, `siciliaPayoutBlock`, `riskPlate`, `riskDetailsHtml`, `loadAdminPayouts` |
| КАССА (заголовок) | **`switchView(name)`** - переключение разделов и их загрузка |
| МЕНЮ | `MENU_HITS` (зоны нажатия на меню-картинке), `openSupport`, `MENU_EXTRA` (вход в админку на телефоне), `renderMenu` |
| БОКОВОЕ МЕНЮ ДЛЯ КОМПЬЮТЕРА | `VIEW_SWITCH`, `viewOpen`, `SIDE_NAV`, **`renderSideNav`**, `markSideNav`, `openMenu`, `closeMenu`, `STATUS_LABEL`, `SOURCE_LABEL` |
| Касса: общие детали оформления | `CASH_ICONS`, `paintCashBalance`, `setCashMode` (пополнить/вывести), `cashTxRow`, `withCashBusy`, `bindCashCopy`, `renderDepositOffer`, **`loadWallet`**, `renderWalletBonus`, `payoutRequisites`, `sendPayoutEnvelope`, `renderPayoutList` |
| КРИПТОКАССА | `loadCryptoOptions`, `renderCoinGrid`, `selectCoin`, `bindAmountInput`, `refreshCryptoRate`, `openCryptoDeposit`, `showCryptoCheckout`, `DEPOSIT_PANES`, `showDepositPane`, `markDepositMethod`, `openDefaultDeposit` |
| СБП и карта: шлюз Sicilia | `SICILIA_*`, `loadSiciliaOptions`, `openBlankTab` (вкладка ДО запроса), `openPaymentWindow`, `openSiciliaDeposit`, `renderSiciliaBanks`, `syncSiciliaAmount` |
| Перевод по реквизиту | `showSiciliaRequisite`, `tiltSiciliaCard`, `siciliaExpired`, `showSiciliaDone`, `showSiciliaCheckout`, `checkSicilia` |
| Касса: оплата не пришла | `loadSiciliaIssues`, `startPaymentEvents` (SSE), `loadSbpBanks` |
| ЛЕНТА ВЫИГРЫШЕЙ | `feedCardHtml`, `pushFeedCard`, `openFeedDrop` (сцена), `pollFeed`, `startFeed` |
| БЕСПЛАТНЫЙ КЕЙС ЗА ПОДПИСКУ | `renderFreeCase`, `loadFreeCase` |
| ПРОМОКОДЫ | `promoResultText`, `applyPromo`, `renderPromoFlaps`, `showGiftReveal`, `loadPromoState` |
| ЭКРАН ПАРТНЁРА | `loadPartner` |
| АПГРЕЙД | `renderUpgradePicker`, `renderUpgradeTicks`, `renderUpgradeStage`, `upgCharge`, `upgSpin`, `upgCountTo` |
| ПОДВАЛ И ПРАВОВЫЕ ДОКУМЕНТЫ | `buildFooter`, `openDoc` |
| ПЕРВЫЙ ЗАХОД | `ONBOARDING`, `licenseLine`, `renderOnboarding`, `startOnboarding` |
| ВХОД НА САЙТ | `guestUser`, `AUTH_PANES`, `openAuth`, `closeAuth`, `showAuthPane`, `mountTelegramWidget`, `onTelegramAuth`, `renderAccount`, `openAccount`, `renderAuthChrome`, `signedIn`, `submitAuth`, `wireAuth`, `takeResetToken`, `loadMe` |
| НАВИГАЦИЯ И СТАРТ | **`init()`** - старт приложения, навешивание обработчиков |
| КОЛЕСО ФОРТУНЫ | `fortuneWheelMarkup` (рисунок колеса по описанию сервера), `renderFortuneArt`, `loadFortune`, `renderFortuneStatus`, `renderFortuneLog`, `showFortuneSteps`, `spinFortune`, `fortuneHighlight`, `showFortuneWin`, **`openFreeMoney`**, `wireFortune` |
| ГЛАВНЫЙ БАННЕР | `runHeroSlider` (`data-ms` на слайдах) |
| СЧЁТЧИКИ В ПОДВАЛЕ | `startFooterCounters` |

---

## 8. Экраны клиента

Разделы - `<section class="view" id="view-NAME">` в `public/index.html`,
переключаются `switchView(NAME)` (`public/app.js`, блок «КАССА»); активный
получает `.active`. Доступность - `viewOpen()` по `config.open` (настройки
`games_*`). Навигация: меню-картинка на телефоне (`renderMenu`, `MENU_HITS`,
`MENU_EXTRA`) и `renderSideNav` (`SIDE_NAV`) на компьютере.

| Раздел | Что внутри разметки | Кто рисует / открывает |
|---|---|---|
| `#view-cases` (главная) | `#hero`/`#heroDots` (слайд-шоу), `#featuredSlot`, `#feed`/`#feedTrack`, пара промо-баннеров, `#perkBar`, `#caseShelves` | `renderCases`, `runHeroSlider`, `startFeed`, `renderPerkBar`, `loadFreeCase`; клик по кейсу -> `openCase` |
| `#opener` (экран кейса, поверх) | `#caseStage`, `#reels`, `#casePanel` (`.open-bar`, `#countRow`, `#autoRow`), `#fsBuy`, `#dropsGrid`, `#autoPanel`/`#autoRunRow`, `#freespins`, `#result`, `#gamble`, `#openerHistory` | `openCase`, `startOpening`, `runAutoOpen`, `runFreeSpins`, `showCaseResult`, `renderGamble`, `closeOpener` |
| `#view-upgrade` | `#upgStage`, `#upgTarget`, `#upgPicker` | `renderUpgradeStage`, `renderUpgradePicker`, `upgSpin` |
| `#view-crash` | `#crashStage`, `#crashMultiplier`, `#crashRocket`, `#crashRecent` | `startCrash`, `createCrashFx`, `cashoutCrash` |
| `#view-roulette` | `#rouletteWheel`, `#rouletteBall`, `#colorPicker`, `#rouletteResult` | `renderRouletteWheel`, `spinRoulette` |
| `#view-fair` («Честность») | `#fairPartners`, `#fairCasino`, `#serverHash`, сиды | `renderFair` |
| `#view-wallet` (касса) | `#walletBalance`, `#walletBonus`, `#cashSwitch`, `#walletDepositPane` (`#cryptoCreate`, `#cryptoCheckout`, `#siciliaCreate`, `#siciliaCheckout`, `#siciliaIssues`, `#depositList`), `#walletWithdrawPane` (`#withdrawSbpFields`, `#withdrawCardFields`, `#withdrawCryptoFields`, `#payoutList`) | `openCashier`, `loadWallet`, `setCashMode`, `openDefaultDeposit`, `openSiciliaDeposit`, `openCryptoDeposit`, `renderPayoutList` |
| `#view-freemoney` (Free Money) | `#fmFortune` (обложка), `#fortuneStage`, `#fortuneStatus`, `#fortuneLog` | `openFreeMoney`, `loadFortune`, `spinFortune`, `wireFortune` |
| `#view-casino` | `#czSeg`, `#czBanners`/`#czHero`, `#casinoRoot`; поверх `#czSheet`, `#czFrame` | `createCasino()` -> `casino.open()` |
| `#view-slots` | `#slotShelf`, `#slotRoot` | `createSlot()` -> `slot.openShelf()` |
| `#fmGifts` (во Free Money) | `#bonusPerks`, `#bonusList` | `renderBonuses` |
| `#view-partner` | `#partnerBody` | `loadPartner` |
| `#view-admin` (панель) | `#boGate`, `#boShell`, `#boNav`, панели `#admin-<id>` (overview, reports, funnel, users, payouts, deposits, risk, promos, partners, feed, settings, staff, journal, casino), `#adminDetail` | `initAdminPanel`, `boOpen(id)` по `BO_SECTIONS` |

Окна поверх экрана:

| Окно | Кто открывает |
|---|---|
| `#authBackdrop` (вход, регистрация, профиль) | `openAuth`, `openAccount`, `showAuthPane` |
| `#onbBackdrop` (первый заход, лицензия) | `startOnboarding` |
| `#docBackdrop` (правовые документы) | `openDoc` |
| `#buyBackdrop` (покупка пачки фриспинов) | `confirmBuyFreeSpins` |
| `#feedBackdrop` (выигрыш из ленты) | `openFeedDrop` |
| `#fortuneStepsBackdrop`, `#fortuneWinBackdrop` | `showFortuneSteps`, `showFortuneWin` |
| `#menuBackdrop` (меню-картинка) | `openMenu`, `closeMenu` |
| `#fxLayer`, `#toast` | `celebrate`/`fx*`, `toast` |
| сцены motion (`mo-*`, создаются кодом) | `motion().win/purchase/inspect/...` |

---

## 9. Где что лежит по задаче

**Поменять текст на экране.** Статичный текст - `public/index.html` (ищите
саму строку). Текст, собранный кодом - `public/app.js` (шаблонные строки;
ищите фразу). Казино - `public/casino.js`, слоты - `public/slots.js`,
документы и реквизиты - `public/legal.js`, сообщения ошибок сервера -
`server/app.js` (`res.status(...).json({ error: '...' })`) и `server/db.js`
(`throw` в транзакциях), коды казино - `MESSAGES` в `casino-db.js`. Без
длинных тире: `test:modules` их ловит.

**Поменять кнопку / вид.** Разметка - `index.html` по id; поведение - в
`init()` или в функции раздела (`app.js`); стиль - `styles.css` по классу,
десктоп в блоках «КОМПЬЮТЕР». Панель открытия: `.open-bar`, `fitOpenBtn`,
`setAgainButton`, `AUTO_COUNTS`.

**Добавить кейс.** Кортеж в `SPECS` (`server/cases.js`); тема с 20
предметами - `THEMES` и `VISUALS` в `server/themes.js`; рисунки - новый
`public/hd/<тема>.js` в том же порядке и запись в `HD_THEMES`
(`item-art-hd.js`); обложка - `assets-src/covers/` -> `node
tools/case-covers.mjs` (и `--stage`); полка - `CATEGORIES` / `THEMED_SHELVES`.
Потом `npm run verify`, `npm run test:art`, `npm run test:cards`.

**Поменять математику кейса.** Только цена, `rtp`, потолок множителя или
профиль в `SPECS`; устройство лестницы - `PROFILES`, `PAYBACK_*`,
`stepWeight`, `buildCase` в `cases.js`. Проверка - `npm run verify`
(`server/verify.js`). Вероятности руками не задаются.

**Открытие кейса на сервере.** `/api/open` -> `playCaseBatch` ->
`playCaseRound` (`db.js`, блок «Витрина выпадений»): `chargeBet`, удвоители
`spendX2`, фриспины `runFreeSpinSeries`.

**Лента барабана / анимация открытия.** `startOpening`, `spinReels`,
`tileHtml`, `weightedSample`, `STRIP_LENGTH`, `WINNER_INDEX` (`app.js`);
показ выигрыша - `public/motion.js`; удвоитель - `playDoublers` и `doubler`.

**Карточки предметов (оформление).** Сервер - `server/card-skins.js`
(`skinsForCase`), клиент - `skinAttrs`, `tileArt` в `app.js`, CSS - «СИСТЕМА
КАРТОЧЕК ВЫИГРЫША». Рисунки - `public/hd/`, `item-art*.js`. Контактный лист:
`node tools/art-sheet.mjs <тема> out.png`.

**Фриспины.** Пачки - `FREESPIN_PACKS`, `freeSpinPackPrice` (`cases.js`),
`buyFreeSpins` (`db.js`), `/api/freespins/*`; клиент - блоки «ПОКУПКА
ФРИСПИНОВ» и «АВТООТКРЫТИЕ» (`confirmBuyFreeSpins`, `runFreeSpins`,
`mergeFreeSpinGrants`); недосмотренная серия - `pending_spins`,
`resumePendingSpins`. Картинки пачек - `tools/freespin-packs.mjs`.

**Касса и пополнение.** Клиент - `loadWallet`, `openDefaultDeposit`, блоки
«КРИПТОКАССА», «СБП и карта», «Перевод по реквизиту», «оплата не пришла».
Сервер - `server/sicilia.js` (`createDeposit`, `handleCallback`,
`confirmPayin`, `reconcile`), `server/crypto.js` (`createDeposit`,
`applyWebhook`). Любое зачисление обязано звать `registerDeposit()` (`db.js`)
в своей транзакции. Лимиты - `assertDepositAllowed`.

**Выводы.** Игрок: `/api/payout/create` -> `createPayout` (`db.js`, блок
«КАССА»), `withdrawable`, `MIN_PAYOUT`/`min_payout`; клиент
`sendPayoutEnvelope`, `renderPayoutList`. Проверка - `server/payout-check.js`
(`checkPayout`); панель - `loadAdminPayouts`, `riskPlate`;
проводка - `/api/admin/payout/resolve`, `riskGate`, `startPayout`,
`completePayout`; в шлюз - `sicilia.sendPayout`, `matchBank`.

**Бонусы и отыгрыш.** `db.js` блок «ОТЫГРЫШ И БОНУСНЫЙ СЧЁТ»: `chargeBet`,
`consumeWager`, `wagerWeight`, `grantBonus`, `bonusAllowance`,
`settleBonus`, `refuseBonus`, `registerDeposit`, `firstDepositRules`.
Клиент - `renderWalletBonus`, `#wagerNote`. Тест - `test:wager`,
`test:payout-check`.

**Промокоды.** `db.js` «ПРОМОКОДЫ» (`redeemPromo`) и «Админка: промокоды»;
ввод только при регистрации - `createEmailUserWithPromo` (`db.js`), ручка
`/api/auth/register` (поле `promo`), поле `#authPromo`; сцена подарка -
`showGiftReveal`; панель - `loadAdminPromos`, `savePromo`.

**Медали сняты** вместе с наградой ×10; колонки `x10_*` в `users` остались
(см. CLAUDE.md, «Живые мелочи»).

**Колесо фортуны.** Сектора и веса - `server/fortune.js`; прокрут -
`playFortuneSpin` (`db.js`), выдача прокрутов - `registerDeposit`; клиент -
блок «КОЛЕСО ФОРТУНЫ» (`spinFortune`, `fortuneHighlight`, `openFreeMoney`);
картинка - `tools/banners.mjs`; при смене картинки править `fortune.js`,
`tools/banners.mjs` и `test/ui.mjs`. Тест - `test:fortune`.

**Удвоитель.** `x2_perks`, `addX2`, `spendX2`, `getX2Perks` (`db.js`);
`FORTUNE_X2_CAP` для удвоителя с колеса. Тест - `test:x2`.

**Краш / рулетка / апгрейд / риск-игра.** Математика - `server/games.js`;
транзакции - `startCrashRound`/`finishCrashRound`, `playInstantRound`,
`playGamble` (`db.js`); клиент - блоки «КРАШ», «РУЛЕТКА», «АПГРЕЙД»,
«РИСК-ИГРА» в `app.js`.

**Панель админа.** Новый раздел: запись в `BO_SECTIONS` (`app.js`), панель
`<div id="admin-<id>" class="admin-pane">` в `index.html`, загрузчик
`loadAdmin<Имя>`, ручка `/api/admin/...` с `need('право')`, право - в
`PERMISSIONS` и ролях `server/staff.js`. Карточка игрока - `openAdminUser`.
Вход в панель - `initAdminPanel`, `renderAdminGate`, `server/ops.js`.

**Настройки площадки.** Описание - `SETTING_DEFS` в
`server/settings-defs.js`; чтение - `setting()` (`db.js`); исполнение -
`gameGate`, `maintenanceGate` (`app.js`), `viewOpen` (клиент); панель -
`loadAdminSettings`. Сначала код, который настройку исполняет.

**Сотрудники и права.** `server/staff.js`, `staff*` в `db.js`, `syncStaff`
(владельцы из `ADMIN_TG_IDS`/`ADMIN_EMAILS`), панель `loadAdminStaff`.

**Вход на сайт.** Сервер - `server/auth.js`, `/api/auth/*`, сессии и сброс
в `db.js`; клиент - блок «ВХОД НА САЙТ» (`openAuth`, `submitAuth`,
`guestUser`); письма - `server/mailer.js`. Тест - `test:auth`.

**Казино лобби и категории.** Блоки и шаблоны - `server/casino-categories.js`;
выдача - `casinoHome`, `casinoGames`, `POPULAR_ORDER`, `VISIBLE_SQL`
(`casino-db.js`); каталог и обложки - `server/casino.js` (`buildCatalog`,
`syncCatalog`, `probeCovers`); клиент - `public/casino.js`; логотипы -
`tools/provider-logos.mjs`; снимок - `tools/casino-snapshot.mjs`. Кошелёк -
`casinoWallet`. Отдача - настройка `casino_rtp`. Тест - `test:casino`.

**Слоты.** Математика - `slot-engine.js`, описания - `slots.js`, клиент -
`public/slots.js`, картинки - `tools/slot-assets.mjs`,
`tools/slot-golden-assets.mjs`. Раздел включается настройкой `games_slots`.

**Лента «Выигрывают сейчас».** Сервер - `server/feed.js`,
`recentPublicDrops`; клиент - `feedCardHtml`, `pushFeedCard`,
`openFeedDrop`.

**Баннеры и картинки.** Исходники - `assets-src/ui/`, `assets-src/covers/`,
`assets-src/slots/`; скрипты в `tools/` (раздел 11) пишут в
`public/assets/ui/` и `public/assets/covers/`. Слайд-шоу - `#hero`,
`runHeroSlider`; пара под ним - `promo-*.webp`, `--promo-square-ratio`.
Путь к картинке в коде - целой строкой `/assets/ui/x.webp` (иначе сборка не
заинлайнит).

**Аналитика и воронка.** `trackEvent`, `CLIENT_EVENTS`, `FUNNEL_STEPS`,
`funnelStats` (`db.js`), клиент `track()`, панель `loadAdminFunnel`.

**Оповещения о сбоях.** `alert`, `countError` (`server/ops.js`), сторож -
`deploy/watchdog.mjs`.

**Лимиты ответственной игры.** `db.js` «Лимиты»: `setPlayerLimits`,
`assertPlayAllowed` (в `chargeBet`), `assertDepositAllowed`,
`LIMIT_COOLDOWN_MS`; казино - `casinoExcluded`.

**Автономная сборка.** `build-standalone.mjs`: читает те же исходники,
`inlineUi` заменяет пути `/assets/...` на data-URI, `strip` снимает
`import/export`, `shim` - заглушка сервера в браузере (`routes` - объект
`'/api/...': (body) => ...` на каждую ручку, состояние в localStorage
`STORE_KEY`), `topLevelNames`/`clashes` - проверка столкновения имён
верхнего уровня. Новая ручка или новый модуль клиента - дописать сюда.
Проверка: `npm run demo && node test/ui.mjs "file://$PWD/dist/luckybox.html"`.

**Тесты.** Раздел 12.

---

## 10. Таблицы базы

| Таблица | Где создаётся | Назначение |
|---|---|---|
| `users` | db.js | игрок: балансы (`balance`, `balance_kop`, `bonus_balance`), `deposit_debt`, seed, tg_id, почта, хеш пароля |
| `rounds` | db.js | все раунды игр (`meta` - входы для пересчёта) |
| `crash_rounds` | db.js | активные раунды краша, точка краша на клиент не уходит |
| `vouchers` | db.js | подарочные открытия кейсов |
| `x2_perks` | db.js | накопленные удвоители по кейсам (`*` - с колеса) |
| `fortune_wins` | db.js | журнал призов колеса |
| `payouts` | db.js | заявки на вывод (карта зашифрована, `card_hash`) |
| `deposits` | db.js | зачисления (в т.ч. от администратора) |
| `balance_transactions` | db.js | пополнения шлюзов с уникальной ссылкой (защита от двойного зачисления) |
| `promocodes`, `promo_redemptions` | db.js | промокоды и их активации |
| `pending_deposit_bonus` | db.js | обещанный процент к пополнению (промо или колесо) |
| `partners`, `partner_payouts` | db.js | реферальная программа и выплаты партнёрам |
| `pending_spins` | db.js | недосмотренная серия фриспинов |
| `analytics_events` | db.js | события аналитики |
| `bot_notices` | db.js | что бот уже написал игроку |
| `admin_log` | db.js | журнал действий сотрудников |
| `staff` | db.js | сотрудники: роль и поправки прав |
| `player_notes` | db.js | заметки в карточке игрока |
| `player_limits` | db.js | лимиты ответственной игры (с отложенным ослаблением) |
| `app_settings` | db.js | значения настроек площадки |
| `slot_sessions` | db.js | бонусная серия слота |
| `sessions` | db.js | сессии (хеш токена), `admin_ok_until` |
| `password_resets` | db.js | одноразовые токены сброса |
| `bonus_events` | db.js | движение бонусного счёта |
| `server_seeds` | db.js | все server seed навсегда |
| `ledger` | db.js | журнал денег, пишется триггерами на `users` |
| `ledger_ctx` | db.js | контекст операции для триггеров (`moneyTx`) |
| `user_access` | db.js | входы: адрес и устройство |
| `pending_deposit_bonus_new` | db.js | временная таблица миграции |
| `payout_checks` | payout-check.js | результаты проверки заявок |
| `crypto_payments` | crypto.js | счета Heleket |
| `sicilia_orders` | sicilia.js | ордера пополнений и выплат Sicilia |
| `sicilia_disputes` | sicilia.js | споры «деньги не пришли», апелляции |
| `casino_providers`, `casino_games` | casino-db.js | каталог казино (`cover_state`, `first_seen_at`) |
| `casino_tx` | casino-db.js | транзакции кошелька казино |
| `ops_links` | ops.js | коды привязки Telegram сотрудников |
| `admin_challenges` | ops.js | запросы подтверждения входа в панель |

На старых базах остались `payment_requests`, `support_chats` и др. (удалённый
Билайн) - не трогать. Рядом с базой: `casino-covers/`, `sicilia-receipts/`,
`backups/`, метка `.running`.

---

## 11. tools/, deploy/, build-standalone.mjs

### tools/ (запускаются на своей машине)

| Скрипт | Что делает |
|---|---|
| `art-sheet.mjs` | контактный лист объёмных рисунков темы в PNG |
| `banners.mjs` | баннеры первого экрана, логотип, колесо фортуны, значки бокового меню (`keyDark`) |
| `case-covers.mjs` | обложки кейсов из `assets-src/covers/` (`--stage` - крупные) |
| `casino-snapshot.mjs` | снимок каталога -> `server/casino-catalog.json` (`--covers`) |
| `cutout-porsche.mjs` | разовая вырезка фона сезонной обложки |
| `fast-covers.mjs` | обложки «Быстрых игр» (`fast-crash`, `fast-upgrade`) |
| `favicon.mjs` | значок вкладки и ярлыка |
| `freespin-packs.mjs` | части дизайна выбора фриспинов |
| `menu-image.mjs` | меню-картинка телефона |
| `motion-demo.mjs` + `motion-demo.html` | демо анимаций -> `dist/motion-demo.html` |
| `promo-banners.mjs` | слайд «Большие джекпоты» (`hero-jackpot.webp`) |
| `promo-logos.mjs` | квадраты `promo-casino.webp`, `promo-cases.webp` (900x782) из присланных логотипов |
| `promo-squares.mjs` | самые старые рисованные квадраты; запуск перезапишет нынешние |
| `provider-logos.mjs` | логотипы провайдеров -> `prov-*.webp`, `public/provider-logos.js` |
| `slot-assets.mjs` | разбор макета TREASURE ISLAND |
| `slot-golden-assets.mjs` | разбор макета GOLDEN LEGACY |

### deploy/

| Файл | Что это |
|---|---|
| `README.md`, `LAUNCH.md`, `SECRETS.md` | развёртывание, чек-лист запуска, список ключей |
| `install.sh` | первичная установка в `/srv/luckybox` |
| `update.sh` | выкат: копия базы, код, перезапуск |
| `backup.mjs` | копия базы (WAL-безопасная, сжатая, проверенная), `RCLONE_REMOTE` |
| `watchdog.mjs` | сторож: health изнутри и снаружи, сертификат, диск, свежесть копий |
| `nginx.conf` | прокси; отдельные `location` для SSE, вебхуков и кошелька казино без `limit_req` |
| `luckybox.service`, `luckybox-bot.service` | сервер и игровой бот |
| `luckybox-backup.service/.timer`, `luckybox-watchdog.service/.timer` | копии и сторож по таймеру |

### build-standalone.mjs

Порядок: конфиг и данные (`config`, `drawTables`, `casinoCatalog`,
`feedPool`) -> пережатие обложек (`DEMO_COVER_SIDE`, `DEMO_STAGE_SIDE`) ->
`inlineUi` -> чтение модулей клиента (явный список, `hdArt` - вся папка
`public/hd/`) -> `strip` -> `shim` (заглушка: `freshUser`, `publicUser`,
`openOnce`, `demoOpen`, `demoCasinoRows`, `stubPayoutCheck`, **`routes`**,
`GUEST_OPEN`, перехват `window.fetch`) -> `page` -> `topLevelNames`
(проверка столкновений) -> `dist/luckybox.html`. `DEMO_ADMIN=1` - сборка с
открытой панелью.

---

## 12. Тесты

| Команда | Что покрывает | Сервер нужен |
|---|---|---|
| `npm run verify` | математика всех кейсов и игр | нет |
| `npm run test:modules` | импорты клиента сходятся, нет длинных тире | нет |
| `npm run test:art` | объёмные рисунки: у всех есть, все различны | нет |
| `npm run test:ratelimit` | ограничитель частоты | нет |
| `npm run test:x2` | удвоители и снятая медаль ×10 | нет |
| `npm run test:wager` | отыгрыш депозита и бонусный счёт | нет |
| `npm run test:payout-check` | проверка заявок, журнал денег | нет |
| `npm run test:crypto` | Heleket | нет |
| `npm run test:sicilia` | Sicilia: подписи, зачисление, сверка, выплаты, споры | нет |
| `npm run test:auth` | вход, сессии, Telegram, письма, перенос базы | нет |
| `npm run test:ops` | служебный бот | нет |
| `npm run test:analytics` | события, воронка, поводы бота | нет |
| `npm run test:fortune` | колесо фортуны | нет |
| `npm run test:slots` | слоты | нет |
| `npm run test:casino` | кошелёк казино, копейки, каталог, блоки | нет |
| `npm run test:api` | HTTP-ручки и арифметика балансов | да |
| `npm run test:cards` | карточки выигрыша | да |
| `npm run test:ui` | интерфейс в браузере (Playwright) | да |
| `npm test` | всё подряд (кроме cards и art) | да, для api/ui |

Запуск API и UI (порядок важен: сначала api, потом ui; база свежая):

```bash
rm -rf /tmp/ui-test && DB_PATH=/tmp/ui-test/app.db ADMIN_TG_IDS=999000001 npm run dev
npm run test:api && npm run test:ui
```

UI против автономной сборки: `npm run demo && node test/ui.mjs "file://$PWD/dist/luckybox.html"`.

Куда дописать проверку: ручка - `test/api.mjs`; вид и поведение -
`test/ui.mjs`; деньги на функциях базы - `test/wager.mjs`,
`test/payout-check.mjs`, `test/x2.mjs`; шлюзы - `test/sicilia.mjs`,
`test/crypto.mjs`; казино - `test/casino.mjs`.

---

## 13. Переменные окружения

Полный список с комментариями - `.env.example`; что где взять -
`deploy/SECRETS.md`. Значения в репозиторий не кладутся.

Самые важные:

| Переменная | Зачем |
|---|---|
| `DB_PATH`, `PORT`, `SITE_URL` | база, порт, адрес сайта (нужен для апелляций и писем) |
| `DEV_MODE` | выключенная авторизация, **никогда на рабочем** |
| `PAYOUT_DATA_KEY` | ключ шифрования карт, **никогда не менять** |
| `ADMIN_TG_IDS`, `ADMIN_EMAILS` | владельцы (почта только при `OPS_*`) |
| `TELEGRAM_TOKEN`, `TELEGRAM_BOT_USERNAME` | игровой бот и виджет входа |
| `OPS_BOT_TOKEN`, `OPS_OWNER_CHAT_ID`, `OPS_ALERT_CHAT_ID`, `OPS_2FA` | служебный бот (другой токен!) |
| `RESEND_API_KEY`, `MAIL_FROM`, `SMTP_URL` | письма |
| `SICILIA_MERCHANT`, `SICILIA_LOGIN`, `SICILIA_API_KEY`, `SICILIA_*` | шлюз СБП и карты |
| `HELEKET_MERCHANT`, `HELEKET_API_KEY`, `CRYPTO_*` | криптокасса |
| `DATABETRIX_AGENT_NAME`, `DATABETRIX_AGENT_TOKEN`, `CASINO_CALLBACK_IPS`, `CASINO_RTP_MIN/MAX`, `CASINO_PROVIDERS`, `CASINO_SYNC_HOURS` | казино |
| `FIRST_DEPOSIT_PCT/MAX/MIN`, `BONUS_WAGER`, `BONUS_CASHOUT_PCT` | бонусы (читаются при каждом вызове) |
| `MIN_PAYOUT`, `FORTUNE_X2_CAP`, `X10_MEDAL_OPENS`, `X10_MEDAL_CAP` | выводы и плюшки |
| `TG_CHANNEL_ID`, `TG_CHANNEL_URL`, `FREE_CASE_ID` | бесплатный кейс за подписку |
| `RATE_LIMIT_*`, `TRUST_PROXY_HOPS` | ограничитель частоты и прокси |
| `BACKUP_DIR`, `BACKUP_KEEP`, `RCLONE_REMOTE` | копии базы |

## 14. Free Money, «Начало», фриспины (октябрь 2026)

| Задача | Куда идти |
|---|---|
| Раздел Free Money целиком | `public/index.html` `#view-freemoney`; `public/app.js` `openFreeMoney`, `renderFreeMoney`, `renderDriveEvent`, `renderStartEvent`, `renderFmTabs`, `markFmTab`, `syncTopbarHeight`, `renderPromoWheel`, `takeWheelCode`, `spinPromoWheel`, `showWheelWin`, `renderBotEvent`; стили - блок «FREE MONEY: РАЗДЕЛ ИВЕНТОВ» в `styles.css` |
| Розыгрыш автомобиля (билеты) | `server/db.js` `startCaseState` (поле `raffle`), `RAFFLE_TICKET_TURNOVER`, `RAFFLE_MAX_TICKETS`, колонка `raffle_turnover`; фото `public/assets/ui/raffle-dubai.webp` (исходник `assets-src/ui/raffle-dubai.png`) |
| Бесплатный кейс «Начало» | `server/cases.js` `start_free`, `START_CASE_ID`, профиль `gift`; `server/db.js` `grantStartCase`, `startCaseRules`, `addRealTurnover`; `/api/open` отказ `START_LOCKED`; клиент `showStartGate`, `.is-gift`; тест `test/start-case.mjs` |
| Колесо удачи (промокод) | `server/promo-wheel.js` (`WHEEL_SECTORS`, `pickWheelSector`, `wheelConfig`); `redeemPromo(..., { wheel: true })`; ручка `/api/wheel/spin`; тип промокода `wheel` |
| Окно выигрыша Lucky Fortune | `public/app.js` `showFortuneWin`, разметка `#fortuneWinBackdrop`, стили `.fw-*` |
| Таблица фриспинов | `server/cases.js` `fsRtpFor`, `FS_RTP_LIFT`, `fsProbability`/`fsCumulative`, `pickItem(c, roll, true)`; клиент `weightedSample(items, 'fsProbability')` |
| Форма выплат кейсов | `server/cases.js` `BAND_STEPS`, `MID_STEPS`, `PROFILES` (`bandShare`, `midShare`) |
| Казино: «N играют», значки категорий | `public/casino.js` `livePlayers`, `liveHtml`, `ICON_TONES`, `icon`; выключатель `FEED_SYNTHETIC` (config.feed.synthetic) |
| Меню компьютера плитками | `public/app.js` `renderSideNav` (`.is-sq`, `.is-wide`, `.is-tall`); стили в последнем блоке `styles.css` |
