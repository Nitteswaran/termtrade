// Client-side train state. Snapshots arrive at 1 Hz stamped with server
// time; we render ~1.2 s in the past and interpolate between buffered
// authoritative states, so motion is perfectly smooth — no dead-reckoning
// jitter, no rubber-banding. Falls back to capped extrapolation if a
// snapshot is late.
import { sampleShape, segBearing, lerpAngle } from './geo.js';

const RENDER_DELAY_MS = 1200;
const LIVE_DELAY_MS = 16000; // KTMB feed updates every ~15 s
const MAX_EXTRAPOLATE_MS = 2500;

export class TrainWorld {
  constructor(shapes) {
    this.shapes = shapes;
    this.sim = new Map();
    this.live = new Map();
    this.demo = false;
    this.clockOffset = 0; // serverTime - clientTime
    this.hiddenRoutes = new Set();
  }

  ingest(snapshot) {
    this.demo = !!snapshot.demo;
    const off = snapshot.t - Date.now();
    this.clockOffset = this.clockOffset === 0 ? off : this.clockOffset * 0.9 + off * 0.1;

    const seen = new Set();
    for (const t of snapshot.trains) {
      seen.add(t.id);
      let tr = this.sim.get(t.id);
      if (!tr) {
        tr = { id: t.id, routeId: t.r, shapeId: t.sh, headsign: t.hs, dir: t.dir, buf: [], doorAnim: t.o ? 1 : 0 };
        this.sim.set(t.id, tr);
      }
      tr.buf.push({ t: snapshot.t, d: t.d, v: t.v, doors: !!t.o, ns: t.ns });
      if (tr.buf.length > 4) tr.buf.shift();
    }
    for (const id of this.sim.keys()) if (!seen.has(id)) this.sim.delete(id);

    const seenLive = new Set();
    for (const v of snapshot.ktmb || []) {
      seenLive.add(v.id);
      let tr = this.live.get(v.id);
      if (!tr) {
        tr = { id: v.id, routeId: v.routeId, label: v.label, buf: [], bearing: v.bearing ?? 0, doors: false, doorAnim: 0 };
        this.live.set(v.id, tr);
      }
      tr.label = v.label;
      tr.speed = v.speed;
      const last = tr.buf[tr.buf.length - 1];
      if (!last || last.lon !== v.lon || last.lat !== v.lat) {
        tr.buf.push({ t: snapshot.t, lon: v.lon, lat: v.lat, bearing: v.bearing });
        if (tr.buf.length > 4) tr.buf.shift();
      }
    }
    for (const id of this.live.keys()) if (!seenLive.has(id)) this.live.delete(id);
  }

  // Advance & return trains to render. dt = seconds since last frame.
  tick(dt) {
    const out = [];
    const now = Date.now() + this.clockOffset;
    const rt = now - RENDER_DELAY_MS;

    for (const tr of this.sim.values()) {
      if (this.hiddenRoutes.has(tr.routeId) || !tr.buf.length) continue;
      const st = sampleBuffer(tr.buf, rt, (a, b, f) => a.d + (b.d - a.d) * f, (last, dtms) => last.d + last.v * Math.min(dtms, MAX_EXTRAPOLATE_MS) / 1000);
      const cur = nearestState(tr.buf, rt);
      tr.doors = cur.doors;
      tr.nextStop = cur.ns;
      tr.speed = cur.v;
      tr.doorAnim += ((tr.doors ? 1 : 0) - tr.doorAnim) * Math.min(1, dt * 3);
      const shape = this.shapes[tr.shapeId];
      if (!shape) continue;
      tr.dist = st; // consumed by the layer for per-car articulation
      const { pos, bearing } = sampleShape(shape, st);
      tr.lon = pos[0];
      tr.lat = pos[1];
      tr.bearing = bearing;
      out.push(tr);
    }

    const lrt = now - LIVE_DELAY_MS;
    for (const tr of this.live.values()) {
      if (this.hiddenRoutes.has('KTMB') || !tr.buf.length) continue;
      const lon = sampleBuffer(tr.buf, lrt, (a, b, f) => a.lon + (b.lon - a.lon) * f, (l) => l.lon);
      const lat = sampleBuffer(tr.buf, lrt, (a, b, f) => a.lat + (b.lat - a.lat) * f, (l) => l.lat);
      const prev = { lon: tr.lon ?? lon, lat: tr.lat ?? lat };
      tr.lon = lon;
      tr.lat = lat;
      const moved = Math.abs(lon - prev.lon) + Math.abs(lat - prev.lat) > 1e-7;
      const target = tr.buf[tr.buf.length - 1].bearing ?? (moved ? segBearing([prev.lon, prev.lat], [lon, lat]) : tr.bearing);
      tr.bearing = lerpAngle(tr.bearing, target, Math.min(1, dt * 2));
      out.push(tr);
    }
    return out;
  }
}

function sampleBuffer(buf, rt, lerp, extrapolate) {
  if (rt <= buf[0].t) return lerp(buf[0], buf[0], 0);
  for (let i = 0; i < buf.length - 1; i++) {
    if (rt <= buf[i + 1].t) {
      const f = (rt - buf[i].t) / Math.max(1, buf[i + 1].t - buf[i].t);
      return lerp(buf[i], buf[i + 1], f);
    }
  }
  const last = buf[buf.length - 1];
  return extrapolate(last, rt - last.t);
}

function nearestState(buf, rt) {
  for (let i = buf.length - 1; i >= 0; i--) if (buf[i].t <= rt) return buf[i];
  return buf[0];
}
