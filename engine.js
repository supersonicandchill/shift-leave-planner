/* Shift & Leave Planner — engine (pure logic, no DOM). Shared by the app and the tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MS = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);

  function parse(s) {
    if (typeof s !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { y, m: mo, d };
  }
  const validDate = (s) => parse(s) !== null;
  function dayNum(s) { const p = parse(s); return Math.round(Date.UTC(p.y, p.m - 1, p.d) / MS); }
  function fromDayNum(n) { const dt = new Date(n * MS); return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
  const addDays = (s, n) => fromDayNum(dayNum(s) + n);
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  function isFeb29(s) { const p = parse(s); return !!p && p.m === 2 && p.d === 29; }
  const leapsThrough = (y) => Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400);
  function feb29Count(s) {
    const p = parse(s);
    let c = leapsThrough(p.y - 1);
    if (isLeap(p.y) && (p.m > 2 || (p.m === 2 && p.d === 29))) c++;
    return c;
  }
  // day count with every Feb 29 removed: the rotation "pretends Feb 29 does not exist"
  const seq = (s) => dayNum(s) - feb29Count(s);
  const dow = (s) => new Date(dayNum(s) * MS).getUTCDay();
  function todayISO() { const d = new Date(); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); }

  /* ---------- Reference data (from the CBA) ---------- */
  const VAC_TIERS = [
    { id: 't0', label: 'Under 1 year', shift: 4.62, h40: 3.07, ref: '§27.1(A)', note: 'Accrues from day one but cannot be taken until one year of service. Set the "first usable date" below.' },
    { id: 't1', label: '1 to under 5 years', shift: 4.62, h40: 3.07, ref: '§27.1(B)' },
    { id: 't2', label: '5 to under 10 years', shift: 6.46, h40: 5.0, ref: '§27.1(C)' },
    { id: 't3', label: '10 to under 15 years', shift: 8.30, h40: 6.15, ref: '§27.1(D)' },
    { id: 't4', label: '15 to under 20 years', shift: 10.15, h40: 7.31, ref: '§27.1(E)' },
    { id: 't5', label: '20 to under 25 years', shift: 12.00, h40: 8.64, ref: '§27.1(G)', note: 'CBA lettering skips F.' },
    { id: 't6', label: '25 years completed', shift: 13.84, h40: 9.97, ref: '§27.1(H)' }
  ];
  const SICK_RATES = { shift: 7, h40: 5 }; // §28.1

  // spot types use one of the (default 3) spots in each half they cover
  const TYPES = {
    vacation: { label: 'Vacation', bank: 'vac', deduct: true, spot: true, short: 'V' },
    personal: { label: 'Personal leave', bank: 'vac', deduct: true, spot: true, short: 'P' },
    sick: { label: 'Sick', bank: 'sick', deduct: true, spot: true, short: 'S' },
    edo: { label: 'EDO', spot: true, short: 'E' },
    other: { label: 'Other time off', spot: true, short: 'O' },
    note: { label: 'Note', short: 'N' },
    adjvac: { label: 'Other deduction (vacation hrs)', bank: 'vac', deduct: true, adj: true, short: '-V' },
    adjsick: { label: 'Other deduction (sick hrs)', bank: 'sick', deduct: true, adj: true, short: '-S' }
  };
  const SPOT_TYPES = Object.keys(TYPES).filter((k) => TYPES[k].spot);
  const STATUSES = ['tentative', 'mine'];
  const HALVES = { F: 'First 12', S: 'Second 12', W: 'Whole 24' };
  const isSpot = (type) => !!(TYPES[type] && TYPES[type].spot);
  const hoursFor = (half) => (half === 'W' ? 24 : 12);
  const halvesOf = (h) => (h === 'W' ? ['F', 'S'] : [h]);
  const overlap = (a, b) => { const x = halvesOf(a); return halvesOf(b).some((h) => x.includes(h)); };
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
  // only my own (no name) spot entries carry a status and touch my balances
  const hasStatus = (e) => isSpot(e.type) && !e.who;

  /* ---------- Default state ---------- */
  function defaultState() {
    return {
      schema: 2,
      settings: {
        calendars: [
          { id: 'c1', title: '1 Unit', start: '2027-01-01' },
          { id: 'c2', title: '2 Unit', start: '2027-01-02' },
          { id: 'c3', title: '3 Unit', start: '2027-01-03' }
        ],
        myCal: 'c1',
        cycle: 3,
        spots: 3,
        scheduleType: 'shift',
        baselineDate: '2027-01-01',
        accrual: { freq: 'days', n: 14, anchor: '2027-01-01', timing: 'end', effective: '' },
        vac: { balance: 0, tier: '', rates: [{ effective: '2027-01-01', rate: 0 }], carryCap: 264, convertExcess: false, convertLimit: 72, firstUse: '', yearOverrides: {} },
        sick: { balance: 0, rates: [{ effective: '2027-01-01', rate: 7 }], yearOverrides: {} },
        confirmed: { calendars: false, payperiod: false, vacRate: false, balances: false }
      },
      names: [],
      entries: [],
      overrides: {},
      ui: { filter: { c1: true, c2: true, c3: true, leap: true, mine: true, full: false }, last: { type: 'vacation', who: '', half: 'W' }, tipDismissed: false }
    };
  }

  /* ---------- Calendars (every Nth day from a start date; Feb 29 never counts) ---------- */
  function calWorks(date, cal, cycle, ov) {
    if (isFeb29(date)) return false;
    const o = ov ? ov[date] : undefined;
    if (o === true || o === false) return o;
    return baseWorks(date, cal, cycle);
  }
  function baseWorks(date, cal, cycle) {
    if (isFeb29(date)) return false;
    const n = cycle || 3;
    return ((((seq(date) - seq(cal.start)) % n) + n) % n) === 0;
  }
  const calById = (st, id) => st.settings.calendars.find((c) => c.id === id) || null;
  const ovFor = (st, id) => (st.overrides && st.overrides[id]) || null;
  // ids of the calendars that work this date
  function dutyCals(date, st) {
    if (isFeb29(date)) return [];
    return st.settings.calendars.filter((c) => calWorks(date, c, st.settings.cycle, ovFor(st, c.id))).map((c) => c.id);
  }
  function calInfo(date, cal, st) {
    const base = baseWorks(date, cal, st.settings.cycle), ov = ovFor(st, cal.id), o = ov ? ov[date] : undefined;
    const forced = (o === true || o === false);
    return { works: forced ? o : base, base, forced };
  }
  function dutyDates(st, calId, from, to) {
    const cal = calById(st, calId), out = [];
    for (let n = dayNum(from); n <= dayNum(to); n++) { const d = fromDayNum(n); if (calWorks(d, cal, st.settings.cycle, ovFor(st, calId))) out.push(d); }
    return out;
  }
  function nextDutyDay(from, calId, st, max) {
    const cal = calById(st, calId); max = max || 800;
    for (let i = 0; i < max; i++) { const d = addDays(from, i); if (calWorks(d, cal, st.settings.cycle, ovFor(st, calId))) return d; }
    return null;
  }
  function expandRange(a, b, st, calId) {
    let x = dayNum(a), y = dayNum(b);
    if (x > y) { const t = x; x = y; y = t; }
    const out = [];
    for (let n = x; n <= y; n++) {
      const d = fromDayNum(n);
      if (isFeb29(d)) continue;
      if (calId && !calWorks(d, calById(st, calId), st.settings.cycle, ovFor(st, calId))) continue;
      out.push(d);
    }
    return out;
  }
  // ctx: { hasMine: bool, full: bool (some half on this date is at the spot limit) }
  function passesFilter(date, st, ctx) {
    const f = st.ui.filter;
    ctx = ctx || {};
    const cals = st.settings.calendars;
    const allCals = cals.every((c) => f[c.id]);
    let show;
    if (isFeb29(date)) show = !!f.leap;
    else if (allCals) show = true;
    else if (f.mine && ctx.hasMine) show = true;
    else show = dutyCals(date, st).some((id) => f[id]);
    if (show && f.full && !ctx.full) show = false;
    return show;
  }

  /* ---------- Entries and the 3-spot rule ---------- */
  function canonName(names, n) {
    n = String(n == null ? '' : n).trim().replace(/\s+/g, ' ');
    const hit = names.find((x) => norm(x) === norm(n));
    return hit || n;
  }
  function addName(names, n) {
    n = canonName(names, n);
    if (n && !names.some((x) => norm(x) === norm(n))) { names.push(n); names.sort((a, b) => a.localeCompare(b)); }
    return n;
  }
  function renameName(st, from, to) {
    to = String(to).trim().replace(/\s+/g, ' ');
    if (!to) return { ok: false, error: 'Name cannot be empty.' };
    if (norm(to) !== norm(from) && st.names.some((x) => norm(x) === norm(to))) return { ok: false, error: 'That name is already in the list.' };
    st.names = st.names.filter((x) => norm(x) !== norm(from));
    st.names.push(to); st.names.sort((a, b) => a.localeCompare(b));
    for (const e of st.entries) if (norm(e.who) === norm(from)) e.who = to;
    return { ok: true };
  }
  function spotUse(entries, calId, date, ignoreId) {
    const r = { F: [], S: [] };
    for (const e of entries) {
      if (e.cal !== calId || e.date !== date || !isSpot(e.type) || e.id === ignoreId) continue;
      for (const h of halvesOf(e.half)) r[h].push(e);
    }
    return r;
  }
  function freeSpots(entries, calId, date, spots, ignoreId) {
    const u = spotUse(entries, calId, date, ignoreId);
    return { F: Math.max(0, spots - u.F.length), S: Math.max(0, spots - u.S.length), use: u };
  }
  // can this entry be placed? {ok, full:['F'|'S'], dup: entry|null, use}
  function checkPlace(entries, cand, spots) {
    const res = { ok: true, full: [], dup: null, use: { F: [], S: [] } };
    if (!isSpot(cand.type)) return res;
    for (const e of entries) {
      if (e.id === cand.id || e.date !== cand.date || !isSpot(e.type)) continue;
      if (norm(e.who) === norm(cand.who) && overlap(e.half, cand.half)) { res.dup = e; res.ok = false; break; }
    }
    res.use = spotUse(entries, cand.cal, cand.date, cand.id);
    for (const h of halvesOf(cand.half)) if (res.use[h].length >= spots) res.full.push(h);
    if (res.full.length) res.ok = false;
    return res;
  }
  const isFull = (entries, calId, date, spots) => { const u = spotUse(entries, calId, date); return u.F.length >= spots || u.S.length >= spots; };
  function personalUsed(entries, year) {
    return entries.filter((e) => e.type === 'personal' && !e.who && parse(e.date).y === year).reduce((a, e) => a + e.hours, 0);
  }
  // my EDOs per calendar month, for the breakout boxes (display only, nothing is limited)
  function edoByMonth(entries, year) {
    const out = [];
    for (let m = 1; m <= 12; m++) out.push({ month: m, entries: [] });
    for (const e of entries) {
      if (e.type !== 'edo' || e.who) continue;
      const p = parse(e.date);
      if (p.y === year) out[p.m - 1].entries.push(e);
    }
    out.forEach((x) => x.entries.sort((a, b) => a.date.localeCompare(b.date)));
    return out;
  }

  /* ---------- Accrual / ledger ---------- */
  function rateAt(rates, date) {
    const d = dayNum(date);
    const sorted = rates.slice().sort((a, b) => dayNum(a.effective) - dayNum(b.effective));
    let r = sorted[0] ? sorted[0].rate : 0;
    for (const x of sorted) if (dayNum(x.effective) <= d) r = x.rate;
    return r;
  }
  // dates on which one accrual becomes available
  function accrualDates(a, from, to) {
    const out = [], t = dayNum(to);
    // The entered balance is "as of the start of the balance date": it already includes every
    // period that finished before that date. End-of-period credits post the day after a period
    // ends, so a credit ON the balance date belongs to the prior (already counted) period.
    const f = dayNum(from) + (a.timing === 'end' ? 1 : 0);
    const eff = a.effective && validDate(a.effective) ? dayNum(a.effective) : -Infinity;
    if (a.freq === 'monthly') {
      const p = parse(from);
      const base = p.y * 12 + (p.m - 1) - 2, tp = parse(to), maxMi = tp.y * 12 + (tp.m - 1) + 2;
      for (let mi = base; mi <= maxMi; mi++) {
        const y = Math.floor(mi / 12), m = (mi % 12) + 1;
        const start = dayNum(iso(y, m, 1));
        const nm = mi + 1, next = dayNum(iso(Math.floor(nm / 12), (nm % 12) + 1, 1));
        const credit = a.timing === 'start' ? start : next;
        if (credit < f || credit > t || credit < eff) continue;
        out.push(fromDayNum(credit));
      }
    } else {
      const n = Math.max(1, Math.floor(a.n) || 14), A = dayNum(a.anchor);
      for (let k = Math.floor((f - A) / n) - 2; ; k++) {
        const ps = A + k * n;
        if (ps > t + n) break;
        const credit = a.timing === 'start' ? ps : ps + n;
        if (credit < f || credit > t || credit < eff) continue;
        out.push(fromDayNum(credit));
      }
    }
    return out;
  }

  // Only entries with no name (mine) touch the ledger.
  function buildLedger(bank, st, opts) {
    opts = opts || {};
    const s = st.settings, b = s[bank];
    const baseline = s.baselineDate, bn = dayNum(baseline);
    const endDate = opts.endDate || '2070-12-31';
    const bY = parse(baseline).y, eY = parse(endDate).y;
    const ev = [];
    for (let y = bY; y <= eY; y++) {
      const jan1 = iso(y, 1, 1);
      if (dayNum(jan1) >= bn) ev.push({ date: jan1, prio: 0, kind: 'yearstart', year: y });
      if (bank === 'vac') { const m31 = iso(y, 3, 31); if (dayNum(m31) >= bn) ev.push({ date: m31, prio: 3, kind: 'expire', year: y }); }
    }
    for (const d of accrualDates(s.accrual, baseline, endDate)) ev.push({ date: d, prio: 1, kind: 'accrual', hours: rateAt(b.rates, d) });
    for (const e of st.entries) {
      const T = TYPES[e.type];
      if (e.who || !T || !T.deduct || T.bank !== bank) continue;
      if (dayNum(e.date) < bn || dayNum(e.date) > dayNum(endDate)) continue;
      ev.push({ date: e.date, prio: 2, kind: 'deduct', hours: e.hours, entry: e });
    }
    ev.sort((a, b2) => (dayNum(a.date) - dayNum(b2.date)) || (a.prio - b2.prio));

    let bal = b.balance, excess = 0;
    const out = [];
    for (const e of ev) {
      const rec = Object.assign({ dn: dayNum(e.date) }, e);
      rec.before = bal;
      if (e.kind === 'yearstart') {
        const ov = b.yearOverrides ? b.yearOverrides[e.year] : undefined;
        if (e.year > bY && ov !== undefined && ov !== null) { bal = ov; rec.manual = true; }
        if (bank === 'vac' && b.carryCap > 0) excess = Math.max(0, bal - b.carryCap);
        rec.excessSet = excess;
      } else if (e.kind === 'accrual') bal += e.hours;
      else if (e.kind === 'deduct') {
        const h = e.hours;
        if (h > 0 && excess > 0) excess -= Math.min(excess, h);
        bal -= h;
        rec.shortfall = h > 0 ? Math.max(0, Math.min(h, h - rec.before)) : 0;
        // vacation cannot be taken before the first usable date (e.g. under one year of service)
        rec.early = !!(bank === 'vac' && b.firstUse && validDate(b.firstUse) && !TYPES[e.entry.type].adj && dayNum(e.date) < dayNum(b.firstUse));
      } else if (e.kind === 'expire') {
        if (excess > 0) {
          const r = excess;
          const conv = b.convertExcess ? Math.min(r, b.convertLimit) : 0;
          bal -= r; excess = 0;
          rec.removed = r; rec.converted = conv; rec.forfeited = r - conv;
        }
      }
      rec.after = bal; rec.excessAfter = excess;
      out.push(rec);
    }
    // earliest date a short entry is covered by accruals alone
    for (let i = 0; i < out.length; i++) {
      const r = out[i];
      if (r.kind === 'deduct' && r.shortfall > 0) {
        let cum = r.before; r.coveredOn = null;
        for (let j = i + 1; j < out.length; j++) {
          if (out[j].kind === 'accrual') { cum += out[j].hours; if (cum >= r.hours) { r.coveredOn = out[j].date; break; } }
        }
      }
    }

    function balanceOn(date) {
      const d = dayNum(date);
      if (d < bn) return b.balance;
      let v = b.balance;
      for (const r of out) { if (r.dn > d) break; v = r.after; }
      return v;
    }
    function stats(year) {
      const y0 = iso(year, 1, 1), y1 = iso(year, 12, 31);
      let accrued = 0, scheduled = 0, other = 0, lowest = null, lowestDate = null, removed = 0;
      const startBal = dayNum(y0) <= bn ? b.balance : balanceOn(addDays(y0, -1));
      lowest = startBal; lowestDate = dayNum(y0) <= bn ? baseline : y0;
      for (const r of out) {
        if (r.dn < dayNum(y0) || r.dn > dayNum(y1)) continue;
        if (r.kind === 'accrual') accrued += r.hours;
        else if (r.kind === 'deduct') { if (TYPES[r.entry.type].adj) other += r.hours; else scheduled += r.hours; }
        else if (r.kind === 'expire') removed += r.removed || 0;
        if (r.after < lowest) { lowest = r.after; lowestDate = r.date; }
      }
      const yearEnd = balanceOn(y1);
      return { year, startBal, accrued, scheduled, other, removed, lowest, lowestDate, yearEnd };
    }
    return { bank, events: out, balanceOn, stats, baseline };
  }

  /* ---------- ICS ---------- */
  const icsEsc = (t) => String(t == null ? '' : t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function fold(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    let out = '', cur = '', bytes = 0;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > 75) { out += cur + '\r\n '; cur = ''; bytes = 1; }
      cur += ch; bytes += b;
    }
    return out + cur;
  }
  const compact = (s) => s.replace(/-/g, '');
  function buildICS(events, opts) {
    opts = opts || {};
    const now = opts.now || new Date();
    const stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shift and Leave Planner//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + icsEsc(opts.name || 'Shift & Leave Planner')];
    for (const e of events) {
      L.push('BEGIN:VEVENT');
      L.push('UID:' + e.uid + '@shift-leave-planner');
      L.push('DTSTAMP:' + stamp);
      L.push('DTSTART;VALUE=DATE:' + compact(e.date));
      L.push('DTEND;VALUE=DATE:' + compact(addDays(e.endDate || e.date, 1)));
      L.push('SUMMARY:' + icsEsc(e.summary));
      if (e.description) L.push('DESCRIPTION:' + icsEsc(e.description));
      L.push('TRANSP:TRANSPARENT');
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }
  function dutyEvents(st, calId, from, to) {
    const cal = calById(st, calId);
    return dutyDates(st, calId, from, to).map((d) => ({ uid: 'duty-' + calId + '-' + d, date: d, summary: cal.title + ' on duty', description: calInfo(d, cal, st).forced ? 'Manual override.' : 'Calculated: every ' + st.settings.cycle + ' days from ' + cal.start + '.' }));
  }
  function entryEvents(entries, st) {
    return entries.map((e) => {
      const T = TYPES[e.type];
      const cal = st && e.cal ? calById(st, e.cal) : null;
      const who = e.who ? e.who : (isSpot(e.type) ? 'Me' : '');
      const half = isSpot(e.type) && e.half ? HALVES[e.half] : '';
      const head = T.spot ? (who + ': ' + T.label) : (e.title ? T.label + ': ' + e.title : T.label);
      const hrs = T.deduct && !e.who ? ' ' + e.hours + ' h' : '';
      const desc = [e.note || '', cal ? 'Calendar: ' + cal.title : '', half ? 'Time: ' + half : '', hasStatus(e) ? 'Status: ' + e.status : '', T.deduct && !e.who ? 'Hours: ' + e.hours : ''].filter(Boolean).join('\n');
      return { uid: 'entry-' + e.id, date: e.date, summary: head + (half ? ' (' + half + ')' : '') + hrs + (hasStatus(e) ? ' [' + e.status + ']' : ''), description: desc };
    });
  }

  /* ---------- Validation (backup restore / load) ---------- */
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  function validateState(o) {
    const errors = [];
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, errors: ['Not a valid backup file.'], state: null };
    if (o.schema !== 2) errors.push('Unknown backup version.');
    const st = defaultState();
    const s = o.settings;
    if (!s || typeof s !== 'object') errors.push('Settings missing.');
    else {
      if (!Array.isArray(s.calendars) || s.calendars.length < 1 || s.calendars.length > 8) errors.push('Calendars missing.');
      else {
        const ids = new Set(), cals = [];
        s.calendars.forEach((c, i) => {
          if (!c || typeof c.id !== 'string' || !c.id || ids.has(c.id)) { errors.push('Calendar ' + (i + 1) + ': bad id.'); return; }
          if (!validDate(c.start) || isFeb29(c.start)) { errors.push('Calendar ' + (i + 1) + ': bad start date.'); return; }
          ids.add(c.id); cals.push({ id: c.id, title: typeof c.title === 'string' ? c.title.slice(0, 30) : '', start: c.start });
        });
        if (cals.length) st.settings.calendars = cals;
      }
      if (typeof s.myCal !== 'string' || !st.settings.calendars.some((c) => c.id === s.myCal)) errors.push('My calendar invalid.'); else st.settings.myCal = s.myCal;
      if (!(Number.isInteger(s.cycle) && s.cycle >= 2 && s.cycle <= 14)) errors.push('Cycle length invalid.'); else st.settings.cycle = s.cycle;
      if (!(Number.isInteger(s.spots) && s.spots >= 1 && s.spots <= 12)) errors.push('Spots per half invalid.'); else st.settings.spots = s.spots;
      if (s.scheduleType === 'shift' || s.scheduleType === 'h40') st.settings.scheduleType = s.scheduleType; else errors.push('Schedule type invalid.');
      if (!validDate(s.baselineDate)) errors.push('Balance start date invalid.'); else st.settings.baselineDate = s.baselineDate;
      const a = s.accrual || {};
      if (a.freq !== 'days' && a.freq !== 'monthly') errors.push('Accrual frequency invalid.'); else st.settings.accrual.freq = a.freq;
      if (!(Number.isInteger(a.n) && a.n >= 1 && a.n <= 366)) errors.push('Accrual interval invalid.'); else st.settings.accrual.n = a.n;
      if (!validDate(a.anchor)) errors.push('Pay period anchor invalid.'); else st.settings.accrual.anchor = a.anchor;
      if (a.timing !== 'start' && a.timing !== 'end') errors.push('Accrual timing invalid.'); else st.settings.accrual.timing = a.timing;
      if (a.effective && !validDate(a.effective)) errors.push('Accrual effective date invalid.'); else st.settings.accrual.effective = a.effective || '';
      for (const bank of ['vac', 'sick']) {
        const b = s[bank] || {}, tb = st.settings[bank];
        if (!isNum(b.balance)) errors.push(bank + ' balance invalid.'); else tb.balance = b.balance;
        if (!Array.isArray(b.rates) || !b.rates.length || !b.rates.every((x) => x && validDate(x.effective) && isNum(x.rate) && x.rate >= 0)) errors.push(bank + ' rates invalid.');
        else tb.rates = b.rates.map((x) => ({ effective: x.effective, rate: x.rate }));
        const yo = {};
        if (b.yearOverrides && typeof b.yearOverrides === 'object') for (const k in b.yearOverrides) { if (/^\d{4}$/.test(k) && isNum(b.yearOverrides[k])) yo[k] = b.yearOverrides[k]; else errors.push(bank + ' year override invalid.'); }
        tb.yearOverrides = yo;
      }
      const v = s.vac || {};
      if (!isNum(v.carryCap) || v.carryCap < 0) errors.push('Carryover cap invalid.'); else st.settings.vac.carryCap = v.carryCap;
      st.settings.vac.convertExcess = !!v.convertExcess;
      if (!isNum(v.convertLimit) || v.convertLimit < 0) errors.push('Conversion limit invalid.'); else st.settings.vac.convertLimit = v.convertLimit;
      st.settings.vac.tier = typeof v.tier === 'string' ? v.tier : '';
      if (v.firstUse && !validDate(v.firstUse)) errors.push('First usable vacation date invalid.'); else st.settings.vac.firstUse = v.firstUse || '';
      const c = s.confirmed || {};
      for (const key in st.settings.confirmed) st.settings.confirmed[key] = !!c[key];
    }
    st.names = [];
    if (Array.isArray(o.names)) for (const n of o.names) { if (typeof n === 'string' && n.trim()) addName(st.names, n.slice(0, 60)); else errors.push('A saved name is invalid.'); }
    st.entries = [];
    if (!Array.isArray(o.entries)) errors.push('Entries missing.');
    else {
      const seen = new Set();
      o.entries.forEach((e, i) => {
        const tag = 'Entry ' + (i + 1);
        if (!e || typeof e !== 'object') { errors.push(tag + ' invalid.'); return; }
        const T = TYPES[e.type];
        if (!T) { errors.push(tag + ': unknown type.'); return; }
        if (!validDate(e.date)) { errors.push(tag + ': bad date.'); return; }
        if (typeof e.id !== 'string' || !e.id || seen.has(e.id)) { errors.push(tag + ': bad or duplicate id.'); return; }
        const who = typeof e.who === 'string' ? e.who.trim().slice(0, 60) : '';
        let cal = '', half = '';
        if (T.spot) {
          if (!st.settings.calendars.some((c) => c.id === e.cal)) { errors.push(tag + ': unknown calendar.'); return; }
          if (!HALVES[e.half]) { errors.push(tag + ': bad time (first/second/whole).'); return; }
          cal = e.cal; half = e.half;
        }
        let hours = 0;
        if (T.deduct && !who) {
          if (!isNum(e.hours) || (!T.adj && e.hours <= 0)) { errors.push(tag + ': bad hours.'); return; }
          hours = e.hours;
        } else if (T.spot) hours = isNum(e.hours) && e.hours >= 0 ? e.hours : hoursFor(half);
        let status = '';
        if (T.spot && !who) { if (!STATUSES.includes(e.status)) { errors.push(tag + ': bad status.'); return; } status = e.status; }
        seen.add(e.id);
        st.entries.push({ id: e.id, cal, date: e.date, type: e.type, who, half, hours, status, title: typeof e.title === 'string' ? e.title.slice(0, 200) : '', note: typeof e.note === 'string' ? e.note.slice(0, 2000) : '' });
      });
      // the 3-spot rule must hold for everything in the file
      const placed = [];
      for (const e of st.entries) {
        const r = checkPlace(placed, e, st.settings.spots);
        if (!r.ok) errors.push('Entry on ' + e.date + (e.who ? ' (' + e.who + ')' : '') + ' breaks the spot limit or double-books a person.');
        placed.push(e);
      }
    }
    st.overrides = {};
    if (o.overrides && typeof o.overrides === 'object') {
      for (const id in o.overrides) {
        if (!st.settings.calendars.some((c) => c.id === id) || !o.overrides[id] || typeof o.overrides[id] !== 'object') { errors.push('Override for unknown calendar.'); continue; }
        for (const d in o.overrides[id]) {
          if (!validDate(d) || isFeb29(d) || typeof o.overrides[id][d] !== 'boolean') errors.push('Override ' + d + ' invalid.');
          else (st.overrides[id] = st.overrides[id] || {})[d] = o.overrides[id][d];
        }
      }
    }
    if (o.ui && typeof o.ui === 'object') {
      const f = o.ui.filter || {};
      for (const k of Object.keys(st.ui.filter)) if (typeof f[k] === 'boolean') st.ui.filter[k] = f[k];
      for (const c of st.settings.calendars) if (typeof st.ui.filter[c.id] !== 'boolean') st.ui.filter[c.id] = typeof f[c.id] === 'boolean' ? f[c.id] : true;
      const l = o.ui.last || {};
      if (TYPES[l.type] && T_OK(l.type)) st.ui.last.type = l.type;
      if (HALVES[l.half]) st.ui.last.half = l.half;
      st.ui.last.who = typeof l.who === 'string' ? l.who.slice(0, 60) : '';
      st.ui.tipDismissed = !!o.ui.tipDismissed;
    }
    return { ok: errors.length === 0, errors, state: st };
  }
  function T_OK(type) { return isSpot(type) || type === 'note'; }

  return {
    TYPES, SPOT_TYPES, STATUSES, HALVES, VAC_TIERS, SICK_RATES, defaultState,
    parse, validDate, dayNum, fromDayNum, addDays, isLeap, daysInMonth, isFeb29, dow, todayISO, iso, pad, seq,
    calWorks, baseWorks, calById, dutyCals, calInfo, dutyDates, nextDutyDay, expandRange, passesFilter,
    isSpot, hoursFor, halvesOf, overlap, hasStatus, canonName, addName, renameName,
    spotUse, freeSpots, checkPlace, isFull, personalUsed, edoByMonth,
    rateAt, accrualDates, buildLedger, buildICS, dutyEvents, entryEvents, validateState
  };
});
