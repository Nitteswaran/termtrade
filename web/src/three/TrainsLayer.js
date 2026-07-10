// MapLibre custom layer hosting the three.js scene: metro EMU consists
// with a PMREM environment (real reflections), viewport culling, line-
// colored glow pads, sun-tracked lighting, and origin-relative matrices
// (float32-safe at any zoom).
import * as THREE from 'three';
import maplibregl from 'maplibre-gl';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildTrain, updateTrainFX } from './trainModels.js';
import { sunPosition, daylightFactor } from '../lib/solar.js';
import { sampleShape } from '../lib/geo.js';

const DEG = Math.PI / 180;
const RAIL_ALTITUDE_M = 0.4;
const MAX_VISIBLE = 140;

function angleDelta(a, b) {
  return ((a - b + 540) % 360) - 180;
}

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
    this.meshes.clear(); // re-added after a style swap: rebuild consists
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
    train.matrixAutoUpdate = false;
    group.add(train);
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
    const exaggerate = Math.min(9, Math.max(3.4, 3.4 + (16.5 - zoom) * 0.9));
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
      const train = g.userData.train;
      updateTrainFX(train, tr.doorAnim ?? 0, this.nightEmissive);
      g.matrix.identity();
      train.matrix.identity();

      // Articulated consist: every car is sampled at its own distance
      // along the real track curve, so the train bends through corners.
      // Cars are scaled by `exaggerate`, so their track offsets are too.
      const shape = tr.dist != null ? this.world.shapes[tr.shapeId] : null;
      const speedFactor = Math.min(1, (tr.speed ?? 0) / 14);
      for (const { node, offset } of train.userData.cars) {
        let lon, lat, brgDeg, brgAhead;
        if (shape) {
          const sC = sampleShape(shape, tr.dist + offset * exaggerate);
          const sA = sampleShape(shape, tr.dist + offset * exaggerate + 10);
          [lon, lat] = sC.pos;
          brgDeg = sC.bearing;
          brgAhead = sA.bearing;
        } else {
          // live GPS train (no shape): rigid consist along its bearing
          brgDeg = tr.bearing || 0;
          brgAhead = brgDeg;
          const b = brgDeg * DEG;
          const d = offset * exaggerate;
          lon = tr.lon + (d * Math.sin(b)) / (111320 * Math.cos(tr.lat * DEG));
          lat = tr.lat + (d * Math.cos(b)) / 110540;
        }

        const brg = brgDeg * DEG;
        if (shape) {
          // left-hand running: opposing trains pass side by side
          const off = 2.1 * exaggerate;
          lon += (-off * Math.cos(brg)) / (111320 * Math.cos(lat * DEG));
          lat += (off * Math.sin(brg)) / 110540;
        }

        // banking: each car rolls into its own curvature
        const roll = THREE.MathUtils.clamp(angleDelta(brgAhead, brgDeg) * 0.025, -0.1, 0.1) * speedFactor;

        const merc = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], RAIL_ALTITUDE_M);
        node.matrix
          .makeTranslation(merc.x - ref.x, merc.y - ref.y, merc.z)
          .scale(new THREE.Vector3(scaleRef, -scaleRef, scaleRef))
          .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
          .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2 - brg))
          .multiply(new THREE.Matrix4().makeRotationX(roll));
      }
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
