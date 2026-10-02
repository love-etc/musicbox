#!/usr/bin/env node
// Sanity checks for the chart maths. Run after `npm run build`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
}
console.log(bad ? `${bad} problem(s)` : `OK: ${X.M.length} months checked, positions continue across ${X.years.join(', ')}; year-end method: ${C.YEAR_END_METHOD}`);
process.exit(bad ? 1 : 0);
