/**
 * Настройки площадки: то, что правят чаще, чем выкатывают код.
 *
 * Отдельным файлом, а не внутри db.js, по одной причине: этот же список нужен
 * автономной демо-сборке, а она собирается без базы. Импортировать ради
 * списка весь db.js значит создавать файл базы на машине, где собирают демо.
 *
 * Значения по умолчанию заданы здесь, а не в базе: база пустая у нового
 * сервера, и приложение обязано подниматься без неё.
 */

export const SETTING_DEFS = [
  { key: 'maintenance', type: 'bool', value: '0', group: 'Режим',
    label: 'Технические работы',
    hint: 'Игроки видят заглушку, сотрудники входят как обычно' },
  { key: 'registration_open', type: 'bool', value: '1', group: 'Режим',
    label: 'Регистрация новых игроков' },
  { key: 'payouts_open', type: 'bool', value: '1', group: 'Касса',
    label: 'Приём заявок на вывод' },
  { key: 'deposits_open', type: 'bool', value: '1', group: 'Касса',
    label: 'Приём пополнений' },
  { key: 'min_payout', type: 'int', value: String(Number(process.env.MIN_PAYOUT || 1000)), group: 'Касса',
    label: 'Минимальная сумма вывода',
    hint: 'Ноль вернёт значение из настроек сервера' },
  { key: 'games_cases', type: 'bool', value: '1', group: 'Игры', label: 'Кейсы' },
  { key: 'games_crash', type: 'bool', value: '1', group: 'Игры', label: 'Краш' },
  { key: 'games_roulette', type: 'bool', value: '1', group: 'Игры', label: 'Рулетка' },
  { key: 'games_upgrade', type: 'bool', value: '1', group: 'Игры', label: 'Апгрейд' },
  { key: 'games_mini', type: 'bool', value: '1', group: 'Игры', label: 'Мини-игры' },
  { key: 'games_fortune', type: 'bool', value: '1', group: 'Игры', label: 'Колесо фортуны' },
  /*
   * Слоты выключены по умолчанию - это решение заказчика, а не поломка.
   * Раздел готов целиком и включается одной галочкой в панели: Настройки ->
   * Игры -> Слоты. Выключенный раздел не показывается ни в меню на телефоне,
   * ни в боковой панели, и сервер отвечает 503 на прямой вызов ручки.
   */
  { key: 'games_slots', type: 'bool', value: '0', group: 'Игры', label: 'Слоты' },
];
