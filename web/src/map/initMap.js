import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { daylightFactor } from '../lib/solar.js';

export const KL_CENTER = [101.6958, 3.1466]; // KLCC-ish

export function createMap(container) {
  const q = new URLSearchParams(location.search);
  const map = new maplibregl.Map({
    container,
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [+(q.get('lon') ?? KL_CENTER[0]), +(q.get('lat') ?? KL_CENTER[1])],
    zoom: +(q.get('z') ?? 14.6),
    pitch: +(q.get('p') ?? 62),
    bearing: +(q.get('b') ?? -24),
    maxPitch: 85,
    antialias: true,
    attributionControl: { compact: true },
  });
  return map;
}

// Extruded 3D buildings from the vector source's `building` layer.
export function addBuildings(map, night) {
  const src = Object.keys(map.getStyle().sources).find((s) => map.getSource(s).type === 'vector');
  if (!src) return;
  const labelLayer = map.getStyle().layers.find((l) => l.type === 'symbol' && l.layout?.['text-field'])?.id;
  map.addLayer(
    {
      id: 'tt-3d-buildings',
      source: src,
      'source-layer': 'building',
      type: 'fill-extrusion',
      minzoom: 13,
      paint: {
        'fill-extrusion-color': night
          ? ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#12161f', 80, '#1c2433', 220, '#2a3447']
          : ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#dfd9cf', 220, '#c9cfd9'],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, ['coalesce', ['get', 'render_height'], 6]],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': night ? 0.92 : 0.85,
      },
    },
    labelLayer
  );
}

// Route lines (glow + core) and station dots from the GTFS network.
export function addNetwork(map, network) {
  const features = Object.entries(network.shapes).map(([id, s]) => ({
    type: 'Feature',
    properties: { shapeId: id, color: routeColorForShape(id, network.routes) },
    geometry: { type: 'LineString', coordinates: s.coords },
  }));
  map.addSource('tt-routes', { type: 'geojson', data: { type: 'FeatureCollection', features } });
  map.addLayer({
    id: 'tt-routes-glow',
    type: 'line',
    source: 'tt-routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 10, 'line-opacity': 0.14, 'line-blur': 4 },
  });
  map.addLayer({
    id: 'tt-routes-core',
    type: 'line',
    source: 'tt-routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 2.2, 'line-opacity': 0.85 },
  });

  const stops = Object.values(network.stops).map((s) => ({
    type: 'Feature',
    properties: { name: title(s.name), color: network.routes[s.routeId]?.color ?? '#8ea0b5' },
    geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
  }));
  map.addSource('tt-stops', { type: 'geojson', data: { type: 'FeatureCollection', features: stops } });
  map.addLayer({
    id: 'tt-stops-dots',
    type: 'circle',
    source: 'tt-stops',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 15, 4.5],
      'circle-color': '#ffffff',
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'tt-stops-labels',
    type: 'symbol',
    source: 'tt-stops',
    minzoom: 13.5,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
    },
    paint: { 'text-color': '#9fb2c8', 'text-halo-color': 'rgba(5,8,14,0.85)', 'text-halo-width': 1.4 },
  });
}

function routeColorForShape(shapeId, routes) {
  // shp_AG_0 -> AG ; shp_MRT_0 belongs to Kajang line (KGL)
  const key = shapeId.replace(/^shp_/, '').replace(/_\d+$/, '');
  const aliases = { MRT: 'KGL' };
  return routes[aliases[key] ?? key]?.color ?? '#8ea0b5';
}

const title = (s) => s.toLowerCase().replace(/(^|\s|\()\S/g, (c) => c.toUpperCase());

// Night palette applied over the day style — dims ground, water, roads.
export function applyNight(map, night) {
  const styleLayers = map.getStyle().layers;
  const set = (id, prop, v) => map.getLayer(id) && map.setPaintProperty(id, prop, v);
  for (const l of styleLayers) {
    if (l.id.startsWith('tt-')) continue;
    try {
      if (l.type === 'background') set(l.id, 'background-color', night ? '#070a12' : undefined);
      else if (l.type === 'fill' && /water/i.test(l.id)) set(l.id, 'fill-color', night ? '#0a1220' : undefined);
      else if (l.type === 'fill' && /land|park|grass|wood|green/i.test(l.id)) set(l.id, 'fill-color', night ? '#0b1018' : undefined);
      else if (l.type === 'fill') set(l.id, 'fill-opacity', night ? 0.25 : undefined);
      else if (l.type === 'line') {
        set(l.id, 'line-opacity', night ? 0.35 : undefined);
        if (/motorway|trunk|primary/.test(l.id)) set(l.id, 'line-color', night ? '#3d3520' : undefined);
      } else if (l.type === 'symbol') {
        set(l.id, 'text-color', night ? '#8494ac' : undefined);
        set(l.id, 'text-halo-color', night ? 'rgba(6,9,15,0.9)' : undefined);
      }
    } catch {}
  }
}

export function isNight() {
  return daylightFactor(Date.now()) < 0.45;
}

// WASD / QE free-fly camera on top of MapLibre's drag-rotate controls.
export function attachFlyCam(map) {
  const keys = new Set();
  const onDown = (e) => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.code);
  };
  const onUp = (e) => keys.delete(e.code);
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);

  let raf;
  function step() {
    raf = requestAnimationFrame(step);
    if (!keys.size) return;
    const speed = 0.000012 * Math.pow(2, 16 - map.getZoom()) * 400;
    const b = (map.getBearing() * Math.PI) / 180;
    let dx = 0, dy = 0;
    if (keys.has('KeyW')) { dx += Math.sin(b); dy += Math.cos(b); }
    if (keys.has('KeyS')) { dx -= Math.sin(b); dy -= Math.cos(b); }
    if (keys.has('KeyA')) { dx -= Math.cos(b); dy += Math.sin(b); }
    if (keys.has('KeyD')) { dx += Math.cos(b); dy -= Math.sin(b); }
    if (dx || dy) {
      const c = map.getCenter();
      map.setCenter([c.lng + dx * speed, c.lat + dy * speed]);
    }
    if (keys.has('KeyQ')) map.setBearing(map.getBearing() - 1.2);
    if (keys.has('KeyE')) map.setBearing(map.getBearing() + 1.2);
    if (keys.has('KeyR')) map.setZoom(map.getZoom() + 0.02);
    if (keys.has('KeyF')) map.setZoom(map.getZoom() - 0.02);
    if (keys.has('KeyT')) map.setPitch(Math.min(85, map.getPitch() + 0.8));
    if (keys.has('KeyG')) map.setPitch(Math.max(0, map.getPitch() - 0.8));
  }
  step();
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
  };
}
