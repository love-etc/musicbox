#!/usr/bin/env node
// Sanity checks for the chart maths. Run after `npm run build`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Load the two browser scripts the same way the page does
const window = {};
new Function('window', readFileSync(join(ROOT, 'site/data.js'), 'utf8'))(window);
new Function('window', 'module', readFileSync(join(ROOT, 'site/charts.js'), 'utf8'))(window, undefined);
const C = window.Charts;
const X = C.build(window.MUSICBOX);
let bad = 0;
const fail = msg => { bad++; console.log('FAIL', msg); };
for (const cat of C.CATS) {
  X.M.forEach((m, i) => {
    const prev = i ? new Map(X.M[i - 1].data[cat].map(e => [e.key, e.rank])) : null;
    const seen = new Set();
    m.data[cat].forEach(e => {
      if (seen.has(e.key)) fail(`${m.month} ${cat}: duplicate ${e.title}`); seen.add(e.key);
      const lw = prev ? prev.get(e.key) ?? null : null;
      if (e.lw !== lw) fail(`${m.month} ${cat} ${e.title}: LM ${e.lw} should be ${lw}`);
      const charted = X.M.slice(0, i).some(p => p.data[cat].some(x => x.key === e.key));
      const kind = !prev ? 'first' : lw === null ? (charted ? 're' : 'new') : lw > e.rank ? 'up' : lw < e.rank ? 'down' : 'same';
      if (e.mv.kind !== kind) fail(`${m.month} ${cat} ${e.title}: move ${e.mv.kind} should be ${kind}`);
      const past = X.M.slice(0, i + 1).map(p => p.data[cat].find(x => x.key === e.key)).filter(Boolean);
      if (e.peak !== Math.min(...past.map(x => x.rank))) fail(`${m.month} ${cat} ${e.title}: peak`);
      if (e.months !== past.length) fail(`${m.month} ${cat} ${e.title}: months`);
    });
  });
  for (const y of X.allYears) {
    const v = X.yearEnd[y][cat].map(r => r.value);
    if (v.some((p, i) => i && p > v[i - 1])) fail(`${y} ${cat} year-end not sorted`);
    // Apple-style totals: the year value is never below Apple's own full-year number
    if (C.YEAR_END_METHOD === 'totals' && X.replay[y]) X.replay[y][cat].forEach(e => {
      const r = X.yearEndAll[y][cat].get(e.key);
      if (!r || r.value < e.val) fail(`${y} ${cat} ${e.title}: year total ${r && r.value} below Replay ${e.val}`);
    });
  }
  // Library totals equal the sum of the per-year totals
  X.H[cat].forEach(h => { const s = Object.values(h.byYear || {}).reduce((a, b) => a + b, 0); if (s !== (h.total || 0)) fail(`${cat} ${h.title}: total mismatch`); });
  // Every charted entry remains eligible for awards, including those below the library cap.
  assert.equal(X.awards[cat].months.length, X.H[cat].size);
  for (const rows of Object.values(X.awards[cat])) {
    rows.forEach((r, i) => {
      assert.ok(!i || rows[i - 1].value >= r.value, `${cat}: awards must be descending`);
      assert.equal(r.rank, i && rows[i - 1].value === r.value ? rows[i - 1].rank : i + 1);
    });
  }
}

// Small histories exercise calendar gaps, December -> January, returns and ties.
const fixtureMonth = (month, entries, source = 'apple') => ({
  month, source, artists: entries,
  songs: entries.map(([title, val]) => [title, 'Test Artist', val]),
  albums: entries.map(([title, val]) => [title, 'Test Artist', val])
});
const fixture = C.build({ months: [
  fixtureMonth('2023-11', [['A', 50], ['B', 40], ['C', 20]]),
  fixtureMonth('2023-12', [['B', 60], ['A', 40], ['C', 20]]),
  fixtureMonth('2024-01', [['A', 80], ['B', 60], ['C', 20]]),
  fixtureMonth('2024-03', [['A', 60], ['B', 50], ['C', 20]]),
  fixtureMonth('2024-04', [['B', 90], ['C', 20]])
] });
for (const cat of C.CATS) {
  const awards = fixture.awards[cat];
  assert.deepEqual(awards.no1.map(r => [r.h.title, r.value]), [['A', 3], ['B', 2]]);
  assert.deepEqual(awards.streak.map(r => [r.h.title, r.value, r.start, r.end, r.rank]),
    [['A', 3, 0, 2, 1], ['B', 3, 0, 2, 1], ['C', 3, 0, 2, 1]]);
  assert.deepEqual(awards.monthly.map(r => [r.h.title, r.value, r.start]), [['B', 90, 4], ['A', 80, 2], ['C', 20, 0]]);
  assert.deepEqual(awards.no1Streak.map(r => [r.h.title, r.value, r.rank]), [['A', 1, 1], ['B', 1, 1]]);
  assert.deepEqual(awards.months.map(r => [r.h.title, r.value, r.rank]), [['B', 5, 1], ['C', 5, 1], ['A', 4, 3]]);
}
const calendar = ['2023-12', '2024-01', '2024-02', '2024-03', '2024-04'].map(month => ({ month }));
assert.deepEqual(C.longestRun([{ rank: 1 }, null, { rank: 1 }, { rank: 1 }, { rank: 1 }], calendar),
  { value: 3, start: 2, end: 4 }, 'A return starts a new run');
assert.deepEqual(C.longestRun([{ rank: 1 }, { rank: 1 }, { rank: 2 }, { rank: 1 }, null], calendar, 1),
  { value: 2, start: 0, end: 1 }, 'Dropping below No. 1 breaks a No. 1 streak');
assert.deepEqual(C.longestRun([null, null], calendar), { value: 0, start: -1, end: -1 });
const merged = C.build({ months: [fixtureMonth('2024-01', [['A', 30]]), fixtureMonth('2024-01', [['A', 40]], 'spotify')] });
for (const cat of C.CATS) {
  assert.equal(merged.awards[cat].monthly[0].value, 70, 'Monthly awards combine sources');
  assert.equal(merged.awards[cat].no1[0].value, 1, 'A merged month counts only once');
}
const empty = C.build({ months: [] });
for (const cat of C.CATS) assert.ok(Object.values(empty.awards[cat]).every(rows => rows.length === 0));
console.log(bad ? `${bad} problem(s)` : `OK: ${X.M.length} months checked, positions continue across ${X.years.join(', ')}; year-end method: ${C.YEAR_END_METHOD}; awards, ties and calendar streaks verified`);
process.exit(bad ? 1 : 0);
