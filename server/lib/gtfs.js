import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV } from './csv.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'rapid-rail-kl');

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
export function haversine(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function parseTime(t) {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function load(name) {
  return parseCSV(fs.readFileSync(path.join(DIR, name), 'utf8'));
}

export function loadGTFS() {
  const routes = {};
  for (const r of load('routes.txt')) {
    routes[r.route_id] = {
      id: r.route_id,
      shortName: r.route_short_name,
      name: r.route_long_name,
      color: '#' + r.route_color,
      category: r.category, // LRT | MRT | MRL | BRT
    };
  }

  // shapes: id -> { coords, cum (meters), length }
  const shapes = {};
  for (const p of load('shapes.txt')) {
    (shapes[p.shape_id] ??= { coords: [] }).coords.push([+p.shape_pt_lon, +p.shape_pt_lat, +p.shape_pt_sequence]);
  }
  for (const s of Object.values(shapes)) {
    s.coords.sort((a, b) => a[2] - b[2]);
    s.coords = s.coords.map((c) => [c[0], c[1]]);
    s.cum = [0];
    for (let i = 1; i < s.coords.length; i++) s.cum.push(s.cum[i - 1] + haversine(s.coords[i - 1], s.coords[i]));
    s.length = s.cum[s.cum.length - 1];
  }

  const stops = {};
  for (const s of load('stops.txt')) {
    stops[s.stop_id] = { id: s.stop_id, name: s.stop_name, lat: +s.stop_lat, lon: +s.stop_lon, routeId: s.route_id };
  }

  const trips = {}; // trip_id -> { routeId, directionId, shapeId, headsign }
  for (const t of load('trips.txt')) {
    trips[t.trip_id] = { routeId: t.route_id, serviceId: t.service_id, directionId: +t.direction_id, shapeId: t.shape_id, headsign: t.trip_headsign };
  }

  // stop_times grouped by trip
  const stopTimes = {};
  for (const st of load('stop_times.txt')) {
    (stopTimes[st.trip_id] ??= []).push({
      arr: parseTime(st.arrival_time),
      dep: parseTime(st.departure_time),
      stopId: st.stop_id,
      seq: +st.stop_sequence,
    });
  }
  for (const list of Object.values(stopTimes)) list.sort((a, b) => a.seq - b.seq);

  // frequencies: trip_id -> [{ start, end, headway }]
  const frequencies = {};
  for (const f of load('frequencies.txt')) {
    (frequencies[f.trip_id] ??= []).push({ start: parseTime(f.start_time), end: parseTime(f.end_time), headway: +f.headway_secs });
  }

  // Build time–distance profiles per trip: stops projected onto shape,
  // times relative to first departure.
  const profiles = {};
  for (const [tripId, sts] of Object.entries(stopTimes)) {
    const trip = trips[tripId];
    if (!trip || !shapes[trip.shapeId]) continue;
    const shape = shapes[trip.shapeId];
    const t0 = sts[0].dep;
    let searchFrom = 0;
    const points = [];
    for (const st of sts) {
      const stop = stops[st.stopId];
      if (!stop) continue;
      const { dist, idx } = projectOnShape(shape, [stop.lon, stop.lat], searchFrom);
      searchFrom = idx;
      points.push({ tArr: st.arr - t0, tDep: st.dep - t0, dist, stopId: st.stopId });
    }
    // ensure monotonic distances
    for (let i = 1; i < points.length; i++) if (points[i].dist <= points[i - 1].dist) points[i].dist = points[i - 1].dist + 1;
    profiles[tripId] = { tripId, ...trip, points, duration: points[points.length - 1].tArr };
  }

  return { routes, shapes, stops, trips, frequencies, profiles };
}

// Nearest point on polyline starting the search at segment index `from`
// (keeps stop ordering monotonic along the shape).
function projectOnShape(shape, pt, from = 0) {
  let best = { d2: Infinity, dist: 0, idx: from };
  const { coords, cum } = shape;
  for (let i = from; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    const abx = b[0] - a[0], aby = b[1] - a[1];
    const apx = pt[0] - a[0], apy = pt[1] - a[1];
    const len2 = abx * abx + aby * aby;
    const t = len2 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2)) : 0;
    const px = a[0] + t * abx, py = a[1] + t * aby;
    const dx = pt[0] - px, dy = pt[1] - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < best.d2) best = { d2, dist: cum[i] + t * (cum[i + 1] - cum[i]), idx: i };
    // early exit: once we've found a very close match and are moving away, stop
    if (best.d2 < 1e-9 && d2 > best.d2 * 100 && i > best.idx + 20) break;
  }
  return best;
}
