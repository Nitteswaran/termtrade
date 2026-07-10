// Procedural metro EMU consists, livery-matched to KL rolling stock.
// The car body is an extruded rounded profile; the cab nose is a proper
// lofted surface swept from that same profile (progressively narrowed and
// lowered), so the front is streamlined — not a box. Glazing and stripes
// are flush per-side panels that never punch through the body.
// Forward = +X, up = +Y, origin at rail level.
import * as THREE from 'three';

export const LIVERIES = {
  KJ:   { body: 0xe3e5e8, accent: 0xd50032, cars: 4, carLen: 17, width: 2.7, height: 3.35 },
  AG:   { body: 0xeeece7, accent: 0xe57200, cars: 4, carLen: 19, width: 2.8, height: 3.5 },
  PH:   { body: 0xeeece7, accent: 0x8c2332, cars: 4, carLen: 19, width: 2.8, height: 3.5 },
  KGL:  { body: 0xdde1e4, accent: 0x047940, cars: 4, carLen: 21, width: 3.1, height: 3.65 },
  PYL:  { body: 0xdde1e4, accent: 0xf0b800, cars: 4, carLen: 21, width: 3.1, height: 3.65 },
  MR:   { body: 0xc3dc78, accent: 0x3e6d1c, cars: 2, carLen: 13, width: 2.6, height: 3.15, monorail: true },
  BRT:  { body: 0xecefef, accent: 0x115740, cars: 1, carLen: 12, width: 2.5, height: 3.1 },
  SA:   { body: 0xebebee, accent: 0xd6006e, cars: 3, carLen: 19, width: 2.8, height: 3.5 },
  KTMB: { body: 0xf3f1ee, accent: 0x1c3f94, accent2: 0xdc2420, cars: 6, carLen: 21, width: 3.0, height: 3.85 },
};

const partsCache = new Map();

// Rounded body cross-section. x = across the track, y = up from floor.
function profilePoints(W, H, n = 20) {
  const s = new THREE.Shape();
  const rB = 0.18, rT = Math.min(0.85, W * 0.32);
  const w = W / 2;
  s.moveTo(-w + rB, 0);
  s.lineTo(w - rB, 0);
  s.quadraticCurveTo(w, 0, w, rB);
  s.lineTo(w, H - rT);
  s.quadraticCurveTo(w, H, w - rT, H);
  s.lineTo(-w + rT, H);
  s.quadraticCurveTo(-w, H, -w, H - rT);
  s.lineTo(-w, rB);
  s.quadraticCurveTo(-w, 0, -w + rB, 0);
  return { shape: s, points: s.getPoints(n) };
}

function bodyGeometry(len, W, H) {
  const { shape } = profilePoints(W, H);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: len,
    bevelEnabled: false,
    curveSegments: 10,
  });
  g.translate(0, 0, -len / 2);
  g.rotateY(Math.PI / 2); // extrusion axis Z -> train axis X
  return g;
}

// Streamlined nose: sweep the body profile forward while narrowing it and
// drooping the roofline, then cap the tip. Real loft, smooth normals.
function noseGeometry(noseLen, W, H, rings = 7) {
  const { points } = profilePoints(W, H, 22);
  const P = points.length;
  const pos = [];
  const idx = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const e = 1 - Math.pow(t, 1.9);                 // taper curve
    const widthScale = 0.28 + 0.72 * e;             // pinch to a rounded tip
    const heightScale = 0.42 + 0.58 * e;            // roofline droops forward
    const x = noseLen * t;
    for (const p of points) {
      pos.push(x, p.y * heightScale + (1 - heightScale) * 0.12 * H, p.x * widthScale);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < P; i++) {
      const a = r * P + i, b = r * P + ((i + 1) % P);
      const c = (r + 1) * P + i, d = (r + 1) * P + ((i + 1) % P);
      idx.push(a, c, b, b, c, d);
    }
  }
  // tip cap (fan around centroid of last ring)
  const tipRing = rings * P;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < P; i++) {
    cx += pos[(tipRing + i) * 3]; cy += pos[(tipRing + i) * 3 + 1]; cz += pos[(tipRing + i) * 3 + 2];
  }
  const center = pos.length / 3;
  pos.push(cx / P, cy / P, cz / P);
  for (let i = 0; i < P; i++) idx.push(tipRing + i, center, tipRing + ((i + 1) % P));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function getParts(kind) {
  if (partsCache.has(kind)) return partsCache.get(kind);
  const L = LIVERIES[kind] || LIVERIES.KJ;
  const bodyH = L.height - 0.45;
  const railY = L.monorail ? 1.0 : 0.62;
  const noseLen = Math.min(3.2, L.carLen * 0.16);

  const mats = {
    body: new THREE.MeshStandardMaterial({ color: L.body, metalness: 0.35, roughness: 0.38, envMapIntensity: 0.9 }),
    accent: new THREE.MeshStandardMaterial({ color: L.accent, metalness: 0.3, roughness: 0.4, envMapIntensity: 0.8 }),
    accent2: new THREE.MeshStandardMaterial({ color: L.accent2 ?? L.accent, metalness: 0.3, roughness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x10151c, metalness: 0.0, roughness: 0.08, envMapIntensity: 1.5,
      emissive: 0xffd9a0, emissiveIntensity: 0,
    }),
    dark: new THREE.MeshStandardMaterial({ color: 0x171a1f, metalness: 0.25, roughness: 0.75 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff7df, emissive: 0xffedb8, emissiveIntensity: 2.4 }),
    pad: new THREE.MeshBasicMaterial({ color: L.accent, transparent: true, opacity: 0.3, depthWrite: false }),
  };

  const sideGlassLen = L.carLen * 0.8;
  const geos = {
    body: bodyGeometry(L.carLen - 0.5, L.width, bodyH),
    nose: noseGeometry(noseLen, L.width, bodyH),
    // per-side flush panels (thin, sit just proud of the flat wall)
    sideGlass: new THREE.BoxGeometry(sideGlassLen, bodyH * 0.28, 0.05),
    sideStripe: new THREE.BoxGeometry(L.carLen * 0.94, 0.24, 0.05),
    sideStripe2: new THREE.BoxGeometry(L.carLen * 0.94, 0.15, 0.05),
    door: new THREE.BoxGeometry(1.35, bodyH * 0.62, 0.05),
    windshield: new THREE.BoxGeometry(0.5, bodyH * 0.4, L.width * 0.66),
    noseMask: new THREE.BoxGeometry(0.4, bodyH * 0.24, L.width * 0.72),
    roofPod: new THREE.BoxGeometry(L.carLen * 0.32, 0.2, L.width * 0.46),
    skirt: new THREE.BoxGeometry(L.carLen - 1.2, 0.32, L.width * 0.86),
    bogie: new THREE.BoxGeometry(2.2, 0.5, L.width * 0.6),
    wheel: new THREE.CylinderGeometry(0.42, 0.42, L.width * 0.78, 14),
    beam: new THREE.BoxGeometry(L.carLen * 0.82, railY, 0.85),
    gangway: new THREE.CylinderGeometry(bodyH * 0.36, bodyH * 0.36, 1.15, 12),
    lamp: new THREE.SphereGeometry(0.15, 10, 8),
    pad: new THREE.PlaneGeometry(L.carLen + 1.6, 11),
  };
  geos.wheel.rotateX(Math.PI / 2); // axle across the track
  geos.gangway.rotateZ(Math.PI / 2);

  const out = { L, mats, geos, railY, bodyH, noseLen };
  partsCache.set(kind, out);
  return out;
}

export function buildTrain(kind) {
  const { L, mats, geos, railY, bodyH, noseLen } = getParts(kind);
  const group = new THREE.Group();
  const doors = [];
  const cars = [];
  const gap = 0.8;
  const total = L.cars * L.carLen + (L.cars - 1) * gap;
  const wallZ = L.width / 2 + 0.04;

  for (let c = 0; c < L.cars; c++) {
    // car 0 is the FRONT of the consist; each car is centred on its own
    // origin and placed on the track individually so the train bends
    const offset = total / 2 - L.carLen / 2 - c * (L.carLen + gap);
    const isHead = c === 0, isTail = c === L.cars - 1;
    const car = new THREE.Group();
    car.matrixAutoUpdate = false;

    const bodyLen = L.carLen - 0.5 - (isHead ? noseLen : 0) - (isTail ? noseLen : 0);
    const bodyShift = (isHead ? -noseLen / 2 : 0) + (isTail ? noseLen / 2 : 0);
    const body = new THREE.Mesh(geos.body, mats.body);
    body.scale.x = bodyLen / (L.carLen - 0.5);
    body.position.set(bodyShift, railY, 0);
    car.add(body);

    // lofted noses on the end cars
    if (isHead) {
      const nose = new THREE.Mesh(geos.nose, mats.body);
      nose.position.set(bodyShift + bodyLen / 2, railY, 0);
      car.add(nose);
      const shield = new THREE.Mesh(geos.windshield, mats.glass);
      shield.position.set(bodyShift + bodyLen / 2 + noseLen * 0.32, railY + bodyH * 0.62, 0);
      shield.rotation.z = -0.42;
      car.add(shield);
      const mask = new THREE.Mesh(geos.noseMask, mats.accent);
      mask.position.set(bodyShift + bodyLen / 2 + noseLen * 0.62, railY + bodyH * 0.3, 0);
      mask.rotation.z = -0.3;
      car.add(mask);
      for (const side of [-1, 1]) {
        const lamp = new THREE.Mesh(geos.lamp, mats.lamp);
        lamp.position.set(bodyShift + bodyLen / 2 + noseLen * 0.78, railY + bodyH * 0.2, side * L.width * 0.24);
        car.add(lamp);
      }
    }
    if (isTail) {
      const nose = new THREE.Mesh(geos.nose, mats.body);
      nose.rotation.y = Math.PI;
      nose.position.set(bodyShift - bodyLen / 2, railY, 0);
      car.add(nose);
      const shield = new THREE.Mesh(geos.windshield, mats.glass);
      shield.position.set(bodyShift - bodyLen / 2 - noseLen * 0.32, railY + bodyH * 0.62, 0);
      shield.rotation.z = 0.42;
      car.add(shield);
    }

    // flush side panels — glazing, stripes, doors (never through-body)
    for (const side of [-1, 1]) {
      const glass = new THREE.Mesh(geos.sideGlass, mats.glass);
      glass.scale.x = bodyLen / (L.carLen * 0.8) * 0.8;
      glass.position.set(bodyShift, railY + bodyH * 0.62, side * wallZ);
      car.add(glass);

      const stripe = new THREE.Mesh(geos.sideStripe, mats.accent);
      stripe.scale.x = bodyLen / (L.carLen * 0.94) * 0.94;
      stripe.position.set(bodyShift, railY + bodyH * 0.4, side * wallZ);
      car.add(stripe);
      if (L.accent2) {
        const s2 = new THREE.Mesh(geos.sideStripe2, mats.accent2);
        s2.scale.x = stripe.scale.x;
        s2.position.set(bodyShift, railY + bodyH * 0.27, side * wallZ);
        car.add(s2);
      }

      for (const f of [-0.26, 0.26]) {
        const door = new THREE.Mesh(geos.door, mats.dark);
        const dx = bodyShift + f * bodyLen;
        door.position.set(dx, railY + bodyH * 0.36, side * (wallZ + 0.01));
        car.add(door);
        doors.push({ mesh: door, baseX: dx, slide: 1.05 });
      }
    }

    // roof pods + underframe
    const pod = new THREE.Mesh(geos.roofPod, mats.dark);
    pod.scale.x = bodyLen / (L.carLen * 0.32) * 0.32;
    pod.position.set(bodyShift, railY + bodyH + 0.08, 0);
    car.add(pod);
    const skirt = new THREE.Mesh(geos.skirt, mats.dark);
    skirt.position.set(bodyShift, railY - 0.1, 0);
    car.add(skirt);

    if (L.monorail) {
      const beam = new THREE.Mesh(geos.beam, mats.dark);
      beam.position.y = railY / 2;
      car.add(beam);
    } else {
      for (const bx of [-bodyLen * 0.3, bodyLen * 0.3]) {
        const bogie = new THREE.Mesh(geos.bogie, mats.dark);
        bogie.position.set(bodyShift + bx, 0.35, 0);
        car.add(bogie);
        for (const wx of [-0.7, 0.7]) {
          const wheel = new THREE.Mesh(geos.wheel, mats.dark);
          wheel.position.set(bodyShift + bx + wx, 0.42, 0);
          car.add(wheel);
        }
      }
    }

    if (c < L.cars - 1) {
      // gangway bridging to the car behind
      const gw = new THREE.Mesh(geos.gangway, mats.dark);
      gw.position.set(-(L.carLen / 2 + gap / 2), railY + bodyH * 0.5, 0);
      car.add(gw);
    }

    // line-colored glow pad under each car (reads from top view)
    const pad = new THREE.Mesh(geos.pad, mats.pad);
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.1;
    car.add(pad);

    group.add(car);
    cars.push({ node: car, offset });
  }

  group.userData = { doors, cars, kind, length: total, glassMat: mats.glass };
  return group;
}

export function updateTrainFX(group, doorAnim, nightEmissive) {
  for (const d of group.userData.doors) {
    d.mesh.position.x = d.baseX + d.slide * doorAnim * Math.sign(d.baseX || 1);
  }
  group.userData.glassMat.emissiveIntensity = nightEmissive;
}
