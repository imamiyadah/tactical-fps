// rounds.js — the match director. It owns the phase machine
// (buy -> live -> end, and match end), the economy, bot loadouts, the
// called strategy each round, and the bomb: carrying, dropping, planting,
// defusing and the win rules around it. Combat itself lives in weapons.js;
// this module only decides what a kill or a timer means.

import {
  BUY_TIME, END_TIME, ROUND_TIME, BOMB_TIME, PLANT_TIME, DEFUSE_TIME,
  ROUNDS_TO_WIN, START_MONEY, WIN_REWARD, LOSS_REWARD, PLANT_REWARD,
  ARMOR_PRICE, GRENADE_PRICE, GRENADE_MAX, BUY_MENU, WEAPONS,
  makeEntity, makeWeaponInstance, rand, randPick, aliveCount,
} from './state.js';
import { SPAWNS, SITES, COVERS, siteAt } from './map.js';
import { makeBotBrain, orderHold, orderToSite } from './bots.js';

const JACKAL_NAMES = ['Vex', 'Ondo', 'Mira', 'Kato'];
const WARDEN_NAMES = ['Hale', 'Ibis', 'Rook', 'Sable', 'Tarn'];

export function setupMatch(G, scene, buildBotMesh) {
  const player = makeEntity('jackal', true);
  player.name = 'YOU';
  G.player = player;
  G.entities.push(player);
  for (let i = 0; i < 4; i++) {
    const b = makeEntity('jackal', false);
    b.name = JACKAL_NAMES[i];
    makeBotBrain(G, b, 0.4 + rand(G) * 0.4);
    G.entities.push(b);
  }
  for (let i = 0; i < 5; i++) {
    const b = makeEntity('warden', false);
    b.name = WARDEN_NAMES[i];
    makeBotBrain(G, b, 0.45 + rand(G) * 0.45);
    G.entities.push(b);
  }
  for (const e of G.entities) {
    if (!e.isPlayer) e.view = buildBotMesh(e), scene.add(e.view.group);
  }
  G.hooks = { onKill };
}

function onKill(G, victim) {
  if (victim.hasBomb) {
    victim.hasBomb = false;
    G.bomb.state = 'dropped';
    G.bomb.carrier = 0;
    G.bomb.pos.x = victim.pos.x; G.bomb.pos.z = victim.pos.z;
    G.feed.push({ text: 'The charge is down', at: G.time });
  }
  if (victim.channel) victim.channel = null;
}

function resetLoadout(e) {
  e.weapons.primary = null;
  e.weapons.sidearm = makeWeaponInstance('p9');
  e.slot = 'sidearm';
  e.armor = false;
  e.grenades = 0;
}

function botBuy(G, e) {
  const r = rand(G);
  if (!e.weapons.primary) {
    if (e.money >= WEAPONS.paleeye.price && r < 0.16) buyWeapon(e, 'paleeye');
    else if (e.money >= WEAPONS.longbow.price && r < 0.78) buyWeapon(e, 'longbow');
    else if (e.money >= WEAPONS.raptor.price && r < 0.62) buyWeapon(e, 'raptor');
  }
  if (!e.armor && e.money >= ARMOR_PRICE + 200) { e.money -= ARMOR_PRICE; e.armor = true; }
  if (e.grenades < 1 && e.money >= GRENADE_PRICE + 250 && rand(G) < 0.4) { e.money -= GRENADE_PRICE; e.grenades++; }
}

function buyWeapon(e, defId) {
  e.money -= WEAPONS[defId].price;
  e.weapons.primary = makeWeaponInstance(defId);
  e.slot = 'primary';
}

// The player's buy menu: returns true when the purchase went through.
export function buyItem(G, e, item) {
  if (item === 'armor') {
    if (e.armor || e.money < ARMOR_PRICE) { G.audio.buyDenied(); return false; }
    e.money -= ARMOR_PRICE; e.armor = true;
  } else if (item === 'grenade') {
    if (e.grenades >= GRENADE_MAX || e.money < GRENADE_PRICE) { G.audio.buyDenied(); return false; }
    e.money -= GRENADE_PRICE; e.grenades++;
  } else {
    const def = WEAPONS[item];
    if (!def || e.money < def.price) { G.audio.buyDenied(); return false; }
    if (e.weapons.primary && e.weapons.primary.defId === item) { G.audio.buyDenied(); return false; }
    buyWeapon(e, item);
  }
  G.audio.buyOk();
  return true;
}

export function startRound(G) {
  G.round++;
  G.strategy = randPick(G, ['A', 'B', 'A', 'B', 'split']);
  G.noises.length = 0;
  G.bomb.state = 'carried';
  G.bomb.site = null;
  G.bombRetasked = false;

  // Everyone back to spawn, healed. Combatants who died last round lost
  // their kit; survivors keep what they carried.
  const byTeam = { jackal: 0, warden: 0 };
  for (const e of G.entities) {
    const spawn = SPAWNS[e.team][byTeam[e.team]++];
    e.pos.x = spawn.x; e.pos.z = spawn.z; e.pos.y = 0;
    e.vel.x = 0; e.vel.y = 0; e.vel.z = 0;
    e.yaw = spawn.yaw; e.pitch = 0;
    e.hp = 100; e.alive = true;
    e.reloading = false; e.channel = null; e.hasBomb = false;
    e.bloom = 0; e.recoilPitch = 0;
    if (e.diedLastRound) { resetLoadout(e); e.diedLastRound = false; }
    if (e.view) { e.view.fall = 0; e.view.group.rotation.x = 0; }
  }

  // The charge goes to a Jackal bot, never forced on the player.
  const jackalBots = G.entities.filter((e) => e.team === 'jackal' && !e.isPlayer);
  const carrier = jackalBots[Math.floor(rand(G) * jackalBots.length)];
  carrier.hasBomb = true;
  G.bomb.carrier = carrier.id;

  // Bot shopping, then orders.
  for (const e of G.entities) if (!e.isPlayer) botBuy(G, e);
  planBots(G, carrier);

  G.phase = 'buy';
  G.phaseAt = G.time + BUY_TIME;
  G.banner = { title: `Round ${G.round}`, sub: `Jackals strike ${G.strategy === 'split' ? 'both sites' : 'Site ' + G.strategy}`, until: G.time + 2.6 };
}

function planBots(G, carrier) {
  const jackals = G.entities.filter((e) => e.team === 'jackal' && !e.isPlayer);
  const wardens = G.entities.filter((e) => e.team === 'warden');
  const main = G.strategy === 'split' ? 'A' : G.strategy;
  const off = main === 'A' ? 'B' : 'A';
  let offCount = 0;
  for (const e of jackals) {
    if (G.strategy === 'split' && e !== carrier && offCount < 2) { orderToSite(G, e, SITES[off], false); offCount++; }
    else orderToSite(G, e, SITES[main], true);
  }
  orderHold(G, wardens[0], COVERS.A[0]);
  orderHold(G, wardens[1], COVERS.A[1]);
  orderHold(G, wardens[2], COVERS.B[0]);
  orderHold(G, wardens[3], COVERS.B[1]);
  orderHold(G, wardens[4], COVERS.mid[0]);
}

function plantBomb(G, planter) {
  const site = siteAt(planter.pos.x, planter.pos.z);
  if (!site) return;
  planter.hasBomb = false;
  planter.channel = null;
  G.bomb.state = 'planted';
  G.bomb.site = site.id;
  G.bomb.pos.x = site.plant.x; G.bomb.pos.z = site.plant.z;
  G.bomb.plantedAt = G.time;
  G.bomb.beepAt = G.time;
  planter.money = Math.min(10000, planter.money + PLANT_REWARD);
  if (planter.bot) {
    // The planter falls back to a post-plant hold, watching for the defuse.
    planter.bot.state = 'hold';
    planter.bot.holdX = planter.pos.x; planter.bot.holdZ = planter.pos.z;
    planter.bot.lookX = 26; planter.bot.lookZ = 0;
    planter.crouch = false;
  }
  G.banner = { title: 'CHARGE PLANTED', sub: `Site ${site.id} — ${site.name}`, until: G.time + 2.4 };
  G.audio.beep(false);
  G.feed.push({ text: `Charge planted at Site ${site.id}`, at: G.time });
}

function endRound(G, winner, reason) {
  G.score[winner]++;
  for (const e of G.entities) {
    e.money = Math.min(10000, e.money + (e.team === winner ? WIN_REWARD : LOSS_REWARD));
    if (!e.alive) e.diedLastRound = true;
    e.channel = null;
  }
  const playerWon = winner === 'jackal';
  G.lastRound = { winner, reason };
  G.banner = {
    title: playerWon ? 'ROUND WON' : 'ROUND LOST',
    sub: reason,
    until: G.time + END_TIME - 0.6,
  };
  if (playerWon) G.audio.roundWin(); else G.audio.roundLose();
  if (G.score[winner] >= ROUNDS_TO_WIN) G.winner = winner;
  G.phase = 'end';
  G.phaseAt = G.time + END_TIME;
}

function retaskWardens(G) {
  // The plant is called: the nearest Warden goes for the defuse, the rest
  // take cover around the site and clear it.
  const site = SITES[G.bomb.site];
  let nearest = null, nd = Infinity;
  for (const e of G.entities) {
    if (e.team !== 'warden' || !e.alive) continue;
    const d = Math.hypot(e.pos.x - G.bomb.pos.x, e.pos.z - G.bomb.pos.z);
    if (d < nd) { nd = d; nearest = e; }
  }
  for (const e of G.entities) {
    if (e.team !== 'warden' || !e.alive || !e.bot) continue;
    if (e === nearest) {
      orderHold(G, e, { x: G.bomb.pos.x, z: G.bomb.pos.z, lookX: site.plant.x + 6, lookZ: site.plant.z });
      e.bot.afterRoute = 'defuse';
    } else {
      const covers = COVERS[site.id];
      orderHold(G, e, covers[e.id % covers.length]);
    }
  }
}

function stepChannels(G) {
  for (const e of G.entities) {
    if (!e.channel || !e.alive) continue;
    const ch = e.channel;
    // Channels break if the situation that allowed them ends.
    if (ch.kind === 'plant') {
      const ok = e.hasBomb && siteAt(e.pos.x, e.pos.z) &&
        (e.isPlayer ? G.playerWantsInteract : e.bot && e.bot.state === 'plant');
      if (!ok) { e.channel = null; continue; }
      if (G.time >= ch.until) plantBomb(G, e);
    } else if (ch.kind === 'defuse') {
      const near = Math.hypot(e.pos.x - G.bomb.pos.x, e.pos.z - G.bomb.pos.z) < 1.9;
      const ok = G.bomb.state === 'planted' && near && e.bot && e.bot.state === 'defuse';
      if (!ok) { e.channel = null; continue; }
      if (G.time >= ch.until) {
        e.channel = null;
        endRound(G, 'warden', 'The charge was defused');
        return;
      }
    }
  }
  // Start channels for bots that have arrived at their errand.
  for (const e of G.entities) {
    if (e.isPlayer || !e.alive || e.channel || !e.bot) continue;
    if (e.bot.state === 'plant' && e.hasBomb && siteAt(e.pos.x, e.pos.z)) {
      e.channel = { kind: 'plant', until: G.time + PLANT_TIME };
    }
    if (e.bot.state === 'defuse' && G.bomb.state === 'planted' &&
        Math.hypot(e.pos.x - G.bomb.pos.x, e.pos.z - G.bomb.pos.z) < 1.9) {
      e.channel = { kind: 'defuse', until: G.time + DEFUSE_TIME };
    }
  }
  // The player plants by holding E inside a site with the charge.
  const p = G.player;
  if (p && p.alive && p.hasBomb && !p.channel && G.playerWantsInteract && siteAt(p.pos.x, p.pos.z)) {
    p.channel = { kind: 'plant', until: G.time + PLANT_TIME };
  }
}

export function stepRounds(G, dt, input) {
  if (G.phase === 'buy') {
    // The player's purchases: number keys map to BUY_MENU entries.
    for (let i = 0; i < BUY_MENU.length; i++) {
      if (input.pressed('Digit' + (i + 1))) buyItem(G, G.player, BUY_MENU[i]);
    }
    if (G.time >= G.phaseAt) {
      G.phase = 'live';
      G.roundEndsAt = G.time + ROUND_TIME;
    }
    return;
  }
  if (G.phase === 'end') {
    if (G.time >= G.phaseAt) {
      if (G.winner) { G.phase = 'matchend'; }
      else startRound(G);
    }
    return;
  }
  if (G.phase !== 'live') return;

  stepChannels(G);
  if (G.phase !== 'live') return;   // a defuse may have ended the round

  // Bomb pickup: any living Jackal walking over a dropped charge takes it.
  if (G.bomb.state === 'dropped') {
    for (const e of G.entities) {
      if (!e.alive || e.team !== 'jackal') continue;
      if (Math.hypot(e.pos.x - G.bomb.pos.x, e.pos.z - G.bomb.pos.z) < 1.15) {
        e.hasBomb = true;
        G.bomb.state = 'carried';
        G.bomb.carrier = e.id;
        if (!e.isPlayer && e.bot) orderToSite(G, e, SITES[G.strategy === 'B' ? 'B' : 'A'], true);
        G.feed.push({ text: `${e.name} recovered the charge`, at: G.time });
        break;
      }
    }
  }

  if (G.bomb.state === 'planted') {
    if (!G.bombRetasked) { G.bombRetasked = true; retaskWardens(G); }
    // Accelerating beeps, then the blast.
    const left = G.bomb.plantedAt + BOMB_TIME - G.time;
    if (G.time >= G.bomb.beepAt) {
      G.audio.beep(left < 5);
      G.bomb.beepAt = G.time + (left > 20 ? 1 : left > 10 ? 0.5 : 0.25);
    }
    if (left <= 0) {
      G.audio.explosion();
      endRound(G, 'jackal', 'The charge detonated');
      return;
    }
  } else if (G.time >= G.roundEndsAt) {
    endRound(G, 'warden', 'The clock ran out');
    return;
  }

  // Elimination rules. With the charge planted the round plays out even
  // if the Jackals all fall — the Wardens can still defuse it.
  const j = aliveCount(G, 'jackal');
  const w = aliveCount(G, 'warden');
  if (w === 0) endRound(G, 'jackal', 'Wardens eliminated');
  else if (j === 0 && G.bomb.state !== 'planted') endRound(G, 'warden', 'Jackals eliminated');
}

export function resetMatch(G) {
  G.score.jackal = 0; G.score.warden = 0;
  G.round = 0; G.winner = null; G.lastRound = null;
  G.feed.length = 0;
  for (const e of G.entities) {
    e.money = START_MONEY;
    e.kills = 0; e.deaths = 0;
    e.diedLastRound = true;
  }
  startRound(G);
}
