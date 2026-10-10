'use strict';
// Selects levels from twins_NxN.json and inserts them into dev/index.html (between LEVELS-TAKT-BEGIN/LEVELS-TAKT-END).
// Usage: node build-twins.js
const fs = require('fs');
const { data, DEV_PAGE } = require('./paths');
const T = require('./twins');

// [size, number of levels]
const PLAN = [[3, 1], [4, 2], [5, 3], [6, 2]];
const MIN_DISTANCE = 4;

function transformIndex(W, t, i) {
  const x = i % W, y = (i / W) | 0, m = W - 1;
  const [sx, sy] = [[x, y], [m - x, y], [x, m - y], [m - x, m - y], [y, x], [m - y, x], [y, m - x], [m - y, m - x]][t];
  return sy * W + sx;
}
function distance(W, p, q) {
  let best = Infinity;
  for (let t = 0; t < 8; t++) {
    let d = 0;
    for (let i = 0; i < W * W; i++) if (p.mask[i] !== q.mask[transformIndex(W, t, i)]) d++;
    const qa = transformIndex(W, t, q.a), qb = transformIndex(W, t, q.b);
    if (!((p.a === qa && p.b === qb) || (p.a === qb && p.b === qa))) d += 2;
    best = Math.min(best, d);
  }
  return best;
}
function replay(g, a, b, moves) {
  const vis = new Uint8Array(g.n);
  vis[a] = vis[b] = 1;
  let rem = g.n - 2;
  for (const ch of moves) {
    const d = T.DIRS.indexOf(ch);
    const ta = g.nb[a * 4 + d], tb = g.nb[b * 4 + d];
    const ma = ta >= 0 && !vis[ta], mb = tb >= 0 && !vis[tb];
    if (!ma && !mb) return false;
    if (ma) { vis[ta] = 1; rem--; a = ta; }
    if (mb) { vis[tb] = 1; rem--; b = tb; }
  }
  return rem === 0;
}

const out = [];
for (const [W, count] of PLAN) {
  const file = data(`twins_${W}x${W}.json`);
  if (!fs.existsSync(file)) { console.warn(`missing ${file}`); continue; }
  const cands = JSON.parse(fs.readFileSync(file, 'utf8')).sort((x, y) => y.score - x.score);
  // 3x3 is always easy for a sensible player - pick a warm-up that teaches the mechanic (most moves with one piece)
  if (W <= 3) {
    for (const c of cands) {
      const lv = T.parseLevel(c.rows), g = T.buildBoard(W, W, lv.mask);
      const raw = T.analyzeRaw(g, g.id[lv.a], g.id[lv.b]);
      c.warm = c.solo * 10 + raw.bits + c.n;
    }
    cands.sort((x, y) => y.warm - x.warm);
  }
  const chosen = [];
  for (const c of cands) {
    const lv = T.parseLevel(c.rows);
    if (chosen.every(o => distance(W, lv, o.lv) >= MIN_DISTANCE)) chosen.push({ c, lv });
    if (chosen.length >= count) break;
  }
  chosen.reverse(); // easiest first within the same size
  chosen.forEach(({ c, lv }, k) => {
    const g = T.buildBoard(W, W, lv.mask);
    const ka = g.id[lv.a], kb = g.id[lv.b];
    const an = T.analyze(g, ka, kb, { budget: 2e7 });
    const raw = T.analyzeRaw(g, ka, kb, { budget: 2e7 });
    if (an.solutions !== 1) throw new Error('not unique: ' + c.rows.join('/'));
    if (!replay(g, ka, kb, an.moves)) throw new Error('invalid solution: ' + c.rows.join('/'));
    const item = {
      id: `t${W}-${k + 1}`, w: W, h: W, rows: c.rows, sol: an.moves, n: g.n,
      score: +c.score.toFixed(1),
      oneIn0: Math.round(1 / an.P[0]),
      oneIn4: Math.round(1 / an.P[4]),
      maxTrap: an.maxTrap,
      solo: an.solo,
      rawOneIn: raw ? Math.round(1 / raw.P) : null,
      near: raw ? raw.near1 + raw.near2 : null,
    };
    out.push(item);
    console.log(`${item.id}  score=${item.score}  n=${item.n}  1:${item.oneIn0} (L0)  1:${item.oneIn4} (L4)  trap=${item.maxTrap}  solo=${item.solo}/${item.sol.length}  naive 1:${item.rawOneIn}  near=${item.near}`);
    console.log('      ' + c.rows.join('\n      '));
  });
}

const html = fs.readFileSync(DEV_PAGE, 'utf8');
const begin = '// LEVELS-TAKT-BEGIN', end = '// LEVELS-TAKT-END';
const i0 = html.indexOf(begin), i1 = html.indexOf(end);
if (i0 < 0 || i1 < 0) throw new Error('markers not found in dev/index.html');
const body = '\nconst LEVELS_TAKT = [\n' + out.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n];\n';
fs.writeFileSync(DEV_PAGE, html.slice(0, i0 + begin.length) + body + html.slice(i1));
console.log(`\n${out.length} levels written to dev/index.html`);
