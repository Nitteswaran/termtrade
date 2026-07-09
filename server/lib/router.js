// Station-to-station journey planner: Dijkstra over the GTFS graph.
// Ride edges come from trip profiles (real travel times); transfer edges
// connect stops within walking distance. Leg geometry is sliced from the
// real track shapes so the highlighted path follows the viaducts.
import { haversine } from './gtfs.js';

const TRANSFER_RADIUS_M = 400;
const TRANSFER_PENALTY_S = 420;

export function buildGraph(gtfs) {
  const adj = new Map(); // stopId -> [{ to, secs, routeId, tripId, fromIdx, toIdx }]
  const edge = (a, e) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(e);
  };

  // one representative weekday trip per route+direction
  const reps = {};
  for (const p of Object.values(gtfs.profiles)) {
    if (p.serviceId !== 'MonFri') continue;
    reps[`${p.routeId}_${p.directionId}`] = p;
  }
  for (const p of Object.values(reps)) {
    for (let i = 0; i < p.points.length - 1; i++) {
      const a = p.points[i], b = p.points[i + 1];
      edge(a.stopId, { to: b.stopId, secs: Math.max(30, b.tArr - a.tDep), routeId: p.routeId, tripId: p.tripId, fromIdx: i, toIdx: i + 1 });
    }
  }

  // walking transfers between nearby stops
  const stops = Object.values(gtfs.stops);
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const a = stops[i], b = stops[j];
      if (Math.abs(a.lat - b.lat) > 0.005 || Math.abs(a.lon - b.lon) > 0.005) continue;
      const d = haversine([a.lon, a.lat], [b.lon, b.lat]);
      if (d <= TRANSFER_RADIUS_M) {
        const secs = TRANSFER_PENALTY_S + Math.round(d / 1.2);
        edge(a.id, { to: b.id, secs, routeId: null });
        edge(b.id, { to: a.id, secs, routeId: null });
      }
    }
  }
  return adj;
}

export function findRoute(gtfs, adj, fromId, toId) {
  if (!gtfs.stops[fromId] || !gtfs.stops[toId]) return null;
  const dist = new Map([[fromId, 0]]);
  const prev = new Map();
  const done = new Set();
  const queue = [[0, fromId]];
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [d, u] = queue.shift();
    if (done.has(u)) continue;
    done.add(u);
    if (u === toId) break;
    for (const e of adj.get(u) ?? []) {
      // small penalty when switching lines even at the same platform
      const prevEdge = prev.get(u)?.edge;
      const switchPenalty = prevEdge && e.routeId && prevEdge.routeId && prevEdge.routeId !== e.routeId ? 240 : 0;
      const nd = d + e.secs + switchPenalty;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { from: u, edge: e });
        queue.push([nd, e.to]);
      }
    }
  }
  if (!dist.has(toId)) return null;

  // unwind path
  const hops = [];
  let cur = toId;
  while (cur !== fromId) {
    const p = prev.get(cur);
    if (!p) break;
    hops.unshift({ from: p.from, to: cur, ...p.edge });
    cur = p.from;
  }

  // group into legs by route (null route = walk/transfer)
  const legs = [];
  for (const h of hops) {
    const last = legs[legs.length - 1];
    if (last && last.routeId === h.routeId) {
      last.stops.push(h.to);
      last.secs += h.secs;
    } else {
      legs.push({ routeId: h.routeId, stops: [h.from, h.to], secs: h.secs, tripId: h.tripId });
    }
  }

  // slice real shape geometry for ride legs
  for (const leg of legs) {
    if (!leg.routeId) {
      leg.coords = leg.stops.map((s) => [gtfs.stops[s].lon, gtfs.stops[s].lat]);
      continue;
    }
    const profile = gtfs.profiles[leg.tripId];
    const shape = profile && gtfs.shapes[profile.shapeId];
    if (!shape) {
      leg.coords = leg.stops.map((s) => [gtfs.stops[s].lon, gtfs.stops[s].lat]);
      continue;
    }
    const byStop = Object.fromEntries(profile.points.map((pt) => [pt.stopId, pt.dist]));
    const d0 = byStop[leg.stops[0]], d1 = byStop[leg.stops[leg.stops.length - 1]];
    leg.coords = sliceShape(shape, Math.min(d0, d1), Math.max(d0, d1));
    if (d1 < d0) leg.coords.reverse();
  }

  return {
    totalSecs: dist.get(toId),
    legs: legs.map((l) => ({
      routeId: l.routeId,
      mode: l.routeId ? 'ride' : 'walk',
      secs: l.secs,
      stops: l.stops,
      stopNames: l.stops.map((s) => gtfs.stops[s]?.name ?? s),
      coords: l.coords,
    })),
  };
}

function sliceShape(shape, dA, dB) {
  const { coords, cum } = shape;
  const out = [];
  for (let i = 0; i < coords.length; i++) {
    if (cum[i] >= dA && cum[i] <= dB) out.push(coords[i]);
  }
  if (out.length < 2) out.push(...interpEnds(shape, dA, dB));
  return out;
}

function interpEnds(shape, dA, dB) {
  const pt = (d) => {
    const { coords, cum } = shape;
    for (let i = 1; i < cum.length; i++) {
      if (cum[i] >= d) {
        const t = (d - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
        return [coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0]), coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1])];
      }
    }
    return shape.coords[shape.coords.length - 1];
  };
  return [pt(dA), pt(dB)];
}
