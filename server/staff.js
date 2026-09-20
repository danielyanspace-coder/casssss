/**
 * Сотрудники и права.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО. До сих пор админ был один флаг `users.is_admin`:
 * либо человек не видит ничего, либо может изменить чужой баланс, подтвердить
 * вывод и поменять реквизиты приёма платежей. Ставить на поддержку человека,
 * который заодно может выписать себе выплату, нельзя, а поддержка нужна
 * круглосуточно. Отсюда роли.
 *
 * ПРИНЦИП. Право - это строка вида `finance.payouts.resolve`. Роль - это
 * готовый набор прав, то есть просто удобная заготовка. Хранится у сотрудника
 * И роль, И два списка поправок: что выдано сверх роли и что отобрано.
 * Поэтому «поддержка, но ещё и промокоды» не требует новой роли.
 *
 * ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО. Ни одно право не даёт «сделать всё». Даже у
 * владельца проверка идёт по списку: если завтра появится новое право,
 * владелец получит его явно, через OWNER_ROLE, а не потому, что где-то стоит
 * `if (isOwner) return true`. Такое `if` переживает любые правки и однажды
 * пропускает то, чего не должен.
 */

/* ============================================================
   ПРАВА
   ============================================================ */

/**
 * Группы нужны интерфейсу: в списке из двадцати с лишним галочек без
 * разделителей невозможно проверить, что именно ты выдал человеку.
 */
export const PERMISSION_GROUPS = [
  { id: 'players', name: 'Игроки' },
  { id: 'finance', name: 'Финансы' },
  { id: 'promo', name: 'Промо и партнёры' },
  { id: 'support', name: 'Поддержка' },
  { id: 'risk', name: 'Риск и контроль' },
  { id: 'system', name: 'Система' },
];

export const PERMISSIONS = [
  { id: 'players.view', group: 'players', label: 'Смотреть карточки игроков' },
  { id: 'players.notes', group: 'players', label: 'Вести заметки в карточке' },
  { id: 'players.balance', group: 'players', label: 'Править баланс',
    hint: 'Размер правки ограничен лимитом роли' },
  { id: 'players.gift', group: 'players', label: 'Дарить кейсы и фриспины' },
  { id: 'players.block', group: 'players', label: 'Блокировать и разблокировать' },
  { id: 'players.limits', group: 'players', label: 'Лимиты ответственной игры' },

  { id: 'finance.payouts.view', group: 'finance', label: 'Видеть заявки на вывод' },
  { id: 'finance.payouts.resolve', group: 'finance', label: 'Проводить и отклонять выводы' },
  { id: 'finance.payments.view', group: 'finance', label: 'Видеть приём платежей' },
  { id: 'finance.settings', group: 'finance', label: 'Реквизиты и устройства приёма',
    hint: 'Самое опасное право в панели: меняет, куда приходят деньги' },

  { id: 'promo.view', group: 'promo', label: 'Смотреть промокоды' },
  { id: 'promo.edit', group: 'promo', label: 'Создавать и выключать промокоды' },
  { id: 'partners.view', group: 'promo', label: 'Смотреть партнёров' },
  { id: 'partners.edit', group: 'promo', label: 'Заводить и править партнёров' },
  { id: 'partners.pay', group: 'promo', label: 'Выплачивать партнёрам' },

  { id: 'support.view', group: 'support', label: 'Читать обращения' },
  { id: 'support.reply', group: 'support', label: 'Отвечать в обращениях' },

  { id: 'risk.view', group: 'risk', label: 'Сигналы риска и мультиаккаунты' },
  { id: 'journal.view', group: 'risk', label: 'Журнал действий сотрудников' },

  { id: 'reports.view', group: 'system', label: 'Отчёты и аналитика' },
  { id: 'games.manage', group: 'system', label: 'Включать и выключать игры' },
  { id: 'settings.manage', group: 'system', label: 'Общие настройки площадки' },
  { id: 'staff.manage', group: 'system', label: 'Управлять сотрудниками',
    hint: 'Выдать можно только то, что есть у тебя самого' },
];

export const PERMISSION_IDS = PERMISSIONS.map((p) => p.id);
const PERMISSION_SET = new Set(PERMISSION_IDS);

export function isPermission(id) {
  return PERMISSION_SET.has(id);
}

/* ============================================================
   РОЛИ
   ============================================================ */

/**
 * balanceCap - потолок одной правки баланса в единицах. Ноль означает «без
 * потолка», и стоит он только у двух ролей.
 *
 * Потолок нужен не от злого умысла, а от опечатки: поддержка компенсирует
 * зависший прокрут на 500, промахивается на три нуля, и это уходит без
 * единой проверки. Правка сверх потолка не «требует подтверждения», а просто
 * не проходит: подтверждение человек нажимает не глядя.
 */
export const ROLES = [
  {
    id: 'owner',
    name: 'Владелец',
    description: 'Все права, включая сотрудников и реквизиты приёма платежей.',
    balanceCap: 0,
    permissions: PERMISSION_IDS.slice(),
  },
  {
    id: 'admin',
    name: 'Администратор',
    description: 'Всё, кроме управления сотрудниками и реквизитов приёма.',
    balanceCap: 0,
    permissions: PERMISSION_IDS.filter(
      (p) => p !== 'staff.manage' && p !== 'finance.settings'),
  },
  {
    id: 'finance',
    name: 'Финансист',
    description: 'Выводы, платежи, отчёты. Игроков видит, но не правит.',
    balanceCap: 0,
    permissions: [
      'players.view', 'players.notes',
      'finance.payouts.view', 'finance.payouts.resolve', 'finance.payments.view',
      'partners.view', 'partners.pay',
      'reports.view', 'journal.view',
    ],
  },
  {
    id: 'support',
    name: 'Поддержка',
    description: 'Обращения, карточка игрока, мелкие компенсации до 5 000.',
    balanceCap: 5000,
    permissions: [
      'players.view', 'players.notes', 'players.balance', 'players.gift',
      'players.limits',
      'support.view', 'support.reply',
      'promo.view',
    ],
  },
  {
    id: 'risk',
    name: 'Риск-менеджер',
    description: 'Блокировки, лимиты, сигналы, проверка выводов до выплаты.',
    balanceCap: 0,
    permissions: [
      'players.view', 'players.notes', 'players.block', 'players.limits',
      'finance.payouts.view',
      'risk.view', 'journal.view', 'reports.view',
    ],
  },
  {
    id: 'marketing',
    name: 'Маркетолог',
    description: 'Промокоды, партнёры, воронка. К деньгам игроков не допущен.',
    balanceCap: 0,
    permissions: [
      'players.view',
      'promo.view', 'promo.edit', 'partners.view', 'partners.edit',
      'reports.view',
    ],
  },
  {
    id: 'analyst',
    name: 'Аналитик',
    description: 'Только чтение: отчёты, выводы, платежи, журнал.',
    balanceCap: 0,
    permissions: [
      'players.view',
      'finance.payouts.view', 'finance.payments.view',
      'promo.view', 'partners.view',
      'reports.view', 'journal.view',
    ],
  },
];

export const ROLE_BY_ID = new Map(ROLES.map((r) => [r.id, r]));

/** Роль, которой помечаются админы из переменной окружения. */
export const BOOTSTRAP_ROLE = 'owner';

/* ============================================================
   РАЗРЕШЕНИЯ КОНКРЕТНОГО СОТРУДНИКА
   ============================================================ */

function parseList(raw) {
  if (!raw) return [];
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(value) ? value.filter(isPermission) : [];
  } catch {
    // Испорченный JSON в поправках не должен ронять вход в панель. Пустой
    // список означает «только то, что даёт роль», то есть меньше прав, а не
    // больше: ошибка разбора не может никому ничего выдать.
    return [];
  }
}

/**
 * Итоговый набор прав: роль плюс выданное, минус отобранное.
 *
 * Отобранное применяется последним намеренно: «этому человеку всё, кроме
 * выплат» должно работать, даже если выплаты придут и из роли, и из
 * поправки.
 */
export function permissionsFor(row) {
  if (!row || !row.active) return new Set();
  const role = ROLE_BY_ID.get(row.role);
  if (!role) return new Set();
  const set = new Set(role.permissions);
  for (const p of parseList(row.extra_perms)) set.add(p);
  for (const p of parseList(row.denied_perms)) set.delete(p);
  return set;
}

/** Потолок одной правки баланса. Ноль - без потолка. */
export function balanceCapFor(row) {
  const role = ROLE_BY_ID.get(row?.role);
  if (!role) return 1;
  if (row.balance_cap === null || row.balance_cap === undefined) return role.balanceCap;
  return Math.max(0, Number(row.balance_cap) || 0);
}

/**
 * Что сотрудник вправе сделать с чужой записью.
 *
 * Два правила, и оба про то, чтобы панель нельзя было захватить изнутри:
 *
 *   1. Выдать можно только то, что есть у себя. Иначе любой, кому доверили
 *      заводить поддержку, за два шага выписывает себе реквизиты приёма.
 *   2. Владельца правит только владелец. Иначе администратор снимает
 *      владельца и остаётся единственным, кто может вернуть доступ.
 */
export function canManage(actorPerms, actorRole, targetRole) {
  if (!actorPerms.has('staff.manage')) return false;
  if (targetRole === 'owner' && actorRole !== 'owner') return false;
  return true;
}

export function grantableBy(actorPerms) {
  return PERMISSION_IDS.filter((p) => actorPerms.has(p));
}

/** Роли, которые этот сотрудник вправе назначить. */
export function assignableRoles(actorPerms, actorRole) {
  return ROLES.filter((r) => {
    if (r.id === 'owner' && actorRole !== 'owner') return false;
    // Назначить роль, в которой есть право, которого у тебя нет, нельзя -
    // это тот же обход, что и выдача права напрямую.
    return r.permissions.every((p) => actorPerms.has(p));
  });
}

export function publicRoles() {
  return ROLES.map((r) => ({
    id: r.id, name: r.name, description: r.description,
    balanceCap: r.balanceCap, permissions: r.permissions,
  }));
}
