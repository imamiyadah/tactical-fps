// bots.js — the nine AI combatants. Each bot runs the same perception and
// gunplay rules as the player: it sees through a vision cone with a
// line-of-sight ray, hears gunfire and sprinting from the shared noise
// list, needs a reaction beat before its first shot, fires in bursts, and
// stops moving to shoot — because its spread obeys the same model.
//
// Brains tick on a stagger (a think every ~0.12 s per bot) while movement
// and firing run every simulation step. Routing is breadth-first search
// over the waypoint graph in map.js; defenders hold cover points, the
// attacking team follows the round's called strategy.

import * as THREE from 'three';
import { WEAPONS, currentWeapon, rand } from './state.js';
import { WAYPOINTS, COVERS, PALETTE } from './map.js';
import { moveAndCollide, segmentBlocked } from './physics.js';
import { eyeHeight, chestHeight } from './weapons.js';

// ---- pathfinding ------------------------------------------------------------
const ADJ = WAYPOINTS.nodes.map(() => []);
for (const [a, b] of WAYPOINTS.edges) { ADJ[a].push(b); ADJ[b].push(a); }

function nearestNode(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.nodes.length; i++) {
    const n = WAYPOINTS.nodes[i];
    const d = (n[0] - x) * (n[0] - x) + (n[1] - z) * (n[1] - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function findPath(fromIdx, toIdx) {
  if (fromIdx === toIdx) return [toIdx];
  const prev = new Array(WAYPOINTS.nodes.length).fill(-1);
  const queue = [fromIdx];
  prev[fromIdx] = fromIdx;
  while (queue.length) {
    const cur = queue.shift();
    if (cur === toIdx) break;
    for (const nb of ADJ[cur]) if (prev[nb] === -1) { prev[nb] = cur; queue.push(nb); }
  }
  if (prev[toIdx] === -1) return [toIdx];
  const path = [];
  let cur = toIdx;
  while (cur !== fromIdx) { path.push(cur); cur = prev[cur]; }
  path.reverse();
  return path;
}

// ---- bot lifecycle ------------------------------------------------------------
export function makeBotBrain(G, e, skill) {
  e.bot = {
    skill,                       // 0..1: reaction time and aim error scale
    state: 'route',              // route | hold | engage | investigate | plant | defuse | cover
    path: [], pathI: 0,
    finalX: e.pos.x, finalZ: e.pos.z,
    holdX: e.pos.x, holdZ: e.pos.z, lookX: 0, lookZ: 0,
    target: null,                // entity currently engaged
    seenAt: -99, reactAt: 0,
    lastSeenX: 0, lastSeenZ: 0, lastSeenAt: -99,
    nextThinkAt: rand(G) * 0.12,
    burstLeft: 0, burstWaitUntil: 0,
    strafeDir: 1, strafeAt: 0,
    grenadeAt: 0,
    investigateUntil: 0,
  };
  return e.bot;
}

// Send a bot to an off-graph point: path to the nearest graph node, then a
// straight final leg.
function orderMove(G, e, tx, tz) {
  const b = e.bot;
  const from = nearestNode(e.pos.x, e.pos.z);
  const to = nearestNode(tx, tz);
  b.path = findPath(from, to);
  b.pathI = 0;
  b.finalX = tx; b.finalZ = tz;
}

export function orderHold(G, e, cover) {
  const b = e.bot;
  orderMove(G, e, cover.x, cover.z);
  b.holdX = cover.x; b.holdZ = cover.z;
  b.lookX = cover.lookX; b.lookZ = cover.lookZ;
  b.state = 'route';
  b.afterRoute = 'hold';
}

export function orderToSite(G, e, site, plantTeam) {
  const b = e.bot;
  if (plantTeam && e.hasBomb) {
    orderMove(G, e, site.plant.x, site.plant.z);
    b.afterRoute = 'plant';
  } else {
    const covers = COVERS[site.id];
    const cover = covers[e.id % covers.length];
    orderMove(G, e, cover.x, cover.z);
    b.holdX = cover.x; b.holdZ = cover.z;
    // Attackers holding a taken site watch the defenders' side of the map.
    b.lookX = 26; b.lookZ = 0;
    b.afterRoute = 'hold';
  }
  b.state = 'route';
}

// ---- perception ---------------------------------------------------------------
function canSee(G, e, o, colliders) {
  const dx = o.pos.x - e.pos.x, dz = o.pos.z - e.pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > 58) return false;
  // Vision cone: 120 degrees around the facing direction.
  const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
  const dot = (dx * fx + dz * fz) / (dist || 1);
  if (dot < 0.5 && dist > 3.5) return false;
  const blocked = segmentBlocked(
    e.pos.x, e.pos.y + eyeHeight(e), e.pos.z,
    o.pos.x, o.pos.y + chestHeight(o), o.pos.z, colliders);
  return !blocked;
}

function think(G, e, combat) {
  const b = e.bot;
  const colliders = G.world.colliders;

  // Nearest visible enemy.
  let visible = null, vd = Infinity;
  for (const o of G.entities) {
    if (!o.alive || o.team === e.team) continue;
    if (canSee(G, e, o, colliders)) {
      const d = Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z);
      if (d < vd) { vd = d; visible = o; }
    }
  }
  if (visible) {
    if (b.target !== visible) { b.target = visible; b.reactAt = G.time + 0.24 + (1 - b.skill) * 0.34; }
    b.seenAt = G.time;
    b.lastSeenX = visible.pos.x; b.lastSeenZ = visible.pos.z; b.lastSeenAt = G.time;
  } else if (b.target && G.time - b.seenAt > 1.6) {
    b.target = null;
  }

  // Hearing: fresh loud noise from the enemy side draws one nearby bot.
  if (!visible && G.phase === 'live') {
    for (let i = G.noises.length - 1; i >= 0; i--) {
      const n = G.noises[i];
      if (G.time - n.at > 0.6) continue;
      const d = Math.hypot(n.x - e.pos.x, n.z - e.pos.z);
      if (d < n.radius && d > 6 && b.state !== 'plant' && b.state !== 'defuse') {
        b.lastSeenX = n.x; b.lastSeenZ = n.z; b.lastSeenAt = G.time;
        if (b.state === 'hold' && d < 26) { b.state = 'investigate'; b.investigateUntil = G.time + 6; orderMove(G, e, n.x, n.z); b.afterRoute = 'look'; }
        break;
      }
    }
  }

  // State transitions that do not need a visible target.
  if (b.state === 'investigate' && G.time > b.investigateUntil) { b.state = 'cover'; }
  if (b.state === 'cover') {
    // Return to the assigned hold spot after investigating.
    orderHold(G, e, { x: b.holdX, z: b.holdZ, lookX: b.lookX, lookZ: b.lookZ });
  }
  if (b.state === 'route' && b.pathI >= b.path.length) {
    const d = Math.hypot(b.finalX - e.pos.x, b.finalZ - e.pos.z);
    if (d < 1.1) {
      if (b.afterRoute === 'plant') b.state = 'plant';
      else if (b.afterRoute === 'defuse') b.state = 'defuse';
      else if (b.afterRoute === 'look') { b.state = 'investigate'; b.investigateUntil = G.time + 2.2; }
      else b.state = 'hold';
    }
  }

  // Low magazine and no eyes on anyone: reload.
  const w = currentWeapon(e);
  if (w && !visible && w.mag <= WEAPONS[w.defId].mag * 0.25) combat.startReload(G, e);
}

// ---- acting ---------------------------------------------------------------------
const aimTmp = { x: 0, y: 0, z: 0 };

function faceToward(e, tx, tz, dt, rate) {
  const want = Math.atan2(-(tx - e.pos.x), -(tz - e.pos.z));
  let diff = want - e.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const maxTurn = rate * dt;
  e.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
  return Math.abs(diff);
}

function driveToward(G, e, tx, tz, dt, speedMul = 1) {
  const dx = tx - e.pos.x, dz = tz - e.pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const w = currentWeapon(e);
  let max = (w ? WEAPONS[w.defId].moveSpeed : 5.2) * speedMul;
  if (e.crouch) max *= 0.5;
  const blend = Math.min(1, 10 * dt);
  if (dist > 0.05) {
    e.vel.x += (dx / dist * max - e.vel.x) * blend;
    e.vel.z += (dz / dist * max - e.vel.z) * blend;
  }
  // Soft separation so bots never stack inside each other.
  for (const o of G.entities) {
    if (o === e || !o.alive) continue;
    const sx = e.pos.x - o.pos.x, sz = e.pos.z - o.pos.z;
    const sd = Math.sqrt(sx * sx + sz * sz);
    if (sd > 0.001 && sd < 0.85) {
      e.vel.x += (sx / sd) * (0.85 - sd) * 6 * dt * 10;
      e.vel.z += (sz / sd) * (0.85 - sd) * 6 * dt * 10;
    }
  }
  moveAndCollide(e.pos, e.vel.x * dt, e.vel.z * dt, e.radius, 1.7, G.world.colliders);
  return dist;
}

function engage(G, e, combat, dt) {
  const b = e.bot;
  const t = b.target;
  const dist = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);

  // Aim with human-like error: worse against moving targets and at range,
  // better for skilled bots. The weapon's own spread applies on top.
  const tSpeed = Math.hypot(t.vel.x, t.vel.z);
  const err = (0.42 - b.skill * 0.27) * (0.6 + dist * 0.014) * (1 + tSpeed * 0.1);
  aimTmp.x = t.pos.x + (rand(G) - 0.5) * 2 * err;
  aimTmp.z = t.pos.z + (rand(G) - 0.5) * 2 * err;
  const headShot = rand(G) < 0.22 + b.skill * 0.2;
  aimTmp.y = t.pos.y + (headShot ? (t.crouch ? 1.18 : 1.62) : chestHeight(t)) + (rand(G) - 0.5) * err;

  faceToward(e, aimTmp.x, aimTmp.z, dt, 7.5);
  const dy = aimTmp.y - (e.pos.y + eyeHeight(e));
  const dh = Math.hypot(aimTmp.x - e.pos.x, aimTmp.z - e.pos.z) || 1;
  e.pitch = Math.atan2(dy, dh);

  // Movement: close in while the target is far or unseen; stop to shoot
  // when it is visible; sidestep between bursts at close range.
  const visibleNow = G.time - b.seenAt < 0.25;
  if (!visibleNow) {
    driveToward(G, e, b.lastSeenX, b.lastSeenZ, dt, 0.92);
    if (Math.hypot(b.lastSeenX - e.pos.x, b.lastSeenZ - e.pos.z) < 1.4 && G.time - b.lastSeenAt > 2.5) b.target = null;
    return;
  }
  if (dist > 27) driveToward(G, e, t.pos.x, t.pos.z, dt, 0.95);
  else if (G.time < b.burstWaitUntil && dist < 16) {
    if (G.time > b.strafeAt) { b.strafeDir = rand(G) < 0.5 ? -1 : 1; b.strafeAt = G.time + 0.5 + rand(G) * 0.7; }
    const px = -Math.cos(e.yaw) * b.strafeDir, pz = Math.sin(e.yaw) * b.strafeDir;
    driveToward(G, e, e.pos.x + px * 3, e.pos.z + pz * 3, dt, 0.45);
  } else {
    e.vel.x *= 0.7; e.vel.z *= 0.7;
    moveAndCollide(e.pos, e.vel.x * dt, e.vel.z * dt, e.radius, 1.7, G.world.colliders);
  }

  // Grenade: a spotted enemy at mid range sometimes eats one first.
  if (e.grenades > 0 && dist > 7 && dist < 19 && G.time > b.grenadeAt && rand(G) < 0.25) {
    b.grenadeAt = G.time + 9;
    const gx = (t.pos.x - e.pos.x) / dist, gz = (t.pos.z - e.pos.z) / dist;
    combat.throwGrenade(G, e, gx, 0.42, gz);
    return;
  }

  // Fire control: bursts separated by re-aim pauses.
  if (G.time < b.reactAt) return;
  const w = currentWeapon(e);
  if (!w) return;
  if (w.mag === 0) { combat.startReload(G, e); b.burstLeft = 0; return; }
  if (b.burstLeft <= 0) {
    if (G.time < b.burstWaitUntil) return;
    b.burstLeft = 2 + Math.floor(rand(G) * 4);
  }
  const ox = e.pos.x, oy = e.pos.y + eyeHeight(e), oz = e.pos.z;
  let dx = aimTmp.x - ox, dyy = aimTmp.y - oy, dz = aimTmp.z - oz;
  const dl = Math.sqrt(dx * dx + dyy * dyy + dz * dz) || 1;
  if (combat.fire(G, e, ox, oy, oz, dx / dl, dyy / dl, dz / dl)) {
    b.burstLeft--;
    if (b.burstLeft <= 0) b.burstWaitUntil = G.time + 0.3 + rand(G) * 0.55;
  }
}

export function stepBots(G, dt, combat) {
  for (const e of G.entities) {
    if (e.isPlayer || !e.bot) continue;
    if (!e.alive) { e.vel.x = 0; e.vel.z = 0; continue; }
    const b = e.bot;
    if (G.phase !== 'live') { e.vel.x *= 0.6; e.vel.z *= 0.6; continue; }

    if (G.time >= b.nextThinkAt) {
      b.nextThinkAt = G.time + 0.12;
      think(G, e, combat);
    }

    if (e.channel) { e.vel.x *= 0.6; e.vel.z *= 0.6; continue; }  // planting/defusing: hands busy

    if (b.target && b.target.alive) { engage(G, e, combat, dt); continue; }
    b.target = null;

    if (b.state === 'route') {
      let tx, tz;
      if (b.pathI < b.path.length) {
        const n = WAYPOINTS.nodes[b.path[b.pathI]];
        tx = n[0]; tz = n[1];
        if (Math.hypot(tx - e.pos.x, tz - e.pos.z) < 1.0) { b.pathI++; continue; }
      } else { tx = b.finalX; tz = b.finalZ; }
      faceToward(e, tx, tz, dt, 4.2);
      e.pitch *= 0.9;
      driveToward(G, e, tx, tz, dt, b.afterRoute === 'plant' ? 0.98 : 0.9);
    } else if (b.state === 'hold') {
      e.vel.x *= 0.75; e.vel.z *= 0.75;
      moveAndCollide(e.pos, e.vel.x * dt, e.vel.z * dt, e.radius, 1.7, G.world.colliders);
      // Watch the assigned point, drifting a little so the hold feels alive.
      const sway = Math.sin(G.time * 0.45 + e.id * 1.7) * 1.6;
      faceToward(e, b.lookX + sway, b.lookZ, dt, 2.2);
      e.pitch *= 0.92;
    } else if (b.state === 'investigate') {
      e.vel.x *= 0.8; e.vel.z *= 0.8;
      faceToward(e, b.lastSeenX, b.lastSeenZ, dt, 3.2);
    } else if (b.state === 'plant' || b.state === 'defuse') {
      e.vel.x *= 0.6; e.vel.z *= 0.6;
      // rounds.js starts and validates the channel; the bot just kneels.
      e.crouch = true;
    }
    if (b.state !== 'plant' && b.state !== 'defuse') e.crouch = false;
  }
}

// ---- bot models -----------------------------------------------------------------
const teamMats = {};
function botMaterials(team) {
  if (!teamMats[team]) {
    const main = team === 'jackal' ? PALETTE.jackal : PALETTE.warden;
    const dark = team === 'jackal' ? PALETTE.jackalDark : PALETTE.wardenDark;
    teamMats[team] = {
      torso: new THREE.MeshLambertMaterial({ color: main }),
      dark: new THREE.MeshLambertMaterial({ color: dark }),
      skin: new THREE.MeshLambertMaterial({ color: 0xc9a186 }),
      gun: new THREE.MeshLambertMaterial({ color: 0x24282c }),
      stripe: new THREE.MeshBasicMaterial({ color: main }),
    };
  }
  return teamMats[team];
}

export function buildBotMesh(e) {
  const m = botMaterials(e.team);
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  const legGeo = new THREE.BoxGeometry(0.17, 0.78, 0.2);
  add(legGeo, m.dark, -0.13, 0.39, 0);
  add(legGeo, m.dark, 0.13, 0.39, 0);
  const torso = add(new THREE.BoxGeometry(0.56, 0.62, 0.3), m.torso.clone(), 0, 1.09, 0);
  add(new THREE.BoxGeometry(0.58, 0.2, 0.32), m.dark, 0, 0.86, 0);            // belt/hips
  add(new THREE.BoxGeometry(0.4, 0.1, 0.02), m.stripe, 0, 1.18, -0.16);        // chest marker
  add(new THREE.BoxGeometry(0.24, 0.26, 0.24), m.skin, 0, 1.56, 0);            // head
  add(new THREE.BoxGeometry(0.27, 0.09, 0.27), m.dark, 0, 1.72, 0);            // cap
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0.18, 1.32, 0);
  g.add(gunPivot);
  const gunMesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.78), m.gun);
  gunMesh.position.set(0, 0, -0.3);
  gunMesh.castShadow = true;
  gunPivot.add(gunMesh);
  const armGeo = new THREE.BoxGeometry(0.11, 0.11, 0.42);
  const arm = new THREE.Mesh(armGeo, m.torso);
  arm.position.set(0.18, 1.3, -0.14);
  g.add(arm);
  return { group: g, torso, gunPivot, fall: 0 };
}

export function syncBotViews(G, dt) {
  for (const e of G.entities) {
    if (!e.view) continue;
    const v = e.view;
    v.group.position.set(e.pos.x, e.pos.y, e.pos.z);
    v.group.rotation.y = e.yaw;
    v.gunPivot.rotation.x = e.pitch;
    if (!e.alive) {
      // Fall where they dropped, over half a second.
      v.fall = Math.min(1, v.fall + dt * 2.2);
      v.group.rotation.x = -v.fall * Math.PI / 2;
      v.group.position.y = e.pos.y + v.fall * 0.12;
    } else {
      v.fall = 0;
      v.group.rotation.x = 0;
      v.group.scale.y = e.crouch ? 0.8 : 1;
      // Damage flash on the torso.
      const hot = G.time - e.lastDamageAt < 0.09;
      v.torso.material.emissive.setHex(hot ? 0x7a1408 : 0x000000);
    }
  }
}
