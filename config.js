'use strict';

/**
 * Matrix Table — shared configuration.
 *
 * Loaded by both the chart (index.html) and the Format dialog (configure.html)
 * so the two agree on the settings shape, the defaults, number formatting,
 * colour palettes and the built-in icon set (the same set as KPI Card 3 and
 * Waterfall).
 *
 * Everything is stored as one JSON string under a single settings key, which
 * Tableau persists inside the workbook.
 */
(function () {
  var STORAGE_KEY = 'matrixTable1';

  var FONT_STACK_FALLBACK =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  /** Font families offered in the dialog. "Lato" ships with the extension. */
  var FONTS = [
    'Lato',
    'IBM Plex Sans',
    'Tableau Book',
    'Tableau Medium',
    'Tableau Semibold',
    'Tableau Bold',
    'Benton Sans',
    'Arial',
    'Helvetica Neue',
    'Segoe UI',
    'Roboto',
    'Open Sans',
    'Georgia',
    'Times New Roman',
    'Courier New'
  ];

  /**
   * Number format: KPI Card's "Big number" options plus Waterfall's signs.
   * Used globally (Numbers tab) and, when the scope is "each", by every part
   * of the chart that writes numbers.
   */
  var FORMAT = {
    scale: 'dynamic', // none | K | M | B | dynamic | workbook | percent | percentDynamic
    decimals: 1,
    pctFromRatio: true, // percent formats: value is a 0–1 ratio (0.4523 → 45.23%)
    thousands: true, // 1,284,500 vs 1284500
    unit: '',
    unitPosition: 'suffix', // suffix | prefix
    unitSpace: true, // "12.5 M SAR" vs "12.5MSAR"
    plusSign: false, // "+262.1" on positive values
    negStyle: 'minus' // minus (−201.4) | hyphen (-201.4) | paren ((201.4))
  };

  function fmtCopy (over) {
    var f = JSON.parse(JSON.stringify(FORMAT));
    Object.keys(over || {}).forEach(function (k) { f[k] = over[k]; });
    return f;
  }

  /** Colour palettes (first colour = first series / category). */
  var PALETTES = {
    house: { label: 'House', colors: ['#2F4B7C', '#EB644C', '#0E7C66', '#6B4FB0', '#F2A93B', '#3BA7C4', '#C4566F', '#8A9A5B', '#B4431E', '#68707D'] },
    tableau10: { label: 'Tableau 10', colors: ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC'] },
    tableau20: { label: 'Tableau 20', colors: ['#4E79A7', '#A0CBE8', '#F28E2B', '#FFBE7D', '#59A14F', '#8CD17D', '#B6992D', '#F1CE63', '#499894', '#86BCB6', '#E15759', '#FF9D9A', '#79706E', '#BAB0AC', '#D37295', '#FABFD2', '#B07AA1', '#D4A6C8', '#9D7660', '#D7B5A6'] },
    colorBlind: { label: 'Color blind', colors: ['#1170AA', '#FC7D0B', '#A3ACB9', '#57606C', '#5FA2CE', '#C85200', '#7B848F', '#A3CCE9', '#FFBC79', '#C8D0D9'] },
    vivid: { label: 'Infographic vivid', colors: ['#F45B69', '#F7A541', '#6A5ACD', '#3BB2B8', '#9B59B6', '#2ECC71', '#E67E22', '#1ABC9C', '#E84393', '#0984E3'] },
    cool: { label: 'Cool gradient', colors: ['#8B5CF6', '#6E8BFF', '#4FB0FF', '#3EE6F5', '#3DF0C8', '#34D399', '#22C55E', '#84CC16'] },
    warm: { label: 'Warm', colors: ['#B4431E', '#E4572E', '#F28E2B', '#F2A93B', '#EDC948', '#C4566F', '#9C755F', '#E15759'] },
    pastel: { label: 'Pastel', colors: ['#A0CBE8', '#FFBE7D', '#8CD17D', '#F1CE63', '#86BCB6', '#FF9D9A', '#D4A6C8', '#D7B5A6', '#BAB0AC', '#FABFD2'] },
    blues: { label: 'Blues', colors: ['#08306B', '#08519C', '#2171B5', '#4292C6', '#6BAED6', '#9ECAE1', '#C6DBEF'] },
    office: { label: 'Office', colors: ['#7CC4FA', '#3A8DDE', '#F0812F', '#FFD966', '#8BC34A', '#B39DDB', '#4DB6AC', '#E57373'] },
    duo: { label: 'Blue / pink', colors: ['#3A7FD5', '#FF85C0', '#7FB3F5', '#FFC2DF'] },
    dusk: { label: 'Dusk', colors: ['#E07B9B', '#D7C4BE', '#5F9BA8', '#9C89B8', '#F0A6CA', '#B8BEDD'] },
    grays: { label: 'Seattle grays', colors: ['#767F8B', '#B3B7B8', '#5C6068', '#D3D3D3', '#989CA3', '#4A4E55', '#C7C9CC'] }
  };

  /** One measure on the Measure tile (keyed by pill name in cfg.measures). */
  var MEASURE = {
    label: '', // empty → field name
    agg: 'auto', // how totals add up: auto | sum | avg | min | max | none
    ownFmt: false, // own number format instead of the shared one
    fmt: fmtCopy()
  };

  /** A colour rule (Colors tab): first matching rule wins. */
  var RULE = {
    on: 'value', // value | pct (share of total) | diff
    op: '>', // > | >= | < | <= | = | between
    value: 0,
    value2: 0,
    bg: '#FDE7E2',
    color: '#B4431E',
    bold: false
  };

  /** Text style block (headers, totals). */
  function textStyle (over) {
    var s = { font: 'Lato', size: 12, weight: 700, color: '#27357E', italic: false, upper: false, letterSpacing: 0 };
    Object.keys(over || {}).forEach(function (k) { s[k] = over[k]; });
    return s;
  }

  var SORTS = [['data', 'As in the data'], ['nameAsc', 'Name, A to Z'], ['nameDesc', 'Name, Z to A'],
    ['totalDesc', 'Total, high to low'], ['totalAsc', 'Total, low to high']];

  /** Window calculation directions (Tableau's "Compute using"). */
  var DIRECTIONS = [['table', 'Table'], ['across', 'Table across (each row)'], ['down', 'Table down (each column)'],
    ['paneAcross', 'Pane across (row, within column group)'], ['paneDown', 'Pane down (column, within row group)']];

  var DEFAULTS = {
    // ---- Header + card (Icon and Title & text = KPI Card; Card = Waterfall) --
    icon: {
      show: true,
      source: 'builtin', // builtin | upload | shape
      builtinId: 'fg-table',
      size: 24,
      color: '#EB644C',
      dataUrl: '',
      name: ''
    },
    title: {
      show: true,
      text: '', // empty → the measure names
      align: 'left', // left | center | right
      font: 'Lato',
      size: 16,
      weight: 500,
      color: '#68707D',
      italic: false
    },
    explanation: {
      show: true,
      reserveSpace: false,
      text: '',
      font: 'Lato',
      size: 12,
      weight: 400,
      color: '#68707D',
      italic: true
    },
    card: {
      padding: 15,
      bgColor: '#FFFFFF',
      bgOpacity: 0,
      gap: 10, // space between the header and the matrix
      plotBg: '#FFFFFF',
      plotBgOpacity: 0
    },

    // ---- Numbers -----------------------------------------------------------
    numbers: {
      mode: 'all', // all | each
      font: 'Lato' // font of all matrix text
    },
    format: fmtCopy(),

    // ---- Layout --------------------------------------------------------------
    layout: {
      measures: 'cell', // cell (first = main, others small) | columns | rows
      mainMeasure: '', // measure key; empty → the first measure
      transpose: false, // swap Rows and Columns without moving pills
      square: 'auto', // auto | on | off — same members on rows and columns (From → To matrices)
      colWidth: 'fit', // fit (fill the width) | auto (by content) | fixed
      colPx: 90,
      minColPx: 60,
      maxColPx: 260, // fit: widest a column gets (0 = no limit)
      rowHeight: 'auto', // auto | fixed
      rowPx: 46,
      rowHeaderPx: 0, // 0 = automatic
      gapX: 8,
      gapY: 8,
      freeze: true, // headers stay in view while scrolling
      banding: false,
      bandColor: '#F7F8FA',
      hideEmptyRows: false,
      hideEmptyCols: false,
      diagonal: true, // same member on row and column → diagonal mark
      diagonalText: '—',
      nullText: 'n/a',
      zeroText: '', // empty → write the number
      emptyStyle: 'tile' // tile (dashed tile) | blank (no tile) | text (text only)
    },

    // ---- Measures (per field) --------------------------------------------------
    measures: {}, // measure key → MEASURE overrides
    measureHeader: {
      show: true, // measure names as a header level (Columns / Rows layout)
      position: 'inner' // inner | outer
    },

    // ---- Calculations: what each cell shows ------------------------------------
    calc: {
      direction: 'table' // default "compute using" for every calculation (see DIRECTIONS)
    },
    metrics: {
      order: ['others', 'pct', 'diff', 'pctDiff', 'running', 'rank'],
      main: { show: true },
      others: { show: true, names: true }, // other measures (Cell layout)
      pct: { show: true, dir: 'inherit', decimals: 0, label: '', onTotals: false },
      diff: { show: false, dir: 'across', vs: 'prev', label: '', arrows: true, signColors: true, fmt: fmtCopy({ plusSign: true }) },
      pctDiff: { show: false, dir: 'across', vs: 'prev', decimals: 1, label: '', arrows: true, signColors: true },
      running: { show: false, dir: 'across', label: 'Σ ', fmt: fmtCopy() },
      rank: { show: false, dir: 'inherit', order: 'desc', label: '#' },
      posColor: '#0E7C66',
      negColor: '#B4431E',
      layout: 'below', // below | right (secondary values beside the main value)
      sep: ' · '
    },

    // ---- Cells -------------------------------------------------------------------
    cells: {
      radius: 6,
      padX: 6,
      padY: 6,
      bg: '#F3F1FC',
      bgOpacity: 100,
      border: true,
      borderStyle: 'solid', // solid | dashed | dotted
      borderWidth: 1,
      borderColor: '#E4E0F5',
      hAlign: 'center', // left | center | right
      vAlign: 'middle', // top | middle | bottom
      main: { font: 'Lato', size: 15, weight: 700, color: '#17202B', italic: false },
      secondary: { size: 10, weight: 400, color: '#55606E', opacity: 80, italic: false },
      emptyBg: '#F4F4F2',
      emptyBorder: '#D2D2CC',
      emptyBorderStyle: 'dashed',
      emptyColor: '#8C96A3',
      emptySize: 11,
      fmt: fmtCopy()
    },

    // ---- Colors --------------------------------------------------------------------
    colors: {
      mode: 'heat', // none | heat | diverging | bars
      by: '__auto', // __auto (Color tile if used, else the value) | __main (the cell's value) | __pct (share of total) | __color (Color tile) | measure key
      scope: 'table', // table | row | column
      low: '#F3F1FC',
      high: '#7D5FD9',
      mid: '#FFFFFF',
      neg: '#D9604A',
      pos: '#2E8B6E',
      autoText: true, // white text on dark cells
      includeTotals: false,
      barColor: '#7D5FD9',
      barOpacity: 35,
      rules: [] // list of RULE
    },

    // ---- Headers -------------------------------------------------------------------
    headers: {
      merge: true, // outer members span their children
      col: textStyle({ size: 11, upper: true, letterSpacing: 4 }),
      colOuter: textStyle({ size: 12, color: '#17202B' }),
      row: textStyle({ size: 13 }),
      rowOuter: textStyle({ size: 13, color: '#17202B' }),
      colOrient: 'horizontal', // horizontal | up | down
      colOuterOrient: 'horizontal',
      colAlign: 'center', // left | center | right
      colOuterAlign: 'center',
      colVAlign: 'bottom', // top | middle | bottom
      rowOrient: 'horizontal',
      rowOuterOrient: 'horizontal',
      rowAlign: 'left',
      rowOuterAlign: 'left',
      rowVAlign: 'middle',
      rowOuterVAlign: 'top',
      wrap: true,
      bg: '#FFFFFF',
      bgOpacity: 0,
      corner: 'none', // none | fields | custom
      cornerText: '',
      cornerStyle: textStyle({ size: 11, weight: 400, color: '#8C96A3', italic: true }),
      memberColors: {}, // member text → colour
      lines: false, // line between outer groups
      lineColor: '#D5D9DF'
    },

    // ---- Totals ---------------------------------------------------------------------
    totals: {
      rowGrand: true, // total row (sums each column)
      rowGrandPos: 'bottom', // bottom | top
      rowGrandLabel: 'Total',
      colGrand: true, // total column (sums each row)
      colGrandPos: 'right', // right | left
      colGrandLabel: 'Total',
      rowSubs: {}, // Rows field index → true: subtotal per group
      colSubs: {},
      subLabel: '{member} total',
      tile: false, // draw totals as tiles like the cells
      bg: '#F3F1FC',
      label: textStyle({ size: 11, upper: true, letterSpacing: 4, color: '#17202B' }),
      value: { font: 'Lato', size: 13, weight: 700, color: '#17202B', italic: false },
      collapsible: true, // click an outer header to fold it into its subtotal
      fmt: fmtCopy()
    },

    // ---- Sort ---------------------------------------------------------------------------
    sort: {
      rows: 'data', // see SORTS
      cols: 'data',
      rowsByCol: '', // column key: rows sorted by this column (set by clicking a column header)
      rowsByDir: 'desc'
    },

    // ---- Tooltip + interaction ---------------------------------------------------------
    tooltip: {
      show: true,
      showAll: true, // every measure, not only the main one
      showPct: true, // % of row, column and table
      showExtra: true, // Tooltip tile measures
      fullNumbers: true
    },
    interaction: {
      rightClickMenu: true,
      crosshair: true, // highlight the row and column under the mouse
      crosshairColor: '#EB644C',
      dblclick: 'format', // format | none
      selectInTableau: false, // click a cell selects its marks (dashboard actions)
      headerSort: true // click a column header to sort the rows by it
    },

    // ---- Export ---------------------------------------------------------------------------
    export: {
      button: 'hover', // hover | always | never
      fileName: '', // empty → the title
      includeTitle: true,
      excelSecondary: 'rich', // rich (same cell, as shown) | omit (numbers stay numbers)
      dataPct: true, // data export: add the % of total and other shown calculations
      dataTotals: false // data export: add subtotal / total rows
    }
  };

  // -------------------------------------------------------------------------
  // Built-in icons: only the Figma "Icons for Extension" set (icons.js).
  // -------------------------------------------------------------------------
  var ICONS = (window.KPI3_FIGMA_ICONS || []).map(function (ic) {
    var o = {}; for (var k in ic) o[k] = ic[k]; o.figma = true; return o;
  });

  var ICON_GROUPS = ['Chart icons', 'Others'];

  function findIcon (id) {
    var fallback = ICONS[0];
    for (var i = 0; i < ICONS.length; i++) {
      if (ICONS[i].id === id) return ICONS[i];
      if (ICONS[i].id === DEFAULTS.icon.builtinId) fallback = ICONS[i];
    }
    return fallback;
  }

  function iconSize (icon, target) {
    var t = Number(target) > 0 ? Number(target) : 24;
    var w = icon.w || 24;
    var h = icon.h || 24;
    return w >= h
      ? { w: t, h: Math.max(1, Math.round(t * h / w)) }
      : { w: Math.max(1, Math.round(t * w / h)), h: t };
  }

  function iconHtml (id, color, target) {
    var icon = findIcon(id);
    var size = iconSize(icon, target);
    var html;
    if (icon.src) {
      if (icon.tint) {
        var m = 'url(' + icon.src + ') center / contain no-repeat';
        html = '<span class="kpi3-icon-mask" style="display:block;width:' + size.w + 'px;height:' + size.h +
          'px;background-color:' + color + ';-webkit-mask:' + m + ';mask:' + m + '"></span>';
      } else {
        html = '<img src="' + icon.src + '" alt="" width="' + size.w + '" height="' + size.h +
          '" style="display:block;width:' + size.w + 'px;height:' + size.h + 'px">';
      }
    } else {
      var paint = icon.mode === 'stroke'
        ? 'fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
        : 'fill="' + color + '"';
      html = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size.w + '" height="' + size.h + '" viewBox="0 0 24 24" style="display:block">' +
        '<path ' + paint + ' d="' + icon.d + '"/></svg>';
    }
    return { html: html, w: size.w, h: size.h, icon: icon };
  }

  function iconSvg (id, color) { return iconHtml(id, color).html; }

  // -------------------------------------------------------------------------
  // Settings I/O
  // -------------------------------------------------------------------------
  function clone (o) { return JSON.parse(JSON.stringify(o)); }

  function isMap (o) { return o && typeof o === 'object' && !Array.isArray(o) && !Object.keys(o).length; }

  /**
   * Deep-merges stored values over the defaults so new keys get defaults.
   * An empty object in the defaults ({}) is a map: the stored map is copied as
   * is. Arrays are copied as stored.
   */
  function merge (base, over) {
    var out = clone(base);
    if (!over || typeof over !== 'object') return out;
    Object.keys(out).forEach(function (k) {
      if (!(k in over)) return;
      if (isMap(out[k])) {
        if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) out[k] = clone(over[k]);
      } else if (Array.isArray(out[k])) {
        if (Array.isArray(over[k])) out[k] = clone(over[k]);
      } else if (out[k] && typeof out[k] === 'object') {
        out[k] = merge(out[k], over[k]);
      } else if (typeof over[k] === typeof out[k] || out[k] === '' || out[k] == null) {
        out[k] = over[k];
      }
    });
    return out;
  }

  function read () {
    try {
      var raw = tableau.extensions.settings.get(STORAGE_KEY);
      return merge(DEFAULTS, raw ? JSON.parse(raw) : null);
    } catch (e) {
      return clone(DEFAULTS);
    }
  }

  function write (cfg) {
    tableau.extensions.settings.set(STORAGE_KEY, JSON.stringify(cfg));
    return tableau.extensions.settings.saveAsync();
  }

  function measureCfg (cfg, key) { return merge(MEASURE, cfg.measures[key]); }
  function ruleCfg (r) { return merge(RULE, r); }

  // -------------------------------------------------------------------------
  // Number formatting
  // -------------------------------------------------------------------------
  var SCALES = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

  function pickScale (value, scale) {
    if (scale === 'dynamic') {
      var a = Math.abs(value);
      return a >= 1e12 ? 'T' : a >= 1e9 ? 'B' : a >= 1e6 ? 'M' : a >= 1e3 ? 'K' : '';
    }
    return SCALES[scale] ? scale : '';
  }

  function fixed (n, decimals, thousands) {
    var d = Math.max(0, Math.min(10, Number(decimals) || 0));
    try {
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
        useGrouping: thousands !== false
      }).format(n);
    } catch (e) {
      return n.toFixed(d);
    }
  }

  function formatScaled (value, scale, decimals, forceScale, thousands) {
    if (!isFinite(value)) return '—';
    var suffix = forceScale != null ? forceScale : pickScale(value, scale);
    var divisor = SCALES[suffix] || 1;
    var text = fixed(value / divisor, decimals, thousands);
    if (/^-[0.,]+$/.test(text)) text = text.slice(1);
    return text + suffix;
  }

  /**
   * Formats a number with a format object (see FORMAT).
   *   opts.signed      write "+" on positive values (when the format asks for it)
   *   opts.fv          Tableau's formatted value (Workbook format)
   *   opts.forceScale  reuse a K/M/B suffix (axis ticks share one)
   *   opts.noUnit      leave the unit off
   *   opts.abs         drop the sign (diverging axis)
   *   opts.full        no K/M/B (tooltips)
   */
  function formatNumber (v, f, opts) {
    opts = opts || {};
    f = f || FORMAT;
    if (v == null || !isFinite(v)) return '—';
    if (opts.abs) v = Math.abs(v);
    var body;
    var neg = v < 0;
    var a = Math.abs(v);
    var scale = f.scale;
    if (opts.full) {
      if (scale === 'workbook' && opts.fv) return String(opts.fv);
      if (scale === 'percentDynamic') scale = 'percent';
      else if (scale !== 'percent') scale = 'none';
    }
    var dec = f.decimals;
    if (opts.full && scale === 'none' && a !== Math.round(a)) dec = Math.max(dec, 2);
    if (scale === 'percent' || scale === 'percentDynamic') {
      var p = f.pctFromRatio ? a * 100 : a;
      body = formatScaled(p, scale === 'percentDynamic' ? 'dynamic' : 'none', dec,
        scale === 'percentDynamic' ? opts.forceScale : '', f.thousands) + '%';
    } else if (scale === 'workbook' && opts.fv) {
      body = String(opts.fv).replace(/^[-−(]\s*/, '').replace(/\)$/, '');
    } else {
      var sc = scale === 'workbook' ? 'dynamic' : scale;
      body = formatScaled(a, sc, dec, opts.forceScale, f.thousands);
    }
    if (!/[1-9]/.test(body)) neg = false;
    if (!opts.noUnit && f.unit) {
      var sp = f.unitSpace === false ? '' : ' ';
      body = f.unitPosition === 'prefix' ? f.unit + sp + body : body + sp + f.unit;
    }
    if (neg) {
      if (f.negStyle === 'paren') return '(' + body + ')';
      return (f.negStyle === 'hyphen' ? '-' : '−') + body;
    }
    if (opts.signed && f.plusSign && /[1-9]/.test(body)) return '+' + body;
    return body;
  }

  // -------------------------------------------------------------------------
  // Dates
  // -------------------------------------------------------------------------
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /** Date from a Tableau cell value (Date, ISO text, "2024", "Jan 2024", "Q1 2024", "January"…). */
  function parseDate (v) {
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (v == null) return null;
    if (typeof v === 'number') {
      if (v >= 1000 && v <= 9999) return new Date(v, 0, 1);
      return null;
    }
    var s = String(v).trim();
    var m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if ((m = /^(\d{4})$/.exec(s))) return new Date(+m[1], 0, 1);
    if ((m = /^Q([1-4])\s*[-/ ]?\s*(\d{4})$/i.exec(s))) return new Date(+m[2], (+m[1] - 1) * 3, 1);
    if ((m = /^(\d{4})\s*[-/ ]?\s*Q([1-4])$/i.exec(s))) return new Date(+m[1], (+m[2] - 1) * 3, 1);
    if ((m = /^Q([1-4])$/i.exec(s))) return new Date(2000, (+m[1] - 1) * 3, 1);
    var mi = monthIndex(s.split(/[\s,-]+/)[0]);
    if (mi >= 0) {
      var y = /(\d{4})/.exec(s);
      var yy = /\b(\d{2})$/.exec(s);
      return new Date(y ? +y[1] : yy ? 2000 + +yy[1] : 2000, mi, 1);
    }
    if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(s))) {
      // Ambiguous d/m vs m/d: Tableau's US format is m/d.
      var a = +m[1]; var b = +m[2];
      return a > 12 ? new Date(+m[3], b - 1, a) : new Date(+m[3], a - 1, b);
    }
    var t = Date.parse(s);
    return isNaN(t) ? null : new Date(t);
  }

  function monthIndex (s) {
    var k = String(s || '').slice(0, 3).toLowerCase();
    for (var i = 0; i < 12; i++) if (MONTHS[i].toLowerCase() === k) return i;
    return -1;
  }

  function pad2 (n) { return (n < 10 ? '0' : '') + n; }

  function formatDate (d, pattern) {
    if (!(d instanceof Date) || isNaN(d)) return '';
    return pattern.replace(/yyyy|yy|MMMM|MMM|MM|dd|Qq|q/g, function (t) {
      switch (t) {
        case 'yyyy': return String(d.getFullYear());
        case 'yy': return pad2(d.getFullYear() % 100);
        case 'MMMM': return MONTHS_LONG[d.getMonth()];
        case 'MMM': return MONTHS[d.getMonth()];
        case 'MM': return pad2(d.getMonth() + 1);
        case 'dd': return pad2(d.getDate());
        case 'Qq': return 'Q' + (Math.floor(d.getMonth() / 3) + 1);
        case 'q': return String(Math.floor(d.getMonth() / 3) + 1);
      }
      return t;
    });
  }

  var DATE_FORMATS = [['auto', 'As Tableau writes it'], ['MMM yyyy', 'Jan 2026'], ['MMM yy', 'Jan 26'], ['MMM', 'Jan'],
    ['MMMM', 'January'], ['yyyy', '2026'], ['Qq yyyy', 'Q1 2026'], ['dd MMM', '05 Jan'], ['dd MMM yyyy', '05 Jan 2026'],
    ['dd/MM/yyyy', '05/01/2026'], ['MM/dd/yyyy', '01/05/2026'], ['yyyy-MM-dd', '2026-01-05']];

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------
  function comparer (order, val, name) {
    var byName = function (a, b) { return String(name(a)).localeCompare(String(name(b)), undefined, { numeric: true, sensitivity: 'base' }); };
    switch (order) {
      case 'valDesc': return function (a, b) { return val(b) - val(a); };
      case 'valAsc': return function (a, b) { return val(a) - val(b); };
      case 'desc': return function (a, b) { return Math.abs(val(b)) - Math.abs(val(a)); };
      case 'asc': return function (a, b) { return Math.abs(val(a)) - Math.abs(val(b)); };
      case 'name': case 'nameAsc': return byName;
      case 'nameDesc': return function (a, b) { return byName(b, a); };
      default: return null;
    }
  }

  function sortBy (list, cmp) {
    if (!cmp) return list.slice();
    return list.map(function (x, i) { return { x: x, i: i }; })
      .sort(function (a, b) { return cmp(a.x, b.x) || a.i - b.i; })
      .map(function (o) { return o.x; });
  }

  // -------------------------------------------------------------------------
  // Colours
  // -------------------------------------------------------------------------
  function fontStack (family) {
    if (!family) return FONT_STACK_FALLBACK;
    return '"' + String(family).replace(/"/g, '') + '", ' + FONT_STACK_FALLBACK;
  }

  function normalizeHex (value) {
    if (typeof value !== 'string') return null;
    var hex = value.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.replace(/(.)/g, '$1$1');
    return /^[0-9a-f]{6}$/i.test(hex) ? '#' + hex.toUpperCase() : null;
  }

  function rgb (hex) {
    var h = normalizeHex(hex) || '#000000';
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }

  function toHex (c) {
    return '#' + c.map(function (x) { return ('0' + Math.max(0, Math.min(255, Math.round(x))).toString(16)).slice(-2); }).join('').toUpperCase();
  }

  function rgba (hex, alpha) {
    var c = rgb(hex);
    return 'rgba(' + c[0] + ', ' + c[1] + ', ' + c[2] + ', ' + alpha + ')';
  }

  /** Mixes two colours: t = 0 → a, t = 1 → b. */
  function mix (a, b, t) {
    var x = rgb(a); var y = rgb(b);
    return toHex([0, 1, 2].map(function (i) { return x[i] + (y[i] - x[i]) * t; }));
  }

  function tint (hex, t) { return mix(hex, '#FFFFFF', t); }

  /** −100 … 100: towards black … towards white. */
  function blend (hex, amount) {
    var a = Math.max(-100, Math.min(100, Number(amount) || 0)) / 100;
    return a < 0 ? mix(hex, '#000000', -a) : mix(hex, '#FFFFFF', a);
  }

  function luminance (hex) {
    var c = rgb(hex).map(function (x) {
      x /= 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function contrastText (hex) { return luminance(hex) > 0.36 ? '#17202B' : '#FFFFFF'; }

  /** Readable version of a bar colour for text on a light background. */
  function readable (hex) { return luminance(hex) > 0.45 ? mix(hex, '#000000', 0.45) : hex; }

  function shades (hex, n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(tint(hex, n <= 1 ? 0 : (i / (n - 1)) * 0.62));
    return out;
  }

  /** Palette colours, with any colours edited in the Format dialog (edits: name → [colour | null]). */
  function paletteColors (name, edits) {
    var base = (PALETTES[name] || PALETTES.house).colors.slice();
    var e = edits && edits[name];
    if (Array.isArray(e)) e.forEach(function (c, i) { if (i < base.length && normalizeHex(c)) base[i] = normalizeHex(c); });
    return base;
  }

  function dashArray (style, width) {
    var w = Math.max(0.5, Number(width) || 1);
    if (style === 'dashed') return (3 * w) + ',' + (3 * w);
    if (style === 'dotted') return w + ',' + (2 * w);
    return '';
  }


  // -------------------------------------------------------------------------
  // Excel number formats (export): the same look as formatNumber, as an
  // Excel format code. `value` picks the K / M / B suffix for dynamic scales.
  // -------------------------------------------------------------------------
  function excelQuote (s) { return '"' + String(s).replace(/"/g, '') + '"'; }

  function excelNumFmt (f, value) {
    f = f || FORMAT;
    var scale = f.scale;
    var d = Math.max(0, Math.min(10, Number(f.decimals) || 0));
    var body = (f.thousands !== false ? '#,##0' : '0') + (d ? '.' + new Array(d + 1).join('0') : '');
    var suffix = '';
    if (scale === 'percent' || scale === 'percentDynamic') {
      body += '%';
    } else {
      var sc = scale === 'dynamic' || scale === 'workbook' ? pickScale(value || 0, 'dynamic') : (SCALES[scale] ? scale : '');
      var commas = { K: ',', M: ',,', B: ',,,', T: ',,,,' }[sc] || '';
      body += commas;
      if (sc) suffix = excelQuote(sc);
    }
    var pos = body + suffix;
    if (f.unit) {
      var sp = f.unitSpace === false ? '' : ' ';
      pos = f.unitPosition === 'prefix' ? excelQuote(f.unit + sp) + pos : pos + excelQuote(sp + f.unit);
    }
    var neg = f.negStyle === 'paren' ? '(' + pos + ')' : '-' + pos;
    var p = f.plusSign ? '+' + pos : pos;
    return p + ';' + neg + ';' + pos;
  }

  /** The value Excel stores for a number shown with format f (percent of a 0–100 value → ratio). */
  function excelValue (v, f) {
    if ((f.scale === 'percent' || f.scale === 'percentDynamic') && !f.pctFromRatio) return v / 100;
    return v;
  }

  window.Mx = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULTS: DEFAULTS,
    FORMAT: FORMAT,
    MEASURE: MEASURE,
    RULE: RULE,
    PALETTES: PALETTES,
    SORTS: SORTS,
    DIRECTIONS: DIRECTIONS,
    textStyle: textStyle,
    DATE_FORMATS: DATE_FORMATS,
    FONTS: FONTS,
    ICONS: ICONS,
    ICON_GROUPS: ICON_GROUPS,
    findIcon: findIcon,
    iconHtml: iconHtml,
    iconSvg: iconSvg,
    clone: clone,
    merge: merge,
    read: read,
    write: write,
    fmtCopy: fmtCopy,
    measureCfg: measureCfg,
    ruleCfg: ruleCfg,
    excelNumFmt: excelNumFmt,
    excelValue: excelValue,
    pickScale: pickScale,
    fixed: fixed,
    formatScaled: formatScaled,
    formatNumber: formatNumber,
    parseDate: parseDate,
    formatDate: formatDate,
    comparer: comparer,
    sortBy: sortBy,
    fontStack: fontStack,
    normalizeHex: normalizeHex,
    rgba: rgba,
    mix: mix,
    tint: tint,
    blend: blend,
    luminance: luminance,
    shades: shades,
    contrastText: contrastText,
    readable: readable,
    paletteColors: paletteColors,
    dashArray: dashArray
  };
  window.Kpi3 = window.Kpi3 || window.Mx;
})();
