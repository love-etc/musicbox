// Shared by the streaming-history importers (Spotify, Deezer): turns a list of
// streams into monthly (or weekly) top lists in the same format as data/charts/.
import { writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const TZ = 'America/Sao_Paulo';
export const DEPTH = 50;      // keep the top 50 of each list; the site charts the top CHART_SIZE
export const MIN_MINUTES = 30; // skip months with less listening than this (stray plays)

// "2019-10:2021-04" "2026-01" ... -> Set of "YYYY-MM"
export function monthRange(ranges) {
  const months = new Set();
  for (const r of ranges) {
    const [a, b = a] = r.split(':');
    let [y, m] = a.split('-').map(Number);
    const [y2, m2] = b.split('-').map(Number);
    while (y * 12 + m <= y2 * 12 + m2) { months.add(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  }
  return months;
}

export function findFiles(dir, re) {
  const files = [];
  (function walk(d) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (re.test(f)) files.push(p);
    }
  })(dir);
  return files;
}

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayOf = ts => fmt.format(new Date(ts));            // "YYYY-MM-DD", São Paulo time
export const monthOf = ts => dayOf(ts).slice(0, 7);
// Billboard-style tracking weeks run Friday to Thursday; a week is named by its Friday.
const DAY = 864e5;
export function weekOf(ts) {
  const d = dayOf(ts), t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return new Date(t - ((new Date(t).getUTCDay() + 2) % 7) * DAY).toISOString().slice(0, 10);
}
// A week belongs to the month (and year) its Monday falls in, i.e. where most of its days are
export const weekMonth = week => new Date(Date.parse(week + 'T00:00:00Z') + 3 * DAY).toISOString().slice(0, 7);

// Titles are tidied to match Apple's style
const VERSION = /remix|mix\b|edit\b|version|live|acoustic|instrumental|demo|mono|stereo|session|unplugged|a cappella|reprise|interlude|recorded|^feat\.|^with |from .*soundtrack|taylor'?s version/i;
export function cleanTrack(t) {
  const i = t.indexOf(' - ');
  if (i < 0) return t;
  const head = t.slice(0, i), tail = t.slice(i + 3);
  if (/remaster|bonus track/i.test(tail)) return head;
  if (VERSION.test(tail)) return `${head} (${tail})`;
  return t;   // a real subtitle, e.g. "God Bless America - And All the Beautiful Women In It"
}
const KEEP = /rare n|platinum blonde|moonlight|3am|paradise|everasking|taylor|from the vault/i;
const PACKAGING = /remaster|deluxe|expanded|bonus track|anniversary|edition|special|explicit|super deluxe/i;
export function cleanAlbum(a) {
  return a
    .replace(/\s*[([]([^)\]]*)[)\]]/g, (m, x) => (KEEP.test(x) || !PACKAGING.test(x)) ? m : '')
    .replace(/\s+-\s+(.*remaster.*|single|ep)$/i, '')
    .replace(/(\s*[-:–]\s*|\s+)((super )?deluxe( edition| version)?|expanded edition|anniversary edition|special edition|bonus track version)$/i, '')
    .replace(/\s+\d+(st|nd|rd|th)? anniversary( edition| version)?$/i, '')
    .trim();
}

// streams: iterable of { ts (ISO string or ms, UTC), title, artist, album, ms, lead? }
// `lead` (default: artist) is who gets the minutes in the artist and album lists.
// Duplicates must already be dropped. Writes <root>/<outDir>/YYYY-MM.json for each month in `months`,
// or with period 'week', <outDir>/YYYY-MM-DD.json for each Friday-to-Thursday week in those months.
export function writeMonths(streams, { root, outDir, source, label, months, period = 'month', depth = DEPTH }) {
  const weekly = period === 'week';
  const B = new Map();
  let kept = 0;
  for (const r of streams) {
    const mo = weekly ? weekOf(r.ts) : monthOf(r.ts);
    if (!months.has(weekly ? weekMonth(mo) : mo)) continue;
    kept++;
    if (!B.has(mo)) B.set(mo, { ms: 0, plays: 0, artists: new Map(), songs: new Map(), albums: new Map() });
    const b = B.get(mo), ms = r.ms, play = ms >= 30000 ? 1 : 0;
    const title = cleanTrack(r.title), album = cleanAlbum(r.album || ''), artist = r.artist, lead = r.lead || r.artist;
    b.ms += ms; b.plays += play;
    b.artists.set(lead, (b.artists.get(lead) || 0) + ms);
    const sk = title + '\u0001' + artist;
    const s = b.songs.get(sk) || { title, artist, plays: 0, ms: 0 };
    s.plays += play; s.ms += ms; b.songs.set(sk, s);
    if (album) {
      // Albums are grouped by name and credited to the artist with the most minutes on them
      const al = b.albums.get(album) || { title: album, ms: 0, by: new Map() };
      al.ms += ms; al.by.set(lead, (al.by.get(lead) || 0) + ms); b.albums.set(album, al);
    }
  }
  const min = ms => Math.round(ms / 60000);
  mkdirSync(join(root, outDir), { recursive: true });
  const rows = list => list.map(r => '    ' + JSON.stringify(r)).join(',\n');
  for (const mo of [...B.keys()].sort()) {
    const b = B.get(mo);
    if (min(b.ms) < MIN_MINUTES) { console.log(`${mo}: only ${min(b.ms)} min, skipped`); continue; }
    const artists = [...b.artists].sort((x, y) => y[1] - x[1]).slice(0, depth).map(([n, ms]) => [n, min(ms)]);
    const songs = [...b.songs.values()].filter(s => s.plays).sort((x, y) => y.plays - x.plays || y.ms - x.ms).slice(0, depth).map(s => [s.title, s.artist, s.plays]);
    const albums = [...b.albums.values()].sort((x, y) => y.ms - x.ms).slice(0, depth)
      .map(a => [a.title, [...a.by].sort((x, y) => y[1] - x[1])[0][0], min(a.ms)]);
    const out = `{
  "${weekly ? 'week' : 'month'}": "${mo}",
  "source": "${source}",
  "total": {"value": ${min(b.ms)}, "unit": "min"},
  "note": "${label} streaming history: ${b.plays} plays of 30s or more, ${min(b.ms)} minutes.",
  "artists": [
${rows(artists)}
  ],
  "songs": [
${rows(songs)}
  ],
  "albums": [
${rows(albums)}
  ]
}
`;
    writeFileSync(join(root, outDir, mo + '.json'), out);
    console.log(`${mo}: ${min(b.ms)} min, ${b.plays} plays → ${outDir}/${mo}.json`);
  }
  return kept;
}
