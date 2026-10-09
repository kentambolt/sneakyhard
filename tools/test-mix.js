'use strict';
// Krydstjek af den generelle motor (mix.js):
//  1) mod solver.js på almindelige baner (1 brik)
//  2) mod twins.js på baner med 2 brikker
//  3) mod ice.js på baner med is (1 brik)
//  4) mod en uafhængig, naiv implementering på baner med kryds, is og 1-2 brikker
// Hver unik løsning afspilles desuden tryk for tryk.
const M = require('./mix');
const P = require('./solver');
const T = require('./twins');
const I = require('./ice');
let seed = 2026;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

// ---- uafhængig naiv implementering ----
function naivePress(w, h, types, used, pos, d, nums) {
  let done = 0;
  if (nums) for (const c of used) if (nums[c]) done++;
  const out = pos.slice(), land = pos.map(() => false);
  const prog = (c) => { const x = c % w, y = (c / w) | 0; return [-y, x, y, -x][d]; };
  const order = pos.map((p, k) => k).sort((i, j) => prog(pos[j]) - prog(pos[i]));
  const free = (c, k) => {
    if (c < 0) return false;
    if (out.some((p, j) => j !== k && p === c)) return false;
    const t = types[c];
    return t === 2 || t === 3 || (t === 1 && !used.has(c) && !(nums && nums[c] && nums[c] !== done + 1));
  };
  const step = (c) => { const x = c % w + DX[d], y = ((c / w) | 0) + DY[d]; return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x; };
  for (const k of order) {
    let q = step(out[k]);
    if (!free(q, k)) continue;
    while (types[q] === 2) { const nx = step(q); if (!free(nx, k)) break; q = nx; }
    out[k] = q;
    land[k] = types[q] === 1;
    if (land[k] && nums && nums[q]) done++;
  }
  return { out, land, moved: out.some((p, k) => p !== pos[k]) };
}
// Optælling op til CAP løsninger; null hvis den naive søgning bliver for stor (tilfældet springes over)
const CAP = 500;
function naiveCount(w, h, types, starts, nums) {
  let total = 0;
  for (const t of types) if (t === 1) total++;
  const used = new Set(starts.filter(s => types[s] === 1));
  let count = 0, nodes = 0;
  const norm = (p) => p.slice().sort((x, y) => x - y);
  const rec = (pos) => {
    if (count >= CAP) return;
    if (++nodes > 200000) throw new Error('budget');
    if (used.size === total) { count++; return; }
    const seen = new Set([norm(pos).join()]), q = [pos], evs = new Map();
    while (q.length) {
      const cur = q.shift();
      for (let d = 0; d < 4; d++) {
        const r = naivePress(w, h, types, used, cur, d, nums);
        if (!r.moved) continue;
        const np = norm(r.out);
        if (r.land.some(Boolean)) {
          const newly = r.out.filter((c, k) => r.land[k]).sort((x, y) => x - y);
          evs.set(newly.join() + '|' + np.join(), { newly, np });
        } else if (!seen.has(np.join())) { seen.add(np.join()); q.push(np); }
      }
    }
    for (const { newly, np } of evs.values()) {
      for (const c of newly) used.add(c);
      rec(np);
      for (const c of newly) used.delete(c);
    }
  };
  try { rec(starts.slice()); } catch (e) { return null; }
  return Math.min(count, CAP);
}
function naiveReplay(w, h, types, starts, dirs, nums) {
  let total = 0;
  for (const t of types) if (t === 1) total++;
  const used = new Set(starts.filter(s => types[s] === 1));
  let pos = starts.slice();
  for (const ch of dirs) {
    const r = naivePress(w, h, types, used, pos, 'URDL'.indexOf(ch), nums);
    if (!r.moved) return false;
    r.out.forEach((c, k) => { if (r.land[k]) used.add(c); });
    pos = r.out;
  }
  return used.size === total;
}

const fails = [];
let n1 = 0, n2 = 0, n3 = 0, n4 = 0, n5 = 0, uniq = 0;
function check(label, want, w, h, types, pieces, a, b, nums) {
  if (want === null || want < 0) return false;
  const g = M.buildBoard(w, h, types, nums);
  const c = M.countSolutions(g, pieces, a, b, CAP, 1e7).count;
  if (c !== want) { fails.push(`${label}: forventet ${want}, fik ${c} ${M.levelToRows(w, h, types, a, b).join('/')}`); return true; }
  if (want >= CAP) return true;
  const an = M.analyze(g, pieces, a, b);
  if (an.solutions >= 0 && an.solutions !== want) fails.push(`${label}: analyse fandt ${an.solutions}, forventet ${want}`);
  if (want === 1) {
    uniq++;
    if (!naiveReplay(w, h, types, pieces === 2 ? [a, b] : [a], an.dirs, nums)) fails.push(`${label}: afspilning fejlede ${an.dirs}`);
  }
  return true;
}

for (let t = 0; t < 700; t++) {
  const W = 3 + (t % 2), N = W * W;
  // 1) almindelig bane, 1 brik
  {
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mask[i] = rand() < 0.8 ? 1 : 0;
    const g = P.buildGraph(W, W, mask);
    if (g.n >= 2 && P.isConnected(g)) for (let s = 0; s < g.n; s++) {
      if (check('vej', P.countSolutions(g, s, CAP, 1e7), W, W, mask, 1, g.cells[s], -1)) n1++;
    }
  }
  // 2) to brikker
  {
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mask[i] = rand() < 0.8 ? 1 : 0;
    const g = T.buildBoard(W, W, mask);
    if (g.n >= 3 && T.components(g) <= 2) for (let a = 0; a < g.n; a++) for (let b = a + 1; b < g.n; b++) {
      if (rand() < 0.6) continue;
      if (check('takt', T.countSolutions(g, a, b, CAP, 1e7).count, W, W, mask, 2, g.cells[a], g.cells[b])) n2++;
    }
  }
  // 3) is, 1 brik
  {
    const types = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const r = rand(); types[i] = r < 0.15 ? 0 : r < 0.42 ? 2 : 1; }
    const g = I.buildBoard(W, W, types);
    if (g.n >= 2) for (const s of g.normals) {
      if (check('is', I.countSolutions(g, s, CAP, 1e7).count, W, W, types, 1, s, -1)) n3++;
    }
  }
  // 4) alt blandet: kryds, is, 1-2 brikker, mod naiv implementering
  {
    const types = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const r = rand(); types[i] = r < 0.12 ? 0 : r < 0.27 ? 2 : r < 0.42 ? 3 : 1; }
    const starts = [];
    for (let i = 0; i < N; i++) if (types[i] === 1 || types[i] === 3) starts.push(i);
    if (starts.length >= 3) for (let k = 0; k < 4; k++) {
      const a = starts[(rand() * starts.length) | 0];
      let b = starts[(rand() * starts.length) | 0];
      const pieces = rand() < 0.5 ? 1 : 2;
      if (pieces === 2 && a === b) continue;
      if (pieces === 1) b = -1;
      if (check('blandet', naiveCount(W, W, types, pieces === 2 ? [a, b] : [a]), W, W, types, pieces, a, b)) n4++;
    }
  }
}

// 5) nummererede poster: rene Postløb-baner og blandet med is, kryds og 2 brikker
for (let t = 0; t < 900; t++) {
  const W = 3 + (t % 2), N = W * W;
  const mixed = t % 3 === 0;
  const types = new Uint8Array(N), nums = new Int8Array(N);
  for (let i = 0; i < N; i++) { const r = rand(); types[i] = r < 0.12 ? 0 : mixed && r < 0.24 ? 2 : mixed && r < 0.34 ? 3 : 1; }
  const normals = [];
  for (let i = 0; i < N; i++) if (types[i] === 1) normals.push(i);
  if (normals.length < 4) continue;
  const a = normals[(rand() * normals.length) | 0];
  const pieces = mixed && rand() < 0.5 ? 2 : 1;
  let b = -1;
  if (pieces === 2) { b = normals[(rand() * normals.length) | 0]; if (b === a) continue; }
  const K = 1 + ((rand() * 3) | 0);
  const free = normals.filter(c => c !== a && c !== b);
  for (let k = 1; k <= K && free.length; k++) nums[free.splice((rand() * free.length) | 0, 1)[0]] = k;
  if (check('poster', naiveCount(W, W, types, pieces === 2 ? [a, b] : [a], nums), W, W, types, pieces, a, b, nums)) n5++;
}
for (const f of fails.slice(0, 8)) console.log(f);
console.log(`vej ${n1}, takt ${n2}, is ${n3}, blandet ${n4}, poster ${n5} tilfælde; ${uniq} unikke løsninger afspillet; ${fails.length} fejl`);
