'use strict';
// Selects levels from ice_NxN.json and inserts them into dev/index.html (between LEVELS-IS-BEGIN/LEVELS-IS-END).
// Usage: node build-ice.js
const fs = require('fs');
const { data, DEV_PAGE } = require('./paths');
const I = require('./ice');

// [size, number of levels]
const PLAN = [[3, 1], [4, 2], [5, 3], [6, 2]];
const MIN_DISTANCE = 4;
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

function transformIndex(W, t, i) {
  const x = i % W, y = (i / W) | 0, m = W - 1;
  const [sx, sy] = [[x, y], [m - x, y], [x, m - y], [m - x, m - y], [y, x], [m - y, x], [y, m - x], [m - y, m - x]][t];
  return sy * W + sx;
}
function distance(W, p, q) {
  let best = Infinity;
  for (let t = 0; t < 8; t++) {
    let d = 0;
    // normal tiles count fully; differences between hole/ice/crossing count half (often pure decoration)
    for (let i = 0; i < W * W; i++) {
      const pt = p.types[i], qt = q.types[transformIndex(W, t, i)];
      if ((pt === 1) !== (qt === 1)) d++;
      else if (pt !== qt) d += 0.5;
    }
    if (p.start !== transformIndex(W, t, q.start)) d += 2;
    best = Math.min(best, d);
  }
  return best;
}
// Two levels with nearly the same solution feel like the same level. Compare the solutions (as directions)
// under all 8 mirrors/rotations of the directions; too similar = edit distance below 35 %.
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function similarSolution(a, b) {
  const maps = [];
  for (const flip of [false, true]) for (let r = 0; r < 4; r++) maps.push((ch) => { let k = 'URDL'.indexOf(ch); if (flip) k = [0, 3, 2, 1][k]; return 'URDL'[(k + r) % 4]; });
  const best = Math.min(...maps.map(m => lev(a, [...b].map(m).join(''))));
  return best < 0.35 * Math.max(a.length, b.length);
}

// Independent replay of the solution: every tile must be used, in the expected order
function replay(w, h, types, start, dirs, order) {
  const used = new Uint8Array(w * h);
  const blocked = (x, y) => x < 0 || y < 0 || x >= w || y >= h || types[y * w + x] === 0 || (types[y * w + x] === 1 && used[y * w + x]);
  used[start] = 1;
  let x = start % w, y = (start / w) | 0;
  const seq = [start];
  for (const ch of dirs) {
    const d = 'URDL'.indexOf(ch);
    let cx = x + DX[d], cy = y + DY[d];
    if (blocked(cx, cy)) return false;
    let landed = true;
    while (types[cy * w + cx] === 2) {
      if (blocked(cx + DX[d], cy + DY[d])) { landed = false; break; }
      cx += DX[d]; cy += DY[d];
    }
    x = cx; y = cy;
    if (landed) { used[y * w + x] = 1; seq.push(y * w + x); }
  }
  for (let i = 0; i < w * h; i++) if (types[i] === 1 && !used[i]) return false;
  return seq.join() === order.join();
}

const out = [];
for (const [W, count] of PLAN) {
  const file = data(`ice_${W}x${W}.json`);
  if (!fs.existsSync(file)) { console.warn(`missing ${file}`); continue; }
  const cands = JSON.parse(fs.readFileSync(file, 'utf8')).sort((x, y) => y.score - x.score || y.iceMoves - x.iceMoves);
  const chosen = [];
  for (const c of cands) {
    const lv = I.parseLevel(c.rows);
    if (chosen.every(o => distance(W, lv, o.lv) >= MIN_DISTANCE && !similarSolution(c.dirs, o.c.dirs))) chosen.push({ c, lv });
    if (chosen.length >= count) break;
  }
  chosen.reverse(); // easiest first within the same size
  chosen.forEach(({ c, lv }, k) => {
    const g = I.buildBoard(W, W, lv.types);
    const an = I.analyze(g, lv.start, { budget: 2e7 });
    const raw = I.analyzeRaw(g, lv.start, { budget: 2e7 });
    if (an.solutions !== 1) throw new Error('not unique: ' + c.rows.join('/'));
    if (!replay(W, W, lv.types, lv.start, an.dirs, an.order)) throw new Error('invalid solution: ' + c.rows.join('/'));
    const item = {
      id: `i${W}-${k + 1}`, w: W, h: W, rows: c.rows, dirs: an.dirs, events: an.order.slice(1).map(t => [t]), n: g.n, ice: g.ice,
      score: +c.score.toFixed(1),
      oneIn0: Math.round(1 / an.P[0]),
      oneIn4: Math.round(1 / an.P[4]),
      maxTrap: an.maxTrap,
      iceMoves: an.iceMoves,
      rawOneIn: raw ? Math.round(1 / raw.P) : null,
      near: raw ? raw.near1 + raw.near2 : null,
    };
    out.push(item);
    console.log(`${item.id}  score=${item.score}  tiles=${item.n} ice=${item.ice}  1:${item.oneIn0} (L0)  1:${item.oneIn4} (L4)  trap=${item.maxTrap}  iceMoves=${item.iceMoves}/${item.dirs.length}  naive 1:${item.rawOneIn}  near=${item.near}`);
    console.log('      ' + c.rows.join('\n      '));
  });
}

const html = fs.readFileSync(DEV_PAGE, 'utf8');
const begin = '// LEVELS-IS-BEGIN', end = '// LEVELS-IS-END';
const i0 = html.indexOf(begin), i1 = html.indexOf(end);
if (i0 < 0 || i1 < 0) throw new Error('markers not found in dev/index.html');
const body = '\nconst LEVELS_IS = [\n' + out.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n];\n';
fs.writeFileSync(DEV_PAGE, html.slice(0, i0 + begin.length) + body + html.slice(i1));
console.log(`\n${out.length} levels written to dev/index.html`);
