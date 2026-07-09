// MapLibre custom layer hosting the three.js scene: metro EMU consists
// with a PMREM environment (real reflections), viewport culling, line-
// colored glow pads, sun-tracked lighting, and origin-relative matrices
// (float32-safe at any zoom).
import * as THREE from 'three';
import maplibregl from 'maplibre-gl';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildTrain, updateTrainFX } from './trainModels.js';
import { sunPosition, daylightFactor } from '../lib/solar.js';

const DEG = Math.PI / 180;
const RAIL_ALTITUDE_M = 0.4;
const MAX_VISIBLE = 140;

export class TrainsLayer {
  constructor(world, routes) {
    this.id = 'termtrade-trains';
    this.type = 'custom';
    this.renderingMode = '3d';
    this.world = world;
    this.routes = routes;
    this.meshes = new Map();
    this.lastTime = performance.now();
    this.trainScreenPos = new Map();
  }

  onAdd(map, gl) {
    this.map = map;
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x30281e, 0.7);
    this.scene.add(this.hemi);
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    // image-based lighting: makes brushed steel + glass read as premium
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  }

  kindFor(tr) {
    return tr.id.startsWith('ktmb-') ? 'KTMB' : tr.routeId;
  }

  makeTrain(tr) {
    const group = new THREE.Group();
    const train = buildTrain(this.kindFor(tr));
    group.add(train);
    const color = new THREE.Color(this.routes[tr.routeId]?.color ?? '#1c3f94');
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(train.userData.length * 1.25, 11),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.12;
    group.add(pad);
    group.userData.train = train;
    group.matrixAutoUpdate = false;
    return group;
  }

  updateLighting() {
    const { altitude, azimuth } = sunPosition(Date.now());
    const day = daylightFactor(Date.now());
    this.day = day;
    const r = 500;
    const alt = Math.max(0.5, altitude);
    this.sun.position.set(r * Math.sin(azimuth) * Math.cos(alt), -r * Math.cos(azimuth) * Math.cos(alt), r * Math.sin(alt));
    const warm = new THREE.Color(0xfff3e0), night = new THREE.Color(0xaebfe4);
    this.sun.color.copy(night).lerp(warm, day);
    this.sun.intensity = 1.6 + 1.0 * day;
    this.hemi.intensity = 0.7 + 0.3 * day;
    this.nightEmissive = (1 - day) * 1.2;
  }

  render(gl, matrix) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.updateLighting();
    const trains = this.world.tick(dt);
    const seen = new Set();
    const zoom = this.map.getZoom();
    const exaggerate = Math.min(4, Math.max(1.15, 1.15 + (16.5 - zoom) * 0.5));
    const ref = maplibregl.MercatorCoordinate.fromLngLat(this.map.getCenter(), 0);
    const scaleRef = ref.meterInMercatorCoordinateUnits() * exaggerate;
    this.trainScreenPos.clear();

    const bounds = this.map.getBounds();
    const padLon = (bounds.getEast() - bounds.getWest()) * 0.25;
    const padLat = (bounds.getNorth() - bounds.getSouth()) * 0.25;
    const inView = (tr) =>
      tr.lon > bounds.getWest() - padLon && tr.lon < bounds.getEast() + padLon &&
      tr.lat > bounds.getSouth() - padLat && tr.lat < bounds.getNorth() + padLat;

    let visible = 0;
    for (const tr of trains) {
      if (tr.lon == null) continue;
      this.trainScreenPos.set(tr.id, tr);
      seen.add(tr.id);
      if (!inView(tr) || visible >= MAX_VISIBLE) {
        const g0 = this.meshes.get(tr.id);
        if (g0) g0.visible = false;
        continue;
      }
      visible++;
      let g = this.meshes.get(tr.id);
      if (!g) {
        g = this.makeTrain(tr);
        this.scene.add(g);
        this.meshes.set(tr.id, g);
      }
      g.visible = true;
      updateTrainFX(g.userData.train, tr.doorAnim ?? 0, this.nightEmissive);
      const merc = maplibregl.MercatorCoordinate.fromLngLat([tr.lon, tr.lat], RAIL_ALTITUDE_M);
      const theta = Math.PI / 2 - (tr.bearing || 0) * DEG;
      g.matrix
        .makeTranslation(merc.x - ref.x, merc.y - ref.y, merc.z)
        .scale(new THREE.Vector3(scaleRef, -scaleRef, scaleRef))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
        .multiply(new THREE.Matrix4().makeRotationY(theta));
    }

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
    this.renderer.clearDepth(); // trains never get swallowed by buildings
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }

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
