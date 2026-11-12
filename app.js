/* Shift & Leave Planner — UI. All logic lives in engine.js; this file only draws and stores. */
(function () {
  'use strict';
  const E = window.Engine, T = E.TYPES;
  const KEY = 'shiftLeavePlanner.v2';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let S, ver = 0, cache = {}, storageOK = true, loadWarn = '', savedAt = '';
  const today = E.todayISO(), tp = E.parse(today);
  const ui = { tab: 'home', year: tp.y, month: tp.m, mode: 'month', range: false, rangeStart: null, bank: 'vac', projDate: E.addDays(today, 30), ledgerOpen: false, open: {}, msg: {}, exp: { duty: true, calId: 'all', from: '2027-01-01', to: '2027-12-31', vacation: true, sick: true, edo: true, notes: false, others: false }, prn: { kind: 'cal', calId: 'c1', year: 2027, filled: true } };
  let sheet = null, flash = '';

  /* ---------- tiny DOM helper (textContent only, so notes and names can never inject markup) ---------- */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'selected') el.selected = !!v;
      else if (k === 'disabled') el.disabled = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) { if (kid === null || kid === undefined || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
    return el;
  }
  const fmtH = (n) => String(Math.round(n * 100) / 100);
  function fmtDate(s, style) {
    const p = E.parse(s); if (!p) return s;
    const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
    const o = style === 'short' ? { month: 'short', day: 'numeric' } : style === 'mid' ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' } : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
    return dt.toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC' }, o));
  }
  // append that skips null/false and flattens arrays (DOM append() would print "null" / "[object ...]")
  function put(parent, ...kids) { for (const k of kids.flat(Infinity)) { if (k === null || k === undefined || k === false) continue; parent.append(k.nodeType ? k : document.createTextNode(String(k))); } }
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function toast(msg, undoFn) {
    const t = h('div', { class: 'toast' }, msg, undoFn ? h('button', { class: 'undo', onclick: () => { undoFn(); t.remove(); } }, 'Undo') : null);
    document.body.append(t); setTimeout(() => t.remove(), undoFn ? 6000 : 2600);
  }
  const cals = () => S.settings.calendars;
  const calIdx = (id) => Math.max(0, cals().findIndex((c) => c.id === id));
  const calTitle = (id) => { const c = E.calById(S, id); return c ? (c.title || 'Calendar') : '?'; };
  const colorCls = (id) => 'u' + ((calIdx(id) % 3) + 1);
  const spots = () => S.settings.spots;

  /* ---------- state ---------- */
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { storageOK = false; }
    if (!raw) return E.defaultState();
    try {
      const r = E.validateState(JSON.parse(raw));
      if (r.ok) return r.state;
      try { localStorage.setItem(KEY + '.corrupt', raw); } catch (e) { /* ignore */ }
      loadWarn = 'Your saved data failed validation (' + r.errors.slice(0, 3).join('; ') + '). A copy was kept under a recovery key and the app started fresh.';
    } catch (e) {
      try { localStorage.setItem(KEY + '.corrupt', raw); } catch (e2) { /* ignore */ }
      loadWarn = 'Your saved data could not be read. A copy was kept and the app started fresh.';
    }
    return E.defaultState();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); storageOK = true; const d = new Date(); savedAt = 'Saved ' + d.getHours() + ':' + E.pad(d.getMinutes()); }
    catch (e) { storageOK = false; savedAt = ''; }
  }
  function mutate(fn) { fn(); ver++; cache = {}; save(); render(); }
  const snap = () => JSON.stringify({ entries: S.entries, names: S.names });
  function restore(s) { const o = JSON.parse(s); mutate(() => { S.entries = o.entries; S.names = o.names; }); }
  function getL(bank) { if (!cache['L' + bank]) cache['L' + bank] = E.buildLedger(bank, S); return cache['L' + bank]; }
  function byDate() {
    if (!cache.byDate) { const m = {}; for (const e of S.entries) (m[e.date] = m[e.date] || []).push(e); cache.byDate = m; }
    return cache.byDate;
  }
  function flagMap() {
    if (!cache.flags) { const m = {}; for (const b of ['vac', 'sick']) for (const r of getL(b).events) if (r.kind === 'deduct' && (r.shortfall > 0 || r.early)) m[r.entry.id] = r; cache.flags = m; }
    return cache.flags;
  }
  function projStatement(bank, date) {
    const name = bank === 'vac' ? 'vacation' : 'sick leave';
    if (E.dayNum(date) < E.dayNum(S.settings.baselineDate)) return 'Your balances start on ' + fmtDate(S.settings.baselineDate, 'mid') + '. Nothing is projected before that date.';
    return 'Based on your starting balance, accrued hours, and previously scheduled ' + name + ', your projected available ' + name + ' balance on ' + fmtDate(date, 'mid') + ' will be ' + fmtH(getL(bank).balanceOn(date)) + ' hours.';
  }
  const stmtBox = (bank, date) => h('div', { class: 'stmt' + (E.dayNum(date) >= E.dayNum(S.settings.baselineDate) && getL(bank).balanceOn(date) < 0 ? ' neg' : '') }, projStatement(bank, date));

  /* ---------- shell ---------- */
  const TABS = [['home', '⌂', 'Home'], ['calendar', '▦', 'Calendar'], ['leave', '⏱', 'Leave'], ['data', '⇪', 'Export'], ['settings', '⚙', 'Settings']];
  function render() {
    const root = document.getElementById('app');
    const prev = document.getElementById('content');
    const top = prev ? prev.scrollTop : 0;
    const body = { home: viewHome, calendar: viewCalendar, leave: viewLeave, data: viewData, settings: viewSettings, help: viewHelp }[ui.tab]();
    root.replaceChildren(
      h('header', { class: 'bar' }, h('h1', {}, 'Shift & Leave Planner'), h('span', { class: 'saved' }, storageOK ? savedAt : '⚠ not saving'), h('button', { class: 'helpq', 'aria-label': 'How to use', onclick: () => go('help') }, '?')),
      h('main', { id: 'content' }, body),
      h('nav', { class: 'tabs' }, TABS.map(([k, ic, lb]) => h('button', { class: ui.tab === k ? 'on' : '', onclick: () => go(k) }, h('span', { class: 'ic' }, ic), lb)))
    );
    const c = document.getElementById('content'); if (c) c.scrollTop = top;
    if (sheet) redrawSheet();
  }
  function go(tab) { closeSheet(); ui.tab = tab; render(); const c = document.getElementById('content'); if (c) c.scrollTop = 0; }

  function openSheet(title, draw) {
    closeSheet();
    const back = h('div', { class: 'sheet-back', onclick: (e) => { if (e.target === back) closeSheet(); } });
    const body = h('div'), ttl = h('h3', {}, title);
    back.append(h('div', { class: 'sheet' }, h('header', {}, ttl, h('button', { class: 'btn sm', onclick: closeSheet }, 'Close')), body));
    document.body.append(back);
    sheet = { back, body, ttl, draw };
    redrawSheet();
  }
  function setSheet(title, draw) { if (!sheet) { openSheet(title, draw); return; } sheet.ttl.textContent = title; sheet.draw = draw; flashKeep = true; redrawSheet(); }
  let flashKeep = false;
  function redrawSheet() { if (!sheet) return; sheet.body.replaceChildren(); sheet.draw(sheet.body); }
  function closeSheet() { if (sheet) { sheet.back.remove(); sheet = null; } flash = ''; }

  /* ---------- calendar cells ---------- */
  function dateEntries(date) { return byDate()[date] || []; }
  function dotsFor(es, calId, date) {
    const f = E.freeSpots(es, calId, date, spots()), n = spots();
    const row = (used) => h('div', { class: 'dr' + (used >= n ? ' full' : '') }, Array.from({ length: n }, (_, i) => h('i', { class: i < used ? 'f' : '' })));
    return h('div', { class: 'dots' }, row(n - f.F), row(n - f.S));
  }
  function tap(date) {
    if (ui.range) {
      if (!ui.rangeStart) { ui.rangeStart = date; render(); toast('Now tap the LAST date'); return; }
      const a = ui.rangeStart, b = date; ui.range = false; ui.rangeStart = null; render();
      const lo = E.dayNum(a) <= E.dayNum(b) ? a : b, hi = E.dayNum(a) <= E.dayNum(b) ? b : a;
      showForm({ date: lo, through: hi, cal: S.settings.myCal, back: 'close', multi: true });
      return;
    }
    showDay(date);
  }
  function dayCell(date, mini) {
    const es = dateEntries(date), cl = E.dutyCals(date, S);
    const ctx = { hasMine: es.some((e) => !e.who), full: cl.some((c) => E.isFull(es, c, date, spots())) };
    if (!E.passesFilter(date, S, ctx)) return h('div', { class: 'cell hidden' });
    if (E.isFeb29(date)) return h('div', { class: 'cell leap', onclick: () => tap(date), role: 'button', 'aria-label': fmtDate(date) }, h('span', { class: 'n' }, 29), mini ? null : h('span', { class: 'u' }, 'n/c'));
    const cls = ['cell', cl.length ? colorCls(cl[0]) : 'u0'];
    const forced = cl.some((c) => E.calInfo(date, E.calById(S, c), S).forced) || cals().some((c) => E.calInfo(date, c, S).forced && !cl.includes(c.id));
    if (forced) cls.push('ov'); if (date === today) cls.push('today'); if (ui.rangeStart === date) cls.push('sel');
    if (es.some((e) => !e.who)) cls.push('mine'); if (ctx.full) cls.push('fullh');
    if (mini) return h('div', { class: cls.join(' '), onclick: () => tap(date), role: 'button', 'aria-label': fmtDate(date) }, h('span', { class: 'n' }, Number(date.slice(8))));
    const fm = flagMap(), mine = es.filter((e) => !e.who || !E.isSpot(e.type));
    return h('div', { class: cls.join(' '), onclick: () => tap(date), role: 'button', 'aria-label': fmtDate(date) },
      h('span', { class: 'n' }, Number(date.slice(8))),
      cl.length ? h('span', { class: 'u' }, cl.map((c) => calTitle(c)).join('/')) : null,
      cl.length ? dotsFor(es, cl[0], date) : null,
      h('div', { class: 'badges' }, mine.slice(0, 3).map((e) => h('span', { class: 'bd ' + (e.status || '') + (fm[e.id] ? ' bad' : '') }, T[e.type].short + (e.status === 'mine' ? '✓' : e.status === 'taken' ? '✗' : ''))), mine.length > 3 ? h('span', { class: 'bd' }, '+') : null));
  }
  function monthGrid(y, m, mini) {
    const g = h('div', { class: 'grid' });
    for (let i = 0; i < E.dow(E.iso(y, m, 1)); i++) g.append(h('div'));
    for (let d = 1; d <= E.daysInMonth(y, m); d++) g.append(dayCell(E.iso(y, m, d), mini));
    return h('div', {}, h('div', { class: 'dow' }, DOW.map((d) => h('div', {}, d))), g);
  }

  /* ---------- Calendar tab ---------- */
  function filterSummary(y) {
    const f = S.ui.filter, on = cals().filter((c) => f[c.id]);
    let n = 0;
    for (let k = E.dayNum(E.iso(y, 1, 1)); k <= E.dayNum(E.iso(y, 12, 31)); k++) {
      const d = E.fromDayNum(k), es = dateEntries(d), cl = E.dutyCals(d, S);
      if (E.passesFilter(d, S, { hasMine: es.some((e) => !e.who), full: cl.some((c) => E.isFull(es, c, d, spots())) })) n++;
    }
    let t;
    if (on.length === cals().length) t = 'All calendars';
    else if (!on.length) t = 'No calendars selected';
    else t = on.map((c) => c.title).join(' + ');
    if (f.full) t += ' · only dates with a full half';
    else if (f.mine && on.length < cals().length) t += ' + dates with your entries';
    return { text: t, n };
  }
  function filterBar() {
    const f = S.ui.filter, sm = filterSummary(ui.year);
    const chip = (key, label, cls, sw) => h('button', { class: 'chip ' + cls + (f[key] ? ' on' : ''), 'aria-pressed': f[key] ? 'true' : 'false', onclick: () => mutate(() => { S.ui.filter[key] = !S.ui.filter[key]; }) }, sw ? h('span', { class: 'sw', style: 'background:' + sw }) : null, label);
    return h('div', { class: 'card filt' },
      h('div', { class: 'row sp' }, h('h2', { style: 'margin:0' }, 'Show on calendar'), h('button', { class: 'helpq', 'aria-label': 'How filters work', onclick: filterHowTo }, '?')),
      h('div', { class: 'chips' }, cals().map((c, i) => chip(c.id, c.title || ('Calendar ' + (i + 1)), 'c' + ((i % 3) + 1), 'var(--u' + ((i % 3) + 1) + ')')), chip('leap', 'Feb 29', 'cl', 'var(--leap)'), chip('mine', 'My entries', 'cm', 'var(--amber)'), chip('full', 'Full days', 'cf', 'var(--bad)')),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: () => mutate(() => { for (const c of cals()) S.ui.filter[c.id] = true; S.ui.filter.leap = true; S.ui.filter.full = false; }) }, 'Show all dates'),
        h('button', { class: 'btn sm', onclick: () => mutate(() => { for (const c of cals()) S.ui.filter[c.id] = c.id === S.settings.myCal; S.ui.filter.leap = true; S.ui.filter.full = false; }) }, 'Only my calendar (' + calTitle(S.settings.myCal) + ')')),
      h('div', { class: 'showing' }, h('b', {}, 'Showing: '), sm.text, ' — ', sm.n + ' dates in ' + ui.year),
      S.ui.tipDismissed ? null : h('div', { class: 'tip' }, 'Tap a chip to show or hide that calendar. The ? explains the dots and colors. ', h('button', { class: 'btn sm ghost', onclick: () => mutate(() => { S.ui.tipDismissed = true; }) }, 'Got it')));
  }
  function filterHowTo() {
    setSheet('How the calendar filters work', (b) => put(b, 
      h('p', {}, 'The chips at the top are switches:'),
      h('ol', {},
        h('li', {}, 'Tap a calendar chip (', cals().map((c) => c.title).join(', '), ') to show or hide the dates that calendar works. Turn two off and you see only the third.'),
        h('li', {}, h('b', {}, 'Feb 29'), ' shows or hides the leap day. It is not counted in the cycle.'),
        h('li', {}, h('b', {}, 'My entries'), ' keeps any date where you have something visible even if its calendar is hidden. Turn it off for a pure calendar view.'),
        h('li', {}, h('b', {}, 'Full days'), ' shows only dates where a First 12 or Second 12 already has all ', spots(), ' spots taken.')),
      h('p', {}, 'Hidden dates are blank, not removed, so dates never shift. Month shows one month; Year shows all twelve. The line under the chips says exactly what is showing and how many dates it covers.'),
      h('div', { class: 'legend' }, cals().map((c, i) => h('span', {}, h('i', { style: 'background:var(--u' + ((i % 3) + 1) + ')' }), c.title)), h('span', {}, h('i', { style: 'background:var(--leap)' }), 'Feb 29: not counted')),
      h('p', { class: 'hint' }, 'The dots on each date: the top row is First 12, the bottom row is Second 12. One dot per taken spot. A red row means all spots are taken.')));
  }
  function viewCalendar() {
    const y = ui.year, m = ui.month, mv = ui.mode === 'month';
    const step = (d) => { if (mv) { let nm = m + d, ny = y; if (nm < 1) { nm = 12; ny--; } if (nm > 12) { nm = 1; ny++; } ui.month = nm; ui.year = ny; } else ui.year += d; render(); };
    return h('div', {},
      filterBar(),
      h('div', { class: 'calhead' }, h('button', { class: 'btn', 'aria-label': 'Previous', onclick: () => step(-1) }, '‹'), h('h2', {}, mv ? MONTHS[m - 1] + ' ' + y : String(y)), h('button', { class: 'btn', 'aria-label': 'Next', onclick: () => step(1) }, '›')),
      h('div', { class: 'row sp', style: 'margin-bottom:8px' },
        h('div', { class: 'seg' }, h('button', { class: mv ? 'on' : '', onclick: () => { ui.mode = 'month'; render(); } }, 'Month'), h('button', { class: !mv ? 'on' : '', onclick: () => { ui.mode = 'year'; render(); } }, 'Year')),
        h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { ui.year = tp.y; ui.month = tp.m; render(); } }, 'Today'), h('button', { class: 'btn sm' + (ui.range ? ' pri' : ''), onclick: () => { ui.range = !ui.range; ui.rangeStart = null; render(); if (ui.range) toast('Tap the FIRST date'); } }, ui.range ? 'Cancel range' : 'Select range'))),
      ui.range ? h('div', { class: 'warn' }, ui.rangeStart ? 'Start: ' + fmtDate(ui.rangeStart, 'mid') + '. Tap the last date.' : 'Range mode: tap the first date, then the last date.') : null,
      mv ? monthGrid(y, m, false) : h('div', {},
        h('div', { class: 'jump' }, MONTHS.map((nm, i) => h('button', { class: 'chip', onclick: () => { const el = document.getElementById('ym-' + (i + 1)); if (el) el.scrollIntoView({ block: 'start' }); } }, nm.slice(0, 3)))),
        h('div', { class: 'year' }, MONTHS.map((nm, i) => h('section', { class: 'ymonth', id: 'ym-' + (i + 1) }, h('h4', { onclick: () => { ui.mode = 'month'; ui.month = i + 1; render(); } }, nm + ' ' + y, h('small', {}, '  open month ›')), monthGrid(y, i + 1, false))))),
      h('p', { class: 'hint' }, 'Badges (yours only): V vacation, S sick, P personal, E EDO, O other, N note. Dashed = tentative, solid white ✓ = mine. Red outline = not enough hours earned yet.'));
  }

  /* ---------- Day sheet ---------- */
  function showDay(date) {
    setSheet(fmtDate(date), (b) => drawDay(b, date));
  }
  function who(e) { return e.who || 'Me'; }
  function entryRow(e, afterDelete) {
    const Tt = T[e.type], fl = flagMap()[e.id], mine = !e.who;
    return h('div', { class: 'entry' + (fl && fl.shortfall > 0 ? ' short' : '') + (e.status === 'taken' ? ' struck' : '') },
      h('div', { class: 'row sp' },
        h('div', { class: 'grow' }, h('b', {}, E.isSpot(e.type) ? who(e) : ''), E.isSpot(e.type) ? ' · ' : '', h('b', {}, Tt.label), E.isSpot(e.type) ? ' · ' + E.HALVES[e.half] : '', Tt.deduct && mine && !Tt.adj ? ' · ' + fmtH(e.hours) + ' h' : '', Tt.adj ? ' · ' + fmtH(e.hours) + ' h' : '', e.title ? ' · ' + e.title : ''),
        E.hasStatus(e) ? h('span', { class: 'pill ' + e.status, role: 'button', title: 'Tap to switch', onclick: () => (e.status === 'taken' ? setStatus(e, 'tentative') : setStatus(e, e.status === 'mine' ? 'tentative' : 'mine')) }, e.status === 'mine' ? 'MINE' : e.status === 'taken' ? 'TAKEN' : 'TENTATIVE') : null),
      e.note ? h('div', { class: 'hint' }, e.note) : null,
      e.status === 'tentative' && E.PLAN_TYPES.includes(e.type) && !e.who ? h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => setStatus(e, 'taken') }, 'Taken by someone else')) : null,
      fl && fl.shortfall > 0 ? h('div', { class: 'err' }, '⚠ Short by ' + fmtH(fl.shortfall) + ' h: you will not have earned enough by ' + fmtDate(e.date, 'short') + '. ' + (fl.coveredOn ? 'Earned by ' + fmtDate(fl.coveredOn, 'mid') + ' if nothing else is scheduled first.' : 'Not covered by projected accrual.')) : null,
      fl && fl.early ? h('div', { class: 'err' }, '⚠ Before your first usable vacation date (' + fmtDate(S.settings.vac.firstUse, 'mid') + ').') : null,
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => showForm({ date: e.date, entry: e, cal: e.cal, back: 'day' }) }, 'Edit'),
        h('button', { class: 'btn sm dng', onclick: () => { const before = snap(); mutate(() => { S.entries = S.entries.filter((x) => x.id !== e.id); }); toast('Deleted', () => restore(before)); if (afterDelete) afterDelete(); } }, 'Delete')));
  }
  function halfLists(es, calId, date) {
    const u = E.spotUse(es, calId, date), n = spots();
    const col = (half, label) => h('div', { class: 'half' }, h('div', { class: 'hl' }, label + ' · ' + u[half].length + '/' + n),
      u[half].map((e) => h('div', { class: 'nm' }, who(e), h('small', {}, ' ' + T[e.type].short + (e.half === 'W' ? ' (whole)' : '')))),
      Array.from({ length: Math.max(0, n - u[half].length) }, () => h('div', { class: 'nm free' }, '—')));
    return h('div', { class: 'halves' }, col('F', 'First 12'), col('S', 'Second 12'));
  }
  function drawDay(b, date) {
    const es = dateEntries(date), cl = E.dutyCals(date, S), leap = E.isFeb29(date);
    put(b, flash ? h('div', { class: flash.startsWith('⚠') ? 'err' : 'okbox' }, flash) : null);
    if (leap) put(b, h('div', { class: 'hint' }, 'Feb 29 is shown but not counted. No calendar works it and the cycle does not advance; it picks up again on March 1. You can still add a note.'));
    for (const id of cl) {
      const mineHere = es.filter((e) => e.cal === id);
      put(b, h('div', { class: 'card' },
        h('div', { class: 'row sp' }, h('span', { class: 'uchip ' + colorCls(id) }, calTitle(id) + ' on duty'), E.calInfo(date, E.calById(S, id), S).forced ? h('span', { class: 'uchip ovr' }, 'OVERRIDE') : null),
        halfLists(es, id, date),
        mineHere.map((e) => entryRow(e)),
        h('button', { class: 'btn pri', style: 'width:100%;margin-top:8px', onclick: () => showForm({ date, cal: id, back: 'day' }) }, '+ Add'),
        E.calInfo(date, E.calById(S, id), S).forced ? h('button', { class: 'btn sm', style: 'margin-top:8px', onclick: () => mutate(() => { delete S.overrides[id][date]; }) }, 'Restore calculated schedule') : null));
    }
    if (!leap && !cl.length) put(b, h('div', { class: 'hint' }, 'No calendar works this date.'));
    const notes = es.filter((e) => !E.isSpot(e.type));
    if (notes.length) put(b, h('h3', {}, 'Notes and adjustments'), notes.map((e) => entryRow(e)));
    put(b, h('div', { class: 'row', style: 'margin:8px 0' }, h('button', { class: 'btn sm', onclick: () => showForm({ date, cal: '', back: 'day', type: 'note' }) }, '+ Add a note')));
    if (!leap) put(b, overrideControl(date));
    if (E.dayNum(date) >= E.dayNum(S.settings.baselineDate)) put(b, stmtBox('vac', date), stmtBox('sick', date));
  }
  function overrideControl(date) {
    const sel = h('select', {}, cals().map((c) => h('option', { value: c.id }, c.title)));
    const act = h('select', {}, h('option', { value: 'true' }, 'works this date'), h('option', { value: 'false' }, 'does NOT work this date'));
    return h('details', { class: 'acc', style: 'margin-top:8px' }, h('summary', {}, 'Schedule override (rare)'), h('div', {},
      h('div', { class: 'hint' }, 'Use only when the real schedule differs from the every-' + S.settings.cycle + '-days pattern. The date is marked OVR and can be restored.'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, sel), h('div', { class: 'grow' }, act), h('button', { class: 'btn', onclick: () => mutate(() => { (S.overrides[sel.value] = S.overrides[sel.value] || {})[date] = act.value === 'true'; }) }, 'Apply'))));
  }

  /* ---------- Quick entry ---------- */
  const FORM_TYPES = ['vacation', 'edo', 'sick', 'personal', 'other', 'note'];
  function showForm(o) {
    const e = o.entry || null, last = S.ui.last;
    const type = e ? e.type : (o.type || (FORM_TYPES.includes(last.type) ? last.type : 'vacation'));
    const f = {
      type, who: e ? e.who : '', half: e ? e.half : last.half, status: e && e.status ? e.status : 'tentative',
      custom: !!(e && E.TYPES[e.type].deduct && !e.who && e.hours !== E.hoursFor(e.half)), hours: e ? String(e.hours) : '', date: o.date, through: o.through || '',
      title: e ? e.title : '', note: e ? e.note : '', cal: e ? e.cal : (o.cal || S.settings.myCal), more: !!e && !!(e.note || e.title), newName: false
    };
    if (f.who && !S.names.some((n) => n.toLowerCase() === f.who.toLowerCase())) f.who = '';
    const view = Object.assign({}, o, { f, entry: e });
    setSheet(e ? 'Edit entry' : (o.multi ? 'Add for ' + fmtDate(o.date, 'short') + ' – ' + fmtDate(o.through, 'short') : 'Add: ' + fmtDate(o.date, 'mid')), (b) => drawForm(b, view));
  }
  const pool = (view) => S.entries.filter((x) => !(view.entry && x.id === view.entry.id));
  function candOf(view, half, whoName) {
    const f = view.f;
    return { id: view.entry ? view.entry.id : '__new', cal: E.isSpot(f.type) ? f.cal : '', date: f.date, type: f.type, who: whoName !== undefined ? whoName : normWho(f.who), half };
  }
  const normWho = (w) => { const t = String(w || '').trim(); return /^me$/i.test(t) ? '' : E.canonName(S.names, t); };
  function halfStatus(view, whoName) { // {F:{ok,..}, S:..., W:...}
    const out = {};
    for (const hv of ['F', 'S', 'W']) out[hv] = E.checkPlace(pool(view), candOf(view, hv, whoName), spots());
    return out;
  }
  function backFromForm(view) { if (view.back === 'day') showDay(view.f.date && !view.entry ? view.date : (view.entry ? view.entry.date : view.date)); else closeSheet(); }
  function drawForm(b, view) {
    const f = view.f, spot = E.isSpot(f.type), multi = !!view.multi && !view.entry, Tt = T[f.type];
    const redraw = () => redrawSheet();
    const errEl = h('div');
    // type row
    put(b, h('div', { class: 'fl' }, 'What'), h('div', { class: 'opts' }, FORM_TYPES.map((k) => h('button', { class: 'opt' + (f.type === k ? ' on' : ''), onclick: () => { f.type = k; if (k === 'note') f.who = ''; redraw(); } }, T[k].label))));
    if (multi && spot) put(b, h('div', { class: 'fl' }, 'Calendar'), h('div', { class: 'opts' }, cals().map((c) => h('button', { class: 'opt ' + colorCls(c.id) + (f.cal === c.id ? ' on' : ''), onclick: () => { f.cal = c.id; redraw(); } }, c.title))));
    let hs = null, whoBlocked = null;
    if (spot) {
      // who row
      const recent = []; for (let i = S.entries.length - 1; i >= 0 && recent.length < 10; i--) { const n = S.entries[i].who; if (n && !recent.includes(n)) recent.push(n); }
      const names = recent.concat(S.names.filter((n) => !recent.includes(n)).slice(0, Math.max(0, 14 - recent.length)));
      const single = !multi;
      const whoChip = (label, val) => {
        let dis = false, why = '';
        if (single) { const st = halfStatus(view, val); dis = !(st.F.ok || st.S.ok || st.W.ok); if (dis) why = (st.F.dup || st.S.dup) ? ' (already off)' : ' (full)'; }
        const on = normWho(f.who) === val && !f.newName;
        return h('button', { class: 'opt' + (on ? ' on' : ''), disabled: dis, onclick: () => { f.who = val; f.newName = false; redraw(); } }, label + why);
      };
      const nameIn = h('input', { type: 'text', list: 'nameList', placeholder: 'Type a name…', maxlength: '60', value: f.newName ? f.who : '', oninput: (ev) => { f.who = ev.target.value; f.newName = true; }, onchange: () => { redraw(); } });
      put(b, h('div', { class: 'fl' }, 'Who'), h('div', { class: 'opts' }, whoChip('Me', ''), names.map((n) => whoChip(n, n)), h('button', { class: 'opt' + (f.newName ? ' on' : ''), onclick: () => { f.newName = true; f.who = ''; redraw(); setTimeout(() => { const i = sheet && sheet.body.querySelector('input[list]'); if (i) i.focus(); }, 30); } }, '+ New name')),
        f.newName ? nameIn : null, h('datalist', { id: 'nameList' }, S.names.map((n) => h('option', { value: n }))));
      // time row
      hs = halfStatus(view);
      if (!multi && !hs[f.half].ok) { const first = ['W', 'F', 'S'].find((k) => hs[k].ok); if (first) { f.half = first; if (!f.custom) f.hours = ''; } }
      const free = multi ? null : E.freeSpots(pool(view), f.cal, f.date, spots());
      const hb = (k, label) => h('button', { class: 'opt' + (f.half === k ? ' on' : ''), disabled: !multi && !hs[k].ok, onclick: () => { f.half = k; redraw(); } }, label);
      put(b, h('div', { class: 'fl' }, 'When'), h('div', { class: 'opts three' }, hb('F', 'First 12' + (free ? ' (' + free.F + ' left)' : '')), hb('S', 'Second 12' + (free ? ' (' + free.S + ' left)' : '')), hb('W', 'Whole 24')));
      if (!multi && !(hs.F.ok || hs.S.ok || hs.W.ok)) {
        const fr = E.freeSpots(pool(view), f.cal, f.date, spots()), dayFull = fr.F === 0 && fr.S === 0, st = hs.W, wn = normWho(f.who);
        const lists = ['F', 'S'].map((k) => E.HALVES[k] + ': ' + fr.use[k].map((x) => who(x)).join(', '));
        whoBlocked = true;
        put(b, h('div', { class: 'err' }, dayFull ? 'This day is full. ' + lists.join(' · ') : (st.dup || hs.F.dup || hs.S.dup) ? (wn ? wn + ' already has' : 'You already have') + ' time off on this date. Pick someone else, or edit that entry.' : 'No time is available on this date.'));
      } else if (!multi && !hs[f.half].ok) put(b, h('div', { class: 'err' }, 'That time is not available.'));
    }
    if (!spot) put(b, h('label', { class: 'f' }, h('span', {}, 'Note'), h('textarea', { maxlength: '2000', value: f.note, onchange: (ev) => { f.note = ev.target.value; } })));
    // more
    const mine = !normWho(f.who);
    put(b, h('details', { class: 'acc', open: f.more, ontoggle: (ev) => { f.more = ev.target.open; }, style: 'margin-top:10px' }, h('summary', {}, 'More (status, hours, dates, notes)'), h('div', {},
      spot && mine ? h('div', {}, h('div', { class: 'fl' }, 'Status'), h('div', { class: 'opts' }, h('button', { class: 'opt' + (f.status === 'tentative' ? ' on' : ''), onclick: () => { f.status = 'tentative'; redraw(); } }, 'Tentative'), h('button', { class: 'opt' + (f.status === 'mine' ? ' on' : ''), onclick: () => { f.status = 'mine'; redraw(); } }, 'Mine')), h('div', { class: 'hint' }, 'Both count toward projected balances.')) : null,
      Tt.deduct && mine ? h('label', { class: 'f' }, h('span', {}, Tt.adj ? 'Hours (negative adds hours back)' : 'Hours deducted (default ' + E.hoursFor(f.half) + ' for ' + E.HALVES[f.half] + ')'), h('input', { type: 'number', step: '0.25', inputmode: 'decimal', placeholder: String(E.hoursFor(f.half)), value: f.custom || Tt.adj ? f.hours : '', onchange: (ev) => { f.hours = ev.target.value; f.custom = ev.target.value !== ''; } })) : null,
      view.entry ? h('label', { class: 'f' }, h('span', {}, 'Date (change to move this entry)'), h('input', { type: 'date', value: f.date, onchange: (ev) => { f.date = ev.target.value; redraw(); } })) : h('label', { class: 'f' }, h('span', {}, 'Through date (optional, fills a range of this calendar\'s duty days)'), h('input', { type: 'date', value: f.through, onchange: (ev) => { f.through = ev.target.value; } })),
      spot ? null : h('label', { class: 'f' }, h('span', {}, 'Title (optional)'), h('input', { type: 'text', maxlength: '200', value: f.title, onchange: (ev) => { f.title = ev.target.value; } })),
      spot ? h('label', { class: 'f' }, h('span', {}, 'Notes (optional)'), h('textarea', { maxlength: '2000', value: f.note, onchange: (ev) => { f.note = ev.target.value; } })) : null)));
    put(b, errEl, h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', { class: 'btn pri grow', disabled: !!whoBlocked, onclick: () => saveForm(view, errEl) }, 'Save'),
      h('button', { class: 'btn grow', onclick: () => backFromForm(view) }, 'Cancel')));
  }
  function saveForm(view, errEl) {
    const f = view.f, Tt = T[f.type], spot = E.isSpot(f.type), bad = (m) => errEl.replaceChildren(h('div', { class: 'err' }, m));
    const whoName = spot ? normWho(f.who) : '';
    if (spot && f.newName && !String(f.who).trim()) return bad('Type a name, or pick one from the list.');
    if (!E.validDate(f.date)) return bad('Pick a valid date.');
    let hrs = 0;
    if (Tt.deduct && !whoName) {
      hrs = f.custom || Tt.adj ? parseFloat(f.hours) : E.hoursFor(f.half);
      if (!isFinite(hrs)) return bad('Enter the number of hours.');
      if (!Tt.adj && hrs <= 0) return bad('Hours must be greater than zero.');
      if (Tt.adj && hrs === 0) return bad('Hours cannot be zero.');
    }
    let dates = [f.date];
    if (!view.entry && f.through && f.through !== f.date) {
      if (!E.validDate(f.through)) return bad('Pick a valid through date.');
      const a = E.dayNum(f.date), z = E.dayNum(f.through);
      if (z < a) return bad('The through date must be on or after the start date.');
      if (z - a > 400) return bad('That range is longer than a year. Split it up.');
      dates = spot ? E.expandRange(f.date, f.through, S, f.cal) : E.expandRange(f.date, f.through, S);
      if (!dates.length) return bad('No duty days of that calendar fall in that range.');
    }
    if (spot) {
      if (E.isFeb29(f.date)) return bad('Feb 29 is not counted. Use a note instead.');
      if (!E.calWorks(f.date, E.calById(S, f.cal), S.settings.cycle, (S.overrides || {})[f.cal])) return bad(calTitle(f.cal) + ' does not work ' + fmtDate(f.date, 'mid') + '.');
    }
    const fresh = [], skipped = [];
    for (const d of dates) {
      const cand = { id: view.entry ? view.entry.id : newId(), cal: spot ? f.cal : '', date: d, type: f.type, who: whoName, half: spot ? f.half : '', hours: Tt.deduct && !whoName ? hrs : (spot ? E.hoursFor(f.half) : 0), status: spot && !whoName ? f.status : '', rank: view.entry && !whoName ? (view.entry.rank || 0) : 0, title: spot ? '' : f.title.trim(), note: f.note.trim() };
      if (spot) {
        const r = E.checkPlace(pool(view).concat(fresh), cand, spots());
        if (!r.ok) { skipped.push({ d, r }); continue; }
      }
      fresh.push(cand);
    }
    if (!fresh.length) {
      const r = skipped[0].r;
      if (r.dup) return bad((whoName || 'You') + ' already has time off on ' + fmtDate(skipped[0].d, 'mid') + ' that overlaps. Edit that entry instead.');
      return bad('Full on ' + fmtDate(skipped[0].d, 'mid') + ': ' + r.full.map((k) => E.HALVES[k] + ' (' + r.use[k].map((x) => who(x)).join(', ') + ')').join(' · ') + '.');
    }
    const before = snap();
    mutate(() => {
      if (view.entry) S.entries = S.entries.map((x) => (x.id === view.entry.id ? fresh[0] : x)); else S.entries = S.entries.concat(fresh);
      if (whoName) E.addName(S.names, whoName);
      if (spot && !view.entry) S.ui.last = { type: f.type, who: whoName, half: f.half }; else if (!spot && !view.entry) S.ui.last.type = S.ui.last.type;
    });
    const ids = new Set(fresh.map((x) => x.id)), msgs = [];
    if (Tt.deduct && !whoName && !Tt.adj) {
      const sh = getL(Tt.bank).events.filter((r) => r.kind === 'deduct' && ids.has(r.entry.id) && r.shortfall > 0);
      if (sh.length) msgs.push('⚠ ' + sh.length + ' date' + (sh.length > 1 ? 's leave' : ' leaves') + ' you short on hours (first: ' + fmtDate(sh[0].date, 'short') + ', short ' + fmtH(sh[0].shortfall) + ' h). You have not earned enough by then.');
      const early = getL(Tt.bank).events.filter((r) => r.kind === 'deduct' && ids.has(r.entry.id) && r.early);
      if (early.length) msgs.push('⚠ Before your first usable vacation date.');
    }
    if (f.type === 'personal' && !whoName) { const yr = E.parse(fresh[0].date).y, used = E.personalUsed(S.entries, yr); if (used > 24) msgs.push('⚠ Personal leave in ' + yr + ' totals ' + fmtH(used) + ' h; CBA §27.8 allows 24 h per year.'); }
    if (skipped.length) msgs.push('Skipped ' + skipped.length + ' date' + (skipped.length > 1 ? 's' : '') + ' (full or already booked): ' + skipped.slice(0, 4).map((s) => fmtDate(s.d, 'short')).join(', ') + (skipped.length > 4 ? '…' : '') + '.');
    flash = msgs.join(' ');
    toast('Saved ' + fresh.length + ' entr' + (fresh.length > 1 ? 'ies' : 'y'), () => restore(before));
    const day = view.entry ? fresh[0].date : view.date;
    if (view.back === 'day' || view.entry) showDay(day); else { closeSheet(); if (msgs.length) toast(msgs[0].replace(/^⚠ /, '')); }
  }

  /* ---------- Home ---------- */
  const CONF_LABELS = { calendars: 'Calendar start dates', payperiod: 'Pay-period dates and accrual timing', vacRate: 'Vacation tier / accrual rate', balances: 'Starting balances and balance date' };
  const kv = (k, v) => h('div', { class: 'kv' }, h('span', {}, k), h('b', {}, v));
  // change one of my picks between tentative / mine / taken. Going back to tentative must still fit the 3-spot rule.
  function setStatus(e, status) {
    if (status !== 'taken') {
      const r = E.checkPlace(S.entries, Object.assign({}, e, { status }), spots());
      if (!r.ok) { toast('Cannot restore: ' + fmtDate(e.date, 'short') + ' is full for that time. Remove someone first.'); return; }
    }
    const before = snap();
    mutate(() => { e.status = status; });
    toast(status === 'taken' ? 'Marked taken. It no longer counts. Add who took it from the day.' : status === 'mine' ? 'Got it' : 'Back on your plan', () => restore(before));
  }
  function planCard(y) {
    const P = E.planList(S.entries, y), n = P.active.length;
    const fm = flagMap();
    const what = (e) => fmtDate(e.date, 'mid') + ' · ' + T[e.type].label + ' · ' + E.HALVES[e.half] + (T[e.type].deduct ? ' · ' + fmtH(e.hours) + ' h' : '') + ' · ' + calTitle(e.cal);
    const act = (e, i) => h('div', { class: 'plan' },
      h('span', { class: 'rk' }, i + 1),
      h('div', { class: 'grow', role: 'button', onclick: () => showDay(e.date) }, h('div', {}, h('b', {}, what(e))), fm[e.id] && fm[e.id].shortfall > 0 ? h('div', { class: 'err', style: 'margin:4px 0 0' }, 'Short by ' + fmtH(fm[e.id].shortfall) + ' h on this date') : null),
      h('div', { class: 'pbtn' },
        h('button', { class: 'btn sm', disabled: i === 0, 'aria-label': 'Move up', onclick: () => mutate(() => { E.movePlan(S.entries, e.id, -1, y); }) }, '↑'),
        h('button', { class: 'btn sm', disabled: i === n - 1, 'aria-label': 'Move down', onclick: () => mutate(() => { E.movePlan(S.entries, e.id, 1, y); }) }, '↓'),
        h('button', { class: 'btn sm pri', onclick: () => setStatus(e, 'mine') }, 'Got it'),
        h('button', { class: 'btn sm dng', onclick: () => setStatus(e, 'taken') }, 'Taken')));
    const dn = (e) => h('div', { class: 'plan done ' + e.status },
      h('span', { class: 'rk' }, e.status === 'mine' ? '✓' : '✗'),
      h('div', { class: 'grow', role: 'button', onclick: () => showDay(e.date) }, h('span', { class: 'strike' }, what(e)), h('small', {}, e.status === 'mine' ? '  GOT IT' : '  TAKEN')),
      h('div', { class: 'pbtn' },
        e.status === 'taken' ? h('button', { class: 'btn sm', onclick: () => showForm({ date: e.date, cal: e.cal, back: 'close' }) }, 'Add who took it') : null,
        h('button', { class: 'btn sm', onclick: () => setStatus(e, 'tentative') }, 'Restore')));
    return h('div', { class: 'card' }, h('h2', {}, 'My plan · ' + y),
      h('div', { class: 'hint' }, 'Your picks in order of priority (1 = most wanted). Use the arrows to reorder. When a day is yours, tap Got it. When someone else gets it first, tap Taken: it is struck out and stops counting toward your hours and the three spots.'),
      n ? P.active.map(act) : h('div', { class: 'hint' }, 'No tentative picks for ' + y + '. Add vacation, personal or EDO days from the Calendar.'),
      P.done.length ? h('div', {}, h('div', { class: 'fl', style: 'margin-top:10px' }, 'Settled'), P.done.map(dn)) : null);
  }
  function projectorCard() {
    const dIn = h('input', { type: 'date', value: ui.projDate, onchange: (ev) => { if (E.validDate(ev.target.value)) { ui.projDate = ev.target.value; render(); } } });
    return h('div', { class: 'card' }, h('h2', {}, 'Balance on any date'), h('label', { class: 'f' }, h('span', {}, 'Pick a date'), dIn), stmtBox('vac', ui.projDate), stmtBox('sick', ui.projDate));
  }
  function edoBoxes(year, interactive) {
    return h('div', { class: 'eboxes' }, E.edoByMonth(S.entries, year).map((x) => h('div', { class: 'ebox' + (x.entries.length ? ' on' : ''), role: interactive ? 'button' : null, onclick: interactive ? () => { ui.tab = 'calendar'; ui.mode = 'month'; ui.year = year; ui.month = x.month; render(); } : null },
      h('b', {}, MONTHS[x.month - 1].slice(0, 3)), x.entries.length ? h('div', { class: 'ed' }, x.entries.map((e) => Number(e.date.slice(8))).join(', ')) : h('div', { class: 'ed none' }, '—'))));
  }
  function viewHome() {
    const y = ui.year, V = getL('vac'), K = getL('sick'), vs = V.stats(y), ks = K.stats(y), my = S.settings.myCal;
    const unconf = Object.keys(S.settings.confirmed).filter((k) => !S.settings.confirmed[k]);
    const nextV = S.entries.filter((e) => !e.who && (e.type === 'vacation' || e.type === 'personal') && E.isActive(e) && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    const tcl = E.dutyCals(today, S), nd = E.nextDutyDay(today, my, S), nd2 = nd ? E.nextDutyDay(E.addDays(nd, 1), my, S) : null;
    return h('div', {},
      loadWarn ? h('div', { class: 'err' }, loadWarn) : null,
      !storageOK ? h('div', { class: 'err' }, 'This browser is blocking local storage, so changes will NOT be saved. Use Export → Download backup often, or open the app in a normal (non-private) window.') : null,
      unconf.length ? h('div', { class: 'warn' }, h('b', {}, 'Not confirmed yet: '), unconf.map((k) => CONF_LABELS[k]).join('; '), '. The app is using starting defaults for these, so projections may be wrong until you check each against your real schedule and pay stubs.', h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn sm pri', onclick: () => go('settings') }, 'Open Settings'))) : null,
      h('div', { class: 'card' }, h('div', { class: 'row sp' }, h('h2', { style: 'margin:0' }, 'EDO breakouts'), h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { ui.year--; render(); } }, '‹'), h('b', {}, y), h('button', { class: 'btn sm', onclick: () => { ui.year++; render(); } }, '›'))), edoBoxes(y, true), h('div', { class: 'hint' }, 'A box fills in when you have an EDO in that month. Nothing is counted or limited.')),
      h('div', { class: 'card' }, h('h2', {}, 'Vacation · ' + y),
        h('div', { class: 'big' }, fmtH(V.balanceOn(today)) + ' h'), h('div', { class: 'hint' }, 'available today'),
        kv('Accrued this year', fmtH(vs.accrued) + ' h'), kv('Scheduled vacation', fmtH(vs.scheduled) + ' h'), vs.other ? kv('Other deductions', fmtH(vs.other) + ' h') : null,
        kv('Projected year-end', fmtH(vs.yearEnd) + ' h'), kv('Lowest projected', fmtH(vs.lowest) + ' h on ' + fmtDate(vs.lowestDate, 'short')),
        kv('Next scheduled vacation', nextV ? fmtDate(nextV.date, 'mid') + ' · ' + fmtH(nextV.hours) + ' h (' + nextV.status + ')' : 'None scheduled'),
        vs.removed ? h('div', { class: 'hint' }, 'Includes ' + fmtH(vs.removed) + ' h of excess over the carryover limit removed on Mar 31 (CBA §27.4).') : null,
        (() => { const ye = V.balanceOn(E.iso(y, 12, 31)), cap = S.settings.vac.carryCap; return cap > 0 && ye > cap ? h('div', { class: 'warn' }, 'Projected Dec 31 balance is ' + fmtH(ye) + ' h, ' + fmtH(ye - cap) + ' h over the ' + cap + ' h carryover limit. That excess must be used by Mar 31 or it is forfeited/converted (§27.4, §27.7).') : null; })()),
      h('div', { class: 'card' }, h('h2', {}, 'Sick leave · ' + y),
        h('div', { class: 'big' }, fmtH(K.balanceOn(today)) + ' h'), h('div', { class: 'hint' }, 'available today'),
        kv('Accrued this year', fmtH(ks.accrued) + ' h'), kv('Scheduled sick leave', fmtH(ks.scheduled) + ' h'), ks.other ? kv('Other deductions', fmtH(ks.other) + ' h') : null, kv('Projected year-end', fmtH(ks.yearEnd) + ' h')),
      projectorCard(),
      h('div', { class: 'card' }, h('h2', {}, 'Schedule'),
        kv('On duty today', tcl.length ? tcl.map(calTitle).join(', ') : (E.isFeb29(today) ? 'Feb 29 (not counted)' : 'None')),
        kv('My calendar', calTitle(my)), kv('Next duty day', nd ? (nd === today ? 'Today · ' : '') + fmtDate(nd, 'mid') : '—'), nd2 ? kv('Following duty day', fmtDate(nd2, 'mid')) : null),
      h('div', { class: 'card' }, h('div', { class: 'row sp' }, h('h2', { style: 'margin:0' }, MONTHS[tp.m - 1] + ' ' + tp.y), h('button', { class: 'btn sm pri', onclick: () => { ui.tab = 'calendar'; ui.mode = 'year'; ui.year = tp.y; render(); } }, 'Annual calendar')), h('div', { style: 'margin-top:8px' }, monthGrid(tp.y, tp.m, false))));
  }

  /* ---------- Leave tab ---------- */
  function balanceChart(L, year) {
    const ns = 'http://www.w3.org/2000/svg', W = 600, Hh = 150, pts = [];
    const y0 = E.dayNum(E.iso(year, 1, 1)), span = E.dayNum(E.iso(year, 12, 31)) - y0 || 1;
    const st = L.stats(year); pts.push([0, st.startBal]);
    for (const r of L.events) { if (r.dn < y0 || r.dn > y0 + span) continue; if (r.kind === 'yearstart' && !r.manual) continue; pts.push([r.dn - y0, r.before]); pts.push([r.dn - y0, r.after]); }
    pts.push([span, st.yearEnd]);
    const mn = Math.min(0, ...pts.map((p) => p[1])), mx = Math.max(1, ...pts.map((p) => p[1]));
    const X = (x) => 30 + (x / span) * (W - 40), Y = (v) => 10 + (1 - (v - mn) / (mx - mn || 1)) * (Hh - 30);
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh); svg.setAttribute('class', 'chart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Projected balance through ' + year);
    const mk = (t, a) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
    svg.append(mk('line', { x1: 30, x2: W - 10, y1: Y(0), y2: Y(0), stroke: mn < 0 ? '#ff6b6b' : '#31426a', 'stroke-width': 1 }));
    svg.append(mk('polyline', { points: pts.map((p) => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' '), fill: 'none', stroke: '#f2b134', 'stroke-width': 2 }));
    const tx = (x, y, t) => { const e = mk('text', { x, y, fill: '#b4bfd6', 'font-size': 11 }); e.textContent = t; return e; };
    svg.append(tx(2, Y(mx) + 4, fmtH(mx)), tx(2, Y(mn) + 4, fmtH(mn)), tx(30, Hh - 4, 'Jan'), tx(W - 40, Hh - 4, 'Dec'));
    return svg;
  }
  function describe(r) {
    if (r.kind === 'accrual') return 'Accrual available';
    if (r.kind === 'deduct') return who(r.entry) + ' ' + T[r.entry.type].label + ' (' + (r.entry.status || '') + ')';
    if (r.kind === 'expire') return 'Mar 31: excess over carryover (forfeited ' + fmtH(r.forfeited || 0) + ', converted ' + fmtH(r.converted || 0) + ')';
    return 'Balance set manually';
  }
  function viewLeave() {
    const bank = ui.bank, L = getL(bank), y = ui.year, st = L.stats(y), nm = bank === 'vac' ? 'Vacation' : 'Sick leave';
    const rows = L.events.filter((r) => E.parse(r.date).y === y && (r.kind === 'accrual' || r.kind === 'deduct' || r.removed || r.manual));
    const list = S.entries.filter((e) => !e.who && T[e.type].bank === bank && E.parse(e.date).y === y).sort((a, b) => a.date.localeCompare(b.date));
    return h('div', {},
      h('div', { class: 'row sp' }, h('div', { class: 'seg' }, h('button', { class: bank === 'vac' ? 'on' : '', onclick: () => { ui.bank = 'vac'; render(); } }, 'Vacation'), h('button', { class: bank === 'sick' ? 'on' : '', onclick: () => { ui.bank = 'sick'; render(); } }, 'Sick')),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { ui.year--; render(); } }, '‹'), h('b', {}, y), h('button', { class: 'btn', onclick: () => { ui.year++; render(); } }, '›'))),
      h('div', { style: 'margin-top:10px' }, planCard(y)),
      h('div', { class: 'card' }, h('h2', {}, nm + ' · ' + y),
        kv('Starting balance', fmtH(st.startBal) + ' h'), kv('Total accrued', fmtH(st.accrued) + ' h'), kv('Total scheduled', fmtH(st.scheduled) + ' h'), kv('Other deductions', fmtH(st.other) + ' h'),
        st.removed ? kv('Excess removed Mar 31', fmtH(st.removed) + ' h') : null,
        kv('Projected year-end available', fmtH(st.yearEnd) + ' h'), kv('Lowest balance', fmtH(st.lowest) + ' h · ' + fmtDate(st.lowestDate, 'short')),
        h('label', { class: 'f', style: 'margin-top:10px' }, h('span', {}, 'Hours become available…'), h('select', { onchange: (ev) => mutate(() => { S.settings.accrual.timing = ev.target.value; }) }, h('option', { value: 'end', selected: S.settings.accrual.timing === 'end' }, 'After the pay period ends'), h('option', { value: 'start', selected: S.settings.accrual.timing === 'start' }, 'At the start of the pay period')))),
      h('div', { class: 'card' }, h('h2', {}, 'Balance through the year'), balanceChart(L, y), h('div', { class: 'hint' }, 'Steps up when hours are earned, down when leave is taken. A line below the red zero means a scheduled day comes before you have earned the hours.')),
      projectorCard(),
      h('div', { class: 'card' }, h('h2', {}, 'My scheduled ' + nm.toLowerCase()), list.length ? list.map((e) => h('div', {}, h('div', { class: 'hint', style: 'margin-bottom:0' }, fmtDate(e.date, 'mid')), entryRow(e))) : h('div', { class: 'hint' }, 'Nothing scheduled this year. Tap a date on the Calendar to add leave, or use Select range for several days.')),
      h('details', { class: 'acc', open: ui.ledgerOpen, ontoggle: (ev) => { ui.ledgerOpen = ev.target.open; } }, h('summary', {}, 'Full ledger (every accrual and deduction)'), h('div', {}, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Event'), h('th', { class: 'r' }, '±h'), h('th', { class: 'r' }, 'Balance'))),
        h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, fmtDate(r.date, 'short')), h('td', {}, describe(r) + (r.shortfall > 0 ? ' ⚠ short ' + fmtH(r.shortfall) : '') + (r.early ? ' ⚠ early' : '')), h('td', { class: 'r' }, r.kind === 'accrual' ? '+' + fmtH(r.hours) : r.kind === 'deduct' ? '−' + fmtH(r.hours) : r.removed ? '−' + fmtH(r.removed) : ''), h('td', { class: 'r' }, fmtH(r.after)))))))));
  }

  /* ---------- Settings ---------- */
  function acc(key, title, ...kids) { return h('details', { class: 'acc', open: !!ui.open[key], ontoggle: (ev) => { ui.open[key] = ev.target.open; } }, h('summary', {}, title), h('div', {}, kids)); }
  function numField(label, val, set, o) {
    o = o || {};
    return h('label', { class: 'f' }, h('span', {}, label), h('input', { type: 'number', step: o.step || 'any', inputmode: 'decimal', value: String(val), onchange: (ev) => { const v = parseFloat(ev.target.value); if (!isFinite(v) || (o.min !== undefined && v < o.min) || (o.max !== undefined && v > o.max)) { ui.msg.num = label + ': enter a valid number' + (o.min !== undefined ? ' (min ' + o.min + ')' : '') + '.'; render(); return; } ui.msg.num = ''; mutate(() => set(v)); } }), o.hint ? h('div', { class: 'hint' }, o.hint) : null);
  }
  function dateField(label, val, set, hint, allowEmpty) {
    return h('label', { class: 'f' }, h('span', {}, label), h('input', { type: 'date', value: val, onchange: (ev) => { const v = ev.target.value; if (!v && allowEmpty) { mutate(() => set('')); return; } if (!E.validDate(v)) { ui.msg.num = label + ': pick a valid date.'; render(); return; } ui.msg.num = ''; mutate(() => set(v)); } }), hint ? h('div', { class: 'hint' }, hint) : null);
  }
  const confirmBox = (key, text) => h('label', { class: 'row', style: 'margin:10px 0;padding:10px;background:var(--panel2);border-radius:10px' }, h('input', { type: 'checkbox', checked: S.settings.confirmed[key], onchange: (ev) => mutate(() => { S.settings.confirmed[key] = ev.target.checked; }) }), h('span', {}, text));
  function calSettings() {
    const ovTotal = Object.keys(S.overrides).reduce((a, k) => a + Object.keys(S.overrides[k]).length, 0);
    return acc('cal', 'Calendars (titles and start dates)',
      h('div', { class: 'hint' }, 'Each calendar works every ' + S.settings.cycle + ' days from its start date. Feb 29 is never counted and the cycle picks up on March 1. Type any title you like.'),
      cals().map((c, i) => {
        const next = []; let d = E.dayNum(today) > E.dayNum(c.start) ? today : c.start;
        for (let k = 0; k < 400 && next.length < 5; k++) { const x = E.addDays(d, k); if (E.calWorks(x, c, S.settings.cycle, null)) next.push(fmtDate(x, 'short')); }
        return h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'uchip u' + ((i % 3) + 1) }, 'Calendar ' + (i + 1))),
          h('label', { class: 'f' }, h('span', {}, 'Title'), h('input', { type: 'text', maxlength: '30', value: c.title, onchange: (ev) => mutate(() => { c.title = ev.target.value.trim().slice(0, 30); }) })),
          h('label', { class: 'f' }, h('span', {}, 'Start date (a date this calendar works)'), h('input', { type: 'date', value: c.start, onchange: (ev) => { const v = ev.target.value; if (!E.validDate(v) || E.isFeb29(v)) { ui.msg.num = 'Pick a valid start date (not Feb 29).'; render(); return; } ui.msg.num = ''; mutate(() => { c.start = v; }); } })),
          h('div', { class: 'hint' }, 'Next duty days: ' + next.join(', ')));
      }),
      h('label', { class: 'f' }, h('span', {}, 'My calendar (your own leave and balances)'), h('select', { onchange: (ev) => mutate(() => { S.settings.myCal = ev.target.value; }) }, cals().map((c) => h('option', { value: c.id, selected: c.id === S.settings.myCal }, c.title)))),
      numField('Days in the cycle', S.settings.cycle, (x) => { S.settings.cycle = Math.round(x); }, { step: '1', min: 2, max: 14, hint: '3 for a 24/48 schedule.' }),
      numField('Spots off per half-day', S.settings.spots, (x) => { S.settings.spots = Math.round(x); }, { step: '1', min: 1, max: 12, hint: 'Maximum people off at one time. Changing it never deletes entries.' }),
      h('h3', {}, 'Schedule overrides (' + ovTotal + ')'),
      ovTotal ? cals().flatMap((c) => Object.keys(S.overrides[c.id] || {}).sort().map((d) => h('div', { class: 'row sp', style: 'margin:4px 0' }, h('span', {}, c.title + ' · ' + fmtDate(d, 'mid') + ' → ' + (S.overrides[c.id][d] ? 'works' : 'does not work')), h('button', { class: 'btn sm', onclick: () => mutate(() => { delete S.overrides[c.id][d]; }) }, 'Restore')))) : h('div', { class: 'hint' }, 'None. To override a date, tap it on the calendar and open "Schedule override".'),
      confirmBox('calendars', 'My calendar start dates match my real schedule'));
  }
  function payRows(bank) {
    const b = S.settings[bank];
    return h('div', {}, h('h3', {}, 'Accrual rate (hours per accrual)'),
      b.rates.map((r, i) => h('div', { class: 'row', style: 'margin:6px 0' },
        h('div', { class: 'grow' }, h('input', { type: 'date', value: r.effective, onchange: (ev) => { if (E.validDate(ev.target.value)) mutate(() => { r.effective = ev.target.value; }); } })),
        h('div', { style: 'width:110px' }, h('input', { type: 'number', step: 'any', value: String(r.rate), onchange: (ev) => { const v = parseFloat(ev.target.value); if (isFinite(v) && v >= 0) mutate(() => { r.rate = v; if (bank === 'vac' && i === 0) b.tier = ''; }); } })),
        b.rates.length > 1 ? h('button', { class: 'btn sm', onclick: () => mutate(() => { b.rates.splice(i, 1); }) }, '✕') : null)),
      h('div', { class: 'hint' }, 'Each row: date it takes effect, and hours earned per accrual. Add a row when your service tier changes.'),
      h('button', { class: 'btn sm', onclick: () => mutate(() => { b.rates.push({ effective: today, rate: b.rates[b.rates.length - 1].rate }); }) }, '+ Add rate change'));
  }
  function overridesEditor(bank) {
    const b = S.settings[bank], ys = Object.keys(b.yearOverrides).sort();
    const yIn = h('input', { type: 'number', placeholder: 'Year', value: String(tp.y + 1), step: '1' }), hIn = h('input', { type: 'number', placeholder: 'Hours', step: 'any' });
    return h('div', {}, h('h3', {}, 'Reset balance on Jan 1 of a year (optional)'),
      h('div', { class: 'hint' }, 'By default the balance carries from one year into the next. If a payroll balance differs from the projection, set the real number for a year here.'),
      ys.map((y) => h('div', { class: 'row sp' }, h('span', {}, y + ': ' + fmtH(b.yearOverrides[y]) + ' h'), h('button', { class: 'btn sm', onclick: () => mutate(() => { delete b.yearOverrides[y]; }) }, 'Remove'))),
      h('div', { class: 'row' }, h('div', { style: 'width:100px' }, yIn), h('div', { class: 'grow' }, hIn), h('button', { class: 'btn sm', onclick: () => { const y = parseInt(yIn.value, 10), v = parseFloat(hIn.value); if (!(y >= 1990 && y <= 2100) || !isFinite(v)) { toast('Enter a year and hours'); return; } if (y <= E.parse(S.settings.baselineDate).y) { toast('Year must be after the balance start year'); return; } mutate(() => { b.yearOverrides[y] = v; }); } }, 'Add')));
  }
  function namesSettings() {
    const inp = h('input', { type: 'text', maxlength: '60', placeholder: 'Add a name' });
    return acc('names', 'Names (' + S.names.length + ')',
      h('div', { class: 'hint' }, 'Names are saved automatically the first time you type them. Rename fixes a spelling everywhere. Removing a name only removes it from the quick list; existing entries keep it.'),
      S.names.map((n) => h('div', { class: 'row sp', style: 'margin:6px 0' }, h('span', { class: 'grow' }, n),
        h('button', { class: 'btn sm', onclick: () => { const to = prompt('Rename "' + n + '" to:', n); if (to === null) return; const before = snap(); const r = E.renameName(S, n, to); if (!r.ok) { toast(r.error); return; } mutate(() => { }); toast('Renamed', () => restore(before)); } }, 'Rename'),
        h('button', { class: 'btn sm dng', onclick: () => { if (confirm('Remove "' + n + '" from the quick list? Entries keep the name.')) mutate(() => { S.names = S.names.filter((x) => x !== n); }); } }, 'Remove'))),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, inp), h('button', { class: 'btn sm', onclick: () => { if (!inp.value.trim()) return; mutate(() => { E.addName(S.names, inp.value); }); } }, 'Add')));
  }
  function viewSettings() {
    const s = S.settings, v = s.vac;
    const tierSel = h('select', { onchange: (ev) => { const t = E.VAC_TIERS.find((x) => x.id === ev.target.value); mutate(() => { v.tier = ev.target.value; if (t) v.rates[0].rate = t[s.scheduleType]; }); } },
      h('option', { value: '', selected: !v.tier }, 'Choose your tier…'), E.VAC_TIERS.map((t) => h('option', { value: t.id, selected: v.tier === t.id }, t.label + ' — ' + t[s.scheduleType] + ' h/period (' + t.ref + ')')));
    return h('div', {},
      ui.msg.num ? h('div', { class: 'err' }, ui.msg.num) : null,
      calSettings(),
      acc('pay', 'Pay periods and accrual timing',
        h('div', { class: 'hint' }, 'The CBA gives accrual "per pay period" (§27.1, §28.1) but not the pay-period calendar or whether hours post at the start or end of a period. Enter your real dates from a pay stub.'),
        h('label', { class: 'f' }, h('span', {}, 'Accrual frequency'), h('select', { onchange: (ev) => mutate(() => { s.accrual.freq = ev.target.value; }) }, h('option', { value: 'days', selected: s.accrual.freq === 'days' }, 'Every N days (pay period)'), h('option', { value: 'monthly', selected: s.accrual.freq === 'monthly' }, 'Monthly'))),
        s.accrual.freq === 'days' ? [numField('Days per pay period', s.accrual.n, (x) => { s.accrual.n = Math.max(1, Math.round(x)); }, { step: '1', min: 1, hint: '14 for biweekly.' }), dateField('Start date of any one pay period', s.accrual.anchor, (x) => { s.accrual.anchor = x; }, 'Any real pay-period start date works.')] : h('div', { class: 'hint' }, 'Monthly: hours post for each calendar month. Enter a monthly rate below.'),
        h('label', { class: 'f' }, h('span', {}, 'Hours become available…'), h('select', { onchange: (ev) => mutate(() => { s.accrual.timing = ev.target.value; }) }, h('option', { value: 'end', selected: s.accrual.timing === 'end' }, 'After the pay period ends (default)'), h('option', { value: 'start', selected: s.accrual.timing === 'start' }, 'At the start of the pay period'))),
        dateField('Accrual effective date (optional)', s.accrual.effective, (x) => { s.accrual.effective = x; }, 'No accrual before this date. Leave blank normally.', true),
        dateField('Balances below are as of the start of this date', s.baselineDate, (x) => { s.baselineDate = x; }, 'Usually Jan 1. Accruals that finished before this date are assumed to be in your balance already.'),
        confirmBox('payperiod', 'My pay-period dates and timing are correct')),
      acc('vac', 'Vacation (CBA Art. 27)',
        h('label', { class: 'f' }, h('span', {}, 'Schedule type (affects the CBA rates offered)'), h('select', { onchange: (ev) => mutate(() => { s.scheduleType = ev.target.value; const t = E.VAC_TIERS.find((x) => x.id === v.tier); if (t) v.rates[0].rate = t[s.scheduleType]; s.sick.rates[0].rate = E.SICK_RATES[s.scheduleType]; }) }, h('option', { value: 'shift', selected: s.scheduleType === 'shift' }, 'Shift (24/48) personnel'), h('option', { value: 'h40', selected: s.scheduleType === 'h40' }, '40-hour personnel'))),
        h('label', { class: 'f' }, h('span', {}, 'Years-of-service tier (fills the first rate row; you can still edit it)'), tierSel),
        v.tier === 't0' ? h('div', { class: 'hint' }, 'Under one year: hours accrue but cannot be taken until one year of service. Set the first usable date below.') : null,
        dateField('First usable vacation date (optional)', v.firstUse, (x) => { v.firstUse = x; }, 'Vacation scheduled before this date is flagged. Leave blank if it does not apply.', true),
        v.rates[0].rate === 0 ? h('div', { class: 'warn' }, 'Vacation rate is 0, so no vacation will accrue until you choose a tier or enter a rate.') : null,
        payRows('vac'),
        numField('Starting vacation balance (hours)', v.balance, (x) => { v.balance = x; }),
        numField('Carryover limit (hours)', v.carryCap, (x) => { v.carryCap = x; }, { min: 0, hint: 'CBA §27.4: 264. Balance above this at Jan 1 must be used by Mar 31. Excess is used first. Set 0 to turn off.' }),
        h('label', { class: 'row', style: 'margin:10px 0' }, h('input', { type: 'checkbox', checked: v.convertExcess, onchange: (ev) => mutate(() => { v.convertExcess = ev.target.checked; }) }), h('span', {}, 'Convert unused excess to pay on Mar 31 instead of forfeiting it (§27.4/§27.7)')),
        v.convertExcess ? numField('Conversion limit (hours)', v.convertLimit, (x) => { v.convertLimit = x; }, { min: 0, hint: '§27.7: 72 h if your rate is 6.46 or less per period; 120 h if 8.30 or more.' }) : null,
        overridesEditor('vac'),
        confirmBox('vacRate', 'My vacation tier and rate are correct'), confirmBox('balances', 'My starting balances are correct')),
      acc('sick', 'Sick leave (CBA Art. 28)',
        payRows('sick'),
        numField('Starting sick balance (hours)', s.sick.balance, (x) => { s.sick.balance = x; }),
        overridesEditor('sick')),
      namesSettings());
  }

  /* ---------- Export / print / backup ---------- */
  function download(name, mime, text) {
    const blob = new Blob([text], { type: mime }), url = URL.createObjectURL(blob), a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
  }
  function exportICS() {
    const x = ui.exp, items = [];
    if (x.duty) {
      if (!E.validDate(x.from) || !E.validDate(x.to) || E.dayNum(x.to) < E.dayNum(x.from)) { toast('Check the date range'); return; }
      if (E.dayNum(x.to) - E.dayNum(x.from) > 3700) { toast('Range is too long (max 10 years)'); return; }
      for (const c of cals()) if (x.calId === 'all' || x.calId === c.id) items.push(...E.dutyEvents(S, c.id, x.from, x.to));
    }
    const types = [];
    if (x.vacation) types.push('vacation', 'personal'); if (x.sick) types.push('sick'); if (x.edo) types.push('edo'); if (x.notes) types.push('note', 'other');
    items.push(...E.entryEvents(S.entries.filter((e) => (e.who ? x.others && E.isSpot(e.type) : types.includes(e.type))), S));
    if (!items.length) { toast('Nothing to export for that selection'); return; }
    download('shift-leave-planner-' + today + '.ics', 'text/calendar', E.buildICS(items, { name: 'Shift & Leave Planner' }));
    toast('Exported ' + items.length + ' events');
  }
  function cbx(label, key) { return h('label', { class: 'row', style: 'margin:6px 0' }, h('input', { type: 'checkbox', checked: ui.exp[key], onchange: (ev) => { ui.exp[key] = ev.target.checked; render(); } }), h('span', {}, label)); }
  function viewData() {
    const x = ui.exp, p = ui.prn, msg = ui.msg.restore;
    const fileIn = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        let obj; try { obj = JSON.parse(rd.result); } catch (e) { ui.msg.restore = { bad: ['That file is not valid JSON.'] }; render(); return; }
        const r = E.validateState(obj);
        if (!r.ok) { ui.msg.restore = { bad: r.errors.slice(0, 8) }; render(); return; }
        if (!confirm('Replace ALL current data with this backup (' + r.state.entries.length + ' entries)? This cannot be undone.')) return;
        S = r.state; ver++; cache = {}; ui.msg.restore = { good: 'Backup restored.' }; save(); render();
      };
      rd.readAsText(f);
    } });
    return h('div', {},
      h('div', { class: 'card' }, h('h2', {}, 'Export to Apple / Google Calendar (.ics)'),
        h('div', { class: 'hint' }, 'Choose what to include. Open the downloaded file and your calendar app offers to add the events. No account or sign-in needed.'),
        cbx('Duty days (date range)', 'duty'),
        x.duty ? h('div', {}, h('label', { class: 'f' }, h('span', {}, 'Which calendar'), h('select', { onchange: (ev) => { x.calId = ev.target.value; } }, h('option', { value: 'all', selected: x.calId === 'all' }, 'All calendars'), cals().map((c) => h('option', { value: c.id, selected: x.calId === c.id }, c.title)))),
          h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', { class: 'f' }, h('span', {}, 'From'), h('input', { type: 'date', value: x.from, onchange: (ev) => { x.from = ev.target.value; } }))), h('div', { class: 'grow' }, h('label', { class: 'f' }, h('span', {}, 'To'), h('input', { type: 'date', value: x.to, onchange: (ev) => { x.to = ev.target.value; } }))))) : null,
        cbx('My vacation and personal leave', 'vacation'), cbx('My sick leave', 'sick'), cbx('My EDOs', 'edo'), cbx('My notes and other time off', 'notes'), cbx('Everyone else\'s time off (with names)', 'others'),
        h('button', { class: 'btn pri', style: 'width:100%;margin-top:8px', onclick: exportICS }, 'Export selected')),
      h('div', { class: 'card' }, h('h2', {}, 'Print'),
        h('label', { class: 'f' }, h('span', {}, 'What to print'), h('select', { onchange: (ev) => { p.kind = ev.target.value; render(); } }, [['cal', 'Calendar sheet (like your paper sheet)'], ['year', 'Annual overview (all calendars)'], ['edo', 'EDO breakouts'], ['vac', 'My vacation selections'], ['proj', 'Leave balance projections']].map(([k, l]) => h('option', { value: k, selected: p.kind === k }, l)))),
        p.kind === 'cal' ? h('label', { class: 'f' }, h('span', {}, 'Calendar'), h('select', { onchange: (ev) => { p.calId = ev.target.value; } }, cals().map((c) => h('option', { value: c.id, selected: p.calId === c.id }, c.title)))) : null,
        h('label', { class: 'f' }, h('span', {}, 'Year'), h('input', { type: 'number', value: String(p.year), step: '1', onchange: (ev) => { const y = parseInt(ev.target.value, 10); if (y >= 1990 && y <= 2100) p.year = y; } })),
        ['cal', 'year', 'edo'].includes(p.kind) ? h('div', { class: 'seg', style: 'margin:6px 0' }, h('button', { class: p.filled ? 'on' : '', onclick: () => { p.filled = true; render(); } }, 'Filled in'), h('button', { class: !p.filled ? 'on' : '', onclick: () => { p.filled = false; render(); } }, 'Blank')) : null,
        h('button', { class: 'btn pri', style: 'width:100%', onclick: doPrint }, 'Print / save as PDF'),
        h('div', { class: 'hint' }, 'Prints in black and white, landscape for calendars. Blank sheets have empty lines to write names in by hand. On iPhone use Share → Print.')),
      h('div', { class: 'card' }, h('h2', {}, 'Backup and restore'),
        h('div', { class: 'hint' }, 'Everything is saved automatically on this device. A JSON backup is your safety net and your snapshot of a plan: your browser can clear site data. Download one after big changes.'),
        h('div', { class: 'row' }, h('button', { class: 'btn pri grow', onclick: () => download('shift-leave-planner-backup-' + today + '.json', 'application/json', JSON.stringify(S, null, 2)) }, 'Download backup'), h('button', { class: 'btn grow', onclick: () => fileIn.click() }, 'Restore from backup'), fileIn),
        msg && msg.bad ? h('div', { class: 'err' }, h('b', {}, 'Restore failed, nothing was changed:'), h('ul', {}, msg.bad.map((m) => h('li', {}, m)))) : null,
        msg && msg.good ? h('div', { class: 'okbox' }, msg.good) : null,
        h('button', { class: 'btn dng', style: 'margin-top:12px', onclick: () => { if (confirm('Erase ALL entries, names, settings and balances on this device? Download a backup first. This cannot be undone.') && confirm('Really erase everything?')) { S = E.defaultState(); ver++; cache = {}; ui.msg = {}; save(); go('home'); toast('Reset to defaults'); } } }, 'Reset everything')));
  }

  /* ---------- Print ---------- */
  function slotsFor(calId, date) {
    const n = spots(), F = Array(n).fill(null), Sx = Array(n).fill(null);
    const es = dateEntries(date).filter((e) => e.cal === calId && E.isSpot(e.type) && E.isActive(e)).sort((a, b) => (a.half === 'W' ? 0 : 1) - (b.half === 'W' ? 0 : 1));
    for (const e of es) {
      if (e.half === 'W') { const i = F.findIndex((v, k) => !v && !Sx[k]); if (i >= 0) { F[i] = e; Sx[i] = e; } }
      else if (e.half === 'F') { const i = F.findIndex((v) => !v); if (i >= 0) F[i] = e; }
      else { const i = Sx.findIndex((v) => !v); if (i >= 0) Sx[i] = e; }
    }
    return { F, S: Sx };
  }
  function pCalSheet(calId, year, filled) {
    const cal = E.calById(S, calId), n = spots(), wrap = h('div', { class: 'p-cal' });
    const cell = (e) => h('td', { class: 'nm' + (e && !e.who ? ' me' : '') }, e ? [e.who || 'Me', h('sup', {}, T[e.type].short)] : '');
    for (let m = 1; m <= 12; m++) {
      const dates = E.dutyDates(S, calId, E.iso(year, m, 1), E.iso(year, m, E.daysInMonth(year, m)));
      wrap.append(h('table', { class: 'p-sheet' },
        h('colgroup', {}, h('col', { style: 'width:0.5in' }), h('col', { style: 'width:0.3in' })),
        h('thead', {}, h('tr', { class: 'mh' }, h('th', { colspan: 2 + 2 * n }, MONTHS[m - 1] + ' ' + year + ' · ' + cal.title)), h('tr', { class: 'hh' }, h('th', {}, 'Date'), h('th', {}, 'Day'), h('th', { colspan: n }, 'FIRST 12'), h('th', { colspan: n }, 'SECOND 12'))),
        h('tbody', {}, dates.map((d) => { const sl = filled ? slotsFor(calId, d) : { F: Array(n).fill(null), S: Array(n).fill(null) }; return h('tr', {}, h('td', { class: 'd' }, fmtDate(d, 'short')), h('td', { class: 'w' }, DOW3[E.dow(d)]), sl.F.map(cell), sl.S.map(cell)); }))));
    }
    return wrap;
  }
  function pMonth(y, m, filled) {
    const g = h('div', { class: 'p-grid' });
    DOW.forEach((d) => g.append(h('div', { class: 'h' }, d)));
    for (let i = 0; i < E.dow(E.iso(y, m, 1)); i++) g.append(h('div'));
    for (let d = 1; d <= E.daysInMonth(y, m); d++) {
      const date = E.iso(y, m, d), cl = E.dutyCals(date, S), es = dateEntries(date);
      if (E.isFeb29(date)) { g.append(h('div', { class: 'lp' }, String(d), h('small', {}, 'n/c'))); continue; }
      const idx = cl.length ? calIdx(cl[0]) + 1 : 0, off = filled ? es.filter((e) => E.isSpot(e.type)).length : 0;
      g.append(h('div', { class: 'u' + (idx % 3 || 3) }, String(d), h('small', {}, (idx ? String(idx) : '') + (off ? ' •' + off : ''))));
    }
    return h('div', { class: 'p-mon' }, h('h4', {}, MONTHS[m - 1] + ' ' + y), g);
  }
  function doPrint() {
    const p = ui.prn, root = document.getElementById('printRoot'), y = p.year, filled = p.filled;
    let landscape = false; const out = [];
    if (p.kind === 'cal') {
      landscape = true;
      out.push(h('div', { class: 'p-title' }, calTitle(p.calId) + ' · ' + y + (filled ? '' : ' · blank')));
      out.push(pCalSheet(p.calId, y, filled));
      out.push(h('div', { class: 'p-key' }, 'Three spots per half. A Whole 24 name goes in the same slot in both halves. Boxed name = me. Letter after a name: V vacation, S sick, P personal, E EDO, O other.'));
    } else if (p.kind === 'year') {
      landscape = true;
      out.push(h('div', { class: 'p-title' }, y + ' Annual Overview'));
      out.push(h('div', { class: 'p-year' }, MONTHS.map((_, i) => pMonth(y, i + 1, filled))));
      out.push(h('div', { class: 'p-key' }, cals().map((c, i) => (i + 1) + ' = ' + c.title).join('   ·   ') + '   ·   n/c = Feb 29, not counted' + (filled ? '   ·   •n = people with time off' : '')));
    } else if (p.kind === 'edo') {
      out.push(h('div', { class: 'p-title' }, y + ' EDO Breakouts' + (filled ? '' : ' · blank')));
      const by = E.edoByMonth(S.entries, y);
      out.push(h('div', { class: 'p-eboxes' }, by.map((x) => h('div', { class: 'p-ebox' + (filled && x.entries.length ? ' on' : '') }, h('b', {}, MONTHS[x.month - 1]), h('div', {}, filled && x.entries.length ? x.entries.map((e) => fmtDate(e.date, 'short') + (e.status === 'mine' ? '' : ' (tent.)')).join(', ') : ' ')))));
    } else if (p.kind === 'vac') {
      const l = S.entries.filter((e) => !e.who && (e.type === 'vacation' || e.type === 'personal') && E.isActive(e) && e.date.startsWith(String(y))).sort((a, b) => a.date.localeCompare(b.date)), V = getL('vac'), fm = flagMap();
      out.push(h('div', { class: 'p-title' }, y + ' Vacation Selections'));
      out.push(h('table', { class: 'p-t' }, h('thead', {}, h('tr', {}, ['Date', 'Type', 'Time', 'Hours', 'Status', 'Balance after', 'Note'].map((c, i) => h('th', { class: i === 3 || i === 5 ? 'r' : '' }, c)))),
        h('tbody', {}, l.map((e) => { const r = V.events.find((x) => x.kind === 'deduct' && x.entry.id === e.id); return h('tr', {}, h('td', {}, fmtDate(e.date, 'mid')), h('td', {}, T[e.type].label), h('td', {}, E.HALVES[e.half]), h('td', { class: 'r' }, fmtH(e.hours)), h('td', {}, e.status.toUpperCase()), h('td', { class: 'r' }, r ? fmtH(r.after) + (fm[e.id] ? ' SHORT' : '') : ''), h('td', {}, e.note)); }))));
      if (!l.length) out.push(h('p', {}, 'No vacation scheduled.'));
    } else {
      out.push(h('div', { class: 'p-title' }, y + ' Leave Balance Projection'));
      for (const bank of ['vac', 'sick']) {
        const L = getL(bank), st = L.stats(y);
        out.push(h('p', {}, h('b', {}, bank === 'vac' ? 'Vacation' : 'Sick leave'), ': start ' + fmtH(st.startBal) + ' h, accrued ' + fmtH(st.accrued) + ' h, scheduled ' + fmtH(st.scheduled) + ' h' + (st.other ? ', other ' + fmtH(st.other) + ' h' : '') + ', year-end ' + fmtH(st.yearEnd) + ' h, lowest ' + fmtH(st.lowest) + ' h (' + fmtDate(st.lowestDate, 'short') + ')'));
        const rows = L.events.filter((r) => E.parse(r.date).y === y && (r.kind === 'deduct' || r.removed || r.kind === 'accrual'));
        out.push(h('table', { class: 'p-t' }, h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Event'), h('th', { class: 'r' }, '± h'), h('th', { class: 'r' }, 'Balance'))), h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, fmtDate(r.date, 'short')), h('td', {}, describe(r) + (r.shortfall > 0 ? ' (SHORT)' : '')), h('td', { class: 'r' }, r.kind === 'accrual' ? '+' + fmtH(r.hours) : r.kind === 'deduct' ? '-' + fmtH(r.hours) : r.removed ? '-' + fmtH(r.removed) : ''), h('td', { class: 'r' }, fmtH(r.after)))))));
      }
    }
    root.replaceChildren(...out);
    let st = document.getElementById('pageStyle'); if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.append(st); }
    st.textContent = '@page { size: ' + (landscape ? 'landscape' : 'portrait') + '; margin: 0.4in; }';
    setTimeout(() => { if (typeof window.print === 'function') { try { window.print(); } catch (e) { /* ignore */ } } }, 60);
  }

  /* ---------- Help ---------- */
  const HELP = [
    ['Start here: 4 steps', ['1. Settings → Calendars: give each calendar a title (1 Unit, 2 Unit, 3 Unit, or anything) and its start date. Pick which one is yours. Tick the confirm box once the "next duty days" match your real schedule.', '2. Settings → Pay periods, Vacation, Sick: enter any one real pay-period start date, your tier or rate, and your starting balances. Tick each confirm box.', '3. Calendar: tap a date, pick what / who / when, tap Save. That is the whole entry.', '4. Export tab → Download backup, now and after big changes. A dated backup is also your saved copy of a plan.']],
    ['Adding time off: what / who / when', ['Tap a date, then + Add under the calendar. Three rows of big buttons: WHAT (Vacation, EDO, Sick, Personal, Other, Note), WHO (Me, or a name), WHEN (First 12, Second 12, Whole 24).', 'It opens on your last choices, so five vacation days in a row is: tap date, tap Save.', 'Other people: tap a name chip, or + New name and type it. New names are saved and appear as chips next time. Fix spellings in Settings → Names.', 'Your own entries count against your leave balance. Other people\'s entries never do.', 'More: switch Tentative / Mine, type custom hours, move the date, add a note. Tap the status tag on any of your entries to flip it.', 'Every save has an Undo button for a few seconds.']],
    ['The three-spots rule', ['Each date has First 12 and Second 12. Each half has 3 spots. Whole 24 uses a spot in both halves; First 12 or Second 12 uses one spot in that half. So a date can hold up to six names, for example two Whole plus one First 12 leaves one Second 12 spot.', 'The dots on each date show it: top row First 12, bottom row Second 12, red when all 3 are taken. Full or already-booked choices are greyed out before you can pick them. Your own entry counts as one of the three.', 'The same person cannot be off twice in the same half of a date.']],
    ['Calendar and filters', ['Each calendar works every 3rd day from its start date. Feb 29 is shown but not counted: no calendar works it, and the cycle picks up on March 1 as if it did not exist.', 'The chips above the calendar are switches. Tap a calendar to show or hide its dates. Hidden dates go blank but stay in place. Show all dates turns everything back on; Only my calendar shows just yours.', 'My entries keeps any date where you have something visible even if its calendar is hidden. Full days shows only dates where a half has all 3 spots taken.', 'Month shows one month; Year shows all twelve. The "Showing" line says what you are seeing and how many dates.', 'Select range: tap the first and last date, then choose what/who/when once. It fills every duty day of that calendar in between and tells you which dates it skipped because they were full.']],
    ['Reading the projections', ['Tap any date to see: "Based on your starting balance, accrued hours, and previously scheduled vacation, your projected available vacation balance on [date] will be [N] hours." It counts only hours already earned by that date, minus leave scheduled on or before it.', 'A red outline or "Short by" warning means you will not have earned enough hours by that date, even if you will earn them later. Deleting an entry gives the hours back and every later date is recalculated.', 'Hours become available after the pay period ends by default. The Leave tab and Settings have a toggle to compare with start-of-period.']],
    ['EDO breakouts', ['The Home screen shows 12 boxes, one per calendar month. A box fills in when you have an EDO in that month and lists the dates. Delete the EDO and it empties. Nothing is counted or limited; how many you may take is up to you.']],
    ['Export, print, backup', ['Export tab: build an .ics file for duty days (pick the calendar and dates), your vacation, sick, EDOs, notes, and optionally everyone\'s time off with names. Open it and Apple Calendar or Google Calendar offers to add the events.', 'Print: a calendar sheet laid out like your paper sheet (each duty date with First 12 and Second 12 name lines), the annual overview, EDO breakouts, your vacation selections, or balance projections. Choose Filled in or Blank. Blank sheets are for writing in by hand.', 'Backup/restore uses a JSON file. Restore checks the file first and changes nothing if it is invalid. Reset asks twice.']],
    ['What the CBA says (and what it does not)', ['Vacation per pay period (shift personnel), §27.1: under 1 yr 4.62, 1–<5 yrs 4.62, 5–<10 yrs 6.46, 10–<15 yrs 8.30, 15–<20 yrs 10.15, 20–<25 yrs 12.00, 25+ yrs 13.84. Under one year it accrues but cannot be taken until one year of service.', 'Carryover §27.4: 264 h. Excess over 264 at Dec 31 carries but must be used by Mar 31, or is forfeited/converted (§27.7: up to 72 h if rate ≤ 6.46, up to 120 h if ≥ 8.30). Personal leave §27.8: up to 24 h from the vacation bank each year.', 'Not stated in the CBA, so you set it: the pay-period calendar; whether accrual posts at the start or end of a period; that the excess over 264 is used first.']]
  ];
  function viewHelp() {
    return h('div', {}, h('div', { class: 'card' }, h('h2', {}, 'How to use Shift & Leave Planner'), h('div', { class: 'hint' }, 'Tap a heading to open it. This guide is always one tap away from the ? at the top.')),
      HELP.map(([t, ps], i) => acc('help' + i, t, ps.map((p) => h('p', {}, p)))),
      h('button', { class: 'btn', onclick: () => go('home') }, 'Back to Home'));
  }

  /* ---------- boot ---------- */
  S = load();
  const first = cals().map((c) => c.start).sort()[0];
  if (E.dayNum(today) < E.dayNum(first)) { const p = E.parse(first); ui.year = p.y; ui.month = p.m; }
  ui.prn.year = ui.year; ui.exp.from = E.iso(ui.year, 1, 1); ui.exp.to = E.iso(ui.year, 12, 31); ui.prn.calId = S.settings.myCal;
  window.__SLP = { get state() { return S; }, ui, render, go, showDay, showForm, exportICS, doPrint, mutate };
  render();
})();
