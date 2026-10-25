/* Ogonki */
(function () {
  'use strict';

  // ---------- Konfiguracja ----------
  const CFG = window.OGONKI_CONFIG || {};
  const configured = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && !/TWOJ/.test(CFG.supabaseUrl + CFG.supabaseAnonKey));
  const sb = configured && window.supabase
    ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null;

  // ---------- Daty ----------
  const WD = ['nd.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
  const MON = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
  const T = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  const d = (s) => { const [y, m, dd] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, dd || 1); };
  const iso = (dt) => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  const diff = (a, b) => Math.round((a - b) / 86400000);
  const addDays = (dt, n) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n);
  const short = (dt) => dt.getDate() + '.' + String(dt.getMonth() + 1).padStart(2, '0');
  const rel = (dt) => {
    const n = diff(dt, T());
    if (n < 0) return 'Zaległe';
    if (n === 0) return 'Dziś';
    if (n === 1) return 'Jutro';
    return WD[dt.getDay()] + ' ' + short(dt);
  };
  const ageOf = (born) => {
    if (!born) return '';
    const b = d(born), t = T();
    const months = (t.getFullYear() - b.getFullYear()) * 12 + (t.getMonth() - b.getMonth());
    if (months < 0) return '';
    if (months < 12) return months + ' mies.';
    const y = Math.floor(months / 12), m = months % 12;
    return y + (y === 1 ? ' r.' : ' l.') + (m ? ' ' + m + ' mies.' : '');
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Stan ----------
  const S = {
    phase: 'loading', authStep: 'login', authEmail: '', authBusy: false, authErr: '', loadErr: '',
    user: null, rats: [], weights: [], entries: [], treatments: [], doses: [], visits: [], members: [],
    stack: [{ name: 'start' }], sheet: null, confirm: null, histAll: false, pending: false, introStep: 0
  };
  const INTRO_KEY = 'ogonki-intro-seen';
  const introSeen = () => { try { return localStorage.getItem(INTRO_KEY) === '1'; } catch (e) { return false; } };
  const markIntro = () => { try { localStorage.setItem(INTRO_KEY, '1'); } catch (e) {} };
  const cur = () => S.stack[S.stack.length - 1];
  const me = () => (S.user && S.user.email || '').toLowerCase();

  // ---------- Dane pomocnicze ----------
  const rat = (id) => S.rats.find((r) => r.id === id);
  const tr = (id) => S.treatments.find((t) => t.id === id);
  const weightsOf = (id) => S.weights.filter((w) => w.rat_id === id).map((w) => [w.date, w.grams]).sort((a, b) => a[0].localeCompare(b[0]));
  const lastW = (id) => { const w = weightsOf(id); return w.length ? w[w.length - 1][1] : null; };
  const trend = (id) => {
    const w = weightsOf(id); if (w.length < 3) return null;
    const p = (w[w.length - 1][1] - w[w.length - 3][1]) / w[w.length - 3][1];
    return p <= -0.05 ? '−' + Math.round(Math.abs(p) * 100) + '%' : null;
  };
  const dayOf = (t) => diff(T(), d(t.start_date)) + 1;
  const endOf = (t) => addDays(d(t.start_date), t.days - 1);
  const active = (t) => { const n = dayOf(t); return !t.ended_at && n >= 1 && n <= t.days && !!rat(t.rat_id); };
  const slotDate = (t, n) => iso(addDays(d(t.start_date), n - 1));
  const doseRec = (t, date, slot) => S.doses.find((x) => x.treatment_id === t.id && x.date === date && x.slot === slot);
  const slotStatus = (t, n, i) => {
    const date = slotDate(t, n), rec = doseRec(t, date, i);
    if (rec) return rec.status;
    return date < iso(T()) ? 'miss' : 'todo';
  };
  const lum = (hex) => {
    const n = parseInt(String(hex).slice(1), 16) || 0;
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const safeCoat = (c) => /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#E9D2A8';
  const avatar = (r, cls) => {
    const c = safeCoat(r.coat);
    return `<span class="avatar ${cls || ''}" style="background:${c};color:${lum(c) > 0.35 ? '#16181D' : '#FFFFFF'}" aria-hidden="true">${esc((r.name || '?').charAt(0).toUpperCase())}</span>`;
  };

  function todaysDoses() {
    const groups = {};
    const today = iso(T());
    S.treatments.filter(active).forEach((t) => {
      t.times.forEach((time, i) => {
        const rec = doseRec(t, today, i);
        (groups[time] = groups[time] || []).push({ t, i, r: rat(t.rat_id), done: !!rec && rec.status === 'ok', bad: !!rec && rec.status === 'bad' });
      });
    });
    return Object.keys(groups).sort().map((time) => ({ time, items: groups[time] }));
  }

  function weighDue() {
    if (!S.rats.length) return null;
    const interval = S.treatments.some((t) => active(t) && t.remind_weigh) ? 3 : 7;
    const ids = new Set(S.rats.map((r) => r.id));
    if (S.rats.some((r) => !S.weights.some((w) => w.rat_id === r.id))) return T();
    const dates = S.weights.filter((w) => ids.has(w.rat_id)).map((w) => w.date).sort();
    const due = addDays(d(dates[dates.length - 1]), interval);
    return due < T() ? T() : due;
  }

  function upcoming() {
    const list = [];
    const wd = weighDue();
    if (wd) list.push({ dt: wd, text: 'Ważenie stada', to: 'waga' });
    S.treatments.filter(active).forEach((t) => list.push({ dt: endOf(t), text: 'Koniec kuracji · ' + rat(t.rat_id).name, to: 'kuracja', id: t.id }));
    S.visits.filter((v) => v.date >= iso(T()) && rat(v.rat_id)).forEach((v) => list.push({
      dt: d(v.date), text: v.text + ' · ' + rat(v.rat_id).name + (v.time ? ', ' + v.time.slice(0, 5) : ''), to: 'profil', id: v.rat_id
    }));
    return list.sort((a, b) => a.dt - b.dt).slice(0, 4);
  }

  // ---------- Ikony ----------
  const I = {
    back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    chev: '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    tick: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    cross: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
  };
  const backBtn = (label) => `<button class="link" data-act="back">${I.back}${esc(label)}</button>`;

  // ---------- Ekrany przed zalogowaniem ----------
  const pre = {
    loading: () => `<div class="screen center"><p class="sub" style="text-align:center">Ładowanie…</p></div>`,
    intro: () => {
      const s = INTRO[S.introStep], last = S.introStep === INTRO.length - 1;
      return `<div class="screen has-bar intro">
        <div class="topbar" style="justify-content:flex-end">${last ? '' : '<button class="link" data-act="intro-skip">Pomiń</button>'}</div>
        <div class="intro-body">
          <div class="ill">${s.ill}</div>
          <h1 class="title">${s.title}</h1>
          <p class="lead">${s.lead}</p>
        </div>
        <div class="bar intro-bar">
          <div class="pager" aria-label="Krok ${S.introStep + 1} z ${INTRO.length}">${INTRO.map((_, i) => `<i class="${i === S.introStep ? 'on' : ''}"></i>`).join('')}</div>
          <button class="btn primary" data-act="intro-next">${last ? 'Zaczynamy' : 'Dalej'}</button>
        </div>
      </div>`;
    },
    config: () => `<div class="screen center">
      <h1 class="title">Ogonki</h1>
      <p class="lead">Aplikacja nie jest jeszcze skonfigurowana.</p>
    </div>`,
    login: () => {
      const signup = S.authStep === 'signup';
      return `<form class="screen center" data-form="auth" novalidate>
      <h1 class="title">${signup ? 'Nowe konto' : 'Ogonki'}</h1>
      <p class="lead">${signup ? 'Użyj adresu, który jest na liście osób ze stada.' : 'Zaloguj się, żeby zobaczyć swoje stado.'}</p>
      <div class="field"><label for="l-email">E-mail</label>
        <input id="l-email" type="email" autocomplete="email" inputmode="email" required value="${esc(S.authEmail)}"></div>
      <div class="field"><label for="l-pass">Hasło</label>
        <input id="l-pass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="8"></div>
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

  // ---------- Ekrany aplikacji ----------
  // ---------- Wstęp (onboarding) ----------
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

  const screens = {
    setup() {
      return `<form class="screen has-bar" data-form="setup-rat" novalidate>
        <div style="display:flex;flex-direction:column;gap:6px;padding-top:8px">
          <h1 class="title small">Kto jest w stadzie?</h1>
          <p class="lead">Dodaj swoje szczury. Wagę i leki uzupełnisz później.</p>
        </div>
        ${S.rats.length ? `<section>${S.rats.map((r) => `<div class="row static">${avatar(r)}<span class="row-main"><span class="name">${esc(r.name)}</span></span></div>`).join('')}</section>` : ''}
        <div class="field"><label for="s-name">Imię</label><input id="s-name" autocomplete="off" maxlength="40"></div>
        <div class="field"><span class="label">Umaszczenie</span>
          <div class="swatches" role="group" aria-label="Umaszczenie">${COATS.map((c, i) => `<button type="button" class="swatch" data-act="swatch" data-c="${c}" style="background:${c}" aria-pressed="${i === 0}" aria-label="Kolor ${i + 1}"></button>`).join('')}</div></div>
        <button class="btn plain" type="submit">${S.rats.length ? 'Dodaj kolejnego' : 'Dodaj'}</button>
        <div class="bar"><button type="button" class="btn primary" data-act="setup-done" ${S.rats.length ? '' : 'disabled'}>Gotowe</button></div>
      </form>`;
    },

    start() {
      const groups = todaysDoses();
      const up = upcoming();
      return `<div class="screen">
        <div class="topbar"><h1 class="title">Ogonki</h1>
          <button class="icon-btn" data-act="go" data-to="ustawienia" aria-label="Ustawienia">${I.gear}</button></div>
        ${groups.map((g) => `<section>
          <div class="sec-h"><h2>${esc(g.time)}</h2></div>
          ${g.items.map((x) => `<div class="row static ${x.done ? 'done' : ''}">
            ${avatar(x.r)}
            <span class="row-main"><span class="name">${esc(x.r.name)}</span><span class="sub">${esc(x.t.med)} · ${esc(x.t.dose)}${x.bad ? ' · problem' : ''}</span></span>
            <button class="check ${x.bad ? 'bad' : ''}" data-act="dose" data-t="${x.t.id}" data-i="${x.i}" aria-pressed="${x.done}" aria-label="Podane: ${esc(x.r.name)}, ${esc(g.time)}"><span>${x.bad ? I.cross : I.tick}</span></button>
          </div>`).join('')}
        </section>`).join('')}
        ${up.length ? `<section><div class="sec-h"><h2>Wkrótce</h2></div>
          ${up.map((u) => `<button class="row" data-act="go" data-to="${u.to}" data-id="${u.id || ''}">
            <span class="when">${rel(u.dt)}</span><span class="row-main"><span>${esc(u.text)}</span></span>${I.chev}</button>`).join('')}
        </section>` : ''}
        <section>
          <div class="sec-h"><h2>Szczury</h2>${S.rats.length ? '<button class="link" data-act="go" data-to="waga">Zważ wszystkie</button>' : ''}</div>
          ${S.rats.length ? '' : '<p class="sub" style="padding:8px 0 4px">Dodaj pierwszego szczura, żeby zacząć zapisywać wagę i leki.</p>'}
          ${S.rats.map((r) => { const t = trend(r.id), w = lastW(r.id), age = ageOf(r.born); return `<button class="row" data-act="go" data-to="profil" data-id="${r.id}">
            ${avatar(r)}
            <span class="row-main"><span class="name">${esc(r.name)}</span>${age ? `<span class="sub">${age}</span>` : ''}</span>
            <span class="end"><span class="weight num">${w ? w + ' g' : '–'}</span>${t ? `<span class="down num">${t}</span>` : ''}</span>${I.chev}
          </button>`; }).join('')}
          <button class="row" data-act="sheet" data-sheet="rat">
            <span class="avatar add" aria-hidden="true">${I.plus}</span>
            <span class="row-main"><span style="color:var(--accent);font-weight:500">Dodaj szczura</span></span>
          </button>
        </section>
      </div>`;
    },

    profil(p) {
      const r = rat(p.id);
      if (!r) return screens.start();
      const ts = S.treatments.filter((x) => x.rat_id === r.id && active(x));
      const w = weightsOf(r.id);
      const delta = w.length > 1 ? w[w.length - 1][1] - w[0][1] : null;
      const visits = S.visits.filter((v) => v.rat_id === r.id && v.date >= iso(T()));
      const hist = S.entries.filter((e) => e.rat_id === r.id).map((e) => ({ date: e.date, text: e.text, at: e.created_at || '' }))
        .concat(w.map((x) => ({ date: x[0], text: x[1] + ' g', at: '' })))
        .sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
      const shown = S.histAll ? hist : hist.slice(0, 8);
      const age = ageOf(r.born);
      return `<div class="screen has-bar">
        <div class="topbar">${backBtn('Ogonki')}<button class="link" data-act="sheet" data-sheet="rat" data-id="${r.id}">Edytuj</button></div>
        <div class="hero">${avatar(r, 'lg')}<div style="display:flex;flex-direction:column;gap:2px;min-width:0">
          <h1 class="title small">${esc(r.name)}</h1>${age ? `<span class="sub">${age}</span>` : ''}</div></div>
        ${w.length ? `<section style="gap:12px">
          <div style="display:flex;align-items:baseline;gap:10px"><span class="big num">${lastW(r.id)} g</span>
          ${delta ? `<span class="num" style="font-size:15px;font-weight:600;color:${delta < 0 ? 'var(--danger)' : 'var(--muted)'}">${delta > 0 ? '+' : '−'}${Math.abs(delta)} g</span>` : ''}</div>
          ${chart(w, ts[0])}
        </section>` : `<p class="sub">Brak pomiarów wagi.</p>`}
        ${ts.length || visits.length ? `<section style="border-top:1px solid var(--line)">
          ${ts.map((t) => `<button class="row" data-act="go" data-to="kuracja" data-id="${t.id}" style="flex-direction:column;align-items:stretch;gap:10px;padding:14px 0">
            <span style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="name">${esc(t.med)}</span><span class="sub">${dayOf(t)} z ${t.days} dni ›</span></span>
            <span class="progress"><i style="width:${Math.round(dayOf(t) / t.days * 100)}%"></i></span></button>`).join('')}
          ${visits.map((v) => `<div class="row static"><span class="when">${rel(d(v.date))}</span>
            <span class="row-main"><span>${esc(v.text)}${v.time ? ', ' + esc(v.time.slice(0, 5)) : ''}</span></span>
            <button class="link" data-act="del-visit" data-id="${v.id}" style="font-size:15px">Usuń</button></div>`).join('')}
        </section>` : ''}
        ${shown.length ? `<section>${shown.map((h) => `<div style="display:flex;gap:16px;padding:10px 0">
          <span class="sub num" style="flex:none;width:52px">${short(d(h.date))}</span><span style="font-size:15px;line-height:1.4;min-width:0;overflow-wrap:anywhere">${esc(h.text)}</span></div>`).join('')}
          ${hist.length > 8 && !S.histAll ? '<button class="link" data-act="hist-all" style="align-self:flex-start">Pokaż całą historię</button>' : ''}
        </section>` : ''}
        <div class="bar"><button class="btn primary" data-act="sheet" data-sheet="entry" data-id="${r.id}">Dodaj wpis</button></div>
      </div>`;
    },

    kuracja(p) {
      const t = tr(p.id);
      if (!t || !active(t)) return screens.start();
      const r = rat(t.rat_id);
      const today = dayOf(t);
      const days = [];
      for (let n = 1; n <= t.days; n++) {
        const future = n > today;
        days.push(`<button class="day ${n === today ? 'today' : future ? 'future' : ''}" ${future ? 'disabled' : `data-act="sheet" data-sheet="day" data-id="${t.id}" data-n="${n}"`} aria-label="Dzień ${n}">
          <b class="num">${n}</b><span class="dots">${t.times.map((_, i) => `<span class="dot ${slotStatus(t, n, i)}"></span>`).join('')}</span></button>`);
      }
      const problems = S.doses.filter((x) => x.treatment_id === t.id && x.status === 'bad').sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
      const confirming = S.confirm === 'end:' + t.id;
      return `<div class="screen">
        <div class="topbar">${backBtn(r.name)}</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <h1 class="title small">${esc(t.med)}</h1>
          <span class="lead">${esc(t.dose)} · ${t.times.map(esc).join(' i ')}</span></div>
        <section style="gap:12px">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span class="name">Dzień ${today} z ${t.days}</span><span class="sub">do ${endOf(t).getDate()} ${MON[endOf(t).getMonth()]}</span></div>
          <div class="days">${days.join('')}</div>
          <div class="legend"><span><i class="dot ok"></i>Podana</span><span><i class="dot bad"></i>Problem</span><span><i class="dot miss"></i>Nie odhaczona</span></div>
        </section>
        ${problems.length ? `<section>${problems.map((x) => `<div class="note"><span class="dot bad"></span><span style="display:flex;flex-direction:column;gap:2px;min-width:0">
          <span class="sub">${short(d(x.date))}, ${esc(t.times[x.slot] || '')}</span><span>${esc(x.note || 'Problem z dawką')}</span></span></div>`).join('')}</section>` : ''}
        <section>
          <div class="row static"><span class="row-main"><span>Ważenie co 3 dni</span></span>
            <button class="toggle" data-act="remind" data-t="${t.id}" aria-pressed="${!!t.remind_weigh}" aria-label="Przypomnienie o ważeniu co 3 dni"></button></div>
          <button class="row" data-act="go" data-to="opiekun"><span class="row-main"><span>Widok dla opiekuna</span></span>${I.chev}</button>
          ${confirming ? `<div class="confirm"><span class="name">Zakończyć kurację?</span>
            <div class="btns"><button class="btn plain" data-act="confirm-cancel">Anuluj</button><button class="btn danger" data-act="end-ok" data-t="${t.id}">Zakończ</button></div></div>`
          : `<button class="row" data-act="confirm" data-key="end:${t.id}" style="border-bottom:0;color:var(--danger)">Zakończ kurację</button>`}
        </section>
      </div>`;
    },

    waga() {
      return `<div class="screen">
        <div class="topbar"><button class="link" data-act="back">Anuluj</button><button class="link strong" data-act="save-weigh" id="saveW">Zapisz</button></div>
        <h1 class="title small">Ważenie</h1>
        <section>${S.rats.map((r) => { const lw = lastW(r.id); return `<div class="row static">
          ${avatar(r)}
          <span class="row-main"><label class="name" for="w-${r.id}">${esc(r.name)}</label>
          <span class="sub num" id="d-${r.id}">${lw ? 'ostatnio ' + lw + ' g' : 'pierwszy pomiar'}</span></span>
          <span class="w-in"><input id="w-${r.id}" data-rat="${r.id}" inputmode="numeric" maxlength="4" placeholder="${lw || ''}" autocomplete="off"><span>g</span></span>
        </div>`; }).join('')}</section>
        <p class="hint">Waż o podobnej porze, najlepiej przed karmieniem.</p>
      </div>`;
    },

    ustawienia() {
      return `<div class="screen">
        <div class="topbar">${backBtn('Ogonki')}</div>
        <h1 class="title small">Ustawienia</h1>
        <section>
          <div class="sec-h"><h2>Osoby z dostępem</h2></div>
          ${S.members.map((m) => `<div class="row static"><span class="row-main"><span style="overflow-wrap:anywhere">${esc(m.email)}</span>${m.email === me() ? '<span class="sub">To ty</span>' : ''}</span>
            ${m.email === me() ? '' : (S.confirm === 'mem:' + m.email
              ? `<button class="link" data-act="confirm-cancel" style="font-size:15px">Anuluj</button><button class="link" data-act="del-member" data-email="${esc(m.email)}" style="font-size:15px;color:var(--danger)">Usuń</button>`
              : `<button class="link" data-act="confirm" data-key="mem:${esc(m.email)}" style="font-size:15px">Usuń</button>`)}
          </div>`).join('')}
          <form data-form="member" style="display:flex;gap:10px;align-items:flex-end;padding-top:12px" novalidate>
            <div class="field" style="flex:1"><label for="m-email">Dodaj osobę (np. opiekuna na wyjazd)</label>
              <input id="m-email" type="email" inputmode="email" autocomplete="off" placeholder="adres@e-mail"></div>
            <button class="btn primary" type="submit" style="width:auto;padding:0 18px;height:48px;border-radius:12px">Dodaj</button>
          </form>
          <p class="hint" style="padding-top:8px">Dodana osoba widzi i może zmieniać wszystkie dane stada. Po powrocie z wyjazdu usuń ją z listy.</p>
        </section>
        <section>
          <button class="row" data-act="go" data-to="opiekun"><span class="row-main"><span>Widok dla opiekuna</span><span class="sub">Duże przyciski, tylko dzisiejsze dawki</span></span>${I.chev}</button>
          <button class="row" data-act="logout" style="color:var(--danger)">Wyloguj</button>
        </section>
        <p class="foot">Zalogowano jako ${esc(me())}</p>
      </div>`;
    },

    opiekun() {
      const groups = todaysDoses();
      return `<div class="screen">
        <div class="topbar">${backBtn('Wróć')}</div>
        <h1 class="title small">Dziś</h1>
        ${groups.length ? '' : '<p class="lead">Na dziś nie ma żadnych dawek.</p>'}
        ${groups.map((g) => `<section style="gap:24px">
          <div class="sec-h" style="margin:0"><h2>${esc(g.time)}</h2></div>
          ${g.items.map((x) => `<div class="care">
            <div style="display:flex;align-items:center;gap:14px">${avatar(x.r, 'md')}
              <span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span style="font-size:20px;font-weight:700">${esc(x.r.name)}</span>${x.r.look ? `<span class="sub">${esc(x.r.look)}</span>` : ''}</span></div>
            <div class="dose-line"><span>${esc(x.t.med)}</span><span class="num" style="font-size:20px;font-weight:700">${esc(x.t.dose)}</span></div>
            <button class="btn ${x.done ? 'outline' : 'primary'}" data-act="dose" data-t="${x.t.id}" data-i="${x.i}" aria-pressed="${x.done}">${x.done ? '✓ Podane' : 'Podane'}</button>
          </div>`).join('')}
        </section>`).join('')}
      </div>`;
    }
  };

  function chart(all, t) {
    const w = all.slice(-12);
    if (w.length < 2) return '';
    const W = 350, top = 8, bottom = 104;
    const vals = w.map((x) => x[1]);
    const min = Math.min(...vals) - 6, max = Math.max(...vals) + 6;
    const step = (W - 12) / (w.length - 1);
    const X = (i) => 6 + i * step;
    const Y = (v) => top + (max - v) / (max - min) * (bottom - top);
    const pts = w.map((x, i) => X(i).toFixed(1) + ',' + Y(x[1]).toFixed(1)).join(' ');
    let band = '';
    if (t) {
      const idx = w.findIndex((x) => x[0] >= t.start_date);
      if (idx !== -1) {
        const bx = Math.max(0, X(idx) - step / 2);
        band = `<rect class="ch-band" x="${bx.toFixed(1)}" y="0" width="${(W - bx).toFixed(1)}" height="${bottom}" rx="8"/>`;
      }
    }
    const last = w.length - 1, first = d(w[0][0]), end = d(w[last][0]);
    return `<svg class="chart" viewBox="0 0 ${W} 124" role="img" aria-label="Waga od ${short(first)} do ${short(end)}: od ${vals[0]} do ${vals[last]} gramów">
      ${band}<line class="ch-axis" x1="0" y1="${bottom}" x2="${W}" y2="${bottom}"/>
      <polyline class="ch-line" points="${pts}"/>
      <circle class="ch-dot" cx="${X(last).toFixed(1)}" cy="${Y(vals[last]).toFixed(1)}" r="5"/>
      <text class="ch-lbl" x="0" y="120">${short(first)}</text>
      <text class="ch-lbl" x="${W}" y="120" text-anchor="end">${short(end)}</text>
    </svg>`;
  }

  // ---------- Arkusze ----------
  const COATS = ['#E9D2A8', '#8C8C92', '#3A3A40', '#FFFFFF', '#C98B5B', '#D9C7B8'];
  const SYMPTOMS = ['Kichanie', 'Porfiryna', 'Słyszalny oddech', 'Apatia', 'Brak apetytu', 'Guz', 'Biegunka', 'Rana'];
  const sheets = {
    entry(sh) {
      const r = rat(sh.id);
      const today = iso(T());
      return `<div class="sheet-h"><button class="link" data-act="close">Anuluj</button><h2>${esc(r.name)}</h2><button class="link strong" data-act="save-entry" data-id="${r.id}">Zapisz</button></div>
        <div class="seg" role="group" aria-label="Rodzaj wpisu">
          <button data-act="seg" data-v="objawy" aria-pressed="true">Objawy</button>
          <button data-act="seg" data-v="wizyta" aria-pressed="false">Wizyta</button>
          <button data-act="seg" data-v="kuracja" aria-pressed="false">Kuracja</button>
          <button data-act="seg" data-v="notatka" aria-pressed="false">Notatka</button>
        </div>
        <div class="panel" data-panel="objawy">
          <div class="chips">${SYMPTOMS.map((s) => `<button class="chip" data-act="chip" aria-pressed="false">${s}</button>`).join('')}</div>
          <div class="field"><label for="e-note">Opis</label><textarea id="e-note" placeholder="Opcjonalnie"></textarea></div>
        </div>
        <div class="panel" data-panel="wizyta" hidden>
          <div class="two"><div class="field"><label for="v-date">Data</label><input id="v-date" type="date" value="${today}"></div>
          <div class="field"><label for="v-time">Godzina</label><input id="v-time" type="time"></div></div>
          <div class="field"><label for="v-text">Powód lub zalecenia</label><textarea id="v-text" placeholder="np. kontrola po kuracji"></textarea></div>
          <p class="hint">Wizyta z przyszłą datą pojawi się w „Wkrótce”. Przeszła trafi do historii.</p>
        </div>
        <div class="panel" data-panel="kuracja" hidden>
          <div class="field"><label for="k-med">Lek</label><input id="k-med" autocomplete="off"></div>
          <div class="field"><label for="k-dose">Dawka z recepty</label><input id="k-dose" autocomplete="off" placeholder="np. 0,15 ml doustnie"></div>
          <div class="two"><div class="field"><label for="k-t1">Godzina</label><input id="k-t1" type="time" value="08:00"></div>
          <div class="field"><label for="k-t2">Druga godzina</label><input id="k-t2" type="time" value="20:00"></div></div>
          <div class="two"><div class="field"><label for="k-start">Od</label><input id="k-start" type="date" value="${today}"></div>
          <div class="field"><label for="k-days">Liczba dni</label><input id="k-days" type="number" inputmode="numeric" min="1" max="365" value="14"></div></div>
          <p class="hint">Wyczyść drugą godzinę, jeśli lek jest raz dziennie. Aplikacja nie wylicza dawek.</p>
        </div>
        <div class="panel" data-panel="notatka" hidden>
          <div class="field"><label for="n-text">Notatka</label><textarea id="n-text"></textarea></div>
        </div>
        <p class="error" id="sheet-err" role="alert" hidden></p>`;
    },
    rat(sh) {
      const r = sh.id ? rat(sh.id) : null;
      const coat = r ? safeCoat(r.coat) : COATS[0];
      const coats = COATS.includes(coat) ? COATS : COATS.concat(coat);
      const confirming = S.confirm === 'arch:' + (r && r.id);
      return `<div class="sheet-h"><button class="link" data-act="close">Anuluj</button><h2>${r ? 'Edycja' : 'Nowy szczur'}</h2><button class="link strong" data-act="save-rat" data-id="${r ? r.id : ''}">${r ? 'Zapisz' : 'Dodaj'}</button></div>
        <div class="field"><label for="r-name">Imię</label><input id="r-name" autocomplete="off" maxlength="40" value="${esc(r ? r.name : '')}"></div>
        <div class="field"><label for="r-born">Urodzony</label><input id="r-born" type="month" max="${iso(T()).slice(0, 7)}" value="${r && r.born ? r.born.slice(0, 7) : ''}"></div>
        <div class="field"><span class="label">Umaszczenie</span>
          <div class="swatches" role="group" aria-label="Umaszczenie">${coats.map((c, i) => `<button class="swatch" data-act="swatch" data-c="${c}" style="background:${c}" aria-pressed="${c === coat}" aria-label="Kolor ${i + 1}"></button>`).join('')}</div></div>
        <div class="field"><label for="r-look">Jak go rozpoznać</label><input id="r-look" autocomplete="off" maxlength="120" value="${esc(r ? r.look : '')}" placeholder="np. beżowy, nacięte lewe ucho"></div>
        <p class="error" id="sheet-err" role="alert" hidden></p>
        ${r ? (confirming
          ? `<div class="confirm"><span class="name">Usunąć ${esc(r.name)} ze stada? Historia zostanie w bazie.</span><div class="btns"><button class="btn plain" data-act="confirm-cancel">Anuluj</button><button class="btn danger" data-act="archive" data-id="${r.id}">Usuń</button></div></div>`
          : `<button class="link" data-act="confirm" data-key="arch:${r.id}" style="color:var(--danger);align-self:flex-start">Usuń ze stada</button>`) : ''}`;
    },
    day(sh) {
      const t = tr(sh.id);
      const date = slotDate(t, sh.n);
      return `<div class="sheet-h"><button class="link" data-act="close">Anuluj</button><h2>Dzień ${sh.n} · ${short(d(date))}</h2><button class="link strong" data-act="save-day" data-id="${t.id}" data-n="${sh.n}">Zapisz</button></div>
        ${t.times.map((time, i) => { const rec = doseRec(t, date, i); const st = rec ? rec.status : 'none'; return `<div class="field" data-slot="${i}">
          <span class="label">${esc(time)}</span>
          <div class="slot-opts" role="group" aria-label="Dawka o ${esc(time)}">
            <button class="chip" data-act="slot" data-v="ok" aria-pressed="${st === 'ok'}">Podana</button>
            <button class="chip" data-act="slot" data-v="bad" aria-pressed="${st === 'bad'}">Problem</button>
            <button class="chip" data-act="slot" data-v="none" aria-pressed="${st === 'none'}">Brak</button>
          </div>
          <input class="slot-note" aria-label="Co się stało o ${esc(time)}" placeholder="Co się stało?" value="${esc(rec && rec.note || '')}" ${st === 'bad' ? '' : 'hidden'} style="min-height:44px;border:0;border-radius:12px;background:var(--fill);padding:10px 14px;font-size:17px">
        </div>`; }).join('')}`;
    }
  };

  // ---------- Renderowanie ----------
  const app = document.getElementById('app');
  let lastKey = null, anim = '';
  function render() {
    S.pending = false;
    if (S.phase !== 'app') {
      app.innerHTML = pre[S.phase]();
      lastKey = S.phase;
      const f = app.querySelector('input'); if (f) f.focus();
      return;
    }
    const c = cur();
    const key = c.name + ':' + (c.id || '');
    const old = app.querySelector('.screen');
    const keep = key === lastKey && old ? old.scrollTop : 0;
    let html = screens[c.name](c);
    if (S.sheet) html += `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true">${sheets[S.sheet.name](S.sheet)}</div></div>`;
    app.innerHTML = html;
    const scr = app.querySelector('.screen');
    if (key === lastKey) scr.scrollTop = keep; else if (anim) scr.classList.add(anim);
    lastKey = key; anim = '';
    if (c.name === 'waga') bindWeigh();
    if (c.name === 'setup') { const f = app.querySelector('#s-name'); if (f) f.focus(); }
  }
  const busy = () => !!S.sheet || cur().name === 'waga' || cur().name === 'setup' || (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName));

  let toastTimer;
  function toast(msg) {
    const old = app.querySelector('.toast'); if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = msg;
    app.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2400);
  }
  function fail(err) {
    console.error(err);
    toast(navigator.onLine ? 'Nie udało się zapisać. Spróbuj ponownie.' : 'Brak internetu. Zmiana nie została zapisana.');
  }
  function sheetErr(msg) { const e = app.querySelector('#sheet-err'); if (e) { e.textContent = msg; e.hidden = false; } }

  // ---------- Dane z Supabase ----------
  async function load() {
    const [r, w, e, t, v, m] = await Promise.all([
      sb.from('rats').select('*').eq('archived', false).order('created_at'),
      sb.from('weights').select('*').order('date'),
      sb.from('entries').select('*').order('date', { ascending: false }),
      sb.from('treatments').select('*').is('ended_at', null).order('start_date'),
      sb.from('visits').select('*').gte('date', iso(addDays(T(), -30))).order('date'),
      sb.from('members').select('*').order('added_at')
    ]);
    const bad = [r, w, e, t, v, m].find((x) => x.error);
    if (bad) throw bad.error;
    let doses = [];
    const ids = t.data.map((x) => x.id);
    if (ids.length) {
      const dq = await sb.from('doses').select('*').in('treatment_id', ids);
      if (dq.error) throw dq.error;
      doses = dq.data;
    }
    Object.assign(S, { rats: r.data, weights: w.data, entries: e.data, treatments: t.data, visits: v.data, members: m.data, doses });
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
    channel = sb.channel('ogonki')
      .on('postgres_changes', { event: '*', schema: 'public' }, refresh)
      .subscribe();
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
      S.phase = 'app'; S.stack = [{ name: S.rats.length ? 'start' : 'setup' }]; render();
      subscribe();
    } catch (err) {
      console.error(err); S.loadErr = err.message || ''; S.phase = 'error'; render();
    }
  }

  // ---------- Ważenie ----------
  function bindWeigh() {
    app.querySelectorAll('.w-in input').forEach((inp) => {
      inp.addEventListener('input', () => {
        inp.value = inp.value.replace(/[^0-9]/g, '').slice(0, 4);
        const id = inp.dataset.rat, n = parseInt(inp.value, 10), out = document.getElementById('d-' + id), lw = lastW(id);
        if (isNaN(n)) { out.textContent = lw ? 'ostatnio ' + lw + ' g' : 'pierwszy pomiar'; out.style.color = ''; }
        else if (lw) { const dd = n - lw; out.textContent = (dd > 0 ? '+' : dd < 0 ? '−' : '±') + Math.abs(dd) + ' g'; out.style.color = dd / lw <= -0.03 ? 'var(--danger)' : ''; }
        else out.textContent = 'pierwszy pomiar';
        const cnt = [...app.querySelectorAll('.w-in input')].filter((i) => i.value).length;
        document.getElementById('saveW').textContent = cnt ? 'Zapisz (' + cnt + ')' : 'Zapisz';
      });
    });
  }

  // ---------- Nawigacja ----------
  function go(name, id) { S.stack.push({ name, id }); S.confirm = null; S.histAll = false; anim = 'enter'; render(); }
  function back() { if (S.stack.length > 1) S.stack.pop(); S.confirm = null; anim = 'enter-back'; render(); }
  function closeSheet() { S.sheet = null; S.confirm = null; render(); }

  async function toggleDose(t, slot) {
    const date = iso(T());
    const rec = doseRec(t, date, slot);
    if (rec) {
      S.doses = S.doses.filter((x) => x !== rec); render();
      const { error } = await sb.from('doses').delete().eq('id', rec.id);
      if (error) { S.doses.push(rec); render(); fail(error); }
    } else {
      const tmp = { id: 'tmp' + Date.now(), treatment_id: t.id, date, slot, status: 'ok', note: '' };
      S.doses.push(tmp); render();
      const { data, error } = await sb.from('doses').upsert({ treatment_id: t.id, date, slot, status: 'ok', note: '' }, { onConflict: 'treatment_id,date,slot' }).select().single();
      if (error) { S.doses = S.doses.filter((x) => x !== tmp); render(); fail(error); } else Object.assign(tmp, data);
    }
  }

  async function run(fn, okMsg) {
    try {
      await fn();
      await load();
      render();
      if (okMsg) toast(okMsg);
      return true;
    } catch (err) { fail(err); return false; }
  }
  const ok = (res) => { if (res.error) throw res.error; return res.data; };

  // ---------- Zdarzenia ----------
  app.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const a = el.dataset.act;
    if (a === 'scrim') { if (e.target === el) closeSheet(); return; }
    switch (a) {
      case 'go': go(el.dataset.to, el.dataset.id || undefined); break;
      case 'back': back(); if (S.pending) render(); break;
      case 'dose': toggleDose(tr(el.dataset.t), Number(el.dataset.i)); break;
      case 'hist-all': S.histAll = true; render(); break;
      case 'confirm': S.confirm = el.dataset.key; render(); break;
      case 'confirm-cancel': S.confirm = null; render(); break;
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
      case 'setup-done': S.stack = [{ name: 'start' }]; anim = 'enter'; render(); break;
      case 'logout': await sb.auth.signOut(); break;
      case 'sheet': S.confirm = null; S.sheet = { name: el.dataset.sheet, id: el.dataset.id || undefined, n: Number(el.dataset.n) || undefined }; render(); break;
      case 'close': closeSheet(); break;
      case 'seg': {
        app.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
        app.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== el.dataset.v; });
        const err = app.querySelector('#sheet-err'); if (err) err.hidden = true;
        break;
      }
      case 'chip': el.setAttribute('aria-pressed', String(el.getAttribute('aria-pressed') !== 'true')); break;
      case 'swatch': app.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b === el))); break;
      case 'slot': {
        const box = el.closest('[data-slot]');
        box.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
        box.querySelector('.slot-note').hidden = el.dataset.v !== 'bad';
        break;
      }
      case 'remind': {
        const t = tr(el.dataset.t);
        run(async () => ok(await sb.from('treatments').update({ remind_weigh: !t.remind_weigh }).eq('id', t.id)));
        break;
      }
      case 'end-ok': {
        const t = tr(el.dataset.t);
        const done = await run(async () => {
          ok(await sb.from('treatments').update({ ended_at: iso(T()) }).eq('id', t.id));
          ok(await sb.from('entries').insert({ rat_id: t.rat_id, date: iso(T()), kind: 'system', text: 'Koniec kuracji: ' + t.med }));
        });
        if (done) { S.confirm = null; S.stack.pop(); anim = 'enter-back'; render(); toast('Kuracja zakończona'); }
        break;
      }
      case 'del-visit': run(async () => ok(await sb.from('visits').delete().eq('id', el.dataset.id)), 'Usunięto wizytę'); break;
      case 'del-member': {
        const email = el.dataset.email; S.confirm = null;
        run(async () => ok(await sb.from('members').delete().eq('email', email)), 'Usunięto dostęp');
        break;
      }
      case 'archive': {
        const id = el.dataset.id;
        const done = await run(async () => ok(await sb.from('rats').update({ archived: true }).eq('id', id)));
        if (done) { S.sheet = null; S.confirm = null; S.stack = [{ name: 'start' }]; anim = 'enter-back'; render(); }
        break;
      }
      case 'save-weigh': {
        const rows = [];
        app.querySelectorAll('.w-in input').forEach((inp) => {
          const v = parseInt(inp.value, 10);
          if (!isNaN(v) && v >= 10) rows.push({ rat_id: inp.dataset.rat, date: iso(T()), grams: v });
        });
        if (!rows.length) { back(); break; }
        el.disabled = true;
        try {
          ok(await sb.from('weights').upsert(rows, { onConflict: 'rat_id,date' }));
          await load();
          S.stack.pop(); anim = 'enter-back'; render();
          toast(rows.length === 1 ? 'Zapisano 1 wagę' : 'Zapisano ' + rows.length + (rows.length < 5 ? ' wagi' : ' wag'));
        } catch (err) { el.disabled = false; fail(err); }
        break;
      }
      case 'save-entry': saveEntry(el); break;
      case 'save-rat': saveRat(el); break;
      case 'save-day': saveDay(el); break;
    }
  });

  async function saveEntry(el) {
    const ratId = el.dataset.id;
    const mode = app.querySelector('.seg [aria-pressed="true"]').dataset.v;
    const today = iso(T());
    const val = (id) => (app.querySelector('#' + id).value || '').trim();
    let job, msg;
    if (mode === 'objawy') {
      const picked = [...app.querySelectorAll('.chip[aria-pressed="true"]')].map((c) => c.textContent);
      const text = [picked.join(', '), val('e-note')].filter(Boolean).join('. ');
      if (!text) return sheetErr('Zaznacz objaw albo wpisz opis.');
      job = async () => ok(await sb.from('entries').insert({ rat_id: ratId, date: today, kind: 'objawy', text }));
      msg = 'Dodano objawy';
    } else if (mode === 'wizyta') {
      const date = val('v-date') || today, time = val('v-time') || null, text = val('v-text') || 'Wizyta';
      if (date > today) {
        job = async () => ok(await sb.from('visits').insert({ rat_id: ratId, date, time, text }));
        msg = 'Wizyta dodana do „Wkrótce”';
      } else {
        job = async () => ok(await sb.from('entries').insert({ rat_id: ratId, date, kind: 'wizyta', text: 'Wizyta: ' + text }));
        msg = 'Dodano wizytę';
      }
    } else if (mode === 'kuracja') {
      const med = val('k-med'), dose = val('k-dose');
      const times = [val('k-t1'), val('k-t2')].filter(Boolean).sort();
      const start = val('k-start') || today, days = parseInt(val('k-days'), 10);
      if (!med || !dose) return sheetErr('Wpisz nazwę leku i dawkę z recepty.');
      if (!times.length) return sheetErr('Podaj co najmniej jedną godzinę.');
      if (!(days >= 1 && days <= 365)) return sheetErr('Liczba dni musi być od 1 do 365.');
      job = async () => {
        ok(await sb.from('treatments').insert({ rat_id: ratId, med, dose, times: [...new Set(times)], start_date: start, days }));
        ok(await sb.from('entries').insert({ rat_id: ratId, date: start, kind: 'system', text: 'Początek kuracji: ' + med + ', ' + dose }));
      };
      msg = 'Dodano kurację';
    } else {
      const text = val('n-text');
      if (!text) return sheetErr('Wpisz treść notatki.');
      job = async () => ok(await sb.from('entries').insert({ rat_id: ratId, date: today, kind: 'notatka', text }));
      msg = 'Dodano notatkę';
    }
    el.disabled = true;
    S.sheet = null;
    const done = await run(job, msg);
    if (!done) { el.disabled = false; S.sheet = { name: 'entry', id: ratId }; }
  }

  async function saveRat(el) {
    const id = el.dataset.id;
    const name = (app.querySelector('#r-name').value || '').trim();
    if (!name) { sheetErr('Wpisz imię.'); app.querySelector('#r-name').focus(); return; }
    const born = app.querySelector('#r-born').value;
    const row = {
      name,
      born: born ? born + '-01' : null,
      coat: app.querySelector('.swatch[aria-pressed="true"]').dataset.c,
      look: (app.querySelector('#r-look').value || '').trim()
    };
    el.disabled = true;
    const sheet = S.sheet; S.sheet = null;
    const done = await run(async () => ok(id ? await sb.from('rats').update(row).eq('id', id) : await sb.from('rats').insert(row)), id ? 'Zapisano' : 'Dodano: ' + name);
    if (!done) { S.sheet = sheet; el.disabled = false; }
  }

  async function saveDay(el) {
    const t = tr(el.dataset.id), n = Number(el.dataset.n), date = slotDate(t, n);
    const ups = [], dels = [];
    app.querySelectorAll('[data-slot]').forEach((box) => {
      const slot = Number(box.dataset.slot);
      const v = box.querySelector('.chip[aria-pressed="true"]').dataset.v;
      const note = (box.querySelector('.slot-note').value || '').trim();
      if (v === 'none') { const rec = doseRec(t, date, slot); if (rec) dels.push(rec.id); }
      else ups.push({ treatment_id: t.id, date, slot, status: v, note: v === 'bad' ? note : '' });
    });
    el.disabled = true;
    S.sheet = null;
    await run(async () => {
      if (ups.length) ok(await sb.from('doses').upsert(ups, { onConflict: 'treatment_id,date,slot' }));
      if (dels.length) ok(await sb.from('doses').delete().in('id', dels));
    }, 'Zapisano');
  }

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
    }
  });

  app.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.sheet) closeSheet(); });

  // ---------- Online / offline i powrót do aplikacji ----------
  const offBar = document.createElement('div');
  offBar.className = 'offline'; offBar.textContent = 'Brak internetu. Zmiany nie zostaną zapisane.';
  offBar.hidden = navigator.onLine;
  document.body.appendChild(offBar);
  window.addEventListener('online', () => { offBar.hidden = true; if (S.phase === 'app') refresh(); });
  window.addEventListener('offline', () => { offBar.hidden = false; });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.phase === 'app') refresh(); });

  // ---------- Start ----------
  if (!sb) { S.phase = 'config'; render(); return; }
  render();
  let started = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') { started = true; setTimeout(() => enter(session), 0); }
  });
  setTimeout(() => { if (!started) sb.auth.getSession().then(({ data }) => enter(data.session)); }, 1500);
})();
