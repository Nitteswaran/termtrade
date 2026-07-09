// Shape geometry helpers: cumulative distances + smooth sampling of
// position and bearing at any distance along a track.

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function prepareShape(shape) {
  const cum = [0];
  const c = shape.coords;
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + haversine(c[i - 1], c[i]));
  return { ...shape, cum, length: cum[cum.length - 1] };
}

// Position [lon,lat] + bearing (deg, clockwise from north) at distance d.
export function sampleShape(shape, d) {
  const { coords, cum } = shape;
  const n = coords.length;
  if (d <= 0) return { pos: coords[0], bearing: segBearing(coords[0], coords[1]) };
  if (d >= cum[n - 1]) return { pos: coords[n - 1], bearing: segBearing(coords[n - 2], coords[n - 1]) };
  // binary search
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const t = (d - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
  const a = coords[lo], b = coords[hi];
  const pos = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  // blend bearing across the vertex for smooth cornering
  const brg = segBearing(a, b);
  let blended = brg;
  const BLEND = 25; // meters of bearing smoothing around vertices
  if (t < 0.5 && lo > 0 && d - cum[lo] < BLEND) {
    const prev = segBearing(coords[lo - 1], a);
    blended = lerpAngle(prev, brg, 0.5 + (d - cum[lo]) / (2 * BLEND));
  } else if (t >= 0.5 && hi < n - 1 && cum[hi] - d < BLEND) {
    const next = segBearing(b, coords[hi + 1]);
    blended = lerpAngle(brg, next, 0.5 - (cum[hi] - d) / (2 * BLEND));
  }
  return { pos, bearing: blended };
}

export function segBearing(a, b) {
  const dLon = rad(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function lerpAngle(a, b, t) {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}
