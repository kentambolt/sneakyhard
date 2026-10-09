'use strict';
// Banegenerator til "Korsvej" (1 brik, felter + kryds) og "Mesterprøven" (2 brikker, felter + is + kryds).
//   node gen-mix.js kryds 5 300 [tråde]
//   node gen-mix.js mester 5 300 [tråde]
// Resultat flettes ind i kryds_WxH.json / mester_WxH.json.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { data } = require('./paths');
const os = require('os');
const fs = require('fs');
const M = require('./mix');

const TOPK = 300;

const VARIANTS = {
  // Korsvej: almindelige felter, huller og kryds. Løsningen skal bruge krydsene (mindst 2 gange).
  kryds: {
    pieces: 1,
    randType: (r) => (r < 0.12 ? M.HOLE : r < 0.3 ? M.PERM : M.NORMAL),
    types: [M.HOLE, M.NORMAL, M.PERM],
    quality: (an, g) => g.perm >= 1 && (g.n < 8 || an.permVisits >= 2),
  },
  // Mesterprøven: alt på én gang. Begge brikker skal arbejde, og både is og kryds skal bruges.
  mester: {
    pieces: 2,
    randType: (r) => (r < 0.1 ? M.HOLE : r < 0.22 ? M.ICE : r < 0.34 ? M.PERM : M.NORMAL),
    types: [M.HOLE, M.NORMAL, M.ICE, M.PERM],
    quality: (an, g) => g.ice >= 1 && g.perm >= 1 && an.iceMoves >= 1 && an.permVisits >= 1 &&
      Math.min(an.lens[0], an.lens[1]) >= Math.max(2, Math.floor(g.n / 5)),
  },
};

function score(a) {
  let s = 0;
  for (let L = 0; L <= M.LMAX; L++) s += a.bits[L];
  return s;
}
function spansBox(W, H, types) {
  let r0 = 0, r1 = 0, c0 = 0, c1 = 0;
  for (let x = 0; x < W; x++) { r0 |= types[x] ? 1 : 0; r1 |= types[(H - 1) * W + x] ? 1 : 0; }
  for (let y = 0; y < H; y++) { c0 |= types[y * W] ? 1 : 0; c1 |= types[y * W + W - 1] ? 1 : 0; }
  return r0 && r1 && c0 && c1;
}

class TopK {
  constructor(k) { this.k = k; this.items = []; this.keys = new Set(); }
  add(W, H, item) {
    if (this.items.length >= this.k && item.score <= this.items[this.items.length - 1].score) return;
    const lv = M.parseLevel(item.rows);
    const key = M.canonical(W, H, lv.types, lv.a, lv.b);
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.items.push(item);
    this.items.sort((x, y) => y.score - x.score);
    if (this.items.length > this.k) {
      const o = M.parseLevel(this.items.pop().rows);
      this.keys.delete(M.canonical(W, H, o.types, o.a, o.b));
    }
  }
}

function evalState(V, W, H, types, a, b) {
  const okStart = (c) => c >= 0 && (types[c] === M.NORMAL || types[c] === M.PERM);
  if (!okStart(a) || (V.pieces === 2 && (!okStart(b) || a === b)) || !spansBox(W, H, types)) return { fitness: -1000 };
  const g = M.buildBoard(W, H, types);
  if (g.n < 3 || g.n > 40) return { fitness: -1000 };
  const c = M.countSolutions(g, V.pieces, a, b, 64, 1e6);
  if (c.count < 0) return { fitness: -40 };
  if (c.count === 0) return { fitness: -8 - c.minRem };
  if (c.count > 1) return { fitness: -1 - Math.log2(c.count) };
  const an = M.analyze(g, V.pieces, a, b, { budget: 3e6 });
  if (an.solutions !== 1) return { fitness: -40 };
  const sc = score(an);
  if (!V.quality(an, g)) return { fitness: sc * 0.3 };
  return {
    fitness: sc,
    item: {
      score: sc, n: g.n, ice: g.ice, perm: g.perm, rows: M.levelToRows(W, H, types, a, V.pieces === 2 ? b : -1),
      bits: an.bits.map(x => +x.toFixed(3)), maxTrap: an.maxTrap, choices: an.choices,
      iceMoves: an.iceMoves, permVisits: an.permVisits, solo: an.solo, lens: an.lens, presses: an.presses,
    },
  };
}

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function annealWorker({ variant, W, H, seconds, seed }) {
  const V = VARIANTS[variant];
  const N = W * H;
  const rand = rng(seed);
  const top = new TopK(TOPK);
  const deadline = Date.now() + seconds * 1000;
  let chains = 0, evals = 0;
  const pick = () => (rand() * N) | 0;
  while (Date.now() < deadline) {
    chains++;
    const types = new Uint8Array(N);
    for (let i = 0; i < N; i++) types[i] = V.randType(rand());
    let a = pick(), b = V.pieces === 2 ? pick() : -1;
    while (V.pieces === 2 && b === a) b = pick();
    types[a] = M.NORMAL;
    if (b >= 0) types[b] = M.NORMAL;
    let cur = evalState(V, W, H, types, a, b);
    const iters = 2000 + N * 80;
    const T0 = 3, T1 = 0.05;
    for (let it = 0; it < iters && Date.now() < deadline; it++) {
      const temp = T0 * Math.pow(T1 / T0, it / iters);
      const r = rand();
      const undo = [];
      let na = a, nb = b;
      if (r < 0.75) {
        const changes = rand() < 0.2 ? 2 : 1;
        for (let f = 0; f < changes; f++) {
          const i = pick();
          const old = types[i];
          const choices = V.types.filter(t => t !== old && !((i === a || i === b) && (t === M.HOLE || t === M.ICE)));
          if (!choices.length) continue;
          undo.push([i, old]);
          types[i] = choices[(rand() * choices.length) | 0];
        }
      } else {
        const i = pick();
        if (i === a || i === b) continue;
        if (types[i] === M.HOLE || types[i] === M.ICE) { undo.push([i, types[i]]); types[i] = M.NORMAL; }
        if (V.pieces === 1 || r < 0.875) na = i; else nb = i;
      }
      const nxt = evalState(V, W, H, types, na, nb);
      evals++;
      if (nxt.item) top.add(W, H, nxt.item);
      const delta = nxt.fitness - cur.fitness;
      if (delta >= 0 || rand() < Math.exp(delta / temp)) { cur = nxt; a = na; b = nb; }
      else for (let k = undo.length - 1; k >= 0; k--) types[undo[k][0]] = undo[k][1];
    }
  }
  return { items: top.items, chains, evals };
}

if (!isMainThread) {
  parentPort.postMessage(annealWorker(workerData));
} else {
  const variant = process.argv[2] || 'kryds';
  const W = +process.argv[3] || 5, H = W;
  const seconds = +process.argv[4] || 60;
  const threads = +process.argv[5] || os.cpus().length;
  if (!VARIANTS[variant]) throw new Error('ukendt variant ' + variant);
  const t0 = Date.now();
  const all = new TopK(TOPK);
  const stats = { chains: 0, evals: 0 };
  const runs = Array.from({ length: threads }, (_, t) => new Promise(resolve => {
    const w = new Worker(__filename, { workerData: { variant, W, H, seconds, seed: (Date.now() + t * 7919) >>> 0 } });
    w.on('message', (r) => {
      for (const it of r.items) all.add(W, H, it);
      stats.chains += r.chains; stats.evals += r.evals;
    });
    w.on('error', (e) => console.error(e));
    w.on('exit', resolve);
  }));
  Promise.all(runs).then(() => {
    console.log(`${variant} ${W}x${H}: ${JSON.stringify(stats)} på ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const out = data(`${variant}_${W}x${H}.json`);
    if (fs.existsSync(out)) for (const it of JSON.parse(fs.readFileSync(out, 'utf8'))) all.add(W, H, it);
    fs.writeFileSync(out, JSON.stringify(all.items, null, 1));
    for (const it of all.items.slice(0, 4)) {
      console.log(`score=${it.score.toFixed(1)} felter=${it.n} is=${it.ice} kryds=${it.perm} bits=[${it.bits.map(x => x.toFixed(1)).join(' ')}] fælde=${it.maxTrap} istræk=${it.iceMoves} krydsbesøg=${it.permVisits} pr.brik=[${it.lens}] tryk=${it.presses}`);
      console.log('   ' + it.rows.join('\n   '));
    }
  });
}
