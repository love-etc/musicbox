/* Page rendering. Data comes from data.js (window.MUSICBOX), maths from charts.js.
   Views (all in the URL hash, so every page has a shareable link):
     #/2023-07/songs            a monthly chart
     #/2023/year-end/albums     a year-end chart        #/2023/replay/artists  Apple's Replay list
     #/all-time/songs           the all-time chart
     #/library/albums           everything that ever charted, ranked by listening totals
     #/album/<key>  #/artist/<key>  #/song/<key>        detail pages */
(function () {
  const DB = window.MUSICBOX;
  const C = window.Charts;
  const X = C.build(DB);
  const { M, years, allYears } = X;
  const CATS = C.CATS;
  const TYPE = { songs: 'song', albums: 'album', artists: 'artist' };
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const CATNAME = { songs: 'Songs', albums: 'Albums', artists: 'Artists' };
  const ONE = { songs: 'song', albums: 'album', artists: 'artist' };
  const UNIT = { songs: 'plays', albums: 'min', artists: 'min' };
  const UNIT_LONG = { songs: 'plays', albums: 'minutes', artists: 'minutes' };
  const SRC = { apple: 'Apple Music Replay', lastfm: 'Last.fm' };
  const LAST = M[M.length - 1], FIRST = M[0];
  // With Apple-style year-end charts the separate Replay tab would be a duplicate, so it only shows in 'points' mode
  const SHOW_REPLAY = C.YEAR_END_METHOD !== 'totals';
  const hasReplay = y => SHOW_REPLAY && !!X.replay[y];

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => Number(n).toLocaleString('en-US');
  const monthLabel = m => `${MONTHS[m.mon]} ${m.year}`;
  const shortLabel = m => `${MON[m.mon]} ${m.year}`;
  const byMonth = new Map(M.map(m => [m.month, m]));
  const ym = (y, mo) => `${y}-${String(mo + 1).padStart(2, '0')}`;
  const isPartial = y => M.filter(m => m.year === y).length < 12;
  const $ = id => document.getElementById(id);

  // ---- Links to detail pages ----
  const enc = k => encodeURIComponent(k);
  const pageHref = (cat, key) => `#/${TYPE[cat]}/${enc(key)}`;
  const artistHref = name => `#/artist/${enc(C.norm(name))}`;
  const artistLinks = (artist, title) => {
    // Link each credited name that has a page; keep the original wording
    let html = esc(artist);
    X.splitCredits(artist).forEach(n => {
      if (!X.artists.has(C.norm(n))) return;
      html = html.replace(esc(n), `<a class="lnk" href="${artistHref(n)}">${esc(n)}</a>`);
    });
    return html;
  };

  // ---- Images: data/images.json rows of [type, title, artist, url] ----
  const IMG = new Map();
  (DB.images || []).forEach(([type, title, artist, url]) => {
    if (url) IMG.set(type + '|' + C.norm(title) + (type === 'artist' ? '' : '|' + C.norm(artist)), url);
  });
  const imgFor = (cat, key) => {
    const u = IMG.get(TYPE[cat] + '|' + key);
    if (u || cat !== 'songs') return u || '';
    const s = X.H.songs.get(key);                       // songs fall back to their album's cover
    return s && s.album ? IMG.get('album|' + s.album.key) || '' : '';
  };

  // ---- State (mirrored in the URL hash) ----
  // view: month "2023-07" | "year-end" | "replay" | "all-time" | "library" | "album" | "artist" | "song"
  let state = { year: LAST.year, view: LAST.month, cat: 'songs', key: null };
  const open = new Set();
  const panelYear = new Map();
  let libFilter = '';

  function readHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (!parts.length) return;
    const [a, b, c] = parts;
    if (a === 'library') { state = { ...state, view: 'library', cat: CATS.includes(b) ? b : 'albums', key: null }; return; }
    if (a === 'album' || a === 'artist' || a === 'song') { state = { ...state, view: a, key: parts.slice(1).join('/') }; return; }
    if (a === 'all-time') { state = { year: 'all', view: 'all-time', cat: CATS.includes(b) ? b : state.cat, key: null }; return; }
    if (/^\d{4}-\d{2}$/.test(a) && byMonth.has(a)) { state = { year: +a.slice(0, 4), view: a, cat: CATS.includes(b) ? b : state.cat, key: null }; return; }
    if (/^\d{4}$/.test(a) && allYears.includes(+a)) {
      const y = +a;
      const view = b === 'replay' && hasReplay(y) ? 'replay' : (b === 'year-end' || b === 'replay') && X.yearEnd[y] ? 'year-end' : defaultView(y);
      state = { year: y, view, cat: CATS.includes(c) ? c : state.cat, key: null };
    }
  }
  function hashFor(s) {
    if (s.view === 'library') return `#/library/${s.cat}`;
    if (s.view === 'album' || s.view === 'artist' || s.view === 'song') return `#/${s.view}/${enc(s.key)}`;
    if (s.view === 'all-time') return `#/all-time/${s.cat}`;
    if (/^\d{4}-\d{2}$/.test(s.view)) return `#/${s.view}/${s.cat}`;
    return `#/${s.year}/${s.view}/${s.cat}`;
  }
  function go(next, push = true) {
    state = { ...state, ...next };
    const h = hashFor(state);
    if (location.hash !== h) { push ? history.pushState(null, '', h) : history.replaceState(null, '', h); }
    render();
    if (!isChartView()) window.scrollTo(0, 0);
  }
  function defaultView(y) {
    const ms = M.filter(m => m.year === y);
    if (ms.length) return ms[ms.length - 1].month;
    return hasReplay(y) ? 'replay' : 'year-end';
  }
  const isChartView = () => !['library', 'album', 'artist', 'song'].includes(state.view);

  // ---- Bits ----
  function tile(seed, letterSrc, round, url, cls = '') {
    let h = 0; for (const ch of seed) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    const hue = 212 + (h % 26), light = 22 + ((h >> 5) % 30), sat = 55 + ((h >> 9) % 30);
    const letter = (String(letterSrc).match(/\p{L}|\p{N}/u) || ['?'])[0].toUpperCase();
    const img = url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
    return `<div class="art${round ? ' round' : ''}${cls ? ' ' + cls : ''}" style="background:hsl(${hue} ${sat}% ${light}%)" aria-hidden="true">${esc(letter)}${img}</div>`;
  }
  const tileFor = (cat, h, cls) => tile(cat === 'artists' ? h.title : h.artist, h.title, cat === 'artists', imgFor(cat, h.key), cls);
  function moveCell(mv) {
    switch (mv && mv.kind) {
      case 'up': return `<span class="up" aria-label="up ${mv.n}"><i class="tri u"></i>${mv.n}</span>`;
      case 'down': return `<span class="down" aria-label="down ${mv.n}"><i class="tri d"></i>${mv.n}</span>`;
      case 'same': return `<span class="same" aria-label="no change">=</span>`;
      case 'new': return `<span class="new">NEW</span>`;
      case 're': return `<span class="re">RE</span>`;
      case 'first': return `<span class="first" aria-label="first chart">–</span>`;
      default: return '';
    }
  }
  // A No. 1 peak gets highlighted wherever a peak is shown
  const pk = v => v === 1 ? '<span class="pk1">1</span>' : v;
  const pkNo = v => v === 1 ? '<span class="pk1">No. 1</span>' : `No. ${v}`;
  const rankColor = r => { const t = (r - 1) / (C.CHART_SIZE - 1); return `hsl(${224 - t * 8} ${80 - t * 25}% ${30 + t * 32}%)`; };

  // ---- Chart history (used in drop-downs and on detail pages) ----
  function lineChart(h) {
    const a = h.first, b = Math.max(h.last, a), n = b - a, Hh = 110;
    const xp = i => (n === 0 ? 50 : (i - a) / n * 100);
    const y = r => 6 + (Hh - 12) * (r - 1) / (C.CHART_SIZE - 1);
    const grid = [1, 5, 10, 15].map(r => `<div class="gl" style="top:${y(r)}px"><span>${r}</span></div>`).join('');
    const tk = [];
    for (let i = a; i <= b; i++) if (i === a || M[i].year !== M[i - 1].year) tk.push(i);
    // drop the start label when the next year line sits right next to it
    const ticks = tk.map((i, j) => `<div class="yt" style="left:${xp(i)}%"><span>${i === a ? (tk[1] !== undefined && xp(tk[1]) < 18 ? '' : shortLabel(M[i])) : M[i].year}</span></div>`);
    let segs = [], seg = [];
    for (let i = a; i <= b; i++) { const p = h.ranks[i]; if (p) seg.push([xp(i), y(p.rank)]); else { if (seg.length) segs.push(seg); seg = []; } }
    if (seg.length) segs.push(seg);
    const lines = segs.filter(s => s.length > 1).map(s => `<polyline points="${s.map(p => p.join(',')).join(' ')}" fill="none" stroke="#1543d6" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join('');
    let dots = '';
    for (let i = a; i <= b; i++) { const p = h.ranks[i]; if (p) dots += `<i class="dot${p.rank === 1 ? ' one' : ''}" style="left:${xp(i)}%;top:${y(p.rank)}px" title="${esc(shortLabel(M[i]))}: No. ${p.rank}"></i>`; }
    return `<div class="lc" role="img" aria-label="Chart position by month">${grid}<div class="plot">${ticks.join('')}<svg viewBox="0 0 100 ${Hh}" preserveAspectRatio="none">${lines}</svg>${dots}</div></div>`;
  }
  function yearCells(h, y) {
    let cells = '';
    for (let mo = 0; mo < 12; mo++) {
      const m = byMonth.get(ym(y, mo)), p = m && h.ranks[m.i];
      const star = m && m.source === 'lastfm' ? '*' : '';
      cells += `<div class="cell"><div class="m">${MON[mo]}${star}</div>` +
        (p ? `<div class="b on" style="background:${rankColor(p.rank)}">${p.rank}</div><div class="u">${fmt(p.val)} ${UNIT[h.cat]}</div>`
           : `<div class="b${m ? '' : ' gap'}"${m ? '' : ' title="No chart this month"'}>${m ? '–' : ''}</div><div class="u"></div>`) + `</div>`;
    }
    return `<div class="hist" style="--n:12">${cells}</div>`;
  }
  function historyBlock(h, id) {
    const chartedYears = [...new Set(h.ranks.map((p, i) => p ? M[i].year : null).filter(Boolean))];
    const ctxYear = typeof state.year === 'number' && isChartView() ? state.year : null;
    let selYear = panelYear.get(id);
    if (!chartedYears.includes(selYear)) selYear = chartedYears.includes(ctxYear) ? ctxYear : chartedYears[chartedYears.length - 1];
    return `${chartedYears.length > 1 ? `<div class="yrs" role="group" aria-label="Year">${chartedYears.map(y => `<button type="button" data-y="${y}" aria-pressed="${y === selYear}">${y}</button>`).join('')}</div>` : ''}
      ${yearCells(h, selYear)}
      ${lineChart(h)}`;
  }
  function chartFacts(h) {
    let best = -1, lfm = false;
    h.ranks.forEach((p, i) => { if (!p) return; if (M[i].source === 'lastfm') lfm = true; if (best < 0 || p.val > h.ranks[best].val) best = i; });
    return { best, lfm, atPeak: h.ranks.filter(p => p && p.rank === h.peak).length };
  }
  function panel(cat, h, id) {
    const unit = UNIT[cat];
    const { best, lfm, atPeak } = chartFacts(h);
    const ctxYear = typeof state.year === 'number' && isChartView() ? state.year : null;
    const yeRow = ctxYear && X.yearEndAll[ctxYear] ? X.yearEndAll[ctxYear][cat].get(h.key) : null;
    const ongoing = ctxYear === LAST.year && isPartial(ctxYear);
    const fourth = yeRow
      ? `<div class="k">${ongoing ? ctxYear + ' so far' : ctxYear + ' year-end'}</div><div class="v">No. ${yeRow.rank}</div><div class="n">${C.YEAR_END_METHOD === 'totals' ? fmt(yeRow.value) + ' ' + unit : yeRow.points + ' points'}</div>`
      : `<div class="k">Library</div><div class="v">No. ${h.libRank}</div><div class="n">of everything that charted</div>`;
    const links = [`<a class="go" href="${pageHref(cat, h.key)}">Open ${ONE[cat]} page →</a>`];
    if (h.album) links.push(`<a class="go" href="${pageHref('albums', h.album.key)}">From ${esc(h.album.title)} →</a>`);
    return `<div class="grid4">
        <div class="stat"><div class="k">Total</div><div class="v">${fmt(h.total || 0)}<small>${unit}</small></div><div class="n">known listening</div></div>
        <div class="stat"><div class="k">Best month</div><div class="v">${fmt(h.ranks[best].val)}<small>${unit}</small></div><div class="n">${shortLabel(M[best])}, at No. ${h.ranks[best].rank}</div></div>
        <div class="stat"><div class="k">Peak</div><div class="v">${pkNo(h.peak)}</div><div class="n">${atPeak} month${atPeak === 1 ? '' : 's'} at peak · ${h.months} on chart</div></div>
        <div class="stat">${fourth}</div>
      </div>
      <h4>Chart history</h4>
      ${historyBlock(h, id)}
      <div class="foot">${debutText(h)}${lfm ? ' * Last.fm month: plays are scrobbles and minutes come from track lengths.' : ''}</div>
      <div class="golinks">${links.join('')}</div>`;
  }
  const debutText = h => `Debuted at No. ${h.ranks[h.first].rank} in ${monthLabel(M[h.first])}${h.last !== h.first ? `; last charted in ${monthLabel(M[h.last])} at No. ${h.ranks[h.last].rank}` : ''}.`;

  // ---- Expandable rows ----
  const panelData = new Map();
  function bindRows(root) {
    root.querySelectorAll('.row[role="button"]').forEach(row => {
      const toggle = ev => {
        if (ev && ev.target.closest('a')) return;           // links inside rows navigate instead
        const p = row.nextElementSibling, on = row.getAttribute('aria-expanded') !== 'true';
        row.setAttribute('aria-expanded', on); p.hidden = !on;
        on ? open.add(row.dataset.id) : open.delete(row.dataset.id);
        if (on && !p.dataset.filled) fillPanel(p);
      };
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', ev => { if (ev.target === row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); toggle(); } });
    });
    root.querySelectorAll('.panel:not([hidden])').forEach(fillPanel);
  }
  function fillPanel(p) {
    const { cat, h, id } = panelData.get(p.dataset.id);
    p.innerHTML = panel(cat, h, id);
    p.dataset.filled = '1';
    bindYears(p, id, () => fillPanel(p));
  }
  function bindYears(root, id, redraw) {
    root.querySelectorAll('.yrs button').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation(); panelYear.set(id, +b.dataset.y); redraw();
    }));
  }
  function rowHtml({ cat, id, rank, mvHtml, e, h, flag, inline, c1, c2, c3, val, unit, plain }) {
    const isArtist = cat === 'artists', expandable = !!h;
    const isOpen = expandable && open.has(id);
    if (expandable) panelData.set(id, { cat, h, id });
    const title = expandable ? `<a class="lnk" href="${pageHref(cat, h.key)}">${esc(e.title)}</a>` : esc(e.title);
    return `
      <div class="row${rank === 1 && !plain ? ' top' : ''}${expandable ? '' : ' static'}"${expandable ? ` role="button" tabindex="0" aria-expanded="${isOpen}"` : ''} data-id="${esc(id)}">
        <div class="rank">${rank}</div>
        <div class="mv">${mvHtml}</div>
        ${tile(isArtist ? e.title : e.artist, e.title, isArtist, imgFor(cat, e.key))}
        <div class="name">
          ${flag ? `<span class="flag">${flag}</span>` : ''}
          <div class="t">${title}</div>
          ${e.artist ? `<div class="a">${artistLinks(e.artist)}</div>` : ''}
          <div class="inline">${inline}</div>
        </div>
        <div class="num">${c1}</div>
        <div class="num">${c2}</div>
        <div class="num">${c3}</div>
        <div class="val">${val}<small>${esc(unit)}</small></div>
        <div class="chev">${expandable ? '<i></i>' : ''}</div>
      </div>
      ${expandable ? `<div class="panel" data-id="${esc(id)}"${isOpen ? '' : ' hidden'}></div>` : ''}`;
  }
  const cols = (cat, a, b, c, d, mv = 'Move') =>
    `<div class="cols"><div class="c">Rank</div><div class="c">${mv}</div><div></div><div>${cat === 'artists' ? 'Artist' : 'Title / Artist'}</div><div class="c">${a}</div><div class="c">${b}</div><div class="c">${c}</div><div class="r">${d}</div><div></div></div>`;
  const setHead = (eyebrow, title, meta) => {
    $('eyebrow').textContent = eyebrow;
    $('title').textContent = title;
    $('meta').innerHTML = meta;
  };

  // ---- Chart views ----
  function renderMonth(m) {
    const cat = state.cat, list = m.data[cat], unit = UNIT[cat];
    const prev = m.i > 0 ? M[m.i - 1] : null;
    const total = m.total ? `<b>${fmt(m.total.value)} ${m.total.unit === 'min' ? 'minutes' : esc(m.total.unit)}</b><br>` : '';
    const gap = m.gapBefore ? `<br>Moves compare with ${esc(shortLabel(prev))}` : '';
    setHead(`${monthLabel(m)} · Top ${C.CHART_SIZE}`, CATNAME[cat], `${total}${SRC[m.source] || esc(m.source)}${gap}`);
    const rows = list.map(e => rowHtml({
      cat, id: `${m.month}|${cat}|${e.key}`, rank: e.rank, mvHtml: moveCell(e.mv), e, h: e.h,
      flag: e.rank === 1 ? `No. 1 ${ONE[cat]} of ${monthLabel(m)}${e.no1 > 1 ? ` · ${e.no1} months at No. 1` : ''}` : '',
      inline: `LM ${e.lw || '–'} · PEAK ${pk(e.peak)} · ${e.months} MO${e.months === 1 ? '' : 'S'}`,
      c1: e.lw || '–', c2: pk(e.peak), c3: e.months, val: fmt(e.val), unit
    })).join('');
    return cols(cat, 'LM', 'Peak', 'MOs', unit) + rows;
  }
  function renderTally(list, idPrefix, flagText, method) {
    const cat = state.cat, totals = method === 'totals';
    const rows = list.map(e => rowHtml({
      cat, id: `${idPrefix}|${cat}|${e.key}`, rank: e.rank, mvHtml: '', e, h: e.h,
      flag: e.rank === 1 ? flagText : '',
      inline: e.months ? `PEAK ${pk(e.peak)} · ${e.months} MO${e.months === 1 ? '' : 'S'}${e.no1 ? ` · ${e.no1}× NO. 1` : ''}` : 'DIDN’T MAKE THE MONTHLY TOP ' + C.CHART_SIZE,
      c1: e.no1 || '–', c2: e.months ? pk(e.peak) : '–', c3: e.months || '–',
      val: totals ? fmt(e.value) : e.points, unit: totals ? UNIT[cat] : 'pts'
    })).join('');
    return cols(cat, 'No. 1s', 'Peak', 'MOs', totals ? UNIT[cat] : 'Points', '') + rows;
  }
  function renderYearEnd(y) {
    const ms = M.filter(m => m.year === y), cat = state.cat, totals = C.YEAR_END_METHOD === 'totals';
    const span = ms.length ? `${MONTHS[ms[0].mon]}–${MONTHS[ms[ms.length - 1].mon]} ${y}` : `${y}`;
    const ongoing = y === LAST.year && isPartial(y);
    setHead(`${ongoing ? 'Year to date' : 'Year-end'} · ${span} · Top ${C.YEAR_END_SIZE}`,
      `${ongoing ? '' : y + ' '}Year-End ${CATNAME[cat]}`,
      totals ? `<b>Most ${cat === 'songs' ? 'plays' : 'minutes'}</b><br>${X.replay[y] ? 'Apple’s Replay totals + Last.fm months' : 'Monthly Replay lists' + (M.some(m => m.year === y && m.source === 'lastfm') ? ' + Last.fm' : '')}`
             : `<b>${isPartial(y) ? `${ms.length} of 12 months` : 'Full year'}</b><br>Points from the monthly charts`);
    return renderTally(X.yearEnd[y][cat], `ye${y}`, `No. 1 ${ONE[cat]} of ${y}${ongoing ? ' so far' : ''}`, C.YEAR_END_METHOD);
  }
  function renderAllTime() {
    const cat = state.cat, totals = C.ALL_TIME_METHOD === 'totals';
    setHead(`All-time · ${shortLabel(FIRST)} – ${shortLabel(LAST)} · Top ${C.ALL_TIME_SIZE}`, `All-Time ${CATNAME[cat]}`,
      totals ? `<b>Most ${cat === 'songs' ? 'plays' : 'minutes'}</b><br>Every month + Apple’s year totals` : `<b>${M.length} monthly charts</b><br>Points from the monthly charts`);
    return renderTally(X.allTime[cat], 'all', `No. 1 ${ONE[cat]} of all time`, C.ALL_TIME_METHOD);
  }
  function renderReplay(y) {
    const cat = state.cat, list = X.replay[y][cat], unit = UNIT[cat];
    const ye = X.yearEndAll[y] ? X.yearEndAll[y][cat] : new Map();
    setHead(`Apple Music Replay ${y} · full-year totals`, `Replay ${y}: Top ${CATNAME[cat]}`,
      `<b>Apple’s own year list</b><br>Ranked by ${cat === 'songs' ? 'plays' : 'minutes'} over the whole year`);
    if (!list.length) return `<p class="empty">No ${CATNAME[cat].toLowerCase()} list saved for Replay ${y}.</p>`;
    const rows = list.map(e => {
      const yr = ye.get(e.key);
      return rowHtml({
        cat, id: `rp${y}|${cat}|${e.key}`, rank: e.rank, mvHtml: '', e, h: e.h,
        flag: e.rank === 1 ? `Apple’s No. 1 ${ONE[cat]} of ${y}` : '',
        inline: yr && yr.months ? `CHART PEAK ${pk(yr.peak)} · ${yr.months} MO${yr.months === 1 ? '' : 'S'}` : 'DIDN’T MAKE THE MONTHLY TOP ' + C.CHART_SIZE,
        c1: yr && yr.months ? pk(yr.peak) : '–', c2: yr && yr.months ? yr.months : '–', c3: yr && yr.no1 ? yr.no1 : '–', val: fmt(e.val), unit
      });
    }).join('');
    return cols(cat, 'Peak', 'MOs', 'No. 1s', unit, '') + rows;
  }

  // ---- Library ----
  const cardHtml = (cat, h, rank) => {
    const sub = cat === 'artists' ? '' : `<div class="ca">${esc(h.artist)}</div>`;
    return `<a class="card${cat === 'artists' ? ' round' : ''}" href="${pageHref(cat, h.key)}" data-q="${esc((h.title + ' ' + (h.artist || '')).toLowerCase())}">
      <div class="cv">${tileFor(cat, h)}${rank ? `<span class="badge">${rank}</span>` : ''}</div>
      <div class="ct">${esc(h.title)}</div>${sub}
      <div class="cm">${fmt(h.total || 0)} ${UNIT[cat]} · peak ${pk(h.peak)}</div></a>`;
  };
  const songRows = (list, prefix) => list.map((h, i) => rowHtml({
    cat: 'songs', id: `${prefix}|songs|${h.key}`, rank: i + 1, mvHtml: '', e: h, h, flag: '',
    inline: `PEAK ${pk(h.peak)} · ${h.months} MO${h.months === 1 ? '' : 'S'}${h.no1 ? ` · ${h.no1}× NO. 1` : ''}`,
    c1: pk(h.peak), c2: h.months, c3: h.no1 || '–', val: fmt(h.total || 0), unit: 'plays', plain: prefix !== 'lib'
  })).join('');

  // Song lists can be re-sorted by clicking a column (or a chip on phones)
  const SORTS = {
    peak:   { label: 'Peak',   first: 1,  get: h => h.peak },
    months: { label: 'MOs',    first: -1, get: h => h.months },
    no1:    { label: 'No. 1s', first: -1, get: h => h.no1 || 0 },
    total:  { label: 'Plays',  first: -1, get: h => h.total || 0 }
  };
  const LISTS = new Map();
  function sortList(L) {
    const { get } = SORTS[L.key];
    return L.list.slice().sort((a, b) => L.dir * (get(a) - get(b)) || (b.total || 0) - (a.total || 0) || a.peak - b.peak || a.title.localeCompare(b.title));
  }
  function songListInner(id) {
    const L = LISTS.get(id);
    const th = k => {
      const on = L.key === k;
      return `<button type="button" class="sort${on ? ' on' : ''}" data-k="${k}" aria-sort="${on ? (L.dir === 1 ? 'ascending' : 'descending') : 'none'}">${k === 'total' ? 'plays' : SORTS[k].label}<i>${on ? (L.dir === 1 ? '▲' : '▼') : ''}</i></button>`;
    };
    const chips = `<div class="sortchips" role="group" aria-label="Sort songs">Sort by ${Object.keys(SORTS).map(k => `<button type="button" data-k="${k}" aria-pressed="${L.key === k}">${SORTS[k].label}${L.key === k ? (L.dir === 1 ? ' ▲' : ' ▼') : ''}</button>`).join('')}</div>`;
    const head = `<div class="cols"><div class="c">#</div><div></div><div></div><div>Title / Artist</div><div class="c">${th('peak')}</div><div class="c">${th('months')}</div><div class="c">${th('no1')}</div><div class="r">${th('total')}</div><div></div></div>`;
    return chips + head + songRows(sortList(L), L.prefix);
  }
  function songList(list, prefix) {
    const id = 'sl' + LISTS.size;
    LISTS.set(id, { list, prefix, key: 'total', dir: -1 });
    return `<div class="songlist" data-list="${id}">${songListInner(id)}</div>`;
  }
  function bindSongLists(root) {
    root.querySelectorAll('.songlist[data-list]').forEach(el => {
      el.addEventListener('click', ev => {
        const b = ev.target.closest('button[data-k]');
        if (!b) return;
        const L = LISTS.get(el.dataset.list), k = b.dataset.k;
        L.dir = L.key === k ? -L.dir : SORTS[k].first;
        L.key = k;
        el.innerHTML = songListInner(el.dataset.list);
        bindRows(el);
        if (state.view === 'library') applyFilter();
      });
    });
  }

  function renderLibrary() {
    const cat = state.cat, list = X.library[cat];
    const body = cat === 'songs'
      ? songList(list, 'lib')
      : `<div class="cards">${list.map((h, i) => cardHtml(cat, h, i + 1)).join('')}</div>`;
    return `<div class="head"><div><div class="eyebrow">Library · ${fmt(list.length)} ${CATNAME[cat].toLowerCase()} that made the monthly top ${C.CHART_SIZE}</div><h2>${CATNAME[cat]}</h2></div>
        <div class="meta"><b>Ranked by ${UNIT_LONG[cat]}</b><br>Every month + Apple’s year totals</div></div>
      <div class="filter"><input id="q" type="search" placeholder="Filter ${CATNAME[cat].toLowerCase()}…" value="${esc(libFilter)}" aria-label="Filter"></div>
      ${body}`;
  }
  function applyFilter() {
    const q = libFilter.trim().toLowerCase();
    document.querySelectorAll('#page .card').forEach(c => { c.hidden = q && !c.dataset.q.includes(q); });
    document.querySelectorAll('#page .songlist .row').forEach(r => {
      const h = panelData.get(r.dataset.id); if (!h) return;
      const hit = !q || (h.h.title + ' ' + h.h.artist).toLowerCase().includes(q);
      r.hidden = !hit; if (!hit) r.nextElementSibling.hidden = true;
    });
  }

  // ---- Detail pages ----
  function byYearText(h, cat) {
    const ys = Object.keys(h.byYear || {}).sort();
    if (!ys.length) return '';
    return `<div class="byyear">${ys.map(y => `<span><b>${y}</b> ${fmt(h.byYear[y])} ${UNIT[cat]}</span>`).join('')}</div>`;
  }
  function factBox(k, v, n) { return `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="n">${n}</div></div>`; }
  function heroFacts(cat, h) {
    const { atPeak } = chartFacts(h);
    return `<div class="facts">
      ${factBox('Total', `${fmt(h.total || 0)}<small>${UNIT[cat]}</small>`, 'known listening')}
      ${factBox('Peak', pkNo(h.peak), `${atPeak} month${atPeak === 1 ? '' : 's'} at peak`)}
      ${factBox('Months on chart', h.months, h.no1 ? `${h.no1} at No. 1` : 'never No. 1')}
      ${factBox('Debut', shortLabel(M[h.first]), `at No. ${h.ranks[h.first].rank}`)}
      ${factBox('Library', `No. ${h.libRank}`, `of ${X.library[cat].length} ${CATNAME[cat].toLowerCase()}`)}
    </div>`;
  }
  function hero(cat, h, kicker, byline) {
    return `<div class="hero">
      ${tileFor(cat, h, 'big')}
      <div class="info">
        <div class="eyebrow">${kicker}</div>
        <h2>${esc(h.title)}</h2>
        ${byline ? `<div class="by">${byline}</div>` : ''}
        ${heroFacts(cat, h)}
        ${byYearText(h, cat)}
      </div></div>`;
  }
  const histSection = (h, id) => `<h3 class="sec">Chart history</h3><div class="detail-hist" data-hid="${esc(id)}">${historyBlock(h, id)}<div class="foot">${debutText(h)}</div></div>`;
  function bindHist(root) {
    root.querySelectorAll('.detail-hist').forEach(d => {
      const id = d.dataset.hid, h = histData.get(id);
      const redraw = () => { d.innerHTML = historyBlock(h, id) + `<div class="foot">${debutText(h)}</div>`; bindYears(d, id, redraw); };
      bindYears(d, id, redraw);
    });
  }
  const histData = new Map();

  function renderAlbum(key) {
    const h = X.H.albums.get(key);
    if (!h) return notFound('album');
    histData.set('alb|' + key, h);
    const songs = h.songs || [];
    const more = X.splitCredits(h.artist).flatMap(n => (X.artists.get(C.norm(n)) || { albums: [] }).albums).filter((a, i, arr) => a !== h && arr.indexOf(a) === i);
    document.title = `${h.title} – ${h.artist} · ${SITE}`;
    return hero('albums', h, `Album`, artistLinks(h.artist))
      + histSection(h, 'alb|' + key)
      + `<h3 class="sec">Charted songs</h3>`
      + (songs.length ? songList(songs, 'alb' + key)
                      : `<p class="hint">No songs from this album made the monthly top ${C.CHART_SIZE} (or they’re not matched yet: see data/tracks.json).</p>`)
      + (more.length ? `<h3 class="sec">More by ${esc(h.artist)}</h3><div class="cards">${more.map(a => cardHtml('albums', a)).join('')}</div>` : '');
  }
  function renderArtist(key) {
    const a = X.artists.get(key);
    if (!a) return notFound('artist');
    document.title = `${a.name} · ${SITE}`;
    const h = a.h;
    let html;
    if (h) {
      histData.set('art|' + key, h);
      html = hero('artists', h, 'Artist', '') + histSection(h, 'art|' + key);
    } else {
      const fake = { title: a.name, key, artist: '' };
      html = `<div class="hero">${tileFor('artists', fake, 'big')}<div class="info"><div class="eyebrow">Artist</div><h2>${esc(a.name)}</h2>
        <p class="hint">Never made the monthly artists top ${C.CHART_SIZE}, but shows up on the songs or albums charts.</p></div></div>`;
    }
    if (a.albums.length) html += `<h3 class="sec">Albums</h3><div class="cards">${a.albums.map(x => cardHtml('albums', x)).join('')}</div>`;
    if (a.songs.length) html += `<h3 class="sec">Songs</h3>${songList(a.songs, 'art' + key)}`;
    return html;
  }
  function renderSong(key) {
    const h = X.H.songs.get(key);
    if (!h) return notFound('song');
    histData.set('song|' + key, h);
    document.title = `${h.title} – ${h.artist} · ${SITE}`;
    const by = artistLinks(h.artist) + (h.album ? ` · from <a class="lnk" href="${pageHref('albums', h.album.key)}">${esc(h.album.title)}</a>` : '');
    let html = hero('songs', h, 'Song', by) + histSection(h, 'song|' + key);
    if (h.album) {
      const others = (h.album.songs || []).filter(s => s !== h);
      if (others.length) html += `<h3 class="sec">Also from ${esc(h.album.title)}</h3>${songList(others, 'sng' + key)}`;
    }
    return html;
  }
  const notFound = what => `<p class="empty">That ${what} isn’t in the charts. <a class="lnk" href="#/library/${what}s">Back to the library</a></p>`;

  // ---- Chrome: nav, year select, bar, category tabs ----
  const SITE = document.title;
  let lastChartHash = '#/';
  function renderTopNav() {
    const lib = !isChartView();
    if (!lib) lastChartHash = hashFor(state);
    $('topnav').innerHTML = `<a href="${lastChartHash}"${lib ? '' : ' aria-current="page"'}>Charts</a><a href="#/library/albums"${lib ? ' aria-current="page"' : ''}>Library</a>`;
    $('yearwrap').hidden = lib;
  }
  function renderYearSelect() {
    $('year').innerHTML = allYears.slice().reverse().map(y => `<option value="${y}"${y === state.year ? ' selected' : ''}>${y}</option>`).join('')
      + `<option value="all"${state.year === 'all' ? ' selected' : ''}>All time</option>`;
  }
  function renderBar() {
    const el = $('months');
    let html = '';
    if (!isChartView()) {
      html = ['albums', 'artists', 'songs'].map(c => `<button type="button" data-lib="${c}" aria-pressed="${state.view === 'library' && state.cat === c}">${CATNAME[c]}</button>`).join('');
      if (state.view !== 'library') html = `<button type="button" data-back="1">← Back</button><span class="sep"></span>` + html;
    } else if (state.year === 'all') {
      html = `<button type="button" class="ye" data-v="all-time" aria-pressed="true">All-time top ${C.ALL_TIME_SIZE}</button>`;
    } else {
      const y = state.year;
      for (let mo = 0; mo < 12; mo++) {
        const m = byMonth.get(ym(y, mo));
        html += m ? `<button type="button" data-v="${m.month}" aria-pressed="${state.view === m.month}">${MON[mo]}${m.source === 'lastfm' ? '<span class="tag">LFM</span>' : ''}</button>`
                  : `<button type="button" disabled title="No chart for ${MONTHS[mo]} ${y}">${MON[mo]}</button>`;
      }
      html += `<span class="push"></span>`;
      if (X.yearEnd[y]) html += `<button type="button" class="ye" data-v="year-end" aria-pressed="${state.view === 'year-end'}">${y === LAST.year && isPartial(y) ? 'Year to date' : 'Year-end'}</button>`;
      if (hasReplay(y)) html += `<button type="button" class="ye" data-v="replay" aria-pressed="${state.view === 'replay'}">Replay ${y}</button>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('button[data-v]').forEach(b => b.addEventListener('click', () => go({ view: b.dataset.v })));
    el.querySelectorAll('button[data-lib]').forEach(b => b.addEventListener('click', () => go({ view: 'library', cat: b.dataset.lib, key: null })));
    el.querySelectorAll('button[data-back]').forEach(b => b.addEventListener('click', () => history.length > 1 ? history.back() : go({ view: 'library', cat: 'albums' })));
    const on = el.querySelector('[aria-pressed="true"]');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function renderCats() {
    const el = $('cats');
    el.innerHTML = CATS.map(c => `<button type="button" data-c="${c}" aria-pressed="${c === state.cat}">${CATNAME[c]}</button>`).join('');
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => go({ cat: b.dataset.c }, false)));
  }
  function renderGlance() {
    const el = $('glance');
    const cell = (e, unit) => e ? `<b>${esc(e.title)}</b><span class="s">${e.artist ? esc(e.artist) + ' · ' : ''}${fmt(e.val)} ${unit}</span>` : '';
    const tcell = (e, c) => e ? `<b>${esc(e.title)}</b><span class="s">${e.artist ? esc(e.artist) + ' · ' : ''}${C.YEAR_END_METHOD === 'totals' ? fmt(e.value) + ' ' + UNIT[c] : e.points + ' pts'}</span>` : '';
    if (state.year === 'all') {
      $('glanceH').textContent = 'No. 1s, year by year';
      $('glanceHint').textContent = 'Year-end No. 1s. Click a year to open it.';
      el.innerHTML = `<thead><tr><th>Year</th><th>Song</th><th>Album</th><th>Artist</th></tr></thead><tbody>` +
        allYears.map(y => `<tr tabindex="0" data-y="${y}" data-v="year-end"><td class="mo">${y}${isPartial(y) ? '<span>' + (M.filter(m => m.year === y).length ? M.filter(m => m.year === y).length + ' months' : 'Replay only') + '</span>' : ''}</td>` +
          CATS.map(c => `<td>${tcell(X.yearEnd[y][c][0], c)}</td>`).join('') + `</tr>`).join('') + `</tbody>`;
    } else {
      const y = state.year;
      $('glanceH').textContent = `No. 1s of ${y}, month by month`;
      $('glanceHint').textContent = 'Click a month to open its charts.';
      let body = '';
      const firstOfYear = M.find(x => x.year === y);
      for (let mo = 0; mo < 12; mo++) {
        const m = byMonth.get(ym(y, mo));
        if (!m) {
          if (!firstOfYear || mo < firstOfYear.mon || y > LAST.year || (y === LAST.year && mo > LAST.mon)) continue;
          body += `<tr class="off"><td class="mo off">${MONTHS[mo]}<span>No data</span></td><td colspan="3"></td></tr>`; continue;
        }
        body += `<tr tabindex="0" data-y="${y}" data-v="${m.month}"><td class="mo">${MONTHS[mo]}${m.source === 'lastfm' ? '<span>Last.fm</span>' : ''}</td>` +
          CATS.map(c => `<td>${cell(m.data[c][0], UNIT[c])}</td>`).join('') + `</tr>`;
      }
      el.innerHTML = `<thead><tr><th>Month</th><th>Song</th><th>Album</th><th>Artist</th></tr></thead><tbody>${body}</tbody>`;
    }
    el.querySelectorAll('tbody tr[data-v]').forEach(tr => {
      const goTo = () => { go({ year: +tr.dataset.y, view: tr.dataset.v }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
      tr.addEventListener('click', goTo);
      tr.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); goTo(); } });
    });
  }
  function renderNotes() {
    const lfm = M.filter(m => m.source === 'lastfm').map(m => monthLabel(m)).join(' and ');
    const missing = [];
    for (let i = 1; i < M.length; i++) if (M[i].gapBefore) {
      for (let k = M[i - 1].year * 12 + M[i - 1].mon + 1; k < M[i].year * 12 + M[i].mon; k++) missing.push(`${MONTHS[k % 12]} ${Math.floor(k / 12)}`);
    }
    const yeText = C.YEAR_END_METHOD === 'totals'
      ? `<p><b>Year-end charts</b> rank like Apple Replay: by total plays (songs) or minutes (albums and artists) over the year. Where Apple’s full-year Replay list exists its totals are used; otherwise the monthly lists are added up. Last.fm months count too.</p>`
      : `<p><b>Year-end charts</b> use chart points: each monthly position earns points, from ${C.CHART_SIZE} for No. 1 down to 1 for No. ${C.CHART_SIZE}. Ties go to the better peak, then more months at No. 1, then more months on the chart, then the earlier debut.</p>`;
    const atText = C.ALL_TIME_METHOD === 'totals'
      ? `<p><b>All-time</b> ranks by total plays or minutes across everything.</p>`
      : `<p><b>All-time</b> uses chart points (${C.CHART_SIZE} for a No. 1 down to 1 for No. ${C.CHART_SIZE}), added up across every monthly chart.</p>`;
    $('notes').innerHTML = `
      <p><b>Monthly charts.</b> Each month is the top ${C.CHART_SIZE} from Apple Music Replay. Artists and albums are ranked by minutes listened and songs by plays. The charts run continuously from ${monthLabel(FIRST)}: moves, peaks and months on chart carry over from one year into the next.${missing.length ? ` There is no chart for ${missing.join(', ')}, so the month after compares with the last chart before the gap.` : ''}</p>
      ${lfm ? `<p><b>Last.fm months.</b> ${lfm} come from Last.fm instead of Apple. Each scrobble counts as a play, and minutes are worked out from each track’s length. They’re marked LFM.</p>` : ''}
      <p><b>Columns.</b> LM is last month’s position, PEAK is the best position reached so far and MOS is months on the chart. NEW is a first appearance and RE is a return after dropping out. Different editions of the same album count as one.</p>
      ${yeText}${atText}
      <p><b>Library totals</b> add up every month something shows up in the Replay lists (top 20 artists, 30 songs, 15 albums) and Apple’s full-year totals where they exist, so they’re a floor: the real numbers are higher. Data built ${esc(DB.builtAt || '')}.</p>`;
  }

  function render() {
    if (isChartView()) {
      if (state.year === 'all') state.view = 'all-time';
      else if (state.view !== 'year-end' && state.view !== 'replay' && !(byMonth.has(state.view) && byMonth.get(state.view).year === state.year)) state.view = defaultView(state.year);
      if (state.view === 'year-end' && !X.yearEnd[state.year]) state.view = defaultView(state.year);
      if (state.view === 'replay' && !hasReplay(state.year)) state.view = X.yearEnd[state.year] ? 'year-end' : defaultView(state.year);
    }
    panelData.clear(); histData.clear(); LISTS.clear();
    renderTopNav(); renderBar();
    const chartView = isChartView();
    $('charts').hidden = !chartView; $('page').hidden = chartView;
    if (chartView) {
      document.title = SITE;
      renderYearSelect(); renderCats();
      const chart = $('chart');
      chart.innerHTML = state.year === 'all' ? renderAllTime()
        : state.view === 'year-end' ? renderYearEnd(state.year)
        : state.view === 'replay' ? renderReplay(state.year)
        : renderMonth(byMonth.get(state.view));
      bindRows(chart);
      renderGlance();
    } else {
      const page = $('page');
      page.innerHTML = state.view === 'library' ? renderLibrary()
        : state.view === 'album' ? renderAlbum(state.key)
        : state.view === 'artist' ? renderArtist(state.key)
        : renderSong(state.key);
      if (state.view === 'library') document.title = `${CATNAME[state.cat]} · Library · ${SITE}`;
      bindRows(page); bindHist(page); bindSongLists(page);
      const q = $('q');
      if (q) { q.addEventListener('input', () => { libFilter = q.value; applyFilter(); }); applyFilter(); }
    }
    const h = hashFor(state);
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  $('year').addEventListener('change', ev => {
    const v = ev.target.value;
    if (v === 'all') return go({ year: 'all', view: 'all-time' });
    const y = +v, wasYE = state.view === 'year-end' || state.view === 'replay';
    const sameMonth = /^\d{4}-\d{2}$/.test(state.view) ? ym(y, +state.view.slice(5) - 1) : null;
    go({ year: y, view: wasYE && (state.view === 'year-end' ? X.yearEnd[y] : hasReplay(y)) ? state.view
      : sameMonth && byMonth.has(sameMonth) ? sameMonth : defaultView(y) });
  });
  window.addEventListener('hashchange', () => { const was = state.view + state.key; readHash(); render(); if (!isChartView() && was !== state.view + state.key) window.scrollTo(0, 0); });
  readHash();
  renderNotes();
  render();
})();
