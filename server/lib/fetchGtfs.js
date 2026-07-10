// Refresh GTFS static from the official data.gov.my endpoints at boot and
// daily. Downloads are validated before replacing the vendored files, so
// API downtime, empty responses or schema surprises never take the app
// down — it just keeps serving the last good dataset.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

const FEEDS = [
  {
    name: 'rapid-rail-kl',
    url: 'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl',
    required: ['routes.txt', 'trips.txt', 'stops.txt', 'stop_times.txt', 'shapes.txt', 'frequencies.txt'],
  },
  {
    name: 'ktmb',
    url: 'https://api.data.gov.my/gtfs-static/ktmb',
    required: ['routes.txt', 'trips.txt', 'stops.txt', 'stop_times.txt'],
  },
];

export async function refreshGTFS() {
  const results = {};
  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed.url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new Error(`suspiciously small response (${buf.length} B)`);
      const zip = new AdmZip(buf);
      const names = new Set(zip.getEntries().map((e) => path.basename(e.entryName)));
      const missing = feed.required.filter((f) => !names.has(f));
      if (missing.length) throw new Error(`missing files: ${missing.join(', ')}`);
      // validated — replace files in place
      const dir = path.join(DATA, feed.name);
      fs.mkdirSync(dir, { recursive: true });
      for (const entry of zip.getEntries()) {
        const base = path.basename(entry.entryName);
        if (!base.endsWith('.txt') || entry.isDirectory || entry.entryName.includes('__MACOSX')) continue;
        fs.writeFileSync(path.join(dir, base), entry.getData());
      }
      results[feed.name] = { ok: true, bytes: buf.length };
    } catch (err) {
      results[feed.name] = { ok: false, error: String(err.message || err) };
    }
  }
  return results;
}
