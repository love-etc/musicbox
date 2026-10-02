#!/usr/bin/env node
// Turns Spotify "Extended Streaming History" exports into monthly lists in data/spotify/.
//
//   node scripts/import-spotify.mjs "spotify data" 2018-11:2021-04 2026-01:2026-03
//
// - Reads every Streaming_History_Audio_*.json under the given folder (any number of
//   accounts), drops exact duplicates, and buckets streams by month in São Paulo time.
// - Minutes = all time played. Plays = streams of 30 seconds or more (Spotify's rule).
// - Months with under 30 minutes are skipped.
// - Albums are grouped by album name, credited to the artist with the most minutes on it,
//   so compilations don't split up.
// - Titles are tidied to match Apple's style: " - Remastered 2011" is dropped,
//   " - Radio Edit" becomes " (Radio Edit)", packaging tags like "(Deluxe Edition)" go.
// The output holds the top 50 of each list; the site charts the top CHART_SIZE.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { monthRange, findFiles, writeMonths } from './lib/history.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [src = 'spotify data', ...ranges] = process.argv.slice(2);
const months = monthRange(ranges.length ? ranges : ['2018-11:2021-04']);
const files = findFiles(join(ROOT, src), /^Streaming_History_Audio_.*\.json$/);

const seen = new Set(), streams = [];
for (const f of files) {
  for (const r of JSON.parse(readFileSync(f, 'utf8'))) {
    if (!r.master_metadata_track_name) continue;               // podcasts, audiobooks
    const k = r.ts + '|' + r.spotify_track_uri + '|' + r.ms_played;
    if (seen.has(k)) continue;
    seen.add(k);
    streams.push({ ts: r.ts, title: r.master_metadata_track_name, artist: r.master_metadata_album_artist_name,
      album: r.master_metadata_album_album_name, ms: r.ms_played });
  }
}
const kept = writeMonths(streams, { root: ROOT, outDir: 'data/spotify', source: 'spotify', label: 'Spotify', months });
console.log(`${files.length} files, ${streams.length} track streams, ${kept} in the requested months`);
