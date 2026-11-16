// input.js — keyboard and mouse state for the player. Continuous state
// (held keys, mouse buttons) is read every simulation step; one-shot keys
// (reload, buy, interact) are consumed through pressed() so a tap is never
// seen twice and never missed between frames.

export function createInput(lockTarget) {
  const keys = new Set();
  const pressedSet = new Set();
  let mouseDX = 0, mouseDY = 0;
  let locked = false;
  let resync = true;   // the first delta after a lock engages is bogus: drop it
  let firing = false, aiming = false;
  let firingEdge = false;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
    if (!e.repeat) { keys.add(e.code); pressedSet.add(e.code); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); firing = false; aiming = false; });

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === lockTarget;
    mouseDX = 0; mouseDY = 0; resync = true;
    if (!locked) { firing = false; aiming = false; }
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    if (resync) { resync = false; return; }
    mouseDX += e.movementX || 0;
    mouseDY += e.movementY || 0;
  });
  document.addEventListener('mousedown', (e) => {
    if (!locked) return;
    if (e.button === 0) { if (!firing) firingEdge = true; firing = true; }
    if (e.button === 2) aiming = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
    if (e.button === 2) aiming = false;
  });
  document.addEventListener('contextmenu', (e) => { if (locked) e.preventDefault(); });

  return {
    keys,
    isLocked: () => locked,
    lock: () => { lockTarget.requestPointerLock(); },
    unlock: () => { document.exitPointerLock(); },
    // Drain the accumulated mouse movement (called once per frame).
    takeMouse() {
      const m = { x: mouseDX, y: mouseDY };
      mouseDX = 0; mouseDY = 0;
      return m;
    },
    // True once per physical press of a key.
    pressed(code) {
      if (pressedSet.has(code)) { pressedSet.delete(code); return true; }
      return false;
    },
    firing: () => firing,
    takeFiringEdge() { const v = firingEdge; firingEdge = false; return v; },
    aiming: () => aiming,
  };
}
