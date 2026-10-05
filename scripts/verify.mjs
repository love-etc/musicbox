#!/usr/bin/env node
// Sanity checks for the chart maths. Run after `npm run build`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { reconstructCollections } from './reconstruct-collections.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Load the two browser scripts the same way the page does
const window = {};
// Checks site/data.js, or another site's data.js: node scripts/verify.mjs site/l
const SITE = (process.argv[2] || 'site').replace(/\/$/, '');
new Function('window', readFileSync(join(ROOT, SITE, 'data.js'), 'utf8'))(window);
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

// Album grouping happens before ranks, but annual totals are reconciled per release.
const releaseFixture = {
  releases: { excludeAlbums: ['Excluded — Test Artist'], groups: [
    { title: 'Album', artist: 'Test Artist', releases: ['Single'] }
  ] },
  months: [
    fixtureMonth('2024-01', [['Excluded', 400], ['Rival', 120], ['Album', 100], ['Single', 30]]),
    fixtureMonth('2024-01', [['Album', 20], ['Single', 5]], 'spotify'),
    fixtureMonth('2024-02', [['Album', 200], ['Single', 40]])
  ],
  replay: { 2024: { albums: [['Excluded', 'Test Artist', 1000], ['Rival', 'Test Artist', 550], ['Album', 'Test Artist', 500], ['Single', 'Test Artist', 90]] } },
  tracks: { 'Single — Test Artist': ['Single'] }
};
const grouped = C.build(releaseFixture), albumKey = 'album|testartist';
assert.deepEqual(grouped.M[0].data.albums.map(e => [e.title, e.val, e.rank]), [['Album', 155, 1], ['Rival', 120, 2]]);
assert.equal(grouped.H.albums.get(albumKey).months, 2);
assert.equal(grouped.T.albums.get(albumKey).total, 615, '500 + 90 annual minutes plus 25 Spotify minutes');
assert.deepEqual(grouped.replay[2024].albums.map(e => [e.title, e.val, e.rank]), [['Album', 590, 1], ['Rival', 550, 2]]);
assert.equal(grouped.H.songs.get('single|testartist').album.key, albumKey);
assert.equal(grouped.albumRedirects.get('single|testartist'), albumKey);
assert.ok(!grouped.T.albums.has('excluded|testartist'));
assert.ok(!grouped.H.albums.has('single|testartist'));
const withoutSingleReplay = structuredClone(releaseFixture);
withoutSingleReplay.replay[2024].albums.pop();
assert.equal(C.build(withoutSingleReplay).T.albums.get(albumKey).total, 595,
  'Album Replay must not swallow 70 monthly single minutes + 25 Spotify minutes');

// Removing an ineligible single fills the open chart slot; it does not leave a gap.
const refill = C.build({ releases: releaseFixture.releases,
  months: [fixtureMonth('2024-01', [['Excluded', 1000], ...Array.from({ length: 16 }, (_, i) => ['Entry ' + i, 100 - i])])] });
assert.equal(refill.M[0].data.albums.length, C.CHART_SIZE);
assert.equal(refill.M[0].data.albums.at(-1).title, 'Entry 14');

const collectionMonth = fixtureMonth('2024-01', [...Array.from({ length: 16 }, (_, i) => ['Entry ' + i, 100 - i]), ['Single', 1]]);
collectionMonth.songs = [['Single', 'Test Artist', 5]];
const unchartedCollection = C.build({
  releases: { groups: [{ title: 'Collection', artist: 'Test Artist', kind: 'Singles collection', releases: ['Single'] }] },
  months: [collectionMonth], tracks: { 'Collection — Test Artist': ['Single'] }
});
const collectionKey = 'collection|testartist';
assert.equal(unchartedCollection.albumPages.get(collectionKey).months, 0);
assert.equal(unchartedCollection.albumPages.get(collectionKey).total, 1);
assert.ok(unchartedCollection.library.albums.some(h => h.key === collectionKey));
assert.ok(!unchartedCollection.H.albums.has(collectionKey), 'Uncharted collections must not gain fake chart history');
assert.ok(Object.values(unchartedCollection.awards.albums).every(rows => rows.every(r => r.h.key !== collectionKey)));
assert.equal(unchartedCollection.H.songs.get('single|testartist').album.key, collectionKey);

// Recover actual playback, including short streams, without doubling exported duplicates.
const collectionGroup = { title: 'Collection', artist: 'Test Artist', kind: 'Singles collection', releases: ['Single', 'B-side'] };
const stream = (ts, title, ms = 60000, artist = 'Test Artist') => ({
  ts, master_metadata_track_name: title, master_metadata_album_artist_name: artist,
  ms_played: ms, spotify_track_uri: 'test:' + title
});
const sample = stream('2024-02-01T01:00:00Z', 'Single'); // Still January in São Paulo.
const recovered = reconstructCollections([collectionGroup], new Set(['2024-01']), [
  sample, { ...sample }, stream('2024-01-12T12:00:00Z', 'Single (feat. Guest)', 120000),
  stream('2024-01-13T12:00:00Z', 'B-side', 20000), stream('2024-01-13T12:01:00Z', 'B-side', 20000),
  stream('2024-01-14T12:00:00Z', 'Single - Recorded at Spotify Studios NYC'),
  stream('2024-01-14T12:00:00Z', 'Single (Remix)'), stream('2024-01-15T12:00:00Z', 'Single', 60000, 'Other Artist'),
  stream('2024-02-02T12:00:00Z', 'Single'), stream('2024-01-16T12:00:00Z', 'Single', -10000)
]);
assert.deepEqual(recovered.months, [{ month: '2024-01', source: 'spotify', albums: [
  ['Single', 'Test Artist', 3], ['B-side', 'Test Artist', 1]
] }]);
const reconstructionFixture = {
  releases: { groups: [collectionGroup] }, collectionListening: recovered,
  months: [fixtureMonth('2024-01', [['Rival', 4], ['Single', 1]], 'spotify'), fixtureMonth('2024-01', [['Single', 2]])]
};
const reconstructed = C.build(reconstructionFixture);
assert.deepEqual(reconstructed.M[0].data.albums.map(e => [e.title, e.val]), [['Collection', 6], ['Rival', 4]],
  'Replace partial Spotify minutes, add missing singles, and preserve Apple minutes before ranking');
assert.equal(reconstructed.T.albums.get(collectionKey).total, 6, 'Recovered minutes must not be counted twice');
const unrecovered = C.build({ ...reconstructionFixture, collectionListening: {} });
for (const cat of ['songs', 'artists']) {
  assert.deepEqual(reconstructed.M[0].data[cat], unrecovered.M[0].data[cat], `${cat} must not change during collection recovery`);
}

// Album minutes from songs: Replay months credit an album with at least its songs' plays × length,
// capped at the artist's minutes; never lowers a listed album, and other sources are left alone.
const estFixture = {
  months: [{ month: '2024-01', source: 'apple', artists: [['Test Artist', 50], ['Other', 30]],
    songs: [['Hit', 'Test Artist', 10], ['Deep Cut', 'Test Artist', 4]],
    albums: [['Rival', 'Other', 30], ['Album', 'Test Artist', 5]] },
  { month: '2024-02', source: 'spotify', artists: [['Test Artist', 9]],
    songs: [['Hit', 'Test Artist', 3]], albums: [['Album', 'Test Artist', 9]] }],
  tracks: { 'Album — Test Artist': ['Hit', 'Deep Cut'] },
  lengths: { 'Hit — Test Artist': 180, 'Deep Cut — Test Artist': 240 }
};
const est = C.build(estFixture);
assert.deepEqual(est.M[0].data.albums.map(e => [e.title, e.val]), [['Album', 46], ['Rival', 30]], '10×3 + 4×4 minutes');
assert.deepEqual(est.M[1].data.albums.map(e => [e.title, e.val]), [['Album', 9]], 'exact sources stay as they are');
assert.equal(est.T.albums.get('album|testartist').total, 55);
estFixture.months[0].artists[0][1] = 40;
assert.equal(C.build(estFixture).M[0].data.albums[0].val, 40, 'capped at the artist’s minutes');
assert.equal(C.build({ ...estFixture, lengths: undefined }).M[0].data.albums[0].title, 'Rival', 'off without lengths');

// Credit cleanup joins tagged, untagged and already combined imports without losing links.
const creditFixture = {
  months: [{ month: '2024-01', source: 'apple', artists: [['Lead', 100]],
    albums: [['Album', 'Lead', 1]], songs: [['Hit (feat. Guest)', 'Lead', 4], ['Hit', 'Lead & Guest', 3]] }],
  tracks: { 'Album — Lead': ['Hit'] }, lengths: { 'Hit (feat. Guest) — Lead': 180 },
  images: [['song', 'Hit', 'Lead', 'cover.jpg']],
  replay: { 2024: { songs: [['Hit', 'Lead', 20]] } }
};
const credited = C.build(creditFixture), hitKey = 'hit|leadguest';
assert.deepEqual(credited.M[0].data.songs.map(e => [e.title, e.artist, e.val]), [['Hit', 'Lead & Guest', 7]]);
assert.equal(credited.T.songs.get(hitKey).total, 20, 'Replay and monthly variants share one identity');
assert.equal(credited.T.albums.get('album|lead').total, 21, 'Normalized song references retain their recorded duration');
assert.equal(credited.H.songs.get(hitKey).album.key, 'album|lead');
assert.equal(credited.songRedirects.get('hit|lead'), hitKey, 'Old song URLs still work');
assert.equal(credited.artists.get('guest').songs[0].key, hitKey);
assert.ok(!credited.T.artists.has('guest'), 'Guest credits do not invent artist listening minutes');
const names = C.catalog({});
assert.deepEqual(names.rename('songs', 'Song (with Guest) [feat. Other] (Live)', 'Lead'), ['Song (Live)', 'Lead, Guest & Other']);
assert.deepEqual(names.rename('songs', 'Song (feat. Kim Petras and Jay Park)', 'Lead'), ['Song', 'Lead, Kim Petras & Jay Park']);
assert.deepEqual(names.rename('songs', 'Song (feat. Elvira, Mistress of the Dark)', 'Lead'), ['Song', 'Lead & Elvira, Mistress of the Dark']);
assert.deepEqual(names.splitCredits('Lead & Elvira, Mistress of the Dark'), ['Lead', 'Elvira, Mistress of the Dark']);
assert.deepEqual(names.rename('songs', 'Song featuring Guest', 'Lead'), ['Song', 'Lead & Guest']);
assert.deepEqual(names.rename('songs', 'Song (feat. Guest)', 'Lead & Guest'), ['Song', 'Lead & Guest']);
assert.deepEqual(names.rename('songs', 'Song', 'Fitz and The Tantrums'), ['Song', 'Fitz and The Tantrums']);
assert.deepEqual(names.rename('songs', 'Floating Free (Beauty & the Beat featuring Nuke Remix)', 'Vibrasphere'),
  ['Floating Free (Beauty & the Beat featuring Nuke Remix)', 'Vibrasphere'], 'Keep remix descriptions intact');

const exclusionFixture = {
  releases: { excludeArtists: ['Hidden Artist'], excludeSongs: ['Hidden Song — Kept Artist'], excludeAlbums: ['Hidden Song — Kept Artist'] },
  months: [{ month: '2024-01', source: 'apple', artists: [['Hidden Artist', 100], ['Kept Artist', 50]],
    albums: [['Hidden Album', 'Hidden Artist', 100], ['Hidden Song', 'Kept Artist', 30], ['Kept Album', 'Kept Artist', 20]],
    songs: [['Hidden Song', 'Kept Artist', 30], ['Other Song', 'Hidden Artist', 20], ['Kept Song', 'Kept Artist', 10]] }],
  replay: { 2024: { artists: [['Hidden Artist', 100]], albums: [['Hidden Album', 'Hidden Artist', 100]], songs: [['Hidden Song', 'Kept Artist', 30]] } }
};
const excluded = C.build(exclusionFixture);
assert.deepEqual(excluded.M[0].data.songs.map(e => [e.title, e.rank]), [['Kept Song', 1]]);
assert.deepEqual(excluded.M[0].data.albums.map(e => [e.title, e.rank]), [['Kept Album', 1]]);
assert.deepEqual(excluded.M[0].data.artists.map(e => [e.title, e.rank]), [['Kept Artist', 1]]);
assert.ok(!excluded.artists.has('hiddenartist'));
for (const cat of C.CATS) assert.equal(excluded.replay[2024][cat].length, 0);

const withoutGroups = { ...window.MUSICBOX.releases, groups: [] };
const original = C.build({ ...window.MUSICBOX, releases: withoutGroups });
const beforeRecovery = C.build({ ...window.MUSICBOX, releases: withoutGroups, collectionListening: {} });
for (const cat of ['songs', 'artists']) {
  const history = db => db.M.map(m => m.data[cat].map(e => [e.key, e.val, e.rank, e.peak, e.months]));
  const totals = db => [...db.T[cat].values()].map(t => [t.key, t.total]);
  assert.deepEqual(history(X), history(beforeRecovery), `${cat} charts must stay unchanged by album rules and recovery`);
  assert.deepEqual(totals(X), totals(beforeRecovery), `${cat} listening must stay unchanged by album rules and recovery`);
}
for (const group of window.MUSICBOX.releases?.groups || []) {
  const key = title => C.norm(title) + '|' + C.norm(group.artist);
  const members = new Set([key(group.title), ...group.releases.map(key)]);
  const expected = [...members].reduce((sum, k) => sum + (original.T.albums.get(k)?.total || 0), 0);
  assert.equal(X.T.albums.get(key(group.title))?.total, expected, `${group.title}: preserve all member listening`);
  for (const member of members) if (member !== key(group.title)) assert.ok(!X.T.albums.has(member));
}
console.log(bad ? `${bad} problem(s)` : `OK (${SITE}): ${X.M.length} ${X.period}ly charts checked; chart history, awards, calendar streaks, release groups and listening totals verified`);
process.exit(bad ? 1 : 0);
