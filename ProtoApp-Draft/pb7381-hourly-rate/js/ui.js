/* ============================================================
   PB-7381 · рендер и поведение экрана (оба варианта)

   Один модуль на две страницы: variant-1.html («список по дням»)
   и variant-2.html («сетка 7×24»). Различие — только в разметке
   области расписания (bodyHtml), поведение общее: включение,
   выбор дня, выделение интервалов (тап и протяжка), футер
   выделения, шторка тарифа, настройки, снэкбар, сохранение.

   Зависит от js/data.js, js/schedule.js, js/selection.js.
   DOM-контракт страницы: #pb-body, #selbar, #scrim, #sheet (#sheet-inner),
   #settings, #interval-page (#interval-fields — экран «Изменить тариф»),
   #snackbar, #enabled, #open-restaurant, #open-settings, #btn-close, #btn-save.
   ============================================================ */

window.PB7381_UI = (function () {
  'use strict';

  var D = window.PB7381_DATA;
  var S = window.PB7381_SCHED;
  var SEL = window.PB7381_SEL;

  var variant = 1;
  var el = {};
  var state = {
    day: 0,
    sheet: null,            /* null | 'tariff' | 'mode' | 'rounding' | 'minTime' | 'price' |
                               'int-tariff' | 'int-day' | 'int-time' | 'restaurant' */
    interval: null,         /* черновик экрана интервала: { day, hour, tariff } */
    intervalDays: [],       /* дни, выбранные в шторке «День» (множественный выбор) */
    intervalHours: [],      /* часы, выбранные в шторке «Интервал» (множественный выбор) */
    saving: false,
    lastApply: null
  };
  var drag = null;
  var suppressClickUntil = 0;
  var HOURS = 24;           /* часов в сутках: строка шторки «Интервал» на каждый час */

  var ICON = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 12h3v9h6v-6h2v6h6v-9h3z"/></svg>',
    tabs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v3H4zm0 5.5h16v3H4zM4 16h16v3H4z"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.3 5.7 8 7l5 5-5 5 1.3 1.3L15.6 12z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
    arrowDown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5z"/></svg>',
    checkBoxOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-9 14-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
    checkBoxOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 5v14H5V5h14m0-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/></svg>',
    /* Type=Indeterminate — часть вложенных пунктов выбрана (родительская строка «все») */
    checkBoxMixed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-2 10H7v-2h10v2z"/></svg>'
  };

  /* ── Утилиты ────────────────────────────────────────────── */
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

  function byId(id) { return document.getElementById(id); }

  /* [0, 1, … n-1] — диапазон часов/дней для родительской строки «все» */
  function range(n) {
    var out = [];
    for (var i = 0; i < n; i++) { out.push(i); }
    return out;
  }

  /* ── Разметка области расписания ────────────────────────── */

  /* Переключатель дня — Button toggle (макет 19107:48915): контейнер 343×44, r12,
     белый фон и рамка #E0E0E0; выбранный день — Button M Accent Filled (#448AFF),
     остальные — Neutral Text (#333333). */
  function chipsHtml() {
    return '<div class="pb-daybar ds-button-toggle" role="tablist" aria-label="День недели">' +
      D.DAYS_SHORT.map(function (label, day) {
        var on = day === state.day;
        return '<button type="button" role="tab" aria-selected="' + on + '"' +
          ' class="ds-btn ds-btn--m pb-daychip ' + (on
            ? 'ds-btn--accent ds-btn--filled pb-daychip--on'
            : 'ds-btn--neutral ds-btn--text') + '"' +
          ' data-day="' + day + '"><span class="ds-btn__label">' + label + '</span></button>';
      }).join('') + '</div>';
  }

  /* Карточка интервала (макет `row` 19107:49258): 56 px, r8, pad 12, время 12/16
     `#616161`, название и цена справа. Фон — цвет тарифа (data.js: базовая
     Neutral/50, счастливый час Accent/10, выходные Negative/50). Тап открывает
     экран интервала, множественного выбора в варианте 1 нет. */
  function rowHtml(day, hour) {
    var key = S.makeKey(day, hour);
    var tariff = S.tariff(S.get(day, hour));
    return '<button type="button" class="pb-row" data-interval="' + key + '"' +
      ' style="--pb-row-bg: var(' + tariff.colorVar + '); --pb-row-ink: var(' + tariff.inkVar + ')"' +
      ' aria-label="' + esc(D.DAYS_LONG[day] + ', ' + S.timeRange(hour) + ', ' + tariff.name) + '">' +
      '<span class="pb-row__time">' + S.hourLabel(hour) + ':00<br>' +
        S.hourLabel(hour + 1) + ':00</span>' +
      '<span class="pb-row__main">' +
        '<span class="pb-row__label">' + esc(tariff.name) + '</span>' +
        '<span class="pb-row__price">' + esc(S.formatPrice(S.priceOf(tariff.id))) + '</span>' +
      '</span></button>';
  }

  function rowsHtml() {
    var html = '';
    for (var h = 0; h < 24; h++) { html += rowHtml(state.day, h); }
    return '<div class="pb-list" role="group" aria-label="Интервалы дня">' + html + '</div>';
  }

  /* Легенда тарифов: стоит под сеткой на прозрачном фоне (заказчик
     11.11.2026 — не серая плашка), при нехватке ширины прокручивается
     по горизонтали; ширина чипов — по содержимому */
  function legendHtml() {
    return '<div class="pb-legend" role="list" aria-label="Тарифы">' +
      D.TARIFFS.map(function (tariff) {
        return '<span class="pb-legend__item" role="listitem">' +
          '<span class="pb-dot" style="--pb-dot-color: var(' + tariff.colorVar + ')"></span>' +
          '<span class="pb-legend__label">' + esc(tariff.name) + ' (' +
          esc(S.formatPrice(S.priceOf(tariff.id))) + ')</span></span>';
      }).join('') + '</div>';
  }

  function gridHtml() {
    var head = '<div class="pb-grid__head"><span></span>' +
      D.DAYS_SHORT.map(function (label, day) {
        var full = SEL.isDayFull(day);
        return '<button type="button" class="pb-grid__day' +
          (full ? ' pb-grid__day--on' : '') + '" data-daycol="' + day + '"' +
          ' aria-pressed="' + full + '" aria-label="' + esc(D.DAYS_LONG[day]) + '">' +
          '<span>' + label + '</span></button>';
      }).join('') + '</div>';

    var rows = '';
    for (var h = 0; h < 24; h++) {
      /* время строки — такой же переключатель, как день в шапке: тап выделяет
         час во всех семи днях, повторный — снимает (заказчик 11.11.2026) */
      var hourFull = SEL.isHourFull(h);
      var cells = '';
      for (var d = 0; d < 7; d++) {
        var key = S.makeKey(d, h);
        var tariff = S.tariff(S.get(d, h));
        var on = SEL.has(key);
        cells += '<button type="button" class="pb-cell' + (on ? ' pb-cell--on' : '') + '"' +
          ' data-key="' + key + '" aria-pressed="' + on + '"' +
          ' aria-label="' + esc(D.DAYS_LONG[d] + ', ' + S.timeRange(h) + ', ' + tariff.name) + '"' +
          ' style="--pb-cell-bg: var(' + tariff.colorVar + ');' +
          ' --pb-cell-ink: var(' + tariff.inkVar + ')">' + esc(tariff.letter) + '</button>';
      }
      rows += '<div class="pb-grid__row">' +
        '<button type="button" class="pb-grid__time' +
          (hourFull ? ' pb-grid__time--on' : '') + '" data-hourrow="' + h + '"' +
          ' aria-pressed="' + hourFull + '" aria-label="' +
          esc('Все дни, ' + S.timeRange(h)) + '">' +
          '<span>' + S.hourLabel(h) + ':00<br>' +
          S.hourLabel(h + 1) + ':00</span></button>' + cells + '</div>';
    }
    return '<div class="pb-grid" role="group" aria-label="Расписание 7 на 24">' +
      head + rows + '</div>' + legendHtml();
  }

  function skeletonHtml() {
    var rows = '';
    for (var i = 0; i < 7; i++) { rows += '<div class="pb-skeleton__row"></div>'; }
    return '<div class="pb-skeleton" aria-hidden="true">' +
      '<div class="pb-skeleton__row pb-skeleton__row--chip"></div>' + rows + '</div>';
  }

  /* Выключенная тарификация: расписания нет, вместо него — одна строка текста
     (формулировка заказчика; заголовок «Тарификация выключена» не дублируем) */
  function emptyHtml() {
    return '<div class="pb-empty">' +
      '<p class="pb-empty__text">Повременная тарификация выключена. ' +
      'Включите, чтобы увидеть расписание тарифов</p>' +
      '</div>';
  }

  function bodyHtml() {
    if (!D.SERVICE.enabled) { return emptyHtml(); }
    return variant === 2 ? gridHtml() : chipsHtml() + rowsHtml();
  }

  /* ── Отрисовка ──────────────────────────────────────────── */

  function renderBody() {
    var scroller = el.body.querySelector('.pb-list, .pb-grid');
    var scrollTop = scroller ? scroller.scrollTop : 0;
    el.body.innerHTML = bodyHtml();
    var next = el.body.querySelector('.pb-list, .pb-grid');
    if (next && scrollTop) { next.scrollTop = scrollTop; }
    syncSelection();
  }

  function renderSkeleton() {
    el.body.innerHTML = skeletonHtml();
  }

  /* Подсветка выделения без перерисовки — чтобы не сбрасывать скролл.
     В варианте 1 выделения нет: тап по карточке открывает экран интервала. */
  function syncSelection() {
    var cells = el.body.querySelectorAll('[data-key]');
    for (var i = 0; i < cells.length; i++) {
      var on = SEL.has(cells[i].getAttribute('data-key'));
      cells[i].classList.toggle(variant === 2 ? 'pb-cell--on' : 'pb-row--on', on);
      cells[i].setAttribute('aria-pressed', String(on));
    }
    var days = el.body.querySelectorAll('[data-daycol]');
    for (var j = 0; j < days.length; j++) {
      var full = SEL.isDayFull(Number(days[j].getAttribute('data-daycol')));
      days[j].classList.toggle('pb-grid__day--on', full);
      days[j].setAttribute('aria-pressed', String(full));
    }
    var hours = el.body.querySelectorAll('[data-hourrow]');
    for (var k = 0; k < hours.length; k++) {
      var hourFull = SEL.isHourFull(Number(hours[k].getAttribute('data-hourrow')));
      hours[k].classList.toggle('pb-grid__time--on', hourFull);
      hours[k].setAttribute('aria-pressed', String(hourFull));
    }
    renderSelbar();
  }

  /* Сводка выделения — тексты §4.2 брифа */
  function summaryLines(keys) {
    var n = keys.length;
    var first = S.parseKey(keys[0]);
    var last = S.parseKey(keys[n - 1]);
    var line1;

    if (n === 1) {
      line1 = S.intervalLabel(first.day, first.hour);
    } else if (n === 168) {
      line1 = 'Все интервалы · ' + n;
    } else if (first.day === last.day) {
      line1 = n + ' ' + plural(n, ['интервал', 'интервала', 'интервалов']) +
        ' · ' + D.DAYS_SHORT[first.day] + ', ' +
        S.hourLabel(first.hour) + ':00–' + S.hourLabel(last.hour + 1) + ':00';
    } else {
      line1 = n + ' ' + plural(n, ['интервал', 'интервала', 'интервалов']) +
        ' · ' + D.DAYS_SHORT[first.day] + '–' + D.DAYS_SHORT[last.day];
    }

    var tariffs = S.uniqueTariffs(keys);
    var line2 = tariffs.length === 1
      ? tariffs[0].name + ' · ' + S.priceLabel(tariffs[0].id)
      : 'Тариф: разный';

    return { line1: line1, line2: line2, count: n };
  }

  function renderSelbar() {
    /* в варианте 1 футера выделения нет — элемента на странице тоже нет */
    if (!el.selbar) { return; }
    var keys = SEL.list();
    if (!keys.length) {
      el.selbar.hidden = true;
      el.selbar.innerHTML = '';
      return;
    }
    var lines = summaryLines(keys);
    el.selbar.hidden = false;
    el.selbar.innerHTML =
      '<div class="pb-selbar__summary">' +
        '<span class="pb-selbar__line1">' + esc(lines.line1) + '</span>' +
        '<span class="pb-selbar__line2">' + esc(lines.line2) + '</span>' +
      '</div>' +
      '<div class="pb-selbar__actions">' +
        '<button type="button" class="ds-btn ds-btn--m ds-btn--accent ds-btn--outlined"' +
          ' data-action="clear"><span class="ds-btn__label">Сбросить</span></button>' +
        '<button type="button" class="ds-btn ds-btn--m ds-btn--accent ds-btn--filled"' +
          ' data-action="change-tariff"><span class="ds-btn__label">Изменить тариф</span></button>' +
      '</div>';
  }

  /* ── Пункты меню в шторке (компонент Menu item) ───────────
     Макет: `19121:61584` (3 двухстрочных пункта) и `19121:60840`
     (8 однострочных + кнопка «Применить» внизу). Пункт — 8/16,
     иконка 20 слева, текст Body M; выбранный — фон Back selected
     (#F5F9FF). Множественный выбор (дни, интервалы) — чекбокс слева
     и обязательная кнопка применения; единственный — галка справа,
     тап применяет значение и закрывает шторку без доп. действий.
     Родительская строка «все» (`mixed`) — проверенный компонент
     Checkbox, Type=Indeterminate: часть пунктов выбрана. */

  function menuItemHtml(opts) {
    var checked = Boolean(opts.checked);
    var mixed = Boolean(opts.mixed);
    var left = opts.multi
      ? '<span class="ds-menu-item__element-left">' +
          '<span class="ds-icon-size ds-icon-size--5x pb-mi__box' +
            (mixed ? ' pb-mi__box--mixed' : '') +
            (checked ? ' pb-mi__box--on' : '') + '">' +
            (mixed ? ICON.checkBoxMixed : (checked ? ICON.checkBoxOn : ICON.checkBoxOff)) +
          '</span></span>'
      : (opts.dot
        ? '<span class="ds-menu-item__element-left">' +
            '<span class="pb-dot" style="--pb-dot-color: var(' + opts.dot + ')"></span>' +
          '</span>'
        : '');
    var right = (!opts.multi && checked)
      ? '<span class="ds-menu-item__element-right">' +
          '<span class="ds-icon-size ds-icon-size--5x pb-mi__check">' + ICON.check + '</span>' +
        '</span>'
      : '';
    var labelDown = opts.label
      ? '<span class="ds-menu-item__label-down">' + esc(opts.label) + '</span>'
      : '';
    /* parent («все дни» / «весь день») не подсвечиваем Back selected:
       он не выбранное значение, а переключатель всего списка */
    var classes = 'ds-menu-item pb-mi' +
      (checked && !opts.plain ? ' pb-mi--on' : '') +
      (opts.divider ? ' pb-mi--divider' : '');
    return '<button type="button" class="' + classes + '"' +
      ' ' + opts.attr + '="' + opts.value + '"' +
      (opts.multi
        ? ' role="checkbox" aria-checked="' + (mixed ? 'mixed' : String(checked)) + '"'
        : ' aria-pressed="' + checked + '"') + '>' +
      left +
      '<span class="ds-menu-item__content">' +
        '<span class="ds-menu-item__text">' + esc(opts.text) + '</span>' + labelDown +
      '</span>' +
      right + '</button>';
  }

  function sheetHeadHtml(title, subtitle, titleClass) {
    return '<div class="pb-sheet__head">' +
      '<h2 class="pb-sheet__title' + (titleClass ? ' ' + titleClass : '') +
        '" id="sheet-title">' + esc(title) + '</h2>' +
      (subtitle ? '<p class="pb-sheet__subtitle">' + esc(subtitle) + '</p>' : '') +
      '</div>';
  }

  function sheetFootHtml(buttonHtml) {
    return '<div class="pb-sheet__foot">' + buttonHtml + '</div>';
  }

  function applyButtonHtml(action, label) {
    return '<button type="button" class="ds-btn ds-btn--m ds-btn--accent ds-btn--filled"' +
      ' data-action="' + action + '"><span class="ds-btn__label">' + esc(label) + '</span></button>';
  }

  /* Шторка «Изменить тариф» из футера выделения — 375×264: заголовок Body M
     и список тарифов, без чипов области и без «Сбросить к базовой цене»
     (заказчик 11.11.2026). Пункт — 56: точка цвета тарифа слева, название
     Body M 16/24; у действующего тарифа галка справа. Тап применяет тариф
     ко всему выделению и закрывает шторку. */
  function sheetTariffHtml() {
    var keys = SEL.list();
    var tariffs = keys.length ? S.uniqueTariffs(keys) : [];
    var current = tariffs.length === 1 ? tariffs[0].id : null;
    return sheetHeadHtml('Изменить тариф', null, 'pb-sheet__title--m') +
      '<div class="pb-sheet__menu pb-sheet__menu--tariff">' +
        D.TARIFFS.map(function (tariff) {
          return menuItemHtml({
            attr: 'data-tariff',
            value: tariff.id,
            text: tariff.name,
            dot: tariff.colorVar,
            checked: tariff.id === current
          });
        }).join('') +
      '</div>';
  }

  function sheetModeHtml() {
    var options = [
      { value: 'absolute', label: 'По абсолютному времени' },
      { value: 'relative', label: 'По времени относительно запуска' }
    ];
    return sheetHeadHtml('Режим тарификации') +
      '<div class="pb-sheet__menu">' +
        options.map(function (option) {
          return menuItemHtml({
            attr: 'data-sheet-mode',
            value: option.value,
            text: option.label,
            checked: D.SERVICE.mode === option.value
          });
        }).join('') +
      '</div>';
  }

  function timeFieldHtml(id, label, value) {
    return '<label class="ds-input ds-input--m">' +
      '<span class="ds-input__frame">' +
        '<span class="ds-input__content">' +
          '<span class="ds-input__label">' + label + '</span>' +
          '<input class="ds-input__field" id="' + id + '" type="text" inputmode="numeric"' +
            ' maxlength="2" value="' + value + '">' +
        '</span>' +
      '</span></label>';
  }

  function sheetRoundingHtml() {
    var parts = D.SERVICE.rounding.split(':');
    return sheetHeadHtml('Округлять время до') +
      '<div class="pb-sheet__fields">' +
        timeFieldHtml('f-hours', 'Часы', parts[0]) +
        timeFieldHtml('f-minutes', 'Минуты', parts[1]) +
      '</div>' +
      '<p class="pb-sheet__note" id="sheet-error" hidden></p>' +
      sheetFootHtml(applyButtonHtml('save-rounding', 'Сохранить'));
  }

  function sheetMinTimeHtml() {
    var mt = D.SERVICE.minTime;
    return sheetHeadHtml('Минимальное время') +
      '<div class="pb-sheet__toggle">' +
        '<label class="ds-slide-toggle">' +
          '<span class="ds-slide-toggle__row">' +
            '<input class="ds-slide-toggle__input" type="checkbox" id="f-mt-on"' +
              (mt.on ? ' checked' : '') + '>' +
            '<span class="ds-slide-toggle__track"></span>' +
            '<span class="ds-slide-toggle__title">Включено</span>' +
          '</span>' +
        '</label>' +
      '</div>' +
      '<div class="pb-sheet__fields">' +
        timeFieldHtml('f-mt-hours', 'Часы', pad(mt.hours)) +
        timeFieldHtml('f-mt-minutes', 'Минуты', pad(mt.minutes)) +
      '</div>' +
      '<p class="pb-sheet__note" id="sheet-error" hidden></p>' +
      sheetFootHtml(applyButtonHtml('save-mintime', 'Сохранить'));
  }

  function sheetPriceHtml() {
    var current = state.priceDraft || D.SERVICE.priceDisplay;
    var options = [
      { value: 'hour', label: 'За час' },
      { value: 'minute', label: 'За минуту' }
    ];
    return sheetHeadHtml('Отображение цены') +
      '<div class="pb-sheet__menu">' +
        options.map(function (option) {
          return menuItemHtml({
            attr: 'data-price',
            value: option.value,
            text: option.label,
            checked: current === option.value
          });
        }).join('') +
      '</div>';
  }

  /* Ресторан: единственный выбор — галка справа, тап применяет и закрывает */
  function sheetRestaurantHtml() {
    return sheetHeadHtml('Ресторан') +
      '<div class="pb-sheet__menu">' +
        D.RESTAURANT.list.map(function (name) {
          return menuItemHtml({
            attr: 'data-restaurant',
            value: name,
            text: name,
            checked: name === D.RESTAURANT.current
          });
        }).join('') +
      '</div>';
  }

  /* ── Открытие/закрытие шторки ─────────────────────────────
     Крестика в шторке нет: закрывают свайп вниз, тап по затемнению и Esc.
     Свайп-порог — 96 px: короче — шторка возвращается на место. */

  var SHEET_DISMISS_OFFSET = 96;

  function sheetHtml(kind) {
    if (kind === 'mode') { return sheetModeHtml(); }
    if (kind === 'rounding') { return sheetRoundingHtml(); }
    if (kind === 'minTime') { return sheetMinTimeHtml(); }
    if (kind === 'price') { return sheetPriceHtml(); }
    if (kind === 'int-tariff') { return sheetIntervalTariffHtml(); }
    if (kind === 'int-day') { return sheetIntervalDayHtml(); }
    if (kind === 'int-time') { return sheetIntervalTimeHtml(); }
    if (kind === 'restaurant') { return sheetRestaurantHtml(); }
    return sheetTariffHtml();
  }

  function openSheet(kind) {
    state.sheet = kind;
    /* «Интервал» — 24 часа: скроллим только список, кнопка остаётся внизу */
    el.sheetInner.classList.toggle('pb-sheet__inner--fit', kind === 'int-time');
    /* «Изменить тариф» — компактная шторка 375×264 (радиус 24, тень 08 dp) */
    el.sheet.classList.toggle('pb-sheet--tariff', kind === 'tariff');
    el.sheetInner.innerHTML = sheetHtml(kind);
    resetSheetOffset();
    el.sheet.hidden = false;
    el.scrim.hidden = false;
    var first = el.sheetInner.querySelector('.pb-mi');
    if (first) { first.focus({ preventScroll: true }); }
    syncMinTimeFields();
  }

  function resetSheetOffset() {
    el.sheet.style.transition = '';
    el.sheet.style.transform = '';
  }

  function closeSheet() {
    state.sheet = null;
    swipe = null;
    el.sheet.hidden = true;
    el.sheetInner.innerHTML = '';
    el.sheetInner.classList.remove('pb-sheet__inner--fit');
    el.sheet.classList.remove('pb-sheet--tariff');
    resetSheetOffset();
    /* затемнение принадлежит только шторке и всегда гаснет вместе с ней.
       Иначе при открытых настройках scrim оставался поверх экрана настроек
       (z-index 24 против 23) и перехватывал тапы: шторка закрывалась, а строки
       «Режим тарификации», «Округление» и остальные становились мёртвыми */
    el.scrim.hidden = true;
  }

  /* свайп вниз: доводим шторку за экран и убираем */
  function dismissSheet() {
    el.sheet.style.transition = 'transform .18s ease-out';
    el.sheet.style.transform = 'translate(-50%, 100%)';
    window.setTimeout(closeSheet, 180);
  }

  var swipe = null;

  /* список внутри шторки прокручен (весь слой или только меню с 24 часами) */
  function sheetScrolled() {
    if (el.sheetInner.scrollTop > 0) { return true; }
    var list = el.sheetInner.querySelector('.pb-sheet__menu');
    return !!(list && list.scrollTop > 0);
  }

  function onSheetPointerDown(event) {
    if (el.sheet.hidden) { return; }
    if (event.pointerType === 'mouse' && event.button !== 0) { return; }
    swipe = { y: event.clientY, x: event.clientX, dy: 0, active: false };
  }

  function onSheetPointerMove(event) {
    if (!swipe) { return; }
    var dy = event.clientY - swipe.y;
    var dx = event.clientX - swipe.x;
    if (!swipe.active) {
      if (dy < 8 || Math.abs(dx) > dy) { return; }
      /* список прокручен — жест отдаём скроллу, тянем только за ручку */
      if (sheetScrolled() && !event.target.closest('[data-grab]')) {
        swipe = null;
        return;
      }
      swipe.active = true;
      el.sheet.style.transition = 'none';
    }
    swipe.dy = Math.max(0, dy);
    el.sheet.style.transform = 'translate(-50%, ' + swipe.dy + 'px)';
  }

  function onSheetPointerUp() {
    if (!swipe) { return; }
    var dy = swipe.dy;
    var active = swipe.active;
    swipe = null;
    if (!active) { return; }
    suppressClickUntil = Date.now() + 400;   /* свайп не должен «нажать» пункт */
    if (dy > SHEET_DISMISS_OFFSET) { dismissSheet(); return; }
    el.sheet.style.transition = 'transform .18s ease-out';
    el.sheet.style.transform = '';
  }

  function isSettingsOpen() { return !el.settings.hidden; }

  function syncMinTimeFields() {
    var toggle = byId('f-mt-on');
    if (!toggle) { return; }
    var hours = byId('f-mt-hours');
    var minutes = byId('f-mt-minutes');
    [hours, minutes].forEach(function (input) {
      if (!input) { return; }
      input.disabled = !toggle.checked;
      var wrap = input.closest('.ds-input');
      if (wrap) { wrap.classList.toggle('ds-input--disabled', !toggle.checked); }
    });
  }

  /* ── Настройки ──────────────────────────────────────────── */
  function syncSettings() {
    var mode = el.settings.querySelector('[data-value="mode"]');
    if (mode) {
      mode.textContent = D.SERVICE.mode === 'relative'
        ? 'По времени относительно запуска'
        : 'По абсолютному времени';
    }
    var rounding = el.settings.querySelector('[data-value="rounding"]');
    if (rounding) { rounding.textContent = D.SERVICE.rounding; }
    var minTime = el.settings.querySelector('[data-value="minTime"]');
    if (minTime) {
      minTime.textContent = D.SERVICE.minTime.on
        ? pad(D.SERVICE.minTime.hours) + ':' + pad(D.SERVICE.minTime.minutes)
        : 'Выключено';
    }
    var price = el.settings.querySelector('[data-value="price"]');
    if (price) {
      price.textContent = D.SERVICE.priceDisplay === 'minute' ? 'За минуту' : 'За час';
    }
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* Иконка ресторана в шапке: названия нет (заказчик 11.11.2026), текущий
     ресторан остаётся в доступном имени кнопки и в шторке выбора */
  function syncRestaurant() {
    if (el.restaurant) {
      el.restaurant.setAttribute('aria-label', 'Ресторан: ' + D.RESTAURANT.current);
    }
  }

  /* Состояние тумблера: подпись «Включена» / «Выключена». Когда тарификация
     выключена, в строке состояния остаётся только тумблер — иконки ресторана
     и настроек скрывает класс на body (prototype.css) */
  function syncEnabledUi() {
    var on = !!D.SERVICE.enabled;
    el.enabled.checked = on;
    if (el.enabledTitle) {
      el.enabledTitle.textContent = on ? 'Включена' : 'Выключена';
    }
    document.body.classList.toggle('pb-tariff-off', !on);
  }

  /* Активная вкладка должна быть видна целиком и стоять по центру полосы.
     Полоса уже контента, поэтому сначала пробуем обычную прокрутку, а если
     до центра не хватает места (последний таб упирается в край) — добавляем
     правый отступ ровно на недостающие пиксели */
  function centerActiveTab() {
    var strip = document.querySelector('.pb-tabs .ds-tabs');
    if (!strip) { return; }
    var active = strip.querySelector('.ds-tab--active');
    if (!active) { return; }
    strip.style.paddingRight = '';
    var max = strip.scrollWidth - strip.clientWidth;
    if (max <= 0) { return; }
    var stripRect = strip.getBoundingClientRect();
    var activeRect = active.getBoundingClientRect();
    var target = strip.scrollLeft + (activeRect.left - stripRect.left) -
      (strip.clientWidth - activeRect.width) / 2;
    if (target > max) {
      strip.style.paddingRight = Math.ceil(target - max) + 'px';
      max = strip.scrollWidth - strip.clientWidth;
    }
    strip.scrollLeft = Math.max(0, Math.min(max, target));
  }

  /* экран настроек не затемняется: свой scrim ему не нужен, а подобранный
     от шторки гасим, чтобы он не остался поверх строк настроек */
  function openSettings() {
    el.settings.hidden = false;
    if (!state.sheet) { el.scrim.hidden = true; }
    syncSettings();
  }

  function closeSettings() {
    el.settings.hidden = true;
    closeSheet();
  }

  /* ── Экран «Изменить тариф» (вариант 1, макет 19121:59370) ──
     Тап по карточке интервала открывает отдельный экран с тремя Select form:
     «Тариф», «День», «Интервал». Футера выделения («Сбросить / Изменить тариф»)
     в этом сценарии нет. Каждое поле открывается нижней шторкой: «Тариф» —
     единственный выбор, «День» и «Интервал» — множественный (чекбоксы
     и кнопка «Применить»). */

  function selectFieldHtml(kind, label, value) {
    return '<button type="button" class="ds-select-form ds-select-form--m pb-interval__field"' +
      ' data-interval-field="' + kind + '" aria-haspopup="dialog">' +
      '<span class="ds-input ds-input--m ds-input--populated">' +
        '<span class="ds-input__frame">' +
          '<span class="ds-input__content">' +
            '<span class="ds-input__label">' + esc(label) + '</span>' +
            '<span class="ds-input__field">' + esc(value) + '</span>' +
          '</span>' +
          '<span class="ds-input__icon">' + ICON.arrowDown + '</span>' +
        '</span>' +
      '</span></button>';
  }

  function intervalTariffLabel(tariffId) {
    var tariff = S.tariff(tariffId);
    return tariff.name + ' (' + S.formatPrice(S.priceOf(tariff.id)) + ')';
  }

  /* «10:00 - 11:00» — как в макете (дефис с пробелами); `to` — конец
     диапазона (не включая), по умолчанию следующий час */
  function intervalRangeLabel(hour, to) {
    return S.hourLabel(hour) + ':00 - ' +
      S.hourLabel(to === undefined ? hour + 1 : to) + ':00';
  }

  /* Значения поля «Интервал»: соседние часы склеиваем в диапазоны —
     10, 11, 12, 14 → «10:00 - 13:00», «14:00 - 15:00»; все 24 — «Весь день» */
  function intervalHourTokens(hours) {
    var list = (hours || []).slice().sort(function (a, b) { return a - b; });
    if (!list.length) { return []; }
    if (list.length >= HOURS) { return ['Весь день']; }
    var ranges = [];
    list.forEach(function (hour) {
      var last = ranges[ranges.length - 1];
      if (last && last[1] === hour) { last[1] = hour + 1; }
      else { ranges.push([hour, hour + 1]); }
    });
    return ranges.map(function (pair) {
      return intervalRangeLabel(pair[0], pair[1]);
    });
  }

  /* Значения поля «День»: один день — полное имя, несколько — короткие */
  function intervalDayTokens(days) {
    var list = (days || []).slice().sort(function (a, b) { return a - b; });
    if (!list.length) { return []; }
    if (list.length === 1) { return [D.DAYS_LONG[list[0]]]; }
    return list.map(function (day) { return D.DAYS_SHORT[day]; });
  }

  /* Ширина текста в шрифте поля — чтобы решить, влезает ли подпись целиком */
  var measureCtx = null;

  function measureText(text, font) {
    if (!measureCtx) {
      var canvas = document.createElement('canvas');
      measureCtx = canvas.getContext ? canvas.getContext('2d') : null;
      if (!measureCtx) { return 0; }
    }
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
  }

  function fieldFont(node) {
    var style = window.getComputedStyle(node);
    return style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
  }

  /* Подпись поля — всегда одна строка. Если выбранные значения не помещаются,
     показываем начало и «...(еще N)», где N — сколько значений осталось
     за кадром: «Пн, Вт, Ср...(еще 4)» */
  function fitFieldValue(tokens, emptyText, node) {
    if (!tokens.length) { return emptyText; }
    var full = tokens.join(', ');
    var width = node.clientWidth;
    if (!width) { return full; }
    var font = fieldFont(node);
    if (measureText(full, font) <= width) { return full; }
    for (var shown = tokens.length - 1; shown >= 0; shown--) {
      var rest = tokens.length - shown;
      var head = shown ? tokens.slice(0, shown).join(', ') + '...' : '...';
      var text = head + '(еще ' + rest + ')';
      if (measureText(text, font) <= width) { return text; }
    }
    return '...(еще ' + tokens.length + ')';
  }

  /* Пересчёт подписей «День» и «Интервал» под фактическую ширину полей */
  function fitIntervalFieldValues() {
    if (!el.intervalFields) { return; }
    var day = el.intervalFields.querySelector('[data-interval-field="day"] .ds-input__field');
    var time = el.intervalFields.querySelector('[data-interval-field="time"] .ds-input__field');
    if (day) {
      day.textContent = fitFieldValue(intervalDayTokens(state.intervalDays), 'Не выбрано', day);
    }
    if (time) {
      time.textContent = fitFieldValue(intervalHourTokens(state.intervalHours), 'Не выбрано', time);
    }
  }

  function renderIntervalFields() {
    if (!el.intervalFields || !state.interval) { return; }
    var interval = state.interval;
    el.intervalFields.innerHTML =
      selectFieldHtml('tariff', 'Тариф', intervalTariffLabel(interval.tariff)) +
      selectFieldHtml('day', 'День', intervalDayTokens(state.intervalDays).join(', ')) +
      selectFieldHtml('time', 'Интервал', intervalHourTokens(state.intervalHours).join(', '));
    fitIntervalFieldValues();
  }

  function openIntervalPage(day, hour) {
    state.interval = { day: day, hour: hour, tariff: S.get(day, hour) };
    state.intervalDays = [day];
    state.intervalHours = [hour];
    /* сначала показываем экран: подпись поля считается по его реальной ширине */
    el.interval.hidden = false;
    renderIntervalFields();
    /* Roboto может догрузиться позже — пересчитываем по готовым шрифтам */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (state.interval) { fitIntervalFieldValues(); }
      });
    }
  }

  function closeIntervalPage() {
    state.interval = null;
    state.intervalDays = [];
    state.intervalHours = [];
    el.interval.hidden = true;
    if (el.intervalFields) { el.intervalFields.innerHTML = ''; }
  }

  function isIntervalOpen() { return !!el.interval && !el.interval.hidden; }

  /* Тап по строке — только чекбокс в черновике; шторка остаётся открытой,
     результат применяет кнопка «Применить» (паттерн множественного выбора) */
  function refreshSheet() {
    if (!state.sheet) { return; }
    var scrollTop = el.sheetInner.scrollTop;
    var list = el.sheetInner.querySelector('.pb-sheet__menu');
    var listTop = list ? list.scrollTop : 0;
    el.sheetInner.innerHTML = sheetHtml(state.sheet);
    el.sheetInner.scrollTop = scrollTop;
    /* «Интервал» скроллит само меню — после перерисовки возвращаем позицию */
    var next = el.sheetInner.querySelector('.pb-sheet__menu');
    if (next) { next.scrollTop = listTop; }
  }

  function toggleIntervalDay(day) {
    var days = (state.intervalDays || []).slice();
    var index = days.indexOf(day);
    if (index === -1) { days.push(day); } else { days.splice(index, 1); }
    days.sort(function (a, b) { return a - b; });
    state.intervalDays = days;
    refreshSheet();
  }

  /* родительская строка «Все дни»: выбраны все — снимаем, иначе берём все */
  function toggleAllIntervalDays() {
    var total = D.DAYS_LONG.length;
    state.intervalDays = (state.intervalDays || []).length === total ? [] : range(total);
    refreshSheet();
  }

  function toggleIntervalHour(hour) {
    var hours = (state.intervalHours || []).slice();
    var index = hours.indexOf(hour);
    if (index === -1) { hours.push(hour); } else { hours.splice(index, 1); }
    hours.sort(function (a, b) { return a - b; });
    state.intervalHours = hours;
    refreshSheet();
  }

  /* родительская строка «Весь день»: выбраны все 24 — снимаем, иначе берём все */
  function toggleAllIntervalHours() {
    state.intervalHours = (state.intervalHours || []).length === HOURS ? [] : range(HOURS);
    refreshSheet();
  }

  function applyIntervalDays() {
    if (!state.intervalDays || !state.intervalDays.length) { return; }
    if (state.interval) { state.interval.day = state.intervalDays[0]; }
    closeSheet();
    renderIntervalFields();
  }

  function applyIntervalHours() {
    if (!state.intervalHours || !state.intervalHours.length) { return; }
    if (state.interval) { state.interval.hour = state.intervalHours[0]; }
    closeSheet();
    renderIntervalFields();
  }

  /* «Сохранить» на экране «Изменить тариф»: тариф встаёт во все выбранные дни
     и во все выбранные часы (множественный выбор в обеих шторках) */
  function saveInterval() {
    var interval = state.interval;
    if (!interval) { return; }
    var days = (state.intervalDays && state.intervalDays.length)
      ? state.intervalDays
      : [interval.day];
    var hours = (state.intervalHours && state.intervalHours.length)
      ? state.intervalHours
      : [interval.hour];
    days.forEach(function (day) {
      hours.forEach(function (hour) { S.set(day, hour, interval.tariff); });
    });
    closeIntervalPage();
    renderBody();
    showSnack(D.TEXTS.saved, '', null, 3000);
  }

  /* ── Шторки экрана интервала ───────────────────────────────
     «Тариф» — единственный выбор (галка справа, тап применяет и закрывает);
     «День» и «Интервал» — множественный (чекбоксы слева + «Применить»),
     с родительской строкой «Все дни» / «Весь день» (Type=Indeterminate). */
  function sheetIntervalTariffHtml() {
    var current = state.interval ? state.interval.tariff : null;
    return sheetHeadHtml('Тариф') +
      '<div class="pb-sheet__menu">' +
        D.TARIFFS.map(function (tariff) {
          return menuItemHtml({
            attr: 'data-int-tariff',
            value: tariff.id,
            text: tariff.name,
            label: S.priceLabel(tariff.id),
            checked: tariff.id === current
          });
        }).join('') +
      '</div>';
  }

  /* «День» — множественный выбор: родительская строка «Все дни» (Checkbox
     Type=Indeterminate) с линией-разделителем, 7 дней и кнопка «Применить».
     Макет `19121:60840`: меню 288 = 8 однострочных пунктов. */
  function sheetIntervalDayHtml() {
    var days = state.intervalDays || [];
    var total = D.DAYS_LONG.length;
    return sheetHeadHtml('День') +
      '<div class="pb-sheet__menu">' +
        menuItemHtml({
          attr: 'data-int-day-all',
          value: 'all',
          text: 'Все дни',
          checked: days.length === total,
          mixed: days.length > 0 && days.length < total,
          multi: true,
          divider: true,
          plain: true
        }) +
        D.DAYS_LONG.map(function (label, day) {
          return menuItemHtml({
            attr: 'data-int-day',
            value: day,
            text: label,
            checked: days.indexOf(day) !== -1,
            multi: true
          });
        }).join('') +
      '</div>' +
      sheetFootHtml(applyButtonHtml('apply-days', 'Применить'));
  }

  /* «Интервал» — тот же множественный выбор, что у дня: «Весь день»
     (Indeterminate) + 24 часа. Список длиннее экрана — меню скроллится. */
  function sheetIntervalTimeHtml() {
    var hours = state.intervalHours || [];
    var options = '';
    for (var h = 0; h < HOURS; h++) {
      options += menuItemHtml({
        attr: 'data-int-time',
        value: h,
        text: intervalRangeLabel(h),
        checked: hours.indexOf(h) !== -1,
        multi: true
      });
    }
    return sheetHeadHtml('Интервал') +
      '<div class="pb-sheet__menu">' +
        menuItemHtml({
          attr: 'data-int-hour-all',
          value: 'all',
          text: 'Весь день',
          checked: hours.length === HOURS,
          mixed: hours.length > 0 && hours.length < HOURS,
          multi: true,
          divider: true,
          plain: true
        }) +
        options +
      '</div>' +
      sheetFootHtml(applyButtonHtml('apply-hours', 'Применить'));
  }

  /* ── Снэкбар ────────────────────────────────────────────── */
  var snackTimer = null;

  function hideSnack() {
    clearTimeout(snackTimer);
    el.snackbar.hidden = true;
    el.snackbar.innerHTML = '';
  }

  function showSnack(text, actionText, onAction, duration) {
    clearTimeout(snackTimer);
    el.snackbar.hidden = false;
    el.snackbar.innerHTML = '<div class="ds-snackbar ds-snackbar--single ds-snackbar--dark">' +
        '<div class="ds-snackbar__body">' +
          '<span class="ds-snackbar__icon">' + ICON.info + '</span>' +
          '<span class="ds-snackbar__label">' + esc(text) + '</span>' +
          (actionText
            ? '<div class="ds-snackbar__content"><button type="button" class="pb-snackbar__btn"' +
              ' data-snack-action>' + esc(actionText) + '</button></div>'
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

  /* ── Применение тарифа и сохранение ─────────────────────── */
  function applyTariff(id) {
    var keys = SEL.list();
    if (!keys.length) { return; }
    var before = S.snapshot();
    keys.forEach(function (key) {
      var p = S.parseKey(key);
      S.set(p.day, p.hour, id);
    });
    closeSheet();
    renderBody();
    var tariff = S.tariff(id);
    showSnack(
      D.TEXTS.applied + tariff.name + ' · ' + keys.length + ' ' +
        plural(keys.length, ['интервал', 'интервала', 'интервалов']),
      'Отменить',
      function () {
        S.restore(before);
        renderBody();
      },
      5000
    );
  }

  function saveWillFail() {
    return new URLSearchParams(window.location.search).get('save') === 'error';
  }

  function save() {
    if (state.saving) { return; }
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
        showSnack(D.TEXTS.saveError, 'Повторить', save, 6000);
        return;
      }
      SEL.clear();
      showSnack(D.TEXTS.saved, '', null, 3000);
    }, 700);
  }

  /* ── События ────────────────────────────────────────────── */
  function canDragScroll() { return SEL.size() === 0; }

  function onPointerDown(event) {
    if (event.button !== 0 && event.button !== undefined) { return; }
    var cell = event.target.closest('[data-key]');
    if (!cell) { return; }
    drag = {
      key: cell.getAttribute('data-key'),
      x: event.clientX,
      y: event.clientY,
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
      /* вертикальное движение без выделения — это скролл (§3.2) */
      if (canDragScroll() && dy > dx) { drag.cancelled = true; return; }
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
      suppressClickUntil = Date.now() + 400;   /* чтобы click не снял выделение повторно */
    }
  }

  function handleClick(event) {
    /* после свайпа и после тапа по ячейке click не должен «дожать» элемент */
    if (Date.now() < suppressClickUntil) { return; }
    var target = event.target;
    /* поля ввода, тумблеры и их подписи обрабатывает сам контрол */
    if (target.closest && target.closest('input, textarea, select, label')) { return; }
    var node = target.closest ? target.closest(
      '[data-tariff],[data-sheet-mode],[data-price],' +
      '[data-restaurant],' +
      '[data-int-tariff],[data-int-day],[data-int-day-all],[data-int-time],[data-int-hour-all],' +
      '[data-interval-field],[data-interval],' +
      '[data-action],[data-day],[data-daycol],[data-hourrow],[data-key],[data-settings-row]'
    ) : null;
    /* `[data-mode]` раньше совпадал с <html data-mode="mobile">: любой тап
       внутри шторки закрывал её. Атрибут переименован, плюс защита от <html>. */
    if (!node || node === document.documentElement) { return; }

    if (node.hasAttribute('data-interval')) {
      var interval = S.parseKey(node.getAttribute('data-interval'));
      openIntervalPage(interval.day, interval.hour);
      return;
    }
    if (node.hasAttribute('data-interval-field')) {
      openSheet('int-' + node.getAttribute('data-interval-field'));
      return;
    }
    if (node.hasAttribute('data-int-tariff')) {
      if (state.interval) { state.interval.tariff = node.getAttribute('data-int-tariff'); }
      closeSheet();
      renderIntervalFields();
      return;
    }
    if (node.hasAttribute('data-int-day-all')) {
      toggleAllIntervalDays();
      return;
    }
    if (node.hasAttribute('data-int-day')) {
      toggleIntervalDay(Number(node.getAttribute('data-int-day')));
      return;
    }
    if (node.hasAttribute('data-int-hour-all')) {
      toggleAllIntervalHours();
      return;
    }
    if (node.hasAttribute('data-int-time')) {
      toggleIntervalHour(Number(node.getAttribute('data-int-time')));
      return;
    }
    if (node.hasAttribute('data-key')) {
      if (Date.now() >= suppressClickUntil) { SEL.toggle(node.getAttribute('data-key')); }
      return;
    }
    if (node.hasAttribute('data-restaurant')) {
      D.RESTAURANT.current = node.getAttribute('data-restaurant');
      closeSheet();
      syncRestaurant();
      return;
    }
    if (node.hasAttribute('data-tariff')) { applyTariff(node.getAttribute('data-tariff')); return; }
    if (node.hasAttribute('data-day')) {
      state.day = Number(node.getAttribute('data-day'));
      renderBody();
      return;
    }
    if (node.hasAttribute('data-daycol')) { SEL.toggleDay(Number(node.getAttribute('data-daycol'))); return; }
    if (node.hasAttribute('data-hourrow')) { SEL.toggleHour(Number(node.getAttribute('data-hourrow'))); return; }
    if (node.hasAttribute('data-sheet-mode')) {
      D.SERVICE.mode = node.getAttribute('data-sheet-mode');
      closeSheet();
      renderBody();
      syncSettings();
      return;
    }
    if (node.hasAttribute('data-price')) {
      state.priceDraft = node.getAttribute('data-price');
      D.SERVICE.priceDisplay = state.priceDraft;
      closeSheet();
      renderBody();
      syncSettings();
      return;
    }
    if (node.hasAttribute('data-settings-row')) {
      openSheet(node.getAttribute('data-settings-row'));
      return;
    }

    var action = node.getAttribute('data-action');
    if (action === 'clear') { SEL.clear(); return; }
    if (action === 'change-tariff') { openSheet('tariff'); return; }
    if (action === 'apply-days') { applyIntervalDays(); return; }
    if (action === 'apply-hours') { applyIntervalHours(); return; }
    if (action === 'save-rounding') { saveRounding(); return; }
    if (action === 'save-mintime') { saveMinTime(); return; }
  }

  function sheetError(text) {
    var node = byId('sheet-error');
    if (!node) { return; }
    node.hidden = false;
    node.classList.add('pb-sheet__note--error');
    node.textContent = text;
  }

  function readField(id, fallback, max) {
    var input = byId(id);
    if (!input) { return fallback; }
    var value = parseInt(input.value, 10);
    if (isNaN(value)) { return fallback; }
    /* часы 0–23, минуты 0–59: предел приходит параметром */
    return Math.min(Math.max(value, 0), max === undefined ? 23 : max);
  }

  function saveRounding() {
    var hours = readField('f-hours', 0);
    var minutes = readField('f-minutes', 0, 59);
    if (hours === 0 && minutes === 0) {
      sheetError('Округление не может быть 00:00');
      return;
    }
    D.SERVICE.rounding = pad(hours) + ':' + pad(minutes);
    closeSheet();
    syncSettings();
  }

  function saveMinTime() {
    var toggle = byId('f-mt-on');
    var enabled = !!(toggle && toggle.checked);
    var hours = readField('f-mt-hours', 0);
    var minutes = readField('f-mt-minutes', 0, 59);
    if (enabled && hours === 0 && minutes === 0) {
      sheetError('Минимальное время не может быть 00:00');
      return;
    }
    D.SERVICE.minTime = { on: enabled, hours: hours, minutes: minutes };
    closeSheet();
    syncSettings();
  }

  function bind() {
    document.addEventListener('click', handleClick);
    el.body.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', function () { drag = null; });

    el.scrim.addEventListener('click', closeSheet);

    /* свайп шторки вниз: за ручку или по свободному месту, пока список не прокручен */
    el.sheet.addEventListener('pointerdown', onSheetPointerDown);
    el.sheet.addEventListener('pointermove', onSheetPointerMove);
    el.sheet.addEventListener('pointerup', onSheetPointerUp);
    el.sheet.addEventListener('pointercancel', onSheetPointerUp);

    el.enabled.addEventListener('change', function () {
      D.SERVICE.enabled = el.enabled.checked;
      if (!D.SERVICE.enabled) {
        /* выключили тарификацию: расписание и его слои больше не нужны */
        SEL.clear();
        if (state.sheet) { closeSheet(); }
        if (isIntervalOpen()) { closeIntervalPage(); }
        if (isSettingsOpen()) { closeSettings(); }
      }
      syncEnabledUi();
      renderBody();
    });

    byId('open-restaurant').addEventListener('click', function () {
      openSheet('restaurant');
    });
    byId('open-settings').addEventListener('click', openSettings);
    window.addEventListener('resize', centerActiveTab);
    window.addEventListener('load', centerActiveTab);
    byId('settings-close').addEventListener('click', closeSettings);
    if (byId('interval-close')) {
      byId('interval-close').addEventListener('click', closeIntervalPage);
    }
    if (byId('interval-cancel')) {
      byId('interval-cancel').addEventListener('click', closeIntervalPage);
    }
    if (byId('interval-save')) {
      byId('interval-save').addEventListener('click', saveInterval);
    }
    el.saveBtn.addEventListener('click', save);
    byId('btn-close').addEventListener('click', function () {
      window.location.href = 'index.html';
    });

    document.addEventListener('change', function (event) {
      if (event.target && event.target.id === 'f-mt-on') { syncMinTimeFields(); }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') { return; }
      if (state.sheet) { closeSheet(); return; }
      if (isIntervalOpen()) { closeIntervalPage(); return; }
      if (isSettingsOpen()) { closeSettings(); }
    });

    SEL.onChange(syncSelection);
  }

  function init(options) {
    variant = options && options.variant === 2 ? 2 : 1;
    el = {
      body: byId('pb-body'),
      selbar: byId('selbar'),
      scrim: byId('scrim'),
      sheet: byId('sheet'),
      sheetInner: byId('sheet-inner'),
      settings: byId('settings'),
      interval: byId('interval-page'),
      intervalFields: byId('interval-fields'),
      snackbar: byId('snackbar'),
      saveBtn: byId('btn-save'),
      saveLabel: byId('btn-save-label'),
      enabled: byId('enabled'),
      enabledTitle: byId('enabled-title'),
      restaurant: byId('open-restaurant')
    };
    state.priceDraft = D.SERVICE.priceDisplay;
    syncEnabledUi();
    syncRestaurant();
    centerActiveTab();
    renderSkeleton();
    bind();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(centerActiveTab);
    }
    /* скелетон области расписания 600 мс при открытии (§8) */
    window.setTimeout(function () {
      renderBody();
      syncSettings();
      centerActiveTab();
    }, 600);
  }

  return { init: init };
})();
