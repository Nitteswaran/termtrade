// Client-side train state machine. Snapshots arrive at 1 Hz; this advances
// every train at 60 fps using its last known speed, then gently corrects
// toward each new authoritative distance — no jumping, no rubber-banding.
import { sampleShape, segBearing, lerpAngle } from './geo.js';

export class TrainWorld {
  constructor(shapes) {
    this.shapes = shapes; // id -> prepared shape
    this.sim = new Map(); // simulated rail trains
    this.live = new Map(); // KTMB GPS trains
    this.demo = false;
  }

  ingest(snapshot) {
    this.demo = !!snapshot.demo;
    const seen = new Set();
    for (const t of snapshot.trains) {
      seen.add(t.id);
      const cur = this.sim.get(t.id);
      if (cur) {
        cur.targetDist = t.d;
        cur.speed = t.v;
        cur.doors = !!t.o;
        cur.nextStop = t.ns;
      } else {
        this.sim.set(t.id, {
          id: t.id, routeId: t.r, shapeId: t.sh, headsign: t.hs, dir: t.dir,
          dist: t.d, targetDist: t.d, speed: t.v, doors: !!t.o, nextStop: t.ns,
          doorAnim: t.o ? 1 : 0,
        });
      }
    }
    for (const id of this.sim.keys()) if (!seen.has(id)) this.sim.delete(id);

    const seenLive = new Set();
    for (const v of snapshot.ktmb || []) {
      seenLive.add(v.id);
      const cur = this.live.get(v.id);
      if (cur) {
        // start a 15 s glide from current rendered position to the new fix
        cur.from = { lon: cur.lon, lat: cur.lat };
        cur.to = { lon: v.lon, lat: v.lat };
        cur.t0 = performance.now();
        cur.dur = 15000;
        cur.speed = v.speed;
        cur.targetBearing = v.bearing ?? segBearing([cur.lon, cur.lat], [v.lon, v.lat]);
        cur.label = v.label;
        cur.routeId = v.routeId;
      } else {
        this.live.set(v.id, {
          id: v.id, lon: v.lon, lat: v.lat,
          from: { lon: v.lon, lat: v.lat }, to: { lon: v.lon, lat: v.lat },
          t0: performance.now(), dur: 15000,
          bearing: v.bearing ?? 0, targetBearing: v.bearing ?? 0,
          speed: v.speed, label: v.label, routeId: v.routeId, doors: false, doorAnim: 0,
        });
      }
    }
    for (const id of this.live.keys()) if (!seenLive.has(id)) this.live.delete(id);
  }

  // Advance all trains by dt seconds; returns render list.
  tick(dt) {
    const out = [];
    const hidden = this.hiddenRoutes ?? new Set();
    for (const tr of this.sim.values()) {
      if (hidden.has(tr.routeId)) continue;
      // dead-reckon with authoritative correction (proportional pull)
      tr.dist += tr.speed * dt;
      tr.dist += (tr.targetDist - tr.dist) * Math.min(1, dt * 1.5);
      tr.doorAnim += ((tr.doors ? 1 : 0) - tr.doorAnim) * Math.min(1, dt * 3);
      const shape = this.shapes[tr.shapeId];
      if (!shape) continue;
      const { pos, bearing } = sampleShape(shape, tr.dist);
      tr.lon = pos[0]; tr.lat = pos[1]; tr.bearing = bearing;
      out.push(tr);
    }
    const now = performance.now();
    for (const tr of this.live.values()) {
      if (hidden.has('KTMB')) continue;
      const f = Math.min(1, (now - tr.t0) / tr.dur);
      const e = f * (2 - f); // ease-out
      tr.lon = tr.from.lon + (tr.to.lon - tr.from.lon) * e;
      tr.lat = tr.from.lat + (tr.to.lat - tr.from.lat) * e;
      tr.bearing = lerpAngle(tr.bearing, tr.targetBearing, Math.min(1, dt * 2));
      out.push(tr);
    }
    return out;
  }
}
