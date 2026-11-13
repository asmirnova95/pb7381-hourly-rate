/* ============================================================
   PB-7381 · ВЕБ-ВЕРСИЯ: карточка услуги «Бильярд», вкладка
   «Повременная тарификация» — в оболочке iiko web (как на стенде).

   РАСКЛАД ОДИН — ВЕБ (заказчик 14.11.2026): переключателя режимов нет,
   карточка открыта постоянно и не закрывается (ни крестиком, ни Esc, ни
   кликом по затемнению). Планшет и телефон — отдельные файлы
   (variant-1.html / variant-2.html), их механик в этом скрипте нет.

   Что рисует скрипт:
     • фон-страницу «Услуги» (таблица услуг);
     • таблицу расписания 7×24 (день × час; в ячейке цена «100,00 ₽» и
       название тарифа);
     • карточку «Тариф» (Card ДС, статичная): пока ничего не выделено —
       заголовок «Тариф» и подсказка; при выделении — заголовок «Тарифы»,
       «Сбросить», сводка и тарифы чипами Chips ДС на всю ширину карточки,
       фон чипа — цвет тарифа; клик по чипу сразу применяет тариф
       (отдельной кнопки нет) и снимает выделение;
     • карточку «Настройки» (Card ДС, статичная, 1:1 с макетом): два
       Select form (режим тарификации и режим отображения цены), блок
       «Округлять время до» — два Input (часы, минуты); ниже «Минимальное
       время» с тумблером и двумя такими же Input, которые появляются
       только при включённом тумблере;
     • меню ресторана, режима и отображения цены (Menu item ДС),
       снэкбар (Snackbar ДС) с текстовой белой кнопкой действия.
       Галка «check» есть только в меню ресторана (единственный выбор);
       из меню двух селектов она убрана (заказчик 13.11.2026).

   ПРАВИЛА (заказчик 12.11.2026): только компоненты и токены iikoDS;
   снэкбар — по центру экрана, 32 от нижнего края, одна строка;
   клик вне сетки снимает выделение (кроме мест, где выделение нужно
   самому действию: сетка, чипы тарифов, открытые меню);
   текст в карточках — ВСЕГДА по левому краю, по центру не выравниваем
   никогда (исключение — колонка времени в сетке, там подпись по центру
   ячейки по просьбе заказчика).

   Зависит от js/core.js.
   DOM-контракт: #pbw-drawer, #pbw-scrim, #pbw-board, #pbw-sel,
   #pbw-tariffs, #pbw-card-rates-title, #pbw-reset, #pbw-card-rates,
   #pbw-card-settings, #pbw-enabled, #pbw-enabled-title,
   #pbw-rest-btn/-name/-menu, #pbw-mode/-menu, #pbw-price/-menu,
   #pbw-rounding-hours/-minutes, #pbw-mintime-on, #pbw-mintime-fields,
   #pbw-mintime-hours/-minutes, #pbw-cancel, #pbw-save, #pbw-save-label,
   #pbw-snackbar, #pbw-listtable.
   ============================================================ */

window.PB7381_WEB = (function () {
  'use strict';

  var D = window.PB7381_DATA;
  var S = window.PB7381_SCHED;
  var SEL = window.PB7381_SEL;

  var DAYS = 7;
  var HOURS = 24;
  var DEFAULT_TARIFF = 'base';

  var el = {};
  var state = { saving: false };
  /* настройки на момент загрузки и последнего сохранения: к этому снимку
     возвращает «Отмена» в подвале карточки (карточка не закрывается) */
  var savedSettings = null;

  var drag = null;
  var suppressClickUntil = 0;
  var snackTimer = null;

  var ICON = {
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></svg>'
  };

  /* ── Утилиты ────────────────────────────────────────────── */
  function byId(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  function plural(n, forms) {
    var abs = Math.abs(n) % 100;
    var last = abs % 10;
    if (abs > 10 && abs < 20) { return forms[2]; }
    if (last > 1 && last < 5) { return forms[1]; }
    if (last === 1) { return forms[0]; }
    return forms[2];
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* «ч:мм» из настроек → строка «чч:мм» */
  function hhmm(hours, minutes) { return pad(hours) + ':' + pad(minutes); }

  /* Строка «чч:мм» → {hours, minutes}; мусор и выход за границы обрезаем */
  function parseHHMM(text, fallback) {
    var m = /^(\d{1,2}):(\d{1,2})$/.exec(String(text).trim());
    if (!m) { return fallback; }
    var h = Math.min(Math.max(parseInt(m[1], 10), 0), 23);
    var mi = Math.min(Math.max(parseInt(m[2], 10), 0), 59);
    return { hours: h, minutes: mi };
  }

  /* ── Стартовое расписание ──────────────────────────────────
     Прототип открывается с тарифом по умолчанию во всех 168 интервалах. */
  function fillDefaultTariff() {
    for (var d = 0; d < DAYS; d++) {
      for (var h = 0; h < HOURS; h++) { S.set(d, h, DEFAULT_TARIFF); }
    }
  }

  /* ── Таблица расписания ──────────────────────────────────── */
  /* Цена подписью — «100,00 ₽»: тот же формат, что в сводке и легенде,
     единицы измерения не дописываем (заказчик 13.11.2026: «/ч» и «/мин»
     в интерфейсе не показывать). Формат — из js/schedule.js. */
  function cellPrice(tariffId) {
    return S.formatPrice(S.priceOf(tariffId));
  }

  /* Точки-маркера в чипах больше нет: фон чипа сам цвета тарифа
     (заказчик 12.11.2026 — точка бледная и нечитабельная). */

  /* Ячейка: цена (12 / regular / Text primary) сверху, название тарифа
     (Caption S 8/10 / Text secondary) снизу — каждая строка одна,
     с многоточием (заказчик 14.11.2026). */
  function cellHtml(day, hour) {
    var key = S.makeKey(day, hour);
    var tariff = S.tariff(S.get(day, hour));
    var on = SEL.has(key);
    var price = cellPrice(tariff.id);
    return '<button type="button" class="pbw-cell' + (on ? ' pbw-cell--on' : '') + '"' +
      ' data-key="' + key + '" aria-pressed="' + on + '"' +
      ' aria-label="' + esc(D.DAYS_LONG[day] + ', ' + S.timeRange(hour) + ', ' +
        tariff.name + ', ' + price) + '"' +
      ' style="--pb-cell-bg: var(' + tariff.colorVar + ');' +
        ' --pb-cell-ink: var(' + tariff.inkVar + ')">' +
      '<span class="pbw-cell__price">' + esc(price) + '</span>' +
      '<span class="pbw-cell__name">' + esc(tariff.name) + '</span>' +
    '</button>';
  }

  /* Шапка дней и колонка часов — такие же переключатели: день выделяет
     весь столбец, время — весь час во всех семи днях */
  function gridHtml() {
    var head = '<div class="pbw-grid__corner" aria-hidden="true"></div>';
    head += D.DAYS_SHORT.map(function (label, day) {
      var full = SEL.isDayFull(day);
      return '<button type="button" class="pbw-grid__day' + (full ? ' pbw-grid__day--on' : '') + '"' +
        ' data-daycol="' + day + '" aria-pressed="' + full + '"' +
        ' aria-label="' + esc(D.DAYS_LONG[day] + ' — выделить весь день') + '">' + label + '</button>';
    }).join('');

    var rows = '';
    for (var h = 0; h < HOURS; h++) {
      var hourFull = SEL.isHourFull(h);
      /* подпись часа — интервал двумя строками: начало над концом
         («00:00» / «01:00», заказчик 12.11.2026); по центру колонки */
      rows += '<button type="button" class="pbw-grid__time' + (hourFull ? ' pbw-grid__time--on' : '') + '"' +
        ' data-hourrow="' + h + '" aria-pressed="' + hourFull + '"' +
        ' aria-label="' + esc('Все дни, ' + S.timeRange(h) + ' — выделить час') + '">' +
        '<span class="pbw-grid__time-first">' + esc(S.hourLabel(h)) + ':00</span>' +
        '<span class="pbw-grid__time-second">' + esc(S.hourLabel(h + 1)) + ':00</span>' +
      '</button>';
      for (var d = 0; d < DAYS; d++) { rows += cellHtml(d, h); }
    }

    return '<div class="pbw-grid" role="group" aria-label="Расписание 7 дней на 24 часа">' + head + rows + '</div>';
  }

  /* Выключенное состояние рисует не сетка, а подпись под тумблером
     (заказчик 13.11.2026): при `body.pbw-off` сетка и обе карточки скрыты
     (css/web.css), поэтому в доске всегда раскладка расписания. */
  function renderBoard() {
    if (!el.board) { return; }
    el.board.innerHTML = gridHtml();
    syncSelection();
  }


  /* ── Сводка выделения и список тарифов ───────────────────── */
  function summaryLines(keys) {
    var n = keys.length;
    var first = S.parseKey(keys[0]);
    var last = S.parseKey(keys[n - 1]);
    var line1;
    if (n === 1) {
      /* только день: интервал идёт второй строкой (timeRange), иначе
         «Пн, 00:00-01:00» дублировался бы дважды */
      line1 = D.DAYS_SHORT[first.day];
    } else if (n === 168) {
      line1 = 'Все интервалы · ' + n;
    } else if (first.day === last.day) {
      line1 = n + ' ' + plural(n, ['интервал', 'интервала', 'интервалов']) + ' · ' +
        D.DAYS_SHORT[first.day];
    } else {
      line1 = n + ' ' + plural(n, ['интервал', 'интервала', 'интервалов']) + ' · ' +
        D.DAYS_SHORT[first.day] + '–' + D.DAYS_SHORT[last.day];
    }
    /* интервал — «01:00-02:00»: дефис, а не тире (заказчик 13.11.2026) */
    var line2 = S.hourLabel(first.hour) + ':00-' + S.hourLabel(last.hour + 1) + ':00';
    return [line1, line2];
  }

  function selectionHtml() {
    var keys = SEL.list();
    if (!keys.length) {
      return '<span class="pbw-summary__line">Выделите интервалы, чтобы изменить тариф</span>';
    }
    var lines = summaryLines(keys);
    return '<span class="pbw-summary__line pbw-summary__line--strong">' + esc(lines[0]) + '</span>' +
      '<span class="pbw-summary__line">' + esc(lines[1]) + '</span>';
  }

  /* Тарифы в карточке — чипы Chips ДС (Size M / Filled) на всю ширину
     карточки: фон чипа — цвет тарифа (тот же colorVar, что заливка ячейки),
     слева название, справа цена, точки нет (заказчик 12.11.2026). Чип
     применённого тарифа дополнительно получает контур акцента 1 px: видно,
     какой тариф стоит во всех выделенных интервалах. */
  function tariffChipsHtml() {
    var uniform = null;
    var keys = SEL.list();
    if (keys.length) {
      var first = S.parseKey(keys[0]);
      var base = S.get(first.day, first.hour);
      uniform = keys.every(function (key) {
        var p = S.parseKey(key);
        return S.get(p.day, p.hour) === base;
      }) ? base : null;
    }
    return D.TARIFFS.map(function (tariff) {
      var on = uniform === tariff.id;
      return '<button type="button" class="ds-chips ds-chips--filled pbw-chip' +
          (on ? ' pbw-chip--on' : '') + '"' +
        ' data-tariff="' + tariff.id + '" aria-pressed="' + on + '"' +
        ' style="--pbw-chip-bg: var(' + tariff.colorVar + ');' +
          ' --pbw-chip-ink: var(' + tariff.inkVar + ')">' +
        '<span class="ds-chips__chip-container">' +
          '<span class="ds-chips__chip-text">' + esc(tariff.name) + '</span>' +
          '<span class="ds-chips__chip-text pbw-chip__price">' +
            esc(cellPrice(tariff.id)) + '</span>' +
        '</span>' +
      '</button>';
    }).join('');
  }

  /* Тарифы в карточке видны только при выделении (заказчик 13.11.2026):
     без выделения в карточке остаётся заголовок «Тариф» и подсказка. */
  function renderTariffs() {
    if (!el.tariffs) { return; }
    var empty = !SEL.size();
    el.tariffs.hidden = empty;
    el.tariffs.innerHTML = empty ? '' : tariffChipsHtml();
    if (el.ratesTitle) { el.ratesTitle.textContent = empty ? 'Тариф' : 'Тарифы'; }
  }

  /* «Сбросить» показывается только при выделении (заказчик 13.11.2026) */
  function syncReset() {
    if (!el.reset) { return; }
    var off = !SEL.size();
    el.reset.hidden = off;
    el.reset.disabled = off;
    el.reset.classList.toggle('ds-btn--disabled', off);
  }

  function renderSelection() {
    if (el.sel) { el.sel.innerHTML = selectionHtml(); }
    renderTariffs();
    syncReset();
  }


  /* Подсветка без перерисовки: прокрутка не сбрасывается */
  function syncSelection() {
    var cells = el.board.querySelectorAll('[data-key]');
    for (var i = 0; i < cells.length; i++) {
      var on = SEL.has(cells[i].getAttribute('data-key'));
      cells[i].classList.toggle('pbw-cell--on', on);
      cells[i].setAttribute('aria-pressed', String(on));
    }
    var days = el.board.querySelectorAll('[data-daycol]');
    for (var j = 0; j < days.length; j++) {
      var full = SEL.isDayFull(Number(days[j].getAttribute('data-daycol')));
      days[j].classList.toggle('pbw-grid__day--on', full);
      days[j].setAttribute('aria-pressed', String(full));
    }
    var hours = el.board.querySelectorAll('[data-hourrow]');
    for (var k = 0; k < hours.length; k++) {
      var hourFull = SEL.isHourFull(Number(hours[k].getAttribute('data-hourrow')));
      hours[k].classList.toggle('pbw-grid__time--on', hourFull);
      hours[k].setAttribute('aria-pressed', String(hourFull));
    }
    renderSelection();
  }


  /* ── Применение тарифа ───────────────────────────────────── */
  function appliedText(name, keys) {
    var n = keys.length;
    if (n === 1) {
      var one = S.parseKey(keys[0]);
      return 'Тариф «' + name + '» применён: ' + D.DAYS_SHORT[one.day] + ', ' + S.timeRange(one.hour);
    }
    return 'Тариф «' + name + '» применён: ' + n + ' ' +
      plural(n, ['интервал', 'интервала', 'интервалов']);
  }

  function applyTariff(id) {
    var keys = SEL.list();
    if (!keys.length) {
      /* список тарифов без выделения скрыт, поэтому подсказываем, к чему
         тариф можно применить */
      showSnack('Выделите интервалы в расписании — тариф применится к ним', '', null, 3500);
      return;
    }
    var before = S.snapshot();
    keys.forEach(function (key) {
      var point = S.parseKey(key);
      S.set(point.day, point.hour, id);
    });
    /* выделение после применения тарифа сбрасывается (заказчик 12.11.2026):
       тариф применён — интервалы больше не «в работе» */
    SEL.clear();
    renderBoard();
    var tariff = S.tariff(id);
    showSnack(appliedText(tariff.name, keys), 'Отменить', function () {
      S.restore(before);
      renderBoard();
    }, 6000);
  }

  /* ── Снэкбар ────────────────────────────────────────────── */
  function hideSnack() {
    clearTimeout(snackTimer);
    if (!el.snackbar) { return; }
    el.snackbar.hidden = true;
    el.snackbar.innerHTML = '';
  }

  function showSnack(text, actionText, onAction, duration) {
    if (!el.snackbar) { return; }
    clearTimeout(snackTimer);
    el.snackbar.hidden = false;
    el.snackbar.innerHTML = '<div class="ds-snackbar ds-snackbar--single ds-snackbar--dark">' +
        '<div class="ds-snackbar__body">' +
          '<span class="ds-snackbar__icon">' + ICON.info + '</span>' +
          '<span class="ds-snackbar__label">' + esc(text) + '</span>' +
          (actionText
            ? '<span class="ds-snackbar__content">' +
              '<button type="button" class="ds-btn ds-btn--s ds-btn--neutral ds-btn--text"' +
              ' data-snack-action><span class="ds-btn__label">' + esc(actionText) + '</span></button>' +
              '</span>'
            : '') +
        '</div>' +
      '</div>';
    var action = el.snackbar.querySelector('[data-snack-action]');
    if (action && onAction) {
      action.addEventListener('click', function () {
        hideSnack();
        onAction();
      });
    }
    snackTimer = setTimeout(hideSnack, duration || 4000);
  }

  /* ── Карточка услуги (панель справа поверх затемнения) ─────
     Расклад один — веб: карточка открыта постоянно и не закрывается
     (заказчик 14.11.2026), поэтому closeDrawer здесь нет. */
  function openDrawer() {
    el.drawer.hidden = false;
    el.scrim.hidden = false;
    document.body.classList.add('pbw-drawer-on');
    /* первую ячейку НЕ фокусируем: при открытии прототипа она подсвечивалась
       рамкой фокуса — «первая ячейка выделена жирным чёрным» (заказчик 12.11.2026) */
  }

  function closeMenus() {
    if (isRestaurantOpen()) { closeRestaurant(); }
    if (isModeOpen()) { closeMode(); }
    if (isPriceOpen()) { closePrice(); }
  }


  /* ── Ресторан: дропдаун на Menu item ─────────────────────── */
  function renderRestaurantMenu() {
    el.restMenu.innerHTML = D.RESTAURANT.list.map(function (name) {
      var on = name === D.RESTAURANT.current;
      return '<button type="button" class="ds-menu-item" data-restaurant="' + esc(name) + '"' +
        ' role="menuitemradio" aria-checked="' + on + '">' +
        '<span class="ds-menu-item__content">' +
          '<span class="ds-menu-item__label">' + esc(name) + '</span>' +
        '</span>' +
        '<span class="ds-menu-item__element-right">' +
          '<span class="ds-menu-item__icon pbw-menu__check"' + (on ? '' : ' hidden') + '>' +
            '<span class="material-icons" aria-hidden="true">check</span>' +
          '</span>' +
        '</span>' +
      '</button>';
    }).join('');
  }

  function syncRestaurant() {
    el.restName.textContent = D.RESTAURANT.current;
    el.restBtn.setAttribute('aria-label', 'Ресторан: ' + D.RESTAURANT.current + '. Изменить');
  }

  function isRestaurantOpen() { return el.restMenu && !el.restMenu.hidden; }

  function openRestaurant() {
    el.restMenu.hidden = false;
    el.restBtn.setAttribute('aria-expanded', 'true');
  }

  function closeRestaurant() {
    el.restMenu.hidden = true;
    el.restBtn.setAttribute('aria-expanded', 'false');
  }

  /* ── Режим тарификации: селект в карточке «Настройки времени» ── */
  var MODES = [
    { value: 'absolute', label: 'По абсолютному времени' },
    { value: 'relative', label: 'По времени относительно запуска' }
  ];

  /* Галки `check` у выбранного пункта нет (заказчик 13.11.2026): выбор виден
     в самом поле селекта. В меню ресторана галка остаётся — это единственный
     выбор в списке. */
  function renderModeMenu() {
    el.modeMenu.innerHTML = MODES.map(function (mode) {
      var on = D.SERVICE.mode === mode.value;
      return '<button type="button" class="ds-menu-item" data-mode="' + mode.value + '"' +
        ' role="option" aria-selected="' + on + '">' +
        '<span class="ds-menu-item__content">' +
          '<span class="ds-menu-item__label">' + esc(mode.label) + '</span>' +
        '</span>' +
      '</button>';
    }).join('');
  }

  function isModeOpen() { return el.modeMenu && !el.modeMenu.hidden; }

  function openMode() {
    renderModeMenu();
    el.modeMenu.hidden = false;
    el.mode.setAttribute('aria-expanded', 'true');
  }

  function closeMode() {
    el.modeMenu.hidden = true;
    el.mode.setAttribute('aria-expanded', 'false');
  }

  /* ── Режим отображения цены: второй селект карточки «Настройки» ──
     Подписи — как в макете (Figma 19204:247633): «Цена за час» / «Цена за минуту» */
  var PRICES = [
    { value: 'hour', label: 'Цена за час' },
    { value: 'minute', label: 'Цена за минуту' }
  ];

  function priceLabel(value) {
    for (var i = 0; i < PRICES.length; i++) {
      if (PRICES[i].value === value) { return PRICES[i].label; }
    }
    return PRICES[0].label;
  }

  function renderPriceMenu() {
    el.priceMenu.innerHTML = PRICES.map(function (price) {
      var on = D.SERVICE.priceDisplay === price.value;
      return '<button type="button" class="ds-menu-item" data-price="' + price.value + '"' +
        ' role="option" aria-selected="' + on + '">' +
        '<span class="ds-menu-item__content">' +
          '<span class="ds-menu-item__label">' + esc(price.label) + '</span>' +
        '</span>' +
      '</button>';
    }).join('');
  }

  function isPriceOpen() { return el.priceMenu && !el.priceMenu.hidden; }

  function openPrice() {
    renderPriceMenu();
    el.priceMenu.hidden = false;
    el.price.setAttribute('aria-expanded', 'true');
  }

  function closePrice() {
    el.priceMenu.hidden = true;
    el.price.setAttribute('aria-expanded', 'false');
  }

  /* ── Настройки: значения модели → контролы карточки ─────────
     В макете каждое время — два поля Timepicker: «Часы» и «Минуты»
     (Figma «Настройки», node 19204:247633), поэтому в модели часы и минуты
     раскладываем по отдельным Input. */
  function syncSettings() {
    var modeLabel = D.SERVICE.mode === 'relative'
      ? 'По времени относительно запуска'
      : 'По абсолютному времени';
    var valueNode = el.mode.querySelector('[data-value="mode"]');
    if (valueNode) { valueNode.textContent = modeLabel; }

    var priceNode = el.price ? el.price.querySelector('[data-value="price"]') : null;
    if (priceNode) { priceNode.textContent = priceLabel(D.SERVICE.priceDisplay); }

    var round = parseHHMM(D.SERVICE.rounding, { hours: 0, minutes: 1 });
    el.roundingHours.value = pad(round.hours);
    el.roundingMinutes.value = pad(round.minutes);

    el.minTimeOn.checked = !!D.SERVICE.minTime.on;
    el.minTimeHours.value = pad(D.SERVICE.minTime.hours);
    el.minTimeMinutes.value = pad(D.SERVICE.minTime.minutes);
    syncMinTimeFields();
  }

  /* Поля «Минимальное время» появляются только при включённом тумблере
     (заказчик 12.11.2026): пока он снят, блока полей нет в раскладке. */
  function syncMinTimeFields() {
    var on = !!(el.minTimeOn && el.minTimeOn.checked);
    if (!el.minTimeFields) { return; }
    el.minTimeFields.hidden = !on;
  }

  /* ── Фон: список услуг (строка открывает карточку) ───────── */
  var LIST_ROWS = [
    { name: 'Бильярд', sku: '00059', type: 'Услуга', group: 'Барные блюда', open: true },
    { name: 'Бильярд день', sku: '26', type: 'Ставка', group: 'Кухонные блюда' },
    { name: 'Баня', sku: '00080', type: 'Услуга', group: 'Кухонные блюда' },
    { name: 'Банкет', sku: '00584', type: 'Услуга', group: 'Барные блюда' },
    { name: 'Прокат кия', sku: '00112', type: 'Услуга', group: 'Барные блюда' },
    { name: 'Аренда зала', sku: '00118', type: 'Услуга', group: 'Кухонные блюда' }
  ];

  function rowHtml(row) {
    return '<button type="button" class="pbw-lrow"' + (row.open ? ' id="pbw-open-item"' : '') + '"' +
      (row.open ? ' data-open-item="1" aria-label="Открыть карточку услуги Бильярд"' : ' disabled') + '>' +
      '<span class="pbw-lrow__name"><span class="material-icons">chevron_right</span>' +
        '<span class="pbw-lrow__text">' + esc(row.name) + '</span></span>' +
      '<span class="pbw-lrow__cell">' + esc(row.sku) + '</span>' +
      '<span class="pbw-lrow__cell">' + esc(row.type) + '</span>' +
      '<span class="pbw-lrow__cell">' + esc(row.group) + '</span>' +
    '</button>';
  }

  function renderList() {
    var head = '<div class="pbw-lrow pbw-lrow--head" role="row">' +
      '<span>Наименование</span><span>Артикул</span><span>Тип</span><span>Категория</span>' +
    '</div>';
    el.list.innerHTML = head + LIST_ROWS.map(rowHtml).join('');
  }

  /* ── Тумблер «Включена» ─────────────────────────────────────
     Выключенное состояние — только тумблер «Выключена» и подпись под ним
     (заказчик 13.11.2026): класс pbw-off прячет ресторан, сетку и обе
     карточки правой колонки, подпись `.pbw-offnote` показывает (css/web.css). */
  function syncEnabledUi() {
    var on = !!D.SERVICE.enabled;
    el.enabled.checked = on;
    el.enabledTitle.textContent = on ? 'Включена' : 'Выключена';
    document.body.classList.toggle('pbw-off', !on);
  }

  /* ── Сохранение (имитация: 700 мс) ────────────────────────── */
  function saveWillFail() {
    return new URLSearchParams(window.location.search).get('save') === 'error';
  }

  function save(after) {
    if (state.saving) { return; }
    readSettings();
    state.saving = true;
    el.saveBtn.disabled = true;
    el.saveBtn.classList.add('ds-btn--disabled');
    el.saveLabel.textContent = 'Сохранение…';
    window.setTimeout(function () {
      state.saving = false;
      el.saveBtn.disabled = false;
      el.saveBtn.classList.remove('ds-btn--disabled');
      el.saveLabel.textContent = 'Сохранить';
      if (saveWillFail()) {
        showSnack(D.TEXTS.saveError, 'Повторить', function () { save(after); }, 6000);
        return;
      }
      savedSettings = settingsSnapshot();   /* к этому снимку возвращает «Отмена» */
      SEL.clear();
      showSnack(D.TEXTS.saved, '', null, 3000);
      if (after) { after(); }
    }, 700);
  }

  /* ── Выделение: тап, протяжка прямоугольником ───────────────
     Логика та же, что в мобильном варианте 2: порог 8 px, мышью протяжка
     всегда выделяет, на тач-экране вертикаль без выделения остаётся скроллом. */
  function onPointerDown(event) {
    if (event.button !== 0 && event.button !== undefined) { return; }
    var cell = event.target.closest ? event.target.closest('[data-key]') : null;
    if (!cell) { return; }
    drag = {
      key: cell.getAttribute('data-key'),
      x: event.clientX,
      y: event.clientY,
      pointerType: event.pointerType,
      active: false,
      cancelled: false,
      last: cell.getAttribute('data-key')
    };
  }

  function onPointerMove(event) {
    if (!drag) { return; }
    if (!drag.active && !drag.cancelled) {
      var dx = Math.abs(event.clientX - drag.x);
      var dy = Math.abs(event.clientY - drag.y);
      if (dx < 8 && dy < 8) { return; }
      if (drag.pointerType !== 'mouse' && SEL.size() === 0 && dy > dx) {
        drag.cancelled = true;
        return;
      }
      drag.active = true;
      SEL.add(drag.key);
    }
    if (!drag.active) { return; }
    var under = document.elementFromPoint(event.clientX, event.clientY);
    var cell = under && under.closest ? under.closest('[data-key]') : null;
    if (cell && cell.getAttribute('data-key') !== drag.last) {
      drag.last = cell.getAttribute('data-key');
      SEL.rectangle(drag.key, drag.last);
    }
    if (event.cancelable) { event.preventDefault(); }
  }

  function onPointerUp() {
    if (!drag) { return; }
    var wasTap = !drag.active && !drag.cancelled;
    var key = drag.key;
    drag = null;
    if (wasTap) {
      SEL.toggle(key);
      suppressClickUntil = Date.now() + 400;
    }
  }


  /* Пара полей «Часы / Минуты» → {hours, minutes}. Мусор и выход за границы
     обрезаем: 0–23 часа, 0–59 минут. */
  function inputHHMM(hoursNode, minutesNode, fallback) {
    var h = parseInt(String(hoursNode.value).replace(/\D/g, ''), 10);
    var m = parseInt(String(minutesNode.value).replace(/\D/g, ''), 10);
    if (isNaN(h)) { h = fallback.hours; }
    if (isNaN(m)) { m = fallback.minutes; }
    return {
      hours: Math.min(Math.max(h, 0), 23),
      minutes: Math.min(Math.max(m, 0), 59)
    };
  }

  /* контролы → модель (по изменению, как форма на стенде);
     «Режим отображения цены» пишется моделью сразу из меню селекта */
  function readSettings() {
    var round = inputHHMM(el.roundingHours, el.roundingMinutes,
      parseHHMM(D.SERVICE.rounding, { hours: 0, minutes: 1 }));
    if (round.hours || round.minutes) {          /* «00:00» запрещено (§5) */
      D.SERVICE.rounding = hhmm(round.hours, round.minutes);
    }
    var min = inputHHMM(el.minTimeHours, el.minTimeMinutes,
      { hours: D.SERVICE.minTime.hours, minutes: D.SERVICE.minTime.minutes });
    if (!min.hours && !min.minutes) {            /* «00:00» запрещено (§5) */
      min = { hours: D.SERVICE.minTime.hours, minutes: D.SERVICE.minTime.minutes };
    }
    D.SERVICE.minTime = { on: !!el.minTimeOn.checked, hours: min.hours, minutes: min.minutes };
  }

  /* ── Клики ──────────────────────────────────────────────── */
  function handleClick(event) {
    if (Date.now() < suppressClickUntil) { return; }
    var target = event.target;
    if (!target.closest) { return; }

    /* клик мимо открытых меню закрывает их */
    if (isRestaurantOpen() && !target.closest('.pbw-rest')) { closeRestaurant(); }
    if (isModeOpen() && !target.closest('.pbw-field')) { closeMode(); }
    if (isPriceOpen() && !target.closest('.pbw-field')) { closePrice(); }

    /* клик вне ячейки снимает выделение — «любой клик мимо ячейки»
       (заказчик 13.11.2026). Не снимаем только там, где выделение нужно
       самому действию: сетка, чипы тарифов, открытые меню. «Сбросить»
       снимает выделение тем же правилом. */
    if (!target.closest('.pbw-board') && !target.closest('.pbw-chips') &&
        !target.closest('.pbw-menu')) {
      SEL.clear();
    }

    /* поля ввода, тумблеры и их подписи обрабатывает сам контрол */
    if (target.closest('input, textarea, select, label')) { return; }

    var node = target.closest('[data-key],[data-daycol],[data-hourrow],[data-tariff],' +
      '[data-restaurant],[data-mode],[data-price],[data-open-item]');
    if (!node) { return; }

    if (node.hasAttribute('data-open-item')) { openDrawer(); return; }

    /* день — весь столбец, час — вся строка, ячейка — один интервал */
    if (node.hasAttribute('data-daycol')) {
      SEL.toggleDay(Number(node.getAttribute('data-daycol')));
      return;
    }
    if (node.hasAttribute('data-hourrow')) {
      SEL.toggleHour(Number(node.getAttribute('data-hourrow')));
      return;
    }
    if (node.hasAttribute('data-key')) {
      SEL.toggle(node.getAttribute('data-key'));
      return;
    }

    if (node.hasAttribute('data-restaurant')) {
      D.RESTAURANT.current = node.getAttribute('data-restaurant');
      closeRestaurant();
      renderRestaurantMenu();
      syncRestaurant();
      return;
    }

    if (node.hasAttribute('data-mode')) {
      D.SERVICE.mode = node.getAttribute('data-mode');
      closeMode();
      syncSettings();
      return;
    }

    /* отображение цены меняет подписи цен — перерисовываем сетку и чипы */
    if (node.hasAttribute('data-price')) {
      D.SERVICE.priceDisplay = node.getAttribute('data-price');
      closePrice();
      syncSettings();
      renderBoard();
      return;
    }

    if (node.hasAttribute('data-tariff')) {
      applyTariff(node.getAttribute('data-tariff'));
    }
  }

  /* «Сбросить» в заголовке карточки «Тарифы»: выделение снимается целиком */
  function resetSelection() {
    if (!SEL.size()) { return; }
    SEL.clear();
  }

  /* Снимок настроек: к нему возвращает «Отмена» в подвале. Карточка не
     закрывается, поэтому «Отмена» = откат правок с последнего сохранения. */
  function settingsSnapshot() {
    return {
      mode: D.SERVICE.mode,
      priceDisplay: D.SERVICE.priceDisplay,
      rounding: D.SERVICE.rounding,
      minTime: {
        on: D.SERVICE.minTime.on,
        hours: D.SERVICE.minTime.hours,
        minutes: D.SERVICE.minTime.minutes
      }
    };
  }

  function cancelEdits() {
    if (savedSettings) {
      D.SERVICE.mode = savedSettings.mode;
      D.SERVICE.priceDisplay = savedSettings.priceDisplay;
      D.SERVICE.rounding = savedSettings.rounding;
      D.SERVICE.minTime = {
        on: savedSettings.minTime.on,
        hours: savedSettings.minTime.hours,
        minutes: savedSettings.minTime.minutes
      };
      syncSettings();
      renderBoard();
    }
    closeMenus();
    hideSnack();
    SEL.clear();
  }

  /* селект ДС: клик и Enter/Space открывают и закрывают список */
  function bindSelect(node, isOpen, open, close) {
    if (!node) { return; }
    node.addEventListener('click', function (event) {
      event.stopPropagation();
      if (isOpen()) { close(); } else { open(); }
    });
    node.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (isOpen()) { close(); } else { open(); }
      }
    });
  }

  /* ── События ────────────────────────────────────────────── */
  /* ── События ────────────────────────────────────────────── */
  function bind() {
    document.addEventListener('click', handleClick);
    el.board.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);

    /* затемнение и крестик не нужны: карточка открыта всегда и не закрывается.
       «Сохранить и закрыть» закрывать нечего — работает как «Сохранить». */
    el.saveBtn.addEventListener('click', function () { save(null); });
    byId('pbw-save-close').addEventListener('click', function () { save(null); });
    byId('pbw-cancel').addEventListener('click', cancelEdits);

    /* дропдаун ресторана: свой обработчик, чтобы тот же клик не закрыл меню */
    el.restBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      if (isRestaurantOpen()) { closeRestaurant(); } else { openRestaurant(); }
    });

    /* оба селекта карточки «Настройки»: открытие по клику и с клавиатуры */
    bindSelect(el.mode, isModeOpen, openMode, closeMode);
    bindSelect(el.price, isPriceOpen, openPrice, closePrice);

    el.enabled.addEventListener('change', function () {
      D.SERVICE.enabled = el.enabled.checked;
      if (!D.SERVICE.enabled) { SEL.clear(); closeMenus(); }
      syncEnabledUi();
      renderBoard();
    });

    /* тумблер минимального времени показывает и скрывает пару полей; при
       включении с «00:00» подставляем 00:30 — «00:00» запрещено (§5) */
    el.minTimeOn.addEventListener('change', function () {
      if (el.minTimeOn.checked && !D.SERVICE.minTime.hours && !D.SERVICE.minTime.minutes) {
        D.SERVICE.minTime = { on: true, hours: 0, minutes: 30 };
        syncSettings();
      }
      syncMinTimeFields();
      readSettings();
    });
    [el.minTimeHours, el.minTimeMinutes, el.roundingHours, el.roundingMinutes]
      .forEach(function (node) { node.addEventListener('change', readSettings); });

    /* Esc закрывает меню и списки, но не карточку (14.11.2026) */
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') { return; }
      if (isRestaurantOpen()) { closeRestaurant(); return; }
      if (isModeOpen()) { closeMode(); return; }
      if (isPriceOpen()) { closePrice(); }
    });

    /* «Сбросить» в заголовке «Тарифов»: снимает выделение интервалов */
    if (el.reset) { el.reset.addEventListener('click', resetSelection); }

    SEL.onChange(syncSelection);
  }

  function init() {
    el = {
      drawer: byId('pbw-drawer'),
      scrim: byId('pbw-scrim'),
      board: byId('pbw-board'),
      sel: byId('pbw-sel'),
      tariffs: byId('pbw-tariffs'),
      ratesTitle: byId('pbw-card-rates-title'),
      restBtn: byId('pbw-rest-btn'),
      restName: byId('pbw-rest-name'),
      restMenu: byId('pbw-rest-menu'),
      mode: byId('pbw-mode'),
      modeMenu: byId('pbw-mode-menu'),
      price: byId('pbw-price'),
      priceMenu: byId('pbw-price-menu'),
      minTimeOn: byId('pbw-mintime-on'),
      minTimeFields: byId('pbw-mintime-fields'),
      minTimeHours: byId('pbw-mintime-hours'),
      minTimeMinutes: byId('pbw-mintime-minutes'),
      roundingHours: byId('pbw-rounding-hours'),
      roundingMinutes: byId('pbw-rounding-minutes'),
      enabled: byId('pbw-enabled'),
      enabledTitle: byId('pbw-enabled-title'),
      snackbar: byId('pbw-snackbar'),
      saveBtn: byId('pbw-save'),
      saveLabel: byId('pbw-save-label'),
      list: byId('pbw-listtable'),
      reset: byId('pbw-reset')
    };

    fillDefaultTariff();
    renderList();
    renderTariffs();
    renderRestaurantMenu();
    syncRestaurant();
    syncSettings();
    syncEnabledUi();
    renderBoard();
    syncSelection();
    savedSettings = settingsSnapshot();   /* стартовое состояние для «Отмены» */
    bind();
    openDrawer();      /* прототип открывается на карточке услуги — как ссылка на стенде */
  }

  return { init: init };
})();

