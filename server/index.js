import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadGTFS } from './lib/gtfs.js';
import { activeTrains, klClock } from './lib/sim.js';
import { KtmbFeed } from './lib/ktmb.js';

const PORT = process.env.PORT || 8787;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('[termtrade] loading GTFS…');
const gtfs = loadGTFS();
console.log(`[termtrade] ${Object.keys(gtfs.shapes).length} shapes, ${Object.keys(gtfs.profiles).length} trip profiles, ${Object.keys(gtfs.stops).length} stops`);

const ktmb = new KtmbFeed();
ktmb.start();

const app = express();

// Static network payload the client needs once at startup.
const network = {
  routes: gtfs.routes,
  stops: gtfs.stops,
  shapes: Object.fromEntries(
    Object.entries(gtfs.shapes).map(([id, s]) => [id, { coords: s.coords.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]), length: Math.round(s.length) }])
  ),
};
app.get('/api/network', (_req, res) => res.json(network));
app.get('/api/health', (_req, res) =>
  res.json({ ok: true, ktmb: { vehicles: ktmb.vehicles.length, lastFetch: ktmb.lastFetch, error: ktmb.error } })
);

const dist = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html'), (err) => err && res.status(404).end()));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function snapshot() {
  const now = Date.now();
  const { secs } = klClock(now);
  let trains = activeTrains(gtfs, now);
  let demo = false;
  if (trains.length === 0) {
    // Outside service hours: replay the timetable on a virtual peak-hour
    // clock so the city never goes dark. Flagged so the UI can say so.
    const demoSecs = 8.5 * 3600 + (secs % (14 * 3600));
    trains = activeTrains(gtfs, now, demoSecs);
    demo = true;
  }
  return JSON.stringify({
    type: 'snapshot',
    t: now,
    kl: secs,
    demo,
    trains: trains.map((tr) => ({
      id: tr.id,
      r: tr.routeId,
      dir: tr.directionId,
      sh: tr.shapeId,
      d: Math.round(tr.dist * 10) / 10,
      v: Math.round(tr.speed * 100) / 100,
      o: tr.doors ? 1 : 0,
      ns: tr.nextStop,
      hs: tr.headsign,
    })),
    ktmb: ktmb.vehicles,
  });
}

setInterval(() => {
  if (!wss.clients.size) return;
  const msg = snapshot();
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}, 1000);

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', network: null })); // network via REST; keep socket lean
  ws.send(snapshot());
});

server.listen(PORT, () => console.log(`[termtrade] http://localhost:${PORT}  ws://localhost:${PORT}/ws`));
