// player.js — the human Jackal. Mouse look is applied once per rendered
// frame (it is view, not simulation), while movement, firing and reloading
// run inside the fixed simulation step so the physics rate never depends
// on the display.

import { WEAPONS, currentWeapon } from './state.js';
import { moveAndCollide } from './physics.js';
import { eyeHeight } from './weapons.js';

const SENS = 0.0021;

// Apply drained mouse movement to the player's view angles. Recoil pitch
// is added by the camera, not here, so recovering recoil never fights the
// player's own aim.
export function applyLook(G, input) {
  const p = G.player;
  if (!p) return;
  const m = input.takeMouse();
  if (!input.isLocked()) return;
  p.yaw -= m.x * SENS;
  p.pitch -= m.y * SENS;
  const lim = Math.PI / 2 - 0.01;
  if (p.pitch > lim) p.pitch = lim;
  if (p.pitch < -lim) p.pitch = -lim;
}

export function viewDir(e, out) {
  const pitch = e.pitch + e.recoilPitch;
  const cp = Math.cos(pitch);
  out.x = -Math.sin(e.yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(e.yaw) * cp;
  return out;
}

const dirTmp = { x: 0, y: 0, z: 0 };

export function stepPlayer(G, dt, input, combat) {
  const p = G.player;
  if (!p || !p.alive) return;
  const live = G.phase === 'live';

  p.crouch = input.keys.has('ControlLeft') || input.keys.has('ControlRight') || input.keys.has('KeyC');

  // Weapon selection and handling (live phase only; the buy phase freezes
  // the player, and rounds.js owns the number keys there).
  if (live && input.isLocked()) {
    if (input.pressed('Digit1')) combat.selectSlot(G, p, 'primary');
    if (input.pressed('Digit2')) combat.selectSlot(G, p, 'sidearm');
    if (input.pressed('Digit3')) combat.selectSlot(G, p, 'grenade');
    if (input.pressed('KeyR')) combat.startReload(G, p);

    const w = currentWeapon(p);
    const def = w ? WEAPONS[w.defId] : null;
    const edge = input.takeFiringEdge();
    if (p.slot === 'grenade') {
      if (edge) {
        viewDir(p, dirTmp);
        if (combat.throwGrenade(G, p, dirTmp.x, dirTmp.y, dirTmp.z)) combat.selectSlot(G, p, p.weapons.primary ? 'primary' : 'sidearm');
      }
    } else if (def && (def.auto ? input.firing() : edge)) {
      const ox = p.pos.x, oy = p.pos.y + eyeHeight(p), oz = p.pos.z;
      viewDir(p, dirTmp);
      if (combat.fire(G, p, ox, oy, oz, dirTmp.x, dirTmp.y, dirTmp.z)) G.playerFiredAt = G.time;
    }
    if (input.pressed('KeyG') && p.grenades > 0) {
      viewDir(p, dirTmp);
      combat.throwGrenade(G, p, dirTmp.x, dirTmp.y, dirTmp.z);
    }
  } else {
    input.takeFiringEdge();
  }

  // Interact is a held state rounds.js reads (plant / defuse channels).
  G.playerWantsInteract = live && input.keys.has('KeyE');

  if (!live) { p.vel.x = 0; p.vel.z = 0; return; }

  // --- movement: accelerate toward the wish velocity ---------------------
  const f = (input.keys.has('KeyW') ? 1 : 0) - (input.keys.has('KeyS') ? 1 : 0);
  const r = (input.keys.has('KeyD') ? 1 : 0) - (input.keys.has('KeyA') ? 1 : 0);
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  let wx = (-sy) * f + cy * r;
  let wz = (-cy) * f + (-sy) * r;
  const wl = Math.sqrt(wx * wx + wz * wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  const w = currentWeapon(p);
  let maxSpeed = w ? WEAPONS[w.defId].moveSpeed : 5.4;
  if (p.slot === 'grenade') maxSpeed = 5.4;
  if (p.crouch) maxSpeed *= 0.5;
  if (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight')) maxSpeed *= 0.52; // walk: quiet, accurate
  const walking = maxSpeed < 4;

  const rate = p.grounded ? 11 : 1.6;   // snappy on ground, drifty in air
  const blend = Math.min(1, rate * dt);
  p.vel.x += (wx * maxSpeed - p.vel.x) * blend;
  p.vel.z += (wz * maxSpeed - p.vel.z) * blend;

  // Gravity and jumping.
  p.vel.y -= 22 * dt;
  if (input.keys.has('Space') && p.grounded) { p.vel.y = 7.4; p.grounded = false; }

  const colliders = G.world.colliders;
  moveAndCollide(p.pos, p.vel.x * dt, p.vel.z * dt, p.radius, 1.7, colliders);
  p.pos.y += p.vel.y * dt;
  if (p.pos.y <= 0) { p.pos.y = 0; p.vel.y = 0; p.grounded = true; }
  else if (p.vel.y > 0.5) p.grounded = false;

  // Footsteps: sprinting is audible to bots, walking and crouching are not.
  const speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
  if (p.grounded && !walking && speed > 3.4 && G.time >= (p.stepNoiseAt || 0)) {
    p.stepNoiseAt = G.time + 0.34;
    G.noises.push({ x: p.pos.x, z: p.pos.z, radius: 13, at: G.time });
    if (G.noises.length > 24) G.noises.shift();
  }
}
