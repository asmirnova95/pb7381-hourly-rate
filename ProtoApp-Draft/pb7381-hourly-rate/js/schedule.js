/* ============================================================
   PB-7381 · расписание: чтение/запись, подписи времени и цены

   Здесь только работа с данными расписания — без DOM (рендер в js/ui.js).
   Зависит от window.PB7381_DATA (js/data.js).

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
     По абсолютному времени: `10:00–11:00`; по времени относительно запуска
     (§5): `0:00–1:00` — часы с начала сеанса, данные не меняются. */
  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function hourLabel(hour) {
    return D.SERVICE.mode === 'relative' ? String(hour) : pad2(hour);
  }

  function timeRange(hour) {
    return hourLabel(hour) + ':00–' + hourLabel(hour + 1) + ':00';
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

  function unitSuffix() {
    return D.SERVICE.priceDisplay === 'minute' ? '/мин' : '/час';
  }

  function priceLabel(tariffId) {
    return formatPrice(priceOf(tariffId)) + unitSuffix();
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
    unitSuffix: unitSuffix,
    priceLabel: priceLabel,
    uniqueTariffs: uniqueTariffs,
    sumForKeys: sumForKeys
  };
})();
