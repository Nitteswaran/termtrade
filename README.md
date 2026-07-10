# TERMTRADE

**Malaysia transit, live in 3D.** A Moovit-style tracker where you fly around a real 3D Kuala Lumpur and watch every LRT, MRT, Monorail, BRT and KTM train move in real time.

![stack](https://img.shields.io/badge/three.js-black) ![stack](https://img.shields.io/badge/MapLibre_GL-blue) ![stack](https://img.shields.io/badge/GTFS--Realtime-green) ![stack](https://img.shields.io/badge/WebSocket-purple)

## What it does

- **Real-time trains** — KTMB (Komuter/ETS) positions come straight from the official
  [data.gov.my GTFS-Realtime feed](https://developer.data.gov.my/realtime-api/gtfs-realtime)
  (`vehicle-position/ktmb`), polled every 15 s and pushed to the browser over WebSocket.
- **Schedule-accurate simulation** — Rapid Rail KL (Kelana Jaya, Ampang, Sri Petaling, Kajang,
  Putrajaya, Monorail, BRT Sunway, Shah Alam) publishes no realtime rail feed yet, so termtrade
  replays the official GTFS static timetable (`frequencies.txt` headways + `stop_times.txt`
  segment times) along the real `shapes.txt` track geometry — dwell times, acceleration and
  braking included.
- **3D city** — MapLibre GL + OpenFreeMap vector tiles with extruded buildings; free-fly camera
  (WASD/QE/RF/TG + mouse orbit).
- **Metro EMU 3D models** — extruded rounded-profile consists per line (PBR steel + flush
  glazing with PMREM environment reflections, line liveries, door animation, glowing windows
  at night), riding exactly on the GTFS track geometry with line-colored glow pads.
- **Journey planner** — From/Destination station search with autocomplete; Dijkstra over the
  GTFS graph (ride times from timetables + walking transfers) returns legs traced along real
  track shapes, highlighted on the map.
- **Buttery motion** — the server broadcasts authoritative states at 1 Hz; the client
  dead-reckons at 60 fps along the track spline and eases corrections in, rotating each consist
  to the track bearing (with smoothed cornering).
- **Real day/night** — sun position computed for Kuala Lumpur (NOAA approximation) drives scene
  lighting, window glow and the map's night palette. Force it with `?light=day` / `?light=night`.
- **Honest service hours** — outside real operating hours the map shows zero trains and a
  "network closed · first train HH:MM" badge, exactly like the real network. (`REPLAY=1` env
  replays the timetable for development.)
- **Self-refreshing GTFS** — on boot (and daily) the server pulls fresh timetables from
  `api.data.gov.my/gtfs-static/ktmb` and `…/gtfs-static/prasarana?category=rapid-rail-kl`,
  validates them, and falls back to the vendored copies on any failure.

## API keys (optional)

Copy `.env.example` to `.env` in the project root (it is git-ignored):

```bash
cp .env.example .env
```

| key | where to get it | what it unlocks |
|---|---|---|
| `MAPTILER_KEY` | https://cloud.maptiler.com/account/keys (free tier) | Much more detailed basemap (MapTiler Streets v2, day + dark variants) instead of the default OpenFreeMap style |
| `GOOGLE_MAPS_API_KEY` | https://console.cloud.google.com/google/maps-apis — enable **Map Tiles API** (billing required) | Google **Photorealistic 3D Tiles**: the real photogrammetry city (buildings, terrain, trees) rendered with three.js/3d-tiles-renderer under the route lines and trains |

No keys are required — without them the app uses the free OpenFreeMap basemap.

## Run it

```bash
npm install
npm run build   # build the web app once
npm start       # http://localhost:8787
```

Dev mode (Vite HMR on :5173, API proxied):

```bash
npm run dev
```

## URL params

| param | example | effect |
|---|---|---|
| `lon`,`lat`,`z`,`p`,`b` | `?lon=101.71&lat=3.158&z=16&p=60&b=45` | share a camera position |
| `light` | `?light=day` | force day/night lighting |

## Architecture

```
server/            Node (ESM)
  lib/gtfs.js      GTFS static parser → shapes with cumulative distances,
                   time–distance trip profiles (stops projected onto shapes)
  lib/sim.js       frequency-based simulation (KL clock, dwell = doors open)
  lib/ktmb.js      GTFS-Realtime protobuf poller (gtfs-realtime-bindings)
  index.js         Express + ws; /api/network + 1 Hz snapshots on /ws
  data/            vendored GTFS static (rapid-rail-kl, ktmb)

web/               Vite + React 18
  lib/interp.js    per-train dead-reckoning + correction, KTMB GPS glide
  lib/geo.js       polyline sampling: position + smoothed bearing at distance d
  lib/solar.js     sun position / daylight factor for KL
  map/initMap.js   MapLibre setup, 3D buildings, route glow lines, night palette, fly-cam
  three/trainModels.js  procedural livery-accurate consists (swap for GLB later)
  three/TrainsLayer.js  MapLibre custom layer hosting the three.js scene
                        (origin-relative matrices → no float32 jitter at close zoom)
```

### Data sources

- [Malaysia official open API — GTFS Realtime & Static](https://developer.data.gov.my/realtime-api/gtfs-realtime) (KTMB realtime; Prasarana `rapid-rail-kl` static: shapes, frequencies, stop_times)
- [OpenFreeMap](https://openfreemap.org) vector tiles (© OpenMapTiles, © OpenStreetMap contributors)

### Swapping in marketplace 3D models

The consists live in `web/src/three/trainModels.js`. To use a purchased/free GLB
(Sketchfab, CGTrader, TurboSquid, BlenderKit — search "KLAV Innovia", "Siemens Inspiro",
"KTM Class 92"), load it with `GLTFLoader`, orient it forward = +X / up = +Y, and return it from
`buildTrain(kind)` — positioning, rotation, doors hook and lighting keep working. Note: pick a
**metro/EMU** model that matches KL rolling stock, and keep it under ~5 MB (meshopt/Draco).

## Refreshing GTFS data

```bash
curl -Lo /tmp/rail.zip "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl"
unzip -o /tmp/rail.zip -d server/data/rapid-rail-kl
curl -Lo /tmp/ktmb.zip "https://api.data.gov.my/gtfs-static/ktmb"
unzip -o /tmp/ktmb.zip -d server/data/ktmb
```
