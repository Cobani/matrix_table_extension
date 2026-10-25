'use strict';

/**
 * Matrix Table — Tableau Viz Extension.
 *
 * Marks card tiles (declared in matrix-table.trex):
 *   rows      Rows: 0–6 dimensions, outermost first. Outer fields group the
 *             inner ones (with optional subtotals, foldable).
 *   columns   Columns: 0–6 dimensions, outermost first.
 *   values    Measure: the measures (dropped one by one). Shown in the
 *             cells (first = main value, others small), or as their own
 *             columns or rows (Format → Layout).
 *   color     Color: optional measure that shades the cells.
 *   Tableau's own Tooltip tile: extra measures in the tooltip.
 *
 * Header (icon, title, explanation) is the same as KPI Card 3; the card
 * options are Waterfall's. Everything else is set in the Format dialog
 * (configure.html), which also opens from the right-click menu.
 */
(function () {
  var el = {};
  var worksheet = null;
  var cfg = null;
  var raw = null; // extracted data, see extract()
  var model = null; // what the last paint drew, see buildModel()
  var renderToken = 0;
  var SEP = '\u0001';

  /** In-memory state (not saved): folded groups, hover. */
  var state = {
    folded: {}, // 'r:<path>' / 'c:<path>' → true
    hover: null, // { ri, ci }
    sig: null
  };

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  function init () {
    ['card', 'icon', 'title', 'explanation', 'tools', 'exportBtn', 'body', 'plot', 'scroll', 'hint', 'tooltip', 'menu', 'toast'].forEach(function (id) {
      el[id] = document.getElementById(id);
    });

    el.scroll.addEventListener('mousemove', onHover);
    el.scroll.addEventListener('mouseleave', function () { hideTooltip(); setHover(null); });
    el.scroll.addEventListener('contextmenu', onContextMenu);
    el.scroll.addEventListener('click', onClick);
    el.scroll.addEventListener('dblclick', onDblClick);
    el.scroll.addEventListener('scroll', function () { hideTooltip(); });
    el.exportBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var r = el.exportBtn.getBoundingClientRect();
      showMenu(exportItems(), r.right, r.bottom + 4, true);
    });
    document.addEventListener('mousedown', function (e) {
      if (!el.menu.contains(e.target) && e.target !== el.exportBtn) hideMenu();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { hideMenu(); hideTooltip(); } });
    window.addEventListener('blur', hideMenu);

    if (window.ExtTiming) ExtTiming.mark('initializeAsync start');
    return tableau.extensions.initializeAsync({ configure: function () { return openDialog(null); } }).then(function () {
      if (window.ExtTiming) ExtTiming.mark('initializeAsync done (Tableau handshake)');
      worksheet = tableau.extensions.worksheetContent.worksheet;
      cfg = Mx.read();

      worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, function () { refresh(); });
      tableau.extensions.settings.addEventListener(
        tableau.TableauEventType.SettingsChanged,
        function () { cfg = Mx.read(); paint(); }
      );

      if (window.ResizeObserver) {
        new ResizeObserver(function () { schedule(); }).observe(document.body);
      } else {
        window.addEventListener('resize', schedule);
      }
      return refresh();
    }).catch(function (err) {
      console.error('Matrix Table failed to initialize:', err);
      showEmpty('Could not initialize the extension. See the console for details.');
    });
  }

  var queued = false;
  var lastW = -1;
  var lastH = -1;
  function schedule () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      var w = document.body.clientWidth; var h = document.body.clientHeight;
      if (w === lastW && h === lastH) return;
      lastW = w; lastH = h;
      paint();
    });
  }

  /**
   * Opens the Format dialog. `focus` ({ tab, item }) preselects a tab and an
   * item. The dialog gets the fields and members as payload, because it
   * can't read the worksheet itself.
   */
  function openDialog (focus) {
    hideMenu();
    hideTooltip();
    var url = window.location.href.split(/[?#]/)[0].replace(/[^/]*$/, '') + 'configure.html' +
      (/[?&]mock\b/.test(location.search) ? '?mock' : '');
    var payload = JSON.stringify(dialogInfo(focus));
    var options = { width: 620, height: 780 };
    // On top (Modal) keeps the Format window in front of Tableau until Done; Floating (Modeless) lets you click the workbook but can fall behind it.
    var DS = tableau.DialogStyle || {};
    var style = cfg && cfg.interaction.dialog === 'floating' ? DS.Modeless : DS.Modal;
    if (style) options.dialogStyle = style;
    return tableau.extensions.ui.displayDialogAsync(url, payload, options).catch(function (err) {
      var closed = tableau.ErrorCodes && err && err.errorCode === tableau.ErrorCodes.DialogClosedByUser;
      if (!closed) console.warn('Matrix Table dialog:', err && err.message);
    });
  }

  /** What the dialog needs to list: measures, fields and their members. */
  function dialogInfo (focus) {
    var info = { focus: focus || null, measures: [], rowFields: [], colFields: [], members: [], hasColor: false, extras: [] };
    if (!raw) return info;
    info.measures = raw.measures.map(function (m) { return { key: m.key, name: m.name }; });
    info.rowFields = raw.rowFields.map(function (f, i) { return { key: f.key, name: f.name, values: (raw.rowValues[i] || []).slice(0, 300) }; });
    info.colFields = raw.colFields.map(function (f, i) { return { key: f.key, name: f.name, values: (raw.colValues[i] || []).slice(0, 300) }; });
    var seen = {};
    raw.rowValues.concat(raw.colValues).forEach(function (list) {
      list.forEach(function (v) { if (!seen[v]) { seen[v] = 1; info.members.push(v); } });
    });
    info.members = info.members.slice(0, 500);
    info.hasColor = !!raw.color;
    info.colorName = raw.color ? raw.color.name : '';
    info.extras = raw.extras.map(function (x) { return { key: x.key, name: x.name }; });
    if (model) {
      info.cols = model.cols.filter(function (c) { return c.type === 'leaf' || c.type === 'grand'; }).slice(0, 200)
        .map(function (c) { return { key: c.key, name: c.label }; });
    }
    return info;
  }

  // ---------------------------------------------------------------------------
  // Last-render cache (same approach as Waterfall)
  // ---------------------------------------------------------------------------
  var CACHE_PREFIX = 'matrixtable:lastRender:v1:';
  var CACHE_MAX_AGE = 30 * 24 * 3600 * 1000;
  var CACHE_MAX_CHARS = 400000;
  var cacheTried = false;

  function cacheKey () {
    var host = '';
    try { host = document.referrer ? new URL(document.referrer).origin : ''; } catch (e) { /* ignore */ }
    return CACHE_PREFIX + host + '|' + (worksheet && worksheet.name);
  }

  function fieldsSig (fields) {
    var out = {};
    Object.keys(fields).sort().forEach(function (k) {
      out[k] = fields[k].map(function (f) { return (f.id || '') + '|' + (f.name || ''); });
    });
    return JSON.stringify(out);
  }

  function readCacheEntry () {
    try {
      var s = window.localStorage.getItem(cacheKey());
      if (!s) return null;
      var c = JSON.parse(s);
      if (!c || !c.data || !(Date.now() - c.t < CACHE_MAX_AGE)) return null;
      return c;
    } catch (e) { return null; }
  }

  function writeCache (fields, data) {
    try {
      var s = JSON.stringify({ sig: fieldsSig(fields), t: Date.now(), data: data });
      if (s.length > CACHE_MAX_CHARS) return;
      try {
        window.localStorage.setItem(cacheKey(), s);
      } catch (full) {
        for (var i = window.localStorage.length - 1; i >= 0; i--) {
          var k = window.localStorage.key(i);
          if (k && k.indexOf(CACHE_PREFIX) === 0) window.localStorage.removeItem(k);
        }
        window.localStorage.setItem(cacheKey(), s);
      }
    } catch (e) { /* ignore */ }
  }

  function clearCache () {
    try { window.localStorage.removeItem(cacheKey()); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------
  // Custom tiles (matrix-table.trex: Rows, Columns, Measure, Color) plus
  // Tableau's own Detail and Tooltip tiles, mapped in getEncodedFields().
  var TILES = ['rows', 'columns', 'values', 'color', 'tooltip', 'detail'];

  async function refresh () {
    var token = ++renderToken;
    var T = window.ExtTiming || { mark: function () {}, done: function () {}, line: function () {} };
    var t0 = performance.now();
    var first = token === 1;
    var ms = function () { return Math.round(performance.now() - t0); };
    if (first) T.mark('data requested');
    try {
      var tFields = 0;
      var tData = 0;
      var fieldsP = getEncodedFields().then(function (r) { tFields = ms(); if (first) T.mark('fields received (Marks card)'); return r; });
      var dataP = readSummaryData().then(function (r) {
        tData = ms();
        if (first) T.mark('data received', (r && r.data ? r.data.length : 0) + ' rows');
        return r;
      }).catch(function (err) { tData = ms(); return { error: err }; });

      if (!cacheTried) {
        cacheTried = true;
        var entry = readCacheEntry();
        if (entry && !raw) {
          raw = entry.data;
          try { paint(); T.mark('cached result drawn'); } catch (e) { raw = null; entry = null; }
        }
        if (entry) {
          fieldsP.then(function (f) {
            if (token !== renderToken || raw !== entry.data || entry.sig === fieldsSig(f)) return;
            raw = null;
            showEmpty('');
            T.mark('cached result removed (fields changed)');
          }).catch(function () { /* handled below */ });
        }
      }

      var results = await Promise.all([fieldsP, dataP]);
      if (token !== renderToken) return;
      var fields = results[0];

      if (!fields.values.length) {
        raw = null;
        clearCache();
        if (first) { T.mark('no measure on Measure'); T.done('Matrix Table load timings'); }
        showEmpty('Drag a measure onto <b>Measure</b>, and dimensions onto <b>Rows</b> and <b>Columns</b>.<br>' +
          'Drop more than one dimension on a tile for more levels (outermost first). Optional: <b>Color</b> shades the cells ' +
          'by another measure, and measures on Tableau\'s <b>Tooltip</b> tile add tooltip rows.');
        return;
      }

      var table = results[1];
      if (table && table.error) throw table.error;

      raw = extract(table, fields);
      raw.sig = fieldsSig(fields);
      if (state.sig && state.sig !== raw.sig) state.folded = {};
      state.sig = raw.sig;
      var tp = performance.now();
      paint();
      if (first) {
        T.mark('live result drawn', 'draw ' + Math.round(performance.now() - tp) + ' ms');
        T.done('Matrix Table load timings');
      } else {
        T.line('refresh #' + token + ': fields ' + tFields + ' ms, data ' + tData + ' ms (' +
          (table.data ? table.data.length : 0) + ' rows), draw ' + Math.round(performance.now() - tp) + ' ms');
      }
      writeCache(fields, raw);
    } catch (err) {
      console.error('Matrix Table render failed:', err);
      if (first) { T.mark('render failed', err && err.message); T.done('Matrix Table load timings'); }
      if (token === renderToken) showEmpty('Could not read the worksheet data. See the console for details.');
    }
  }

  async function getEncodedFields () {
    var spec = await worksheet.getVisualSpecificationAsync();
    var marks = spec.marksSpecifications[spec.activeMarksSpecificationIndex];
    var fields = {};
    TILES.forEach(function (t) { fields[t] = []; });
    marks.encodings.forEach(function (e) {
      if (!e.field) return;
      var type = String(e.type || '').toLowerCase();
      var id = type && type !== 'custom' ? type : e.id;
      // Detail and Tooltip are Tableau's own tiles: their measures become tooltip rows.
      // Dimensions there only add rows (values are added up per cell).
      if (id === 'detail' || id === 'tooltip') id = isMeasureField(e.field) ? 'tooltip' : 'detail';
      (fields[id] = fields[id] || []).push(e.field);
    });
    return fields;
  }

  function isMeasureField (f) {
    var role = String(f.role || '').toLowerCase();
    if (role === 'measure') return true;
    if (role === 'dimension') return false;
    return /^(SUM|AVG|MIN|MAX|CNT|CNTD|COUNT|COUNTD|MEDIAN|AGG|STDEV|STDEVP|VAR|VARP|PCT\d+)\(/i.test(String(f.name || ''));
  }

  async function readSummaryData () {
    var reader = await worksheet.getSummaryDataReaderAsync(undefined, { ignoreSelection: true });
    try {
      return await reader.getAllPagesAsync();
    } finally {
      await reader.releaseAsync();
    }
  }

  function norm (s) {
    return String(s || '').replace(/^[A-Z_]+\((.*)\)$/i, '$1').trim().toLowerCase();
  }

  function nameParts (s) {
    var str = String(s || '');
    var i = str.indexOf('//');
    if (i < 0) return [norm(str)];
    return [norm(str.slice(i + 2)), norm(str.slice(0, i))].filter(Boolean);
  }

  function isMN (c) { return /^measure (names|values)$/i.test(c.fieldName); }
  function isNumericCol (c) { return /^(float|int|real|integer|number)$/i.test(String(c.dataType || '')); }
  function isDateCol (c) { return /date/i.test(String(c.dataType || '')); }

  function findColumn (table, field, taken) {
    if (!field) return null;
    var cols = table.columns.filter(function (c) { return taken.indexOf(c) < 0 && !isMN(c); });
    var fid = field.id || field.fieldId;
    var fn = nameParts(field.name);
    return cols.find(function (c) { return fid && c.fieldId && c.fieldId === fid; }) ||
      cols.find(function (c) { return c.fieldName === field.name; }) ||
      cols.find(function (c) { return norm(c.fieldName) === norm(field.name); }) ||
      cols.find(function (c) {
        var cn = nameParts(c.fieldName);
        return cn.some(function (x) { return fn.indexOf(x) >= 0; });
      }) ||
      null;
  }

  /** Renamed pills: unmatched fields take the free columns in order (see Waterfall). */
  function matchLeftovers (table, reqs, taken, pivoted) {
    var free = function () {
      return table.columns.filter(function (c) { return taken.indexOf(c) < 0 && !isMN(c); });
    };
    var take = function (r, c) { if (c) { r.col = c; taken.push(c); r.guessed = true; } };
    reqs.forEach(function (r) {
      if (!r.col && r.dim) take(r, free().find(function (x) { return !isNumericCol(x); }));
    });
    if (!pivoted) {
      reqs.forEach(function (r) {
        if (!r.col && !r.dim) take(r, free().find(isNumericCol));
      });
    }
    reqs.forEach(function (r) {
      if (!r.col && (r.dim || !pivoted)) take(r, free()[0]);
    });
    var guessed = reqs.filter(function (r) { return r.guessed; });
    if (guessed.length) {
      console.info('Matrix Table: matched renamed fields by position:', guessed.map(function (r) {
        return (r.field && r.field.name) + ' → ' + r.col.fieldName;
      }));
    }
  }

  function toNumber (cell) {
    if (!cell) return NaN;
    var v = cell.nativeValue != null ? cell.nativeValue : cell.value;
    if (v === null || v === '%null%' || v === '') return NaN;
    return typeof v === 'number' ? v : Number(v);
  }

  var DATE_PARTS = { YEAR: 'Year', QUARTER: 'Quarter', MONTH: 'Month', WEEK: 'Week', DAY: 'Day', WEEKDAY: 'Weekday', HOUR: 'Hour',
    TYR: 'Year', TQR: 'Quarter', TMN: 'Month', TWK: 'Week', TDY: 'Day', MY: 'Month', QY: 'Quarter', MDY: 'Day' };

  function cleanName (name) {
    var s = String(name || '');
    var m = /^([A-Z]+)\((.*)\)$/i.exec(s);
    if (m && DATE_PARTS[m[1].toUpperCase()]) return DATE_PARTS[m[1].toUpperCase()] + ' of ' + m[2];
    return s.replace(/^(SUM|AVG|MIN|MAX|CNT|CNTD|COUNT|COUNTD|MEDIAN|AGG|ATTR|STDEV|VAR)\((.*)\)$/i, '$2');
  }

  /** How totals add up when the Measures tab says "Automatic". */
  function autoAgg (pillName) {
    var m = /^([A-Z]+)\(/i.exec(String(pillName || ''));
    var f = m ? m[1].toUpperCase() : 'SUM';
    if (f === 'SUM' || f === 'CNT' || f === 'COUNT') return 'sum';
    if (f === 'AVG') return 'avg';
    if (f === 'MIN') return 'min';
    if (f === 'MAX') return 'max';
    if (f === 'CNTD' || f === 'COUNTD' || f === 'AGG' || f === 'MEDIAN' || f === 'ATTR' || /^STDEV|^VAR|^PCT/.test(f)) return 'none';
    return 'sum';
  }

  function cellText (cell) {
    if (!cell) return '';
    var f = cell.formattedValue;
    if (f == null || f === '%null%') f = cell.value;
    return f == null || f === '%null%' ? 'Null' : String(f);
  }

  /**
   * Summary data → rows with every tile's values:
   *   { r: [Rows values], c: [Columns values], rd / cd: [date ms | null],
   *     v: { measure: n }, fv: { measure: Tableau text }, k: Color value, x: { tooltip measure: n } }
   */
  function extract (table, fields) {
    var rows = table.data || [];
    var taken = [];
    var cMN = table.columns.find(function (c) { return /^measure names$/i.test(c.fieldName); });
    var cMV = table.columns.find(function (c) { return /^measure values$/i.test(c.fieldName); });

    function dimReq (f) { return { field: f, dim: true, col: null, key: f.name, name: cleanName(f.name) }; }
    var used = {};
    function measReq (f, kind) {
      var key = f.name;
      while (used[kind + key]) key += '+';
      used[kind + key] = 1;
      return { field: f, dim: false, col: null, key: key, name: cleanName(f.name), kind: kind, agg: autoAgg(f.name) };
    }
    var rq = fields.rows.map(dimReq);
    var cq = fields.columns.map(dimReq);
    var meas = fields.values.map(function (f) { return measReq(f, 'v'); });
    var color = fields.color.map(function (f) { return measReq(f, 'k'); });
    var extras = fields.tooltip.map(function (f) { return measReq(f, 'x'); });
    var details = (fields.detail || []).map(dimReq);

    var reqs = rq.concat(cq, details, meas, color, extras);
    reqs.forEach(function (r) {
      r.col = findColumn(table, r.field, taken);
      if (r.col) taken.push(r.col);
    });
    matchLeftovers(table, reqs, taken, !!(cMN && cMV));

    function cellOf (row, r, mn) {
      if (r.col) return row[r.col.index];
      if (cMN && cMV && (mn === norm(r.field.name) || mn === norm(r.name))) return row[cMV.index];
      return null;
    }

    function dimVals (row, list, dates) {
      var out = [];
      list.forEach(function (r, i) {
        var cell = r.col ? row[r.col.index] : null;
        out.push(cellText(cell));
        var dt = null;
        if (cell && r.col && isDateCol(r.col)) {
          var nv = cell.nativeValue != null ? cell.nativeValue : cell.value;
          var pd = Mx.parseDate(nv);
          dt = pd ? pd.getTime() : null;
        }
        dates.push(dt);
      });
      return out;
    }

    // Measure Names / Measure Values rows: one row per measure, merge them back by dimension values.
    var byKey = cMN ? {} : null;
    var out = [];
    rows.forEach(function (row) {
      var mn = cMN ? norm(row[cMN.index].formattedValue || row[cMN.index].value) : null;
      var rd = []; var cd = [];
      var o = { r: dimVals(row, rq, rd), c: dimVals(row, cq, cd), rd: rd, cd: cd, v: {}, fv: {}, k: null, x: {} };
      if (byKey) {
        var dk = o.r.join(SEP) + '\u0002' + o.c.join(SEP) + '\u0002' + details.map(function (r) { return cellText(r.col ? row[r.col.index] : null); }).join(SEP);
        if (byKey[dk]) o = byKey[dk]; else { byKey[dk] = o; out.push(o); }
      } else {
        out.push(o);
      }
      meas.forEach(function (r) {
        var cell = cellOf(row, r, mn);
        if (!cell) return;
        var n = toNumber(cell);
        if (!isFinite(n)) return;
        o.v[r.key] = n; o.fv[r.key] = cell.formattedValue;
      });
      color.forEach(function (r) { var n = toNumber(cellOf(row, r, mn)); if (isFinite(n)) o.k = n; });
      extras.forEach(function (r) { var n = toNumber(cellOf(row, r, mn)); if (isFinite(n)) o.x[r.key] = n; });
    });

    var fieldsOf = function (list) { return list.map(function (r) { return { key: r.key, name: r.name, isDate: !!(r.col && isDateCol(r.col)) }; }); };
    var valuesOf = function (n, which) {
      var lists = [];
      for (var i = 0; i < n; i++) {
        var seen = {}; var l = [];
        out.forEach(function (o) { var v = o[which][i]; if (!seen[v]) { seen[v] = 1; l.push(v); } });
        lists.push(l);
      }
      return lists;
    };
    var strip = function (r) { return { key: r.key, name: r.name, agg: r.agg }; };
    return {
      rows: out,
      rowFields: fieldsOf(rq),
      colFields: fieldsOf(cq),
      rowValues: valuesOf(rq.length, 'r'),
      colValues: valuesOf(cq.length, 'c'),
      measures: meas.map(strip),
      color: color[0] ? strip(color[0]) : null,
      extras: extras.map(strip)
    };
  }

  // ---------------------------------------------------------------------------
  // Model: member trees, axis items, header cells, cell values and calculations
  // ---------------------------------------------------------------------------
  function mainKey () {
    var k = cfg.layout.mainMeasure;
    return raw.measures.some(function (m) { return m.key === k; }) ? k : raw.measures[0].key;
  }

  function measureOf (k) { return raw.measures.find(function (m) { return m.key === k; }) || { key: k, name: k, agg: 'sum' }; }

  function mName (k) {
    var mc = Mx.measureCfg(cfg, k);
    return mc.label || measureOf(k).name;
  }

  function aggOf (k) {
    var a = Mx.measureCfg(cfg, k).agg;
    return a === 'auto' ? measureOf(k).agg : a;
  }

  function newAcc () { return { v: {}, k: null, x: {} }; }

  function addNum (store, key, x, fv) {
    var a = store[key];
    if (!a) a = store[key] = { s: 0, n: 0, mn: Infinity, mx: -Infinity, fv: null };
    a.s += x; a.n++;
    if (x < a.mn) a.mn = x;
    if (x > a.mx) a.mx = x;
    a.fv = fv == null ? null : fv;
  }

  function aggNum (a, how, isTotal) {
    if (!a || !a.n) return NaN;
    switch (how) {
      case 'avg': return a.s / a.n;
      case 'min': return a.mn;
      case 'max': return a.mx;
      case 'none': return isTotal ? NaN : a.s;
      default: return a.s;
    }
  }

  function pk (R, C) { return R.length + ':' + R.join(SEP) + '\u0002' + C.length + ':' + C.join(SEP); }

  /** Adds every data row to every (row prefix × column prefix) it belongs to. */
  function aggregate (rows, getR, getC, nR, nC) {
    var store = new Map();
    rows.forEach(function (o) {
      var rr = getR(o); var cc = getC(o);
      var rk = []; var ck = [];
      for (var i = 0; i <= nR; i++) rk.push(i + ':' + rr.slice(0, i).join(SEP));
      for (var j = 0; j <= nC; j++) ck.push(j + ':' + cc.slice(0, j).join(SEP));
      for (i = 0; i <= nR; i++) {
        for (j = 0; j <= nC; j++) {
          var key = rk[i] + '\u0002' + ck[j];
          var acc = store.get(key);
          if (!acc) { acc = newAcc(); store.set(key, acc); }
          var m;
          for (m in o.v) addNum(acc.v, m, o.v[m], o.fv[m]);
          if (o.k != null) { if (!acc.k) acc.k = { s: 0, n: 0, mn: Infinity, mx: -Infinity }; acc.k.s += o.k; acc.k.n++; acc.k.mn = Math.min(acc.k.mn, o.k); acc.k.mx = Math.max(acc.k.mx, o.k); }
          for (m in o.x) addNum(acc.x, m, o.x[m], null);
        }
      }
    });
    return store;
  }

  function buildTree (rows, getP, getD, n) {
    var root = { path: [], children: [], map: {}, depth: -1, order: [] };
    rows.forEach(function (o, idx) {
      var p = getP(o); var d = getD(o);
      var node = root;
      for (var i = 0; i < n; i++) {
        var lbl = p[i];
        var ch = node.map[lbl];
        if (!ch) {
          var lo = root.order[i] || (root.order[i] = {});
          if (lo[lbl] == null) lo[lbl] = idx;
          ch = { label: lbl, path: p.slice(0, i + 1), depth: i, children: [], map: {}, first: lo[lbl], date: d[i] };
          node.map[lbl] = ch;
          node.children.push(ch);
        }
        node = ch;
      }
    });
    return root;
  }

  function unionTrees (a, b) {
    var labels = a.children.map(function (n) { return n.label; });
    b.children.forEach(function (n) { if (labels.indexOf(n.label) < 0) labels.push(n.label); });
    [a, b].forEach(function (t) {
      t.children = labels.map(function (l, i) {
        var n = t.map[l] || (t.map[l] = { label: l, path: [l], depth: 0, children: [], map: {}, date: null });
        n.first = i; // same order on both axes
        return n;
      });
    });
  }

  function sortTree (node, cmpFor) {
    if (!node.children.length) return;
    var cmp = cmpFor(node.depth + 1);
    if (cmp) node.children = Mx.sortBy(node.children, cmp);
    node.children.forEach(function (c) { sortTree(c, cmpFor); });
  }

  function nameCmp (fields, desc) {
    return function (depth) {
      var isDate = fields[depth] && fields[depth].isDate;
      return function (a, b) {
        var r = isDate && a.date != null && b.date != null ? a.date - b.date
          : String(a.label).localeCompare(String(b.label), undefined, { numeric: true, sensitivity: 'base' });
        return desc ? -r : r;
      };
    };
  }

  function valueCmp (val, desc) {
    return function () {
      return function (a, b) {
        var x = val(a); var y = val(b);
        var fx = isFinite(x); var fy = isFinite(y);
        if (!fx || !fy) return fx === fy ? 0 : fx ? -1 : 1; // blanks last
        return desc ? y - x : x - y;
      };
    };
  }

  function itemKey (it) { return it.type + ':' + it.path.join(SEP) + '|' + (it.m || ''); }

  /** Rows or columns in display order: leaves, folded groups, subtotals, grand total. */
  function flatten (root, n, axis) {
    var T = cfg.totals;
    var subs = axis === 'r' ? T.rowSubs : T.colSubs;
    var items = [];
    var walk = function (node) {
      node.children.forEach(function (ch) {
        if (ch.depth === n - 1) { items.push({ type: 'leaf', path: ch.path, node: ch }); return; }
        if (T.collapsible && state.folded[axis + ':' + ch.path.join(SEP)]) { items.push({ type: 'folded', path: ch.path, node: ch }); return; }
        walk(ch);
        if (subs[ch.depth]) items.push({ type: 'sub', path: ch.path, node: ch });
      });
    };
    if (n === 0) items.push({ type: 'leaf', path: [] });
    else walk(root);
    var grand = axis === 'r' ? T.rowGrand : T.colGrand;
    if (grand && n > 0) {
      var g = { type: 'grand', path: [] };
      if ((axis === 'r' ? T.rowGrandPos : T.colGrandPos) === (axis === 'r' ? 'top' : 'left')) items.unshift(g); else items.push(g);
    }
    return items;
  }

  function withMeasures (items, M, outer) {
    var out = [];
    if (outer) M.forEach(function (m) { items.forEach(function (it) { out.push(Object.assign({}, it, { m: m })); }); });
    else items.forEach(function (it) { M.forEach(function (m) { out.push(Object.assign({}, it, { m: m })); }); });
    return out;
  }

  function subLabel (member) { return String(cfg.totals.subLabel || '{member} total').replace(/\{member\}/g, member); }

  function grandLabel (axis) { return axis === 'r' ? cfg.totals.rowGrandLabel : cfg.totals.colGrandLabel; }

  /**
   * Header cells of one axis, per level: { text, kind, style, span (levels),
   * count (items), i0, i1, toggle, fold, sortable, key }.
   */
  function headerLevels (items, n, axis, hasMeas, outerMeas, main) {
    var specs = [];
    if (hasMeas && outerMeas) specs.push({ kind: 'meas' });
    for (var i = 0; i < n; i++) specs.push({ kind: 'dim', i: i });
    if (hasMeas && !outerMeas) specs.push({ kind: 'meas' });
    if (!specs.length && axis === 'c') specs.push({ kind: 'mname' });
    var merge = cfg.headers.merge;
    var canFold = cfg.totals.collapsible;
    var grid = specs.map(function () { return []; });
    items.forEach(function (it, idx) {
      var pre = outerMeas && it.m ? it.m + '\u0004' : '';
      var k = it.path.length;
      specs.forEach(function (sp, li) {
        var d = null;
        if (sp.kind === 'meas') {
          d = { id: 'M|' + (outerMeas ? it.m : itemKey(it)), text: mName(it.m), kind: 'meas', style: 'meas' };
        } else if (sp.kind === 'mname') {
          d = { id: 'N', text: mName(main), kind: 'mname', style: 'inner' };
        } else {
          var di = sp.i;
          var style = di === n - 1 ? 'inner' : 'outer';
          if (it.type === 'grand') {
            if (di === 0) d = { id: pre + 'G', text: grandLabel(axis), kind: 'grand', style: 'total', span: n };
            else d = 'covered';
          } else if (it.type === 'sub' && di >= k) {
            d = di === k ? { id: pre + 'S|' + it.path.join(SEP), text: subLabel(it.path[k - 1]), kind: 'sub', style: 'total', span: n - k } : 'covered';
          } else if (it.type === 'folded' && di >= k - 1) {
            d = di === k - 1
              ? { id: pre + 'F|' + it.path.join(SEP), text: it.path[k - 1], kind: 'folded', style: 'outer', span: n - k + 1, toggle: 'closed', fold: axis + ':' + it.path.join(SEP), member: it.path[k - 1] }
              : 'covered';
          } else {
            var prefix = it.path.slice(0, di + 1).join(SEP);
            var id = pre + 'D' + di + '|' + (merge ? prefix : itemKey(Object.assign({}, it, { m: null })));
            if (di === n - 1) id = pre + 'D' + di + '|' + it.path.join(SEP);
            d = { id: id, text: it.path[di], kind: 'dim', style: style, member: it.path[di] };
            if (canFold && di < n - 1) { d.toggle = 'open'; d.fold = axis + ':' + prefix; }
          }
        }
        grid[li][idx] = d;
      });
    });
    // vertical spans → real level count (measure levels never span)
    var levels = specs.map(function () { return []; });
    specs.forEach(function (sp, li) {
      var cur = null;
      items.forEach(function (it, idx) {
        var d = grid[li][idx];
        if (d === 'covered' || d == null) { cur = null; return; }
        if (cur && cur.id === d.id) { cur.count++; cur.i1 = idx; return; }
        cur = Object.assign({ count: 1, i0: idx, i1: idx, level: li, axis: axis }, d);
        cur.span = d.span != null ? Math.max(1, d.span) : 1;
        levels[li].push(cur);
      });
    });
    levels.forEach(function (lv) {
      lv.forEach(function (c) {
        if (c.count === 1) { c.sortable = axis === 'c'; c.key = itemKey(items[c.i0]); }
      });
    });
    return { specs: specs, levels: levels };
  }

  /** Window-calculation direction for a metric. */
  function dirOf (metric) {
    var d = metric.dir;
    return !d || d === 'inherit' ? cfg.calc.direction : d;
  }

  var DIR_LABEL = { table: 'table', across: 'row', down: 'column', paneAcross: 'row (group)', paneDown: 'column (group)' };

  function buildModel () {
    var T = cfg.layout.transpose;
    var RF = T ? raw.colFields : raw.rowFields;
    var CF = T ? raw.rowFields : raw.colFields;
    var getR = T ? function (o) { return o.c; } : function (o) { return o.r; };
    var getC = T ? function (o) { return o.r; } : function (o) { return o.c; };
    var getRD = T ? function (o) { return o.cd; } : function (o) { return o.rd; };
    var getCD = T ? function (o) { return o.rd; } : function (o) { return o.cd; };
    var nR = RF.length; var nC = CF.length;
    var M = raw.measures.map(function (m) { return m.key; });
    var main = mainKey();
    var mode = cfg.layout.measures;
    if (mode !== 'columns' && mode !== 'rows') mode = 'cell';
    var outerMeas = cfg.measureHeader.position === 'outer';

    var store = aggregate(raw.rows, getR, getC, nR, nC);
    var accOf = function (R, C) { return store.get(pk(R, C)); };
    var value = function (R, C, m, isTotal) {
      var a = accOf(R, C);
      return a ? aggNum(a.v[m], aggOf(m), isTotal) : NaN;
    };

    // ---- trees + sorting
    var rTree = buildTree(raw.rows, getR, getRD, nR);
    var cTree = buildTree(raw.rows, getC, getCD, nC);
    // From → To matrices: the same members on both axes (missing ones show as empty cells)
    var sq = cfg.layout.square;
    if (sq === 'auto' && nR === 1 && nC === 1) {
      var rl = rTree.children.map(function (n) { return n.label; });
      var shared = cTree.children.filter(function (n) { return rl.indexOf(n.label) >= 0; }).length;
      sq = shared >= Math.max(2, Math.ceil(Math.min(rl.length, cTree.children.length) / 2)) ? 'on' : 'off';
    }
    if (sq === 'on' && nR === 1 && nC === 1) unionTrees(rTree, cTree);
    var S = cfg.sort;
    var cmpFor = function (how, axis, fields) {
      if (how === 'nameAsc' || how === 'nameDesc') return nameCmp(fields, how === 'nameDesc');
      if (how === 'totalDesc' || how === 'totalAsc') {
        return valueCmp(function (nd) { return axis === 'r' ? value(nd.path, [], main, true) : value([], nd.path, main, true); }, how === 'totalDesc');
      }
      // as in the data: members keep the order they first appear in (across all groups)
      return function () { return function (a, b) { return a.first - b.first; }; };
    };
    sortTree(cTree, cmpFor(S.cols, 'c', CF));
    var cols = flatten(cTree, nC, 'c');
    if (mode === 'columns') cols = withMeasures(cols, M, outerMeas);
    cols.forEach(function (c) { c.key = itemKey(c); });

    sortTree(rTree, cmpFor(S.rows, 'r', RF));
    var byCol = S.rowsByCol ? cols.find(function (c) { return c.key === S.rowsByCol; }) : null;
    if (byCol) {
      sortTree(rTree, valueCmp(function (nd) { return value(nd.path, byCol.path, byCol.m || main, true); }, S.rowsByDir !== 'asc'));
    }
    var rows = flatten(rTree, nR, 'r');
    if (mode === 'rows') rows = withMeasures(rows, M, outerMeas);
    rows.forEach(function (r) { r.key = itemKey(r); });

    // ---- cells
    var L = cfg.layout;
    var isAgg = function (it) { return it.type !== 'leaf'; };
    var isTot = function (it) { return it.type === 'sub' || it.type === 'grand'; };
    var makeCell = function (rit, cit, ri, ci) {
      var m = cit.m || rit.m || main;
      var agg = isAgg(rit) || isAgg(cit);
      var a = accOf(rit.path, cit.path);
      var c = { ri: ri, ci: ci, R: rit.path, C: cit.path, m: m, agg: agg, total: isTot(rit) || isTot(cit), empty: null, lines: [] };
      if (L.diagonal && nR && nC && rit.type === 'leaf' && cit.type === 'leaf' &&
          String(rit.path[nR - 1]) === String(cit.path[nC - 1])) {
        c.empty = 'diag';
        c.v = NaN;
        return c;
      }
      var an = a && a.v[m];
      c.v = a ? aggNum(an, aggOf(m), agg) : NaN;
      c.fv = an && an.n === 1 && !agg ? an.fv : null;
      if (!isFinite(c.v)) c.empty = 'null';
      c.k = a && a.k ? (agg ? (raw.color && raw.color.agg === 'avg' ? a.k.s / a.k.n : a.k.s) : a.k.s) : NaN;
      c.acc = a || null;
      return c;
    };
    var computeCells = function () {
      return rows.map(function (rit, ri) { return cols.map(function (cit, ci) { return makeCell(rit, cit, ri, ci); }); });
    };
    var cells = computeCells();

    // hide empty rows / columns (leaf rows only; totals stay)
    var allEmpty = function (list) {
      return list.every(function (c) { return c.empty === 'null' || c.empty === 'diag' || c.total; }) &&
        list.some(function (c) { return !c.total; });
    };
    var hideR = L.hideEmptyRows; var hideC = L.hideEmptyCols;
    if (hideR || hideC) {
      var keepR = rows.map(function (r, ri) { return !(hideR && r.type === 'leaf' && allEmpty(cells[ri])); });
      var keepC = cols.map(function (c, ci) { return !(hideC && c.type === 'leaf' && allEmpty(cells.map(function (row) { return row[ci]; }))); });
      rows = rows.filter(function (r, i) { return keepR[i]; });
      cols = cols.filter(function (c, i) { return keepC[i]; });
      cells = computeCells();
    }

    // ---- calculations
    var MT = cfg.metrics;
    var paneR = function (R) { return R.slice(0, Math.min(R.length, Math.max(0, nR - 1))); };
    var paneC = function (C) { return C.slice(0, Math.min(C.length, Math.max(0, nC - 1))); };
    var denom = function (c, dir) {
      switch (dir) {
        case 'across': return value(c.R, [], c.m, true);
        case 'down': return value([], c.C, c.m, true);
        case 'paneAcross': return value(c.R, paneC(c.C), c.m, true);
        case 'paneDown': return value(paneR(c.R), c.C, c.m, true);
        default: return value([], [], c.m, true);
      }
    };
    var pctDir = dirOf(MT.pct);
    cells.forEach(function (row) {
      row.forEach(function (c) {
        if (c.empty || aggOf(c.m) !== 'sum') return; // shares of averages, minimums or distinct counts don't add up to 100%
        var d = denom(c, pctDir);
        c.pct = d ? c.v / d : NaN;
        c.pctRow = (function (x) { return x ? c.v / x : NaN; })(value(c.R, [], c.m, true));
        c.pctCol = (function (x) { return x ? c.v / x : NaN; })(value([], c.C, c.m, true));
        c.pctAll = (function (x) { return x ? c.v / x : NaN; })(value([], [], c.m, true));
      });
    });

    var seqCache = {};
    var sequences = function (dir) {
      if (seqCache[dir]) return seqCache[dir];
      var groups = {};
      cells.forEach(function (row, ri) {
        row.forEach(function (c, ci) {
          if (c.total || c.empty === 'diag') return;
          var key;
          var ord;
          if (dir === 'across' || dir === 'paneAcross') { key = 'r' + ri + '|' + c.m + (dir === 'paneAcross' ? '|' + paneC(c.C).join(SEP) : ''); ord = ci; } else if (dir === 'down' || dir === 'paneDown') { key = 'c' + ci + '|' + c.m + (dir === 'paneDown' ? '|' + paneR(c.R).join(SEP) : ''); ord = ri; } else { key = c.m; ord = ri * 100000 + ci; }
          (groups[key] = groups[key] || []).push({ c: c, o: ord });
        });
      });
      var out = Object.keys(groups).map(function (k) {
        return groups[k].sort(function (a, b) { return a.o - b.o; }).map(function (x) { return x.c; });
      });
      seqCache[dir] = out;
      return out;
    };
    if (MT.diff.show || MT.pctDiff.show) {
      [['diff', MT.diff], ['pctDiff', MT.pctDiff]].forEach(function (p) {
        if (!p[1].show) return;
        sequences(dirOf(p[1])).forEach(function (seq) {
          seq.forEach(function (c, i) {
            if (i === 0 && p[1].vs === 'prev') { c[p[0]] = NaN; return; }
            var base = p[1].vs === 'first' ? seq[0].v : seq[i - 1].v;
            if (p[1].vs === 'first' && i === 0) { c[p[0]] = NaN; return; }
            c[p[0]] = p[0] === 'diff' ? c.v - base : (base ? (c.v - base) / Math.abs(base) : NaN);
          });
        });
      });
    }
    if (MT.running.show) {
      sequences(dirOf(MT.running)).forEach(function (seq) {
        var sum = 0;
        seq.forEach(function (c) { if (isFinite(c.v)) sum += c.v; c.running = c.empty ? NaN : sum; });
      });
    }
    if (MT.rank.show) {
      sequences(dirOf(MT.rank)).forEach(function (seq) {
        var vals = seq.filter(function (c) { return isFinite(c.v); }).map(function (c) { return c.v; });
        vals.sort(function (a, b) { return MT.rank.order === 'asc' ? a - b : b - a; });
        seq.forEach(function (c) { c.rank = isFinite(c.v) ? vals.indexOf(c.v) + 1 : NaN; c.rankOf = vals.length; });
      });
    }

    // ---- texts
    cells.forEach(function (row) { row.forEach(function (c) { cellTexts(c, mode, M, main); }); });

    // ---- colours
    colorCells(cells, value);

    var maxLines = 0;
    cells.forEach(function (row) { row.forEach(function (c) { if (!c.total && c.lines.length > maxLines) maxLines = c.lines.length; }); });
    var rowH = headerLevels(rows, nR, 'r', mode === 'rows' && cfg.measureHeader.show, outerMeas, main);
    var colH = headerLevels(cols, nC, 'c', mode === 'columns' && cfg.measureHeader.show, outerMeas, main);
    cols.forEach(function (c) {
      c.label = c.type === 'grand' ? grandLabel('c') : c.type === 'sub' ? subLabel(c.path[c.path.length - 1])
        : (c.path.length ? c.path.join(' › ') : mName(main));
      if (c.m && mode === 'columns') c.label += ' · ' + mName(c.m);
    });

    return {
      rows: rows, cols: cols, cells: cells, RF: RF, CF: CF, nR: nR, nC: nC, M: M, main: main, mode: mode, maxLines: maxLines,
      rowH: rowH, colH: colH, value: value, pctDir: pctDir
    };
  }

  // ---------------------------------------------------------------------------
  // Number formats + cell texts
  // ---------------------------------------------------------------------------
  function fmtOf (m, part) {
    var mc = Mx.measureCfg(cfg, m);
    if (mc.ownFmt) return mc.fmt;
    if (cfg.numbers.mode === 'each') return part === 'totals' ? cfg.totals.fmt : cfg.cells.fmt;
    return cfg.format;
  }

  function pctFmt (decimals, signed) {
    return Mx.merge(Mx.FORMAT, { scale: 'percent', pctFromRatio: true, decimals: decimals, unit: '', plusSign: !!signed, thousands: true });
  }

  function diffFmt (m, part) {
    if (cfg.numbers.mode === 'each' && !Mx.measureCfg(cfg, m).ownFmt) return cfg.metrics.diff.fmt;
    return Mx.merge(fmtOf(m, part), { plusSign: true });
  }

  function runningFmt (m, part) {
    if (cfg.numbers.mode === 'each' && !Mx.measureCfg(cfg, m).ownFmt) return cfg.metrics.running.fmt;
    return fmtOf(m, part);
  }

  function arrow (v, on) { return on && isFinite(v) && v !== 0 ? (v > 0 ? '▲ ' : '▼ ') : ''; }

  /** Main text + the small lines under it (other measures, % of total, difference, …). */
  function cellTexts (c, mode, M, main) {
    var L = cfg.layout;
    var MT = cfg.metrics;
    var part = c.total ? 'totals' : 'cells';
    if (c.empty === 'diag') { c.text = L.diagonalText; return; }
    if (c.empty === 'null') { c.text = L.nullText; }
    else if (c.v === 0 && L.zeroText) c.text = L.zeroText;
    else c.text = Mx.formatNumber(c.v, fmtOf(c.m, part), { fv: c.fv });
    c.fmt = fmtOf(c.m, part);
    var lines = [];
    var sc = MT.posColor; var nc = MT.negColor;
    (MT.order || []).forEach(function (kind) {
      if (kind === 'others') {
        if (mode !== 'cell' || !MT.others.show) return;
        M.forEach(function (k) {
          if (k === main) return;
          var a = c.acc && c.acc.v[k];
          var v = a ? aggNum(a, aggOf(k), c.agg) : NaN;
          if (!isFinite(v)) return;
          lines.push({ kind: 'other', m: k, v: v, label: MT.others.names ? mName(k) + ' ' : '', text: Mx.formatNumber(v, fmtOf(k, part), { fv: a.n === 1 && !c.agg ? a.fv : null }), fmt: fmtOf(k, part) });
        });
        return;
      }
      if (c.empty) return;
      var mt = MT[kind];
      if (!mt || !mt.show) return;
      if (c.total && !(kind === 'pct' && mt.onTotals)) return;
      var v = c[kind];
      if (!isFinite(v)) return;
      var ln = { kind: kind, v: v, label: mt.label || '' };
      if (kind === 'pct') { ln.fmt = pctFmt(mt.decimals); ln.text = Mx.formatNumber(v, ln.fmt); }
      else if (kind === 'diff') { ln.fmt = diffFmt(c.m, part); ln.text = arrow(v, mt.arrows) + Mx.formatNumber(v, ln.fmt, { signed: true }); if (mt.signColors && v) ln.color = v > 0 ? sc : nc; }
      else if (kind === 'pctDiff') { ln.fmt = pctFmt(mt.decimals, true); ln.text = arrow(v, mt.arrows) + Mx.formatNumber(v, ln.fmt, { signed: true }); if (mt.signColors && v) ln.color = v > 0 ? sc : nc; }
      else if (kind === 'running') { ln.fmt = runningFmt(c.m, part); ln.text = Mx.formatNumber(v, ln.fmt); }
      else if (kind === 'rank') { ln.text = String(v); ln.fmt = null; }
      lines.push(ln);
    });
    c.lines = lines;
    if (!MT.main.show && lines.length && !c.empty) c.hideMain = true;
  }

  // ---------------------------------------------------------------------------
  // Colours: heat map, diverging, data bars, rules
  // ---------------------------------------------------------------------------
  function colorValue (c, by, value) {
    if (by === '__pct') return c.pct;
    if (by === '__color') return c.k;
    if (by && by !== '__main') return value(c.R, c.C, by, c.agg);
    return c.v;
  }

  function ruleMatch (r, v) {
    var a = Number(r.value); var b = Number(r.value2);
    switch (r.op) {
      case '>': return v > a;
      case '>=': return v >= a;
      case '<': return v < a;
      case '<=': return v <= a;
      case '=': return v === a;
      case '!=': return v !== a;
      case 'between': return v >= Math.min(a, b) && v <= Math.max(a, b);
    }
    return false;
  }

  function colorCells (cells, value) {
    var C = cfg.colors;
    var by = C.by;
    if (by === '__auto') by = raw.color ? '__color' : '__main';
    if (by === '__color' && !raw.color) by = '__main';
    var groups = {};
    var flat = [];
    cells.forEach(function (row) { row.forEach(function (c) { flat.push(c); }); });
    if (C.mode !== 'none') {
      flat.forEach(function (c) {
        if (c.empty || (c.total && !C.includeTotals)) return;
        var v = colorValue(c, by, value);
        if (!isFinite(v)) return;
        c.cv = v;
        var g = (C.scope === 'row' ? 'r' + c.ri : C.scope === 'column' ? 'c' + c.ci : '') + '|' + (by === '__main' || by === '__pct' ? c.m : '') + (c.total ? '|t' : '');
        var s = groups[g] || (groups[g] = { mn: Infinity, mx: -Infinity, abs: 0 });
        if (v < s.mn) s.mn = v;
        if (v > s.mx) s.mx = v;
        if (Math.abs(v) > s.abs) s.abs = Math.abs(v);
        c.cg = s;
      });
      flat.forEach(function (c) {
        if (c.cv == null || !c.cg) return;
        var s = c.cg; var v = c.cv;
        if (C.mode === 'heat') {
          var t = s.mx > s.mn ? (v - s.mn) / (s.mx - s.mn) : 1;
          c.bg = Mx.mix(C.low, C.high, Math.max(0, Math.min(1, t)));
        } else if (C.mode === 'diverging') {
          var u = s.abs ? Math.abs(v) / s.abs : 0;
          c.bg = Mx.mix(C.mid, v < 0 ? C.neg : C.pos, u);
        } else if (C.mode === 'bars') {
          c.bar = s.abs ? Math.abs(v) / s.abs : 0;
          c.barNeg = v < 0;
        }
      });
    }
    var rules = (C.rules || []).map(Mx.ruleCfg);
    if (rules.length) {
      flat.forEach(function (c) {
        if (c.empty) return;
        for (var i = 0; i < rules.length; i++) {
          var r = rules[i];
          var v = r.on === 'pct' ? c.pct : r.on === 'diff' ? c.diff : c.v;
          if (isFinite(v) && ruleMatch(r, r.on === 'pct' ? v * 100 : v)) {
            if (Mx.normalizeHex(r.bg)) c.bg = Mx.normalizeHex(r.bg);
            if (Mx.normalizeHex(r.color)) c.fg = Mx.normalizeHex(r.color);
            if (r.bold) c.bold = true;
            c.rule = i;
            break;
          }
        }
      });
    }
    flat.forEach(function (c) {
      if (c.bg && !c.fg && C.autoText && Mx.luminance(c.bg) < 0.36) { c.fg = '#FFFFFF'; c.onDark = true; }
    });
  }

  // ---------------------------------------------------------------------------
  // Paint
  // ---------------------------------------------------------------------------
  function paint () {
    if (!cfg || !raw) return;
    var m;
    try {
      m = buildModel();
    } catch (e) {
      console.error('Matrix Table: could not build the matrix', e);
      showEmpty('Could not draw the matrix. See the console for details.');
      return;
    }
    model = m;
    if (!m.rows.length || !m.cols.length) {
      showEmpty('No values to show.');
      return;
    }
    el.card.classList.remove('is-empty');
    hideTooltip();
    paintCard();
    paintHeader();
    paintTools();
    drawTable(m);
  }

  function applyFont (node, f) {
    node.style.fontFamily = Mx.fontStack(f.font);
    node.style.fontSize = f.size + 'px';
    node.style.fontWeight = String(f.weight);
    node.style.fontStyle = f.italic ? 'italic' : 'normal';
    if (f.color) node.style.color = f.color;
  }

  function paintCard () {
    var c = cfg.card;
    el.card.style.padding = c.padding + 'px';
    el.card.style.backgroundColor = c.bgOpacity > 0 ? Mx.rgba(c.bgColor, c.bgOpacity / 100) : 'transparent';
    el.body.style.marginTop = c.gap + 'px';
    el.plot.style.backgroundColor = c.plotBgOpacity > 0 ? Mx.rgba(c.plotBg, c.plotBgOpacity / 100) : 'transparent';
  }

  function defaultTitle () {
    var m = raw.measures.map(function (x) { return mName(x.key); }).join(' & ');
    var by = raw.rowFields.concat(raw.colFields).map(function (f) { return f.name; });
    return by.length ? m + ' by ' + by.join(', ') : m;
  }

  function paintHeader () {
    var ic = cfg.icon;
    var showIcon = ic.show && (ic.source === 'builtin' || ic.dataUrl);
    el.card.classList.toggle('no-icon', !showIcon);
    el.icon.style.display = showIcon ? '' : 'none';
    el.icon.innerHTML = '';

    if (showIcon) {
      if (ic.source === 'builtin') {
        var r = Mx.iconHtml(ic.builtinId, ic.color, iconTarget());
        el.icon.innerHTML = r.html;
        setIconBox(r.w, r.h);
      } else {
        var img = new Image();
        img.alt = '';
        img.onload = function () { sizeImageIcon(img); };
        img.src = ic.dataUrl;
        el.icon.appendChild(img);
        if (img.complete) sizeImageIcon(img);
      }
    }

    var t = cfg.title;
    applyFont(el.title, t);
    el.title.textContent = t.text || defaultTitle();
    el.title.style.textAlign = t.align || 'left';
    el.title.style.display = t.show === false ? 'none' : '';

    var ex = cfg.explanation;
    var hasText = ex.show && !!ex.text;
    applyFont(el.explanation, ex);
    el.explanation.style.textAlign = t.align || 'left';
    el.explanation.textContent = hasText ? ex.text : ' ';
    el.explanation.style.display = hasText || ex.reserveSpace ? '' : 'none';

    var headVisible = showIcon || t.show !== false || hasText || ex.reserveSpace;
    el.card.classList.toggle('no-head', !headVisible);
    if (!headVisible) el.body.style.marginTop = '0px';
    updateIconSpan();
  }

  function sizeImageIcon (img) {
    var t = iconTarget();
    var w = img.naturalWidth || t;
    var h = img.naturalHeight || t;
    var W, H;
    if (w >= h) { W = t; H = Math.max(1, Math.round(t * h / w)); } else { H = t; W = Math.max(1, Math.round(t * w / h)); }
    img.style.width = W + 'px';
    img.style.height = H + 'px';
    setIconBox(W, H);
  }

  function iconTarget () {
    var n = Number(cfg.icon.size);
    return isFinite(n) && n > 0 ? Math.max(8, Math.min(128, n)) : 24;
  }

  var iconBoxH = 0;
  function setIconBox (w, h) {
    el.icon.style.width = w + 'px';
    el.icon.style.height = h + 'px';
    iconBoxH = h;
    updateIconSpan();
  }

  function updateIconSpan () {
    var head = el.icon.parentNode;
    var titleH = el.title.offsetHeight || 19;
    var hasExplanation = el.explanation.style.display !== 'none';
    head.classList.toggle('icon-span', hasExplanation && iconBoxH > titleH * 1.5);
  }

  function paintTools () {
    var mode = cfg.export.button;
    el.tools.style.display = mode === 'never' ? 'none' : '';
    el.card.classList.toggle('tools-hover', mode === 'hover');
    el.card.classList.toggle('tools-always', mode === 'always');
  }

  // ---------------------------------------------------------------------------
  // Table
  // ---------------------------------------------------------------------------
  function esc (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function textCss (s) {
    return 'font-family:' + Mx.fontStack(s.font) + ';font-size:' + s.size + 'px;font-weight:' + s.weight +
      ';font-style:' + (s.italic ? 'italic' : 'normal') + ';color:' + s.color +
      (s.upper != null ? ';text-transform:' + (s.upper ? 'uppercase' : 'none') : '') +
      (s.letterSpacing ? ';letter-spacing:' + (s.letterSpacing / 100) + 'em' : '');
  }

  function solidBg () {
    var H = cfg.headers; var c = cfg.card;
    if (H.bgOpacity >= 100) return H.bg;
    if (c.plotBgOpacity >= 100) return c.plotBg;
    if (c.bgOpacity >= 100) return c.bgColor;
    return '#FFFFFF';
  }

  function css () {
    var L = cfg.layout; var C = cfg.cells; var H = cfg.headers; var T = cfg.totals; var MT = cfg.metrics;
    var V = { top: 'top', middle: 'middle', bottom: 'bottom' };
    var bd = C.border ? C.borderWidth + 'px ' + C.borderStyle + ' ' + C.borderColor : '0';
    var hb = H.bgOpacity > 0 ? Mx.rgba(H.bg, H.bgOpacity / 100) : 'transparent';
    var s = [];
    s.push('.mx{border-spacing:' + L.gapX + 'px ' + L.gapY + 'px;font-family:' + Mx.fontStack(cfg.numbers.font) + '}');
    s.push('.mx td.c{background:' + (C.bgOpacity > 0 ? Mx.rgba(C.bg, C.bgOpacity / 100) : 'transparent') + ';border:' + bd +
      ';border-radius:' + C.radius + 'px;padding:' + C.padY + 'px ' + C.padX + 'px;text-align:' + C.hAlign + ';vertical-align:' + V[C.vAlign] + '}');
    s.push('.mx td.c .mv{' + textCss(C.main) + '}');
    s.push('.mx td.c .ms{font-size:' + C.secondary.size + 'px;font-weight:' + C.secondary.weight + ';color:' + C.secondary.color +
      ';opacity:' + (C.secondary.opacity / 100) + ';font-style:' + (C.secondary.italic ? 'italic' : 'normal') + '}');
    s.push('.mx td.c.on-dark .mv,.mx td.c.on-dark .ms{color:inherit}');
    s.push('.mx td.c.e{background:' + (L.emptyStyle === 'tile' ? C.emptyBg : 'transparent') + ';border:' +
      (L.emptyStyle === 'tile' ? '1px ' + C.emptyBorderStyle + ' ' + C.emptyBorder : '0') + ';color:' + C.emptyColor + ';font-size:' + C.emptySize + 'px}');
    s.push('.mx td.c .ev{justify-content:' + ({ left: 'flex-start', right: 'flex-end' }[C.hAlign] || 'center') + ';padding:0 ' + C.padX + 'px}');
    s.push('.mx td.c.t{' + (T.tile ? 'background:' + T.bg + ';' : 'background:transparent;border-color:transparent;') + '}');
    s.push('.mx td.c.t .mv{' + textCss(T.value) + '}');
    if (L.banding) s.push('.mx tr.band td.c:not(.t):not(.e){background-color:' + L.bandColor + '}');
    s.push('.mx th{background:' + hb + ';white-space:' + (H.wrap ? 'normal' : 'nowrap') + '}');
    s.push('.mx th.ch{' + textCss(H.col) + ';vertical-align:' + V[H.colVAlign] + ';text-align:' + H.colAlign + '}');
    s.push('.mx th.ch.o{' + textCss(H.colOuter) + ';text-align:' + H.colOuterAlign + '}');
    s.push('.mx th.rh{' + textCss(H.row) + ';vertical-align:' + V[H.rowVAlign] + ';text-align:' + H.rowAlign + '}');
    s.push('.mx th.rh.o{' + textCss(H.rowOuter) + ';vertical-align:' + V[H.rowOuterVAlign] + ';text-align:' + H.rowOuterAlign + '}');
    s.push('.mx th.t{' + textCss(T.label) + '}');
    s.push('.mx th.k{' + textCss(H.cornerStyle) + ';vertical-align:bottom;text-align:left}');
    if (H.lines) s.push('.mx th.rh.o{border-top:1px solid ' + H.lineColor + '}.mx th.ch.o{border-bottom:1px solid ' + H.lineColor + '}');
    if (L.freeze) {
      s.push('.mx thead th,.mx th.rh{position:sticky}.mx thead th{z-index:2}.mx th.rh{z-index:1}.mx thead th.k{z-index:3}');
      var sb = H.bgOpacity >= 100 ? H.bg : solidBg();
      // the shifted shadows fill the spacing gaps, so scrolled cells don't show between frozen headers
      s.push('.mx thead th,.mx th.rh{background:' + sb + '}');
      s.push('.mx thead th{box-shadow:0 ' + L.gapY + 'px 0 0 ' + sb + ',0 -' + L.gapY + 'px 0 0 ' + sb + ',' + L.gapX + 'px 0 0 0 ' + sb + '}');
      s.push('.mx th.rh{box-shadow:' + L.gapX + 'px 0 0 0 ' + sb + ',-' + L.gapX + 'px 0 0 0 ' + sb + ',0 ' + L.gapY + 'px 0 0 ' + sb + '}');
      s.push('.mx th.rh.o .hl,.mx th.rh[rowspan] .hl{position:sticky;top:calc(var(--thead-h, 0px) + ' + (L.gapY + 4) + 'px)}');
    }
    s.push('.mx td.c .ms .up{color:' + MT.posColor + '}');
    s.push('.mx.xh td.c.is-x{box-shadow:inset 0 0 0 999px ' + Mx.rgba(cfg.interaction.crosshairColor, 0.07) + '}');
    s.push('.mx.xh td.c.is-hot{outline:2px solid ' + cfg.interaction.crosshairColor + ';outline-offset:-1px}');
    s.push('.mx.xh th.is-hot{color:' + cfg.interaction.crosshairColor + ' !important}');
    return s.join('\n');
  }

  function orientClass (o) { return o === 'up' ? ' v-up' : o === 'down' ? ' v-down' : ''; }

  function memberColor (text) {
    var mc = cfg.headers.memberColors || {};
    return mc[text] ? ';color:' + mc[text] : '';
  }

  function headerHtml (c, axis, m) {
    var H = cfg.headers;
    var outer = c.style === 'outer';
    var cls = axis === 'c' ? 'ch' : 'rh';
    if (outer) cls += ' o';
    if (c.style === 'total') cls += ' t';
    if (c.kind === 'meas') cls += ' ms-h';
    var orient = axis === 'c' ? (outer ? H.colOuterOrient : H.colOrient) : (outer ? H.rowOuterOrient : H.rowOrient);
    var span = axis === 'c'
      ? (c.count > 1 ? ' colspan="' + c.count + '"' : '') + (c.span > 1 ? ' rowspan="' + c.span + '"' : '')
      : (c.count > 1 ? ' rowspan="' + c.count + '"' : '') + (c.span > 1 ? ' colspan="' + c.span + '"' : '');
    var tg = c.toggle ? '<span class="tg" data-fold="' + esc(c.fold) + '" title="' + (c.toggle === 'open' ? 'Fold into its total' : 'Unfold') + '">' + (c.toggle === 'open' ? '▾' : '▸') + '</span>' : '';
    var sort = '';
    if (axis === 'c' && c.sortable && cfg.sort.rowsByCol && cfg.sort.rowsByCol === c.key) sort = '<span class="so">' + (cfg.sort.rowsByDir === 'asc' ? '▲' : '▼') + '</span>';
    var style = c.member != null ? memberColor(c.member) : '';
    return '<th class="' + cls + '"' + span + ' data-axis="' + axis + '" data-i0="' + c.i0 + '" data-i1="' + c.i1 + '" data-lv="' + c.level + '"' +
      (c.sortable ? ' data-key="' + esc(c.key) + '"' : '') + (style ? ' style="' + style.slice(1) + '"' : '') + '>' +
      '<span class="hl' + orientClass(orient) + '">' + tg + '<span class="tx">' + esc(c.text) + '</span>' + sort + '</span></th>';
  }

  function cellHtml (c) {
    var cls = 'c';
    if (c.total) cls += ' t';
    if (c.empty) cls += ' e';
    if (c.onDark) cls += ' on-dark';
    var st = '';
    if (c.bg) st += 'background-color:' + c.bg + ';' + (cfg.cells.border ? 'border-color:' + Mx.mix(c.bg, '#000000', 0.06) + ';' : '');
    if (c.fg) st += 'color:' + c.fg + ';';
    var inner;
    if (c.empty) {
      // invisible stand-ins keep the row as tall as rows with values; the text sits centred over them
      inner = '<div class="ev">' + esc(c.text) + '</div><div class="mv ph">&nbsp;</div>';
      if (model && model.maxLines && cfg.metrics.layout !== 'right') inner += '<div class="ms ph">' + new Array(model.maxLines + 1).join('<span class="ln">&nbsp;</span>') + '</div>';
    } else {
      var mv = c.hideMain ? '' : '<div class="mv"' + (c.fg ? ' style="color:' + c.fg + (c.bold ? ';font-weight:800' : '') + '"' : (c.bold ? ' style="font-weight:800"' : '')) + '>' + esc(c.text) + '</div>';
      var right = cfg.metrics.layout === 'right';
      var lines = c.lines.map(function (l) {
        return '<span class="ln ln-' + l.kind + '"' + (l.color && !c.onDark ? ' style="color:' + l.color + '"' : '') + '>' +
          (l.label ? '<span class="lb">' + esc(l.label) + '</span>' : '') + esc(l.text) + '</span>';
      });
      var ms = lines.length ? '<div class="ms' + (right ? ' ms-r' : '') + '"' + (c.fg ? ' style="color:' + c.fg + '"' : '') + '>' +
        lines.join(right ? '<span class="sep">' + esc(cfg.metrics.sep) + '</span>' : '') + '</div>' : '';
      inner = right && ms ? '<div class="row-r">' + mv + ms + '</div>' : mv + ms;
      if (c.bar != null) {
        inner += '<span class="bar" style="width:' + Math.round(c.bar * 100) + '%;background:' + (c.barNeg ? cfg.colors.neg : cfg.colors.barColor) +
          ';opacity:' + (cfg.colors.barOpacity / 100) + '"></span>';
      }
    }
    return '<td class="' + cls + '" data-ri="' + c.ri + '" data-ci="' + c.ci + '"' + (st ? ' style="' + st + '"' : '') + '>' + inner + '</td>';
  }

  function cornerHtml (m, nRowCols, nHeadRows) {
    var H = cfg.headers;
    if (!nRowCols || !nHeadRows) return [];
    var out = [];
    if (H.corner === 'fields') {
      var names = m.rowH.specs.map(function (sp) { return sp.kind === 'dim' ? m.RF[sp.i].name : sp.kind === 'meas' ? 'Measure' : ''; });
      if (nHeadRows > 1) out.push({ row: 0, html: '<th class="k" colspan="' + nRowCols + '" rowspan="' + (nHeadRows - 1) + '"></th>' });
      out.push({ row: nHeadRows - 1, html: names.map(function (n) { return '<th class="k">' + esc(n) + '</th>'; }).join('') });
    } else {
      var text = H.corner === 'custom' ? H.cornerText : '';
      out.push({ row: 0, html: '<th class="k" colspan="' + nRowCols + '" rowspan="' + nHeadRows + '">' + esc(text) + '</th>' });
    }
    return out;
  }

  function drawTable (m) {
    var L = cfg.layout;
    var nRowCols = m.rowH.levels.length;
    var nHeadRows = m.colH.levels.length;
    var parts = [];
    parts.push('<style>' + css() + '</style>');
    parts.push('<table class="mx' + (cfg.interaction.crosshair ? ' xh' : '') + '" id="grid"><colgroup>');
    for (var i = 0; i < nRowCols; i++) parts.push('<col class="cr"' + (L.rowHeaderPx > 0 ? ' style="width:' + L.rowHeaderPx + 'px"' : '') + '>');
    m.cols.forEach(function () { parts.push('<col class="cd">'); });
    parts.push('</colgroup><thead>');
    var corners = cornerHtml(m, nRowCols, nHeadRows);
    m.colH.levels.forEach(function (lv, li) {
      parts.push('<tr class="hr">');
      corners.forEach(function (k) { if (k.row === li) parts.push(k.html); });
      lv.forEach(function (c) { parts.push(headerHtml(c, 'c', m)); });
      parts.push('</tr>');
    });
    parts.push('</thead><tbody>');
    var starts = m.rowH.levels.map(function (lv) {
      var o = {};
      lv.forEach(function (c) { o[c.i0] = c; });
      return o;
    });
    var leafN = 0;
    m.rows.forEach(function (r, ri) {
      var band = L.banding && r.type === 'leaf' && (leafN++ % 2 === 1);
      parts.push('<tr data-ri="' + ri + '" class="' + (r.type === 'leaf' ? 'lr' : 'tr-' + r.type) + (band ? ' band' : '') + '"' +
        (L.rowHeight === 'fixed' ? ' style="height:' + L.rowPx + 'px"' : '') + '>');
      starts.forEach(function (o) { if (o[ri]) parts.push(headerHtml(o[ri], 'r', m)); });
      m.cells[ri].forEach(function (c) { parts.push(cellHtml(c)); });
      parts.push('</tr>');
    });
    parts.push('</tbody></table>');
    el.scroll.innerHTML = parts.join('');
    el.table = el.scroll.querySelector('table');
    layoutTable(m, nRowCols);
    collectHot();
  }

  /** Column widths (fit / fixed) and sticky offsets. */
  function layoutTable (m, nRowCols) {
    var L = cfg.layout;
    var t = el.table;
    var cols = t.querySelectorAll('col.cd');
    var nData = cols.length;
    if (L.colWidth === 'fixed') {
      Array.prototype.forEach.call(cols, function (c) { c.style.width = L.colPx + 'px'; });
      t.style.width = 'auto';
    } else if (L.colWidth === 'fit') {
      Array.prototype.forEach.call(cols, function (c) { c.style.width = L.minColPx + 'px'; });
      t.style.width = 'auto';
      var first = t.querySelector('tbody td.c');
      var rh = first ? first.offsetLeft : 0;
      var avail = el.scroll.clientWidth;
      var room = avail - rh - nData * L.gapX;
      var w = Math.floor(room / Math.max(1, nData));
      if (L.colMax > 0) w = Math.min(w, L.colMax);
      if (w > L.minColPx) {
        // spread the pixels left over by rounding, so the matrix ends exactly at the right edge
        var spare = L.colMax > 0 && w === L.colMax ? 0 : Math.max(0, room - w * nData);
        Array.prototype.forEach.call(cols, function (c, i) { c.style.width = (w + (i < spare ? 1 : 0)) + 'px'; });
      }
    } else {
      t.style.width = 'auto';
    }
    if (L.fillHeight && L.rowHeight !== 'fixed') fillHeight(t);
    if (L.freeze) {
      var gy = L.gapY; var gx = L.gapX;
      t.style.setProperty('--thead-h', (t.tHead ? t.tHead.offsetHeight : 0) + 'px');
      Array.prototype.forEach.call(t.tHead.rows, function (tr) {
        var top = Math.max(0, tr.offsetTop - gy);
        Array.prototype.forEach.call(tr.cells, function (th) { th.style.top = top + 'px'; });
      });
      Array.prototype.forEach.call(t.querySelectorAll('th.rh, thead th.k'), function (th) {
        th.style.left = Math.max(0, th.offsetLeft - gx) + 'px';
      });
    }
  }

  /** Rows grow evenly (totals keep their height) so the matrix reaches the bottom of the worksheet. */
  function fillHeight (t) {
    var extra = Math.floor(el.scroll.clientHeight - t.getBoundingClientRect().height);
    if (extra < 2) return;
    var rows = Array.prototype.slice.call(t.tBodies[0].rows);
    var grow = rows.filter(function (tr) { return !/\btr-(sub|grand)\b/.test(tr.className); });
    if (!grow.length) grow = rows;
    var hs = grow.map(function (tr) { return tr.getBoundingClientRect().height; });
    var each = Math.floor(extra / grow.length);
    var spare = extra - each * grow.length;
    grow.forEach(function (tr, i) { tr.style.height = (hs[i] + each + (i < spare ? 1 : 0)) + 'px'; });
  }

  // ---------------------------------------------------------------------------
  // Hover: crosshair + tooltip
  // ---------------------------------------------------------------------------
  var hot = { heads: [], on: [] };

  function collectHot () {
    hot.heads = Array.prototype.map.call(el.table.querySelectorAll('th[data-axis]'), function (th) {
      return { el: th, axis: th.getAttribute('data-axis'), i0: Number(th.getAttribute('data-i0')), i1: Number(th.getAttribute('data-i1')) };
    });
    hot.on = [];
    state.hover = null;
  }

  function setHover (pos) {
    if (!cfg || !cfg.interaction.crosshair || !el.table) return;
    var k = pos ? pos.ri + ',' + pos.ci : null;
    if (state.hover === k) return;
    state.hover = k;
    hot.on.forEach(function (n) { n.classList.remove('is-x', 'is-hot'); });
    hot.on = [];
    if (!pos) return;
    var add = function (n, c) { n.classList.add(c); hot.on.push(n); };
    var tr = el.table.tBodies[0].rows[pos.ri];
    if (tr) Array.prototype.forEach.call(tr.querySelectorAll('td.c'), function (td) { add(td, 'is-x'); });
    Array.prototype.forEach.call(el.table.querySelectorAll('td.c[data-ci="' + pos.ci + '"]'), function (td) { add(td, 'is-x'); });
    var me = el.table.querySelector('td.c[data-ri="' + pos.ri + '"][data-ci="' + pos.ci + '"]');
    if (me) add(me, 'is-hot');
    hot.heads.forEach(function (h) {
      var i = h.axis === 'r' ? pos.ri : pos.ci;
      if (i >= h.i0 && i <= h.i1) add(h.el, 'is-hot');
    });
  }

  function cellFromEvent (e) {
    var td = e.target.closest ? e.target.closest('td.c') : null;
    if (!td || !model) return null;
    var ri = Number(td.getAttribute('data-ri')); var ci = Number(td.getAttribute('data-ci'));
    var c = model.cells[ri] && model.cells[ri][ci];
    return c ? { c: c, td: td, ri: ri, ci: ci } : null;
  }

  function headFromEvent (e) {
    var th = e.target.closest ? e.target.closest('th[data-axis]') : null;
    if (!th || !model) return null;
    var axis = th.getAttribute('data-axis');
    var lv = Number(th.getAttribute('data-lv')); var i0 = Number(th.getAttribute('data-i0'));
    var levels = axis === 'c' ? model.colH.levels : model.rowH.levels;
    var h = (levels[lv] || []).find(function (x) { return x.i0 === i0; });
    return h ? { h: h, th: th, axis: axis } : null;
  }

  function onHover (e) {
    if (!cfg || el.menu.style.display === 'block') return;
    var d = cellFromEvent(e);
    if (!d) { hideTooltip(); setHover(null); return; }
    setHover({ ri: d.ri, ci: d.ci });
    if (!cfg.tooltip.show) return;
    showTooltip(d.c, e.clientX, e.clientY);
  }

  function pathText (axis, it) {
    if (!it) return '';
    if (it.type === 'grand') return grandLabel(axis);
    if (it.type === 'sub') return it.path.slice(0, -1).concat([subLabel(it.path[it.path.length - 1])]).join(' › ');
    return it.path.join(' › ');
  }

  /** Tooltip numbers: no K / M / B, whole numbers without decimals. */
  function fullFmt (f, v) {
    if (cfg.tooltip.fullNumbers && Math.round(v) === v && f.scale !== 'percent' && f.scale !== 'percentDynamic') return Mx.merge(f, { decimals: 0 });
    return f;
  }

  function full (v, m, fv) {
    return Mx.formatNumber(v, fullFmt(fmtOf(m, 'cells'), v), { full: cfg.tooltip.fullNumbers, fv: fv });
  }

  function showTooltip (c, x, y) {
    var tt = el.tooltip;
    var TT = cfg.tooltip;
    var rit = model.rows[c.ri]; var cit = model.cols[c.ci];
    var h = [];
    var rp = pathText('r', rit); var cp = pathText('c', cit);
    var RF = model.RF; var CF = model.CF;
    if (rp) h.push('<div class="tt-path">' + esc(RF.length ? RF.map(function (f) { return f.name; }).join(' › ') : '') + '</div><div class="tt-name">' + esc(rp) + '</div>');
    if (cp) h.push('<div class="tt-path">' + esc(CF.length ? CF.map(function (f) { return f.name; }).join(' › ') : '') + '</div><div class="tt-name">' + esc(cp) + '</div>');
    if (c.empty === 'diag') {
      h.push('<div class="tt-note">Same member on row and column</div>');
    } else if (c.empty) {
      h.push('<div class="tt-note">No data</div>');
    } else {
      h.push('<div class="tt-series">' + esc(mName(c.m)) + '</div><div class="tt-value">' + esc(full(c.v, c.m, c.fv)) + '</div>');
    }
    var rowsHtml = [];
    if (!c.empty && TT.showAll) {
      model.M.forEach(function (k) {
        if (k === c.m) return;
        var a = c.acc && c.acc.v[k];
        var v = a ? aggNum(a, aggOf(k), c.agg) : NaN;
        rowsHtml.push(ttRow(mName(k), isFinite(v) ? full(v, k, a && a.n === 1 && !c.agg ? a.fv : null) : '—'));
      });
    }
    if (!c.empty && TT.showPct) {
      var pf = pctFmt(Math.max(1, cfg.metrics.pct.decimals));
      rowsHtml.push(ttRow('% of row', Mx.formatNumber(c.pctRow, pf)));
      rowsHtml.push(ttRow('% of column', Mx.formatNumber(c.pctCol, pf)));
      rowsHtml.push(ttRow('% of table', Mx.formatNumber(c.pctAll, pf)));
    }
    if (!c.empty) {
      c.lines.forEach(function (l) {
        if (l.kind === 'other' || l.kind === 'pct') return;
        var nm = { diff: 'Difference', pctDiff: '% difference', running: 'Running total', rank: 'Rank' }[l.kind];
        rowsHtml.push(ttRow(nm, l.kind === 'rank' ? l.text + ' of ' + c.rankOf : l.text));
      });
      if (cfg.metrics.pct.show && TT.showPct && ['table', 'across', 'down'].indexOf(model.pctDir) < 0) {
        rowsHtml.push(ttRow('% of ' + DIR_LABEL[model.pctDir], Mx.formatNumber(c.pct, pctFmt(Math.max(1, cfg.metrics.pct.decimals)))));
      }
    }
    if (!c.empty && raw.color && isFinite(c.k)) rowsHtml.push(ttRow(raw.color.name, Mx.formatNumber(c.k, fullFmt(cfg.format, c.k), { full: TT.fullNumbers })));
    if (!c.empty && TT.showExtra && c.acc) {
      raw.extras.forEach(function (x) {
        var v = aggNum(c.acc.x[x.key], x.agg, c.agg);
        if (isFinite(v)) rowsHtml.push(ttRow(x.name, Mx.formatNumber(v, fullFmt(cfg.format, v), { full: TT.fullNumbers })));
      });
    }
    if (rowsHtml.length) h.push('<div class="tt-rows">' + rowsHtml.join('') + '</div>');
    tt.innerHTML = h.join('');
    tt.style.fontFamily = Mx.fontStack(cfg.numbers.font);
    tt.style.display = 'block';
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    var tw = tt.offsetWidth;
    var th = tt.offsetHeight;
    var left = Math.min(Math.max(4, x + 14), vw - tw - 4);
    var top = y - th - 12;
    if (top < 4) top = Math.min(y + 18, vh - th - 4);
    tt.style.left = left + 'px';
    tt.style.top = Math.max(4, top) + 'px';
  }

  function ttRow (name, val) {
    return '<div class="tt-row"><span class="nm">' + esc(name) + '</span><span class="vl">' + esc(val) + '</span></div>';
  }

  function hideTooltip () { if (el.tooltip) el.tooltip.style.display = 'none'; }

  // ---------------------------------------------------------------------------
  // Clicks
  // ---------------------------------------------------------------------------
  function onClick (e) {
    if (!model) return;
    var fold = e.target.closest && e.target.closest('[data-fold]');
    if (fold) { toggleFold(fold.getAttribute('data-fold')); return; }
    var hd = headFromEvent(e);
    if (hd) {
      if (hd.h.toggle && hd.h.fold && hd.h.kind === 'folded') { toggleFold(hd.h.fold); return; }
      if (hd.axis === 'c' && hd.h.sortable && cfg.interaction.headerSort && hd.h.level === model.colH.levels.length - 1 - (hd.h.span - 1)) {
        cycleSort(hd.h.key);
      }
      return;
    }
    var d = cellFromEvent(e);
    if (d && cfg.interaction.selectInTableau) selectInTableau(d.c);
  }

  function onDblClick (e) {
    if (!cfg || cfg.interaction.dblclick !== 'format') return;
    if (e.target.closest && e.target.closest('[data-fold]')) return;
    var hd = headFromEvent(e);
    if (hd) { openDialog({ tab: hd.h.style === 'total' ? 'totals' : 'headers', member: hd.h.member }); return; }
    var d = cellFromEvent(e);
    if (d) openDialog({ tab: d.c.total ? 'totals' : 'cells' });
  }

  function toggleFold (key) {
    if (state.folded[key]) delete state.folded[key]; else state.folded[key] = true;
    paint();
  }

  function foldAll (axis, on) {
    var n = axis === 'r' ? model.nR : model.nC;
    if (n < 2) return;
    if (!on) {
      Object.keys(state.folded).forEach(function (k) { if (k.indexOf(axis + ':') === 0) delete state.folded[k]; });
    } else {
      var list = axis === 'r' ? (cfg.layout.transpose ? raw.colValues : raw.rowValues) : (cfg.layout.transpose ? raw.rowValues : raw.colValues);
      // fold every top-level member
      (list[0] || []).forEach(function (v) { state.folded[axis + ':' + v] = true; });
    }
    paint();
  }

  function cycleSort (key) {
    setSaved(function (c) {
      if (c.sort.rowsByCol !== key) { c.sort.rowsByCol = key; c.sort.rowsByDir = 'desc'; } else if (c.sort.rowsByDir === 'desc') c.sort.rowsByDir = 'asc';
      else { c.sort.rowsByCol = ''; c.sort.rowsByDir = 'desc'; }
    });
  }

  function selectInTableau (c) {
    var sel = [];
    var RF = model.RF; var CF = model.CF;
    RF.forEach(function (f, i) { if (c.R[i] != null) sel.push({ fieldName: cleanPill(f.key), value: [c.R[i]] }); });
    CF.forEach(function (f, i) { if (c.C[i] != null) sel.push({ fieldName: cleanPill(f.key), value: [c.C[i]] }); });
    if (!sel.length) return;
    try {
      worksheet.selectMarksByValueAsync(sel, tableau.SelectionUpdateType.Replace).catch(function (err) { console.info('Matrix Table: selection not applied', err && err.message); });
    } catch (e) { /* ignore */ }
  }

  function cleanPill (name) { var s = String(name); var i = s.indexOf('//'); return i >= 0 ? s.slice(0, i) : s; }

  /** Changes a saved setting from the chart (works while authoring; viewers keep it for the session). */
  function setSaved (fn) {
    var c = Mx.read();
    fn(c);
    fn(cfg);
    paint();
    try {
      Mx.write(c).catch(function (err) { console.info('Matrix Table: setting kept for this session only', err && err.message); });
    } catch (e) { /* read-only */ }
  }

  // ---------------------------------------------------------------------------
  // Right-click menu + export menu
  // ---------------------------------------------------------------------------
  function exportItems () {
    return [
      { head: 'Export' },
      ['Excel — as shown (.xlsx)', function () { exportXlsx('visual'); }],
      ['Excel — data only (.xlsx)', function () { exportXlsx('data'); }],
      ['CSV — data (.csv)', function () { exportCsv('data'); }],
      ['CSV — crosstab as shown (.csv)', function () { exportCsv('crosstab'); }],
      null,
      ['Copy table (paste into Excel)', copyTable]
    ];
  }

  function check (on, text) { return (on ? '✓ ' : '  ') + text; }

  function onContextMenu (e) {
    if (!cfg || !cfg.interaction.rightClickMenu) return;
    e.preventDefault();
    hideTooltip();
    var items = [];
    var d = cellFromEvent(e);
    var hd = d ? null : headFromEvent(e);
    if (d) {
      var c = d.c;
      items.push({ head: [pathText('r', model.rows[c.ri]), pathText('c', model.cols[c.ci])].filter(Boolean).join('  ×  ') });
      if (!c.empty) items.push(['Copy value', function () { copyPlain(Mx.formatNumber(c.v, fmtOf(c.m, 'cells'), { full: true, fv: c.fv }), 'Value copied'); }]);
      items.push([c.total ? 'Format totals…' : 'Format cells…', function () { openDialog({ tab: c.total ? 'totals' : 'cells' }); }]);
    }
    if (hd) {
      var h = hd.h;
      items.push({ head: h.text });
      if (h.fold) items.push([h.toggle === 'open' ? 'Fold “' + h.text + '” into its total' : 'Unfold “' + h.text + '”', function () { toggleFold(h.fold); }]);
      if (hd.axis === 'c' && h.sortable) {
        var on = cfg.sort.rowsByCol === h.key;
        items.push([check(on && cfg.sort.rowsByDir === 'desc', 'Sort rows by this column, high to low'), function () { setSaved(function (x) { x.sort.rowsByCol = h.key; x.sort.rowsByDir = 'desc'; }); }]);
        items.push([check(on && cfg.sort.rowsByDir === 'asc', 'Sort rows by this column, low to high'), function () { setSaved(function (x) { x.sort.rowsByCol = h.key; x.sort.rowsByDir = 'asc'; }); }]);
        if (on) items.push(['Clear sort', function () { setSaved(function (x) { x.sort.rowsByCol = ''; }); }]);
      }
      if (h.member != null) items.push(['Header colour for “' + h.text + '”…', function () { openDialog({ tab: 'headers', member: h.member }); }]);
      items.push(['Format headers…', function () { openDialog({ tab: 'headers' }); }]);
    }
    if (model.nR > 1 && cfg.totals.collapsible) items.push(null, ['Fold all rows', function () { foldAll('r', true); }], ['Unfold all rows', function () { foldAll('r', false); }]);
    if (model.nC > 1 && cfg.totals.collapsible) items.push(['Fold all columns', function () { foldAll('c', true); }], ['Unfold all columns', function () { foldAll('c', false); }]);

    var P = cfg.metrics.pct;
    var dir = dirOf(P);
    items.push(null, { head: '% of total' });
    items.push([check(P.show, 'Show % of total'), function () { setSaved(function (x) { x.metrics.pct.show = !x.metrics.pct.show; }); }]);
    [['table', 'of the table'], ['across', 'of each row'], ['down', 'of each column']].forEach(function (o) {
      items.push([check(P.show && dir === o[0], 'Compute ' + o[1]), function () {
        setSaved(function (x) { x.metrics.pct.show = true; x.metrics.pct.dir = 'inherit'; x.calc.direction = o[0]; });
      }]);
    });
    items.push(null);
    items.push([check(cfg.totals.rowGrand, 'Total row'), function () { setSaved(function (x) { x.totals.rowGrand = !x.totals.rowGrand; }); }]);
    items.push([check(cfg.totals.colGrand, 'Total column'), function () { setSaved(function (x) { x.totals.colGrand = !x.totals.colGrand; }); }]);
    items.push([check(cfg.layout.transpose, 'Swap rows and columns'), function () { state.folded = {}; setSaved(function (x) { x.layout.transpose = !x.layout.transpose; x.sort.rowsByCol = ''; }); }]);
    items.push(null);
    items = items.concat(exportItems().slice(1));
    items.push(null,
      ['Layout…', function () { openDialog({ tab: 'layout' }); }],
      ['Calculations…', function () { openDialog({ tab: 'calc' }); }],
      ['Colors…', function () { openDialog({ tab: 'colors' }); }],
      null,
      ['Format extension…', function () { openDialog(null); }]);
    showMenu(items, e.clientX, e.clientY);
  }

  function showMenu (items, x, y, alignRight) {
    var m = el.menu;
    m.innerHTML = '';
    var prevSep = true;
    items.forEach(function (it, i) {
      if (!it) {
        var nextReal = items.slice(i + 1).some(Boolean);
        if (!prevSep && nextReal) m.appendChild(document.createElement('hr'));
        prevSep = true; return;
      }
      prevSep = false;
      if (it.head) { var hd = document.createElement('div'); hd.className = 'menu-head'; hd.textContent = it.head; m.appendChild(hd); return; }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = it[0];
      btn.addEventListener('click', function () { hideMenu(); it[1](); });
      m.appendChild(btn);
    });
    m.style.display = 'block';
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    var left = alignRight ? x - m.offsetWidth : x;
    m.style.left = Math.max(2, Math.min(left, vw - m.offsetWidth - 4)) + 'px';
    m.style.top = Math.max(2, Math.min(y, vh - m.offsetHeight - 4)) + 'px';
  }

  function hideMenu () {
    if (el.menu) el.menu.style.display = 'none';
  }

  var toastTimer = null;
  function toast (text, error) {
    el.toast.textContent = text;
    el.toast.classList.toggle('is-error', !!error);
    el.toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.style.display = 'none'; }, error ? 7000 : 4500);
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  function baseName () {
    var n = cfg.export.fileName || (cfg.title.text || defaultTitle());
    n = String(n).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Matrix';
    var d = new Date();
    return n + ' ' + d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function saved (ok, name) {
    if (ok) toast('Downloaded ' + name + '. If nothing appeared (Tableau Desktop can block downloads), use “Copy table” and paste into Excel.');
    else toast('Download isn’t available here. Use “Copy table” and paste into Excel.', true);
  }

  function pt (px) { return Math.round(Number(px) * 0.75 * 10) / 10; }

  function fontSpec (s, colorOver) {
    return { name: String(s.font || cfg.numbers.font || 'Lato'), size: pt(s.size), bold: Number(s.weight) >= 600, italic: !!s.italic, color: colorOver || s.color };
  }

  function caseOf (text, s) { return s && s.upper ? String(text).toUpperCase() : String(text); }

  function rotation (o) { return o === 'up' ? 90 : o === 'down' ? 180 : 0; }

  /** Faded secondary colour (opacity over white), so Excel shows it like the chart. */
  function faded (hex, op) { return Mx.mix(hex, '#FFFFFF', 1 - Math.max(0, Math.min(100, op)) / 100); }

  /** The matrix as sheet cells, the way it is drawn (merged headers, colours, number formats). */
  function visualSheet (noTitle) {
    var m = model;
    var H = cfg.headers; var C = cfg.cells; var T = cfg.totals; var L = cfg.layout;
    var nRC = m.rowH.levels.length; var nHR = m.colH.levels.length;
    var top = 0;
    var cells = [];
    var merges = [];
    var heights = [];
    var put = function (r, c, v) { (cells[r] = cells[r] || [])[c] = v; };
    var merge = function (r0, c0, r1, c1) { if (r1 > r0 || c1 > c0) merges.push([r0, c0, r1, c1]); };
    var totalCols = nRC + m.cols.length;
    if (cfg.export.includeTitle && !noTitle) {
      if (cfg.title.show !== false) {
        put(0, 0, { v: cfg.title.text || defaultTitle(), s: { font: fontSpec(cfg.title) } });
        merge(0, 0, 0, Math.max(0, totalCols - 1));
        heights[0] = Math.max(20, cfg.title.size * 1.6);
        top = 1;
      }
      if (cfg.explanation.show && cfg.explanation.text) {
        put(top, 0, { v: cfg.explanation.text, s: { font: fontSpec(cfg.explanation) } });
        merge(top, 0, top, Math.max(0, totalCols - 1));
        top++;
      }
      if (top) top++;
    }
    var hdrFill = H.bgOpacity > 0 ? H.bg : null;
    // corner
    if (nRC && nHR) {
      var ct = H.corner === 'custom' ? H.cornerText : '';
      if (H.corner === 'fields') {
        m.rowH.specs.forEach(function (sp, i) {
          put(top + nHR - 1, i, { v: sp.kind === 'dim' ? m.RF[sp.i].name : sp.kind === 'meas' ? 'Measure' : '', s: { font: fontSpec(H.cornerStyle), align: { v: 'bottom' }, fill: hdrFill } });
        });
        if (nHR > 1) merge(top, 0, top + nHR - 2, nRC - 1);
      } else {
        put(top, 0, { v: ct, s: { font: fontSpec(H.cornerStyle), align: { v: 'bottom' }, fill: hdrFill } });
        merge(top, 0, top + nHR - 1, nRC - 1);
      }
    }
    var headStyle = function (h, axis) {
      var outer = h.style === 'outer';
      var s = h.style === 'total' ? T.label : axis === 'c' ? (outer ? H.colOuter : H.col) : (outer ? H.rowOuter : H.row);
      var mc = h.member != null && H.memberColors && H.memberColors[h.member];
      var orient = axis === 'c' ? (outer ? H.colOuterOrient : H.colOrient) : (outer ? H.rowOuterOrient : H.rowOrient);
      var al = axis === 'c' ? (outer ? H.colOuterAlign : H.colAlign) : (outer ? H.rowOuterAlign : H.rowAlign);
      var va = axis === 'c' ? H.colVAlign : (outer ? H.rowOuterVAlign : H.rowVAlign);
      return { v: caseOf(h.text, s), s: { font: fontSpec(s, mc || null), fill: hdrFill, align: { h: al, v: va, wrap: true, rotate: rotation(orient) } } };
    };
    m.colH.levels.forEach(function (lv, li) {
      lv.forEach(function (h) {
        var r = top + li; var c = nRC + h.i0;
        put(r, c, headStyle(h, 'c'));
        merge(r, c, r + h.span - 1, nRC + h.i1);
      });
    });
    var bodyTop = top + nHR;
    m.rowH.levels.forEach(function (lv, li) {
      lv.forEach(function (h) {
        var r = bodyTop + h.i0;
        put(r, li, headStyle(h, 'r'));
        merge(r, li, bodyTop + h.i1, li + h.span - 1);
      });
    });
    var rich = cfg.export.excelSecondary !== 'omit';
    var sec = C.secondary;
    m.cells.forEach(function (row, ri) {
      row.forEach(function (c) {
        var r = bodyTop + ri; var col = nRC + c.ci;
        var align = { h: C.hAlign, v: C.vAlign, wrap: true };
        if (c.empty) {
          var tile = L.emptyStyle === 'tile' && !c.total;
          put(r, col, { v: c.text, s: { font: { name: cfg.numbers.font, size: pt(C.emptySize), color: C.emptyColor }, fill: tile ? C.emptyBg : null, border: tile ? { style: 'dashed', color: C.emptyBorder } : null, align: align } });
          return;
        }
        var ms = c.total ? T.value : C.main;
        var fg = c.fg || ms.color;
        var fill = c.total ? (T.tile ? T.bg : null) : (c.bg || (C.bgOpacity > 0 ? C.bg : null));
        if (!c.total && !c.bg && L.banding && model.rows[ri].type === 'leaf' && ri % 2 === 1) fill = L.bandColor;
        var border = !c.total && C.border ? { style: C.borderStyle === 'solid' ? 'thin' : C.borderStyle, color: c.bg ? Mx.mix(c.bg, '#000000', 0.06) : C.borderColor } : null;
        var s = { font: fontSpec(ms, fg), fill: fill, border: border, align: align };
        if (c.bold) s.font.bold = true;
        var lines = c.lines;
        if (lines.length && rich) {
          var runs = [];
          if (!c.hideMain) runs.push({ text: c.text, font: s.font.name, size: s.font.size, bold: s.font.bold, italic: s.font.italic, color: fg });
          var right = cfg.metrics.layout === 'right';
          lines.forEach(function (l, i) {
            var txt = (i === 0 ? (runs.length ? (right ? '  ' : '\n') : '') : (right ? cfg.metrics.sep : '\n')) + (l.label || '') + l.text;
            runs.push({ text: txt, font: s.font.name, size: pt(sec.size), bold: Number(sec.weight) >= 600, italic: !!sec.italic, color: c.onDark ? fg : faded(l.color || sec.color, sec.opacity) });
          });
          put(r, col, { rich: runs, s: s });
        } else if (c.text !== Mx.formatNumber(c.v, c.fmt, { fv: c.fv }) && !isFinite(Number(c.text))) {
          put(r, col, { v: c.text, s: s }); // zero text etc.
        } else {
          var f = c.fmt;
          s.numFmt = Mx.excelNumFmt(f, c.v);
          put(r, col, { v: Mx.excelValue(c.v, f), s: s });
        }
      });
    });
    // sizes from the drawn table
    var widths = [];
    var t = el.table;
    if (t) {
      var firstRow = t.tBodies[0] && t.tBodies[0].rows[0];
      var tds = firstRow ? firstRow.querySelectorAll('td.c') : [];
      for (var i = 0; i < nRC; i++) {
        var th = t.querySelector('th.rh[data-lv="' + i + '"]:not([colspan])');
        widths[i] = th ? th.offsetWidth + 12 : 120;
      }
      Array.prototype.forEach.call(tds, function (td, k) { widths[nRC + k] = td.offsetWidth + 10; });
      Array.prototype.forEach.call(t.tHead ? t.tHead.rows : [], function (tr, k) { heights[top + k] = Math.max(18, tr.offsetHeight); });
      Array.prototype.forEach.call(t.tBodies[0].rows, function (tr, k) { heights[bodyTop + k] = Math.max(18, tr.offsetHeight); });
    }
    lastTop = bodyTop;
    return { name: 'Matrix', cells: cells, merges: merges, colWidths: widths, rowHeights: heights, freeze: { rows: bodyTop, cols: nRC }, gridLines: false };
  }

  /** One row per cell: Rows fields, Columns fields, every measure, and the shown calculations of the main measure. */
  function dataTable () {
    var m = model;
    var MT = cfg.metrics;
    var withTotals = cfg.export.dataTotals;
    var head = m.RF.map(function (f) { return f.name; }).concat(m.CF.map(function (f) { return f.name; }));
    m.M.forEach(function (k) { head.push(mName(k)); });
    var calcs = [];
    if (cfg.export.dataPct) {
      if (MT.pct.show) calcs.push(['pct', '% of ' + DIR_LABEL[m.pctDir] + ' total']);
      if (MT.diff.show) calcs.push(['diff', 'Difference']);
      if (MT.pctDiff.show) calcs.push(['pctDiff', '% difference']);
      if (MT.running.show) calcs.push(['running', 'Running total']);
      if (MT.rank.show) calcs.push(['rank', 'Rank']);
    }
    calcs.forEach(function (c) { head.push(c[1] + ' (' + mName(m.main) + ')'); });
    var out = [];
    var seen = {};
    var label = function (it, axis, n) {
      var a = [];
      for (var i = 0; i < n; i++) {
        if (i < it.path.length) a.push(it.path[i]);
        else if (it.type === 'grand') a.push(i === 0 ? grandLabel(axis) : '');
        else if (it.type === 'sub') a.push(i === it.path.length ? subLabel(it.path[i - 1]) : '');
        else a.push(i === it.path.length ? 'All' : '');
      }
      return a;
    };
    m.cells.forEach(function (row, ri) {
      var rit = m.rows[ri];
      row.forEach(function (c, ci) {
        var cit = m.cols[ci];
        if (c.empty === 'diag') return;
        if (!withTotals && (rit.type !== 'leaf' || cit.type !== 'leaf')) return;
        var key = rit.type + rit.path.join(SEP) + '\u0002' + cit.type + cit.path.join(SEP);
        if (seen[key] && c.m !== m.main) return;
        var vals = m.M.map(function (k) {
          var a = c.acc && c.acc.v[k];
          var v = a ? aggNum(a, aggOf(k), c.agg) : NaN;
          return isFinite(v) ? v : null;
        });
        if (vals.every(function (v) { return v == null; })) return;
        var rec = label(rit, 'r', m.nR).concat(label(cit, 'c', m.nC), vals);
        calcs.forEach(function (k) { var v = c.m === m.main ? c[k[0]] : NaN; rec.push(isFinite(v) ? v : null); });
        if (seen[key] != null) { out[seen[key]] = rec; return; }
        seen[key] = out.length;
        out.push(rec);
      });
    });
    return { head: head, rows: out, nDims: m.nR + m.nC, calcs: calcs };
  }

  function exportXlsx (kind) {
    if (!model) return;
    var name = baseName() + '.xlsx';
    var sheet;
    try {
      if (kind === 'data') {
        var d = dataTable();
        var hs = { font: { name: 'Calibri', size: 11, bold: true, color: '#FFFFFF' }, fill: '#27357E', align: { v: 'middle', wrap: true } };
        var cells = [d.head.map(function (x) { return { v: x, s: hs }; })];
        var mFmt = model.M.map(function (k) { return fmtOf(k, 'cells'); });
        d.rows.forEach(function (r) {
          cells.push(r.map(function (v, i) {
            if (i < d.nDims) return { v: v };
            if (v == null) return null;
            var j = i - d.nDims;
            var f = j < mFmt.length ? mFmt[j] : null;
            var calc = j >= mFmt.length ? d.calcs[j - mFmt.length][0] : null;
            if (calc === 'pct' || calc === 'pctDiff') return { v: v, s: { numFmt: '0.0%' } };
            if (calc === 'rank') return { v: v };
            if (calc) f = mFmt[model.M.indexOf(model.main)];
            var nf = Mx.merge(f, { scale: f.scale === 'percent' || f.scale === 'percentDynamic' ? 'percent' : 'none', unit: f.unit });
            return { v: Mx.excelValue(v, nf), s: { numFmt: Mx.excelNumFmt(nf, v) } };
          }));
        });
        var widths = d.head.map(function (h, i) {
          var w = String(h).length;
          d.rows.slice(0, 200).forEach(function (r) { if (r[i] != null) w = Math.max(w, String(r[i]).length); });
          return Math.min(360, Math.max(64, w * 7 + 18));
        });
        sheet = { name: 'Data', cells: cells, colWidths: widths, freeze: { rows: 1, cols: 0 }, autoFilter: 'A1:' + MxExport.colName(d.head.length - 1) + (d.rows.length + 1) };
      } else {
        sheet = visualSheet();
      }
      var blob = MxExport.xlsx([sheet]);
      saved(MxExport.download(blob, name), name);
    } catch (e) {
      console.error('Matrix Table: Excel export failed', e);
      toast('Excel export failed: ' + (e && e.message), true);
    }
  }

  function crosstabRows () {
    var sh = visualSheet(true);
    var rows = [];
    var covered = {};
    sh.merges.forEach(function (mg) {
      for (var r = mg[0]; r <= mg[2]; r++) for (var c = mg[1]; c <= mg[3]; c++) if (r !== mg[0] || c !== mg[1]) covered[r + ',' + c] = 1;
    });
    var w = 0;
    sh.cells.forEach(function (r) { if (r && r.length > w) w = r.length; });
    for (var r = 0; r < sh.cells.length; r++) {
      var src = sh.cells[r] || [];
      var line = [];
      for (var c = 0; c < w; c++) {
        var x = src[c];
        if (!x || covered[r + ',' + c]) { line.push(''); continue; }
        if (x.rich) line.push(x.rich.map(function (q) { return q.text; }).join('').replace(/\n/g, ' · ')); else line.push(x.v);
      }
      rows.push(line);
    }
    return rows;
  }

  function exportCsv (kind) {
    if (!model) return;
    var name = baseName() + '.csv';
    try {
      var rows;
      if (kind === 'data') { var d = dataTable(); rows = [d.head].concat(d.rows); } else rows = crosstabRows();
      saved(MxExport.download(MxExport.csv(rows), name, 'text/csv;charset=utf-8'), name);
    } catch (e) {
      console.error('Matrix Table: CSV export failed', e);
      toast('CSV export failed: ' + (e && e.message), true);
    }
  }

  /** Copies the matrix as an HTML table (keeps colours in Excel) plus tab-separated text. */
  function copyTable () {
    if (!model) return;
    var sh = visualSheet();
    var covered = {};
    var spans = {};
    sh.merges.forEach(function (mg) {
      spans[mg[0] + ',' + mg[1]] = [mg[2] - mg[0] + 1, mg[3] - mg[1] + 1];
      for (var r = mg[0]; r <= mg[2]; r++) for (var c = mg[1]; c <= mg[3]; c++) if (r !== mg[0] || c !== mg[1]) covered[r + ',' + c] = 1;
    });
    var w = 0;
    sh.cells.forEach(function (r) { if (r && r.length > w) w = r.length; });
    var html = ['<table style="border-collapse:collapse">'];
    var tsv = [];
    for (var r = 0; r < sh.cells.length; r++) {
      var src = sh.cells[r] || [];
      html.push('<tr>');
      var line = [];
      for (var c = 0; c < w; c++) {
        var x = src[c];
        var txt = '';
        if (x) txt = x.rich ? x.rich.map(function (q) { return q.text; }).join('') : (typeof x.v === 'number' ? (x.s && x.s.numFmt ? displayOf(r, c) : String(x.v)) : String(x.v == null ? '' : x.v));
        line.push(txt.replace(/\n/g, ' '));
        if (covered[r + ',' + c]) continue;
        var sp = spans[r + ',' + c];
        var s = (x && x.s) || {};
        var f = s.font || {};
        var st = 'font-family:' + (f.name || 'Calibri') + ';font-size:' + (f.size || 11) + 'pt;' + (f.bold ? 'font-weight:bold;' : '') + (f.italic ? 'font-style:italic;' : '') +
          (f.color ? 'color:' + f.color + ';' : '') + (s.fill ? 'background:' + s.fill + ';' : '') +
          (s.border ? 'border:1px ' + (s.border.style === 'thin' ? 'solid' : s.border.style) + ' ' + s.border.color + ';' : '') +
          'text-align:' + ((s.align && s.align.h) || 'left') + ';vertical-align:' + ((s.align && s.align.v) || 'middle') + ';padding:3px 6px;' +
          (s.numFmt ? 'mso-number-format:\'' + s.numFmt.split(';')[0].replace(/"/g, '\\"') + '\';' : '');
        var content = x ? (x.rich ? x.rich.map(function (q) { return '<span style="font-size:' + q.size + 'pt;color:' + q.color + ';' + (q.bold ? 'font-weight:bold;' : 'font-weight:normal;') + '">' + esc(q.text).replace(/\n/g, '<br style="mso-data-placement:same-cell">') + '</span>'; }).join('') : esc(typeof x.v === 'number' ? x.v : x.v)) : '';
        html.push('<td' + (sp ? ' rowspan="' + sp[0] + '" colspan="' + sp[1] + '"' : '') + ' style="' + st + '">' + content + '</td>');
      }
      html.push('</tr>');
      tsv.push(line.join('\t'));
    }
    html.push('</table>');
    copyRich(html.join(''), tsv.join('\n'), 'Table copied. Paste it into Excel, Sheets or an email.');
  }

  function displayOf (r, c) {
    // the text the matrix shows for a body cell (for TSV)
    var m = model;
    var nRC = m.rowH.levels.length;
    var sh = lastTop;
    var c0 = m.cells[r - sh] && m.cells[r - sh][c - nRC];
    return c0 ? c0.text : '';
  }
  var lastTop = 0;

  function copyRich (html, text, msg) {
    var done = false;
    var handler = function (e) {
      try {
        e.clipboardData.setData('text/html', html);
        e.clipboardData.setData('text/plain', text);
        e.preventDefault();
        done = true;
      } catch (x) { /* fall back below */ }
    };
    document.addEventListener('copy', handler);
    try { document.execCommand('copy'); } catch (x) { /* ignore */ }
    document.removeEventListener('copy', handler);
    if (done) { toast(msg); return; }
    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
        .then(function () { toast(msg); }, function () { toast('Couldn’t copy here. Use an export instead.', true); });
    } else {
      toast('Couldn’t copy here. Use an export instead.', true);
    }
  }

  function copyPlain (text, msg) { copyRich(esc(text), text, msg); }

  // ---------------------------------------------------------------------------
  function showEmpty (html) {
    el.card.classList.add('is-empty');
    hideTooltip();
    el.hint.innerHTML = html;
  }

  window.MatrixTable = {
    init: init,
    _state: state,
    _model: function () { return model; },
    _export: { xlsx: exportXlsx, csv: exportCsv, visualSheet: function () { return visualSheet(); }, dataTable: function () { return dataTable(); }, crosstab: function () { return crosstabRows(); } }
  };
})();
