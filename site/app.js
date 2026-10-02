/* Page rendering. Data comes from data.js (window.MUSICBOX), maths from charts.js. */
(function () {
  const DB = window.MUSICBOX;
  const C = window.Charts;
  const X = C.build(DB);
  const { M, years } = X;
  const CATS = C.CATS;
  const TYPE = { songs: 'song', albums: 'album', artists: 'artist' };
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const CATNAME = { songs: 'Songs', albums: 'Albums', artists: 'Artists' };
  const ONE = { songs: 'song', albums: 'album', artists: 'artist' };
  const UNIT = { songs: 'plays', albums: 'min', artists: 'min' };
  const SRC = { apple: 'Apple Music Replay', lastfm: 'Last.fm' };
  const LAST = M[M.length - 1], FIRST = M[0];
  const allYears = [...new Set([...years, ...Object.keys(X.replay).map(Number)])].sort((a, b) => a - b);

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => Number(n).toLocaleString('en-US');
  const monthLabel = m => `${MONTHS[m.mon]} ${m.year}`;
  const shortLabel = m => `${MON[m.mon]} ${m.year}`;
  const byMonth = new Map(M.map(m => [m.month, m]));
  const ym = (y, mo) => `${y}-${String(mo + 1).padStart(2, '0')}`;
  const isPartial = y => M.filter(m => m.year === y).length < 12;

  // ---- Images: data/images.json rows of [type, title, artist, url] ----
  const IMG = new Map();
  (DB.images || []).forEach(([type, title, artist, url]) => {
    if (url) IMG.set(type + '|' + C.norm(title) + (type === 'artist' ? '' : '|' + C.norm(artist)), url);
  });
  const imgFor = (cat, key) => IMG.get(TYPE[cat] + '|' + key) || '';

  // ---- State (mirrored in the URL hash) ----
  // view: month string "2023-07" | "year-end" | "replay" | "all-time"
  let state = { year: LAST.year, view: LAST.month, cat: 'songs' };
  const open = new Set();
  const panelYear = new Map();

  function readHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (!parts.length) return;
    let [a, b, c] = parts;
    if (a === 'all-time') { state = { year: 'all', view: 'all-time', cat: CATS.includes(b) ? b : state.cat }; return; }
    if (/^\d{4}-\d{2}$/.test(a) && byMonth.has(a)) { state = { year: +a.slice(0, 4), view: a, cat: CATS.includes(b) ? b : state.cat }; return; }
    if (/^\d{4}$/.test(a) && allYears.includes(+a)) {
      const y = +a;
      const view = b === 'replay' && X.replay[y] ? 'replay' : b === 'year-end' && X.yearEnd[y] ? 'year-end' : defaultView(y);
      state = { year: y, view, cat: CATS.includes(c) ? c : state.cat };
    }
  }
  function writeHash() {
    const h = state.view === 'all-time' ? `#/all-time/${state.cat}`
      : /^\d{4}-\d{2}$/.test(state.view) ? `#/${state.view}/${state.cat}`
      : `#/${state.year}/${state.view}/${state.cat}`;
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function defaultView(y) {
    const ms = M.filter(m => m.year === y);
    if (ms.length) return ms[ms.length - 1].month;
    return X.replay[y] ? 'replay' : 'year-end';
  }

  // ---- Bits ----
  function tile(seed, letterSrc, round, url) {
    let h = 0; for (const ch of seed) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    const hue = 212 + (h % 26), light = 22 + ((h >> 5) % 30), sat = 55 + ((h >> 9) % 30);
    const letter = (letterSrc.match(/\p{L}|\p{N}/u) || ['?'])[0].toUpperCase();
    const img = url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
    return `<div class="art${round ? ' round' : ''}" style="background:hsl(${hue} ${sat}% ${light}%)" aria-hidden="true">${esc(letter)}${img}</div>`;
  }
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
  const rankColor = r => { const t = (r - 1) / (C.CHART_SIZE - 1); return `hsl(${224 - t * 8} ${80 - t * 25}% ${30 + t * 32}%)`; };

  // ---- History panel ----
  function lineChart(h) {
    const a = h.first, b = Math.max(h.last, a), n = b - a, Hh = 110;
    const xp = i => (n === 0 ? 50 : (i - a) / n * 100);
    const y = r => 6 + (Hh - 12) * (r - 1) / (C.CHART_SIZE - 1);
    const grid = [1, 5, 10, 15].map(r => `<div class="gl" style="top:${y(r)}px"><span>${r}</span></div>`).join('');
    const ticks = [];
    for (let i = a; i <= b; i++) if (i === a || M[i].year !== M[i - 1].year) ticks.push(`<div class="yt" style="left:${xp(i)}%"><span>${i === a ? shortLabel(M[i]) : M[i].year}</span></div>`);
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
  function panel(cat, h, id) {
    const unit = UNIT[cat];
    let total = 0, best = -1, lfm = false;
    h.ranks.forEach((p, i) => { if (!p) return; total += p.val; if (M[i].source === 'lastfm') lfm = true; if (best < 0 || p.val > h.ranks[best].val) best = i; });
    const atPeak = h.ranks.filter(p => p && p.rank === h.peak).length;
    const chartedYears = [...new Set(h.ranks.map((p, i) => p ? M[i].year : null).filter(Boolean))];
    const ctxYear = state.year === 'all' ? null : state.year;
    let selYear = panelYear.get(id);
    if (!chartedYears.includes(selYear)) selYear = chartedYears.includes(ctxYear) ? ctxYear : chartedYears[chartedYears.length - 1];
    const yeRow = ctxYear && X.yearEndAll[ctxYear] ? X.yearEndAll[ctxYear][cat].get(h.key) : null;
    const at = X.allTimeAll[cat].get(h.key);
    const last = h.last, debut = h.first;
    const fourth = yeRow
      ? `<div class="k">${isPartial(ctxYear) && ctxYear === LAST.year ? ctxYear + ' so far' : ctxYear + ' year-end'}</div><div class="v">No. ${yeRow.rank}</div><div class="n">${yeRow.points} points · all-time No. ${at.rank}</div>`
      : `<div class="k">All-time</div><div class="v">No. ${at.rank}</div><div class="n">${at.points} points</div>`;
    return `<div class="grid4">
        <div class="stat"><div class="k">Total</div><div class="v">${fmt(total)}<small>${unit}</small></div><div class="n">across ${h.months} charted month${h.months === 1 ? '' : 's'}</div></div>
        <div class="stat"><div class="k">Best month</div><div class="v">${fmt(h.ranks[best].val)}<small>${unit}</small></div><div class="n">${shortLabel(M[best])}, at No. ${h.ranks[best].rank}</div></div>
        <div class="stat"><div class="k">Peak</div><div class="v">No. ${h.peak}</div><div class="n">${atPeak} month${atPeak === 1 ? '' : 's'} at peak · ${h.months} on chart</div></div>
        <div class="stat">${fourth}</div>
      </div>
      <h4>Chart history</h4>
      ${chartedYears.length > 1 ? `<div class="yrs" role="group" aria-label="Year">${chartedYears.map(y => `<button type="button" data-y="${y}" aria-pressed="${y === selYear}">${y}</button>`).join('')}</div>` : ''}
      ${yearCells(h, selYear)}
      ${lineChart(h)}
      <div class="foot">Debuted at No. ${h.ranks[debut].rank} in ${monthLabel(M[debut])}${last !== debut ? `; last charted in ${monthLabel(M[last])} at No. ${h.ranks[last].rank}` : ''}. Totals only count months where it made the top ${C.CHART_SIZE}.${lfm ? ' * Last.fm month: plays are scrobbles and minutes come from track lengths.' : ''}</div>`;
  }

  function bindRows(root) {
    root.querySelectorAll('.row[role="button"]').forEach(row => {
      const toggle = () => {
        const p = row.nextElementSibling, on = row.getAttribute('aria-expanded') !== 'true';
        row.setAttribute('aria-expanded', on); p.hidden = !on;
        on ? open.add(row.dataset.id) : open.delete(row.dataset.id);
        if (on && !p.dataset.filled) fillPanel(p);
      };
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
    });
    root.querySelectorAll('.panel:not([hidden])').forEach(fillPanel);
  }
  const panelData = new Map();
  function fillPanel(p) {
    const { cat, h, id } = panelData.get(p.dataset.id);
    p.innerHTML = panel(cat, h, id);
    p.dataset.filled = '1';
    p.querySelectorAll('.yrs button').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation(); panelYear.set(id, +b.dataset.y); fillPanel(p);
    }));
  }
  function rowHtml({ id, rank, mvHtml, isArtist, e, h, flag, inline, c1, c2, c3, val, unit }) {
    const cat = state.cat, expandable = !!h;
    const isOpen = expandable && open.has(id);
    if (expandable) panelData.set(id, { cat, h, id });
    return `
      <div class="row${rank === 1 ? ' top' : ''}${expandable ? '' : ' static'}"${expandable ? ` role="button" tabindex="0" aria-expanded="${isOpen}"` : ''} data-id="${esc(id)}">
        <div class="rank">${rank}</div>
        <div class="mv">${mvHtml}</div>
        ${tile(isArtist ? e.title : e.artist, e.title, isArtist, imgFor(cat, e.key))}
        <div class="name">
          ${flag ? `<span class="flag">${flag}</span>` : ''}
          <div class="t">${esc(e.title)}</div>
          ${e.artist ? `<div class="a">${esc(e.artist)}</div>` : ''}
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
  const cols = (isArtist, a, b, c, d, mv = 'Move') =>
    `<div class="cols"><div class="c">Rank</div><div class="c">${mv}</div><div></div><div>${isArtist ? 'Artist' : 'Title / Artist'}</div><div class="c">${a}</div><div class="c">${b}</div><div class="c">${c}</div><div class="r">${d}</div><div></div></div>`;
  const setHead = (eyebrow, title, meta) => {
    document.getElementById('eyebrow').textContent = eyebrow;
    document.getElementById('title').textContent = title;
    document.getElementById('meta').innerHTML = meta;
  };

  // ---- Views ----
  function renderMonth(m) {
    const cat = state.cat, list = m.data[cat], isArtist = cat === 'artists', unit = UNIT[cat];
    const prev = m.i > 0 ? M[m.i - 1] : null;
    const total = m.total ? `<b>${fmt(m.total.value)} ${m.total.unit === 'min' ? 'minutes' : esc(m.total.unit)}</b><br>` : '';
    const gap = m.gapBefore ? `<br>Moves compare with ${esc(shortLabel(prev))}` : '';
    setHead(`${monthLabel(m)} · Top ${C.CHART_SIZE}`, CATNAME[cat], `${total}${SRC[m.source] || esc(m.source)}${gap}`);
    const rows = list.map(e => rowHtml({
      id: `${m.month}|${cat}|${e.key}`, rank: e.rank, mvHtml: moveCell(e.mv), isArtist, e, h: e.h,
      flag: e.rank === 1 ? `No. 1 ${ONE[cat]} of ${monthLabel(m)}${e.no1 > 1 ? ` · ${e.no1} months at No. 1` : ''}` : '',
      inline: `LM ${e.lw || '–'} · PEAK ${e.peak} · ${e.months} MO${e.months === 1 ? '' : 'S'}`,
      c1: e.lw || '–', c2: e.peak, c3: e.months, val: fmt(e.val), unit
    })).join('');
    return cols(isArtist, 'LM', 'Peak', 'MOs', unit) + rows;
  }
  function renderTally(list, idPrefix, flagText) {
    const cat = state.cat, isArtist = cat === 'artists';
    const rows = list.map(e => rowHtml({
      id: `${idPrefix}|${cat}|${e.key}`, rank: e.rank, mvHtml: '', isArtist, e, h: e.h,
      flag: e.rank === 1 ? flagText : '',
      inline: `PEAK ${e.peak} · ${e.months} MO${e.months === 1 ? '' : 'S'}${e.no1 ? ` · ${e.no1}× NO. 1` : ''}`,
      c1: e.no1 || '–', c2: e.peak, c3: e.months, val: e.points, unit: 'pts'
    })).join('');
    return cols(isArtist, 'No. 1s', 'Peak', 'MOs', 'Points', '') + rows;
  }
  function renderYearEnd(y) {
    const ms = M.filter(m => m.year === y), cat = state.cat;
    const span = `${MONTHS[ms[0].mon]}–${MONTHS[ms[ms.length - 1].mon]} ${y}`;
    const partial = isPartial(y), ongoing = y === LAST.year && partial;
    setHead(`${ongoing ? 'Year to date' : 'Year-end'} · ${span} · Top ${C.YEAR_END_SIZE}`,
      `${ongoing ? '' : y + ' '}Year-End ${CATNAME[cat]}`,
      `<b>${partial ? `${ms.length} of 12 months` : 'Full year'}</b><br>Points from the monthly charts`);
    return renderTally(X.yearEnd[y][cat], `ye${y}`, `No. 1 ${ONE[cat]} of ${y}${ongoing ? ' so far' : ''}`);
  }
  function renderAllTime() {
    const cat = state.cat;
    setHead(`All-time · ${shortLabel(FIRST)} – ${shortLabel(LAST)} · Top ${C.ALL_TIME_SIZE}`, `All-Time ${CATNAME[cat]}`,
      `<b>${M.length} monthly charts</b><br>Points from the monthly charts`);
    return renderTally(X.allTime[cat], 'all', `No. 1 ${ONE[cat]} of all time`);
  }
  function renderReplay(y) {
    const cat = state.cat, list = X.replay[y][cat], isArtist = cat === 'artists', unit = UNIT[cat];
    const ye = X.yearEndAll[y] ? X.yearEndAll[y][cat] : new Map();
    setHead(`Apple Music Replay ${y} · full-year totals`, `Replay ${y}: Top ${CATNAME[cat]}`,
      `<b>Apple’s own year list</b><br>Ranked by ${cat === 'songs' ? 'plays' : 'minutes'} over the whole year`);
    if (!list.length) return `<p class="empty">No ${CATNAME[cat].toLowerCase()} list saved for Replay ${y}.</p>`;
    const rows = list.map(e => {
      const yr = ye.get(e.key);
      return rowHtml({
        id: `rp${y}|${cat}|${e.key}`, rank: e.rank, mvHtml: '', isArtist, e, h: e.h,
        flag: e.rank === 1 ? `Apple’s No. 1 ${ONE[cat]} of ${y}` : '',
        inline: yr ? `CHART PEAK ${yr.peak} · ${yr.months} MO${yr.months === 1 ? '' : 'S'} · YEAR-END ${yr.rank}` : 'DID NOT CHART THIS YEAR',
        c1: yr ? yr.peak : '–', c2: yr ? yr.months : '–', c3: yr ? yr.rank : '–', val: fmt(e.val), unit
      });
    }).join('');
    return cols(isArtist, 'Peak', 'MOs', 'YE rank', unit, '') + rows;
  }

  // ---- Chrome: year select, month bar, category tabs ----
  function renderYearSelect() {
    const sel = document.getElementById('year');
    sel.innerHTML = allYears.slice().reverse().map(y => `<option value="${y}"${y === state.year ? ' selected' : ''}>${y}</option>`).join('')
      + `<option value="all"${state.year === 'all' ? ' selected' : ''}>All time</option>`;
  }
  function renderBar() {
    const el = document.getElementById('months');
    if (state.year === 'all') {
      el.innerHTML = `<button type="button" class="ye" data-v="all-time" aria-pressed="true">All-time top ${C.ALL_TIME_SIZE}</button>`;
    } else {
      const y = state.year;
      let html = '';
      for (let mo = 0; mo < 12; mo++) {
        const m = byMonth.get(ym(y, mo));
        html += m ? `<button type="button" data-v="${m.month}" aria-pressed="${state.view === m.month}">${MON[mo]}${m.source === 'lastfm' ? '<span class="tag">LFM</span>' : ''}</button>`
                  : `<button type="button" disabled title="No chart for ${MONTHS[mo]} ${y}">${MON[mo]}</button>`;
      }
      html += `<span class="push"></span>`;
      if (X.yearEnd[y]) html += `<button type="button" class="ye" data-v="year-end" aria-pressed="${state.view === 'year-end'}">${y === LAST.year && isPartial(y) ? 'Year to date' : 'Year-end'}</button>`;
      if (X.replay[y]) html += `<button type="button" class="ye" data-v="replay" aria-pressed="${state.view === 'replay'}">Replay ${y}</button>`;
      el.innerHTML = html;
    }
    el.querySelectorAll('button[data-v]').forEach(b => b.addEventListener('click', () => { state.view = b.dataset.v; render(); }));
    const on = el.querySelector('[aria-pressed="true"]');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function renderCats() {
    const el = document.getElementById('cats');
    el.innerHTML = CATS.map(c => `<button type="button" data-c="${c}" aria-pressed="${c === state.cat}">${CATNAME[c]}</button>`).join('');
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { state.cat = b.dataset.c; render(); }));
  }
  function renderGlance() {
    const el = document.getElementById('glance');
    const cell = (e, unit) => e ? `<b>${esc(e.title)}</b><span class="s">${e.artist ? esc(e.artist) + ' · ' : ''}${fmt(e.val)} ${unit}</span>` : '';
    const tcell = e => e ? `<b>${esc(e.title)}</b><span class="s">${e.artist ? esc(e.artist) + ' · ' : ''}${e.points} pts</span>` : '';
    if (state.year === 'all') {
      document.getElementById('glanceH').textContent = 'No. 1s, year by year';
      document.getElementById('glanceHint').textContent = 'Year-end No. 1s from the monthly charts. Click a year to open it.';
      el.innerHTML = `<thead><tr><th>Year</th><th>Song</th><th>Album</th><th>Artist</th></tr></thead><tbody>` +
        years.map(y => `<tr tabindex="0" data-y="${y}" data-v="year-end"><td class="mo">${y}${isPartial(y) ? '<span>' + M.filter(m => m.year === y).length + ' months</span>' : ''}</td>` +
          CATS.map(c => `<td>${tcell(X.yearEnd[y][c][0])}</td>`).join('') + `</tr>`).join('') + `</tbody>`;
    } else {
      const y = state.year;
      document.getElementById('glanceH').textContent = `No. 1s of ${y}, month by month`;
      document.getElementById('glanceHint').textContent = 'Click a month to open its charts.';
      let body = '';
      for (let mo = 0; mo < 12; mo++) {
        const m = byMonth.get(ym(y, mo));
        if (!m) { if (mo < (M.find(x => x.year === y) || {}).mon || y > LAST.year || (y === LAST.year && mo > LAST.mon)) continue; body += `<tr class="off"><td class="mo off">${MONTHS[mo]}<span>No data</span></td><td colspan="3"></td></tr>`; continue; }
        body += `<tr tabindex="0" data-y="${y}" data-v="${m.month}"><td class="mo">${MONTHS[mo]}${m.source === 'lastfm' ? '<span>Last.fm</span>' : ''}</td>` +
          CATS.map(c => `<td>${cell(m.data[c][0], UNIT[c])}</td>`).join('') + `</tr>`;
      }
      el.innerHTML = `<thead><tr><th>Month</th><th>Song</th><th>Album</th><th>Artist</th></tr></thead><tbody>${body}</tbody>`;
    }
    el.querySelectorAll('tbody tr[data-v]').forEach(tr => {
      const go = () => { state.year = +tr.dataset.y; state.view = tr.dataset.v; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
    });
  }
  function renderNotes() {
    const lfm = M.filter(m => m.source === 'lastfm').map(m => monthLabel(m)).join(' and ');
    const missing = [];
    for (let i = 1; i < M.length; i++) if (M[i].gapBefore) {
      for (let k = M[i - 1].year * 12 + M[i - 1].mon + 1; k < M[i].year * 12 + M[i].mon; k++) missing.push(`${MONTHS[k % 12]} ${Math.floor(k / 12)}`);
    }
    document.getElementById('who').textContent = `Apple Music Replay + Last.fm · ${shortLabel(FIRST)} to ${shortLabel(LAST)}`;
    document.getElementById('notes').innerHTML = `
      <p><b>Monthly charts.</b> Each month is the top ${C.CHART_SIZE} from Apple Music Replay. Artists and albums are ranked by minutes listened and songs by plays. The charts run continuously from ${monthLabel(FIRST)}: moves, peaks and months on chart carry over from one year into the next, so January is compared with the December before it.${missing.length ? ` There is no chart for ${missing.join(', ')}, so the month after compares with the last chart before the gap.` : ''}</p>
      ${lfm ? `<p><b>Last.fm months.</b> ${lfm} come from Last.fm instead of Apple. Each scrobble counts as a play, and minutes are worked out from each track’s length. They are marked LFM in the month bar.</p>` : ''}
      <p><b>Columns.</b> LM is last month’s position, PEAK is the best position reached so far and MOS is months on the chart so far. NEW is a first appearance and RE is a return after dropping out. Different editions of the same album (for example “Detour” and “Detour (Rare N’ Deluxe)”) count as one.</p>
      <p><b>Year-end and all-time.</b> Each monthly position earns points, from ${C.CHART_SIZE} for No. 1 down to 1 for No. ${C.CHART_SIZE}. Ties go to the better peak, then more months at No. 1, then more months on the chart, then the earlier debut. Replay ${allYears.filter(y => X.replay[y]).join(', ')} tabs show Apple’s own full-year lists, which rank by total plays or minutes instead.</p>
      <p><b>Details.</b> Click any entry for its full chart history. Totals there only add up the months where it made the top ${C.CHART_SIZE}, so real totals are higher. Data built ${esc(DB.builtAt || '')}.</p>`;
  }

  function render() {
    if (state.year !== 'all' && state.view !== 'year-end' && state.view !== 'replay' && !(byMonth.has(state.view) && byMonth.get(state.view).year === state.year)) state.view = defaultView(state.year);
    if (state.view === 'year-end' && !X.yearEnd[state.year]) state.view = defaultView(state.year);
    if (state.view === 'replay' && !X.replay[state.year]) state.view = defaultView(state.year);
    panelData.clear();
    renderYearSelect(); renderBar(); renderCats();
    const chart = document.getElementById('chart');
    chart.innerHTML = state.year === 'all' ? renderAllTime()
      : state.view === 'year-end' ? renderYearEnd(state.year)
      : state.view === 'replay' ? renderReplay(state.year)
      : renderMonth(byMonth.get(state.view));
    bindRows(chart);
    renderGlance();
    writeHash();
  }

  document.getElementById('year').addEventListener('change', ev => {
    const v = ev.target.value;
    if (v === 'all') { state.year = 'all'; state.view = 'all-time'; }
    else {
      const y = +v, wasYE = state.view === 'year-end' || state.view === 'replay';
      const sameMonth = /^\d{4}-\d{2}$/.test(state.view) ? ym(y, +state.view.slice(5) - 1) : null;
      state.year = y;
      state.view = wasYE && (state.view === 'year-end' ? X.yearEnd[y] : X.replay[y]) ? state.view
        : sameMonth && byMonth.has(sameMonth) ? sameMonth : defaultView(y);
    }
    render();
  });
  window.addEventListener('hashchange', () => { readHash(); render(); });
  readHash();
  renderNotes();
  render();
})();
