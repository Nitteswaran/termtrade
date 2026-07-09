// Procedural low-poly train models, livery-matched to real Malaysian
// rolling stock. Built in a frame where forward = +X, up = +Y, origin at
// rail level under the consist centre. Every mesh is cheap (boxes +
// tapered noses) so 200+ trains render at 60 fps; swap any of these for a
// GLB from Sketchfab/CGTrader later via userData.slots.
import * as THREE from 'three';

// One shared geometry cache
const geo = {
  box: new THREE.BoxGeometry(1, 1, 1),
};

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.5, ...opts });
}

// Box with the +X end tapered in (cab nose).
function taperedNose(len, w, h, taper = 0.45) {
  const g = new THREE.BoxGeometry(len, h, w, 1, 1, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getX(i) > 0) {
      pos.setY(i, pos.getY(i) * (1 - taper * 0.55) - h * taper * 0.1);
      pos.setZ(i, pos.getZ(i) * (1 - taper));
    }
  }
  g.computeVertexNormals();
  return g;
}

export const LIVERIES = {
  // LRT Kelana Jaya — Bombardier Innovia: brushed steel, red mask & doors
  KJ: { body: 0xd8dadd, accent: 0xd50032, windows: 0x14171c, doors: 0xd50032, cars: 4, carLen: 16.5, width: 2.7, height: 3.3, altitude: 13, },
  // LRT Ampang — CRRC AMY: white, tangerine stripe
  AG: { body: 0xe8e6e1, accent: 0xe57200, windows: 0x14171c, doors: 0x3a3d42, cars: 4, carLen: 19, width: 2.8, height: 3.5, altitude: 13, },
  // LRT Sri Petaling — CRRC AMY: white, maroon stripe
  PH: { body: 0xe8e6e1, accent: 0x76232f, windows: 0x14171c, doors: 0x3a3d42, cars: 4, carLen: 19, width: 2.8, height: 3.5, altitude: 13, },
  // MRT Kajang — Siemens Inspiro: silver, emerald band
  KGL: { body: 0xc9cdd2, accent: 0x047940, windows: 0x101418, doors: 0x047940, cars: 4, carLen: 22, width: 3.1, height: 3.7, altitude: 15, },
  // MRT Putrajaya — Innovia Metro 300: silver, gold band
  PYL: { body: 0xc9cdd2, accent: 0xffcd00, windows: 0x101418, doors: 0x2e3238, cars: 4, carLen: 22, width: 3.1, height: 3.7, altitude: 15, },
  // KL Monorail — Scomi SUTRA: lime green, compact
  MR: { body: 0x9dc94c, accent: 0x2e5410, windows: 0x0f1410, doors: 0x2e5410, cars: 2, carLen: 12, width: 2.6, height: 3.2, monorail: true, altitude: 9, },
  // BRT Sunway — electric bus
  BRT: { body: 0xdfe3e6, accent: 0x115740, windows: 0x14171c, doors: 0x115740, cars: 1, carLen: 12, width: 2.5, height: 3.1, altitude: 6, },
  // LRT Shah Alam — new CRRC sets, magenta identity
  SA: { body: 0xe4e4e8, accent: 0xd6006e, windows: 0x14171c, doors: 0xd6006e, cars: 3, carLen: 19, width: 2.8, height: 3.5, altitude: 13, },
  // KTM Komuter Class 92 — white, red/blue swoosh
  KTMB: { body: 0xf2f1ee, accent: 0x1c3f94, accent2: 0xdc2420, windows: 0x14171c, doors: 0x1c3f94, cars: 5, carLen: 21, width: 3.0, height: 3.9, altitude: 0.5, },
};

export function buildTrain(kind) {
  const L = LIVERIES[kind] || LIVERIES.KJ;
  const group = new THREE.Group();
  const doors = [];
  const windows = [];
  const gap = 0.55;
  const total = L.cars * L.carLen + (L.cars - 1) * gap;
  let x0 = -total / 2;

  const bodyMat = mat(L.body);
  const accentMat = mat(L.accent, { metalness: 0.2, roughness: 0.5 });
  const accent2Mat = L.accent2 ? mat(L.accent2, { metalness: 0.2, roughness: 0.5 }) : accentMat;
  const winMat = new THREE.MeshStandardMaterial({
    color: L.windows, metalness: 0.1, roughness: 0.2,
    emissive: 0xffd9a0, emissiveIntensity: 0,
  });
  const doorMat = mat(L.doors, { metalness: 0.2, roughness: 0.55 });
  const darkMat = mat(0x1a1d22, { metalness: 0.1, roughness: 0.85 });

  const railY = L.monorail ? 0.9 : 0.55; // monorail straddles its beam
  for (let c = 0; c < L.cars; c++) {
    const cx = x0 + L.carLen / 2;
    const isHead = c === 0, isTail = c === L.cars - 1;
    const car = new THREE.Group();
    car.position.set(cx, 0, 0);

    const bodyH = L.height - 0.5;
    const bodyLen = L.carLen - (isHead || isTail ? 3.2 : 0);
    const bodyOffset = isHead ? -1.6 : isTail ? 1.6 : 0;

    const body = new THREE.Mesh(geo.box, bodyMat);
    body.scale.set(bodyLen, bodyH, L.width);
    body.position.set(bodyOffset, railY + bodyH / 2, 0);
    car.add(body);

    // cab noses
    if (isHead || isTail) {
      const nose = new THREE.Mesh(taperedNose(3.4, L.width, bodyH), bodyMat);
      nose.position.set(isHead ? bodyOffset + bodyLen / 2 + 1.55 : bodyOffset - bodyLen / 2 - 1.55, railY + bodyH / 2, 0);
      if (isTail) nose.rotation.y = Math.PI;
      car.add(nose);
      // windshield
      const shield = new THREE.Mesh(geo.box, winMat);
      shield.scale.set(0.9, bodyH * 0.42, L.width * 0.78);
      shield.position.set(isHead ? bodyOffset + bodyLen / 2 + 1.2 : bodyOffset - bodyLen / 2 - 1.2, railY + bodyH * 0.68, 0);
      shield.rotation.z = isHead ? -0.25 : 0.25;
      car.add(shield);
      windows.push(shield);
    }

    // window band (both sides)
    for (const side of [-1, 1]) {
      const band = new THREE.Mesh(geo.box, winMat);
      band.scale.set(bodyLen * 0.92, bodyH * 0.34, 0.06);
      band.position.set(bodyOffset, railY + bodyH * 0.66, side * (L.width / 2 + 0.01));
      car.add(band);
      windows.push(band);

      // accent stripe under windows
      const stripe = new THREE.Mesh(geo.box, accentMat);
      stripe.scale.set(bodyLen * 0.98, 0.28, 0.05);
      stripe.position.set(bodyOffset, railY + bodyH * 0.42, side * (L.width / 2 + 0.02));
      car.add(stripe);
      if (L.accent2) {
        const stripe2 = new THREE.Mesh(geo.box, accent2Mat);
        stripe2.scale.set(bodyLen * 0.98, 0.18, 0.05);
        stripe2.position.set(bodyOffset, railY + bodyH * 0.3, side * (L.width / 2 + 0.02));
        car.add(stripe2);
      }

      // two sliding doors per side per car
      for (const dx of [-bodyLen * 0.28, bodyLen * 0.28]) {
        const door = new THREE.Mesh(geo.box, doorMat);
        door.scale.set(1.4, bodyH * 0.72, 0.08);
        door.position.set(bodyOffset + dx, railY + bodyH * 0.4, side * (L.width / 2 + 0.03));
        car.add(door);
        doors.push({ mesh: door, baseX: bodyOffset + dx, slide: 1.15 });
      }
    }

    // roof unit
    const roof = new THREE.Mesh(geo.box, darkMat);
    roof.scale.set(bodyLen * 0.5, 0.22, L.width * 0.55);
    roof.position.set(bodyOffset, railY + bodyH + 0.11, 0);
    car.add(roof);

    // bogies / underframe
    if (L.monorail) {
      const beamGrip = new THREE.Mesh(geo.box, darkMat);
      beamGrip.scale.set(bodyLen * 0.8, railY, 0.8);
      beamGrip.position.set(bodyOffset, railY / 2, 0);
      car.add(beamGrip);
    } else {
      for (const bx of [-bodyLen * 0.32, bodyLen * 0.32]) {
        const bogie = new THREE.Mesh(geo.box, darkMat);
        bogie.scale.set(2.4, railY, L.width * 0.7);
        bogie.position.set(bodyOffset + bx, railY / 2, 0);
        car.add(bogie);
      }
    }

    // gangway to next car
    if (c < L.cars - 1) {
      const gang = new THREE.Mesh(geo.box, darkMat);
      gang.scale.set(gap + 0.3, bodyH * 0.8, L.width * 0.8);
      gang.position.set(x0 + L.carLen + gap / 2, railY + bodyH * 0.45, 0);
      car.add(gang);
    }

    group.add(car);
    x0 += L.carLen + gap;
  }

  // headlight glow sprite on lead cab
  const head = new THREE.Mesh(
    geo.box,
    new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff2c8, emissiveIntensity: 1.4 })
  );
  head.scale.set(0.15, 0.18, L.width * 0.5);
  head.position.set(total / 2 - 0.05, railY + 0.7, 0);
  group.add(head);

  group.userData = { doors, windows, kind, length: total, altitude: L.altitude ?? 0 };
  return group;
}

// Animate: doorAnim 0..1, nightFactor 0..1
export function updateTrainFX(group, doorAnim, nightEmissive) {
  for (const d of group.userData.doors) {
    d.mesh.position.x = d.baseX + d.slide * doorAnim;
    d.mesh.scale.x = 1.4 * (1 - 0.85 * doorAnim);
  }
  for (const w of group.userData.windows) {
    w.material.emissiveIntensity = nightEmissive;
  }
}
