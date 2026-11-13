/* ============================================================
   PB-7381 · ЯДРО: данные → расписание → выделение (js/core.js)

   Один файл вместо прежних data.js + schedule.js + selection.js:
   проект держим компактным, файлов для чтения меньше (заказчик
   13.11.2026 — «оптимизируй проект»). Порядок секций важен и сохранён:

     1) PB7381_DATA  — демо-данные, единственный источник (бриф §8);
     2) PB7381_SCHED — расписание и формат цены «100,00 ₽» (§6);
     3) PB7381_SEL   — выделение «день-час» (§3.1, §3.2, §4.2).

   Цепочка зависимостей: DATA → SCHED → SEL. DOM здесь нет: рендер
   в js/ui.js (мобильные варианты) и js/web.js (веб-версия).
   ============================================================ */
/* ============================================================
   PB-7381 · «Повременная тарификация» — ДАННЫЕ (единственный источник демо-данных)

   Правило брифа (§8): демо-данные лежат ТОЛЬКО здесь; состояние живёт в памяти
   страницы (localStorage не используем, между перезагрузками ничего не сохраняем).

   Модель расписания (§6): интервал = день 0–6 (0 = Пн) × час 0–23, значение — id тарифа.
   Ключ интервала — строка `"день-час"`, например `"0-10"` (Пн, 10:00–11:00).
   ============================================================ */

window.PB7381_DATA = (function () {
  'use strict';

  var DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  var DAYS_LONG = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

  /* Тарифы (§6). Цвет — токен палитры ДС (литералов в коде быть не должно):
     базовая — Neutral/50, счастливый час — Accent/10, выходные — Negative/50.
     `letter` — буква для ячейки в компактных режимах: «Б», «С», «В» вместо
     цены и названия (мобильный вариант 2, js/ui.js и компактный расклад
     js/web.js); в десктопной ячейке по-прежнему цена и название.

     `markVar` — насыщенная ступень той же шкалы (Neutral/400, Accent/500,
     Negative/500); в мобильном варианте 2 она красит точку в списке тарифов
     (js/ui.js). Веб-прототип с 13.11.2026 берёт для точки `colorVar` — тот же
     бледный цвет, что у заливки ячейки (заказчик: «цвет точки должен совпадать
     с бледным цветом ячейки»), поэтому `markVar` в веб-раскладке не читается. */
  var TARIFFS = [
    {
      id: 'base',
      name: 'Базовая цена',
      price: 100,
      letter: 'Б',
      system: true,
      colorVar: '--ds-palette-neutral-50',
      inkVar: '--ds-color-text-primary',
      markVar: '--ds-palette-neutral-400'
    },
    {
      id: 'happy',
      name: 'Счастливый час',
      price: 50,
      letter: 'С',
      system: false,
      colorVar: '--ds-palette-accent-10',
      inkVar: '--ds-color-text-primary',
      markVar: '--ds-palette-accent-500'
    },
    {
      id: 'weekend',
      name: 'Выходные',
      price: 250,
      letter: 'В',
      system: false,
      colorVar: '--ds-palette-negative-50',
      inkVar: '--ds-color-text-primary',
      markVar: '--ds-palette-negative-500'
    }
  ];

  /* Услуга и правила (§6). Значения по умолчанию — как в брифе. */
  var SERVICE = {
    name: 'Бильярд',
    basePrice: 100,
    enabled: true,
    /* 'absolute' — по абсолютному времени; 'relative' — по времени относительно запуска */
    mode: 'absolute',
    /* «Округлять время до», '00:00' запрещено (§5) */
    rounding: '00:01',
    /* «Минимальное время»: выключено по умолчанию; при включении '00:00' запрещено */
    minTime: { on: false, hours: 0, minutes: 0 },
    /* 'hour' — «За час»; 'minute' — «За минуту» (цены пересчитываются: 100 ₽/час → 1,67 ₽/мин) */
    priceDisplay: 'hour'
  };

  /* Ресторан: имя в дропдауне шапки и варианты в шторке выбора (единственный
     выбор). Это тоже демо-данные (§8), поэтому лежат здесь, а не в разметке. */
  var RESTAURANT = {
    current: 'Прага',
    list: ['Прага', 'Кофейня на Пресне', 'Бистро «Сад»']
  };

  /* Демо-расписание (§6) — одинаковое для обоих вариантов.
     periods: [день|дни, час с (включительно), час до (не включая), id тарифа] */
  var PERIODS = [
    [[0, 1, 2, 3, 4], 0, 11, 'base'],
    [[0, 1, 2, 3, 4], 11, 12, 'happy'],
    [[0, 1, 2, 3, 4], 12, 14, 'base'],
    [[0, 1, 2, 3, 4], 14, 15, 'happy'],
    [[0, 1, 2, 3, 4], 15, 24, 'base'],
    [[5, 6], 0, 9, 'base'],
    [[5, 6], 9, 18, 'weekend'],
    [[5, 6], 18, 24, 'base']
  ];

  /* Сообщения снэкбара (§8, §4.3) — тексты брифа, менять нельзя */
  var TEXTS = {
    saved: 'Изменения сохранены',
    saveError: 'Не удалось сохранить изменения',
    applied: 'Применено: ',
    noOtherTariffs: 'Других тарифов нет'
  };

  return {
    DAYS_SHORT: DAYS_SHORT,
    DAYS_LONG: DAYS_LONG,
    TARIFFS: TARIFFS,
    SERVICE: SERVICE,
    RESTAURANT: RESTAURANT,
    PERIODS: PERIODS,
    TEXTS: TEXTS
  };
})();

/* ═══ 2/3 · РАСПИСАНИЕ И ЦЕНЫ ═══════════════════════════════ */
/* ============================================================
   PB-7381 · расписание: чтение/запись, подписи времени и цены

   Здесь только работа с данными расписания — без DOM (рендер в js/ui.js).
   Зависит от window.PB7381_DATA (js/core.js).

   Модель (§6): 7 дней × 24 часа, значение — id тарифа; ключ `"день-час"`.
   ============================================================ */

window.PB7381_SCHED = (function () {
  'use strict';

  var D = window.PB7381_DATA;
  var NBSP = '\u00A0';

  /* grid[день][час] = id тарифа */
  var grid = [];

  function makeKey(day, hour) {
    return day + '-' + hour;
  }

  function parseKey(key) {
    var parts = String(key).split('-');
    return { day: parseInt(parts[0], 10), hour: parseInt(parts[1], 10) };
  }

  /* Собрать расписание из PERIODS (демо-данные §6) */
  function reset() {
    grid = [];
    for (var d = 0; d < 7; d++) {
      grid.push(new Array(24).fill('base'));
    }
    D.PERIODS.forEach(function (period) {
      var days = period[0];
      var from = period[1];
      var to = period[2];
      var tariffId = period[3];
      days.forEach(function (day) {
        for (var h = from; h < to; h++) {
          grid[day][h] = tariffId;
        }
      });
    });
  }

  function get(day, hour) {
    return grid[day] ? grid[day][hour] : undefined;
  }

  function set(day, hour, tariffId) {
    if (!grid[day]) { return; }
    grid[day][hour] = tariffId;
  }

  /* Снимок расписания — для «Отменить» в снэкбаре (§4.3) */
  function snapshot() {
    return grid.map(function (row) { return row.slice(); });
  }

  function restore(snap) {
    grid = snap.map(function (row) { return row.slice(); });
  }

  function keysAll() {
    var keys = [];
    for (var d = 0; d < 7; d++) {
      for (var h = 0; h < 24; h++) { keys.push(makeKey(d, h)); }
    }
    return keys;
  }

  function keysDay(day) {
    var keys = [];
    for (var h = 0; h < 24; h++) { keys.push(makeKey(day, h)); }
    return keys;
  }

  /* Строка сетки — один час во всех семи днях (выделение по строке, как по столбцу) */
  function keysHour(hour) {
    var keys = [];
    for (var d = 0; d < 7; d++) { keys.push(makeKey(d, hour)); }
    return keys;
  }

  function tariff(id) {
    for (var i = 0; i < D.TARIFFS.length; i++) {
      if (D.TARIFFS[i].id === id) { return D.TARIFFS[i]; }
    }
    return D.TARIFFS[0];
  }

  /* ── Время ────────────────────────────────────────────────
     По абсолютному времени: `10:00-11:00`; по времени относительно запуска
     (§5): `0:00-1:00` — часы с начала сеанса, данные не меняются.
     Разделитель — дефис (заказчик 13.11.2026). */
  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function hourLabel(hour) {
    return D.SERVICE.mode === 'relative' ? String(hour) : pad2(hour);
  }

  function timeRange(hour) {
    return hourLabel(hour) + ':00-' + hourLabel(hour + 1) + ':00';
  }

  function intervalLabel(day, hour) {
    return D.DAYS_SHORT[day] + ', ' + timeRange(hour);
  }

  /* ── Цена ─────────────────────────────────────────────────
     Формат брифа (§6): `100,00 ₽`, `1 000,00 ₽` — запятая, два знака,
     разделитель тысяч — неразрывный пробел. */
  function formatNumber(value) {
    var rounded = Math.round(value * 100) / 100;
    var parts = rounded.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return parts[0] + ',' + parts[1];
  }

  function formatPrice(value) {
    return formatNumber(value) + NBSP + '₽';
  }

  /* Цена тарифа в текущем отображении: «За час» — как есть, «За минуту» — /60 */
  function priceOf(tariffId) {
    var price = tariff(tariffId).price;
    return D.SERVICE.priceDisplay === 'minute' ? price / 60 : price;
  }

  /* Цена подписью — «100,00 ₽», без единиц измерения: «/ч» и «/мин»
     в интерфейсе не показываем (заказчик 13.11.2026). «За час»/«За минуту»
     меняет только значение (priceOf), формат строки от этого не зависит. */
  function priceLabel(tariffId) {
    return formatPrice(priceOf(tariffId));
  }

  /* Список разных тарифов среди выделенных интервалов — в порядке TARIFFS */
  function uniqueTariffs(keys) {
    var seen = {};
    keys.forEach(function (key) {
      var p = parseKey(key);
      seen[get(p.day, p.hour)] = true;
    });
    return D.TARIFFS.filter(function (t) { return seen[t.id]; });
  }

  /* Итог по выделению (§2.4): общая сумма и разбивка по тарифам.
     Минутное отображение пересчитывает цену часа на минуту, а сеанс в демо
     считается по часам — поэтому итог всегда «цена часа × число часов». */
  function sumForKeys(keys) {
    var byTariff = {};
    keys.forEach(function (key) {
      var p = parseKey(key);
      var id = get(p.day, p.hour);
      if (!byTariff[id]) { byTariff[id] = { id: id, hours: 0, sum: 0 }; }
      byTariff[id].hours += 1;
      byTariff[id].sum += tariff(id).price;
    });
    var list = Object.keys(byTariff).map(function (id) { return byTariff[id]; });
    var total = list.reduce(function (acc, item) { return acc + item.sum; }, 0);
    return { total: total, list: list };
  }

  reset();

  return {
    reset: reset,
    get: get,
    set: set,
    snapshot: snapshot,
    restore: restore,
    keysAll: keysAll,
    keysDay: keysDay,
    keysHour: keysHour,
    tariff: tariff,
    makeKey: makeKey,
    parseKey: parseKey,
    hourLabel: hourLabel,
    timeRange: timeRange,
    intervalLabel: intervalLabel,
    formatNumber: formatNumber,
    formatPrice: formatPrice,
    priceOf: priceOf,
    priceLabel: priceLabel,
    uniqueTariffs: uniqueTariffs,
    sumForKeys: sumForKeys
  };
})();

/* ═══ 3/3 · ВЫДЕЛЕНИЕ ═══════════════════════════════════════ */
/* ============================================================
   PB-7381 · выделение интервалов

   Одно выделение на оба варианта: набор ключей `"день-час"`. Операции —
   добавление, снятие, прямоугольный диапазон, столбец дня, весь день, все 168.
   Выделение живёт в памяти и НЕ сбрасывается при смене дня, скролле и закрытии
   шторки (§3.1, §3.2, §4.2).

   Зависит от window.PB7381_SCHED (js/core.js).
   ============================================================ */

window.PB7381_SEL = (function () {
  'use strict';

  var S = window.PB7381_SCHED;
  var keys = new Set();
  var listeners = [];

  function emit() {
    listeners.forEach(function (fn) { fn(stats()); });
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function stats() {
    return { size: keys.size, empty: keys.size === 0 };
  }

  function has(key) { return keys.has(key); }

  function size() { return keys.size; }

  /* Отсортированный список: сверху Пн, внутри дня — по часам */
  function list() {
    return Array.from(keys).sort(function (a, b) {
      var pa = S.parseKey(a);
      var pb = S.parseKey(b);
      return pa.day - pb.day || pa.hour - pb.hour;
    });
  }

  function add(key) {
    if (keys.has(key)) { return false; }
    keys.add(key);
    emit();
    return true;
  }

  function remove(key) {
    if (!keys.has(key)) { return false; }
    keys.delete(key);
    emit();
    return true;
  }

  /* Тап: выделить, повторный тап — снять (§3.1, §3.2) */
  function toggle(key) {
    if (keys.has(key)) { keys.delete(key); } else { keys.add(key); }
    emit();
    return keys.has(key);
  }

  function addMany(nextKeys) {
    nextKeys.forEach(function (key) { keys.add(key); });
    emit();
  }

  function clear() {
    if (!keys.size) { return; }
    keys.clear();
    emit();
  }

  /* Прямоугольник: от интервала a до интервала b включительно (протяжка, §3.2) */
  function rectangle(keyA, keyB) {
    var a = S.parseKey(keyA);
    var b = S.parseKey(keyB);
    var d1 = Math.min(a.day, b.day);
    var d2 = Math.max(a.day, b.day);
    var h1 = Math.min(a.hour, b.hour);
    var h2 = Math.max(a.hour, b.hour);
    for (var d = d1; d <= d2; d++) {
      for (var h = h1; h <= h2; h++) { keys.add(S.makeKey(d, h)); }
    }
    emit();
  }

  function dayKeys(day) { return S.keysDay(day); }

  function isDayFull(day) {
    return S.keysDay(day).every(function (key) { return keys.has(key); });
  }

  /* Тап по заголовку дня / «Выбрать весь день»: выделить столбец, повторно — снять */
  function toggleDay(day) {
    if (isDayFull(day)) {
      S.keysDay(day).forEach(function (key) { keys.delete(key); });
    } else {
      S.keysDay(day).forEach(function (key) { keys.add(key); });
    }
    emit();
    return isDayFull(day);
  }

  /* Строка сетки: тап по времени выделяет час во всех семи днях — зеркально
     столбцу дня (заказчик 11.11.2026), повторный тап по времени — снять */
  function isHourFull(hour) {
    return S.keysHour(hour).every(function (key) { return keys.has(key); });
  }

  function toggleHour(hour) {
    if (isHourFull(hour)) {
      S.keysHour(hour).forEach(function (key) { keys.delete(key); });
    } else {
      S.keysHour(hour).forEach(function (key) { keys.add(key); });
    }
    emit();
    return isHourFull(hour);
  }

  /* «Все дни»: все 168 интервалов, повторно — снять */
  function isAllFull() { return keys.size === 168; }

  function toggleAll() {
    if (isAllFull()) {
      keys.clear();
    } else {
      S.keysAll().forEach(function (key) { keys.add(key); });
    }
    emit();
    return isAllFull();
  }

  /* Вернуть выделение к снимку (после «Отменить» в снэкбаре тариф не трогаем) */
  function replace(nextKeys) {
    keys = new Set(nextKeys);
    emit();
  }

  return {
    onChange: onChange,
    stats: stats,
    has: has,
    size: size,
    list: list,
    add: add,
    remove: remove,
    toggle: toggle,
    addMany: addMany,
    clear: clear,
    rectangle: rectangle,
    dayKeys: dayKeys,
    isDayFull: isDayFull,
    toggleDay: toggleDay,
    isHourFull: isHourFull,
    toggleHour: toggleHour,
    isAllFull: isAllFull,
    toggleAll: toggleAll,
    replace: replace
  };
})();
