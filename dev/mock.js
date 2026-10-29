'use strict';

/**
 * Stand-in for the Tableau Extensions API, for previewing the extension in a
 * normal browser (dev/preview.html). Loaded only when the page URL has ?mock.
 *
 * - Settings live in localStorage, so the matrix and the Format dialog (two
 *   frames) see each other's changes, like they do inside Tableau.
 * - Sample data: ?data=transfer | sales | nested | monthly | negative | raw |
 *   measures | ratios | single | wide
 * - ?rename: the first Rows pill is "renamed" (//New name), so the Marks card
 *   reports a different name than the data column, as Tableau does.
 */
(function () {
  var params = new URLSearchParams(location.search);
  var DS_KEY = 'mtMockData';
  var SET_KEY = 'mtMockSettings';
  var PAYLOAD_KEY = 'mtMockPayload';

  // deterministic pseudo-random numbers
  var seed = 11;
  function rnd () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

  var REGIONS = ['Central', 'East', 'South', 'West'];
  var SEGMENTS = ['Consumer', 'Corporate', 'Home Office'];
  var YEARS = ['2022', '2023', '2024', '2025'];
  var CATS = [['Furniture', ['Bookcases', 'Chairs', 'Furnishings', 'Tables']], ['Office Supplies', ['Appliances', 'Binders', 'Paper', 'Storage']], ['Technology', ['Accessories', 'Copiers', 'Machines', 'Phones']]];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var DATASETS = {
    // From → To money movement between products (the base design). Same product = diagonal.
    transfer: function () {
      var P = ['Current', 'Ehsan', 'Musaned', 'Daily', 'Monthly', 'Term'];
      var V = {
        Current: { Daily: 34.0, Monthly: 18.6, Term: 6.9 },
        Ehsan: { Current: 4.8, Daily: 3.9, Monthly: 1.6, Term: 0.6 },
        Musaned: { Current: 3.2, Daily: 2.8, Monthly: 1.2, Term: 0.4 },
        Daily: { Current: 22.0, Monthly: 7.4, Term: 2.3 },
        Monthly: { Current: 10.4, Daily: 5.1, Term: 0.8 },
        Term: { Current: 1.7, Daily: 0.7, Monthly: 0.3 }
      };
      var rows = [];
      P.forEach(function (f) { P.forEach(function (t) { if (V[f][t] != null) rows.push({ 'From Product': f, 'To Product': t, 'SUM(Amount (M))': V[f][t], 'SUM(Transfers)': Math.round(V[f][t] * (900 + rnd() * 300)) }); }); });
      return { tiles: { rows: ['From Product'], columns: ['To Product'], values: ['SUM(Amount (M))'], tooltip: ['SUM(Transfers)'] }, rows: rows };
    },
    // Region › Segment by Year, Sales + Profit, Quantity in the tooltip, Profit ratio on Color
    sales: function () {
      var rows = [];
      REGIONS.forEach(function (r, i) {
        SEGMENTS.forEach(function (s, j) {
          YEARS.forEach(function (y, k) {
            var sales = Math.round((180000 - i * 22000 - j * 30000) * (0.85 + k * 0.09 + rnd() * 0.2));
            var profit = Math.round(sales * (0.04 + rnd() * 0.2));
            rows.push({ Region: r, Segment: s, 'YEAR(Order Date)': y, 'SUM(Sales)': sales, 'SUM(Profit)': profit, 'AGG(Profit Ratio)': profit / sales, 'SUM(Quantity)': Math.round(sales / 230) });
          });
        });
      });
      return { tiles: { rows: ['Region', 'Segment'], columns: ['YEAR(Order Date)'], values: ['SUM(Sales)', 'SUM(Profit)'], color: ['AGG(Profit Ratio)'], tooltip: ['SUM(Quantity)'] }, rows: rows };
    },
    // Category › Sub-Category by Region › Segment (two levels each way)
    nested: function () {
      var rows = [];
      CATS.forEach(function (g) {
        g[1].forEach(function (sc) {
          var base = 9000 + rnd() * 40000;
          REGIONS.forEach(function (r) {
            SEGMENTS.forEach(function (s) {
              if (rnd() < 0.06) return; // a few gaps
              rows.push({ Category: g[0], 'Sub-Category': sc, Region: r, Segment: s, 'SUM(Sales)': Math.round(base * (0.4 + rnd())) });
            });
          });
        });
      });
      return { tiles: { rows: ['Category', 'Sub-Category'], columns: ['Region', 'Segment'], values: ['SUM(Sales)'] }, rows: rows };
    },
    monthly: function () {
      var rows = [];
      MONTHS.forEach(function (m, i) {
        YEARS.forEach(function (y, k) {
          rows.push({ 'MONTH(Order Date)': m, 'YEAR(Order Date)': y, 'SUM(Sales)': Math.round((52000 + Math.sin(i / 1.9) * 16000 + i * 2200) * (0.82 + k * 0.11 + rnd() * 0.12)) });
        });
      });
      return { tiles: { rows: ['MONTH(Order Date)'], columns: ['YEAR(Order Date)'], values: ['SUM(Sales)'] }, rows: rows };
    },
    negative: function () {
      var rows = [];
      CATS.forEach(function (g) {
        g[1].forEach(function (sc) {
          SEGMENTS.forEach(function (s) { rows.push({ 'Sub-Category': sc, Segment: s, 'SUM(Profit)': Math.round((rnd() - 0.3) * 24000) }); });
        });
      });
      return { tiles: { rows: ['Sub-Category'], columns: ['Segment'], values: ['SUM(Profit)'] }, rows: rows };
    },
    raw: function () {
      var rows = [];
      ['Paseo', 'VTT', 'Amarilla', 'Velo', 'Montana', 'Carretera'].forEach(function (p, i) {
        ['Channel Partners', 'Enterprise', 'Government', 'Midmarket', 'Small Business'].forEach(function (c) {
          rows.push({ Product: p, Segment: c, 'SUM(Gross Sales)': (4.8e6 - i * 5e5) * (0.2 + rnd()) });
        });
      });
      return { tiles: { rows: ['Product'], columns: ['Segment'], values: ['SUM(Gross Sales)'] }, rows: rows };
    },
    // Rows only, three measures (try Layout → Measures as columns)
    measures: function () {
      var rows = [];
      CATS.forEach(function (g) {
        g[1].forEach(function (sc) {
          var s = Math.round(30000 + rnd() * 200000);
          rows.push({ 'Sub-Category': sc, 'SUM(Sales)': s, 'SUM(Profit)': Math.round(s * (rnd() * 0.3 - 0.05)), 'SUM(Quantity)': Math.round(s / 180) });
        });
      });
      return { tiles: { rows: ['Sub-Category'], columns: [], values: ['SUM(Sales)', 'SUM(Profit)', 'SUM(Quantity)'] }, rows: rows };
    },
    // Averages and distinct counts: totals can't simply add up (Measures tab → Totals)
    ratios: function () {
      var rows = [];
      REGIONS.forEach(function (r) {
        SEGMENTS.forEach(function (s) {
          rows.push({ Region: r, Segment: s, 'AVG(Discount)': 0.05 + rnd() * 0.2, 'CNTD(Customer)': Math.round(60 + rnd() * 140) });
        });
      });
      return { tiles: { rows: ['Region'], columns: ['Segment'], values: ['AVG(Discount)', 'CNTD(Customer)'] }, rows: rows };
    },
    // No dimensions at all
    single: function () {
      return { tiles: { rows: [], columns: [], values: ['SUM(Bank In)', 'SUM(Wallet In)'] }, rows: [{ 'SUM(Bank In)': 262.1e6, 'SUM(Wallet In)': 36.3e6 }] };
    },
    // 3 row levels, 30 columns: scrolling with frozen headers
    wide: function () {
      var rows = [];
      CATS.forEach(function (g) {
        g[1].forEach(function (sc) {
          REGIONS.forEach(function (r) {
            for (var d = 1; d <= 30; d++) rows.push({ Category: g[0], 'Sub-Category': sc, Region: r, 'DAY(Order Date)': String(d), 'SUM(Orders)': Math.round(rnd() * 90) });
          });
        });
      });
      return { tiles: { rows: ['Category', 'Sub-Category', 'Region'], columns: ['DAY(Order Date)'], values: ['SUM(Orders)'] }, rows: rows };
    }
  };

  var dsName = params.get('data') || localStorage.getItem(DS_KEY) || 'transfer';
  var DS = (DATASETS[dsName] || DATASETS.transfer)();
  var RENAME = /[?&]rename\b/.test(location.search);

  function cell (v) {
    return { value: v, nativeValue: v, formattedValue: typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v) };
  }

  var ORDER = ['rows', 'columns', 'values', 'color', 'tooltip'];
  var DIMS = { rows: 1, columns: 1 };

  function allFields () {
    var out = [];
    ORDER.forEach(function (t) { (DS.tiles[t] || []).forEach(function (n) { out.push({ tile: t, name: n }); }); });
    return out;
  }

  function buildTable () {
    var cols = allFields().map(function (f, i) {
      var name = RENAME && f.tile === 'rows' && i === 0 ? 'Calculation_8812' : f.name;
      return { fieldName: name, fieldId: '[' + name + ']', dataType: DIMS[f.tile] ? 'string' : 'float', index: i, src: f.name };
    });
    // Like Tableau, hand the rows over last-to-first.
    var data = DS.rows.slice().reverse().map(function (r) { return cols.map(function (c) { return cell(r[c.src]); }); });
    return { columns: cols.map(function (c) { return { fieldName: c.fieldName, fieldId: c.fieldId, dataType: c.dataType, index: c.index }; }), data: data };
  }

  // Tooltip measures sit on Tableau's own Tooltip tile, which comes with a type.
  function encodings () {
    return allFields().map(function (f, i) {
      var name = RENAME && f.tile === 'rows' && i === 0 ? 'From (renamed)' : f.name;
      var builtIn = f.tile === 'tooltip' ? 'tooltip' : null;
      return { id: builtIn || f.tile, type: builtIn || 'custom', field: { name: name, id: '[' + name + ']', role: DIMS[f.tile] ? 'dimension' : 'measure' } };
    });
  }

  // ---- settings ----------------------------------------------------------
  function loadSettings () {
    try { return JSON.parse(localStorage.getItem(SET_KEY) || '{}'); } catch (e) { return {}; }
  }
  var pending = loadSettings();
  var settingsHandlers = [];
  window.addEventListener('storage', function (e) {
    if (e.key === SET_KEY) {
      pending = loadSettings();
      settingsHandlers.forEach(function (h) { h({}); });
    }
  });

  var configureFn = null;
  var dialogResolve = null;
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'mt-dialog-closed' && dialogResolve) { dialogResolve(''); dialogResolve = null; }
    if (e.data && e.data.type === 'mt-configure' && configureFn) configureFn();
  });

  window.tableau = {
    TableauEventType: { SummaryDataChanged: 'summary-data-changed', SettingsChanged: 'settings-changed' },
    DialogStyle: { Modal: 'modal', Modeless: 'modeless', Window: 'window' },
    ErrorCodes: { DialogClosedByUser: 'dialog-closed-by-user' },
    SelectionUpdateType: { Replace: 'select-replace' },
    extensions: {
      initializeAsync: function (opts) {
        configureFn = opts && opts.configure;
        return Promise.resolve();
      },
      initializeDialogAsync: function () {
        return Promise.resolve(localStorage.getItem(PAYLOAD_KEY) || '');
      },
      settings: {
        get: function (k) { return pending[k]; },
        set: function (k, v) { pending[k] = v; },
        getAll: function () { return pending; },
        saveAsync: function () {
          localStorage.setItem(SET_KEY, JSON.stringify(pending));
          settingsHandlers.forEach(function (h) { h({}); });
          return Promise.resolve();
        },
        addEventListener: function (type, h) { settingsHandlers.push(h); }
      },
      worksheetContent: {
        worksheet: {
          name: 'Mock sheet',
          addEventListener: function () {},
          getVisualSpecificationAsync: function () {
            return Promise.resolve({ activeMarksSpecificationIndex: 0, marksSpecifications: [{ encodings: encodings() }] });
          },
          getSummaryDataReaderAsync: function () {
            var t = buildTable();
            return Promise.resolve({
              getAllPagesAsync: function () { return Promise.resolve(t); },
              releaseAsync: function () { return Promise.resolve(); }
            });
          },
          selectMarksByValueAsync: function (sel) { console.log('mock selectMarksByValueAsync', JSON.stringify(sel)); return Promise.resolve(); },
          clearSelectedMarksAsync: function () { return Promise.resolve(); }
        }
      },
      ui: {
        displayDialogAsync: function (url, payload) {
          localStorage.setItem(PAYLOAD_KEY, payload || '');
          var target = window.parent !== window ? window.parent : null;
          if (target) target.postMessage({ type: 'mt-open-dialog', url: url }, '*');
          else window.open(url, 'mt-dialog', 'width=620,height=780');
          return new Promise(function (resolve) { dialogResolve = resolve; });
        },
        closeDialog: function () {
          if (window.parent !== window) window.parent.postMessage({ type: 'mt-close-dialog' }, '*');
          else window.close();
        }
      }
    }
  };
})();
