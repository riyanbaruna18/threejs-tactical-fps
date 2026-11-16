// DUSTLINE compound: an original 3-lane map, 64 x 44 m. South yard (PHANTOM spawn)
// feeds three lanes — A-main east, mid, B-main west — into two bomb sites, Foundry (A)
// and Cistern (B), with a north yard behind them for VANGUARD rotations. Every wall is
// a box collider and a bullet stopper; the waypoint graph below is laid out so every
// consecutive pair of nodes has a clear straight line between them.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WALL_H = 3.4;

export function buildMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mats = {};
  for (const [name, hex] of Object.entries(PALETTE)) {
    mats[name] = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.92, metalness: 0.04 });
  }
  mats.rust.roughness = 0.75;
  mats.steel.roughness = 0.5;
  mats.steel.metalness = 0.45;
  mats.ground.roughness = 1;

  const colliders = [];
  const shootables = [];
  const walls2d = [];

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
      if (h >= 1 && w <= 40 && d <= 40) walls2d.push({ x, z, w, d });
    }
    return mesh;
  }

  // Floor (the ground collider actors stand on) and site floor inlays.
  box(65.2, 0.4, 45.2, 0, -0.2, 0, 'ground');
  box(12, 0.06, 13, 24, 0.03, -9, 'sandLight', false);
  box(12, 0.06, 13, -24, 0.03, -9, 'sandLight', false);
  box(10, 0.06, 10, 0, 0.03, -18.5, 'concreteDark', false);

  // Perimeter, 5 m high.
  box(65.2, 5, 0.6, 0, 2.5, -22.3, 'concrete');
  box(65.2, 5, 0.6, 0, 2.5, 22.3, 'concrete');
  box(0.6, 5, 45.2, -32.3, 2.5, 0, 'concrete');
  box(0.6, 5, 45.2, 32.3, 2.5, 0, 'concrete');

  // z=2 divider: south yard vs north half. Gaps: mid [-1.5,1.5], A [15,19], B [-19,-15].
  box(13, WALL_H, 0.6, -25.5, WALL_H / 2, 2, 'concrete');
  box(13.5, WALL_H, 0.6, -8.25, WALL_H / 2, 2, 'concrete');
  box(13.5, WALL_H, 0.6, 8.25, WALL_H / 2, 2, 'concrete');
  box(13, WALL_H, 0.6, 25.5, WALL_H / 2, 2, 'concrete');

  // Mid/A and mid/B dividers (x=+/-5), with the short-connector gap at z [-8,-4].
  box(0.6, WALL_H, 8, 5, WALL_H / 2, -12, 'concrete');
  box(0.6, WALL_H, 6, 5, WALL_H / 2, -1, 'concrete');
  box(0.6, WALL_H, 8, -5, WALL_H / 2, -12, 'concrete');
  box(0.6, WALL_H, 6, -5, WALL_H / 2, -1, 'concrete');

  // Short-connector north walls (z=-8): the corridor roofs the band z [-8,-4].
  box(13, WALL_H, 0.6, 11.5, WALL_H / 2, -8, 'concrete');
  box(13, WALL_H, 0.6, -11.5, WALL_H / 2, -8, 'concrete');

  // Site A (Foundry): west wall with the pocket gap z [-13,-11] and the main gap
  // z [-8,-2]; south wall with the A-main gap x [18,21]; north wall gap x [24,28].
  box(0.6, WALL_H, 3, 18, WALL_H / 2, -14.5, 'rust');
  box(0.6, WALL_H, 3, 18, WALL_H / 2, -9.5, 'rust');
  box(9, WALL_H, 0.6, 25.5, WALL_H / 2, -2, 'rust');
  box(6, WALL_H, 0.6, 21, WALL_H / 2, -16, 'rust');
  box(2, WALL_H, 0.6, 29, WALL_H / 2, -16, 'rust');
  // Site B (Cistern), mirrored.
  box(0.6, WALL_H, 3, -18, WALL_H / 2, -14.5, 'rust');
  box(0.6, WALL_H, 3, -18, WALL_H / 2, -9.5, 'rust');
  box(9, WALL_H, 0.6, -25.5, WALL_H / 2, -2, 'rust');
  box(6, WALL_H, 0.6, -21, WALL_H / 2, -16, 'rust');
  box(2, WALL_H, 0.6, -29, WALL_H / 2, -16, 'rust');

  // Crates and containers: cover that stays clear of every waypoint line.
  const crates = [
    // south yard
    [2, 1.2, 2, -14, 0.6, 14, 'steel'], [2, 1.2, 2, 14, 0.6, 18, 'steel'],
    [1.5, 1, 1.5, -10, 0.5, 6, 'concreteDark'], [1.5, 1, 1.5, 10, 0.5, 4, 'concreteDark'],
    // mid
    [1.2, 1.1, 1.2, 3, 0.55, 8, 'concreteDark'], [1.2, 1.1, 1.2, -3, 0.55, -2, 'concreteDark'],
    // site A
    [4, 2.4, 2, 20, 1.2, -14, 'rust'], [2, 1.2, 2, 21, 0.6, -13, 'steel'],
    [1.5, 1.5, 1.5, 27, 0.75, -4, 'concreteDark'], [1, 1, 1, 19, 0.5, -5, 'steel'],
    [2, 1.2, 2, 26, 0.6, 0, 'steel'],
    // site B
    [4, 2.4, 2, -20, 1.2, -14, 'rust'], [2, 1.2, 2, -21, 0.6, -13, 'steel'],
    [1.5, 1.5, 1.5, -27, 0.75, -4, 'concreteDark'], [1, 1, 1, -19, 0.5, -5, 'steel'],
    [2, 1.2, 2, -26, 0.6, 0, 'steel'],
    // north yard / pockets
    [2, 1.2, 2, -12, 0.6, -19, 'steel'], [2, 1.2, 2, 12, 0.6, -19, 'steel'],
    [1.5, 1.2, 1.5, 9, 0.6, -12, 'concreteDark'], [1.5, 1.2, 1.5, -9, 0.6, -12, 'concreteDark'],
  ];
  for (const [w, h, d, x, y, z, mat] of crates) box(w, h, d, x, y, z, mat);

  // Site markers: amber pillars + floating letters, so a site reads at a glance.
  for (const [sx, label] of [[24, 'A'], [-24, 'B']]) {
    box(0.5, 4.4, 0.5, sx - 5.5, 2.2, -15.5, 'accent');
    box(0.5, 4.4, 0.5, sx + 5.5, 2.2, -15.5, 'accent');
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 2.2, 0.2),
      new THREE.MeshStandardMaterial({ color: PALETTE.accent, emissive: PALETTE.accent, emissiveIntensity: 0.7 }),
    );
    sign.position.set(sx, 3.6, -15.6);
    group.add(sign);
    shootables.push(sign);
    void label;
  }

  // Distant skyline silhouettes outside the walls, for depth.
  const skyline = new THREE.Group();
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x2e3a4e, fog: true });
  const skyGeo = new THREE.BoxGeometry(1, 1, 1);
  const skySeed = [38, -14, 9, 46, 20, 12, -40, 26, 7, 52, -30, 15, -52, 8, 11, 60, 4, 14];
  for (let i = 0; i < skySeed.length; i += 3) {
    const m = new THREE.Mesh(skyGeo, skyMat);
    m.scale.set(6 + (skySeed[i] % 5), skySeed[i + 2], 6);
    m.position.set(skySeed[i], skySeed[i + 2] / 2 - 0.5, skySeed[i + 1] > 0 ? 34 : -34);
    skyline.add(m);
  }
  scene.add(skyline);

  // Lighting: low dusk sun from the south-west, cool sky fill, warm bounce.
  const hemi = new THREE.HemisphereLight(0x8fa3c0, 0x5c4a33, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.7);
  sun.position.set(-18, 26, 22);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -38;
  sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 38;
  sun.shadow.camera.bottom = -38;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x6f86ad, 0.5);
  fill.position.set(14, 12, -18);
  scene.add(fill);

  return { colliders, shootables, group, walls2d };
}

// Waypoint graph. Nodes are open ground; every route below is a straight-line chain
// with no wall between consecutive nodes (verified against the wall list above).
export const WAYPOINTS = {
  pSpawn: { x: 0, z: 18.5 }, pMidS: { x: 0, z: 8 }, pMidDoor: { x: 0, z: 0 },
  pMidN: { x: 0, z: -6 }, pMidTop: { x: 0, z: -13 },
  pAdoor: { x: 17, z: 6 }, pA1: { x: 17, z: -0.5 }, pA2: { x: 17, z: -6 },
  pA3: { x: 24, z: -9 }, pA4: { x: 26, z: -12 },
  pShortA1: { x: 9, z: -6 }, pShortA2: { x: 14, z: -6 },
  pBdoor: { x: -17, z: 6 }, pB1: { x: -17, z: -0.5 }, pB2: { x: -17, z: -6 },
  pB3: { x: -24, z: -9 }, pB4: { x: -26, z: -12 },
  pShortB1: { x: -9, z: -6 }, pShortB2: { x: -14, z: -6 },
  vSpawn: { x: 0, z: -18.5 }, vMid: { x: 0, z: -14 },
  vA1: { x: 12, z: -14 }, vA2: { x: 24, z: -10 }, vA3: { x: 28, z: -6 },
  vB1: { x: -12, z: -14 }, vB2: { x: -24, z: -10 }, vB3: { x: -28, z: -6 },
};

export const ROUTES = {
  aLong: ['pSpawn', 'pAdoor', 'pA1', 'pA2', 'pA3', 'pA4'],
  aShort: ['pSpawn', 'pMidS', 'pMidDoor', 'pMidN', 'pShortA1', 'pShortA2', 'pA2', 'pA3', 'pA4'],
  midPush: ['pSpawn', 'pMidS', 'pMidDoor', 'pMidN', 'pMidTop', 'vMid'],
  bLong: ['pSpawn', 'pBdoor', 'pB1', 'pB2', 'pB3', 'pB4'],
  bShort: ['pSpawn', 'pMidS', 'pMidDoor', 'pMidN', 'pShortB1', 'pShortB2', 'pB2', 'pB3', 'pB4'],
  holdA: ['vSpawn', 'vA1', 'vA2'],
  holdA2: ['vSpawn', 'vA1', 'vA2', 'vA3'],
  holdB: ['vSpawn', 'vB1', 'vB2'],
  holdB2: ['vSpawn', 'vB1', 'vB2', 'vB3'],
  holdMid: ['vSpawn', 'vMid'],
  rotateAtoB: ['vA2', 'vA1', 'vSpawn', 'vB1', 'vB2'],
  rotateBtoA: ['vB2', 'vB1', 'vSpawn', 'vA1', 'vA2'],
  retakeA: ['vSpawn', 'vA1', 'vA2', 'pA3', 'pA4'],
  retakeB: ['vSpawn', 'vB1', 'vB2', 'pB3', 'pB4'],
};

export const SITES = {
  A: { name: 'Foundry', minX: 19, maxX: 29, minZ: -15, maxZ: -3, cx: 24, cz: -9 },
  B: { name: 'Cistern', minX: -29, maxX: -19, minZ: -15, maxZ: -3, cx: -24, cz: -9 },
};

export const SPAWNS = {
  PHANTOM: [
    { x: -3, z: 19.5 }, { x: -1, z: 20.5 }, { x: 1, z: 19.5 }, { x: 3, z: 20.5 }, { x: 0, z: 18.5 },
  ],
  VANGUARD: [
    { x: -3, z: -19.5 }, { x: -1, z: -20.5 }, { x: 1, z: -19.5 }, { x: 3, z: -20.5 }, { x: 0, z: -18.5 },
  ],
};

export const MAP_BOUNDS = { minX: -31.6, maxX: 31.6, minZ: -21.6, maxZ: 21.6 };
