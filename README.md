# Emberline — a three.js tactical FPS

An original round-based tactical shooter that runs entirely in the browser.
You lead the **Jackals** (amber) against five **Warden** bots (teal) in the
Sundown Freightyard — a container yard at dusk with a mid lane, a warehouse
route north, a depot lane south, and two bomb sites: **Site A, the Crane
Yard**, and **Site B, the Depot**.

Win a round by eliminating the Wardens or by planting the charge and
letting it blow; lose it by falling, by letting the clock die, or by
watching the Wardens defuse. Round wins pay money; between rounds a buy
phase sells four weapons (P9 sidearm, Raptor-9 SMG, LB-7 Longbow rifle,
Pale Eye marksman rifle), a kevlar vest and frag charges. First team to
9 rounds takes the match.

## Gunplay rules worth knowing

- Hits are ray-tested against a body box and a separate head box; headshots
  multiply damage (up to ×3 on the rifle). Armour cuts body damage by 55%.
- Spread is a live number, shown by the crosshair gap: it grows while you
  move, jump or hold the trigger, and shrinks when you stop, walk or
  crouch. Stopping to aim genuinely pays — for the bots too, who share the
  exact same firing code as the player.
- Bots route through a waypoint graph, hold cover at the sites, react to
  what they see (vision cone + line of sight) and hear (gunfire, sprinting
  footsteps), take a reaction beat before their first shot, fire in
  bursts, and rotate to defuse once the charge is planted.

## Play it

Serve the `game/` folder with any static file server and open it in
desktop Chrome — no build step, no network requests:

```sh
npx serve game          # or: python3 -m http.server -d game 8080
# open http://localhost:8080
```

Click to lock the mouse and play.

| Keys | Action |
| --- | --- |
| W A S D / mouse | Move / look |
| Click / right-click | Fire / aim (marksman rifle scopes in) |
| R | Reload |
| Shift / Ctrl or C | Walk (quiet, accurate) / crouch |
| E (hold) | Plant the charge inside a site |
| 1–5 | Buy during the buy phase; switch weapons in play |
| 3 / G | Frag slot / quick-throw frag charge |
| Space, Esc | Jump, pause |

## Hand it in

`main.ts` (Node 22, standard library only) copies `game/` and
`screenshots/` to the output directory and writes `dossier.json` with the
vendored make.fun library:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Layout

- `game/index.html` — page, HUD and the single import map for three.js.
- `game/src/` — the game, one module per job: `state` (the single game
  object + tuning), `map` (world data and scene), `physics` (collision
  and rays), `weapons` (gunplay, effects, viewmodel), `bots` (perception
  and tactics), `player`, `rounds` (phases and economy), `hud`, `input`,
  `audio` (all sound is synthesized WebAudio), `main` (fixed-step loop).
- `game/vendor/three/` — three.js 0.187.0, vendored byte for byte.
- `vendor/makefun-threejs.ts` — the dossier library, vendored unchanged.
- `screenshots/` — renders of the game running.

The simulation runs at a fixed 60 Hz, decoupled from rendering; all state
lives in one object; tracers, particles and grenades are pooled, so the
hot loops allocate nothing per frame.

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/imamiyadah/tactical-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/imamiyadah/tactical-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
