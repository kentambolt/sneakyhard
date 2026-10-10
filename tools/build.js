'use strict';
// Selects levels from levels_NxN.json and inserts them into dev/index.html (between LEVELS-VEJ-BEGIN/LEVELS-VEJ-END).
// Usage: node build.js
const fs = require('fs');
const { data, DEV_PAGE } = require('./paths');
const P = require('./solver');

// [size, number of levels]
const PLAN = [[3, 1], [4, 2], [5, 3], [6, 3], [7, 2], [8, 2]];
const MIN_DISTANCE = 4; // levels must differ by at least this many tiles (after mirroring/rotation)

function transformIndex(W, t, i) {
  const x = i % W, y = (i / W) | 0, m = W - 1;
  const [sx, sy] = [[x, y], [m - x, y], [x, m - y], [m - x, m - y], [y, x], [m - y, x], [y, m - x], [m - y, m - x]][t];
  return sy * W + sx;
}
function distance(W, a, b) {
  let best = Infinity;
  for (let t = 0; t < 8; t++) {
    let d = 0;
    for (let i = 0; i < W * W; i++) if (a.mask[i] !== b.mask[transformIndex(W, t, i)]) d++;
    if (a.startCell !== transformIndex(W, t, b.startCell)) d += 2;
    best = Math.min(best, d);
  }
  return best;
}

const out = [];
for (const [W, count] of PLAN) {
  const file = data(`levels_${W}x${W}.json`);
  if (!fs.existsSync(file)) { console.warn(`missing ${file}`); continue; }
  const cands = JSON.parse(fs.readFileSync(file, 'utf8')).sort((a, b) => b.score - a.score);
  // 3x3 is always trivial for a sensible player - pick the one with the most naive traps instead (warm-up)
  if (W <= 3) {
    const rawBits = (c) => { const lv = P.parseLevel(c.rows), g = P.buildGraph(W, W, lv.mask); return P.analyzeRaw(g, g.id[lv.startCell]).bits; };
    for (const c of cands) c.rawBits = rawBits(c);
    cands.sort((a, b) => b.rawBits - a.rawBits);
  }
  const chosen = [];
  for (const c of cands) {
    const lv = P.parseLevel(c.rows);
    if (chosen.every(o => distance(W, lv, o.lv) >= MIN_DISTANCE)) chosen.push({ c, lv });
    if (chosen.length >= count) break;
  }
  chosen.reverse(); // easiest first within the same size
  chosen.forEach(({ c, lv }, k) => {
    const g = P.buildGraph(W, W, lv.mask);
    const s = g.id[lv.startCell];
    const a = P.analyze(g, s, { budget: 2e7 });
    const raw = P.analyzeRaw(g, s, { budget: W >= 8 ? 1e7 : 2e7 });
    if (a.solutions !== 1) throw new Error('not unique: ' + c.rows.join('/'));
    // The solution is shown in the game, so it must be a valid route through every tile
    const adj = (u, v) => g.nb.subarray(g.nbStart[u], g.nbStart[u + 1]).includes(v);
    if (a.path[0] !== s || new Set(a.path).size !== g.n || !a.path.every((v, i) => i === 0 || adj(a.path[i - 1], v))) {
      throw new Error('invalid solution: ' + c.rows.join('/'));
    }
    const item = {
      id: `${W}-${k + 1}`, w: W, h: W, rows: c.rows,
      sol: a.path.map(v => g.cells[v]),
      n: g.n,
      score: +c.score.toFixed(1),
      oneIn0: Math.round(1 / a.P[0]),
      oneIn4: Math.round(1 / a.P[4]),
      maxTrap: a.maxTrap,
      warnsdorff: a.pWarns === 0 ? 0 : Math.round(1 / a.pWarns),
      rawOneIn: raw ? Math.round(1 / raw.P) : null,
      paths: raw ? raw.paths : null,
      near1: raw ? raw.near1 : null,
      near2: raw ? raw.near2 : null,
    };
    out.push(item);
    console.log(`${item.id}  score=${item.score}  n=${item.n}  1:${item.oneIn0} (L0)  1:${item.oneIn4} (L4)  trap=${item.maxTrap}  naive 1:${item.rawOneIn}  paths=${item.paths}  missing-1=${item.near1}`);
    console.log('      ' + c.rows.join('\n      '));
  });
}

const html = fs.readFileSync(DEV_PAGE, 'utf8');
const begin = '// LEVELS-VEJ-BEGIN', end = '// LEVELS-VEJ-END';
const i0 = html.indexOf(begin), i1 = html.indexOf(end);
if (i0 < 0 || i1 < 0) throw new Error('markers not found in dev/index.html');
const body = '\nconst LEVELS_VEJ = [\n' + out.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n];\n';
fs.writeFileSync(DEV_PAGE, html.slice(0, i0 + begin.length) + body + html.slice(i1));
console.log(`\n${out.length} levels written to dev/index.html`);
