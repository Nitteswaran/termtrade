// MapLibre custom layer hosting the three.js scene: all trains, sun/moon
// lighting, door + window FX. Positions come from TrainWorld each frame.
import * as THREE from 'three';
import maplibregl from 'maplibre-gl';
import { buildTrain, updateTrainFX } from './trainModels.js';
import { sunPosition, daylightFactor } from '../lib/solar.js';

const DEG = Math.PI / 180;

export class TrainsLayer {
  constructor(world, routes) {
    this.id = 'termtrade-trains';
    this.type = 'custom';
    this.renderingMode = '3d';
    this.world = world;
    this.routes = routes;
    this.meshes = new Map(); // train id -> group
    this.lastTime = performance.now();
    this.trainScreenPos = new Map(); // for picking
  }

  onAdd(map, gl) {
    this.map = map;
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();

    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x30281e, 0.9);
    this.scene.add(this.hemi);

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
  }

  kindFor(train) {
    if (train.id.startsWith('ktmb-')) return 'KTMB';
    return this.world.shapes[train.shapeId] ? train.routeId : 'KTMB';
  }

  updateLighting() {
    const { altitude, azimuth } = sunPosition(Date.now());
    const day = daylightFactor(Date.now());
    this.day = day;
    // sun direction in scene space (x east, y up used pre-transform… lights
    // operate in mercator-ish space; approximate with azimuth mapping)
    const r = 500;
    const alt = Math.max(0.45, altitude); // keep a flattering key-light angle even at night
    this.sun.position.set(
      r * Math.sin(azimuth) * Math.cos(alt),
      -r * Math.cos(azimuth) * Math.cos(alt),
      r * Math.sin(alt)
    );
    const warm = new THREE.Color(0xfff3e0), night = new THREE.Color(0x8fa8d8);
    this.sun.color.copy(night).lerp(warm, day);
    this.sun.intensity = 1.1 + 1.6 * day;
    this.hemi.intensity = 0.8 + 0.5 * day;
    this.nightEmissive = (1 - day) * 1.15;
  }

  render(gl, matrix) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.updateLighting();
    const trains = this.world.tick(dt);
    const seen = new Set();
    const center = this.map.getCenter();
    // zoom-adaptive exaggeration keeps trains legible from city scale
    const zoom = this.map.getZoom();
    const exaggerate = zoom >= 16 ? 1 : Math.min(3.2, 1 + (16 - zoom) * 0.55);
    const ref = maplibregl.MercatorCoordinate.fromLngLat(center, 0);
    const scaleRef = ref.meterInMercatorCoordinateUnits() * exaggerate;
    this.trainScreenPos.clear();

    for (const tr of trains) {
      if (tr.lon == null) continue;
      seen.add(tr.id);
      let g = this.meshes.get(tr.id);
      if (!g) {
        g = buildTrain(this.kindFor(tr));
        g.matrixAutoUpdate = false;
        this.scene.add(g);
        this.meshes.set(tr.id, g);
      }
      const merc = maplibregl.MercatorCoordinate.fromLngLat([tr.lon, tr.lat], g.userData.altitude || 0);
      const theta = Math.PI / 2 - (tr.bearing || 0) * DEG;
      // positions are relative to `ref` so float32 precision survives close zooms
      const m = new THREE.Matrix4()
        .makeTranslation(merc.x - ref.x, merc.y - ref.y, merc.z)
        .scale(new THREE.Vector3(scaleRef, -scaleRef, scaleRef))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
        .multiply(new THREE.Matrix4().makeRotationY(theta));
      g.matrix.copy(m);
      updateTrainFX(g, tr.doorAnim ?? 0, this.nightEmissive);
      this.trainScreenPos.set(tr.id, tr);
    }

    // remove departed trains
    for (const [id, g] of this.meshes) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this.meshes.delete(id);
      }
    }

    this.camera.projectionMatrix = new THREE.Matrix4()
      .fromArray(matrix)
      .multiply(new THREE.Matrix4().makeTranslation(ref.x, ref.y, 0));
    this.renderer.resetState();
    // trains are the heroes: clear depth so buildings never swallow them
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }

  // nearest train to a screen point (pixel-space picking)
  pick(point, maxPx = 45) {
    let best = null, bestD = maxPx * maxPx;
    for (const tr of this.trainScreenPos.values()) {
      const p = this.map.project([tr.lon, tr.lat]);
      const dx = p.x - point.x, dy = p.y - point.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = tr; }
    }
    return best;
  }
}
