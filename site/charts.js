/* Chart math. Used by the page (app.js) and by scripts/verify.mjs.
   Input: the MUSICBOX object written by scripts/build.mjs.
   Positions continue across years: movement, peaks and months-on-chart
   carry over from one month to the next regardless of the calendar year. */
(function (root) {
  // ---- Settings --------------------------------------------------------------
  const CHART_SIZE = 15;      // positions per monthly chart (points: No. 1 = 15 … No. 15 = 1)
  const YEAR_END_SIZE = 25;   // positions shown on year-end charts
  const ALL_TIME_SIZE = 50;   // positions shown on the all-time chart
  // How year-end and all-time charts are ranked:
  //   'totals' = Apple Replay style: most plays (songs) / minutes (albums, artists) over the period.
  //              Uses Apple's full-year Replay totals where they exist, otherwise the monthly lists.
  //   'points' = chart points: No. 1 earns CHART_SIZE points, No. CHART_SIZE earns 1, summed per month.
  const YEAR_END_METHOD = 'totals';
  const ALL_TIME_METHOD = 'points';
  // -----------------------------------------------------------------------------
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
    // Key every list entry (after renames), then merge months that have more than one
    // source (e.g. Apple Music + Spotify in the same month) by adding their numbers up.
    const keyed = m => ({
      songs: m.songs.map(([t, a, v]) => { [t, a] = rename('songs', t, artistName(a)); return { title: t, artist: a, val: v, key: norm(t) + '|' + norm(a) }; }),
      albums: m.albums.map(([t, a, v]) => { [t, a] = rename('albums', t, artistName(a)); return { title: t, artist: a, val: v, key: norm(t) + '|' + norm(a) }; }),
      artists: m.artists.map(([n, v]) => { n = artistName(n); return { title: n, artist: '', val: v, key: norm(n) }; })
    });
    const RAW = DB.months.map(m => ({ ...m, full: keyed(m) }));   // one per source file, used for totals
    const byMonth = new Map();
    RAW.forEach(m => { if (!byMonth.has(m.month)) byMonth.set(m.month, []); byMonth.get(m.month).push(m); });
    const ORDER = ['apple', 'deezer', 'spotify', 'lastfm'];
    const M = [...byMonth.values()].map(parts => {
      parts.sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source));
      if (parts.length === 1) return { ...parts[0], sources: [parts[0].source] };
      const full = {};
      CATS.forEach(cat => {
        const acc = new Map();
        parts.forEach(p => p.full[cat].forEach(e => {
          if (acc.has(e.key)) acc.get(e.key).val += e.val;
          else acc.set(e.key, { ...e });
        }));
        full[cat] = [...acc.values()].sort((a, b) => b.val - a.val);
      });
      const totals = parts.map(p => p.total && p.total.value);
      return {
        month: parts[0].month, source: parts.map(p => p.source).join('+'), sources: parts.map(p => p.source),
        total: totals.every(Boolean) ? { value: totals.reduce((a, b) => a + b, 0), unit: 'min' } : null,
        full, merged: true
      };
    }).sort((a, b) => abs(a.month) - abs(b.month));
    M.forEach((m, i) => {
      m.i = i;
      m.year = +m.month.slice(0, 4);
      m.mon = +m.month.slice(5, 7) - 1;
      m.gapBefore = i > 0 && abs(m.month) - abs(M[i - 1].month) > 1;
      if (!m.merged) m.full = m.full || keyed(m);
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
        list.sort((a, b) => b.val - a.val);   // stable: only moves things when merged duplicates add up
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

    // ---- Apple's own year-long Replay lists, keyed like the charts ----
    const replay = {}, replayVal = {};
    Object.entries(DB.replay || {}).forEach(([y, r]) => {
      replay[y] = {}; replayVal[y] = {};
      CATS.forEach(cat => {
        replayVal[y][cat] = new Map();
        replay[y][cat] = (r[cat] || []).map((row, i) => {
          let e;
          if (cat === 'artists') { const n = artistName(row[0]); e = { title: n, artist: '', val: row[1], key: norm(n) }; }
          else { const [t, a] = rename(cat, row[0], artistName(row[1])); e = { title: t, artist: a, val: row[2], key: norm(t) + '|' + norm(a) }; }
          e.rank = i + 1; e.h = H[cat].get(e.key) || null;
          if (!replayVal[y][cat].has(e.key)) replayVal[y][cat].set(e.key, e);
          return e;
        });
      });
    });

    // ---- Listening totals ----
    // Every month's full list (not just the charted top) plus Apple's year totals.
    // For each year: max(sum of Apple's monthly values, Apple's full-year value)
    // + whatever Deezer / Spotify / Last.fm months add. That's a floor: months where something
    // fell off the lists aren't counted.
    const years = [...new Set(M.map(m => m.year))];
    const allYears = [...new Set([...years, ...Object.keys(replay).map(Number)])].sort((a, b) => a - b);
    const sourcesOf = y => [...new Set(RAW.filter(m => +m.month.slice(0, 4) === y).map(m => m.source))];
    const T = {};  // cat -> Map(key -> { key, title, artist, byYear: {y: value}, total, h })
    CATS.forEach(cat => {
      const tm = new Map(); T[cat] = tm;
      const get = e => {
        if (!tm.has(e.key)) tm.set(e.key, { key: e.key, title: e.title, artist: e.artist, monthly: {}, extra: {}, byYear: {}, total: 0, h: H[cat].get(e.key) || null });
        return tm.get(e.key);
      };
      // Apple's full-year Replay number already covers its monthly lists; other sources come on top
      RAW.forEach(m => {
        const y = +m.month.slice(0, 4), bucket = m.source === 'apple' ? 'monthly' : 'extra';
        m.full[cat].forEach(e => { const t = get(e); t[bucket][y] = (t[bucket][y] || 0) + e.val; });
      });
      Object.keys(replay).forEach(y => replay[y][cat].forEach(e => get(e)));
      tm.forEach(t => {
        allYears.forEach(y => {
          const r = replayVal[y] && replayVal[y][cat].get(t.key);
          const v = Math.max(t.monthly[y] || 0, r ? r.val : 0) + (t.extra[y] || 0);
          if (v) { t.byYear[y] = v; t.total += v; }
        });
        if (t.h) { t.title = t.h.title; t.artist = t.h.artist; t.h.total = t.total; t.h.byYear = t.byYear; }
      });
    });

    // ---- Ranked tallies ----
    function stats(h, set) {
      let points = 0, peak = 99, months = 0, no1 = 0, first = -1;
      if (h) h.ranks.forEach((p, i) => {
        if (!p || !set.has(i)) return;
        points += CHART_SIZE + 1 - p.rank; months++; if (p.rank === 1) no1++;
        if (p.rank < peak) peak = p.rank;
        if (first < 0) first = i;
      });
      return { points, peak, months, no1, first, firstRank: first >= 0 ? h.ranks[first].rank : 99 };
    }
    // Chart points over a set of month indexes
    function tallyPoints(cat, idxs) {
      const set = new Set(idxs), rows = [];
      H[cat].forEach(h => {
        const s = stats(h, set);
        if (s.months) rows.push({ key: h.key, title: h.title, artist: h.artist, h, ...s, value: s.points });
      });
      rows.sort((a, b) => b.points - a.points || a.peak - b.peak || b.no1 - a.no1 || b.months - a.months || a.first - b.first || a.firstRank - b.firstRank);
      rows.forEach((r, i) => { r.rank = i + 1; });
      return rows;
    }
    // Listening totals over a list of years (null = all time)
    function tallyTotals(cat, yrs) {
      const set = new Set(yrs ? M.filter(m => yrs.includes(m.year)).map(m => m.i) : M.map(m => m.i)), rows = [];
      T[cat].forEach(t => {
        const value = yrs ? yrs.reduce((a, y) => a + (t.byYear[y] || 0), 0) : t.total;
        if (!value) return;
        // Apple's own order breaks ties within a single Replay year
        const rp = yrs && yrs.length === 1 && replayVal[yrs[0]] ? replayVal[yrs[0]][cat].get(t.key) : null;
        rows.push({ key: t.key, title: t.title, artist: t.artist, h: t.h, ...stats(t.h, set), value, rp: rp ? rp.rank : 999 });
      });
      rows.sort((a, b) => b.value - a.value || a.rp - b.rp || a.peak - b.peak || b.months - a.months || a.title.localeCompare(b.title));
      rows.forEach((r, i) => { r.rank = i + 1; });
      return rows;
    }

    const yearEnd = {}, yearEndAll = {};
    allYears.forEach(y => {
      const idxs = M.filter(m => m.year === y).map(m => m.i);
      yearEnd[y] = {}; yearEndAll[y] = {};
      CATS.forEach(cat => {
        const all = YEAR_END_METHOD === 'totals' ? tallyTotals(cat, [y]) : tallyPoints(cat, idxs);
        yearEndAll[y][cat] = new Map(all.map(r => [r.key, r]));
        yearEnd[y][cat] = all.slice(0, YEAR_END_SIZE);
      });
    });
    const allTime = {}, allTimeAll = {};
    CATS.forEach(cat => {
      const all = ALL_TIME_METHOD === 'totals' ? tallyTotals(cat, null) : tallyPoints(cat, M.map(m => m.i));
      allTimeAll[cat] = new Map(all.map(r => [r.key, r]));
      allTime[cat] = all.slice(0, ALL_TIME_SIZE);
    });

    // ---- Library: everything that ever charted, ranked by listening totals ----
    const library = {};
    CATS.forEach(cat => {
      library[cat] = [...H[cat].values()].sort((a, b) => (b.total || 0) - (a.total || 0) || a.peak - b.peak || b.months - a.months);
      library[cat].forEach((h, i) => { h.libRank = i + 1; });
    });

    // ---- Songs on albums (data/tracks.json) ----
    Object.entries(DB.tracks || {}).forEach(([ak, songs]) => {
      if (ak.startsWith('_')) return;
      const i = ak.lastIndexOf(' — ');
      const [at, aa] = rename('albums', ak.slice(0, i), artistName(ak.slice(i + 3)));
      const album = H.albums.get(norm(at) + '|' + norm(aa));
      if (!album) return;
      album.songs = album.songs || [];
      songs.forEach(s => {
        const j = s.lastIndexOf(' — ');
        const [st, sa] = j < 0 ? rename('songs', s, aa) : rename('songs', s.slice(0, j), artistName(s.slice(j + 3)));
        const song = H.songs.get(norm(st) + '|' + norm(sa));
        if (song && !song.album) { song.album = album; album.songs.push(song); }
      });
      album.songs.sort((a, b) => (b.total || 0) - (a.total || 0) || a.peak - b.peak);
    });

    // ---- Artists: everyone credited on a charted song or album, or charted as an artist ----
    const splitCredits = (artist, title = '') => {
      const names = String(artist).split(/\s*(?:,|&| featuring | feat\. | x )\s*/i);
      const feat = String(title).match(/\((?:feat\.|featuring|with|avec) ([^)]+)\)/i);
      if (feat) names.push(...feat[1].split(/\s*(?:,|&)\s*/));
      return [...new Set(names.map(n => artistName(n.trim())).filter(Boolean))];
    };
    const A = new Map();
    const artistEntry = name => {
      const k = norm(name);
      if (!A.has(k)) A.set(k, { key: k, name, h: null, albums: [], songs: [] });
      return A.get(k);
    };
    H.artists.forEach(h => { const a = artistEntry(h.title); a.h = h; a.name = h.title; });
    H.albums.forEach(h => splitCredits(h.artist).forEach(n => { const a = artistEntry(n); if (!a.albums.includes(h)) a.albums.push(h); }));
    H.songs.forEach(h => splitCredits(h.artist, h.title).forEach(n => { const a = artistEntry(n); if (!a.songs.includes(h)) a.songs.push(h); }));
    A.forEach(a => {
      a.albums.sort((x, y) => (y.total || 0) - (x.total || 0));
      a.songs.sort((x, y) => (y.total || 0) - (x.total || 0));
      a.total = a.h ? a.h.total : (T.artists.get(a.key) || {}).total || 0;
    });

    return { M, H, T, years, allYears, sourcesOf, yearEnd, yearEndAll, allTime, allTimeAll, replay, library, artists: A, splitCredits };
  }

  const api = { CHART_SIZE, YEAR_END_SIZE, ALL_TIME_SIZE, YEAR_END_METHOD, ALL_TIME_METHOD, CATS, norm, build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Charts = api;
})(typeof window !== "undefined" ? window : globalThis);
