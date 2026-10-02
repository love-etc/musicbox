#!/usr/bin/env node
// Turns a Deezer data export (the deezer-data_*.xlsx you get from Deezer's
// "My personal data" page) into monthly lists in data/deezer/.
//
//   node scripts/import-deezer.mjs "deezer data" 2018-11:2019-09
//
// Reads the "listeningHistory" sheet of every deezer-data_*.xlsx in the folder (no
// spreadsheet library needed: the .xlsx is unzipped and read directly). Same rules
// as the Spotify import: São Paulo months, plays are 30 seconds or more, minutes
// count everything, months under 30 minutes are skipped. Deezer's dates are UTC.
// Comma-separated artist lists become "A & B", credited to the first artist.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { monthRange, findFiles, writeMonths } from './lib/history.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [src = 'deezer data', ...ranges] = process.argv.slice(2);
const months = monthRange(ranges.length ? ranges : ['2018-11:2019-09']);
const files = findFiles(join(ROOT, src), /^deezer-data.*\.xlsx$/i);

// ---- Minimal .xlsx reader: zip directory -> shared strings -> one sheet's rows ----
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nl);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    out.set(name, () => (method === 8 ? inflateRawSync(raw) : raw).toString('utf8'));
    p += 46 + nl + xl + cl;
  }
  return out;
}
const unxml = s => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (m, e) =>
  ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e] ??
  String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)));
const text = x => unxml([...x.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''));

function readSheet(file, wanted) {
  const z = unzip(readFileSync(file));
  const strings = z.has('xl/sharedStrings.xml')
    ? [...z.get('xl/sharedStrings.xml')().matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => text(m[1])) : [];
  const wb = z.get('xl/workbook.xml')(), rels = z.get('xl/_rels/workbook.xml.rels')();
  const sheet = [...wb.matchAll(/<sheet\b[^>]*>/g)].map(m => m[0]).find(s => wanted.test(s.match(/name="([^"]*)"/)[1]));
  if (!sheet) throw new Error(`${file}: no sheet matching ${wanted}`);
  const rid = sheet.match(/r:id="([^"]*)"/)[1];
  const target = rels.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*>`))[0].match(/Target="([^"]*)"/)[1];
  const xml = z.get(target.startsWith('/') ? target.slice(1) : 'xl/' + target)();
  const col = ref => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(r => {
    const row = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] || '';
      const i = col(attrs.match(/r="([A-Z]+\d+)"/)[1]), t = (attrs.match(/t="([^"]*)"/) || [])[1];
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      row[i] = t === 's' ? strings[+v] : t === 'inlineStr' ? text(body) : v === undefined ? '' : unxml(v);
    }
    return row;
  });
}

const seen = new Set(), streams = [];
for (const f of files) {
  const [head, ...rows] = readSheet(f, /listeninghistory/i);
  const at = name => { const i = head.indexOf(name); if (i < 0) throw new Error(`${f}: no "${name}" column`); return i; };
  const T = at('Song Title'), A = at('Artist'), L = at('Album Title'), S = at('Listening Time'), D = at('Date'), I = head.indexOf('ISRC');
  for (const r of rows) {
    if (!r[T] || !r[D]) continue;
    const k = r[D] + '|' + (r[I] || r[T]) + '|' + r[S];
    if (seen.has(k)) continue;
    seen.add(k);
    // Deezer lists every artist ("Lady Gaga, Bradley Cooper"). The first one is the lead; the
    // song credit drops anyone already in the title's "(feat. ...)" and reads "A & B" like Apple.
    const names = String(r[A]).split(', ');
    const feat = (String(r[T]).match(/\((?:feat\.|featuring|with) ([^)]*)\)/i) || [])[1] || '';
    const credit = names.filter((n, i) => !i || !feat.includes(n));
    const artist = credit.length > 1 ? credit.slice(0, -1).join(', ') + ' & ' + credit[credit.length - 1] : credit[0];
    streams.push({ ts: r[D].replace(' ', 'T') + 'Z', title: r[T], artist, lead: names[0], album: r[L], ms: (+r[S] || 0) * 1000 });
  }
}
const kept = writeMonths(streams, { root: ROOT, outDir: 'data/deezer', source: 'deezer', label: 'Deezer', months });
console.log(`${files.length} files, ${streams.length} streams, ${kept} in the requested months`);
