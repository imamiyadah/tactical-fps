// hud.js — all DOM output. The simulation never touches the document;
// main.js calls update() once per rendered frame and this module writes
// only what changed, so the HUD costs nothing on frames where nothing
// moved. The crosshair gap is driven by the same liveSpread() number the
// bullets use, so what the player sees is what the gun does.

import { WEAPONS, BUY_MENU, GRENADE_PRICE, ARMOR_PRICE, PLANT_TIME, currentWeapon, aliveCount } from './state.js';
import { SITES } from './map.js';
import { liveSpread } from './weapons.js';

function el(id) { return document.getElementById(id); }
function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud() {
  const hud = {
    root: el('hud'), crosshair: el('crosshair'), hitmarker: el('hitmarker'),
    healthNum: el('health-num'), healthFill: el('health-fill'), armorTag: el('armor-tag'),
    ammoMag: el('ammo-mag'), ammoReserve: el('ammo-reserve'), weaponName: el('weapon-name'),
    money: el('money'), timer: el('timer'), phaseTag: el('phase-tag'),
    scoreJ: el('score-j'), scoreW: el('score-w'), aliveJ: el('alive-j'), aliveW: el('alive-w'),
    feed: el('feed'), banner: el('banner'), bannerTitle: el('banner-title'), bannerSub: el('banner-sub'),
    buy: el('buymenu'), buyRows: el('buy-rows'), buyMoney: el('buy-money'),
    vignette: el('vignette'), scope: el('scope'), dead: el('deadtag'),
    plantbar: el('plantbar'), plantFill: el('plantbar-fill'), plantLabel: el('plantbar-label'),
    hint: el('hint'), bombTag: el('bombtag'),
    map: el('minimap'),
  };
  const mapCtx = hud.map.getContext('2d');
  const cache = { feedN: -1, buySig: '', bannerTitle: '' };
  let mapAt = 0;

  function drawMinimap(G) {
    const g = mapCtx, W = hud.map.width, H = hud.map.height;
    const sx = W / 68, sz = H / 52;
    const px = (x) => (x + 34) * sx, pz = (z) => (z + 26) * sz;
    g.fillStyle = '#20262c'; g.fillRect(0, 0, W, H);
    for (const s of [SITES.A, SITES.B]) {
      g.strokeStyle = s.id === 'A' ? '#ffa63d' : '#3fd2c8';
      g.lineWidth = 1.5;
      g.strokeRect(px(s.minX), pz(s.minZ), (s.maxX - s.minX) * sx, (s.maxZ - s.minZ) * sz);
    }
    g.fillStyle = '#4a545e';
    for (const c of G.world.colliders) {
      if (c.maxY < 1.4) continue;
      g.fillRect(px(c.minX), pz(c.minZ), (c.maxX - c.minX) * sx, (c.maxZ - c.minZ) * sz);
    }
    // The charge: carried by a teammate (steady) or down/planted (blink).
    if (G.bomb.state !== 'carried' || G.player.hasBomb) {
      if (Math.floor(G.time * 2.4) % 2 === 0 || G.bomb.state === 'dropped') {
        g.fillStyle = '#ffd23d';
        const bx = G.bomb.state === 'carried' ? G.player.pos.x : G.bomb.pos.x;
        const bz = G.bomb.state === 'carried' ? G.player.pos.z : G.bomb.pos.z;
        g.fillRect(px(bx) - 2.5, pz(bz) - 2.5, 5, 5);
      }
    }
    for (const e of G.entities) {
      if (!e.alive || e.team !== 'jackal') continue;
      g.fillStyle = e.isPlayer ? '#ffffff' : '#ffa63d';
      g.beginPath(); g.arc(px(e.pos.x), pz(e.pos.z), e.isPlayer ? 3 : 2.2, 0, 7); g.fill();
    }
  }

  function update(G, now) {
    const p = G.player;
    const inGame = G.phase === 'buy' || G.phase === 'live' || G.phase === 'end';
    hud.root.style.display = inGame ? 'block' : 'none';
    if (!inGame || !p) return;

    // Health / armour
    hud.healthNum.textContent = Math.ceil(p.hp);
    hud.healthFill.style.width = `${Math.max(0, p.hp)}%`;
    hud.healthFill.style.background = p.hp > 30 ? 'var(--accent)' : '#e0483e';
    hud.armorTag.style.visibility = p.armor ? 'visible' : 'hidden';

    // Weapon / ammo / money
    const w = currentWeapon(p);
    if (p.slot === 'grenade') {
      hud.weaponName.textContent = 'Frag Charge';
      hud.ammoMag.textContent = p.grenades;
      hud.ammoReserve.textContent = '';
    } else if (w) {
      const def = WEAPONS[w.defId];
      hud.weaponName.textContent = def.name;
      hud.ammoMag.textContent = w.mag;
      hud.ammoReserve.textContent = `/ ${w.reserve}`;
      hud.ammoMag.style.color = w.mag === 0 ? '#e0483e' : '';
    }
    hud.money.textContent = `$${p.money}`;

    // Clock and score
    if (G.phase === 'buy') { hud.phaseTag.textContent = 'BUY'; hud.timer.textContent = fmtTime(G.phaseAt - G.time); }
    else if (G.bomb.state === 'planted') { hud.phaseTag.textContent = 'PLANTED'; hud.timer.textContent = fmtTime(G.bomb.plantedAt + 40 - G.time); }
    else if (G.phase === 'live') { hud.phaseTag.textContent = `ROUND ${G.round}`; hud.timer.textContent = fmtTime(G.roundEndsAt - G.time); }
    else { hud.phaseTag.textContent = ''; hud.timer.textContent = ''; }
    hud.scoreJ.textContent = G.score.jackal;
    hud.scoreW.textContent = G.score.warden;
    hud.aliveJ.textContent = '●'.repeat(aliveCount(G, 'jackal'));
    hud.aliveW.textContent = '●'.repeat(aliveCount(G, 'warden'));
    hud.bombTag.style.visibility = G.bomb.state === 'planted' ? 'visible' : 'hidden';

    // Crosshair follows the true spread; hitmarker flashes on a hit.
    if (p.alive && w && G.phase === 'live') {
      const spread = liveSpread(p, WEAPONS[w.defId]);
      hud.crosshair.style.setProperty('--gap', `${(4 + spread * 300).toFixed(1)}px`);
      hud.crosshair.style.display = 'block';
    } else hud.crosshair.style.display = 'none';
    hud.hitmarker.classList.toggle('on', G.time - (G.hitmarkAt || -9) < 0.13);

    // Hurt vignette and the down state.
    const hurt = Math.max(0, 1 - (G.time - (G.hurtAt || -9)) / 0.45);
    hud.vignette.style.opacity = p.alive ? (hurt * 0.55 + (p.hp <= 30 ? 0.16 + Math.sin(G.time * 5) * 0.05 : 0)).toFixed(2) : 0.35;
    hud.dead.style.display = !p.alive && G.phase === 'live' ? 'block' : 'none';

    // Scope overlay while aiming the marksman rifle.
    const scoped = G.playerAiming && w && w.defId === 'paleeye' && p.alive;
    hud.scope.style.display = scoped ? 'block' : 'none';
    if (scoped) hud.crosshair.style.display = 'none';

    // Plant channel progress + contextual hint.
    if (p.channel && p.channel.kind === 'plant') {
      hud.plantbar.style.display = 'block';
      hud.plantLabel.textContent = 'PLANTING THE CHARGE';
      hud.plantFill.style.width = `${Math.min(100, (1 - (p.channel.until - G.time) / PLANT_TIME) * 100)}%`;
    } else hud.plantbar.style.display = 'none';
    hud.hint.textContent =
      p.hasBomb && G.phase === 'live' && !p.channel ? 'Reach a site and hold E to plant the charge' :
      p.slot === 'grenade' ? 'Click to throw the frag charge' : '';

    // Kill feed: last five events, newest at the bottom.
    if (G.feed.length !== cache.feedN) {
      cache.feedN = G.feed.length;
      hud.feed.innerHTML = G.feed.slice(-5).map((f) => `<div>${f.text}</div>`).join('');
    }

    // Centre banner.
    if (G.banner && G.time < G.banner.until) {
      if (cache.bannerTitle !== G.banner.title + G.banner.sub) {
        cache.bannerTitle = G.banner.title + G.banner.sub;
        hud.bannerTitle.textContent = G.banner.title;
        hud.bannerSub.textContent = G.banner.sub;
      }
      hud.banner.style.display = 'block';
    } else hud.banner.style.display = 'none';

    // Buy menu (buy phase only), rebuilt only when its contents change.
    if (G.phase === 'buy') {
      const sig = `${p.money}|${p.armor}|${p.grenades}|${p.weapons.primary ? p.weapons.primary.defId : ''}`;
      if (sig !== cache.buySig) {
        cache.buySig = sig;
        hud.buyMoney.textContent = `$${p.money}`;
        hud.buyRows.innerHTML = BUY_MENU.map((item, i) => {
          let name, price, owned = false;
          if (item === 'armor') { name = 'Kevlar Vest'; price = ARMOR_PRICE; owned = p.armor; }
          else if (item === 'grenade') { name = `Frag Charge (${p.grenades}/${2})`; price = GRENADE_PRICE; owned = p.grenades >= 2; }
          else { name = WEAPONS[item].name; price = WEAPONS[item].price; owned = p.weapons.primary && p.weapons.primary.defId === item; }
          const afford = p.money >= price;
          const cls = owned ? 'owned' : afford ? '' : 'poor';
          return `<div class="buy-row ${cls}"><kbd>${i + 1}</kbd><span>${name}</span><b>${owned ? 'OWNED' : '$' + price}</b></div>`;
        }).join('');
      }
      hud.buy.style.display = 'block';
    } else hud.buy.style.display = 'none';

    if (G.time - mapAt > 0.12) { mapAt = G.time; drawMinimap(G); }
  }

  return { update };
}
