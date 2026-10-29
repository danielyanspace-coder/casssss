/**
 * HTTP-сервер сайта: отдаёт статику, вход и игровое API.
 *
 * Важное правило: исход считает ТОЛЬКО сервер. Клиент получает готовый
 * результат и лишь проигрывает анимацию. В краше точка взрыва вообще не
 * уходит на клиент до конца раунда, иначе игрок выводил бы ставку за
 * мгновение до взрыва.
 */

import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, writeFileSync, rmSync } from 'node:fs';

import {
  CASES, CATEGORIES, getCase, pickItem, publicCase, validateCases, TIERS,
  FREESPIN_PACKS, freeSpinPackPrice,
} from './cases.js';
import {
  CRASH_CONFIG,
  ROULETTE_CONFIG,
  ROULETTE_WHEEL,
  crashMultiplierAt,
  crashPointFromRoll,
  rouletteColorOf,
  rouletteSlotFromRoll,
  validateGames,
  GAMBLE_CONFIG,
  gambleAceFromRoll,
  validateGamble,
  UPGRADE_CONFIG,
  upgradeTarget,
  upgradeChance,
  upgradeWinFromRoll,
  validateUpgrade,
} from './games.js';
import { computeRoll, generateClientSeed } from './fair.js';
import { timingSafeEqual } from 'node:crypto';
import {
  casinoWallet, CASINO_STATUS, userBalanceRub, casinoPlayerId, casinoExcluded,
  casinoGames, casinoGame, casinoProviders, casinoHistory, casinoSummary, kopToRub, casinoHome,
  setCoverState, casinoRtp, CASINO_RTP_MIN, CASINO_RTP_MAX,
} from './casino-db.js';
import { CASINO_TABS, categoryById } from './casino-categories.js';
import { checkPayout, payoutCheck, overridePayoutCheck, payoutCleared } from './payout-check.js';
import {
  casinoEnv, casinoConfigured, startCatalogSync, syncCatalog, syncStatus, launchGame, coverFile,
} from './casino.js';
import {
  FORTUNE_SEGMENTS, SEGMENT_DEG, SEGMENTS_START_DEG, validateFortune,
  GIFT_CASE_MAX_PRICE, PERCENT_MIN, PERCENT_MAX, VOUCHER_MIN, VOUCHER_MAX, CASH_PRIZE,
} from './fortune.js';
import { limits } from './ratelimit.js';
import * as crypto from './crypto.js';
import * as sicilia from './sicilia.js';
import * as partners from './partners.js';
import * as finance from './finance.js';
import { adminDeposits, depositsSummary, depositsCsvRows, payoutsCsvRows, toCsv } from './cashdesk.js';
import {
  BONUS_CONFIG,
  claimBonus,
  finishCrashRound,
  getCrashRound,
  getHistory,
  getOrCreateUser,
  getUserById,
  playCaseRound,
  playCaseBatch,
  buyFreeSpins,
  playInstantRound,
  rotateServerSeed,
  setClientSeed,
  startCrashRound,
  getVouchers, getX2Perks, startCaseState, startCaseRules, RAFFLE_TICKET_TURNOVER, RAFFLE_MAX_TICKETS,
  fortuneState, fortuneHistory, playFortuneSpin,
  syncStaff, staffRow, staffList, staffSave, staffRemove, findUserByAnyId,
  playerNotes, addPlayerNote, deletePlayerNote,
  getPlayerLimits, setPlayerLimits, dayActivity, LIMIT_COOLDOWN_MS,
  settingsAll, setting, saveSettings,
  adminJournal, revenueDaily, caseReport as caseRevenueReport, riskSignals,
  logAdmin,
  adminOverview,
  adminUsers,
  adminUserDetail,
  adminAdjustBalance,
  adminSetBlocked,
  adminGrantVoucher,
  adminRecentRounds,
  playGamble,
  clearGamble,
  MIN_PAYOUT,
  PAYOUT_STEP,
  getDeposits,
  getPayouts,
  pendingPayoutTotal,
  lastPasswordResetAt, createPayout, withdrawable, spendable, refuseBonus, bonusRules, bonusAllowance, getBonusEvents,
  recordAccess,
  cancelPayout,
  resolvePayout,
  startPayout,
  completePayout,
  adminPayouts,
  payoutStats,
  grantFreeCase,
  freeCaseState,
  recentPublicDrops,
  redeemPromo,
  pendingDepositBonus,
  myPromoRedemptions,
  db, getPartnerForUser, isOwnerKeyed, createEmailUser, createEmailUserWithPromo, findUserByEmail, findUserByTgId,
  linkTelegram, setEmailLogin, setPasswordHash, deleteUserSessions, purgeExpiredSessions,
  createPasswordReset, usePasswordReset,
  adminSavePromo,
  wheelPromoList, createWheelPromo, setWheelPromoActive, broadcastAudience, recentBroadcasts,
  adminListPromos,
  adminDeletePromo,
  adminSavePartner,
  savePendingSpins,
  getPendingSpins,
  clearPendingSpins,
  trackEvent, funnelStats, eventTotals, CLIENT_EVENTS,
  firstDepositRules,
  getSlotSession, playSlotSpin, buySlotBonus, playSlotFreeSpin, awardSlotJackpot,
} from './db.js';
import {
  SLOTS, getSlot, publicSlot, slotCard, validateSlots,
  LINES as SLOT_LINES,
  gridFrom, evaluate as evaluateSlot, jackpotFrom, jackpotRoll, offsetsFrom,
} from './slots.js';
import { validateSkins } from './card-skins.js';
import {
  resolveUser, startSession, endSession, currentSessionHash, isSameOrigin,
  normalizeEmail, checkPassword, normalizeNick, hashPassword, verifyPassword,
  burnPasswordCheck, verifyTelegramLogin, newResetToken, resetTokenHash, RESET_TTL_MS, deviceId,
} from './auth.js';
import { isMailConfigured, sendMail } from './mailer.js';
import {
  alert, countError, inform, startOpsBot, twoFactorRequired, sessionConfirmed, twoFactorState,
  createLink, requestApproval, confirmByCode, challengeStatus,
} from './ops.js';
import {
  PERMISSIONS, PERMISSION_GROUPS, ROLES, ROLE_BY_ID, permissionsFor, balanceCapFor,
  canManage, assignableRoles, publicRoles, isPermission,
} from './staff.js';
import {
  startFeed, getFeed, FEED_CONFIG, FEED_MIN_MULTIPLIER, FEED_MIN_VALUE, FEED_PLAIN_MIN_VALUE,
  FEED_REAL_SHARE,
} from './feed.js';
import {
  isConfigured as subscriptionConfigured,
  isSubscribed,
  subscriptionConfig,
  FREE_CASE_COOLDOWN_MS,
} from './subscription.js';
import { wheelConfig } from './promo-wheel.js';
import * as broadcast from './broadcast.js';
// Если математика поехала - падаем на старте, до первого игрока.
const caseReport = validateCases();
const gameReport = validateGames();
const gambleReport = validateGamble();
const upgradeReport = validateUpgrade();
const slotReport = validateSlots();
/*
 * Опечатка в названии семейства или материала иначе всплывёт на экране
 * игрока: карточка останется без поверхности, и это заметят не сразу.
 */
const skinReport = validateSkins();
validateFortune();

// Владельцы задаются через окружение - не через базу, чтобы права нельзя
// было получить, дописав себе строку в таблицу. Ключ - Telegram ID
// (ADMIN_TG_IDS) или почта аккаунта (ADMIN_EMAILS).
const splitList = (raw) => String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
/*
 * Почта при регистрации не подтверждается, и адрес владельца не секрет: кто
 * первым зарегистрирует его, тот и стал бы владельцем панели. Поэтому почта
 * даёт права владельца только вместе со служебным ботом и закреплённым
 * Telegram владельца (OPS_BOT_TOKEN, OPS_OWNER_CHAT_ID): вход в панель тогда
 * подтверждается в его Telegram, и чужой аккаунт с той же почтой дальше
 * подтверждения не пройдёт. Telegram ID (ADMIN_TG_IDS) подлинность доказывает
 * сам и работает всегда.
 */
const OWNER_EMAILS_GUARDED = Boolean(process.env.OPS_BOT_TOKEN && process.env.OPS_OWNER_CHAT_ID);
const OWNER_KEYS = [
  ...splitList(process.env.ADMIN_TG_IDS),
  ...(OWNER_EMAILS_GUARDED ? splitList(process.env.ADMIN_EMAILS).map((e) => e.toLowerCase()) : []),
];
if (!OWNER_EMAILS_GUARDED && splitList(process.env.ADMIN_EMAILS).length && process.env.DEV_MODE !== 'true') {
  console.warn('[staff] ADMIN_EMAILS не действует без OPS_BOT_TOKEN и OPS_OWNER_CHAT_ID: '
    + 'почту никто не подтверждает, и владельцем стал бы первый, кто её зарегистрирует.');
}
syncStaff(OWNER_KEYS);

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

/*
 * Express 4 не ловит ошибки async-ручек: исключение внутри уходит в
 * unhandledRejection, ответ не отправляется, и запрос висит до таймаута
 * nginx, а игрок видит «зависшую» кнопку. Оборачиваем каждую ручку один
 * раз здесь, чтобы ошибка ушла в общий обработчик и вернулась ответом.
 * Обработчики ошибок (четыре аргумента) не трогаем: Express узнаёт их по
 * числу аргументов.
 */
const wrapAsync = (fn) => (typeof fn !== 'function' || fn.length === 4 ? fn
  : function wrapped(req, res, next) {
    const out = fn.call(this, req, res, next);
    if (out && typeof out.catch === 'function') out.catch(next);
    return out;
  });
for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
  const original = app[method].bind(app);
  app[method] = (path, ...handlers) => (handlers.length
    ? original(path, ...handlers.map(wrapAsync)) : original(path));
}

/*
 * За nginx все запросы приходят с адреса самого nginx. Без этой строки
 * ограничитель частоты считал бы всех безымянных клиентов за одного и рубил
 * бы вход целиком, а в логах стоял бы один и тот же 127.0.0.1.
 *
 * Число - сколько прокси перед приложением. Один nginx на том же сервере это
 * 1. Если добавите Cloudflare или второй балансировщик, увеличьте: доверять
 * всей цепочке (`true`) нельзя, заголовок подделывается кем угодно.
 */
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
app.disable('x-powered-by');
app.use('/api', (req, res, next) => {
  // Ответы с балансом, сессией и данными сотрудников не сохраняются в кеше.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(express.json({ limit: '8mb', verify: (req, res, buffer) => { req.rawBody = buffer.toString('utf8'); } }));
/*
 * Картинки (/assets) браузер держит неделю и ещё месяц может показывать из
 * кеша, проверяя свежесть в фоне: обложки кейсов весят мегабайты, и
 * перекачивать их каждый час значило листать главную с пустыми плитками.
 * HTML, код и стили сверяются по ETag при заходе: их меняет каждый выкат,
 * и старый клиент не должен смешиваться с новой разметкой.
 */
const ASSET_CACHE = 'public, max-age=604800, stale-while-revalidate=2592000';
app.use('/assets', express.static(join(__dirname, '..', 'public', 'assets'), {
  setHeaders: (res) => res.setHeader('Cache-Control', ASSET_CACHE),
}));
app.use(express.static(join(__dirname, '..', 'public'), {
  maxAge: '1h',
  // Без версий в URL браузер должен сверять клиент после каждого выката.
  // ETag сохраняет быстрый 304, но старый JS не смешивается с новым HTML.
  setHeaders: (res, path) => {
    if (/\.(?:html|js|css)$/.test(path)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
/*
 * Скрытый вход в панель с компьютера: в боковом меню админки нет (решение
 * заказчика), а меню телефона на широком экране не открыть. Это та же
 * страница сайта, клиент по адресу сам открывает панель. Защита не здесь:
 * без прав и подтверждения в боте /api/admin/* всё равно откажет.
 */
app.get(['/admin', '/admin/'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(join(__dirname, '..', 'public', 'index.html'));
});
// Часть браузеров и поисковых роботов просит /favicon.ico, не читая разметку.
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.png'));

function auth(req, res, next) {
  if (!isSameOrigin(req)) return res.status(403).json({ error: 'Запрос с чужой страницы' });
  const result = resolveUser(req, res);
  if (!result.ok) return res.status(401).json({ error: result.error, code: result.code });

  const player = result.user;

  /*
   * Владельцы задаются в окружении, и список сверяется при каждом запросе
   * того, кто в нём есть или должен был быть: убрали ключ из ADMIN_TG_IDS
   * или ADMIN_EMAILS - доступ пропал сразу, без перезапуска.
   *
   * Сверка идёт только для владельцев. Остальных сотрудников заводит человек
   * через панель, и переменная окружения их не касается.
   */
  const inEnv = isOwnerKeyed(player, OWNER_KEYS);
  const bootstrapRow = staffRow(player.id);
  const bootstrapMismatch = inEnv
    ? !bootstrapRow || (bootstrapRow.added_by === null && bootstrapRow.role !== 'owner')
    : !!(bootstrapRow && bootstrapRow.added_by === null);
  if (bootstrapMismatch) {
    syncStaff(OWNER_KEYS);
    req.player = getUserById(player.id);
  } else {
    req.player = player;
  }

  // Хеш сессии нужен подтверждению входа в панель: оно живёт у сессии.
  req.sessionHash = result.viaSession ? currentSessionHash(req) : '';
  req.staff = staffRow(req.player.id);
  req.perms = permissionsFor(req.staff);

  // Адрес и метка браузера: по ним проверка заявки на вывод ищет связанные
  // аккаунты. Запись редкая (раз в 10 минут на сочетание), в учёт не мешает.
  try {
    recordAccess(req.player.id, String(req.ip || '').replace(/^::ffff:/, ''),
                 deviceId(req, res), req.get('user-agent'));
  } catch { /* учёт заходов не должен ронять запрос */ }

  if (req.player.is_blocked) {
    return res.status(403).json({ error: 'Аккаунт заблокирован' });
  }
  maintenanceGate(req, res, next);
}

/**
 * Витрина без входа. Сайт открыт гостю: каталог казино и прочее, что только
 * показывается, отдаётся и без сессии. Вошедший проходит обычный auth (его
 * блокировка и права действуют), гость - только режим обслуживания.
 */
function browse(req, res, next) {
  if (resolveUser(req).ok) return auth(req, res, next);
  if (!isSameOrigin(req)) return res.status(403).json({ error: 'Запрос с чужой страницы' });
  req.perms = new Set();
  maintenanceGate(req, res, next);
}

/**
 * Режим обслуживания.
 *
 * Стоит ПОСЛЕ auth, а не до: сотрудники обязаны входить в закрытую площадку,
 * иначе включивший работы сам себя из панели и выгонит. Заглушка отдаётся
 * кодом 503, чтобы клиент отличал её от обычной ошибки.
 *
 * Список исключений короткий и не случайный: /api/me и /api/config нужны
 * клиенту, чтобы вообще показать экран с заглушкой.
 */
/**
 * Минимум вывода: настройка панели, а если её не трогали - значение сервера.
 *
 * Ноль означает «как в настройках сервера», а не «выводить можно копейку»:
 * пустое поле в панели не должно молча открывать вывод на любую сумму.
 */
function minPayoutNow() {
  return setting('min_payout') || MIN_PAYOUT;
}

const MAINTENANCE_OPEN = new Set(['/api/me', '/api/config', '/api/track']);

function maintenanceGate(req, res, next) {
  if (!setting('maintenance')) return next();
  if (req.perms && req.perms.size > 0) return next();
  if (MAINTENANCE_OPEN.has(req.path)) return next();
  return res.status(503).json({
    error: 'Идут технические работы. Загляните чуть позже',
    maintenance: true,
  });
}

/**
 * Выключатель игры из панели.
 *
 * Прятать раздел на клиенте мало: раздел открывается прямым запросом, а
 * выключают игру обычно потому, что в ней что-то не так. Поэтому отказ
 * стоит на сервере, а клиент по тому же признаку прячет вход, чтобы игрок
 * не упирался в кнопку, которая всегда ругается.
 */
function gameGate(key) {
  return (req, res, next) => {
    if (setting(`games_${key}`)) return next();
    res.status(503).json({ error: 'Игра временно недоступна' });
  };
}

/**
 * Проверка права.
 *
 * Не «пропустить админа», а именно право: дальше по коду ни одна ручка не
 * должна спрашивать про роль. Как только появляется `if (role === 'admin')`,
 * набор прав перестаёт быть правдой о том, кто что может.
 */
function need(permission) {
  return (req, res, next) => {
    if (!req.perms || !req.perms.has(permission)) {
      return res.status(403).json({ error: 'Недостаточно прав', need: permission });
    }
    adminConfirmed(req, res, next);
  };
}

/**
 * Вход в панель подтверждён в служебном боте (server/ops.js).
 *
 * Стоит внутри need() и adminOnly(), а не отдельным слоем: через них идёт
 * каждая ручка /api/admin/*, и новая ручка не может забыть проверку. Тестовый
 * игрок DEV_MODE без сессии проходит: у него нет сессии, к которой привязать
 * подтверждение, а на рабочем сервере DEV_MODE выключен.
 */
function adminConfirmed(req, res, next) {
  if (!twoFactorRequired()) return next();
  if (process.env.DEV_MODE === 'true' && !req.sessionHash) return next();
  if (sessionConfirmed(req.sessionHash)) return next();
  return res.status(403).json({ error: 'Подтвердите вход в панель в Telegram', code: 'ADMIN_2FA' });
}

/** Есть ли у человека хоть какой-то доступ в панель. */
function staffOnly(req, res, next) {
  if (!req.perms || req.perms.size === 0) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  next();
}

function adminOnly(req, res, next) {
  staffOnly(req, res, () => adminConfirmed(req, res, next));
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    firstName: user.first_name,
    // Целые рубли плюс копейки казино (users.balance_kop, см. casino-db.js).
    balance: userBalanceRub(user),
    isAdmin: !!user.is_admin,
    x2Perks: getX2Perks(user.id),
    gambleStake: user.gamble_stake,
    gambleCase: user.gamble_case,
    vouchers: getVouchers(user.id),
    // Бесплатный кейс «Начало» и билеты розыгрыша: шкалы в Free Money.
    ...startCaseState(user),
    /*
     * Бонусный счёт отдельно от своих денег. balance - свои (их показывает
     * шапка, ими играет казино, их выводят), bonusBalance - подарки, которыми
     * играют в наших играх, когда своих не хватает на ставку.
     */
    bonusBalance: user.bonus_balance || 0,
    // Сколько ещё поставить бонусными деньгами, чтобы бонус перешёл в деньги.
    wagerRequired: (user.bonus_balance || 0) > 0 ? (user.wager_required || 0) : 0,
    // Сколько бонусов ещё может перейти в деньги: доля от пополнений.
    bonusCashoutLeft: bonusAllowance(user),
    // По нему клиент решает, показывать ли предложение первого пополнения.
    depositsCount: user.deposits_count || 0,
    isPartner: Boolean(getPartnerForUser(user)),
    // Чем игрок входит: от этого зависит профиль (привязать Telegram, задать
    // пароль) и бонус за подписку на канал, который без Telegram не проверить.
    email: user.email || null,
    hasPassword: Boolean(user.password_hash),
    telegram: user.tg_id == null ? null : { username: user.username || null },
    stats: {
      rounds: user.total_rounds,
      spent: user.total_spent,
      won: user.total_won,
      bestMultiplier: Number(user.best_multiplier.toFixed(2)),
      profit: user.total_won - user.total_spent,
    },
    fair: {
      serverSeedHash: user.server_seed_hash,
      clientSeed: user.client_seed,
      nonce: user.nonce,
      prevServerSeed: user.prev_server_seed,
      prevServerHash: user.prev_server_hash,
    },
  };
}

/** Ставка должна быть целым числом в разумных границах. */
function parseBet(raw) {
  const bet = Math.floor(Number(raw));
  if (!Number.isFinite(bet) || bet < 1) return null;
  if (bet > 10_000_000) return null;
  return bet;
}

function sendInsufficient(res, need) {
  return res.status(400).json({
    error: 'INSUFFICIENT_FUNDS',
    message: `Не хватает ${need} ед.`,
  });
}

/* ============================================================
   КОНФИГ И ИГРОК
   ============================================================ */

/*
 * Проверка живости для сторожа (deploy/watchdog.mjs) и внешнего монитора.
 * Ходит в базу: процесс, который отвечает, но базу не видит, тоже сломан.
 */
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

const PUBLIC_CASE_CONFIG_JSON = JSON.stringify(CASES.map(publicCase));
let lastConfigSettings = '';
let lastPublicConfig = '';

app.get('/api/config', (req, res) => {
  const config = {
    categories: CATEGORIES,
    tiers: TIERS,
    crash: {
      rtp: CRASH_CONFIG.rtp,
      maxMultiplier: CRASH_CONFIG.maxMultiplier,
      growth: CRASH_CONFIG.growth,
    },
    roulette: {
      rtp: ROULETTE_CONFIG.rtp,
      slots: ROULETTE_CONFIG.slots,
      colors: ROULETTE_CONFIG.colors,
      wheel: ROULETTE_WHEEL,
    },
    gamble: {
      cards: GAMBLE_CONFIG.cards,
      aces: GAMBLE_CONFIG.aces,
      payout: GAMBLE_CONFIG.payout,
      chance: GAMBLE_CONFIG.chance,
      rtp: GAMBLE_CONFIG.rtp,
    },
    upgrade: {
      minStake: UPGRADE_CONFIG.minStake,
      multipliers: UPGRADE_CONFIG.multipliers,
    },
    // synthetic: выдуманные витрина и счётчики «N играют» в казино. Один
    // выключатель FEED_SYNTHETIC на всё оживление, которого нет на самом деле.
    feed: { minMultiplier: FEED_CONFIG.minMultiplier, minValue: FEED_CONFIG.minValue, synthetic: FEED_CONFIG.synthetic },
    freeCase: subscriptionConfig(),
    // Колесо удачи за промокод: сектора и их доли круга (угол = вероятность).
    promoWheel: wheelConfig(),
    // Телеграм-бот проекта: ивент в Free Money и откуда берутся коды колеса.
    projectBot: (process.env.PROJECT_BOT_USERNAME || 'Luckyboxbonus_bot').replace(/^@/, ''),
    // Розыгрыш автомобиля: условие билетов (startCaseState считает сами билеты).
    raffle: { prize: 'Rolls-Royce Wraith', step: RAFFLE_TICKET_TURNOVER, max: RAFFLE_MAX_TICKETS },
    // Кейс «Начало»: за какое пополнение и за какой оборот.
    startCase: startCaseRules(),
    // Чем можно войти. Виджет Telegram показывается, только если задан бот:
    // без его имени виджет не загрузится, а кнопка, которая не работает, хуже
    // отсутствующей. Сброс пароля - только при настроенной почте.
    auth: {
      telegramBot: process.env.TELEGRAM_TOKEN ? (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '') : '',
      mail: isMailConfigured(),
    },
    bonus: { enabled: false },
    maxBatch: MAX_BATCH,
    freeSpinPacks: FREESPIN_PACKS,
    minPayout: minPayoutNow(),
    // Выключатели из панели: клиент по ним прячет разделы, сервер по ним же
    // отказывает. Прятать без отказа нельзя - раздел открывается прямым
    // запросом; отказывать без пряток можно, но игрок будет тыкать в кнопку,
    // которая всегда ругается.
    open: {
      payouts: setting('payouts_open'),
      deposits: setting('deposits_open'),
      cases: setting('games_cases'),
      crash: setting('games_crash'),
      roulette: setting('games_roulette'),
      upgrade: setting('games_upgrade'),
      fortune: setting('games_fortune'),
      slots: setting('games_slots'),
      casino: setting('games_casino'),
    },
    // Отдача слотов казино - та же настройка, что уходит агрегатору при
    // запуске. По ней раздел «Честность» и плитки показывают число.
    casino: { rtp: casinoRtp(), configured: casinoConfigured() },
    // Условия приветственного бонуса нужны клиенту, чтобы показать их в кассе
    // до пополнения, а не после.
    // Потолок перевода бонуса в деньги нужен тексту правил: обещание без
    // него («отыграл - выводи») было бы неправдой.
    firstDeposit: { ...firstDepositRules(), cashoutPct: bonusRules().cashoutPct },
  };
  const settingsJson = JSON.stringify(config);
  if (settingsJson !== lastConfigSettings) {
    lastConfigSettings = settingsJson;
    lastPublicConfig = `{"cases":${PUBLIC_CASE_CONFIG_JSON},${settingsJson.slice(1)}`;
  }
  // В кеше только публичная конфигурация, не данные игрока. Настройки
  // сверяются на каждом запросе, переключатели панели действуют сразу.
  res.type('application/json').send(lastPublicConfig);
});

/* ============================================================
   ВИТРИНА КРУПНЫХ ВЫПАДЕНИЙ
   ============================================================ */

/**
 * Лента открыта без авторизации: она видна и до входа в Telegram.
 * Наружу уходят только ник, кейс и предмет - ни ID, ни балансов.
 */
/**
 * Оформление и рисунок для настоящего выпадения.
 *
 * В таблице раундов лежит только название предмета, а витрина показывает
 * карточку целиком. Ищем предмет в его кейсе по названию: внутри одного кейса
 * названия не повторяются (это проверяет validateCases).
 */
function withItemLook(drop) {
  const item = getCase(drop.caseId)?.items.find((it) => it.name === drop.name);
  return item ? { ...drop, skin: drop.skin || item.skin, art: drop.art || item.art } : drop;
}

app.get('/api/feed', limits.read, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 40);
  // Свои выпадения игрок должен видеть в ленте наравне с выдуманными, поэтому
  // порог тут только по сумме - тот же, ниже которого выпадение выглядит
  // поломкой, а не скромным выигрышем.
  // Доля настоящих ограничена: иначе игрок, открывший подряд четыре десятка
  // кейсов, вытесняет из витрины всё остальное - см. FEED_REAL_SHARE.
  const real = recentPublicDrops(Math.ceil(limit * FEED_REAL_SHARE), FEED_PLAIN_MIN_VALUE)
    .map(withItemLook);
  const shown = FEED_CONFIG.synthetic ? getFeed(limit) : [];

  // Настоящие выпадения идут первыми при равной свежести.
  const merged = [...real, ...shown]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);

  res.json({
    drops: merged,
    minMultiplier: FEED_MIN_MULTIPLIER,
    minValue: FEED_MIN_VALUE,
    bigShare: FEED_CONFIG.bigShare,
  });
});

app.post('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.player) });
});

/* ============================================================
   ВХОД НА САЙТ
   ============================================================
   Почта с паролем - основной способ, Telegram - второй и привязка. Ответы
   на ошибки входа намеренно одинаковые («почта или пароль не подходят»):
   по разнице в тексте перебирали бы, кто зарегистрирован. По той же причине
   «Забыли пароль» отвечает одинаково на любую почту. Регистрация открыта
   правом площадки registration_open: закрытая касается только НОВЫХ, у того,
   кто уже заходил, вход отбирать не за что. */

const authGate = (req, res, next) => (isSameOrigin(req)
  ? next() : res.status(403).json({ error: 'Запрос с чужой страницы' }));

function authError(res, err) {
  const status = err.code === 'EMAIL_TAKEN' || err.code === 'TG_TAKEN' ? 409 : 400;
  res.status(status).json({ error: err.message, code: err.code });
}

function welcome(req, res, user, created = false, extra = {}) {
  if (user.is_blocked) return res.status(403).json({ error: 'Аккаунт заблокирован' });
  startSession(req, res, user.id);
  if (!created) trackEvent(user.id, 'login');
  res.json({ ok: true, created, user: publicUser(user), ...extra });
}

app.post('/api/auth/register', authGate, limits.auth, async (req, res) => {
  try {
    if (!setting('registration_open')) {
      return res.status(403).json({ error: 'Регистрация новых игроков временно закрыта' });
    }
    const email = normalizeEmail(req.body?.email);
    const password = checkPassword(req.body?.password);
    const nick = normalizeNick(req.body?.nick);
    const { user, promo } = createEmailUserWithPromo({
      email, passwordHash: await hashPassword(password), nick,
      promo: req.body?.promo, resolveCase: promoCaseResolver,
    });
    if (promo) trackEvent(user.id, 'promo_redeemed', { type: promo.type });
    welcome(req, res, user, true, { promo });
  } catch (err) {
    authError(res, err);
  }
});

/*
 * Неудачные входы на одну почту. Лимит по адресу (limits.auth, nginx) не
 * мешает перебирать пароль одного аккаунта с сотни адресов. После
 * LOGIN_FAIL_MAX неудач за LOGIN_FAIL_WINDOW_MS почта закрывается для входа
 * до конца окна. Считаем и несуществующие почты: иначе по разнице ответов
 * было бы видно, кто зарегистрирован. Память процесса, а не база: после
 * перезапуска счёт начинается заново, и это допустимо.
 */
const LOGIN_FAIL_MAX = 10;
const LOGIN_FAIL_WINDOW_MS = 30 * 60_000;
const loginFails = new Map();
function loginLocked(email, now = Date.now()) {
  const f = loginFails.get(email);
  if (!f || now - f.first > LOGIN_FAIL_WINDOW_MS) { loginFails.delete(email); return false; }
  return f.count >= LOGIN_FAIL_MAX;
}
function loginFailed(email, now = Date.now()) {
  const f = loginFails.get(email);
  if (!f || now - f.first > LOGIN_FAIL_WINDOW_MS) loginFails.set(email, { first: now, count: 1 });
  else f.count += 1;
  if (loginFails.size > 50_000) loginFails.clear();
}

app.post('/api/auth/login', authGate, limits.auth, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (email && loginLocked(email)) {
    return res.status(429).json({ error: 'Слишком много попыток входа. Подождите полчаса или восстановите пароль', code: 'LOGIN_LOCKED' });
  }
  const user = email ? findUserByEmail(email) : null;
  if (!user || !user.password_hash) {
    await burnPasswordCheck(password);
    if (email) loginFailed(email);
    return res.status(401).json({ error: 'Почта или пароль не подходят', code: 'LOGIN' });
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    loginFailed(email);
    return res.status(401).json({ error: 'Почта или пароль не подходят', code: 'LOGIN' });
  }
  loginFails.delete(email);
  welcome(req, res, user);
});

app.post('/api/auth/telegram', authGate, limits.auth, (req, res) => {
  const check = verifyTelegramLogin(req.body?.data, process.env.TELEGRAM_TOKEN);
  if (!check.ok) return res.status(401).json({ error: check.error, code: 'TG' });
  const existing = findUserByTgId(check.user.id);
  if (!existing && !setting('registration_open')) {
    return res.status(403).json({ error: 'Регистрация новых игроков временно закрыта' });
  }
  welcome(req, res, getOrCreateUser(check.user), !existing);
});

app.post('/api/auth/logout', authGate, (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

/** Привязать Telegram к аккаунту, заведённому по почте. */
app.post('/api/auth/link-telegram', auth, limits.auth, (req, res) => {
  const check = verifyTelegramLogin(req.body?.data, process.env.TELEGRAM_TOKEN);
  if (!check.ok) return res.status(401).json({ error: check.error, code: 'TG' });
  try {
    const user = linkTelegram(req.player.id, check.user);
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    authError(res, err);
  }
});

/**
 * Почта и пароль для пришедшего через Telegram, или смена пароля.
 * Смена требует текущий пароль: открытая на чужом компьютере вкладка не
 * должна позволять увести аккаунт.
 */
app.post('/api/auth/password', auth, limits.auth, async (req, res) => {
  try {
    const password = checkPassword(req.body?.password);
    const player = req.player;
    if (player.password_hash) {
      if (!(await verifyPassword(req.body?.current, player.password_hash))) {
        return res.status(401).json({ error: 'Текущий пароль не подходит', code: 'LOGIN' });
      }
      setPasswordHash(player.id, await hashPassword(password));
    } else {
      const email = normalizeEmail(req.body?.email);
      setEmailLogin(player.id, email, await hashPassword(password));
    }
    deleteUserSessions(player.id, currentSessionHash(req));
    res.json({ ok: true, user: publicUser(getUserById(player.id)) });
  } catch (err) {
    authError(res, err);
  }
});

/** Адрес сайта для ссылок в письмах: из окружения, а не из заголовка Host. */
function siteUrl() {
  return String(process.env.SITE_URL || process.env.WEBAPP_URL || `http://localhost:${process.env.PORT || 3000}`)
    .replace(/\/+$/, '');
}

const RESET_RESEND_MS = 5 * 60_000;
app.post('/api/auth/forgot', authGate, limits.auth, async (req, res) => {
  if (!isMailConfigured()) {
    return res.status(503).json({ error: 'Восстановление по почте пока недоступно, напишите в поддержку' });
  }
  const done = () => res.json({ ok: true, message: 'Если почта зарегистрирована, письмо уже в пути' });
  let email;
  try { email = normalizeEmail(req.body?.email); } catch (err) { return authError(res, err); }
  const user = findUserByEmail(email);
  if (!user) return done();
  // Одно письмо на почту раз в RESET_RESEND_MS: лимит по адресу не мешает
  // засыпать чужой ящик письмами с разных адресов и выжечь суточную квоту
  // почтового сервиса, после чего сброс перестал бы работать у всех. Ответ
  // тот же, что и на отправку: по нему нельзя понять, есть ли такая почта.
  if (Date.now() - lastPasswordResetAt(user.id) < RESET_RESEND_MS) return done();
  const { token, tokenHash } = newResetToken();
  createPasswordReset(user.id, tokenHash, RESET_TTL_MS);
  try {
    await sendMail({
      to: email,
      subject: 'LUCKYBOX: восстановление пароля',
      text: `Чтобы задать новый пароль, откройте ссылку:\n${siteUrl()}/?reset=${token}\n\n`
        + 'Ссылка действует час. Если вы не просили сброс, просто удалите это письмо.',
    });
  } catch (err) {
    console.error('Письмо сброса не ушло:', err.message);
    alert('mail', `Почта: письмо сброса пароля не ушло (${err.message}). Проверьте RESEND_API_KEY и домен в Resend.`);
    return res.status(502).json({ error: 'Письмо не отправилось, попробуйте позже' });
  }
  done();
});

app.post('/api/auth/reset', authGate, limits.auth, async (req, res) => {
  try {
    const password = checkPassword(req.body?.password);
    const user = usePasswordReset(resetTokenHash(String(req.body?.token || '')), await hashPassword(password));
    welcome(req, res, user);
  } catch (err) {
    authError(res, err);
  }
});

// Просроченные сессии и ссылки сброса не нужны никому, но копились бы вечно.
const SESSION_PURGE_MS = 60 * 60 * 1000;
setInterval(purgeExpiredSessions, SESSION_PURGE_MS).unref();

/**
 * События, которые может отправить только клиент: заход в кассу, упор в
 * нехватку средств, пройденный онбординг. Сервер о них не знает - они
 * происходят целиком в интерфейсе.
 *
 * Имя проверяется по белому списку CLIENT_EVENTS, а свойства не принимаются
 * вовсе: иначе в таблицу можно было бы насыпать что угодно и любого размера.
 * Ограничитель тот же, что у чтения: событие дешевле любого запроса к базе.
 */
app.post('/api/track', auth, limits.read, (req, res) => {
  const name = String(req.body?.name || '');
  if (!CLIENT_EVENTS.has(name)) return res.status(400).json({ error: 'Неизвестное событие' });
  trackEvent(req.player.id, name);
  res.json({ ok: true });
});

/* ============================================================
   КЕЙСЫ
   ============================================================ */

/**
 * Несколько серий фриспинов одной пачки - одна серия для показа.
 *
 * Только склейка: каждая серия уже посчитана и зачислена в транзакции своего
 * открытия. Бонуса за совпадение нет - он не входит в отдачу кейса. Та же
 * функция стоит в public/app.js, клиент склеивает свежий ответ сам.
 */
function mergeFreeSpinGrants(grants) {
  if (grants.length === 1) return grants[0];
  return {
    type: 'freespins',
    caseId: grants[0].caseId,
    count: grants.reduce((n, g) => n + (g.count || g.spins.length), 0),
    capped: grants.some((g) => g.capped),
    spins: grants.flatMap((g) => g.spins),
    total: grants.reduce((n, g) => n + (g.total || 0), 0),
    parts: grants.map((g) => g.count || g.spins.length),
  };
}

/**
 * Сколько одинаковых кейсов можно открыть за раз.
 *
 * Два - решение заказчика. Сначала было пять, но пять лент приходилось
 * сжимать втрое, и предмет на них было не разглядеть; потом три, теперь две:
 * обе ленты в полный размер и целиком на экране телефона вместе с итогом.
 */
const MAX_BATCH = 2;

app.post('/api/open', auth, limits.play, gameGate('cases'), (req, res) => {
  const caseData = getCase(req.body?.caseId);
  if (!caseData) return res.status(404).json({ error: 'Кейс не найден' });

  // Сезонный кейс до даты старта не открывается. Проверка именно здесь, на
  // сервере: спрятать кнопку в интерфейсе мало, запрос можно послать напрямую.
  if (caseData.availableFrom && Date.now() < caseData.availableFrom) {
    const starts = new Date(caseData.availableFrom).toLocaleDateString('ru-RU');
    return res.status(403).json({ error: `Кейс откроется ${starts}` });
  }

  let count = Math.min(MAX_BATCH, Math.max(1, Math.trunc(Number(req.body?.count) || 1)));

  const user = req.player;
  const vouchers = getVouchers(user.id).find((v) => v.case_id === caseData.id)?.count || 0;

  /*
   * Бесплатный кейс открывается только подарком, по одному. Без подарка -
   * отказ с условием: клиент рисует по нему сцену «пополни от 100 ₽» или
   * шкалу оборота. Цена кейса - номинал решателя, списать её нельзя.
   */
  if (caseData.free) {
    if (vouchers <= 0) {
      const st = startCaseState(user).startCase;
      return res.status(403).json({ error: st.needDeposit
        ? `Пополните баланс от ${st.minDeposit} ₽, и этот кейс ваш бесплатно`
        : `Поставьте ещё ${st.step - st.progress} ₽, и кейс снова ваш`, code: 'START_LOCKED', startCase: st });
    }
    count = 1;
  }
  // Ваучеры покрывают первые открытия пачки, остальное оплачивается балансом.
  const payable = Math.max(0, count - vouchers);
  const need = payable * caseData.price;

  if (spendable(user) < need) return sendInsufficient(res, need - spendable(user));

  let results;
  try {
    results = playCaseBatch(user.id, caseData, count, (serverSeed, clientSeed, nonce) => {
      const roll = computeRoll(serverSeed, clientSeed, nonce);
      return { item: pickItem(caseData, roll), roll };
    }, (serverSeed, clientSeed, nonce) => {
      // Фриспин крутит свою таблицу: крупное в серии выпадает чаще.
      const roll = computeRoll(serverSeed, clientSeed, nonce);
      return { item: pickItem(caseData, roll, true), roll };
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_FUNDS') return sendInsufficient(res, need - spendable(user));
    throw err;
  }

  const opened = results.map((result) => ({
    item: {
      id: result.item.id,
      name: result.item.name,
      kind: result.item.kind,
      value: result.payout,
      tier: result.item.tier,
      // Без оформления выигрышная плитка ленты рисовалась видом кейса, а та же
      // карточка в составе - видом предмета, и игрок видел два разных приза.
      skin: result.item.skin,
      art: result.item.art,
      perkLabel: result.item.perkLabel,
      multiplier: Number((result.payout / caseData.price).toFixed(2)),
      // Номинал предмета до удвоителя. Лента показывает его, а удвоение
      // играется отдельно, когда она встала: на плитке стоит та же сумма,
      // что в составе кейса, и видно, что именно добавил удвоитель.
      baseValue: result.item.value,
    },
    granted: result.granted.map((g) => ({
      ...g,
      caseName: g.caseId ? getCase(g.caseId)?.name : undefined,
    })),
    free: result.free,
    x2Applied: result.x2Applied,
    net: result.totalPayout - (result.free ? 0 : caseData.price),
    fair: { roll: result.roll, nonce: result.nonce },
  }));

  const last = results[results.length - 1];

  // Выпавшая серия тоже может остаться недосмотренной. Серии с разных лент
  // пачки клиент показывает одной общей, и сохраняется она так же: раньше
  // хранилась только последняя, и вышедший посреди двойной серии игрок при
  // возвращении видел половину.
  const pending = opened.flatMap((o) => o.granted).filter((g) => g.type === 'freespins');
  if (pending.length) savePendingSpins(user.id, caseData.id, mergeFreeSpinGrants(pending));

  // Выигрыш фриспинов реально зачислен на баланс в той же транзакции, что и
  // сам предмет, - его нельзя терять при подсчёте суммы пачки, иначе итог
  // на экране разойдётся с тем, что реально начислено.
  const freeSpinsTotal = (o) =>
    o.granted.find((g) => g.type === 'freespins')?.total || 0;

  trackEvent(user.id, 'case_open', { caseId: caseData.id, count, price: caseData.price });

  res.json({
    count,
    opened,
    // Поля одиночного открытия сохранены: на них опирается вся анимация.
    ...opened[0],
    totalSpent: opened.reduce((s, o) => s + (o.free ? 0 : caseData.price), 0),
    totalWon: opened.reduce((s, o) => s + o.item.value + freeSpinsTotal(o), 0),
    balance: last.balance,
    user: publicUser(getUserById(user.id)),
  });
});

/**
 * Покупка серии фриспинов.
 *
 * Цену считает сервер, клиент её только показывает: иначе подобранным запросом
 * можно было бы купить серию за свою цену.
 */
app.post('/api/freespins/buy', auth, limits.play, gameGate('cases'), (req, res) => {
  const caseData = getCase(req.body?.caseId);
  if (!caseData) return res.status(404).json({ error: 'Кейс не найден' });

  if (caseData.availableFrom && Date.now() < caseData.availableFrom) {
    const starts = new Date(caseData.availableFrom).toLocaleDateString('ru-RU');
    return res.status(403).json({ error: `Кейс откроется ${starts}` });
  }

  if (caseData.free) return res.status(400).json({ error: 'В этом кейсе фриспины не продаются' });
  const count = Math.trunc(Number(req.body?.count));
  const cost = freeSpinPackPrice(caseData, count);
  if (!cost) return res.status(400).json({ error: 'Такой пачки нет' });

  const user = req.player;
  if (spendable(user) < cost) return sendInsufficient(res, cost - spendable(user));

  let result;
  try {
    result = buyFreeSpins(user.id, caseData, count, cost,
      (serverSeed, clientSeed, nonce) => {
        const roll = computeRoll(serverSeed, clientSeed, nonce);
        return { item: pickItem(caseData, roll, true), roll };
      });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_FUNDS') return sendInsufficient(res, cost - spendable(user));
    throw err;
  }

  const grant = {
    type: 'freespins',
    caseId: caseData.id,
    count: result.count,
    capped: result.capped,
    spins: result.spins,
    total: result.total,
  };

  // Серию запоминаем до того, как игрок её досмотрит: закроет кейс на середине
  // - при следующем заходе она доиграется, а не пропадёт.
  savePendingSpins(user.id, caseData.id, grant);
  trackEvent(user.id, 'freespins_bought', { caseId: caseData.id, count: result.count, cost: result.cost });

  res.json({
    // Форма ответа повторяет выдачу фриспинов из кейса: клиент проигрывает их
    // той же анимацией, что и выпавшие.
    grant,
    cost: result.cost,
    balance: result.balance,
    user: publicUser(getUserById(user.id)),
  });
});

/* ============================================================
   РУЛЕТКА
   ============================================================ */

app.post('/api/roulette', auth, limits.play, gameGate('roulette'), (req, res) => {
  const bet = parseBet(req.body?.bet);
  const color = String(req.body?.color || '');

  if (!bet) return res.status(400).json({ error: 'Некорректная ставка' });
  if (!ROULETTE_CONFIG.payouts[color]) {
    return res.status(400).json({ error: 'Некорректный цвет' });
  }

  const user = req.player;
  if (spendable(user) < bet) return sendInsufficient(res, bet - spendable(user));

  let result;
  try {
    result = playInstantRound(user.id, bet, (serverSeed, clientSeed, nonce) => {
      const roll = computeRoll(serverSeed, clientSeed, nonce);
      const slot = rouletteSlotFromRoll(roll);
      const landed = rouletteColorOf(slot);
      const won = landed === color;
      // Выплата целыми рублями вниз: ×1.5 на нечётной ставке давал дробь, а
      // зачисление округляло её вверх, и ставка в 1 ₽ платила 2 (отдача 93%).
      const payout = won ? Math.floor(bet * ROULETTE_CONFIG.payouts[color]) : 0;

      return {
        game: 'roulette',
        title: 'Рулетка',
        subtitle: won
          ? `${labelOf(landed)} - забрал ${payout}`
          : `${labelOf(landed)} - мимо`,
        payout,
        tier: won ? (landed === 'green' ? 'unique' : 'epic') : 'common',
        roll,
        slot,
        landed,
        won,
        // Ставка на цвет: по ней проверка заявки на вывод пересчитывает исход.
        meta: { color },
      };
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_FUNDS') return sendInsufficient(res, bet - spendable(user));
    throw err;
  }

  res.json({
    slot: result.slot,
    landed: result.landed,
    won: result.won,
    payout: result.payout,
    net: result.payout - bet,
    balance: result.balance,
    fair: { roll: result.roll, nonce: result.nonce },
    user: publicUser(getUserById(user.id)),
  });
});

function labelOf(colorId) {
  return ROULETTE_CONFIG.colors.find((c) => c.id === colorId)?.label || colorId;
}

/* ============================================================
   КРАШ
   ============================================================ */

app.post('/api/crash/start', auth, limits.play, gameGate('crash'), (req, res) => {
  const bet = parseBet(req.body?.bet);
  if (!bet) return res.status(400).json({ error: 'Некорректная ставка' });

  const user = req.player;
  if (spendable(user) < bet) return sendInsufficient(res, bet - spendable(user));

  let round;
  try {
    round = startCrashRound(user.id, bet, (serverSeed, clientSeed, nonce) => {
      const roll = computeRoll(serverSeed, clientSeed, nonce);
      return { crashPoint: crashPointFromRoll(roll), roll };
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_FUNDS') return sendInsufficient(res, bet - spendable(user));
    throw err;
  }

  // crashPoint намеренно не отдаём - иначе клиент знал бы будущее.
  res.json({
    roundId: round.roundId,
    startedAt: round.startedAt,
    serverTime: Date.now(),
    bet,
    balance: round.balance,
    user: publicUser(getUserById(user.id)),
  });
});

/**
 * Опрос состояния раунда. Клиент дёргает это каждые ~150 мс, чтобы узнать,
 * не взорвалось ли - раньше времени точку краша он получить не может.
 */
app.post('/api/crash/state', auth, (req, res) => {
  const round = getCrashRound(Number(req.body?.roundId), req.player.id);
  if (!round) return res.status(404).json({ error: 'Раунд не найден' });

  if (round.status !== 'running') {
    return res.json({
      status: round.status,
      crashPoint: round.crash_point,
      cashedAt: round.cashed_at,
    });
  }

  const elapsed = Date.now() - round.started_at;
  const current = crashMultiplierAt(elapsed);

  if (current >= round.crash_point) {
    const result = finishCrashRound(round.id, req.player.id, 'busted', null);
    return res.json({
      status: 'busted',
      crashPoint: round.crash_point,
      payout: 0,
      balance: result?.balance ?? getUserById(req.player.id).balance,
      user: publicUser(getUserById(req.player.id)),
    });
  }

  res.json({
    status: 'running',
    multiplier: Number(current.toFixed(2)),
    elapsed,
  });
});

app.post('/api/crash/cashout', auth, limits.play, (req, res) => {
  const round = getCrashRound(Number(req.body?.roundId), req.player.id);
  if (!round) return res.status(404).json({ error: 'Раунд не найден' });
  if (round.status !== 'running') {
    return res.status(400).json({ error: 'Раунд уже завершён', status: round.status });
  }

  // Момент вывода считается по часам сервера, а не по тому, что прислал клиент.
  const elapsed = Date.now() - round.started_at;
  const current = crashMultiplierAt(elapsed);

  if (current >= round.crash_point) {
    const result = finishCrashRound(round.id, req.player.id, 'busted', null);
    return res.json({
      status: 'busted',
      crashPoint: round.crash_point,
      payout: 0,
      balance: result?.balance ?? getUserById(req.player.id).balance,
      user: publicUser(getUserById(req.player.id)),
    });
  }

  // Вниз до сотых, а не по правилам округления: 1.996 при взрыве на 2.00 не
  // должно стать выводом ровно в точке взрыва и выплатой выше положенной.
  const cashedAt = Math.floor(current * 100 + 1e-9) / 100;
  const result = finishCrashRound(round.id, req.player.id, 'cashed', cashedAt);
  if (!result) return res.status(400).json({ error: 'Раунд уже завершён' });

  res.json({
    status: 'cashed',
    cashedAt,
    payout: result.payout,
    crashPoint: round.crash_point,
    net: result.payout - round.bet,
    balance: result.balance,
    user: publicUser(getUserById(req.player.id)),
  });
});

/**
 * Незавершённая серия фриспинов.
 *
 * Деньги за неё уже на балансе, поэтому это только показ: клиент доигрывает
 * прокруты и подтверждает через /api/freespins/ack.
 */
app.post('/api/freespins/pending', auth, (req, res) => {
  res.json({ pending: getPendingSpins(req.player.id) });
});

app.post('/api/freespins/ack', auth, (req, res) => {
  clearPendingSpins(req.player.id);
  res.json({ ok: true });
});

/* ============================================================
   ПРОМОКОДЫ
   ============================================================ */

/** Кейс для промокода описывается ровно тем, что нужно хранилищу. */
function promoCaseResolver(caseId) {
  const c = getCase(caseId);
  return c ? { name: c.name, price: c.price, rtp: c.rtp } : null;
}

app.post('/api/promo/redeem', auth, limits.guess, (req, res) => {
  let result;
  try {
    result = redeemPromo(req.player.id, req.body?.code, promoCaseResolver);
  } catch (err) {
    if (err.code === 'PROMO' || err.code === 'BAD') {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

  trackEvent(req.player.id, 'promo_redeemed', { type: result?.type });
  res.json({ result, user: publicUser(getUserById(req.player.id)) });
});

/** Прокрут «Колеса удачи» промокодом (server/promo-wheel.js). */
app.post('/api/wheel/spin', auth, limits.guess, (req, res) => {
  let result;
  try {
    result = redeemPromo(req.player.id, req.body?.code, promoCaseResolver, { wheel: true });
  } catch (err) {
    if (err.code === 'PROMO' || err.code === 'BAD') return res.status(400).json({ error: err.message });
    throw err;
  }
  trackEvent(req.player.id, 'promo_redeemed', { type: 'wheel' });
  res.json({ result, user: publicUser(getUserById(req.player.id)) });
});

/** Всё, что показывается в Free Money: промокоды, ожидающий процент, отыгрыш. */
app.post('/api/promo/state', auth, (req, res) => {
  res.json({
    pendingDeposit: pendingDepositBonus(req.player.id),
    history: myPromoRedemptions(req.player.id),
    // Отыгрыш имеет смысл, только пока на бонусном счёте что-то есть.
    wagerRequired: (req.player.bonus_balance || 0) > 0 ? (req.player.wager_required || 0) : 0,
    bonusBalance: req.player.bonus_balance || 0,
  });
});

/* ============================================================
   ПАРТНЁРУ
   ============================================================ */

/*
 * Партнёрский кабинет живёт отдельным сайтом по адресу /partners
 * (public/partners/, расчёты - server/partners.js). Вход тот же, что на сайте:
 * та же сессия и та же почта, поэтому партнёр-игрок не заводит второй пароль,
 * а владелец входит в кабинет тем же аккаунтом и с тем же подтверждением в
 * Telegram (need() на каждой ручке /api/pc/admin/*).
 */
function partnerOnly(req, res, next) {
  const p = partners.partnerOfUser(req.player.id);
  if (!p) return res.status(403).json({ error: 'Вы не партнёр', code: 'NOT_PARTNER' });
  req.partner = p;
  next();
}

function pcError(res, err) {
  const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'EMAIL_TAKEN' || err.code === 'TAKEN' ? 409
    : err.code === 'BLOCKED' || err.code === 'CLOSED' ? 403 : 400;
  if (!err.code) throw err;
  res.status(status).json({ error: err.message, code: err.code });
}

/* Старый экран партнёра на сайте: те же деньги, что и в кабинете. */
app.post('/api/partner/stats', auth, limits.read, partnerOnly, (req, res) => {
  res.json(partners.dashboard(req.partner.id, { days: 30 }));
});

app.post('/api/pc/me', auth, limits.read, (req, res) => {
  const p = partners.partnerOfUser(req.player.id);
  res.json({
    user: { id: req.player.id, email: req.player.email || null, nick: req.player.first_name || req.player.username || '' },
    partner: partners.publicPartner(p && partners.partnerById(p.id)),
    staff: req.perms.size ? { permissions: [...req.perms], twoFactor: twoFactorState(req.player.id, req.sessionHash) } : null,
    rules: partners.rulesNow(),
  });
});

app.post('/api/pc/register', authGate, limits.auth, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = checkPassword(req.body?.password);
    const { user } = partners.registerPartner({
      email, passwordHash: await hashPassword(password), name: req.body?.name, contact: req.body?.contact,
    });
    trackEvent(user.id, 'signup');
    startSession(req, res, user.id);
    res.json({ ok: true });
  } catch (err) { pcError(res, err); }
});

app.post('/api/pc/join', auth, limits.auth, (req, res) => {
  try { res.json({ partner: partners.publicPartner(partners.joinAsPartner(req.player.id, req.body || {})) }); }
  catch (err) { pcError(res, err); }
});

app.post('/api/pc/dashboard', auth, limits.read, partnerOnly, (req, res) => {
  res.json(partners.dashboard(req.partner.id, { days: req.body?.days }));
});

app.post('/api/pc/profile', auth, limits.auth, partnerOnly, (req, res) => {
  try { res.json({ partner: partners.publicPartner(partners.updateProfile(req.partner.id, req.body || {})) }); }
  catch (err) { pcError(res, err); }
});

app.post('/api/pc/promo/create', auth, limits.auth, partnerOnly, (req, res) => {
  try { res.json(partners.createPromo(req.partner.id, req.body?.code)); }
  catch (err) { pcError(res, err); }
});

app.post('/api/pc/promo/toggle', auth, limits.auth, partnerOnly, (req, res) => {
  try { res.json(partners.setPromoActive(req.partner.id, req.body?.id, !!req.body?.active)); }
  catch (err) { pcError(res, err); }
});

/*
 * Вывод партнёра - USDT по тому же курсу, что вывод игрока (Rapira плюс
 * наценка, crypto.payoutRate): курс один на проект. Нет курса - заявку не
 * принимаем, иначе монет посчитать не из чего.
 */
app.post('/api/pc/payout/quote', auth, limits.read, partnerOnly, async (req, res) => {
  res.json({ rate: await crypto.payoutRate('USDT') });
});

app.post('/api/pc/payout', auth, limits.auth, partnerOnly, async (req, res) => {
  const rate = await crypto.payoutRate('USDT');
  if (!(rate > 0)) return res.status(503).json({ error: 'Курс USDT сейчас недоступен, попробуйте через минуту' });
  try {
    const r = partners.requestPayout(req.partner.id, req.body || {}, rate);
    alert(`partner:payout:${r.id}`, `Запрос партнёра «${req.partner.name || req.partner.id}» на вывод ${r.amount} ₽`
      + ` (${r.usdt} USDT). Кабинет /partners -> Заявки.`);
    res.json(r);
  } catch (err) { pcError(res, err); }
});

app.post('/api/pc/payout/cancel', auth, limits.auth, partnerOnly, (req, res) => {
  try { res.json(partners.cancelPayout(req.partner.id, req.body?.id)); }
  catch (err) { pcError(res, err); }
});

/* ---------- Кабинет: админ ---------- */

app.post('/api/pc/admin/overview', auth, need('partners.view'), (req, res) => {
  res.json(partners.adminOverview({ days: req.body?.days }));
});

app.post('/api/pc/admin/partner', auth, need('partners.view'), (req, res) => {
  try {
    const id = Number(req.body?.id);
    res.json({ ...partners.dashboard(id, { days: req.body?.days }), shares: partners.shareHistory(id) });
  } catch (err) { pcError(res, err); }
});

app.post('/api/pc/admin/share', auth, need('partners.edit'), (req, res) => {
  try {
    // Обе стороны - по номеру из списка или по ключу, который ввёл человек.
    const pick = (key, id) => (key != null && key !== '' ? partners.findPartner(key) : partners.partnerById(id));
    const source = pick(req.body?.sourceKey, req.body?.sourceId);
    const benef = pick(req.body?.beneficiaryKey, req.body?.beneficiaryId);
    if (!source || !benef) return res.status(404).json({ error: 'Партнёр не найден: номер, почта или имя' });
    res.json(partners.setShare(req.player.id, benef.id, source.id, req.body?.pct));
  } catch (err) { pcError(res, err); }
});

app.post('/api/pc/admin/status', auth, need('partners.edit'), (req, res) => {
  try { res.json(partners.setStatus(req.player.id, Number(req.body?.id), String(req.body?.status || ''))); }
  catch (err) { pcError(res, err); }
});

app.post('/api/pc/admin/payouts', auth, need('partners.view'), (req, res) => {
  res.json({ rows: partners.adminPayouts({ status: String(req.body?.status || 'pending') }) });
});

app.post('/api/pc/admin/payout/resolve', auth, need('partners.pay'), (req, res) => {
  try { res.json(partners.resolvePayout(req.player.id, Number(req.body?.id), req.body || {})); }
  catch (err) { pcError(res, err); }
});

app.post('/api/pc/admin/payout/manual', auth, need('partners.pay'), (req, res) => {
  try { res.json(partners.manualPayout(req.player.id, Number(req.body?.partnerId), req.body?.amount, req.body?.comment)); }
  catch (err) { pcError(res, err); }
});

/*
 * Сверка с Sicilia. Баланс, который показывает сам шлюз, спрашивается здесь
 * же: рядом с нашим расчётом он и нужен. Шлюз не ответил - расчёт всё равно
 * отдаётся, с текстом ошибки вместо их числа.
 */
app.post('/api/pc/admin/finance/sicilia', auth, need('finance.reports'), async (req, res) => {
  let gateway = null;
  let gatewayError = '';
  if (sicilia.isConfigured()) {
    try { gateway = await sicilia.gatewayBalance(); } catch (err) { gatewayError = err.message; }
  } else gatewayError = 'Ключи Sicilia не заданы';
  try {
    res.json({
      ledger: finance.siciliaLedger({ days: req.body?.days, day: req.body?.day }),
      owed: finance.siciliaOwed(),
      issues: finance.siciliaIssues(),
      gateway, gatewayError,
      canSettle: req.perms.has('finance.settle'),
    });
  } catch (err) { pcError(res, err); }
});

app.post('/api/pc/admin/finance/cash', auth, need('finance.reports'), (req, res) => {
  res.json(finance.cashSummary({ days: req.body?.days }));
});

app.post('/api/pc/admin/finance/settle', auth, need('finance.settle'), (req, res) => {
  try { res.json(finance.addSettlement(req.player.id, req.body || {})); }
  catch (err) { pcError(res, err); }
});

app.post('/api/pc/admin/finance/settle/void', auth, need('finance.settle'), (req, res) => {
  try { res.json(finance.voidSettlement(req.player.id, req.body?.id)); }
  catch (err) { pcError(res, err); }
});

app.post('/api/pc/admin/finance/export', auth, need('finance.reports'), (req, res) => {
  const days = Math.min(366, Math.max(1, Number(req.body?.days) || 30));
  const { head, rows } = finance.siciliaCsvRows(days);
  logAdmin(req.player.id, 0, 'export', { note: 'sicilia-ledger', meta: { days, rows: rows.length } });
  res.type('text/csv; charset=utf-8').send(toCsv(head, rows));
});

/* Настройки программы и комиссий шлюза - те же, что в панели, только свои группы. */
const PC_SETTING_GROUPS = new Set(['Партнёры', 'Sicilia']);
/*
 * Промокоды Колеса удачи в кабинете: один код - один прокрут на игрока.
 * Права те же, что у промокодов в панели сайта.
 */
app.post('/api/pc/admin/wheel', auth, need('promo.view'), (req, res) => {
  res.json({
    rows: wheelPromoList(),
    wheel: wheelConfig(),
    bot: {
      configured: broadcast.isConfigured(),
      username: (process.env.PROJECT_BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
      audience: broadcastAudience(),
      recent: recentBroadcasts(5),
    },
  });
});

/*
 * «Разместить промокод»: дневной код уходит ботом всем подписчикам. Только
 * живой код колеса - разосланный выключенный или израсходованный код
 * собрал бы тысячу жалоб «не работает».
 */
app.post('/api/pc/admin/wheel/broadcast', auth, need('promo.edit'), (req, res) => {
  const row = wheelPromoList().find((r) => r.id === Number(req.body?.id));
  if (!row) return res.status(404).json({ error: 'Код не найден' });
  const now = Date.now();
  if (!row.is_active || (row.expires_at && row.expires_at < now) || (row.max_uses && row.used_count >= row.max_uses)) {
    return res.status(400).json({ error: 'Код не работает: включите его или заведите новый' });
  }
  try { res.json({ broadcast: broadcast.startDailyPromo(req.player.id, row.code) }); }
  catch (err) { pcError(res, err); }
});

app.post('/api/pc/admin/wheel/create', auth, need('promo.edit'), (req, res) => {
  try { res.json(createWheelPromo(req.player.id, req.body || {})); }
  catch (err) { pcError(res, err); }
});

app.post('/api/pc/admin/wheel/toggle', auth, need('promo.edit'), (req, res) => {
  try { res.json(setWheelPromoActive(req.player.id, req.body?.id, !!req.body?.active)); }
  catch (err) { pcError(res, err); }
});

app.post('/api/pc/admin/settings', auth, need('settings.manage'), (req, res) => {
  res.json({ rows: settingsAll().filter((r) => PC_SETTING_GROUPS.has(r.group)) });
});

app.post('/api/pc/admin/settings/save', auth, need('settings.manage'), (req, res) => {
  const patch = Object.fromEntries(Object.entries(req.body?.patch || {})
    .filter(([k]) => settingsAll().some((r) => r.key === k && PC_SETTING_GROUPS.has(r.group))));
  res.json({ rows: saveSettings(req.player.id, patch).filter((r) => PC_SETTING_GROUPS.has(r.group)) });
});

/* ============================================================
   АДМИНКА: ПРОМОКОДЫ И ПАРТНЁРЫ
   ============================================================ */

app.post('/api/admin/promos', auth, need('promo.view'), (req, res) => {
  res.json({ rows: adminListPromos(), cases: CASES.map((c) => ({ id: c.id, name: c.name, price: c.price })) });
});

app.post('/api/admin/promo/save', auth, need('promo.edit'), (req, res) => {
  try {
    res.json(adminSavePromo(req.player.id, req.body || {}));
  } catch (err) {
    if (err.code === 'BAD') return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/promo/delete', auth, need('promo.edit'), (req, res) => {
  try {
    res.json(adminDeletePromo(req.player.id, Number(req.body?.id)));
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/partners', auth, need('partners.view'), (req, res) => {
  res.json({ rows: partners.adminOverview().rows });
});

app.post('/api/admin/partner/save', auth, need('partners.edit'), (req, res) => {
  try {
    res.json(adminSavePartner(req.player.id, req.body || {}));
  } catch (err) {
    if (err.code === 'BAD') return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/partner/pay', auth, need('partners.pay'), (req, res) => {
  try {
    res.json(partners.manualPayout(req.player.id, Number(req.body?.partnerId), req.body?.amount, req.body?.comment));
  } catch (err) {
    if (err.code === 'BAD' || err.code === 'NOT_FOUND') return res.status(400).json({ error: err.message });
    throw err;
  }
});

/* ============================================================
   ПРОЧЕЕ
   ============================================================ */

// Бонус по таймеру отключён - раздача единиц обесценивала ставку.
app.post('/api/bonus', auth, limits.play, (req, res) => {
  res.status(410).json({ error: 'disabled', message: 'Бонус больше не выдаётся' });
});

app.post('/api/history', auth, limits.read, (req, res) => {
  const caseTitle = req.body?.caseTitle ? String(req.body.caseTitle).slice(0, 64) : null;
  const limit = Math.min(60, Math.max(1, Number(req.body?.limit) || 60));
  res.json({ history: getHistory(req.player.id, limit, caseTitle) });
});

/* ============================================================
   КАССА
   ============================================================ */

app.post('/api/wallet', auth, limits.read, (req, res) => {
  const pending = pendingPayoutTotal(req.player.id);
  res.json({
    balance: req.player.balance,
    pending,
    /*
     * Доступное к выводу: весь баланс, если пополнение прокручено ставками, и
     * ноль, пока не прокручено. Заявка списывает сумму сразу, поэтому
     * ожидающие показываются отдельной строкой и здесь уже не участвуют.
     */
    available: withdrawable(req.player),
    // Сколько ещё надо поставить, чтобы открылся вывод. Игрок должен видеть
    // расстояние до цели, а не только слово «нельзя».
    depositDebt: req.player.deposit_debt || 0,
    wagerProgress: req.player.wager_progress,
    minPayout: minPayoutNow(),
    // Шаг суммы для карты и СБП: клиент подсказывает его и округляет «Всё».
    payoutStep: PAYOUT_STEP,
    deposits: getDeposits(req.player.id),
    payouts: getPayouts(req.player.id),
    bonus: {
      balance: req.player.bonus_balance || 0,
      wagerLeft: (req.player.bonus_balance || 0) > 0 ? (req.player.wager_required || 0) : 0,
      cashoutLeft: bonusAllowance(req.player),
      rules: bonusRules(),
      events: getBonusEvents(req.player.id),
    },
  });
});

/*
 * Отказ от бонуса: бонусный счёт и его отыгрыш обнуляются. Нужен тому, кого
 * недоигранный подарок только путает. Свои деньги не трогаются.
 */
app.post('/api/bonus/refuse', auth, limits.cashier, (req, res) => {
  try {
    const result = refuseBonus(req.player.id);
    res.json({ ...result, user: publicUser(getUserById(req.player.id)) });
  } catch (err) {
    if (err.code === 'BONUS_BUSY') return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.post('/api/payout/create', auth, limits.cashier, async (req, res) => {
  if (!setting('payouts_open')) {
    return res.status(503).json({ error: 'Приём заявок на вывод временно закрыт' });
  }
  const amount = Math.trunc(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Укажите сумму вывода' });
  }
  if (amount < minPayoutNow()) {
    return res.status(400).json({
      error: `Минимальная сумма вывода ${minPayoutNow().toLocaleString('ru-RU')}`,
    });
  }

  // Курс вывода USDT считает сервер (Rapira плюс наценка), см. payoutQuote.
  const { cryptoRate, cryptoAmount } = req.body?.method === 'crypto'
    ? await crypto.payoutQuote(req.body?.cryptoCurrency, amount, req.body?.cryptoAmount, req.body?.cryptoRate)
    : {};

  try {
    const result = createPayout(req.player.id, amount, {
      minPayout: minPayoutNow(),
      method: req.body?.method,
      phone: req.body?.phone,
      bank: req.body?.bank,
      cardNumber: req.body?.cardNumber,
      cryptoCurrency: req.body?.cryptoCurrency,
      cryptoNetwork: req.body?.cryptoNetwork,
      cryptoAddress: req.body?.cryptoAddress,
      cryptoAmount,
      cryptoRate,
    });
    trackEvent(req.player.id, 'payout_created', { amount, method: req.body?.method });
    // Проверка заявки сразу, пока игрок ждёт ответа: к моменту, когда
    // сотрудник откроет панель, плашка уже стоит. Сбой проверки не должен
    // отменять заявку - тогда её проверят по кнопке.
    try { checkPayout(result.id); } catch (e) { console.error('Проверка заявки:', e); }
    res.json({ ...result, user: publicUser(getUserById(req.player.id)) });
  } catch (err) {
    // Ожидаемые отказы: игроку показывается сообщение, а не «что-то пошло не
    // так». WAGER_PROGRESS - не отыграно пополнение, остальные - проверки
    // реквизитов платёжного модуля. Бонус вывод больше не запирает.
    if ([
      'MIN', 'STEP', 'INSUFFICIENT_FUNDS', 'WAGER', 'WAGER_PROGRESS',
      'BAD_PHONE', 'BAD_BANK', 'BAD_CARD', 'BAD_METHOD', 'PAYOUT_KEY_MISSING',
      'BAD_CURRENCY', 'BAD_NETWORK', 'BAD_ADDRESS', 'BAD_RATE',
    ].includes(err.code)) {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    throw err;
  }
});

app.post('/api/payout/cancel', auth, limits.cashier, (req, res) => {
  try {
    const result = cancelPayout(req.player.id, Number(req.body?.id));
    res.json({ ...result, user: publicUser(getUserById(req.player.id)) });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'RESOLVED') return res.status(400).json({ error: err.message });
    throw err;
  }
});

/* ============================================================
   РИСК-ИГРА
   ============================================================ */

app.post('/api/gamble/pick', auth, limits.play, (req, res) => {
  const index = Math.trunc(Number(req.body?.index));
  if (!Number.isInteger(index) || index < 0 || index >= GAMBLE_CONFIG.cards) {
    return res.status(400).json({ error: 'Некорректный выбор карты' });
  }

  let result;
  try {
    result = playGamble(req.player.id, index, GAMBLE_CONFIG, (serverSeed, clientSeed, nonce) => {
      const roll = computeRoll(serverSeed, clientSeed, nonce);
      return { acePosition: gambleAceFromRoll(roll), roll };
    });
  } catch (err) {
    if (err.code === 'NO_STAKE') return res.status(400).json({ error: 'Нечем рисковать' });
    throw err;
  }

  res.json({
    won: result.won,
    acePosition: result.acePosition,
    payout: result.payout,
    stake: result.stake,
    balance: result.balance,
    fair: { roll: result.roll, nonce: result.nonce },
    user: publicUser(getUserById(req.player.id)),
  });
});

app.post('/api/gamble/skip', auth, limits.play, (req, res) => {
  clearGamble(req.player.id);
  res.json({ user: publicUser(getUserById(req.player.id)) });
});

/* ============================================================
   АПГРЕЙД
   ============================================================ */

app.post('/api/upgrade', auth, limits.play, gameGate('upgrade'), (req, res) => {
  const stake = parseBet(req.body?.stake);
  const multiplier = Number(req.body?.multiplier);

  if (!stake || stake < UPGRADE_CONFIG.minStake) {
    return res.status(400).json({ error: `Минимальная ставка - ${UPGRADE_CONFIG.minStake}` });
  }
  if (!UPGRADE_CONFIG.multipliers.includes(multiplier)) {
    return res.status(400).json({ error: 'Недоступный множитель' });
  }
  if (spendable(req.player) < stake) return sendInsufficient(res, stake - spendable(req.player));

  const target = upgradeTarget(stake, multiplier);
  const chance = upgradeChance(stake, target);

  const result = playInstantRound(req.player.id, stake, (serverSeed, clientSeed, nonce) => {
    const roll = computeRoll(serverSeed, clientSeed, nonce);
    const won = upgradeWinFromRoll(roll, chance);
    return {
      game: 'upgrade',
      title: 'Апгрейд',
      subtitle: won ? `x${multiplier} - попал` : `x${multiplier} - мимо`,
      payout: won ? target : 0,
      tier: won ? 'legendary' : 'common',
      roll,
      won,
      meta: { multiplier, target },
    };
  });

  res.json({
    won: result.won,
    stake,
    target,
    multiplier,
    // Угол стрелки: ролл - это доля круга от верхней точки. Сектор выигрыша
    // клиент рисует сам от нуля до chance, поэтому картинка проверяема.
    chance,
    balance: result.balance,
    fair: { roll: result.roll, nonce: result.nonce },
    user: publicUser(getUserById(req.player.id)),
  });
});

/* ============================================================
   БЕСПЛАТНЫЙ КЕЙС ЗА ПОДПИСКУ
   ============================================================ */

/* ============================================================
   КОЛЕСО ФОРТУНЫ
   ============================================================ */

/**
 * Состояние колеса: шаги, остаток прокрутов, когда следующий.
 *
 * Описание секторов отдаётся вместе с состоянием, а не лежит в клиенте:
 * иначе при правке весов пришлось бы помнить про два места, и колесо
 * останавливалось бы не на том, что показало окно выигрыша.
 */
/* ============================================================
   МИНИ-ИГРЫ
   ============================================================ */

/* ============================================================
   КАЗИНО: ИГРЫ ПРОВАЙДЕРОВ
   ============================================================ */

// Пределы и текущая отдача казино живут в casino-db.js: от них же считается
// вес оборота казино в отыгрыше пополнения.

/* Карточка игры для клиента. Ссылки на обложки - наши, а не CDN агрегатора:
   у нас они пережаты и не зависят от того, отвечает ли их CDN. */
function publicCasinoGame(g) {
  return {
    id: g.id,
    name: g.name,
    provider: g.provider_name,
    providerId: g.provider_id,
    kind: g.kind,
    // Игры без обложки в списки не попадают (VISIBLE_SQL в casino-db.js).
    // Вертикальной нет - плитка сразу горизонтальная.
    cover: `/casino/cover/${encodeURIComponent(g.id)}`,
    vertical: Boolean(g.img_vertical) && g.cover_state !== 'w' && g.cover_state !== 'x',
    // Запас на случай, если вертикальная не загрузится у игрока.
    alt: g.img_vertical && g.img && g.cover_state !== 'w' && g.cover_state !== 'x'
      ? `/casino/cover/${encodeURIComponent(g.id)}?w=1` : null,
    wide: g.img_wide ? `/casino/wide/${encodeURIComponent(g.id)}` : null,
    demo: Boolean(g.demo),
    freespin: Boolean(g.freespin),
    // Число отдачи только там, где оно наше. У живых столов и NovaPlay его
    // задаёт провайдер, и приписать им нашу цифру значило бы соврать.
    rtp: g.rtp_mode === 'operator' ? casinoRtp() : null,
    // Только у «Лучших выигрышей»: настоящий раунд, множитель и сумма.
    ...(g.win_mult ? { winMult: g.win_mult, winAmount: kopToRub(g.win_kop) } : {}),
  };
}

const CASINO_KINDS = ['slots', 'live', 'fast'];
const CASINO_PAGE_MAX = 96;

app.post('/api/casino/lobby', browse, limits.read, gameGate('casino'), (req, res) => {
  const providers = casinoProviders();
  const counts = Object.fromEntries(CASINO_KINDS.map((k) => [k, 0]));
  for (const p of providers) counts[p.kind] = (counts[p.kind] || 0) + p.game_count;
  res.json({
    rtp: casinoRtp(),
    configured: casinoConfigured(),
    // Вкладки показываются все три, даже пустая: заказчик держит «Live
    // казино» в меню, а пустая вкладка честно говорит, что столы готовятся.
    tabs: CASINO_TABS,
    counts,
    providers: providers.map((p) => ({ id: p.id, name: p.name, kind: p.kind, count: p.game_count })),
  });
});

/* Лобби вкладки: блоки с первыми играми каждого. Полный список блока -
   /api/casino/games с category. */
app.post('/api/casino/home', browse, limits.read, gameGate('casino'), (req, res) => {
  const kind = CASINO_KINDS.includes(req.body?.kind) ? req.body.kind : 'slots';
  res.json({
    kind,
    blocks: casinoHome(kind).map((b) => ({ ...b, games: b.games.map(publicCasinoGame) })),
  });
});

app.post('/api/casino/games', browse, limits.read, gameGate('casino'), (req, res) => {
  const b = req.body || {};
  const kind = CASINO_KINDS.includes(b.kind) ? b.kind : '';
  const category = typeof b.category === 'string' && categoryById(b.category) ? b.category : '';
  const { total, rows } = casinoGames({
    kind,
    provider: typeof b.provider === 'string' ? b.provider.slice(0, 80) : '',
    category,
    q: typeof b.q === 'string' ? b.q.trim().slice(0, 60) : '',
    offset: Math.max(0, Math.trunc(Number(b.offset) || 0)),
    limit: Math.min(CASINO_PAGE_MAX, Math.max(1, Math.trunc(Number(b.limit) || 48))),
  });
  res.json({ total, games: rows.map(publicCasinoGame) });
});

/**
 * Запуск игры.
 *
 * Игрок у агрегатора - lb<наш id>, не tg_id. Деньги в игре не лежат: каждое
 * списание и начисление агрегатор присылает нам в /api/casino/wallet, и
 * баланс остаётся только здесь.
 */
app.post('/api/casino/launch', auth, limits.play, gameGate('casino'), async (req, res) => {
  const game = casinoGame(req.body?.gameId);
  if (!game) return res.status(404).json({ error: 'Игра не найдена' });
  const demo = req.body?.demo === true;
  if (demo && !game.demo) return res.status(400).json({ error: 'У этой игры нет демо' });
  if (!casinoConfigured()) return res.status(503).json({ error: 'Казино ещё не подключено' });
  if (!demo && casinoExcluded(req.player.id)) {
    return res.status(403).json({ error: 'Вы установили перерыв в игре. Казино откроется по его окончании' });
  }

  try {
    const result = await launchGame({
      game,
      playerId: casinoPlayerId(req.player.id),
      demo,
      ip: req.ip?.replace(/^::ffff:/, '') || '',
      // Страна из CASINO_COUNTRY (launchGame), а не из заголовка cf-ipcountry:
      // Cloudflare перед сервером нет, и заголовок прислал бы сам игрок.
      country: '',
      rtp: casinoRtp(),
      // Адрес сайта один на весь проект - SITE_URL.
      lobbyUrl: process.env.SITE_URL || process.env.PUBLIC_URL || '',
    });
    if (!result.ok) {
      console.error('[casino] запуск', game.id, result.status, result.message);
      // Пустой баланс агента у партнёра запирает ВСЕ игры разом - это не
      // сбой одной игры, а повод разбудить владельца.
      if (/balance must be greater than zero/i.test(String(result.message))) {
        alert('casino:agent-balance', 'Казино: у агента пустой баланс у агрегатора, игры не запускаются. Пополните баланс агента в кабинете Databetrix.');
      } else {
        countError('casino:launch', `Казино: игры не запускаются (${result.status} ${result.message || ''})`, { threshold: 5 });
      }
      return res.status(503).json({ error: 'Игра временно недоступна. Попробуйте позже' });
    }
    trackEvent(req.player.id, 'casino_launch', { gameId: game.id, demo });
    res.json({ url: result.url, html: result.html, game: publicCasinoGame(game), demo });
  } catch (err) {
    console.error('[casino] запуск', game.id, err.message);
    countError('casino:launch-net', `Казино: агрегатор не отвечает на запуск (${err.message})`, { threshold: 5 });
    res.status(503).json({ error: 'Игра временно недоступна. Попробуйте позже' });
  }
});

app.post('/api/casino/history', auth, limits.read, (req, res) => {
  res.json({
    rows: casinoHistory(req.player.id, 40).map((r) => ({
      id: r.id, method: r.method, game: r.game_name || r.game_id, amount: kopToRub(r.amount_kop),
      free: Boolean(r.free_round), rolledBack: Boolean(r.rolled_back), at: r.created_at,
    })),
    balance: userBalanceRub(getUserById(req.player.id)),
  });
});

/*
 * Обложки. Без авторизации: картинки публичные, а браузер грузит их тегом
 * img, и проверять сессию у картинки незачем. Кешируются надолго: имя файла
 * - хеш адреса картинки, новая обложка придёт под новым именем.
 */
const COVER_MAX_AGE = 7 * 24 * 3600;

/*
 * choose(game) -> { src, missing }: какую картинку отдать и какой признак
 * поставить игре, если файла на CDN нет. Признак: вертикальной нет - есть
 * надежда на горизонтальную ('w'); нет горизонтальной - обложки нет ('x').
 * По нему лобби уводит игру в конец списка.
 */
async function sendCover(req, res, choose) {
  const game = casinoGame(req.params.id);
  if (!game) return res.status(404).end();
  const { src, missing } = choose(game);
  if (!src.img_vertical && !src.img) {
    if (missing) setCoverState(game.id, missing);
    return res.status(404).end();
  }
  const cover = await coverFile(src);
  // Временная ошибка сети не означает, что файл отсутствует на CDN.
  if (!cover) return res.status(503).set('Cache-Control', 'no-store').end();
  if (cover.missing) {
    if (missing) setCoverState(game.id, missing);
    return res.status(404).end();
  }
  if (cover.redirect) return res.redirect(302, cover.redirect);
  res.set('Cache-Control', `public, max-age=${COVER_MAX_AGE}, immutable`);
  res.type('image/webp').sendFile(cover.file);
}

/*
 * ?w=1 - горизонтальная обложка вместо вертикальной. Клиент просит её, когда
 * вертикальная не загрузилась; сервер и сам отдаёт горизонтальную, если
 * проверка уже знает, что вертикальной нет.
 */
app.get('/casino/cover/:id', (req, res, next) => sendCover(req, res, (g) => {
  const horizontal = req.query.w === '1' || g.cover_state === 'w' || !g.img_vertical;
  return horizontal
    ? { src: { ...g, img_vertical: null }, missing: 'x' }
    : { src: g, missing: 'w' };
}).catch(next));
// Широкая - для окна запуска. Её отсутствие обложку плитки не отменяет.
app.get('/casino/wide/:id', (req, res, next) =>
  sendCover(req, res, (g) => ({ src: { ...g, img_vertical: g.img_wide || g.img_vertical }, missing: null }))
    .catch(next));

app.post('/api/admin/casino', auth, need('games.manage'), (req, res) => {
  const day = 24 * 3600 * 1000;
  res.json({
    sync: syncStatus(),
    configured: casinoConfigured(),
    rtp: casinoRtp(),
    rtpRange: [CASINO_RTP_MIN, CASINO_RTP_MAX],
    today: casinoSummary(Date.now() - day),
    week: casinoSummary(Date.now() - 7 * day),
    month: casinoSummary(Date.now() - 30 * day),
  });
});

app.post('/api/admin/casino/sync', auth, need('games.manage'), async (req, res) => {
  if (!casinoConfigured()) return res.status(400).json({ error: 'Не заданы ключи агрегатора' });
  res.json({ sync: await syncCatalog() });
});

/* ============================================================
   СЛОТЫ
   ============================================================ */

/**
 * Ставка слота обязана делиться на двадцать линий без остатка.
 *
 * Выплаты внутри заданы в ставках НА ЛИНИЮ. Если общая ставка не делится,
 * линейная становится дробной, и выигрыш приходится округлять на каждой
 * линии по отдельности - тогда сумма на экране перестаёт сходиться с
 * таблицей. Поэтому список ставок закрытый и весь делится на двадцать.
 */
function slotLineBet(slot, raw) {
  const bet = parseBet(raw);
  if (!bet || !slot.bets.includes(bet)) return null;
  return { total: bet, line: bet / SLOT_LINES };
}

/** Слот из запроса или 400. */
function askSlot(req, res) {
  const slot = getSlot(req.body?.slotId);
  if (!slot) { res.status(400).json({ error: 'Слот не найден' }); return null; }
  return slot;
}

app.post('/api/slots', auth, limits.read, (req, res) => {
  res.json({ slots: SLOTS.map(slotCard) });
});

app.post('/api/slot', auth, limits.read, (req, res) => {
  const slot = askSlot(req, res);
  if (!slot) return;

  const session = getSlotSession(req.player.id);
  /*
   * Серия показывается только в СВОЕЙ игре. Бонус куплен или выигран в
   * конкретном слоте, и его ставка с лентами относится к нему же: доигрывать
   * его в другой игре означало бы платить по чужой таблице.
   *
   * Серии, заведённые до появления второй игры, лежат с пустым slot_id и
   * доигрываются там, куда игрок зайдёт: отнимать оплаченные вращения из-за
   * нашего обновления не за что.
   */
  const mine = session && (!session.slot_id || session.slot_id === slot.id);

  res.json({
    slot: publicSlot(slot),
    session: mine ? {
      spinsLeft: session.spins_left,
      lineBet: session.line_bet,
      totalBet: session.line_bet * SLOT_LINES,
      totalWin: session.total_win,
      bought: Boolean(session.bought),
    } : null,
  });
});

app.post('/api/slot/spin', auth, limits.play, gameGate('slots'), (req, res) => {
  const slot = askSlot(req, res);
  if (!slot) return;
  const bet = slotLineBet(slot, req.body?.bet);
  if (!bet) return res.status(400).json({ error: 'Такой ставки нет' });

  const user = req.player;
  if (user.balance < bet.total) return sendInsufficient(res, bet.total - user.balance);

  let result;
  try {
    result = playSlotSpin(user.id, slot.id, bet.total, (serverSeed, clientSeed, nonce) => {
      const roll = computeRoll(serverSeed, clientSeed, nonce);
      const offsets = offsetsFrom(roll, slot.strips);
      const grid = gridFrom(slot, offsets);
      const outcome = evaluateSlot(slot, grid, bet.line);
      const payout = outcome.lineWin + outcome.scatterWin;
      const multiplier = payout / bet.total;

      return {
        game: 'slot',
        title: slot.name,
        subtitle: outcome.triggered
          ? `${outcome.scatters} SCATTER - фриспины`
          : payout > 0 ? `Выигрыш ×${multiplier.toFixed(2)}` : 'Без выигрыша',
        payout,
        tier: multiplier >= 50 ? 'unique'
            : multiplier >= 20 ? 'mythic'
            : multiplier >= 5 ? 'epic'
            : payout > 0 ? 'rare' : 'common',
        roll,
        offsets,
        grid,
        wins: outcome.wins,
        lineWin: outcome.lineWin,
        scatterWin: outcome.scatterWin,
        scatters: outcome.scatters,
        freeSpins: outcome.triggered ? slot.freeSpins : 0,
        lines: SLOT_LINES,
        multiplier,
      };
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_FUNDS') return sendInsufficient(res, bet.total - user.balance);
    if (err.code === 'BAD') return res.status(400).json({ error: err.message });
    throw err;
  }

  /*
   * Джекпот разыгрывается ПОСЛЕ прокрута и отдельной транзакцией: он не
   * зависит от того, что выпало на барабанах, и его отдача посчитана
   * отдельным слагаемым (см. jackpotBudget в server/slot-engine.js).
   */
  const jackpot = jackpotFrom(slot, jackpotRoll(result.roll), bet.total);
  let balance = result.balance;
  if (jackpot) {
    balance = awardSlotJackpot(user.id, jackpot, bet.total, result.nonce, slot.name);
    trackEvent(user.id, 'slot_jackpot',
               { slot: slot.id, id: jackpot.id, amount: jackpot.amount, bet: bet.total });
  }

  trackEvent(user.id, 'slot_spin', { slot: slot.id, bet: bet.total, payout: result.payout });

  res.json({
    slotId: slot.id,
    offsets: result.offsets,
    grid: result.grid,
    wins: result.wins,
    lineWin: result.lineWin,
    scatterWin: result.scatterWin,
    scatters: result.scatters,
    payout: result.payout,
    freeSpins: result.freeSpins,
    jackpot: jackpot ? { id: jackpot.id, name: jackpot.name, amount: jackpot.amount } : null,
    bet: bet.total,
    lineBet: bet.line,
    roll: result.roll,
    nonce: result.nonce,
    balance,
    user: publicUser(getUserById(user.id)),
  });
});

app.post('/api/slot/free', auth, limits.play, gameGate('slots'), (req, res) => {
  const slot = askSlot(req, res);
  if (!slot) return;

  const user = req.player;
  let result;
  try {
    result = playSlotFreeSpin(user.id, (serverSeed, clientSeed, nonce, session) => {
      // Серия играется тем слотом, в котором выпала или куплена: цена покупки
      // считается по его отдаче, и крутить её в другом слоте (с множителем
      // фриспинов) значило бы поменять отдачу покупки.
      if (session.slot_id && session.slot_id !== slot.id) {
        throw Object.assign(new Error('Фриспины этой серии - в другом слоте'), { code: 'WRONG_SLOT' });
      }
      const roll = computeRoll(serverSeed, clientSeed, nonce);
      const offsets = offsetsFrom(roll, slot.strips);
      // Во фриспинах wild расширяется на весь барабан - это и есть бонус.
      const grid = gridFrom(slot, offsets, { expandWild: true });
      const outcome = evaluateSlot(slot, grid, session.line_bet, { free: true });

      return {
        title: slot.name,
        roll,
        offsets,
        grid,
        wins: outcome.wins,
        lineWin: outcome.lineWin,
        scatterWin: outcome.scatterWin,
        scatters: outcome.scatters,
        payout: outcome.lineWin + outcome.scatterWin,
      };
    });
  } catch (err) {
    if (err.code === 'BAD' || err.code === 'WRONG_SLOT') return res.status(400).json({ error: err.message });
    throw err;
  }

  res.json({
    slotId: slot.id,
    offsets: result.offsets,
    grid: result.grid,
    wins: result.wins,
    lineWin: result.lineWin,
    scatterWin: result.scatterWin,
    scatters: result.scatters,
    payout: result.payout,
    spinsLeft: result.spinsLeft,
    sessionWin: result.sessionWin,
    roll: result.roll,
    nonce: result.nonce,
    balance: result.balance,
    user: publicUser(getUserById(user.id)),
  });
});

app.post('/api/slot/buy', auth, limits.play, gameGate('slots'), (req, res) => {
  const slot = askSlot(req, res);
  if (!slot) return;
  const bet = slotLineBet(slot, req.body?.bet);
  if (!bet) return res.status(400).json({ error: 'Такой ставки нет' });

  const price = slot.buyBonusPrice * bet.total;
  const user = req.player;
  if (user.balance < price) return sendInsufficient(res, price - user.balance);

  let result;
  try {
    result = buySlotBonus(user.id, slot.id, price, bet.line, slot.freeSpins, slot.name);
  } catch (err) {
    if (err.code === 'INSUFFICIENT_FUNDS') return sendInsufficient(res, price - user.balance);
    if (err.code === 'BAD') return res.status(400).json({ error: err.message });
    throw err;
  }

  trackEvent(user.id, 'slot_bonus_bought', { slot: slot.id, bet: bet.total, price });

  res.json({
    slotId: slot.id,
    price,
    spinsLeft: result.session.spins_left,
    lineBet: bet.line,
    balance: result.balance,
    user: publicUser(getUserById(user.id)),
  });
});

app.post('/api/fortune/state', auth, limits.read, (req, res) => {
  res.json({
    ...fortuneState(req.player.id),
    history: fortuneHistory(req.player.id),
    wheel: {
      segments: FORTUNE_SEGMENTS.map((s) => ({ index: s.index, type: s.type, label: s.label })),
      segmentDeg: SEGMENT_DEG,
      startDeg: SEGMENTS_START_DEG,
    },
    prizes: {
      percentMin: PERCENT_MIN, percentMax: PERCENT_MAX,
      voucherMin: VOUCHER_MIN, voucherMax: VOUCHER_MAX,
      cash: CASH_PRIZE, giftCaseMaxPrice: GIFT_CASE_MAX_PRICE,
    },
  });
});

/**
 * Прокрут. Ограничитель тот же, что у кассы: денежная ручка, и дёргать её
 * вплотную незачем - всё равно раз в сутки.
 */
app.post('/api/fortune/spin', auth, limits.cashier, gameGate('fortune'), (req, res) => {
  let result;
  try {
    result = playFortuneSpin(req.player.id, CASES);
  } catch (err) {
    if (err.code === 'FORTUNE_EMPTY' || err.code === 'FORTUNE_COOLDOWN') {
      return res.status(400).json({ error: err.code, message: err.message, readyAt: err.readyAt });
    }
    throw err;
  }

  const c = result.prize.caseId ? getCase(result.prize.caseId) : null;
  res.json({
    prize: {
      ...result.prize,
      caseName: c?.name || null,
      casePrice: c?.price || 0,
    },
    user: publicUser(getUserById(req.player.id)),
    state: fortuneState(req.player.id),
  });
});

app.post('/api/free-case/state', auth, (req, res) => {
  if (!subscriptionConfigured()) return res.json({ enabled: false });
  const state = freeCaseState(req.player.id, FREE_CASE_COOLDOWN_MS);
  res.json({ enabled: true, ...subscriptionConfig(), ...state, needsTelegram: req.player.tg_id == null });
});

app.post('/api/free-case/claim', auth, limits.cashier, async (req, res) => {
  if (!subscriptionConfigured()) {
    return res.status(503).json({
      error: 'Бесплатный кейс ещё не настроен',
      message: 'Раздел включится, когда будут заданы канал и кейс - см. NEDOSTATOK.md',
    });
  }

  const { caseId } = subscriptionConfig();
  if (!getCase(caseId)) {
    return res.status(500).json({ error: `Кейс ${caseId} не найден в конфигурации` });
  }

  // Подписку видно только по Telegram ID: без привязки проверять нечего.
  if (req.player.tg_id == null) {
    return res.status(409).json({ error: 'Привяжите Telegram в профиле, чтобы получить кейс', code: 'TG_REQUIRED' });
  }
  const check = await isSubscribed(req.player.tg_id);

  if (!check.ok) {
    // Сеть или права бота - это наша проблема, а не игрока, и говорить
    // ему «вы не подписаны» в такой ситуации нельзя.
    const message = check.reason === 'network'
      ? 'Telegram не ответил, попробуйте ещё раз'
      : 'Проверка подписки недоступна, мы уже чиним';
    return res.status(503).json({ error: message });
  }

  if (!check.subscribed) {
    return res.status(403).json({
      error: 'Подпишитесь на канал',
      channelUrl: subscriptionConfig().channelUrl,
    });
  }

  const granted = grantFreeCase(req.player.id, caseId, FREE_CASE_COOLDOWN_MS);
  if (!granted.ok) {
    return res.status(429).json({ error: 'Кейс уже получен', readyAt: granted.readyAt });
  }

  res.json({
    ok: true,
    caseId,
    readyAt: granted.readyAt,
    vouchers: getVouchers(req.player.id),
    user: publicUser(getUserById(req.player.id)),
  });
});

app.post('/api/fair/client-seed', auth, (req, res) => {
  const raw = String(req.body?.seed ?? '').trim();
  const seed = raw || generateClientSeed();
  if (seed.length > 64 || !/^[\w-]+$/.test(seed)) {
    return res.status(400).json({
      error: 'Seed: до 64 символов, только буквы, цифры, дефис и подчёркивание',
    });
  }
  setClientSeed(req.player.id, seed);
  res.json({ user: publicUser(getUserById(req.player.id)) });
});

app.post('/api/fair/rotate', auth, limits.guess, (req, res) => {
  const result = rotateServerSeed(req.player.id);
  res.json({ ...result, user: publicUser(getUserById(req.player.id)) });
});

/* ============================================================
   АДМИНКА
   ============================================================ */

app.post('/api/admin/overview', auth, need('reports.view'), (req, res) => {
  res.json({ ...adminOverview(), recent: adminRecentRounds(30) });
});

/**
 * Воронка: сколько игроков дошло до каждого шага.
 *
 * Период ограничен сверху: запрос за всё время прочитал бы таблицу событий
 * целиком, а она растёт быстрее всех остальных.
 */
app.post('/api/admin/funnel', auth, need('reports.view'), (req, res) => {
  const days = Math.min(90, Math.max(1, Math.trunc(Number(req.body?.days) || 7)));
  res.json({ funnel: funnelStats(days), events: eventTotals(days) });
});

app.post('/api/admin/users', auth, need('players.view'), (req, res) => {
  const query = String(req.body?.query || '').slice(0, 64);
  const limit = Math.min(100, Math.max(1, Number(req.body?.limit) || 30));
  const offset = Math.max(0, Number(req.body?.offset) || 0);
  res.json(adminUsers({ query, limit, offset }));
});

app.post('/api/admin/user', auth, need('players.view'), (req, res) => {
  const detail = adminUserDetail(Number(req.body?.userId));
  if (!detail) return res.status(404).json({ error: 'Игрок не найден' });
  res.json(detail);
});

app.post('/api/admin/balance', auth, need('players.balance'), (req, res) => {
  const targetId = Number(req.body?.userId);
  const amount = Math.trunc(Number(req.body?.amount));

  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ error: 'Укажите ненулевую сумму' });
  }
  if (Math.abs(amount) > 100_000_000) {
    return res.status(400).json({ error: 'Слишком большая сумма' });
  }

  /*
   * Потолок одной правки. Он не про недоверие к поддержке, а про опечатку:
   * компенсация зависшего прокрута на 500 с промахом в три нуля уходит без
   * единой проверки, и заметят её в отчёте через неделю. Подтверждение здесь
   * не помогло бы - его нажимают не глядя.
   */
  const cap = balanceCapFor(req.staff);
  if (cap > 0 && Math.abs(amount) > cap) {
    return res.status(403).json({
      error: `Правка больше ${cap.toLocaleString('ru-RU')} вам недоступна`,
    });
  }

  try {
    // asDeposit=false - это корректировка: деньги доходят без долга по обороту.
    // По умолчанию начисление считается пополнением и требует отыгрыша.
    const result = adminAdjustBalance(
      req.player.id, targetId, amount, String(req.body?.note || '').slice(0, 200),
      { asDeposit: req.body?.asDeposit !== false }
    );
    res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/block', auth, need('players.block'), (req, res) => {
  const targetId = Number(req.body?.userId);
  if (targetId === req.player.id) {
    return res.status(400).json({ error: 'Нельзя заблокировать самого себя' });
  }
  // Сотрудника блокирует только тот, кто вправе им управлять: иначе
  // риск-менеджер запер бы владельца, и вернуть доступ можно было бы лишь
  // правкой базы руками.
  const targetStaff = staffRow(targetId);
  if (targetStaff && !canManage(req.perms, req.staff?.role, targetStaff.role)) {
    return res.status(403).json({ error: 'Этого сотрудника блокировать может только тот, кто им управляет' });
  }
  try {
    res.json(adminSetBlocked(req.player.id, targetId, !!req.body?.blocked));
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/voucher', auth, need('players.gift'), (req, res) => {
  const targetId = Number(req.body?.userId);
  const caseId = String(req.body?.caseId || '');
  const count = Math.min(100, Math.max(1, Math.trunc(Number(req.body?.count) || 1)));

  if (!getCase(caseId)) return res.status(400).json({ error: 'Кейс не найден' });

  try {
    res.json({ vouchers: adminGrantVoucher(req.player.id, targetId, caseId, count) });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/payouts', auth, need('finance.payouts.view'), async (req, res) => {
  const status = ['pending', 'processing', 'paid', 'rejected', 'cancelled', 'all']
    .includes(req.body?.status) ? req.body.status : 'pending';
  const rows = adminPayouts(status);
  // Код банка шлюза подбирается по названию из заявки; не нашли - админ
  // выберет сам. Отправка в шлюз показывается рядом с заявкой.
  const banks = sicilia.isConfigured() ? await sicilia.banks() : [];
  // Итог проверки для плашки: цвет, причины и подтверждение сотрудника.
  // Полный разбор отдаёт /api/admin/payout/check.
  const verdict = (id) => {
    try {
      const c = payoutCheck(id);
      return c && { verdict: c.verdict, reasons: c.reasons, override: c.override || null, checkedAt: c.checkedAt };
    } catch (e) {
      console.error('Проверка заявки:', e);
      return null;
    }
  };
  res.json({
    rows: rows.map((r) => ({
      ...r,
      gatewayBank: r.method === 'sbp' ? sicilia.matchBank(r.bank, banks) : null,
      check: ['pending', 'processing'].includes(r.status) ? verdict(r.id) : null,
    })),
    gateway: sicilia.gatewayPayouts(rows.map((r) => r.id)),
    siciliaReady: sicilia.isConfigured(),
    stats: payoutStats(),
  });
});

/*
 * Проверка заявки целиком: все пункты с подробностями. recheck пересчитывает
 * заново - деньги игрока могли двинуться с момента заявки.
 */
app.post('/api/admin/payout/check', auth, need('finance.payouts.view'), (req, res) => {
  const id = Number(req.body?.id);
  const result = req.body?.recheck ? checkPayout(id) : payoutCheck(id);
  if (!result) return res.status(404).json({ error: 'Заявка не найдена' });
  res.json({ check: result });
});

/*
 * Подтверждение красной заявки: «проверил сам, выплачивать можно» с
 * комментарием. Без него красную заявку нельзя взять в работу или отправить
 * в шлюз - подозрение не должно уйти деньгами одним нажатием.
 */
app.post('/api/admin/payout/override', auth, need('finance.payouts.resolve'), (req, res) => {
  try {
    overridePayoutCheck(Number(req.body?.id), req.player.id, req.body?.comment);
    res.json({ check: payoutCheck(Number(req.body?.id)) });
  } catch (err) {
    if (err.code === 'COMMENT') return res.status(400).json({ error: err.message });
    throw err;
  }
});

/** Красная заявка без подтверждения сотрудника дальше не двигается. */
function riskGate(res, payoutId) {
  if (payoutCleared(payoutId)) return false;
  res.status(409).json({
    error: 'Проверка нашла подозрения. Разберите причины и подтвердите заявку с комментарием.',
    code: 'RISK',
  });
  return true;
}

app.post('/api/admin/payout/resolve', auth, need('finance.payouts.resolve'), (req, res) => {
  const id = Number(req.body?.id);
  const status = String(req.body?.status || '');
  const comment = String(req.body?.comment || '').slice(0, 300);

  // Отклонить можно всегда, двигать к выплате - только проверенную.
  if ((status === 'processing' || status === 'paid') && riskGate(res, id)) return;

  try {
    let result;
    if (status === 'processing') result = startPayout(req.player.id, id, comment);
    else if (status === 'paid') result = completePayout(req.player.id, id, comment);
    else result = resolvePayout(req.player.id, id, status, comment);
    res.json({ ...result, stats: payoutStats() });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'RESOLVED' || err.code === 'BAD_STATUS') {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
});

/* ============================================================
   КРИПТОКАССА HELEKET
   ============================================================ */

/**
 * Что доступно к оплате: монеты, сети и курсы.
 *
 * Курсы отдаются здесь же, а не отдельной ручкой: интерфейсу они нужны ровно
 * в тот момент, когда он рисует список монет, и второй запрос был бы лишним
 * походом по сети ради тех же данных.
 */
app.post('/api/crypto/options', auth, limits.read, async (req, res) => {
  if (!crypto.isConfigured()) return res.json({ enabled: false, coins: [], rates: {} });
  try {
    const [coins, rates] = await Promise.all([crypto.coins(), crypto.cashierRates()]);
    res.json({
      enabled: true,
      coins,
      rates: rates.deposit,
      payoutRates: rates.payout,
      min: crypto.CRYPTO_MIN,
      max: crypto.CRYPTO_MAX,
    });
  } catch (err) {
    res.status(503).json({ error: err.code || 'GATEWAY_ERROR', message: err.message });
  }
});

app.post('/api/crypto/create', auth, limits.cashier, async (req, res) => {
  if (!setting('deposits_open')) {
    return res.status(503).json({ error: 'Приём пополнений временно закрыт' });
  }

  try {
    const payment = await crypto.createDeposit(
      req.player.id, req.body?.amount, req.body?.currency, req.body?.network
    );
    res.status(201).json(payment);
  } catch (err) {
    const status = err.code === 'GATEWAY_UNREACHABLE' || err.code === 'NOT_CONFIGURED' ? 503 : 400;
    res.status(status).json({ error: err.code || 'CRYPTO_ERROR', message: err.message });
  }
});

app.post('/api/crypto/list', auth, limits.read, (req, res) => {
  res.json({ rows: crypto.listDeposits(req.player.id) });
});

/**
 * Сверка платежа со шлюзом по просьбе игрока.
 *
 * Нужна, когда вебхук не дошёл: сеть моргнула, приложение перезапускалось.
 * Без неё деньги висели бы до ручного разбора, а игрок видел бы «ожидание»
 * при уже отправленном переводе.
 */
app.post('/api/crypto/refresh', auth, limits.cashier, async (req, res) => {
  try {
    const result = await crypto.refreshDeposit(req.body?.id, req.player.id);
    if (result.credited) {
      emitPayment(req.player.id, 'payment.completed', { source: 'crypto' });
    }
    res.json({ ...result, user: publicUser(getUserById(req.player.id)) });
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404 : 400;
    res.status(status).json({ error: err.code || 'CRYPTO_ERROR', message: err.message });
  }
});

/**
 * Вебхук шлюза.
 *
 * Отвечаем 200 на всё, что подписано нашим ключом, даже если платёж уже был
 * зачислен: шлюз повторяет доставку до успешного ответа, и на любой другой
 * код он будет ломиться снова и снова. Защита от повторного зачисления живёт
 * в базе, а не в коде ответа.
 */
app.post('/api/webhooks/heleket', limits.webhook, (req, res) => {
  if (!crypto.webhookIpAllowed(req.ip)) {
    return res.status(403).json({ error: 'Чужой адрес' });
  }
  if (!crypto.verifyWebhook(req.body)) {
    return res.status(401).json({ error: 'Подпись не совпала' });
  }

  try {
    const result = crypto.applyWebhook(req.body);
    if (result.credited) emitPayment(result.userId, 'payment.completed', { source: 'crypto' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(200).json({ ok: true, unknown: true });
    throw err;
  }
});

/* ============================================================
   СБП И КАРТА: ШЛЮЗ SICILIA
   ============================================================ */

/*
 * Пополнение СБП и картой. Через API шлюза (по умолчанию) сервер заводит
 * ордер и отдаёт реквизит, касса показывает его сама; через окно - сервер
 * подписывает ссылку. Деньги приходят колбэком и сверкой. Подробности - в
 * server/sicilia.js.
 */
app.post('/api/sicilia/options', auth, limits.read, (req, res) => {
  const env = sicilia.siciliaEnv();
  res.json({ enabled: sicilia.payinReady(env), mode: env.payin, min: env.min, max: env.max,
    ttlMin: Math.round(env.ttlMs / 60_000) });
});

app.post('/api/sicilia/create', auth, limits.cashier, async (req, res) => {
  if (!setting('deposits_open')) return res.status(503).json({ error: 'Приём пополнений временно закрыт' });
  try {
    const b = req.body || {};
    res.status(201).json(await sicilia.createDeposit(req.player.id, b.amount, { method: b.method, senderBank: b.senderBank }));
  } catch (err) {
    const status = err.code === 'NOT_CONFIGURED' || err.code === 'GATEWAY_UNREACHABLE' || err.code === 'NO_REQUISITE' ? 503
      : err.code === 'OPEN_ORDER' ? 409 : 400;
    res.status(status).json({ error: err.message, code: err.code, order: err.order });
  }
});

/* Отмена перевода игроком: реквизит освобождается сразу, а не по сроку. */
app.post('/api/sicilia/cancel', auth, limits.cashier, async (req, res) => {
  try {
    const result = await sicilia.cancelDeposit(req.body?.id, req.player.id);
    if (result.credited) emitPayment(req.player.id, 'payment.completed', { source: 'sicilia' });
    res.json({ ...result, user: publicUser(getUserById(req.player.id)) });
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'GATEWAY_UNREACHABLE' ? 503 : 400;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

/* Тот же перевод ещё раз: игрок закрыл кассу или окно, не заплатив. */
app.post('/api/sicilia/reopen', auth, limits.cashier, (req, res) => {
  try {
    res.json(sicilia.reopenDeposit(req.body?.id, req.player.id));
  } catch (err) {
    res.status(err.code === 'NOT_FOUND' ? 404 : 400).json({ error: err.message, code: err.code });
  }
});

app.post('/api/sicilia/list', auth, limits.read, (req, res) => {
  res.json({ rows: sicilia.listDeposits(req.player.id) });
});

app.post('/api/sicilia/refresh', auth, limits.cashier, async (req, res) => {
  try {
    const result = await sicilia.refreshDeposit(req.body?.id, req.player.id);
    if (result.credited) emitPayment(req.player.id, 'payment.completed', { source: 'sicilia' });
    res.json({ ...result, user: publicUser(getUserById(req.player.id)) });
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'GATEWAY_UNREACHABLE' ? 503 : 400;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

/**
 * Колбэк шлюза: и пополнения, и выплаты (у выплат адрес задаётся в кабинете
 * один на все, у пополнений мы передаём его в ссылке окна).
 *
 * Подпись колбэка статуса не покрывает, поэтому сам колбэк ничего не решает:
 * сервер переспрашивает статус у шлюза своей подписью. Не смогли спросить -
 * отвечаем 503, и шлюз повторит; деньги не теряются и сверкой по расписанию.
 */
app.post('/api/webhooks/sicilia', limits.webhook, async (req, res) => {
  if (!sicilia.callbackIpAllowed(req.ip)) {
    // Адрес в журнал: если шлюз сменит адрес отправки, его видно отсюда и
    // дописывают в SICILIA_CALLBACK_IPS. Деньги до тех пор зачисляет сверка.
    console.error('[sicilia] колбэк: чужой адрес', req.ip);
    return res.status(403).json({ error: 'Чужой адрес' });
  }
  if (!sicilia.verifyCallback(req.body)) return res.status(401).json({ error: 'Подпись не совпала' });
  try {
    const result = await sicilia.handleCallback(req.body);
    if (result.credited) emitPayment(result.userId, 'payment.completed', { source: 'sicilia' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[sicilia] колбэк:', err.message);
    res.status(err.code === 'NOT_FOUND' ? 200 : 503).json({ ok: false });
  }
});

/*
 * «Перевёл, а деньги не пришли»: чек игрока и его слова. Сразу в шлюз это не
 * уходит, спор сначала видит сотрудник (почему - в sicilia.reportDeposit).
 * Лимит кассы, а не чтения: каждое обращение пишет файл на диск.
 */
app.post('/api/sicilia/report', auth, limits.cashier, async (req, res) => {
  try {
    const r = await sicilia.reportDeposit(req.player.id, req.body?.id, { comment: req.body?.comment, image: req.body?.image });
    if (r.credited) emitPayment(req.player.id, 'payment.completed', { source: 'sicilia' });
    res.json({ ...r, user: publicUser(getUserById(req.player.id)) });
  } catch (err) {
    res.status(err.code === 'NOT_FOUND' ? 404 : 400).json({ error: err.message, code: err.code });
  }
});

/*
 * Чек к спору. Ссылку открывает трейдер шлюза из апелляции, поэтому она без
 * входа; имя файла - 16 случайных байт, список файлов не отдаётся, а
 * поисковикам и кешам сказано файл не хранить.
 */
app.get('/receipts/:name', (req, res) => {
  const file = sicilia.receiptFile(req.params.name);
  if (!file) return res.status(404).end();
  res.set({ 'Content-Type': file.type, 'Cache-Control': 'private, max-age=3600', 'X-Robots-Tag': 'noindex, nofollow' });
  res.sendFile(file.path);
});

/* Панель: все пополнения через шлюзы, с номерами нашими и шлюза. */
app.post('/api/admin/deposits', auth, need('finance.payouts.view'), (req, res) => {
  const filter = ['all', 'credited', 'open', 'failed', 'dispute'].includes(req.body?.filter) ? req.body.filter : 'all';
  res.json({
    rows: adminDeposits({ q: req.body?.q, filter, before: req.body?.before }),
    summary: depositsSummary(),
    canResolve: req.perms.has('finance.payouts.resolve'),
    siteUrl: Boolean(sicilia.siciliaEnv().webapp),
    configured: sicilia.isConfigured(),
  });
});

/* Переспросить шлюз о пополнении сейчас, не дожидаясь сверки. */
app.post('/api/admin/deposit/recheck', auth, need('finance.payouts.view'), async (req, res) => {
  try {
    const r = await sicilia.recheckDeposit(req.body?.id);
    if (r.credited) emitPayment(r.userId, 'payment.completed', { source: 'sicilia' });
    res.json(r);
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'GATEWAY_UNREACHABLE' ? 503 : 400;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

/* Апелляция у шлюза: по спору игрока или по оплате, с чеком сотрудника. */
app.post('/api/admin/dispute/open', auth, need('finance.payouts.resolve'), async (req, res) => {
  try {
    const r = await sicilia.openAppeal(req.player.id, {
      orderId: req.body?.orderId, disputeId: req.body?.disputeId, reason: req.body?.reason, image: req.body?.image,
    });
    res.json(r);
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404
      : ['NOT_CONFIGURED', 'GATEWAY_UNREACHABLE', 'NO_SITE_URL'].includes(err.code) ? 503 : 400;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

app.post('/api/admin/dispute/decline', auth, need('finance.payouts.resolve'), (req, res) => {
  try {
    res.json({ dispute: sicilia.declineDispute(req.player.id, req.body?.id, req.body?.note) });
  } catch (err) {
    res.status(err.code === 'NOT_FOUND' ? 404 : 400).json({ error: err.message, code: err.code });
  }
});

/*
 * Выгрузка сделок построчно: пополнения или выводы, с номерами нашими и
 * шлюза. Отдельно от отчётов и под правом финансов: в файле игроки и их
 * реквизиты, а не сводные цифры.
 */
app.post('/api/admin/export/finance', auth, need('finance.payouts.view'), (req, res) => {
  const kind = req.body?.kind === 'payouts' ? 'payouts' : 'deposits';
  const days = Math.min(366, Math.max(1, Number(req.body?.days) || 30));
  const { head, rows } = kind === 'payouts' ? payoutsCsvRows(days) : depositsCsvRows(days);
  logAdmin(req.player.id, 0, 'export', { note: kind, meta: { days, rows: rows.length } });
  res.type('text/csv; charset=utf-8').send(toCsv(head, rows));
});

/* Панель: готовность шлюза, баланс мерчанта и коды банков для выплат. */
app.post('/api/admin/sicilia', auth, need('finance.payouts.view'), async (req, res) => {
  const env = sicilia.siciliaEnv();
  let balance = null;
  let balanceError = '';
  if (sicilia.isConfigured(env)) {
    try { balance = await sicilia.merchantBalance(); } catch (err) { balanceError = err.message; }
  }
  const banks = await sicilia.banks();
  res.json({
    configured: sicilia.isConfigured(env),
    payin: sicilia.payinReady(env),
    balance,
    balanceError,
    banks,
  });
});

/*
 * Отзыв выплаты из шлюза и возврат заявки в «ожидают». Оба шага снимают
 * «в работе» только после того, как шлюз сам подтвердил отмену своего ордера.
 */
app.post('/api/admin/sicilia/payout/recall', auth, need('finance.payouts.resolve'), async (req, res) => {
  try {
    res.json({ ...(await sicilia.recallPayout(req.player.id, Number(req.body?.id))), stats: payoutStats() });
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404 : ['NOT_CONFIGURED', 'GATEWAY_UNREACHABLE'].includes(err.code) ? 503 : 400;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

app.post('/api/admin/sicilia/payout/release', auth, need('finance.payouts.resolve'), async (req, res) => {
  try {
    res.json({ ...(await sicilia.releasePayout(req.player.id, Number(req.body?.id))), stats: payoutStats() });
  } catch (err) {
    res.status(err.code === 'GATEWAY_UNREACHABLE' ? 503 : 400).json({ error: err.message, code: err.code });
  }
});

/* Отмена пополнения с нашей стороны: отзыв ордера у шлюза. */
app.post('/api/admin/deposit/cancel', auth, need('finance.payouts.resolve'), async (req, res) => {
  try {
    const r = await sicilia.staffCancelDeposit(req.player.id, req.body?.id);
    if (r.credited) emitPayment(r.userId, 'payment.completed', { source: 'sicilia' });
    res.json(r);
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404 : ['NOT_CONFIGURED', 'GATEWAY_UNREACHABLE'].includes(err.code) ? 503 : 400;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

app.post('/api/admin/sicilia/payout', auth, need('finance.payouts.resolve'), async (req, res) => {
  if (riskGate(res, Number(req.body?.id))) return;
  try {
    const gateway = await sicilia.sendPayout(req.player.id, Number(req.body?.id), req.body?.bank);
    res.json({ gateway, stats: payoutStats() });
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'NOT_CONFIGURED' || err.code === 'GATEWAY_UNREACHABLE' ? 503 : 400;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

/**
 * Кошелёк казино: вызовы агрегатора на каждую ставку, выигрыш и отмену.
 *
 * Отвечаем всегда кодом 200 и statusCode в теле - так устроен их протокол;
 * HTTP-ошибку агрегатор воспринял бы как сбой сети и повторял бы вызов.
 * Повтор не страшен (casino-db.js отвечает на него кодом 9), но лишний.
 *
 * Защита двойная: адрес их сервера (CASINO_CALLBACK_IPS) и наш же ключ
 * агента в заголовке. Ограничителя частоты здесь нет намеренно: вызовов по
 * одному на каждый прокрут каждого игрока, и упереться в собственный лимит
 * значило бы отказать в выигрыше.
 */
function sameSecret(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

app.post('/api/casino/wallet', (req, res) => {
  const env = casinoEnv();
  const ip = String(req.ip || '').replace(/^::ffff:/, '');
  if (env.callbackIps.length && !env.callbackIps.includes(ip)) {
    console.error('[casino] кошелёк: чужой адрес', ip);
    // Код 200 и statusCode в теле, как требует их протокол: HTTP-ошибку
    // агрегатор принял бы за сбой сети, а не за отказ, если его адреса
    // сменятся. Оповещение - чтобы смену адресов не искать по жалобам.
    countError('casino:foreign-ip', `Казино: кошелёк вызван с адреса ${ip}, его нет в CASINO_CALLBACK_IPS`, { threshold: 3 });
    return res.json({ statusCode: CASINO_STATUS.INVALID_CREDENTIALS, message: 'Forbidden' });
  }
  if (!sameSecret(req.get('x-agent-name'), env.agent) || !sameSecret(req.get('x-agent-token'), env.token)) {
    return res.json({ statusCode: CASINO_STATUS.INVALID_CREDENTIALS, message: 'Invalid credentials' });
  }

  try {
    const result = casinoWallet(req.body, { currency: env.currency });
    res.json({
      statusCode: result.statusCode,
      message: result.statusCode === 0 ? 'Success' : String(result.statusCode),
      balance: result.balance ?? null,
      bonusBalance: 0,
    });
  } catch (err) {
    console.error('[casino] кошелёк:', err);
    // Ошибка кошелька - это ставка или выигрыш, которые не прошли.
    alert('casino:wallet', `Казино: ошибка кошелька, ставки и выигрыши могут не проходить.\n${err.message}`);
    res.json({ statusCode: CASINO_STATUS.GENERIC, message: 'Generic error' });
  }
});

/* ============================================================
   ПОТОК СОБЫТИЙ О ПЛАТЕЖАХ
   ============================================================
   Колбэк шлюза приходит на сервер раньше, чем игрок вернётся из окна
   оплаты. Открытая касса узнаёт о зачислении по этому потоку и сразу
   обновляет баланс, не дожидаясь своего опроса. */

const paymentStreams = new Map();
function emitPayment(userId, event, data) {
  for (const res of paymentStreams.get(userId) || []) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

// Потоков на игрока не больше нескольких вкладок: поток не заканчивается, и
// один аккаунт иначе держал бы тысячи соединений. Лишний закрывает самый
// старый, а не отказывает новой вкладке.
const STREAMS_PER_PLAYER = 5;
app.get('/api/payments/events', auth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders(); res.write('event: connected\ndata: {}\n\n');
  const set = paymentStreams.get(req.player.id) || new Set();
  while (set.size >= STREAMS_PER_PLAYER) {
    const oldest = set.values().next().value;
    set.delete(oldest);
    try { oldest.end(); } catch { /* уже закрыт */ }
  }
  set.add(res); paymentStreams.set(req.player.id, set);
  const keepalive = setInterval(() => res.write(': keepalive\n\n'), 25000);
  req.on('close', () => { clearInterval(keepalive); set.delete(res); if (!set.size) paymentStreams.delete(req.player.id); });
});

/* ============================================================
   БЭК-ОФИС: СОТРУДНИКИ, ЖУРНАЛ, НАСТРОЙКИ, РИСК, ОТЧЁТЫ
   ============================================================ */

/**
 * Что этот сотрудник может. Клиент рисует панель по этому ответу и ничего
 * не додумывает: раздела, на который нет права, он просто не строит.
 *
 * Это удобство, а не защита. Защита - need() на каждой ручке: спрятанный
 * раздел открывается одной строкой в консоли браузера.
 */
/* ---------- Подтверждение входа в панель (служебный бот) ---------- */

app.post('/api/admin/2fa/status', auth, staffOnly, (req, res) => {
  res.json(twoFactorState(req.player.id, req.sessionHash));
});

/*
 * Ссылка привязки. Сменить уже привязанный Telegram можно только из
 * подтверждённой сессии: иначе украденный пароль позволил бы перевесить
 * подтверждения на чужой Telegram.
 */
app.post('/api/admin/2fa/link', auth, staffOnly, (req, res) => {
  const st = twoFactorState(req.player.id, req.sessionHash);
  if (st.linked && st.required && !st.confirmed) {
    return res.status(403).json({ error: 'Telegram уже привязан. Сменить его можно после подтверждения входа' });
  }
  const url = createLink(req.player.id);
  if (!url) return res.status(503).json({ error: 'Служебный бот ещё не готов, попробуйте через минуту' });
  res.json({ url });
});

app.post('/api/admin/2fa/request', auth, staffOnly, limits.auth, async (req, res) => {
  try {
    res.json(await requestApproval(req.player.id, req.sessionHash, { ip: req.ip, userAgent: req.get('user-agent') }));
  } catch (err) {
    res.status(err.code === 'NOT_LINKED' || err.code === 'NO_SESSION' ? 400 : 502)
      .json({ error: err.code === 'TG_ERROR' ? 'Telegram не ответил, попробуйте ещё раз' : err.message });
  }
});

app.post('/api/admin/2fa/poll', auth, staffOnly, (req, res) => {
  res.json({
    status: challengeStatus(Number(req.body?.id), req.player.id),
    confirmed: sessionConfirmed(req.sessionHash),
  });
});

app.post('/api/admin/2fa/code', auth, staffOnly, limits.auth, (req, res) => {
  try {
    confirmByCode(Number(req.body?.id), req.player.id, req.body?.code);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message, code: err.code });
  }
});

app.post('/api/admin/me', auth, adminOnly, (req, res) => {
  const role = ROLE_BY_ID.get(req.staff?.role);
  res.json({
    role: req.staff?.role || null,
    roleName: role?.name || '',
    permissions: [...req.perms],
    balanceCap: balanceCapFor(req.staff),
    note: req.staff?.note || '',
    sections: {
      players: req.perms.has('players.view'),
      finance: req.perms.has('finance.payouts.view'),
      // Споры игроков ждут человека: число показывается на вкладке раздела.
      disputes: req.perms.has('finance.payouts.view') ? sicilia.openDisputesCount() : 0,
      promo: req.perms.has('promo.view') || req.perms.has('partners.view'),
      risk: req.perms.has('risk.view'),
      reports: req.perms.has('reports.view'),
      journal: req.perms.has('journal.view'),
      staff: req.perms.has('staff.manage'),
      settings: req.perms.has('settings.manage'),
    },
  });
});

app.post('/api/admin/staff', auth, need('staff.manage'), (req, res) => {
  res.json({
    rows: staffList(),
    roles: publicRoles(),
    assignable: assignableRoles(req.perms, req.staff?.role).map((r) => r.id),
    permissions: PERMISSIONS,
    groups: PERMISSION_GROUPS,
    // Выдать можно только то, что есть у себя: иначе любой, кому доверили
    // заводить поддержку, за два шага выписывает себе реквизиты приёма.
    grantable: [...req.perms],
    meId: req.player.id,
  });
});

app.post('/api/admin/staff/save', auth, need('staff.manage'), (req, res) => {
  const body = req.body || {};
  const role = String(body.role || '');
  if (!ROLE_BY_ID.has(role)) return res.status(400).json({ error: 'Неизвестная роль' });

  const allowedRoles = assignableRoles(req.perms, req.staff?.role).map((r) => r.id);
  if (!allowedRoles.includes(role)) {
    return res.status(403).json({ error: 'Эта роль вам недоступна' });
  }

  const extra = (Array.isArray(body.extra) ? body.extra : []).filter(isPermission);
  const denied = (Array.isArray(body.denied) ? body.denied : []).filter(isPermission);
  const notMine = extra.filter((p) => !req.perms.has(p));
  if (notMine.length) {
    return res.status(403).json({ error: `Нельзя выдать то, чего нет у вас: ${notMine.join(', ')}` });
  }

  // Потолок правки баланса - тоже право: свой потолок нельзя раздать шире.
  // Ноль означает «без потолка», то есть шире любого числа.
  const myCap = balanceCapFor(req.staff);
  if (myCap > 0 && body.balanceCap !== null && body.balanceCap !== undefined) {
    const cap = Math.max(0, Math.trunc(Number(body.balanceCap) || 0));
    if (cap === 0 || cap > myCap) {
      return res.status(403).json({ error: `Потолок правки баланса не может быть выше вашего (${myCap})` });
    }
  }

  const target = findUserByAnyId(body.userKey);
  if (target) {
    const existing = staffRow(target.id);
    if (existing && !canManage(req.perms, req.staff?.role, existing.role)) {
      return res.status(403).json({ error: 'Эту запись вам править нельзя' });
    }
    // Снять права самому себе можно только по ошибке, и это ошибка, после
    // которой в панель никто не войдёт. Поэтому нельзя.
    if (target.id === req.player.id && body.active === false) {
      return res.status(400).json({ error: 'Нельзя выключить самого себя' });
    }
  }

  try {
    res.json({ rows: staffSave(req.player.id, { ...body, role, extra, denied }) });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/staff/remove', auth, need('staff.manage'), (req, res) => {
  const userId = Number(req.body?.userId);
  if (userId === req.player.id) {
    return res.status(400).json({ error: 'Нельзя удалить самого себя' });
  }
  const existing = staffRow(userId);
  if (!existing) return res.status(404).json({ error: 'Сотрудник не найден' });
  if (!canManage(req.perms, req.staff?.role, existing.role)) {
    return res.status(403).json({ error: 'Эту запись вам править нельзя' });
  }
  res.json({ rows: staffRemove(req.player.id, userId) });
});

app.post('/api/admin/journal', auth, need('journal.view'), (req, res) => {
  res.json(adminJournal({
    limit: Math.min(200, Math.max(1, Number(req.body?.limit) || 80)),
    offset: Math.max(0, Number(req.body?.offset) || 0),
    adminId: Math.max(0, Number(req.body?.adminId) || 0),
    action: String(req.body?.action || '').slice(0, 40),
  }));
});

app.post('/api/admin/settings', auth, need('settings.manage'), (req, res) => {
  res.json({ rows: settingsAll() });
});

app.post('/api/admin/settings/save', auth, need('settings.manage'), (req, res) => {
  res.json({ rows: saveSettings(req.player.id, req.body?.patch || {}) });
});

app.post('/api/admin/player/note', auth, need('players.notes'), (req, res) => {
  const userId = Number(req.body?.userId);
  try {
    res.json({ notes: addPlayerNote(req.player.id, userId, req.body?.text, req.body?.pinned) });
  } catch (err) {
    if (err.code === 'BAD') return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/player/note/delete', auth, need('players.notes'), (req, res) => {
  try {
    res.json({ notes: deletePlayerNote(req.player.id, Number(req.body?.noteId)) });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/player/limits', auth, need('players.limits'), (req, res) => {
  const userId = Number(req.body?.userId);
  if (!getUserById(userId)) return res.status(404).json({ error: 'Игрок не найден' });
  res.json({
    limits: setPlayerLimits(req.player.id, userId, req.body?.patch || {}),
    day: dayActivity(userId),
    cooldownMs: LIMIT_COOLDOWN_MS,
  });
});

app.post('/api/admin/risk', auth, need('risk.view'), (req, res) => {
  res.json(riskSignals({ limit: Math.min(100, Math.max(5, Number(req.body?.limit) || 40)) }));
});

app.post('/api/admin/reports', auth, need('reports.view'), (req, res) => {
  const days = Math.min(180, Math.max(1, Number(req.body?.days) || 30));
  res.json({ days, daily: revenueDaily(days), cases: caseRevenueReport(days) });
});

/**
 * Выгрузка в CSV.
 *
 * Разделитель - точка с запятой, кодировка с BOM: Excel в русской локали
 * открывает запятую как разделитель дробной части и складывает всю строку в
 * одну ячейку. Это не придирка, это первое, обо что спотыкается любой отчёт.
 */
app.post('/api/admin/export', auth, need('reports.view'), (req, res) => {
  const kind = String(req.body?.kind || 'daily');
  const days = Math.min(180, Math.max(1, Number(req.body?.days) || 30));
  const date = (t) => new Date(t).toISOString().slice(0, 10);

  let head = [];
  let rows = [];
  if (kind === 'cases') {
    head = ['кейс', 'открытий', 'игроков', 'поставлено', 'выплачено', 'доход', 'отдача'];
    rows = caseRevenueReport(days).map((r) => [
      r.title, r.opened, r.players, r.wagered, r.paid, r.ggr,
      r.rtp === null ? '' : (r.rtp * 100).toFixed(2)]);
  } else {
    head = ['дата', 'раундов', 'игроков', 'поставлено', 'выплачено', 'доход',
            'отдача', 'пополнено', 'выведено', 'чистый приход', 'регистраций'];
    rows = revenueDaily(days).map((r) => [
      date(r.day), r.rounds, r.players, r.wagered, r.paid, r.ggr,
      r.rtp === null ? '' : (r.rtp * 100).toFixed(2),
      r.deposits, r.payouts, r.net, r.signups]);
  }

  const escape = (v) => {
    const text = String(v ?? '');
    return /[";\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const csv = '\ufeff' + [head, ...rows].map((r) => r.map(escape).join(';')).join('\r\n');
  logAdmin(req.player.id, 0, 'export', { note: kind, meta: { days, rows: rows.length } });
  res.type('text/csv; charset=utf-8').send(csv);
});

app.use((err, req, res, next) => {
  console.error('Ошибка запроса:', err);
  if (!err.status || err.status >= 500) {
    countError('http:500', `Сервер отвечает ошибками 500. Последняя: ${req.method} ${req.path}: ${err.message}`);
  }
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Внутренняя ошибка сервера' });
});

const PORT = Number(process.env.PORT || 3000);

/*
 * Падение процесса. Необработанная ошибка - это состояние, в котором дальше
 * работать нельзя: оповещаем и выходим, systemd поднимет сервер заново.
 * Пауза перед выходом даёт оповещению уйти.
 */
const CRASH_EXIT_DELAY_MS = 3000;
process.on('uncaughtException', (err) => {
  console.error('Необработанная ошибка:', err);
  alert('process:crash', `Сервер упал: ${err.message}. systemd перезапустит его.`);
  setTimeout(() => process.exit(1), CRASH_EXIT_DELAY_MS);
});
process.on('unhandledRejection', (err) => {
  console.error('Необработанный отказ промиса:', err);
  countError('process:rejection', `Необработанная ошибка в фоне: ${err?.message || err}`, { threshold: 3 });
});

/*
 * Метка «процесс работает» рядом с базой. Штатная остановка (выкат,
 * systemctl restart) её снимает. Если при старте метка на месте - прошлый
 * процесс умер сам, и об этом надо сказать: иначе перезапуски после падений
 * проходят незамеченными, пока не станут постоянными.
 */
const RUN_MARK = join(dirname(resolve(process.env.DB_PATH || './data/app.db')), '.running');
const crashedBefore = existsSync(RUN_MARK);
try { writeFileSync(RUN_MARK, String(process.pid)); } catch { /* только для разбора */ }
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    try { rmSync(RUN_MARK, { force: true }); } catch { /* пусть */ }
    process.exit(0);
  });
}

// HOST задаёт служба (deploy/luckybox.service): на сервере только 127.0.0.1,
// снаружи вход один - через nginx. Без HOST слушаем все адреса, как раньше:
// так работают разработка и тесты.
app.listen(PORT, process.env.HOST || undefined, () => {
  startOpsBot();
  if (crashedBefore) inform('Сервер перезапустился после сбоя: прошлый процесс не остановился штатно. Причина - в journalctl -u luckybox.');
  startFeed();
  startCatalogSync();
  sicilia.startReconcile((userId) => emitPayment(userId, 'payment.completed', { source: 'sicilia' }));
  broadcast.resumeBroadcasts();

  console.log(`\n  LUCKYBOX запущен на http://localhost:${PORT}`);
  if (process.env.DEV_MODE === 'true') {
    console.log('  DEV_MODE включён - без входа любой запрос идёт от тестового игрока.');
  }
  console.log(`  Краш RTP: ${(gameReport.crashRtp * 100).toFixed(2)}%  ` +
              `Рулетка RTP: ${(gameReport.rouletteRtp * 100).toFixed(2)}%  ` +
              `Риск-игра RTP: ${(gambleReport.rtp * 100).toFixed(2)}%  ` +
              `Апгрейд RTP: ${(upgradeReport.rtp * 100).toFixed(2)}%`);
  for (const r of slotReport) {
    console.log(`  Слот ${r['слот']}: отдача ${r['отдача всего']}, ` +
                `бонус раз в ${r['бонус раз в']} прокрутов, ` +
                `покупка бонуса ${r['цена бонуса']}`);
  }
  console.log(`  Оформление карточек: ${skinReport.families} семейств на ${skinReport.tiers} ступеней редкости`);
  console.log(`  Витрина: ${FEED_CONFIG.synthetic ? 'выдуманные выпадения включены' : 'только живые игроки'}` +
              `, порог x${FEED_CONFIG.minMultiplier}, пул ${FEED_CONFIG.poolSize}`);
  console.log(`  Бесплатный кейс за подписку: ${subscriptionConfigured() ? 'настроен' : 'выключен (нет канала/кейса)'}\n`);
  console.table(caseReport);
});
