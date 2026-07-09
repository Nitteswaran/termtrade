// Procedural metro EMU consists, livery-matched to KL rolling stock.
// Car bodies are extruded rounded profiles (not boxes) with PBR steel +
// flush glazing; the scene provides a PMREM environment so the metal and
// glass pick up real reflections. Forward = +X, up = +Y, origin at rail.
import * as THREE from 'three';

export const LIVERIES = {
  KJ:   { body: 0xdadde1, accent: 0xd50032, cars: 4, carLen: 17, width: 2.7, height: 3.35 },
  AG:   { body: 0xe9e7e2, accent: 0xe57200, cars: 4, carLen: 19, width: 2.8, height: 3.5 },
  PH:   { body: 0xe9e7e2, accent: 0x8c2332, cars: 4, carLen: 19, width: 2.8, height: 3.5 },
  KGL:  { body: 0xd4d8dc, accent: 0x047940, cars: 4, carLen: 21, width: 3.1, height: 3.65 },
  PYL:  { body: 0xd4d8dc, accent: 0xffcd00, cars: 4, carLen: 21, width: 3.1, height: 3.65 },
  MR:   { body: 0xbcd96a, accent: 0x3e6d1c, cars: 2, carLen: 13, width: 2.6, height: 3.15, monorail: true },
  BRT:  { body: 0xe6e9ea, accent: 0x115740, cars: 1, carLen: 12, width: 2.5, height: 3.1 },
  SA:   { body: 0xe6e6ea, accent: 0xd6006e, cars: 3, carLen: 19, width: 2.8, height: 3.5 },
  KTMB: { body: 0xf1efec, accent: 0x1c3f94, accent2: 0xdc2420, cars: 6, carLen: 21, width: 3.0, height: 3.85 },
};

// ---- shared geometry/material caches (per livery) ----
const partsCache = new Map();

function roundedProfile(W, H) {
  // cross-section: x = width, y = height above rail deck
  const s = new THREE.Shape();
  const rB = 0.16, rT = Math.min(0.75, W * 0.3);
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
  return s;
}

function bodyGeometry(len, W, H) {
  const g = new THREE.ExtrudeGeometry(roundedProfile(W, H), {
    depth: len - 0.9,
    bevelEnabled: true,
    bevelThickness: 0.42,
    bevelSize: 0.3,
    bevelSegments: 3,
    curveSegments: 8,
  });
  g.translate(0, 0, -(len - 0.9) / 2);
  g.rotateY(Math.PI / 2); // extrusion (Z) -> train axis (X)
  return g;
}

function getParts(kind) {
  if (partsCache.has(kind)) return partsCache.get(kind);
  const L = LIVERIES[kind] || LIVERIES.KJ;

  const mats = {
    body: new THREE.MeshStandardMaterial({ color: L.body, metalness: 0.85, roughness: 0.32, envMapIntensity: 1.1 }),
    accent: new THREE.MeshStandardMaterial({ color: L.accent, metalness: 0.65, roughness: 0.35, envMapIntensity: 1.0 }),
    accent2: new THREE.MeshStandardMaterial({ color: L.accent2 ?? L.accent, metalness: 0.65, roughness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x0b0e13, metalness: 0.0, roughness: 0.06, envMapIntensity: 1.6,
      emissive: 0xffd9a0, emissiveIntensity: 0,
    }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15181d, metalness: 0.4, roughness: 0.7 }),
    light: new THREE.MeshStandardMaterial({ color: 0xfff7df, emissive: 0xffedb8, emissiveIntensity: 2.2 }),
  };
  const railY = L.monorail ? 1.0 : 0.62;
  const geos = {
    body: bodyGeometry(L.carLen, L.width, L.height - 0.45),
    glass: new THREE.BoxGeometry(L.carLen * 0.86, (L.height - 0.45) * 0.3, L.width + 0.06),
    stripe: new THREE.BoxGeometry(L.carLen * 0.96, 0.26, L.width + 0.08),
    stripe2: new THREE.BoxGeometry(L.carLen * 0.96, 0.16, L.width + 0.08),
    door: new THREE.BoxGeometry(1.35, (L.height - 0.45) * 0.66, L.width + 0.05),
    roofUnit: new THREE.BoxGeometry(L.carLen * 0.34, 0.22, L.width * 0.5),
    bogie: new THREE.BoxGeometry(2.3, railY, L.width * 0.72),
    beam: new THREE.BoxGeometry(L.carLen * 0.82, railY, 0.85),
    gangway: new THREE.BoxGeometry(1.1, (L.height - 0.45) * 0.75, L.width * 0.74),
    shield: new THREE.BoxGeometry(0.55, (L.height - 0.45) * 0.44, L.width * 0.8),
    mask: new THREE.BoxGeometry(0.5, (L.height - 0.45) * 0.32, L.width * 0.86),
    lamp: new THREE.SphereGeometry(0.14, 10, 8),
  };
  const out = { L, mats, geos, railY };
  partsCache.set(kind, out);
  return out;
}

export function buildTrain(kind) {
  const { L, mats, geos, railY } = getParts(kind);
  const group = new THREE.Group();
  const doors = [];
  const windows = [];
  const gap = 0.7;
  const total = L.cars * L.carLen + (L.cars - 1) * gap;
  let x0 = -total / 2;
  const bodyH = L.height - 0.45;

  for (let c = 0; c < L.cars; c++) {
    const cx = x0 + L.carLen / 2;
    const isHead = c === 0, isTail = c === L.cars - 1;
    const car = new THREE.Group();
    car.position.x = cx;

    const body = new THREE.Mesh(geos.body, mats.body);
    body.position.y = railY;
    car.add(body);

    const glass = new THREE.Mesh(geos.glass, mats.glass);
    glass.position.y = railY + bodyH * 0.64;
    car.add(glass);
    windows.push(glass);

    const stripe = new THREE.Mesh(geos.stripe, mats.accent);
    stripe.position.y = railY + bodyH * 0.4;
    car.add(stripe);
    if (L.accent2) {
      const s2 = new THREE.Mesh(geos.stripe2, mats.accent2);
      s2.position.y = railY + bodyH * 0.28;
      car.add(s2);
    }

    for (const dx of [-L.carLen * 0.27, L.carLen * 0.27]) {
      const door = new THREE.Mesh(geos.door, mats.dark);
      door.position.set(dx, railY + bodyH * 0.38, 0);
      car.add(door);
      doors.push({ mesh: door, baseX: dx, slide: 1.1 });
    }

    const roof = new THREE.Mesh(geos.roofUnit, mats.dark);
    roof.position.y = railY + bodyH + 0.1;
    car.add(roof);

    if (L.monorail) {
      const beam = new THREE.Mesh(geos.beam, mats.dark);
      beam.position.y = railY / 2;
      car.add(beam);
    } else {
      for (const bx of [-L.carLen * 0.3, L.carLen * 0.3]) {
        const bogie = new THREE.Mesh(geos.bogie, mats.dark);
        bogie.position.set(bx, railY / 2, 0);
        car.add(bogie);
      }
    }

    if (c < L.cars - 1) {
      const gw = new THREE.Mesh(geos.gangway, mats.dark);
      gw.position.set(L.carLen / 2 + gap / 2, railY + bodyH * 0.45, 0);
      car.add(gw);
    }

    // cab face on end cars: swept windshield + line-colored mask + lamps
    if (isHead || isTail) {
      const dir = isHead ? 1 : -1;
      const fx = dir * (L.carLen / 2 - 0.12);
      const shield = new THREE.Mesh(geos.shield, mats.glass);
      shield.position.set(fx, railY + bodyH * 0.66, 0);
      shield.rotation.z = -dir * 0.32;
      car.add(shield);
      windows.push(shield);
      const mask = new THREE.Mesh(geos.mask, mats.accent);
      mask.position.set(fx + dir * 0.03, railY + bodyH * 0.34, 0);
      mask.rotation.z = -dir * 0.18;
      car.add(mask);
      for (const side of [-1, 1]) {
        const lamp = new THREE.Mesh(geos.lamp, mats.light);
        lamp.position.set(fx + dir * 0.12, railY + bodyH * 0.24, side * L.width * 0.3);
        car.add(lamp);
      }
    }

    group.add(car);
    x0 += L.carLen + gap;
  }

  group.userData = { doors, windows, kind, length: total, glassMat: mats.glass };
  return group;
}

// doorAnim 0..1 (sliding), nightEmissive lights the glazing after dark
export function updateTrainFX(group, doorAnim, nightEmissive) {
  for (const d of group.userData.doors) {
    d.mesh.position.x = d.baseX + d.slide * doorAnim * Math.sign(d.baseX || 1);
  }
  group.userData.glassMat.emissiveIntensity = nightEmissive;
}
