// Compact solar-position math (NOAA approximation) — enough for
// day/night lighting that tracks real Kuala Lumpur time.
const rad = Math.PI / 180;

export function sunPosition(date, lat = 3.139, lon = 101.6869) {
  const days = date / 86400000 - 10957.5; // days since J2000
  const M = rad * (357.5291 + 0.98560028 * days);
  const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M)) + rad * 102.9372 + Math.PI;
  const e = rad * 23.4397;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const theta = rad * (280.16 + 360.9856235 * days) + rad * lon;
  const H = theta - ra;
  const phi = rad * lat;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
  return { altitude, azimuth }; // radians; altitude<0 => night
}

// 0 = deep night, 1 = full day, smooth twilight in between.
// Overridable for demos/testing via ?light=day|night.
const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('light') : null;

export function daylightFactor(date) {
  if (forced === 'day') return 1;
  if (forced === 'night') return 0;
  const { altitude } = sunPosition(date);
  const deg = (altitude * 180) / Math.PI;
  return Math.max(0, Math.min(1, (deg + 6) / 12)); // civil twilight ramp
}
