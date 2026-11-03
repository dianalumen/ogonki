/* Ogonki v2 */
(function () {
  'use strict';

  // ---------- Config ----------
  const CFG = window.OGONKI_CONFIG || {};
  const configured = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && !/TWOJ/.test(CFG.supabaseUrl + CFG.supabaseAnonKey));
  const sb = configured && window.supabase
    ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null;

  // ---------- Dates & formatting ----------
  // Dates are 'YYYY-MM-DD' strings in local time; times are 'HH:MM'.
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (dt) => dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
  const pd = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d || 1); };
  const T = () => iso(new Date());
  const addD = (s, n) => { const x = pd(s); x.setDate(x.getDate() + n); return iso(x); };
  const ad = (n) => addD(T(), n);
  const diffD = (a, b) => Math.round((pd(a) - pd(b)) / 864e5);
  const WD = ['nd.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
  const WDL = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
  const MONG = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  const short = (s) => { const x = pd(s); return x.getDate() + '.' + pad(x.getMonth() + 1); };
  const rel = (s) => { const n = diffD(s, T()); if (n === 0) return 'Dziś'; if (n === 1) return 'Jutro'; if (n === -1) return 'Wczoraj'; return WD[pd(s).getDay()] + ' ' + short(s); };
  const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  const fromMin = (m) => { m = ((m % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
  const nowM = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const nowHM = () => fromMin(nowM());
  const hm = (t) => (t ? String(t).slice(0, 5) : null);
  const clock = (ts) => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (s) => parseFloat(String(s).replace(',', '.'));
  const fNum = (v, unit) => (unit === 'ml' ? Number(v).toFixed(2) : String(+Number(v).toFixed(3))).replace('.', ',');
  const plural = (n, a, b, c) => n === 1 ? a : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? b : c;
  const portions = (n) => n + ' ' + plural(n, 'porcja', 'porcje', 'porcji');
  const ago = (n) => (n === 0 ? 'dziś' : n === 1 ? 'wczoraj' : n + ' dni temu');
  function ageOf(born) {
    if (!born) return '';
    const b = pd(born), t = new Date();
    const months = (t.getFullYear() - b.getFullYear()) * 12 + (t.getMonth() - b.getMonth());
    if (months < 0) return '';
    if (months < 12) return months + ' mies.';
    const y = Math.floor(months / 12), m = months % 12;
    return y + (y === 1 ? ' rok' : y < 5 ? ' lata' : ' lat') + (m ? ' ' + m + ' mies.' : '');
  }

  // ---------- Codes stored in the database and their Polish labels ----------
  const UNIT = { ml: 'ml', drops: 'kropli', tablet: 'tabl.', scoop: 'miarka', unit: 'j.' };
  const FORM = { oral: 'Doustnie', injection: 'Zastrzyk', other: 'Inaczej' };
  const SPLIT = { tablet: ['tabletka', 'tabletki', 'tabletkę'], capsule: ['kapsułka', 'kapsułki', 'kapsułkę'], sachet: ['saszetka', 'saszetki', 'saszetkę'], vial: ['fiolka', 'fiolki', 'fiolkę'] };
  const KIND = { symptoms: 'Objawy', visit: 'Wizyta', note: 'Notatka', system: 'Leki', meds: 'Leki', weight: 'Waga' };
  const FROM_DB = { ok: 'given', bad: 'partial', skipped: 'skipped' };
  const TO_DB = { given: 'ok', partial: 'bad', skipped: 'skipped' };
  const COATS = ['#E9D2A8', '#8C8C92', '#3A3A40', '#FFFFFF', '#C98B5B', '#D9C7B8'];
  const SYMPTOMS = ['Kichanie', 'Porfiryna', 'Słyszalny oddech', 'Apatia', 'Brak apetytu', 'Guz', 'Kulenie', 'Biegunka', 'Drapanie', 'Rana'];

  // ---------- Per-device preferences ----------
  const pref = {
    get(k, def) { try { const v = localStorage.getItem('ogonki-' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem('ogonki-' + k, JSON.stringify(v)); } catch (e) {} }
  };

  // ---------- State ----------
  const S = {
    phase: 'loading', authStep: 'login', authEmail: '', authBusy: false, authErr: '', loadErr: '',
    user: null,
    rats: [], weights: [], entries: [], treatments: [], doses: [], doseChanges: [], shifts: [], visits: [], members: [], cageTasks: [], cageDone: [],
    tab: 'today', stack: [], setup: false, sheet: null, confirm: null, scroll: {}, pending: false, introStep: 0,
    chartRange: 14, onlyMorning: false, pt: null, histFilter: 'all', histMore: false, form: null, weighAck: false,
    thr: pref.get('thr', 5)
  };
  const me = () => (S.user && S.user.email || '').toLowerCase();

  // ---------- Lookups ----------
  const rat = (id) => S.rats.find((r) => r.id === id);
  const tr = (id) => S.treatments.find((t) => t.id === id);
  const nameOf = (email) => {
    if (!email) return '—';
    const m = S.members.find((x) => x.email === email);
    return m && m.display_name ? m.display_name : email.split('@')[0];
  };
  const safeCoat = (c) => /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : COATS[0];

  // ---------- Treatment logic ----------
  function doseHist(t) { return S.doseChanges.filter((c) => c.treatment_id === t.id).sort((a, b) => a.from_date.localeCompare(b.from_date)); }
  // { min, max, unit } for a numeric dose, { text } for a dose kept only as v1 text.
  function doseOn(t, date) {
    const h = doseHist(t);
    if (!h.length) return t.dose_min != null && t.unit ? { min: +t.dose_min, max: t.dose_max != null ? +t.dose_max : null, unit: t.unit } : { text: t.dose };
    let d = h[0];
    h.forEach((x) => { if (x.from_date <= date) d = x; });
    return { min: +d.dose_min, max: d.dose_max != null ? +d.dose_max : null, unit: d.unit };
  }
  const isRange = (d) => d.text == null && d.max != null && d.max !== d.min;
  function doseTxt(d) {
    if (d.text != null) return d.text;
    return (isRange(d) ? fNum(d.min, d.unit) + '–' + fNum(d.max, d.unit) : fNum(d.min, d.unit)) + ' ' + (UNIT[d.unit] || d.unit);
  }
  const perDay = (t) => (t.sched === 'times' ? t.times.length : 1);
  function plannedEnd(t) {
    if (t.end_type === 'forever') return null;
    if (t.sched === 'every') return addD(t.start_date, t.every_n * ((t.end_type === 'doses' ? t.end_n : Math.ceil(t.end_n / t.every_n)) - 1));
    if (t.end_type === 'days') return addD(t.start_date, t.end_n - 1);
    return addD(t.start_date, Math.ceil(t.end_n / perDay(t)) - 1);
  }
  function lastDate(t) {
    const pe = plannedEnd(t);
    return t.ended_at && (pe === null || t.ended_at < pe) ? t.ended_at : pe;
  }
  // v1 still reads `days`; keep it covering the whole planned course.
  const legacyDays = (row) => { const pe = plannedEnd(row); return pe ? Math.min(365, Math.max(1, diffD(pe, row.start_date) + 1)) : 365; };
  const active = (t) => !t.ended_at && !!rat(t.rat_id) && (plannedEnd(t) === null || plannedEnd(t) >= T());
  const shiftOf = (t, date, i) => { const s = S.shifts.find((x) => x.treatment_id === t.id && x.date === date && x.slot === i); return s ? hm(s.time) : null; };
  function slots(t, date) {
    if (date < t.start_date) return [];
    const ld = lastDate(t);
    if (ld && date > ld) return [];
    const n = diffD(date, t.start_date);
    if (t.sched === 'every') { if (n % t.every_n) return []; return [{ i: 0, time: hm(t.every_time), k: n / t.every_n }]; }
    if (t.sched === 'anytime') return [{ i: 0, time: null }];
    return t.times.map((tm, i) => ({ i, time: shiftOf(t, date, i) || tm }));
  }
  const doseRec = (t, date, i) => S.doses.find((x) => x.treatment_id === t.id && x.date === date && x.slot === i);
  function status(t, date, sl) {
    const L = doseRec(t, date, sl.i);
    if (L) return { s: FROM_DB[L.status] || 'given', L };
    if (date < T()) return { s: 'missed' };
    if (date > T() || !sl.time) return { s: 'todo' };
    const late = nowM() - toMin(sl.time);
    if (late > t.late_min) return { s: 'late', m: late };
    if (late >= -30) return { s: 'due' };
    return { s: 'todo' };
  }
  const isDone = (s) => s === 'given' || s === 'partial' || s === 'skipped';
  function schedTxt(t) {
    if (t.sched === 'anytime') return 'Raz dziennie, o dowolnej porze';
    if (t.sched === 'every') return 'Co ' + t.every_n + ' dni' + (t.every_time ? ', o ' + hm(t.every_time) : '');
    const n = t.times.length;
    return (n === 1 ? 'Raz dziennie' : n + '× dziennie') + ', ' + t.times.join(', ');
  }
  function endTxt(t) {
    if (t.end_type === 'forever') return 'na stałe';
    if (t.end_type === 'doses') return t.end_n + ' ' + plural(t.end_n, 'dawka', 'dawki', 'dawek');
    return t.end_n + ' ' + plural(t.end_n, 'dzień', 'dni', 'dni');
  }
  function everyInfo(t) {
    const all = [];
    const n = t.end_type === 'doses' ? t.end_n : Math.ceil(t.end_n / t.every_n);
    for (let k = 0; k < n; k++) all.push(addD(t.start_date, k * t.every_n));
    const next = all.find((d) => d >= T() && !doseRec(t, d, 0));
    return { all, next, idx: next ? all.indexOf(next) + 1 : null };
  }
  function progressTxt(t) {
    if (t.end_type === 'forever') return 'Na stałe · od ' + short(t.start_date);
    if (t.sched === 'every') { const e = everyInfo(t); return e.next ? 'Dawka ' + e.idx + ' z ' + e.all.length + ' · ' + rel(e.next).toLowerCase() : 'Wszystkie dawki podane'; }
    const n = diffD(T(), t.start_date) + 1, tot = diffD(plannedEnd(t), t.start_date) + 1;
    if (n < 1) return 'Start ' + rel(t.start_date).toLowerCase();
    return 'Dzień ' + Math.min(n, tot) + ' z ' + tot + ' · do ' + short(plannedEnd(t));
  }
  function isLastDose(t, date, sl) {
    const ld = plannedEnd(t);
    if (!ld || t.ended_at || date !== ld) return false;
    const all = slots(t, date);
    return all.length > 0 && all[all.length - 1].i === sl.i;
  }
  function remainingDoses(t) {
    const ld = lastDate(t); if (!ld) return null;
    let n = 0;
    for (let d = T(); d <= ld; d = addD(d, 1)) slots(t, d).forEach((sl) => { if (!doseRec(t, d, sl.i)) n++; });
    return n;
  }
  const splitName = (t, form) => (SPLIT[t.split_what] || [t.split_what, t.split_what, t.split_what])[form];
  const lowSplit = (t) => t.split_what && active(t) && t.split_left <= t.split_warn;

  // ---------- Weight logic ----------
  const weightsOf = (id) => S.weights.filter((w) => w.rat_id === id)
    .map((w) => ({ id: w.id, date: w.date, time: hm(w.time), g: w.grams, by: w.weighed_by }))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.time).localeCompare(String(b.time)));
  // Weights without a time come from v1 and are treated as morning ones.
  const isMorning = (w) => !w.time || toMin(w.time) < 660;
  const lastW = (id) => { const w = weightsOf(id); return w[w.length - 1] || null; };
  const todayW = (id) => weightsOf(id).filter((w) => w.date === T()).pop() || null;
  const prevW = (id) => weightsOf(id).filter((w) => w.date < T()).pop() || null;
  function trend(id) {
    const m = weightsOf(id).filter(isMorning);
    if (m.length < 3) return null;
    const last = m[m.length - 1];
    const prev = m.filter((x) => x.date < last.date && diffD(last.date, x.date) <= 14);
    if (!prev.length) return null;
    const mx = Math.max(...prev.map((x) => x.g));
    const p = (last.g - mx) / mx * 100;
    return p <= -S.thr ? Math.round(p) : null;
  }
  function weighDue() {
    if (!S.rats.length) return null;
    const interval = S.treatments.some((t) => active(t) && t.remind_weigh) ? 3 : 7;
    if (S.rats.some((r) => !lastW(r.id))) return T();
    const last = S.rats.map((r) => lastW(r.id).date).sort().pop();
    const due = addD(last, interval);
    return due < T() ? T() : due;
  }

  // ---------- Cage logic ----------
  function cageLast(c) {
    const done = S.cageDone.filter((x) => x.task_id === c.id).sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
    return done[done.length - 1] || null;
  }
  function cageState(c) {
    const last = cageLast(c);
    if (!last) return { s: 'due', never: true };
    if (last.date === T()) return { s: 'done', last };
    const ds = diffD(T(), last.date);
    if (ds < c.min_days) return { s: 'soon', in: c.min_days - ds, ds, last };
    if (ds <= c.max_days) return { s: 'due', ds, last };
    return { s: 'late', over: ds - c.max_days, ds, last };
  }
  const range = (c) => (c.min_days === c.max_days ? 'co ' + c.min_days + ' dni' : c.max_days > 20 ? 'raz w miesiącu' : 'co ' + c.min_days + '–' + c.max_days + ' dni');

  // ---------- Icons ----------
  const sv = (p, w) => `<svg width="${w || 22}" height="${w || 22}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const I = {
    back: sv('<path d="M15 5l-7 7 7 7"/>'),
    chev: '<span class="chev">' + sv('<path d="M9 5l7 7-7 7"/>', 16) + '</span>',
    tick: sv('<path d="M5 12.5l4.5 4.5L19 7"/>', 17),
    dash: sv('<path d="M7 12h10"/>', 17),
    plus: sv('<path d="M12 5v14M5 12h14"/>', 20),
    gear: sv('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>', 20),
    today: sv('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    pill: sv('<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="M9.2 8l5.6 8"/>'),
    flock: sv('<circle cx="9" cy="9" r="3.5"/><circle cx="17" cy="11" r="2.5"/><path d="M3 20c.5-3.5 3-5.5 6-5.5s5.5 2 6 5.5M15 15.5c2.6 0 5 1.6 5.5 4.5"/>'),
    scale: sv('<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M8 11a4 4 0 0 1 8 0M12 11l1.5-2"/>', 20),
    broom: sv('<path d="M14 3l-4 9M6 12h8l2 9H4z"/>', 20),
    person: sv('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-7 8-7s7 2.5 8 7"/>', 20),
    split: sv('<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/>', 20)
  };
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const avatar = (r, cls) => { const c = safeCoat(r.coat); return `<span class="avatar ${cls || ''}" style="background:${c};color:${lum(c) > .35 ? '#16181D' : '#FFFFFF'}" aria-hidden="true">${esc((r.name || '?').charAt(0).toUpperCase())}</span>`; };
  const backBtn = (label) => `<button class="link" data-act="back">${I.back}${esc(label)}</button>`;
  const seg = (items, cur, act, key) => `<div class="seg" role="group" style="grid-template-columns:repeat(${items.length},minmax(0,1fr))">${items.map(([v, l]) => `<button data-act="${act}" data-k="${key || ''}" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${l}</button>`).join('')}</div>`;

  function statusLine(t, st) {
    const L = st.L;
    const amt = L && L.amount != null ? ' · ' + fNum(L.amount, doseOn(t, L.date).unit) + ' ' + (UNIT[doseOn(t, L.date).unit] || '') : '';
    switch (st.s) {
      case 'given': return `<span class="status st-ok">Podane ${clock(L.given_at)} · ${esc(nameOf(L.given_by))}${amt}</span>`;
      case 'partial': return `<span class="status st-part">Częściowo ${clock(L.given_at)} · ${esc(nameOf(L.given_by))}${L.note ? ' · ' + esc(L.note) : ''}</span>`;
      case 'skipped': return `<span class="status st-skip">Pominięte · ${esc(nameOf(L.given_by))}${L.note ? ' · ' + esc(L.note) : ''}</span>`;
      case 'late': return `<span class="status st-late">Spóźnione ${st.m >= 120 ? Math.floor(st.m / 60) + ' h' : st.m + ' min'}</span>`;
      case 'missed': return '<span class="status st-miss">Nie odhaczono</span>';
      case 'due': return '<span class="status st-due">Teraz</span>';
      default: return '';
    }
  }
  function doseRow(x) {
    const { t, sl, date } = x;
    const r = rat(t.rat_id), st = status(t, date, sl), done = isDone(st.s);
    return `<div class="row static ${done ? 'done' : ''}">
      <button class="row-hit" data-act="dosesheet" data-t="${t.id}" data-d="${date}" data-i="${sl.i}">
        ${avatar(r)}
        <span class="row-main"><span class="name">${esc(r.name)}</span>
        <span class="sub">${esc(t.med)} · ${esc(doseTxt(doseOn(t, date)))}${t.form === 'injection' ? ' · zastrzyk' : ''}</span>${statusLine(t, st)}${isLastDose(t, date, sl) ? '<span class="tag accent">Ostatnia dawka kuracji</span>' : ''}</span>
      </button>
      <button class="check ${st.s === 'late' ? 'late' : ''}" data-act="check" data-t="${t.id}" data-d="${date}" data-i="${sl.i}" data-s="${st.s}" aria-label="${done ? 'Zmień wpis' : 'Podane'}: ${esc(r.name)}, ${esc(t.med)}"><span>${st.s === 'skipped' ? I.dash : I.tick}</span></button>
    </div>`;
  }
  function splitRow(t) {
    const r = rat(t.rat_id), out = t.split_left === 0;
    return `<div class="row static">
      <span class="avatar icon">${I.split}</span>
      <button class="row-hit" data-act="go" data-to="treatment" data-id="${t.id}"><span class="row-main"><span class="name sm">Podziel ${splitName(t, 2)}: ${esc(t.med)}</span>
        <span class="sub">${esc(r.name)} · z jednej ${splitName(t, 1)} ${portions(t.split_parts)}</span>
        <span class="status ${out ? 'st-late' : 'st-part'}">${out ? 'Brak porcji na następną dawkę' : 'Zostało ' + portions(t.split_left)}</span></span></button>
      <button class="link sm" data-act="split-done" data-t="${t.id}">Podzielone</button>
    </div>`;
  }
  function cageRow(c) {
    const cs = cageState(c);
    const sub = cs.never ? 'Jeszcze nie odhaczone'
      : cs.s === 'done' ? `Zrobione dziś · ${esc(nameOf(cs.last.done_by))}`
      : cs.s === 'late' ? `<span class="st-late status">Spóźnione o ${cs.over} ${plural(cs.over, 'dzień', 'dni', 'dni')}</span> · ostatnio ${ago(cs.ds)}`
      : cs.s === 'due' ? `Ostatnio ${ago(cs.ds)} · ${esc(nameOf(cs.last.done_by))}`
      : `Za ${cs.in} ${plural(cs.in, 'dzień', 'dni', 'dni')} · ostatnio ${ago(cs.ds)}`;
    return `<div class="row static ${cs.s === 'done' ? 'done' : ''}">
      <span class="avatar icon">${I.broom}</span>
      <span class="row-main"><span class="name sm">${esc(c.name)}</span><span class="sub">${sub}</span><span class="sub">${range(c)}</span></span>
      <button class="check ${cs.s === 'late' ? 'late' : ''}" data-act="cage" data-c="${c.id}" data-s="${cs.s === 'done' ? 'given' : 'todo'}" aria-label="${cs.s === 'done' ? 'Cofnij' : 'Zrobione'}: ${esc(c.name)}"><span>${I.tick}</span></button>
    </div>`;
  }

  function dosesOn(date) {
    const groups = {}, any = [];
    S.treatments.filter((t) => !t.ended_at && rat(t.rat_id)).forEach((t) => slots(t, date).forEach((sl) => {
      const x = { t, sl, date };
      if (sl.time) (groups[sl.time] = groups[sl.time] || []).push(x); else any.push(x);
    }));
    return { timed: Object.keys(groups).sort().map((time) => ({ time, items: groups[time] })), any };
  }
  function missedRecent() {
    const out = [];
    [ad(-2), ad(-1)].forEach((d) => S.treatments.forEach((t) => {
      if (!rat(t.rat_id) || (t.ended_at && t.ended_at < d)) return;
      slots(t, d).forEach((sl) => { if (!doseRec(t, d, sl.i)) out.push({ t, sl, date: d }); });
    }));
    return out;
  }
  function lateCount() {
    let n = 0;
    dosesOn(T()).timed.forEach((g) => g.items.forEach((x) => { if (status(x.t, T(), x.sl).s === 'late') n++; }));
    return n + missedRecent().length + S.treatments.filter((t) => t.split_what && active(t) && t.split_left === 0).length;
  }
  function upcoming() {
    const list = [];
    const wd = weighDue();
    if (wd && wd > T()) list.push({ dt: wd, text: 'Ważenie stada', sub: 'najlepiej rano', to: 'weigh' });
    S.treatments.filter(active).forEach((t) => {
      if (t.sched === 'every') {
        const e = everyInfo(t);
        if (e.next && e.next > T()) list.push({ dt: e.next, text: `${e.idx === e.all.length ? 'Ostatnia dawka: ' : ''}${t.med} · ${rat(t.rat_id).name}`, sub: `dawka ${e.idx} z ${e.all.length}${t.form === 'injection' ? ', zastrzyk' : ''}`, to: 'treatment', id: t.id });
        return;
      }
      const ld = plannedEnd(t);
      if (ld && ld >= T() && diffD(ld, T()) <= 7) {
        const sl = slots(t, ld).slice(-1)[0];
        list.push({ dt: ld, text: 'Ostatnia dawka: ' + t.med, sub: rat(t.rat_id).name + (sl ? ', ' + rel(ld).toLowerCase() + (sl.time ? ' ' + sl.time : '') : ''), to: 'treatment', id: t.id });
      }
    });
    S.cageTasks.forEach((c) => { const cs = cageState(c); if (cs.s === 'soon') list.push({ dt: ad(cs.in), text: c.name, sub: 'ostatnio ' + ago(cs.ds), to: 'flock' }); });
    S.visits.filter((v) => v.date >= T() && rat(v.rat_id)).forEach((v) => list.push({ dt: v.date, text: v.text, sub: rat(v.rat_id).name + (v.time ? ', ' + hm(v.time) : ''), to: 'rat', id: v.rat_id }));
    return list.sort((a, b) => a.dt.localeCompare(b.dt)).slice(0, 5);
  }

  // ---------- Onboarding ----------
  const INTRO = [
    {
      title: 'Dawki bez zgadywania',
      lead: 'Odhaczasz lek, a druga osoba od razu to widzi.',
      ill: `<svg viewBox="0 0 240 160" role="img" aria-label="Lista dawek z odhaczonymi pozycjami">
        <rect class="i-card" x="20" y="14" width="200" height="132" rx="18"/>
        ${[0, 1, 2].map((i) => `<circle class="i-av${i}" cx="50" cy="${46 + i * 36}" r="13"/>
          <rect class="i-line" x="74" y="${40 + i * 36}" width="${[86, 70, 92][i]}" height="12" rx="6"/>
          <circle class="${i < 2 ? 'i-on' : 'i-off'}" cx="196" cy="${46 + i * 36}" r="11"/>
          ${i < 2 ? `<path class="i-tick" d="M190 ${46 + i * 36}l4 4 8-8"/>` : ''}`).join('')}
      </svg>`
    },
    {
      title: 'Waga pod kontrolą',
      lead: 'Szczury ukrywają chorobę. Spadek wagi zobaczysz na czas.',
      ill: `<svg viewBox="0 0 240 160" role="img" aria-label="Wykres wagi ze spadkiem na końcu">
        <rect class="i-card" x="20" y="14" width="200" height="132" rx="18"/>
        <rect class="i-band" x="150" y="30" width="54" height="96" rx="10"/>
        <line class="i-axis" x1="36" y1="126" x2="204" y2="126"/>
        <polyline class="i-chart" points="40,70 70,60 100,64 130,58 160,78 192,104"/>
        <circle class="i-dot" cx="192" cy="104" r="7"/>
      </svg>`
    },
    {
      title: 'Wszystko w jednym miejscu',
      lead: 'Objawy, wizyty i kuracje w historii każdego szczura. Na wizytę masz wszystko pod ręką.',
      ill: `<svg viewBox="0 0 240 160" role="img" aria-label="Dwie osoby dzielące wspólne stado">
        <rect class="i-card" x="20" y="14" width="200" height="132" rx="18"/>
        <circle class="i-av0" cx="100" cy="70" r="30"/><circle class="i-av1" cx="140" cy="70" r="30"/>
        <rect class="i-line" x="70" y="114" width="100" height="12" rx="6"/>
      </svg>`
    }
  ];
  // v1 stored '1' under the same key, which parses as a truthy number.
  const introSeen = () => !!pref.get('intro-seen', false);
  const markIntro = () => pref.set('intro-seen', true);

  // ---------- Screens before sign-in ----------
  const pre = {
    loading: () => '<div class="screen center"><p class="sub" style="text-align:center">Ładowanie…</p></div>',
    intro: () => {
      const s = INTRO[S.introStep], last = S.introStep === INTRO.length - 1;
      return `<div class="screen has-bar intro">
        <div class="topbar" style="justify-content:flex-end">${last ? '' : '<button class="link" data-act="intro-skip">Pomiń</button>'}</div>
        <div class="intro-body"><div class="ill">${s.ill}</div><h1 class="title">${s.title}</h1><p class="lead">${s.lead}</p></div>
        <div class="bar intro-bar">
          <div class="pager" aria-label="Krok ${S.introStep + 1} z ${INTRO.length}">${INTRO.map((_, i) => `<i class="${i === S.introStep ? 'on' : ''}"></i>`).join('')}</div>
          <button class="btn primary" data-act="intro-next">${last ? 'Zaczynamy' : 'Dalej'}</button>
        </div>
      </div>`;
    },
    config: () => '<div class="screen center"><h1 class="title">Ogonki</h1><p class="lead">Aplikacja nie jest jeszcze skonfigurowana.</p></div>',
    login: () => {
      const signup = S.authStep === 'signup';
      return `<form class="screen center" data-form="auth" novalidate>
        <h1 class="title">${signup ? 'Nowe konto' : 'Ogonki'}</h1>
        <p class="lead">${signup ? 'Użyj adresu, który jest na liście osób ze stada.' : 'Zaloguj się, żeby zobaczyć swoje stado.'}</p>
        <div class="field"><label for="l-email">E-mail</label><input id="l-email" type="email" autocomplete="email" inputmode="email" required value="${esc(S.authEmail)}"></div>
        <div class="field"><label for="l-pass">Hasło</label><input id="l-pass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="8"></div>
        ${signup ? '<p class="hint">Co najmniej 8 znaków.</p>' : ''}
        ${S.authErr ? `<p class="error" role="alert">${esc(S.authErr)}</p>` : ''}
        <button class="btn primary" type="submit" ${S.authBusy ? 'disabled' : ''}>${S.authBusy ? 'Chwila…' : signup ? 'Załóż konto' : 'Zaloguj'}</button>
        <button class="link" type="button" data-act="auth-mode" style="align-self:center">${signup ? 'Mam już konto' : 'Pierwszy raz? Załóż konto'}</button>
      </form>`;
    },
    denied: () => `<div class="screen center">
      <h1 class="title">Brak dostępu</h1>
      <p class="lead">Adres ${esc(me())} nie jest na liście osób ze stada. Poproś osobę, która ma dostęp, żeby dodała cię w Ustawieniach.</p>
      <button class="btn plain" data-act="logout">Wyloguj</button>
    </div>`,
    error: () => `<div class="screen center">
      <h1 class="title">Nie udało się wczytać danych</h1>
      <p class="lead">Sprawdź połączenie z internetem i spróbuj ponownie.</p>
      ${S.loadErr ? `<p class="hint">${esc(S.loadErr)}</p>` : ''}
      <button class="btn primary" data-act="retry">Spróbuj ponownie</button>
    </div>`
  };

  // ---------- App screens ----------
  const screens = {
    setup() {
      return `<form class="screen has-bar" data-form="setup-rat" novalidate>
        <div style="display:flex;flex-direction:column;gap:6px;padding-top:8px">
          <h1 class="title small">Kto jest w stadzie?</h1>
          <p class="lead">Dodaj swoje szczury. Wagę i leki uzupełnisz później.</p>
        </div>
        ${S.rats.length ? `<section>${S.rats.map((r) => `<div class="row static">${avatar(r)}<span class="row-main"><span class="name">${esc(r.name)}</span></span></div>`).join('')}</section>` : ''}
        <div class="field"><label for="s-name">Imię</label><input id="s-name" autocomplete="off" maxlength="40"></div>
        <div class="field"><span class="lbl">Umaszczenie</span>
          <div class="swatches" role="group" aria-label="Umaszczenie">${COATS.map((c, i) => `<button type="button" class="swatch" data-act="swatch" data-c="${c}" style="background:${c}" aria-pressed="${i === 0}" aria-label="Kolor ${i + 1}"></button>`).join('')}</div></div>
        <button class="btn plain" type="submit">${S.rats.length ? 'Dodaj kolejnego' : 'Dodaj'}</button>
        <div class="bar"><button type="button" class="btn primary" data-act="setup-done" ${S.rats.length ? '' : 'disabled'}>Gotowe</button></div>
      </form>`;
    },

    today() {
      const { timed, any } = dosesOn(T());
      const missed = missedRecent();
      const wDone = S.rats.filter((r) => todayW(r.id)).length;
      const dueCage = S.cageTasks.filter((c) => ['due', 'late', 'done'].includes(cageState(c).s));
      const up = upcoming();
      const dt = new Date();
      const nothing = !timed.length && !any.length;
      const allW = S.rats.length && wDone === S.rats.length;
      return `<div class="screen tabbed">
        <div class="topbar">
          <div><h1 class="title">Dziś</h1><span class="sub">${WDL[dt.getDay()]}, ${dt.getDate()} ${MONG[dt.getMonth()]}</span></div>
          <button class="icon-btn" data-act="go" data-to="settings" aria-label="Ustawienia">${I.gear}</button>
        </div>
        ${missed.length ? `<div class="alert" role="alert"><b>Nieodhaczone dawki</b>
          <span class="sub">Uzupełnij, czy zostały podane, żeby historia kuracji była prawdziwa.</span>
          ${missed.map((x) => `<button class="row" data-act="dosesheet" data-t="${x.t.id}" data-d="${x.date}" data-i="${x.sl.i}">
            <span class="row-main"><span><b class="plain">${esc(rat(x.t.rat_id).name)}</b> · ${esc(x.t.med)}</span><span class="sub">${rel(x.date)}${x.sl.time ? ', ' + x.sl.time : ''}</span></span>
            <span class="link sm">Uzupełnij</span></button>`).join('')}
        </div>` : ''}
        ${S.rats.length ? `<section>
          <div class="sec-h"><h2>Ważenie</h2></div>
          <button class="row ${allW ? 'done' : ''}" data-act="go" data-to="weigh">
            <span class="avatar icon">${I.scale}</span>
            <span class="row-main"><span class="name">${allW ? 'Całe stado zważone' : 'Zważ stado'}</span>
            <span class="sub">${allW ? 'Dziś ' + S.rats.map((r) => todayW(r.id).time || '').sort()[0] : wDone ? 'Zważone ' + wDone + ' z ' + S.rats.length + ' · brakuje: ' + S.rats.filter((r) => !todayW(r.id)).map((r) => esc(r.name)).join(', ') : 'Najlepiej rano, przed jedzeniem'}</span></span>${I.chev}
          </button>
        </section>` : ''}
        ${nothing ? `<div class="empty"><span class="name">Dziś żadnych leków</span><span class="sub">Kiedy weterynarz przepisze lek, dodaj kurację. Przypomnimy o każdej dawce.</span><button class="btn primary inline" data-act="newform">Dodaj kurację</button></div>` : ''}
        ${S.treatments.filter(lowSplit).length ? `<section><div class="sec-h"><h2>Do przygotowania</h2></div>${S.treatments.filter(lowSplit).map(splitRow).join('')}</section>` : ''}
        ${timed.map((g) => {
          const late = g.items.some((x) => status(x.t, T(), x.sl).s === 'late');
          return `<section><div class="sec-h"><h2 class="${late ? 'late' : ''}">Leki · ${g.time}</h2></div>${g.items.map(doseRow).join('')}</section>`;
        }).join('')}
        ${any.length ? `<section><div class="sec-h"><h2>Leki · o dowolnej porze</h2></div>${any.map(doseRow).join('')}</section>` : ''}
        ${dueCage.length ? `<section><div class="sec-h"><h2>Klatka</h2></div>${dueCage.map(cageRow).join('')}</section>` : ''}
        ${up.length ? `<section><div class="sec-h"><h2>Wkrótce</h2></div>
          ${up.map((u) => `<button class="row" data-act="${u.to === 'flock' ? 'tab' : 'go'}" data-to="${u.to}" data-v="${u.to}" data-id="${u.id || ''}">
            <span class="when">${rel(u.dt)}</span><span class="row-main"><span class="sm">${esc(u.text)}</span><span class="sub">${esc(u.sub)}</span></span>${I.chev}</button>`).join('')}
        </section>` : ''}
      </div>`;
    },

    meds() {
      const act = S.treatments.filter(active);
      const ended = S.treatments.filter((t) => !active(t) && rat(t.rat_id)).sort((a, b) => String(lastDate(b)).localeCompare(String(lastDate(a))));
      return `<div class="screen tabbed">
        <div class="topbar"><h1 class="title">Leki</h1><button class="icon-btn" data-act="go" data-to="carer" aria-label="Widok dla opiekuna">${I.person}</button></div>
        ${S.rats.length ? '<button class="btn primary" data-act="newform">Nowa kuracja</button>' : ''}
        <section><div class="sec-h"><h2>Aktywne · ${act.length}</h2></div>
          ${act.length ? act.map((t) => { const r = rat(t.rat_id); return `<button class="row" data-act="go" data-to="treatment" data-id="${t.id}">
            ${avatar(r)}<span class="row-main"><span class="name">${esc(t.med)}</span>
            <span class="sub">${esc(r.name)} · ${esc(doseTxt(doseOn(t, T())))}${t.form === 'injection' ? ' · zastrzyk' : ''}</span>
            <span class="sub">${schedTxt(t)}</span>
            <span class="status ${t.end_type === 'forever' ? 'st-skip' : 'st-ok'}">${t.end_type === 'forever' ? '<span class="tag">Na stałe</span>' : progressTxt(t)}</span>${t.split_what ? `<span class="status ${lowSplit(t) ? (t.split_left ? 'st-part' : 'st-late') : 'st-skip'}">Porcje: ${t.split_left} z ${t.split_parts}${lowSplit(t) ? ' · podziel ' + splitName(t, 2) : ''}</span>` : ''}</span>${I.chev}</button>`; }).join('') : '<p class="sub pad">Brak aktywnych kuracji.</p>'}
        </section>
        ${ended.length ? `<section><div class="sec-h"><h2>Zakończone</h2></div>${ended.slice(0, 20).map((t) => `<button class="row" data-act="go" data-to="treatment" data-id="${t.id}">
          ${avatar(rat(t.rat_id))}<span class="row-main"><span>${esc(t.med)}</span><span class="sub">${esc(rat(t.rat_id).name)} · ${short(t.start_date)}–${short(lastDate(t))}</span></span>${I.chev}</button>`).join('')}</section>` : ''}
        <button class="row" data-act="go" data-to="carer"><span class="row-main"><span>Widok dla opiekuna</span><span class="sub">Duże przyciski, tylko dzisiejsze dawki</span></span>${I.chev}</button>
      </div>`;
    },

    flock() {
      const wDone = S.rats.filter((r) => todayW(r.id)).length;
      return `<div class="screen tabbed">
        <div class="topbar"><h1 class="title">Stado</h1>${S.rats.length ? `<button class="link sm" data-act="go" data-to="weigh">${I.scale}&nbsp;Zważ${wDone ? ` (${wDone}/${S.rats.length})` : ''}</button>` : ''}</div>
        <section>
          ${S.rats.map((r) => { const t = trend(r.id), w = lastW(r.id), meds = S.treatments.filter((x) => x.rat_id === r.id && active(x)), age = ageOf(r.born); return `<button class="row" data-act="go" data-to="rat" data-id="${r.id}">
            ${avatar(r)}<span class="row-main"><span class="name">${esc(r.name)}</span><span class="sub">${[age, meds.map((m) => esc(m.med)).join(', ')].filter(Boolean).join(' · ')}</span></span>
            <span class="end"><span class="weight num">${w ? w.g + ' g' : '–'}</span>${t !== null ? `<span class="down num">${String(t).replace('-', '−')}% w 2 tyg.</span>` : `<span class="sub">${w ? rel(w.date).toLowerCase() : ''}</span>`}</span>${I.chev}</button>`; }).join('')}
          <button class="row" data-act="sheet" data-sheet="rat"><span class="avatar icon">${I.plus}</span><span class="row-main"><span class="accent">Dodaj szczura</span></span></button>
        </section>
        ${S.cageTasks.length ? `<section><div class="sec-h"><h2>Klatka</h2></div>${S.cageTasks.map(cageRow).join('')}</section>` : ''}
      </div>`;
    },

    rat(p) {
      const r = rat(p.id); if (!r) return screens.flock();
      const meds = S.treatments.filter((t) => t.rat_id === r.id && active(t));
      const visits = S.visits.filter((v) => v.rat_id === r.id && v.date >= T());
      const w = lastW(r.id), tw = trend(r.id);
      const items = histItems(r);
      const shown = S.histMore ? items : items.slice(0, 12);
      const age = ageOf(r.born);
      return `<div class="screen has-bar">
        <div class="topbar">${backBtn('Wróć')}<button class="link" data-act="sheet" data-sheet="rat" data-id="${r.id}">Edytuj</button></div>
        <div class="hero">${avatar(r, 'lg')}<div class="col">
          <h1 class="title small">${esc(r.name)}</h1><span class="sub">${[age, esc(r.look || '')].filter(Boolean).join(' · ')}</span></div></div>
        ${w ? `<section style="gap:12px">
          <div class="wrap-row"><span class="big num">${w.g} g</span>
            <span class="sub">${rel(w.date).toLowerCase()}${w.time ? ', ' + w.time : ''}</span>
            ${tw !== null ? `<span class="down num">${String(tw).replace('-', '−')}% od najwyższej wagi z 2 tyg.</span>` : ''}</div>
          <div class="wrap-row between">
            <div style="flex:1;min-width:180px">${seg([[7, '7 dni'], [14, '14 dni'], [30, '30 dni']], S.chartRange, 'range')}</div>
            <button class="chip" data-act="morning" aria-pressed="${S.onlyMorning}">Tylko rano</button>
          </div>
          ${chart(r)}
        </section>` : '<p class="sub">Brak pomiarów wagi.</p>'}
        <section><div class="sec-h"><h2>Leki</h2><button class="link sm" data-act="newform" data-rat="${r.id}">+ Kuracja</button></div>
          ${meds.length ? meds.map((t) => `<button class="row" data-act="go" data-to="treatment" data-id="${t.id}">
            <span class="row-main"><span class="name">${esc(t.med)} <span class="sub">· ${esc(doseTxt(doseOn(t, T())))}</span></span><span class="sub">${schedTxt(t)} · ${t.end_type === 'forever' ? 'na stałe' : progressTxt(t)}</span></span>${I.chev}</button>`).join('') : '<p class="sub pad">Teraz nie bierze leków.</p>'}
        </section>
        ${visits.length ? `<section><div class="sec-h"><h2>Zaplanowane wizyty</h2></div>${visits.map((v) => `<div class="row static"><span class="when">${rel(v.date)}</span>
          <span class="row-main"><span>${esc(v.text)}${v.time ? ', ' + hm(v.time) : ''}</span></span>
          ${S.confirm === 'visit:' + v.id
            ? `<button class="link sm" data-act="confirm-cancel">Anuluj</button><button class="link sm danger" data-act="del-visit" data-id="${v.id}">Usuń</button>`
            : `<button class="link sm" data-act="confirm" data-key="visit:${v.id}">Usuń</button>`}</div>`).join('')}</section>` : ''}
        <section><div class="sec-h"><h2>Historia</h2></div>
          <div class="chips" style="margin-bottom:6px">${[['all', 'Wszystko'], ['symptoms', 'Objawy'], ['visit', 'Wizyty'], ['meds', 'Leki'], ['weight', 'Waga'], ['note', 'Notatki']].map(([v, l]) => `<button class="chip" data-act="hfilter" data-v="${v}" aria-pressed="${S.histFilter === v}">${l}</button>`).join('')}</div>
          ${shown.length ? shown.map((h) => `<div class="hist"><span class="d num">${short(h.date)}</span><span class="t"><span class="tag">${KIND[h.type]}</span><span>${esc(h.text)}</span></span></div>`).join('') : '<p class="sub pad">Brak wpisów.</p>'}
          ${items.length > shown.length ? `<button class="link sm" data-act="histmore">Pokaż starsze (${items.length - shown.length})</button>` : ''}
        </section>
      </div>
      <div class="bar"><button class="btn primary" data-act="sheet" data-sheet="entry" data-id="${r.id}">Dodaj objaw, wizytę lub notatkę</button></div>`;
    },

    treatment(p) {
      const t = tr(p.id); if (!t || !rat(t.rat_id)) return screens.meds();
      const r = rat(t.rat_id), isAct = active(t);
      const confirming = S.confirm === 'end:' + t.id;
      let prog = '';
      if (t.sched === 'every') {
        const e = everyInfo(t);
        prog = `<section><div class="sec-h"><h2>Dawki</h2></div>${e.all.map((d, k) => { const st = status(t, d, { i: 0, time: hm(t.every_time) }); return `<button class="row" data-act="dosesheet" data-t="${t.id}" data-d="${d}" data-i="0" ${d > T() ? 'disabled' : ''}>
          <span class="when">Dawka ${k + 1}</span><span class="row-main"><span class="sm">${rel(d)}</span>${st.s === 'todo' ? '<span class="sub">zaplanowana</span>' : statusLine(t, st)}</span></button>`; }).join('')}</section>`;
      } else {
        const ld = lastDate(t);
        const forever = t.end_type === 'forever' && !t.ended_at;
        const from = forever ? (addD(T(), -13) > t.start_date ? addD(T(), -13) : t.start_date) : t.start_date;
        const to = forever ? T() : ld;
        const cells = [];
        for (let d = from; d <= to; d = addD(d, 1)) {
          const sls = slots(t, d);
          cells.push(`<button class="day ${d === T() ? 'today' : d > T() ? 'future' : ''}" ${d > T() ? 'disabled' : `data-act="daysheet" data-t="${t.id}" data-d="${d}"`} aria-label="${short(d)}"><b class="num">${forever ? pd(d).getDate() : diffD(d, t.start_date) + 1}</b><span class="dots">${sls.map((sl) => `<span class="dot ${status(t, d, sl).s}"></span>`).join('')}</span></button>`);
        }
        const recent = [];
        for (let k = 0; k < 4; k++) { const d = ad(-k); if (d < t.start_date || (ld && d > ld)) continue; slots(t, d).slice().reverse().forEach((sl) => recent.push({ d, sl })); }
        prog = `<section style="gap:12px">
          <div class="wrap-row between"><span class="name">${isAct ? progressTxt(t) : 'Od ' + short(t.start_date) + ' do ' + short(ld)}</span>${forever ? '<span class="sub">ostatnie 14 dni</span>' : ''}</div>
          <div class="days" role="group" aria-label="Plan dawek">${cells.join('')}</div>
          <div class="legend"><span><i class="dot given"></i>podane</span><span><i class="dot partial"></i>częściowo</span><span><i class="dot skipped"></i>pominięte</span><span><i class="dot missed"></i>nie odhaczono</span></div>
        </section>
        ${recent.length ? `<section><div class="sec-h"><h2>Ostatnie podania</h2></div>${recent.map(({ d, sl }) => { const st = status(t, d, sl); return `<button class="row" data-act="dosesheet" data-t="${t.id}" data-d="${d}" data-i="${sl.i}">
          <span class="when">${rel(d)}${sl.time ? '<br>' + sl.time : ''}</span><span class="row-main">${statusLine(t, st) || '<span class="sub">jeszcze nie</span>'}</span>${I.chev}</button>`; }).join('')}</section>` : ''}`;
      }
      const changes = S.entries.filter((e) => e.rat_id === t.rat_id && e.kind === 'system' && e.text.startsWith(t.med + ':') && /zmienion/.test(e.text)).sort((a, b) => a.date.localeCompare(b.date));
      const rem = remainingDoses(t);
      return `<div class="screen">
        <div class="topbar">${backBtn('Wróć')}${isAct ? `<button class="link" data-act="editform" data-t="${t.id}">Edytuj</button>` : ''}</div>
        <div class="col" style="gap:6px">
          <h1 class="title small">${esc(t.med)}</h1>
          <button class="chip" data-act="go" data-to="rat" data-id="${r.id}" style="align-self:flex-start;padding-left:14px">${avatar(r)}${esc(r.name)}</button>
        </div>
        <div class="dose-big"><span class="kv"><span class="sub">Dawka · ${FORM[t.form].toLowerCase()}</span><span class="v num">${esc(doseTxt(doseOn(t, T())))}</span></span>
          ${isAct ? `<button class="link sm" data-act="editform" data-t="${t.id}">Zmień dawkę</button>` : ''}</div>
        ${t.split_what ? (() => { const low = t.split_left <= t.split_warn; return `<section style="gap:10px">
          <div class="wrap-row between"><span class="sub">Porcje z ${splitName(t, 1)}</span><span class="name num ${low ? (t.split_left ? 'st-part' : 'st-late') : ''}">${t.split_left} z ${t.split_parts}</span></div>
          <div class="progress"><i style="width:${Math.round(t.split_left / t.split_parts * 100)}%;${low ? 'background:var(--warn-fill)' : ''}"></i></div>
          <span class="sub">${t.split_left ? (rem !== null && t.split_left >= rem ? 'Wystarczy do końca kuracji (' + (rem === 1 ? 'została 1 dawka' : 'zostały ' + rem + ' ' + plural(rem, 'dawka', 'dawki', 'dawek')) + ')' : t.sched !== 'every' && t.split_left / perDay(t) >= 1 ? 'Starczy na ok. ' + Math.floor(t.split_left / perDay(t)) + ' ' + plural(Math.floor(t.split_left / perDay(t)), 'dzień', 'dni', 'dni') : 'Starczy na ' + t.split_left + ' ' + plural(t.split_left, 'dawkę', 'dawki', 'dawek')) : 'Brak porcji. Podziel ' + splitName(t, 2) + ' przed następną dawką.'} · ${t.split_warn ? 'przypomnienie przy ' + t.split_warn + ' ' + (t.split_warn === 1 ? 'porcji' : 'porcjach') : 'przypomnienie, gdy się skończą'}</span>
          ${isAct ? `<button class="btn ${low ? 'primary' : 'outline'}" data-act="split-done" data-t="${t.id}">Podzielone: ${splitName(t, 0)} na ${portions(t.split_parts)}</button>` : ''}
        </section>`; })() : ''}
        <div class="kv"><span class="sub">Jak często</span><span class="lg">${schedTxt(t)}${t.sched === 'times' ? ` · spóźnienie do ${t.late_min >= 60 ? t.late_min / 60 + ' h' : t.late_min + ' min'}` : ''}</span><span class="sub">Czas trwania: ${endTxt(t)}</span></div>
        ${prog}
        ${t.note ? `<div class="kv"><span class="sub">Jak podawać</span><span class="md">${esc(t.note)}</span></div>` : ''}
        ${changes.length ? `<div class="kv"><span class="sub">Zmiany</span>${changes.map((e) => `<span>${short(e.date)} · ${esc(e.text)}</span>`).join('')}</div>` : ''}
        ${isAct ? `<section>
          <div class="row static"><span class="row-main"><span>Ważenie co 3 dni</span><span class="sub">Przypomnienie w „Wkrótce” na czas kuracji</span></span>
            <button class="toggle" data-act="remind" data-t="${t.id}" aria-pressed="${!!t.remind_weigh}" aria-label="Przypomnienie o ważeniu co 3 dni"></button></div>
          <button class="row" data-act="go" data-to="carer"><span class="row-main"><span>Widok dla opiekuna</span></span>${I.chev}</button>
          ${confirming ? `<div class="confirm"><span class="name">Zakończyć kurację?</span><span class="sub">Zostanie w historii. Dzisiejsze nieodhaczone dawki znikną z ekranu Dziś.</span>
            <div class="btns"><button class="btn plain" data-act="confirm-cancel">Anuluj</button><button class="btn danger" data-act="end-ok" data-t="${t.id}">Zakończ</button></div></div>`
          : `<button class="row danger" data-act="confirm" data-key="end:${t.id}" style="border-bottom:0">Zakończ kurację</button>`}
        </section>` : `<p class="banner">Kuracja zakończona ${short(lastDate(t))}.</p>`}
      </div>`;
    },

    form() {
      const f = S.form, edit = !!f.tid;
      return `<div class="screen">
        <div class="topbar"><button class="link" data-act="back">Anuluj</button><button class="link strong" data-act="saveform">Zapisz</button></div>
        <h1 class="title small">${edit ? 'Edytuj kurację' : 'Nowa kuracja'}</h1>
        ${f.errs.length ? `<div class="errors" role="alert">${f.errs.map((e) => `<span>${esc(e)}</span>`).join('')}</div>` : ''}
        <div class="field"><span class="lbl">Dla kogo</span><div class="chips">${S.rats.map((r) => `<button class="chip" data-act="fset" data-k="rat" data-v="${r.id}" aria-pressed="${f.rat === r.id}" ${edit ? 'disabled' : ''} style="padding-left:14px">${avatar(r)}${esc(r.name)}</button>`).join('')}</div></div>
        <div class="field"><label for="f-med">Lek</label><input id="f-med" data-f="med" value="${esc(f.med)}" maxlength="80" placeholder="np. Enrofloksacyna" autocomplete="off"></div>
        <div class="field"><span class="lbl">Jak podawany</span>${seg(Object.entries(FORM), f.form, 'fset', 'form')}</div>
        <div class="field"><span class="lbl">Dawka z zalecenia weterynarza</span>
          ${f.legacy ? `<p class="banner">Zapisana dawka: „${esc(f.legacy)}”. Wpisz ją liczbą, żeby można było liczyć porcje i zakresy.</p>` : ''}
          <div class="two"><input class="inp num" data-f="dmin" inputmode="decimal" value="${esc(f.dmin)}" placeholder="od, np. 0,15" aria-label="Dawka od"><input class="inp num" data-f="dmax" inputmode="decimal" value="${esc(f.dmax)}" placeholder="do (opcjonalnie)" aria-label="Dawka do"></div>
          <div class="chips">${Object.entries(UNIT).map(([v, l]) => `<button class="chip" data-act="fset" data-k="unit" data-v="${v}" aria-pressed="${f.unit === v}">${l}</button>`).join('')}</div>
          <span class="hint">Jeśli weterynarz dał zakres (np. przy lekach przeciwbólowych), wpisz oba końce. Aplikacja niczego nie przelicza.${edit ? ' Zmiana dawki zapisze się w historii od dziś.' : ''}</span></div>
        <div class="field"><span class="lbl">Jak często</span>${seg([['times', 'O stałych porach'], ['anytime', 'O dowolnej porze'], ['every', 'Co kilka dni']], f.sched, 'fset', 'sched')}
          ${f.sched === 'times' ? `<div class="col" style="gap:8px">${f.times.map((tm, i) => `<div class="time-row"><input class="inp num" type="time" data-f="time" data-i="${i}" value="${tm}" aria-label="Pora ${i + 1}">${f.times.length > 1 ? `<button class="x-btn" data-act="ftime-del" data-i="${i}" aria-label="Usuń porę">×</button>` : ''}</div>`).join('')}
            ${f.times.length < 4 ? '<button class="link sm" data-act="ftime-add" style="align-self:flex-start">+ Dodaj porę</button>' : ''}
            <span class="lbl sub" style="margin-top:6px">Ile można się spóźnić, zanim dawka będzie „spóźniona”</span>
            <div class="chips">${[[15, '15 min'], [30, '30 min'], [60, '1 h'], [120, '2 h']].map(([v, l]) => `<button class="chip" data-act="fset" data-k="late" data-v="${v}" aria-pressed="${+f.late === v}">${l}</button>`).join('')}</div></div>`
          : f.sched === 'anytime' ? '<span class="hint">Raz dziennie, kiedy wygodnie. Bez godziny i bez alertu o spóźnieniu; dobre dla suplementów.</span>'
          : `<div class="two"><div class="field"><label for="f-every">Co ile dni</label><input id="f-every" class="num" data-f="every" inputmode="numeric" value="${esc(f.every)}"></div>
             <div class="field"><label for="f-et">Pora (opcjonalnie)</label><input id="f-et" type="time" data-f="everyTime" value="${esc(f.everyTime)}"></div></div>`}
        </div>
        <div class="field"><label for="f-start">${f.sched === 'every' ? 'Pierwsza dawka' : 'Od kiedy'}</label><input id="f-start" type="date" data-f="start" value="${f.start}"></div>
        <div class="field"><span class="lbl">Jak długo</span>${seg([['days', 'Liczba dni'], ['doses', 'Liczba dawek'], ['forever', 'Na stałe']], f.endType, 'fset', 'endType')}
          ${f.endType !== 'forever' ? `<input class="inp num" data-f="endN" inputmode="numeric" value="${esc(f.endN)}" aria-label="${f.endType === 'days' ? 'Liczba dni' : 'Liczba dawek'}" placeholder="${f.endType === 'days' ? 'np. 14' : 'np. 3'}">` : '<span class="hint">Lek bez daty końca, np. przy chorobie przewlekłej. Zakończysz go ręcznie.</span>'}</div>
        <div class="field">
          <div class="row static" style="border-top:1px solid var(--line)"><span class="row-main"><span>Lek dzielony na porcje</span><span class="sub">Np. tabletka dzielona na kilka lub kilkanaście dawek</span></span>
            <button class="toggle" data-act="fsplit" aria-pressed="${!!f.splitOn}" aria-label="Lek dzielony na porcje"></button></div>
          ${f.splitOn ? `<span class="lbl sub">Co dzielisz</span>
            <div class="chips">${Object.entries(SPLIT).map(([v, l]) => `<button class="chip" data-act="fset" data-k="splitWhat" data-v="${v}" aria-pressed="${f.splitWhat === v}">${l[0]}</button>`).join('')}</div>
            <div class="two"><div class="field"><label for="f-sp">Ile porcji z jednej</label><input id="f-sp" class="num" data-f="splitParts" inputmode="numeric" value="${esc(f.splitParts)}"></div>
            ${edit ? `<div class="field"><label for="f-sl">Zostało teraz</label><input id="f-sl" class="num" data-f="splitLeft" inputmode="numeric" value="${esc(f.splitLeft)}"></div>` : ''}</div>
            <span class="lbl sub">Przypomnij o podzieleniu, gdy zostanie</span>
            <div class="chips">${[0, 1, 2, 3].map((v) => `<button class="chip" data-act="fset" data-k="splitWarn" data-v="${v}" aria-pressed="${+f.splitWarn === v}">${v === 0 ? 'gdy się skończy' : portions(v)}</button>`).join('')}</div>
            <span class="hint">Każda podana dawka zużywa jedną porcję. Przypomnienie pojawi się na ekranie Dziś w sekcji „Do przygotowania”.</span>` : ''}
        </div>
        <div class="field"><label for="f-note">Jak podawać (zobaczy też opiekun)</label><textarea id="f-note" data-f="note" maxlength="500" placeholder="np. strzykawka 1 ml, potem coś słodkiego">${esc(f.note)}</textarea></div>
        <button class="btn primary" data-act="saveform">${edit ? 'Zapisz zmiany' : 'Dodaj kurację'}</button>
      </div>`;
    },

    weigh() {
      return `<div class="screen">
        <div class="topbar"><button class="link" data-act="back">Anuluj</button><span class="sub">${nowHM()} · ${nowM() < 660 ? 'pomiar poranny' : 'pomiar o innej porze'}</span></div>
        <h1 class="title small">Ważenie</h1>
        <p class="sub" style="margin-top:-12px">Wpisz wagi z wagi kuchennej (bez pojemnika). Puste pola się nie zapiszą.</p>
        <section>${S.rats.map((r) => { const tw = todayW(r.id), pw = prevW(r.id); return `<div class="row static">
          ${avatar(r)}<span class="row-main"><label class="name" for="w-${r.id}">${esc(r.name)}</label>
          <span class="sub num" id="d-${r.id}">${weighHint(tw, pw)}</span></span>
          <span class="w-in" id="wi-${r.id}"><input id="w-${r.id}" data-rat="${r.id}" inputmode="numeric" maxlength="4" autocomplete="off" aria-describedby="d-${r.id}"><span>g</span></span>
        </div>`; }).join('')}</section>
        <button class="btn primary" id="saveW" data-act="save-weigh" disabled>Zapisz</button>
      </div>`;
    },

    settings() {
      const mine = S.members.find((m) => m.email === me());
      return `<div class="screen">
        <div class="topbar">${backBtn('Wróć')}</div>
        <h1 class="title small">Ustawienia</h1>
        <form class="field" data-form="my-name" novalidate><label for="my-name">Twoje imię</label>
          <div class="time-row"><input id="my-name" class="inp" maxlength="30" autocomplete="given-name" value="${esc(mine && mine.display_name || '')}" placeholder="${esc(me().split('@')[0])}"><button class="btn primary inline" type="submit">Zapisz</button></div>
          <span class="hint">Zapisuje się przy każdej podanej dawce, ważeniu i sprzątaniu.</span></form>
        <div class="field"><span class="lbl">Alert przy spadku wagi</span>${seg([[3, '3%'], [5, '5%'], [10, '10%']], S.thr, 'thr')}<span class="hint">Porównuje poranną wagę z najwyższą poranną z ostatnich 2 tygodni. Ustawienie tylko na tym telefonie.</span></div>
        <section>
          <div class="sec-h"><h2>Osoby z dostępem</h2></div>
          ${S.members.map((m) => `<div class="row static"><span class="row-main"><span class="wrap">${esc(m.display_name || m.email)}</span><span class="sub wrap">${m.display_name ? esc(m.email) + ' · ' : ''}${m.email === me() ? 'to ty' : ''}</span></span>
            ${m.email === me() ? '' : (S.confirm === 'mem:' + m.email
              ? `<button class="link sm" data-act="confirm-cancel">Anuluj</button><button class="link sm danger" data-act="del-member" data-email="${esc(m.email)}">Usuń</button>`
              : `<button class="link sm" data-act="confirm" data-key="mem:${esc(m.email)}">Usuń</button>`)}
          </div>`).join('')}
          <form data-form="member" class="time-row" style="align-items:flex-end;padding-top:12px" novalidate>
            <div class="field" style="flex:1"><label for="m-email">Dodaj osobę (np. opiekuna na wyjazd)</label>
              <input id="m-email" type="email" inputmode="email" autocomplete="off" placeholder="adres@e-mail"></div>
            <button class="btn primary inline" type="submit">Dodaj</button>
          </form>
          <p class="hint" style="padding-top:8px">Dodana osoba zakłada konto na ten adres i widzi oraz może zmieniać wszystkie dane stada. Po powrocie z wyjazdu usuń ją z listy.</p>
        </section>
        <section>
          <button class="row" data-act="go" data-to="carer"><span class="row-main"><span>Widok dla opiekuna</span><span class="sub">Duże przyciski, tylko dzisiejsze dawki</span></span>${I.chev}</button>
          <button class="row danger" data-act="logout">Wyloguj</button>
        </section>
        <p class="foot">Zalogowano jako ${esc(me())}</p>
      </div>`;
    },

    carer() {
      const { timed, any } = dosesOn(T());
      const groups = timed.concat(any.length ? [{ time: 'O dowolnej porze', items: any }] : []);
      const cage = S.cageTasks.filter((c) => ['due', 'late'].includes(cageState(c).s));
      const card = (x) => {
        const r = rat(x.t.rat_id), st = status(x.t, T(), x.sl), done = isDone(st.s), d = doseOn(x.t, T());
        return `<div class="care">
        <div class="wrap-row">${avatar(r, 'md')}<span class="col" style="gap:2px"><span class="name xl">${esc(r.name)}</span><span class="sub">${esc(r.look || '')}</span></span></div>
        <div class="dose-big" style="padding:10px 0"><span>${esc(x.t.med)}${x.t.form === 'injection' ? ' (zastrzyk)' : ''}</span><span class="v num" style="font-size:22px">${esc(doseTxt(d))}</span></div>
        ${x.t.note ? `<span class="md">${esc(x.t.note)}</span>` : ''}
        ${isRange(d) ? '<span class="hint">Weterynarz dał zakres. Jeśli nie wiesz, ile dać, podaj mniejszą dawkę.</span>' : ''}
        ${done ? `<p class="banner ok">✓ ${st.s === 'given' ? 'Podane' : st.s === 'partial' ? 'Częściowo' : 'Pominięte'} ${clock(st.L.given_at)} · ${esc(nameOf(st.L.given_by))}</p>` : `<button class="btn primary" data-act="carer-give" data-t="${x.t.id}" data-i="${x.sl.i}">Podane</button>`}
      </div>`;
      };
      return `<div class="screen">
        <div class="topbar">${backBtn('Wróć')}</div>
        <header class="col" style="gap:4px"><span class="sub">Widok dla opiekuna</span><h1 class="title small">Dziś</h1></header>
        ${groups.length ? '' : '<p class="lead">Na dziś nie ma żadnych dawek.</p>'}
        ${groups.map((g) => `<section style="gap:16px"><div class="sec-h"><h2>${g.time}</h2></div>${g.items.map(card).join('')}</section>`).join('')}
        ${cage.length ? `<section><div class="sec-h"><h2>Klatka</h2></div>${cage.map((c) => `<div class="row static"><span class="row-main"><span>${esc(c.name)}</span><span class="sub">${range(c)}</span></span><button class="link sm" data-act="cage" data-c="${c.id}" data-s="todo">Zrobione</button></div>`).join('')}</section>` : ''}
      </div>`;
    }
  };

  function weighHint(tw, pw) {
    return tw ? `dziś ${tw.time || ''}: ${tw.g} g · wpisz, by poprawić` : pw ? `ostatnio ${pw.g} g · ${rel(pw.date).toLowerCase()}` : 'pierwszy pomiar';
  }

  function histItems(r) {
    let e = S.entries.filter((x) => x.rat_id === r.id).map((x) => ({ date: x.date, at: x.created_at || '', type: x.kind === 'system' ? 'meds' : x.kind, text: x.text }));
    weightsOf(r.id).forEach((w) => e.push({ date: w.date, at: w.date + 'T' + (w.time || ''), type: 'weight', text: w.g + ' g' + (w.time ? ' · ' + w.time : '') + (w.by ? ' · ' + nameOf(w.by) : '') }));
    S.treatments.filter((t) => t.rat_id === r.id).forEach((t) => {
      S.doses.filter((x) => x.treatment_id === t.id && x.status !== 'ok').forEach((x) => e.push({
        date: x.date, at: x.given_at, type: 'meds',
        text: `${t.med}: ${x.status === 'bad' ? 'częściowo' : 'pominięte'}${x.note ? ' – ' + x.note : ''} (${nameOf(x.given_by)}, ${clock(x.given_at)})`
      }));
    });
    const f = S.histFilter;
    e = e.filter((x) => (f === 'all' ? x.type !== 'weight' : x.type === f));
    return e.sort((a, b) => b.date.localeCompare(a.date) || String(b.at).localeCompare(String(a.at)));
  }

  function chart(r) {
    const days = S.chartRange, from = ad(-(days - 1));
    let w = weightsOf(r.id).filter((x) => x.date >= from);
    if (S.onlyMorning) w = w.filter(isMorning);
    if (w.length < 2) return '<p class="sub">Za mało pomiarów w tym okresie.</p>';
    const W = 350, L = 34, top = 10, bottom = 128;
    const vals = w.map((x) => x.g);
    let mn = Math.min(...vals), mx = Math.max(...vals);
    const padV = Math.max(4, (mx - mn) * .15); mn = Math.floor(mn - padV); mx = Math.ceil(mx + padV);
    const X = (x) => L + (diffD(x.date, from) + toMin(x.time || '08:00') / 1440) / days * (W - L - 6);
    const Y = (v) => top + (mx - v) / (mx - mn) * (bottom - top);
    let bands = '';
    S.treatments.filter((t) => t.rat_id === r.id && t.sched !== 'every').forEach((t) => {
      const ld = lastDate(t) || T(); if (ld < from || t.start_date > T()) return;
      const a = t.start_date < from ? from : t.start_date, b = ld > T() ? T() : ld;
      const x1 = L + diffD(a, from) / days * (W - L - 6), x2 = L + (diffD(b, from) + 1) / days * (W - L - 6);
      bands += `<rect class="ch-band" x="${x1.toFixed(1)}" y="${top - 6}" width="${(x2 - x1).toFixed(1)}" height="${bottom - top + 6}" rx="4"/>`;
    });
    const mid = Math.round((mn + mx) / 2);
    const grid = [mx, mid, mn].map((v) => `<line class="ch-grid" x1="${L}" x2="${W}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ch-lbl" x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`).join('');
    const pts = w.map((x) => X(x).toFixed(1) + ',' + Y(x.g).toFixed(1)).join(' ');
    const sel = S.pt && S.pt.rat === r.id ? S.pt.id : null;
    const dots = w.map((x) => `<circle class="ch-dot ${isMorning(x) ? '' : 'other'} ${sel === x.id ? 'sel' : ''}" cx="${X(x).toFixed(1)}" cy="${Y(x.g).toFixed(1)}" r="${sel === x.id ? 6 : 4}"/><circle class="ch-hit" data-act="pt" data-id="${x.id}" data-rat="${r.id}" cx="${X(x).toFixed(1)}" cy="${Y(x.g).toFixed(1)}" r="11"><title>${short(x.date)} ${x.time || ''}: ${x.g} g</title></circle>`).join('');
    const sw = sel && w.find((x) => x.id === sel);
    return `<div class="col" style="gap:6px">
      <p class="sub" style="min-height:20px">${sw ? `<b class="fg">${sw.g} g</b> · ${rel(sw.date)}${sw.time ? ', ' + sw.time : ''} · ${isMorning(sw) ? 'rano' : 'inna pora'}${sw.by ? ' · ' + esc(nameOf(sw.by)) : ''}` : 'Dotknij punktu, by zobaczyć szczegóły.'}</p>
      <svg class="chart" viewBox="0 0 ${W} 150" role="img" aria-label="Waga ${esc(r.name)} z ${days} dni">
        ${bands}${grid}<polyline class="ch-line" points="${pts}"/>${dots}
        <text class="ch-lbl" x="${L}" y="146">${short(from)}</text><text class="ch-lbl" x="${W}" y="146" text-anchor="end">dziś</text>
      </svg>
      <div class="legend"><span><i class="dot given"></i>rano</span><span><i class="dot ring"></i>inna pora</span>${bands ? '<span><i class="sq band"></i>kuracja</span>' : ''}</div>
    </div>`;
  }

  // ---------- Sheets ----------
  const sheets = {
    dose(sh) {
      const t = tr(sh.t), r = rat(t.rat_id), date = sh.d, i = +sh.i;
      const sl = slots(t, date).find((x) => x.i === i) || { i, time: t.times[i] || null };
      const st = status(t, date, sl), L = st.L, d = doseOn(t, date);
      const head = `<div class="sheet-h"><button class="link" data-act="close">Zamknij</button><h2>${esc(r.name)}</h2><span></span></div>
        <div class="kv"><span class="name xl">${esc(t.med)} · ${esc(doseTxt(d))}</span><span class="sub">${rel(date)}${sl.time ? ', ' + sl.time : ', o dowolnej porze'}${t.form === 'injection' ? ' · zastrzyk' : ''}</span></div>
        ${t.note ? `<p class="banner">${esc(t.note)}</p>` : ''}
        ${isLastDose(t, date, sl) ? '<p class="banner ok">To ostatnia dawka tej kuracji.</p>' : ''}
        ${t.split_what && !L ? `<p class="sub">Porcje: zostało ${t.split_left} z ${t.split_parts}${t.split_left === 0 ? ' · <span class="st-late status">najpierw podziel ' + splitName(t, 2) + '</span>' : ''}</p>` : ''}`;
      if (L) {
        return head + `<div class="kv"><span class="sub">Zapisano</span>${statusLine(t, st)}</div>
          ${sh.confirm ? `<div class="confirm"><span class="name">Cofnąć wpis z ${clock(L.given_at)} (${esc(nameOf(L.given_by))})?</span><span class="sub">Dawka znów będzie widoczna jako niepodana.</span>
            <div class="btns"><button class="btn plain" data-act="close">Nie</button><button class="btn danger" data-act="undo-ok">Cofnij wpis</button></div></div>`
          : '<button class="btn danger-outline" data-act="undo-ask">Cofnij wpis</button>'}`;
      }
      const amounts = isRange(d) ? [d.min, +((d.min + d.max) / 2).toFixed(3), d.max] : [];
      const canShift = sl.time && date === T() && t.sched === 'times';
      const newT = canShift && sh.shift ? fromMin(toMin(sl.time) + sh.shift) : null;
      return head + `
        ${amounts.length ? `<div class="field"><span class="lbl">Ile podano</span><div class="chips">${amounts.map((a) => `<button class="chip num" data-act="amt" data-v="${a}" aria-pressed="${sh.amt === a}">${fNum(a, d.unit)} ${UNIT[d.unit]}</button>`).join('')}</div></div>` : ''}
        <div class="field"><label for="s-note">Notatka (opcjonalnie)</label><input id="s-note" data-s="note" value="${esc(sh.note || '')}" maxlength="200" placeholder="np. wypluł połowę"></div>
        <button class="btn primary" data-act="log" data-v="given">Podane${date !== T() ? ' (' + rel(date).toLowerCase() + ')' : ''}</button>
        <div class="btns"><button class="btn plain" data-act="log" data-v="partial">Częściowo / wypluł</button><button class="btn plain" data-act="log" data-v="skipped">Pominięte</button></div>
        ${canShift ? `<div class="field" style="border-top:1px solid var(--line)"><span class="lbl" style="padding-top:12px">Przesuń porę dawki</span>
          <div class="chips">${[-30, -15, 15, 30].map((m) => `<button class="chip num" data-act="shift" data-v="${m}" aria-pressed="${sh.shift === m}">${m > 0 ? '+' : '−'}${Math.abs(m)} min</button>`).join('')}</div>
          ${newT ? `${seg([['today', 'Tylko dziś'], ['always', 'Od dziś na stałe']], sh.scope || 'today', 'scope')}
          <button class="btn outline" data-act="shift-ok">Przesuń na ${newT}</button>` : '<span class="hint">Np. żeby stopniowo przenieść antybiotyk na wygodniejszą godzinę.</span>'}</div>` : ''}`;
    },
    day(sh) {
      const t = tr(sh.t), r = rat(t.rat_id);
      return `<div class="sheet-h"><button class="link" data-act="close">Zamknij</button><h2>${esc(r.name)} · ${rel(sh.d)}</h2><span></span></div>
        <section>${slots(t, sh.d).map((sl) => { const st = status(t, sh.d, sl); return `<button class="row" data-act="dosesheet" data-t="${t.id}" data-d="${sh.d}" data-i="${sl.i}">
          <span class="when">${sl.time || '—'}</span><span class="row-main">${statusLine(t, st) || '<span class="sub">jeszcze nie</span>'}</span>${I.chev}</button>`; }).join('')}</section>`;
    },
    entry(sh) {
      const r = rat(sh.id), mode = sh.mode || 'symptoms';
      return `<div class="sheet-h"><button class="link" data-act="close">Anuluj</button><h2>${esc(r.name)}</h2><button class="link strong" data-act="save-entry">Zapisz</button></div>
        ${seg([['symptoms', 'Objawy'], ['visit', 'Wizyta'], ['note', 'Notatka']], mode, 'emode')}
        ${mode === 'symptoms' ? `<div class="chips">${SYMPTOMS.map((s) => `<button class="chip" data-act="sy" data-v="${s}" aria-pressed="${(sh.sy || []).includes(s)}">${s}</button>`).join('')}</div>
          <div class="field"><span class="lbl">Nasilenie</span>${seg([['łagodne', 'Łagodne'], ['średnie', 'Średnie'], ['silne', 'Silne']], sh.sev || '', 'sev')}</div>
          <div class="field"><label for="e-note">Opis</label><textarea id="e-note" data-s="text" maxlength="1500" placeholder="Opcjonalnie">${esc(sh.text || '')}</textarea></div>` : ''}
        ${mode === 'visit' ? `<div class="two"><div class="field"><label for="v-date">Data</label><input id="v-date" type="date" data-s="vdate" value="${sh.vdate || T()}"></div>
          <div class="field"><label for="v-time">Godzina</label><input id="v-time" type="time" data-s="vtime" value="${sh.vtime || ''}"></div></div>
          <div class="field"><label for="v-text">Rozpoznanie i zalecenia</label><textarea id="v-text" data-s="text" maxlength="1500" placeholder="np. mykoplazma, antybiotyk 14 dni">${esc(sh.text || '')}</textarea></div>
          <p class="hint">Wizyta z przyszłą datą pojawi się w „Wkrótce”. Przeszła trafi do historii.</p>
          <button class="chip" data-act="vmed" aria-pressed="${!!sh.vmed}" style="align-self:flex-start">Weterynarz przepisał lek</button>
          ${sh.vmed ? '<span class="hint">Po zapisaniu od razu otworzy się nowa kuracja.</span>' : ''}` : ''}
        ${mode === 'note' ? `<div class="field"><label for="n-text">Notatka</label><textarea id="n-text" data-s="text" maxlength="2000">${esc(sh.text || '')}</textarea></div>` : ''}
        ${sh.err ? `<p class="error" role="alert">${esc(sh.err)}</p>` : ''}`;
    },
    rat(sh) {
      const r = sh.id ? rat(sh.id) : null;
      const cur = sh.coat || (r ? safeCoat(r.coat) : COATS[0]);
      const coats = COATS.includes(cur) ? COATS : COATS.concat(cur);
      const val = (k) => (sh[k] != null ? sh[k] : r ? (k === 'born' ? (r.born || '').slice(0, 7) : r[k] || '') : '');
      return `<div class="sheet-h"><button class="link" data-act="close">Anuluj</button><h2>${r ? 'Edytuj' : 'Nowy szczur'}</h2><button class="link strong" data-act="save-rat">${r ? 'Zapisz' : 'Dodaj'}</button></div>
        <div class="field"><label for="r-name">Imię</label><input id="r-name" data-s="name" maxlength="40" value="${esc(val('name'))}" autocomplete="off"></div>
        <div class="field"><label for="r-born">Urodzony (miesiąc)</label><input id="r-born" type="month" data-s="born" max="${T().slice(0, 7)}" value="${esc(val('born'))}"></div>
        <div class="field"><label for="r-look">Jak go rozpoznać</label><input id="r-look" data-s="look" maxlength="120" value="${esc(val('look'))}" placeholder="np. czarny, biała łatka na brzuchu"><span class="hint">Pokażemy to w widoku dla opiekuna przy każdej dawce.</span></div>
        <div class="field"><span class="lbl">Umaszczenie</span><div class="swatches">${coats.map((c, i) => `<button class="swatch" data-act="coat" data-v="${c}" style="background:${c}" aria-pressed="${c === cur}" aria-label="Kolor ${i + 1}"></button>`).join('')}</div></div>
        ${sh.err ? '<p class="error" role="alert">Wpisz imię.</p>' : ''}
        ${r ? (S.confirm === 'arch:' + r.id
          ? `<div class="confirm"><span class="name">Usunąć ${esc(r.name)} ze stada? Historia zostanie w bazie.</span><div class="btns"><button class="btn plain" data-act="confirm-cancel">Anuluj</button><button class="btn danger" data-act="archive" data-id="${r.id}">Usuń</button></div></div>`
          : `<button class="link danger" data-act="confirm" data-key="arch:${r.id}" style="align-self:flex-start">Usuń ze stada</button>`) : ''}`;
    }
  };

  // ---------- Rendering ----------
  const app = document.getElementById('app');
  let lastKey = null, anim = '', lastSheet = null;
  const curScreen = () => (S.setup ? { name: 'setup' } : S.stack.length ? S.stack[S.stack.length - 1] : { name: S.tab });
  function render() {
    S.pending = false;
    if (S.phase !== 'app') {
      app.innerHTML = pre[S.phase]();
      lastKey = S.phase;
      const f = app.querySelector('input'); if (f) f.focus();
      return;
    }
    const cur = curScreen(), key = cur.name + ':' + (cur.id || '');
    const old = app.querySelector('.screen');
    if (old && lastKey) S.scroll[lastKey] = old.scrollTop;
    const oldSheet = app.querySelector('.sheet');
    const sheetScroll = oldSheet && S.sheet && lastSheet === S.sheet.name ? oldSheet.scrollTop : 0;
    let html = screens[cur.name](cur);
    if (!S.stack.length && !S.setup) {
      const lc = lateCount();
      html += `<nav class="tabbar" aria-label="Główne">${[['today', 'Dziś', I.today], ['meds', 'Leki', I.pill], ['flock', 'Stado', I.flock]].map(([v, l, ic]) => `<button class="tab" data-act="tab" data-v="${v}" ${S.tab === v ? 'aria-current="page"' : ''}>${ic}${l}${v === 'today' && lc ? `<span class="badge">${lc}</span>` : ''}</button>`).join('')}</nav>`;
    }
    if (S.sheet) html += `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true">${sheets[S.sheet.name](S.sheet)}</div></div>`;
    const toastEl = app.querySelector('.toast');
    app.innerHTML = html;
    if (toastEl) app.appendChild(toastEl);
    const scr = app.querySelector('.screen');
    if (key === lastKey || anim === 'enter-back' || anim === 'tab') scr.scrollTop = S.scroll[key] || 0;
    if (anim === 'enter' || anim === 'enter-back') scr.classList.add(anim);
    const sh = app.querySelector('.sheet'); if (sh && sheetScroll) sh.scrollTop = sheetScroll;
    lastKey = key; lastSheet = S.sheet ? S.sheet.name : null; anim = '';
    if (cur.name === 'weigh') bindWeigh();
    if (cur.name === 'setup') { const f = app.querySelector('#s-name'); if (f) f.focus(); }
  }
  const busy = () => !!S.sheet || ['weigh', 'form', 'setup'].includes(curScreen().name) || (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName));

  let toastTimer;
  function toast(msg, undo) {
    const old = app.querySelector('.toast'); if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('role', 'status');
    el.innerHTML = esc(msg) + (undo ? '<button type="button">Cofnij</button>' : '');
    if (undo) el.querySelector('button').addEventListener('click', () => { el.remove(); undo(); });
    app.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), undo ? 5000 : 2400);
  }
  function fail(err) {
    console.error(err);
    toast(navigator.onLine ? 'Nie udało się zapisać. Spróbuj ponownie.' : 'Brak internetu. Zmiana nie została zapisana.');
  }

  // ---------- Supabase data ----------
  const ok = (res) => { if (res.error) throw res.error; return res.data; };
  // PostgREST returns at most 1000 rows per request, so page through.
  async function fetchAll(make) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const rows = ok(await make().range(from, from + 999));
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }
  async function load() {
    const since = ad(-400);
    const [rats, weights, entries, treatments, doses, doseChanges, shifts, visits, members, cageTasks, cageDone] = await Promise.all([
      fetchAll(() => sb.from('rats').select('*').eq('archived', false).order('created_at')),
      fetchAll(() => sb.from('weights').select('*').gte('date', since).order('date').order('id')),
      fetchAll(() => sb.from('entries').select('*').order('date', { ascending: false }).order('id')),
      fetchAll(() => sb.from('treatments').select('*').order('start_date').order('id')),
      fetchAll(() => sb.from('doses').select('*').gte('date', since).order('date').order('id')),
      fetchAll(() => sb.from('dose_changes').select('*').order('from_date').order('id')),
      fetchAll(() => sb.from('dose_shifts').select('*').gte('date', ad(-1)).order('date')),
      fetchAll(() => sb.from('visits').select('*').gte('date', ad(-30)).order('date')),
      fetchAll(() => sb.from('members').select('*').order('added_at')),
      fetchAll(() => sb.from('cage_tasks').select('*').eq('archived', false).order('created_at')),
      fetchAll(() => sb.from('cage_done').select('*').gte('date', ad(-120)).order('date').order('id'))
    ]);
    treatments.forEach((t) => { t.times = (t.times || []).map(hm); });
    Object.assign(S, { rats, weights, entries, treatments, doses, doseChanges, shifts, visits, members, cageTasks, cageDone });
  }

  let refreshTimer;
  function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      try { await load(); } catch (err) { console.error(err); return; }
      if (S.phase !== 'app') return;
      if (busy()) S.pending = true; else render();
    }, 300);
  }

  let channel = null;
  function subscribe() {
    if (channel) return;
    channel = sb.channel('ogonki').on('postgres_changes', { event: '*', schema: 'public' }, refresh).subscribe();
  }

  async function enter(session) {
    if (!session) {
      if (channel) { sb.removeChannel(channel); channel = null; }
      S.user = null; S.phase = introSeen() ? 'login' : 'intro'; render(); return;
    }
    if (S.user && S.user.id === session.user.id && S.phase === 'app') return;
    S.user = session.user;
    try {
      const { data, error } = await sb.rpc('is_member');
      if (error) throw error;
      if (!data) { S.phase = 'denied'; render(); return; }
      await load();
      markIntro();
      S.phase = 'app'; S.setup = !S.rats.length; S.stack = []; S.tab = 'today'; render();
      subscribe();
    } catch (err) {
      console.error(err); S.loadErr = err.message || ''; S.phase = 'error'; render();
    }
  }

  async function run(fn, okMsg, undo) {
    try {
      await fn();
      await load();
      render();
      if (okMsg) toast(okMsg, undo);
      return true;
    } catch (err) { fail(err); try { await load(); } catch (e) {} render(); return false; }
  }
  const entry = (ratId, text, date) => sb.from('entries').insert({ rat_id: ratId, date: date || T(), kind: 'system', text: text.slice(0, 2000) });

  // ---------- Doses ----------
  function givenAt(t, date, i) {
    if (date === T()) return new Date().toISOString();
    const sl = slots(t, date).find((s) => s.i === i);
    const [h, m] = (sl && sl.time || '12:00').split(':').map(Number);
    const d = pd(date); d.setHours(h, m);
    return d.toISOString();
  }
  // Saves a dose and, for split medicines, uses up one portion. Optimistic: the screen updates first.
  async function logDose(t, date, i, st, extra) {
    const prev = doseRec(t, date, i);
    const usePortion = !(prev && prev.portion) && t.split_what && st !== 'skipped' && t.split_left > 0;
    const row = Object.assign({ treatment_id: t.id, date, slot: i, status: TO_DB[st], note: '', amount: null, given_at: givenAt(t, date, i), given_by: me(), portion: !!(prev && prev.portion) || usePortion }, extra || {});
    const optimistic = Object.assign({ id: prev ? prev.id : 'tmp' + Date.now() }, row);
    S.doses = S.doses.filter((x) => x !== prev).concat(optimistic);
    if (usePortion) t.split_left--;
    render();
    try {
      ok(await sb.from('doses').upsert(row, { onConflict: 'treatment_id,date,slot' }));
      if (usePortion) ok(await sb.from('treatments').update({ split_left: t.split_left }).eq('id', t.id));
      refresh();
      return true;
    } catch (err) { fail(err); refresh(); return false; }
  }
  async function unlogDose(t, date, i) {
    const rec = doseRec(t, date, i); if (!rec) return;
    S.doses = S.doses.filter((x) => x !== rec);
    const back = rec.portion && t.split_what;
    if (back) t.split_left = Math.min(t.split_parts, t.split_left + 1);
    render();
    try {
      ok(await sb.from('doses').delete().eq('treatment_id', t.id).eq('date', date).eq('slot', i));
      if (back) ok(await sb.from('treatments').update({ split_left: t.split_left }).eq('id', t.id));
    } catch (err) { fail(err); }
    refresh();
  }

  // ---------- Weighing ----------
  function bindWeigh() {
    const inputs = [...app.querySelectorAll('.w-in input')];
    const update = () => {
      let cnt = 0, warn = 0;
      inputs.forEach((inp) => {
        inp.value = inp.value.replace(/[^0-9]/g, '').slice(0, 4);
        const id = inp.dataset.rat, n = parseInt(inp.value, 10), out = document.getElementById('d-' + id), box = document.getElementById('wi-' + id);
        const base = prevW(id), tw = todayW(id);
        box.classList.remove('warn'); out.style.color = '';
        if (isNaN(n)) { out.textContent = weighHint(tw, base); return; }
        cnt++;
        if (!base) { out.textContent = 'pierwszy pomiar'; return; }
        const dd = n - base.g, p = dd / base.g;
        if (Math.abs(p) > .15) { warn++; box.classList.add('warn'); out.style.color = 'var(--danger)'; out.textContent = `Na pewno? Ostatnio ${base.g} g`; return; }
        out.textContent = (dd > 0 ? '+' : dd < 0 ? '−' : '±') + Math.abs(dd) + ' g od ' + rel(base.date).toLowerCase();
        if (p <= -.03) out.style.color = 'var(--danger)';
      });
      const btn = document.getElementById('saveW');
      btn.disabled = !cnt;
      if (!warn) S.weighAck = false;
      btn.textContent = !cnt ? 'Zapisz' : warn && S.weighAck ? 'Zapisz mimo to' : warn ? 'Sprawdź zaznaczone wagi' : 'Zapisz ' + cnt + ' ' + plural(cnt, 'wagę', 'wagi', 'wag');
      btn.dataset.warn = warn;
    };
    inputs.forEach((inp) => inp.addEventListener('input', update));
    update();
  }

  // ---------- Treatment form ----------
  function newForm(ratId) {
    S.form = { tid: null, rat: ratId || (S.rats[0] && S.rats[0].id), med: '', form: 'oral', dmin: '', dmax: '', unit: 'ml', legacy: '', sched: 'times', times: ['08:00', '20:00'], late: 30, every: '10', everyTime: '', start: T(), endType: 'days', endN: '14', note: '', splitOn: false, splitWhat: 'tablet', splitParts: '10', splitWarn: 2, splitLeft: '', errs: [] };
    S.sheet = null; go('form');
  }
  function editForm(t) {
    const d = doseOn(t, T()), text = d.text != null;
    S.form = { tid: t.id, rat: t.rat_id, med: t.med, form: t.form, dmin: text ? '' : fNum(d.min, d.unit), dmax: !text && d.max != null ? fNum(d.max, d.unit) : '', unit: text ? 'ml' : d.unit, legacy: text ? d.text : '', sched: t.sched, times: t.times.length ? t.times.slice() : ['08:00'], late: t.late_min, every: String(t.every_n || 10), everyTime: hm(t.every_time) || '', start: t.start_date, endType: t.end_type, endN: String(t.end_n || ''), note: t.note || '', splitOn: !!t.split_what, splitWhat: t.split_what || 'tablet', splitParts: String(t.split_parts || 10), splitWarn: t.split_what ? t.split_warn : 2, splitLeft: t.split_what ? String(t.split_left) : '', errs: [] };
    go('form');
  }
  async function saveForm() {
    const f = S.form, errs = [];
    const mn = num(f.dmin), mx = String(f.dmax).trim() ? num(f.dmax) : null;
    if (!f.rat) errs.push('Najpierw dodaj szczura.');
    if (!f.med.trim()) errs.push('Wpisz nazwę leku.');
    if (!(mn > 0 && mn < 100000)) errs.push('Wpisz dawkę.');
    if (mx != null && !(mx > mn && mx < 100000)) errs.push('Górna granica dawki musi być większa od dolnej.');
    const times = [...new Set(f.times.filter(Boolean))].sort();
    if (f.sched === 'times' && !times.length) errs.push('Dodaj co najmniej jedną porę.');
    const every = parseInt(f.every, 10), endN = parseInt(f.endN, 10);
    if (f.sched === 'every' && !(every >= 2 && every <= 90)) errs.push('Podaj, co ile dni (od 2 do 90).');
    if (f.endType !== 'forever' && !(endN >= 1 && endN <= 365)) errs.push(f.endType === 'days' ? 'Podaj liczbę dni (od 1 do 365).' : 'Podaj liczbę dawek (od 1 do 365).');
    if (!f.start) errs.push('Wybierz datę rozpoczęcia.');
    const parts = parseInt(f.splitParts, 10);
    if (f.splitOn && !(parts >= 2 && parts <= 50)) errs.push('Podaj, na ile porcji dzielisz lek (od 2 do 50).');
    if (errs.length) { f.errs = errs; render(); app.querySelector('.screen').scrollTop = 0; return; }

    const dose = { min: mn, max: mx, unit: f.unit };
    const row = {
      med: f.med.trim(), form: f.form, dose_min: mn, dose_max: mx, unit: f.unit, dose: doseTxt(dose).slice(0, 80),
      sched: f.sched, times: f.sched === 'times' ? times : [], late_min: +f.late,
      every_n: f.sched === 'every' ? every : null, every_time: f.sched === 'every' && f.everyTime ? f.everyTime : null,
      start_date: f.start, end_type: f.endType, end_n: f.endType === 'forever' ? null : endN, note: f.note.trim(),
      split_what: f.splitOn ? f.splitWhat : null, split_parts: f.splitOn ? parts : null, split_warn: f.splitOn ? +f.splitWarn : 2,
      split_left: f.splitOn ? (String(f.splitLeft).trim() !== '' ? Math.max(0, Math.min(parts, parseInt(f.splitLeft, 10) || 0)) : parts) : null
    };
    row.days = legacyDays(row);

    if (f.tid) {
      const t = tr(f.tid), old = doseOn(t, T());
      const changed = old.text != null || old.min !== mn || old.max !== mx || old.unit !== f.unit;
      const done = await run(async () => {
        ok(await sb.from('treatments').update(row).eq('id', t.id));
        if (changed) {
          if (!doseHist(t).length && old.text == null) ok(await sb.from('dose_changes').upsert({ treatment_id: t.id, from_date: t.start_date, dose_min: old.min, dose_max: old.max, unit: old.unit }, { onConflict: 'treatment_id,from_date' }));
          // Before the course starts, or when the old dose was only text, the new dose covers the whole course.
          const from = T() < f.start || (old.text != null && !doseHist(t).length) ? f.start : T();
          ok(await sb.from('dose_changes').upsert({ treatment_id: t.id, from_date: from, dose_min: mn, dose_max: mx, unit: f.unit, created_by: me() }, { onConflict: 'treatment_id,from_date' }));
          ok(await entry(t.rat_id, `${row.med}: dawka zmieniona z ${doseTxt(old)} na ${doseTxt(dose)}`));
        }
        if (t.sched === 'times' && row.sched === 'times' && t.times.join() !== times.join()) ok(await entry(t.rat_id, `${row.med}: pory zmienione z ${t.times.join(', ')} na ${times.join(', ')}`));
      }, 'Zapisano zmiany');
      if (done) { S.form = null; S.stack.pop(); anim = 'enter-back'; render(); }
    } else {
      let id = null;
      const done = await run(async () => {
        const created = ok(await sb.from('treatments').insert(Object.assign({ rat_id: f.rat }, row)).select().single());
        id = created.id;
        ok(await sb.from('dose_changes').insert({ treatment_id: id, from_date: f.start, dose_min: mn, dose_max: mx, unit: f.unit, created_by: me() }));
        ok(await entry(f.rat, `Początek kuracji: ${row.med}, ${row.dose}`, f.start));
      }, 'Dodano kurację');
      if (done) { S.form = null; S.stack.pop(); S.stack.push({ name: 'treatment', id }); anim = 'enter'; render(); }
    }
  }

  // ---------- Navigation ----------
  function go(name, id) { S.stack.push({ name, id }); S.confirm = null; S.pt = null; S.histMore = false; anim = 'enter'; render(); }
  function back() { S.stack.pop(); S.confirm = null; anim = 'enter-back'; render(); }
  function closeSheet() { S.sheet = null; S.confirm = null; render(); }

  // ---------- Events ----------
  app.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const a = el.dataset.act;
    if (a === 'scrim') { if (e.target === el) closeSheet(); return; }
    switch (a) {
      // navigation
      case 'tab': S.tab = el.dataset.v; S.stack = []; S.sheet = null; anim = 'tab'; render(); break;
      case 'go': go(el.dataset.to, el.dataset.id || undefined); break;
      case 'back': back(); break;
      case 'sheet': S.confirm = null; S.sheet = { name: el.dataset.sheet, id: el.dataset.id || undefined }; render(); break;
      case 'close': closeSheet(); break;
      case 'confirm': S.confirm = el.dataset.key; render(); break;
      case 'confirm-cancel': S.confirm = null; render(); break;

      // sign-in and onboarding
      case 'retry': S.phase = 'loading'; render(); sb.auth.getSession().then(({ data }) => enter(data.session)); break;
      case 'auth-mode': {
        const inp = app.querySelector('#l-email'); if (inp) S.authEmail = inp.value.trim();
        S.authStep = S.authStep === 'signup' ? 'login' : 'signup'; S.authErr = ''; render(); break;
      }
      case 'intro-next':
        if (S.introStep < INTRO.length - 1) { S.introStep++; render(); app.querySelector('.intro-body').classList.add('enter'); }
        else { markIntro(); S.phase = 'login'; render(); }
        break;
      case 'intro-skip': markIntro(); S.phase = 'login'; render(); break;
      case 'setup-done': S.setup = false; anim = 'enter'; render(); break;
      case 'swatch': app.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b === el))); break;
      case 'logout': await sb.auth.signOut(); break;

      // doses
      case 'check': {
        const t = tr(el.dataset.t), d = el.dataset.d, i = +el.dataset.i;
        if (isDone(el.dataset.s)) { S.sheet = { name: 'dose', t: t.id, d, i, confirm: true }; render(); break; }
        if (await logDose(t, d, i, 'given')) toast(`${rat(t.rat_id).name}: podane ${d === T() ? nowHM() : rel(d).toLowerCase()}`, () => unlogDose(t, d, i));
        break;
      }
      case 'carer-give': {
        const t = tr(el.dataset.t), i = +el.dataset.i;
        if (await logDose(t, T(), i, 'given')) toast('Dziękujemy! Zapisane.', () => unlogDose(t, T(), i));
        break;
      }
      case 'dosesheet': S.sheet = { name: 'dose', t: el.dataset.t, d: el.dataset.d, i: +el.dataset.i }; render(); break;
      case 'daysheet': {
        const t = tr(el.dataset.t), sls = slots(t, el.dataset.d);
        S.sheet = sls.length === 1 ? { name: 'dose', t: t.id, d: el.dataset.d, i: sls[0].i } : { name: 'day', t: t.id, d: el.dataset.d };
        render(); break;
      }
      case 'amt': S.sheet.amt = +el.dataset.v; render(); break;
      case 'log': {
        const sh = S.sheet, t = tr(sh.t), extra = {};
        if (sh.amt != null) extra.amount = sh.amt;
        if (sh.note) extra.note = sh.note.trim().slice(0, 200);
        S.sheet = null;
        if (await logDose(t, sh.d, sh.i, el.dataset.v, extra)) toast(el.dataset.v === 'given' ? 'Zapisano: podane' : el.dataset.v === 'partial' ? 'Zapisano: częściowo' : 'Zapisano: pominięte');
        break;
      }
      case 'undo-ask': S.sheet.confirm = true; render(); break;
      case 'undo-ok': { const sh = S.sheet; S.sheet = null; await unlogDose(tr(sh.t), sh.d, sh.i); toast('Wpis cofnięty'); break; }
      case 'shift': S.sheet.shift = +el.dataset.v; render(); break;
      case 'scope': S.sheet.scope = el.dataset.v; render(); break;
      case 'shift-ok': {
        const sh = S.sheet, t = tr(sh.t), cur = shiftOf(t, T(), sh.i) || t.times[sh.i], nt = fromMin(toMin(cur) + sh.shift);
        S.sheet = null;
        if ((sh.scope || 'today') === 'today') {
          run(async () => ok(await sb.from('dose_shifts').upsert({ treatment_id: t.id, date: T(), slot: sh.i, time: nt }, { onConflict: 'treatment_id,date,slot' })), 'Dziś o ' + nt);
        } else {
          const old = t.times[sh.i], times = t.times.slice(); times[sh.i] = nt;
          run(async () => {
            ok(await sb.from('treatments').update({ times: [...new Set(times)].sort() }).eq('id', t.id));
            ok(await sb.from('dose_shifts').delete().eq('treatment_id', t.id).gte('date', T()));
            ok(await entry(t.rat_id, `${t.med}: pora zmieniona z ${old} na ${nt}`));
          }, 'Od dziś o ' + nt);
        }
        break;
      }
      case 'split-done': {
        const t = tr(el.dataset.t), prev = t.split_left;
        let entryId = null;
        run(async () => {
          ok(await sb.from('treatments').update({ split_left: t.split_parts }).eq('id', t.id));
          entryId = ok(await sb.from('entries').insert({ rat_id: t.rat_id, date: T(), kind: 'system', text: `${t.med}: podzielono ${splitName(t, 2)} na ${portions(t.split_parts)} (${nameOf(me())})` }).select().single()).id;
        }, 'Gotowe: ' + portions(t.split_parts), () => run(async () => {
          ok(await sb.from('treatments').update({ split_left: prev }).eq('id', t.id));
          if (entryId) ok(await sb.from('entries').delete().eq('id', entryId));
        }));
        break;
      }

      // treatments
      case 'newform': newForm(el.dataset.rat); break;
      case 'editform': editForm(tr(el.dataset.t)); break;
      case 'saveform': saveForm(); break;
      case 'fset': {
        const k = el.dataset.k, v = el.dataset.v;
        S.form[k] = v;
        if (k === 'sched' && v === 'every' && S.form.endType === 'days') { S.form.endType = 'doses'; S.form.endN = '3'; }
        render(); break;
      }
      case 'fsplit': S.form.splitOn = !S.form.splitOn; render(); break;
      case 'ftime-add': { const l = S.form.times; l.push(l.length ? fromMin(toMin(l[l.length - 1] || '08:00') + 240) : '08:00'); render(); break; }
      case 'ftime-del': S.form.times.splice(+el.dataset.i, 1); render(); break;
      case 'remind': { const t = tr(el.dataset.t); run(async () => ok(await sb.from('treatments').update({ remind_weigh: !t.remind_weigh }).eq('id', t.id))); break; }
      case 'end-ok': {
        const t = tr(el.dataset.t);
        const done = await run(async () => {
          ok(await sb.from('treatments').update({ ended_at: T() }).eq('id', t.id));
          ok(await entry(t.rat_id, 'Koniec kuracji: ' + t.med));
        });
        if (done) { S.confirm = null; back(); toast('Kuracja zakończona'); }
        break;
      }

      // cage
      case 'cage': {
        const c = S.cageTasks.find((x) => x.id === el.dataset.c);
        if (el.dataset.s === 'given') { run(async () => ok(await sb.from('cage_done').delete().eq('task_id', c.id).eq('date', T())), 'Cofnięto'); break; }
        let rowId = null;
        run(async () => { rowId = ok(await sb.from('cage_done').insert({ task_id: c.id, date: T(), done_by: me() }).select().single()).id; },
          c.name + ': zrobione', () => run(async () => ok(await sb.from('cage_done').delete().eq('id', rowId))));
        break;
      }

      // rat profile and chart
      case 'range': S.chartRange = +el.dataset.v; S.pt = null; render(); break;
      case 'morning': S.onlyMorning = !S.onlyMorning; S.pt = null; render(); break;
      case 'pt': S.pt = { rat: el.dataset.rat, id: el.dataset.id }; render(); break;
      case 'hfilter': S.histFilter = el.dataset.v; S.histMore = false; render(); break;
      case 'histmore': S.histMore = true; render(); break;
      case 'del-visit': S.confirm = null; run(async () => ok(await sb.from('visits').delete().eq('id', el.dataset.id)), 'Usunięto wizytę'); break;

      // entry sheet
      case 'emode': S.sheet.mode = el.dataset.v; S.sheet.err = ''; render(); break;
      case 'sy': { const l = S.sheet.sy = S.sheet.sy || []; const ix = l.indexOf(el.dataset.v); if (ix >= 0) l.splice(ix, 1); else l.push(el.dataset.v); render(); break; }
      case 'sev': S.sheet.sev = S.sheet.sev === el.dataset.v ? '' : el.dataset.v; render(); break;
      case 'vmed': S.sheet.vmed = !S.sheet.vmed; render(); break;
      case 'save-entry': saveEntry(); break;

      // rat sheet
      case 'coat': S.sheet.coat = el.dataset.v; render(); break;
      case 'save-rat': saveRat(); break;
      case 'archive': {
        const done = await run(async () => ok(await sb.from('rats').update({ archived: true }).eq('id', el.dataset.id)));
        if (done) { S.sheet = null; S.confirm = null; S.stack = []; S.tab = 'flock'; S.setup = !S.rats.length; anim = 'enter-back'; render(); }
        break;
      }

      // weighing
      case 'save-weigh': {
        if (+el.dataset.warn && !S.weighAck) { S.weighAck = true; el.textContent = 'Zapisz mimo to'; break; }
        const rows = [];
        app.querySelectorAll('.w-in input').forEach((inp) => {
          const v = parseInt(inp.value, 10);
          if (!isNaN(v) && v >= 10 && v <= 2000) rows.push({ rat_id: inp.dataset.rat, date: T(), time: nowHM(), grams: v, weighed_by: me() });
        });
        if (!rows.length) { back(); break; }
        el.disabled = true; S.weighAck = false;
        const done = await run(async () => {
          ok(await sb.from('weights').delete().eq('date', T()).in('rat_id', rows.map((r) => r.rat_id)));
          ok(await sb.from('weights').insert(rows));
        }, 'Zapisano ' + rows.length + ' ' + plural(rows.length, 'wagę', 'wagi', 'wag'));
        if (done) back(); else el.disabled = false;
        break;
      }

      // settings
      case 'thr': S.thr = +el.dataset.v; pref.set('thr', S.thr); render(); break;
      case 'del-member': { const email = el.dataset.email; S.confirm = null; run(async () => ok(await sb.from('members').delete().eq('email', email)), 'Usunięto dostęp'); break; }
    }
  });

  async function saveEntry() {
    const sh = S.sheet, r = rat(sh.id), mode = sh.mode || 'symptoms', txt = (sh.text || '').trim();
    let job, msg, after = null;
    if (mode === 'symptoms') {
      const text = [(sh.sy || []).join(', '), txt].filter(Boolean).join('. ') + (sh.sev ? ' · ' + sh.sev : '');
      if (!(sh.sy || []).length && !txt) { sh.err = 'Zaznacz objaw albo wpisz opis.'; render(); return; }
      job = async () => ok(await sb.from('entries').insert({ rat_id: r.id, date: T(), kind: 'symptoms', text: text.slice(0, 2000) }));
      msg = 'Dodano objawy';
    } else if (mode === 'visit') {
      const date = sh.vdate || T(), time = sh.vtime || null, text = txt || 'Wizyta';
      if (date > T()) { job = async () => ok(await sb.from('visits').insert({ rat_id: r.id, date, time, text })); msg = 'Wizyta w „Wkrótce” na ekranie Dziś'; }
      else { job = async () => ok(await sb.from('entries').insert({ rat_id: r.id, date, kind: 'visit', text: text.slice(0, 2000) })); msg = 'Dodano wizytę'; }
      if (sh.vmed) after = () => newForm(r.id);
    } else {
      if (!txt) { sh.err = 'Wpisz treść notatki.'; render(); return; }
      job = async () => ok(await sb.from('entries').insert({ rat_id: r.id, date: T(), kind: 'note', text: txt }));
      msg = 'Dodano notatkę';
    }
    S.sheet = null; S.histFilter = 'all';
    const done = await run(job, msg);
    if (!done) { S.sheet = sh; render(); } else if (after) after();
  }

  async function saveRat() {
    const sh = S.sheet, r = sh.id ? rat(sh.id) : null;
    const name = (sh.name != null ? sh.name : r ? r.name : '').trim();
    if (!name) { sh.err = true; render(); return; }
    const born = sh.born != null ? sh.born : r && r.born ? r.born.slice(0, 7) : '';
    const row = { name, born: born ? born + '-01' : null, look: (sh.look != null ? sh.look : r ? r.look : '').trim(), coat: sh.coat || (r ? safeCoat(r.coat) : COATS[0]) };
    S.sheet = null;
    const done = await run(async () => ok(r ? await sb.from('rats').update(row).eq('id', r.id) : await sb.from('rats').insert(row)), r ? 'Zapisano' : 'Dodano: ' + name);
    if (!done) { S.sheet = sh; render(); }
  }

  app.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.f && S.form) { if (el.dataset.f === 'time') S.form.times[+el.dataset.i] = el.value; else S.form[el.dataset.f] = el.value; }
    if (el.dataset.s && S.sheet) S.sheet[el.dataset.s] = el.value;
  });

  app.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.dataset.form;
    if (f === 'auth') {
      const signup = S.authStep === 'signup';
      const email = (app.querySelector('#l-email').value || '').trim().toLowerCase();
      const password = app.querySelector('#l-pass').value || '';
      S.authEmail = email;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { S.authErr = 'Wpisz poprawny adres e-mail.'; render(); return; }
      if (password.length < (signup ? 8 : 1)) { S.authErr = signup ? 'Hasło musi mieć co najmniej 8 znaków.' : 'Wpisz hasło.'; render(); return; }
      S.authBusy = true; S.authErr = ''; render();
      const res = signup ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
      S.authBusy = false;
      const err = res.error;
      if (err) {
        const m = (err.message || '').toLowerCase();
        S.authErr = err.status === 429 ? 'Za dużo prób. Odczekaj chwilę i spróbuj ponownie.'
          : m.includes('invalid login') ? 'Nieprawidłowy e-mail lub hasło.'
          : m.includes('already registered') ? 'To konto już istnieje. Zaloguj się.'
          : m.includes('not confirmed') ? 'Konto czeka na potwierdzenie adresu e-mail.'
          : m.includes('signups not allowed') ? 'Zakładanie nowych kont jest wyłączone.'
          : 'Nie udało się. ' + (err.message || '');
        render();
      } else if (signup && !res.data.session) {
        S.authStep = 'login';
        S.authErr = 'Konto utworzone. Potwierdź adres e-mail i zaloguj się.';
        render();
      }
    } else if (f === 'setup-rat') {
      const inp = app.querySelector('#s-name');
      const name = (inp.value || '').trim();
      if (!name) { toast('Wpisz imię.'); inp.focus(); return; }
      const coat = app.querySelector('.swatch[aria-pressed="true"]').dataset.c;
      run(async () => ok(await sb.from('rats').insert({ name, coat })), 'Dodano: ' + name);
    } else if (f === 'member') {
      const inp = app.querySelector('#m-email');
      const email = (inp.value || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Wpisz poprawny adres e-mail.'); inp.focus(); return; }
      run(async () => ok(await sb.from('members').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true })), 'Dodano ' + email);
    } else if (f === 'my-name') {
      const name = (app.querySelector('#my-name').value || '').trim();
      app.querySelector('#my-name').blur();
      run(async () => ok(await sb.from('members').update({ display_name: name || null }).eq('email', me())), 'Zapisano');
    }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.sheet) closeSheet(); });

  // ---------- Online / offline and returning to the app ----------
  const offBar = document.createElement('div');
  offBar.className = 'offline'; offBar.textContent = 'Brak internetu. Zmiany nie zostaną zapisane.';
  offBar.hidden = navigator.onLine;
  document.body.appendChild(offBar);
  window.addEventListener('online', () => { offBar.hidden = true; if (S.phase === 'app') refresh(); });
  window.addEventListener('offline', () => { offBar.hidden = false; });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.phase === 'app') refresh(); });
  // Refresh "late" states every minute, but never while someone is typing or a sheet is open.
  setInterval(() => { if (S.phase === 'app' && !busy()) render(); }, 60000);
  document.addEventListener('focusout', () => setTimeout(() => { if (S.pending && !busy()) render(); }, 0));

  // ---------- Start ----------
  if (!sb) { S.phase = 'config'; render(); return; }
  render();
  let started = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') { started = true; setTimeout(() => enter(session), 0); }
  });
  setTimeout(() => { if (!started) sb.auth.getSession().then(({ data }) => enter(data.session)); }, 1500);
})();
