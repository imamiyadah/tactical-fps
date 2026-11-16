// main.js — boots Emberline and runs the loop. The simulation advances in
// fixed 1/60 steps (state.js SIM_DT) drained from an accumulator, so
// gameplay is identical at any display rate; rendering then draws the
// latest state: camera, bot models, the charge, effects and the HUD.
//
// Module map: state (the one game object) · map (world data + scene) ·
// physics (collision/rays) · weapons (gunplay + effects) · bots (AI) ·
// player (human control) · rounds (phases + economy) · hud (DOM) ·
// input · audio.

import * as THREE from 'three';
import { createGame, SIM_DT, currentWeapon, WEAPONS } from './state.js';
import { buildWorld } from './map.js';
import { createCombat, buildViewmodel, eyeHeight } from './weapons.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { applyLook, stepPlayer, viewDir } from './player.js';
import { stepBots, syncBotViews, buildBotMesh } from './bots.js';
import { setupMatch, stepRounds, resetMatch } from './rounds.js';
import { createHud } from './hud.js';

const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.08, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);

const G = createGame();
G.audio = createAudio();
G.world = buildWorld(scene);
const combat = createCombat(scene, G.world, G.audio);
setupMatch(G, scene, buildBotMesh);
for (const e of G.entities) if (e.view) e.view.group.visible = false;   // hidden behind the menu

const input = createInput(renderer.domElement);
const hud = createHud();
const viewmodel = buildViewmodel(camera);

// The charge: a slab with a status light, carried on a back, dropped on
// the ground, or planted and blinking faster as the timer runs down.
const bombMesh = new THREE.Group();
const bombBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.16, 0.3),
  new THREE.MeshLambertMaterial({ color: 0x33302a }),
);
bombBody.castShadow = true;
bombMesh.add(bombBody);
const bombLightMat = new THREE.MeshBasicMaterial({ color: 0x39d353 });
const bombLight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.1), bombLightMat);
bombLight.position.set(0.1, 0.1, 0);
bombMesh.add(bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

// ---- menu / pause flow -------------------------------------------------------
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayCopy = document.getElementById('overlay-copy');
const playBtn = document.getElementById('play');
let started = false;

function showOverlay(title, copy, button) {
  overlayTitle.innerHTML = title;
  overlayCopy.textContent = copy;
  playBtn.textContent = button;
  overlay.hidden = false;
}
playBtn.addEventListener('click', () => {
  G.audio.unlock();
  overlay.hidden = true;
  if (!started) {
    started = true;
    for (const e of G.entities) if (e.view) e.view.group.visible = true;
    resetMatch(G);
  } else if (G.phase === 'matchend') {
    resetMatch(G);
  }
  input.lock();
});
document.addEventListener('pointerlockchange', () => {
  if (!input.isLocked() && started && (G.phase === 'buy' || G.phase === 'live')) {
    showOverlay('PAUSED', 'The round is frozen while you are out. Jump back in.', 'Resume');
  }
  if (!input.isLocked() && G.phase === 'matchend') {
    showOverlay(
      G.winner === 'jackal' ? 'MATCH WON' : 'MATCH LOST',
      `Final score — Jackals ${G.score.jackal}, Wardens ${G.score.warden}.`,
      'Play again',
    );
  }
});

// ---- the loop ------------------------------------------------------------------
let last = performance.now();
let acc = 0;
let eyeY = 1.6;
let lastFiredAt = -1;

// One fixed simulation step: phases, the player, the bots, then weapon
// upkeep. Kept separate from frame() so tests can advance the simulation
// deterministically without waiting on the display.
function stepSim() {
  G.time += SIM_DT;
  stepRounds(G, SIM_DT, input);
  stepPlayer(G, SIM_DT, input, combat);
  stepBots(G, SIM_DT, combat);
  combat.step(G, SIM_DT);
}

function frame(nowMs) {
  const frameDt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;

  applyLook(G, input);
  G.playerAiming = input.aiming() && input.isLocked() && G.player && G.player.alive && G.phase === 'live';

  acc += frameDt;
  let steps = 0;
  while (acc >= SIM_DT && steps < 5) {
    stepSim();
    acc -= SIM_DT;
    steps++;
  }
  if (steps === 5) acc = 0;

  // Camera.
  const p = G.player;
  if (G.phase === 'menu' || !started) {
    const t = nowMs / 1000;
    camera.position.set(Math.sin(t * 0.07) * 27, 13.5, Math.cos(t * 0.07) * 27);
    camera.lookAt(0, 0, -2);
    camera.fov = 62;
    camera.updateProjectionMatrix();
  } else if (p) {
    const targetEye = p.alive ? eyeHeight(p) : 0.42;
    eyeY += (targetEye - eyeY) * Math.min(1, frameDt * 11);
    camera.position.set(p.pos.x, p.pos.y + eyeY, p.pos.z);
    camera.rotation.y = p.yaw;
    camera.rotation.x = p.pitch + p.recoilPitch;
    let roll = 0;
    if (!p.alive) roll = 0.55;
    if (G.shakeAt && G.time - G.shakeAt < 0.32) {
      const s = (0.32 - (G.time - G.shakeAt)) * 0.14;
      camera.position.y += Math.sin(nowMs * 0.09) * s;
      roll += Math.sin(nowMs * 0.11) * s * 0.7;
    }
    camera.rotation.z = roll;
    // Field of view: aiming narrows it; the marksman rifle scopes hard.
    const w = currentWeapon(p);
    let targetFov = 90;
    if (G.playerAiming && w) targetFov = WEAPONS[w.defId].zoom > 1 ? 29 : 74;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, frameDt * 13);
      camera.updateProjectionMatrix();
    }
  }

  // The charge follows its carrier or rests where it fell / was planted.
  if (started) {
    bombMesh.visible = true;
    if (G.bomb.state === 'carried') {
      const carrier = G.entities.find((e) => e.id === G.bomb.carrier);
      if (carrier) {
        bombMesh.position.set(
          carrier.pos.x + Math.sin(carrier.yaw) * 0.24,
          carrier.pos.y + 1.32,
          carrier.pos.z + Math.cos(carrier.yaw) * 0.24,
        );
        bombMesh.rotation.y = carrier.yaw;
      }
      bombLightMat.color.setHex(0x39d353);
    } else {
      bombMesh.position.set(G.bomb.pos.x, 0.09, G.bomb.pos.z);
      bombMesh.rotation.y = 0.4;
      if (G.bomb.state === 'planted') {
        const left = 40 - (G.time - G.bomb.plantedAt);
        const rate = left > 20 ? 1 : left > 10 ? 2 : 4;
        bombLightMat.color.setHex(Math.floor(G.time * rate) % 2 === 0 ? 0xff3b30 : 0x551512);
      } else bombLightMat.color.setHex(0xffd23d);
    }
  }

  if (G.playerFiredAt !== undefined && G.playerFiredAt !== lastFiredAt) {
    lastFiredAt = G.playerFiredAt;
    viewmodel.onShot(G.time);
  }
  viewmodel.update(G.time, frameDt, G.player, !!G.playerAiming);
  syncBotViews(G, frameDt);
  combat.updateFx(G.time, frameDt);
  hud.update(G, nowMs);

  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// A small handle for local testing and screenshots: the live game object,
// plus step(n) to advance the simulation n fixed steps on demand.
window.EMBERLINE = {
  G, input, viewDir,
  step(n) { for (let i = 0; i < n; i++) stepSim(); },
};
