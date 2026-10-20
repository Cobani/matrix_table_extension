'use strict';

/**
 * Format dialog for the Matrix Table extension ("Format Extension" on the
 * Marks card, or the matrix's right-click menu).
 *
 * Every change is saved straight away (debounced), so the matrix behind the
 * modeless dialog updates live. Cancel restores what was stored on open.
 * The matrix passes its measures, fields and members as the dialog payload,
 * because a dialog can't read the worksheet.
 *
 * The Icon, Title & text, Numbers, Card and Presets tabs are the Bar Chart's
 * (Icon and Title & text come from KPI Card; Card from Waterfall).
 */
(function () {
  var cfg = null;
  var original = null;
  var saveTimer = null;
  var activeTab = 'layout';
  var shapeIndex = null;
  var info = { measures: [], rowFields: [], colFields: [], members: [], hasColor: false, colorName: '', extras: [], cols: [], focus: null };

  var WEIGHTS = [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [900, 'Black']];
  var LINE_STYLES = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']];
  var H_ALIGN = [['left', 'Left'], ['center', 'Center'], ['right', 'Right']];
  var V_ALIGN = [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']];
  var ORIENT = [['horizontal', 'Horizontal'], ['up', 'Vertical ↑'], ['down', 'Vertical ↓']];

  var TABS = [
    { id: 'icon', label: 'Icon', build: buildIconTab, keys: ['icon'] },
    { id: 'text', label: 'Title & text', build: buildTextTab, keys: ['title', 'explanation'] },
    { id: 'layout', label: 'Layout', build: buildLayoutTab, keys: ['layout', 'measureHeader'] },
    { id: 'measures', label: 'Measures', build: buildMeasuresTab, keys: ['measures'] },
    { id: 'calc', label: 'Calculations', build: buildCalcTab, keys: ['calc', 'metrics'] },
    { id: 'cells', label: 'Cells', build: buildCellsTab, keys: ['cells'] },
    { id: 'colors', label: 'Colors', build: buildColorsTab, keys: ['colors'] },
    { id: 'headers', label: 'Headers', build: buildHeadersTab, keys: ['headers'] },
    { id: 'totals', label: 'Totals', build: buildTotalsTab, keys: ['totals'] },
    { id: 'sort', label: 'Sort', build: buildSortTab, keys: ['sort'] },
    { id: 'tooltip', label: 'Tooltip & actions', build: buildTooltipTab, keys: ['tooltip', 'interaction'] },
    { id: 'export', label: 'Export', build: buildExportTab, keys: ['export'] },
    { id: 'numbers', label: 'Numbers', build: buildNumbersTab, keys: ['numbers.mode', 'numbers.font', 'format'] },
    { id: 'card', label: 'Card', build: buildCardTab, keys: ['card'] },
    { id: 'presets', label: 'Presets', build: buildPresetsTab, keys: [] }
  ];

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  function init () {
    return tableau.extensions.initializeDialogAsync().then(function (payload) {
      try {
        var p = JSON.parse(payload || '{}');
        Object.keys(info).forEach(function (k) { if (p[k] != null) info[k] = p[k]; });
      } catch (e) { /* opened without payload */ }

      cfg = Mx.read();
      original = Mx.clone(cfg);

      if (!info.measures.length) {
        info.measures = Object.keys(cfg.measures).map(function (k) { return { key: k, name: k }; });
      }
      if (info.focus && info.focus.tab) activeTab = info.focus.tab;

      buildTabs();
      document.getElementById('cancel').addEventListener('click', function () {
        cfg = original;
        flush().then(close);
      });
      document.getElementById('done').addEventListener('click', function () { flush().then(close); });
      document.getElementById('reset-tab').addEventListener('click', resetTab);
    }).catch(function (err) {
      console.error('Matrix Table dialog failed to initialize:', err);
    });
  }

  function buildTabs () {
    var nav = document.getElementById('tabs');
    var panels = document.getElementById('panels');
    var scroll = panels.scrollTop;
    nav.innerHTML = '';
    panels.innerHTML = '';

    TABS.forEach(function (tab) {
      var b = h('button', { className: 'tab', type: 'button', role: 'tab', textContent: tab.label });
      b.setAttribute('aria-selected', String(tab.id === activeTab));
      b.addEventListener('click', function () { activeTab = tab.id; panels.scrollTop = 0; buildTabs(); });
      nav.appendChild(b);

      var panel = h('section', { className: 'panel', role: 'tabpanel' });
      panel.hidden = tab.id !== activeTab;
      if (!panel.hidden) tab.build(panel);
      panels.appendChild(panel);
    });
    panels.scrollTop = scroll;
  }

  function rebuild () { buildTabs(); }

  function resetTab () {
    var tab = TABS.find(function (t) { return t.id === activeTab; });
    tab.keys.forEach(function (k) {
      var path = k.split('.');
      var def = path.reduce(function (o, x) { return o == null ? undefined : o[x]; }, Mx.DEFAULTS);
      var last = path.pop();
      var tgt = path.reduce(function (o, x) { return o[x]; }, cfg);
      tgt[last] = Mx.clone(def);
    });
    changed();
    buildTabs();
  }

  // ---------------------------------------------------------------------------
  // Number format editor (KPI Card "Big number" options + Waterfall signs)
  // ---------------------------------------------------------------------------
  function fmtRows (g, base, opts) {
    opts = opts || {};
    var fmtRow = selectRow('Number format', P(base, 'scale'), [
      ['dynamic', 'Dynamic (K / M / B)'], ['K', 'Thousands (K)'], ['M', 'Millions (M)'],
      ['B', 'Billions (B)'], ['none', 'Full number'],
      ['percent', 'Percentage (%)'], ['percentDynamic', 'Percentage, dynamic (K / M / B %)'],
      ['workbook', 'Workbook format']
    ]);
    fmtRow.querySelector('select').addEventListener('change', rebuild);
    g.appendChild(fmtRow);
    var scale = get(P(base, 'scale'));
    if (scale === 'percent' || scale === 'percentDynamic') {
      g.appendChild(checkboxRow('Value is a 0–1 ratio', P(base, 'pctFromRatio')));
      g.appendChild(help('On: 0.4523 → 45.23%. Off: 45.23 → 45.23%.'));
    }
    if (scale === 'workbook') g.appendChild(help('Uses Tableau’s format when a cell is a single value; totals fall back to Dynamic.'));
    g.appendChild(numberRow('Decimal places', P(base, 'decimals'), 0, 6, 1));
    g.appendChild(checkboxRow('Thousands separator', P(base, 'thousands')));
    g.appendChild(textRow('Unit', P(base, 'unit'), 'e.g. SAR, M, %'));
    g.appendChild(selectRow('Unit position', P(base, 'unitPosition'), [['suffix', 'After number'], ['prefix', 'Before number']]));
    g.appendChild(checkboxRow('Space before / after unit', P(base, 'unitSpace')));
    if (!opts.noSign) g.appendChild(checkboxRow('“+” on positive values', P(base, 'plusSign')));
    g.appendChild(selectRow('Negative numbers', P(base, 'negStyle'), [['minus', '−201.4'], ['hyphen', '-201.4'], ['paren', '(201.4)']]));
    var sample = h('div', { className: 'sample' });
    var upd = function () {
      var f = get(base);
      sample.textContent = 'Preview: ' + Mx.formatNumber(1284500, f, { signed: true }) + '   ' + Mx.formatNumber(262.1, f, { signed: true }) +
        '   ' + Mx.formatNumber(-45200, f, { signed: true }) + '   ' + Mx.formatNumber(0.4523, f, { signed: true });
    };
    upd();
    g.addEventListener('input', upd);
    g.addEventListener('change', upd);
    g.appendChild(sample);
  }

  /** Format controls for one part: own format when the scope is "each". */
  function labelFmt (g, base, opts) {
    if (cfg.numbers.mode === 'each') {
      fmtRows(g, base, opts);
    } else {
      var note = h('p', { className: 'note' });
      note.innerHTML = 'Uses the shared number format (<a href="#">Numbers tab</a>). Switch the scope there to <b>Each part its own</b> to format this on its own.';
      note.querySelector('a').addEventListener('click', function (e) { e.preventDefault(); activeTab = 'numbers'; buildTabs(); });
      g.appendChild(note);
    }
  }


  // ---------------------------------------------------------------------------
  // Shared bits for the matrix tabs
  // ---------------------------------------------------------------------------
  function measureOptions (withFirst) {
    var o = info.measures.map(function (m) { return [m.key, m.name]; });
    return withFirst ? [['', 'First measure on the tile']].concat(o) : o;
  }

  function dirOptions (withInherit) {
    var o = Mx.DIRECTIONS.map(function (d) { return d.slice(); });
    return withInherit ? [['inherit', 'As set above (' + labelOf(Mx.DIRECTIONS, cfg.calc.direction) + ')']].concat(o) : o;
  }

  function labelOf (list, v) { var x = list.find(function (o) { return o[0] === v; }); return x ? x[1] : v; }

  function note (g, html) { var n = h('p', { className: 'note' }); n.innerHTML = html; g.appendChild(n); return n; }

  function tabLink (n, tab) {
    Array.prototype.forEach.call(n.querySelectorAll('a[data-tab]'), function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); activeTab = a.getAttribute('data-tab'); buildTabs(); });
    });
    return n;
  }

  /** Font rows plus capitals / letter spacing (header and total label styles). */
  function textStyleRows (g, base) {
    fontRows(g, base);
    g.appendChild(checkboxRow('Capitals', P(base, 'upper')));
    g.appendChild(numberRow('Letter spacing', P(base, 'letterSpacing'), 0, 40, 1));
  }

  // ---------------------------------------------------------------------------
  // Layout tab
  // ---------------------------------------------------------------------------
  function buildLayoutTab (p) {
    var L = cfg.layout;
    var g1 = group(p, 'Measures');
    g1.appendChild(segRow('Show measures', 'layout.measures', [['cell', 'In the cell'], ['columns', 'As columns'], ['rows', 'As rows']], rebuild));
    g1.appendChild(help(L.measures === 'cell'
      ? 'One cell per row × column. The main measure is the big number; the other measures, % of total and other calculations sit under it, smaller (Calculations tab).'
      : L.measures === 'columns'
        ? 'Each measure gets its own column under every column member, like Measure Names on Columns in Tableau.'
        : 'Each measure gets its own row under every row member, like Measure Names on Rows in Tableau.'));
    if (info.measures.length > 1 && L.measures === 'cell') g1.appendChild(selectRow('Main measure', 'layout.mainMeasure', measureOptions(true)));
    if (L.measures !== 'cell') {
      g1.appendChild(checkboxRow('Measure names as headers', 'measureHeader.show'));
      g1.appendChild(segRow('Measure level', 'measureHeader.position', [['inner', 'Innermost'], ['outer', 'Outermost']]));
      g1.appendChild(help('Innermost: each member shows all measures side by side. Outermost: one block per measure.'));
    }

    var g2 = group(p, 'Rows and columns');
    g2.appendChild(checkboxRow('Swap rows and columns', 'layout.transpose'));
    g2.appendChild(help('Shows the Rows fields across the top and the Columns fields down the side, without moving pills.'));
    g2.appendChild(selectRow('Same members both ways', 'layout.square', [['auto', 'Automatic'], ['on', 'Always'], ['off', 'Never']]));
    g2.appendChild(help('For From → To matrices: rows and columns list the same members in the same order, so every pair has a cell (n/a when there is no data). Automatic does this when one field each side shares most of its members.'));

    var g3 = group(p, 'Size');
    g3.appendChild(selectRow('Column width', 'layout.colWidth', [['fit', 'Fit to width'], ['auto', 'By content'], ['fixed', 'Fixed']], null, rebuild));
    if (L.colWidth === 'fixed') g3.appendChild(numberRow('Width (px)', 'layout.colPx', 20, 600, 1));
    if (L.colWidth === 'fit') {
      g3.appendChild(numberRow('Narrowest (px)', 'layout.minColPx', 20, 400, 1));
      g3.appendChild(numberRow('Widest (px)', 'layout.maxColPx', 0, 1200, 10));
      g3.appendChild(help('Columns share the width, between these sizes (Widest 0 = no limit). When they don’t fit, the matrix scrolls.'));
    }
    g3.appendChild(segRow('Row height', 'layout.rowHeight', [['auto', 'By content'], ['fixed', 'Fixed']], rebuild));
    if (L.rowHeight === 'fixed') g3.appendChild(numberRow('Height (px)', 'layout.rowPx', 12, 300, 1));
    g3.appendChild(numberRow('Row header width', 'layout.rowHeaderPx', 0, 600, 1));
    g3.appendChild(help('Width of each row header column in px. 0 = by content.'));
    g3.appendChild(numberRow('Gap between columns', 'layout.gapX', 0, 40, 1));
    g3.appendChild(numberRow('Gap between rows', 'layout.gapY', 0, 40, 1));

    var g4 = group(p, 'Scrolling and rows');
    g4.appendChild(checkboxRow('Freeze headers', 'layout.freeze'));
    g4.appendChild(help('Row and column headers stay in view while the matrix scrolls.'));
    g4.appendChild(checkboxRow('Banded rows', 'layout.banding', rebuild));
    if (L.banding) g4.appendChild(colorRow('Band colour', 'layout.bandColor'));

    var g5 = group(p, 'Empty and special cells');
    g5.appendChild(checkboxRow('Hide empty rows', 'layout.hideEmptyRows'));
    g5.appendChild(checkboxRow('Hide empty columns', 'layout.hideEmptyCols'));
    g5.appendChild(checkboxRow('Mark the diagonal', 'layout.diagonal', rebuild));
    g5.appendChild(help('A cell whose row and column are the same member (e.g. Current → Current) shows the mark below instead of a value.'));
    if (L.diagonal) g5.appendChild(textRow('Diagonal mark', 'layout.diagonalText', '—'));
    g5.appendChild(textRow('No data', 'layout.nullText', 'n/a'));
    g5.appendChild(textRow('Zero shown as', 'layout.zeroText', 'empty = the number'));
    g5.appendChild(selectRow('Empty cells look', 'layout.emptyStyle', [['tile', 'Dashed tile'], ['text', 'Text only'], ['blank', 'Text only, no tile']]));
  }

  // ---------------------------------------------------------------------------
  // Measures tab: names, total aggregation and number format per measure
  // ---------------------------------------------------------------------------
  function buildMeasuresTab (p) {
    if (!info.measures.length) { note(p, 'Drop measures on the <b>Measure</b> tile first.'); return; }
    if (info.measures.length > 1) {
      var g0 = group(p, 'Main measure');
      g0.appendChild(selectRow('Main measure', 'layout.mainMeasure', measureOptions(true)));
      g0.appendChild(help('The big number in each cell (Layout → In the cell), and what % of total, differences, ranks and sorting use.'));
    }
    var gh = group(p, 'Totals');
    gh.appendChild(help('How subtotals and totals combine the cells. Automatic: SUM / COUNT add up, AVG averages, MIN / MAX take the min / max, and distinct counts or AGG() ratios stay empty (they can\u2019t be added up). For a ratio, pick Average or leave the totals empty.'));
    info.measures.forEach(function (m) {
      cfg.measures[m.key] = Mx.measureCfg(cfg, m.key);
      var g = group(p, m.name);
      var base = ['measures', m.key];
      g.appendChild(textRow('Display name', P(base, 'label'), m.name));
      g.appendChild(selectRow('Totals', P(base, 'agg'), [['auto', 'Automatic'], ['sum', 'Add up (sum)'], ['avg', 'Average'], ['min', 'Minimum'], ['max', 'Maximum'], ['none', 'Leave empty']]));
      g.appendChild(checkboxRow('Own number format', P(base, 'ownFmt'), rebuild));
      if (cfg.measures[m.key].ownFmt) fmtRows(g, P(base, 'fmt'));
    });
  }

  // ---------------------------------------------------------------------------
  // Calculations tab: what each cell shows
  // ---------------------------------------------------------------------------
  var METRIC_NAMES = { others: 'Other measures', pct: '% of total', diff: 'Difference', pctDiff: '% difference', running: 'Running total', rank: 'Rank' };

  function buildCalcTab (p) {
    var MT = cfg.metrics;
    var g0 = group(p, 'Compute using');
    g0.appendChild(selectRow('Direction', 'calc.direction', dirOptions(false), null, rebuild));
    var n0 = note(g0, '<b>Table</b>: the whole matrix. <b>Table across</b>: along each row (e.g. % of the row total). <b>Table down</b>: along each column. ' +
      '<b>Pane</b>: the same, but only within the outer group (outer column member across, outer row member down). Each calculation below can use its own direction.');
    tabLink(n0);

    var g1 = group(p, 'Main value');
    g1.appendChild(checkboxRow('Show main value', 'metrics.main.show'));
    g1.appendChild(help('Off: cells show only the smaller values below (e.g. only % of total).'));

    if (cfg.layout.measures === 'cell' && info.measures.length > 1) {
      var g2 = group(p, 'Other measures');
      g2.appendChild(checkboxRow('Show other measures', 'metrics.others.show'));
      g2.appendChild(checkboxRow('With their names', 'metrics.others.names'));
    }

    var g3 = group(p, '% of total');
    g3.appendChild(checkboxRow('Show % of total', 'metrics.pct.show', rebuild));
    if (MT.pct.show) {
      g3.appendChild(selectRow('Compute using', 'metrics.pct.dir', dirOptions(true)));
      g3.appendChild(numberRow('Decimal places', 'metrics.pct.decimals', 0, 4, 1));
      g3.appendChild(textRow('Text before', 'metrics.pct.label', 'e.g. Share '));
      g3.appendChild(checkboxRow('Also on totals', 'metrics.pct.onTotals'));
    }

    var g4 = group(p, 'Difference');
    g4.appendChild(checkboxRow('Show difference', 'metrics.diff.show', rebuild));
    if (MT.diff.show) {
      g4.appendChild(selectRow('Along', 'metrics.diff.dir', dirOptions(true)));
      g4.appendChild(segRow('From', 'metrics.diff.vs', [['prev', 'Previous cell'], ['first', 'First cell']]));
      g4.appendChild(textRow('Text before', 'metrics.diff.label', 'Δ '));
      g4.appendChild(checkboxRow('▲ ▼ arrows', 'metrics.diff.arrows'));
      g4.appendChild(checkboxRow('Green / red', 'metrics.diff.signColors'));
      labelFmt(g4, 'metrics.diff.fmt');
    }

    var g5 = group(p, '% difference');
    g5.appendChild(checkboxRow('Show % difference', 'metrics.pctDiff.show', rebuild));
    if (MT.pctDiff.show) {
      g5.appendChild(selectRow('Along', 'metrics.pctDiff.dir', dirOptions(true)));
      g5.appendChild(segRow('From', 'metrics.pctDiff.vs', [['prev', 'Previous cell'], ['first', 'First cell']]));
      g5.appendChild(numberRow('Decimal places', 'metrics.pctDiff.decimals', 0, 4, 1));
      g5.appendChild(textRow('Text before', 'metrics.pctDiff.label', ''));
      g5.appendChild(checkboxRow('▲ ▼ arrows', 'metrics.pctDiff.arrows'));
      g5.appendChild(checkboxRow('Green / red', 'metrics.pctDiff.signColors'));
    }

    var g6 = group(p, 'Running total');
    g6.appendChild(checkboxRow('Show running total', 'metrics.running.show', rebuild));
    if (MT.running.show) {
      g6.appendChild(selectRow('Along', 'metrics.running.dir', dirOptions(true)));
      g6.appendChild(textRow('Text before', 'metrics.running.label', 'Σ '));
      labelFmt(g6, 'metrics.running.fmt');
    }

    var g7 = group(p, 'Rank');
    g7.appendChild(checkboxRow('Show rank', 'metrics.rank.show', rebuild));
    if (MT.rank.show) {
      g7.appendChild(selectRow('Within', 'metrics.rank.dir', dirOptions(true)));
      g7.appendChild(segRow('Order', 'metrics.rank.order', [['desc', 'Highest = 1'], ['asc', 'Lowest = 1']]));
      g7.appendChild(textRow('Text before', 'metrics.rank.label', '#'));
    }
    g7.appendChild(help('Differences, running totals and ranks are left out of total cells.'));

    var g8 = group(p, 'Order and placement');
    var r = row('Order');
    var list = h('div', { className: 'dimlist' });
    var order = (MT.order || []).filter(function (k) { return METRIC_NAMES[k]; });
    Object.keys(METRIC_NAMES).forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
    order.forEach(function (k, pos) {
      var mt = k === 'others' ? MT.others : MT[k];
      var item = h('div', { className: 'dimitem' + (mt && mt.show ? '' : ' is-off') });
      var label = h('span', { className: 'dimname', textContent: (pos + 1) + '. ' + METRIC_NAMES[k] + (mt && mt.show ? '' : ' (off)') });
      var up = h('button', { type: 'button', className: 'mini', textContent: '▲', title: 'Higher' });
      var down = h('button', { type: 'button', className: 'mini', textContent: '▼', title: 'Lower' });
      up.disabled = pos === 0;
      down.disabled = pos === order.length - 1;
      var move = function (d) { var a = order.slice(); var t = a[pos]; a[pos] = a[pos + d]; a[pos + d] = t; set('metrics.order', a); rebuild(); };
      up.addEventListener('click', function () { move(-1); });
      down.addEventListener('click', function () { move(1); });
      item.append(label, up, down);
      list.appendChild(item);
    });
    r.appendChild(list);
    g8.appendChild(r);
    g8.appendChild(segRow('Placement', 'metrics.layout', [['below', 'Under the main value'], ['right', 'Beside it']], rebuild));
    if (MT.layout === 'right') g8.appendChild(textRow('Separator', 'metrics.sep', ' · '));
    g8.appendChild(colorRow('Up colour', 'metrics.posColor'));
    g8.appendChild(colorRow('Down colour', 'metrics.negColor'));
    var n8 = note(g8, 'Size, colour and fading of these values: <a href="#" data-tab="cells">Cells tab</a> → Smaller values.');
    tabLink(n8);
  }

  // ---------------------------------------------------------------------------
  // Cells tab
  // ---------------------------------------------------------------------------
  function buildCellsTab (p) {
    var C = cfg.cells;
    var g1 = group(p, 'Tile');
    g1.appendChild(colorRow('Background', 'cells.bg'));
    g1.appendChild(rangeRow('Opacity', 'cells.bgOpacity', 0, 100, 1, '%'));
    g1.appendChild(help('Shading from the Colors tab replaces this colour.'));
    g1.appendChild(numberRow('Corner radius', 'cells.radius', 0, 30, 1));
    g1.appendChild(numberRow('Padding across', 'cells.padX', 0, 40, 1));
    g1.appendChild(numberRow('Padding up / down', 'cells.padY', 0, 40, 1));
    g1.appendChild(checkboxRow('Border', 'cells.border', rebuild));
    if (C.border) {
      g1.appendChild(segRow('Style', 'cells.borderStyle', LINE_STYLES));
      g1.appendChild(numberRow('Width', 'cells.borderWidth', 1, 6, 1));
      g1.appendChild(colorRow('Colour', 'cells.borderColor'));
    }

    var g2 = group(p, 'Alignment');
    g2.appendChild(segRow('Across', 'cells.hAlign', H_ALIGN));
    g2.appendChild(segRow('Up / down', 'cells.vAlign', V_ALIGN));

    var g3 = group(p, 'Main value');
    fontRows(g3, 'cells.main');

    var g4 = group(p, 'Smaller values');
    g4.appendChild(numberRow('Size (px)', 'cells.secondary.size', 6, 40, 1));
    g4.appendChild(selectRow('Weight', 'cells.secondary.weight', WEIGHTS));
    g4.appendChild(colorRow('Colour', 'cells.secondary.color'));
    g4.appendChild(rangeRow('Opacity', 'cells.secondary.opacity', 10, 100, 1, '%'));
    g4.appendChild(checkboxRow('Italic', 'cells.secondary.italic'));
    g4.appendChild(help('Other measures, % of total, differences, running totals and ranks (Calculations tab).'));

    var g5 = group(p, 'Empty cells (no data, diagonal)');
    g5.appendChild(colorRow('Background', 'cells.emptyBg'));
    g5.appendChild(colorRow('Border', 'cells.emptyBorder'));
    g5.appendChild(segRow('Border style', 'cells.emptyBorderStyle', LINE_STYLES));
    g5.appendChild(colorRow('Text colour', 'cells.emptyColor'));
    g5.appendChild(numberRow('Text size', 'cells.emptySize', 6, 30, 1));
    var n5 = note(g5, 'The texts and whether empty cells get a tile: <a href="#" data-tab="layout">Layout tab</a>.');
    tabLink(n5);

    var g6 = group(p, 'Number format');
    labelFmt(g6, 'cells.fmt');
  }

  // ---------------------------------------------------------------------------
  // Colors tab
  // ---------------------------------------------------------------------------
  function ramp (a, b, mid) {
    var s = h('span', { className: 'lg-ramp' });
    s.style.cssText = 'display:inline-block;width:120px;height:10px;border-radius:3px;background:linear-gradient(90deg,' + a + (mid ? ',' + mid : '') + ',' + b + ')';
    return s;
  }

  function buildColorsTab (p) {
    var C = cfg.colors;
    var g1 = group(p, 'Shading');
    g1.appendChild(segRow('Style', 'colors.mode', [['none', 'None'], ['heat', 'Heat map'], ['diverging', '− / +'], ['bars', 'Data bars']], rebuild));
    if (C.mode !== 'none') {
      var by = [['__auto', 'Automatic' + (info.hasColor ? ' (Color tile)' : ' (the cell value)')], ['__main', 'The cell value'], ['__pct', '% of total']];
      if (info.hasColor) by.push(['__color', info.colorName || 'Color tile']);
      info.measures.forEach(function (m) { by.push([m.key, m.name]); });
      g1.appendChild(selectRow('Shade by', 'colors.by', by));
      g1.appendChild(segRow('Range', 'colors.scope', [['table', 'Whole table'], ['row', 'Each row'], ['column', 'Each column']]));
      g1.appendChild(help('Lowest to highest within the range. Measures shown as their own columns or rows are shaded separately.'));
      g1.appendChild(checkboxRow('Shade totals too', 'colors.includeTotals'));
    }
    if (C.mode === 'heat') {
      g1.appendChild(colorRow('Lowest', 'colors.low', rebuild));
      g1.appendChild(colorRow('Highest', 'colors.high', rebuild));
      var r1 = row('Preview'); r1.appendChild(ramp(C.low, C.high)); g1.appendChild(r1);
    } else if (C.mode === 'diverging') {
      g1.appendChild(colorRow('Negative', 'colors.neg', rebuild));
      g1.appendChild(colorRow('Zero', 'colors.mid', rebuild));
      g1.appendChild(colorRow('Positive', 'colors.pos', rebuild));
      var r2 = row('Preview'); r2.appendChild(ramp(C.neg, C.pos, C.mid)); g1.appendChild(r2);
    } else if (C.mode === 'bars') {
      g1.appendChild(colorRow('Bar colour', 'colors.barColor'));
      g1.appendChild(colorRow('Negative bars', 'colors.neg'));
      g1.appendChild(rangeRow('Opacity', 'colors.barOpacity', 10, 100, 1, '%'));
    }
    if (C.mode === 'heat' || C.mode === 'diverging') {
      g1.appendChild(checkboxRow('White text on dark cells', 'colors.autoText'));
    }

    var g2 = group(p, 'Rules');
    g2.appendChild(help('Colour cells that meet a condition. The first matching rule wins and replaces the shading. % of total is written as a percentage (e.g. 10 for 10%).'));
    var rules = cfg.colors.rules;
    rules.forEach(function (r0, i) {
      rules[i] = Mx.ruleCfg(r0);
      var base = ['colors', 'rules', i];
      var card = h('div', { className: 'subcard' });
      card.appendChild(selectRow('When', P(base, 'on'), [['value', 'The value'], ['pct', '% of total'], ['diff', 'The difference']]));
      card.appendChild(selectRow('Is', P(base, 'op'), [['>', 'greater than'], ['>=', 'at least'], ['<', 'less than'], ['<=', 'at most'], ['=', 'equal to'], ['!=', 'not equal to'], ['between', 'between']], null, rebuild));
      card.appendChild(numberRow('Value', P(base, 'value'), -1e15, 1e15, 'any'));
      if (rules[i].op === 'between') card.appendChild(numberRow('and', P(base, 'value2'), -1e15, 1e15, 'any'));
      card.appendChild(colorRow('Cell colour', P(base, 'bg')));
      card.appendChild(colorRow('Text colour', P(base, 'color')));
      card.appendChild(checkboxRow('Bold', P(base, 'bold')));
      var del = h('button', { type: 'button', className: 'btn btn--small', textContent: 'Remove rule' });
      del.addEventListener('click', function () { rules.splice(i, 1); changed(); rebuild(); });
      card.appendChild(del);
      g2.appendChild(card);
    });
    var add = h('button', { type: 'button', className: 'btn', textContent: 'Add rule' });
    add.addEventListener('click', function () { rules.push(Mx.clone(Mx.RULE)); changed(); rebuild(); });
    g2.appendChild(add);
  }

  // ---------------------------------------------------------------------------
  // Headers tab
  // ---------------------------------------------------------------------------
  function buildHeadersTab (p) {
    var H = cfg.headers;
    var nC = info.colFields.length; var nR = info.rowFields.length;
    if (cfg.layout.transpose) { var t = nC; nC = nR; nR = t; }
    var focus = info.focus || {};

    var g1 = group(p, nC > 1 ? 'Column headers (innermost)' : 'Column headers');
    g1.appendChild(segRow('Orientation', 'headers.colOrient', ORIENT));
    g1.appendChild(segRow('Align', 'headers.colAlign', H_ALIGN));
    g1.appendChild(segRow('Up / down', 'headers.colVAlign', V_ALIGN));
    textStyleRows(g1, 'headers.col');

    if (nC > 1 || cfg.layout.measures === 'columns') {
      var g2 = group(p, 'Outer column headers');
      g2.appendChild(segRow('Orientation', 'headers.colOuterOrient', ORIENT));
      g2.appendChild(segRow('Align', 'headers.colOuterAlign', H_ALIGN));
      textStyleRows(g2, 'headers.colOuter');
    }

    var g3 = group(p, nR > 1 ? 'Row headers (innermost)' : 'Row headers');
    g3.appendChild(segRow('Orientation', 'headers.rowOrient', ORIENT));
    g3.appendChild(segRow('Align', 'headers.rowAlign', H_ALIGN));
    g3.appendChild(segRow('Up / down', 'headers.rowVAlign', V_ALIGN));
    textStyleRows(g3, 'headers.row');

    if (nR > 1 || cfg.layout.measures === 'rows') {
      var g4 = group(p, 'Outer row headers');
      g4.appendChild(segRow('Orientation', 'headers.rowOuterOrient', ORIENT));
      g4.appendChild(segRow('Align', 'headers.rowOuterAlign', H_ALIGN));
      g4.appendChild(segRow('Up / down', 'headers.rowOuterVAlign', V_ALIGN));
      textStyleRows(g4, 'headers.rowOuter');
    }

    var g5 = group(p, 'All headers');
    g5.appendChild(checkboxRow('Merge repeated members', 'headers.merge'));
    g5.appendChild(help('On: an outer member spans its children. Off: it is written next to every child.'));
    g5.appendChild(checkboxRow('Wrap long names', 'headers.wrap'));
    g5.appendChild(colorRow('Background', 'headers.bg'));
    g5.appendChild(rangeRow('Opacity', 'headers.bgOpacity', 0, 100, 1, '%'));
    g5.appendChild(checkboxRow('Lines between groups', 'headers.lines', rebuild));
    if (H.lines) g5.appendChild(colorRow('Line colour', 'headers.lineColor'));

    var g6 = group(p, 'Top-left corner');
    g6.appendChild(selectRow('Shows', 'headers.corner', [['none', 'Nothing'], ['fields', 'Row field names'], ['custom', 'Text']], null, rebuild));
    if (H.corner === 'custom') g6.appendChild(textRow('Text', 'headers.cornerText', 'e.g. From \\ To'));
    if (H.corner !== 'none') fontRows(g6, 'headers.cornerStyle');

    var g7 = group(p, 'Colour per member');
    g7.appendChild(help('Colours a member’s header on both axes, e.g. one colour per product family. Empty = the header colour above.'));
    if (!info.members.length) note(g7, 'No members yet.');
    var lst = h('div', { className: 'memberlist' });
    info.members.forEach(function (m) {
      var r = optColorRow(m, ['headers', 'memberColors', m], H.row.color);
      if (focus.member === m) { r.style.outline = '2px solid var(--accent)'; setTimeout(function () { r.scrollIntoView({ block: 'center' }); }, 0); }
      lst.appendChild(r);
    });
    g7.appendChild(lst);
  }

  // ---------------------------------------------------------------------------
  // Totals tab
  // ---------------------------------------------------------------------------
  function buildTotalsTab (p) {
    var T = cfg.totals;
    var RF = info.rowFields; var CF = info.colFields;
    if (cfg.layout.transpose) { var t = RF; RF = CF; CF = t; }
    var g1 = group(p, 'Grand totals');
    g1.appendChild(checkboxRow('Total row', 'totals.rowGrand', rebuild));
    if (T.rowGrand) {
      g1.appendChild(segRow('Position', 'totals.rowGrandPos', [['bottom', 'Bottom'], ['top', 'Top']]));
      g1.appendChild(textRow('Label', 'totals.rowGrandLabel', 'Total'));
    }
    g1.appendChild(help('Adds up each column (e.g. “IN” in a From → To matrix).'));
    g1.appendChild(checkboxRow('Total column', 'totals.colGrand', rebuild));
    if (T.colGrand) {
      g1.appendChild(segRow('Position', 'totals.colGrandPos', [['right', 'Right'], ['left', 'Left']]));
      g1.appendChild(textRow('Label', 'totals.colGrandLabel', 'Total'));
    }
    g1.appendChild(help('Adds up each row (e.g. “OUT”).'));

    var g2 = group(p, 'Group totals (subtotals)');
    var any = false;
    RF.slice(0, -1).forEach(function (f, i) { any = true; g2.appendChild(checkboxRow('Per ' + f.name + ' (rows)', ['totals', 'rowSubs', String(i)])); });
    CF.slice(0, -1).forEach(function (f, i) { any = true; g2.appendChild(checkboxRow('Per ' + f.name + ' (columns)', ['totals', 'colSubs', String(i)])); });
    if (!any) note(g2, 'Drop two or more fields on <b>Rows</b> or <b>Columns</b> to get group totals.');
    g2.appendChild(textRow('Label', 'totals.subLabel', '{member} total'));
    g2.appendChild(help('{member} is replaced by the group’s name.'));
    g2.appendChild(checkboxRow('Fold groups', 'totals.collapsible'));
    g2.appendChild(help('Click ▾ next to an outer header to fold the group into one row or column of totals; ▸ unfolds it. Right-click → Fold all.'));

    var g3 = group(p, 'Total cells');
    g3.appendChild(checkboxRow('Draw as tiles', 'totals.tile', rebuild));
    if (T.tile) g3.appendChild(colorRow('Tile colour', 'totals.bg'));
    fontRows(g3, 'totals.value');
    var n3 = note(g3, 'How each measure adds up: <a href="#" data-tab="measures">Measures tab</a>. % of total on totals: <a href="#" data-tab="calc">Calculations tab</a>.');
    tabLink(n3);
    var g4 = group(p, 'Total labels');
    textStyleRows(g4, 'totals.label');
    var g5 = group(p, 'Number format');
    labelFmt(g5, 'totals.fmt');
  }

  // ---------------------------------------------------------------------------
  // Sort tab
  // ---------------------------------------------------------------------------
  function buildSortTab (p) {
    var g1 = group(p, 'Order of members');
    g1.appendChild(selectRow('Rows', 'sort.rows', Mx.SORTS));
    g1.appendChild(selectRow('Columns', 'sort.cols', Mx.SORTS));
    g1.appendChild(help('Applies at every level, within each group. Total = the main measure added up across the other axis. Dates sort by date.'));
    var g2 = group(p, 'Rows by a column');
    var opts = [['', 'Off']].concat((info.cols || []).map(function (c) { return [c.key, c.name]; }));
    g2.appendChild(selectRow('Sort rows by', 'sort.rowsByCol', opts, null, rebuild));
    if (cfg.sort.rowsByCol) g2.appendChild(segRow('Direction', 'sort.rowsByDir', [['desc', 'High to low'], ['asc', 'Low to high']]));
    g2.appendChild(help('Or click a column header in the matrix: high to low, low to high, off.'));
  }

  // ---------------------------------------------------------------------------
  // Tooltip & actions tab
  // ---------------------------------------------------------------------------
  function buildTooltipTab (p) {
    var g1 = group(p, 'Tooltip');
    g1.appendChild(checkboxRow('Show tooltip', 'tooltip.show'));
    g1.appendChild(checkboxRow('Every measure', 'tooltip.showAll'));
    g1.appendChild(checkboxRow('% of row, column and table', 'tooltip.showPct'));
    g1.appendChild(checkboxRow('Tooltip tile measures', 'tooltip.showExtra'));
    g1.appendChild(checkboxRow('Full numbers', 'tooltip.fullNumbers'));
    g1.appendChild(help('Full numbers: no K / M / B, and Tableau’s own format when the Numbers format is Workbook.'));

    var g2 = group(p, 'Mouse');
    g2.appendChild(checkboxRow('Highlight row and column', 'interaction.crosshair', rebuild));
    if (cfg.interaction.crosshair) g2.appendChild(colorRow('Highlight colour', 'interaction.crosshairColor'));
    g2.appendChild(checkboxRow('Click a column header to sort', 'interaction.headerSort'));
    g2.appendChild(checkboxRow('Right-click menu', 'interaction.rightClickMenu'));
    g2.appendChild(selectRow('Double-click', 'interaction.dblclick', [['format', 'Opens its settings'], ['none', 'Nothing']]));
    g2.appendChild(checkboxRow('Click selects in Tableau', 'interaction.selectInTableau'));
    g2.appendChild(help('Selects the cell’s marks, so dashboard filter and highlight actions run.'));
  }

  // ---------------------------------------------------------------------------
  // Export tab
  // ---------------------------------------------------------------------------
  function buildExportTab (p) {
    var g1 = group(p, 'Export button');
    g1.appendChild(segRow('Show', 'export.button', [['hover', 'On hover'], ['always', 'Always'], ['never', 'Never']]));
    g1.appendChild(help('The button at the top right, and the right-click menu, export to Excel or CSV and copy the table.'));
    var g2 = group(p, 'Files');
    g2.appendChild(textRow('File name', 'export.fileName', 'Empty = the title'));
    g2.appendChild(help('Today’s date is added, e.g. “Transfers 2026-10-20.xlsx”.'));
    var g3 = group(p, 'Excel — as shown');
    g3.appendChild(checkboxRow('Title and explanation on top', 'export.includeTitle'));
    g3.appendChild(segRow('Smaller values', 'export.excelSecondary', [['rich', 'In the cell, like the matrix'], ['omit', 'Leave out']]));
    g3.appendChild(help('“In the cell” keeps the look (two sizes of text in one cell), but those cells are text. “Leave out” keeps every value a number Excel can add up.'));
    var g4 = group(p, 'Excel and CSV — data');
    g4.appendChild(checkboxRow('Add shown calculations', 'export.dataPct'));
    g4.appendChild(help('Adds a column for each calculation shown in the cells (% of total, difference, …) of the main measure.'));
    g4.appendChild(checkboxRow('Add total rows', 'export.dataTotals'));
    note(p, 'Tableau Desktop can block downloads from extensions. Then use <b>Copy table</b> and paste into Excel: colours and number formats come along. Tableau Server and Cloud in a browser download normally.');
  }

  // ---------------------------------------------------------------------------
  // Numbers + Card (Bar Chart's)
  // ---------------------------------------------------------------------------
  function allLabelFmtPaths () {
    return [['cells', 'fmt'], ['totals', 'fmt'], ['metrics', 'diff', 'fmt'], ['metrics', 'running', 'fmt']];
  }

  function copyGlobalToAll () {
    allLabelFmtPaths().forEach(function (pth) {
      var last = pth[pth.length - 1];
      var o = pth.slice(0, -1).reduce(function (x, k) { return x[k]; }, cfg);
      o[last] = Mx.clone(cfg.format);
      if (pth[1] === 'diff') o[last].plusSign = true;
    });
    changed();
  }

  function optColorRow (label, path, fallback) {
    var r = row(label);
    var wrap = h('div', { className: 'inline' });
    var cur = get(path);
    var picker = h('input', { type: 'color', value: Mx.normalizeHex(cur) || Mx.normalizeHex(fallback) || '#000000' });
    var hex = h('input', { type: 'text', className: 'hex', value: cur || '', placeholder: fallback || 'default', maxLength: 7, spellcheck: false });
    var reset = h('button', { type: 'button', className: 'btn btn--small', textContent: 'Reset' });
    picker.addEventListener('input', function () { hex.value = picker.value.toUpperCase(); set(path, hex.value); });
    hex.addEventListener('input', function () {
      var v = Mx.normalizeHex(hex.value);
      hex.classList.toggle('is-invalid', !!hex.value && !v);
      if (v) { picker.value = v; set(path, v); }
    });
    reset.addEventListener('click', function () {
      var keys = P(path); var last = keys.pop();
      var o = keys.reduce(function (a, k) { return a && a[k]; }, cfg);
      if (o) delete o[last];
      hex.value = ''; picker.value = Mx.normalizeHex(fallback) || '#000000';
      changed();
    });
    wrap.append(picker, hex, reset);
    r.appendChild(wrap);
    return r;
  }

  function buildNumbersTab (p) {
    var g1 = group(p, 'Scope');
    g1.appendChild(segRow('Format', 'numbers.mode', [['all', 'All numbers the same'], ['each', 'Each part its own']], function () {
      if (cfg.numbers.mode === 'each') copyGlobalToAll();
      rebuild();
    }));
    g1.appendChild(help(cfg.numbers.mode === 'all'
      ? 'Cell values, totals, differences, running totals and tooltips use the format below. A measure can still have its own format (Measures tab).'
      : 'Cells, totals, differences and running totals each have their own format on their tabs (Cells, Totals, Calculations). They started as copies of the format below.'));
    var g2 = group(p, cfg.numbers.mode === 'all' ? 'Number format' : 'Shared format (tooltips)');
    fmtRows(g2, 'format');
    if (cfg.numbers.mode === 'each') {
      var btn = h('button', { type: 'button', className: 'btn', textContent: 'Copy this format to every part' });
      btn.addEventListener('click', function () { copyGlobalToAll(); setStatus('Copied to every part'); });
      g2.appendChild(btn);
    }
    var g3 = group(p, 'Chart text');
    g3.appendChild(fontFamilyRow('Font', 'numbers.font'));
    g3.appendChild(help('Font of the matrix and the tooltip. Cell, header and total fonts are on their tabs.'));
  }

  function buildCardTab (p) {
    var g1 = group(p, 'Card');
    g1.appendChild(numberRow('Padding (px)', 'card.padding', 0, 60, 1));
    g1.appendChild(numberRow('Space above matrix', 'card.gap', 0, 60, 1));

    var g2 = group(p, 'Background');
    g2.appendChild(colorRow('Color', 'card.bgColor'));
    g2.appendChild(rangeRow('Opacity', 'card.bgOpacity', 0, 100, 1, '%'));
    g2.appendChild(help('0% is fully transparent. Set worksheet and container shading to None in Tableau to see through.'));

    var g3 = group(p, 'Matrix area background');
    g3.appendChild(colorRow('Color', 'card.plotBg'));
    g3.appendChild(rangeRow('Opacity', 'card.plotBgOpacity', 0, 100, 1, '%'));
    g3.appendChild(help('Shades only the area with the matrix, e.g. a light panel behind the cells.'));
  }

  function help (text) { return h('div', { className: 'help', textContent: text }); }

  /** Path helper: P('a.b', 'c.d') or P(['series', key], 'label') → array. */
  function P (base, rest) {
    var a = Array.isArray(base) ? base.slice() : String(base).split('.');
    return rest == null ? a : a.concat(String(rest).split('.'));
  }

  // ---------------------------------------------------------------------------
  // Presets tab: export / import the chart's settings (file, clipboard, or
  // "My presets" kept in this browser)
  // ---------------------------------------------------------------------------
  var PRESET_TYPE = 'tableau-matrix-table-preset';
  var PRESET_STORE = 'matrixtable:presets:v1';

  /**
   * Settings tied to this worksheet's fields and members (measure names and
   * formats, member colours, subtotals per field). "Look only" presets leave them out, and an
   * import keeps the chart's own unless asked otherwise.
   */
  var FIELD_PATHS = [
    'measures', 'layout.mainMeasure', 'headers.memberColors', 'totals.rowSubs', 'totals.colSubs',
    'sort.rowsByCol', 'colors.by', 'title.text', 'explanation.text', 'export.fileName'
  ];

  var presetUi = { scope: 'look', name: '', keepFields: true, msg: null, pasted: '' };

  function getAt (o, path) { return path.split('.').reduce(function (x, k) { return x == null ? undefined : x[k]; }, o); }

  function setAt (o, path, v) {
    var keys = path.split('.');
    var last = keys.pop();
    var t = keys.reduce(function (x, k) { if (x[k] == null || typeof x[k] !== 'object') x[k] = {}; return x[k]; }, o);
    if (v === undefined) delete t[last]; else t[last] = v;
  }

  function delAt (o, path) { setAt(o, path, undefined); }

  /** Only the settings that differ from the defaults (smaller files, future-proof). */
  function diffFromDefaults (cur, def) {
    if (Array.isArray(cur) || cur == null || typeof cur !== 'object') return JSON.stringify(cur) === JSON.stringify(def) ? undefined : Mx.clone(cur);
    if (def == null || typeof def !== 'object' || Array.isArray(def) || !Object.keys(def).length) {
      return Object.keys(cur).length ? Mx.clone(cur) : undefined;
    }
    var out = {};
    Object.keys(cur).forEach(function (k) {
      var d = diffFromDefaults(cur[k], def[k]);
      if (d !== undefined) out[k] = d;
    });
    return Object.keys(out).length ? out : undefined;
  }

  function makePreset (scope, name) {
    var s = Mx.clone(cfg);
    if (scope === 'look') FIELD_PATHS.forEach(function (p) { delAt(s, p); });
    return {
      type: PRESET_TYPE,
      version: 1,
      name: name || 'Matrix preset',
      scope: scope,
      exported: new Date().toISOString(),
      settings: diffFromDefaults(s, Mx.DEFAULTS) || {}
    };
  }

  /** Accepts a preset file, or the raw settings JSON of a workbook. */
  function parsePreset (text) {
    var o;
    try { o = JSON.parse(String(text).replace(/^﻿/, '')); } catch (e) { throw new Error('This isn’t valid JSON. Paste the whole preset, from { to }.'); }
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('This isn’t a Matrix Table preset.');
    if (o.type && o.type !== PRESET_TYPE) throw new Error('This preset is for another extension (' + o.type + ').');
    if (o.type === PRESET_TYPE) {
      if (!o.settings || typeof o.settings !== 'object') throw new Error('The preset has no settings.');
      return o;
    }
    if (o.matrixTable1) { try { o = typeof o.matrixTable1 === 'string' ? JSON.parse(o.matrixTable1) : o.matrixTable1; } catch (e) { /* fall through */ } }
    var known = Object.keys(o).filter(function (k) { return k in Mx.DEFAULTS; });
    if (!known.length) throw new Error('No Matrix Table settings found in this file.');
    return { type: PRESET_TYPE, version: 1, name: 'Imported settings', scope: 'all', settings: o };
  }

  function applyImported (pr, keepFields) {
    var next = Mx.merge(Mx.DEFAULTS, pr.settings);
    FIELD_PATHS.forEach(function (p) {
      var has = getAt(pr.settings, p) !== undefined;
      if (keepFields || pr.scope === 'look' || !has) setAt(next, p, Mx.clone(getAt(cfg, p)));
    });
    cfg = next;
    changed();
  }

  function loadStore () {
    try { var a = JSON.parse(localStorage.getItem(PRESET_STORE) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }

  function saveStore (list) {
    try { localStorage.setItem(PRESET_STORE, JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  function fileName (name) {
    return (String(name || 'matrix-table-preset').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'matrix-table-preset') + '.json';
  }

  function download (text, name) {
    try {
      var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      var a = h('a', { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      return true;
    } catch (e) { return false; }
  }

  function copyText (text, ta) {
    var fallback = function () {
      try { ta.focus(); ta.select(); return document.execCommand('copy'); } catch (e) { return false; }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, fallback);
    }
    return Promise.resolve(fallback());
  }

  function presetMsg (g) {
    if (!presetUi.msg) return;
    g.appendChild(h('p', { className: 'preset-msg' + (presetUi.msg.error ? ' is-error' : ''), textContent: presetUi.msg.text }));
    presetUi.msg = null;
  }

  function say (text, error) { presetUi.msg = { text: text, error: !!error }; rebuild(); }

  function describe (pr) {
    var d = pr.exported ? new Date(pr.exported) : null;
    return (pr.scope === 'look' ? 'Look only' : 'Everything') + (d && !isNaN(d) ? ' · ' + d.toLocaleDateString() : '');
  }

  function buildPresetsTab (p) {
    presetMsg(p);
    // ---- Export
    var g1 = group(p, 'Export');
    g1.appendChild(help('Saves this matrix’s settings as a preset you can import into another Matrix Table, in this or any workbook.'));
    var rName = row('Preset name');
    var name = h('input', { type: 'text', value: presetUi.name, placeholder: 'e.g. Transfer matrix' });
    name.addEventListener('input', function () { presetUi.name = name.value; });
    rName.appendChild(name);
    g1.appendChild(rName);
    var rScope = row('Include');
    var seg = h('div', { className: 'seg' });
    [['look', 'Look only'], ['all', 'Everything']].forEach(function (o) {
      var b = h('button', { type: 'button', textContent: o[1] });
      b.setAttribute('aria-pressed', String(presetUi.scope === o[0]));
      b.addEventListener('click', function () { presetUi.scope = o[0]; rebuild(); });
      seg.appendChild(b);
    });
    rScope.appendChild(seg);
    g1.appendChild(rScope);
    g1.appendChild(help(presetUi.scope === 'look'
      ? 'Layout, calculations, cells, colours, headers, totals, numbers, card… Leaves out what belongs to these fields: measure names and formats, the main measure, colours per member, subtotals per field, sort by column, title text.'
      : 'Every setting, including measure names and formats, colours per member, subtotals and title text. Best for a copy of the same sheet.'));

    var ta = h('textarea', { className: 'preset-json', readOnly: true, spellcheck: false });
    var current = function () { return JSON.stringify(makePreset(presetUi.scope, presetUi.name.trim()), null, 2); };
    var btns = h('div', { className: 'inline preset-btns' });
    var bDl = h('button', { type: 'button', className: 'btn btn--small', textContent: 'Download .json' });
    var bCp = h('button', { type: 'button', className: 'btn btn--small', textContent: 'Copy' });
    var bSave = h('button', { type: 'button', className: 'btn btn--small', textContent: 'Save to My presets' });
    var bShow = h('button', { type: 'button', className: 'btn btn--small', textContent: 'Show JSON' });
    bDl.addEventListener('click', function () {
      var t = current();
      ta.value = t;
      say(download(t, fileName(presetUi.name)) ? 'Downloaded ' + fileName(presetUi.name) + '. If nothing appeared (Tableau Desktop can block downloads), use Copy and paste it into a text file.' : 'Download isn’t available here. Use Copy instead.', false);
    });
    bCp.addEventListener('click', function () {
      var t = current();
      ta.value = t; ta.hidden = false;
      copyText(t, ta).then(function (ok) { say(ok ? 'Copied. Paste it into a .json or text file, an email or chat.' : 'Couldn’t copy. Select the text below and copy it yourself.', !ok); });
    });
    bSave.addEventListener('click', function () {
      var nm = presetUi.name.trim() || 'Preset ' + (loadStore().length + 1);
      var list = loadStore().filter(function (x) { return x.name !== nm; });
      var pr = makePreset(presetUi.scope, nm);
      list.unshift(pr);
      say(saveStore(list) ? 'Saved “' + nm + '” to My presets.' : 'Couldn’t save in this browser. Download or copy the preset instead.', false);
    });
    bShow.addEventListener('click', function () { ta.value = current(); ta.hidden = !ta.hidden; });
    btns.append(bDl, bCp, bSave, bShow);
    g1.appendChild(btns);
    ta.hidden = true;
    g1.appendChild(ta);

    // ---- Import
    var g2 = group(p, 'Import');
    g2.appendChild(help('Applies a preset to this matrix. Cancel at the bottom undoes it.'));
    g2.appendChild((function () {
      var r = row('Keep this matrix’s');
      var input = h('input', { type: 'checkbox' });
      input.checked = presetUi.keepFields;
      input.addEventListener('change', function () { presetUi.keepFields = input.checked; });
      r.appendChild(h('div', { className: 'inline' }, [input, h('span', { className: 'help preset-inline-help', textContent: 'measure names and formats, member colours, subtotals, title text' })]));
      return r;
    })());
    var file = h('input', { type: 'file', accept: '.json,application/json,text/plain' });
    file.style.display = 'none';
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var pr = parsePreset(rd.result);
          applyImported(pr, presetUi.keepFields);
          say('Applied “' + (pr.name || f.name) + '” (' + describe(pr) + ').', false);
        } catch (e) { say(e.message, true); }
      };
      rd.onerror = function () { say('Couldn’t read the file.', true); };
      rd.readAsText(f);
    });
    var paste = h('textarea', { className: 'preset-json', spellcheck: false, placeholder: 'Or paste a preset here' });
    paste.value = presetUi.pasted;
    paste.addEventListener('input', function () { presetUi.pasted = paste.value; });
    var ib = h('div', { className: 'inline preset-btns' });
    var bFile = h('button', { type: 'button', className: 'btn btn--small', textContent: 'Choose file…' });
    bFile.addEventListener('click', function () { file.value = ''; file.click(); });
    var bPaste = h('button', { type: 'button', className: 'btn btn--small', textContent: 'Apply pasted' });
    bPaste.addEventListener('click', function () {
      if (!paste.value.trim()) { say('Paste a preset into the box first.', true); return; }
      try {
        var pr = parsePreset(paste.value);
        applyImported(pr, presetUi.keepFields);
        presetUi.pasted = '';
        say('Applied “' + pr.name + '” (' + describe(pr) + ').', false);
      } catch (e) { say(e.message, true); }
    });
    ib.append(bFile, bPaste, file);
    g2.appendChild(ib);
    g2.appendChild(paste);

    // ---- My presets (this browser)
    var g3 = group(p, 'My presets');
    var list = loadStore();
    if (!list.length) {
      g3.appendChild(h('p', { className: 'note', textContent: 'None yet. “Save to My presets” keeps a preset on this computer for this extension, ready for any workbook. Download or copy a preset to share it or move it to another computer.' }));
    } else {
      g3.appendChild(help('Kept on this computer for this extension (any workbook). Clearing the browser data of Tableau removes them, so download the ones you want to keep.'));
      list.forEach(function (pr, i) {
        var r = h('div', { className: 'preset-item' });
        var t = h('div', { className: 'preset-name' }, [h('b', { textContent: pr.name }), h('span', { className: 'help', textContent: ' ' + describe(pr) })]);
        var apply = h('button', { type: 'button', className: 'btn btn--small', textContent: 'Apply' });
        apply.addEventListener('click', function () { applyImported(pr, presetUi.keepFields); say('Applied “' + pr.name + '”.', false); });
        var dl = h('button', { type: 'button', className: 'btn btn--small', textContent: 'Download' });
        dl.addEventListener('click', function () { download(JSON.stringify(pr, null, 2), fileName(pr.name)); });
        var del = h('button', { type: 'button', className: 'btn btn--small', textContent: 'Delete', title: 'Delete this preset' });
        del.addEventListener('click', function () {
          if (del.dataset.sure) { var l = loadStore(); l.splice(i, 1); saveStore(l); say('Deleted “' + pr.name + '”.', false); return; }
          del.dataset.sure = '1'; del.textContent = 'Sure?';
          setTimeout(function () { delete del.dataset.sure; del.textContent = 'Delete'; }, 2500);
        });
        r.append(t, h('div', { className: 'inline' }, [apply, dl, del]));
        g3.appendChild(r);
      });
    }
  }
  function buildIconTab (p) {
    var ic = cfg.icon;

    var preview = h('div', { className: 'icon-preview' });
    var slot = h('div', { className: 'slot' });
    var name = h('div', { className: 'name' });
    preview.append(slot, name);
    var refreshPreview = function () {
      slot.innerHTML = '';
      slot.classList.remove('slot--dark');
      if (!ic.show) { name.textContent = 'Icon hidden'; return; }
      if (ic.source === 'builtin') {
        var r = Mx.iconHtml(ic.builtinId, ic.color);
        slot.innerHTML = r.html;
        slot.classList.toggle('slot--dark', !!r.icon.light);
        name.textContent = r.icon.label;
      } else if (ic.dataUrl) {
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth || 24; var hh = img.naturalHeight || 24;
          if (w >= hh) { img.style.width = '24px'; img.style.height = 'auto'; } else { img.style.height = '24px'; img.style.width = 'auto'; }
        };
        img.src = ic.dataUrl;
        slot.appendChild(img);
        name.textContent = ic.name || (ic.source === 'shape' ? 'Tableau shape' : 'Uploaded image');
      } else {
        name.textContent = 'No image chosen yet';
      }
    };
    refreshPreview();

    var g = group(p, 'Icon');
    g.appendChild(preview);
    g.appendChild(checkboxRow('Show icon', 'icon.show', function () { refreshPreview(); }));
    g.appendChild(rangeRow('Size', 'icon.size', 12, 96, 1, ' px'));
    g.appendChild(h('div', { className: 'help', textContent: 'Length of the icon\u2019s longer side. Figma default is 24 px; icons stay sharpest up to about 48 px.' }));

    var sources = [['builtin', 'Built-in'], ['shape', 'Tableau shapes'], ['upload', 'Upload']];
    var sourceRow = row('Source');
    var seg = h('div', { className: 'seg' });
    sources.forEach(function (s) {
      var b = h('button', { type: 'button', textContent: s[1] });
      b.setAttribute('aria-pressed', String(ic.source === s[0]));
      b.addEventListener('click', function () {
        ic.source = s[0];
        if (s[0] === 'builtin') ic.show = true;
        changed();
        buildTabs();
      });
      seg.appendChild(b);
    });
    sourceRow.appendChild(seg);
    g.appendChild(sourceRow);

    var body = group(p, sources.find(function (s) { return s[0] === ic.source; })[1]);

    if (ic.source === 'builtin') {
      var gridWrap = h('div');
      var fillGrid = function () {
        gridWrap.innerHTML = '';
        Mx.ICON_GROUPS.forEach(function (groupName) {
          var icons = Mx.ICONS.filter(function (icon) { return icon.group === groupName; });
          if (!icons.length) return;
          gridWrap.appendChild(h('div', { className: 'grid-title', textContent: groupName + ' (' + icons.length + ')' }));
          var grid = h('div', { className: 'grid' });
          icons.forEach(function (icon) {
            var cell = h('button', { type: 'button', className: 'cell', title: icon.label });
            if (icon.light) cell.classList.add('cell--dark');
            cell.innerHTML = Mx.iconHtml(icon.id, ic.color).html;
            if (icon.id === ic.builtinId) cell.classList.add('is-active');
            cell.addEventListener('click', function () {
              ic.builtinId = icon.id;
              ic.show = true;
              Array.prototype.forEach.call(gridWrap.querySelectorAll('.cell'), function (c) { c.classList.remove('is-active'); });
              cell.classList.add('is-active');
              changed();
              refreshPreview();
            });
            grid.appendChild(cell);
          });
          gridWrap.appendChild(grid);
        });
      };
      body.appendChild(colorRow('Icon color', 'icon.color', function () { refreshPreview(); fillGrid(); }));
      body.appendChild(h('div', { className: 'help', textContent: 'Recolours the built-in icons.' }));
      fillGrid();
      body.appendChild(gridWrap);
    } else if (ic.source === 'shape') {
      buildShapePicker(body, refreshPreview);
    } else {
      buildUpload(body, refreshPreview);
    }
  }

  /** Lists Tableau shape palettes served by serve.py (/shapes/index.json). */
  function buildShapePicker (body, refreshPreview) {
    var note = h('p', { className: 'note', textContent: 'Loading shape palettes…' });
    body.appendChild(note);

    var loadIndex = shapeIndex ? Promise.resolve(shapeIndex)
      : fetch(baseUrl() + 'shapes/index.json', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (j) { shapeIndex = j; return j; });

    loadIndex.then(function (index) {
      var palettes = (index.palettes || []).filter(function (pl) { return pl.files && pl.files.length; });
      if (!palettes.length) {
        note.innerHTML = 'No shape palettes found. serve.py looked in:<br><code>' +
          (index.searched || []).map(escapeHtml).join('</code><br><code>') +
          '</code><br>Set <code>KPI_SHAPES_DIRS</code> before starting it to add folders.';
        return;
      }
      note.textContent = 'Shapes are copied into the workbook when picked, so they keep working after publishing.';

      var selRow = row('Palette');
      var sel = h('select');
      palettes.forEach(function (pl, i) { sel.appendChild(h('option', { value: String(i), textContent: pl.name + ' (' + pl.files.length + ')' })); });
      var remembered = palettes.findIndex(function (pl) { return cfg.icon.name.indexOf(pl.name + ' / ') === 0; });
      sel.value = String(remembered >= 0 ? remembered : 0);
      selRow.appendChild(sel);
      body.appendChild(selRow);

      var grid = h('div', { className: 'grid' });
      body.appendChild(grid);

      var fill = function () {
        grid.innerHTML = '';
        var pl = palettes[Number(sel.value)];
        pl.files.forEach(function (f) {
          var label = pl.name + ' / ' + f.name;
          var cell = h('button', { type: 'button', className: 'cell', title: f.name });
          cell.appendChild(h('img', { src: baseUrl() + f.url, alt: '', loading: 'lazy' }));
          if (cfg.icon.source === 'shape' && cfg.icon.name === label) cell.classList.add('is-active');
          cell.addEventListener('click', function () {
            fetch(baseUrl() + f.url).then(function (r) { return r.blob(); })
              .then(blobToIconDataUrl)
              .then(function (url) {
                cfg.icon.source = 'shape';
                cfg.icon.dataUrl = url;
                cfg.icon.name = label;
                cfg.icon.show = true;
                Array.prototype.forEach.call(grid.children, function (c) { c.classList.remove('is-active'); });
                cell.classList.add('is-active');
                changed();
                refreshPreview();
              })
              .catch(function (e) { setStatus('Could not load that shape: ' + e.message); });
          });
          grid.appendChild(cell);
        });
      };
      sel.addEventListener('change', fill);
      fill();
    }).catch(function () {
      note.innerHTML = 'Tableau shapes are listed by the local helper server. Start the extension with ' +
        '<code>./serve.sh</code> (it runs <code>serve.py</code>), then reopen this dialog. ' +
        'You can still upload a shape file from the <b>Upload</b> tab.';
    });
  }

  function buildUpload (body, refreshPreview) {
    var drop = h('label', { className: 'drop' });
    var input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/svg+xml,image/webp,image/bmp,.ico' });
    drop.append(input,
      h('b', { textContent: 'Choose an image' }),
      h('span', { textContent: 'or drop it here — PNG, SVG, JPG, GIF. Tableau custom shapes work too.' }));
    body.appendChild(drop);
    body.appendChild(h('p', {
      className: 'note',
      textContent: 'Scaled to 24 px on its longer side. Raster images are stored at 96 px for sharp rendering on high-DPI screens.'
    }));

    var take = function (file) {
      if (!file) return;
      blobToIconDataUrl(file).then(function (url) {
        cfg.icon.source = 'upload';
        cfg.icon.dataUrl = url;
        cfg.icon.name = file.name;
        cfg.icon.show = true;
        changed();
        refreshPreview();
      }).catch(function (e) { setStatus('Could not read that image: ' + e.message); });
    };
    input.addEventListener('change', function () { take(input.files[0]); });
    ['dragenter', 'dragover'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) { take(e.dataTransfer.files[0]); });
  }

  function buildTextTab (p) {
    var g1 = group(p, 'Title');
    g1.appendChild(checkboxRow('Show title', 'title.show'));
    g1.appendChild(textRow('Title', 'title.text', 'Defaults to the measure names'));
    g1.appendChild(segRow('Alignment', 'title.align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]));
    g1.appendChild(h('div', { className: 'help', textContent: 'The explanation text follows the same alignment.' }));
    fontRows(g1, 'title');

    var g2 = group(p, 'Explanation text');
    g2.appendChild(checkboxRow('Show explanation', 'explanation.show'));
    g2.appendChild(checkboxRow('Keep space when empty', 'explanation.reserveSpace'));
    g2.appendChild(h('div', { className: 'help', textContent: 'Reserves the explanation line even when it is empty or hidden, so charts line up across a dashboard.' }));
    g2.appendChild(textRow('Text', 'explanation.text', 'e.g. % Top-Up vs Local Transfer'));
    fontRows(g2, 'explanation', true);
  }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------
  function fontRows (g, section, withItalic) {
    g.appendChild(fontFamilyRow('Font', P(section, 'font')));
    g.appendChild(numberRow('Size (px)', P(section, 'size'), 6, 160, 1));
    g.appendChild(selectRow('Weight', P(section, 'weight'), WEIGHTS));
    g.appendChild(colorRow('Color', P(section, 'color')));
    if (withItalic !== false) g.appendChild(checkboxRow('Italic', P(section, 'italic')));
  }

  function fontFamilyRow (label, path) {
    var r = row(label);
    var wrap = h('div', { className: 'inline' });
    var sel = h('select');
    Mx.FONTS.forEach(function (f) { sel.appendChild(h('option', { value: f, textContent: f })); });
    sel.appendChild(h('option', { value: '__custom', textContent: 'Other…' }));
    var custom = h('input', { type: 'text', placeholder: 'Installed font name' });
    var current = get(path);
    if (Mx.FONTS.indexOf(current) >= 0) { sel.value = current; custom.hidden = true; } else { sel.value = '__custom'; custom.value = current; }
    sel.addEventListener('change', function () {
      custom.hidden = sel.value !== '__custom';
      if (sel.value !== '__custom') { set(path, sel.value); } else { custom.focus(); }
    });
    custom.addEventListener('input', function () { if (custom.value.trim()) set(path, custom.value.trim()); });
    wrap.append(sel, custom);
    r.appendChild(wrap);
    return r;
  }

  function textRow (label, path, placeholder) {
    var r = row(label);
    var cur = get(path);
    var input = h('input', { type: 'text', value: cur == null ? '' : cur, placeholder: placeholder || '' });
    input.addEventListener('input', function () { set(path, input.value); });
    r.appendChild(input);
    return r;
  }

  function numberRow (label, path, min, max, step) {
    var r = row(label);
    var input = h('input', { type: 'number', min: min, max: max, step: step, value: get(path) });
    input.addEventListener('input', function () {
      var n = Number(input.value);
      if (input.value === '' || !isFinite(n)) return;
      set(path, Math.max(min, Math.min(max, n)));
    });
    r.appendChild(input);
    return r;
  }

  function rangeRow (label, path, min, max, step, unit) {
    var r = row(label);
    var wrap = h('div', { className: 'inline' });
    var input = h('input', { type: 'range', min: min, max: max, step: step, value: get(path) });
    var out = h('span', { className: 'readout', textContent: get(path) + (unit || '') });
    input.addEventListener('input', function () { set(path, Number(input.value)); out.textContent = input.value + (unit || ''); });
    wrap.append(input, out);
    r.appendChild(wrap);
    return r;
  }

  function selectRow (label, path, options, help, after) {
    var r = row(label);
    var sel = h('select');
    options.forEach(function (o) { sel.appendChild(h('option', { value: String(o[0]), textContent: o[1] })); });
    sel.value = String(get(path));
    if (sel.selectedIndex < 0) sel.selectedIndex = 0;
    sel.addEventListener('change', function () {
      var orig = options.find(function (o) { return String(o[0]) === sel.value; })[0];
      set(path, orig);
      if (after) after();
    });
    r.appendChild(sel);
    if (help) { var frag = document.createDocumentFragment(); frag.append(r, h('div', { className: 'help', textContent: help })); return wrapRows(frag); }
    return r;
  }

  function segRow (label, path, options, after) {
    var r = row(label);
    var seg = h('div', { className: 'seg' });
    options.forEach(function (o) {
      var b = h('button', { type: 'button', textContent: o[1] });
      b.setAttribute('aria-pressed', String(get(path) === o[0]));
      b.addEventListener('click', function () {
        set(path, o[0]);
        Array.prototype.forEach.call(seg.children, function (c) { c.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        if (after) after();
      });
      seg.appendChild(b);
    });
    r.appendChild(seg);
    return r;
  }

  function checkboxRow (label, path, after) {
    var r = row(label);
    var input = h('input', { type: 'checkbox' });
    input.checked = !!get(path);
    input.addEventListener('change', function () { set(path, input.checked); if (after) after(); });
    r.appendChild(h('div', { className: 'inline' }, [input]));
    return r;
  }

  function colorRow (label, path, after) {
    var r = row(label);
    var wrap = h('div', { className: 'inline' });
    var picker = h('input', { type: 'color', value: Mx.normalizeHex(get(path)) || '#000000' });
    var hex = h('input', { type: 'text', className: 'hex', value: get(path), maxLength: 7, spellcheck: false });
    picker.addEventListener('input', function () {
      hex.value = picker.value.toUpperCase(); hex.classList.remove('is-invalid');
      set(path, hex.value); if (after) after();
    });
    hex.addEventListener('input', function () {
      var v = Mx.normalizeHex(hex.value);
      hex.classList.toggle('is-invalid', !v);
      if (v) { picker.value = v; set(path, v); if (after) after(); }
    });
    hex.addEventListener('blur', function () { hex.value = get(path); hex.classList.remove('is-invalid'); });
    wrap.append(picker, hex);
    r.appendChild(wrap);
    return r;
  }

  function wrapRows (frag) { var d = h('div'); d.appendChild(frag); return d; }

  function row (label) {
    var r = h('div', { className: 'row' });
    r.appendChild(h('label', { textContent: label }));
    return r;
  }

  function group (parent, title) {
    var g = h('div', { className: 'group' });
    g.appendChild(h('h3', { className: 'group-title', textContent: title }));
    parent.appendChild(g);
    return g;
  }

  function h (tag, props, children) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'role') n.setAttribute('role', props[k]); else n[k] = props[k];
    });
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  // ---------------------------------------------------------------------------
  // Images
  // ---------------------------------------------------------------------------

  /**
   * Converts an image file/blob into a compact data URL for the workbook.
   * Small SVGs are kept as vectors; everything else is rasterised so its
   * longer side is 96 px (4× the 24 px display size).
   */
  function blobToIconDataUrl (blob) {
    return readAsDataUrl(blob).then(function (url) {
      var isSvg = /svg/i.test(blob.type) || /^data:image\/svg/i.test(url);
      if (isSvg && url.length < 60000) return url;
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth || 96;
          var hh = img.naturalHeight || 96;
          var k = 96 / Math.max(w, hh);
          if (k >= 1 && url.length < 60000) { resolve(url); return; }
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * Math.min(k, 1)));
          c.height = Math.max(1, Math.round(hh * Math.min(k, 1)));
          var ctx = c.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/png'));
        };
        img.onerror = function () { reject(new Error('unsupported image format')); };
        img.src = url;
      });
    });
  }

  function readAsDataUrl (blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }

  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // State + persistence
  // ---------------------------------------------------------------------------
  function get (path) {
    return P(path).reduce(function (o, k) { return o == null ? undefined : o[k]; }, cfg);
  }

  function set (path, value) {
    var keys = P(path);
    var last = keys.pop();
    keys.reduce(function (o, k) {
      if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
      return o[k];
    }, cfg)[last] = value;
    changed();
  }

  function changed () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 180);
  }

  function flush () {
    clearTimeout(saveTimer);
    return persist();
  }

  function persist () {
    try {
      setStatus('Saving…');
      return Mx.write(cfg).then(function () { setStatus('Saved'); })
        .catch(function (err) { setStatus('Could not save: ' + (err && err.message)); console.error(err); });
    } catch (err) {
      console.error(err);
      return Promise.resolve();
    }
  }

  function setStatus (text) {
    document.getElementById('status').textContent = text;
  }

  function close () {
    tableau.extensions.ui.closeDialog(' ');
  }

  function baseUrl () {
    return window.location.href.split(/[?#]/)[0].replace(/[^/]*$/, '');
  }

  function escapeHtml (s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }


  window.MatrixTableConfigure = { init: init };
})();
