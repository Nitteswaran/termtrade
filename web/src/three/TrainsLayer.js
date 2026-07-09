// MapLibre custom layer hosting the three.js scene. Renders the user's
// GLB train model (meshopt-compressed) per active train, with viewport
// culling, line-colored ground glow, sun-tracked lighting and origin-
// relative matrices (float32-safe at any zoom).
import * as THREE from 'three';
import maplibregl from 'maplibre-gl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { buildTrain } from './trainModels.js';
import { sunPosition, daylightFactor } from '../lib/solar.js';

const DEG = Math.PI / 180;
const TRAIN_LENGTH_M = 42; // rendered consist length (exaggerated for legibility)
const RAIL_ALTITUDE_M = 0.4; // sit on the drawn track
const MAX_VISIBLE = 140;

let modelPromise = null;
function loadTrainModel() {
  modelPromise ??= new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      '/models/train.glb',
      (gltf) => {
        // normalize: forward = +X, base at y=0, length = TRAIN_LENGTH_M
        const inner = gltf.scene;
        inner.rotation.y = -Math.PI / 2; // model length runs along Z; nose at -Z
        const wrap = new THREE.Group();
        wrap.add(inner);
        const bbox = new THREE.Box3().setFromObject(wrap);
        const size = bbox.getSize(new THREE.Vector3());
        const s = TRAIN_LENGTH_M / Math.max(size.x, 1e-6);
        wrap.scale.setScalar(s);
        const b2 = new THREE.Box3().setFromObject(wrap);
        const c = b2.getCenter(new THREE.Vector3());
        wrap.position.set(-c.x, -b2.min.y, -c.z);
        const root = new THREE.Group();
        root.add(wrap);
        resolve(root);
      },
      undefined,
      () => resolve(null) // fall back to procedural models
    );
  });
  return modelPromise;
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
    this.model = null;
    loadTrainModel().then((m) => (this.model = m));
  }

  onAdd(map, gl) {
    this.map = map;
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x30281e, 0.9);
    this.scene.add(this.hemi);
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
  }

  makeTrain(tr) {
    const group = new THREE.Group();
    if (this.model) {
      group.add(this.model.clone(true));
    } else {
      group.add(buildTrain(tr.id.startsWith('ktmb-') ? 'KTMB' : tr.routeId));
    }
    // line-colored glow pad under the train — readable from top view
    const color = new THREE.Color(this.routes[tr.routeId]?.color ?? '#4cc2ff');
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(TRAIN_LENGTH_M * 1.35, 14),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.38, depthWrite: false })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.15;
    group.add(pad);
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
    this.sun.intensity = 2.1 + 0.8 * day;
    this.hemi.intensity = 1.15 + 0.25 * day;
  }

  render(gl, matrix) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.updateLighting();
    const trains = this.world.tick(dt);
    const seen = new Set();
    const zoom = this.map.getZoom();
    // exaggerate size so trains stay legible from city scale & top view
    const exaggerate = Math.min(5, Math.max(1.35, 1.35 + (16.5 - zoom) * 0.55));
    const ref = maplibregl.MercatorCoordinate.fromLngLat(this.map.getCenter(), 0);
    const scaleRef = ref.meterInMercatorCoordinateUnits() * exaggerate;
    this.trainScreenPos.clear();

    // viewport culling with padding
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
      if (!inView(tr) || visible >= MAX_VISIBLE) {
        const g = this.meshes.get(tr.id);
        if (g) g.visible = false;
        seen.add(tr.id);
        continue;
      }
      visible++;
      seen.add(tr.id);
      let g = this.meshes.get(tr.id);
      if (!g) {
        g = this.makeTrain(tr);
        this.scene.add(g);
        this.meshes.set(tr.id, g);
      }
      g.visible = true;
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
    // trains are the heroes: never let buildings swallow them
    this.renderer.clearDepth();
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
