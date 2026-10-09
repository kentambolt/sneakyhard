'use strict';
// Krydstjek af solvableFrom (bruges af "Tjek kurs"): fra tilfældige stillinger midt i et spil skal svaret
// stemme med en uafhængig, naiv søgning efter en vej i mål. Dækker alle felttyper, poster og 1-2 brikker.
const M = require('./mix');
let seed = 99;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

function press(w, h, types, nums, used, pos, d) {
  let done = 0;
  for (const c of used) if (nums[c]) done++;
  const out = pos.slice(), land = pos.map(() => false);
  const prog = (c) => { const x = c % w, y = (c / w) | 0; return [-y, x, y, -x][d]; };
  const order = pos.map((p, k) => k).sort((i, j) => prog(pos[j]) - prog(pos[i]));
  const step = (c) => { const x = c % w + DX[d], y = ((c / w) | 0) + DY[d]; return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x; };
  const free = (c, k) => c >= 0 && !out.some((p, j) => j !== k && p === c) &&
    (types[c] === 2 || types[c] === 3 || (types[c] === 1 && !used.has(c) && !(nums[c] && nums[c] !== done + 1)));
  for (const k of order) {
    let q = step(out[k]);
    if (!free(q, k)) continue;
    while (types[q] === 2) { const nx = step(q); if (!free(nx, k)) break; q = nx; }
    out[k] = q;
    land[k] = types[q] === 1;
    if (land[k] && nums[q]) done++;
  }
  return out.some((p, k) => p !== pos[k]) ? { out, land } : null;
}
// Naiv søgning: kan man fra (used, pos) bruge alle felter? Gratis bevægelser håndteres med et besøgt-sæt pr. tilstand.
function naiveSolvable(w, h, types, nums, used, pos) {
  let total = 0;
  for (const t of types) if (t === 1) total++;
  const seen = new Set();
  let nodes = 0;
  const rec = (u, p) => {
    if (u.size === total) return true;
    const key = [...u].sort((x, y) => x - y).join() + '|' + p.slice().sort((x, y) => x - y).join();
    if (seen.has(key)) return false;
    seen.add(key);
    if (++nodes > 300000) throw new Error('budget');
    for (let d = 0; d < 4; d++) {
      const r = press(w, h, types, nums, u, p, d);
      if (!r) continue;
      const u2 = new Set(u);
      r.out.forEach((c, k) => { if (r.land[k]) u2.add(c); });
      if (rec(u2, r.out)) return true;
    }
    return false;
  };
  try { return rec(used, pos); } catch (e) { return null; }
}

let tested = 0, yes = 0, fails = 0;
for (let t = 0; t < 3000; t++) {
  const W = 3 + (t % 2), N = W * W;
  const kind = t % 4; // 0: almindelig, 1: is+kryds, 2: poster, 3: to brikker blandet
  const types = new Uint8Array(N), nums = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    const r = rand();
    types[i] = r < 0.12 ? 0 : (kind === 1 || kind === 3) && r < 0.26 ? 2 : (kind === 1 || kind === 3) && r < 0.38 ? 3 : 1;
  }
  const normals = [];
  for (let i = 0; i < N; i++) if (types[i] === 1) normals.push(i);
  if (normals.length < 4) continue;
  const pieces = kind === 3 ? 2 : 1;
  const pos = [normals[(rand() * normals.length) | 0]];
  if (pieces === 2) { const b = normals[(rand() * normals.length) | 0]; if (b === pos[0]) continue; pos.push(b); }
  if (kind === 2) {
    const free = normals.filter(c => !pos.includes(c));
    for (let k = 1; k <= 3 && free.length; k++) nums[free.splice((rand() * free.length) | 0, 1)[0]] = k;
  }
  // spil et par tilfældige tryk for at komme midt ind i spillet
  let used = new Set(pos.filter(c => types[c] === 1)), p = pos.slice();
  const steps = (rand() * 5) | 0;
  for (let s = 0; s < steps; s++) {
    const r = press(W, W, types, nums, used, p, (rand() * 4) | 0);
    if (!r) continue;
    r.out.forEach((c, k) => { if (r.land[k]) used.add(c); });
    p = r.out;
  }
  const want = naiveSolvable(W, W, types, nums, used, p);
  if (want === null) continue;
  const g = M.buildBoard(W, W, types, nums);
  const got = M.solvableFrom(g, pieces, [...used], p);
  tested++;
  if (want) yes++;
  if (got !== want) { fails++; if (fails < 6) console.log('MISMATCH', want, got, M.levelToRows(W, W, types, p[0], p[1] ?? -1, nums).join('/'), [...used]); }
}
console.log(`${tested} stillinger testet (${yes} kan løses), ${fails} fejl`);
