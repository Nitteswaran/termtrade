// Frequency-based train simulation along real GTFS shapes.
// Trains depart every headway within each service band and follow the
// trip's time–distance profile (dwell at stations = doors open).

const KL_OFFSET = 8 * 3600 * 1000; // Asia/Kuala_Lumpur, UTC+8, no DST

export function klClock(nowMs = Date.now()) {
  const kl = new Date(nowMs + KL_OFFSET);
  const secs = kl.getUTCHours() * 3600 + kl.getUTCMinutes() * 60 + kl.getUTCSeconds() + kl.getUTCMilliseconds() / 1000;
  const dow = kl.getUTCDay(); // 0=Sun
  return { secs, dow };
}

function serviceIdFor(dow) {
  if (dow === 0) return 'Sun';
  if (dow === 6) return 'Sat';
  return 'MonFri';
}

export function activeTrains(gtfs, nowMs = Date.now(), secsOverride = null) {
  const { secs: realSecs, dow } = klClock(nowMs);
  const secs = secsOverride ?? realSecs;
  const service = serviceIdFor(dow);
  const trains = [];

  for (const [tripId, bands] of Object.entries(gtfs.frequencies)) {
    const profile = gtfs.profiles[tripId];
    if (!profile || profile.serviceId !== service) continue;
    for (const band of bands) {
      // departures in [band.start, min(band.end, secs)] that are still running
      const firstRelevant = Math.max(band.start, Math.ceil((secs - profile.duration - band.start) / band.headway) * band.headway + band.start);
      for (let dep = firstRelevant; dep <= band.end && dep <= secs; dep += band.headway) {
        const elapsed = secs - dep;
        if (elapsed < 0 || elapsed > profile.duration) continue;
        const state = positionAt(profile, elapsed);
        if (!state) continue;
        trains.push({
          id: `${tripId}@${dep}`,
          routeId: profile.routeId,
          directionId: profile.directionId,
          shapeId: profile.shapeId,
          headsign: profile.headsign,
          ...state,
        });
      }
    }
  }
  return trains;
}

function positionAt(profile, elapsed) {
  const pts = profile.points;
  if (!pts.length) return null;
  // find the segment containing `elapsed`
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (elapsed <= p.tDep) {
      if (elapsed >= p.tArr) {
        // dwelling at station i — doors open
        return { dist: p.dist, speed: 0, doors: true, atStop: p.stopId, nextStop: pts[i + 1]?.stopId ?? p.stopId };
      }
      // travelling between i-1 and i
      const prev = pts[i - 1];
      if (!prev) return { dist: p.dist, speed: 0, doors: true, atStop: p.stopId, nextStop: p.stopId };
      const t0 = prev.tDep, t1 = p.tArr;
      const span = Math.max(1, t1 - t0);
      const f = Math.min(1, Math.max(0, (elapsed - t0) / span));
      // ease in/out within the segment => realistic acceleration + braking
      const eased = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      const dist = prev.dist + eased * (p.dist - prev.dist);
      const segLen = p.dist - prev.dist;
      // instantaneous speed = derivative of eased curve
      const dfdt = (f < 0.5 ? 4 * f : 4 * (1 - f)) / span;
      return { dist, speed: Math.max(0, segLen * dfdt), doors: false, atStop: null, nextStop: p.stopId };
    }
  }
  const last = pts[pts.length - 1];
  return { dist: last.dist, speed: 0, doors: true, atStop: last.stopId, nextStop: last.stopId };
}
