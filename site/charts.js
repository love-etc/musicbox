/* Chart math. Used by the page (app.js) and by scripts/verify.mjs.
   Input: the MUSICBOX object written by scripts/build.mjs.
   Positions continue across years: movement, peaks and months-on-chart
   carry over from one month to the next regardless of the calendar year. */
(function (root) {
  const CHART_SIZE = 15;      // positions per monthly chart (points: No. 1 = 15 … No. 15 = 1)
  const YEAR_END_SIZE = 25;   // positions shown on year-end charts
  const ALL_TIME_SIZE = 50;   // positions shown on the all-time chart
  const CATS = ['songs', 'albums', 'artists'];

  const norm = s => String(s).toLowerCase().normalize('NFC')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

  // Month index helpers: "2021-05" <-> absolute month number
  const abs = ym => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1); };

  function build(DB) {
    const alias = DB.aliases || {};
    const artistName = a => (alias.artists && alias.artists[a]) || a;
    // songs/albums aliases: "Old title — Old artist" (or just "Old title") -> "New title" or "New title — New artist"
    const rename = (cat, t, a) => {
      const map = alias[cat]; if (!map) return [t, a];
      const v = map[t + ' — ' + a] || map[t];
      if (!v) return [t, a];
      const i = v.lastIndexOf(' — ');
      return i < 0 ? [v, a] : [v.slice(0, i), v.slice(i + 3)];
    };
    const M = DB.months.slice().sort((a, b) => abs(a.month) - abs(b.month));
    M.forEach((m, i) => {
      m.i = i;
      m.year = +m.month.slice(0, 4);
      m.mon = +m.month.slice(5, 7) - 1;
      m.gapBefore = i > 0 && abs(m.month) - abs(M[i - 1].month) > 1;
      const songs = m.songs.map(([t, a, v]) => { [t, a] = rename('songs', t, artistName(a)); return { title: t, artist: a, val: v, key: norm(t) + '|' + norm(a) }; });
      const albums = m.albums.map(([t, a, v]) => { [t, a] = rename('albums', t, artistName(a)); return { title: t, artist: a, val: v, key: norm(t) + '|' + norm(a) }; });
      const artists = m.artists.map(([n, v]) => { n = artistName(n); return { title: n, artist: '', val: v, key: norm(n) }; });
      m.full = { songs, albums, artists };
      m.data = {};
    });

    const H = {};           // cat -> Map(key -> history)
    CATS.forEach(cat => {
      const hist = new Map();
      H[cat] = hist;
      M.forEach((m, i) => {
        // de-duplicate keys inside a month (e.g. two editions of one album): keep the first, add values
        const seen = new Map(), list = [];
        m.full[cat].forEach(e => {
          if (seen.has(e.key)) { seen.get(e.key).val += e.val; return; }
          const c = { ...e }; seen.set(e.key, c); list.push(c);
        });
        const top = list.slice(0, CHART_SIZE);
        const prevMap = i > 0 ? new Map(M[i - 1].data[cat].map(e => [e.key, e.rank])) : null;
        top.forEach((e, r) => {
          const rank = r + 1, before = hist.get(e.key);
          const h = before || { key: e.key, cat, titles: {}, artists: {}, peak: 99, months: 0, no1: 0, points: 0, first: i, last: i, ranks: new Array(M.length).fill(null) };
          e.lw = prevMap ? (prevMap.get(e.key) || null) : null;
          if (!prevMap) e.mv = { kind: 'first' };
          else if (e.lw === null) e.mv = { kind: before ? 're' : 'new' };
          else if (e.lw > rank) e.mv = { kind: 'up', n: e.lw - rank };
          else if (e.lw < rank) e.mv = { kind: 'down', n: rank - e.lw };
          else e.mv = { kind: 'same' };
          h.peak = Math.min(h.peak, rank);
          h.months += 1;
          if (rank === 1) h.no1 += 1;
          h.points += CHART_SIZE + 1 - rank;
          h.titles[e.title] = (h.titles[e.title] || 0) + 1;
          h.artists[e.artist] = (h.artists[e.artist] || 0) + 1;
          h.last = i;
          h.ranks[i] = { rank, val: e.val };
          e.rank = rank; e.peak = h.peak; e.months = h.months; e.no1 = h.no1; e.h = h;
          hist.set(e.key, h);
        });
        m.data[cat] = top;
      });
      hist.forEach(h => {
        h.artist = Object.entries(h.artists).sort((a, b) => b[1] - a[1])[0][0];
      });
    });

    // Most recent spelling wins for display (Apple sometimes renames things)
    function latestTitle(h, M, cat) {
      for (let i = h.last; i >= h.first; i--) {
        const e = h.ranks[i] && M[i].data[cat] && M[i].data[cat].find(x => x.key === h.key);
        if (e) return e.title;
      }
      return Object.keys(h.titles)[0];
    }
    CATS.forEach(cat => H[cat].forEach(h => { h.title = latestTitle(h, M, cat); }));

    // Ranked tally over a set of month indexes
    function tally(cat, idxs, size) {
      const set = new Set(idxs), rows = [];
      H[cat].forEach(h => {
        let points = 0, peak = 99, months = 0, no1 = 0, first = -1;
        h.ranks.forEach((p, i) => {
          if (!p || !set.has(i)) return;
          points += CHART_SIZE + 1 - p.rank; months++; if (p.rank === 1) no1++;
          if (p.rank < peak) peak = p.rank;
          if (first < 0) first = i;
        });
        if (months) rows.push({ key: h.key, title: h.title, artist: h.artist, h, points, peak, months, no1, first, firstRank: h.ranks[first].rank });
      });
      rows.sort((a, b) => b.points - a.points || a.peak - b.peak || b.no1 - a.no1 || b.months - a.months || a.first - b.first || a.firstRank - b.firstRank);
      rows.forEach((r, i) => { r.rank = i + 1; });
      return size ? rows.slice(0, size) : rows;
    }

    const years = [...new Set(M.map(m => m.year))];
    const yearEnd = {}, yearEndAll = {};
    years.forEach(y => {
      const idxs = M.filter(m => m.year === y).map(m => m.i);
      yearEnd[y] = {}; yearEndAll[y] = {};
      CATS.forEach(cat => {
        const all = tally(cat, idxs, 0);
        yearEndAll[y][cat] = new Map(all.map(r => [r.key, r]));
        yearEnd[y][cat] = all.slice(0, YEAR_END_SIZE);
      });
    });
    const allTime = {}, allTimeAll = {};
    CATS.forEach(cat => {
      const all = tally(cat, M.map(m => m.i), 0);
      allTimeAll[cat] = new Map(all.map(r => [r.key, r]));
      allTime[cat] = all.slice(0, ALL_TIME_SIZE);
    });

    // Apple's own year-long Replay lists, matched to chart histories where possible
    const replay = {};
    Object.entries(DB.replay || {}).forEach(([y, r]) => {
      replay[y] = {};
      CATS.forEach(cat => {
        replay[y][cat] = (r[cat] || []).map((row, i) => {
          let e;
          if (cat === 'artists') { const n = artistName(row[0]); e = { title: n, artist: '', val: row[1], key: norm(n) }; }
          else { const [t, a] = rename(cat, row[0], artistName(row[1])); e = { title: t, artist: a, val: row[2], key: norm(t) + '|' + norm(a) }; }
          e.rank = i + 1; e.h = H[cat].get(e.key) || null;
          return e;
        });
      });
    });

    return { M, H, years, yearEnd, yearEndAll, allTime, allTimeAll, replay, tally };
  }

  const api = { CHART_SIZE, YEAR_END_SIZE, ALL_TIME_SIZE, CATS, norm, build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Charts = api;
})(typeof window !== "undefined" ? window : globalThis);
