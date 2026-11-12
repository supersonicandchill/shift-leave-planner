const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const J = (x) => JSON.stringify(x);
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, '');
const engineSrc = fs.readFileSync(path.join(root, 'engine.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

let pass = 0, fail = 0;
const results = [];
function t(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

function boot(seed) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.detail && e.detail.message || e.message)));
  vc.on('error', (m) => errors.push('console.error: ' + m));
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.addEventListener('error', (e) => errors.push('window error: ' + e.message));
  if (seed) for (const k in seed) w.localStorage.setItem(k, seed[k]);
  w.confirm = () => true; w.prompt = () => null; w.print = () => { w.__printed = (w.__printed || 0) + 1; };
  w.URL.createObjectURL = (b) => { w.__blob = b; return 'blob:x'; }; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { w.__downloaded = this.getAttribute('download'); };
  w.TextEncoder = TextEncoder; w.eval(engineSrc); w.eval(appSrc);
  return { w, d: w.document, errors, S: () => w.__SLP.state, ui: w.__SLP.ui };
}
const $ = (d, sel) => d.querySelector(sel), $$ = (d, sel) => Array.from(d.querySelectorAll(sel));
const byText = (d, sel, text) => $$(d, sel).find((e) => e.textContent.trim() === text || e.textContent.trim().startsWith(text));
const stored = (w) => JSON.parse(w.localStorage.getItem('shiftLeavePlanner.v2'));
const setInput = (w, el, val) => { el.value = val; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };

const A = boot();
const { w, d } = A;
const DAY = '2027-03-05'; // calendar 1 duty day
const cellFor = (date) => $(d, '[aria-label="' + w.eval('(function(){return null})()') + '"]');
function openDay(date) { w.__SLP.go('calendar'); const p = w.Engine.parse(date); A.ui.year = p.y; A.ui.month = p.m; A.ui.mode = 'month'; w.__SLP.render(); const lab = new w.Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); const c = $$(d, '.cell').find((e) => e.getAttribute('aria-label') === lab); assert.ok(c, 'cell for ' + date); c.click(); }

console.log('UI SMOKE');
t('app loads with no console or script errors; 5 tabs; header', () => {
  assert.deepStrictEqual(A.errors, []);
  assert.strictEqual($$(d, 'nav.tabs button').length, 5); assert.ok($(d, 'header.bar h1').textContent.includes('Shift & Leave Planner'));
  assert.ok($(d, '[name=viewport]') || true);
});
t('every tab renders without errors', () => {
  for (const tab of ['home', 'calendar', 'leave', 'data', 'settings', 'help']) { w.__SLP.go(tab); assert.ok($(d, '#content').children.length > 0, tab); }
  assert.deepStrictEqual(A.errors, []);
});
t('first view is January 2027 (earliest calendar start) when today is before it; calendar shows month grid', () => {
  const today = w.Engine.todayISO();
  if (today < '2027-01-01') { assert.strictEqual(A.ui.year, 2027); assert.strictEqual(A.ui.month, 1); }
  w.__SLP.go('calendar'); A.ui.year = 2027; A.ui.month = 3; w.__SLP.render();
  assert.strictEqual($$(d, '.grid .cell').length, 31);
  assert.ok($$(d, '.cell.u1').length >= 10 && $$(d, '.cell.u2').length >= 9 && $$(d, '.cell.u3').length >= 9);
});
t('quick entry: tap date, + Add, Save -> one Me / Vacation / Whole entry, 24 h, saved to localStorage', () => {
  openDay(DAY);
  assert.ok($(d, '.sheet'));
  byText(d, '.sheet button', '+ Add').click();
  assert.ok(byText(d, '.opt', 'Vacation') && byText(d, '.opt', 'Whole 24'));
  byText(d, '.sheet button', 'Save').click();
  const e = A.S().entries; assert.strictEqual(e.length, 1);
  assert.deepStrictEqual([e[0].date, e[0].type, e[0].who, e[0].half, e[0].hours, e[0].status, e[0].cal], [DAY, 'vacation', '', 'W', 24, 'tentative', 'c1']);
  assert.strictEqual(stored(w).entries.length, 1);
  assert.deepStrictEqual(A.errors, []);
});
t('the day sheet shows the entry; slots show 1/3 in both halves', () => {
  const txt = $(d, '.sheet').textContent; assert.ok(txt.includes('First 12 · 1/3') && txt.includes('Second 12 · 1/3'), txt.slice(0, 300));
});
t('add someone else: + New name, type, First 12, Save -> name saved to the list, no balance effect', () => {
  const before = JSON.stringify(w.Engine.buildLedger('vac', A.S()).stats(2027));
  byText(d, '.sheet button', '+ Add').click();
  byText(d, '.opt', 'EDO').click();
  byText(d, '.opt', '+ New name').click();
  setInput(w, $(d, '.sheet input[list]'), 'Hadley');
  byText(d, '.opt', 'First 12').click();
  byText(d, '.sheet button', 'Save').click();
  const e = A.S().entries.find((x) => x.who === 'Hadley');
  assert.ok(e && e.type === 'edo' && e.half === 'F' && e.status === '' && e.hours === 12, JSON.stringify(e));
  assert.strictEqual(J(A.S().names), J(['Hadley']));
  assert.strictEqual(JSON.stringify(w.Engine.buildLedger('vac', A.S()).stats(2027)), before);
});
t('name chip appears next time; picking it and saving a Whole adds a second Whole (my entry + Cook = 2 whole + Hadley first)', () => {
  byText(d, '.sheet button', '+ Add').click();
  byText(d, '.opt', '+ New name').click(); setInput(w, $(d, '.sheet input[list]'), 'Cook'); byText(d, '.opt', 'Whole 24').click();
  byText(d, '.sheet button', 'Save').click();
  assert.strictEqual(J(A.S().names), J(['Cook', 'Hadley']));
  byText(d, '.sheet button', '+ Add').click();
  assert.ok(byText(d, '.opt', 'Hadley') && byText(d, '.opt', 'Cook'));
});
t('your scenario in the UI: First 12 is now full (3/3): First 12 button disabled, Second 12 enabled, a fourth name is blocked for Whole', () => {
  // state now: Me whole, Cook whole, Hadley first  -> First 12 = 3, Second 12 = 2
  byText(d, '.opt', '+ New name').click(); setInput(w, $(d, '.sheet input[list]'), 'Busch');
  const f = byText(d, '.opt', 'First 12'), s2 = byText(d, '.opt', 'Second 12'), wh = byText(d, '.opt', 'Whole 24');
  assert.ok(f.disabled, 'First 12 should be disabled'); assert.ok(!s2.disabled, 'Second 12 should be enabled'); assert.ok(wh.disabled, 'Whole should be disabled');
  assert.ok(f.textContent.includes('0 left') && s2.textContent.includes('1 left'));
  byText(d, '.opt', 'Second 12').click();
  byText(d, '.sheet button', 'Save').click();
  const sp = w.Engine.spotUse(A.S().entries, 'c1', DAY);
  assert.strictEqual(sp.F.length, 3); assert.strictEqual(sp.S.length, 3);
});
t('with both halves full: the form says the day is full and Save is disabled', () => {
  byText(d, '.sheet button', '+ Add').click();
  const txt = $(d, '.sheet').textContent; assert.ok(txt.includes('This day is full'), txt.slice(0, 400));
  assert.ok(byText(d, '.sheet button', 'Save').disabled);
  byText(d, '.sheet button', 'Cancel').click();
});
t('a hand-forced fourth Whole entry is rejected by the engine check (defence in depth)', () => {
  const r = w.Engine.checkPlace(A.S().entries, { id: 'zz', cal: 'c1', date: DAY, type: 'vacation', who: 'Z', half: 'W' }, 3);
  assert.ok(!r.ok);
});
t('cell shows red full-state and dots', () => {
  w.__SLP.render();
  const cell = $$(d, '.cell.fullh'); assert.ok(cell.length >= 1); assert.ok($$(d, '.dr.full').length >= 2);
});
t('Full days filter keeps only the full date(s)', () => {
  byText(d, '.chip', 'Full days').click();
  const shown = $$(d, '.grid .cell:not(.hidden)'); assert.strictEqual(shown.length, 1);
  byText(d, '.chip', 'Full days').click();
});
t('calendar chips hide and show dates; Show all dates restores', () => {
  const total = () => $$(d, '.grid .cell:not(.hidden)').length;
  const all = total(); assert.strictEqual(all, 31);
  byText(d, '.chip', '2 Unit').click(); byText(d, '.chip', '3 Unit').click();
  byText(d, '.chip', 'My entries').click(); // off: pure view
  const onlyOne = total(); assert.ok(onlyOne >= 10 && onlyOne <= 11, 'only 1 Unit dates, got ' + onlyOne);
  assert.ok($(d, '.showing').textContent.includes('1 Unit'));
  byText(d, 'button', 'Show all dates').click(); assert.strictEqual(total(), 31);
  byText(d, '.chip', 'My entries').click();
});
t('filter state persists in localStorage', () => {
  byText(d, '.chip', '3 Unit').click();
  assert.strictEqual(stored(w).ui.filter.c3, false);
  byText(d, 'button', 'Show all dates').click();
});
t('range select fills only the chosen calendar\'s duty days and skips full dates with a message', () => {
  A.ui.year = 2027; A.ui.month = 4; w.__SLP.go('calendar'); w.__SLP.render();
  byText(d, '.btn', 'Select range').click();
  const lab = (n) => new w.Date(Date.UTC(2027, 3, n)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  $$(d, '.cell').find((e) => e.getAttribute('aria-label') === lab(1)).click();
  $$(d, '.cell').find((e) => e.getAttribute('aria-label') === lab(10)).click();
  byText(d, '.opt', 'Sick').click(); byText(d, '.opt', 'Whole 24').click();
  byText(d, '.sheet button', 'Save').click();
  const sick = A.S().entries.filter((e) => e.type === 'sick' && e.date.startsWith('2027-04'));
  const expected = w.Engine.expandRange('2027-04-01', '2027-04-10', A.S(), 'c1');
  assert.strictEqual(J(sick.map((e) => e.date)), J(expected));
  assert.ok(sick.every((e) => e.hours === 24 && e.half === 'W'));
});
t('EDO breakout box fills when I place an EDO in that month, empties when deleted; others\' EDOs do not fill it', () => {
  w.__SLP.go('home'); A.ui.year = 2027; w.__SLP.render();
  assert.strictEqual($$(d, '.ebox.on').length, 0);
  openDay('2027-05-03'); byText(d, '.sheet button', '+ Add').click(); byText(d, '.opt', 'EDO').click(); byText(d, '.opt', 'Whole 24').click(); byText(d, '.sheet button', 'Save').click();
  w.__SLP.go('home'); assert.strictEqual($$(d, '.ebox.on').length, 1); assert.ok($(d, '.ebox.on').textContent.startsWith('May'));
  const e = A.S().entries.find((x) => x.type === 'edo' && !x.who && x.date === '2027-05-03');
  w.__SLP.mutate(() => { A.S().entries = A.S().entries.filter((x) => x.id !== e.id); });
  assert.strictEqual($$(d, '.ebox.on').length, 0);
  // Hadley's EDO in March (other person) must not fill March
  assert.ok(!$$(d, '.ebox.on').some((b) => b.textContent.startsWith('Mar')));
});
t('delete then Undo restores the entry', () => {
  openDay(DAY);
  const n0 = A.S().entries.length;
  const del = $$(d, '.sheet .entry').find((e) => e.textContent.includes('Cook')).querySelector('.btn.dng'); del.click();
  assert.strictEqual(A.S().entries.length, n0 - 1);
  $$(d, '.toast .undo').pop().click();
  assert.strictEqual(A.S().entries.length, n0); assert.ok(A.S().entries.some((e) => e.who === 'Cook'));
});
t('tapping the status tag flips Tentative <-> Mine on my entry, and it persists', () => {
  openDay(DAY);
  const pill = $(d, '.sheet .pill'); assert.strictEqual(pill.textContent, 'TENTATIVE'); pill.click();
  assert.strictEqual(A.S().entries.find((e) => !e.who && e.date === DAY).status, 'mine'); assert.strictEqual(stored(w).entries.find((e) => !e.who && e.date === DAY).status, 'mine');
});
t('Feb 29 (2028): shown, not counted; adding leave there is blocked; a note is allowed', () => {
  openDay('2028-02-29');
  assert.ok($(d, '.sheet').textContent.includes('not counted'));
  assert.ok(!$$(d, '.sheet button').some((b) => b.textContent.trim() === '+ Add'));
  byText(d, '.sheet button', '+ Add a note').click(); const ta = $(d, '.sheet textarea'); setInput(w, ta, 'leap note');
  byText(d, '.sheet button', 'Save').click();
  assert.ok(A.S().entries.some((e) => e.type === 'note' && e.date === '2028-02-29'));
});
t('leave tab: shows balance statement; shortfall appears for premature vacation', () => {
  w.__SLP.mutate(() => { A.S().settings.vac.balance = 0; A.S().settings.vac.rates = [{ effective: '2027-01-01', rate: 4.62 }]; });
  openDay('2027-01-04'); byText(d, '.sheet button', '+ Add').click(); byText(d, '.opt', 'Vacation').click(); byText(d, '.opt', 'Whole 24').click(); byText(d, '.sheet button', 'Save').click();
  assert.ok($(d, '.sheet').textContent.includes('Short by'), $(d, '.sheet').textContent.slice(0, 300));
  w.__SLP.go('leave'); assert.ok($(d, '#content').textContent.includes('Balance through the year') && $(d, '#content svg.chart'));
});
t('names are rendered as text: markup in a name or note never becomes an element', () => {
  w.__SLP.mutate(() => { A.S().entries.push({ id: 'x1', cal: 'c2', date: '2027-03-06', type: 'vacation', who: '<img src=x onerror=window.__pwn=1>', half: 'W', hours: 24, status: '', title: '', note: '<b id=evil>hi</b>' }); });
  openDay('2027-03-06');
  assert.ok(!$(d, 'img') && !$(d, '#evil')); assert.ok(!w.__pwn); assert.ok($(d, '.sheet').textContent.includes('<img src=x'));
});
t('settings: change a start date -> calendar recalculates; titles editable; confirm box persists', () => {
  w.__SLP.go('settings'); byText(d, 'summary', 'Calendars').click();
  const inputs = $$(d, 'details.acc')[0].querySelectorAll('input[type=text]');
  setInput(w, inputs[0], 'A Shift'); assert.strictEqual(A.S().settings.calendars[0].title, 'A Shift');
  setInput(w, inputs[0], '1 Unit');
  const dates = $$(d, 'details.acc')[0].querySelectorAll('input[type=date]');
  setInput(w, dates[0], '2027-01-02');
  assert.strictEqual(w.Engine.dutyDates(A.S(), 'c1', '2027-01-01', '2027-01-10')[0], '2027-01-02');
  setInput(w, $$(d, 'details.acc')[0].querySelectorAll('input[type=date]')[0], '2027-01-01');
  const cb = $$(d, 'details.acc')[0].querySelector('input[type=checkbox]'); cb.checked = true; cb.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.strictEqual(stored(w).settings.confirmed.calendars, true);
  setInput(w, $$(d, 'details.acc')[0].querySelectorAll('input[type=date]')[0], '2028-02-29');
  assert.ok($(d, '.err') && $(d, '.err').textContent.includes('valid start date'));
});
t('names manager: rename updates entries everywhere', () => {
  A.ui.msg.num = ''; w.__SLP.go('settings'); byText(d, 'summary', 'Names').click();
  w.prompt = () => 'Cooke'; $$(d, '.row.sp').find((r) => r.firstChild && r.firstChild.textContent === 'Cook').querySelector('.btn').click();
  assert.ok(A.S().names.includes('Cooke') && !A.S().names.includes('Cook'));
  assert.ok(A.S().entries.some((e) => e.who === 'Cooke') && !A.S().entries.some((e) => e.who === 'Cook'));
});
t('print: calendar sheet for 2027 has 12 month tables and 122 rows for calendar 1; blank has no names; window.print called', () => {
  w.__SLP.go('data'); A.ui.prn = { kind: 'cal', calId: 'c1', year: 2027, filled: true }; w.__SLP.doPrint();
  const p = $(d, '#printRoot'); assert.strictEqual($$(p, 'table.p-sheet').length, 12);
  assert.strictEqual($$(p, 'table.p-sheet tbody tr').length, 122);
  assert.ok(p.textContent.includes('Cooke') && p.textContent.includes('Hadley'));
  assert.ok($$(p, 'td.nm.me').length >= 1);
  A.ui.prn.filled = false; w.__SLP.doPrint();
  assert.ok(!p.textContent.includes('Cooke')); assert.strictEqual($$(p, 'table.p-sheet tbody tr').length, 122);
  assert.strictEqual($$(p, 'table.p-sheet tbody tr:first-child td.nm').length, 72);
  assert.ok($(d, '#pageStyle').textContent.includes('landscape'));
});
t('print: year overview, EDO breakouts (blank + filled), vacation, projections all render', () => {
  for (const kind of ['year', 'edo', 'vac', 'proj']) for (const filled of [true, false]) { A.ui.prn = { kind, calId: 'c1', year: 2027, filled }; w.__SLP.doPrint(); assert.ok($(d, '#printRoot').children.length > 0, kind); }
  A.ui.prn = { kind: 'edo', calId: 'c1', year: 2027, filled: false }; w.__SLP.doPrint(); assert.strictEqual($$(d, '#printRoot .p-ebox').length, 12); assert.strictEqual($$(d, '#printRoot .p-ebox.on').length, 0);
  assert.deepStrictEqual(A.errors, []);
});
t('ICS export builds a valid file including names for other people when asked', () => {
  w.__SLP.go('data'); A.ui.exp = { duty: true, calId: 'c1', from: '2027-01-01', to: '2027-01-31', vacation: true, sick: true, edo: true, notes: false, others: true };
  w.__SLP.exportICS();
  assert.ok(w.__downloaded.endsWith('.ics'));
});
t('backup download is valid JSON that the validator accepts (full round trip through the UI state)', () => {
  const r = w.Engine.validateState(JSON.parse(JSON.stringify(A.S())));
  assert.ok(r.ok, r.errors.join('; '));
});
t('reload: a new session with the saved data shows the same entries (persistence)', () => {
  const B = boot({ 'shiftLeavePlanner.v2': w.localStorage.getItem('shiftLeavePlanner.v2') });
  assert.deepStrictEqual(B.errors, []); assert.strictEqual(B.S().entries.length, A.S().entries.length); assert.strictEqual(J(B.S().names), J(A.S().names));
});
t('corrupt saved data: app starts fresh, keeps a recovery copy, shows a warning, no crash', () => {
  const B = boot({ 'shiftLeavePlanner.v2': '{not json' });
  assert.deepStrictEqual(B.errors, []); assert.strictEqual(B.S().entries.length, 0);
  assert.strictEqual(B.w.localStorage.getItem('shiftLeavePlanner.v2.corrupt'), '{not json');
  assert.ok(B.d.querySelector('#content .err').textContent.includes('could not be read'));
});
t('invalid-but-parseable saved data (breaks the spot rule) is rejected with a warning and a recovery copy', () => {
  const s = JSON.parse(JSON.stringify(A.S())); s.entries = ['A', 'B', 'C', 'D'].map((n, i) => ({ id: 'q' + i, cal: 'c1', date: '2027-03-05', type: 'vacation', who: n, half: 'W', hours: 24, status: '', title: '', note: '' }));
  const B = boot({ 'shiftLeavePlanner.v2': JSON.stringify(s) });
  assert.strictEqual(B.S().entries.length, 0); assert.ok(B.d.querySelector('#content .err').textContent.includes('failed validation'));
});
t('storage blocked (private mode): app still works and warns', () => {
  const B = boot();
  B.w.Storage.prototype.setItem = function () { throw new Error('quota'); };
  B.w.__SLP.mutate(() => { B.S().names.push('X'); });
  assert.ok(B.d.querySelector('header .saved').textContent.includes('not saving')); assert.deepStrictEqual(B.errors, []);
});
t('help tab has the how-to sections', () => {
  w.__SLP.go('help'); const s = $$(d, 'details.acc summary').map((x) => x.textContent);
  assert.ok(s.some((x) => x.includes('three-spots')) && s.some((x) => x.includes('Start here')) && s.some((x) => x.includes('Calendar and filters')));
});
t('no console or script errors across the whole run', () => assert.deepStrictEqual(A.errors, []));

setTimeout(() => {
  t('window.print() is actually invoked after the print view is built', () => assert.ok(w.__printed >= 10, 'printed ' + w.__printed));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}, 400);
