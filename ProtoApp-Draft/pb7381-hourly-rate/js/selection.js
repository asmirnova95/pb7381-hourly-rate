/* ============================================================
   PB-7381 · выделение интервалов

   Одно выделение на оба варианта: набор ключей `"день-час"`. Операции —
   добавление, снятие, прямоугольный диапазон, столбец дня, весь день, все 168.
   Выделение живёт в памяти и НЕ сбрасывается при смене дня, скролле и закрытии
   шторки (§3.1, §3.2, §4.2).

   Зависит от window.PB7381_SCHED (js/schedule.js).
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
