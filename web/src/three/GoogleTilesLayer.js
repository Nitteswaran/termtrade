// Google Photorealistic 3D Tiles rendered with three.js (3d-tiles-renderer)
// inside a MapLibre custom layer.
//
// The scene runs in METERS in a local ENU frame at the map center (x east,
// y north, z up) so the tileset keeps uniform scale 1 and the renderer's
// screen-space-error math is exact. The camera gets its true position from
// maplibre's free-camera API (for LOD distances) while the projection
// matrix is overridden with the exact map view-projection, so the imagery
// stays pixel-aligned with the basemap. Ground height self-calibrates by
// raycasting the photogrammetry down to the z=0 basemap plane.
import * as THREE from 'three';
import maplibregl from 'maplibre-gl';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/plugins';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { daylightFactor } from '../lib/solar.js';

const WGS84_A = 6378137;
const WGS84_E2 = 6.69437999014e-3;
const DEG = Math.PI / 180;

function ecefFromLngLat(lon, lat, h = 0) {
  const φ = lat * DEG, λ = lon * DEG;
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(φ) ** 2);
  return new THREE.Vector3(
    (N + h) * Math.cos(φ) * Math.cos(λ),
    (N + h) * Math.cos(φ) * Math.sin(λ),
    (N * (1 - WGS84_E2) + h) * Math.sin(φ)
  );
}

export class GoogleTilesLayer {
  constructor(key) {
    this.id = 'tt-google-3d-tiles';
    this.type = 'custom';
    this.renderingMode = '3d';
    this.key = key;
    this.groundOffset = 55; // ≈ KL ellipsoid height; refined by raycast
    this.calibrated = false;
    this.lastCalibration = 0;
  }

  onAdd(map, gl) {
    this.map = map;
    this.camera = new THREE.PerspectiveCamera(40, 1, 10, 300000);
    this.camera.matrixAutoUpdate = false;
    this.scene = new THREE.Scene();
    this.ambient = new THREE.AmbientLight(0xffffff, 2.4); // textures carry baked light
    this.scene.add(this.ambient);
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;

    const tiles = new TilesRenderer('https://tile.googleapis.com/v1/3dtiles/root.json');
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: this.key, autoRefreshToken: true }));
    const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    const loader = new GLTFLoader(tiles.manager);
    loader.setDRACOLoader(draco);
    tiles.manager.addHandler(/\.(gltf|glb)$/g, loader);
    tiles.setCamera(this.camera);
    tiles.errorTarget = 12; // sharper photogrammetry near the camera
    tiles.group.matrixAutoUpdate = false;
    this.scene.add(tiles.group);
    this.tiles = tiles;
  }

  onRemove() {
    this.tiles?.dispose();
  }

  // ECEF -> local ENU metres at the map center (uniform scale 1)
  rebase() {
    const c = this.map.getCenter();
    const φ = c.lat * DEG, λ = c.lng * DEG;
    const e = new THREE.Vector3(-Math.sin(λ), Math.cos(λ), 0);
    const n = new THREE.Vector3(-Math.sin(φ) * Math.cos(λ), -Math.sin(φ) * Math.sin(λ), Math.cos(φ));
    const u = new THREE.Vector3(Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ));
    const o = ecefFromLngLat(c.lng, c.lat, 0);
    this.tiles.group.matrix.set(
      e.x, e.y, e.z, -e.dot(o),
      n.x, n.y, n.z, -n.dot(o),
      u.x, u.y, u.z, -u.dot(o) - this.groundOffset,
      0, 0, 0, 1
    );
    this.tiles.group.matrixWorldNeedsUpdate = true;
  }

  calibrateGround() {
    const now = performance.now();
    if (now - this.lastCalibration < 1500) return;
    this.lastCalibration = now;
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 5000), new THREE.Vector3(0, 0, -1));
    const hits = ray.intersectObject(this.tiles.group, true);
    if (hits.length) {
      const z = hits[0].point.z; // residual terrain height above basemap plane
      // ignore hits against coarse global-LOD geometry — only trust
      // plausible local terrain (KL sits well within ±300 m)
      if (Math.abs(z) > 300) return;
      this.groundOffset += this.calibrated ? z * 0.3 : z;
      this.calibrated = true;
    }
  }

  render(gl, matrix) {
    try {
      this.renderCount = (this.renderCount ?? 0) + 1;
      this.renderInner(gl, matrix);
    } catch (err) {
      this.lastError = String(err.stack || err);
    }
  }

  renderInner(gl, matrix) {
    const ref = maplibregl.MercatorCoordinate.fromLngLat(this.map.getCenter(), 0);
    const s = ref.meterInMercatorCoordinateUnits();
    this.rebase();

    // true camera position (metres, ENU at center) for LOD distances,
    // derived from pitch/bearing/camera distance
    const tr = this.map.transform;
    const dMerc = tr.cameraToCenterDistance / tr.worldSize; // mercator units
    const pitch = this.map.getPitch() * DEG;
    const brg = this.map.getBearing() * DEG;
    const px = (-Math.sin(brg) * Math.sin(pitch) * dMerc) / s;
    const py = (-Math.cos(brg) * Math.sin(pitch) * dMerc) / s;
    const pz = (Math.cos(pitch) * dMerc) / s;
    this.camera.position.set(px, py, pz);
    this.camera.matrixWorld.makeTranslation(px, py, pz);
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();

    // exact view-projection: VP_map · T(ref) · S(s,-s,s) · T(camera)
    // (renderer computes P · MW⁻¹, so bake T(camera) into P)
    const vpScene = new THREE.Matrix4()
      .fromArray(matrix)
      .multiply(new THREE.Matrix4().makeTranslation(ref.x, ref.y, 0))
      .multiply(new THREE.Matrix4().makeScale(s, -s, s));
    this.camera.projectionMatrix = vpScene.clone().multiply(this.camera.matrixWorld);

    // plausible intrinsics for the SSE denominator
    const canvas = this.map.getCanvas();
    this.camera.fov = (this.map.transform?.fov ?? 36.87);
    this.camera.aspect = canvas.width / canvas.height;

    // daytime imagery dims after dark so it matches the night scene
    this.ambient.intensity = 0.45 + 2.0 * daylightFactor(Date.now());

    this.tiles.setResolution(this.camera, canvas.width, canvas.height);
    this.tiles.update();
    this.calibrateGround();

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }
}
