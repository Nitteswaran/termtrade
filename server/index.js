import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadGTFS } from './lib/gtfs.js';
import { activeTrains, klClock, nextServiceStart } from './lib/sim.js';
import { KtmbFeed } from './lib/ktmb.js';
import { loadEnv } from './lib/env.js';
import { buildGraph, findRoute } from './lib/router.js';
import { refreshGTFS } from './lib/fetchGtfs.js';

loadEnv();
const PORT = process.env.PORT || 8787;
// REPLAY=1 (dev only): replay the timetable outside service hours
const REPLAY = process.env.REPLAY === '1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pull fresh GTFS from api.data.gov.my; falls back to vendored data.
console.log('[termtrade] refreshing GTFS from data.gov.my…');
const refreshed = await refreshGTFS().catch((e) => ({ error: String(e) }));
console.log('[termtrade] gtfs refresh:', JSON.stringify(refreshed));
setInterval(() => refreshGTFS().then((r) => console.log('[termtrade] daily gtfs refresh:', JSON.stringify(r))), 24 * 3600 * 1000).unref();

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

app.get('/api/config', (_req, res) =>
  res.json({
    maptilerKey: process.env.MAPTILER_KEY || null,
    googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || null,
  })
);

const graph = buildGraph(gtfs);
app.get('/api/route', (req, res) => {
  const { from, to } = req.query;
  const route = findRoute(gtfs, graph, from, to);
  if (!route) return res.status(404).json({ error: 'no route found' });
  res.json(route);
});
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
  let replay = false;
  let closed = null;
  if (trains.length === 0) {
    // Real world: network is closed. Report when service resumes.
    // (REPLAY=1 dev flag replays the timetable instead.)
    if (REPLAY) {
      const demoSecs = 8.5 * 3600 + (secs % (14 * 3600));
      trains = activeTrains(gtfs, now, demoSecs);
      replay = true;
    } else {
      closed = nextServiceStart(gtfs, now);
    }
  }
  return JSON.stringify({
    type: 'snapshot',
    t: now,
    kl: secs,
    replay,
    closed,
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
