// Emberline — hand-in program (Node 22, standard library only).
//
// The game itself is the static site in game/: plain ES modules, no build
// step, three.js supplied through an import map. This program packages it
// for the grader: it mirrors game/ and screenshots/ into the output
// directory and writes dossier.json there with the vendored make.fun
// library — the summary of screenshots + source that the judge reads.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts     (defaults to /output)

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });

// Mirror the game tree first, then the screenshots beside it; the dossier
// is built from the copies, so what is judged is exactly what was handed in.
cpSync(join(root, 'game'), join(outDir, 'game'), { recursive: true });

const shotsFrom = join(root, 'screenshots');
const shotsTo = join(outDir, 'screenshots');
mkdirSync(shotsTo, { recursive: true });
if (existsSync(shotsFrom)) cpSync(shotsFrom, shotsTo, { recursive: true });

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
