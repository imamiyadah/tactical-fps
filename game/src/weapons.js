// weapons.js — gunplay shared by the player and every bot, so a bot's rifle
// obeys exactly the rules the player's does: magazine, reload, range
// falloff, headshot multiplier, armour, and a spread model that punishes
// movement and sustained fire and rewards stopping and crouching.
//
// Hits are resolved the step they are fired (hitscan): the ray is tested
// against the map boxes and against two boxes per enemy — a body box and a
// smaller head box above it — and the nearest strike wins.

import * as THREE from 'three';
import { WEAPONS, GRENADE_DAMAGE, GRENADE_RADIUS, currentWeapon } from './state.js';
import { rayHitWorld, rayHitBox, segmentBlocked } from './physics.js';

export function eyeHeight(e) { return e.crouch ? 1.16 : 1.6; }
export function chestHeight(e) { return e.crouch ? 0.92 : 1.24; }

const hitTmp = { t: 0 };
const muzzleTmp = { x: 0, y: 0, z: 0 };

// Live spread (radians) for an entity right now: base accuracy of the
// weapon, plus a movement term scaled by ground speed, plus bloom from
// sustained fire. Crouching multiplies the total down; being airborne is
// the worst case. This is the number the crosshair gap shows.
export function liveSpread(e, def) {
  const sp = Math.sqrt(e.vel.x * e.vel.x + e.vel.z * e.vel.z);
  const move = Math.min(1, sp / def.moveSpeed);
  let s = def.spreadBase + def.spreadMove * move + e.bloom;
  if (e.crouch) s *= 0.6;
  if (!e.grounded) s *= 2.2;
  return s;
}

export function applyDamage(G, target, amount, attacker, headshot) {
  if (!target.alive) return;
  if (target.armor && !headshot) amount *= 0.45;
  target.hp -= amount;
  target.lastDamageFrom = attacker ? attacker.id : 0;
  target.lastDamageAt = G.time;
  if (attacker && attacker.isPlayer) {
    G.hitmarkAt = G.time;
    G.audio.hit();
  }
  if (target.isPlayer) {
    G.hurtAt = G.time;
    G.audio.hurt();
  }
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths++;
    target.channel = null;
    if (attacker && attacker !== target) {
      attacker.kills++;
      attacker.money = Math.min(10000, attacker.money + 300);
      if (attacker.isPlayer) G.audio.kill();
    }
    G.feed.push({
      text: `${attacker ? attacker.name : 'World'} ▸ ${target.name}${headshot ? ' (headshot)' : ''}`,
      at: G.time,
    });
    if (G.hooks && G.hooks.onKill) G.hooks.onKill(G, target, attacker, headshot);
  }
}

export function createCombat(scene, world, audio) {
  const colliders = world.colliders;

  // --- pooled effects -------------------------------------------------------
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tracers = [];
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    m.visible = false;
    scene.add(m);
    tracers.push({ mesh: m, until: 0 });
  }
  let tracerIdx = 0;

  const flashTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,240,200,1)');
    grad.addColorStop(0.4, 'rgba(255,180,80,0.75)');
    grad.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const flashes = [];
  for (let i = 0; i < 12; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    s.visible = false;
    scene.add(s);
    flashes.push({ sprite: s, until: 0 });
  }
  let flashIdx = 0;
  const boomLight = new THREE.PointLight(0xffa050, 0, 18, 1.6);
  scene.add(boomLight);

  const PMAX = 360;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PMAX * 3);
  const pCol = new Float32Array(PMAX * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 0.085, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  points.frustumCulled = false;
  scene.add(points);
  const parts = [];
  for (let i = 0; i < PMAX; i++) { parts.push({ life: 0, vx: 0, vy: 0, vz: 0 }); pPos[i * 3 + 1] = -50; }
  let partIdx = 0;

  function burst(x, y, z, r, gcol, b, count, speed, up) {
    for (let n = 0; n < count; n++) {
      const p = parts[partIdx];
      const i3 = partIdx * 3;
      pPos[i3] = x; pPos[i3 + 1] = y; pPos[i3 + 2] = z;
      pCol[i3] = r; pCol[i3 + 1] = gcol; pCol[i3 + 2] = b;
      const a = Math.random() * Math.PI * 2, e2 = Math.random() - 0.3;
      p.vx = Math.cos(a) * speed * Math.random();
      p.vz = Math.sin(a) * speed * Math.random();
      p.vy = e2 * speed + up;
      p.life = 0.28 + Math.random() * 0.3;
      partIdx = (partIdx + 1) % PMAX;
    }
  }

  function tracer(x0, y0, z0, x1, y1, z1, now) {
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % tracers.length;
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.5) return;
    t.mesh.position.set(x0 + dx / 2, y0 + dy / 2, z0 + dz / 2);
    t.mesh.scale.set(1, 1, len);
    t.mesh.lookAt(x1, y1, z1);
    t.mesh.material.opacity = 0.85;
    t.mesh.visible = true;
    t.until = now + 0.05;
  }

  function flash(x, y, z, scale, now, dur = 0.045) {
    const f = flashes[flashIdx];
    flashIdx = (flashIdx + 1) % flashes.length;
    f.sprite.position.set(x, y, z);
    f.sprite.scale.set(scale, scale, 1);
    f.sprite.material.opacity = 0.95;
    f.sprite.visible = true;
    f.until = now + dur;
  }

  // --- firing ---------------------------------------------------------------
  function fire(G, e, ox, oy, oz, dx, dy, dz) {
    const w = currentWeapon(e);
    if (!w || e.reloading || !e.alive) return false;
    const def = WEAPONS[w.defId];
    if (G.time < w.nextShotAt) return false;
    if (w.mag <= 0) {
      w.nextShotAt = G.time + 0.32;
      if (e.isPlayer) audio.dryFire();
      startReload(G, e);
      return false;
    }
    w.mag--;
    w.nextShotAt = G.time + 60 / def.rpm;
    e.bloom = Math.min(0.09, e.bloom + def.recoil * 1.9);
    e.recoilPitch += def.recoil;

    // Perturb the direction inside the live spread cone.
    const s = liveSpread(e, def);
    const rx = (Math.random() + Math.random() - 1) * s;
    const ry = (Math.random() + Math.random() - 1) * s;
    // perpendicular basis for the cone
    let px = -dz, pz = dx;
    const plen = Math.sqrt(px * px + pz * pz) || 1;
    px /= plen; pz /= plen;
    let fx = dx + px * rx, fz = dz + pz * rx, fy = dy + ry;
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
    fx /= fl; fy /= fl; fz /= fl;

    // Nearest world strike.
    let bestT = def.range;
    let hitWorld = false;
    if (rayHitWorld(ox, oy, oz, fx, fy, fz, colliders, def.range, hitTmp)) {
      bestT = hitTmp.t; hitWorld = true;
    }
    // Nearest enemy strike: head box wins ties by being tested at its own t.
    let victim = null, victimHead = false;
    for (const o of G.entities) {
      if (o === e || !o.alive || o.team === e.team) continue;
      const feetY = o.pos.y;
      const topY = feetY + (o.crouch ? 1.3 : o.standHeight);
      const bodyT = rayHitBox(ox, oy, oz, fx, fy, fz,
        o.pos.x, (feetY + topY - 0.26) / 2 + 0.0, o.pos.z, 0.34, (topY - 0.26 - feetY) / 2, 0.34, bestT);
      const headT = rayHitBox(ox, oy, oz, fx, fy, fz,
        o.pos.x, topY - 0.13, o.pos.z, 0.15, 0.14, 0.15, bestT);
      let t = -1, head = false;
      if (headT > 0 && (bodyT < 0 || headT <= bodyT)) { t = headT; head = true; }
      else if (bodyT > 0) { t = bodyT; }
      if (t > 0 && t < bestT) { bestT = t; victim = o; victimHead = head; hitWorld = false; }
    }

    const hx = ox + fx * bestT, hy = oy + fy * bestT, hz = oz + fz * bestT;
    // Muzzle point: a little ahead of the eye so tracers start at the gun.
    muzzleTmp.x = ox + fx * 0.55; muzzleTmp.y = oy - 0.14 + fy * 0.3; muzzleTmp.z = oz + fz * 0.55;
    tracer(muzzleTmp.x, muzzleTmp.y, muzzleTmp.z, hx, hy, hz, G.time);
    flash(muzzleTmp.x, muzzleTmp.y, muzzleTmp.z, def.id === 'paleeye' ? 1.1 : 0.7, G.time);

    if (victim) {
      const fall = Math.max(0.25, 1 - Math.max(0, bestT - 18) / 130);
      applyDamage(G, victim, def.damage * fall * (victimHead ? def.headMult : 1), e, victimHead);
      // No blood burst on the player: the hit point sits centimetres from
      // the camera and the points would fill the screen; the hurt vignette
      // and hitmarker carry that feedback instead.
      if (!victim.isPlayer) burst(hx, hy, hz, 0.85, 0.25, 0.2, 5, 1.6, 0.6);
    } else if (hitWorld) {
      burst(hx, hy, hz, 1.0, 0.85, 0.55, 4, 1.3, 0.8);
    }

    // Gunfire is loud: bots inside the radius hear it and react.
    G.noises.push({ x: e.pos.x, z: e.pos.z, radius: 42, at: G.time });
    if (G.noises.length > 24) G.noises.shift();

    const dp = G.player ? Math.hypot(G.player.pos.x - e.pos.x, G.player.pos.z - e.pos.z) : 0;
    audio.shot(def.id, e.isPlayer ? 1 : Math.max(0.06, 1 / (1 + dp * 0.055)));
    return true;
  }

  function startReload(G, e) {
    const w = currentWeapon(e);
    if (!w || e.reloading) return;
    const def = WEAPONS[w.defId];
    if (w.reserve <= 0 || w.mag >= def.mag) return;
    e.reloading = true;
    w.reloadingUntil = G.time + def.reload;
    if (e.isPlayer) audio.reload();
  }

  function finishReloads(G) {
    for (const e of G.entities) {
      if (!e.reloading) continue;
      const w = currentWeapon(e);
      if (!w) { e.reloading = false; continue; }
      if (G.time >= w.reloadingUntil) {
        const def = WEAPONS[w.defId];
        const need = def.mag - w.mag;
        const take = Math.min(need, w.reserve);
        w.mag += take; w.reserve -= take;
        e.reloading = false;
      }
    }
  }

  function selectSlot(G, e, slot) {
    if (slot === 'grenade') {
      if (e.grenades <= 0) return false;
    } else if (!e.weapons[slot]) return false;
    if (e.slot !== slot) {
      e.slot = slot;
      e.reloading = false;
      const w = currentWeapon(e);
      if (w) w.nextShotAt = Math.max(w.nextShotAt, G.time + 0.22);
    }
    return true;
  }

  // --- grenades ---------------------------------------------------------------
  const grenadeGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const grenadeMat = new THREE.MeshLambertMaterial({ color: 0x44503c });
  const grenadePool = [];
  for (let i = 0; i < 10; i++) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.visible = false;
    scene.add(mesh);
    grenadePool.push({ active: false, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, fuse: 0, thrower: null, mesh });
  }

  function throwGrenade(G, e, dx, dy, dz) {
    if (e.grenades <= 0 || !e.alive) return false;
    let slot = null;
    for (const g of grenadePool) if (!g.active) { slot = g; break; }
    if (!slot) return false;
    e.grenades--;
    slot.active = true;
    slot.thrower = e;
    slot.fuse = 1.6;
    slot.pos.x = e.pos.x; slot.pos.y = e.pos.y + eyeHeight(e); slot.pos.z = e.pos.z;
    const power = 13;
    slot.vel.x = dx * power; slot.vel.y = dy * power + 3.2; slot.vel.z = dz * power;
    slot.mesh.visible = true;
    if (e.isPlayer) audio.throwWhoosh();
    return true;
  }

  function explode(G, g) {
    g.active = false;
    g.mesh.visible = false;
    const { x, y, z } = g.pos;
    flash(x, y + 0.2, z, 4.2, G.time, 0.14);
    burst(x, y + 0.2, z, 1.0, 0.55, 0.2, 42, 6.5, 2.4);
    boomLight.position.set(x, y + 0.6, z);
    boomLight.intensity = 260;
    const dp = G.player ? Math.hypot(G.player.pos.x - x, G.player.pos.z - z) : 99;
    audio.explosion(dp < 30 ? Math.max(0.15, 1 - dp / 34) : 0);
    if (dp < 7) G.shakeAt = G.time;
    for (const o of G.entities) {
      if (!o.alive) continue;
      const d = Math.hypot(o.pos.x - x, o.pos.z - z);
      if (d > GRENADE_RADIUS) continue;
      const blocked = segmentBlocked(x, y + 0.3, z, o.pos.x, o.pos.y + 1, o.pos.z, colliders);
      if (blocked) continue;
      const dmg = GRENADE_DAMAGE * Math.pow(1 - d / GRENADE_RADIUS, 1.15);
      if (dmg > 2) applyDamage(G, o, dmg, g.thrower, false);
    }
    G.noises.push({ x, z, radius: 46, at: G.time });
  }

  function stepGrenades(G, dt) {
    for (const g of grenadePool) {
      if (!g.active) continue;
      g.fuse -= dt;
      if (g.fuse <= 0) { explode(G, g); continue; }
      g.vel.y -= 20 * dt;
      const steps = 3, sdt = dt / steps;
      for (let s = 0; s < steps; s++) {
        const ox = g.pos.x, oz = g.pos.z;
        g.pos.x += g.vel.x * sdt;
        g.pos.z += g.vel.z * sdt;
        g.pos.y += g.vel.y * sdt;
        // Bounce off box sides by undoing the penetrating axis.
        for (const c of colliders) {
          if (g.pos.x > c.minX - 0.11 && g.pos.x < c.maxX + 0.11 &&
              g.pos.z > c.minZ - 0.11 && g.pos.z < c.maxZ + 0.11 &&
              g.pos.y > c.minY && g.pos.y < c.maxY + 0.11) {
            if (Math.abs(g.pos.x - ox) > Math.abs(g.pos.z - oz)) { g.pos.x = ox; g.vel.x *= -0.42; }
            else { g.pos.z = oz; g.vel.z *= -0.42; }
          }
        }
        if (g.pos.y < 0.11) {
          g.pos.y = 0.11;
          g.vel.y = Math.abs(g.vel.y) > 1.4 ? -g.vel.y * 0.38 : 0;
          g.vel.x *= 0.72; g.vel.z *= 0.72;
        }
      }
      g.mesh.position.set(g.pos.x, g.pos.y, g.pos.z);
    }
  }

  // Per-frame effect upkeep (render side; lifetimes only).
  function updateFx(now, dt) {
    for (const t of tracers) {
      if (!t.mesh.visible) continue;
      if (now > t.until) { t.mesh.visible = false; continue; }
      t.mesh.material.opacity = Math.max(0, (t.until - now) / 0.05) * 0.85;
    }
    for (const f of flashes) {
      if (!f.sprite.visible) continue;
      if (now > f.until) { f.sprite.visible = false; continue; }
      f.sprite.material.opacity = 0.95;
    }
    boomLight.intensity = Math.max(0, boomLight.intensity - dt * 1500);
    for (let i = 0; i < PMAX; i++) {
      const p = parts[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      const i3 = i * 3;
      if (p.life <= 0) { pPos[i3 + 1] = -50; continue; }
      p.vy -= 5.5 * dt;
      pPos[i3] += p.vx * dt; pPos[i3 + 1] += p.vy * dt; pPos[i3 + 2] += p.vz * dt;
      if (pPos[i3 + 1] < 0.02) pPos[i3 + 1] = 0.02;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  // Per-step upkeep: reloads completing, bloom/recoil recovery.
  function step(G, dt) {
    finishReloads(G);
    for (const e of G.entities) {
      if (e.bloom > 0) e.bloom = Math.max(0, e.bloom - dt * 0.075);
      if (e.recoilPitch > 0) e.recoilPitch = Math.max(0, e.recoilPitch - dt * 0.14);
    }
    stepGrenades(G, dt);
  }

  return { fire, startReload, selectSlot, throwGrenade, step, updateFx, burst, flash };
}

// ---- first-person viewmodel -------------------------------------------------
// A low-poly gun built from boxes, one group per weapon, bobbing with
// movement and kicking with recoil. Lives in weapons.js because it is the
// visual half of the same firing model.
export function buildViewmodel(camera) {
  const group = new THREE.Group();
  group.position.set(0.27, -0.235, -0.45);
  camera.add(group);

  const dark = new THREE.MeshLambertMaterial({ color: 0x3b4148 });
  const mid = new THREE.MeshLambertMaterial({ color: 0x5d656f });
  const accent = new THREE.MeshLambertMaterial({ color: 0xd9822b });
  const wood = new THREE.MeshLambertMaterial({ color: 0x6e5136 });

  function gun(parts) {
    const g = new THREE.Group();
    for (const [x, y, z, w, h, d, m] of parts) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      g.add(mesh);
    }
    g.visible = false;
    group.add(g);
    return g;
  }

  const models = {
    p9: gun([
      [0, 0, -0.1, 0.05, 0.06, 0.24, dark], [0, 0.045, -0.1, 0.042, 0.03, 0.22, mid],
      [0, -0.07, -0.02, 0.045, 0.1, 0.07, mid], [0, -0.03, -0.16, 0.04, 0.05, 0.05, dark],
      [0, 0.075, -0.2, 0.012, 0.03, 0.012, accent],
    ]),
    raptor: gun([
      [0, 0, -0.16, 0.06, 0.09, 0.44, dark], [0, -0.09, -0.1, 0.05, 0.13, 0.06, mid],
      [0, -0.02, 0.14, 0.05, 0.12, 0.16, mid], [0, 0.07, -0.3, 0.014, 0.035, 0.014, accent],
      [0, 0.01, -0.42, 0.03, 0.03, 0.1, dark],
    ]),
    longbow: gun([
      [0, 0, -0.22, 0.055, 0.08, 0.6, wood], [0, -0.08, -0.08, 0.045, 0.12, 0.055, dark],
      [0, -0.01, 0.2, 0.05, 0.1, 0.2, wood], [0, 0.065, -0.34, 0.016, 0.04, 0.016, accent],
      [0, 0.02, -0.56, 0.028, 0.028, 0.14, dark], [0, 0.08, -0.05, 0.03, 0.035, 0.12, dark],
    ]),
    paleeye: gun([
      [0, 0, -0.3, 0.05, 0.07, 0.78, dark], [0, -0.07, -0.05, 0.045, 0.11, 0.06, mid],
      [0, -0.01, 0.26, 0.05, 0.09, 0.22, wood], [0, 0.02, -0.72, 0.024, 0.024, 0.2, dark],
      [0, 0.075, -0.18, 0.045, 0.05, 0.2, dark], [0, 0.075, -0.18, 0.052, 0.02, 0.05, accent],
    ]),
    grenade: gun([[0, -0.02, -0.12, 0.09, 0.11, 0.09, new THREE.MeshLambertMaterial({ color: 0x44503c })]]),
  };
  const flashQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffc37a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
  );
  flashQuad.position.set(0, 0.02, -0.85);
  group.add(flashQuad);

  let kick = 0, flashAt = -9, bobT = 0;
  return {
    group,
    onShot(now) { kick = Math.min(0.09, kick + 0.045); flashAt = now; },
    update(now, dt, e, aiming) {
      for (const k of Object.keys(models)) models[k].visible = false;
      if (!e || !e.alive) return;
      const key = e.slot === 'grenade' ? 'grenade' : (e.weapons[e.slot] ? e.weapons[e.slot].defId : 'p9');
      if (models[key]) models[key].visible = true;
      const speed = Math.hypot(e.vel.x, e.vel.z);
      bobT += dt * (2 + speed * 1.6);
      kick = Math.max(0, kick - dt * 0.5);
      const ads = aiming && key !== 'grenade';
      const tx = ads ? 0 : 0.27, ty = ads ? -0.148 : -0.235, tz = ads ? -0.35 : -0.45;
      group.position.x += (tx - group.position.x) * Math.min(1, dt * 11);
      group.position.y += (ty + Math.sin(bobT * 2) * 0.006 * Math.min(1, speed) - group.position.y) * Math.min(1, dt * 11);
      group.position.z += (tz + kick - group.position.z) * Math.min(1, dt * 14);
      group.rotation.x = kick * 1.4;
      flashQuad.material.opacity = now - flashAt < 0.04 ? 0.9 : 0;
      flashQuad.visible = flashQuad.material.opacity > 0;
      if (key === 'paleeye' && aiming) models.paleeye.visible = false; // scoped: eye to the glass
    },
  };
}
