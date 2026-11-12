const assert = require('assert');
const E = require('../engine.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
let idn = 0;
// entry builder. who '' = me.
const ent = (date, type, o) => {
  o = o || {};
  const spot = E.isSpot(type);
  const who = o.who || '';
  const half = spot ? (o.half || 'W') : '';
  const T = E.TYPES[type];
  return { id: 'e' + (++idn), cal: o.cal !== undefined ? o.cal : (spot ? 'c1' : ''), date, type, who, half,
    hours: o.hours !== undefined ? o.hours : (T.deduct ? E.hoursFor(half || 'W') : 0),
    status: spot && !who ? (o.status || 'tentative') : '', title: '', note: '' };
};
const base = (mod) => { const s = E.defaultState(); if (mod) mod(s); return s; };
const setStarts = (s, a, b, c) => { s.settings.calendars[0].start = a; s.settings.calendars[1].start = b; s.settings.calendars[2].start = c; };

/* independent reference: walk the real calendar day by day, skipping Feb 29, mark every Nth day */
function naiveWorks(start, cycle, fromYear, toYear) {
  const out = {};
  const A = E.dayNum(start), lo = E.dayNum(fromYear + '-01-01'), hi = E.dayNum(toYear + '-12-31');
  let k = 0;
  for (let n = A; n <= hi; n++) { const d = E.fromDayNum(n); if (E.isFeb29(d)) continue; if (n >= lo) out[d] = (k % cycle === 0); k++; }
  k = 0;
  for (let n = A - 1; n >= lo; n--) { const d = E.fromDayNum(n); if (E.isFeb29(d)) continue; k--; out[d] = (((k % cycle) + cycle) % cycle === 0); }
  return out;
}

console.log('CALENDARS / ROTATION');
[['2027-01-01', 3], ['2026-01-03', 3], ['2028-03-01', 3], ['2027-01-02', 3], ['2040-02-28', 3], ['2027-06-15', 4]].forEach(([start, cycle], i) => {
  t('matches independent reference 2000-2105, start ' + start + ' every ' + cycle, () => {
    const ref = naiveWorks(start, cycle, 2000, 2105), cal = { id: 'x', title: 'x', start };
    let n = 0;
    for (const d in ref) { assert.strictEqual(E.calWorks(d, cal, cycle, null), ref[d], d); n++; }
    assert.ok(n > 38000);
  });
});
t('your 2026 1-Unit sheet: starts Jan 3, ends Dec 29, 121 dates, and every sampled date matches', () => {
  const s = base(); setStarts(s, '2026-01-03', '2026-01-04', '2026-01-05');
  const d = E.dutyDates(s, 'c1', '2026-01-01', '2026-12-31');
  assert.strictEqual(d.length, 121); assert.strictEqual(d[0], '2026-01-03'); assert.strictEqual(d[d.length - 1], '2026-12-29');
  ['2026-01-18', '2026-02-08', '2026-03-01', '2026-03-04', '2026-03-07', '2026-05-06', '2026-06-14', '2026-08-04', '2026-09-27', '2026-12-26', '2026-02-26', '2026-04-12', '2026-11-26'].forEach((x) => assert.ok(d.includes(x), x));
  ['2026-01-04', '2026-01-05', '2026-02-27', '2026-03-02'].forEach((x) => assert.ok(!d.includes(x), x));
});
t('2027 default calendars: 122 / 122 / 121 dates; start Jan 1, 2, 3', () => {
  const s = base();
  const a = E.dutyDates(s, 'c1', '2027-01-01', '2027-12-31'), b = E.dutyDates(s, 'c2', '2027-01-01', '2027-12-31'), c = E.dutyDates(s, 'c3', '2027-01-01', '2027-12-31');
  assert.deepStrictEqual([a.length, b.length, c.length], [122, 122, 121]);
  assert.deepStrictEqual([a[0], b[0], c[0]], ['2027-01-01', '2027-01-02', '2027-01-03']);
  assert.deepStrictEqual([a[a.length - 1], b[b.length - 1], c[c.length - 1]], ['2027-12-30', '2027-12-31', '2027-12-29']);
});
t('every day of 2027 is worked by exactly one calendar', () => {
  const s = base();
  for (let n = E.dayNum('2027-01-01'); n <= E.dayNum('2027-12-31'); n++) assert.strictEqual(E.dutyCals(E.fromDayNum(n), s).length, 1, E.fromDayNum(n));
});
t('2027 per-month counts for calendar 1', () => {
  const a = E.dutyDates(base(), 'c1', '2027-01-01', '2027-12-31');
  const by = [...Array(12)].map((_, i) => a.filter((d) => +d.slice(5, 7) === i + 1).length);
  assert.deepStrictEqual(by, [11, 9, 10, 10, 11, 10, 10, 10, 10, 11, 10, 10]);
});
t('Feb 29 is never a duty day, does not advance the cycle, and March 1 resumes', () => {
  const s = base(); setStarts(s, '2028-02-26', '2028-02-27', '2028-02-28'); // Feb 28 2028 is cal 3's day, Feb 29 pretends not to exist
  assert.deepStrictEqual(E.dutyCals('2028-02-28', s), ['c3']);
  assert.deepStrictEqual(E.dutyCals('2028-02-29', s), []);
  assert.deepStrictEqual(E.dutyCals('2028-03-01', s), ['c1']); // the day after Feb 28 in the cycle
  assert.deepStrictEqual(E.dutyCals('2028-03-02', s), ['c2']);
});
t('cycle does not drift across leap years 2026-2100', () => {
  const s = base();
  for (let y = 2027; y <= 2100; y++) {
    const d = E.dutyDates(s, 'c1', y + '-01-01', y + '-12-31');
    for (let i = 1; i < d.length; i++) {
      const gap = E.dayNum(d[i]) - E.dayNum(d[i - 1]);
      const spansLeap = E.isLeap(y) && d[i - 1] <= y + '-02-29' && d[i] > y + '-02-29';
      assert.strictEqual(gap, spansLeap ? 4 : 3, d[i]);
    }
  }
});
t('changing a start date regenerates the duty dates; titles are free text', () => {
  const s = base(); s.settings.calendars[0].title = 'A Shift'; s.settings.calendars[0].start = '2027-01-02';
  assert.strictEqual(E.dutyDates(s, 'c1', '2027-01-01', '2027-01-31')[0], '2027-01-02');
});
t('manual override marks a date and can be restored', () => {
  const s = base(); s.overrides = { c1: { '2027-01-05': true, '2027-01-07': false } }; // Jan 5 is normally off, Jan 7 normally on
  assert.ok(E.dutyCals('2027-01-05', s).includes('c1')); assert.ok(!E.dutyCals('2027-01-07', s).includes('c1'));
  assert.ok(E.calInfo('2027-01-05', s.settings.calendars[0], s).forced);
  delete s.overrides.c1['2027-01-05']; delete s.overrides.c1['2027-01-07'];
  assert.ok(!E.dutyCals('2027-01-05', s).includes('c1')); assert.ok(E.dutyCals('2027-01-07', s).includes('c1'));
});
t('expandRange keeps only that calendar\'s duty days and skips Feb 29', () => {
  const s = base();
  assert.deepStrictEqual(E.expandRange('2027-01-01', '2027-01-10', s, 'c1'), ['2027-01-01', '2027-01-04', '2027-01-07', '2027-01-10']);
  assert.ok(!E.expandRange('2028-02-27', '2028-03-02', s).includes('2028-02-29'));
});

console.log('FILTERING');
t('all on shows every date; one off hides only that calendar; Feb 29 chip works', () => {
  const s = base();
  assert.ok(E.passesFilter('2027-01-02', s, {}));
  s.ui.filter.c2 = false;
  assert.ok(!E.passesFilter('2027-01-02', s, {})); assert.ok(E.passesFilter('2027-01-01', s, {}));
  s.ui.filter.leap = false; assert.ok(!E.passesFilter('2028-02-29', s, {}));
});
t('"my entries" keeps a hidden date visible; off hides it', () => {
  const s = base(); s.ui.filter.c1 = false; s.ui.filter.c3 = false;
  assert.ok(!E.passesFilter('2027-01-01', s, { hasMine: false }));
  assert.ok(E.passesFilter('2027-01-01', s, { hasMine: true }));
  s.ui.filter.mine = false; assert.ok(!E.passesFilter('2027-01-01', s, { hasMine: true }));
});
t('full-days filter shows only dates with a full half', () => {
  const s = base(); s.ui.filter.full = true;
  assert.ok(!E.passesFilter('2027-01-01', s, { full: false })); assert.ok(E.passesFilter('2027-01-01', s, { full: true }));
});

console.log('THREE SPOTS PER HALF');
const day = '2027-03-05'; // calendar 1 works (Jan 1 + 63 days)
t('fixture date is a calendar-1 day', () => assert.deepStrictEqual(E.dutyCals(day, base()), ['c1']));
t('your example: two Whole + one First 12 -> First full, Second has room; then a Second 12 fits, a Whole does not', () => {
  const s = base(); s.entries = [ent(day, 'vacation', { who: 'Hadley' }), ent(day, 'vacation', { who: 'Cook' }), ent(day, 'edo', { who: 'Busch', half: 'F' })];
  const f = E.freeSpots(s.entries, 'c1', day, 3);
  assert.deepStrictEqual([f.F, f.S], [0, 1]);
  assert.ok(E.checkPlace(s.entries, ent(day, 'vacation', { who: 'Koss', half: 'S' }), 3).ok);
  const w = E.checkPlace(s.entries, ent(day, 'vacation', { who: 'Koss', half: 'W' }), 3);
  assert.ok(!w.ok); assert.deepStrictEqual(w.full, ['F']);
  assert.ok(!E.checkPlace(s.entries, ent(day, 'vacation', { who: 'Koss', half: 'F' }), 3).ok);
});
t('a day can hold up to six names: 3 First 12 + 3 Second 12', () => {
  const s = base();
  ['A', 'B', 'C'].forEach((n) => s.entries.push(ent(day, 'vacation', { who: n, half: 'F' })));
  ['D', 'E', 'F'].forEach((n) => { const e = ent(day, 'sick', { who: n, half: 'S' }); assert.ok(E.checkPlace(s.entries, e, 3).ok); s.entries.push(e); });
  assert.ok(E.isFull(s.entries, 'c1', day, 3));
  assert.ok(!E.checkPlace(s.entries, ent(day, 'edo', { who: 'G', half: 'S' }), 3).ok);
});
t('three Whole entries fill both halves; a fourth name is blocked and the block names both halves', () => {
  const s = base(); ['A', 'B', 'C'].forEach((n) => s.entries.push(ent(day, 'vacation', { who: n })));
  const r = E.checkPlace(s.entries, ent(day, 'edo', { who: 'D', half: 'W' }), 3);
  assert.ok(!r.ok); assert.deepStrictEqual(r.full.sort(), ['F', 'S']);
  assert.deepStrictEqual(r.use.F.map((e) => e.who).sort(), ['A', 'B', 'C']);
});
t('my own entry counts as one of the three', () => {
  const s = base(); s.entries = [ent(day, 'vacation', {}), ent(day, 'vacation', { who: 'A' }), ent(day, 'vacation', { who: 'B' })];
  assert.ok(!E.checkPlace(s.entries, ent(day, 'vacation', { who: 'C' }), 3).ok);
});
t('all five time-off types use a spot; notes and adjustments do not', () => {
  const s = base(); ['vacation', 'personal', 'sick'].forEach((ty, i) => s.entries.push(ent(day, ty, { who: 'P' + i })));
  assert.ok(!E.checkPlace(s.entries, ent(day, 'edo', { who: 'Z' }), 3).ok);
  assert.ok(!E.checkPlace(s.entries, ent(day, 'other', { who: 'Z' }), 3).ok);
  assert.ok(E.checkPlace(s.entries, ent(day, 'note', {}), 3).ok);
  assert.ok(E.checkPlace(s.entries, ent(day, 'adjvac', { hours: 4 }), 3).ok);
});
t('same person cannot be on overlapping halves of one date; First 12 + Second 12 is allowed; case-insensitive', () => {
  const s = base(); s.entries = [ent(day, 'vacation', { who: 'Hadley', half: 'F' })];
  assert.ok(!E.checkPlace(s.entries, ent(day, 'edo', { who: ' hadley ', half: 'W' }), 3).ok);
  assert.ok(E.checkPlace(s.entries, ent(day, 'sick', { who: 'Hadley', half: 'S' }), 3).ok);
  const mine = [ent(day, 'vacation', {}), ];
  assert.ok(!E.checkPlace(mine, ent(day, 'sick', {}), 3).ok);
});
t('editing an entry ignores itself when checking spots', () => {
  const s = base(); ['A', 'B', 'C'].forEach((n) => s.entries.push(ent(day, 'vacation', { who: n })));
  const edit = Object.assign({}, s.entries[0], { half: 'F' });
  assert.ok(E.checkPlace(s.entries, edit, 3).ok);
});
t('spots are per calendar: the same date on another calendar has its own spots', () => {
  const s = base(); ['A', 'B', 'C'].forEach((n) => s.entries.push(ent(day, 'vacation', { who: n })));
  assert.ok(E.checkPlace(s.entries, ent(day, 'vacation', { who: 'D', cal: 'c2' }), 3).ok);
});
t('spots setting is honored (e.g. 2)', () => {
  const s = base(); ['A', 'B'].forEach((n) => s.entries.push(ent(day, 'vacation', { who: n })));
  assert.ok(!E.checkPlace(s.entries, ent(day, 'vacation', { who: 'C' }), 2).ok);
});
t('names list: added once, canonical spelling reused, rename updates every entry, delete leaves entries', () => {
  const s = base(); E.addName(s.names, ' Hadley '); E.addName(s.names, 'hadley'); E.addName(s.names, 'Cook');
  assert.deepStrictEqual(s.names, ['Cook', 'Hadley']);
  assert.strictEqual(E.canonName(s.names, 'cook'), 'Cook');
  s.entries = [ent(day, 'vacation', { who: 'Hadley' }), ent('2027-03-07', 'edo', { who: 'Hadley', half: 'F' })];
  assert.ok(E.renameName(s, 'Hadley', 'Hadly').ok); assert.ok(s.entries.every((e) => e.who === 'Hadly')); assert.ok(s.names.includes('Hadly'));
  assert.ok(!E.renameName(s, 'Hadly', 'cook').ok);
  s.names = s.names.filter((n) => n !== 'Hadly'); assert.strictEqual(s.entries.length, 2);
});
t('EDO breakout boxes: my EDOs fill their calendar month; others\' EDOs and other types do not; two in a month is fine', () => {
  const s = base(); s.entries = [ent('2027-03-04', 'edo', {}), ent('2027-03-31', 'edo', {}), ent('2027-04-03', 'edo', { who: 'Cook' }), ent('2027-05-03', 'vacation', {}), ent('2026-03-04', 'edo', {})];
  const b = E.edoByMonth(s.entries, 2027);
  assert.deepStrictEqual(b.map((x) => x.entries.length), [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  s.entries.pop(); s.entries.shift(); // remove one -> box updates
  assert.strictEqual(E.edoByMonth(s.entries, 2027)[2].entries.length, 1);
});

console.log('LEAVE ACCRUAL / PROJECTION');
const st = (mod) => base((s) => {
  s.settings.baselineDate = '2026-01-01';
  s.settings.accrual = { freq: 'monthly', n: 14, anchor: '2026-01-01', timing: 'end', effective: '' };
  s.settings.vac.balance = 120; s.settings.vac.rates = [{ effective: '2026-01-01', rate: 8 }];
  s.settings.sick.balance = 0; s.settings.sick.rates = [{ effective: '2026-01-01', rate: 7 }];
  if (mod) mod(s);
});
t('monthly accrual, end-of-period: 120 start, 8/mo, Mar 10/11 + Jul 15 @24', () => {
  const s = st(); s.entries = [ent('2026-03-10', 'vacation', { hours: 24 }), ent('2026-03-11', 'vacation', { hours: 24 }), ent('2026-07-15', 'vacation', { hours: 24 })];
  const L = E.buildLedger('vac', s);
  assert.strictEqual(L.balanceOn('2026-03-10'), 112);
  assert.strictEqual(L.balanceOn('2026-03-11'), 88);
  assert.strictEqual(L.balanceOn('2026-07-14'), 88 + 8 * 4);
  assert.strictEqual(L.balanceOn('2026-07-15'), 88 + 32 - 24);
  assert.strictEqual(L.balanceOn('2026-10-15'), 96 + 8 * 3);
});
t('timing "start" credits one period earlier than "end" (toggle)', () => {
  const sE = st(), sS = st((x) => { x.settings.accrual.timing = 'start'; });
  assert.strictEqual(E.buildLedger('vac', sS).balanceOn('2026-03-10') - E.buildLedger('vac', sE).balanceOn('2026-03-10'), 8);
});
t('accrual is NOT counted before it is available (premature vacation flagged)', () => {
  const s = st((x) => { x.settings.vac.balance = 10; }); s.entries = [ent('2026-01-05', 'vacation', { hours: 24 })];
  const L = E.buildLedger('vac', s), r = L.events.find((e) => e.kind === 'deduct');
  assert.strictEqual(r.shortfall, 14); assert.strictEqual(L.balanceOn('2026-01-05'), -14); assert.ok(r.coveredOn);
});
t('vacation after enough accrual: no shortfall', () => {
  const s = st(); s.entries = [ent('2026-06-05', 'vacation', { hours: 24 })];
  assert.strictEqual(E.buildLedger('vac', s).events.find((e) => e.kind === 'deduct').shortfall, 0);
});
t('later vacation is flagged when earlier vacation consumed the hours', () => {
  const s = st((x) => { x.settings.vac.balance = 30; }); s.entries = [ent('2026-01-10', 'vacation', { hours: 24 }), ent('2026-01-20', 'vacation', { hours: 24 })];
  const ev = E.buildLedger('vac', s).events.filter((e) => e.kind === 'deduct');
  assert.strictEqual(ev[0].shortfall, 0); assert.strictEqual(ev[1].shortfall, 18);
});
t('12-hour halves deduct 12; Whole deducts 24', () => {
  const s = st(); s.entries = [ent('2026-05-05', 'vacation', { half: 'F' }), ent('2026-05-06', 'vacation', { half: 'W' })];
  assert.strictEqual(E.buildLedger('vac', s).balanceOn('2026-05-06'), E.buildLedger('vac', st()).balanceOn('2026-05-06') - 36);
});
t('deleting an entry gives the hours back and recomputes later shortfalls', () => {
  const s = st((x) => { x.settings.vac.balance = 30; x.settings.vac.rates = [{ effective: '2026-01-01', rate: 0 }]; });
  s.entries = [ent('2026-06-16', 'vacation', { hours: 24 }), ent('2026-07-01', 'vacation', { hours: 24 })];
  assert.strictEqual(E.buildLedger('vac', s).events.filter((e) => e.kind === 'deduct')[1].shortfall, 18);
  s.entries.shift();
  assert.strictEqual(E.buildLedger('vac', s).events.filter((e) => e.kind === 'deduct')[0].shortfall, 0);
});
t('tentative and mine both count toward projection', () => {
  const s = st(); s.entries = [ent('2026-05-05', 'vacation', { hours: 8, status: 'tentative' }), ent('2026-05-06', 'vacation', { hours: 8, status: 'mine' })];
  assert.strictEqual(E.buildLedger('vac', s).balanceOn('2026-05-07'), E.buildLedger('vac', st()).balanceOn('2026-05-07') - 16);
});
t('other people\'s time off never touches my balances', () => {
  const s = st(); s.entries = [ent('2026-05-05', 'vacation', { who: 'Cook' }), ent('2026-05-05', 'sick', { who: 'Hadley' })];
  assert.strictEqual(E.buildLedger('vac', s).balanceOn('2026-12-31'), E.buildLedger('vac', st()).balanceOn('2026-12-31'));
  assert.strictEqual(E.buildLedger('sick', s).balanceOn('2026-12-31'), E.buildLedger('sick', st()).balanceOn('2026-12-31'));
});
t('sick leave is independent of vacation (and vice versa)', () => {
  const s = st(); s.entries = [ent('2026-05-05', 'sick', { hours: 24 })];
  assert.strictEqual(E.buildLedger('vac', s).balanceOn('2026-12-31'), E.buildLedger('vac', st()).balanceOn('2026-12-31'));
  assert.strictEqual(E.buildLedger('sick', s).balanceOn('2026-12-31'), E.buildLedger('sick', st()).balanceOn('2026-12-31') - 24);
});
t('personal leave and other deductions come out of vacation; EDO/other/notes deduct nothing', () => {
  const s = st(); s.entries = [ent('2026-05-05', 'personal', { hours: 2 }), ent('2026-05-06', 'adjvac', { hours: 4 }), ent('2026-05-07', 'edo', {}), ent('2026-05-08', 'other', {}), ent('2026-05-09', 'note', {})];
  assert.strictEqual(E.buildLedger('vac', s).balanceOn('2026-05-09'), E.buildLedger('vac', st()).balanceOn('2026-05-09') - 6);
});
t('under-one-year rule: vacation before the first usable date is flagged "early" but still accrues', () => {
  const s = st((x) => { x.settings.vac.firstUse = '2026-09-01'; });
  s.entries = [ent('2026-08-31', 'vacation', { hours: 24 }), ent('2026-09-01', 'vacation', { hours: 24 })];
  const ev = E.buildLedger('vac', s).events.filter((e) => e.kind === 'deduct');
  assert.strictEqual(ev[0].early, true); assert.strictEqual(ev[1].early, false);
});
t('biweekly pay-period accrual: 27 credits land in 2026 (anchor Jan 1, start timing); end timing starts Jan 15', () => {
  const s = st((x) => { x.settings.accrual = { freq: 'days', n: 14, anchor: '2026-01-01', timing: 'start', effective: '' }; x.settings.vac.rates = [{ effective: '2026-01-01', rate: 12 }]; x.settings.vac.balance = 0; });
  const acc = E.buildLedger('vac', s).events.filter((e) => e.kind === 'accrual' && e.date.startsWith('2026'));
  assert.strictEqual(acc.length, 27); assert.strictEqual(acc[1].date, '2026-01-15');
  assert.strictEqual(E.accrualDates({ freq: 'days', n: 14, anchor: '2026-01-01', timing: 'end', effective: '' }, '2026-01-01', '2026-12-31')[0], '2026-01-15');
});
t('rate change effective on a date (service tier change)', () => {
  const s = st((x) => { x.settings.accrual = { freq: 'days', n: 14, anchor: '2026-01-01', timing: 'start', effective: '' }; x.settings.vac.balance = 0; x.settings.vac.rates = [{ effective: '2026-01-01', rate: 10.15 }, { effective: '2026-07-01', rate: 12 }]; });
  assert.strictEqual(E.rateAt(s.settings.vac.rates, '2026-06-30'), 10.15); assert.strictEqual(E.rateAt(s.settings.vac.rates, '2026-07-01'), 12);
  const hrs = E.buildLedger('vac', s).events.filter((e) => e.kind === 'accrual').map((e) => e.hours);
  assert.ok(hrs.includes(10.15) && hrs.includes(12));
});
t('accrual effective date delays accrual', () => {
  const s = st((x) => { x.settings.accrual.effective = '2026-06-01'; });
  assert.ok(E.dayNum(E.buildLedger('vac', s).events.find((e) => e.kind === 'accrual').date) >= E.dayNum('2026-06-01'));
});
t('carryover: >264 at Jan 1 -> excess used first; unused excess forfeited at Mar 31', () => {
  const s = st((x) => { x.settings.vac.balance = 300; x.settings.vac.rates = [{ effective: '2026-01-01', rate: 0 }]; });
  s.entries = [ent('2026-02-10', 'vacation', { hours: 24 })];
  const L = E.buildLedger('vac', s), ex = L.events.find((e) => e.kind === 'expire' && e.year === 2026);
  assert.strictEqual(ex.removed, 12); assert.strictEqual(ex.forfeited, 12); assert.strictEqual(ex.converted, 0);
  assert.strictEqual(L.balanceOn('2026-03-30'), 276); assert.strictEqual(L.balanceOn('2026-03-31'), 264);
});
t('carryover: conversion option converts up to the limit instead of forfeiting', () => {
  const s = st((x) => { x.settings.vac.balance = 300; x.settings.vac.rates = [{ effective: '2026-01-01', rate: 0 }]; x.settings.vac.convertExcess = true; x.settings.vac.convertLimit = 120; });
  const ex = E.buildLedger('vac', s).events.find((e) => e.kind === 'expire' && e.year === 2026);
  assert.strictEqual(ex.removed, 36); assert.strictEqual(ex.converted, 36); assert.strictEqual(ex.forfeited, 0);
  s.settings.vac.convertLimit = 10;
  const ex2 = E.buildLedger('vac', s).events.find((e) => e.kind === 'expire' && e.year === 2026);
  assert.strictEqual(ex2.converted, 10); assert.strictEqual(ex2.forfeited, 26);
});
t('excess fully used before Mar 31: nothing forfeited', () => {
  const s = st((x) => { x.settings.vac.balance = 290; x.settings.vac.rates = [{ effective: '2026-01-01', rate: 0 }]; });
  s.entries = [ent('2026-02-01', 'vacation', { hours: 24 }), ent('2026-02-04', 'vacation', { hours: 24 })];
  assert.ok(!E.buildLedger('vac', s).events.find((e) => e.kind === 'expire' && e.year === 2026).removed);
});
t('switching years: balance carries into 2027; Jan 1 override replaces it', () => {
  const s = st((x) => { x.settings.vac.balance = 100; });
  const L = E.buildLedger('vac', s), dec31 = L.balanceOn('2026-12-31');
  assert.strictEqual(dec31, 100 + 8 * L.events.filter((e) => e.kind === 'accrual' && e.date.startsWith('2026')).length);
  assert.ok(L.balanceOn('2027-02-01') > dec31);
  const L2 = E.buildLedger('vac', st((x) => { x.settings.vac.balance = 100; x.settings.vac.yearOverrides = { 2027: 50 }; }));
  assert.strictEqual(L2.balanceOn('2027-01-01') - L2.events.filter((e) => e.date === '2027-01-01' && e.kind === 'accrual').reduce((a, e) => a + e.hours, 0), 50);
});
t('sick leave has no cap: it keeps accruing past 1900', () => {
  const s = st((x) => { x.settings.sick.balance = 1895; });
  assert.ok(E.buildLedger('sick', s).balanceOn('2026-12-31') > 1900);
});
t('stats: accrued/scheduled/lowest/year-end', () => {
  const s = st(); s.entries = [ent('2026-03-10', 'vacation', { hours: 24 }), ent('2026-03-11', 'vacation', { hours: 24 })];
  const L = E.buildLedger('vac', s), x = L.stats(2026);
  assert.strictEqual(x.scheduled, 48); assert.strictEqual(x.startBal, 120);
  assert.strictEqual(x.yearEnd, 120 + x.accrued - 48);
  assert.strictEqual(x.lowest, Math.min(120, L.balanceOn('2026-03-11')));
});

console.log('EXPORT (ICS)');
t('ICS: CRLF, required fields, all-day with exclusive end, stable UIDs', () => {
  const s = base(); const evs = E.dutyEvents(s, 'c1', '2027-01-01', '2027-01-10');
  const a = E.buildICS(evs, { now: new Date(Date.UTC(2027, 0, 1)) }), b = E.buildICS(evs, { now: new Date(Date.UTC(2027, 5, 1)) });
  assert.ok(a.startsWith('BEGIN:VCALENDAR\r\n') && a.endsWith('END:VCALENDAR\r\n'));
  assert.strictEqual((a.match(/BEGIN:VEVENT/g) || []).length, 4);
  assert.ok(a.includes('DTSTART;VALUE=DATE:20270101') && a.includes('DTEND;VALUE=DATE:20270102'));
  assert.ok(!/[^\r]\n/.test(a));
  assert.deepStrictEqual(a.match(/UID:[^\r]+/g), b.match(/UID:[^\r]+/g));
});
t('ICS: month/year rollover end date; escaping; 75-octet folding incl. multibyte', () => {
  const ics = E.buildICS([{ uid: 'x', date: '2027-12-31', summary: 'a,b;c\\d', description: 'line1\nline2 ' + 'é'.repeat(80) }]);
  assert.ok(ics.includes('DTEND;VALUE=DATE:20280101')); assert.ok(ics.includes('SUMMARY:a\\,b\\;c\\\\d'));
  ics.split('\r\n').forEach((l) => assert.ok(new TextEncoder().encode(l).length <= 75, l.slice(0, 20)));
  assert.ok(ics.replace(/\r\n /g, '').includes('line1\\nline2'));
});
t('entry events include names, halves, status; others\' time off carries the name', () => {
  const s = base(); const me = ent('2027-03-04', 'vacation', { half: 'F' }), ot = ent('2027-03-04', 'edo', { who: 'Hadley', half: 'S' });
  const [a, b] = E.entryEvents([me, ot], s);
  assert.ok(a.summary.includes('Me: Vacation') && a.summary.includes('First 12') && a.summary.includes('[tentative]'));
  assert.ok(b.summary.startsWith('Hadley: EDO') && b.summary.includes('Second 12') && !b.summary.includes('[') );
  assert.ok(b.description.includes('Calendar: 1 Unit'));
});
t('exporting from 2000 to 2100 never emits Feb 29 as a duty day', () => {
  const s = base(); const evs = E.dutyEvents(s, 'c1', '2027-01-01', '2100-12-31');
  assert.ok(!evs.some((e) => e.date.endsWith('-02-29')));
});

console.log('BACKUP / RESTORE');
t('round trip: JSON -> validate -> identical state', () => {
  const s = base((x) => { x.names = ['Cook', 'Hadley']; x.entries = [ent('2027-03-04', 'vacation', {}), ent('2027-03-04', 'edo', { who: 'Hadley', half: 'F' }), ent('2027-03-07', 'note', {})]; x.overrides = { c1: { '2027-01-04': true } }; x.settings.vac.firstUse = '2027-06-01'; });
  const r = E.validateState(JSON.parse(JSON.stringify(s)));
  assert.ok(r.ok, r.errors.join('; ')); assert.deepStrictEqual(r.state, s);
});
t('default state is itself valid', () => assert.ok(E.validateState(JSON.parse(JSON.stringify(base()))).ok));
const bad = (mut) => { const s = JSON.parse(JSON.stringify(base())); mut(s); return E.validateState(s); };
t('rejects garbage, old versions, bad dates, unknown calendar/type/half, bad status', () => {
  assert.ok(!E.validateState(null).ok); assert.ok(!E.validateState('x').ok); assert.ok(!E.validateState([]).ok);
  assert.ok(!bad((s) => { s.schema = 1; }).ok);
  assert.ok(!bad((s) => { s.settings.calendars[0].start = '2027-02-30'; }).ok);
  assert.ok(!bad((s) => { s.settings.calendars[0].start = '2028-02-29'; }).ok);
  assert.ok(!bad((s) => { s.entries = [{ id: 'a', cal: 'zz', date: '2027-03-04', type: 'vacation', who: '', half: 'W', hours: 24, status: 'tentative' }]; }).ok);
  assert.ok(!bad((s) => { s.entries = [{ id: 'a', cal: 'c1', date: '2027-03-04', type: 'bogus', who: '', half: 'W', hours: 24, status: 'tentative' }]; }).ok);
  assert.ok(!bad((s) => { s.entries = [{ id: 'a', cal: 'c1', date: '2027-03-04', type: 'vacation', who: '', half: 'X', hours: 24, status: 'tentative' }]; }).ok);
  assert.ok(!bad((s) => { s.entries = [{ id: 'a', cal: 'c1', date: '2027-03-04', type: 'vacation', who: '', half: 'W', hours: 24, status: 'approved' }]; }).ok);
  assert.ok(!bad((s) => { s.entries = [{ id: 'a', cal: 'c1', date: '2027-03-04', type: 'vacation', who: '', half: 'W', hours: -3, status: 'tentative' }]; }).ok);
  assert.ok(!bad((s) => { s.overrides = { c1: { '2028-02-29': true } }; }).ok);
  assert.ok(!bad((s) => { s.settings.myCal = 'nope'; }).ok);
});
t('rejects a file that breaks the 3-spot rule or double-books a person; accepts exactly 3', () => {
  const mk = (n) => bad((s) => { s.entries = ['A', 'B', 'C', 'D'].slice(0, n).map((w, i) => ({ id: 'e' + i, cal: 'c1', date: '2027-03-04', type: 'vacation', who: w, half: 'W', hours: 24, status: '' })); });
  assert.ok(mk(3).ok); assert.ok(!mk(4).ok);
  assert.ok(!bad((s) => { s.entries = [0, 1].map((i) => ({ id: 'd' + i, cal: 'c1', date: '2027-03-04', type: 'vacation', who: 'A', half: 'F', hours: 12, status: '' })); }).ok);
});
t('rejects duplicate ids and sanitizes oversized notes and names', () => {
  assert.ok(!bad((s) => { const e = { id: 'a', cal: 'c1', date: '2027-03-04', type: 'note', who: '', half: '', hours: 0, status: '' }; s.entries = [e, Object.assign({}, e)]; }).ok);
  const r = bad((s) => { s.entries = [{ id: 'a', cal: '', date: '2027-03-04', type: 'note', who: '', half: '', hours: 0, status: '', title: 'x'.repeat(500), note: 'y'.repeat(5000) }]; });
  assert.ok(r.ok); assert.strictEqual(r.state.entries[0].title.length, 200); assert.strictEqual(r.state.entries[0].note.length, 2000);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
