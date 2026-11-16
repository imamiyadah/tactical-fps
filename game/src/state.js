// state.js — every piece of shared game state lives in the one object built by
// createGame(). No module keeps its own copy of the world: systems read and
// write fields of G, which keeps the simulation deterministic and debuggable.
//
// Emberline is an original round-based tactical FPS: the Jackals attack and
// plant the charge; the Wardens defend the two sites of the Sundown
// Freightyard. First team to 9 round wins takes the match.

// ---- tuning ---------------------------------------------------------------
export const SIM_DT = 1 / 60;          // fixed simulation step (seconds)
export const ROUND_TIME = 100;         // live-round clock
export const BOMB_TIME = 40;           // charge countdown once planted
export const BUY_TIME = 12;            // freeze / buy phase length
export const END_TIME = 5;             // round-end banner before the next buy
export const PLANT_TIME = 3;           // channel to plant
export const DEFUSE_TIME = 5;          // channel to defuse
export const ROUNDS_TO_WIN = 9;
export const TEAM_SIZE = 5;

export const START_MONEY = 800;
export const MAX_MONEY = 10000;
export const KILL_REWARD = 300;
export const PLANT_REWARD = 300;       // paid to the planter
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1400;
export const ARMOR_PRICE = 650;

// ---- weapons --------------------------------------------------------------
// damage is per pellet at point blank; falloff trims it with range.
// spread is in radians at rest; the live spread grows with movement, air
// time and sustained fire, and shrinks when the shooter stops or crouches.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', slot: 'sidearm', price: 0,
    damage: 26, headMult: 2.3, rpm: 380, auto: false,
    mag: 12, reserve: 48, reload: 1.1, moveSpeed: 5.4,
    spreadBase: 0.006, spreadMove: 0.045, recoil: 0.011, pellets: 1,
    range: 55, zoom: 1,
  },
  raptor: {
    id: 'raptor', name: 'Raptor-9 SMG', slot: 'primary', price: 1400,
    damage: 24, headMult: 1.9, rpm: 780, auto: true,
    mag: 32, reserve: 128, reload: 1.9, moveSpeed: 5.2,
    spreadBase: 0.011, spreadMove: 0.06, recoil: 0.009, pellets: 1,
    range: 48, zoom: 1,
  },
  longbow: {
    id: 'longbow', name: 'LB-7 Longbow Rifle', slot: 'primary', price: 2700,
    damage: 33, headMult: 3.0, rpm: 600, auto: true,
    mag: 30, reserve: 120, reload: 2.2, moveSpeed: 4.9,
    spreadBase: 0.004, spreadMove: 0.055, recoil: 0.016, pellets: 1,
    range: 90, zoom: 1,
  },
  paleeye: {
    id: 'paleeye', name: 'Pale Eye Marksman', slot: 'primary', price: 3200,
    damage: 105, headMult: 2.0, rpm: 42, auto: false,
    mag: 5, reserve: 30, reload: 2.8, moveSpeed: 4.5,
    spreadBase: 0.001, spreadMove: 0.09, recoil: 0.09, pellets: 1,
    range: 140, zoom: 3.2,
  },
};

export const GRENADE_PRICE = 300;
export const GRENADE_MAX = 2;
export const GRENADE_DAMAGE = 110;     // at the centre of the blast
export const GRENADE_RADIUS = 6.5;

// Buy-menu order: slot key -> item id.
export const BUY_MENU = ['raptor', 'longbow', 'paleeye', 'armor', 'grenade'];

// ---- entities -------------------------------------------------------------
let nextEntityId = 1;

export function makeWeaponInstance(defId) {
  const def = WEAPONS[defId];
  return { defId, mag: def.mag, reserve: def.reserve, reloadingUntil: 0, nextShotAt: 0 };
}

// One combatant. The player is an entity too (isPlayer), driven by player.js
// instead of bots.js, so damage, movement and economy treat everyone alike.
export function makeEntity(team, isPlayer) {
  return {
    id: nextEntityId++,
    team,                       // 'jackal' (attack) | 'warden' (defend)
    isPlayer,
    alive: true,
    hp: 100,
    armor: false,               // bought vest: body hits lose 55% of damage
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    // kinematics (position is the feet centre; eye height derives from crouch)
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0,
    crouch: false,
    grounded: true,
    radius: 0.38,
    standHeight: 1.78,
    // loadout
    weapons: { primary: null, sidearm: makeWeaponInstance('p9') },
    slot: 'sidearm',            // 'primary' | 'sidearm' | 'grenade'
    grenades: 0,
    // firing state
    bloom: 0,                   // extra spread from sustained fire (radians)
    recoilPitch: 0,             // accumulated kick, recovered over time
    triggerHeld: false,
    triggerPressed: false,
    reloading: false,
    // bot brain (unused for the player)
    bot: null,
    // round bookkeeping
    hasBomb: false,
    channel: null,              // { kind: 'plant'|'defuse', until } while busy
    lastDamageFrom: 0,          // entity id, for the kill feed
    lastDamageAt: -99,
  };
}

export function currentWeapon(e) {
  return e.slot === 'primary' ? e.weapons.primary : e.slot === 'sidearm' ? e.weapons.sidearm : null;
}

// ---- the game object --------------------------------------------------------
export function createGame() {
  nextEntityId = 1;
  return {
    phase: 'menu',              // menu | buy | live | end | matchend
    phaseAt: 0,                 // sim time the phase ends (buy/end phases)
    time: 0,                    // sim clock, seconds since boot
    round: 0,
    roundEndsAt: 0,             // sim time the live clock runs out
    score: { jackal: 0, warden: 0 },
    winner: null,               // match winner team id once decided
    lastRound: null,            // { winner, reason } for the banner
    entities: [],               // player first, then bots
    player: null,
    bomb: { state: 'carried', carrier: 0, pos: { x: 0, y: 0, z: 0 }, plantedAt: 0, site: null, beepAt: 0 },
    grenadeProjectiles: [],     // live thrown grenades (pooled by weapons.js)
    noises: [],                 // recent { x, z, radius, at } hearing events
    feed: [],                   // kill feed entries { text, at }
    banner: null,               // { title, sub, until } centre-screen message
    strategy: 'A',              // jackal plan for the round: 'A' | 'B' | 'split'
    rngState: 123456789,        // deterministic LCG for bot decisions
  };
}

// Small deterministic RNG so bot choices do not depend on Math.random's seed.
export function rand(G) {
  G.rngState = (G.rngState * 1103515245 + 12345) & 0x7fffffff;
  return G.rngState / 0x7fffffff;
}

export function randPick(G, arr) {
  return arr[Math.floor(rand(G) * arr.length) % arr.length];
}

export function aliveCount(G, team) {
  let n = 0;
  for (const e of G.entities) if (e.alive && e.team === team) n++;
  return n;
}

export function teamOf(e) {
  return e.team === 'jackal' ? 'warden' : 'jackal';
}
