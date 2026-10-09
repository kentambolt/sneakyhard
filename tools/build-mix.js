'use strict';
// Udvælger baner til Korsvej, Mesterprøven og Postløb og indsætter dem i dev/index.html
// (mellem LEVELS-KRYDS-/LEVELS-MESTER-/LEVELS-POST-markørerne).
// Brug: node build-mix.js            (alle tre)
//       node build-mix.js post       (kun én variant)
const fs = require('fs');
const { data, DEV_PAGE } = require('./paths');
const M = require('./mix');

const PLANS = {
  kryds: { marker: 'KRYDS', prefix: 'k', sizes: [[3, 1], [4, 2], [5, 3], [6, 2]] },
  mester: { marker: 'MESTER', prefix: 'm', sizes: [[4, 3], [5, 4]] }, // mindst mulig plads
  post: { marker: 'POST', prefix: 'p', sizes: [[3, 1], [4, 2], [5, 3], [6, 2]] },
};
const ONLY = process.argv.slice(2);
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
    // almindelige felter tæller fuldt; forskelle mellem hul/is/kryds tæller halvt (ofte ren pynt)
    for (let i = 0; i < W * W; i++) {
      const pt = p.types[i], qt = q.types[transformIndex(W, t, i)];
      if ((pt === 1) !== (qt === 1)) d++;
      else if (pt !== qt) d += 0.5;
      if (p.nums[i] !== q.nums[transformIndex(W, t, i)]) d++; // poster med andet nummer eller sted
    }
    const ps = [p.a, p.b].filter(c => c >= 0).sort().join(), qs = [q.a, q.b].filter(c => c >= 0).map(c => transformIndex(W, t, c)).sort().join();
    if (ps !== qs) d += 2;
    best = Math.min(best, d);
  }
  return best;
}

// To baner med næsten samme løsning føles som den samme bane. Sammenlign løsningerne (som retninger)
// under alle 8 spejlinger/rotationer af retningerne; for ens = redigeringsafstand under 35 %.
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

// Uafhængig afspilning (samme regler skrevet på ny): alle felter skal bruges
function replay(w, h, types, starts, dirs, nums) {
  let total = 0;
  for (const t of types) if (t === 1) total++;
  const used = new Set(starts.filter(s => types[s] === 1));
  let pos = starts.slice();
  const step = (c, d) => { const x = c % w + DX[d], y = ((c / w) | 0) + DY[d]; return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x; };
  for (const ch of dirs) {
    const d = 'URDL'.indexOf(ch);
    const prog = (c) => { const x = c % w, y = (c / w) | 0; return [-y, x, y, -x][d]; };
    const out = pos.slice();
    const order = pos.map((p, k) => k).sort((i, j) => prog(pos[j]) - prog(pos[i]));
    let done = 0;
    for (const c of used) if (nums[c]) done++;
    const free = (c, k) => c >= 0 && !out.some((p, j) => j !== k && p === c) &&
      (types[c] === 2 || types[c] === 3 || (types[c] === 1 && !used.has(c) && !(nums[c] && nums[c] !== done + 1)));
    for (const k of order) {
      let q = step(out[k], d);
      if (!free(q, k)) continue;
      while (types[q] === 2) { const nx = step(q, d); if (!free(nx, k)) break; q = nx; }
      out[k] = q;
      if (types[q] === 1) { used.add(q); if (nums[q]) done++; }
    }
    if (out.every((p, k) => p === pos[k])) return false;
    pos = out;
  }
  return used.size === total;
}

let html = fs.readFileSync(DEV_PAGE, 'utf8');
for (const [variant, plan] of Object.entries(PLANS)) {
  if (ONLY.length && !ONLY.includes(variant)) continue;
  const out = [];
  for (const [W, count] of plan.sizes) {
    const file = data(`${variant}_${W}x${W}.json`);
    if (!fs.existsSync(file)) { console.warn(`mangler ${file}`); continue; }
    const cands = JSON.parse(fs.readFileSync(file, 'utf8')).sort((x, y) => y.score - x.score);
    // Opvarmning (3x3): skal lære mekanikken, så krydset skal faktisk bruges
    if (W <= 3 && variant === 'kryds') cands.sort((x, y) => Math.min(y.permVisits, 2) - Math.min(x.permVisits, 2) || y.score - x.score);
    const chosen = [];
    for (const c of cands) {
      const lv = M.parseLevel(c.rows);
      if (!chosen.every(o => distance(W, lv, o.lv) >= MIN_DISTANCE)) continue;
      if (!c.dirs) c.dirs = M.analyze(M.buildBoard(W, W, lv.types, lv.nums), lv.pieces, lv.a, lv.b, { budget: 2e7 }).dirs;
      if (chosen.every(o => !similarSolution(c.dirs, o.c.dirs))) chosen.push({ c, lv });
      if (chosen.length >= count) break;
    }
    chosen.reverse(); // lettest først inden for samme størrelse
    chosen.forEach(({ c, lv }, k) => {
      const g = M.buildBoard(W, W, lv.types, lv.nums);
      const an = M.analyze(g, lv.pieces, lv.a, lv.b, { budget: 2e7 });
      const raw = M.analyzeRaw(g, lv.pieces, lv.a, lv.b, { budget: 1e7 });
      if (an.solutions !== 1) throw new Error('ikke unik: ' + c.rows.join('/'));
      if (!replay(W, W, lv.types, lv.pieces === 2 ? [lv.a, lv.b] : [lv.a], an.dirs, lv.nums)) throw new Error('ugyldig løsning: ' + c.rows.join('/'));
      const item = {
        id: `${plan.prefix}${W}-${k + 1}`, w: W, h: W, rows: c.rows, dirs: an.dirs, events: an.events,
        n: g.n, ice: g.ice, perm: g.perm, score: +c.score.toFixed(1),
        oneIn0: Math.round(1 / an.P[0]),
        oneIn4: Math.round(1 / an.P[4]),
        maxTrap: an.maxTrap,
        iceMoves: an.iceMoves, permVisits: an.permVisits, solo: an.solo,
        lens: lv.pieces === 2 ? an.lens : undefined,
        near: raw ? raw.near1 + raw.near2 : null,
      };
      // Postløb spilles som en sti: løsningen som felter (start + hvert felt i rækkefølge)
      if (variant === 'post') Object.assign(item, { sol: [lv.a, ...an.events.flat()], K: g.K });
      out.push(item);
      console.log(`${item.id}  score=${item.score}  felter=${item.n} is=${item.ice} kryds=${item.perm}  1:${item.oneIn0} (L0)  1:${item.oneIn4} (L4)  fælde=${item.maxTrap}  istræk=${item.iceMoves} krydsbesøg=${item.permVisits}${item.lens ? ' pr.brik=' + item.lens : ''}  tryk=${item.dirs.length}  næsten=${item.near}`);
      console.log('      ' + c.rows.join('\n      '));
    });
  }
  const begin = `// LEVELS-${plan.marker}-BEGIN`, end = `// LEVELS-${plan.marker}-END`;
  const i0 = html.indexOf(begin), i1 = html.indexOf(end);
  if (i0 < 0 || i1 < 0) throw new Error(`markører for ${variant} ikke fundet i dev/index.html`);
  const body = `\nconst LEVELS_${plan.marker} = [\n` + out.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n];\n';
  html = html.slice(0, i0 + begin.length) + body + html.slice(i1);
  console.log(`${out.length} ${variant}-baner\n`);
}
fs.writeFileSync(DEV_PAGE, html);
console.log('skrevet til dev/index.html');
