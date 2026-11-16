// map.js — the Sundown Freightyard: one data table describes every solid
// box; the same table builds the three.js meshes and fills the collider
// list physics.js tests against, so the visible world and the collision
// world can never drift apart.
//
// Layout (metres, x east, z south, ground y=0): the Jackals spawn west, the
// Wardens east. A central mid lane runs the length of the yard; a warehouse
// anchors the north route to Site A (Crane Yard), an open depot lane runs
// south to Site B. Two divider walls with offset door gaps force rotations
// through mid or the long lanes — no straight line crosses the map.

import * as THREE from 'three';

export const PALETTE = {
  sky: 0x2c3644,
  fog: 0x9a6a4e,
  sun: 0xffb36b,
  ground: 0x55504b,
  wall: 0x8d8578,
  lowWall: 0x6e675c,
  steel: 0x3d454d,
  jackal: 0xd9822b,      // attacker amber
  jackalDark: 0x8a5316,
  warden: 0x2b8a94,      // defender teal
  wardenDark: 0x17555c,
  siteA: 0xffa63d,
  siteB: 0x3fd2c8,
  crate: 0x9a7b4f,
};

// Box table: [x, z, w, d, h, material, y0?] — centre x/z, footprint w×d,
// height h, optional base height y0 (crane beam). Materials: 'wall',
// 'lowwall', 'steel', 'crate', or a container colour key 'rust'|'teal'|
// 'slate'|'ochre'.
const BOXES = [
  // perimeter
  [0, -24.6, 67, 1.2, 4.6, 'wall'], [0, 24.6, 67, 1.2, 4.6, 'wall'],
  [-32.6, 0, 1.2, 50.4, 4.6, 'wall'], [32.6, 0, 1.2, 50.4, 4.6, 'wall'],
  // divider walls (door gaps offset so the lanes zig-zag)
  [-18, -6.5, 28, 1, 3.2, 'wall'], [7, -6.5, 14, 1, 3.2, 'wall'], [26, -6.5, 12, 1, 3.2, 'wall'],
  [-25, 6.5, 14, 1, 3.2, 'wall'], [-3, 6.5, 20, 1, 3.2, 'wall'], [22, 6.5, 20, 1, 3.2, 'wall'],
  // mid-lane containers
  [-13, -3.3, 6, 2.4, 2.6, 'rust'], [-13, 3.3, 6, 2.4, 2.6, 'teal'],
  [0, -3.3, 6, 2.4, 2.6, 'slate'], [0, 3.3, 6, 2.4, 2.6, 'ochre'],
  [13, -3.3, 6, 2.4, 2.6, 'teal'], [13, 3.3, 6, 2.4, 2.6, 'rust'],
  // mid low walls (crouch cover)
  [6.5, -1.7, 3, 0.5, 1.05, 'lowwall'], [-6.5, 1.7, 3, 0.5, 1.05, 'lowwall'],
  // warehouse (north route): west and east walls carry a door gap each
  [-11, -16.4, 1.2, 4.4, 5, 'wall'], [-11, -10.9, 1.2, 2.8, 5, 'wall'],
  [3, -16.4, 1.2, 4.4, 5, 'wall'], [3, -10.9, 1.2, 2.8, 5, 'wall'],
  [-4, -18.6, 15.2, 1.2, 5, 'wall'],
  [-6.5, -12, 2, 2, 1.15, 'crate'], [-1.5, -15.5, 2, 2, 2.3, 'crate'],
  // spawn-yard containers
  [-22, -8.5, 6, 2.4, 2.6, 'slate'], [-22, 8.5, 6, 2.4, 2.6, 'rust'],
  [28.5, -1.5, 2.4, 6, 2.6, 'slate'],
  // Site A — Crane Yard
  [18, -17.5, 6, 2.4, 2.6, 'rust'], [24.5, -10.8, 2.4, 6, 2.6, 'teal'],
  [20, -11.8, 2, 2, 1.15, 'crate'], [26.5, -15.5, 2, 2, 1.15, 'crate'],
  [15.8, -14, 0.5, 3, 1.05, 'lowwall'],
  // crane legs + beam (beam is high: a visual landmark, still a collider)
  [16.5, -19, 0.45, 0.45, 9, 'steel'], [27.5, -19, 0.45, 0.45, 9, 'steel'],
  [16.5, -9.5, 0.45, 0.45, 9, 'steel'], [27.5, -9.5, 0.45, 0.45, 9, 'steel'],
  [22, -14.25, 0.7, 11.5, 0.8, 'steel', 8.4],
  // Site B — Depot
  [24, 12.3, 6, 2.4, 2.6, 'ochre'], [17.5, 17.8, 2.4, 6, 2.6, 'rust'],
  [20.5, 15.8, 2, 2, 2.3, 'crate'], [26.5, 10.8, 2, 2, 1.15, 'crate'],
  [15.8, 13, 0.5, 3, 1.05, 'lowwall'],
  // lane cover
  [-16, -13, 2, 2, 1.15, 'crate'], [9, 12.5, 2, 2, 1.15, 'crate'],
  [18, 3.3, 6, 2.4, 2.6, 'slate'],
];

export const SITES = {
  A: { id: 'A', name: 'Crane Yard', minX: 14.5, maxX: 29.5, minZ: -20.5, maxZ: -8.5, plant: { x: 22, z: -14 }, color: PALETTE.siteA },
  B: { id: 'B', name: 'Depot', minX: 14.5, maxX: 29.5, minZ: 8.5, maxZ: 20.5, plant: { x: 22, z: 14 }, color: PALETTE.siteB },
};

export function siteAt(x, z) {
  for (const id of ['A', 'B']) {
    const s = SITES[id];
    if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return s;
  }
  return null;
}

export const SPAWNS = {
  jackal: [
    { x: -27, z: -4, yaw: -Math.PI / 2 }, { x: -28, z: 0, yaw: -Math.PI / 2 },
    { x: -27, z: 4, yaw: -Math.PI / 2 }, { x: -25.5, z: -2, yaw: -Math.PI / 2 },
    { x: -25.5, z: 2, yaw: -Math.PI / 2 },
  ],
  warden: [
    { x: 27, z: -5, yaw: Math.PI / 2 }, { x: 28, z: 0, yaw: Math.PI / 2 },
    { x: 27, z: 5, yaw: Math.PI / 2 }, { x: 25.5, z: -2.5, yaw: Math.PI / 2 },
    { x: 25.5, z: 2.5, yaw: Math.PI / 2 },
  ],
};

// Waypoint graph for bot routing. Nodes are [x, z]; edges are index pairs.
// Every lane, door and site is reachable from both spawns.
export const WAYPOINTS = {
  nodes: [
    [-26, 0], [-19, 0], [-9, 0], [3, 0], [14, 0], [21, 0],           // 0-5 mid spine
    [-2, -6.5], [-14, -13], [-4, -13], [8, -13], [17, -6.5],        // 6-10 north
    [22, -14], [26, -17.5],                                          // 11-12 site A
    [-15.5, 6.5], [-14, 13], [-3, 12.5], [9.5, 6.5], [12, 13],      // 13-17 south
    [22, 14], [26, 17.5],                                            // 18-19 site B
    [26, 0],                                                         // 20 warden spawn
  ],
  edges: [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 20],
    [3, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [10, 5],
    [1, 13], [13, 14], [14, 15], [15, 17], [17, 18], [18, 19], [17, 16], [16, 4],
    [0, 7], [0, 14], [20, 11], [20, 18],
  ],
};

// Positions bots hold when defending or after a plant, with the point they
// watch. faceYaw is derived from the watch point when a bot takes the spot.
export const COVERS = {
  A: [
    { x: 19.2, z: -16.2, lookX: 8, lookZ: -12 },
    { x: 25.8, z: -12.2, lookX: 16, lookZ: -8 },
    { x: 21.5, z: -18.8, lookX: 17, lookZ: -6.5 },
    { x: 16.8, z: -11.5, lookX: 22, lookZ: -14 },
  ],
  B: [
    { x: 19.2, z: 16.4, lookX: 8, lookZ: 12 },
    { x: 25.8, z: 12.4, lookX: 16, lookZ: 8 },
    { x: 21.5, z: 18.8, lookX: 17, lookZ: 6.5 },
    { x: 16.8, z: 11.2, lookX: 22, lookZ: 14 },
  ],
  mid: [
    { x: 16.5, z: -1.8, lookX: -10, lookZ: 0 },
    { x: 5.2, z: 1.9, lookX: 26, lookZ: 0 },
  ],
};

// ---- scene construction -----------------------------------------------------

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function containerTexture(base, rib) {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    g.fillStyle = rib;
    for (let x = 8; x < 256; x += 24) g.fillRect(x, 0, 9, 256);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 10; g.strokeRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, 256, 14);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let i = 0; i < 40; i++) g.fillRect((i * 67) % 256, (i * 41) % 256, 22, 5);
  });
}

function groundTexture() {
  // One painted asphalt sheet for the whole yard: lane lines, crosswalks
  // and the two site aprons with their letters, drawn in map coordinates.
  const W = 1408, H = 1056, sx = W / 70, sz = H / 54;
  const px = (x) => (x + 35) * sx, pz = (z) => (z + 27) * sz;
  return canvasTexture(W, H, (g) => {
    g.fillStyle = '#514f4d'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 5200; i++) {
      g.fillStyle = i % 2 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.05)';
      g.fillRect((i * 131) % W, (i * 197) % H, 3, 3);
    }
    g.strokeStyle = 'rgba(232,200,120,0.55)'; g.lineWidth = 4; g.setLineDash([26, 20]);
    g.beginPath(); g.moveTo(px(-31), pz(0)); g.lineTo(px(31), pz(0)); g.stroke();
    g.setLineDash([]);
    for (const s of [SITES.A, SITES.B]) {
      g.fillStyle = s.id === 'A' ? 'rgba(255,166,61,0.13)' : 'rgba(63,210,200,0.13)';
      g.fillRect(px(s.minX), pz(s.minZ), (s.maxX - s.minX) * sx, (s.maxZ - s.minZ) * sz);
      g.strokeStyle = s.id === 'A' ? '#ffa63d' : '#3fd2c8'; g.lineWidth = 6;
      g.strokeRect(px(s.minX), pz(s.minZ), (s.maxX - s.minX) * sx, (s.maxZ - s.minZ) * sz);
      g.fillStyle = s.id === 'A' ? 'rgba(255,166,61,0.8)' : 'rgba(63,210,200,0.8)';
      g.font = `900 ${Math.round(7 * sz)}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(s.id, px((s.minX + s.maxX) / 2), pz((s.minZ + s.maxZ) / 2));
    }
    g.fillStyle = 'rgba(255,255,255,0.20)';
    g.fillRect(px(-30.5), pz(-5.4), 9 * sx, 0.5 * sz);
    g.fillRect(px(21.5), pz(4.9), 9 * sx, 0.5 * sz);
  });
}

export function buildWorld(scene) {
  const colliders = [];

  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(0x8a6248, 70, 190);

  // Dusk sky dome: a vertical gradient, deep blue overhead melting into
  // the orange band the yard is lit by.
  const skyTex = canvasTexture(16, 512, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#1d2836');
    grad.addColorStop(0.42, '#3d4450');
    grad.addColorStop(0.62, '#8a5a44');
    grad.addColorStop(0.74, '#e08a4e');
    grad.addColorStop(0.82, '#f7b267');
    grad.addColorStop(1, '#5a4034');
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 512);
  });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xffd9b0, 0x3d4a56, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.5);
  sun.position.set(38, 42, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 38; sun.shadow.camera.bottom = -38;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 54),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Distant skyline silhouettes for depth past the walls.
  const skylineMat = new THREE.MeshBasicMaterial({ color: 0x232d36 });
  const skyline = new THREE.Mesh(new THREE.BoxGeometry(30, 16, 2), skylineMat);
  skyline.position.set(-30, 8, -34); scene.add(skyline);
  const skyline2 = new THREE.Mesh(new THREE.BoxGeometry(22, 11, 2), skylineMat);
  skyline2.position.set(26, 5.5, -34); scene.add(skyline2);
  const skyline3 = new THREE.Mesh(new THREE.BoxGeometry(26, 13, 2), skylineMat);
  skyline3.position.set(8, 6.5, 34); scene.add(skyline3);

  // Materials
  const wallTex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#8d8578'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 3;
    for (let y = 0; y <= 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    for (let x = 0; x <= 256; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 218, 256, 38);
  });
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  const crateTex = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#9a7b4f'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(60,40,18,0.55)'; g.lineWidth = 4;
    for (let y = 0; y <= 128; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
    g.strokeRect(4, 4, 120, 120);
  });
  const mats = {
    wall: new THREE.MeshLambertMaterial({ map: wallTex }),
    lowwall: new THREE.MeshLambertMaterial({ color: PALETTE.lowWall }),
    steel: new THREE.MeshLambertMaterial({ color: PALETTE.steel }),
    crate: new THREE.MeshLambertMaterial({ map: crateTex }),
    rust: new THREE.MeshLambertMaterial({ map: containerTexture('#a34a2e', 'rgba(0,0,0,0.18)') }),
    teal: new THREE.MeshLambertMaterial({ map: containerTexture('#2e6f6a', 'rgba(0,0,0,0.18)') }),
    slate: new THREE.MeshLambertMaterial({ map: containerTexture('#54606a', 'rgba(0,0,0,0.20)') }),
    ochre: new THREE.MeshLambertMaterial({ map: containerTexture('#b57e2e', 'rgba(0,0,0,0.18)') }),
  };
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  for (const [x, z, w, d, h, mat, y0 = 0] of BOXES) {
    const mesh = new THREE.Mesh(unitBox, mats[mat]);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y0 + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push({
      minX: x - w / 2, maxX: x + w / 2,
      minY: y0, maxY: y0 + h,
      minZ: z - d / 2, maxZ: z + d / 2,
    });
  }

  // Fuel drums on Site B and by the warehouse door: cylinders for looks,
  // boxes for collision so physics stays AABB-only.
  const drumMat = new THREE.MeshLambertMaterial({ color: 0x7a4a26 });
  const drumGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.15, 12);
  for (const [x, z] of [[25.6, 18.6], [24.6, 18.9], [25.1, 17.6], [-8.6, -8.6], [19.5, -18.9]]) {
    const drum = new THREE.Mesh(drumGeo, drumMat);
    drum.position.set(x, 0.575, z);
    drum.castShadow = true;
    scene.add(drum);
    colliders.push({ minX: x - 0.55, maxX: x + 0.55, minY: 0, maxY: 1.15, minZ: z - 0.55, maxZ: z + 0.55 });
  }

  // Lamp posts: emissive heads that read as sodium yard lights at dusk.
  const poleMat = new THREE.MeshLambertMaterial({ color: PALETTE.steel });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffc37a });
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.09, 5.4, 8);
  const lampGeo = new THREE.SphereGeometry(0.22, 10, 8);
  for (const [x, z] of [[-19, -5.2], [3, 5.2], [21, -5.2], [-19, 5.2], [14.8, -13], [14.8, 13]]) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 2.7, z);
    scene.add(pole);
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(x, 5.5, z);
    scene.add(lamp);
    const glow = new THREE.PointLight(0xffa050, 26, 16, 1.8);
    glow.position.set(x, 5.3, z);
    scene.add(glow);
  }

  return { colliders };
}
